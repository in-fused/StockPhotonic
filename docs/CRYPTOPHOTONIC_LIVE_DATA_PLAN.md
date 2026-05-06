# CryptoPhotonic Live-Data Readiness Plan

CryptoPhotonic remains an offline, fixture-driven Solana-first graph renderer until a secure runtime exists for live-data access. This plan defines the boundary for future Helius, Solana, and Jupiter integration without adding credentials, live requests, backend code, or production data claims.

## Phase D79-D80 Scope

- Planning and adapter shaping only.
- No API keys, private RPC URLs, bearer tokens, wallet private keys, or signing material are added.
- No browser-side live fetching, WebSocket subscription, backend/server implementation, swap request, transaction signing, or production-data claim is added.
- No CryptoPhotonic UI rendering, canvas animation, layout, replay controls, or StockPhotonic behavior is changed.
- Phase D80 adds only the local secure runner plan, cache/rate-limit strategy, and generated output contract. It does not implement the runner or any live provider calls.

## Solana-First Strategy

- Keep Solana as the first live-data target because current fixtures and adapters already normalize Solana-shaped wallet, SPL token, entity hub, and swap-like transaction records.
- Preserve offline fixture loading as the default mode for local development, demos, and visual QA.
- Treat all public sample data under `data/crypto/` as synthetic, dev-only, and safe to ship without secrets.
- Add live ingestion only after a backend/proxy or local-only secure runner can protect provider credentials and enforce request policy.

## Real Data Pipeline

The live-data path must preserve the current graph model:

`Input -> Adapter -> Graph -> UI -> Live Flow Queue`

- Input: a secure runtime receives an allowed request such as one public wallet address or an approved transaction signature list, then calls external Solana providers. The browser never calls Helius, private Solana RPC URLs, or secret-backed Jupiter endpoints directly.
- Adapter: `js/crypto/solanaAdapter.js` remains the boundary that normalizes provider payloads into CryptoPhotonic dataset records with `metadata`, `wallets`, `tokens`, `entities`, and `transactions`.
- Graph: the normalized dataset continues through `CryptoPhotonic.core.normalizeDataset()` and `CryptoPhotonic.graph.buildGraph()` with no graph contract changes.
- UI: existing CryptoPhotonic rendering consumes graph nodes and edges exactly as it does for fixtures. No live-data-specific rendering path is required for the first milestone.
- Live Flow Queue: normalized transactions become ordered flow edges. `buildFlowReplayPlan()` currently derives `flowReplay.ordered_flows` from those edges, so live records append to the same ordered queue shape used by offline fixtures.

## Target Integrations

### Helius Enhanced Transactions

- Role: primary live-data source for the first real-data milestone.
- Future purpose: normalize enriched Solana transaction payloads into CryptoPhotonic wallets, tokens, entity hubs, transaction flows, and route context.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime that owns the Helius secret, validates requested signatures or wallet scopes, calls Helius, filters responses, and returns sanitized graph-ready records.

### Solana WebSocket / Realtime

- Role: realtime later, after the static recent-transaction path is secure and tested.
- Future purpose: stream updates for watched wallets, hubs, or Solana programs into the graph.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime that owns realtime credentials or RPC URLs, manages subscriptions server-side or inside a local secure runner, and forwards only sanitized events to the browser.

### Jupiter Route / Swap Context

- Role: swap context later, not needed for the first live milestone.
- Future purpose: annotate swap-like transaction flows with route, quote, pool, and token context.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime for any live route or quote requests, plus explicit separation from signing or swap execution. Browser public code must not execute swaps or hold signing material.

## Required Data Shape

The adapter output must match the existing CryptoPhotonic dataset shape. Provider-specific payloads are discarded after normalized records are built, except for safe diagnostic metadata.

### Dataset Envelope

```json
{
  "metadata": {
    "name": "string",
    "environment": "secure_runtime_live_candidate",
    "chain": "solana",
    "adapter": "solana",
    "production_meaning": false,
    "live_blockchain_fetching": false
  },
  "wallets": [],
  "tokens": [],
  "entities": [],
  "transactions": []
}
```

- `metadata.live_blockchain_fetching` remains `false` in public browser code until a future phase wires a secure runtime.
- `production_meaning` remains `false` until labeling, attribution, and review rules are explicitly added.

### Transaction Format

Each parsed transfer becomes one CryptoPhotonic transaction record:

```json
{
  "id": "tx:solana:<signature>:<transfer_index>",
  "transaction_type": "native_transfer | token_transfer | swap_leg | provider_type",
  "transaction_hash": "solana signature",
  "chain": "solana",
  "source_wallet": "normalized source owner/account",
  "destination_wallet": "normalized destination owner/account",
  "token_mint": "normalized SPL mint or solana:native-sol",
  "contract_address": "same value as token_mint",
  "symbol": "SOL | token symbol | SPL",
  "amount": 0,
  "usd_value": 0,
  "timestamp": "ISO-8601 timestamp or null",
  "confidence": 0,
  "label_source": "helius_enhanced_transactions | secure_runtime | fixture source",
  "hub_ids": [],
  "flow_role": "",
  "route_id": "",
  "metadata": {
    "source_format": "native_transfer | token_transfer | swap_leg",
    "instruction_index": 0,
    "token_account_source": "optional token account",
    "token_account_destination": "optional token account",
    "decimals": 0,
    "raw_amount": "optional provider amount"
  }
}
```

Required for graph compatibility: `source_wallet`, `destination_wallet`, `token_mint` or `symbol`, `transaction_hash`, `chain`, `amount`, `usd_value`, `timestamp`, and `hub_ids`.

### Wallet Structure

```json
{
  "id": "wallet:solana:<address>",
  "type": "wallet",
  "address": "normalized owner/account address",
  "chain": "solana",
  "label": "short address or reviewed label",
  "label_source": "transaction_input | secure_runtime | reviewed_label",
  "confidence": 0,
  "metadata": {
    "first_seen_signature": "optional",
    "watched_wallet": true
  }
}
```

Wallet labels must default to short addresses. Entity-style labels require reviewed hub inputs and must not be inferred from a single transfer alone.

### Token Structure

```json
{
  "id": "token:solana:<mint>",
  "type": "token",
  "symbol": "SOL | SPL | provider symbol",
  "name": "Solana | token name | symbol",
  "token_mint": "normalized mint",
  "contract_address": "normalized mint",
  "chain": "solana",
  "decimals": 0,
  "label_source": "helius_enhanced_transactions | secure_runtime | fixture source",
  "confidence": 0,
  "metadata": {
    "source_format": "native_transfer | token_transfer",
    "provider_token_account": "optional"
  }
}
```

Native SOL uses `solana:native-sol` as the token mint so the graph can treat SOL like any other token exposure.

### Hub Labeling Inputs

Hubs remain optional for the first live milestone. When added later, hub records must use the existing entity shape:

```json
{
  "id": "hub:<stable id>",
  "type": "hub",
  "label": "reviewed exchange/protocol/pool/bridge label",
  "category": "exchange | protocol | liquidity_pool | bridge | labeled_entity",
  "chain": "solana",
  "label_source": "reviewed_label | secure_runtime_allowlist | fixture source",
  "confidence": 0,
  "related_wallets": [],
  "related_programs": [],
  "metadata": {
    "program_id": "optional",
    "pool_address": "optional",
    "review_required": true
  }
}
```

Transaction records link to hubs through `hub_ids`, `exchange_hub_id`, `protocol_hub_id`, `route_hub_id`, `pool_hub_id`, `liquidity_pool_hub_id`, `bridge_hub_id`, or `counterparty_hub_id`. The graph already aggregates hub flow from those IDs.

### Swap Route Structure

Swap context is not required for the first milestone. When Jupiter context is added later, route records should annotate transactions without changing the graph contract:

```json
{
  "route_id": "stable route id",
  "transaction_hash": "solana signature",
  "source_wallet": "initiating wallet",
  "input_token_mint": "mint or solana:native-sol",
  "output_token_mint": "mint or solana:native-sol",
  "input_amount": 0,
  "output_amount": 0,
  "usd_value": 0,
  "legs": [
    {
      "index": 0,
      "program_id": "optional",
      "pool_hub_id": "optional",
      "input_token_mint": "mint",
      "output_token_mint": "mint",
      "input_amount": 0,
      "output_amount": 0
    }
  ],
  "metadata": {
    "source": "jupiter_context | helius_swap_event",
    "execution_disabled": true
  }
}
```

Each route leg that should animate must also be represented as a normal transaction record with `flow_role: "swap_route"` and the same `route_id`.

## Minimum Live Data Set

The first live milestone is deliberately narrow:

- Track one public Solana wallet address at a time.
- Load recent transactions for that one wallet through a secure runtime.
- Use Helius Enhanced Transactions as the primary source.
- Parse native SOL and SPL token transfers only.
- Normalize transfer owners/accounts into wallet records and token records.
- Build graph flow edges from parsed transfers.
- Append new normalized transfers to replay order by timestamp/signature.
- Do not add clustering, entity attribution, risk scoring, counterparty claims, swap execution, signing, or realtime subscriptions.

Out of scope for the first live milestone:

- Wallet clustering.
- Persistent identity labels.
- Exchange/protocol attribution unless supplied by a reviewed allowlist.
- Multi-wallet watchlists.
- Jupiter quote execution.
- Browser-side provider requests.

## Secure Configuration Boundaries

- Browser public code must never contain API keys, bearer tokens, private RPC URLs, signing keys, wallet private keys, or secret-manager access.
- API keys must remain in local environment variables or a managed secret store.
- `index.html`, public JavaScript, and JSON fixtures must not include real provider keys or private URLs.
- Live Helius, Solana RPC/WebSocket, and Jupiter calls require a future backend/proxy or local-only secure runner before enablement.
- The Helius key must never be exposed to browser JavaScript, devtools, source maps, static assets, JSON fixtures, logs, analytics, or client error reports.
- Request filtering is required in the secure runtime before provider calls are made. The runtime must validate wallet address format, allowed scopes, pagination limits, time windows, signature lists, and response size.
- Responses must be sanitized before they reach public UI code. Drop provider credentials, request headers, internal URLs, unneeded raw payloads, and any field that is not needed for the graph contract.
- Rate limits, allowlists, retry policy, and abuse controls belong in the secure runtime, not in public browser code.
- No browser-side secret loading is implemented in this phase.
- No live blockchain fetching, WebSocket subscription, swap request, transaction signing, or backend/server code is implemented in this phase.

## Local Secure Runner Plan

A future local-only secure runner may live under `scripts/crypto/`. It is not implemented in this phase. Its purpose is to let the user run a controlled ingestion process from their own machine while keeping provider credentials out of the browser and out of public fixtures.

Required runner boundaries:

- Run only as a local command-line process from the user's machine.
- Read the Helius API key from a local environment variable such as `HELIUS_API_KEY`.
- Never write, print, bundle, or expose the Helius key to browser JavaScript, HTML, public assets, generated fixtures, logs intended for sharing, or source maps.
- Accept a constrained public Solana wallet address, signature list, and optional time window as local input.
- Validate wallet addresses, transaction signatures, pagination limits, response size, and time windows before any provider request in a later implementation.
- Write only sanitized graph-ready JSON fixtures under `data/crypto/generated/`.
- Keep any raw provider payload cache outside public generated output. If raw cache is later needed, use `data/crypto/cache/` and ignore it before writing real payloads.
- Exit without starting a backend service, web server, proxy, browser listener, signing workflow, or swap execution path.

The local runner is a preparation path for secure ingestion, not a replacement for the public fixture model. Offline fixture loading remains the default browser behavior until a later phase explicitly wires sanitized generated files into the app.

## Cache Strategy For Helius Free-Tier Limits

Helius free-tier limits should be treated as constrained and subject to change. The future runner should avoid hardcoded plan assumptions and should make its request policy configurable below the current provider allowance documented at implementation time.

Recommended cache locations:

- `data/crypto/generated/`: sanitized output fixtures that are safe for browser consumption.
- `data/crypto/cache/`: optional future raw or semi-raw local cache, ignored before any real provider payloads are written.

Cache rules:

- Cache wallet scans by normalized wallet address.
- Cache transaction details by transaction signature.
- Cache list results by wallet address plus time window and pagination cursor where applicable.
- Track already-seen signatures per wallet and skip them on later runs.
- Batch unknown signatures before requesting enhanced transaction details.
- Append only new sanitized transfer records to the generated wallet-flow fixture.
- Deduplicate by transaction signature plus transfer index or another stable transfer identifier.
- Preserve raw provider payloads only outside public generated data if they are needed for local diagnostics or replayable parsing tests.
- Never copy raw request headers, private URLs, API keys, bearer tokens, or provider diagnostics that include secrets into generated fixtures.

Incremental updates should be preferred over full re-pulls. A runner should load the existing generated wallet-flow file first, collect known signatures and transfer IDs, request only missing windows or signatures, then rewrite or append the sanitized fixture with deterministic ordering.

## Rate Limit Strategy For Helius Free-Tier Limits

The future runner should default to conservative local throttling because free-tier provider limits can change by account, endpoint, and date.

Safe defaults:

- Keep maximum requests per second below the documented free-tier allowance at implementation time.
- Use a configurable request interval rather than embedding fragile assumptions in code or fixtures.
- Retry 429 responses with exponential backoff and jitter.
- Respect provider retry headers when present.
- Batch signature lookups where the provider endpoint supports batching.
- Avoid tight polling loops and realtime-style refresh intervals on the free tier.
- Prefer incremental wallet updates over full history re-pulls.
- Stop or slow down after repeated rate-limit responses rather than continuing to burn quota.
- Record non-secret request timing and count metadata locally so future runs can choose smaller windows.

Polling should not be the first realtime design. The first live milestone should remain a user-triggered local command that refreshes a bounded wallet/time-window fixture, then hands sanitized JSON to the offline UI.

## Generated Output Contract

The future runner should write sanitized fixtures using this path pattern:

`data/crypto/generated/solana-wallet-flow.<wallet>.json`

`<wallet>` should be a normalized, filesystem-safe public wallet address or reviewed short identifier. The generated file must be safe to commit only after review and must contain no secrets.

Required top-level shape:

```json
{
  "metadata": {
    "name": "Solana wallet flow",
    "environment": "local_secure_runner_generated",
    "chain": "solana",
    "adapter": "solana",
    "source": "helius_enhanced_transactions_sanitized",
    "wallet": "public wallet address",
    "generated_at": "ISO-8601 timestamp",
    "time_window": {
      "start": "ISO-8601 timestamp or null",
      "end": "ISO-8601 timestamp or null"
    },
    "production_meaning": false,
    "live_blockchain_fetching": false,
    "sanitized": true
  },
  "wallets": [],
  "tokens": [],
  "entities": [],
  "transactions": []
}
```

Generated files must include:

- `metadata`
- `wallets`
- `tokens`
- `entities`
- `transactions`

Generated files must not include:

- API keys, bearer tokens, signing material, private keys, or secret names that reveal secret values.
- Raw request headers or authorization metadata.
- Private RPC, WebSocket, proxy, or provider URLs.
- Raw provider payloads unless explicitly sanitized into the public graph contract.
- Local filesystem paths that expose private machine details.
- Error traces or diagnostics that contain request credentials.

The generated contract mirrors the existing adapter output contract so `solanaAdapter`, graph building, and the current animation state can consume the same shape without public UI changes.

## Live Flow Queue Integration

The user-facing concept should be Live Flow Queue, not Replay. The queue represents realtime ordered flow intake from sanitized transaction records, not press-play historical playback.

The internal `flowReplay` name and `buildFlowReplayPlan()` function may remain for now to avoid UI or graph contract churn. A later refactor can rename the internal state to `flowQueue` after generated live fixtures and merge/dedupe behavior are stable.

The animation system should reuse the existing ordered-flow path:

1. Secure runtime returns sanitized Helius transaction payloads.
2. `solanaAdapter` maps each parsed transfer into CryptoPhotonic transaction records.
3. `graph.buildGraph()` turns transactions into flow edges.
4. `buildFlowReplayPlan()` sorts flow edges by timestamp and value into `flowReplay.ordered_flows`.
5. The current UI controls and flow pulse animation read `flowReplay.ordered_flows` and `activeFlowId`.

For later incremental live updates, a sanitized transaction batch should be normalized, deduplicated by `transaction_hash` plus transfer index, merged into the current dataset, and rebuilt into graph/queue state. New transactions append to the Live Flow Queue according to the existing timestamp sort. No new animation primitives are needed for the first live milestone.

## Disabled Adapter Stubs

`js/crypto/solanaAdapter.js` exposes planning-only functions for future integration:

- `createHeliusEnhancedTransactionPlan()`
- `createSolanaWebSocketPlan()`
- `createJupiterRouteContextPlan()`

These functions return configuration/readiness objects only. They do not fetch, subscribe, sign, execute swaps, load secrets, or make live blockchain calls.

## Enablement Checklist For A Later Phase

- Add a backend/proxy or local-only secure runner outside public browser code.
- Load provider credentials only from environment variables or a secret manager inside that secure runtime.
- Keep request allowlists and rate limits server-side.
- Add cache indexes by wallet address, transaction signature, and time window before making repeated Helius requests.
- Add conservative rate limiting, 429 retry/backoff, batched signature lookup, and incremental update behavior before free-tier live testing.
- Add request filtering for wallet addresses, signatures, pagination, date windows, response size, and provider endpoints.
- Sanitize live responses before they reach CryptoPhotonic UI code.
- Add merge/dedupe behavior for recent transactions before realtime append.
- Preserve offline fixtures as the fallback and test baseline.
- Add tests that verify no keys appear in HTML, public JavaScript, or JSON fixtures.
- Add tests that adapter output still builds graph nodes, flow edges, hub label edges when supplied, and replay ordering without UI changes.
