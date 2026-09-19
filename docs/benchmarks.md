# Benchmarks

These measurements motivated `pi-provider-gzip`. They were collected against a
production OpenAI-compatible relay serving a large reasoning model, using real
pi sessions and a raw HTTP/1.1 client.

Provider names, hostnames, and model aliases are intentionally omitted.

All timings are **TTFT** (time to first streamed token/byte) unless noted.
Numbers are medians or ranges across repeated runs; the relay was noticeably
volatile, so treat single runs with caution.

## 1. Network chain

| Leg | Result |
| --- | --- |
| DNS | 13–20 ms (single A record) |
| TCP connect | 35–50 ms |
| TLS 1.3 handshake | 75–130 ms (`TLS_AES_256_GCM_SHA384`) |
| Total handshake | ~130–180 ms |
| Fixed relay overhead | ~540–680 ms (even a bare `GET /v1/models`) |
| Local uplink to relay | 2.5–4.8 MB/s |
| General internet uplink (reference) | 0.27–0.39 MB/s |

The relay is a nearby, fast-reachable host. Upload of a 2.7 MB body at
~3 MB/s takes roughly a second — under 1% of the observed TTFT. The bottleneck
is not client bandwidth.

## 2. The relay ingests bytes slowly

Sending to a **non-existent model** isolates the relay path (no inference).
Response time still scaled with body size:

| Request body | Plain | gzip body |
| --- | --- | --- |
| 0 KB | 545 ms | 538 ms |
| 32 KB | 783 ms | 550 ms |
| 128 KB | 4847 ms | 541 ms |
| 512 KB | 7564 ms | 537 ms |
| 2 MB | **48583 ms** | **546 ms** |

Once gzipped to a few KB, the relay returns at its fixed ~0.54 s floor
regardless of original size. This confirms the cost is a function of *received
bytes*, not tokens and not the model.

A 1 MB `POST` measured with `curl --trace-time` showed the body was uploaded in
~146 ms, then the server sat for ~19.5 s before the first response byte.

## 3. Synthetic context scaling (real model)

| Request body | TTFT |
| --- | --- |
| 0.4 KB | ~1.5 s |
| 16 KB | ~1.8 s |
| 64 KB | 3.0–6.1 s |
| 256 KB | 5.3–8.6 s |
| 1 MB | ~28 s |

## 4. Real pi sessions

Bodies captured from pi itself (system prompt + tools + history):

| Scenario | Session file | pi request body | TTFT |
| --- | --- | --- | --- |
| Fresh (no history) | — | 5.7 KB | 1.4–3.4 s |
| Small history | 26 KB | 20.6 KB | 1.6 s |
| Medium history | 469 KB | 377 KB | **16.4 s** |
| Large history | 4.8 MB | 1.95 MB | **67.5 s** |
| Extra-large history | 10.3 MB | 2.78 MB | **46.8–80.8 s** |

Composition of the 2.78 MB request: ~1.81 MB assistant content, ~0.83 MB tool
results, 4 tool definitions, no images.

## 5. Effect of gzip

| Request body | TTFT plain | TTFT gzip | Speedup |
| --- | --- | --- | --- |
| 377 KB → 116 KB | 16.4 s | 3.4 s | 4.8× |
| 2.78 MB → 752 KB | 67.0 s | 11.7 s | 5.7× |
| 2.78 MB → 747 KB | 76.5 s | 29.4 s | 2.6× |
| 2.78 MB → 751 KB | 46.8 s | 20.4 s | 2.3× |

Real payloads compressed ~3.6–3.7×. Because the relay cost scales with the
received byte count, the speedup is roughly proportional to the compression
ratio, on top of a fixed ~0.5 s floor.

## 6. Notes

- **HTTP/2 vs HTTP/1.1:** ~15% (10.8 s vs 12.6 s on a 2.78 MB body). Minor
  compared to gzip; pi uses undici (HTTP/1.1) by default.
- **Variance:** the same 2.78 MB body measured between 12.6 s and 70 s across
  runs. The relay is oversubscribed. Prefer medians/ranges over single samples.
- **Residual cost:** after gzip, the remaining TTFT is the upstream model
  prefill. That can only be reduced by shrinking context (compaction, trimming
  old reasoning/tool output).

## Reproducing

The core checks are small enough to re-run by hand against any relay:

```bash
# Isolate the relay path (no inference): swap in a bogus model id.
curl -s -o /dev/null -w '%{time_starttransfer}\n' \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  --data-binary @body.json \
  https://your-gateway.example/v1/chat/completions

# Same body, gzipped
gzip -c body.json > body.json.gz
curl -s -o /dev/null -w '%{time_starttransfer}\n' \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -H 'Content-Encoding: gzip' --data-binary @body.json.gz \
  https://your-gateway.example/v1/chat/completions
```
