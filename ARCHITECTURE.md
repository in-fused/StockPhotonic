# CURRENT SYSTEM STATE

Document: StockPhotonic Architecture. StockPhotonic is a static browser app. `index.html` hosts the UI shell; modular JavaScript under `js/` handles data loading, graph rendering, intelligence, controls, and sidebar/dashboard rendering.

- Graph Intelligence (2D): Canvas graph using the production static dataset with filtering, search, layout modes, focus/threshold controls, relationship taxonomy filters, confidence/source/review filters, portfolio exposure, SEC visibility, cluster intelligence, shared exposure, hidden relationship hints, industry correlations, ecosystem overlays, route tracing, source coverage lens, guided discovery, active graph legend, graph-adjacent intelligence cards, and production edge "Why Connected?" inspection.
- 3D Network capabilities: Three.js production graph with camera controls, labels, SEC emphasis, sector/type filters, neighborhood depth, search, details panel, and fullscreen mode.
- Source Workbench pipeline: Static UI tab documenting local SEC commands, candidate files, workflow stages, candidate preview status, candidate-company expansion batches, promotion planner readiness, generated triage/overlap artifacts, source coverage refresh state, source registry governance, OpenAlex context artifacts, corridor lanes, and graph growth metrics when present.
- SEC ingestion + candidate system: Python scripts under `scripts/` handle local SEC cache/fetch/inspect/report/candidate workflows and keep staging output under `data/candidates/`.
- Scheduled review orchestration: GitHub Actions and local Python wrappers refresh review-only SEC, OpenAlex, preflight, source coverage, and pipeline summary artifacts without commits or production graph writes.
- OpenAlex intelligence layer: Script-side cache-first enrichment for ecosystem/topic/institution/cluster hints. It never runs in the browser and never proves or promotes relationships.
- Source registry governance: Reviewer-owned registry artifacts under `data/source_registry/` track official SEC roots, trusted host visibility, corridor maintenance, universe expansion readiness, strategic hubs, graph scaling state, and OpenAlex safety.
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
    source_registry/          # Reviewer-owned source governance artifacts
    cache/sec/                # Local SEC cache artifacts
    cache/openalex/           # Local OpenAlex entity/topic cache, ignored by git
  js/
    core/                     # Dataset loading and normalization
    graph/                    # 2D render/viewport/layout plus 3D view
    intelligence/             # Clusters, correlations, portfolio nexus
    stock/                    # StockPhotonic registry, relationship, graph scaling, evidence/trust helpers
    ui/                       # Controls, dashboard, search, sidebar
    utils/                    # DOM, formatting, math helpers
  scripts/                    # Local ingestion, candidate, promotion, validation tools
  docs/                       # Supporting source registry/refactor notes
```

## GRAPH SYSTEM

2D Graph Intelligence is the default exploration surface. It renders production nodes and edges, applies visible graph filters, supports focus and signal-threshold pruning, and derives dashboard/sidebar intelligence from existing data only.

The StockPhotonic relationship intelligence layer lives in `js/stock/evidencePolicy.js`, `js/stock/relationships.js`, `js/stock/sourceReview.js`, and `js/stock/graphIntelligence.js`. It normalizes existing edge fields at runtime into additive metadata such as `relationship_type`, `confidence_tier`, `evidence_count`, `source_status`, `source_age_key`, `source_host_categories`, `evidence_tier`, `trusted_relationship_class`, `reviewer_decision_state`, and `relationship_summary`, then derives graph-native overlays, guided discovery flows, active-state summaries, route traces, node roles, cluster summaries, evidence gaps, and compact relationship explanations. These derived fields do not create new relationship claims; missing evidence is surfaced as pending unless a safe public class qualifies for strong-inferred graph visibility.

D141/D142 graph overlays and guides are read-only visual interpretations of existing static metadata. AI infrastructure, semiconductor chain, cloud/hyperscaler, payments, energy, healthcare, and enterprise SaaS overlays match edge type, edge label/provenance/summary, and endpoint sector/industry-group metadata. Guided discovery reuses these overlays plus visible hub, source-backed, evidence-gap, and portfolio-exposure derivations. Route tracing follows visible graph edges only and never creates production data.

D145 caches ecosystem match results and visible route indexes so larger source-backed graphs can trace strongest, source-backed, supply-chain, portfolio, and ecosystem routes without repeated full recomputation. Strategic hub intelligence identifies hubs, bridges, corridor companies, repeated exposure hubs, and cross-sector anchors from visible production edges. The canvas renderer uses density-aware edge and label throttles to reduce visual noise while preserving selected, hovered, route, guided, overlay, source-lens, and portfolio emphasis.

D146 adds `js/stock/sourceRegistry.js` and `js/stock/graphScaling.js`. D147 adds `js/stock/universeExpansion.js` for review-only candidate-company preview helpers. D148 adds `js/stock/promotionPlanner.js` for deterministic readiness scoring, reviewer-state workflow display, batch comparison, and graph-impact simulation. Source registry helpers classify URL governance categories without promoting trust. Graph scaling helpers precompute density buckets, hub summaries, corridor buckets, route-cache summaries, candidate preview density state, growth forecasts, and label-priority seeds for large-graph readability. Strategic hub scoring exposes corridor centrality, ecosystem breadth, source-backed hub quality, bridge significance, and repeated exposure.

3D Network is an alternate production-network view powered by Three.js. It uses the same production graph and adds spatial exploration, relationship filtering, SEC emphasis, neighborhood expansion, and selected-item inspection without changing data.

## UI LAYERS

- App tabs: Graph Intelligence, Source Workbench, 3D Network.
- Graph controls: sector, industry group, relationship type, confidence tier, evidence tier, source-host category, sourced-only, SEC-backed-only, stale-review, candidate-preview, candidate-company preview, candidate density, candidate ecosystem/corridor focus, missing-evidence, portfolio-connected, cross-sector, layout, search, focus, threshold, orbit, portfolio input, SEC preview visibility, guided discovery dock, ecosystem overlay dock, active graph legend, evidence/source coverage lens, guided traversal, and route tracing.
- Sidebar/dashboard: selected company investigation workspace, relationship evidence cards, evidence review queue, relationship timeline context, connection rows, SEC evidence cues, source/confidence/freshness/host-diversity summaries, nexus view, shared exposure, hidden relationships, cluster context, portfolio exposure, trust summary.
- Source Workbench: command reference, evidence-state contract, source aging/host-category rules, pipeline overview, candidate file list, recommended local workflow, grouped SEC candidate review snapshot, candidate-company preview center, promotion planner console, expansion batch cards, triage metric cards, checklist status, candidate-vs-production overlap comparison, optional data expansion preflight report display, graph-growth simulation cards, and source governance console.
- Scheduled review artifacts: Source Workbench can also display review pipeline timestamps, OpenAlex enrichment summaries, source coverage refresh queues, and missing-artifact fallback states.

CSS ownership is split by layer. Shared shell styles live in `css/shell.css`, graph/fullscreen styles in `css/graph.css`, StockPhotonic styles in `css/stock.css`, CryptoPhotonic styles in `css/crypto.css`, review/source styles in `css/review.css`, and responsive overrides in `css/mobile.css`. Do not use `css/crypto.css` as a shared catch-all.

## REVIEW AND TRUST DISPLAY

Evidence review UI is static-browser only. It reads production JSON and candidate JSON served by the local static server, then derives:

- Tiered evidence policy: `VERIFIED`, `STRONG_INFERRED`, `CONTEXT_ONLY`, and `NEEDS_REVIEW`.
- Trusted relationship classes for competitor, ecosystem overlap, supplier ecosystem, cloud/hyperscaler exposure, semiconductor supply chain, and financial infrastructure overlap.
- Reviewer decision states: `accepted_for_visibility`, `accepted_for_review`, `blocked`, `weak_signal`, `enrichment_only`, and `ready_for_promotion_review`.
- Evidence aging from existing verified or filing dates.
- Source-host categories from URL host/path patterns.
- Review queue groups for low confidence, missing source, stale review, candidate preview, and SEC preview.
- Trust panels showing confidence tier, evidence count, source diversity, freshness, SEC-backed state, candidate/preview state, and missing-evidence warnings.
- Optional triage artifacts showing candidate clusters, review priorities, overlap states, source quality, and checklist counts.

The graph renderer uses these same derived fields to strengthen verified edges, label strong-inferred public ecosystem/competitive edges, and soften context-only, stale, pending, candidate, or review-required edges. D147 candidate-company nodes are graph-preview surfaces only and use separate planning-anchor edges. No browser ingestion, backend code, provider calls, API keys, or automatic candidate promotion are part of this layer.

D142 adds `scripts/data_expansion_preflight.py` as a local-only review report helper. It reads production JSON and optional candidate/triage artifacts, then writes only `data/candidates/data_expansion_preflight_report.json` when explicitly requested. Source Workbench can display that static artifact if present. The helper reports production source coverage, high-value unsourced edges, relationship type gaps, candidate blockers, missing production-universe tickers, tiered evidence summaries, and fast-track source targets without network calls or production writes.

D148 adds `scripts/promotion_planner_report.py`, which reads production data plus candidate-company staging artifacts and writes only `data/candidates/promotion_planner_report.json` when explicitly run with `--write`. The report contains reviewer-state lifecycle summaries, production-readiness factors, promotion blockers, batch comparisons, source-readiness summaries, and graph-impact simulations. It guards production hashes and reports zero production writes.

D143 adds `scripts/source_coverage_refresh.py`, `scripts/openalex_enrichment.py`, and `scripts/review_artifact_refresh.py`. D144 extends source coverage refresh with `fast_track_source_targets`, `source_expansion_batches`, `hub_source_gaps`, and per-row evidence tier/reviewer state metadata. D145 expands this into source-backed corridor planning with `corridor_source_lanes`, `ecosystem_expansion_opportunities`, `source_backlog_visibility`, and `graph_growth_metrics`. D146 adds `scripts/source_registry_governance.py`, which writes reviewer-owned source registry and governance artifacts under `data/source_registry/` when explicitly run with `--write --sync-registry`. D148 extends the refresh plan with `scripts/promotion_planner_report.py`. These scripts generate review-only artifacts for reviewer queues, OpenAlex ecosystem/topic/institution/cluster hints, source coverage enrichment, source governance, universe expansion readiness, promotion planning, corridor maintenance, graph scaling, and pipeline refresh status. OpenAlex networking is disabled unless explicitly requested and is bounded by request/entity caps plus cache reuse. The app only reads generated JSON files; it does not call OpenAlex or SEC from the browser.

D145 also adds `scripts/d145_source_expand_graph.py` as a one-phase audit helper for the controlled production graph expansion. It enriches source URLs and appends duplicate-checked, source-backed production relationships, but it is not a browser ingestion path and does not consume OpenAlex or candidate rows as promotion authority.

## PIPELINE COMPONENTS

- Source registry and candidate validators define allowed source and relationship metadata.
- SEC scripts fetch/cache filings only when explicitly requested and properly identified.
- Candidate scripts generate review-only relationship records with short snippets, filing references, ticker-pairing metadata, and safe confidence hints.
- Triage scripts generate queue, summary, overlap, and checklist artifacts without production writes.
- OpenAlex scripts generate source-labeled context hints without production writes, relationship proof, or promotion authority.
- Source registry governance scripts generate official-source visibility, trusted-host inventories, universe expansion blockers, corridor queues, stale-source queues, and scaling reports without production writes.
- Scheduled workflow scripts refresh review artifacts and validate outputs, then upload artifacts only.
- Promotion preview classifies candidates before production writes.
- Manual promotion can write reviewed edges to `data/connections.json`.
- `scripts/validate_data.py` enforces production dataset integrity and validates candidate, triage, preflight, source coverage, source registry, OpenAlex, cache, and pipeline artifact shape when those review files exist.

## SEC CANDIDATE INTELLIGENCE

The SEC extraction layer is local-script only. `scripts/sec_filing_signals.py` and `scripts/sec_signal_report.py` detect explicit relationship phrases and attach extraction metadata, while `scripts/sec_signal_candidates_preview.py` resolves public-company mentions into review-only candidate records. False-positive guards block generic customer/supplier language, accounting-only contract wording, XBRL-dominated snippets, legal exhibit fragments, credit-facility noise, and negated relationship language.

`scripts/sec_candidate_triage.py` reads `data/candidates/sec_relationship_candidates.json` plus production companies/connections, then emits review artifacts. It clusters repeated pairs and evidence phrases, derives source-host category and source-diversity counts, compares candidates to existing production relationships, identifies production edges missing source URLs, and assigns reviewer action labels. The labels are not executable actions.
