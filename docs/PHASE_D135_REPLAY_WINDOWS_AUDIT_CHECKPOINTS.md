# Phase D135 - Replay Windows and Audit Checkpoints

D135 moves CryptoPhotonic replay from a single staged replay snapshot toward bounded replay-window investigation. The active Wallet Lookup graph remains unchanged. Replay windows are still preview-only, staged-history-only, and Worker-backed.

## Replay Windows

Replay windows represent bounded staged ranges from a scan manifest and replay reconstruction metadata. A window can be the newest staged range, the oldest staged range, or a partial middle range. Window labels, ordinal ranges, continuity warnings, and boundary markers are visible in Replay Workspace.

Window rules:

- A replay window is a staged segment, not complete lifetime history.
- Window continuation can move to newer or older staged windows when the scan cache has enough rows.
- If older history requires another page, the UI must load another Worker history page before rebuilding the replay window.
- Missing windows may exist. The UI must not imply continuous archive coverage unless a future provider contract and scan state prove it.

## Worker Replay-Window Retrieval

The Worker exposes `GET /api/crypto/wallet-history/replay-window` for scan-cache replay-window reads. The endpoint accepts safe scan/window parameters and returns replay window metadata plus sanitized normalized transactions when cached rows are available.

The endpoint does not perform provider fetches and does not expose raw provider payloads, provider URLs, request headers, API keys, bearer tokens, or private RPC values. Metadata-only responses are valid when cached rows cannot be hydrated.

## Audit Checkpoints

Replay Audit Mode now supports local replay checkpoints. Checkpoints can persist:

- current and selected replay step
- selected replay window id/index/label
- replay filters
- selected counterparty/token filter
- audit breadcrumbs and recent steps

Checkpoints are local UI state only. They contain no provider secrets, no raw provider payloads, and no full replay dataset. They survive replay reset and replay window swaps, then can be resumed from Replay Workspace.

## Continuation Actions

Replay continuation controls include:

- Continue Older
- Continue Newer
- Save Checkpoint
- Resume Checkpoint
- Window Start / Window End boundary jumps
- Continue Around This Transfer
- Continue Related Counterparty
- Continue Related Token

These actions operate only on staged replay data. They do not call providers from the browser and do not merge staged history into Wallet Lookup.

## Visualization

Replay Workspace now shows staged-window labels, replay-window separators, partial-history warnings, checkpoint status, and boundary markers. The replay canvas also draws staged-window boundary markers so the graph communicates "this is only a staged segment."

## Remaining Limits

D135 does not solve full archive completeness. It does not materialize arbitrary historical windows unless they are present in the Worker scan cache. It does not prove chronological continuity across provider gaps, rate limits, cursor stalls, malformed ordering, missing timestamps, or ambiguous exhaustion.

## Future Goals

The next archive-grade phase should add stronger server-side replay window indexing, verified oldest-first hydration across cached pages, explicit gap maps, checkpoint export/import, and provider-contract-backed completeness proofs without changing the preview-only and Worker-only boundaries.
