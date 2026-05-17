# D145 Mega Graph Expansion

## Purpose

D145 is a controlled large-scale source expansion and ecosystem growth phase for StockPhotonic. It expands production graph density, source-backed coverage, corridor visibility, and large-graph intelligence while preserving the static dataset, manual promotion workflow, and OpenAlex context-only boundary.

## Production Graph Expansion

- Production connections increased from 121 to 134.
- Existing unsourced production edges were source-refreshed with SEC filings, official company pages, investor-relations pages, or official partner/customer pages.
- Added production edges are source-backed and duplicate-checked by unordered endpoint pair plus relationship type.
- No candidate row, OpenAlex hint, or browser-side signal was auto-promoted.

## Source Expansion Lanes

`scripts/d145_source_expand_graph.py` records the D145 source-backed expansion pass. It:

- enriches existing production source gaps with real URLs only;
- adds reviewed source-backed edges for major AI infrastructure, enterprise SaaS, payments, and healthcare adjacency;
- validates URL shape;
- rejects duplicate production edge keys;
- preserves candidate -> preview -> manual promotion for future candidate data.

`scripts/source_coverage_refresh.py` now also reports production corridor lanes after source coverage is cleared:

- AI compute -> foundry -> cloud
- Payment network -> banks
- PBM -> pharma -> insurance
- Oilfield services -> energy majors
- Aerospace suppliers -> OEMs
- Enterprise SaaS -> cloud platforms
- Retail -> consumer distribution

These lanes are review-only orchestration signals. They do not create relationships or authorize promotion.

## Strategic Hubs

`js/stock/graphIntelligence.js` now identifies strategic hubs, ecosystem bridges, corridor companies, repeated exposure hubs, and cross-sector anchors from the loaded production graph. Seeded strategic anchors include NVDA, MSFT, AMZN, AVGO, JPM, XOM, LLY, GOOGL, AAPL, and TSM.

Hub explanations are graph-native and compact: selected-node cards explain why the company matters using degree, ecosystem count, source-backed ratio, sector reach, and corridor participation.

## Corridor Logic

Ecosystem overlays and route tracing remain derived from static metadata:

- edge type and relationship label;
- endpoint sector and industry group;
- source/evidence state;
- visible graph filters.

Route tracing uses cached visible-edge indexes for strongest, source-backed, supply-chain, portfolio, and ecosystem routes. It never creates hidden data or browser-ingested relationships.

## OpenAlex Boundary

OpenAlex enrichment was broadened for enterprise SaaS/workflow, aerospace/defense supply chain, and consumer/retail platform context. Generated records now include density, sector-overlap, and institution-adjacency hints.

OpenAlex remains `CONTEXT_ONLY`:

- `relationship_claim_created: false`
- `review_only: true`
- no production writes
- no promotion authority

## Density Safety

Large-graph rendering now uses density-aware edge and label behavior:

- weak-edge thresholds rise when the visible graph is dense;
- non-emphasized edges are softened in dense views;
- labels are throttled more aggressively when density is high;
- selected, hovered, route, guided, overlay, source-lens, and portfolio emphasis is preserved.

## Scaling Rules

- Keep production data static in `data/companies.json` and `data/connections.json`.
- Use source-backed production edits only when evidence is real and reviewable.
- Keep fast-track source coverage as review-only planning, not promotion.
- Keep corridor lanes as reviewer orchestration, not data creation.
- Keep OpenAlex cache-first and context-only.
- Preserve the D139 CSS ownership split.
- Validate JS and Python after graph intelligence or script changes.

## Future Direction

The next large graph phase should add a reviewer-owned source registry and corridor maintenance workflow: source aging by corridor, official URL host validation, lane-level checklist exports, and optional large-graph layout precomputation. It should still avoid browser ingestion and automatic promotion.
