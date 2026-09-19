import assert from "node:assert/strict";
import { test } from "node:test";
import * as zlib from "node:zlib";
import { createCompressionFetch } from "../lib/compress-fetch.ts";
import type { Encoding } from "../lib/encodings.ts";

interface Captured {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
}

function base(captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ input, init });
    return new Response("ok");
  }) as typeof fetch;
}

const URL_ENABLED = "https://relay.example/v1/chat/completions";
const URL_OTHER = "https://other.example/v1/chat/completions";

function options(
  captured: Captured[],
  overrides: Partial<Parameters<typeof createCompressionFetch>[0]> = {},
) {
  return createCompressionFetch({
    targets: new Map([["relay.example", "gzip"]]),
    minBytes: 16,
    level: 6,
    debug: false,
    baseFetch: base(captured),
    ...overrides,
  });
}

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers as HeadersInit).get(name);
}

function decompress(encoding: string, body: unknown): string {
  const buffer = body as Buffer;
  if (encoding === "br") return zlib.brotliDecompressSync(buffer).toString("utf8");
  if (encoding === "zstd") return zlib.zstdDecompressSync(buffer).toString("utf8");
  return zlib.gunzipSync(buffer).toString("utf8");
}

test("compresses string POST bodies with gzip by default", async () => {
  const captured: Captured[] = [];
  const payload = JSON.stringify({ hello: "world".repeat(50) });

  await options(captured)(URL_ENABLED, {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json", "content-length": String(payload.length) },
  });

  const { init } = captured[0];
  const encoding = header(init, "content-encoding");
  assert.equal(encoding, "gzip");
  assert.equal(header(init, "content-length"), null);
  assert.equal(header(init, "content-type"), "application/json");
  assert.equal(decompress(encoding!, init?.body), payload);
});

for (const encoding of ["br", "zstd"] as const) {
  test(`uses ${encoding} when the host requests it`, { skip: !zstdSafe(encoding) }, async () => {
    const captured: Captured[] = [];
    const payload = JSON.stringify({ hello: "world".repeat(50) });

    await options(captured, { targets: new Map<string, Encoding>([["relay.example", encoding]]) })(
      URL_ENABLED,
      { method: "POST", body: payload },
    );

    const { init } = captured[0];
    assert.equal(header(init, "content-encoding"), encoding);
    assert.equal(decompress(encoding, init?.body), payload);
  });
}

function zstdSafe(encoding: Encoding): boolean {
  return encoding !== "zstd" || typeof zlib.zstdCompressSync === "function";
}

test("skips hosts that are not in the allowlist", async () => {
  const captured: Captured[] = [];
  await options(captured)(URL_OTHER, { method: "POST", body: "x".repeat(100) });
  assert.equal(header(captured[0].init, "content-encoding"), null);
});

test("skips non-POST methods", async () => {
  const captured: Captured[] = [];
  await options(captured)(URL_ENABLED, { method: "GET", body: "x".repeat(100) });
  assert.equal(header(captured[0].init, "content-encoding"), null);
});

test("leaves bodies below the threshold untouched", async () => {
  const captured: Captured[] = [];
  const payload = JSON.stringify({ hi: true });
  await options(captured)(URL_ENABLED, { method: "POST", body: payload });
  assert.equal(captured[0].init?.body, payload);
});

test("passes through non-string bodies", async () => {
  const captured: Captured[] = [];
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  await options(captured)(URL_ENABLED, { method: "POST", body: bytes });
  assert.equal(captured[0].init?.body, bytes);
});

test("debug logging includes host, encoding and ratio", async () => {
  const lines: string[] = [];
  const captured: Captured[] = [];
  await options(captured, { debug: true, log: (m) => lines.push(m) })(URL_ENABLED, {
    method: "POST",
    body: JSON.stringify({ text: "abcd".repeat(500) }),
  });
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /\[pi-provider-gzip\] relay\.example gzip \d+ -> \d+ bytes \(\d+\.\dx\)/,
  );
});

test("malformed URLs never crash and are not compressed", async () => {
  const captured: Captured[] = [];
  await options(captured)("http://[invalid", { method: "POST", body: "x".repeat(100) });
  assert.equal(header(captured[0].init, "content-encoding"), null);
});
