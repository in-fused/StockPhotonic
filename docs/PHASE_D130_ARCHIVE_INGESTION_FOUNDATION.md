# Phase D130 Archive Ingestion Foundation

Date: 2026-05-12

Status: implemented as an additive foundation. Wallet Lookup, Live Feed, active graph behavior, and StockPhotonic remain unchanged.

## What Changed

D130 introduces the first real archive-capable history ingestion foundation for CryptoPhotonic:

- Worker-side Helius `getTransactionsForAddress` adapter.
- Safe scan manifests for progressive historical scans.
- Gap and confidence tracking.
- Replay-window metadata for preview-only replay scaling.
- Expanded provider diagnostics for archive and replay readiness.
- Frontend status surfaces for scan progress, confidence, provider grade, archive readiness, replay coverage, and staged-history warnings.

The browser still calls only Worker-owned endpoints. API keys, provider URLs, request headers, bearer tokens, and raw provider payloads are never returned to browser code.

## Helius Archive Adapter

The default Helius wallet-history path now calls Helius RPC `getTransactionsForAddress` from the Worker:

- method: `getTransactionsForAddress`
- transaction detail mode: `full`
- cursor: `paginationToken`
- ordering: `sortOrder=desc` by default, `asc` if `CRYPTO_HELIUS_HISTORY_SORT_ORDER=asc`
- token-account coverage: `filters.tokenAccounts`, default `balanceChanged`
- status filter: default `any`
- normalized output: existing CryptoPhotonic event shape

The previous Helius Enhanced Transactions address-history adapter remains available as `CRYPTO_HELIUS_HISTORY_ADAPTER=legacy` and as a downgraded fallback. Legacy fallback pages are marked as partial and do not raise archive completeness confidence.

## Scan Manifest Contract

Each Worker history page returns safe metadata:

```json
{
  "scan_id": "scan:helius:<safe-id>",
  "wallet": "<wallet>",
  "provider": "helius",
  "provider_grade": "archive",
  "replay_suitability": "medium",
  "started_at": "2026-05-12T00:00:00.000Z",
  "updated_at": "2026-05-12T00:00:05.000Z",
  "cursor_state": {
    "current_cursor": null,
    "next_cursor": "1055:5",
    "cursor_kind": "pagination_token",
    "cursor_advanced": true,
    "cursor_stalled": false,
    "sort_order": "desc",
    "pagination_model": "paginationToken"
  },
  "pages_loaded": 1,
  "transactions_loaded": 10,
  "earliest_timestamp": "",
  "latest_timestamp": "",
  "provider_limit_reached": false,
  "rate_limited": false,
  "completeness_confidence": 60,
  "full_history_loaded": false,
  "gap_flags": [],
  "warnings": []
}
```

Manifests are persisted in Worker KV when `CRYPTO_EVENTS_KV` exists and otherwise use bounded in-memory storage. The browser also keeps the manifest in `HistoryController` and sends `scan_id` on later page requests.

## Gap And Confidence Model

D130 does not fake completeness. Confidence is degraded when any of these appear:

- cursor stall
- missing ordering fields
- timestamp inconsistency
- incomplete transaction rows
- provider exhaustion ambiguity
- schema mismatch
- malformed ordering
- provider or Worker rate limit
- provider limit

`full_history_loaded` means only that the current scan reached a best-effort cursor exhaustion state without blocking gap flags. It is not a forensic guarantee.

## Replay Expansion Foundation

Replay still operates on staged preview datasets only. New metadata supports later wallet-inception-to-present replay:

- `replay_window`
- replay coverage percentage
- replay generation warnings
- provider grade
- replay suitability
- completeness confidence
- gap flags

The frontend continues to cap staged rows, graph preview transactions, nodes, and edges. Large scans must remain paged and manifest-backed instead of being rendered as one massive graph.

## Provider Diagnostics

Diagnostics now expose safe provider capabilities:

- provider family
- archive readiness
- replay readiness
- provider grade
- replay suitability
- chronological ordering support
- token-account coverage support
- deterministic pagination support
- gap-detection support

These values are safe metadata. They do not expose secrets and do not authorize browser provider calls.

## Still Not Guaranteed

D130 does not guarantee:

- complete lifetime wallet history for every wallet
- legal, forensic, identity, ownership, criminality, risk, or investment conclusions
- correctness of provider parser coverage
- absence of provider-side omissions
- browser rendering of very large full-history graphs
- merging staged history into the active Wallet Lookup graph

Archive-grade means the provider path and scan architecture can support archive-style ingestion. A specific wallet scan becomes best-effort complete only when pagination exhausts without gap flags and with enough provider contract confidence.

## Recommended Next Phase

Recommended D131 direction:

- add persisted normalized page/transaction cache keyed by scan manifest
- add explicit oldest-first replay scan mode
- add scan resume controls and saved manifest selection
- add provider compliance fixtures for Helius archive responses
- add automated tests for cursor stalls, malformed ordering, rate limits, ambiguous exhaustion, and confidence degradation
