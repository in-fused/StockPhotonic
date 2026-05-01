# StockPhotonic Data Sources & Provenance

**Last Updated**: May 1, 2026

**Current Version**: v5.8 / Phase 2.2 Derived Industry-Group Intelligence Foundations

**Current Dataset**: 60 real US-listed public companies and 117 curated connections loaded from static JSON files:

- `data/companies.json`
- `data/connections.json`

**Core Principle**: Every company must be a real public company and every connection should be traceable to a verifiable public source. Smaller verified data is preferable to larger fake or generated data.

---

## Current Dataset Reality

The current app is a static Canvas prototype. It loads company and connection data directly from JSON in the browser. There is no backend, no live ingestion, and no automatic data refresh in the current app. The graph UI now surfaces edge provenance and available source links in selected-node connection rows, shows a compact dataset trust summary near the graph controls, and derives a runtime-only industry-group layer from existing company fields.

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
  "source_urls": [
    "https://investors.micron.com/news-releases/news-release-details/micron-high-volume-production-hbm4-designed-nvidia-vera-rubin"
  ],
  "verified_date": "2026-04-29"
}
```

Important current-field notes:

- `source` and `target` are numeric company IDs from `data/companies.json`.
- The current dataset uses `provenance` for every edge and optional `source_urls` for direct supporting links.
- `provenance` is a short citation summary, not a substitute for captured URLs.
- `source_urls` is optional and should contain one or more stable `http://` or `https://` URLs when direct sources are available.
- Generic relationship labels are not allowed in curated core data.
- `verified_date` is present on current edges and should remain present.
- `confidence` is an integer score from 1 to 5. Phase 2 core edges are expected to be 3 to 5.
- `strength` is a numeric score from 0 to 1.
- `industry_group` is not stored in the current schema. The UI derives an `industryGroup` value at runtime from `sector`, `industry`, `name`, and `ticker`.

### Current Allowed Connection Types

The current static dataset uses:

- `supply`
- `partnership`
- `ecosystem`
- `competitor`
- `investment`

Future schema versions may add `subsidiary`, `board_interlock`, and `mna`, but those are not present in the current static dataset.

---

## Edge-Level Source URLs

Phase 2.1 adds optional edge-level source URLs through the `source_urls` array. This field is for direct verification links such as SEC filings, company investor relations pages, official press releases, earnings materials, or reputable published articles. It is intentionally an array because a single relationship may need more than one source.

`provenance` and `source_urls` serve different purposes:

- `provenance` is the concise human-readable summary shown for every edge.
- `source_urls` is the machine-readable list of direct public links users can open to verify the edge.

Coverage is currently partial. Only a starter subset of high-impact supply, partnership, and investment edges has direct links. Missing `source_urls` values are warnings for high-confidence edges, not validation failures, until source capture coverage is broader. The future goal is direct source coverage for every confidence 4 or 5 edge before the dataset expands materially.

Do not add guessed, placeholder, or fabricated URLs. If a defensible direct URL is not available, leave `source_urls` absent and keep the provenance summary honest.

---

## Current Signal Ingestion And Scoring Pipeline

The current pipeline is intentionally staged so raw source evidence is separated from curated dataset writes:

```text
RAW INPUT -> scripts/generate_signals.py -> signal_score/source_meta -> scripts/enrich_connections.py -> scripts/validate_data.py -> data/connections.json
```

Current scripts:

- `scripts/generate_signals.py` converts raw text/source inputs into structured candidate signals with tickers, relationship type, label, strength, `source_meta`, and `signal_score`.
- `scripts/enrich_connections.py` safely converts vetted candidate signals into dataset connection records, supports dry runs and filtering, rejects duplicates, and validates the merged result before writing.
- `scripts/validate_data.py` validates the static JSON dataset and computes expected confidence from structural evidence, with optional `signal_score` adjustment when present.

Important distinction:

- `signal_score` measures the quality and priority of an ingestion signal before it becomes a curated connection. It is based on source tier and keyword strength.
- `confidence` measures the credibility of a persisted dataset connection. It is still grounded in structural evidence such as type, source URLs, and strength.
- `signal_score` can influence confidence only after the base confidence logic runs. It cannot determine confidence by itself.
- `source_meta` belongs to generated candidate signals and records the source type and tier used to score the signal. It is not required in the current static dataset.

Source tier mapping for generated signals:

| Source type | Tier |
|-------------|------|
| `sec_filing` | 1 |
| `company_release` | 1 |
| `announcement` | 1 |
| `news` | 2 |
| `partner_page` | 2 |
| `unknown` | 3 |

Signal score rules:

- Tier 1 base score: `0.9`
- Tier 2 base score: `0.75`
- Tier 3 base score: `0.6`
- Strong keywords add `0.05`.
- Moderate keywords do not change the base score.
- Scores are clamped between `0.6` and `0.95`.

Confidence interaction:

- Existing confidence rules run first.
- Optional `signal_score >= 0.9` can upgrade confidence from `4` to `5`.
- Optional `signal_score <= 0.65` can downgrade confidence from `4` or `5` to `3`.
- Confidence remains clamped between `3` and `5` for core Phase 2 data.
- Missing `signal_score` is ignored and does not invalidate data.

Useful ingestion and validation commands:

```bash
python scripts/generate_signals.py --preview
python scripts/enrich_connections.py --from-signals --dry-run
python scripts/enrich_connections.py --from-signals --dry-run --min-signal-score 0.8
python scripts/enrich_connections.py --from-signals --dry-run --min-strength 0.7 --types supply,partnership
python scripts/validate_data.py
python scripts/validate_data.py --strict-confidence
```

CLI concepts:

- `--from-signals` tells `enrich_connections.py` to use generated candidate signals instead of the static `NEW_CONNECTIONS` list.
- `--dry-run` prints the result without modifying `data/connections.json`.
- `--min-signal-score` filters generated signals before ingestion based on source quality and keyword score.
- `--min-strength` filters generated signals before ingestion based on relationship strength.
- `--types` filters generated signals to specific allowed connection types.
- `--strict-confidence` makes validator confidence mismatches fail instead of reporting warnings.

Current next priority: build toward reputable-source ingestion using SEC filings, company releases, official announcements, partner pages, and reputable news as raw inputs while keeping validation strict and dataset writes reviewable.

---

## Large-Scale Expansion Source Strategy

See `DATA_EXPANSION_PLAN.md` for the dedicated expansion plan. The short version: StockPhotonic should scale through an SEC-first source layer, candidate review queues, and validation before any broad production data writes.

Expansion principles:

- SEC EDGAR should be the primary trusted source layer for durable company and relationship records.
- Official filings and structured SEC data should be used before third-party mirrors, scraped datasets, or generated API outputs.
- SEC access must respect fair-access expectations, including caching, backoff, rate discipline, and a proper identifying `User-Agent`.
- SEC filings should be treated as the source of truth for durable relationship records when a filing directly supports the edge.
- Large expansion work should begin in source registries, candidate files, or review queues instead of direct writes to `data/companies.json` or `data/connections.json`.

### Official Ticker Universe Candidate File

`data/candidates/official_ticker_universe.json` is a review-only staging file for future public-company candidates. The app must not load it yet, and candidate validation must not promote it into `data/companies.json`.

The file currently contains a tiny reviewable official ticker sample set used only to validate the candidate-only flow. It is not production coverage and does not create graph nodes, graph edges, app-loaded data, or relationship claims.

Any future record in this file should start with `review_status: "pending"` and include ticker, company name, exchange, public-company asset type, source type, source tier, source URL, and capture date. Official exchange or listing-venue records should use `source_type: "official_exchange_listing"` with the registry-defined tier. This is candidate-company metadata only: it can stage the ticker universe, but it does not prove business relationships and cannot create production edges. Promotion to production requires source validation, duplicate checks against existing companies, manual review, normal production validation, and a separate future writer phase.

Recommended sequence:

1. Phase A: Build source registry and ingestion backlog.
2. Phase B: Add ticker universe from official or exchange-sourced listings as candidates.
3. Phase C: Add SEC filings fetch/cache layer.
4. Phase D: Add EX-21 subsidiary extraction.
5. Phase E: Add 13F ownership graph layer.
6. Phase F: Add company release/news signal extraction.
7. Phase G: Add API integrations later as optional enrichers.

Future parser/tooling candidates:

- SEC official APIs.
- `edgartools` Python library.
- Custom parser for EX-21 subsidiary exhibits.
- Custom parser for 8-K, 10-K, and S-1 signal extraction.
- 13F bulk dataset pipeline.

---

## Future Stricter Provenance Target

The long-term target is stricter than the current Phase 2 data:

- Keep `provenance` as a concise human-readable source summary.
- Add `source_urls` for each edge when stable filings, press releases, transcripts, or article URLs are available.
- Prefer primary-source URLs from SEC filings, company investor relations pages, earnings transcripts, and official press releases.
- Use reputable secondary sources only when primary sources are unavailable or when the edge reflects market/ecosystem context.
- Keep low-confidence inferred edges out of the core dataset or clearly flag them as experimental.

Recommended future connection shape:

```json
{
  "source": 1,
  "target": 6,
  "type": "supply",
  "strength": 0.90,
  "label": "HBM memory relationship",
  "confidence": 5,
  "provenance": "Company filings and earnings call references",
  "source_urls": [
    "https://investors.micron.com/news-releases/news-release-details/micron-high-volume-production-hbm4-designed-nvidia-vera-rubin"
  ],
  "verified_date": "2026-04-20",
  "notes": "Optional maintainer notes"
}
```

`source_urls` is optional in the current static dataset, but high-confidence edges should gain coverage over time.

---

## Current Derived Industry-Group Layer

Phase 2.2 adds an app-side industry-group layer without changing `data/companies.json`, `data/connections.json`, or validation scripts.

Current hierarchy:

- Sector remains the broad category.
- Industry group is a more specific derived group inside or near a sector.
- The current implementation uses deterministic keyword rules against existing company fields and falls back to the existing `industry` value when no rule matches.

The derived industry group is used for the current Industry Group control, graph highlighting, and selected-node sidebar summaries. Connected industry-group distribution, top groups by count, top groups by average edge strength, and the Industry Correlation mini-section are all derived from existing graph edges. This does not add new factual company claims, new URLs, or new relationship records.

This is a transitional layer before normalized industry-group data. A future version may add a source-backed `industry_group` field or lookup table, durable correlation records, and government/policy relation layers after validation rules and public-source requirements are defined.

---

## Future Sector And Industry-Group Source Planning

This section covers the normalized source-backed version of industry-group intelligence. The current Phase 2.2 layer is derived in the app and does not change stored data.

Hierarchy target:

- Sector remains the broad category.
- Industry group becomes the more specific breakdown inside or near each sector.
- Example healthcare industry groups: Pharmaceuticals, Insurance / Managed Care, PBM / Pharmacy Benefits, MedTech, and Life Sciences Tools.
- The current `industry` field is a descriptive company field. A future normalized `industry_group` field or lookup table may be useful, but that is not part of the stored static dataset today.

Future correlation intelligence should be source-backed before it becomes product data. Candidate relationship views include:

- Pharmaceuticals <-> Insurance / PBM
- Semiconductors <-> Cloud Infrastructure
- Energy Producers <-> Oilfield Services
- Retail <-> Payments Networks
- Aerospace OEMs <-> Suppliers

Future small-company / IPO discovery should identify smaller companies, newer IPOs, or under-followed names benefiting from large-cap ecosystems only when public evidence supports the link. Candidate signal categories include:

- Supplier exposure.
- Platform dependency.
- Government funding support.
- Strategic partnerships.
- Customer concentration.
- Ecosystem adjacency.

Future government / policy relationship planning may track public funding, grants, contracts, subsidies, regulation, defense exposure, healthcare reimbursement, energy policy, and industrial policy connections. These should remain outside the core dataset until each relationship can be tied to reviewable public sources and a clear confidence rule. Do not promote inferred policy exposure into product data as an unsupported claim.

Potential source categories for these future layers:

- SEC filings and company disclosures for customer concentration, supplier dependency, partnerships, and risk factors.
- Company investor relations materials, earnings transcripts, and official press releases for ecosystem and platform relationships.
- Public government records for grants, contracts, awards, subsidies, and agency funding.
- Regulatory publications and official policy documents for reimbursement, energy, defense, and industrial-policy exposure.
- Reputable secondary sources only when they explain context that primary sources do not capture directly.

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
- Optional `source_urls`, when present, must be a JSON array of URL strings beginning with `http://` or `https://`.
- `type` is in the allowed current list: `supply`, `partnership`, `ecosystem`, `competitor`, `investment`.
- No duplicate tickers.
- No ticker ending in 2+ digits unless explicitly allowlisted.
- No placeholder company names matching `Company [number]`.
- No blank or generic labels such as `Supply relationship`.

Recommended warning checks:

- Companies with no connections should be reported as graph-health warnings.
- Confidence 4 or 5 connections without `source_urls` should be reported as source-coverage warnings.
- Stale `verified_date` values should eventually be warnings until the source refresh workflow is automated.

Run:

```bash
python scripts/validate_data.py
```

The validator uses only the Python standard library and does not modify data files.

---

## Source Tiers For Future Curation

### Tier 1: Primary And Durable Sources

Preferred for high-confidence edges:

- SEC EDGAR company submissions API.
- SEC 10-K, 10-Q, 8-K, S-1, and 424B filings.
- SEC EX-21 subsidiary exhibits.
- SEC 13F datasets for institutional ownership networks.
- Company investor relations releases.
- Official company partner, customer, supplier, and ecosystem pages.

### Tier 2: Reliable Secondary And Context Sources

Useful when primary documents are unavailable or when context is broader than a direct filing:

- Reuters
- Bloomberg
- Wall Street Journal
- Financial Times
- The Information
- Reputable industry publications with clear sourcing
- Exchange and official company profile datasets
- OpenSanctions, CorpWatch-style, or similar ownership mirrors only when traceable back to original filings or public registries

### Tier 3: Discovery-Only Or Experimental Sources

Use only outside the default core dataset unless clearly flagged:

- Kaggle or community datasets.
- Scraped third-party datasets.
- Unverified API outputs.
- Any source without clear provenance.
- Technology stack overlap, broad ecosystem proximity, or NLP-suggested edges pending human review.

Never include pure speculation, social media rumors, or unverified analyst notes as core data.

---

## Future Relationship Categories

The current production dataset should keep using only currently validated connection types. Future expansion planning should define source rules and validation rules before supporting additional categories:

- Subsidiary / ownership.
- Institutional ownership / shared holder.
- Supplier / customer.
- Strategic partnership.
- Investment.
- Competitor / peer.
- Government contract / public funding.
- IPO / underwriting / capital markets relation.
- Crypto / mining / blockchain exposure.
- ETF / holdings exposure.

No new category should enter `data/connections.json` until it has source requirements, validation behavior, confidence rules, and manual review expectations.

---

## Expansion Guardrails

- No source-backed edge enters `data/connections.json` without URL or durable provenance, confidence, and `verified_date`.
- Third-party data must preserve original source attribution.
- Datasets must pass validation before commit.
- Large expansions should start in candidate files or review queues, not directly in production data.
- Manual review remains required before durable dataset writes.
- Do not add fake companies, unsupported relationships, placeholder source records, or inferred edges to the core dataset.

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

- Edge-level `source_urls` coverage is partial and currently focused on a starter subset of high-impact edges.
- Market caps are manually curated approximate display values and are not live prices.
- There is no automated source refresh or stale-edge review workflow yet.
- Some current provenance summaries still need direct source URL capture.
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
- `source_urls` when available.
- `verified_date`.
- One-sentence justification.

Example future contribution:

```text
NVDA -> MU
type: supply
strength: 0.80
confidence: 5
provenance: NVIDIA and Micron earnings-call commentary on HBM demand
source_urls:
  - https://investors.micron.com/news-releases/news-release-details/micron-high-volume-production-hbm4-designed-nvidia-vera-rubin
verified_date: 2026-04-20
justification: Micron supplies high-bandwidth memory used in AI accelerator systems.
```

---

## Legal And Attribution

- Data should be derived from public filings, company disclosures, public registries, and reputable published sources.
- StockPhotonic should not redistribute proprietary bulk datasets.
- This project is for informational and research use only. It is not financial advice.
