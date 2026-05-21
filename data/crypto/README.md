# CryptoPhotonic Local Data Contract

CryptoPhotonic browser code may read local static JSON, generated cache files, or Worker-normalized responses. It must not call chain providers, RPC endpoints, explorer APIs, swap APIs, or wallet-history providers directly from the browser.

## Data Classes

### Fixture Data

Fixture data is local, reviewable JSON used for deterministic UI and parser QA. Fixtures must mark themselves as sample, fixture, or generated test data and must set production-meaning fields to false when present. Fixture data is not evidence of wallet identity, ownership, liquidity, risk, criminality, market intent, or complete history.

Examples:

- `data/crypto/sample-flow.json`
- `data/crypto/solana-sample-flow.json`
- `data/crypto/sample_wallet_history.json`
- `data/crypto/sample_replay_cache.json`

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
