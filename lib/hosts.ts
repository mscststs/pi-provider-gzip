/**
 * Resolve which hosts may receive gzip-compressed request bodies.
 *
 * The interceptor works at the `fetch` layer, where only the URL is available
 * (not the pi provider id). To keep the interceptor scoped to model traffic,
 * we build a host allowlist from the live model registry and drop any host
 * whose provider opted out via `compat.gzip: false`.
 */

/**
 * The subset of a pi model we need. `compat` is intentionally `unknown`:
 * pi's declared compat types do not include our `gzip` key, even though the
 * runtime merges it in, so we read it defensively.
 */
export interface ModelLike {
  baseUrl?: string | null;
  compat?: unknown;
}

/** Extract the `host:port` of a base URL, or `undefined` when unparseable. */
export function hostOf(baseUrl: string | null | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Read the `gzip` opt-out flag from a provider/model `compat` object.
 * Returns `undefined` when the flag is absent or not a boolean.
 */
export function readGzipFlag(compat: unknown): boolean | undefined {
  if (typeof compat !== "object" || compat === null) return undefined;
  const value = (compat as Record<string, unknown>).gzip;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Build the set of hosts that should be gzip-compressed.
 *
 * A host is enabled when at least one model uses it and no model on that host
 * opted out. Opting out wins over opting in, which is the safe default when a
 * provider shares a host with another provider.
 */
export function resolveEnabledHosts(models: Iterable<ModelLike>): Set<string> {
  const enabled = new Set<string>();
  const disabled = new Set<string>();

  for (const model of models) {
    const host = hostOf(model.baseUrl);
    if (!host) continue;
    if (readGzipFlag(model.compat) === false) disabled.add(host);
    else enabled.add(host);
  }

  for (const host of disabled) enabled.delete(host);
  return enabled;
}
