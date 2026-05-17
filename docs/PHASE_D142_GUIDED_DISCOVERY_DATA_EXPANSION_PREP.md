# Phase D142 - Guided Discovery UX + Data Expansion Prep

## Scope

D142 turns D141 graph intelligence into a guided StockPhotonic experience without changing production data, CryptoPhotonic, backend behavior, or the candidate promotion workflow.

## Guided Discovery Mode

The StockPhotonic graph explorer dock now includes compact guide buttons:

- Start with AI Infrastructure
- Explore Semiconductor Chain
- Find Strongest Hubs
- Follow Source-Backed Relationships
- Review Evidence Gaps
- Explore Portfolio Exposure

Each guide is graph-native. It highlights visible nodes and edges using cached node/link key sets derived from the current visible graph. Ecosystem guides reuse D141 overlay matching. Source and evidence-gap guides use source coverage state. Portfolio discovery only activates meaningful highlights after the user analyzes portfolio tickers.

Guides are visual traversal aids only. They do not create relationship claims, write data, ingest sources, or promote candidates.

## Active Graph Legend

The canvas now has a compact active-state legend showing:

- active guide
- active ecosystem overlay
- active relationship route
- source coverage lens state
- selected company
- selected relationship
- active filter count
- color meanings for SEC-backed, sourced, pending, route, and selected emphasis

This keeps graph state visible without opening documentation or reading the side panel.

## Relationship Explanation Cards

"Why Connected?" cards now separate:

- direct edge summary
- relationship type meaning
- source/confidence explanation
- overlay or route context when active
- next exploration actions for endpoint selection, strongest route, and source lens

These explanations remain generic and source-aware. Missing evidence stays labeled as pending, and the UI does not infer supplier, customer, partnership, or ownership details beyond the loaded edge metadata.

## Ecosystem Discovery Flow

Ecosystem overlay cards now show:

- overlay description
- visible node and edge counts
- SEC-backed and sourced coverage
- top hubs inside the overlay
- strongest relationship categories
- "Follow Ecosystem" route action

Overlay membership is derived from relationship type, raw edge type, labels, provenance, source labels, evidence snippets, endpoint sector, and derived industry group.

## Evidence Gap Discovery

The source coverage model now derives a production-wide evidence-gap summary:

- total production edge count
- sourced ratio
- SEC-backed edge count
- stale review count
- candidate preview count
- high-value unsourced production edges
- relationship type source gaps

The Evidence Gaps guide ranks visible unsourced edges by strength, confidence, and endpoint graph degree. The Source Coverage card also links to gap review and Source Workbench.

## Data Expansion Preflight Report

`scripts/data_expansion_preflight.py` is a local-only report helper. It reads:

- `data/companies.json`
- `data/connections.json`
- optional SEC candidate records
- optional reviewer triage artifacts

It writes only `data/candidates/data_expansion_preflight_report.json` when `--write` is passed. The artifact is review-only, reports zero network calls, and does not mutate production graph data.

The report includes:

- production edge source coverage
- high-value unsourced production edges
- relationship types with missing source URLs
- candidate promotion blockers
- candidate tickers missing from the production universe
- data expansion priority rows

## Source Workbench Readiness

Source Workbench now displays the preflight report when present and falls back gracefully when it is missing. The browser only fetches the static JSON artifact. It does not execute scripts, call APIs, ingest sources, or write files.

## Mobile

Mobile graph use now keeps:

- guide dock horizontally scrollable
- active legend compact and scroll-safe
- graph intelligence card readable above touch controls
- route actions horizontally scrollable
- Source Workbench preflight panels single-column

Fullscreen remains usable with guide, legend, and card overlays positioned inside the graph stage.

## Scaling Notes

D142 keeps guide, default highlight, evidence-gap, and overlay membership as derived sets recomputed on graph state changes, not every canvas frame. The renderer receives cached visual metadata through existing node/link visual caches. Default cluster anchor checks are capped to high-degree candidates to avoid broad cluster recomputation as the graph grows.

Future larger-graph work should precompute source coverage, ecosystem membership, top hubs, bridge nodes, and type gap indexes during load or as static artifacts.
