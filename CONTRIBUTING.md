# Contributing

Thanks for looking at `pi-provider-gzip`!

## Requirements

- Node.js 22.6+ (Node 24 recommended; the test suite runs TypeScript directly)
- npm

## Setup

```bash
git clone git@github.com:mscststs/pi-provider-gzip.git
cd pi-provider-gzip
npm install
```

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test (runs *.test.ts via native type stripping)
npm run check       # both
```

## Layout

| Path | Purpose |
| --- | --- |
| `extensions/index.ts` | pi extension entry point — wiring only |
| `lib/config.ts` | master switch + tuning, no pi imports |
| `lib/encodings.ts` | gzip/br/zstd codecs and fallback, no pi imports |
| `lib/hosts.ts` | model registry → host/encoding map, no pi imports |
| `lib/compress-fetch.ts` | the `fetch` wrapper, no pi imports |
| `lib/interceptor.ts` | idempotent global install/uninstall |
| `test/` | `node:test` suites for `lib/` |
| `docs/benchmarks.md` | measurement notes |

Keep `lib/` free of pi imports so it stays trivially testable. Put anything that
needs the pi extension API in `extensions/`.

## Design notes

- **One master switch.** `PI_GZIP=0` disables the extension; there are no
  environment allowlists. Per-provider opt-out is
  `"compat": { "gzip": false }` in `models.json`, and the per-provider codec is
  `"compat": { "encoding": "br" }` (gzip default, invalid values fall back).
- **Transport-level hook.** We patch `globalThis.fetch` once and scope it with a
  host → encoding map from `ctx.modelRegistry.getAll()`. This is what lets one
  hook cover every fetch-based API, built-in and user-defined alike.
- **Idempotent installs.** The original `fetch` is kept on `globalThis` under a
  symbol so re-installs (reload, new session) reconfigure instead of nesting
  wrappers.

## Adding coverage

Coverage follows the transport. If a provider uses `fetch`, it is covered
automatically; add it to the compatibility table in `README.md`. Providers that
use a different transport (Amazon Bedrock's AWS SDK, WebSocket) need a separate
adapter and should stay documented as unsupported.

## Trying it locally

```bash
pi -e /absolute/path/to/pi-provider-gzip
PI_GZIP_DEBUG=1 pi   # confirms compression in the current session
PI_GZIP=0 pi         # disables the extension for one run
```

## Releasing

Releases are published to npm as `@mscststs/pi-provider-gzip` from GitHub Actions
via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). No
long-lived `NPM_TOKEN` is stored.

Day to day:

```bash
npm run release:patch   # or release:minor / release:major
```

That runs `npm version <bump>`, which commits the bump and creates a `vX.Y.Z`
tag, then pushes with `--follow-tags`. The tag triggers
`.github/workflows/release.yml`, which checks the tag against `package.json`,
runs `npm run check`, publishes with provenance, and opens a GitHub Release.

### One-time setup

Trusted Publisher settings live on the package's npm page, so the **first**
publish must create the package:

1. `npm login --registry=https://registry.npmjs.org` (a scoped package needs
   `--access public`).
2. First release only: `npm publish --access public --registry=https://registry.npmjs.org`.
3. On <https://www.npmjs.com/package/@mscststs/pi-provider-gzip> → **Settings** →
   **Trusted Publishers** → **GitHub Actions**, and fill in:
   - Organization or user: `mscststs`
   - Repository: `pi-provider-gzip`
   - Workflow filename: `release.yml`
   - Environment: leave empty (the workflow does not declare one)
4. All later releases go through Actions with no token.

If you add an npm *environment* on either side, set the same name under
`jobs.publish.environment` in `release.yml`.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
