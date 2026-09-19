import assert from "node:assert/strict";
import { test } from "node:test";
import { installFetchInterceptor, uninstallFetchInterceptor } from "../lib/interceptor.ts";

test("compresses through the global fetch and restores on uninstall", async () => {
  const realFetch = globalThis.fetch;
  const captured: Array<{ init: RequestInit | undefined }> = [];
  const fake: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ init });
    return new Response("ok");
  }) as typeof fetch;

  globalThis.fetch = fake;
  try {
    installFetchInterceptor({
      enabledHosts: new Set(["relay.example"]),
      minBytes: 1,
      level: 6,
      debug: false,
      log: () => {},
    });

    await globalThis.fetch("https://relay.example/v1/chat/completions", {
      method: "POST",
      body: "x".repeat(100),
    });
    assert.equal(new Headers(captured.at(-1)?.init?.headers).get("content-encoding"), "gzip");

    // Re-installing updates the allowlist without stacking wrappers.
    installFetchInterceptor({
      enabledHosts: new Set(),
      minBytes: 1,
      level: 6,
      debug: false,
      log: () => {},
    });
    await globalThis.fetch("https://relay.example/v1/chat/completions", {
      method: "POST",
      body: "x".repeat(100),
    });
    assert.equal(new Headers(captured.at(-1)?.init?.headers).get("content-encoding"), null);

    uninstallFetchInterceptor();
    assert.equal(globalThis.fetch, fake);
  } finally {
    uninstallFetchInterceptor();
    globalThis.fetch = realFetch;
  }
});

test("uninstall is a no-op when not installed", () => {
  uninstallFetchInterceptor();
  assert.equal(typeof globalThis.fetch, "function");
});
