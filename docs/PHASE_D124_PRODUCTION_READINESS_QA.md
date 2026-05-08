# Phase D124 Production Readiness QA

Date: 2026-05-08

## Desktop Checks

- StockPhotonic loads the default graph, interaction dock, fullscreen graph control, help control, focus control, perspective control, and orb control without CryptoPhotonic style regressions.
- CryptoPhotonic loads Generated Fixture mode with readable Data Source / Mode, Flow Filters, Playback / Motion, Investigation Workspace tabs, Details, Replay, and Interaction Dock panels.
- CryptoPhotonic desktop graph labels remain readable at Balanced density, with hover/focus details available and no horizontal page overflow.
- Replay Workspace remains preview-only: it uses the separate history workspace canvas and does not merge staged history into the active Wallet Lookup graph.

## Mobile Checks

- StockPhotonic graph, dock, and fullscreen controls remain usable with the fixed bottom dock.
- CryptoPhotonic graph supports touch pan/zoom, fullscreen, label density cycling, selected-object summaries, and the bottom investigation drawer.
- The mobile investigation drawer must not overlap the fixed dock; collapsed mode should show only the handle and selected object headline.
- Details and Replay tabs must wrap long wallet addresses, signatures, token mints, and status messages without horizontal overflow.

## Worker Endpoint Checks

- Wallet Lookup must call only the configured Worker wallet-activity endpoint and replace the active graph with the Worker response.
- Live Feed must call only the configured Worker feed endpoint and show sanitized Worker events.
- History pagination must stay staged through the Worker wallet-history endpoint; staged pages must not merge into the active graph.
- Replay must remain preview-only, using staged history artifacts and the separate preview canvas/workspace.

## Environment Reminders

- Do not place provider secrets, API keys, bearer tokens, private RPC URLs, or signing material in browser files.
- Configure provider credentials only in the Worker/runtime secret store.
- Verify `CryptoPhotonicWorkerFeedEndpoint`, `CryptoPhotonicWorkerWalletActivityEndpoint`, and any wallet-history endpoint before deployment.
- Confirm Worker CORS, rate limiting, response-size limits, cache status, and sanitized payload fields before enabling production traffic.
