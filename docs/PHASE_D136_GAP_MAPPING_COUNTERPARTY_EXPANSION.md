# Phase D136 - Gap Mapping and Counterparty Expansion

D136 turns CryptoPhotonic Replay Workspace into a gap-aware staged investigation surface. It does not change StockPhotonic behavior, does not merge staged replay/history into Wallet Lookup, and does not add browser-side provider calls.

## Replay Gap Mapping

Replay gap maps are explicit staged-window metadata and UI overlays. They can represent:

- rate-limited replay continuation
- provider-limited windows
- cursor ambiguity or cursor stalls
- missing timestamp boundaries
- missing-window risk outside loaded staged pages
- replay-order reconstruction requirements
- ambiguous provider exhaustion

Gap markers are visible in the Replay Workspace timeline and in the replay canvas. They indicate uncertainty, not proof that a specific transfer is missing.

## Continuity Confidence

Replay continuity confidence is a staged-continuity score. It is shown per replay window and degraded by gap impact, provider limits, rate limits, cursor ambiguity, missing timestamps, partial windows, and oldest-first reconstruction requirements.

Labels intentionally describe staged continuity only:

- High staged continuity
- Partial staged continuity
- Ambiguous staged continuity
- Provider-limited continuity

The UI must not present this as proven full-history continuity.

## Replay Neighborhoods

Replay neighborhoods are bounded, temporary expansions derived only from staged replay rows. Available actions include:

- Expand Around This Wallet
- Expand Related Counterparties
- Expand Same Route
- Expand Same Token Neighborhood
- Expand Current Replay Cluster
- Collapse Neighborhood

Neighborhood expansion highlights local replay-only context in the replay canvas and side panel. It does not modify the active Wallet Lookup graph.

## Replay Clusters

Lightweight clusters are derived from repeated staged observations:

- repeated counterparty clusters
- repeated token clusters
- repeated route clusters
- dense time hotspots

Clusters are address/route/token observations only. They are not identity, ownership, risk, or criminality assertions.

## Recursive Replay Exploration

D136 adds staged continuation helpers:

- Continue Along Route
- Follow Outbound Chain
- Follow Inbound Chain
- Continue Token Path

These helpers first search the current staged replay window. If no matching staged event is visible and an older staged window can be loaded, the UI can continue into that staged window while preserving uncertainty messaging. A missing staged match never proves that a chain ends.

## Scaling Safeguards

Replay investigation state is capped:

- replay windows remain cached with a small LRU-style cache
- neighborhood event lists are capped
- cluster lists and cluster members are capped
- replay graph nodes, edges, transactions, and particles remain capped by the existing preview renderer/animator limits
- replay audit breadcrumbs and recent steps are pruned

These limits prevent recursive graph growth and keep mobile replay usable.

## Future Archive-Grade Goals

Future phases should move toward server-side archive-grade continuity proofs:

- durable gap-map indexing per scan
- verified cursor exhaustion with provider-contract evidence
- replay window backfill planning
- checkpoint import/export with gap context
- stronger oldest-first reconstruction validation

Those goals still must preserve Worker-only provider authority, preview-only replay, staged-history-only boundaries, and the active Wallet Lookup graph isolation.
