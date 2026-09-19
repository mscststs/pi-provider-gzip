/**
 * Request-body compression codecs.
 *
 * pi's extension point runs on top of `node:zlib`, which ships gzip, Brotli
 * (`br`) and — since Node 22.15 — Zstandard (`zstd`). Which one a relay accepts
 * varies, so the choice is configurable per provider via `compat.encoding`.
 *
 * Everything here is pi-free so it can be unit-tested with plain `node --test`.
 */
import * as zlib from "node:zlib";

/** A supported `Content-Encoding` value. */
export type Encoding = "gzip" | "br" | "zstd";

/** Used when a provider does not request anything else. */
export const DEFAULT_ENCODING: Encoding = "gzip";

/** All encodings, in preference order used by docs/tests. */
export const ENCODINGS: readonly Encoding[] = ["gzip", "br", "zstd"];

/**
 * `zstdCompressSync` only exists on Node >= 22.15. Imported through the module
 * namespace (instead of a named import) so older runtimes can still load this
 * extension and fall back to gzip at request time.
 */
type SyncCompressor = (buffer: Buffer, options?: { params?: Record<number, number> }) => Buffer;

const zstdCompressSync = (zlib as unknown as { zstdCompressSync?: SyncCompressor }).zstdCompressSync;

const VALUE_ALIASES: Readonly<Record<string, Encoding>> = {
  gzip: "gzip",
  br: "br",
  brotli: "br",
  zstd: "zstd",
  zstandard: "zstd",
};

/**
 * Normalize a user-provided `compat.encoding` value.
 * Returns `undefined` for anything that is not a known encoding, so callers can
 * fall back to `DEFAULT_ENCODING` ("gzip").
 */
export function normalizeEncoding(value: unknown): Encoding | undefined {
  if (typeof value !== "string") return undefined;
  return VALUE_ALIASES[value.trim().toLowerCase()];
}

/** Whether the running Node runtime can actually produce this encoding. */
export function isEncodingSupported(encoding: Encoding): boolean {
  return encoding !== "zstd" || typeof zstdCompressSync === "function";
}

/**
 * Resolve the encoding that will be used for a request: the requested one when
 * the runtime supports it, otherwise `"gzip"`.
 *
 * `supported` is injectable so the fallback can be unit-tested on runtimes that
 * do have zstd.
 */
export function pickEncoding(
  requested: Encoding,
  supported: (encoding: Encoding) => boolean = isEncodingSupported,
): Encoding {
  return supported(requested) ? requested : DEFAULT_ENCODING;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Map the shared `0`-`9` level onto Brotli's `0`-`11` quality scale. */
export function brotliQuality(level: number): number {
  return clamp(Math.round((level / 9) * zlib.constants.BROTLI_MAX_QUALITY), 0, zlib.constants.BROTLI_MAX_QUALITY);
}

/** Map the shared `0`-`9` level onto a Zstandard level (capped at 19). */
export function zstdLevel(level: number): number {
  return clamp(Math.round((level / 9) * 19), 1, 19);
}

/**
 * Compress a request body with the given encoding.
 *
 * `level` is the same `0`-`9` knob across codecs; it is mapped onto each
 * codec's native scale.
 */
export function compressBody(encoding: Encoding, body: Buffer, level: number): Buffer {
  switch (encoding) {
    case "br":
      return zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality(level) },
      });
    case "zstd": {
      if (zstdCompressSync === undefined) {
        throw new Error("zstd is not available in this Node.js runtime");
      }
      return zstdCompressSync(body, {
        params: { [zlib.constants.ZSTD_c_compressionLevel]: zstdLevel(level) },
      });
    }
    default:
      return zlib.gzipSync(body, { level });
  }
}
