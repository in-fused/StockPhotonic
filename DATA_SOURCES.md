# CURRENT SYSTEM STATE

Document: StockPhotonic Data Sources. Production graph data is static JSON: `data/companies.json` and `data/connections.json`. The current production dataset is 60 real public companies and 121 curated connections.

- Graph Intelligence (2D): Reads production companies/connections only, then derives filters, dashboards, source visibility, clusters, shared exposure, hidden relationships, portfolio exposure, and industry correlations in the browser.
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
- `scripts/sec_candidate_promotion_preview.py`: validates candidate promotion shape without production writes.
- `scripts/sec_candidate_promote.py`: explicit production writer; default mode is dry-run.
- `scripts/validate_data.py`: production dataset validation.

SEC network commands require an identifying user agent and explicit network flags where supported.

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
