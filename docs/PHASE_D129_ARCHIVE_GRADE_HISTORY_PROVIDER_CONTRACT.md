# Phase D129 Archive-Grade History Provider Contract

Date: 2026-05-08

Status: system design only. No new provider integration, no browser-side provider calls, no Wallet Lookup behavior change, and no graph behavior change are introduced by this phase.

## Purpose

CryptoPhotonic can stage paginated wallet history through the Worker, but staged pages do not currently prove full lifetime wallet history. This document defines the provider contract required before CryptoPhotonic can truthfully claim "full history" or enable archive-grade replay at scale.

The current system remains conservative:

- Wallet Lookup replaces the active graph only through the existing Worker wallet-activity path.
- Wallet History pages remain staged through `/api/crypto/wallet-history`.
- Replay remains preview-only unless a later implementation explicitly opts into a graph preview path.
- The browser must never call Helius, lana.ai, Solana RPC, archive RPC, generic external providers, or private endpoints directly.

## Source Notes

Current provider direction was checked against primary provider documentation on 2026-05-08:

- Helius `getTransactionsForAddress`: https://www.helius.dev/docs/rpc/gettransactionsforaddress
- Helius `getTransfersByAddress`: https://www.helius.dev/docs/rpc/gettransfersbyaddress
- Helius Enhanced Transactions FAQ: https://www.helius.dev/docs/faqs/enhanced-transactions
- Helius historical data overview: https://www.helius.dev/docs/rpc/historical-data

The important change for future planning is that Helius now documents Enhanced Transactions as deprecated for new integrations and points new transaction-history integrations toward `getTransactionsForAddress`. This phase records that direction only. It does not call the new endpoint.

## Full History Criteria

"Full wallet history" means the provider can produce a complete, gap-free, deterministic, replayable record of every relevant on-chain transaction or transfer involving the target wallet scope for the requested chain and coverage mode.

For Solana, the target wallet scope must explicitly define whether it includes:

- Direct signer/account references only.
- Associated token accounts owned by the wallet.
- Token accounts that changed owner over time.
- Native SOL, WSOL, SPL Token, Token-2022, mint, burn, fee, close-account, and owner-change flows.
- Failed transactions, if they are required for the product claim.

Minimum criteria:

| Criterion | Requirement |
|---|---|
| Deterministic pagination | Repeating the same wallet, filters, order, and cursor must return the same page boundary unless the provider explicitly versioned or invalidated the cursor. |
| No missing gaps | The provider must expose gap detection through slots, block times, signature boundaries, monotonic indexes, totals, or an equivalent audit mechanism. |
| Historical depth | The provider must state and enforce the depth guarantee: genesis-to-present, fixed retention window, plan-limited depth, or best-effort recent history. |
| Ordering guarantees | The provider must support stable chronological ordering for replay, with deterministic tie-breakers such as slot, transaction index, instruction index, inner instruction index, transfer index, and signature. |
| Cursor guarantees | Cursors must be opaque or documented, stable across requests long enough to complete a scan, non-repeating, and capable of proving exhaustion. |
| Transaction completeness | Each transaction row must include enough detail to reconstruct token and SOL flows, counterparties, timestamps, signatures, indexes, and wallet relationship without relying on UI inference. |
| Replay suitability | The output must support oldest-first replay without partial ordering or collapsed netting that hides intermediate flows. |
| Source accountability | Each row must include provider, endpoint family, coverage mode, generated time, and confidence metadata. |

Full history is not proven by:

- One or more recent pages.
- A missing `nextCursor` from a provider with undocumented depth.
- A short page from a rate-limited provider.
- Public RPC signature pagination without associated token account coverage.
- Parsed transaction APIs that omit unsupported transaction types.
- Transfer-only APIs when transaction-level context is needed for replay.

## Provider Capability Requirements

Any provider proposed for archive-grade history must be evaluated against this table before implementation.

| Capability | Basic | Partial | Archive |
|---|---|---|---|
| Cursor type | Offset, page, signature, or generic cursor with limited guarantees. | Stable cursor or keyset cursor with documented page continuity. | Keyset, slot/index, or opaque cursor with stable ordering, exhaustion proof, and replay resume support. |
| Max depth | Recent, plan-limited, or unknown. | Explicit retention window or broad historical range with caveats. | Genesis-to-present or documented complete indexed coverage for the target scope. |
| Ordering guarantees | Newest-first or provider default only. | Ascending/descending supported but tie-break details incomplete. | Chronological and reverse order, with deterministic tie-breakers for same-slot and same-transaction rows. |
| Historical coverage | Direct address references only, or parser-defined coverage. | Direct address plus token-account support for known cases. | Wallet-owned token account coverage over time, native SOL, SPL, Token-2022, account close, mints/burns, owner changes, and failed/successful status as declared. |
| Rate limits | Too low or unstable for controlled backfill. | Backfill possible with throttling and caching. | Backfill suitable under documented quotas, with retry headers or clear budget planning. |
| Batch size | Small pages, no batch detail lookups. | Pages up to practical Worker-safe limits, optional batch details. | Efficient pages plus batch detail fetches or full detail in history response. |
| Response consistency | Provider can reorder or omit rows without strong signals. | Mostly stable, with documented filters and some totals or cursor metadata. | Stable schema, cursor versioning, gap signals, error taxonomy, and documented exclusions. |
| Replay suitability | Low. Useful for inspection only. | Medium. Useful for bounded preview after normalization. | High. Supports full chronological reconstruction and gap checks. |

Required metadata fields for Worker responses and diagnostics:

```json
{
  "provider_grade": "basic | partial | archive",
  "replay_suitability": "low | medium | high",
  "completeness_confidence": 0,
  "historical_depth": "unknown | recent | retention_window | genesis_to_present | provider_defined",
  "ordering_guarantee": "unknown | provider_default | reverse_chronological | chronological_with_tiebreakers",
  "cursor_guarantee": "unknown | best_effort | stable_keyset | exhaustion_provable",
  "coverage_scope": "direct_address | wallet_with_token_accounts | provider_defined | archive_wallet_scope"
}
```

`completeness_confidence` is not a probability of truth. It is a product-facing confidence score based on documented provider guarantees and observed scan state:

- `0-39`: inspection only.
- `40-69`: bounded preview or partial replay.
- `70-89`: strong but not archive-certified.
- `90-100`: archive-grade contract with explicit coverage and gap checks.

## Replay Data Requirements

True replay requires rows that can be sorted into full chronological order without hiding intermediate movement.

Each replay event must include:

- Chain.
- Signature or transaction hash.
- Slot or block height when available.
- Timestamp or block time.
- Transaction index inside the block when available.
- Instruction index, inner instruction index, and transfer index when available.
- Source wallet or null source for mint-like events.
- Destination wallet or null destination for burn-like events.
- Token mint or native SOL marker.
- Raw amount and display amount.
- Decimals.
- Transaction status and error state when the selected coverage mode includes failed transactions.
- Wallet relationship to the tracked wallet: inbound, outbound, self, owner-change, fee, mint, burn, intermediary, or unknown.
- Source provider and endpoint family.

Replay must support:

- Full chronological ordering, preferably oldest-first from the provider or after a complete scan with stable tie-breakers.
- Token and SOL flows in the same normalized stream.
- Wallet relationships without inferring ownership from a single transfer.
- Timestamps for animation and user inspection.
- Multi-leg transaction grouping by signature.
- Reconciliation flags for rows omitted, unsupported, filtered, or collapsed by the provider.

Replay must avoid:

- Missing events.
- Partial ordering.
- Net-only movement that hides intermediate accounts.
- Current-price backfills represented as historical USD truth.
- Provider labels used as identity or risk claims.
- Any replay claim when provider depth, cursor exhaustion, or parser coverage is unknown.

## Current Provider Evaluation

### Helius

Strengths:

- Strong Solana-specific history product surface.
- Current docs list archive-oriented `getTransactionsForAddress` with filtering, chronological sorting, token-account support, efficient pagination, and full transaction data.
- Historical data docs describe genesis-to-present archival infrastructure.
- `getTransfersByAddress` is transfer-focused and includes parsed SOL/token movement, instruction indexes, confirmation status, counterparties, amounts, decimals, and pagination.

Weaknesses:

- Existing CryptoPhotonic Worker history path still uses the older address-history style adapter, not the newer archive-style methods.
- Enhanced Transactions is documented as deprecated for new work, so future implementation should not deepen dependency on the legacy Enhanced Transactions surface.
- `getTransfersByAddress` currently has a documented one-year retention limit and is transfer-only, so it cannot be the sole full-history provider.
- Helius-specific RPC methods require server-side credentials and plan verification.

Missing capabilities before archive claim:

- Worker adapter for `getTransactionsForAddress` is not implemented.
- Cursor exhaustion and gap verification are not implemented.
- Full chronological replay contract is not implemented.
- Transfer rows would need stitching to full transaction rows if using `getTransfersByAddress` as an auxiliary source.

Current grade in CryptoPhotonic:

- Provider grade: `partial`.
- Replay suitability: `medium` for bounded staged preview; not archive-grade.
- Completeness confidence: `55`.

### Generic Provider

Strengths:

- Keeps provider-specific URLs and bearer tokens Worker-side.
- Allows testing a future owned backend or documented vendor endpoint without browser changes.
- Existing normalizer accepts events, transactions, items, results, or data arrays plus next-cursor variants.

Weaknesses:

- The contract is intentionally generic and cannot imply provider depth, ordering, cursor stability, or archive coverage.
- The Worker can normalize a page but cannot prove source completeness without provider-specific metadata.
- Generic cursors may be offset-like, unstable, or non-replayable.

Missing capabilities before archive claim:

- Required upstream metadata for coverage mode, ordering, cursor type, retention, totals, gap checks, and limitations.
- Provider-specific compliance tests.
- Explicit replay ordering and transaction completeness mapping.

Current grade in CryptoPhotonic:

- Provider grade: `basic`.
- Replay suitability: `low` by default, upgradeable only when the configured upstream contract proves stronger guarantees.
- Completeness confidence: `25`.

### lana.ai

Strengths:

- Placeholder candidate exists so the system can express "not configured" without browser provider calls.

Weaknesses:

- No public wallet-history API or authentication contract was verified for D129.
- No cursor, ordering, coverage, retention, rate-limit, or replay semantics are documented in this repository.
- The Worker must not call lana.ai until public docs or a private contract are reviewed.

Missing capabilities before archive claim:

- Public or supplied API documentation.
- Authentication model.
- Pagination and cursor guarantees.
- Wallet scope and historical depth.
- Response schema and replay field mapping.

Current grade in CryptoPhotonic:

- Provider grade: `basic`.
- Replay suitability: `low`.
- Completeness confidence: `0`.

### Archive / RPC Providers

Strengths:

- Conceptually the right class for full lifetime wallet history when backed by indexed archival storage.
- Can support gap checks through slots, blocks, transaction indexes, and deterministic ordering.
- Can combine signatures, full transaction details, token account history, and block-level verification.

Weaknesses:

- Standard Solana RPC alone does not prove full wallet history because direct address signature scans can miss associated token account activity.
- Public RPC is not suitable for production backfills.
- Full reconstruction can require indexing, batching, token-account ownership tracking, retries, and storage.

Missing capabilities before archive claim:

- Chosen provider and endpoint contract.
- Archive retention guarantee.
- Token-account ownership over time.
- Stable chronological pagination.
- Backfill budget and cache design.
- Gap detection and resumable scans.

Target grade:

- Provider grade: `archive` only after documented coverage, stable cursor, and replay tests pass.
- Replay suitability: `high`.
- Completeness confidence: `90+` only with explicit gap checks.

## Integration Strategy

Recommended direction: use a single archive-grade primary provider for the authoritative history scan, plus auxiliary providers only for enrichment or validation.

Single-provider primary is preferred because:

- Cursor semantics stay consistent.
- Gap detection is simpler.
- Replay ordering can be provider-native.
- The Worker cache can store one canonical scan state per wallet and coverage mode.

Multi-provider fallback is allowed only if it does not silently stitch incompatible histories. Fallback must be explicit:

- If the primary provider is unavailable, return `provider_unavailable`, not a mixed page that appears complete.
- If a secondary provider supplies partial data, mark `provider_grade`, `replay_suitability`, and `completeness_confidence` lower.
- If providers disagree, keep both provenance records and do not mark full history loaded.

Stitching strategy, if multiple sources are used later:

1. Choose one canonical provider for ordering and cursor exhaustion.
2. Normalize auxiliary sources into sidecar enrichment keyed by signature and transfer index.
3. Deduplicate by signature, slot, transaction index, instruction index, inner instruction index, transfer index, source wallet, destination wallet, mint, and raw amount.
4. Mark conflicts as review-required metadata.
5. Never fill gaps silently from another provider without a gap record.

Caching strategy for large histories:

- Cache scan manifests by wallet, provider, coverage mode, commitment, filters, and provider contract version.
- Cache pages by cursor and page hash.
- Cache normalized transactions by signature.
- Cache transfer rows by signature plus instruction indexes.
- Store sanitized graph-ready rows and operational cursors only in browser-facing endpoints.
- Keep raw provider payloads out of public files. If raw payloads are required for local diagnostics, store them in a non-public cache with secret scanning and retention rules.

Pagination flow for future archive-grade scans:

1. Create a scan manifest with provider, wallet, coverage mode, order, requested limits, contract version, and started timestamp.
2. Request the first page from the Worker-side provider only.
3. Validate schema, ordering, cursor, and page bounds.
4. Normalize records into replay rows.
5. Record page hash, cursor in, cursor out, first and last slot, first and last signature, row count, omitted count, and warnings.
6. Continue until the provider supplies a documented exhaustion signal.
7. Run gap checks and duplicate checks.
8. Mark `full_history_loaded: true` only when the provider contract and scan manifest prove exhaustion without gaps.

## System Limits

CryptoPhotonic should not attempt unlimited browser-side replay. Full history belongs in Worker-side or generated datasets with bounded UI previews.

Recommended limits:

| Limit | Recommendation |
|---|---:|
| Worker history page size | Keep current cap at 50 until a provider-specific adapter proves larger pages are safe. |
| Browser staged rows | 10,000 rows maximum for inspection and copy/export prep. |
| Graph-ready preview transfers | 25,000 transfer rows maximum. |
| Default visual replay window | 500 to 1,000 chronological transfer rows. |
| Maximum opt-in preview replay | 5,000 transfer rows after explicit user action. |
| Active graph nodes | 2,000 nodes for interactive browser rendering. |
| Active graph edges | 5,000 edges for interactive browser rendering. |
| Archive scan storage | Worker/cache side, paged and resumable. Do not keep full archive scans only in browser memory. |
| Progressive loading boundary | Stop on rate limit, provider limit, cursor stall, schema mismatch, gap signal, or 20 pages per UI action. |

Performance constraints:

- Browser pagination must remain user-triggered or explicitly progressive with caps.
- Large histories must stream or page through a cache; they must not block the main UI thread with one huge JSON payload.
- Graph preview must remain separate from Wallet Lookup replacement data.
- Full replay should be built from a manifest-backed scan, not from ad hoc staged rows.

## Worker Metadata Contract

Worker history responses and diagnostics should expose provider grade metadata without changing data loading behavior:

```json
{
  "provider_grade": "basic",
  "replay_suitability": "low",
  "completeness_confidence": 0,
  "historical_depth": "unknown",
  "ordering_guarantee": "unknown",
  "cursor_guarantee": "unknown",
  "coverage_scope": "provider_defined",
  "archive_contract_version": "d129_archive_history_contract_v1"
}
```

These fields are descriptive only in D129. They must not enable browser provider calls, automatic graph merge, Wallet Lookup behavior changes, or new provider requests.

## Validation Rules

Before any later implementation can claim archive support:

- No API keys, bearer tokens, private URLs, request headers, or raw provider payloads appear in browser files or public JSON.
- Browser calls only Worker-owned CryptoPhotonic endpoints.
- Provider implementation lives behind the Worker or another secure runtime.
- Wallet Lookup behavior remains separate from Wallet History staging.
- Provider pages include grade, replay suitability, confidence, cursor, coverage, and ordering metadata.
- Tests verify cursor progress, cursor exhaustion, duplicate handling, gap flags, ordering, and schema normalization.
- Replay preview refuses archive labels when provider grade is `basic` or `partial`.

## Recommended Next Provider Direction

Do not integrate a new provider yet.

The next implementation design should evaluate Helius `getTransactionsForAddress` as the primary archive candidate because it is currently the strongest documented fit for full transaction history, associated token account coverage, chronological ordering, and replay-oriented pagination. Helius `getTransfersByAddress` should be evaluated as an auxiliary transfer-reconciliation source, not the sole full-history provider, because its current documented retention is one year and it returns transfer rows rather than complete transaction payloads.

The generic provider should remain a Worker-side adapter only, with archive claims disabled until the configured upstream supplies a documented archive contract. lana.ai should remain disabled until API and auth documentation are verified. Standard/public RPC should remain a conceptual fallback for low-level verification, not the authoritative full-history source.
