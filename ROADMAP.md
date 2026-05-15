# CURRENT SYSTEM STATE

Document: StockPhotonic Roadmap. StockPhotonic is a static photonic graph application using `data/companies.json` and `data/connections.json` as production source of truth.

- Graph Intelligence (2D): Current main work surface for exploring curated companies and edges with filters, search, relationship taxonomy, source/confidence/review filters, Focus Mode, signal thresholds, portfolio exposure, SEC-backed edge indicators, hub/nexus layouts, cluster intelligence, shared exposure, hidden relationship hints, and industry correlations.
- 3D Network capabilities: Three.js production-network view with orbiting camera, search, labels, filters, SEC emphasis, neighborhood depth, selected details, and fullscreen exploration.
- Source Workbench pipeline: Static, read-only guide and candidate preview surface for the local SEC workflow.
- SEC ingestion + candidate system: Local scripts support SEC fetch/cache, filing inspection, signal extraction, candidate preview, candidate writing, job manifests, schedule previews, and policy gates.
- Promotion + validation flow: Source-backed candidates must pass preview, manual review, explicit promotion, and `scripts/validate_data.py` before production use.

## CORE RULES

- No fake data.
- No automatic production writes.
- Candidate -> preview -> manual promotion only.
- No backend in the current app.
- Static production dataset is the source of truth.

## CURRENT FOCUS

- UI/UX polish for the 2D Graph Intelligence workflow.
- Intelligence layer clarity: company investigation workspace, why-connected relationship cards, source/confidence labels, hubs, clusters, shared exposure, hidden relationships, industry correlations, portfolio exposure, and SEC-backed edge visibility.
- Review layer clarity: evidence review queue, source aging labels, URL-derived source-host diversity, stale/pending indicators, candidate review grouping, triage artifacts, and candidate-vs-production overlap comparison.
- CSS maintainability: keep the D139 split across `base.css`, `shell.css`, `graph.css`, `stock.css`, `crypto.css`, `review.css`, and `mobile.css`; do not return to a single shared catch-all stylesheet.
- 3D immersion and usability while staying tied to the production static dataset.
- Source coverage quality for existing high-value relationships.
- Validation discipline before any production data expansion.

## NEXT MAJOR AREAS

- Data expansion through SEC-backed candidates, not direct production writes.
- Broader source coverage from SEC filings, company disclosures, official pages, and reputable secondary sources when needed.
- Better review ergonomics for candidate evaluation, clustering, overlap reports, checklist exports, and promotion previews.
- Relationship evidence depth: short source snippets, filing references, source aging review queues, source-host diversity, and relationship-specific confidence explanations.
- Future open-data review workflow: source registry rules that can pre-classify URL host categories, expose review aging thresholds, and export reviewer checklists while preserving candidate -> preview -> manual promotion.
- Open-data ownership/ETF overlap model after schema, source registry, and validation support exist.
- Optional backend/auth layer only after the static app and source workflow remain stable.
- Optional larger graph rendering/performance work as source-backed data grows.

## D140 FOLLOW-ON

- Expand approved CIK/ticker coverage only through local SEC candidate runs.
- Add reviewer decisions as explicit review-only fields before any new promotion logic.
- Improve production source coverage for the 78 current production edges missing source URLs.
- Keep ownership/ETF overlap behind explicit schema and validation support.

## NOT CURRENT

- Live ingestion in the browser.
- User accounts, persisted portfolios, or cloud sync.
- Automatic promotion from candidates to production.
- Unsupported ETF, crypto, options, earnings, policy, or government-contract data layers.
