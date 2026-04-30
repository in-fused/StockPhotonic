# StockPhotonic v2 — Complete Project Handoff & Vision Document

**Date:** April 29, 2026  
**Repo:** https://github.com/in-fused/StockPhotonic  
**Current Version:** v5.4 (partial fixes)  
**Status:** Data expanded successfully (300 companies + 600 connections), but graph interaction and layout need major cleanup

---

## 1. Current State Summary

**What Works:**
- 300 companies + 600 connections loading correctly
- Connection lines now have different colors by type (partnership, supply, ecosystem, competitor, investment)
- Basic force-directed graph rendering

**What’s Broken / Needs Work:**
- Graph is extremely messy (“spiderweb”) with too many overlapping lines
- Node clicking is unreliable or broken
- Pan/zoom/drag is clunky
- UI counts are now dynamic but layout needs major improvement for large datasets
- No differentiation in line thickness or transparency based on strength

---

## 2. Long-Term Vision (Your Words)

You want to expand far beyond the initial “Top 500” scope:

### Core Expansion Goals
- **All US-listed stocks** (not just top 500)
- **ETFs** (major ones + sector/thematic ETFs)
- **Cryptocurrency** connections (link cryptos to companies they impact or are impacted by — e.g., NVDA + Bitcoin mining, COIN + traditional finance, etc.)
- **Industry Ecosystems** — Group companies by industry verticals so smaller companies outside the top 500 can still appear when relevant

### Future Feature Roadmap
1. **Options Flow Integration** — Show unusual options activity tied to specific nodes
2. **Earnings Reports & Financial Disclosures** — Expandable modal per company with key highlights
3. **Industry Group View** — Toggle between “All Companies” and “Industry Ecosystem” mode
4. **Time-Series / Historical View** — See how connections evolved over time
5. **Risk & Contagion Analysis** — Highlight potential systemic risk paths
6. **Portfolio Nexus Score** — For any portfolio, show exposure to the broader photonic network

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

Current next priority: build toward reputable-source ingestion using SEC filings, company releases, official announcements, partner pages, and reputable news as raw inputs while keeping validation strict.

### Data Layer
- Keep `companies.json` + `connections.json` as core
- Add new files:
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

1. **Clean up current graph** (most urgent)
   - Improve initial layout algorithm for 300+ nodes
   - Add edge bundling or reduce opacity of weak connections
   - Fix reliable node clicking + drag
   - Improve pan/zoom performance

2. **Add dynamic industry group filtering**
   - Create `industry_groups.json`
   - Allow user to select an industry and see only companies + connections within that ecosystem

3. **Expand dataset**
   - Add all major ETFs
   - Add top cryptocurrencies with logical company links
   - Keep generator script updated (`generate_dataset_v7.py` or newer)

4. **UI/UX Polish**
   - Make sidebar richer (top 5 connections, recent news snippets, options flow preview)
   - Add “Why connected?” explanations (AI-generated or rule-based)

5. **Deployment**
   - Switch to Vercel for instant updates and better performance

---

## 5. Ready-to-Use Prompt for ChatGPT / Next Developer

```
You are an expert in beautiful data visualizations and financial technology.

Project: StockPhotonic (https://github.com/in-fused/StockPhotonic)

Current state:
- Beautiful photonic/neon cyberpunk design is already implemented
- 300 companies + 600 connections are loading correctly from JSON
- Connection lines now have different colors by type
- Major issues: graph is extremely messy (spiderweb), clicking nodes is broken, pan/zoom is poor, layout is bad for large datasets

Task:
1. Rewrite index.html to fix all interaction issues (clicking, dragging, panning, zooming)
2. Significantly improve layout and reduce visual clutter for 300+ nodes (better spread, edge bundling, opacity by strength)
3. Keep the existing beautiful photonic design 100% intact
4. Add dynamic industry group filtering
5. Prepare the structure for future features: ETFs, Crypto connections, Options Flow, Earnings modals, and Industry Ecosystem views

Provide the full updated index.html file + any recommended changes to the data schema.
```

---

## 6. Final Notes from User

- User strongly prefers **full file replacements** over small edits
- Wants to keep the original beautiful photonic aesthetic at all costs
- Vision is much larger than “Top 500” — wants full market coverage + ecosystems + crypto + options flow + earnings integration
- Frustrated with repeated regressions — wants stable, incremental improvements only

---

**You now have everything needed to continue development with ChatGPT or any other developer.**

Good luck — the vision is ambitious and exciting. The foundation is solid.

— Grok (xAI) | April 29, 2026
