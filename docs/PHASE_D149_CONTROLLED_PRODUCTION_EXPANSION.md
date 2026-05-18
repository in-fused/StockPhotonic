# Phase D149 Controlled Production Expansion

D149 introduces the first reviewer-approved production company expansion and the first large-graph navigation layer designed for hundreds and later thousands of companies.

## Production Expansion Result

- Production companies increased from 60 to 113.
- Production connections increased from 134 to 162.
- 53 companies were promoted from reviewer-approved identity batches.
- 28 production connections were appended from explicit reviewer-approved relationship rows.
- No automatic promotion, browser ingestion, or generated relationship creation was used.

Approved company batches:

- AI infrastructure expansion
- Semiconductor supplier batch
- Aerospace supplier batch
- Financial infrastructure batch
- Retail/logistics/distribution batch
- Cloud/security/workflow batch

Approved connection additions:

- 24 SEC-identity-backed competitor/peer edges.
- 3 official company-source partnership edges.
- 1 official company-source ecosystem edge.

## Production Governance

Reviewed production expansion is allowed only through `data/candidates/production_expansion_approvals.json` and `scripts/production_company_expansion.py`.

The writer requires:

- reviewer-approved manifest metadata
- `production_write_allowed: true`
- `automatic_promotion_allowed: false`
- `relationship_generation_allowed: false`
- `browser_ingestion: false`
- source-backed company identity
- official listing URL and SEC submissions URL when available
- duplicate ticker checks
- normalized alias checks
- explicitly listed relationship rows only
- official source URLs for relationship edges
- post-write validation

The production expansion report is written to:

```text
data/candidates/production_expansion_report.json
```

This report is a production-operation audit artifact. It records the expansion result, batch counts, edge counts, relationship type counts, and safety state. It does not grant future automatic promotion authority.

## Large-Graph Navigation Architecture

D149 adds `js/stock/largeGraphNavigation.js`, which is a read-only navigation/indexing helper. It filters and prioritizes existing loaded graph edges; it never creates relationships.

Navigation modes:

- Overview
- Ecosystem Focus
- Corridor Focus
- Neighborhood Isolation
- Strategic Hubs
- Route Isolation
- Production Only
- Preview Only

The helper computes:

- visible node/edge sets for each navigation mode
- local neighborhood BFS up to depth 3
- strategic hub summaries
- ecosystem bucket summaries
- corridor bucket summaries
- route isolation sets
- progressive-disclosure counts
- source-backed and SEC-backed visible edge counts

## Progressive Disclosure

The large graph no longer needs to show every production edge with equal visual priority. D149 prioritizes:

- selected company neighborhoods
- active route traces
- ecosystem overlays
- corridor views
- strategic hubs
- source-backed edges
- production-only investigation
- preview-only staging review

Graph scaling heuristics lower label limits and candidate preview labels when a navigation mode is active, while preserving selected, hovered, route, guided, overlay, source-lens, and portfolio labels.

## Source Workbench

Source Workbench now includes a Production Expansion Console that reads the static expansion report and summarizes:

- companies added
- production company total
- edges added
- production edge total
- expansion batches
- graph density
- manifest-only relationship mode
- automatic promotion status
- batch-level additions
- connection additions

Source Workbench remains a browser display surface only. It does not execute scripts, ingest sources, or write production JSON.

## Future 1000+ Company Direction

The next scale milestones should expand the navigation/index layer before adding substantially more companies:

- persistent reviewer decisions for company promotion state
- stricter source registry joins for official company roots
- richer corridor route precomputes
- large-graph minimap or overview navigation
- viewport-aware label budgets
- partial edge streaming from static shards if the dataset reaches browser memory limits
- reviewer-authored ecosystem notes only after schema and source validation
