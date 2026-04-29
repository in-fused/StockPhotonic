# StockPhotonic Roadmap

**Vision**: The most insightful, beautiful, and trustworthy visualization of corporate interconnections for serious personal investors and their trusted circle.

**Current Version**: v0.9 (Single-file Photonic Canvas prototype – 40 companies, 87 connections)

---

## Phase 0: Foundation (This Week – April 28 to May 5, 2026)

**Goal**: Make the prototype maintainable and expand the dataset significantly without breaking the magic.

**Tasks**:
- [x] Extract data from `index.html` into `data/companies.json` + `data/connections.json` (versioned, documented).
- [ ] Expand to **80 companies** (top ~60 by cap + 20 strategically important subs/partners) and **300+ high-quality connections**.
- [ ] Add provenance UI: Hover/click edge shows source, confidence, verified date, notes.
- [ ] Add "Last Updated" badge + "Data Quality" score (e.g., 94% of edges have confidence ≥4).
- [ ] Implement basic Portfolio Exposure calculator in the existing HTML (text input for tickers → highlights connected nodes + simple risk score).
- [ ] Create `DATA_SOURCES.md` with full attribution and update instructions.
- [ ] Update `README.md` with screenshots, quick start, and vision.
- [ ] Tag v1.0 on GitHub.

**Deliverable**: A living, trustworthy prototype you can share with 2-3 close friends immediately for feedback.

---

## Phase 1: Modern Frontend (May 6 – May 20, 2026)

**Goal**: Production-grade UI/UX with 3D photonic graph while keeping performance and beauty.

**Tasks**:
- [ ] Scaffold Next.js 15 + TypeScript + Tailwind + shadcn/ui in `frontend/` or root.
- [ ] Port Canvas logic to **Three.js** (`@react-three/fiber`, `drei`, `@react-three/postprocessing` for bloom/glow).
- [ ] Implement:
  - 3D force-directed layout (or use `graphology` + custom forces for stability).
  - Node: Glowing sphere + inner core + pulsing ring on hover/select.
  - Edge: Fiber-optic tube (TubeGeometry) with animated particles flowing in direction of "data flow".
  - LOD: Only render labels for selected + high-degree nodes when zoomed.
  - Controls: OrbitControls + zoom to fit + "center on node".
- [ ] Rebuild sidebar as beautiful glassmorphic panel with tabs (Ecosystem / Insights / Performance / Notes).
- [ ] Add advanced filters: Multi-select sectors, connection type pills, strength slider, "only high-confidence".
- [ ] Fuzzy search with Fuse.js (ticker, name, connection labels).
- [ ] Responsive: Mobile drawer for sidebar, touch-friendly graph.
- [ ] Dark neon theme refinement + accessibility (reduced motion toggle, high-contrast mode).
- [ ] Deploy preview on Vercel.

**Stretch**: "Photonic Mode" toggle – extra particle density, slower animations, full-screen immersion.

**Deliverable**: Stunning 3D web app that feels like a sci-fi trading terminal. Friends say "this is the coolest thing I've seen for investing."

---

## Phase 2: Data Engine & Backend (May 21 – June 10, 2026)

**Goal**: Reliable, automated, transparent data pipeline + persistence for watchlists/notes.

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

## Phase 3: Personal Investing Power Features (June 11 – July 5, 2026)

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

## Phase 4: Polish, Sharing & Community (July 2026+)

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
   - Week 1: AI/Semi supply chain + Berkshire ecosystem (highest 2026 relevance).
   - Week 2: Broaden to all sectors.
4. **Friend Circle Size**: Start with 3-5, expand to 15 max. Quality > quantity.

---

**This roadmap is living**. Update it after every phase retrospective.

**Immediate Next Step (You + Me)**: I will now generate the expanded `companies.json` (80 entries) and `connections.json` (300+ entries) with full provenance. You pull them into the repo, replace the hardcoded data in `index.html`, and we have v1.0 ready to share.

Let's build something that actually helps you see the market in a way no Bloomberg terminal or Yahoo Finance ever will.