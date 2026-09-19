/**
 * Build a `fetch` implementation that gzip-compresses request bodies before
 * they leave the process.
 *
 * Free of any pi imports so it can be unit-tested with plain `node --test`.
 */
import { gzipSync } from "node:zlib";

export type RequestLogger = (message: string) => void;

export interface GzipFetchConfig {
  /** Hosts allowed to receive compressed bodies (see `lib/hosts.ts`). */
  enabledHosts: ReadonlySet<string>;
  /** Bodies smaller than this many bytes are sent as-is. */
  minBytes: number;
  /** zlib compression level. */
  level: number;
  /** When true, emit a debug line per compression. */
  debug: boolean;
  /** Optional debug sink. Defaults to `process.stderr.write`. */
  log?: RequestLogger;
}

export interface GzipFetchOptions extends GzipFetchConfig {
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
 * Wrap `baseFetch` so string POST bodies at or above `minBytes`, addressed to
 * an enabled host, are gzip-compressed and tagged with
 * `Content-Encoding: gzip`.
 *
 * Everything else (other methods, other hosts, non-string bodies, small
 * payloads) is forwarded untouched.
 */
export function createGzipFetch(options: GzipFetchOptions): typeof fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch;
  const log = options.log ?? ((message: string) => process.stderr.write(message));

  return function gzipFetch(input, init) {
    const requestInit = init as RequestInit | undefined;
    const body = requestInit?.body;
    const host = requestHost(input);

    if (
      host !== undefined &&
      options.enabledHosts.has(host) &&
      requestMethod(input, requestInit) === "POST" &&
      isCompressibleBody(body) &&
      body.length >= options.minBytes
    ) {
      const compressed = gzipSync(Buffer.from(body, "utf8"), { level: options.level });

      const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
      headers.set("content-encoding", "gzip");
      headers.delete("content-length");

      if (options.debug) {
        const ratio = (body.length / compressed.length).toFixed(1);
        log(
          `[pi-provider-gzip] ${host} ${body.length} -> ${compressed.length} bytes (${ratio}x)\n`,
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
