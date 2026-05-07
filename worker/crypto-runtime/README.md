# CryptoPhotonic Cloudflare Worker Runtime MVP

This Worker is the first secure runtime foundation for CryptoPhotonic. It is isolated from the static StockPhotonic app and provides a browser-safe event API shape without real Helius webhooks, Jupiter calls, private RPC calls, transaction signing, or swap execution.

## Routes

- `GET /health` returns runtime status with no secrets and no provider calls.
- `GET /api/crypto/events` returns sanitized synthetic or in-memory test events.
- `POST /api/crypto/test-event` accepts a local/dev event-like JSON payload, rejects unsafe provider or secret-shaped fields, and returns a sanitized preview. The current adapter stores accepted events in memory only for the active Worker isolate.

## Local Development

```sh
npm install -g wrangler
cd worker/crypto-runtime
wrangler dev
```

Example local check:

```sh
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/crypto/events
curl -X POST http://127.0.0.1:8787/api/crypto/test-event \
  -H "content-type: application/json" \
  -d '{"chain":"solana-dev-synthetic","signature":"local_synthetic_signature","transaction_type":"token_transfer","wallets":[{"address":"SyntheticWalletLocal","role":"observer"}],"tokens":[{"symbol":"CPHOTON","mint":"SyntheticMintLocal","decimals":6}],"transfers":[]}'
```

## Deploy Placeholder

```sh
cd worker/crypto-runtime
wrangler deploy
```

Do not deploy this as a production live-data endpoint until webhook verification, persistence bindings, rate limits, observability, and provider secret handling are added.

## Future Secrets

Use Wrangler secrets only. Never commit API keys, private RPC URLs, bearer tokens, `.dev.vars`, or provider credentials.

```sh
cd worker/crypto-runtime
wrangler secret put HELIUS_API_KEY
```

The command prompts for the value. Do not place the value in source, documentation, browser code, or static assets.

## Planned Bindings

Production persistence is intentionally not configured in this phase. Future phases can add bindings such as:

- KV namespace for cached sanitized event snapshots.
- D1 database for queryable event history.
- Queue for webhook ingestion buffering.
- Durable Object for dedupe, ordering, or per-stream coordination.

The current `src/storage.js` adapter documents the future interface through `listEvents()`, `addEvent()`, `dedupeEvent()`, and `getRuntimeStatus()`.

## Security Rules

- Browser code must not call Helius, Jupiter, or private RPC providers directly.
- Worker responses must not expose API keys, authorization headers, bearer tokens, private RPC URLs, raw provider payloads, signing keys, or request headers.
- `POST /api/crypto/test-event` is only a local/dev ingestion path for sanitized test payloads.
- Sanitized event output is limited to graph-safe fields: event identity, chain, signature, timestamp, transaction type, source, wallets, tokens, transfers, and metadata flags.
- All current events have `metadata.production_meaning = false` and `metadata.live_blockchain_fetching = false`.

## Future Helius Webhook Path

A later phase can point Helius webhooks at a dedicated Worker ingestion route, verify webhook authenticity, reduce raw provider payloads to the sanitized CryptoPhotonic event shape, dedupe them, and persist only safe fields through configured Cloudflare bindings. The browser should continue to read only sanitized Worker APIs, never provider APIs.
