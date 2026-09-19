import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createGzipFetch } from "../lib/gzip-fetch.ts";

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

function options(captured: Captured[], overrides: Partial<Parameters<typeof createGzipFetch>[0]> = {}) {
  return createGzipFetch({
    enabledHosts: new Set(["relay.example"]),
    minBytes: 16,
    level: 6,
    debug: false,
    baseFetch: base(captured),
    ...overrides,
  });
}

test("compresses string POST bodies on an enabled host", async () => {
  const captured: Captured[] = [];
  const payload = JSON.stringify({ hello: "world".repeat(50) });

  await options(captured)(URL_ENABLED, {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json", "content-length": String(payload.length) },
  });

  const { init } = captured[0];
  const headers = new Headers(init?.headers as HeadersInit);
  assert.equal(headers.get("content-encoding"), "gzip");
  assert.equal(headers.get("content-length"), null);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(gunzipSync(init?.body as Buffer).toString("utf8"), payload);
});

test("skips hosts that are not in the allowlist", async () => {
  const captured: Captured[] = [];
  await options(captured)(URL_OTHER, { method: "POST", body: "x".repeat(100) });
  const headers = new Headers(captured[0].init?.headers as HeadersInit);
  assert.equal(headers.get("content-encoding"), null);
});

test("skips non-POST methods", async () => {
  const captured: Captured[] = [];
  await options(captured)(URL_ENABLED, { method: "GET", body: "x".repeat(100) });
  const headers = new Headers(captured[0].init?.headers as HeadersInit);
  assert.equal(headers.get("content-encoding"), null);
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

test("debug logging includes the host and ratio", async () => {
  const lines: string[] = [];
  const captured: Captured[] = [];
  await options(captured, { debug: true, log: (m) => lines.push(m) })(URL_ENABLED, {
    method: "POST",
    body: JSON.stringify({ text: "abcd".repeat(500) }),
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[pi-provider-gzip\] relay\.example \d+ -> \d+ bytes \(\d+\.\dx\)/);
});

test("malformed URLs never crash and are not compressed", async () => {
  const captured: Captured[] = [];
  await options(captured)("http://[invalid", { method: "POST", body: "x".repeat(100) });
  const headers = new Headers(captured[0].init?.headers as HeadersInit);
  assert.equal(headers.get("content-encoding"), null);
});
