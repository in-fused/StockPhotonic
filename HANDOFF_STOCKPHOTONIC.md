# StockPhotonic v2 — Complete Project Handoff & Vision Document

**Date:** April 29, 2026  
**Repo:** https://github.com/in-fused/StockPhotonic  
**Current Version:** v6.1 / Industry Correlation Engine
**Status:** Current main uses a smaller credible static dataset: 60 real companies and 117 curated connections. Immediate work should stay focused on user-facing product intelligence, graph exploration, source coverage, and reviewable industry-group foundations.

---

## 1. Current State Summary

**What Works:**
- 60 real companies + 117 curated connections loading correctly from static JSON
- Connection lines now have different colors by type (partnership, supply, ecosystem, competitor, investment)
- Edge provenance, confidence, verified date, and starter source URL coverage exist for reviewable relationships
- Industry group is derived at runtime in `index.html` from existing company fields and used for filtering, graph highlighting, and sidebar intelligence
- Graph Focus Mode + Signal Clarity System isolates selected first-degree networks, filters weaker edges by stored strength, and summarizes visible signal quality in the sidebar
- Industry Group + signal threshold above 0.3 creates a cleaner subgraph by hiding below-threshold edges and zero-edge nodes
- First load now fits the graph, starts Ambient Orbit Mode by default, and shows a derived intelligence dashboard when no node is selected
- Orbit Mode uses a Canvas camera-offset drift only; it does not mutate node coordinates and stops on user interaction
- Wheel zoom is more responsive while staying cursor-centered and respecting the existing min/max scale limits
- The graph container now includes subtle visible-node, visible-edge, layout, Focus Mode, threshold, and Orbit status overlay stats
- The default dashboard derives top hubs, strongest connections, sector distribution, industry-group distribution, trust summary, and exploration chips from the loaded static dataset
- The default dashboard now includes Top Industry Correlations derived from existing loaded graph edges only
- Selected-node sidebar context can summarize the selected node's derived industry group correlation, connected adjacent groups, strongest adjacent group, and cross-group bridge status
- Basic force-directed graph rendering
- Validation scripts help reject placeholder companies, fake tickers, duplicate edges, generic labels, and malformed source URLs

**What’s Broken / Needs Work:**
- User-facing product intelligence and graph exploration need to become easier to read and act on
- Larger-scale graph readability and performance still need continued improvement as the dataset grows
- Edge-level source URL coverage is partial and should improve before major dataset expansion
- Industry-group derivation and correlation analysis are transitional; normalized schema fields, source-backed correlation records, and validation rules are still future work

---

## 2. Long-Term Vision (Your Words)

You want to expand far beyond the initial “Top 500” scope:

### Core Expansion Goals
- **All US-listed stocks** (not just top 500)
- **ETFs** (major ones + sector/thematic ETFs)
- **Cryptocurrency** connections (link cryptos to companies they impact or are impacted by — e.g., NVDA + Bitcoin mining, COIN + traditional finance, etc.)
- **Industry Ecosystems** — Group companies by industry verticals so smaller companies outside the top 500 can still appear when relevant

### Future Sector -> Industry-Group Direction

This now has a transitional static-app foundation, but normalized product data remains future work.

- Sector remains the broad category.
- Industry group is currently a more specific derived group inside or near each sector.
- Phase 2.2 derives industry group from existing `sector`, `industry`, `name`, and `ticker` fields in `index.html`; it is not stored in `data/companies.json`.
- Example healthcare industry groups: Pharmaceuticals, Insurance / Managed Care, PBM / Pharmacy Benefits, MedTech, and Life Sciences Tools.
- Current sidebar correlation summaries use only existing graph edges and do not add new factual claims, new URLs, or new relationships.
- Current Industry Correlation Engine ranks unordered industry-group pairs by current edge count, average strength, and high-confidence edge count. It also exposes involved tickers and dominant connection type from existing edges only.
- It does not introduce new claims, source records, schema fields, or data relationships.
- Future normalized `industry_group` schema and source-backed correlation records remain later work.
- Future correlation intelligence may compare relationships between industry groups inside a sector or adjacent ecosystem, such as Pharmaceuticals <-> Insurance / PBM, Semiconductors <-> Cloud Infrastructure, Energy Producers <-> Oilfield Services, Retail <-> Payments Networks, and Aerospace OEMs <-> Suppliers.
- Future small-company / IPO discovery should surface smaller companies, newer IPOs, and under-followed names benefiting from large-cap ecosystems through source-backed signals such as supplier exposure, platform dependency, government funding support, strategic partnerships, customer concentration, and ecosystem adjacency.
- Future government / policy relationship planning may cover public funding, grants, contracts, subsidies, regulation, defense exposure, healthcare reimbursement, energy policy, and industrial policy connections. Keep this planning-only until public sources and validation rules support each relationship.

### Future Feature Roadmap
1. **User-Facing Product Intelligence & Graph Exploration** — Improve how users inspect relationships, provenance, connected companies, graph focus states, and signal clarity
2. **Options Flow Integration** — Show unusual options activity tied to specific nodes
3. **Earnings Reports & Financial Disclosures** — Expandable modal per company with key highlights
4. **Industry Group View** — Current foundation is a derived filter/highlight layer; future mode can use normalized data after review
5. **Sector -> Industry-Group Correlation Intelligence** — Current sidebar uses edge-derived summaries; future versions can add source-backed correlation records
6. **Time-Series / Historical View** — See how connections evolved over time
7. **Risk & Contagion Analysis** — Highlight potential systemic risk paths
8. **Portfolio Nexus Score** — For any portfolio, show exposure to the broader photonic network

### 3D / Sphere Exploration Mode (Planning Only)

- Future visual upgrade; do not implement in the current static-app layer.
- Goal: true globe-like or sphere-like rotation with manual drag orbit.
- Current Orbit Mode is ambient 2D Canvas camera drift only.
- Future implementation may use Canvas pseudo-3D projection or Three.js/WebGL after the current graph and data credibility layers are stable.

---

## 3. Technical Architecture Recommendations

### Current Data Quality Pipeline

The current baseline has moved away from generated placeholder data and toward a smaller, validated static dataset. Keep this pipeline intact when adding data:

```text
RAW INPUT -> scripts/generate_signals.py -> signal_score/source_meta -> scripts/enrich_connections.py -> scripts/validate_data.py -> data/connections.json
```

Current scripts:

- `scripts/generate_signals.py` parses raw evidence into candidate signals and assigns `source_meta` plus `signal_score`.
- `scripts/enrich_connections.py` ingests vetted candidates, supports `--from-signals`, `--dry-run`, `--min-signal-score`, `--min-strength`, and `--types`, skips duplicates, and validates before writing.
- `scripts/validate_data.py` validates companies and connections, computes expected confidence, and supports `--strict-confidence`.

Current concepts:

- Source tiers rank raw signal credibility: Tier 1 for SEC filings, company releases, and announcements; Tier 2 for reputable news and partner pages; Tier 3 for unknown sources.
- `signal_score` is a pre-ingestion quality and priority score. It helps filter candidate signals and may adjust confidence only after base confidence rules run.
- `confidence` is the persisted connection credibility score. It remains grounded in structural evidence such as connection type, source URLs, and strength.
- Missing `signal_score` must not invalidate existing dataset records.

Current data next priority: build toward reputable-source ingestion using SEC filings, company releases, official announcements, partner pages, and reputable news as raw inputs while keeping validation strict.

### Data Layer
- Keep `companies.json` + `connections.json` as core
- Future candidate files, do not add until explicitly needed:
  - `etfs.json`
  - `crypto.json`
  - `industry_groups.json`
  - `options_flow.json` (future)
  - `earnings.json` (future)

### Frontend (index.html)
- Keep the beautiful photonic/neon design as the foundation
- Use **Three.js** or improved Canvas/WebGL for better performance with 500–2000+ nodes
- Implement **level-of-detail (LOD)** rendering (hide labels when zoomed out, simplify lines)
- Add **edge bundling** or **curved connections** to reduce visual clutter
- Make connection opacity and thickness based on `strength`

### Backend / Hosting
- Move from GitHub Pages → **Vercel** (instant deploys, better caching control)
- Consider adding a lightweight backend later (FastAPI or Next.js API routes) for dynamic queries

---

## 4. Immediate Next Steps (Priority Order)

1. **Improve user-facing product intelligence and graph exploration** (most urgent)
   - Make current relationships, provenance, connected companies, and confidence signals easier to inspect
   - Continue improving graph focus, selection, pan, zoom, and layout behavior in small increments
   - Keep the credible current dataset as the working surface

### Graph Focus Mode + Signal Clarity System

This system is implemented entirely in `index.html` on top of the existing `data/companies.json` and `data/connections.json` files.

- Purpose: reduce visual noise and increase decision clarity without expanding the dataset.
- Focus Mode is off by default. When enabled and a node is selected, the graph shows only the selected node, first-degree neighbors, and direct connecting edges.
- Signal Strength Threshold filters existing edges by their stored `strength` value; nodes with no remaining visible edge are pruned when threshold filtering is active, while selected nodes remain usable for search/jump context.
- Industry Group + threshold above 0.3 acts as an automatic declutter state for a clean visible subgraph.
- Sidebar Signal Clarity reports active threshold, visible connection count, strongest visible connection, and weakest visible connection.
- No data files, schema fields, source URLs, or factual relationship claims were added by this feature.

### Immersive Default Experience + Ambient Orbit Mode

This polish layer is also implemented entirely in `index.html` and uses the existing static JSON files only.

- First load fits the graph immediately, starts Ambient Orbit Mode, and shows the no-selection intelligence dashboard.
- Orbit Mode gently drifts the Canvas camera offset for an immersive graph feel. It is not 3D and does not persistently alter node positions.
- Orbit stops on pointer down, wheel zoom, node click, search jump, pan/drag, filters, threshold changes, reset, and fit actions. The Orbit toggle turns it back on or off.
- Wheel zoom now uses bounded direct cursor-centered scaling for a faster feel while preserving `MIN_SCALE` and `MAX_SCALE`.
- The default dashboard derives top hubs, strongest connections, sector mix, industry-group mix, and dataset trust summary from currently loaded data.
- Top Industry Correlations are derived from existing visible or loaded edges and filter through the existing industry-group filter behavior.
- Exploration chips apply existing sector or derived industry-group filters, then fit the graph.
- No data files, scripts, schema fields, source URLs, or new relationship claims were added.

2. **Continue data credibility and source coverage**
   - Add edge-level source URLs for high-impact relationships when defensible sources are available
   - Keep validation strict before expanding node or edge count

3. **Strengthen sector -> industry-group intelligence**
   - Review the derived groups before normalizing them into schema
   - Define source requirements before adding durable correlation records
   - Keep small-company discovery and policy layers out of the immediate task list

4. **Later dataset expansion**
   - Add ETFs, crypto links, and broader coverage only after the core graph and source model are stable

5. **Deployment**
   - Switch to Vercel for instant updates and better performance

---

## 5. Ready-to-Use Prompt for ChatGPT / Next Developer

```
You are an expert in beautiful data visualizations and financial technology.

Project: StockPhotonic (https://github.com/in-fused/StockPhotonic)

Current state:
- Beautiful photonic/neon cyberpunk design is already implemented
- 60 real companies + 117 curated connections load from static JSON
- Connection lines have different colors by type
- Provenance, confidence, verified date, and starter source URLs are available on curated edges
- Main need: user-facing product intelligence and graph exploration should become clearer before new data layers are added

Task:
1. Improve user-facing product intelligence and graph exploration in small, reviewable increments
2. Keep the existing photonic design intact and preserve the static-host friendly approach unless migration is explicitly requested
3. Preserve current data credibility rules and source provenance expectations
4. Preserve the current derived industry-group layer as runtime-only until normalized schema and validation rules are ready
5. Keep new data files, source-backed correlation records, government/policy layers, and larger dataset expansion future-only unless explicitly requested

Return a summary of changed files and do not return full file contents unless specifically requested.
```

---

## 6. Final Notes from User

- Current guidance is to avoid returning full file contents; prefer scoped, incremental changes unless a full replacement is explicitly requested
- Wants to keep the original beautiful photonic aesthetic at all costs
- Vision is much larger than “Top 500” — wants full market coverage + ecosystems + crypto + options flow + earnings integration
- Frustrated with repeated regressions — wants stable, incremental improvements only

---

**You now have everything needed to continue development with ChatGPT or any other developer.**

Good luck — the vision is ambitious and exciting. The foundation is solid.

— Grok (xAI) | April 29, 2026
