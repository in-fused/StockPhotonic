# CURRENT SYSTEM STATE

Document: StockPhotonic Data Sources. Production graph data is static JSON: `data/companies.json` and `data/connections.json`. The current production dataset is 60 real public companies and 134 curated connections.

- Graph Intelligence (2D): Reads production companies/connections only, then derives filters, dashboards, relationship taxonomy, confidence tiers, source visibility, clusters, shared exposure, hidden relationships, portfolio exposure, and industry correlations in the browser.
- 3D Network capabilities: Renders the same production dataset with Three.js; it does not create, promote, or alter data.
- Source Workbench pipeline: Read-only browser surface for local source commands, candidate review, candidate-company expansion staging, triage artifacts, and data expansion preflight. It can display static artifact contents served from the repo, but cannot run ingestion or write production data.
- SEC ingestion + candidate system: SEC cache, filing inspection, signal extraction, candidate preview/write, job, schedule, and policy scripts operate locally and keep staged records under `data/candidates/`.
- Scheduled review orchestration: GitHub Actions and local scripts can refresh review-only SEC, OpenAlex, preflight, source coverage, source governance, and pipeline summary artifacts. They upload artifacts only and do not commit or promote production graph data.
- OpenAlex intelligence layer: Local/script-side enrichment for ecosystem, topic, institution, and clustering hints. OpenAlex is context, not relationship proof or promotion authority.
- Tiered evidence policy: Browser helpers and review-only scripts classify relationship display state as `VERIFIED`, `STRONG_INFERRED`, `CONTEXT_ONLY`, or `NEEDS_REVIEW`. These labels improve graph clarity and reviewer priority, but never authorize automatic promotion.
- Source registry governance: Reviewer-owned source registry artifacts under `data/source_registry/` track official source roots, trusted host visibility, corridor maintenance, universe expansion readiness, graph scaling state, and OpenAlex safety. These artifacts are not production graph data.
- Promotion + validation flow: SEC-backed candidates can become production edges only after preview, manual review, explicit promotion, and validation.

## CORE RULES

- No fake data, guessed URLs, placeholder records, or unsupported claims.
- No automatic production writes.
- Candidate -> preview -> manual promotion only.
- No backend in the current app.
- `data/companies.json` and `data/connections.json` are the production source of truth.
- `data/source_registry/` is review governance only and cannot create relationships.

## HOW DATA ENTERS THE SYSTEM

1. Public source evidence is collected locally, preferably from SEC filings or official company sources.
2. Local scripts cache and inspect source material.
3. Extracted relationship signals become candidate previews.
4. Candidate files live under `data/candidates/` and are not production data.
5. Promotion preview identifies which candidates are safe to consider.
6. Manual promotion can append validated edges to `data/connections.json`.
7. `python scripts/validate_data.py` must pass after production changes.

## SOURCE REGISTRY GOVERNANCE

D146 introduces `scripts/source_registry_governance.py`:

```text
production JSON + candidate artifacts + OpenAlex cache -> source registry report -> Workbench governance console
```

## Candidate Company Preview

D147 adds review-only company expansion artifacts:

- `data/candidates/candidate_companies.json`
- `data/candidates/universe_expansion_batches.json`
- `data/candidates/promotion_planner_report.json`

These files can be loaded by the static browser UI only as preview nodes, preview tables, promotion-planner rows, graph-impact simulations, and expansion batch summaries. Candidate-company preview edges are corridor-planning anchors with `corridor_assignment_not_relationship` semantics. They do not prove a relationship, do not assign ecosystem membership authoritatively, do not create production edges, and do not write production companies.

D148 promotion planning is review-only. Readiness scores are deterministic planning scores based on official source availability, SEC identity support, duplicate status, corridor/ecosystem usefulness, staged hub value, source diversity, and review completeness. They are not confidence scores and do not authorize promotion.

Generate them locally with:

```bash
python scripts/universe_expansion_batches.py --write --force
```

The batch engine guards production hashes, checks duplicate tickers against production, reads official ticker/CIK staging data, and writes only review artifacts under `data/candidates/`.

Generated files:

- `data/source_registry/official_company_sources.json`
- `data/source_registry/trusted_source_hosts.json`
- `data/source_registry/corridor_source_registry.json`
- `data/source_registry/source_governance_report.json`

The registry validates URL shape, source age, duplicate URL usage, host categories, universe expansion blockers, corridor maintenance queues, strategic hub scores, and large-graph readiness. It performs no network calls and writes no production graph files.

## SEC PIPELINE SUMMARY

Primary SEC path:

```text
SEC lookup/cache -> filing plan/fetch -> filing inspect/report -> candidate preview/write -> promotion preview -> manual promotion -> validation
```

Candidate-company universe growth uses:

```text
candidate company staging -> Source Workbench preview -> promotion planner report -> reviewer state decision -> manual promotion review -> validation
```

Key scripts:

- `scripts/sec_bulk_pipeline_run.py`: bulk SEC candidate workflow for approved ticker/CIK mappings.
- `scripts/sec_pipeline_run.py`: single-ticker SEC workflow.
- `scripts/sec_signal_report.py`: aggregates filing signals for review.
- `scripts/sec_signal_candidates_preview.py`: prints candidate-shaped records without writing.
- `scripts/sec_signal_candidates_write.py`: writes review-only SEC candidates when explicitly requested.
- `scripts/promotion_planner_report.py`: writes only the review-only promotion planner artifact with readiness scoring, reviewer lifecycle summaries, batch comparison, and graph-impact simulation.
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

## SCHEDULED REVIEW ORCHESTRATION

D143 adds review-only scheduled/local orchestration:

```text
python scripts/review_artifact_refresh.py --write --force
```

Generated review-only artifacts:

- `data/candidates/review_pipeline_summary.json`
- `data/candidates/source_coverage_refresh_report.json`
- `data/candidates/openalex_ecosystem_candidates.json`
- `data/candidates/openalex_topic_overlap.json`
- `data/candidates/openalex_institution_overlap.json`
- `data/candidates/openalex_cluster_hints.json`

GitHub Actions workflows:

- `.github/workflows/sec_candidate_pipeline.yml`
- `.github/workflows/openalex_enrichment.yml`
- `.github/workflows/review_artifact_refresh.yml`

These workflows restore caches, run bounded local scripts, validate outputs, and upload artifacts. They do not push commits, mutate production graph data, or run promotion.

## OPENALEX ENRICHMENT

OpenAlex is used for ecosystem discovery, topic overlap, research clustering, institution overlap, and company/topic proximity hints:

```text
python scripts/openalex_enrichment.py --write --force
python scripts/openalex_enrichment.py --write --force --allow-network --max-requests 24 --max-entities 20
```

Default mode is cache-only/dry-run. Network mode requires explicit `--allow-network`, respects a hard request cap, reuses `data/cache/openalex/entity_resolution_cache.json`, and never writes API keys to artifacts or cache. `OPENALEX_API_KEY` can be provided locally or as a GitHub Secret.

OpenAlex-derived records must remain:

- `review_only`
- source-attributed
- confidence-labeled
- `relationship_claim_created: false`
- outside production promotion unless separately reviewed through the existing candidate workflow

## TIERED EVIDENCE AND FAST-TRACK SOURCE COVERAGE

D144 adds a formal display policy for production and review-only relationship rows:

- `VERIFIED`: SEC, official company, or strong source-backed production evidence.
- `STRONG_INFERRED`: obvious public competitor/ecosystem relationship from stable metadata. Safe for graph visibility, not official partnership/customer proof.
- `CONTEXT_ONLY`: OpenAlex/topic overlap, weak ecosystem hints, or enrichment context. Never relationship proof.
- `NEEDS_REVIEW`: ambiguous, candidate-only, weak, conflicting, or unresolved signals.

Trusted relationship classes are derived from existing metadata and endpoint context:

- `competitor`
- `ecosystem_overlap`
- `supplier_ecosystem`
- `cloud_hyperscaler_exposure`
- `semiconductor_supply_chain`
- `financial_infrastructure_overlap`

Reviewer decision states are review-only labels: `accepted_for_visibility`, `accepted_for_review`, `blocked`, `weak_signal`, `enrichment_only`, and `ready_for_promotion_review`.

Fast-track source coverage means strong inferred edges can stay visible while reviewers prioritize source enrichment batches. It does not create source URLs, infer partnerships, or promote production data.

## D145 LARGE-SCALE SOURCE AND ECOSYSTEM EXPANSION

D145 source-refreshed production coverage and expanded the source-backed graph while preserving the static production data contract:

- Production edges: 134.
- Source-backed production edges: 134.
- Unsourced production edges: 0.
- Candidate auto-promotion: none.
- Browser ingestion: none.

Source coverage now includes SEC filings, official company reports, investor-relations pages, official partnership announcements, and official partner/customer pages. The D145 expansion script is `scripts/d145_source_expand_graph.py`; it is an audit helper for this phase, not a live ingestion path.

Source Workbench refresh artifacts now expose corridor planning lanes even after the source backlog is clear:

- AI compute -> foundry -> cloud
- Payment network -> banks
- PBM -> pharma -> insurance
- Oilfield services -> energy majors
- Aerospace suppliers -> OEMs
- Enterprise SaaS -> cloud platforms
- Retail -> consumer distribution

These lanes are source-review planning metadata only. They do not create claims, fabricate memberships, or authorize automatic promotion.

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

## DATA EXPANSION PREFLIGHT

D142 adds a review-only preflight report helper:

```text
python scripts/data_expansion_preflight.py --write --force
```

The script reads production companies/connections plus optional SEC candidate and triage artifacts. It performs no network calls and writes only:

```text
data/candidates/data_expansion_preflight_report.json
```

The report includes:

- production edge source coverage and sourced ratio
- SEC-backed production edge count
- stale review count
- high-value production edges missing source URLs
- relationship types with source coverage gaps
- candidate promotion blockers
- candidate tickers missing from the production universe
- data expansion priorities for reviewers

The Source Workbench displays this artifact when present and falls back to a missing-report state when it is absent. The browser never executes the script, ingests sources, promotes candidates, or writes production data.

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

Reviewer-added official IR, newsroom, and partner/customer roots belong in `data/source_registry/reviewer_source_roots.json`. They must be real HTTPS roots and remain lifecycle context only; they do not escalate trust automatically or prove relationships.
