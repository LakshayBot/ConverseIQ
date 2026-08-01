#!/usr/bin/env node
/**
 * dev-warmup - runs `next dev` and blocks until the first compile is done.
 *
 * Why: Tauri 2's dev orchestration polls `devUrl` and opens the webview the
 * moment the dev server returns 200 on `/`. Next.js's `next dev` answers 200
 * as soon as it starts *listening*, which is BEFORE the first route compile
 * has produced the layout/page chunks. The webview then requests
 * `/_next/static/chunks/app/layout.js`, the dev server hasn't emitted it yet,
 * and the request hangs until the WKWebView timeout fires:
 *
 *   ChunkLoadError: Loading chunk app/layout failed.
 *   (timeout: http://localhost:3118/_next/static/chunks/app/layout.js)
 *
 * The fix: kick `next dev` off in a child process, then poll the dev URL and
 * its referenced layout chunk until both are 200 - only then does this
 * script return. Tauri sees `beforeDevCommand` exit cleanly and the dev
 * server is already warm, so the webview's first request succeeds.
 *
 * Usage: `pnpm dev:warm` (wired into `beforeDevCommand` in tauri.conf.json).
 */

const { spawn, execSync } = require('child_process');
const http = require('http');

const PORT = parseInt(process.env.PORT || '3118', 10);
const DEV_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 180_000; // 3 minutes - first compile on cold cache
const POLL_INTERVAL_MS = 500;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function pollUntilReady() {
  const start = Date.now();
  let lastError = null;
  for (;;) {
    const elapsed = Date.now() - start;
    if (elapsed > READY_TIMEOUT_MS) {
      throw new Error(
        `Next.js did not finish first-compile within ${READY_TIMEOUT_MS / 1000}s ` +
          `(last error: ${lastError || 'none'})`,
      );
    }
    try {
      const idx = await get(DEV_URL);
      if (idx.status === 200 && idx.body.length > 100) {
        // Pull the first layout chunk URL Next.js embedded in the HTML.
        const m = idx.body.match(/\/_next\/static\/chunks\/app\/layout[^"\\]*\.js/);
        if (m) {
          const chunkUrl = DEV_URL + m[0];
          const chunk = await get(chunkUrl);
          if (chunk.status === 200 && chunk.body.length > 1024) {
            console.log(
              `[dev-warmup] ready after ${elapsed}ms - chunk ${m[0]} ` +
                `(${chunk.body.length} bytes)`,
            );
            return;
          }
          lastError = `chunk ${m[0]} returned status=${chunk.status}, size=${chunk.body.length}`;
        } else {
          lastError = 'index HTML returned 200 but no layout chunk URL found yet';
        }
      } else {
        lastError = `index returned status=${idx.status}, size=${idx.body.length}`;
      }
    } catch (e) {
      lastError = e.message || String(e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function killStaleServer() {
  try {
    execSync(
      `lsof -ti:${PORT} -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true`,
      { stdio: 'ignore' },
    );
  } catch {
    // best-effort cleanup
  }
}

async function main() {
  killStaleServer();

  console.log(`[dev-warmup] starting next dev on :${PORT}`);
  const next = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    stdio: 'inherit',
    env: process.env,
  });

  // Forward signals so Ctrl+C / Tauri-exit cleans up the child.
  const shutdown = (signal) => {
    if (!next.killed) {
      try {
        next.kill(signal);
      } catch {}
    }
    process.exit(signal === 'SIGKILL' ? 137 : 0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  next.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });

  try {
    await pollUntilReady();
    // Detach our polling - let `next dev` keep running so Tauri can keep the
    // dev server alive. Our job is done; Tauri will own the lifecycle from
    // here (with our PID as the `beforeDevCommand` foreground process).
  } catch (e) {
    console.error(`[dev-warmup] FAILED: ${e.message}`);
    try {
      next.kill('SIGKILL');
    } catch {}
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[dev-warmup] unexpected error:', e);
  process.exit(1);
});