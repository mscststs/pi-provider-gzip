/**
 * Configuration for pi-provider-gzip.
 *
 * The whole feature is governed by a single master switch (`PI_GZIP`).
 * Per-provider opt-out lives in the provider's own settings as
 * `compat: { gzip: false }` — see `docs/benchmarks.md` and the README.
 */

/** Bodies smaller than this many bytes are sent as-is. */
export const DEFAULT_MIN_BYTES = 1024;

/** Default zlib compression level (0-9). */
export const DEFAULT_LEVEL = 6;

export interface GzipConfig {
  /** Master switch. `false` disables the extension entirely. */
  enabled: boolean;
  /** Minimum request-body byte length (UTF-8 string length) required to compress. */
  minBytes: number;
  /** zlib compression level, clamped to 0-9. */
  level: number;
  /** When true, log each compression to stderr. */
  debug: boolean;
}

type Env = Record<string, string | undefined>;

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read the extension configuration from the process environment.
 *
 * | Variable            | Default | Meaning                                          |
 * | ------------------- | ------- | ------------------------------------------------ |
 * | `PI_GZIP`           | `1`     | The single master switch. Set to `0` to disable. |
 * | `PI_GZIP_MIN_BYTES` | `1024`  | Only compress bodies at least this large.        |
 * | `PI_GZIP_LEVEL`     | `6`     | zlib level, clamped to `0`-`9`.                  |
 * | `PI_GZIP_DEBUG`     | `0`     | Set to `1` to log compression details to stderr. |
 *
 * Per-provider opt-out is configured on the provider itself via
 * `"compat": { "gzip": false }` in `models.json`, not via environment
 * variables.
 */
export function readConfig(env: Env = process.env): GzipConfig {
  return {
    enabled: env.PI_GZIP !== "0",
    minBytes: Math.max(0, parseInteger(env.PI_GZIP_MIN_BYTES, DEFAULT_MIN_BYTES)),
    level: Math.min(9, Math.max(0, parseInteger(env.PI_GZIP_LEVEL, DEFAULT_LEVEL))),
    debug: env.PI_GZIP_DEBUG === "1",
  };
}
