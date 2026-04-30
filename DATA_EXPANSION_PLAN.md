# StockPhotonic Data Expansion Plan

**Last Updated**: April 30, 2026

**Purpose**: Prepare StockPhotonic for many more real US-listed companies and source-backed relationships without adding unverified companies, unsupported connections, or placeholder source records.

This plan is strategy only. It does not authorize writing new companies to `data/companies.json` or new edges to `data/connections.json` until source capture, validation, and manual review are ready.

---

## SEC-First Source Strategy

SEC EDGAR should be the primary trusted source layer for durable company and relationship records. StockPhotonic should prioritize official filings and structured SEC data before third-party mirrors, vendor APIs, scraped datasets, or generated signals.

Core principles:

- Treat SEC filings as the source of truth for durable relationship records when a filing directly supports the relationship.
- Prefer official SEC EDGAR APIs, filing URLs, company submissions data, and filing exhibits before third-party copies.
- Respect SEC fair-access rules for automated access, including rate limits, caching, backoff, and a proper identifying `User-Agent`.
- Cache fetched filings and derived extracts so repeated validation and parser work does not repeatedly hit SEC endpoints.
- Preserve accession numbers, filing dates, form types, source URLs, and extraction notes with every candidate record.
- Use third-party sources only as discovery or enrichment unless they trace clearly back to an original filing or company disclosure.

---

## Recommended Source Tiers

### Tier 1: Primary And Durable Sources

Use these first for high-confidence company records and durable relationship edges:

- SEC EDGAR company submissions API.
- SEC 10-K, 10-Q, 8-K, S-1, and 424B filings.
- SEC EX-21 subsidiary exhibits.
- SEC 13F datasets for institutional ownership networks.
- Company investor relations releases.
- Official company partner, customer, supplier, and ecosystem pages.

### Tier 2: Reputable Context And Verification Sources

Use these for confirmation, context, or relationships not fully captured by filings:

- Reputable financial and business news sources.
- Exchange and official company profile datasets.
- OpenSanctions, CorpWatch-style, or similar ownership mirrors only when the record is traceable back to original filings or public registries.

### Tier 3: Discovery-Only Or Experimental Sources

Use these only for candidate discovery unless independently verified by Tier 1 or strong Tier 2 evidence:

- Kaggle or community datasets.
- Scraped third-party datasets.
- Unverified API outputs.
- Any source without clear provenance, capture date, and original-source attribution.

Tier 3 data must not enter production graph data as a durable relationship without independent source verification.

---

## Relationship Categories To Support

Future expansion should support a broader taxonomy while keeping each category source-backed and validated before use in production data:

- `subsidiary` / ownership.
- Institutional ownership / shared holder.
- Supplier / customer.
- Strategic partnership.
- Investment.
- Competitor / peer.
- Government contract / public funding.
- IPO / underwriting / capital markets relation.
- Crypto / mining / blockchain exposure.
- ETF / holdings exposure.

Each category needs a source policy before it becomes a production `type`. For example, subsidiary relationships should be filing-backed, ETF holdings should come from issuer holdings files or official fund disclosures, and government contract edges should point to public award or agency records.

---

## Tooling Direction

Recommended future parser and ingestion candidates:

- SEC official APIs for company submissions, filing metadata, and structured access.
- `edgartools` Python library for filing discovery and parsing support.
- Custom parser for EX-21 subsidiary exhibits.
- Custom parser for 8-K, 10-K, and S-1 signal extraction.
- 13F bulk dataset pipeline for institutional ownership and shared-holder graph layers.

Implementation expectations:

- Keep raw source fetch, candidate extraction, candidate review, and production writes as separate stages.
- Store fetched source metadata with candidate records, including URL, form type, filing date, accession number when available, extraction method, and capture date.
- Prefer deterministic parsers for durable extraction; use LLM or NLP assistance only for candidate surfacing that remains review-gated.
- Build idempotent fetch/cache behavior before large universe expansion.

---

## Expansion Sequence

### Phase A: Source Registry And Ingestion Backlog

Create a registry of allowed source types, source tiers, fetch rules, required metadata fields, and relationship categories. Track candidate ingestion tasks before adding companies or edges to production JSON.

### Phase B: Official Ticker Universe

Add a ticker universe from official or exchange-sourced listings in candidate form first. Do not write the full universe directly into `data/companies.json`.

### Phase C: SEC Filings Fetch/Cache Layer

Build a fair-access SEC fetch/cache layer with a proper identifying `User-Agent`, retry/backoff, local cache keys, and metadata capture.

### Phase D: EX-21 Subsidiary Extraction

Parse subsidiary exhibits into candidate ownership records. Keep ambiguous names, foreign subsidiaries, ticker matching, and parent-child normalization in review queues until resolved.

### Phase E: 13F Ownership Graph Layer

Build institutional ownership and shared-holder candidates from SEC 13F data. Keep this as a separate graph layer because shared holder exposure is not the same as direct business relationship.

### Phase F: Company Release And News Signal Extraction

Use official company releases, investor relations pages, and reputable news as source-backed signal inputs for supplier/customer, partnership, customer, and ecosystem candidates.

### Phase G: Optional API Enrichers

Add vendor or third-party APIs only after the SEC and official-source foundation exists. API output should enrich, refresh, or prioritize candidate review, not replace provenance.

---

## Guardrails

Production data must remain smaller and more trustworthy than any unreviewed expansion candidate set.

Required guardrails:

- No source-backed edge enters `data/connections.json` without URL or durable provenance, confidence, and `verified_date`.
- Third-party data must preserve original source attribution and must not obscure the underlying filing, disclosure, or registry.
- Datasets must pass validation before commit.
- Large expansions should start in candidate files or review queues, not directly in production data.
- Manual review remains required before durable writes to `data/companies.json` or `data/connections.json`.
- Never add fake companies, fake tickers, inferred connections, placeholder source URLs, or unsupported relationship labels.
- Keep experimental layers separate from the core graph until schema, validation, and source requirements are settled.

---

## Candidate Record Expectations

Before an extracted relationship is eligible for manual review, it should include:

- Source ticker or company identifier.
- Target ticker or company identifier.
- Proposed relationship category.
- Source tier.
- Form type or source type.
- Source URL.
- Filing date or publication date.
- Capture date.
- Extracted evidence text or concise extraction note.
- Confidence proposal.
- Reviewer status.

Production records should only be created after a reviewer confirms the companies, relationship type, source support, and current validation rules.

