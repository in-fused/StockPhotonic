# StockPhotonic Architecture

**Project Goal**: A reliable, beautiful, insightful web application that visualizes the hidden photonic web of interconnections between the top 500+ US public companies (and key subsidiaries). Designed for personal investing insight, risk assessment, and sharing with a small trusted circle. No monetization until rock-solid.

**Core Philosophy**:
- **Photonic Aesthetic First**: Neon, glowing, particle-driven, immersive UI that makes complex networks feel alive and explorable.
- **Data Quality > Quantity**: Every connection has provenance, confidence score (1-5), type, strength, and last-verified date. "Unknown interconnections" are explicitly called out.
- **Personal Utility First**: Portfolio exposure calculator, watchlists, notes, "nexus risk" scores.
- **Pragmatic Scaling**: Start single-file / static JSON → Next.js + lightweight backend → optional graph DB.

---

## Current State (v0.9 – April 2026)

- Single `index.html` (~82KB) with embedded Canvas force-directed graph.
- 40 companies (top by market cap, April 2026 data).
- ~87 high-quality curated connections (supply, partnership, investment, ecosystem).
- Fully client-side, zero dependencies beyond CDNs (Tailwind, FontAwesome, Chart.js).
- Strengths: Stunning visual, instant load, works offline after first visit.
- Limitations: Hardcoded data, no persistence, performance ceiling ~150-200 nodes in vanilla JS, no user accounts.

**Decision**: Do **not** heavy-refactor the HTML yet. Keep it as the living prototype and "demo" entry point. Extract data to JSON immediately for maintainability.

---

## Target Architecture (v2.0 – Recommended Path)

### High-Level Stack (Chosen for Solo Dev + Free Hosting + Performance)

| Layer          | Technology                          | Why |
|----------------|-------------------------------------|-----|
| **Frontend**   | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | Best DX, server components for data, easy Vercel deploy, built-in API routes |
| **Graph Viz**  | Three.js + @react-three/fiber + drei + postprocessing (bloom, glow) | True 3D photonic experience (volumetric lights, fiber-optic edges, LOD labels). Falls back to 2D Canvas if needed. |
| **State**      | Zustand or Jotai + React Query      | Lightweight, great for filters/search |
| **Data**       | Static JSON (build-time) + optional live API routes | Fast initial load. Live prices/market caps via FMP free tier. |
| **Backend**    | Next.js API Routes (or separate FastAPI if heavy ETL) | Zero extra infra. Python scripts for ingestion. |
| **Database**   | Turso (serverless SQLite) or Supabase Postgres (free tier) | Simple SQL, easy migrations, works great with Prisma. For graph queries: recursive CTEs or in-memory NetworkX cache. |
| **Auth**       | Supabase Auth (magic links) or Clerk (free tier) | Invite-only for 5-10 friends initially. Later: public read + private notes. |
| **Hosting**    | Vercel (frontend + API) + Turso/Supabase | Free, global CDN, instant previews on PRs. |
| **Analytics**  | Plausible or Umami (self-hosted, privacy-first) | Optional, only if sharing publicly later. |

**Alternative Lightweight Path** (if you want to stay closer to current):
- Keep HTML + vanilla JS.
- Use `data/companies.json` + `data/connections.json`.
- Add a small Python/FastAPI backend only for ETL + portfolio calculations.
- Deploy as static site on GitHub Pages / Vercel.

**Recommendation**: Go Next.js. The photonic canvas code ports easily, and you'll gain routing (`/company/NVDA`, `/portfolio`, `/explore`), better mobile, component reuse, and future-proofing. The single HTML can live as `/demo` or landing page.

---

## Folder Structure (Monorepo Style – Recommended)

```
StockPhotonic/
├── app/                          # Next.js App Router (or keep root index.html as demo)
│   ├── layout.tsx
│   ├── page.tsx                  # Landing + 3D Graph
│   ├── company/[ticker]/page.tsx # Deep dive per company
│   ├── portfolio/page.tsx        # Personal exposure calculator
│   ├── api/
│   │   ├── companies/route.ts
│   │   ├── connections/route.ts
│   │   ├── subgraph/route.ts     # Ego network for a node
│   │   └── portfolio/route.ts    # Nexus exposure calc
│   └── components/
│       ├── PhotonicGraph.tsx     # Three.js canvas
│       ├── NodeModal.tsx
│       ├── Filters.tsx
│       ├── PortfolioInput.tsx
│       └── ConnectionCard.tsx
├── data/                         # Version-controlled core dataset
│   ├── companies.json            # 100-200 core nodes (expandable)
│   ├── connections.json          # 300-1000 high-quality edges
│   ├── sectors.json
│   └── provenance.md             # How each connection was sourced
├── scripts/                      # ETL & maintenance (Python)
│   ├── ingest_fmp.py             # Market caps, M&A via FinancialModelingPrep
│   ├── ingest_opencorporates.py  # Subsidiaries from OpenCorporates API
│   ├── build_graph.py            # Validate, compute centrality, export JSON
│   └── validate_connections.py   # Confidence scoring rules
├── lib/                          # Shared utils
│   ├── graph.ts                  # Centrality, community detection (via networkx WASM or API)
│   └── utils.ts
├── docs/
│   ├── ARCHITECTURE.md           # This file
│   ├── ROADMAP.md
│   ├── DATA_SOURCES.md           # Detailed provenance + update cadence
│   └── CONTRIBUTING.md           # How friends can suggest connections
├── public/
│   └── logos/                    # Company logos (or use SVG inline / Clearbit)
├── .env.example
├── next.config.js
├── package.json
└── README.md
```

**Data Flow**:
1. `scripts/build_graph.py` runs daily (GitHub Action or local cron) → updates `data/*.json` + computes metrics (degree, betweenness, PageRank per sector).
2. Next.js build includes latest JSON.
3. Client fetches live prices on demand (FMP free tier: 250 calls/day sufficient for personal use).
4. User portfolio calc happens client-side or via API route (privacy).

---

## Data Model (Core Entities)

### companies.json
```json
[
  {
    "id": 1,
    "ticker": "NVDA",
    "name": "NVIDIA Corporation",
    "sector": "Semiconductors",
    "industry": "Semiconductor Equipment & Materials",
    "market_cap": 5.264,
    "rank": 1,
    "description": "Leader in GPU computing and AI infrastructure.",
    "color": "#00f9ff",
    "cik": "1045810",
    "logo_url": null,
    "last_updated": "2026-04-28"
  }
]
```

### connections.json
```json
[
  {
    "id": 42,
    "source_id": 1,           // NVDA
    "target_id": 15,          // MU
    "type": "supply",         // supply | subsidiary | partnership | investment | board_interlock | mna | ecosystem | competitor
    "strength": 0.91,         // 0-1 (revenue dependency or strategic importance)
    "label": "HBM memory for Blackwell GPUs",
    "confidence": 5,          // 1-5 (5 = primary source doc, 1 = inferred)
    "source": "NVIDIA earnings call + Micron 10-K supplier disclosure",
    "source_url": "https://...",
    "verified_date": "2026-04-20",
    "notes": "Critical for HBM3E ramp; 40%+ of MU's high-margin revenue tied to NVDA"
  }
]
```

**Connection Types** (expand as data grows):
- `supply` – Tier-1 supplier (with % revenue if known)
- `subsidiary` – Majority ownership (>50%)
- `investment` – Significant stake (e.g., BRK 9% KO)
- `partnership` – JV, co-development, major alliance
- `board_interlock` – Shared director (future data)
- `mna` – Recent or historical M&A
- `ecosystem` – Platform (Azure + OpenAI, AWS + NVDA)
- `competitor` – Direct rival with known collab (rare but useful)

**Provenance Rules** (enforced in validation script):
- Every edge must have `source` + `confidence >= 3` for core dataset.
- Auto-flag edges >90 days old for re-verification.
- "Inferred" edges (e.g., "likely supplier because both in AI stack") have confidence 2 and visible warning.

---

## Key Features Roadmap (Prioritized for Personal Use)

**MVP (Next 3-4 weeks – Usable for daily investing)**:
1. 3D Photonic Graph (Three.js) with 80-120 nodes, 300+ edges.
2. Live market caps + 1-day change via FMP.
3. Advanced filters (sector, min degree, connection type, search fuzzy).
4. Portfolio Exposure: Paste 5-15 tickers → shows connected subgraph + "Nexus Risk Score" (weighted sum of connection strengths to your holdings).
5. Per-company modal: Full ego-network, all connections with sources, description, quick links to SEC/earnings.
6. "Share View" button: Generates URL with current filters + highlighted nodes (for friends).

**v2.1 (1-2 months)**:
- User accounts (Supabase) + private watchlists + notes on connections/companies.
- Time travel: Historical connections (M&A dates, new supply wins).
- Graph analytics panel: Top central nodes, communities ("AI Infra", "Berkshire Web", "Pharma Payer-Provider").
- Export: High-res PNG, SVG, GraphML (for Gephi), JSON subgraph.

**v2.5 (3 months)**:
- Automated daily refresh of prices + new M&A (FMP webhook or cron).
- "New Connection Alert": Email when a watched company adds a high-confidence link.
- Mobile PWA + offline support (IndexedDB cache of core graph).
- Simple NLP on latest 10-K risk factors / earnings transcripts to suggest new edges (human review required).

**Future (if traction)**:
- Paid data layers (FactSet Supply Chain, BoardEx interlocks) behind feature flag.
- Public read-only mode + "Suggest Connection" form (moderated).
- Risk modeling: Monte Carlo contagion simulation (if NVDA supply disrupted, impact on downstream?).

---

## Performance & Scalability Targets

- **Nodes**: 200 (core) → 500 (full top + key subs) → 2000+ (with paid data).
- **Edges**: 800 → 3000 → 10k+.
- **Load Time**: <1.5s initial (static JSON + code-split Three.js).
- **Interaction**: 60fps on mid-range laptop even with 300 nodes + bloom postprocessing.
- **Mobile**: Graceful degradation (2D Canvas fallback, fewer particles).

**Tech Mitigations**:
- Instanced meshes for nodes.
- LOD for labels (only show ticker when zoomed or selected).
- Edge bundling or opacity culling for dense areas.
- Web Workers for force simulation if needed.

---

## Security & Privacy (Critical for Personal Finance Data)

- Portfolio inputs never stored server-side by default (client-side calc or ephemeral session).
- If accounts enabled: All user data (watchlists, notes) encrypted at rest, row-level security via Supabase.
- No tracking pixels. Self-hosted analytics only.
- Open source everything (MIT or AGPL) so friends can self-host if paranoid.

---

## Development Workflow

1. **Local**: `npm run dev` – hot reloads, live graph updates from `data/*.json`.
2. **Data Update**: Edit JSON manually (for now) or run `python scripts/ingest_*.py`.
3. **PR Flow**: Every PR must pass `validate_connections.py` (no orphan edges, confidence >=3 for new core data, no duplicates).
4. **Deployment**: Vercel previews on every PR. Main branch auto-deploys to production.

---

## Open Questions / Decisions Needed

1. **Stack Confirmation**: Next.js + Three.js or stay vanilla HTML longer?
2. **Data Priority**: Focus first on AI/Semi supply chain (highest signal for 2026 investing) or balanced across all sectors?
3. **Hosting Budget**: $0 (Vercel + Turso free) or willing to pay $10-20/mo for premium data APIs later?
4. **Friend Onboarding**: Invite codes + magic link, or simple shared password + localStorage for v1?

---

**Next Immediate Action**: Generate expanded `companies.json` (80+ entries) + `connections.json` (300+ entries) with full provenance. This becomes the v1.0 dataset.

This architecture keeps the magic of the original photonic viz while giving us a professional, maintainable, data-rich foundation that can grow with your investing needs and the friend circle. Ready to build.