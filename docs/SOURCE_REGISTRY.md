# StockPhotonic Source Registry

**Last Updated**: May 17, 2026

This registry defines the allowed source types, source tiers, relationship categories, and metadata requirements for candidate ingestion. It is a review foundation only. Candidate records must not be treated as production graph data until they pass validation and manual review.

D146 adds reviewer-owned registry artifacts under `data/source_registry/`. These artifacts organize official source roots, trusted host visibility, corridor maintenance, universe expansion readiness, and source lifecycle queues. They do not authorize production writes or automatic trust escalation.

---

## Source Tiers

| Tier | Meaning | Production Use |
|------|---------|----------------|
| 1 | Primary or official source | Eligible for high-confidence candidates after validation and review |
| 2 | Reputable secondary or contextual source | Eligible for review when provenance is clear |
| 3 | Unknown, community, scraped, or weak-provenance source | Discovery only unless independently verified |

SEC EDGAR and official company sources should be preferred before third-party mirrors or API-derived claims.

---

## Relationship Categories

Allowed candidate relationship categories:

- `subsidiary`
- `ownership`
- `institutional_ownership`
- `shared_holder`
- `supplier_customer`
- `supply`
- `partnership`
- `investment`
- `competitor`
- `peer`
- `government_contract`
- `public_funding`
- `ipo_underwriting`
- `capital_markets`
- `crypto_exposure`
- `mining_exposure`
- `blockchain_exposure`
- `etf_holding`
- `holdings_exposure`
- `ecosystem`

Current production `data/connections.json` supports a smaller set. Candidate categories must be mapped and reviewed before any production write.

---

## Required Candidate Metadata

Every candidate connection must include:

- `source_ticker`
- `target_ticker`
- `relationship_type`
- `source_type`
- `source_tier`
- `source_url`
- `filing_type`
- `filing_date`
- `capture_date`
- `extraction_text`
- `confidence_candidate`
- `signal_score`
- `review_status`

`review_status` starts as `pending`. Missing SEC-only fields such as `filing_type` may be an empty string only for non-SEC source types.

## Candidate Company And Ticker Universe Metadata

`data/candidates/official_ticker_universe.json` stages future real public-company candidates only. It must not be loaded by the app, and it must not directly write to `data/companies.json` or `data/connections.json`.

D147 candidate-company preview files are a narrower reviewer surface derived from approved identity metadata:

- `data/candidates/candidate_companies.json`
- `data/candidates/universe_expansion_batches.json`

These files may be loaded by the static app only as review tables and graph-preview nodes. Their preview edges are corridor-planning anchors, not relationship claims. They cannot prove ecosystem membership, promote companies, or create production connections.

Candidate ticker-universe records, when present, must include:

- `ticker`
- `name`
- `exchange`
- `asset_type`
- `source_type`
- `source_tier`
- `source_url`
- `capture_date`
- `review_status`

`asset_type` should be `public_company` until another asset type has explicit schema and validation support. `review_status` starts as `pending`. Future production promotion requires source validation, duplicate checks, manual review, production validation, and an explicit writer phase that does not exist yet.

`official_exchange_listing` is the dedicated source type for official exchange or listing-venue ticker universe staging. It is candidate-company metadata only: it can support public-company discovery, but it does not prove a business relationship and cannot create production edges.

## Candidate CIK Mapping Metadata

`data/candidates/cik_mappings.json` stages future ticker-to-CIK lookup references for SEC fetch/cache workflows only. It must not be loaded by the app, and it must not directly write to `data/companies.json` or `data/connections.json`.

Candidate CIK mapping records, when present, must include:

- `ticker`
- `cik`
- `source_type`
- `source_tier`
- `source_url`
- `capture_date`
- `review_status`

`ticker` must be uppercase. `cik` must be 10-digit zero-padded or normalizable to 10 digits. `source_type` must be registered, `source_tier` must match the registry tier, and `source_url` must be `http://` or `https://`. `review_status` must be `pending` or `approved_for_fetch`. The SEC helper may read only those candidate/reference mappings for explicit `--ticker` lookup, but it must not invent mappings or promote them to production data.

---

## Allowed Source Types

### `sec_filing`

- `source_type`: `sec_filing`
- `tier`: 1
- `description`: Official SEC EDGAR filing or structured SEC filing data.
- `allowed relationship types`: `subsidiary`, `ownership`, `supplier_customer`, `supply`, `partnership`, `investment`, `competitor`, `peer`, `ipo_underwriting`, `capital_markets`, `crypto_exposure`, `mining_exposure`, `blockchain_exposure`, `ecosystem`
- `required metadata`: `source_url`, `filing_type`, `filing_date`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

### `company_release`

- `source_type`: `company_release`
- `tier`: 1
- `description`: Official company investor relations release, press release, earnings material, or company disclosure page.
- `allowed relationship types`: `supplier_customer`, `supply`, `partnership`, `investment`, `competitor`, `peer`, `government_contract`, `public_funding`, `crypto_exposure`, `mining_exposure`, `blockchain_exposure`, `ecosystem`
- `required metadata`: `source_url`, `filing_date`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

### `news`

- `source_type`: `news`
- `tier`: 2
- `description`: Reputable financial, business, or industry news source with clear sourcing.
- `allowed relationship types`: `supplier_customer`, `supply`, `partnership`, `investment`, `competitor`, `peer`, `government_contract`, `public_funding`, `ipo_underwriting`, `capital_markets`, `crypto_exposure`, `mining_exposure`, `blockchain_exposure`, `ecosystem`
- `required metadata`: `source_url`, `filing_date`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

### `partner_page`

- `source_type`: `partner_page`
- `tier`: 2
- `description`: Official partner, customer, marketplace, supplier, or ecosystem page from a company or platform.
- `allowed relationship types`: `supplier_customer`, `supply`, `partnership`, `investment`, `ecosystem`, `crypto_exposure`, `blockchain_exposure`
- `required metadata`: `source_url`, `filing_date`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

### `13f_dataset`

- `source_type`: `13f_dataset`
- `tier`: 1
- `description`: SEC 13F data used for institutional ownership and shared-holder candidate layers.
- `allowed relationship types`: `institutional_ownership`, `shared_holder`, `ownership`, `investment`, `holdings_exposure`
- `required metadata`: `source_url`, `filing_type`, `filing_date`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

### `official_exchange_listing`

- `source_type`: `official_exchange_listing`
- `tier`: 1
- `description`: Official exchange or listing-venue data used only to stage public-company ticker universe candidates.
- `allowed relationship types`: none; this source type is not relationship evidence
- `required metadata`: `ticker`, `name`, `exchange`, `asset_type`, `source_url`, `capture_date`, `review_status`
- `production promotion`: candidate company promotion only in a future explicit writer phase after duplicate checks and manual review; never production edge promotion

### `unknown`

- `source_type`: `unknown`
- `tier`: 3
- `description`: Any source whose provenance, original source, or durability is unclear.
- `allowed relationship types`: none for production promotion; discovery review only
- `required metadata`: `source_url`, `capture_date`, `extraction_text`, `confidence_candidate`, `signal_score`, `review_status`

Unknown-source candidates must not be promoted to production data.

Reviewer-added official IR, newsroom, and partner/customer roots are staged in `data/source_registry/reviewer_source_roots.json`. Roots must be HTTPS URLs with valid hosts. They classify lifecycle/source review state only and cannot escalate trust automatically.

---

## Promotion Guardrails

- Candidate data lives under `data/candidates/`.
- Production data lives under `data/companies.json` and `data/connections.json`.
- Reviewer-owned source registry data lives under `data/source_registry/`.
- Candidate ingestion scripts must run as dry-run simulation unless a future reviewed writer is explicitly implemented.
- No candidate may be promoted unless both tickers already exist in `data/companies.json`.
- No candidate may be promoted without a valid `source_url`, valid source tier, supported relationship type, and non-duplicate relationship key.
- Manual review is required before durable production writes.

---

## Reviewer-Owned Source Registry

`data/source_registry/official_company_sources.json`

- Records one source-governance shell per production company.
- Registers observed official SEC CIK source roots when a reviewed CIK mapping is present.
- Leaves company IR, newsroom, and partner/customer source roots empty until a reviewer adds real URLs.
- Sets `auto_trust_escalation_allowed: false`.

`data/source_registry/trusted_source_hosts.json`

- Inventories observed source hosts and classifies them as SEC, official company IR, official newsroom, partner/customer, trusted industry/report, or observed host.
- Host registration is a visibility aid only.
- A trusted host does not prove any relationship by itself.

`data/source_registry/corridor_source_registry.json`

- Defines corridor maintenance lanes, source categories, review keywords, and maintenance cadence.
- Corridor definitions are review scaffolding, not relationship claims.

`data/source_registry/source_governance_report.json`

- Generated by `scripts/source_registry_governance.py`.
- Summarizes source quality, stale queues, duplicate source URL reduction, invalid URL detection, universe readiness, corridor maintenance, strategic hubs, graph scaling, and OpenAlex safety.
- Has `artifact_status: review_only`, `production_write_allowed: false`, and zero production writes.

---

## Stale Source Review Logic

Source ages are computed from `verified_date` on production edges or filing/capture dates on candidate artifacts:

- `verified_recently`: 0-180 days old.
- `aging_evidence`: 181-365 days old.
- `stale_review_recommended`: more than 365 days old.
- `no_verified_date`: missing or invalid date.

Stale and missing-date rows are review queues only. They do not demote production data automatically.

---

## Universe Expansion Philosophy

Universe expansion is staged as review-only metadata first. Required checks include:

- duplicate ticker prevention;
- alias conflict detection;
- official listing source validation;
- CIK mapping readiness;
- missing metadata detection;
- reviewer sector and corridor assignment;
- promotion preview and manual review before any future production writer.

No source registry artifact can create a production company or edge.
