import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOf, readGzipFlag, resolveEnabledHosts } from "../lib/hosts.ts";

test("hostOf extracts host:port and tolerates bad input", () => {
  assert.equal(hostOf("https://api.example.com/v1"), "api.example.com");
  assert.equal(hostOf("http://127.0.0.1:8788/v1"), "127.0.0.1:8788");
  assert.equal(hostOf("not a url"), undefined);
  assert.equal(hostOf(undefined), undefined);
  assert.equal(hostOf(""), undefined);
});

test("default: every provider host is enabled", () => {
  const hosts = resolveEnabledHosts([
    { baseUrl: "https://relay-a.example/v1" },
    { baseUrl: "https://relay-b.example/v1" },
  ]);
  assert.deepEqual([...hosts].sort(), ["relay-a.example", "relay-b.example"]);
});

test("compat.gzip=false removes a host", () => {
  const hosts = resolveEnabledHosts([
    { baseUrl: "https://keep.example/v1" },
    { baseUrl: "https://skip.example/v1", compat: { gzip: false } },
  ]);
  assert.deepEqual([...hosts], ["keep.example"]);
});

test("compat.gzip=true keeps a host (no-op)", () => {
  const hosts = resolveEnabledHosts([{ baseUrl: "https://keep.example/v1", compat: { gzip: true } }]);
  assert.deepEqual([...hosts], ["keep.example"]);
});

test("opt-out wins when a host is shared", () => {
  const hosts = resolveEnabledHosts([
    { baseUrl: "https://shared.example/v1" },
    { baseUrl: "https://shared.example/v1", compat: { gzip: false } },
  ]);
  assert.equal(hosts.size, 0);
});

test("models without a baseUrl are ignored", () => {
  const hosts = resolveEnabledHosts([{}, { baseUrl: null }, { baseUrl: "https://ok.example/v1" }]);
  assert.deepEqual([...hosts], ["ok.example"]);
});

test("readGzipFlag reads only boolean gzip values", () => {
  assert.equal(readGzipFlag({ gzip: false }), false);
  assert.equal(readGzipFlag({ gzip: true }), true);
  assert.equal(readGzipFlag({ gzip: "nope" }), undefined);
  assert.equal(readGzipFlag({ supportsStore: true }), undefined);
  assert.equal(readGzipFlag(null), undefined);
  assert.equal(readGzipFlag(undefined), undefined);
});

test("unrelated compat keys do not disable a host", () => {
  const hosts = resolveEnabledHosts([{ baseUrl: "https://keep.example/v1", compat: { supportsStore: false } }]);
  assert.deepEqual([...hosts], ["keep.example"]);
});
