import assert from "node:assert/strict";
import { test } from "node:test";
import * as zlib from "node:zlib";
import {
  DEFAULT_ENCODING,
  ENCODINGS,
  brotliQuality,
  compressBody,
  isEncodingSupported,
  normalizeEncoding,
  pickEncoding,
  zstdLevel,
} from "../lib/encodings.ts";

const SAMPLE = Buffer.from(JSON.stringify({ text: "abcd".repeat(500) }), "utf8");

test("normalizeEncoding accepts known names and aliases, case-insensitively", () => {
  assert.equal(normalizeEncoding("gzip"), "gzip");
  assert.equal(normalizeEncoding("GZIP"), "gzip");
  assert.equal(normalizeEncoding("  br "), "br");
  assert.equal(normalizeEncoding("brotli"), "br");
  assert.equal(normalizeEncoding("zstd"), "zstd");
  assert.equal(normalizeEncoding("Zstandard"), "zstd");
});

test("normalizeEncoding rejects unknown and non-string values", () => {
  assert.equal(normalizeEncoding("deflate"), undefined);
  assert.equal(normalizeEncoding("identity"), undefined);
  assert.equal(normalizeEncoding(""), undefined);
  assert.equal(normalizeEncoding(undefined), undefined);
  assert.equal(normalizeEncoding(null), undefined);
  assert.equal(normalizeEncoding(42), undefined);
});

test("DEFAULT_ENCODING is gzip and every encoding is exposed", () => {
  assert.equal(DEFAULT_ENCODING, "gzip");
  assert.deepEqual([...ENCODINGS], ["gzip", "br", "zstd"]);
});

test("pickEncoding falls back to gzip only when unsupported", () => {
  assert.equal(pickEncoding("br"), "br");
  assert.equal(pickEncoding("gzip"), "gzip");
  assert.equal(pickEncoding("zstd", () => true), "zstd");
  assert.equal(pickEncoding("br", () => false), "gzip");
  assert.equal(pickEncoding("zstd", () => false), "gzip");
  assert.equal(pickEncoding("gzip", () => false), "gzip");
});

test("isEncodingSupported mirrors zstd availability in the runtime", () => {
  assert.equal(isEncodingSupported("gzip"), true);
  assert.equal(isEncodingSupported("br"), true);
  assert.equal(isEncodingSupported("zstd"), typeof zlib.zstdCompressSync === "function");
});

test("level mapping stays inside each codec's native range", () => {
  for (const level of [0, 3, 6, 9]) {
    assert.ok(brotliQuality(level) >= 0 && brotliQuality(level) <= 11);
    assert.ok(zstdLevel(level) >= 1 && zstdLevel(level) <= 19);
  }
  assert.ok(brotliQuality(9) > brotliQuality(0));
  assert.ok(zstdLevel(9) > zstdLevel(0));
});

test("compressBody round-trips gzip", () => {
  const compressed = compressBody("gzip", SAMPLE, 6);
  assert.notEqual(compressed.length, 0);
  assert.deepEqual(zlib.gunzipSync(compressed), SAMPLE);
});

test("compressBody round-trips brotli", () => {
  const compressed = compressBody("br", SAMPLE, 6);
  assert.deepEqual(zlib.brotliDecompressSync(compressed), SAMPLE);
});

test("compressBody round-trips zstd when available", { skip: !isEncodingSupported("zstd") }, () => {
  const compressed = compressBody("zstd", SAMPLE, 6);
  assert.deepEqual(zlib.zstdDecompressSync(compressed), SAMPLE);
});
