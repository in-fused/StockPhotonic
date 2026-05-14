# Phase D137 StockPhotonic Relationship Intelligence

Date: May 14, 2026

## Summary

D137 upgrades StockPhotonic into a relationship-intelligence workspace while keeping the app static and preserving CryptoPhotonic behavior.

The phase adds runtime relationship normalization, source/confidence filters, relationship evidence cards, selected-company investigation summaries, stronger Company Nexus grouping, and Source Workbench language that distinguishes curated production edges, SEC-backed production edges, and candidate preview records.

## Evidence Rules

- Do not invent partnership, customer, supplier, or ownership claims.
- Use existing `data/connections.json` fields when present.
- Use SEC preview candidate fields only as preview evidence.
- Label missing sources as pending.
- Leave source URLs absent rather than guessing.
- Keep candidate records out of production until preview, manual promotion, and validation pass.

## Runtime-Derived Fields

`js/stock/relationships.js` may derive:

- `relationship_type`
- `relationship_type_label`
- `relationship_group`
- `confidence_score`
- `confidence_tier`
- `confidence_tier_label`
- `evidence_count`
- `source_count`
- `source_status`
- `source_status_label`
- `source_stale`
- `relationship_summary`
- `evidence_tags`

These fields are additive browser metadata. They do not change the production source of truth.

## Relationship Taxonomy

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

## UI Behavior

- Selected companies now show a compact investigation workspace with company identity, sector/industry, market cap, relationship counts, source coverage, strongest evidence, and category chips.
- Relationship evidence cards explain why each visible relationship exists using existing labels, evidence snippets, provenance, source counts, and confidence tiers.
- Company Nexus View groups visible direct relationships by taxonomy group and graph rendering mutes low-confidence or unsourced edges.
- Filters now cover relationship type, confidence tier, sourced-only, SEC-backed-only, portfolio-connected, and cross-sector relationships.
- Graph status pills and visible count labels reflect active relationship filtering.

## Source Workbench Contract

Source Workbench remains a static, local-pipeline guide. It now documents:

- Curated production relationships.
- SEC-backed production relationships.
- Candidate preview relationships.
- Missing-source/evidence-pending states.

No browser ingestion, backend code, API keys, or paid data dependencies were added.

## Open Data Direction

Recommended future source expansion should prefer:

- SEC EDGAR filings.
- Official investor-relations releases.
- Official company product/partner pages.
- Exchange listing files for company discovery only.
- Official ETF issuer holdings files after schema support.
- Reputable secondary sources only as supporting review context.
