# CURRENT SYSTEM STATE

Document: StockPhotonic Architecture. StockPhotonic is a static browser app. `index.html` hosts the UI shell; modular JavaScript under `js/` handles data loading, graph rendering, intelligence, controls, and sidebar/dashboard rendering.

- Graph Intelligence (2D): Canvas graph using the production static dataset with filtering, search, layout modes, focus/threshold controls, relationship taxonomy filters, confidence/source/review filters, portfolio exposure, SEC visibility, cluster intelligence, shared exposure, hidden relationship hints, industry correlations, ecosystem overlays, route tracing, source coverage lens, graph-adjacent intelligence cards, and production edge "Why Connected?" inspection.
- 3D Network capabilities: Three.js production graph with camera controls, labels, SEC emphasis, sector/type filters, neighborhood depth, search, details panel, and fullscreen mode.
- Source Workbench pipeline: Static UI tab documenting local SEC commands, candidate files, workflow stages, candidate preview status, and generated triage/overlap artifacts when present.
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
  css/
    base.css                  # Fonts, tokens, reset, body defaults, scrollbars
    shell.css                 # Shared page chrome, product/app tabs, docks, help modal
    graph.css                 # Graph containers, canvases, overlays, fullscreen HUD
    stock.css                 # StockPhotonic controls, sidebar/workspace surfaces
    crypto.css                # CryptoPhotonic-only graph, wallet, replay, audit surfaces
    review.css                # Evidence review, trust/source chips, Source Workbench
    mobile.css                # Shared and product-specific responsive overrides
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

The StockPhotonic relationship intelligence layer lives in `js/stock/relationships.js`, `js/stock/sourceReview.js`, and `js/stock/graphIntelligence.js`. It normalizes existing edge fields at runtime into additive metadata such as `relationship_type`, `confidence_tier`, `evidence_count`, `source_status`, `source_age_key`, `source_host_categories`, and `relationship_summary`, then derives graph-native overlays, route traces, node roles, cluster summaries, and compact relationship explanations. These derived fields do not create new relationship claims; missing evidence is surfaced as pending.

D141 graph overlays are read-only visual interpretations of existing static metadata. AI infrastructure, semiconductor chain, cloud/hyperscaler, payments, energy, healthcare, and enterprise SaaS overlays match edge type, edge label/provenance/summary, and endpoint sector/industry-group metadata. Route tracing follows visible graph edges only and never creates production data.

3D Network is an alternate production-network view powered by Three.js. It uses the same production graph and adds spatial exploration, relationship filtering, SEC emphasis, neighborhood expansion, and selected-item inspection without changing data.

## UI LAYERS

- App tabs: Graph Intelligence, Source Workbench, 3D Network.
- Graph controls: sector, industry group, relationship type, confidence tier, source-host category, sourced-only, SEC-backed-only, stale-review, candidate-preview, missing-evidence, portfolio-connected, cross-sector, layout, search, focus, threshold, orbit, portfolio input, SEC preview visibility, ecosystem overlay dock, source coverage lens, guided traversal, and route tracing.
- Sidebar/dashboard: selected company investigation workspace, relationship evidence cards, evidence review queue, relationship timeline context, connection rows, SEC evidence cues, source/confidence/freshness/host-diversity summaries, nexus view, shared exposure, hidden relationships, cluster context, portfolio exposure, trust summary.
- Source Workbench: command reference, evidence-state contract, source aging/host-category rules, pipeline overview, candidate file list, recommended local workflow, grouped candidate review snapshot, static candidate preview table, triage metric cards, checklist status, and candidate-vs-production overlap comparison.

CSS ownership is split by layer. Shared shell styles live in `css/shell.css`, graph/fullscreen styles in `css/graph.css`, StockPhotonic styles in `css/stock.css`, CryptoPhotonic styles in `css/crypto.css`, review/source styles in `css/review.css`, and responsive overrides in `css/mobile.css`. Do not use `css/crypto.css` as a shared catch-all.

## REVIEW AND TRUST DISPLAY

Evidence review UI is static-browser only. It reads production JSON and candidate JSON served by the local static server, then derives:

- Evidence aging from existing verified or filing dates.
- Source-host categories from URL host/path patterns.
- Review queue groups for low confidence, missing source, stale review, candidate preview, and SEC preview.
- Trust panels showing confidence tier, evidence count, source diversity, freshness, SEC-backed state, candidate/preview state, and missing-evidence warnings.
- Optional triage artifacts showing candidate clusters, review priorities, overlap states, source quality, and checklist counts.

The graph renderer uses these same derived fields to strengthen sourced/high-confidence edges and soften stale, pending, candidate, or unsourced edges. No browser ingestion, backend code, provider calls, API keys, or automatic candidate promotion are part of this layer.

## PIPELINE COMPONENTS

- Source registry and candidate validators define allowed source and relationship metadata.
- SEC scripts fetch/cache filings only when explicitly requested and properly identified.
- Candidate scripts generate review-only relationship records with short snippets, filing references, ticker-pairing metadata, and safe confidence hints.
- Triage scripts generate queue, summary, overlap, and checklist artifacts without production writes.
- Promotion preview classifies candidates before production writes.
- Manual promotion can write reviewed edges to `data/connections.json`.
- `scripts/validate_data.py` enforces production dataset integrity and validates candidate/triage artifact shape when those review files exist.

## SEC CANDIDATE INTELLIGENCE

The SEC extraction layer is local-script only. `scripts/sec_filing_signals.py` and `scripts/sec_signal_report.py` detect explicit relationship phrases and attach extraction metadata, while `scripts/sec_signal_candidates_preview.py` resolves public-company mentions into review-only candidate records. False-positive guards block generic customer/supplier language, accounting-only contract wording, XBRL-dominated snippets, legal exhibit fragments, credit-facility noise, and negated relationship language.

`scripts/sec_candidate_triage.py` reads `data/candidates/sec_relationship_candidates.json` plus production companies/connections, then emits review artifacts. It clusters repeated pairs and evidence phrases, derives source-host category and source-diversity counts, compares candidates to existing production relationships, identifies production edges missing source URLs, and assigns reviewer action labels. The labels are not executable actions.
