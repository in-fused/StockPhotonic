# Phase D143 - Scheduled Ingestion Orchestrator + OpenAlex Intelligence Layer

## Scope

D143 adds scheduled/local review automation for StockPhotonic source work. It preserves the static production source of truth and keeps every generated output review-only unless a human later runs the manual promotion workflow.

This is not a backend phase. It adds GitHub Actions, local Python orchestration, OpenAlex enrichment helpers, source coverage refresh artifacts, validation, documentation, and a read-only Source Workbench display.

## Non-Promotion Contract

- Production graph data remains `data/companies.json` and `data/connections.json`.
- SEC and OpenAlex outputs are artifacts under `data/candidates/` or cache files under `data/cache/`.
- No workflow commits or pushes generated data.
- No workflow runs `scripts/sec_candidate_promote.py`.
- OpenAlex never proves a production relationship and never authorizes promotion.
- Browser code only fetches static artifact JSON; it does not call SEC, OpenAlex, or local scripts.

## New Local Scripts

- `scripts/openalex_enrichment.py`
  - Generates `openalex_ecosystem_candidates.json`, `openalex_topic_overlap.json`, `openalex_institution_overlap.json`, and `openalex_cluster_hints.json`.
  - Defaults to cache-only/dry-run mode.
  - Requires `--allow-network` for OpenAlex requests.
  - Enforces `--max-requests`, `--max-entities`, `--per-page`, cache reuse, and rate limiting.

- `scripts/source_coverage_refresh.py`
  - Builds `source_coverage_refresh_report.json`.
  - Expands preflight data into weak relationship categories, ecosystem gaps, missing production tickers, and reviewer priorities.
  - Performs no network calls.

- `scripts/review_artifact_refresh.py`
  - Orchestrates candidate triage, data expansion preflight, source coverage refresh, OpenAlex cache-only enrichment, and validation.
  - Writes `review_pipeline_summary.json`.
  - Optional OpenAlex networking requires `--allow-openalex-network`.

## OpenAlex Philosophy

OpenAlex is used for:

- ecosystem discovery
- topic overlap
- research clustering
- institution/topic context
- company/topic proximity hints

OpenAlex is not used for:

- production truth
- relationship proof
- automatic promotion
- browser-side ingestion

Every OpenAlex artifact uses `artifact_status: review_only`, `production_write_allowed: false`, `relationship_claim_created: false`, confidence labels, and source attribution.

## Budget And Cache Rules

OpenAlex networking is disabled by default. When enabled:

- requests are capped by `--max-requests`
- companies are capped by `--max-entities`
- search pages are capped by `--per-page`
- cache is reused before any request
- API keys are never written to cache or artifacts
- failed lookups become review status, not hard production failures

Cache path:

```text
data/cache/openalex/entity_resolution_cache.json
```

The cache is ignored by git and can be restored/uploaded as a GitHub Actions cache or artifact.

## GitHub Actions

New workflows:

- `.github/workflows/sec_candidate_pipeline.yml`
  - Scheduled and manual SEC review runs.
  - Prints scheduled preview plans.
  - Optionally runs approved SEC jobs with `SEC_USER_AGENT`.
  - Uploads review artifacts only.

- `.github/workflows/openalex_enrichment.yml`
  - Scheduled/manual OpenAlex enrichment.
  - Uses cache-first behavior.
  - Network mode is bounded and requires secrets or manual opt-in.

- `.github/workflows/review_artifact_refresh.yml`
  - Scheduled/manual refresh of triage, preflight, source coverage, OpenAlex, and validation artifacts.
  - Uploads generated files only.

Expected GitHub Secrets:

```text
OPENALEX_API_KEY
SEC_USER_AGENT
```

## Review Artifact Lifecycle

1. Candidate or enrichment scripts write review-only files under `data/candidates/`.
2. Source Workbench displays any static artifacts that are present.
3. Reviewers inspect candidate evidence, overlap, OpenAlex context, and source coverage queues.
4. Promotion preview remains separate.
5. Manual promotion remains explicit.
6. Validation must pass after any production data change.

## Source Workbench

Source Workbench now displays:

- latest review pipeline timestamp
- OpenAlex ecosystem/topic/institution/cluster summaries
- OpenAlex hint rows with `NO CLAIM` labels
- source coverage refresh state
- reviewer priority queue
- graceful missing-artifact fallbacks

It does not execute scripts or make network requests.

## Validation

`scripts/validate_data.py` now validates:

- OpenAlex artifact structure
- OpenAlex cache shape
- source attribution
- confidence labels
- review-only metadata
- zero production writes
- source coverage refresh queue shape
- review pipeline summary shape
- existing candidate and triage artifacts

Warnings about existing confidence-score mismatches are still warnings unless strict confidence validation is requested.
