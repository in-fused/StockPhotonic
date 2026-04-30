# StockPhotonic Roadmap

**Vision**: The most insightful, beautiful, and trustworthy visualization of corporate interconnections for serious personal investors and their trusted circle.

**Current Version**: v5.9 / Graph Focus Mode + Signal Clarity System (single-file Photonic Canvas app loading 60 real companies and 117 curated connections)

---

## Phase 0: Static Prototype Foundation (Completed Baseline – April 2026)

**Goal**: Make the prototype maintainable and expand the dataset significantly without breaking the magic.

**Tasks**:
- [x] Extract data from `index.html` into `data/companies.json` + `data/connections.json` (versioned, documented).
- [x] Expand static loading into external JSON files.
- [x] Retire the generated 300-company / 600-connection placeholder dataset after it proved useful for graph stress testing but failed the data credibility bar.
- [ ] Add provenance UI: Hover/click edge shows source, confidence, verified date, notes.
- [x] Add "Last Updated" badge + "Data Quality" score (e.g., 94% of edges have confidence ≥4).
- [ ] Implement basic Portfolio Exposure calculator in the existing HTML (text input for tickers → highlights connected nodes + simple risk score).
- [ ] Create `DATA_SOURCES.md` with full attribution and update instructions.
- [ ] Update `README.md` with screenshots, quick start, and vision.
- [ ] Tag v1.0 on GitHub.

**Deliverable**: A living, trustworthy prototype you can share with 2-3 close friends immediately for feedback.

---

## Phase 1: Graph Usability Stabilization (April 29 to May 5, 2026)

**Goal**: Make the static Canvas graph usable and reliable before any future expansion.

**Tasks**:
- [ ] Fix node click reliability so click, drag, and pan gestures do not conflict.
- [ ] Add smooth wheel zoom around the pointer and pan by dragging empty canvas.
- [ ] Preserve or add reset/fit view controls.
- [x] Reduce spiderweb clutter with strength-scaled edge opacity/thickness while preserving color by type.
- [ ] Add label level-of-detail so all node labels are not drawn at every zoom level.
- [ ] Improve initial sector-aware layout with stronger spacing and bounded settling.
- [x] Add first-degree focus mode on node selection: selected node, neighbor nodes, connected edges, and hidden unrelated elements when Focus Mode is enabled.
- [x] Add Graph Focus Mode + Signal Clarity System to reduce visual noise and increase decision clarity using only existing company and connection data.
- [x] Add a signal strength threshold slider that filters weaker edges and prunes zero-edge nodes when the threshold creates a cleaner subgraph.
- [x] Add Signal Clarity sidebar summary for active threshold, visible connection count, strongest visible connection, and weakest visible connection.
- [x] Keep details in the existing sidebar/panel and include connected companies when data allows.
- [ ] Keep the app static-host friendly and avoid framework migration in this phase.

**Deliverable**: The graph is stable enough to explore the static dataset without accidental selections, broken dragging, or unreadable edge dominance.

**Graph Focus Mode + Signal Clarity System**:
- Purpose: reduce noise and make the existing graph more decision-grade by isolating high-signal structures.
- Focus Mode is off by default; when enabled with a selected node, it shows only the selected node, first-degree neighbors, and the selected node's direct edges.
- Signal Strength Threshold filters existing edges by their stored strength value; no new data, schema fields, or factual claims are introduced.
- Industry Group + threshold above 0.3 automatically forms a cleaner visible subgraph by hiding below-threshold edges and zero-edge nodes.

---

## Phase 2: Real Dataset Foundation (Current Priority – April 30 to May 14, 2026)

**Goal**: Replace generated placeholder data with a smaller, credible core of real public companies and defensible relationships.

**Tasks**:
- [x] Replace fake ticker variants such as `LLY132`, `LLY52`, and `AVG0146`.
- [x] Replace placeholder company names such as `NVDA Company 1`.
- [x] Replace generic connection labels such as `Supply relationship`.
- [x] Keep the dataset small enough to manually review: 60 real companies and 117 curated edges.
- [x] Strengthen `scripts/validate_data.py` to fail duplicate tickers, synthetic ticker suffixes, placeholder names, and generic labels.
- [ ] Add edge-level source URLs for the highest-impact supply, partnership, and investment relationships. _(in progress: Phase 2.1)_
- [x] Document the current raw-input signal pipeline from `scripts/generate_signals.py` through `scripts/enrich_connections.py`, `scripts/validate_data.py`, and `data/connections.json`.
- [x] Add source tiering and `signal_score` concepts for candidate signal prioritization.
- [x] Add ingestion controls for generated signals: `--from-signals`, `--dry-run`, `--min-signal-score`, `--min-strength`, and `--types`.
- [x] Add provenance UI so users can inspect confidence, verified date, and source summary from the graph.
- [x] Add a transitional derived industry-group layer in `index.html` without changing company or connection data files.
- [ ] Review top AI/semiconductor, healthcare/PBM, payments, and Berkshire edges before expanding the node count.

**Deliverable**: StockPhotonic presents only real companies in the core dataset. Data credibility is the gate before feature expansion, larger market coverage, ETFs, crypto, options flow, earnings, auth, backend work, or framework migration.

**Current Pipeline**: `RAW INPUT -> scripts/generate_signals.py -> signal_score/source_meta -> scripts/enrich_connections.py -> scripts/validate_data.py -> data/connections.json`.

`signal_score` is an ingestion-quality score based on source tier and keyword strength. It helps prioritize and filter candidate signals before dataset writes. `confidence` is the persisted connection credibility score and remains based on structural validation rules; optional `signal_score` can only adjust the result after the base confidence logic has run.

**Current Data Next Priority**: Build toward reputable-source ingestion using SEC filings, company releases, official announcements, partner pages, and reputable news as raw inputs while keeping validation strict and reviewable.

---

## Phase 1 Later: Modern Frontend Exploration (Future, Not Current Phase 1)

**Goal**: Evaluate production-grade UI/UX options after the static Canvas graph is stable.

**Possible Tasks**:
- [ ] Consider Next.js 15 + TypeScript + Tailwind + shadcn/ui only after the current static app is reliable.
- [ ] Consider Three.js or Canvas/WebGL rendering for larger future datasets.
- [ ] Evaluate advanced filters, fuzzy search, mobile drawer UI, and accessibility refinements.
- [ ] Deploy preview on Vercel when the stable prototype is ready.

---

## Phase 3: Data Engine & Backend (May 21 – June 10, 2026)

**Goal**: Reliable, automated, transparent data pipeline + persistence for watchlists/notes after the real static dataset is credible.

**Tasks**:
- [ ] Set up **Turso** (or Supabase) + Prisma ORM.
- [ ] Schema: `companies`, `connections`, `users`, `watchlists`, `notes`, `connection_suggestions`.
- [ ] Build ETL scripts (`scripts/`):
  - `ingest_fmp.py`: Daily market caps, profiles, M&A via FinancialModelingPrep free tier.
  - `ingest_opencorporates.py`: Subsidiaries for top 200 tickers (rate-limited, cached).
  - `ingest_corpwatch.py`: EX-21 filings for ownership trees.
  - `validate.py`: Enforce rules (no orphans, confidence ≥3 for core, duplicate detection, staleness flagging).
  - `compute_centrality.py`: NetworkX – degree, betweenness, eigenvector, community detection (Louvain). Export per-sector "influence scores".
- [ ] API Routes:
  - `GET /api/subgraph?ticker=NVDA&depth=2` – returns ego network + metrics.
  - `POST /api/portfolio` – accepts tickers + weights, returns exposure breakdown + risk score.
  - `POST /api/suggest-connection` – for friends to propose new edges (moderated queue).
- [ ] Background job (GitHub Action or cron on Render): Daily data refresh → commit new JSON or push to DB.
- [ ] Add "Data Freshness" dashboard (last successful ingest, % edges <30 days old, pending verifications).

**Deliverable**: You can run `python scripts/build_graph.py` and have fresh data. Friends can suggest connections that appear after your review.

---

## Phase 4: Personal Investing Power Features (June 11 – July 5, 2026)

**Goal**: Turn the tool into your daily edge for portfolio construction and risk monitoring.

**Tasks**:
- [ ] **Portfolio Dashboard**:
  - Upload CSV (ticker, shares, avg cost) or paste tickers.
  - Visual: Your holdings highlighted on the global graph + "connected component" subgraph.
  - Metrics: Nexus Exposure % (sum of connection strengths to your holdings), Concentration Risk (top 3 nexus hubs), Contagion Scenarios (what if NVDA supply disrupted?).
- [ ] **Watchlist + Alerts** (Supabase):
  - Star companies/connections.
  - Email or in-app notification when a watched edge changes (new M&A, supply win announced, confidence upgrade).
- [ ] **Insight Engine**:
  - "Hidden Gems": Low market-cap companies with high betweenness (undervalued bridges).
  - "Cluster Opportunities": Strong internal connections but weak external (acquisition targets or partnership plays).
  - "Risk Heatmap": Sector-level exposure matrix.
- [ ] Per-company page: Full 10-K risk factors summary (via FMP), recent news sentiment (if free API), peer comparison.
- [ ] Export everything: PDF report of current view, GraphML for Gephi/Cytoscape, CSV of ego network.

**Deliverable**: A tool you actually use every week for position sizing and due diligence. "I saw the NVDA-MU link strength was 0.91 – that's why I added a small MU position."

---

## Product Intelligence: Sector -> Industry-Group Correlation Intelligence

**Goal**: After the immediate product intelligence and graph exploration work is stronger, prepare StockPhotonic to analyze how industry groups relate inside broader sectors and adjacent ecosystems.

**Current Transitional Layer**:
- Phase 2.2 derives `industryGroup` at runtime inside `index.html` from existing `sector`, `industry`, `name`, and `ticker` fields.
- The derived value is not stored in `data/companies.json` and is not a normalized schema field yet.
- Current sidebar correlation language is edge-derived from the existing static graph only. It does not add new factual company claims, URLs, or unsupported relationships.

**Planning Principles**:
- Sector remains the broad category.
- Industry group is the more specific derived group inside or near a sector.
- Example healthcare industry groups: Pharmaceuticals, Insurance / Managed Care, PBM / Pharmacy Benefits, MedTech, and Life Sciences Tools.
- Keep the current layer transitional until the schema, sources, and validation rules are ready for normalized industry-group data.

**Future Capabilities**:
- [ ] Compare relationships between industry groups inside a sector, such as Pharmaceuticals <-> Insurance / PBM.
- [ ] Compare adjacent ecosystem groups, such as Semiconductors <-> Cloud Infrastructure, Energy Producers <-> Oilfield Services, Retail <-> Payments Networks, and Aerospace OEMs <-> Suppliers.
- [ ] Add a normalized `industry_group` field or lookup table after the derived groups are reviewed.
- [ ] Add source-backed correlation records for durable industry-group intelligence.
- [ ] Build a small-company / IPO discovery layer for smaller companies, newer IPOs, and under-followed names benefiting from large-cap ecosystems.
- [ ] Evaluate discovery signals such as supplier exposure, platform dependency, government funding support, strategic partnerships, customer concentration, and ecosystem adjacency.
- [ ] Plan a government / policy relationship layer for public funding, grants, contracts, subsidies, regulation, defense exposure, healthcare reimbursement, energy policy, and industrial policy connections.
- [ ] Require public, reviewable support before any government, policy, or ecosystem relationship becomes product data.

**Placement**: The current implementation is a static-app foundation. Normalized schema fields, source-backed correlation records, and government/policy relation layers remain future work.

---

## Phase 5: Polish, Sharing & Community (July 2026+)

- [ ] Public landing page with interactive demo (read-only, no portfolio upload).
- [ ] Invite system: Generate unique codes for 10-20 friends max (keep it high-signal, low-noise).
- [ ] "Suggest Connection" form with screenshot upload + source link (you review in admin UI).
- [ ] Mobile PWA + offline graph (IndexedDB).
- [ ] Performance: 500 nodes @ 60fps on M1 MacBook / recent iPhone.
- [ ] Documentation: Video walkthrough, "How to read the photonic graph" guide, methodology whitepaper (confidence scoring, data sources).
- [ ] Optional: Public API (read-only) for power users who want to build their own viz.

---

## Success Metrics (Personal + Project Health)

**Personal Investing**:
- You discover at least 3-5 actionable interconnections per month that influence position sizing or new ideas.
- Portfolio "nexus risk" becomes a standard metric you track alongside beta/sharpe.

**Product**:
- 5-10 active monthly users (your circle) with zero churn.
- <5 support requests per month (mostly data questions, not bugs).
- Lighthouse score >90 on desktop/mobile.
- Data quality: >85% of core edges have confidence 4-5 and verified <60 days.

**Long-term Optionality**:
- If it becomes indispensable: Consider small paid tier for premium data layers (FactSet, BoardEx) or white-label for small RIAs.
- But primary goal remains: **Your personal edge + gift to friends**.

---

## Risk Mitigation

- **Data Staleness**: Automated staleness flagging + quarterly manual audit of top 50 hubs.
- **API Limits**: Heavy caching (24h for market data, 7d for static relationships). Fallback to last-known values with warning.
- **Scope Creep**: Strict "core dataset" vs "experimental" layers. New connection types start in experimental until validated.
- **Performance**: Three.js LOD + WebGL2 + instancing. Measure on low-end devices early.
- **Privacy**: Portfolio data never leaves device unless user explicitly enables cloud sync.

---

## Current Blockers / Open Decisions

1. **Three.js vs keep Canvas**: Three.js gives "wow" factor but adds bundle size (~300KB gzipped with postprocessing). Decision by May 10.
2. **DB Choice**: Turso (SQLite, dead simple) vs Supabase (Postgres + built-in auth/storage). Leaning Turso for simplicity.
3. **Data Priority Order**:
   - Current: improve user-facing product intelligence and graph exploration on the smaller real-company core.
   - Next: continue adding edge-level source URLs for the highest-impact AI/Semi, PBM, payments, and Berkshire ecosystem links.
   - Later: normalize industry groups and add source-backed correlation records only when each ticker, edge, and relationship category is real and reviewable.
4. **Friend Circle Size**: Start with 3-5, expand to 15 max. Quality > quantity.

---

**This roadmap is living**. Update it after every phase retrospective.

**Immediate Next Step**: Improve user-facing product intelligence and graph exploration on the credible Phase 2 dataset before adding new data layers or migrating architecture.

Let's build something that actually helps you see the market in a way no Bloomberg terminal or Yahoo Finance ever will.
