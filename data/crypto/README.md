# CryptoPhotonic Local Data Contract

CryptoPhotonic browser code may read local static JSON, generated cache files, or Worker-normalized responses. It must not call chain providers, RPC endpoints, explorer APIs, swap APIs, or wallet-history providers directly from the browser.

## D339-D348 Active Graph Rule

CryptoPhotonic is truth-bound on first load. The active graph remains empty until one of these real-data sources is available:

- Worker Wallet Lookup data
- Worker Live Feed events returned and rendered
- An explicitly selected generated Local Cache artifact marked as provider-fetched and non-sample

Sample fixtures, sample caches, built-in dev samples, and generated `*.sample.json` files are dev/test artifacts only. They may remain in the repository for parser, layout, and replay QA, but they must not render as default active graph data or masquerade as production-safe Local Cache data.

Local Cache entries are selectable only when manifest and artifact metadata show all of the following:

- `sample: false`
- `fixture: false`
- `provider_cache: true`
- `provider_cache_derived: true`
- `cache_origin: provider_fetched`
- `cache_class: provider_cache`
- `sanitized: true`
- `browser_provider_calls: false`
- `provider_keys_included: false`

The browser still never calls providers directly. Provider keys remain local/server-side only.

## D369-D378 Crypto Worker/API Runtime Endpoints

D369-D378 implements the first real server-side runtime bridge for the D349-D368 contract. Browser code calls only same-origin `/api/crypto/*` endpoints; those API handlers read provider credentials from server environment variables and call Helius server-side only.

Runtime boundaries:

- `HELIUS_API_KEY` is read only from the server environment and is never returned to the browser.
- `/api/crypto/provider-diagnostics`, `/api/crypto/wallet-activity`, `/api/crypto/wallet-history`, and `/api/crypto/events` return sanitized metadata and normalized rows only.
- Provider request URLs, headers, bearer tokens, keyed URLs, raw provider payloads, signing material, and secret values are not returned or cached.
- The runtime cache is in-memory, TTL-bounded, best-effort, and non-persistent; it stores only sanitized response payloads and emits cache ids/status metadata.
- Missing wallet and missing provider-key states return explicit empty/error metadata with no sample/mock/dev fallback.
- Wallet Lookup remains a replacement graph path, wallet-history remains preview/review-only staged pagination, and Live Feed does not fake global events when no wallet source is supplied.
- Sample fixtures and generated sample files remain dev/test artifacts and cannot become active graph data.

## D349-D368 Real Provider Ingestion + Worker Polling Safeguards

D349-D368 adds the guarded path for legitimate Solana wallet transaction history backfill and Worker-backed event polling without moving provider access into the browser.

The browser remains provider-blind:

- Browser code may call only configured Worker endpoints or read explicitly selected static Local Cache artifacts.
- Browser code must not call Solana RPC, explorer, swap, wallet-history, or provider APIs directly.
- Provider keys, bearer tokens, request headers, private URLs, and raw provider payloads must stay local/server-side and must not be written into browser-readable artifacts.
- Live Feed polling is disabled unless a safe Worker endpoint is configured, bounded by a minimum interval, and backed off or stopped on Worker rate-limit metadata.
- Worker `retry_after_seconds`, `rate_limited`, `provider_limited`, `more_available`, `cursor_exhausted`, `full_history_loaded`, `cache_id`, and `next_cursor` are UI states, not completeness or identity claims.
- Sample/mock/dev events and sample fixtures remain dev/test only and cannot become active graph data.

Local provider scripts remain explicit:

- `scripts/crypto_fetch_history.py` sends no network request without `--allow-network`.
- `scripts/crypto_fetch_history.py` writes nothing without `--write`.
- Network mode requires `--wallet` and a provider key in the configured local environment variable.
- Bounded backfill uses `--max-pages`, `--limit-per-page`, `--cooldown-seconds`, `--max-retries`, `--backoff-cap-seconds`, `--stop-on-rate-limit`, and `--resume-cursor`.
- `scripts/crypto_provider_adapters.py` returns sanitized provider page summaries and rate-limit/provider-limit/cursor metadata, never provider keys, request headers, raw keyed URLs, or raw provider payloads.
- `scripts/crypto_worker_contract.py` documents and validates the expected Worker response shape for `/api/crypto/wallet-activity`, `/api/crypto/wallet-history`, `/api/crypto/events`, and `/api/crypto/provider-diagnostics`; it does not deploy or implement a Worker.

Provider-fetched normalized cache metadata must include:

- `wallet`
- `provider`
- `provider_label`
- `fetched_at`
- `cache_id`
- `cache_version`
- `pages_loaded`
- `requested_limit`
- `returned_count`
- `next_cursor`
- `cursor_exhausted`
- `more_available`
- `rate_limited`
- `retry_after_seconds`
- `cooldown_applied_seconds`
- `provider_limited`
- `full_history_loaded`
- `full_history_claim_allowed`
- `browser_provider_calls: false`
- `provider_keys_included: false`
- `raw_provider_payloads_included: false`

`full_history_claim_allowed` must remain false unless the cursor is exhausted and no rate limit, provider limit, provider unavailable state, or additional cursor remains. Even when true, it is a bounded provider/cache state and must not imply wallet identity, ownership, source-of-funds, risk, criminality, liquidity truth, or investment meaning.

The intended provider-cache flow is:

`crypto_fetch_history.py` -> `crypto_normalize_transactions.py` -> `crypto_build_generated_fixture.py` -> `data/crypto/generated/provider-cache/*.generated.json` -> `manifest.provider_cache_fixtures` -> explicit UI Local Cache selection.

Generated provider-cache artifacts must be non-sample, sanitized, provider-cache-derived, and explicitly selected. The manifest must not auto-select sample fixtures, and first load must stay empty until Worker data or an explicitly selected provider cache is available.

## Data Classes

### Fixture Data

Fixture data is local, reviewable JSON used for deterministic UI and parser QA. Fixtures must mark themselves as sample, fixture, or generated test data and must set production-meaning fields to false when present. Fixture data is not evidence of wallet identity, ownership, liquidity, risk, criminality, market intent, or complete history.

Examples:

- `data/crypto/sample-flow.json`
- `data/crypto/solana-sample-flow.json`
- `data/crypto/sample_wallet_history.json`
- `data/crypto/sample_replay_cache.json`
- `data/crypto/generated/*.sample.json`

### Provider-Fetched Cache Data

Provider-fetched cache data is created only by local/server-side tooling or a secure Worker. Provider credentials must be read from local/server environment variables only and must never be written into browser-readable files. Cache files may store sanitized transaction facts, cursor state, replay-window summaries, parser limitations, and provenance metadata, but not provider request headers, bearer tokens, API keys, private URLs, signing material, or raw secrets.

Local scripts default to dry-run. Network/provider access must require an explicit flag such as `--allow-network`.

`scripts/crypto_provider_adapters.py` contains the local/server-side adapter boundary. `scripts/crypto_fetch_history.py` may call that adapter only when `--allow-network` is supplied, a public wallet is supplied, and the configured provider key exists in the local environment. Provider keys are never accepted as CLI arguments, printed, written to cache files, or passed to browser code.

Generated provider cache metadata must include bounded pagination fields:

- `cursor`
- `current_cursor`
- `next_cursor`
- `cursor_type`
- `cursor_field`
- `pagination_supported`
- `deterministic_pagination_support`
- `requested_limit`
- `returned_count`
- `more_available`
- `cursor_exhausted`
- `full_history_loaded`

### Wallet Lookup Replacement Graph Data

Wallet lookup replacement graph data is a browser-safe graph payload returned by a secure Worker. Loading it replaces the active CryptoPhotonic graph for that wallet lookup session. It is not merged with generated fixtures, live Worker feed events, or staged wallet-history pages.

Required boundaries:

- Wallet addresses are observations only.
- Labels must not imply identity or ownership certainty.
- Provider state and cache state must be shown as bounded metadata, not proof of completeness.
- Browser code must not receive provider keys.

### Replay Cache Data

Replay cache data is a staged, preview-only transaction or transfer-window cache. It can support replay planning, multi-step transaction review, parser confidence display, and scan-window continuation. It must not be treated as complete lifetime history unless provider pagination, cursor exhaustion, and scan metadata explicitly support that limited claim.

Replay cache entries should include:

- cache id/version
- source wallet input
- scan/window metadata
- cursor and pagination metadata from the normalized cache
- signature group count
- parser-limited count
- event type counts
- continuity confidence reason
- normalized transaction events
- parser confidence
- parser confidence reason
- parser limitations
- raw reference metadata without raw provider payloads

`scripts/crypto_normalize_transactions.py --write-replay-cache` generates replay cache JSON from normalized rows. The replay cache is derived local review state; it must not include raw provider payloads, provider request URLs, provider headers, API keys, bearer tokens, signing material, or browser-side provider calls.

### Generated Static Graph Fixtures

D329-D338 adds `scripts/crypto_build_generated_fixture.py`, a local-only generated fixture builder that converts normalized wallet history or replay cache JSON into browser-readable CryptoPhotonic graph datasets under `data/crypto/generated/`. The builder defaults to dry-run, writes only when `--write` is supplied, updates `data/crypto/generated/manifest.json` only when `--manifest` is supplied, and keeps the default output boundary inside `data/crypto/generated/`.

Generated fixtures are static/cache artifacts for browser rendering and replay review. They are not live blockchain fetches, production truth, source-of-funds evidence, wallet identity evidence, ownership evidence, risk labels, criminality labels, or complete-history claims. D339-D348 changes the active graph rule: generated sample fixtures are never default active data, and generated Local Cache artifacts are selectable only when metadata marks them as non-sample and provider-cache-derived.

Generated sample fixtures and manifest entries must explicitly mark:

- `sample`
- `fixture`
- `sanitized`
- `production_meaning: false`
- `live_blockchain_fetching: false`
- `browser_provider_calls: false`
- `provider_keys_included: false`

Generated graph fixtures should include wallets, tokens, transactions, transaction groups, parser quality summaries, cache/pagination summaries, replay cache references when present, and sanitized raw-reference flags. They must not include provider keys, request URLs, request headers, raw provider payloads, bearer tokens, private URLs, signing material, or browser-side provider-call instructions.

The browser may read generated fixture JSON and the generated manifest as static files. It must continue to use only static/cache/Worker-normalized data and must not call chain providers directly.

The generated manifest distinguishes `sample_fixtures`, `provider_cache_fixtures`, and `active_provider_cache_candidate`. `active_fixture` is kept only as a legacy/null field and must not point at sample data for production view.

### Review/Export Files

Review/export files are analyst-facing artifacts generated from normalized JSON, usually CSV and optionally XLSX when a local dependency is available. They are derived review material and not production app state. Export files must preserve source and parser limitation fields so downstream review does not overstate transaction meaning.

## Multi-Step Transaction Schema

Normalized transaction events should support these fields:

- `signature`
- `signature_group_id`
- `signature_group_index`
- `signature_group_size`
- `transfer_leg_index`
- `transfer_leg_count`
- `slot`
- `timestamp`
- `source_wallet`
- `destination_wallet`
- `token_mint`
- `amount`
- `transfer_direction`
- `outer_instruction_index`
- `inner_instruction_index`
- `program_id`
- `event_type`
- `multi_leg_signature`
- `swap_leg_group`
- `balance_delta_summary`
- `parser_confidence`
- `parser_confidence_reason`
- `parser_limitations`
- `raw_reference`

Rows are grouped deterministically by signature. Multiple visible transfer legs under one signature must remain separate rows with preserved source wallet, destination wallet, token mint, amount, and outer/inner instruction indices when available. Group fields are review aids only; they must not synthesize routes from unrelated legs.

Swap-like rows require visible inbound and outbound leg evidence under the same signature. When the parser can only infer a route or liquidity path from paired legs, normalized rows must carry explicit parser limitations such as `route or liquidity path not proven`.

Parser confidence should be paired with `parser_confidence_reason`. Missing source, destination, amount, or token mint fields, unsupported event shapes, downgraded swap labels, and parser-limited rows should lower confidence and remain visible in review/export output.

Recommended event type labels:

- `direct_transfer`
- `multi_leg_transfer`
- `swap_like_flow`
- `parser_limited_event`
- `unknown_unsupported_event`

These labels describe parser output only. They do not prove wallet identity, intent, liquidity truth, complete routing, or source-of-funds.

## Provider Key Boundary

Provider keys must stay local/server-side only. Do not place keys in:

- browser JavaScript
- HTML
- committed JSON
- generated cache files
- source maps
- screenshots or review exports
- local command examples intended for sharing

The browser may read static/cache/Worker-normalized data only. All provider access remains local/server-side and explicitly invoked.
