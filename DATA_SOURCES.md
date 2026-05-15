# CURRENT SYSTEM STATE

Document: StockPhotonic Data Sources. Production graph data is static JSON: `data/companies.json` and `data/connections.json`. The current production dataset is 60 real public companies and 121 curated connections.

- Graph Intelligence (2D): Reads production companies/connections only, then derives filters, dashboards, relationship taxonomy, confidence tiers, source visibility, clusters, shared exposure, hidden relationships, portfolio exposure, and industry correlations in the browser.
- 3D Network capabilities: Renders the same production dataset with Three.js; it does not create, promote, or alter data.
- Source Workbench pipeline: Read-only browser surface for local source commands and candidate review. It can display candidate file contents served statically, but cannot run ingestion or write production data.
- SEC ingestion + candidate system: SEC cache, filing inspection, signal extraction, candidate preview/write, job, schedule, and policy scripts operate locally and keep staged records under `data/candidates/`.
- Promotion + validation flow: SEC-backed candidates can become production edges only after preview, manual review, explicit promotion, and validation.

## CORE RULES

- No fake data, guessed URLs, placeholder records, or unsupported claims.
- No automatic production writes.
- Candidate -> preview -> manual promotion only.
- No backend in the current app.
- `data/companies.json` and `data/connections.json` are the production source of truth.

## HOW DATA ENTERS THE SYSTEM

1. Public source evidence is collected locally, preferably from SEC filings or official company sources.
2. Local scripts cache and inspect source material.
3. Extracted relationship signals become candidate previews.
4. Candidate files live under `data/candidates/` and are not production data.
5. Promotion preview identifies which candidates are safe to consider.
6. Manual promotion can append validated edges to `data/connections.json`.
7. `python scripts/validate_data.py` must pass after production changes.

## SEC PIPELINE SUMMARY

Primary SEC path:

```text
SEC lookup/cache -> filing plan/fetch -> filing inspect/report -> candidate preview/write -> promotion preview -> manual promotion -> validation
```

Key scripts:

- `scripts/sec_bulk_pipeline_run.py`: bulk SEC candidate workflow for approved ticker/CIK mappings.
- `scripts/sec_pipeline_run.py`: single-ticker SEC workflow.
- `scripts/sec_signal_report.py`: aggregates filing signals for review.
- `scripts/sec_signal_candidates_preview.py`: prints candidate-shaped records without writing.
- `scripts/sec_signal_candidates_write.py`: writes review-only SEC candidates when explicitly requested.
- `scripts/sec_candidate_triage.py`: writes review-only queue, summary, overlap, and checklist artifacts for manual review.
- `scripts/sec_candidate_promotion_preview.py`: validates candidate promotion shape without production writes.
- `scripts/sec_candidate_promote.py`: explicit production writer; default mode is dry-run.
- `scripts/validate_data.py`: production dataset validation.

SEC network commands require an identifying user agent and explicit network flags where supported.

## SEC EXTRACTION AND REVIEW ARTIFACTS

D140 expands local SEC evidence extraction while preserving the same gates:

- Relationship phrase rules now look for explicit supplier/customer, strategic partnership, cloud/hyperscaler, semiconductor supply-chain, AI infrastructure, data-center/power, competitor, and ownership/investment language.
- Candidate snippets are capped as short filing excerpts and may carry `filing_form`, `source_reference`, `evidence_context`, and `ticker_pairing` metadata.
- Generic customer/supplier mentions, accounting contract language, XBRL fragments, legal exhibit lists, credit-facility noise, and negated relationship language are filtered before candidate creation where possible.
- Source/reference metadata remains review-only. A snippet or confidence hint is not production proof.

Reviewer triage command:

```text
python scripts/sec_candidate_triage.py --write --force
```

Generated review-only artifacts:

- `data/candidates/candidate_review_queue.json`
- `data/candidates/candidate_review_summary.json`
- `data/candidates/candidate_overlap_report.json`
- `docs/candidate_reviewer_checklist.md`

The triage artifacts cluster candidates by source ticker, target ticker, relationship type, filing form, repeated pair, repeated evidence phrase, and source host/category. They also compare candidates to `data/connections.json`, identify same-pair overlaps, production edges missing source URLs, and candidate evidence that could enrich an existing edge. These are labels for review only; they do not merge or promote data.

## CANDIDATE VS PRODUCTION

- Candidate files are staging/review artifacts only.
- Candidate records may include unresolved, blocked, duplicate, or manual-review-required items.
- Candidate files are not loaded as production graph data.
- Production companies are only `data/companies.json`.
- Production connections are only `data/connections.json`.
- Manual promotion writes only reviewed, mapped, non-duplicate production edges and never creates fake companies.

## SOURCE URL EXPECTATIONS

- Prefer SEC filings, company investor relations pages, official releases, official partner/customer pages, or reputable secondary sources with clear provenance.
- High-confidence production edges should include stable `source_urls` when direct evidence is available.
- Leave `source_urls` absent rather than guessing.
- Every production connection needs `provenance`, `confidence`, `strength`, `label`, `type`, and `verified_date`.

## RELATIONSHIP EVIDENCE DISPLAY

The browser derives additive metadata from existing connection fields. It does not invent relationship claims.

Derived runtime fields may include:

- `relationship_type`: mapped from existing `type`, `relationship_type`, label, provenance, or candidate metadata.
- `confidence_tier`: high, medium, low, or evidence pending.
- `evidence_count`: count of attached source URLs plus explicit evidence snippets when present.
- `source_status`: SEC-backed, candidate/preview, source attached, or no source URL attached yet.
- `source_age_key`: verified recently, aging evidence, stale review recommended, no verified date, or candidate preview.
- `source_host_categories`: URL-derived categories such as SEC source, company IR URL, partner/customer page URL, secondary/research source, candidate-only source, or other source URL.
- `relationship_summary`: existing label, evidence snippet, provenance note, or an evidence-pending fallback.

Relationship cards must show source/confidence state when available. If source evidence is missing, the UI should say "Evidence pending", "Relationship type from curated dataset", or "No source URL attached yet" instead of implying a verified partnership/customer relationship.

## SOURCE AGING AND REVIEW QUEUE

Source aging is derived only from `verified_date`, candidate `filing_date`, or equivalent static metadata already present in the loaded files.

- Verified recently: dated evidence within the recent review window.
- Aging evidence: dated evidence past the recent window but not beyond the stale-review threshold.
- Stale review recommended: dated evidence older than the stale-review threshold.
- No verified date: no usable date is present. This is a pending metadata state, not an outdated claim.
- Candidate preview: review-only candidate state; freshness is shown as candidate context, not production verification.

The evidence review queue surfaces low-confidence, missing-source, stale-review, candidate-preview, and SEC-preview items. It is graph-aware and labels whether items are currently visible or filtered. Queue entries are prompts for human review; they do not create new production claims.

The Source Workbench can also display the generated candidate triage queue, summary, overlap comparison, and checklist status when those static files are present. Missing artifacts are handled as an unavailable review state.

## SOURCE HOST CATEGORIES

Source-host visibility is derived from URL host/path patterns only:

- SEC source: `sec.gov` URLs.
- Official company IR: URL hosts or paths with investor-relations, shareholder, filing, release, or results patterns.
- Official partner/customer page: URL paths with partner, customer, case-study, project, solution, ecosystem, collaboration, or similar page patterns.
- Secondary/research source: known research/news/market-data hosts.
- Candidate-only source: candidate records without a direct production source URL.
- Other source URL: valid URL that does not match the above patterns.

These badges are review aids, not proof of relationship type. If the URL category cannot be inferred safely, the UI falls back to other source URL rather than inventing an official-source label.

## CURRENT TAXONOMY

StockPhotonic currently maps relationship records into this open-data-ready taxonomy:

- Supplier / Customer
- Strategic Partnership
- Competitor / Peer
- Hyperscaler / Cloud Ecosystem
- Semiconductor Supply Chain
- AI Infrastructure
- Data Center / Power
- Ownership / ETF Overlap
- SEC-backed Preview
- Curated / Manual Relationship

The taxonomy is a display and filtering layer. Production truth remains `data/connections.json`.

## FUTURE OPEN SOURCE EXPANSION

Recommended open or source-friendly inputs:

- SEC EDGAR 10-K, 10-Q, 8-K, exhibit, and risk-factor text.
- Company investor-relations releases and official technical/product pages.
- Exchange-published listing metadata for public-company discovery only.
- Official ETF issuer holdings files when ownership/ETF overlap is explicitly modeled.
- Government contract portals only after a dedicated schema and source registry rules exist.
- Reputable secondary sources only as review support, not as unsupported production claims.

Do not wire paid/API-only sources into the static frontend. Any future source expansion should preserve candidate preview, manual promotion, and validation gates.
