# StockPhotonic Data Sources & Provenance

**Last Updated**: April 28, 2026

**Core Principle**: Every connection in the dataset must be traceable to a verifiable public source. No black-box data. No "trust us" edges.

---

## Tier 1: Primary Sources (Highest Confidence – Used for Core Dataset)

### 1. Financial Modeling Prep (FMP) – Free Tier
- **What**: Company profiles, market caps (daily), M&A transactions, financial statements.
- **Usage**: Live prices/market caps, historical M&A dates, basic descriptions.
- **Update Cadence**: Daily via API (250 calls/day free – sufficient).
- **Access**: https://financialmodelingprep.com/developer/docs
- **Limitations**: M&A coverage good but not exhaustive for small deals.

### 2. OpenCorporates Relationships + API
- **What**: 30M+ subsidiary, control, and ownership relationships extracted from SEC EDGAR, UK Companies House, and 140+ global registries.
- **Usage**: Parent → subsidiary edges (especially Exhibit 21 10-K filings for US public companies).
- **Update Cadence**: Weekly bulk or on-demand API for top 200 tickers.
- **Access**: https://opencorporates.com/ (free API key for light use; bulk paid but sample available).
- **Example Edge**: `BRK.B → KO` (Berkshire's long-term control stake via 13F + direct ownership disclosures).

### 3. Corporate Ownership Data (corporateownershipdata.com)
- **What**: Free, researcher-curated dataset of control and shareholdings in all US public firms (S&P 500 focus).
- **Usage**: Common ownership patterns (e.g., Vanguard/BlackRock stakes creating "invisible" links between competitors).
- **Access**: Direct download from site (S&P 500 files available as of 2026).
- **Example**: Universal ownership metrics between NVDA, MSFT, GOOGL via large index fund overlap.

### 4. SEC EDGAR + CorpWatch EX-21 (via OpenSanctions)
- **What**: Parsed Exhibit 21 subsidiary lists from every US public company's 10-K.
- **Usage**: Clean subsidiary trees for conglomerates (BRK, GE, etc.).
- **Access**: https://www.opensanctions.org/datasets/us_corpwatch/ (JSON/Parquet dumps).
- **Note**: Only companies/subs, no % ownership unless disclosed.

### 5. Company 10-K / 10-Q / Earnings Transcripts (via FMP or SEC)
- **What**: Supplier/customer disclosures in risk factors, MD&A, footnotes.
- **Usage**: High-confidence supply chain edges (e.g., "NVIDIA relies on TSMC for advanced packaging" – direct quote).
- **Example Sources**:
  - NVDA 10-K: "We depend on a limited number of third-party manufacturers..."
  - MU earnings: Explicit HBM revenue guidance tied to AI customers.

---

## Tier 2: Secondary / Curated Sources (High Confidence – Manually Verified)

### Curated Supply Chain & Ecosystem Maps (2024-2026)
- **Sources**: Company investor presentations, earnings call transcripts (verbatim), press releases, reputable journalism (Bloomberg, WSJ, Reuters, The Information).
- **Examples**:
  - NVDA ↔ TSLA: "We are using NVIDIA DRIVE Orin and Thor for next-gen vehicles" – Tesla AI Day + NVDA GTC keynotes.
  - AMZN ↔ NVDA: AWS Inferentia/Trainium + massive GPU clusters for Bedrock/SageMaker.
  - LLY ↔ UNH: Formulary inclusion of Mounjaro/Zepbound + UNH 10-K pharmacy benefit manager notes.
- **Process**: Every edge manually reviewed by project maintainer. Confidence = 4 or 5 only.

### Board Interlocks (Future – Currently Limited)
- **Current Status**: Not in core dataset (hard to parse at scale without paid BoardEx).
- **Plan**: Use SEC proxy statements (DEF 14A) for top 50 companies. Parse "Director Compensation" and "Related Person Transactions" sections.
- **Tooling**: `sec-api.io` Directors & Board Members API (free tier available).

---

## Tier 3: Experimental / Inferred (Lower Confidence – Clearly Flagged)

- **AI/Tech Ecosystem Inferences**: "Both companies are in the CUDA + PyTorch stack" → low-strength `ecosystem` edge with confidence 2 and explicit warning "Inferred from public technology stack overlap – not a formal partnership."
- **Competitor-Collab**: Rare cases where rivals have joint ventures (e.g., certain auto tech consortia).
- **Never Include**: Pure speculation, Twitter rumors, unverified analyst notes.

**Rule**: Experimental edges are hidden by default. User must toggle "Show inferred connections".

---

## Data Quality Metrics (Target for v1.0)

| Metric                        | Target | Current (v0.9) | How Measured |
|-------------------------------|--------|----------------|--------------|
| % edges with confidence ≥4    | ≥85%   | ~70%           | Validation script |
| % edges verified <60 days     | ≥70%   | 100% (manual)  | `verified_date` field |
| Orphan nodes (no connections) | 0      | 2              | Build script |
| Duplicate edges               | 0      | 0              | Hash check |
| Source URL present            | 100%   | 65%            | Schema enforcement |

**Validation Script** (`scripts/validate_connections.py`):
- Rejects any edge with confidence <3 for core dataset.
- Flags edges >90 days old.
- Checks referential integrity (source/target IDs exist).
- Computes graph health: connected components, diameter, average degree.

---

## Update Cadence & Automation

| Data Type           | Frequency | Method                  | Owner     |
|---------------------|-----------|-------------------------|-----------|
| Market Caps / Prices| Daily     | FMP API                 | Cron      |
| New M&A             | Daily     | FMP M&A endpoint        | Cron      |
| Subsidiaries        | Weekly    | OpenCorporates API      | Manual review first 3 months |
| Curated Supply/Partnerships | Bi-weekly | Manual + transcript NLP | Maintainer |
| Board Interlocks    | Quarterly | Proxy parsing           | Maintainer |
| Full Rebuild        | Monthly   | `build_graph.py`        | Maintainer |

**GitHub Action** (future): Runs validation + rebuild on every push to `data/` + nightly for prices.

---

## Known Gaps & Future Data Layers (Paid or Complex)

1. **FactSet Revere Supply Chain** – Best-in-class % revenue dependency. ~$ expensive. Consider for v2.5 if project gains traction.
2. **S&P Global Company Relationships** – 8M+ relationships. Paid.
3. **Bloomberg Supply Chain** – Enterprise level.
4. **BoardEx / Equilar** – Director interlocks with full bios. Very valuable for "trust networks" but costly.
5. **NLP on 10-K Risk Factors** – Auto-extract supplier mentions (e.g., "sole source" language). Requires LLM fine-tuning or heavy regex + human review.

**For Now**: We stay 100% free/open + manual curation for the highest-signal edges (AI infra, Berkshire, payments, pharma payers). This is actually an advantage – our data is more transparent and focused than black-box commercial datasets.

---

## How to Contribute Data (for Friends)

1. Open an issue with title `DATA: New connection NVDA ↔ XYZ`.
2. Include: Type, strength estimate, source URL or filing citation, one-sentence justification.
3. Maintainer reviews within 48h. If accepted → added with your attribution in `provenance.md`.

**Example Good Contribution**:
```
NVDA → ARM (partnership, strength 0.75)
Source: NVIDIA GTC 2026 keynote + ARM press release "NVIDIA and ARM expand collaboration on AI accelerators"
Justification: ARM IP in NVIDIA's next-gen Grace-Blackwell superchips; strategic for both in AI edge.
Confidence: 5
```

---

## Legal & Attribution

- All data derived from public SEC filings, company disclosures, and open registries.
- StockPhotonic does **not** redistribute raw bulk datasets. We only surface curated, high-signal subsets with links back to sources.
- If you use this for investment decisions: This is **not financial advice**. Data is for informational and research purposes. Always verify with primary sources.

---

**Questions?** Open an issue or DM the maintainer. This document is the single source of truth for data philosophy.