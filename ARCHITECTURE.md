# CURRENT SYSTEM STATE

Document: StockPhotonic Architecture. StockPhotonic is a static browser app. `index.html` hosts the UI shell; modular JavaScript under `js/` handles data loading, graph rendering, intelligence, controls, and sidebar/dashboard rendering.

- Graph Intelligence (2D): Canvas graph using the production static dataset with filtering, search, layout modes, focus/threshold controls, relationship taxonomy filters, confidence/source filters, portfolio exposure, SEC visibility, cluster intelligence, shared exposure, hidden relationship hints, and industry correlations.
- 3D Network capabilities: Three.js production graph with camera controls, labels, SEC emphasis, sector/type filters, neighborhood depth, search, details panel, and fullscreen mode.
- Source Workbench pipeline: Static UI tab documenting local SEC commands, candidate files, workflow stages, and candidate preview status.
- SEC ingestion + candidate system: Python scripts under `scripts/` handle local SEC cache/fetch/inspect/report/candidate workflows and keep staging output under `data/candidates/`.
- Promotion + validation flow: Candidate data is previewed and manually promoted into production JSON, then validated before use.

## CORE RULES

- No fake data.
- No automatic production writes.
- Candidate -> preview -> manual promotion only.
- No backend in the current app.
- Static production JSON is the source of truth.

## FILE STRUCTURE OVERVIEW

```text
StockPhotonic/
  index.html                  # Static app shell and tab structure
  data/
    companies.json            # Production companies
    connections.json          # Production connections
    candidates/               # Review-only staging data
    cache/sec/                # Local SEC cache artifacts
  js/
    core/                     # Dataset loading and normalization
    graph/                    # 2D render/viewport/layout plus 3D view
    intelligence/             # Clusters, correlations, portfolio nexus
    stock/                    # StockPhotonic relationship taxonomy/evidence helpers
    ui/                       # Controls, dashboard, search, sidebar
    utils/                    # DOM, formatting, math helpers
  scripts/                    # Local ingestion, candidate, promotion, validation tools
  docs/                       # Supporting source registry/refactor notes
```

## GRAPH SYSTEM

2D Graph Intelligence is the default exploration surface. It renders production nodes and edges, applies visible graph filters, supports focus and signal-threshold pruning, and derives dashboard/sidebar intelligence from existing data only.

The StockPhotonic relationship intelligence layer lives in `js/stock/relationships.js`. It normalizes existing edge fields at runtime into additive metadata such as `relationship_type`, `confidence_tier`, `evidence_count`, `source_status`, and `relationship_summary`. These derived fields do not create new relationship claims; missing evidence is surfaced as pending.

3D Network is an alternate production-network view powered by Three.js. It uses the same production graph and adds spatial exploration, relationship filtering, SEC emphasis, neighborhood expansion, and selected-item inspection without changing data.

## UI LAYERS

- App tabs: Graph Intelligence, Source Workbench, 3D Network.
- Graph controls: sector, industry group, relationship type, confidence tier, sourced-only, SEC-backed-only, portfolio-connected, cross-sector, layout, search, focus, threshold, orbit, portfolio input, SEC preview visibility.
- Sidebar/dashboard: selected company investigation workspace, relationship evidence cards, connection rows, SEC evidence cues, source/confidence summaries, nexus view, shared exposure, hidden relationships, cluster context, portfolio exposure, trust summary.
- Source Workbench: command reference, evidence-state contract, pipeline overview, candidate file list, recommended local workflow, and static candidate preview table.

## PIPELINE COMPONENTS

- Source registry and candidate validators define allowed source and relationship metadata.
- SEC scripts fetch/cache filings only when explicitly requested and properly identified.
- Candidate scripts generate review-only relationship records.
- Promotion preview classifies candidates before production writes.
- Manual promotion can write reviewed edges to `data/connections.json`.
- `scripts/validate_data.py` enforces production dataset integrity.
