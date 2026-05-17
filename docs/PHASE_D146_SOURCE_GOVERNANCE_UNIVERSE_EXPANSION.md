# D146 Source Governance And Universe Expansion

## Purpose

D146 adds reviewer-owned source governance and controlled universe-expansion infrastructure for StockPhotonic. It prepares the graph to grow beyond the current 60-company production universe without changing the static production dataset rules or the candidate -> preview -> manual promotion workflow.

## Source Registry

The registry now lives under `data/source_registry/`:

- `official_company_sources.json`: production-company source shells with observed SEC CIK roots when available.
- `trusted_source_hosts.json`: observed and categorized source hosts used for reviewer visibility only.
- `corridor_source_registry.json`: corridor definitions, maintenance cadence, source categories, and review keywords.
- `source_governance_report.json`: generated review-only governance, expansion, corridor, scaling, and OpenAlex safety report.

Registry records are review-owned. A registered source root or host does not prove a relationship, does not promote a candidate, and does not escalate trust automatically.

## Governance Script

`scripts/source_registry_governance.py` reads production data, candidate staging files, registry inputs, and OpenAlex cache/artifacts. It can write review artifacts only when run with:

```bash
python scripts/source_registry_governance.py --write --force --sync-registry
```

The script guards production hashes for `data/companies.json` and `data/connections.json`. It performs no network calls, no browser ingestion, and no production writes.

## Universe Expansion Engine

Universe expansion remains review-only. The governance report includes:

- duplicate ticker prevention against production and candidate files;
- alias conflict detection by normalized company name;
- missing metadata detection;
- CIK and official listing source readiness;
- source readiness scores;
- blocker rows for reviewer triage.

The report does not assign ecosystem membership to new companies automatically. Candidate-company rows that look source-ready still require reviewer sector/corridor assignment and a future explicit writer phase.

## Corridor Maintenance

D146 tracks corridor lifecycle state for:

- AI compute/foundry/cloud
- payment networks/banks
- PBM/pharma/insurance
- aerospace/OEM
- energy infrastructure
- enterprise SaaS/cloud
- retail/consumer

For each corridor, the report computes edge count, source-backed coverage, stale edge count, missing source count, density score, maintenance priority, and growth readiness. These rows are maintenance queues only.

## Graph Scaling

The frontend adds graph-scaling helpers for density buckets, hub summaries, corridor buckets, route precompute summaries, and label-priority seeds. Rendering keeps selected, hovered, route, overlay, guided, and source-lens labels protected while throttling unfocused labels as density grows.

## Strategic Hubs

Strategic hub scoring now exposes multi-corridor exposure, repeated exposure, source-backed hub quality, ecosystem breadth, and bridge significance. These are graph-native summaries derived from loaded static edges and evidence state.

## OpenAlex Safety

OpenAlex remains context-only:

- no relationship authority;
- no promotion authority;
- entity-resolution state is visible for alias review;
- cache lifecycle state is reported;
- source role is shown as enrichment context only.

## Workbench

Source Workbench now includes a source governance console with registry visibility, trusted-host visibility, stale-source queues, universe blockers, corridor maintenance rows, graph scaling state, and OpenAlex safety status.

## Non-Goals

D146 does not modify CryptoPhotonic, add browser-side ingestion, expose API keys, create production companies, create production connections, or auto-promote candidate data.
