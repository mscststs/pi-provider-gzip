import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOf, readEncodingFlag, readGzipFlag, resolveCompressionTargets } from "../lib/hosts.ts";

test("hostOf extracts host:port and tolerates bad input", () => {
  assert.equal(hostOf("https://api.example.com/v1"), "api.example.com");
  assert.equal(hostOf("http://127.0.0.1:8788/v1"), "127.0.0.1:8788");
  assert.equal(hostOf("not a url"), undefined);
  assert.equal(hostOf(undefined), undefined);
  assert.equal(hostOf(""), undefined);
});

test("default: every provider host is enabled with gzip", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://relay-a.example/v1" },
    { baseUrl: "https://relay-b.example/v1" },
  ]);
  assert.deepEqual([...targets], [
    ["relay-a.example", "gzip"],
    ["relay-b.example", "gzip"],
  ]);
});

test("compat.encoding selects the algorithm per host", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://a.example/v1", compat: { encoding: "br" } },
    { baseUrl: "https://b.example/v1", compat: { encoding: "zstd" } },
    { baseUrl: "https://c.example/v1" },
  ]);
  assert.equal(targets.get("a.example"), "br");
  assert.equal(targets.get("b.example"), "zstd");
  assert.equal(targets.get("c.example"), "gzip");
});

test("invalid or unknown compat.encoding falls back to gzip", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://bad.example/v1", compat: { encoding: "deflate" } },
    { baseUrl: "https://nope.example/v1", compat: { encoding: 42 } },
    { baseUrl: "https://empty.example/v1", compat: { encoding: "" } },
  ]);
  assert.equal(targets.get("bad.example"), "gzip");
  assert.equal(targets.get("nope.example"), "gzip");
  assert.equal(targets.get("empty.example"), "gzip");
});

test("compat.gzip=false removes a host regardless of encoding", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://keep.example/v1" },
    { baseUrl: "https://skip.example/v1", compat: { gzip: false } },
    { baseUrl: "https://also-skip.example/v1", compat: { gzip: false, encoding: "br" } },
  ]);
  assert.deepEqual([...targets.keys()], ["keep.example"]);
});

test("compat.gzip=true keeps a host (no-op)", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://keep.example/v1", compat: { gzip: true } },
  ]);
  assert.equal(targets.get("keep.example"), "gzip");
});

test("opt-out wins when a host is shared", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://shared.example/v1", compat: { encoding: "br" } },
    { baseUrl: "https://shared.example/v1", compat: { gzip: false } },
  ]);
  assert.equal(targets.size, 0);
});

test("explicit encoding wins over the default on a shared host", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://shared.example/v1" },
    { baseUrl: "https://shared.example/v1", compat: { encoding: "br" } },
  ]);
  assert.equal(targets.get("shared.example"), "br");
});

test("first explicit encoding wins when a host conflicts", () => {
  const targets = resolveCompressionTargets([
    { baseUrl: "https://shared.example/v1", compat: { encoding: "br" } },
    { baseUrl: "https://shared.example/v1", compat: { encoding: "zstd" } },
  ]);
  assert.equal(targets.get("shared.example"), "br");
});

test("a custom default encoding is used for unconfigured hosts", () => {
  const targets = resolveCompressionTargets([{ baseUrl: "https://a.example/v1" }], "zstd");
  assert.equal(targets.get("a.example"), "zstd");
});

test("models without a baseUrl are ignored", () => {
  const targets = resolveCompressionTargets([
    {},
    { baseUrl: null },
    { baseUrl: "https://ok.example/v1" },
  ]);
  assert.deepEqual([...targets.keys()], ["ok.example"]);
});

test("readGzipFlag reads only boolean gzip values", () => {
  assert.equal(readGzipFlag({ gzip: false }), false);
  assert.equal(readGzipFlag({ gzip: true }), true);
  assert.equal(readGzipFlag({ gzip: "nope" }), undefined);
  assert.equal(readGzipFlag({ supportsStore: true }), undefined);
  assert.equal(readGzipFlag(null), undefined);
  assert.equal(readGzipFlag(undefined), undefined);
});

test("readEncodingFlag normalizes only known encodings", () => {
  assert.equal(readEncodingFlag({ encoding: "br" }), "br");
  assert.equal(readEncodingFlag({ encoding: "ZSTD" }), "zstd");
  assert.equal(readEncodingFlag({ encoding: "deflate" }), undefined);
  assert.equal(readEncodingFlag({ encoding: true }), undefined);
  assert.equal(readEncodingFlag({}), undefined);
  assert.equal(readEncodingFlag(null), undefined);
});
