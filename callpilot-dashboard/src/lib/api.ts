const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ accessToken: string; refreshToken: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, displayName: string) =>
      request("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      }),
  },
  providers: {
    list: () =>
      request<{ id: string; provider: string; model: string; endpoint?: string }[]>("/api/v1/providers"),
    create: (data: Record<string, unknown>) =>
      request("/api/v1/providers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetch(`${API_URL}/api/v1/providers/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      }),
  },
  meetings: {
    list: () =>
      request<{ id: string; state: string; startedAt?: string }[]>("/api/v1/meetings"),
    create: () =>
      request<{ meetingId: string; state: string }>("/api/v1/meetings", { method: "POST" }),
  },
};
