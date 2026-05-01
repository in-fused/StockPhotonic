# StockPhotonic Data Expansion Plan

**Last Updated**: May 1, 2026

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

Add a ticker universe from official or exchange-sourced listings in candidate form first. Use `official_exchange_listing` for official exchange or listing-venue source records. This source type is candidate-company metadata only; it can stage public-company tickers but does not prove relationships and cannot create production edges. Do not write the full universe directly into `data/companies.json`.

### Phase D1: Official Ticker Universe Candidate Foundation

`data/candidates/official_ticker_universe.json` is the staging foundation for future broad public-company coverage. It is candidate-only, is not loaded by the app, and must not directly modify `data/companies.json` or `data/connections.json`.

Production promotion from this file requires source validation, duplicate checks, manual review, production validation, and an explicit future writer phase. The current candidate ingestion support validates the file as a dry run only.

Dry-run validation commands:

```bash
python scripts/ingest_candidates.py --candidates data/candidates/official_ticker_universe.json
python scripts/ingest_candidates.py --candidates data/candidates/official_ticker_universe.json --summary-only
```

### Phase D5: SEC Fetch Cache Foundation

`scripts/sec_fetch_cache.py` provides a read-only SEC fetch/cache foundation for future source-backed extraction. It is opt-in infrastructure only: it does not create candidate records, does not extract or promote relationships, and does not write `data/companies.json` or `data/connections.json`.

Use dry run first:

```bash
python scripts/sec_fetch_cache.py --cik 0000320193 --user-agent "Your Name your.email@example.com" --dry-run
```

Fetch only when the exact SEC submissions endpoint and cache path are acceptable:

```bash
python scripts/sec_fetch_cache.py --cik 0000320193 --user-agent "Your Name your.email@example.com"
```

The helper requires an explicit identifying `--user-agent`, avoids refetching an existing cache file unless `--force-refresh` is passed, and writes cached SEC responses under `data/cache/sec/` by default. Cached SEC responses should not be committed unless a future reviewed phase explicitly approves them.

Cache review workflow:

- `data/cache/sec/` is local cache space for raw SEC source artifacts.
- Cached SEC responses are ignored by default and should stay out of commits during normal development.
- Raw cache files are not candidates and are not production data.
- Future extraction phases should read cached source files and emit candidate JSON separately, with review status and source metadata, before any production graph write is considered.
- A future reviewed phase may explicitly approve committing selected cache artifacts if the project needs durable fixtures or auditable source snapshots.

### Phase D9: Local Data Provisioner Dry-Run Orchestrator

`scripts/provision_data.py` is a manual local provisioner for safe data-foundation checks. It coordinates candidate validation and SEC cache dry-run planning without importing app code, promoting candidates, extracting relationships, scheduling work, or writing production graph data.

Default usage is dry-run-first:

```bash
python scripts/provision_data.py
python scripts/provision_data.py --summary-only
python scripts/provision_data.py --ticker AAPL
python scripts/provision_data.py --ticker AAPL --allow-network --user-agent "Your Name your.email@example.com"
```

In default mode, the provisioner validates `data/candidates/official_ticker_universe.json` and `data/candidates/cik_mappings.json`, previews SEC cache targets through `scripts/sec_fetch_cache.py --dry-run`, and reports production writes as zero. Network-enabled cache fetches require explicit `--allow-network` and an identifying `--user-agent`, and are limited to CIK mappings with `review_status: "approved_for_fetch"`. Scheduling or automated refresh behavior remains a future phase after manual dry-run safety is proven.

### Phase D10: SEC Submissions Cache Inspector

`scripts/sec_submissions_inspect.py` is a read-only inspector for cached SEC submissions JSON files under `data/cache/sec/`. It performs no network calls, creates no candidates, extracts no relationships, and writes no production graph data.

Use it to identify available filings for future parser phases:

```bash
python scripts/sec_submissions_inspect.py --cache-file data/cache/sec/submissions_CIK0000320193.json --forms 10-K,10-Q,8-K --limit 10
```

The inspector reports CIK, company name, tickers, recent filing count, form breakdown, latest filing date, and recent filing metadata such as form, filing date, accession number, primary document, and report date when present. It is an inventory tool only; parser selection, candidate creation, and production writes remain separate future phases.

### Phase D11: SEC Filing Download Plan Generator

`scripts/sec_filing_plan.py` is a read-only planning tool for cached SEC submissions JSON files. It selects recent filings by form type and prints deterministic SEC archive URLs for review without downloading filing documents, creating relationship candidates, extracting relationships, or writing production graph data.

Default usage writes nothing:

```bash
python scripts/sec_filing_plan.py --cache-file data/cache/sec/submissions_CIK0000320193.json --forms 10-K,10-Q,8-K --limit 10
python scripts/sec_filing_plan.py --cache-file data/cache/sec/submissions_CIK0000320193.json --forms 10-K --json
```

Optional `--output` writes only a plan artifact under `data/candidates/plans/` and refuses paths outside that directory. Plan artifacts are review/planning records only; they are not candidate records and do not authorize filing downloads or production writes.

### Phase D12: SEC Filing Fetcher From Approved Plan

`scripts/sec_filing_fetch.py` reads a reviewed filing download plan artifact from `data/candidates/plans/` and fetches only the listed SEC archive documents into `data/cache/sec/filings/`. It makes no network calls by default, creates no candidates, extracts no relationships, and writes no production graph data.

Preview a reviewed plan without network access:

```bash
python scripts/sec_filing_fetch.py --plan data/candidates/plans/aapl_recent_filings.json
```

Fetch only after the exact plan-listed downloads are acceptable:

```bash
python scripts/sec_filing_fetch.py --plan data/candidates/plans/aapl_recent_filings.json --allow-network --user-agent "Your Name your.email@example.com"
```

Network-enabled fetches require both `--allow-network` and an identifying `--user-agent`, validate the approved plan shape, enforce SEC archive host/path checks, skip existing cache files unless `--force-refresh` is passed, and write only raw filing cache artifacts plus metadata sidecars under `data/cache/sec/filings/`. Downloaded filings are not candidate records and not production data; future parser phases should read the cache and emit candidate JSON separately.

### Phase D13: SEC Filing Cache Inspector

`scripts/sec_filing_inspect.py` is a read-only inspector for one downloaded SEC filing cache document under `data/cache/sec/filings/`. It reads local cache files and optional metadata sidecars only, performs no network calls, creates no candidates, extracts no relationships, and writes no production graph data.

Use it to preview filing contents before parser phases:

```bash
python scripts/sec_filing_inspect.py --file data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --search "supplier"
```

The inspector reports file size, cache-root status, detected text/HTML/XML-ish content type, selected metadata fields, bounded content preview, optional search snippets, and safety counters. It is a cache preview tool only; candidate creation and production writes remain separate future phases.

### Phase D15: SEC Filing Signal Report Aggregator

`scripts/sec_signal_report.py` is a read-only report tool for one or more downloaded SEC filing cache documents under `data/cache/sec/filings/`. It reuses the existing deterministic filing signal extractor, reads optional sibling metadata sidecars for filing-date recency, aggregates total signals by type, ranks the strongest snippets by `confidence_hint`, keyword frequency, and recency when available, and prints the report to stdout only.

Default usage writes nothing:

```bash
python scripts/sec_signal_report.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm
python scripts/sec_signal_report.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --limit-chars 50000 --json
```

The report aggregator makes no network calls, creates no candidate records, writes no production graph data, and reports safety counters for `network_calls`, `candidate_records_created`, and `production_writes`. It is a review and prioritization tool only; candidate extraction and production writes remain separate future phases.

### Phase D16: SEC Signal Candidate Preview Generator

`scripts/sec_signal_candidates_preview.py` is a preview-only converter from read-only SEC signal report snippets to relationship candidate-shaped objects. It accepts one or more cached filing documents under `data/cache/sec/filings/`, reuses the safe signal report path, reads optional sibling metadata sidecars, and prints preview objects to stdout only.

Default usage writes nothing:

```bash
python scripts/sec_signal_candidates_preview.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm
python scripts/sec_signal_candidates_preview.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --limit-chars 50000 --json
```

Preview objects include metadata-derived `source_ticker`, `filing_date`, and `accession_number` when available, `target_ticker: null`, a signal-derived `relationship_type`, `source_type: "sec_filing"`, `source_tier: 1`, `confidence_hint`, `evidence_snippet`, and `review_status: "preview_only"`. Safety counters report `network_calls: 0`, `candidate_files_written: 0`, and `production_writes: 0`; the generator makes no network calls, writes no candidate files, and writes no production graph data.

### Phase D17: SEC Signal Candidate File Writer

`scripts/sec_signal_candidates_write.py` is the explicit review-gated writer for SEC signal candidate previews. It accepts one or more cached filing documents under `data/cache/sec/filings/`, reuses the safe preview path, and writes no data by default. Default mode prints only the would-be candidate records to stdout.

Dry-run preview before writing:

```bash
python scripts/sec_signal_candidates_write.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm
python scripts/sec_signal_candidates_write.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --limit-chars 50000
```

Write only after the preview is acceptable:

```bash
python scripts/sec_signal_candidates_write.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --write --force
```

The writer saves only `data/candidates/sec_relationship_candidates.json`, refuses to overwrite an existing candidate file unless `--force` is passed, and records candidates with `review_status: "pending_review"`. The candidate file is review-only metadata and candidate records: it includes `status: "candidate_only"`, `production_write_allowed: false`, `app_load_allowed: false`, and safety counters for `network_calls: 0` and `production_writes: 0`. It must not create production nodes, create production edges, modify `data/companies.json`, modify `data/connections.json`, or change app/UI/rendering behavior.

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
- Broad market coverage begins with `data/candidates/official_ticker_universe.json`, but that file remains review/staging only until a future reviewed writer phase exists.
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
