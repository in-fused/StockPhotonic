# StockPhotonic Data Expansion Plan

**Last Updated**: May 3, 2026

**Purpose**: Prepare StockPhotonic for many more real US-listed companies and source-backed relationships without adding unverified companies, unsupported connections, or placeholder source records.

This plan is strategy only. It does not authorize writing new companies to `data/companies.json` or new edges to `data/connections.json` until source capture, validation, and manual review are ready.

---

## Phase V1: Source Intelligence Workbench

V1 adds an in-app Source Intelligence Workbench for product visibility and local command guidance. It recommends the one-command SEC pipeline runner, bulk local runner, local job runner, and scheduled-run preview for dry-run-first work, summarizes the advanced manual SEC lookup/cache -> filing plan -> filing fetch -> filing inspect -> signal report -> candidate preview -> candidate writer path, and makes the candidate-only file locations visible to non-technical users.

The workbench is read-only. It does not run scripts from the browser, fetch SEC data from the browser, add backend/server code, promote candidates, create production nodes or edges, or modify `data/companies.json` or `data/connections.json`. Any displayed candidate records remain review-only and must not be treated as graph data unless an explicit reviewed promotion phase, such as Phase D24, runs outside the browser.

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

`scripts/sec_signal_candidates_preview.py` is a preview-only converter from read-only SEC signal report snippets to relationship candidate-shaped objects. It accepts one or more cached filing documents under `data/cache/sec/filings/`, reuses the safe signal report path, reads optional sibling metadata sidecars, filters to high-confidence graph-worthy candidates, and prints preview objects to stdout only.

Default usage writes nothing:

```bash
python scripts/sec_signal_candidates_preview.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm
python scripts/sec_signal_candidates_preview.py --files data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm --limit-chars 50000 --json
```

Preview objects include metadata-derived `source_ticker`, `filing_date`, and `accession_number` when available, a signal-derived `relationship_type`, `relationship_signal`, `source_type: "sec_filing"`, `source_tier: 1`, `confidence_hint`, `evidence_snippet`, and `review_status: "preview_only"`. The preview keeps only records with deterministic entity resolution to a production company: `target_ticker`, `target_name`, `target_entity_mention`, and preview-only `target_match_confidence >= 0.75` must all be present. Preview output is capped per source ticker and overall to keep Batch 1 reviewable. Safety counters report `network_calls: 0`, `candidate_files_written: 0`, and `production_writes: 0`; the generator makes no network calls, writes no candidate files, and writes no production graph data.

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

The writer saves only `data/candidates/sec_relationship_candidates.json`, refuses to overwrite an existing candidate file unless `--force` is passed, records candidates with `review_status: "pending_review"`, and persists only preview candidates that have resolved target fields with `target_match_confidence >= 0.85`. This keeps the preview threshold lower for inspection while preserving the stricter candidate-file and promotion-grade floor. The candidate file is review-only metadata and candidate records: it includes `status: "candidate_only"`, `production_write_allowed: false`, `app_load_allowed: false`, and safety counters for `network_calls: 0` and `production_writes: 0`. It must not create production nodes, create production edges, modify `data/companies.json`, modify `data/connections.json`, or change app/UI/rendering behavior.

### Phase D19: SEC Candidate Entity Resolution Preview

The SEC signal candidate preview generator now extracts deterministic legal-entity mentions from evidence snippets, resolves clear matches against `data/companies.json` in read-only mode, and keeps XBRL unit/inline-tag metadata from dominating the preview ranking.

The preview matcher uses production company names, tickers, and any alias fields already present in company records. It may also use small deterministic public aliases only when the corresponding production ticker already exists, such as resolving `Google LLC` evidence to the existing Alphabet/Google production ticker. Matched previews add `target_name`, `target_match_method`, `target_match_confidence`, and `target_entity_mention`; later filtering keeps only resolved matches that meet the current confidence threshold.

This phase does not modify `data/companies.json`, does not modify `data/connections.json`, does not add production nodes or edges, performs no network calls, and does not write candidate files by default. The explicit writer remains review-gated behind `--write` and carries forward preview-resolution fields only for retained candidates.

### Phase D21: One-Command SEC Pipeline Runner

`scripts/sec_pipeline_run.py` is a safe local orchestrator for running the existing SEC workflow for one ticker through candidate preview and optional review-only candidate writing. It delegates to the existing validation, submissions fetch/inspect, filing plan/fetch, signal report, candidate preview, and candidate writer scripts instead of duplicating SEC parsing logic.

Default usage is dry-run/preview first:

```bash
python scripts/sec_pipeline_run.py --ticker AAPL --forms 10-K,10-Q,8-K --limit 10
python scripts/sec_pipeline_run.py --ticker AAPL --forms 10-K,10-Q,8-K --limit 10 --allow-network --user-agent "Your Name your.email@example.com"
python scripts/sec_pipeline_run.py --ticker AAPL --forms 10-K,10-Q,8-K --limit 10 --allow-network --user-agent "Your Name your.email@example.com" --write-candidates --force
```

Network calls require both `--allow-network` and an identifying `--user-agent`. Candidate file output requires `--write-candidates` and writes only `data/candidates/sec_relationship_candidates.json` through the existing review-only writer. The runner may create a temporary filing plan artifact solely to satisfy the existing filing fetcher's reviewed-plan input contract, then removes that temporary artifact before exit. It does not modify `data/companies.json`, does not modify `data/connections.json`, does not add production nodes or edges, does not add backend/server code, and does not run from the browser.

### Phase D22: SEC Candidate Promotion Preview Validator

`scripts/sec_candidate_promotion_preview.py` is a preview-only validator for review-only SEC relationship candidates. It reads `data/candidates/sec_relationship_candidates.json` by default, reads the candidate-only `data/candidates/sec_automation_policy.json` gate when present, validates the file's candidate-only metadata, checks candidate endpoints against `data/companies.json`, checks duplicate edge keys against `data/connections.json`, deduplicates same-pair candidates to the strongest retained record, and prints which unique records could later become production edge shapes after manual review.

Default usage writes nothing:

```bash
python scripts/sec_candidate_promotion_preview.py
python scripts/sec_candidate_promotion_preview.py --json
```

The validator does not promote candidates, does not create production nodes or edges, does not modify `data/companies.json` or `data/connections.json`, performs no network calls, and adds no backend/server code. `supplier_customer` candidates remain blocked unless deterministic evidence terms map them clearly to the current production `supply` or `partnership` types, and share issuance or ownership evidence maps to `investment`. Policy classifications are additional preview metadata and do not authorize production writes.

### Phase D23: High-Confidence SEC Candidate Filtering

The SEC candidate preview and writer retain only graph-worthy relationship candidates, with different thresholds by stage. Preview records are discarded when the target ticker is unresolved, the target name is missing, the preview target match confidence is below `0.75`, evidence lacks a resolvable named entity, or the snippet is dominated by generic depends-on/suppliers/customers/vendors language, internal-operations phrasing, accounting-only phrases such as `revenue from contracts`, or XBRL artifacts. The writer persists only candidates that remain at `target_match_confidence >= 0.85`.

`supplier_customer` signals are no longer carried forward as generic candidate types. They map to `partnership` only when evidence contains licensing, revenue, search-distribution, or payment terms; they map to `supply` only when evidence contains supply, manufacturing, sourced-components, or component-supplier terms; otherwise they are discarded from candidate preview and blocked by promotion preview. Investment-specific evidence such as share issuance, common-stock sale, equity investment, cash purchase price, or ownership stake maps to `investment` before broader partnership/supplier labels are accepted.

This phase is still preview/review-only. It performs no network calls, does not auto-promote candidates, does not modify `data/companies.json`, does not modify `data/connections.json`, and does not write candidate files unless the explicit writer receives `--write`.

### Phase D24: Controlled SEC Candidate Promotion To Graph

`scripts/sec_candidate_promote.py` is the explicit production writer for validated SEC relationship candidates. It reads `data/candidates/sec_relationship_candidates.json`, maps candidate source and target tickers to existing production company IDs, checks current `data/connections.json` for duplicate edge keys, and writes only `data/connections.json` when `--write` is passed.

Default usage is dry-run-first:

```bash
python scripts/sec_candidate_promote.py
python scripts/sec_candidate_promote.py --write
```

Promotion is allowed only when the candidate has a resolved `target_ticker`, `target_match_confidence >= 0.85`, evidence text, a valid filing date, a valid `confidence_hint`, source and target tickers already present in `data/companies.json`, and a relationship type that maps deterministically to current production `partnership`, `supply`, or `investment`. The writer prevents existing production duplicates, suppresses weaker duplicate candidates for the same normalized production edge key within the same run, performs no network calls, never modifies `data/companies.json`, and keeps `--write` explicit and manual. Dry-run and JSON output can include the automation policy classification, but the policy does not make production writes automatic.

Phase D24 promoted one AAPL -> GOOGL `partnership` edge for the SEC filing licensing/search distribution relationship. A post-write dry run reports the resolved AAPL -> GOOGL candidates as existing duplicates, so reruns do not add another edge.

### Phase D25: Bulk SEC Pipeline Batch Runner

`scripts/sec_bulk_pipeline_run.py` is a safe local batch wrapper for running multiple approved ticker/CIK mappings through the existing single-ticker SEC pipeline. It reads `data/candidates/cik_mappings.json`, processes only requested tickers with `review_status: "approved_for_fetch"`, and delegates each approved ticker to `scripts/sec_pipeline_run.py`.

Default usage is dry-run/preview first:

```bash
python scripts/sec_bulk_pipeline_run.py --tickers AAPL,MSFT,NVDA --forms 10-K,10-Q,8-K --limit 10
python scripts/sec_bulk_pipeline_run.py --tickers AAPL,MSFT,NVDA --forms 10-K,10-Q,8-K --limit 10 --allow-network --user-agent "Your Name your.email@example.com" --write-candidates --force
```

Network calls require both `--allow-network` and an identifying `--user-agent`. Candidate file output requires `--write-candidates`; when enabled, the batch writes one combined review-only candidate file from successfully processed cached filings. Requested tickers with no mapping or no usable filings are skipped with an explicit summary reason. The runner reports requested, processed, skipped, and failed tickers, whether candidate files were written, and `production writes: 0`. It does not auto-promote candidates, does not modify `data/companies.json`, does not modify `data/connections.json`, does not add backend/server code, and does not run from the browser.

### Phase D26: Local SEC Job Manifest + Run Log

`data/candidates/sec_jobs.json` defines reviewed local SEC batch jobs, and `scripts/sec_job_run.py` runs one job by manifest id through the existing bulk runner. This phase is repeatable local orchestration only: it adds no backend/server code, adds no browser execution path, writes no production graph data, and does not promote candidates.

Default usage is dry-run/preview first:

```bash
python scripts/sec_job_run.py --job-id mega_cap_core
python scripts/sec_job_run.py --job-id batch_1_multi_sector
python scripts/sec_job_run.py --job-id batch_1_multi_sector_fast
python scripts/sec_job_run.py --job-id batch_1_multi_sector_deep
python scripts/sec_job_run.py --job-id batch_1_multi_sector_fast --allow-network --user-agent "Your Name your.email@example.com" --write-candidates --force
python scripts/sec_job_run.py --job-id batch_1_multi_sector_deep --allow-network --user-agent "Your Name your.email@example.com" --write-candidates --force
```

The job runner reads only jobs with `review_status: "approved_for_local_run"`, refuses unknown or unapproved jobs, refuses `--allow-network` without `--user-agent`, and refuses `--force` unless `--write-candidates` is present. It prints the exact delegated `scripts/sec_bulk_pipeline_run.py` command before running it. `mega_cap_core` remains the starter job; `batch_1_multi_sector` is the standard/default Batch 1 job; `batch_1_multi_sector_fast` is the explicit fast Batch 1 job at limit 10; and `batch_1_multi_sector_deep` is the deeper Batch 1 job at limit 25. In these jobs, `limit` means filings reviewed per ticker after form filtering, not a cap on relationships found. Each delegated run writes a local audit log under `data/candidates/run_logs/` with timestamp, job id, tickers, forms, limit, mode, candidate-writing yes/no, return code, and `production_writes: 0`. Run logs are candidate/local audit artifacts only and are not app-loaded data.

### Phase D27: Expand CIK Mapping Coverage

`data/candidates/cik_mappings.json` now includes approved SEC submissions endpoint mappings for AAPL, MSFT, and NVDA so bulk and job runners can process the current mega-cap core ticker set instead of skipping MSFT or NVDA as unmapped.

The added mappings are starter approved mappings only, not the long-term company universe. Future scale work should add more reviewed CIK mappings and job manifests before broader automated ingestion. The mappings remain candidate/reference-only records with `source_type: "sec_filing"`, `source_tier: 1`, SEC submissions URLs, capture dates, and `review_status: "approved_for_fetch"`. Candidate-only metadata remains unchanged: production writes are not allowed, app loading is not allowed, and duplicate ticker/CIK validation continues to gate the file before any local fetch workflow uses it.

### Phase D28: SEC Automation Policy + Promotion Gate

`data/candidates/sec_automation_policy.json` defines a candidate-only policy layer for future SEC relationship promotion decisions. It sets `status: "candidate_only"`, keeps `production_write_allowed`, `app_load_allowed`, and `auto_promotion_enabled` false, and classifies candidates as `future_auto_promotable_preview`, `manual_review_required`, or `blocked`.

This phase is a gate, not automation execution. A candidate is only future-auto-promotable in preview when it is a Tier 1 `sec_filing` candidate with a production source and target ticker, `target_match_confidence >= 0.92`, `confidence_hint >= 0.85`, `relationship_type` of `partnership` or `supply`, at least one SEC archive URL in `source_urls`, evidence text, filing date, and no duplicate existing production edge. Lower confidence, missing URLs, ambiguous relationships, multiple possible target entities, existing production-edge conflicts, or relationship categories outside the gate require manual review. Missing production endpoints, missing evidence, unsupported types, or generic supplier/customer/dependency language only are blocked.

The future automation path remains staged:

```text
scheduled preview -> scheduled run -> candidates -> policy preview -> manual/auto promotion gate -> validation -> optional commit
```

The policy file does not schedule runs, fetch SEC data, run in the browser, add backend/server code, load in the app, modify `data/companies.json`, modify `data/connections.json`, or make `--write` automatic.

### Phase D29: SEC Scheduled Run Plan + Safe Auto-Promotion Dry Run

`data/candidates/sec_schedule.json` defines a candidate-only local schedule plan for reviewed SEC job cadence. It is a planning artifact only: `production_write_allowed`, `app_load_allowed`, `auto_execution_enabled`, and `auto_promotion_enabled` stay false, and no browser, backend, hosted worker, or automatic runner reads it.

`scripts/sec_scheduled_run_preview.py` reads the schedule plan, `data/candidates/sec_jobs.json`, and `data/candidates/sec_automation_policy.json`, then simulates the staged path without executing it:

```text
scheduled run -> job runner command -> candidate generation -> promotion preview -> policy gate -> validation command -> optional commit plan
```

Default usage is dry-run/preview first:

```bash
python scripts/sec_scheduled_run_preview.py --schedule-id weekly_mega_cap_core_preview
python scripts/sec_scheduled_run_preview.py --schedule-id weekly_mega_cap_core_preview --json
python scripts/sec_scheduled_run_preview.py --schedule-id weekly_mega_cap_core_preview --include-commit-plan
```

The scheduled preview prints exact terminal commands a human can run, classifies current candidate state as `ready_for_manual_promotion`, `future_auto_promotable_preview`, `manual_review_required`, or `blocked`, and includes a recommended next command. It may include `--allow-network` in printed job commands only when the preview is explicitly run with `--allow-network` and `--user-agent`; the planner itself still performs no network calls. It writes no candidate files, runs no git commands, does not auto-promote candidates, does not modify `data/companies.json`, and does not modify `data/connections.json`.

### Phase D30: Source Workbench Workflow Consolidation + Scale Prep

The Source Workbench now presents the bulk/job/scheduled-run pipeline as the primary local workflow instead of leading with one-off single-ticker commands. The visible recommended sequence is:

```text
Scheduled Preview -> Local Job Runner -> Bulk Candidate Generation -> Promotion Preview -> Manual Promotion Dry Run -> Validation
```

Single-ticker `sec_pipeline_run.py` commands remain useful for debugging one ticker or inspecting intermediate artifacts, but they belong in the advanced path rather than the top-level recommendation. The approved AAPL/MSFT/NVDA job is framed as the starter SEC batch only; Phase D31 expands the approved CIK mapping reference beyond that starter set, Phase D33 gives Batch 1 explicit standard/fast/deep job scopes, and future expansion should add additional approved mappings and reviewed jobs before wider automated ingestion.

Scale roadmap:

```text
Current: AAPL/MSFT/NVDA starter job plus Batch 1 standard/fast/deep local jobs
Next: more approved mappings and sector job manifests / S&P-style batches
Then: policy-gated promotion candidates
Then: reviewed production graph writes
```

Future automation should stay local and preview-first until the data path is proven. Broader universe expansion should come from more source-backed mappings and reviewed job manifests, not from unsafe direct writes to production graph JSON. The safest next target is a local scheduled preview plus candidate generation, with manual promotion still protected by promotion preview, policy classification, dry-run behavior, and validation. Later options include Windows Task Scheduler, a local desktop agent, or a hosted worker.

Graph UX scale work should follow the data scale foundation. The SEC preview overlay is working; larger graph UI cleanup and any 3D/globe orbit prototype should come after, or alongside, sidebar and canvas layout cleanup.

### Phase D31: Approved SEC CIK Mapping Coverage Batch 1

`data/candidates/cik_mappings.json` now moves beyond the initial AAPL/MSFT/NVDA starter set with approved SEC submissions endpoint mappings for a first multi-sector batch: AMZN, GOOGL, META, AMD, INTC, AVGO, JPM, GS, BLK, XOM, CVX, UNH, LLY, GE, and CAT.

This is candidate/reference-only expansion. It enables the bulk runner, and future reviewed job manifests, to process a broader cross-section of the US market graph without mapping skips for those tickers. It does not create production companies, production edges, app-loaded records, relationship candidates, or graph changes.

The CIK mapping file still keeps `status: "candidate_only"`, `production_write_allowed: false`, and `app_load_allowed: false`. Each Batch 1 mapping uses `source_type: "sec_filing"`, `source_tier: 1`, a zero-padded SEC submissions CIK URL, a capture date, and `review_status: "approved_for_fetch"`. Duplicate ticker and duplicate CIK validation remain required before any fetch workflow uses the expanded mapping set.

### Phase D32: Multi-Sector SEC Job Manifest

`data/candidates/sec_jobs.json` now includes the reviewed `batch_1_multi_sector` job so the expanded Batch 1 approved CIK mapping coverage can be run by job id instead of manually pasting long ticker lists. `mega_cap_core` remains the starter job for AAPL, MSFT, and NVDA; `batch_1_multi_sector` is the broader Batch 1 job for AAPL, MSFT, NVDA, AMZN, GOOGL, META, AMD, INTC, AVGO, JPM, GS, BLK, XOM, CVX, UNH, LLY, GE, and CAT.

Both manifest jobs remain local-only candidate orchestration. They require `review_status: "approved_for_local_run"`, delegate through the local bulk runner, and do not create production nodes, create production edges, promote candidates, load in the app, modify `data/companies.json`, or modify `data/connections.json`.

### Phase D33: Job Scope Controls + Batch 1 Runtime Guidance

`data/candidates/sec_jobs.json` keeps `batch_1_multi_sector` as the standard/default Batch 1 job and adds two clearer variants for the same 18 approved tickers and the same 10-K, 10-Q, and 8-K form set. `batch_1_multi_sector_fast` uses limit 10 for routine Batch 1 runs, while `batch_1_multi_sector_deep` uses limit 25 for deeper filing review.

For all SEC job and bulk runner commands, `limit` means filings reviewed per ticker after form filtering. It is not a cap on relationships found or relationship candidates surfaced. Higher limits can take longer and may require more SEC network/cache work when network access is explicitly enabled.

The Source Workbench now exposes copyable fast and deep Batch 1 dry-run commands plus network-enabled review-only candidate-writing variants. These commands still run from the local terminal only, require explicit `--allow-network` and `--user-agent` for SEC access, require `--write-candidates` for candidate output, and do not authorize production promotion.

The expansion path remains reviewed and staged: add more approved ticker/CIK mappings, then add more reviewed job manifests, then run candidate generation and promotion previews, then consider production writes only through the separate reviewed promotion path. This phase does not create production nodes, create production edges, modify `data/companies.json`, modify `data/connections.json`, add backend/server code, or run network calls.

### Phase D34: SEC Batch Runtime Visibility + Candidate Write Propagation

`scripts/sec_job_run.py` now streams delegated bulk-runner output so reviewed manifest jobs show live progress instead of appearing frozen. `scripts/sec_bulk_pipeline_run.py` prints ticker-by-ticker progress with current index/total, ticker symbol, mode, limit, candidate-write state, and final per-ticker candidate preview counts when available. The end-of-run summary includes requested, processed, skipped, and failed tickers plus aggregate filing, signal, candidate, candidate-file, and production-write counters.

When `--write-candidates --force` is passed to the local job runner, the delegated bulk runner preserves those flags and now passes candidate-writing mode through to each ticker-level `scripts/sec_pipeline_run.py` invocation. Network access is still gated by `--allow-network` plus `--user-agent`; review-only candidate writes still require `--write-candidates`; promotion remains a separate reviewed path.

Batch jobs can take several minutes when filings need to be fetched or scanned. A healthy Fast Batch 1 run should visibly advance ticker by ticker and end with `production writes: 0`.

### Phase D35: High-Signal Relationship Extraction Upgrade

`scripts/sec_signal_report.py` now adds a candidate-focused snippet lane in addition to the human review top snippets. This lane prioritizes explicit company relationship patterns including `agreement with [Company]`, `partnership with [Company]`, `collaboration with [Company]`, `joint venture with [Company]`, `[Company] supplies`, `manufactured by [Company]`, `components sourced from [Company]`, `revenue from [Company]`, `[Company] accounted for X% of revenue`, `investment in [Company]`, and `ownership stake in [Company]`.

`scripts/sec_signal_candidates_preview.py` now converts those high-signal snippets before falling back to generic signal snippets, upgrades entity detection for legal names, known public aliases, and multi-word company names, and binds target resolution to the explicit relationship phrase. Preview can surface `target_match_confidence >= 0.75`, but it remains preview-only, capped per source ticker and overall, and filters `depends on`, `our customers`, `our suppliers`, internal operations language, accounting-only phrases such as `revenue from contracts`, unresolved snippets, and XBRL-dominated artifacts.

`scripts/sec_signal_candidates_write.py` keeps the stricter `target_match_confidence >= 0.85` floor before any review-only candidate file write. This phase performs no network calls, creates no production nodes or edges, does not modify `data/companies.json`, and does not modify `data/connections.json`.

### Phase D36: Candidate Deduplication + Relationship Type Normalization

`scripts/sec_candidate_promotion_preview.py` and `scripts/sec_candidate_promote.py` now normalize relationship types before final promotion eligibility. `supplier_customer` candidates become `partnership` only for licensing, revenue, search-distribution, or payment evidence; they become `supply` only for manufacturing, supply, sourced-components, or component-supplier evidence. Share issuance, common-stock sale, equity investment, cash purchase price, or ownership-stake language maps to `investment`, including cases where the raw candidate label was a broader `partnership` or `agreement with` signal.

Both scripts now deduplicate same source/target candidate pairs after endpoint validation and type normalization. The strongest candidate is retained using promotability, policy gate result, confidence hint, target-match confidence, source URL support, and original order as tie-breakers. Suppressed duplicates are reported separately, and the kept record carries merged source URL and signal/type metadata when duplicate signals contributed evidence. Promotion preview and dry-run promotion therefore show only unique proposed edges, while existing production duplicates remain blocked.

This phase writes no production graph data. `scripts/sec_candidate_promotion_preview.py` remains read-only, and `scripts/sec_candidate_promote.py` still writes `data/connections.json` only when `--write` is explicit.

### Phase D37: First Multi-Company SEC Graph Promotion

`scripts/sec_candidate_promote.py` now deduplicates production promotion candidates by normalized edge key after endpoint validation and relationship type normalization. This keeps exact duplicate source/target/type edges blocked while allowing distinct validated relationship categories, such as `partnership` and `investment`, to coexist for the same company pair when supported by separate SEC evidence.

The first multi-company SEC promotion appended three source-backed production edges to `data/connections.json`: INTC-NVDA `partnership`, NVDA-MSFT `partnership`, and INTC-NVDA `investment`. Each promoted edge preserves the SEC archive URL in `source_urls`, uses `provenance: "SEC filing"`, carries a filing-date `verified_date`, and maps to existing production company IDs only. The prior AAPL-GOOGL candidate stayed blocked as an existing production duplicate.

Post-promotion validation reports 60 companies and 121 connections with no validation errors and no duplicate edge keys. A follow-up dry run of the promotion writer reports zero promotable edges, confirming the D37 write is idempotent after promotion. This phase does not create production companies, does not run network calls, and does not modify app/UI behavior.

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
- Automation policy classifications are gates and review signals, not production-write authorization by themselves.
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
- Source URL or source URLs, including direct SEC archive URLs when available.
- Filing date or publication date.
- Capture date.
- Extracted evidence text or concise extraction note.
- Confidence proposal.
- Reviewer status.

Production records should only be created after a reviewer or future reviewed auto-promotion gate confirms the companies, relationship type, source support, policy classification, and current validation rules.
