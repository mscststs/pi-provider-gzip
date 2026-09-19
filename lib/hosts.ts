/**
 * Resolve which hosts may receive compressed request bodies, and with which
 * encoding.
 *
 * The interceptor works at the `fetch` layer, where only the URL is available
 * (not the pi provider id). To keep the interceptor scoped to model traffic,
 * we build a host -> encoding map from the live model registry and drop any
 * host whose provider opted out via `compat.gzip: false`.
 */
import { DEFAULT_ENCODING, normalizeEncoding, type Encoding } from "./encodings.ts";

/**
 * The subset of a pi model we need. `compat` is intentionally `unknown`:
 * pi's declared compat types do not include our keys, even though the runtime
 * merges them in, so we read them defensively.
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
 * Read the requested encoding from a provider/model `compat` object.
 *
 * Accepts `gzip`, `br`/`brotli` and `zstd`/`zstandard` (case-insensitive).
 * Anything else — including a missing key — returns `undefined` so the caller
 * falls back to gzip.
 */
export function readEncodingFlag(compat: unknown): Encoding | undefined {
  if (typeof compat !== "object" || compat === null) return undefined;
  return normalizeEncoding((compat as Record<string, unknown>).encoding);
}

/**
 * Build the host -> encoding map used by the fetch interceptor.
 *
 * Rules, in order:
 *  - `compat.gzip: false` removes the host entirely (opt-out wins).
 *  - `compat.encoding` selects the algorithm for that host; invalid values
 *    fall back to `defaultEncoding` (gzip).
 *  - A host shared by several models uses the first explicitly configured
 *    encoding; otherwise the default.
 */
export function resolveCompressionTargets(
  models: Iterable<ModelLike>,
  defaultEncoding: Encoding = DEFAULT_ENCODING,
): Map<string, Encoding> {
  const targets = new Map<string, Encoding>();
  const explicit = new Map<string, Encoding>();
  const disabled = new Set<string>();

  for (const model of models) {
    const host = hostOf(model.baseUrl);
    if (!host) continue;

    if (readGzipFlag(model.compat) === false) {
      disabled.add(host);
      continue;
    }

    const requested = readEncodingFlag(model.compat);
    if (requested !== undefined && !explicit.has(host)) explicit.set(host, requested);
    if (!targets.has(host)) targets.set(host, requested ?? defaultEncoding);
  }

  for (const [host, encoding] of explicit) targets.set(host, encoding);
  for (const host of disabled) targets.delete(host);
  return targets;
}
