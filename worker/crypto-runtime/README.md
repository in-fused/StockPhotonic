# CryptoPhotonic Cloudflare Worker Runtime

This Worker is the secure runtime foundation for CryptoPhotonic. It is isolated from the static StockPhotonic app and provides a browser-safe event feed with bounded server-side Helius webhook ingestion, no browser-side provider calls, no Jupiter calls, no private RPC calls, no transaction signing, and no swap execution.

## Routes

- `GET /health` returns runtime status with no secrets and no provider calls.
- `GET /api/crypto/events` returns sanitized events through the secure runtime feed contract.
- `POST /api/crypto/test-event` accepts local/dev event-like JSON payloads, rejects unsafe provider or secret-shaped fields, normalizes the event, stores it through the configured adapter, and never echoes unsafe input.
- `POST /webhooks/helius` accepts bounded Helius webhook deliveries, verifies the configured authorization header when not running locally, reduces payloads to the CryptoPhotonic event shape, enforces the controlled wallet watchlist, dedupes retries, and stores only sanitized fields.
- `POST /api/crypto/dev/clear-events` clears test events only when `ENVIRONMENT` is `local` or `development`.

## Event Feed Contract

`GET /api/crypto/events` supports:

- `limit`: integer from `1` to `100`; defaults to `50`.
- `since`: date or timestamp parseable by the Worker runtime; returned as an ISO timestamp in `filters_applied`.
- `wallet`: exact case-insensitive match against sanitized wallet addresses.
- `token`: exact case-insensitive match against sanitized token symbols or mints.
- `transaction_type`: exact case-insensitive match against sanitized transaction types.

Every response includes only sanitized event fields and metadata:

```json
{
  "events": [],
  "metadata": {
    "sanitized": true,
    "production_meaning": false,
    "live_blockchain_fetching": false,
    "source": "secure_runtime_feed",
    "count": 0,
    "filters_applied": {
      "limit": 50
    }
  }
}
```

Every event is normalized with:

- `schema_version: "cryptophotonic_event_v1"`
- `ingestion_source: "local_test_event"`, `"fixture_fallback"`, or `"helius_webhook"`
- `received_at`
- `dedupe_key`

Raw payloads, provider headers, secrets, private RPC URLs, and unsafe provider-shaped fields are rejected or stripped before storage/output.

## Helius Webhook Ingestion

Configure Helius to deliver enhanced webhook POSTs to:

```text
https://<your-worker-host>/webhooks/helius
```

Use Helius' `authHeader` setting and store the same expected value in the Worker environment as `HELIUS_WEBHOOK_AUTH_HEADER`. Helius echoes that value in the `Authorization` header when sending webhook deliveries, which the Worker verifies before reading or storing the event. Local development can run without this value only when `ENVIRONMENT` is `local` or `development`.

Example Helius webhook settings:

```json
{
  "webhookURL": "https://cryptophotonic-runtime.<account>.workers.dev/webhooks/helius",
  "webhookType": "enhanced",
  "transactionTypes": ["ANY"],
  "accountAddresses": ["<controlled-wallet-1>"],
  "authHeader": "<stored-only-as-HELIUS_WEBHOOK_AUTH_HEADER>"
}
```

Do not commit the Helius API key, the webhook auth header value, private RPC URLs, or exported provider payloads. Use Wrangler secrets or environment variables:

```sh
cd worker/crypto-runtime
wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER
```

The webhook route accepts at most 10 transactions per delivery and stores only the reduced fields: chain, signature, timestamp, transaction type, source, wallets, tokens, transfers, schema version, ingestion source, received time, dedupe key, and metadata flags.

## Controlled Watchlist

The Helius route is intentionally limited to 1 to 3 wallets. The source contains a static placeholder watchlist, and deployments can set `CRYPTO_HELIUS_ALLOWED_WALLETS` to a comma-separated list of up to three controlled wallet addresses. Events with no wallet match are rejected and not stored.

This is not an open wallet tracker. Do not add user-submitted wallet tracking, dynamic browser-controlled filters, or unrestricted address ingestion in this phase. A future allowlist system can move this into a signed admin workflow backed by durable storage, audit logging, and explicit per-wallet limits.

## Storage Modes

Adapter priority:

1. `CRYPTO_EVENTS_KV`: Cloudflare KV-ready event storage. Events are stored by `dedupe_key` and indexed for bounded feed reads.
2. `CRYPTO_EVENTS_D1`: D1 binding detection and stub path. The events table is intentionally not implemented yet; the runtime uses memory fallback and reports `d1_binding_present_table_not_implemented`.
3. No binding: in-memory test events with sanitized fixture fallback.

Future KV placeholder:

```toml
[[kv_namespaces]]
binding = "CRYPTO_EVENTS_KV"
id = "replace-with-kv-namespace-id"
preview_id = "replace-with-preview-kv-namespace-id"
```

Future D1 placeholder:

```toml
[[d1_databases]]
binding = "CRYPTO_EVENTS_D1"
database_name = "cryptophotonic-events"
database_id = "replace-with-d1-database-id"
```

## Local Development

```sh
npm install -g wrangler
cd worker/crypto-runtime
wrangler dev
```

Example local checks:

```sh
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/crypto/events
curl "http://127.0.0.1:8787/api/crypto/events?limit=1"
curl "http://127.0.0.1:8787/api/crypto/events?wallet=SyntheticWalletLocal"
curl "http://127.0.0.1:8787/api/crypto/events?token=CPHOTON&transaction_type=token_transfer"
curl -X POST http://127.0.0.1:8787/api/crypto/test-event \
  -H "content-type: application/json" \
  -d '{"chain":"solana-dev-synthetic","signature":"local_synthetic_signature","transaction_type":"token_transfer","wallets":[{"address":"SyntheticWalletLocal","role":"observer"}],"tokens":[{"symbol":"CPHOTON","mint":"SyntheticMintLocal","decimals":6}],"transfers":[]}'
curl -X POST http://127.0.0.1:8787/api/crypto/dev/clear-events
```

`POST /api/crypto/test-event` also accepts a bounded array of 1 to 10 safe event objects for local testing.

## Deploy Placeholder

```sh
cd worker/crypto-runtime
wrangler deploy
```

Do not deploy this as a broad production live-data endpoint. The current Helius path is for a small controlled first-data phase only and requires webhook authorization, the 1 to 3 wallet allowlist, bounded payloads, dedupe, and sanitized storage.

## Future Secrets

Use Wrangler secrets only. Never commit API keys, private RPC URLs, bearer tokens, `.dev.vars`, or provider credentials.

```sh
cd worker/crypto-runtime
wrangler secret put HELIUS_API_KEY
```

The command prompts for the value. Do not place the value in source, documentation, browser code, or static assets.

For webhook receiver authentication, prefer:

```sh
cd worker/crypto-runtime
wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER
```

## Planned Bindings

Production persistence is intentionally placeholder-only in this phase. Future phases can add bindings such as:

- KV namespace for cached sanitized event snapshots.
- D1 database for queryable event history.
- Queue for webhook ingestion buffering.
- Durable Object for dedupe, ordering, or per-stream coordination.

The current `src/storage.js` adapter documents the future interface through `listEvents()`, `addEvent()`, `dedupeEvent()`, `clearEvents()`, and `getRuntimeStatus()`.

## Free-Tier Strategy

- No browser polling of Helius, Jupiter, Solana RPC, or private provider endpoints.
- Browser reads only the bounded, sanitized Worker feed.
- Webhook/cache first: provider ingestion happens server-side, reduces raw payloads to safe events, and caches those events before the browser reads them.
- Bounded reads: the public feed enforces a maximum `limit` of `100` and exact filters to avoid unbounded scans.
- Bounded writes: Helius webhook ingestion accepts at most 10 transactions per delivery and only 1 to 3 configured wallets.
- Keep scope small on the free tier because webhook fan-out, retries, KV writes, and feed reads compound quickly as wallet count and transaction volume rise.

## Security Rules

- Browser code must not call Helius, Jupiter, or private RPC providers directly.
- Worker responses must not expose API keys, authorization headers, bearer tokens, private RPC URLs, raw provider payloads, signing keys, or request headers.
- `POST /api/crypto/test-event` is only a local/dev ingestion path for sanitized test payloads.
- `POST /webhooks/helius` must use a Helius `authHeader` value mirrored into `HELIUS_WEBHOOK_AUTH_HEADER` before non-local deployments accept events.
- Helius events outside the controlled wallet watchlist are rejected before storage.
- Sanitized event output is limited to graph-safe fields: event identity, chain, signature, timestamp, transaction type, source, wallets, tokens, transfers, schema version, ingestion source, received time, dedupe key, and metadata flags.
- Events keep `metadata.live_blockchain_fetching = false` because the Worker receives webhook deliveries and the browser reads cached sanitized events; neither path performs browser live provider fetching.
