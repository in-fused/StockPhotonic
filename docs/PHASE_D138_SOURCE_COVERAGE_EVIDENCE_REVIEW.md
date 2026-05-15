# Phase D138 Source Coverage and Evidence Review

Date: May 14, 2026

## Summary

D138 expands StockPhotonic review ergonomics without changing the static architecture. It adds source aging, URL-derived source-host categories, a graph-aware evidence review queue, relationship trust panels, source/review filters, candidate review grouping, and lightweight relationship timeline context.

## Rules Preserved

- CryptoPhotonic behavior is not modified.
- No backend, browser ingestion, provider calls, API keys, or paid/API-only dependencies are added.
- Candidate records remain preview-only staging data.
- Candidate -> preview -> manual promotion -> validation remains the only production path.
- Missing evidence stays labeled as pending.
- No partnership, customer, supplier, or ownership claim is inferred from missing fields.

## Derived Review Logic

Source aging uses only existing `verified_date`, candidate `filing_date`, or equivalent static metadata:

- Verified recently.
- Aging evidence.
- Stale review recommended.
- No verified date.
- Candidate preview.

URL-derived source-host categories:

- SEC source.
- Official company IR URL.
- Official partner/customer page URL.
- Secondary/research source.
- Candidate-only source.
- Other source URL.

These categories are review aids. They do not prove relationship type or source authority beyond the URL pattern shown.

## UI Additions

- Evidence Review Queue in selected-company workflows and dashboard context.
- Source-host category filter.
- Stale review, candidate preview, and missing-evidence filters.
- Relationship cards with confidence, evidence count, source host diversity, freshness, SEC-backed/candidate state, and missing-evidence warnings.
- Lightweight timeline context for latest verified, oldest verified, latest SEC-backed, and pending review dates.
- Source Workbench candidate review summary grouped by confidence, relationship type, review status, and source-host category.

## Future Open-Data Workflow

Future phases should add reviewer-export artifacts and source registry checks before any broader open-data expansion. The browser should continue to display review status only; source collection and promotion should remain local script workflows with explicit validation.
