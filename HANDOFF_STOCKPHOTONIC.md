# StockPhotonic v2 — Complete Project Handoff & Vision Document

**Date:** April 29, 2026  
**Repo:** https://github.com/in-fused/StockPhotonic  
**Current Version:** v5.7 / Phase 2.1 Edge-Level Source URLs
**Status:** Current main uses a smaller credible static dataset: 60 real companies and 117 curated connections. Immediate work should stay focused on user-facing product intelligence, graph exploration, and source coverage.

---

## 1. Current State Summary

**What Works:**
- 60 real companies + 117 curated connections loading correctly from static JSON
- Connection lines now have different colors by type (partnership, supply, ecosystem, competitor, investment)
- Edge provenance, confidence, verified date, and starter source URL coverage exist for reviewable relationships
- Basic force-directed graph rendering
- Validation scripts help reject placeholder companies, fake tickers, duplicate edges, generic labels, and malformed source URLs

**What’s Broken / Needs Work:**
- User-facing product intelligence and graph exploration need to become easier to read and act on
- Graph focus, node selection, pan, zoom, drag, and layout behavior still need continued improvement
- Edge-level source URL coverage is partial and should improve before major dataset expansion
- Future industry-group correlation work is planning-only until schema and validation rules are ready

---

## 2. Long-Term Vision (Your Words)

You want to expand far beyond the initial “Top 500” scope:

### Core Expansion Goals
- **All US-listed stocks** (not just top 500)
- **ETFs** (major ones + sector/thematic ETFs)
- **Cryptocurrency** connections (link cryptos to companies they impact or are impacted by — e.g., NVDA + Bitcoin mining, COIN + traditional finance, etc.)
- **Industry Ecosystems** — Group companies by industry verticals so smaller companies outside the top 500 can still appear when relevant

### Future Sector -> Industry-Group Direction

This is a future product-intelligence layer, not the immediate implementation task.

- Sector remains the broad category.
- Industry group becomes the more specific breakdown inside each sector.
- Example healthcare industry groups: Pharmaceuticals, Insurance / Managed Care, PBM / Pharmacy Benefits, MedTech, and Life Sciences Tools.
- Future correlation intelligence should compare relationships between industry groups inside a sector or adjacent ecosystem, such as Pharmaceuticals <-> Insurance / PBM, Semiconductors <-> Cloud Infrastructure, Energy Producers <-> Oilfield Services, Retail <-> Payments Networks, and Aerospace OEMs <-> Suppliers.
- Future small-company / IPO discovery should surface smaller companies, newer IPOs, and under-followed names benefiting from large-cap ecosystems through source-backed signals such as supplier exposure, platform dependency, government funding support, strategic partnerships, customer concentration, and ecosystem adjacency.
- Future government / policy relationship planning may cover public funding, grants, contracts, subsidies, regulation, defense exposure, healthcare reimbursement, energy policy, and industrial policy connections. Keep this planning-only until public sources and validation rules support each relationship.

### Future Feature Roadmap
1. **User-Facing Product Intelligence & Graph Exploration** — Improve how users inspect relationships, provenance, connected companies, and graph focus states
2. **Options Flow Integration** — Show unusual options activity tied to specific nodes
3. **Earnings Reports & Financial Disclosures** — Expandable modal per company with key highlights
4. **Industry Group View** — Toggle between “All Companies” and “Industry Ecosystem” mode after the core graph experience is stronger
5. **Sector -> Industry-Group Correlation Intelligence** — Compare relationships among industry groups inside sectors and adjacent ecosystems
6. **Time-Series / Historical View** — See how connections evolved over time
7. **Risk & Contagion Analysis** — Highlight potential systemic risk paths
8. **Portfolio Nexus Score** — For any portfolio, show exposure to the broader photonic network

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
   - Improve graph focus, selection, pan, zoom, and layout behavior in small increments
   - Keep the credible current dataset as the working surface

2. **Continue data credibility and source coverage**
   - Add edge-level source URLs for high-impact relationships when defensible sources are available
   - Keep validation strict before expanding node or edge count

3. **Plan sector -> industry-group intelligence** (future only)
   - Define hierarchy and source requirements before adding data or UI
   - Keep industry-group filtering, correlation intelligence, small-company discovery, and policy layers out of the immediate task list

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
4. Document future sector -> industry-group hierarchy, correlation intelligence, small-company discovery, and government/policy layers without adding features yet
5. Keep industry group filtering, new data files, and larger dataset expansion future-only unless explicitly requested

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
