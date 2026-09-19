/**
 * Process-wide `fetch` interceptor.
 *
 * Installed once per process and re-configured on every `session_start` so the
 * host allowlist follows the active model registry. The original `fetch` is
 * stored on `globalThis` under a symbol, which makes repeated installs
 * (extension reloads, multiple sessions) idempotent instead of nesting
 * wrappers.
 */
import { createGzipFetch, type GzipFetchConfig } from "./gzip-fetch.ts";

const STATE_KEY = Symbol.for("pi-provider-gzip.interceptor");

interface InterceptorState {
  originalFetch: typeof fetch;
}

function getState(): InterceptorState | undefined {
  return (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY] as InterceptorState | undefined;
}

/** Install or update the gzip interceptor. Safe to call repeatedly. */
export function installFetchInterceptor(config: GzipFetchConfig): void {
  const existing = getState();
  const originalFetch = existing?.originalFetch ?? globalThis.fetch;

  if (!existing) {
    (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY] = { originalFetch };
  }

  globalThis.fetch = createGzipFetch({ ...config, baseFetch: originalFetch });
}

/** Restore the original `fetch`. Primarily useful for tests. */
export function uninstallFetchInterceptor(): void {
  const existing = getState();
  if (!existing) return;
  globalThis.fetch = existing.originalFetch;
  delete (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY];
}
