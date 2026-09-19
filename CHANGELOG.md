# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-19

### Changed

- Renamed the extension entry point from `extensions/gzip-request-body.ts` to
  `extensions/index.ts`. Pi now shows just the package name (instead of the
  package name plus the entry filename) in its startup resource list. No
  behavior change.

## [0.1.0] - 2026-09-19

### Added

- Initial release.
- A process-wide `fetch` interceptor that gzip-compresses model request bodies,
  scoped to an allowlist of hosts derived from the live model registry.
- Coverage for every fetch-based API pi supports (OpenAI Chat Completions /
  Responses / Azure / Codex SSE, Anthropic Messages, Mistral Conversations,
  Google Generative AI / Vertex, pi-messages, and OpenAI-compatible relays).
- A single master switch, `PI_GZIP` (default on).
- Per-provider opt-out via `"compat": { "gzip": false }` in `models.json`.
- Optional tuning: `PI_GZIP_MIN_BYTES`, `PI_GZIP_LEVEL`, `PI_GZIP_DEBUG`.
- Unit tests for configuration, host resolution, the gzip transport wrapper,
  and the idempotent interceptor install/uninstall.
- Benchmark notes in `docs/benchmarks.md`.

### Not supported

- Amazon Bedrock (`bedrock-converse-stream`), which uses the AWS SDK with a
  node:http transport and SigV4 payload signing.
- WebSocket transports, which bypass `fetch`.

[Unreleased]: https://github.com/mscststs/pi-provider-gzip/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mscststs/pi-provider-gzip/releases/tag/v0.1.1
[0.1.0]: https://github.com/mscststs/pi-provider-gzip/releases/tag/v0.1.0
