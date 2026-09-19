#!/usr/bin/env node
/**
 * Probe which HTTP request-body compression encodings a pi provider accepts.
 *
 * The gzip extension assumes `Content-Encoding: gzip` is the only option. Some
 * relays (new-api / one-api) also decompress Brotli and Zstandard, which
 * compress model transcripts noticeably better than gzip. This script answers
 * "what does *my* provider accept?" empirically.
 *
 * Usage:
 *   node scripts/probe-encodings.mjs [provider] [model] [--size N]
 *
 * Defaults to the provider/model from PI_PROVIDER / PI_MODEL, or shuguang +
 * deepseek/deepseek-v4-flash.
 *
 * Reads base URLs from ~/.pi/agent/models.json and API keys from
 * ~/.pi/agent/auth.json.
 *
 * How the probe works: for each candidate encoding we send the *actually
 * compressed* body with a matching `Content-Encoding` header. If the server
 * decodes it, the JSON parses and the request succeeds; if it ignores or
 * rejects the encoding, the raw compressed bytes reach the JSON parser and the
 * server answers 400 "invalid JSON". We also send an uncompressed body with an
 * unknown encoding to prove that unknown encodings are passed through rather
 * than decoded.
 */
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PI_DIR = join(homedir(), ".pi", "agent");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function parseArgs(argv) {
  const positional = [];
  let size = 64 * 1024;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--size") size = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  return {
    provider: positional[0] ?? process.env.PI_PROVIDER ?? "shuguang",
    model: positional[1] ?? process.env.PI_MODEL ?? "deepseek/deepseek-v4-flash",
    size,
  };
}

/** Realistic-ish payload built from one of the user's own session files. */
function buildPayload(api, model, size) {
  const filler =
    "The quick brown fox jumps over the lazy dog. " +
    "fn main() { println!(\"hello world\"); }\n";
  let text = filler.repeat(Math.ceil(size / filler.length) + 1);
  text = text.slice(0, size);

  if (api === "anthropic-messages" || api === "anthropic") {
    return { model, max_tokens: 16, messages: [{ role: "user", content: text }] };
  }
  if (api === "openai-responses") {
    return { model, input: text, stream: false, max_output_tokens: 16 };
  }
  // openai-completions and most OpenAI-compatible relays.
  return { model, messages: [{ role: "user", content: text }], stream: false, max_tokens: 16 };
}

function endpointFor(baseUrl, api) {
  const base = baseUrl.replace(/\/+$/, "");
  if (api === "anthropic-messages" || api === "anthropic") return `${base}/messages`;
  if (api === "openai-responses") return `${base}/responses`;
  return `${base}/chat/completions`;
}

function authHeaders(api, key) {
  if (api === "anthropic-messages" || api === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  }
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

const CODECS = {
  gzip: (body) => gzipSync(body),
  deflate: (body) => deflateSync(body),
  "deflate-raw": (body) => deflateRawSync(body),
  br: (body) => brotliCompressSync(body),
  zstd: (body) => zstdCompressSync(body),
};

async function probe(url, headers, raw, encoding) {
  const body = raw;
  const sent = { ...headers };
  if (encoding) sent["content-encoding"] = encoding;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers: sent, body });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - started, text };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, text: String(error) };
  }
}

function verdict(status, text) {
  if (status === 200) {
    if (/invalid JSON request body/i.test(text)) return "BAD (HTTP 200 but JSON error?)";
    return "SUPPORTED";
  }
  if (status === 400 && /invalid JSON request body/i.test(text)) return "not supported";
  if (status === 401 || status === 403) return "auth error";
  return `error ${status}`;
}

async function main() {
  const { provider, model, size } = parseArgs(process.argv.slice(2));
  const models = readJson(join(PI_DIR, "models.json"))?.providers ?? {};
  const auth = readJson(join(PI_DIR, "auth.json")) ?? {};

  const config = models[provider];
  if (!config?.baseUrl) {
    console.error(`Provider "${provider}" has no baseUrl in ${PI_DIR}/models.json`);
    process.exit(1);
  }
  const key = auth[provider]?.key;
  if (!key) {
    console.error(`No API key for provider "${provider}" in ${PI_DIR}/auth.json`);
    process.exit(1);
  }

  const api = config.api ?? "openai-completions";
  const url = endpointFor(config.baseUrl, api);
  const headers = authHeaders(api, key);
  const payload = JSON.stringify(buildPayload(api, model, size));
  const raw = Buffer.from(payload, "utf8");

  console.log(`provider : ${provider}`);
  console.log(`model    : ${model}`);
  console.log(`api      : ${api}`);
  console.log(`endpoint : ${url}`);
  console.log(`payload  : ${raw.length} bytes (plain JSON)\n`);

  const rows = [];
  // Control: unknown encoding + valid JSON must succeed => unknown encodings
  // are ignored, so a 400 for a compressed body really means "not decoded".
  const control = await probe(url, headers, raw, "unknown-xyz");
  rows.push({ encoding: "(none, control)", bytes: raw.length, ...control, note: verdict(control.status, control.text) });

  for (const [name, encode] of Object.entries(CODECS)) {
    const compressed = encode(raw);
    const res = await probe(url, headers, compressed, name);
    rows.push({
      encoding: name,
      bytes: compressed.length,
      ...res,
      note: verdict(res.status, res.text) + (name === "gzip" ? " (baseline)" : ""),
    });
  }

  console.log(
    `${"ENCODING".padEnd(18)} ${"BYTES".padStart(9)} ${"HTTP".padStart(5)} ${"TIME".padStart(7)}  VERDICT`,
  );
  console.log("-".repeat(70));
  for (const r of rows) {
    console.log(
      `${r.encoding.padEnd(18)} ${String(r.bytes).padStart(9)} ${String(r.status).padStart(5)} ${(r.ms + "ms").padStart(7)}  ${r.note}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
