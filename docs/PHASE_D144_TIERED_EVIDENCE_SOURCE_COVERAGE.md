# Phase D144 - Tiered Evidence Policy + Source Coverage Fast-Track

## Scope

D144 adds a tiered evidence policy, trusted relationship classes, fast-track source coverage artifacts, and clearer graph trust visualization for StockPhotonic.

This is not an ingestion or promotion phase. It does not add backend code, browser-side ingestion, automatic promotion, fake URLs, or CryptoPhotonic changes.

## Tiered Evidence Policy

Relationships now derive a display-only evidence tier:

- `VERIFIED`: SEC, official company, or strong source-backed production relationship evidence.
- `STRONG_INFERRED`: obvious public competitor or ecosystem overlap inferred from stable metadata. Safe for graph visibility, not official partnership proof.
- `CONTEXT_ONLY`: OpenAlex, topic overlap, research, or weak ecosystem context. Not relationship proof.
- `NEEDS_REVIEW`: ambiguous, candidate-only, weak, conflicting, or unresolved relationship signals.

Display confidence is separate from promotion authority. No evidence tier can bypass candidate preview, manual promotion, or validation.

## Trusted Relationship Classes

The trusted class layer is derived from existing edge metadata, endpoint sector/industry context, and validated source-policy logic:

- `competitor`
- `ecosystem_overlap`
- `supplier_ecosystem`
- `cloud_hyperscaler_exposure`
- `semiconductor_supply_chain`
- `financial_infrastructure_overlap`

Only safe classes can reduce manual-review pressure, and even then they only become `STRONG_INFERRED` visibility labels. Generic supplier/customer claims remain more conservative unless stronger evidence exists.

## Reviewer Decision States

Review-only decision labels are now emitted in browser helpers and source coverage artifacts:

- `accepted_for_visibility`
- `accepted_for_review`
- `blocked`
- `weak_signal`
- `enrichment_only`
- `ready_for_promotion_review`

These states are not executable promotion actions. They are reviewer guidance for prioritization and Source Workbench display.

## Source Coverage Fast-Track

`scripts/data_expansion_preflight.py` and `scripts/source_coverage_refresh.py` now add review-only source enrichment fields:

- `tiered_evidence_policy_summary`
- `fast_track_source_targets`
- `source_expansion_batches`
- `hub_source_gaps`
- per-row `evidence_tier`, `trusted_relationship_class`, `reviewer_decision_state`, and `fast_track_visibility`

The artifacts can suggest source-search targets and batches, but they never fabricate URLs and never write production graph data.

## Graph And Workbench UI

Graph Intelligence and Source Workbench now expose tier labels in:

- graph filters
- active graph legend
- source coverage lens
- relationship evidence cards
- selected-company investigation workspace
- evidence review queues
- candidate preview rows
- OpenAlex hint rows
- Source Workbench policy summaries and fast-track batches

OpenAlex remains explicitly `CONTEXT_ONLY` / enrichment-only.

## Safety

- Production graph data remains static JSON.
- Candidate preview and manual promotion flow is unchanged.
- No browser-side ingestion was added.
- No backend/provider/API behavior changed.
- CryptoPhotonic behavior is unchanged.
