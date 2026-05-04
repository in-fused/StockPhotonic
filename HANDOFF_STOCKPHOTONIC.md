# CURRENT SYSTEM STATE

Document: StockPhotonic Handoff. StockPhotonic is a static, client-side photonic network app. Production data is loaded from `data/companies.json` and `data/connections.json`; the current production dataset contains 60 real public companies and 121 curated connections.

- Graph Intelligence (2D): Canvas-based network with sector and industry-group filters, search, Focus Mode, signal thresholding, portfolio exposure highlighting, SEC-backed edge visibility, hub/sector/nexus layouts, derived dashboards, shared exposure, hidden relationship, cluster, and industry-correlation summaries.
- 3D Network capabilities: Three.js view over the same production dataset with orbit/zoom/pan, search, sector and relationship filters, labels, SEC emphasis, neighborhood depth controls, selected-node/edge details, fullscreen mode, and production-only graph rendering.
- Source Workbench pipeline: Read-only browser guide for local SEC ingestion commands, pipeline stages, candidate files, and candidate preview visibility. The browser does not run scripts, fetch SEC data, or write production data.
- SEC ingestion + candidate system: Local scripts fetch/cache SEC submissions and filings, inspect filings, extract signal reports, generate candidate-shaped previews, and optionally write review-only candidate files under `data/candidates/`.
- Promotion + validation flow: Candidates stay outside production until promotion preview, manual review, explicit promotion, and validation pass. Production graph data remains static JSON.

## CORE RULES

- No fake data, placeholder companies, synthetic tickers, generic labels, guessed URLs, or unsupported relationship claims.
- No automatic production writes. Scripts default to preview/dry-run unless an explicit write flag is used.
- Candidate -> preview -> manual promotion only.
- No backend in the current product. The app is static and browser-rendered.
- `data/companies.json` and `data/connections.json` are the source of truth for production graph views.

## FAST ONBOARDING

- Entry point: `index.html`.
- Modular app code: `js/core/`, `js/graph/`, `js/intelligence/`, `js/ui/`, `js/utils/`.
- Production data: `data/companies.json`, `data/connections.json`.
- Candidate data and SEC staging: `data/candidates/`.
- Local maintenance scripts: `scripts/`.
- Validation command: `python scripts/validate_data.py`.

## CURRENT OPERATING MODEL

Keep product work focused on the current static graph and its intelligence layers. New relationships should start as source-backed candidates, not direct production edits. Production edge additions require public evidence, reviewed metadata, explicit promotion, and validation.

## HANDOFF PROMPT

Continue StockPhotonic as a static, source-disciplined financial network app. Preserve the photonic UI, the static dataset source-of-truth model, and the candidate-only SEC workflow. Improve UI/UX, intelligence, 3D immersion, and source coverage without inventing data or bypassing manual promotion.
