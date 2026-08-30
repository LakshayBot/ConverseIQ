// Frontend auth client. The ONLY place the webview ever sees tokens -
// short-lived access tokens for outgoing requests; the refresh token stays
// server-side (managed by the `refresh_access_token` Tauri command).
//
// All persistence goes through Tauri commands (settings.json). No localStorage.

import { invoke } from '@tauri-apps/api/core';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  email: string;
}

/** Backend-shaped login response (snake_case keys come back as-is). */
interface LoginResponseRaw {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

/** Backend-shaped register response. */
interface RegisterResponseRaw {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * Low-level REST proxy. Routes through the Rust `callpilot_api_request`
 * command so we don't hit CORS. `authToken` is the optional bearer header.
 */
async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown,
  authToken?: string | null,
): Promise<T> {
  const json = body !== undefined ? JSON.stringify(body) : null;
  // Tauri's `invoke` treats `undefined`/`null` as the default; pass `null`
  // explicitly so the Rust side can destructure cleanly.
  const result = await invoke<any>('callpilot_api_request', {
    method,
    path,
    body: json,
    authToken: authToken ?? null,
  });
  return result as T;
}

/**
 * Extracts a user-friendly message from a `callpilot_api_request` error string.
 * The Rust side throws `"HTTP <status>: <body>"` on non-2xx; the body is usually
 * a JSON `{"error": "..."}` or a ValidationProblem payload.
 */
export function describeAuthError(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');

  // Status-code routing. The Rust proxy's "HTTP <code>: <body>" prefix is
  // stable enough to pattern-match on.
  const statusMatch = text.match(/^HTTP\s+(\d{3})\s*:/);
  if (!statusMatch) {
    if (text.includes('timed out') || text.includes('Timeout')) {
      return 'The CallPilot server took too long to respond. Check Settings → Server.';
    }
    if (text.includes('Could not connect') || text.includes('Could not reach')) {
      return "Couldn't reach the CallPilot server. Check Settings → Server.";
    }
    return text || 'Something went wrong. Please try again.';
  }

  const status = Number(statusMatch[1]);

  if (status === 400) {
    // ValidationProblem bodies look like `{"errors":{"Email":["..."]}}` or
    // a plain message. Show a generic 400 message; specific field errors are
    // rare enough that the generic copy is fine for v1.
    return 'Please check the email format and password (8+ characters).';
  }
  if (status === 401) return 'Email or password is incorrect.';
  if (status === 409) return 'An account with that email already exists.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'The CallPilot server hit an error. Please try again shortly.';
  return `Server returned ${status}.`;
}

/**
 * Logs the user in. Returns the persisted session so the caller can update
 * React state without a second round-trip.
 */
export async function login(email: string, password: string): Promise<AuthSession> {
  const trimmedEmail = email.trim().toLowerCase();
  const resp = await apiCall<LoginResponseRaw>(
    'POST',
    '/api/v1/auth/login',
    { email: trimmedEmail, password },
  );
  const session: AuthSession = {
    accessToken: resp.accessToken,
    refreshToken: resp.refreshToken,
    accessTokenExpiresAt: resp.accessTokenExpiresAt,
    refreshTokenExpiresAt: resp.refreshTokenExpiresAt,
    email: trimmedEmail,
  };
  await invoke('set_auth_token', {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    email: session.email,
  });
  return session;
}

/**
 * Registers a new account, then immediately logs it in so the user lands on
 * the home screen without a second form.
 */
export async function register(email: string, password: string): Promise<AuthSession> {
  const trimmedEmail = email.trim().toLowerCase();
  // 1) Create the user.
  await apiCall<RegisterResponseRaw>('POST', '/api/v1/auth/register', {
    email: trimmedEmail,
    password,
    confirmPassword: password,
  });
  // 2) Reuse the login flow so we persist a session in one place.
  return login(trimmedEmail, password);
}

/**
 * Best-effort sign-out. We always clear the local session, even if the
 * server-side logout call fails - the access token will expire on its own
 * and the refresh token is server-revoked on the next attempt.
 */
export async function logout(): Promise<void> {
  const session = await getSession().catch(() => null);

  // Build the logout body. If we don't have a refresh token (rare - would
  // mean the local store was corrupted), skip the server call.
  if (session?.refreshToken) {
    try {
      await apiCall<{ message: string }>(
        'POST',
        '/api/v1/auth/logout',
        { refreshToken: session.refreshToken },
        session.accessToken,
      );
    } catch (e) {
      // Swallow - we still want to wipe the local session.
      console.warn('[auth] server-side logout failed:', e);
    }
  }

  await invoke('clear_auth_token');
}

/**
 * Tries to restore the session on app launch. Returns the (possibly rotated)
 * session if the server accepted the stored refresh token, otherwise `null`.
 */
export async function tryRestoreSession(): Promise<AuthSession | null> {
  try {
    const resp = await invoke<AuthSession | null>('refresh_access_token');
    if (!resp) return null;
    return {
      accessToken: resp.accessToken,
      refreshToken: resp.refreshToken,
      accessTokenExpiresAt: resp.accessTokenExpiresAt,
      refreshTokenExpiresAt: resp.refreshTokenExpiresAt,
      email: resp.email,
    };
  } catch (e) {
    console.warn('[auth] session restore failed:', e);
    // The server rejected the refresh token - the Rust side already cleared
    // the store in that case, so the next login starts fresh.
    return null;
  }
}

/** Returns the cached session without hitting the network. */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const resp = await invoke<AuthSession | null>('get_auth_session');
    if (!resp) return null;
    return {
      accessToken: resp.accessToken,
      refreshToken: resp.refreshToken,
      accessTokenExpiresAt: resp.accessTokenExpiresAt,
      refreshTokenExpiresAt: resp.refreshTokenExpiresAt,
      email: resp.email,
    };
  } catch {
    return null;
  }
}

/**
 * Checks if a JWT token is expired or will expire within the buffer.
 * Uses the token's exp claim if available, falls back to expiresAt.
 */
function isTokenExpiringSoon(expiresAt: string | null, bufferMs = 5 * 60 * 1000): boolean {
  if (!expiresAt) return false;
  try {
    const expiry = new Date(expiresAt).getTime();
    return Date.now() >= expiry - bufferMs;
  } catch {
    return false;
  }
}

function isJwtExpiringSoon(token: string | null, bufferMs = 5 * 60 * 1000): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp;
    if (typeof exp === 'number') {
      return Date.now() >= exp * 1000 - bufferMs;
    }
  } catch {
    // Fall through to expiresAt check
  }
  return false;
}

// ── Refresh queue: prevents concurrent refresh calls (like Axios interceptors) ──
let refreshPromise: Promise<AuthSession | null> | null = null;
let sessionExpiredNotified = false;

function emitSessionExpired() {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  // Dispatch global event for AuthContext to handle logout + redirect
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('callpilot:session-expired'));
  }
}

export function resetSessionExpiredFlag() {
  sessionExpiredNotified = false;
}

/**
 * Attempts to refresh the access token. Uses a shared promise to prevent
 * concurrent refreshes (professional pattern like Axios interceptors).
 */
async function refreshAccessToken(): Promise<AuthSession | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshed = await invoke<AuthSession | null>('refresh_access_token');
      if (refreshed) resetSessionExpiredFlag();
      return refreshed;
    } catch (e) {
      const msg = String(e);
      // 401 or refresh token expired/revoked = session dead
      if (msg.includes('401') || msg.includes('expired') || msg.includes('Invalid')) {
        emitSessionExpired();
      }
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Authenticated REST helper. Use this for any endpoint beyond `/auth/*`.
 * Reads the current access token server-side and attaches it as a bearer
 * header - the token never lives in the webview for longer than one call.
 *
 * Professional session handling (like major apps):
 * - On 401, attempts silent refresh once then retries
 * - On refresh failure, emits session-expired event for global logout
 * - Queues concurrent requests during refresh (no thundering herd)
 * - No proactive refresh here — handled by AuthContext periodic check
 *   and Rust get_auth_access_token to avoid race after login
 */
export async function authedApiCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let token: string | null = null;
  try {
    token = (await invoke<string | null>('get_auth_access_token')) ?? null;
  } catch {
    // No session - fall through and let the server reject with 401.
  }

  try {
    return await apiCall<T>(method, path, body, token);
  } catch (e) {
    const msg = String(e);
    const is401 = msg.includes('HTTP 401') || msg.includes('401');

    if (!is401) throw e;

    // 401: try silent refresh once (with queue)
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      emitSessionExpired();
      throw new Error('HTTP 401: Session expired. Please log in again.');
    }

    // Retry with new token
    try {
      return await apiCall<T>(method, path, body, refreshed.accessToken);
    } catch (retryErr) {
      const retryMsg = String(retryErr);
      if (retryMsg.includes('401')) {
        emitSessionExpired();
      }
      throw retryErr;
    }
  }
}
