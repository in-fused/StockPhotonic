# CryptoPhotonic Live-Data Readiness Plan

CryptoPhotonic remains an offline, fixture-driven Solana-first graph renderer until a secure runtime exists for live-data access. This plan defines the boundary for future Helius, Solana, and Jupiter integration without adding credentials, live requests, backend code, or production data claims.

## Phase D79 Scope

- Planning and adapter shaping only.
- No API keys, private RPC URLs, bearer tokens, wallet private keys, or signing material are added.
- No browser-side live fetching, WebSocket subscription, backend/server implementation, swap request, transaction signing, or production-data claim is added.
- No CryptoPhotonic UI rendering, canvas animation, layout, replay controls, or StockPhotonic behavior is changed.

## Solana-First Strategy

- Keep Solana as the first live-data target because current fixtures and adapters already normalize Solana-shaped wallet, SPL token, entity hub, and swap-like transaction records.
- Preserve offline fixture loading as the default mode for local development, demos, and visual QA.
- Treat all public sample data under `data/crypto/` as synthetic, dev-only, and safe to ship without secrets.
- Add live ingestion only after a backend/proxy or local-only secure runner can protect provider credentials and enforce request policy.

## Real Data Pipeline

The live-data path must preserve the current graph model:

`Input -> Adapter -> Graph -> UI -> Replay`

- Input: a secure runtime receives an allowed request such as one public wallet address or an approved transaction signature list, then calls external Solana providers. The browser never calls Helius, private Solana RPC URLs, or secret-backed Jupiter endpoints directly.
- Adapter: `js/crypto/solanaAdapter.js` remains the boundary that normalizes provider payloads into CryptoPhotonic dataset records with `metadata`, `wallets`, `tokens`, `entities`, and `transactions`.
- Graph: the normalized dataset continues through `CryptoPhotonic.core.normalizeDataset()` and `CryptoPhotonic.graph.buildGraph()` with no graph contract changes.
- UI: existing CryptoPhotonic rendering consumes graph nodes and edges exactly as it does for fixtures. No live-data-specific rendering path is required for the first milestone.
- Replay: normalized transactions become flow edges. `buildFlowReplayPlan()` derives `flowReplay.ordered_flows` from those edges, so live records append to the same replay queue shape used by offline fixtures.

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

## Replay Integration

The animation system should reuse the existing flow replay path:

1. Secure runtime returns sanitized Helius transaction payloads.
2. `solanaAdapter` maps each parsed transfer into CryptoPhotonic transaction records.
3. `graph.buildGraph()` turns transactions into flow edges.
4. `buildFlowReplayPlan()` sorts flow edges by timestamp and value into `flowReplay.ordered_flows`.
5. The current UI replay controls and flow pulse animation read `flowReplay.ordered_flows` and `activeFlowId`.

For later incremental live updates, a sanitized transaction batch should be normalized, deduplicated by `transaction_hash` plus transfer index, merged into the current dataset, and rebuilt into graph/replay state. New transactions append to the replay queue according to the existing timestamp sort. No new animation primitives are needed for the first live milestone.

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
- Add request filtering for wallet addresses, signatures, pagination, date windows, response size, and provider endpoints.
- Sanitize live responses before they reach CryptoPhotonic UI code.
- Add merge/dedupe behavior for recent transactions before realtime append.
- Preserve offline fixtures as the fallback and test baseline.
- Add tests that verify no keys appear in HTML, public JavaScript, or JSON fixtures.
- Add tests that adapter output still builds graph nodes, flow edges, hub label edges when supplied, and replay ordering without UI changes.
