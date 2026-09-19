/**
 * Build a `fetch` implementation that compresses request bodies (gzip, Brotli
 * or Zstandard) before they leave the process.
 *
 * Free of any pi imports so it can be unit-tested with plain `node --test`.
 */
import { compressBody, pickEncoding, type Encoding } from "./encodings.ts";

export type RequestLogger = (message: string) => void;

export interface CompressionFetchConfig {
  /** Hosts allowed to receive compressed bodies, mapped to their encoding. */
  targets: ReadonlyMap<string, Encoding>;
  /** Bodies smaller than this many bytes are sent as-is. */
  minBytes: number;
  /** Shared `0`-`9` compression level, mapped per codec. */
  level: number;
  /** When true, emit a debug line per compression. */
  debug: boolean;
  /** Optional debug sink. Defaults to `process.stderr.write`. */
  log?: RequestLogger;
}

export interface CompressionFetchOptions extends CompressionFetchConfig {
  /** Underlying fetch. Defaults to `globalThis.fetch`. */
  baseFetch?: typeof fetch;
}

function requestHost(input: RequestInfo | URL): string | undefined {
  try {
    if (typeof input === "string") return new URL(input).host;
    if (input instanceof URL) return input.host;
    if (typeof Request !== "undefined" && input instanceof Request) return new URL(input.url).host;
  } catch {
    // Malformed URL: never compress.
  }
  return undefined;
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function isCompressibleBody(body: unknown): body is string {
  return typeof body === "string";
}

/**
 * Wrap `baseFetch` so string POST bodies at or above `minBytes`, addressed to a
 * configured host, are compressed and tagged with the host's `Content-Encoding`.
 *
 * The encoding is requested per host via `compat.encoding`; if the runtime
 * cannot produce it (or the value was invalid), it silently falls back to gzip.
 *
 * Everything else (other methods, other hosts, non-string bodies, small
 * payloads) is forwarded untouched.
 */
export function createCompressionFetch(options: CompressionFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  const log = options.log ?? ((message: string) => process.stderr.write(message));

  return function compressionFetch(input, init) {
    const requestInit = init as RequestInit | undefined;
    const body = requestInit?.body;
    const host = requestHost(input);
    const requested = host !== undefined ? options.targets.get(host) : undefined;

    if (
      requested !== undefined &&
      requestMethod(input, requestInit) === "POST" &&
      isCompressibleBody(body) &&
      body.length >= options.minBytes
    ) {
      const encoding = pickEncoding(requested);
      const compressed = compressBody(encoding, Buffer.from(body, "utf8"), options.level);

      const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
      headers.set("content-encoding", encoding);
      headers.delete("content-length");

      if (options.debug) {
        const ratio = (body.length / compressed.length).toFixed(1);
        log(
          `[pi-provider-gzip] ${host} ${encoding} ${body.length} -> ${compressed.length} bytes (${ratio}x)\n`,
        );
      }

      return baseFetch(input, {
        ...requestInit,
        body: compressed as unknown as BodyInit,
        headers,
      });
    }

    return baseFetch(input, init);
  };
}
