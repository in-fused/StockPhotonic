# CryptoPhotonic Live-Data Readiness Plan

CryptoPhotonic remains an offline, fixture-driven Solana-first graph renderer until a secure runtime exists for live-data access. This plan defines the boundary for future Helius, Solana, and Jupiter integration without adding credentials, live requests, backend code, or production data claims.

## Solana-First Strategy

- Keep Solana as the first live-data target because current fixtures and adapters already normalize Solana-shaped wallet, SPL token, entity hub, and swap-like transaction records.
- Preserve offline fixture loading as the default mode for local development, demos, and visual QA.
- Treat all public sample data under `data/crypto/` as synthetic, dev-only, and safe to ship without secrets.
- Add live ingestion only after a backend/proxy or local-only secure runner can protect provider credentials and enforce request policy.

## Target Integrations

### Helius Enhanced Transactions

- Future purpose: normalize enriched Solana transaction payloads into CryptoPhotonic wallets, tokens, entity hubs, transaction flows, and route context.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime that owns `HELIUS_API_KEY`, validates requested signatures or wallet scopes, calls Helius, and returns sanitized graph-ready records.

### Helius WebSocket / Realtime

- Future purpose: stream updates for watched wallets, hubs, or Solana programs into the graph.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime that owns realtime credentials or RPC URLs, manages subscriptions server-side or inside a local secure runner, and forwards only sanitized events to the browser.

### Jupiter Route / Swap Context

- Future purpose: annotate swap-like transaction flows with route, quote, pool, and token context.
- Current status: disabled adapter planning stub only.
- Required before live use: secure runtime for any live route or quote requests, plus explicit separation from signing or swap execution. Browser public code must not execute swaps or hold signing material.

## Secure Configuration Boundaries

- Browser public code must never contain API keys, bearer tokens, private RPC URLs, signing keys, wallet private keys, or secret-manager access.
- API keys must remain in local environment variables or a managed secret store.
- `index.html`, public JavaScript, and JSON fixtures must not include real provider keys or private URLs.
- Live Helius, Solana RPC/WebSocket, and Jupiter calls require a future backend/proxy or local-only secure runner before enablement.
- No browser-side secret loading is implemented in this phase.
- No live blockchain fetching, WebSocket subscription, swap request, transaction signing, or backend/server code is implemented in this phase.

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
- Sanitize live responses before they reach CryptoPhotonic UI code.
- Preserve offline fixtures as the fallback and test baseline.
- Add tests that verify no keys appear in HTML, public JavaScript, or JSON fixtures.
