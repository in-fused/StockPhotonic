# CURRENT SYSTEM STATE

Document: StockPhotonic Roadmap. StockPhotonic is a static photonic graph application using `data/companies.json` and `data/connections.json` as production source of truth.

- Graph Intelligence (2D): Current main work surface for exploring curated companies and edges with filters, search, relationship taxonomy, source/confidence/review filters, Focus Mode, signal thresholds, portfolio exposure, SEC-backed edge indicators, hub/nexus layouts, cluster intelligence, shared exposure, hidden relationship hints, industry correlations, ecosystem overlays, source coverage lens, analyst metadata layers, route tracing, route comparison, keyboard spatial traversal, guided discovery, active graph legend, large-graph navigation modes, adaptive HUD, embedded graph annotations, in-session investigation continuity, investigation queueing, graph timeline rails, session snapshots, scalable graph prep indexes, compact route/replay workspace continuity, and graph-native narrative cards.
- 3D Network capabilities: Three.js production-network view with orbiting camera, search, labels, filters, SEC emphasis, neighborhood depth, selected details, and fullscreen exploration.
- Source Workbench pipeline: Static, read-only guide and candidate preview surface for the local SEC workflow, candidate-company expansion batches, reviewed production expansion summaries, promotion planning, source coverage refresh, source registry governance, universe expansion readiness, corridor maintenance, graph-growth simulation, and OpenAlex safety summaries.
- SEC ingestion + candidate system: Local scripts support SEC fetch/cache, filing inspection, signal extraction, candidate preview, candidate writing, job manifests, schedule previews, and policy gates.
- Scheduled review orchestration: Local/GitHub Actions review pipelines refresh SEC, OpenAlex, source coverage, preflight, and pipeline summary artifacts without production writes.
- OpenAlex intelligence layer: Cache-first enrichment for ecosystem, topic, institution, and cluster hints. It is review-only context, not relationship proof.
- Source registry governance: Reviewer-owned source registry artifacts track official SEC roots, trusted hosts, source aging, duplicate source reduction, universe blockers, corridor maintenance, graph scaling, and OpenAlex entity-resolution visibility.
- Tiered evidence policy: Graph and Source Workbench distinguish verified, strong-inferred, context-only, and needs-review relationships while keeping promotion manual.
- Promotion + validation flow: Source-backed candidates must pass preview, manual review, explicit promotion, and `scripts/validate_data.py` before production use. Reviewed production expansion manifests may add source-backed companies and explicitly listed source-backed edges.

## CORE RULES

- No fake data.
- No automatic production writes.
- Reviewed production expansion is allowed only from explicit approval manifests and validation gates.
- Candidate -> preview -> reviewer approval -> explicit writer -> validation only.
- No backend in the current app.
- Static production dataset is the source of truth.
- `data/source_registry/` is governance only and cannot create production companies or relationships.

## CURRENT FOCUS

- D161-D168 analyst spatial operating environment: improve massive graph readability, add reversible investigation execution workflows, deepen focus cinema, add density-gated analyst overlays, converge graph timeline/replay continuity, expand semantic intelligence layers, mature mobile graph OS ergonomics, and harden scalability/performance without backend, provider, ingestion, storage/auth, or production-data changes.
- UI/UX polish for the 2D Graph Intelligence workflow, especially guided discovery, default graph onboarding, active state comprehension, command-palette access, transient overlays, and mobile graph usability.
- Intelligence layer clarity: company investigation workspace, graph-adjacent storytelling cards, embedded route/corridor/hub annotations, why-connected relationship cards, source/confidence labels, hubs, bridges, corridors, clusters, shared exposure, hidden relationships, ecosystem overlays, active graph legend, route tracing, route comparison summaries, industry correlations, portfolio exposure, deterministic evidence-aware narratives, and SEC-backed edge visibility.
- Review layer clarity: evidence review queue, source aging labels, URL-derived source-host diversity, stale/pending indicators, candidate review grouping, candidate-company preview staging, promotion readiness tables, reviewer decision states, graph-impact simulations, expansion batch summaries, triage artifacts, candidate-vs-production overlap comparison, and data expansion preflight reporting.
- Trust layer clarity: trusted relationship classes, evidence tier filters, strong-inferred fast-track visibility, reviewer decision states, and OpenAlex context-only boundaries.
- CSS maintainability: keep the D139 split across `base.css`, `shell.css`, `graph.css`, `stock.css`, `crypto.css`, `review.css`, and `mobile.css`; do not return to a single shared catch-all stylesheet.
- 3D immersion and usability while staying tied to the production static dataset.
- Source coverage quality for existing high-value relationships.
- Validation discipline before any production data expansion.
- Source governance discipline for official URL lifecycle, trusted-host visibility, stale-source queues, corridor maintenance, and safe universe staging.

## NEXT MAJOR AREAS

- Data expansion through SEC-backed candidates and reviewed production expansion manifests, never automatic production writes.
- Broader source coverage from SEC filings, company disclosures, official pages, and reputable secondary sources when needed.
- Better review ergonomics for candidate evaluation, clustering, overlap reports, checklist exports, data expansion preflight, and promotion previews.
- Source coverage fast-track batches that target strong-inferred public relationships for enrichment without adding manual-promotion pressure.
- Scheduled review artifact refreshes that reduce manual triage burden while keeping artifacts review-only.
- OpenAlex enrichment cache quality, entity resolution accuracy, and reviewer-visible topic/institution context.
- Bounded live-refresh governance that keeps scheduled source intelligence review-only, cache-first, and rate-limited.
- Relationship evidence depth: short source snippets, filing references, source aging review queues, source-host diversity, and relationship-specific confidence explanations.
- Future open-data review workflow: source registry rules that pre-classify URL host categories, expose review aging thresholds, export reviewer checklists, and preserve candidate -> preview -> manual promotion.
- Open-data ownership/ETF overlap model after schema, source registry, and validation support exist.
- Optional backend/auth layer only after the static app and source workflow remain stable.
- Larger graph rendering/performance work as source-backed data grows, using D152 semantic zoom tiers, D153 cinematic focus/corridor systems, D154 route-comparison caches, D155-D160 viewport edge budgets, D161 readability budgets, label render queues, corridor-aware suppression, semantic fogging, label anchor caches, corridor lane indexes, route/comparison caches, semantic tile prep, replay chunk prep, minimap sampling plans, annotation throttles, animation budgets, source-backed corridor lanes, strategic hub summaries, Crypto topology prioritization, and D149 progressive-disclosure navigation modes.
- Controlled universe expansion engine that stages real public-company metadata, detects ticker/name conflicts, scores source readiness, and requires reviewer-owned ecosystem/corridor assignment before any future writer exists.

## D151 FOLLOW-ON

- Persist user-authored graph workspace state only after a storage/auth architecture is intentionally introduced.
- Completed in D152: semantic zoom tiers for macro, cluster, relationship, and inspection detail; zoom-aware label and edge budgets; richer stock minimap interaction; spatial breadcrumbs; and mode-sensitive Stock/Crypto graph detail.
- Add server-free precomputed layout snapshots for 1000+ node graphs if the static bundle size remains acceptable.
- Completed in D154: keyboard traversal for hubs, bridges, corridors, selected neighborhoods, active route nodes, and replay events after the semantic minimap and breadcrumb model were validated.
- Add reviewer-authored workspace annotations as review-only artifacts, not relationship proof or promotion authority.
- Keep Crypto liquidity topology improvements tied to reviewed local/static data and never browser-side provider ingestion.

## D152 FOLLOW-ON

- Completed in D153: cinematic viewport easing, selected-node focus bubble repulsion, reversible cluster breathing room, Stock corridor lane rendering, soft edge grouping, minimap corridor hints, compact spatial story cues, graph-native command navigation, Crypto flow corridors, and replay lane emphasis.
- Add optional precomputed semantic/cinematic tiles for very large static graphs so macro and cluster tiers can render without scanning every low-priority edge.
- Add reviewer-authored corridor notes as review-only overlays that never become relationship proof or promotion authority.
- Completed in D154: keyboard-driven spatial traversal for hubs, corridors, selected neighborhoods, and replay paths.
- Completed in D154: route comparison mode that can show two or more evidence-backed paths with shared edge bundling, divergence/convergence notes, and clear visual separation.
- Keep Crypto realtime or archive expansion behind Worker/server boundaries; the browser graph should continue to consume sanitized static or Worker-owned data only.

## D153 FOLLOW-ON

- Add persisted, review-only investigation workspaces after a storage/auth design exists; do not persist analyst notes as relationship proof.
- Completed in D154: route comparison with two or more simultaneously visible bundled paths, including shared-edge disambiguation and corridor-aware lane separation.
- Completed in D154: keyboard and command-palette traversal sequences for next hub, next bridge, next corridor, route endpoint, and current replay neighborhood.
- Add optional precomputed corridor lane indexes and label anchor snapshots once graph size makes per-frame lane grouping too expensive.
- Keep cinematic motion bounded, semantic-tier aware, and reversible; avoid force-simulation chaos or browser-side ingestion.

## D154 FOLLOW-ON

- Completed in D155-D160: graph-first workspace convergence, adaptive HUD, contextual inspector collapse, smaller route/replay workspaces, in-session route/corridor/hub pinning, replay checkpoints, embedded graph annotations, deterministic narrative summaries, bounded route/comparison/label/corridor/hub/semantic-tile prep caches, minimap/replay scaling prep, mobile graph OS compression, and disabled-by-default future overlay foundations.
- Add explicit user-selected route endpoints only after the current visible-route comparison model is validated with analysts.
- Promote optional static precomputed route, semantic tile, corridor lane, and label-anchor indexes only if production graph growth makes runtime derivation expensive.
- Add persisted investigation workspaces only after a storage/auth architecture exists; keep current workspace state in-session only.
- Add reviewer-authored corridor notes as review-only artifacts, not relationship proof or promotion authority.
- Keep route expansion tied to existing relationship metadata contracts and visible graph edges.

## D155-D160 FOLLOW-ON

- Completed in D161-D168: massive graph readability controller, adaptive edge thinning, semantic edge fading, corridor-aware suppression, intelligent label queues, node prominence scaling, semantic fogging, contextual edge reveal, bounded render queues, graph timeline rail, investigation queue rail, session snapshots, density-gated analyst overlays, semantic intelligence layers, mobile graph OS maturation, Crypto replay graph chronology, animation budgets, minimap sampling, annotation throttles, memory budgets, and progressive hydration prep.
- Validate the adaptive HUD, timeline rail, investigation rail, and embedded annotations with analysts before adding persisted workspace state.
- Keep ownership, ETF overlap, geopolitical, OpenAlex, institutional exposure, and liquidity overlays behind real schemas, source rules, validation, and performance budgets; D161-D168 analyst layers only use metadata already loaded in the browser.
- Add persisted analyst workspaces only after storage/auth is intentionally designed; current route, corridor, hub, queue, timeline, snapshot, and checkpoint memory remains reversible and session-only.
- Consider static precomputed semantic tiles, label anchors, route caches, readability queues, and corridor lane indexes once production graphs approach several hundred additional source-backed nodes.
- Keep mobile graph OS evolution focused on gesture-first immersion, compact graph-native rails, touch-safe minimap behavior, route/replay shortcuts, and graph visibility rather than desktop panel compression.

## D161-D168 FOLLOW-ON

- Validate readability budgets against future larger production graphs, especially edge suppression thresholds, label queue ordering, and corridor reveal behavior.
- Add user-selected route endpoints only after graph timeline and route comparison ergonomics are validated.
- Add reviewer-authored semantic layer notes as review-only artifacts, not relationship proof or promotion authority.
- Add precomputed readability and semantic-tile manifests only if runtime derivation becomes too expensive for static delivery.
- Keep any future persisted investigation workspace behind an explicit storage/auth architecture; the current queue, task stack, jump history, snapshots, and chronology are intentionally session-only.
- Continue Crypto replay convergence through Worker-owned sanitized replay data only; do not add browser-side provider ingestion.

## D141 FOLLOW-ON

- Precompute ecosystem and route indexes when the graph grows beyond the current static core.
- Add optional route target selection after the current guided routes are validated with users.
- Add reviewer-authored ecosystem notes only when they are source-backed and schema-validated.
- Expand route types only through existing metadata contracts, not browser ingestion.

## D142 FOLLOW-ON

- Precompute guided discovery indexes for larger datasets: top hubs, bridges, source-backed edges, evidence gaps, and ecosystem memberships.
- Add route target selection after guided discovery proves useful with reviewers.
- Expand Source Workbench promotion planning into reviewer-owned decision persistence and diff exports without automatic promotion.
- Add source-backed expansion batches only after preflight, candidate preview, manual review, promotion preview, and validation all pass.

## D143 FOLLOW-ON

- Add reviewer decisions to OpenAlex and source coverage artifact rows before any future promotion tooling consumes them.
- Improve deterministic ticker-to-OpenAlex entity mapping with reviewed aliases and blocked false-positive mappings.
- Add artifact aging/retention policy for stale OpenAlex cache entries and scheduled workflow artifacts.
- Add optional source registry joins for official company/IR URLs after they have validation rules.
- Keep larger-graph expansion behind candidate preview, manual review, promotion preview, and validation.

## D144 FOLLOW-ON

- Add reviewed source-registry joins for official company/IR source suggestions without fabricating URLs.
- Add tier-aware large-graph decluttering indexes before expanding beyond the current static core.
- Add reviewer-owned batch export for `fast_track_source_targets`, preserving review-only artifacts and manual promotion.
- Add optional strict validation for evidence tier fields after the policy stabilizes.
- Keep OpenAlex as `CONTEXT_ONLY` enrichment and never relationship proof.

## D145 FOLLOW-ON

- Completed in D146: reviewer-owned source registry, corridor maintenance queues, source-aging visibility, universe readiness reports, large-graph scaling summaries, and OpenAlex entity-resolution safety.
- Completed in D148: review-only promotion planner, reviewer decision workflow display, production-readiness scoring, batch promotion planning, graph-impact simulation, source-readiness summaries, staged hub scoring, and mobile-aware large-graph safety forecasts.
- Completed in D149: first reviewer-approved production company expansion, reviewed production expansion report, production expansion console, and large-graph navigation modes for ecosystem focus, corridor focus, neighborhood isolation, strategic hubs, route isolation, production-only, and preview-only.

## D149 FOLLOW-ON

- Add persistent reviewer decision artifacts for company-level production approval state.
- Add stricter source-registry joins for reviewer-approved official company roots before the next expansion.
- Add viewport-aware large-graph label budgets and an optional minimap once graph size approaches several hundred companies.
- Add route-target selection for corridor traversal after current route isolation is validated with reviewers.
- Keep future 1000+ company growth behind source-backed identity, duplicate/alias checks, explicit approval manifests, and validation.

## D150 FOLLOW-ON

- Add reviewer-authored decisions to live-refresh candidate queues without creating promotion authority.
- Add optional persistent GitHub artifact retrieval docs for teams that want to compare scheduled refresh runs without committing generated data.
- Add stricter cache-retention review tooling after enough OpenAlex/SEC cache history exists.
- Keep continuous intelligence separate from production mutation; future promotion remains reviewed, explicit, and validated.

## D146 FOLLOW-ON

- Add reviewer-authored official IR/newsroom roots to `official_company_sources.json` only after URL review.
- Add a reviewer checklist export for stale-source queues, corridor maintenance, and universe blockers.
- Keep candidate-company preview UI as the mandatory review surface before any future production company writer is considered.
- Expand candidate-company batches only through source-backed identity metadata, duplicate/alias checks, reviewer-owned ecosystem assignment, and manual promotion governance.
- Add stricter registry validation once reviewers have added official company URLs.
- Keep OpenAlex context-only and source governance review-only.

## D140 FOLLOW-ON

- Expand approved CIK/ticker coverage only through local SEC candidate runs.
- Add reviewer decisions as explicit review-only fields before any new promotion logic.
- Maintain production source coverage after D145's zero-unsourced-edge baseline.
- Keep ownership/ETF overlap behind explicit schema and validation support.

## NOT CURRENT

- Live ingestion in the browser.
- User accounts, persisted portfolios, or cloud sync.
- Automatic promotion from candidates to production.
- Treating candidate-company preview anchors as relationship proof.
- Unsupported ETF, crypto, options, earnings, policy, or government-contract data layers.
