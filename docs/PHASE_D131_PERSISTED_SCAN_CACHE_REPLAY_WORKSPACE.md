# Phase D131 - Persisted Scan Cache and Replay Workspace

D131 turns replay from a sidebar utility into a graph-first investigation workspace and adds the Worker-side persistence foundations needed for large historical scan reconstruction. The phase remains additive: Wallet Lookup replacement behavior is unchanged, staged history is not merged into the active graph, and replay stays preview-only.

## Replay Workspace

Replay now targets the main CryptoPhotonic graph stage through the dedicated `crypto-history-workspace-canvas`. The sidebar controls build datasets, open the large workspace, and show compact status only.

Workspace layout:

- Top rail: preview-only status, build/render/play/exit controls, timeline labels, progress scrubber, step/window navigation, speed controls.
- Main area: large replay canvas occupying the graph-stage space.
- Bottom rail: compact metadata for rendered graph size, replay window, current path, coverage, confidence, scan cache state, and warnings.

The active Wallet Lookup graph canvas is hidden while Replay Workspace Mode is active. It is not mutated, merged, or replaced by staged replay history.

## Sidebar Simplification

The history and replay sidebars now favor compact status rows and collapsible sections. Detailed scan metadata, provider diagnostics, warnings, and staged rows are available as drill-down details instead of dense always-open panels.

The sidebar is now a companion surface for:

- Worker history controls.
- scan/cache status.
- preview dataset actions.
- replay warnings and readiness.
- concise coverage/confidence metadata.

## Persisted Scan Cache

The Worker now maintains a D131 scan-cache foundation linked to the scan manifest.

Persisted record types:

- `normalized_scan_page`: safe page record with manifest reference, cursor state, transaction refs, sanitized replay window metadata, and normalized transactions.
- `normalized_scan_transaction`: safe transaction record keyed by scan id and stable transaction ref.
- `replay_reconstruction_cache`: safe reconstruction metadata for replay windows and timeline segments.

Storage behavior:

- Uses `CRYPTO_EVENTS_KV` when available.
- Falls back to bounded in-memory maps for local/dev operation.
- Cache records use a 7 day TTL.
- The scan manifest still uses its existing 24 hour TTL.

Browser exposure:

- The browser receives only safe cache metadata such as storage mode, persistence status, page/transaction counts, resumability, last page reference, and replay cache presence.
- Raw provider payloads, provider URLs, API keys, bearer tokens, request headers, private RPC values, and secret-shaped fields are not returned.

## Replay Reconstruction Windows

D131 introduces replay reconstruction metadata without attempting unlimited full-history rendering.

Metadata includes:

- `chunk_size`.
- `render_cap_transactions`.
- `total_transactions`.
- `total_windows`.
- `current_window_index`.
- `current_window_start` and `current_window_end`.
- `current_window_label`.
- `oldest_first_ready`.
- `oldest_first_reconstruction_required`.
- `progressive_expansion_available`.
- `timeline_segments`.
- `coverage_pct`.
- `confidence_degraded`.

Timeline segments are built from normalized pages and are retained as bounded metadata. They prepare older-to-newer reconstruction while allowing newest-first providers to remain honest about the need for cached window reconstruction.

## Chunking and Windowing

Default D131 limits:

- replay chunk size: 80 transactions.
- replay render cap: 320 transactions.
- maximum replay timeline segments retained by Worker metadata: 128.
- frontend preview render limits remain capped at 320 transactions, 240 nodes, and 360 edges.

These caps prevent large staged scans from forcing the browser to render a massive graph in one pass. Progressive expansion should load and render bounded windows, then let users move between windows rather than drawing the full archive at once.

## Confidence Boundaries

Replay confidence degrades when:

- the scan is partial.
- provider limits or rate limits occur.
- cursor stalls occur.
- schema or ordering gaps are detected.
- timestamps are missing or inconsistent.
- provider exhaustion is ambiguous.
- pages arrive newest-first and oldest-first reconstruction is still required.

`full_history_loaded` remains best-effort and provider-contract dependent. The UI and exported metadata must not imply forensic completeness, identity findings, ownership findings, criminality or risk findings, or investment conclusions.

## Archive Replay Readiness

D131 is archive-replay ready only as a foundation. A future phase can use cached normalized pages and transaction refs to request, hydrate, and render specific replay windows oldest-first.

Not yet implemented:

- random-access loading of historical windows from KV into the browser.
- full oldest-first replay hydration across all cached pages.
- server-side replay graph materialization.
- unlimited archive rendering.

The correct next step is to add explicit replay-window retrieval endpoints that return only sanitized normalized window records and preserve the same preview-only boundaries.
