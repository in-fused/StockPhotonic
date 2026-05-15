# Phase D140 SEC Evidence Extraction and Candidate Intelligence

Date: May 15, 2026

## Summary

D140 deepens the review-only SEC evidence layer. It improves phrase extraction, snippet hygiene, ticker-pairing metadata, candidate clustering, overlap detection, source-host quality scoring, and reviewer artifacts while preserving the static browser architecture and manual promotion workflow.

## Rules Preserved

- CryptoPhotonic behavior is not modified.
- No backend, browser ingestion, provider calls, API keys, paid/API-only dependencies, or automatic production promotion are added.
- Candidate records remain review-only until manually promoted through preview and validation.
- Static production truth remains `data/companies.json` and `data/connections.json`.
- Missing evidence remains pending; no fake partnership/customer/supplier claims are created.

## SEC Extraction Changes

- `scripts/sec_filing_signals.py` now uses explicit relationship phrase rules for supplier/customer, partnership, cloud/hyperscaler, semiconductor supply-chain, AI infrastructure, data-center/power, competitor, and ownership/investment language.
- `scripts/sec_signal_report.py` carries stronger relationship patterns and cleaner filing snippets.
- `scripts/sec_signal_candidates_preview.py` writes shorter candidate snippets with `filing_form`, `source_reference`, `evidence_context`, and `ticker_pairing` fields.
- False-positive guards filter generic customer/supplier text, accounting-only contract wording, legal exhibit fragments, XBRL noise, credit-facility noise, and negated relationship language.

## Candidate Triage Artifacts

Run:

```text
python scripts/sec_candidate_triage.py --write --force
```

Generated review-only artifacts:

- `data/candidates/candidate_review_queue.json`
- `data/candidates/candidate_review_summary.json`
- `data/candidates/candidate_overlap_report.json`
- `docs/candidate_reviewer_checklist.md`

The triage script clusters candidates by source ticker, target ticker, relationship type, filing form, repeated pair, repeated evidence phrase, source host, and source category. It also derives source-host categories, source diversity counts, filing freshness, review priority, overlap state, and reviewer action labels.

## Overlap Detection

The overlap report compares candidate pairs against `data/connections.json` and identifies:

- Exact represented production pairs.
- Same-pair different-type candidates.
- Near duplicate candidate clusters.
- Production edges missing source URLs.
- Candidate evidence that may enrich an existing production edge.

The report does not merge data. Recommended actions are labels only: ignore duplicate, enrich existing edge, review for promotion, needs more evidence, or reject as weak signal.

## Validation

`scripts/validate_data.py` still validates production JSON and now also validates candidate/triage artifact shape when those files exist. It checks candidate source/target tickers, supported relationship labels, URL shape, review-only metadata, and supported reviewer action labels.

## Manual Boundary

Promotion remains:

```text
candidate -> promotion preview -> manual review -> explicit promotion -> validation
```

No D140 script writes production graph data except the existing manual promotion script when explicitly run with its write mode.
