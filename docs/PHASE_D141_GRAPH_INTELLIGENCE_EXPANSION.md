# Phase D141 - Graph Intelligence Expansion

## Scope

D141 adds graph-native relationship storytelling to the static StockPhotonic graph without changing production data, CryptoPhotonic, backend behavior, or the candidate promotion workflow.

## Added Graph-Native Systems

- Compact graph explorer dock inside the StockPhotonic canvas.
- Ecosystem overlays for AI infrastructure, semiconductor chain, cloud/hyperscaler, financial/payments, energy infrastructure, healthcare/biotech, and enterprise SaaS/workflow.
- Source coverage lens for SEC-backed, sourced, candidate preview, stale review, and pending evidence states.
- Selected-company intelligence card with hub/bridge/corridor role, dominant ecosystem, cluster size, average edge strength, and sourced ratio.
- Production relationship click targeting with a compact "Why Connected?" card.
- Route tracing for strongest path, shared exposure, hidden links, supply chain, SEC-backed, portfolio exposure, and selected ecosystem routes.
- Canvas-native node/link emphasis for routes, overlays, selected relationships, source coverage, hubs, bridges, clusters, and corridors.

## Derivation Rules

Ecosystem overlays are derived from existing static relationship metadata only:

- normalized relationship type
- raw edge type
- edge label, provenance, summary, source label, and evidence snippet
- endpoint sector, industry, and derived industry group

No overlay creates a new supplier, customer, partnership, or ownership claim. If an edge lacks direct evidence, the source coverage lens keeps it labeled as pending rather than upgrading the claim.

## Route Tracing

Routes are visual traversal aids, not new data. They use visible graph edges under current filters:

- Strongest route greedily follows high-strength visible edges.
- Shared exposure route uses existing shared-neighbor intelligence.
- Supply chain route follows supply-group and semiconductor/power relationship metadata.
- SEC-backed route follows promoted SEC-backed production edges.
- Portfolio route follows portfolio-highlighted edges after a portfolio is analyzed.
- Ecosystem route follows the active or dominant selected-company overlay.

## Cluster Storytelling

Selected-company cards summarize:

- role: hub, bridge, corridor, sparse, or normal network node
- dominant direct relationship category
- strongest ecosystem
- related cluster member count
- strongest cluster hub
- sourced/SEC-backed/missing/stale edge coverage

Cluster and role labels are graph descriptors derived from degree, sector reach, relationship metadata, and existing cluster helpers. They are not business claims.

## UX Notes

The graph-first layer reduces sidebar dependence:

- The canvas dock handles overlays and evidence lens toggles.
- The compact card sits adjacent to the graph and avoids modal interruptions.
- Node and edge highlights are drawn on the canvas instead of creating per-node DOM overlays.
- Mobile rules keep overlay buttons horizontally scrollable and keep intelligence cards above the touch controls.

## Scaling Direction

The implementation keeps state as sets/maps and draws on canvas. Future larger-graph work should move more role and ecosystem calculations into precomputed visible-graph indexes, then reuse the same render hooks.
