[English](README.md) | [简体中文](README.zh-CN.md)

# pi-provider-gzip

A [pi](https://pi.dev) extension that **gzip-compresses model request bodies**
to cut time-to-first-token (TTFT) on LLM gateways that ingest large request
bodies slowly.

```
before:  2.7 MB request body  ──►  gateway chews on it  ──►  ~55–80 s TTFT
after:   0.75 MB gzip body    ──►  gateway chews on it  ──►  ~12–22 s TTFT
```

- **One switch** turns the whole feature on or off (`PI_GZIP=0`).
- **Works for every provider by default** — no allowlists, no per-provider setup.
- **Per-provider opt-out** lives in the provider's own settings:
  `"compat": { "gzip": false }`.

> **Why does this help?** Many model relays (new-api, one-api, LiteLLM proxies,
> corporate gateways …) do work proportional to the **received byte count**
> before dispatching a request — token counting, quota pre-checks, body logging,
> WAF scanning. That cost is independent of the model and can dominate TTFT once
> your context reaches hundreds of KB. Compressing the JSON body shrinks those
> bytes. See [`docs/benchmarks.md`](docs/benchmarks.md) for the measurements.

## Install

```bash
# From git
pi install git:github.com/mscststs/pi-provider-gzip

# From npm (once published)
pi install npm:@mscststs/pi-provider-gzip

# From a local checkout
pi install /absolute/path/to/pi-provider-gzip
```

Try it without installing:

```bash
pi -e /absolute/path/to/pi-provider-gzip
```

After installing, start a new session (or run `/reload` in an existing one).

## Controls

### The master switch

| Variable    | Default | Meaning                                    |
| ----------- | ------- | ------------------------------------------ |
| `PI_GZIP`   | `1`     | `0` disables the extension for the process. |

```bash
PI_GZIP=0 pi        # temporarily disable everything
```

Advanced tuning (rarely needed):

| Variable            | Default | Meaning                                          |
| ------------------- | ------- | ------------------------------------------------ |
| `PI_GZIP_MIN_BYTES` | `1024`  | Only compress bodies at least this large.        |
| `PI_GZIP_LEVEL`     | `6`     | zlib level, clamped to `0`–`9`.                  |
| `PI_GZIP_DEBUG`     | `0`     | `1` logs each compression to stderr.             |

```bash
PI_GZIP_DEBUG=1 pi
# [pi-provider-gzip] relay.example 2708795 -> 753098 bytes (3.6x)
```

### Per-provider opt-out

Providers that reject gzip request bodies can opt out in `models.json`:

```json
{
  "providers": {
    "my-relay": {
      "baseUrl": "https://relay.example/v1",
      "api": "openai-completions",
      "apiKey": "...",
      "models": [{ "id": "my-model", "name": "my-model", "contextWindow": 128000 }],
      "compat": { "gzip": false }
    }
  }
}
```

This also works for built-in providers — no `baseUrl` required, since `compat`
alone is a valid provider entry:

```json
{
  "providers": {
    "openai": { "compat": { "gzip": false } }
  }
}
```

> `compat` is the only provider-level field pi exposes to extensions, so it is
> where the switch lives. `compat: { "gzip": false }` is an opt-out; everything
> else is enabled.

## How it works

At `session_start` the extension reads pi's live model registry, builds a host
allowlist from every configured provider, and installs a **single process-wide
`fetch` interceptor**. The interceptor compresses a request only when *all* of
these hold:

1. the method is `POST`,
2. the destination host is in the allowlist (and not opted out),
3. the body is a string at or above `PI_GZIP_MIN_BYTES`.

It then gzips the body, sets `Content-Encoding: gzip`, and drops the stale
`Content-Length` so the HTTP stack recomputes it. Everything else is forwarded
untouched. The gateway decompresses transparently; the model sees the exact same
JSON.

Because the hook is at the transport layer, it covers **all fetch-based APIs pi
supports**, whether the provider is built-in or user-defined:

| Covered | Not covered |
| --- | --- |
| OpenAI Chat Completions / Responses / Azure / Codex (SSE) | Amazon Bedrock (`bedrock-converse-stream`) |
| Anthropic Messages | WebSocket transports |
| Mistral Conversations | |
| Google Generative AI / Vertex | |
| pi-messages, and any OpenAI-compatible relay | |

Bedrock uses the AWS SDK with a node:http transport and SigV4 payload signing;
WebSocket transports never go through `fetch`. Both are intentionally out of
scope.

## Compatibility

- **Server must accept `Content-Encoding: gzip` on request bodies.** Most
  gateways do. If a provider rejects it with `400`, add
  `"compat": { "gzip": false }` to that provider.
- **Node:** requires Node 22.6+ (pi bundles a compatible runtime).

## Benchmarks

Measured against an OpenAI-compatible relay serving a large reasoning model,
using real pi sessions. Full methodology and raw numbers live in
[`docs/benchmarks.md`](docs/benchmarks.md).

| Scenario             | Request body | TTFT without | TTFT with      |
| -------------------- | ------------ | ------------ | -------------- |
| Fresh session        | 5.7 KB       | 1.5–3.4 s    | 1.4 s          |
| Small history        | 20.6 KB      | 1.6 s        | 1.6 s          |
| Medium history       | 377 KB       | 16.4 s       | **3.4 s**      |
| Large history        | 1.95 MB      | 67.5 s       | —              |
| Extra-large history  | 2.78 MB      | 46.8–80.8 s  | **11.7–29.4 s** |

The relay itself returned a **constant ~0.54 s** for any body size once it was
gzipped, versus **48.6 s** for a plain 2 MB body.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| A provider returns `400 Bad Request` | It does not accept gzip bodies | Add `"compat": { "gzip": false }` to that provider, or `PI_GZIP=0` |
| No change in TTFT | Body is already small, or the relay decompresses before billing | Check `PI_GZIP_DEBUG=1`; the win scales with body size |
| `Failed to load extension` | Pi version does not provide the extension API used here | Update pi |
| Bedrock requests are never compressed | AWS SDK transport, out of scope | Expected |

## Development

```bash
npm install        # dev deps: pi-coding-agent, @types/node, typescript
npm run check      # typecheck + unit tests
npm test           # node --test only
```

### Project layout

```
extensions/
  index.ts               # pi extension entry point (wiring only)
lib/
  config.ts              # master switch + tuning (pure)
  hosts.ts               # model registry -> host allowlist (pure)
  gzip-fetch.ts          # fetch wrapper (pure)
  interceptor.ts         # idempotent global fetch install/uninstall
test/                    # node:test suites
docs/benchmarks.md       # measurement notes
```

## License

[MIT](LICENSE)
