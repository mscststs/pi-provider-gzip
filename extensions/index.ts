/**
 * pi-provider-gzip
 *
 * Gzip-compresses model request bodies to cut time-to-first-token (TTFT) on
 * gateways that ingest large request bodies slowly.
 *
 * Why this works: some OpenAI-compatible relays spend time proportional to the
 * *received* body size before they dispatch a request (token counting, quota
 * pre-checks, body logging, WAF scanning, ...). Compressing the JSON body
 * shrinks those bytes and moves the bottleneck back to the model itself.
 *
 * How it hooks in: at `session_start` the extension reads the live model
 * registry, builds a host allowlist from every configured provider, and
 * installs a single process-wide `fetch` interceptor. That one hook covers all
 * fetch-based APIs pi supports (OpenAI, Anthropic, Mistral, Google, ...),
 * whether the provider is built-in or user-defined.
 *
 * Controls:
 *   - Master switch: `PI_GZIP=0` disables everything.
 *   - Per-provider opt-out: `"compat": { "gzip": false }` in `models.json`.
 *
 * Providers that do not use `fetch` (Amazon Bedrock's AWS SDK transport with
 * SigV4 signing) and WebSocket transports are out of scope.
 *
 * See `docs/benchmarks.md` for the measurements that motivated this.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "../lib/config.ts";
import { resolveEnabledHosts } from "../lib/hosts.ts";
import { installFetchInterceptor } from "../lib/interceptor.ts";

export default function gzipRequestBody(pi: ExtensionAPI): void {
  const config = readConfig();
  if (!config.enabled) return;

  pi.on("session_start", (_event, ctx) => {
    const models = ctx.modelRegistry.getAll();
    const enabledHosts = resolveEnabledHosts(models);

    installFetchInterceptor({
      enabledHosts,
      minBytes: config.minBytes,
      level: config.level,
      debug: config.debug,
    });
  });
}
