# D147 Candidate Company Preview And Controlled Universe Expansion

## Purpose

D147 adds a reviewer-owned candidate-company preview system so StockPhotonic can stage growth beyond the 60-company production universe without writing to `data/companies.json` or `data/connections.json`.

The phase separates three states:

- production companies and production edges in the static dataset;
- SEC relationship candidates that remain review-only relationship previews;
- candidate companies that can be graph-previewed as staged nodes with corridor-planning anchors.

## Candidate Company Preview

Candidate companies live in `data/candidates/candidate_companies.json`. They are preview-visible only when the reviewer turns on the candidate-company controls. Candidate nodes use a separate visual halo and preview tint, and candidate edges are dashed planning anchors.

Candidate preview edges have `preview_edge_semantics: corridor_assignment_not_relationship`. They do not prove relationships, ecosystem membership, customer/supplier status, or partnership status.

## Expansion Batches

`scripts/universe_expansion_batches.py` generates structured review-only batches:

- AI infrastructure expansion;
- semiconductor suppliers;
- aerospace suppliers;
- financial infrastructure;
- healthcare adjacency;
- energy infrastructure;
- retail logistics and distribution;
- cloud security and workflow.

The script reads existing official ticker/CIK staging data and production companies for duplicate checks. It writes only candidate artifacts under `data/candidates/` and preserves production file hashes.

## Reviewer Governance

Each candidate company carries readiness state, source readiness summary, ecosystem assignment proposals, corridor assignment proposals, duplicate ticker warnings, alias conflict warnings, blockers, and strategic hub preview scores.

Promotion remains out of scope. D147 adds no automatic company writer and no automatic relationship writer.

## Source Lifecycle

`data/source_registry/reviewer_source_roots.json` is a review-owned shell for future official IR, newsroom, and partner/customer root URLs. Strict validation requires real HTTPS roots and keeps these roots as source-lifecycle context only.

The source governance report now exposes candidate-company identity source counts, reviewer-added root queues, stale-source aging queues, and OpenAlex candidate-company context hints.

## Graph Scaling

The graph adds candidate-company toggles, preview-only isolation, hub-only focus, density control, ecosystem focus, and corridor focus. Scaling helpers include candidate preview counts in density decisions while keeping production graph intelligence based on static production edges.

Labeling and fit bounds include visible candidate nodes, but candidate-company previews remain visually distinct from production companies.

## Source Workbench

Source Workbench now acts as an expansion center:

- candidate-company preview summary;
- expansion batch cards;
- readiness and blocker table;
- ecosystem and corridor assignment visibility;
- source lifecycle visibility;
- graph growth metrics and OpenAlex context boundaries.

## Non-Goals

D147 does not change CryptoPhotonic behavior, add browser-side ingestion, expose API keys, fabricate URLs, fabricate relationships, create production companies, create production edges, or bypass the candidate -> preview -> manual promotion workflow.
