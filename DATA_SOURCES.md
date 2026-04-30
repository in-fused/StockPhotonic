# StockPhotonic Data Sources & Provenance

**Last Updated**: April 30, 2026

**Current Version**: v5.5 / Phase 2 Real Dataset Foundation

**Current Dataset**: 60 real US-listed public companies and 117 curated connections loaded from static JSON files:

- `data/companies.json`
- `data/connections.json`

**Core Principle**: Every company must be a real public company and every connection should be traceable to a verifiable public source. Smaller verified data is preferable to larger fake or generated data.

---

## Current Dataset Reality

The current app is a static Canvas prototype. It loads company and connection data directly from JSON in the browser. There is no backend, no live ingestion, and no automatic data refresh in the current app.

### `data/companies.json`

Current company records use these fields. Market caps are static approximate display values in trillions of dollars, not live market data.

```json
{
  "id": 1,
  "ticker": "NVDA",
  "name": "NVIDIA Corporation",
  "sector": "AI / Semiconductors",
  "industry": "Graphics Processing Units and AI Accelerators",
  "market_cap": 4.5,
  "rank": 1,
  "color": "#00f9ff"
}
```

### `data/connections.json`

Current connection records use these fields:

```json
{
  "source": 1,
  "target": 6,
  "type": "supply",
  "strength": 0.9,
  "label": "HBM memory exposure for AI accelerators",
  "confidence": 5,
  "provenance": "Company disclosures and public investor materials",
  "verified_date": "2026-04-29"
}
```

Important current-field notes:

- `source` and `target` are numeric company IDs from `data/companies.json`.
- The current dataset uses `provenance`, not `source_url`.
- `provenance` is currently a short citation summary, not a per-edge URL.
- Generic relationship labels are not allowed in curated core data.
- `verified_date` is present on current edges and should remain present.
- `confidence` is an integer score from 1 to 5. Phase 2 core edges are expected to be 3 to 5.
- `strength` is a numeric score from 0 to 1.

### Current Allowed Connection Types

The current v5.4 dataset uses:

- `supply`
- `partnership`
- `ecosystem`
- `competitor`
- `investment`

Future schema versions may add `subsidiary`, `board_interlock`, and `mna`, but those are not present in the current static dataset.

---

## Future Stricter Provenance Target

The long-term target is stricter than the current Phase 2 data:

- Keep `provenance` as a concise human-readable source summary.
- Add `source_url` for each edge when a stable filing, press release, transcript, or article URL is available.
- Prefer primary-source URLs from SEC filings, company investor relations pages, earnings transcripts, and official press releases.
- Use reputable secondary sources only when primary sources are unavailable or when the edge reflects market/ecosystem context.
- Keep low-confidence inferred edges out of the core dataset or clearly flag them as experimental.

Recommended future connection shape:

```json
{
  "source": 1,
  "target": 15,
  "type": "supply",
  "strength": 0.91,
  "label": "HBM memory relationship",
  "confidence": 5,
  "provenance": "Company filings and earnings call references",
  "source_url": "https://example.com/source",
  "verified_date": "2026-04-20",
  "notes": "Optional maintainer notes"
}
```

`source_url` is therefore a recommended future enhancement, not a field that exists in the current v5.4 dataset.

---

## Confidence And Verification Expectations

Current Phase 2 expectations:

- `confidence` must be present on every connection.
- `confidence` must be an integer from 1 to 5.
- Core Phase 2 data should use confidence 3 to 5.
- `verified_date` must be present on every connection.
- `verified_date` should use ISO date format: `YYYY-MM-DD`.
- `provenance` must be present and non-empty on every connection.
- Company tickers must not use fake numeric suffixes such as `LLY132` or `AVG0146`.
- Company names must not use placeholder patterns such as `NVDA Company 1`.

Confidence guide:

| Score | Meaning |
|-------|---------|
| 5 | Direct primary-source support, such as SEC filing, company disclosure, official press release, or earnings transcript. |
| 4 | Strong public support from a reliable source, or multiple reinforcing sources. |
| 3 | Plausible curated relationship with public support, acceptable for Phase 2 but should be improved over time. |
| 2 | Inferred relationship. Future experimental layer only, not core by default. |
| 1 | Weak or speculative. Do not include in the core dataset. |

---

## Validation Plan

Dataset validation should check the static JSON files before UI or data-expansion work continues.

Required checks:

- No orphan connections: every connection must point to existing company IDs.
- No duplicate edges for the same unordered source/target/type combination.
- Valid `source` and `target` company IDs.
- `source` and `target` must not be the same company.
- Valid `strength` range: 0 to 1.
- Valid `confidence` range: 1 to 5.
- Phase 2 core confidence should be 3 to 5.
- `verified_date` present and formatted as `YYYY-MM-DD`.
- `provenance` present and non-empty.
- `type` is in the allowed current list: `supply`, `partnership`, `ecosystem`, `competitor`, `investment`.
- No duplicate tickers.
- No ticker ending in 2+ digits unless explicitly allowlisted.
- No placeholder company names matching `Company [number]`.
- No blank or generic labels such as `Supply relationship`.

Recommended warning checks:

- Companies with no connections should be reported as graph-health warnings.
- Missing optional future fields, such as `source_url`, should not fail the current v5.4 dataset.
- Stale `verified_date` values should eventually be warnings until the source refresh workflow is automated.

Run:

```bash
python scripts/validate_data.py
```

The validator uses only the Python standard library and does not modify data files.

---

## Source Tiers For Future Curation

### Tier 1: Primary Sources

Preferred for high-confidence edges:

- SEC EDGAR filings, including 10-K, 10-Q, 8-K, DEF 14A, and Exhibit 21 subsidiary lists.
- Company investor relations pages.
- Official company press releases.
- Earnings call transcripts and investor presentations.
- Public regulatory filings and exchange disclosures.

### Tier 2: Reliable Secondary Sources

Useful when primary documents are unavailable or when context is broader than a direct filing:

- Reuters
- Bloomberg
- Wall Street Journal
- Financial Times
- The Information
- Reputable industry publications with clear sourcing

### Tier 3: Experimental Or Inferred

Use only outside the default core dataset unless clearly flagged:

- Technology stack overlap.
- Broad platform ecosystem proximity.
- Analyst commentary without primary-source confirmation.
- NLP-suggested edges pending human review.

Never include pure speculation, social media rumors, or unverified analyst notes as core data.

---

## Update Cadence Target

The current Phase 2 dataset is static and manually updated. Future automation can use this target cadence:

| Data Type | Target Frequency | Method |
|-----------|------------------|--------|
| Company profile basics | Monthly or on demand | Static JSON rebuild or API-assisted script |
| Market caps and prices | Daily when live data is introduced | API-backed future layer |
| New M&A | Daily or weekly | Filing/API review |
| Subsidiaries | Quarterly | SEC Exhibit 21 / OpenCorporates / CorpWatch review |
| Curated relationships | Bi-weekly | Manual review with source capture |
| Full validation | Every data change | `scripts/validate_data.py` or successor |

---

## Known Gaps

- The current dataset has `provenance` summaries but not edge-level `source_url` values.
- Market caps are manually curated approximate display values and are not live prices.
- There is no automated source refresh or stale-edge review workflow yet.
- There is no provenance UI in the graph yet.
- The static dataset should be validated and stabilized before adding ETFs, crypto, options flow, earnings data, or larger market coverage.

---

## Contribution Expectations

For a proposed new connection, include:

- Source company ticker or ID.
- Target company ticker or ID.
- Connection type.
- Strength estimate from 0 to 1.
- Confidence score from 1 to 5.
- `provenance` summary.
- `source_url` when available.
- `verified_date`.
- One-sentence justification.

Example future contribution:

```text
NVDA -> MU
type: supply
strength: 0.80
confidence: 5
provenance: NVIDIA and Micron earnings-call commentary on HBM demand
source_url: https://example.com/source
verified_date: 2026-04-20
justification: Micron supplies high-bandwidth memory used in AI accelerator systems.
```

---

## Legal And Attribution

- Data should be derived from public filings, company disclosures, public registries, and reputable published sources.
- StockPhotonic should not redistribute proprietary bulk datasets.
- This project is for informational and research use only. It is not financial advice.
