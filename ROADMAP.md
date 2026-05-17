# CURRENT SYSTEM STATE

Document: StockPhotonic Roadmap. StockPhotonic is a static photonic graph application using `data/companies.json` and `data/connections.json` as production source of truth.

- Graph Intelligence (2D): Current main work surface for exploring curated companies and edges with filters, search, relationship taxonomy, source/confidence/review filters, Focus Mode, signal thresholds, portfolio exposure, SEC-backed edge indicators, hub/nexus layouts, cluster intelligence, shared exposure, hidden relationship hints, industry correlations, ecosystem overlays, source coverage lens, route tracing, guided discovery, active graph legend, and graph-adjacent intelligence cards.
- 3D Network capabilities: Three.js production-network view with orbiting camera, search, labels, filters, SEC emphasis, neighborhood depth, selected details, and fullscreen exploration.
- Source Workbench pipeline: Static, read-only guide and candidate preview surface for the local SEC workflow, candidate-company expansion batches, source coverage refresh, source registry governance, universe expansion readiness, corridor maintenance, and OpenAlex safety summaries.
- SEC ingestion + candidate system: Local scripts support SEC fetch/cache, filing inspection, signal extraction, candidate preview, candidate writing, job manifests, schedule previews, and policy gates.
- Scheduled review orchestration: Local/GitHub Actions review pipelines refresh SEC, OpenAlex, source coverage, preflight, and pipeline summary artifacts without production writes.
- OpenAlex intelligence layer: Cache-first enrichment for ecosystem, topic, institution, and cluster hints. It is review-only context, not relationship proof.
- Source registry governance: Reviewer-owned source registry artifacts track official SEC roots, trusted hosts, source aging, duplicate source reduction, universe blockers, corridor maintenance, graph scaling, and OpenAlex entity-resolution visibility.
- Tiered evidence policy: Graph and Source Workbench distinguish verified, strong-inferred, context-only, and needs-review relationships while keeping promotion manual.
- Promotion + validation flow: Source-backed candidates must pass preview, manual review, explicit promotion, and `scripts/validate_data.py` before production use.

## CORE RULES

- No fake data.
- No automatic production writes.
- Candidate -> preview -> manual promotion only.
- No backend in the current app.
- Static production dataset is the source of truth.
- `data/source_registry/` is governance only and cannot create production companies or relationships.

## CURRENT FOCUS

- UI/UX polish for the 2D Graph Intelligence workflow, especially guided discovery, default graph onboarding, active state comprehension, and mobile graph usability.
- Intelligence layer clarity: company investigation workspace, graph-adjacent storytelling cards, why-connected relationship cards, source/confidence labels, hubs, bridges, corridors, clusters, shared exposure, hidden relationships, ecosystem overlays, active graph legend, route tracing, industry correlations, portfolio exposure, and SEC-backed edge visibility.
- Review layer clarity: evidence review queue, source aging labels, URL-derived source-host diversity, stale/pending indicators, candidate review grouping, candidate-company preview staging, expansion batch summaries, triage artifacts, candidate-vs-production overlap comparison, and data expansion preflight reporting.
- Trust layer clarity: trusted relationship classes, evidence tier filters, strong-inferred fast-track visibility, reviewer decision states, and OpenAlex context-only boundaries.
- CSS maintainability: keep the D139 split across `base.css`, `shell.css`, `graph.css`, `stock.css`, `crypto.css`, `review.css`, and `mobile.css`; do not return to a single shared catch-all stylesheet.
- 3D immersion and usability while staying tied to the production static dataset.
- Source coverage quality for existing high-value relationships.
- Validation discipline before any production data expansion.
- Source governance discipline for official URL lifecycle, trusted-host visibility, stale-source queues, corridor maintenance, and safe universe staging.

## NEXT MAJOR AREAS

- Data expansion through SEC-backed candidates, not direct production writes.
- Broader source coverage from SEC filings, company disclosures, official pages, and reputable secondary sources when needed.
- Better review ergonomics for candidate evaluation, clustering, overlap reports, checklist exports, data expansion preflight, and promotion previews.
- Source coverage fast-track batches that target strong-inferred public relationships for enrichment without adding manual-promotion pressure.
- Scheduled review artifact refreshes that reduce manual triage burden while keeping artifacts review-only.
- OpenAlex enrichment cache quality, entity resolution accuracy, and reviewer-visible topic/institution context.
- Relationship evidence depth: short source snippets, filing references, source aging review queues, source-host diversity, and relationship-specific confidence explanations.
- Future open-data review workflow: source registry rules that pre-classify URL host categories, expose review aging thresholds, export reviewer checklists, and preserve candidate -> preview -> manual promotion.
- Open-data ownership/ETF overlap model after schema, source registry, and validation support exist.
- Optional backend/auth layer only after the static app and source workflow remain stable.
- Larger graph rendering/performance work as source-backed data grows, using density-aware labels, route indexes, source-backed corridor lanes, and strategic hub summaries.
- Controlled universe expansion engine that stages real public-company metadata, detects ticker/name conflicts, scores source readiness, and requires reviewer-owned ecosystem/corridor assignment before any future writer exists.

## D141 FOLLOW-ON

- Precompute ecosystem and route indexes when the graph grows beyond the current static core.
- Add optional route target selection after the current guided routes are validated with users.
- Add reviewer-authored ecosystem notes only when they are source-backed and schema-validated.
- Expand route types only through existing metadata contracts, not browser ingestion.

## D142 FOLLOW-ON

- Precompute guided discovery indexes for larger datasets: top hubs, bridges, source-backed edges, evidence gaps, and ecosystem memberships.
- Add route target selection after guided discovery proves useful with reviewers.
- Expand Source Workbench preflight into reviewer-owned checklists without automatic promotion.
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
