# CryptoPhotonic Cloudflare Worker Runtime

This Worker is the secure runtime foundation for CryptoPhotonic. It is isolated from the static StockPhotonic app and provides a browser-safe event feed with bounded server-side Helius webhook ingestion, no browser-side provider calls, no Jupiter calls, no private RPC calls, no transaction signing, and no swap execution.

## Routes

- `GET /health` returns runtime status with no secrets and no provider calls.
- `GET /api/crypto/events` returns sanitized events through the secure runtime feed contract.
- `GET /api/crypto/wallet-activity?wallet=<address>&limit=<n>` performs one controlled server-side Helius Enhanced Transactions address-history lookup, stores/dedupes sanitized events, and returns browser-safe events only.
- `GET /api/crypto/wallet-history?wallet=<address>&cursor=<optional>&scan_id=<optional>&limit=<n>` returns a non-storing normalized wallet history page contract for frontend pagination state. It calls only Worker-side provider adapters, carries safe scan-manifest metadata, and returns `provider_not_configured` when no provider is configured.
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
- `ingestion_source: "local_test_event"`, `"fixture_fallback"`, `"helius_webhook"`, or `"helius_wallet_lookup"`
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

## Controlled Wallet Lookup

`GET /api/crypto/wallet-activity?wallet=<address>&limit=<n>` is a user-action endpoint for the CryptoPhotonic "Track Wallet" UI. The browser calls only this Worker route. The Worker validates the Solana wallet address, reads `HELIUS_API_KEY` only from the Worker environment, calls Helius Enhanced Transactions address history server-side, reduces the provider response to the CryptoPhotonic event shape, stores/dedupes by signature through the existing adapter, and returns sanitized events only.

Set the Helius API key as a Wrangler secret:

```powershell
cd worker/crypto-runtime
wrangler secret put HELIUS_API_KEY
```

Do not put the key in `wrangler.toml`, `.dev.vars`, browser code, static HTML, docs, or committed source. If `HELIUS_API_KEY` is missing, the route returns `503 wallet_lookup_not_configured` and does not crash.

Direct smoke test:

```powershell
curl.exe "https://<worker>/api/crypto/wallet-activity?wallet=<PUBLIC_WALLET>&limit=10"
```

Limits and free-tier controls:

- `limit` defaults to `10`.
- `limit` is hard-capped at `25`.
- The Worker performs no polling loop; each lookup is one request caused by a user action.
- Repeated lookup for the same wallet uses a short KV or in-memory cooldown when cached sanitized events already exist.
- Events are deduped by normalized signature before storage.

Wallet lookup complements webhook tracking. Webhooks are push-based configured watchlist ingestion at `/webhooks/helius`; wallet lookup is a controlled pull for recent activity entered in the UI. Both routes store the same sanitized event shape, and both keep provider secrets out of the browser.

## Wallet History Endpoint

`GET /api/crypto/wallet-history?wallet=<address>&cursor=<optional>&scan_id=<optional>&limit=<n>` is the backend pagination contract used by the CryptoPhotonic Load More History control. The browser calls only this Worker route. The endpoint does not merge pages into the graph, does not expose provider URLs or secrets, and always returns a normalized page:

```json
{
  "wallet": "<PUBLIC_WALLET>",
  "provider": "helius",
  "cursor": null,
  "nextCursor": "<PROVIDER_CURSOR_OR_NULL>",
  "events": [],
  "moreAvailable": false,
  "status": "ok",
  "message": "Wallet history page loaded from the Worker-side Helius adapter.",
  "metadata": {
    "sanitized": true,
    "production_meaning": false,
    "live_blockchain_fetching": false,
    "browser_provider_calls": false,
    "provider_secret_exposed": false,
    "raw_provider_payload_exposed": false,
    "endpoint_contract": "/api/crypto/wallet-history",
    "scan_manifest": {
      "scan_id": "scan:helius:<safe-id>",
      "provider": "helius",
      "cursor_state": {
        "current_cursor": null,
        "next_cursor": "<PROVIDER_CURSOR_OR_NULL>"
      },
      "pages_loaded": 1,
      "transactions_loaded": 10,
      "completeness_confidence": 60,
      "full_history_loaded": false,
      "gap_flags": []
    }
  }
}
```

Supported Worker-side provider candidates:

- `helius`: implemented against Helius `getTransactionsForAddress` through the Worker-side Helius RPC endpoint. Configure `CRYPTO_WALLET_HISTORY_PROVIDER=helius` and set `HELIUS_API_KEY` as a Wrangler secret. The archive adapter uses `paginationToken`, `transactionDetails=full`, page-safe `limit`, `sortOrder=desc` by default, and `filters.tokenAccounts=balanceChanged` unless `CRYPTO_HELIUS_HISTORY_TOKEN_ACCOUNTS` is set to `none`, `balanceChanged`, or `all`. Set `CRYPTO_HELIUS_HISTORY_SORT_ORDER=asc` for oldest-first archive scans when the UI flow is ready to consume them. Set `CRYPTO_HELIUS_HISTORY_ADAPTER=legacy` only to force the older address-history adapter. The legacy address-history path remains available as a downgraded fallback and is not archive-grade.
- `lana`: placeholder only. D107 found no public lana.ai wallet history API documentation, so the Worker returns `provider_placeholder` and performs no lana.ai request.
- `generic`: implemented as a Worker-side HTTPS endpoint adapter for a future documented provider or owned backend. Configure `CRYPTO_WALLET_HISTORY_PROVIDER=generic`, `CRYPTO_WALLET_HISTORY_URL`, and optionally `CRYPTO_WALLET_HISTORY_BEARER_TOKEN`. The browser never sees these values.

If `CRYPTO_WALLET_HISTORY_PROVIDER` or provider-specific config is missing, the endpoint returns a structured `provider_not_configured` page with empty events. Invalid wallets return `400 invalid_event_query`; unsupported providers return `400 unsupported_provider`.

History page guardrails:

- Frontend-requested `limit` is capped to the Worker maximum and reported as `metadata.limit_capped` when adjusted.
- Successful normalized history pages are cached by provider, wallet, scan id, cursor, and limit for 45 seconds. Cache entries contain only the normalized response body, never provider URLs, API keys, bearer tokens, or raw provider payloads.
- Cache metadata is returned as `metadata.cache_status` and `metadata.cache_hit` so the staged UI can show hit/miss state.
- Provider fetches are rate-limited per provider/wallet window before calling Helius or a generic endpoint. The default is 12 provider fetches per 60 seconds; override with `CRYPTO_WALLET_HISTORY_RATE_LIMIT_FETCHES` if needed.
- Worker-side guardrails and upstream `429` responses return a normalized `provider_rate_limited` page with a structured message and `metadata.retry_after_seconds`.
- Provider outages or malformed provider responses return `provider_unavailable`. Missing provider setup returns `provider_not_configured`. These guardrail/error pages are not cached as successful history pages.

Archive-grade readiness metadata:

- History responses and diagnostics include `archive_contract_version`, `scan_manifest_version`, `provider_family`, `archive_readiness`, `replay_readiness`, `provider_grade`, `replay_suitability`, `completeness_confidence`, `historical_depth`, `ordering_guarantee`, `cursor_guarantee`, `coverage_scope`, `chronological_ordering_support`, `token_account_coverage_support`, `deterministic_pagination_support`, and `gap_detection_support`.
- These fields do not change Wallet Lookup and do not merge staged history into the active graph.
- Current Helius history support is archive-path capable, but a wallet scan is not complete until pagination exhausts without blocking `gap_flags`. Confidence is degraded by rate limits, provider limits, cursor stalls, missing ordering fields, malformed ordering, timestamp inconsistencies, incomplete rows, and ambiguous exhaustion.
- Generic and lana.ai candidates remain `basic` until a documented provider contract proves stronger cursor, ordering, and depth guarantees.

## Scan Manifests

Every Worker history page now carries a browser-safe scan manifest. The manifest is operational metadata only; it contains no raw provider payload, API key, bearer token, request header, provider URL, or private RPC value.

Manifest fields:

- `scan_id`: safe identifier passed back by the browser on later page requests.
- `wallet`, `provider`, `provider_grade`, `replay_suitability`.
- `started_at`, `updated_at`.
- `cursor_state`: current cursor, next cursor, cursor kind, advancement state, sort order, and pagination model.
- `pages_loaded`, `transactions_loaded`.
- `earliest_timestamp`, `latest_timestamp`.
- `provider_limit_reached`, `rate_limited`.
- `completeness_confidence`, `full_history_loaded`.
- `gap_flags`, `warnings`.

The Worker persists scan manifests in `CRYPTO_EVENTS_KV` when available, falling back to bounded in-memory storage. The browser also keeps the latest manifest in the history controller so progressive loading can resume within the current session by sending `scan_id`.

Stop conditions for progressive backfill:

- provider limit or upstream rate limit
- Worker rate limit
- cursor stall
- schema mismatch
- malformed ordering
- ambiguous provider exhaustion
- no next cursor

`full_history_loaded: true` is only best-effort unless the provider contract plus scan state prove exhaustion without gaps. Do not present it as legal, forensic, or investment-grade completeness.

## Helius Archive Adapter

The default Helius history path now calls `getTransactionsForAddress` server-side only:

- endpoint family: Helius RPC, Worker-side only
- method: `getTransactionsForAddress`
- `transactionDetails`: `full`
- `sortOrder`: `desc` by default, `asc` when configured
- cursor: `paginationToken`
- token-account scope: `filters.tokenAccounts`
- replay ordering checks: slot plus `transactionIndex`
- normalized output: CryptoPhotonic sanitized event rows only

The adapter validates page-local schema, timestamps, cursor movement, ordering fields, and transaction completeness. It emits `gap_flags` instead of pretending gaps are complete. The older Helius address-history adapter still exists as a fallback/legacy path and is explicitly downgraded to partial confidence when used.

## Replay Scaling Notes

Replay remains preview-only. The browser builds capped preview datasets from staged rows and never merges staged history into the active Wallet Lookup graph. The current UI exposes:

- scan progress
- replay coverage estimate
- completeness confidence
- provider grade
- archive readiness
- staged-history warnings
- replay limitations

Rendering remains capped by the frontend preview limits, and the replay animator uses capped graph windows. Large archive scans must continue through progressive pages and manifest-backed windows rather than one massive browser graph render.

## Controlled Watchlist

The Helius route is intentionally limited to 1 to 3 wallets. The source contains a static placeholder watchlist, and deployments can set `CRYPTO_HELIUS_ALLOWED_WALLETS` to a comma-separated list of up to three controlled wallet addresses. Events with no wallet match are rejected and not stored.

This webhook watchlist is separate from the controlled wallet lookup endpoint. Do not broaden webhook ingestion beyond the 1 to 3 configured wallets, and do not add signing, swap execution, private RPC calls, or unrestricted background polling.

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

PowerShell-friendly local checks:

```powershell
cd worker/crypto-runtime
wrangler dev
curl.exe http://127.0.0.1:8787/health
curl.exe http://127.0.0.1:8787/api/crypto/events
curl.exe "http://127.0.0.1:8787/api/crypto/events?limit=1"
curl.exe "http://127.0.0.1:8787/api/crypto/events?wallet=CryptoPhotonicControlledWallet1111111111111111111"
curl.exe "http://127.0.0.1:8787/api/crypto/events?token=CPHOTON&transaction_type=token_transfer"
curl.exe "http://127.0.0.1:8787/api/crypto/wallet-activity?wallet=<PUBLIC_WALLET>&limit=10"
curl.exe -X POST http://127.0.0.1:8787/api/crypto/test-event `
  -H "content-type: application/json" `
  --data-binary "@test-payloads/test-event.sample.json"
curl.exe -X POST http://127.0.0.1:8787/webhooks/helius `
  -H "content-type: application/json" `
  --data-binary "@test-payloads/helius-webhook.sample.json"
curl.exe -X POST http://127.0.0.1:8787/api/crypto/dev/clear-events
```

`POST /api/crypto/test-event` also accepts a bounded array of 1 to 10 safe event objects for local testing.

For a frontend smoke test, open the Worker routes first:

```sh
cd worker/crypto-runtime
wrangler dev
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/crypto/events
```

Then open the CryptoPhotonic UI and turn Live Mode ON only after the feed endpoint is reachable. If the UI is not hosted behind the same local origin as the Worker, configure safe endpoints for the browser test by using same-origin `/api/crypto/events` and `/api/crypto/wallet-activity` paths through a local proxy/rewrite, or by pointing at explicit deployed HTTPS Worker URLs. The browser guard rejects non-HTTPS external URLs such as `http://127.0.0.1:8787/api/crypto/events`, so local cross-origin tests should use curl, a same-origin proxy, or HTTPS Worker endpoints.

## Deployment Checklist

Use this checklist for the first controlled Worker deployment and smoke test. Keep the first run to one controlled wallet. Do not add real API keys, webhook secrets, provider URLs, signing flows, swap execution, or broad wallet input to source control.

1. Install Wrangler:

```powershell
npm install -g wrangler
```

2. Log in to Cloudflare:

```powershell
wrangler login
```

3. Create or select the Worker in `wrangler.toml`:

```toml
name = "cryptophotonic-runtime"
main = "src/index.js"
compatibility_date = "2026-05-06"
workers_dev = true

[vars]
CRYPTO_RUNTIME_MODE = "mvp-dev"
LIVE_PROVIDER_FETCHING = "false"
ENVIRONMENT = "production"
CRYPTO_HELIUS_ALLOWED_WALLETS = "CryptoPhotonicControlledWallet1111111111111111111"
```

4. If using KV, create namespaces and put only placeholder IDs in `wrangler.toml` until the real Cloudflare IDs are known locally:

```powershell
cd worker/crypto-runtime
wrangler kv namespace create CRYPTO_EVENTS_KV
wrangler kv namespace create CRYPTO_EVENTS_KV --preview
```

```toml
[[kv_namespaces]]
binding = "CRYPTO_EVENTS_KV"
id = "replace-with-kv-namespace-id"
preview_id = "replace-with-preview-kv-namespace-id"
```

5. Set deployment environment and watchlist values without broadening scope:

```toml
[vars]
ENVIRONMENT = "production"
CRYPTO_HELIUS_ALLOWED_WALLETS = "CryptoPhotonicControlledWallet1111111111111111111"
```

6. Set the Helius wallet lookup API key and webhook authorization header as Wrangler secrets. Use real values only at the prompts; do not put them in this README, `wrangler.toml`, `.dev.vars`, browser code, or static assets.

```powershell
cd worker/crypto-runtime
wrangler secret put HELIUS_API_KEY
wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER
```

7. Deploy:

```powershell
cd worker/crypto-runtime
wrangler deploy
```

8. Test `/health`:

```powershell
$WorkerBaseUrl = "https://cryptophotonic-runtime.<account>.workers.dev"
curl.exe "$WorkerBaseUrl/health"
```

9. Test `/api/crypto/events`:

```powershell
curl.exe "$WorkerBaseUrl/api/crypto/events"
```

10. Test controlled wallet lookup. Replace the placeholder with a public Solana wallet address:

```powershell
curl.exe "$WorkerBaseUrl/api/crypto/wallet-activity?wallet=<PUBLIC_WALLET>&limit=10"
```

11. Post a synthetic test event:

```powershell
curl.exe -X POST "$WorkerBaseUrl/api/crypto/test-event" `
  -H "content-type: application/json" `
  --data-binary "@test-payloads/test-event.sample.json"
```

12. Post the synthetic Helius webhook sample with a placeholder authorization header. Replace the placeholder only in your local shell, never in source:

```powershell
$WebhookAuthHeader = "replace-with-local-webhook-auth-header"
curl.exe -X POST "$WorkerBaseUrl/webhooks/helius" `
  -H "content-type: application/json" `
  -H "Authorization: $WebhookAuthHeader" `
  --data-binary "@test-payloads/helius-webhook.sample.json"
```

13. Verify the event appears in the sanitized feed:

```powershell
curl.exe "$WorkerBaseUrl/api/crypto/events?wallet=CryptoPhotonicControlledWallet1111111111111111111&limit=5"
```

## First Live Test Sequence

Use this exact order for the first real smoke test:

1. Deploy the Worker with `ENVIRONMENT = "production"` and one controlled wallet in `CRYPTO_HELIUS_ALLOWED_WALLETS`.
2. Confirm `GET /health` returns runtime status and no secrets.
3. Confirm `GET /api/crypto/events` returns a sanitized feed response.
4. Add one allowed wallet only. Keep the first live test to that single controlled wallet.
5. Set `HELIUS_WEBHOOK_AUTH_HEADER` with `wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER`.
6. Configure the Helius webhook manually in the Helius dashboard with the deployed `/webhooks/helius` URL, enhanced webhook type, the same one wallet, and the same auth header value.
7. Send or observe one transaction for that wallet.
8. Confirm the Worker feed receives one sanitized event at `/api/crypto/events`.
9. Configure the frontend Worker endpoints as same-origin `/api/crypto/events` and `/api/crypto/wallet-activity` paths, or as deployed HTTPS Worker URLs.
10. Turn CryptoPhotonic Live Mode ON only after the feed endpoint is reachable.

## Deployed Smoke Test Commands

Run these from `worker/crypto-runtime` in Windows PowerShell after deployment:

```powershell
cd worker/crypto-runtime
wrangler deploy
$WorkerBaseUrl = "https://cryptophotonic-runtime.<account>.workers.dev"
$WebhookAuthHeader = "replace-with-local-webhook-auth-header"

curl.exe "$WorkerBaseUrl/health"
curl.exe "$WorkerBaseUrl/api/crypto/events"
curl.exe "$WorkerBaseUrl/api/crypto/wallet-activity?wallet=<PUBLIC_WALLET>&limit=10"
curl.exe -X POST "$WorkerBaseUrl/api/crypto/test-event" `
  -H "content-type: application/json" `
  --data-binary "@test-payloads/test-event.sample.json"
curl.exe -X POST "$WorkerBaseUrl/webhooks/helius" `
  -H "content-type: application/json" `
  -H "Authorization: $WebhookAuthHeader" `
  --data-binary "@test-payloads/helius-webhook.sample.json"
curl.exe "$WorkerBaseUrl/api/crypto/events?wallet=CryptoPhotonicControlledWallet1111111111111111111&limit=5"
```

Do not deploy this as a broad production live-data endpoint. The current Helius path is for a small controlled first-data phase only and requires webhook authorization, the 1 to 3 wallet allowlist, bounded payloads, dedupe, and sanitized storage.

## Deployment Troubleshooting

- `401 invalid_webhook_auth`: the Helius dashboard `authHeader` value does not exactly match `HELIUS_WEBHOOK_AUTH_HEADER`, or the manual smoke test omitted the `Authorization` header.
- `403 webhook_event_out_of_scope`: the webhook payload did not include any wallet from `CRYPTO_HELIUS_ALLOWED_WALLETS`. Start with the default controlled placeholder locally, then use one real controlled wallet only for the first live test.
- `503 webhook_not_configured`: `HELIUS_WEBHOOK_AUTH_HEADER` is missing in a non-local deployment. Set it with `wrangler secret put HELIUS_WEBHOOK_AUTH_HEADER` and redeploy if needed.
- Worker feed unavailable in UI: check the Worker URL directly with `curl.exe "$WorkerBaseUrl/api/crypto/events"` before turning Live Mode ON.
- Worker wallet endpoint unavailable in UI: check the Worker URL directly with `curl.exe "$WorkerBaseUrl/api/crypto/wallet-activity?wallet=<PUBLIC_WALLET>&limit=10"` before using Track Wallet.
- GitHub Pages or static-host same-origin `/api/crypto/events` and `/api/crypto/wallet-activity` not available: static hosts cannot serve those Worker routes. Use explicit deployed HTTPS Worker endpoints or move to a host that can route both paths to the Worker.
- CORS issue: direct browser reads from GitHub Pages require the Worker to return CORS headers that allow the page origin. Confirm curl succeeds first, then inspect the browser console.
- KV not configured or memory fallback: without `CRYPTO_EVENTS_KV`, events are held in runtime memory and may disappear across isolates or restarts. Configure KV before relying on deployed feed persistence.
- Duplicate events: repeated signatures are deduped. A second POST of the same sample payload can return duplicate metadata and may not add a new feed item.

## Frontend Feed Deployment Options

CryptoPhotonic Live Mode is OFF by default. When enabled, the browser fetches only the sanitized Worker feed and never calls Helius, Jupiter, Solana RPC, private provider endpoints, signing services, or swap execution routes.

### Option A: Same Domain / Same Path

Host the static CryptoPhotonic UI and the Worker/API route behind the same domain, with the Worker mounted at:

```text
/api/crypto/events
```

Use the default frontend configuration:

```html
<main id="crypto-photonic-view" data-worker-feed-endpoint="/api/crypto/events">
```

This is the preferred production shape because the UI can fetch same-origin `/api/crypto/events` without exposing secrets or provider endpoints to browser code.

### Option B: Static UI + Explicit Worker Endpoints

GitHub Pages, Vercel static output, and other static hosts can host the UI, but they cannot serve same-origin Worker routes unless a rewrite/proxy is configured. Keep Live Mode OFF until the deployed Worker feed is reachable over HTTPS, then configure explicit Worker feed and wallet lookup URLs permanently in `index.html` or deployment-injected config:

```html
<script>
  window.CryptoPhotonicWorkerFeedEndpoint = 'https://cryptophotonic-runtime.<account>.workers.dev/api/crypto/events';
  window.CryptoPhotonicWorkerWalletActivityEndpoint = 'https://cryptophotonic-runtime.<account>.workers.dev/api/crypto/wallet-activity';
</script>
```

or:

```html
<main id="crypto-photonic-view" data-worker-feed-endpoint="https://cryptophotonic-runtime.<account>.workers.dev/api/crypto/events">
```

The configured external feed endpoint must use HTTPS and must end at `/api/crypto/events` with no credentials, query string, or fragment. The configured external wallet lookup endpoint must use HTTPS and must end at `/api/crypto/wallet-activity` with no credentials, query string, or fragment. Console commands such as `window.CryptoPhotonicWorkerFeedEndpoint = '...'` are useful only for temporary manual testing and reset on refresh; deployed UI configuration should live in `index.html` or deployment config. The Worker must also return CORS headers that allow the static UI origin to read `GET /api/crypto/events` and `GET /api/crypto/wallet-activity`. Do not configure provider URLs, Helius URLs, Jupiter URLs, private RPC URLs, API keys, auth headers, or non-HTTPS local URLs in the static UI.

The browser still calls only the Worker endpoints. It never calls Helius directly; the provider key stays in the Worker environment and wallet lookup remains one bounded server-side Worker action per user request.

### Option C: Later Static Host Migration

A later phase can move the static CryptoPhotonic UI to Cloudflare Pages or Vercel and route `/api/crypto/events` and `/api/crypto/wallet-activity` to the Worker/API runtime from the same site. Preserve the same browser contract: the UI reads sanitized Worker events and wallet lookup results only, while the Worker owns webhook/provider secrets, bounded ingestion, dedupe, storage, and all server-side provider interaction.

Generated fixture fallback remains safe in all options. If the Worker is unavailable, misconfigured, or not yet deployed, CryptoPhotonic stays in fixture/sample mode and Live Mode remains unavailable or OFF.

## Future Secrets

Use Wrangler secrets only. Never commit API keys, private RPC URLs, bearer tokens, `.dev.vars`, or provider credentials.

```sh
cd worker/crypto-runtime
wrangler secret put HELIUS_API_KEY
```

The command prompts for the value used by server-side wallet lookup. Do not place the value in source, documentation, browser code, or static assets.

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
- Browser wallet lookup calls only `/api/crypto/wallet-activity`; the Worker performs one bounded server-side Helius address-history request per user action.
- Webhook/cache first: provider ingestion happens server-side, reduces raw payloads to safe events, and caches those events before the browser reads them.
- Bounded reads: the public feed enforces a maximum `limit` of `100` and exact filters to avoid unbounded scans.
- Wallet lookup reads default to `10`, are capped at `25`, use signature dedupe, and use a short cooldown for repeated wallet requests when cached data exists.
- Bounded writes: Helius webhook ingestion accepts at most 10 transactions per delivery and only 1 to 3 configured wallets.
- Keep scope small on the free tier because webhook fan-out, retries, KV writes, and feed reads compound quickly as wallet count and transaction volume rise.

## Security Rules

- Browser code must not call Helius, Jupiter, or private RPC providers directly.
- Browser wallet history pagination must call only `/api/crypto/wallet-history`; Helius, lana.ai, generic external provider URLs, bearer tokens, and RPC details stay Worker-side.
- Worker responses must not expose API keys, authorization headers, bearer tokens, private RPC URLs, raw provider payloads, signing keys, or request headers.
- `POST /api/crypto/test-event` is only a local/dev ingestion path for sanitized test payloads.
- `POST /webhooks/helius` must use a Helius `authHeader` value mirrored into `HELIUS_WEBHOOK_AUTH_HEADER` before non-local deployments accept events.
- Helius events outside the controlled wallet watchlist are rejected before storage.
- Sanitized event output is limited to graph-safe fields: event identity, chain, signature, timestamp, transaction type, source, wallets, tokens, transfers, schema version, ingestion source, received time, dedupe key, and metadata flags.
- Events keep `metadata.live_blockchain_fetching = false` because the Worker receives webhook deliveries and the browser reads cached sanitized events; neither path performs browser live provider fetching.
