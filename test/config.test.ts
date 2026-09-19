import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LEVEL, DEFAULT_MIN_BYTES, readConfig } from "../lib/config.ts";

test("defaults: enabled, 1KiB threshold, level 6", () => {
  const config = readConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.minBytes, DEFAULT_MIN_BYTES);
  assert.equal(config.level, DEFAULT_LEVEL);
  assert.equal(config.debug, false);
});

test("PI_GZIP=0 is the single master switch", () => {
  assert.equal(readConfig({ PI_GZIP: "0" }).enabled, false);
  assert.equal(readConfig({ PI_GZIP: "1" }).enabled, true);
  assert.equal(readConfig({}).enabled, true);
});

test("numeric options are parsed and clamped", () => {
  assert.equal(readConfig({ PI_GZIP_MIN_BYTES: "4096" }).minBytes, 4096);
  assert.equal(readConfig({ PI_GZIP_MIN_BYTES: "nope" }).minBytes, DEFAULT_MIN_BYTES);
  assert.equal(readConfig({ PI_GZIP_MIN_BYTES: "-10" }).minBytes, 0);
  assert.equal(readConfig({ PI_GZIP_LEVEL: "99" }).level, 9);
  assert.equal(readConfig({ PI_GZIP_LEVEL: "-3" }).level, 0);
});

test("PI_GZIP_DEBUG is opt-in", () => {
  assert.equal(readConfig({ PI_GZIP_DEBUG: "1" }).debug, true);
  assert.equal(readConfig({ PI_GZIP_DEBUG: "yes" }).debug, false);
});
