# Roadmap Notes

## D309-D318 Local Provider Adapter + Replay Cache Builder

- Added the local/server-side `crypto_provider_adapters.py` boundary for sanitized wallet-history provider pages, with Helius support behind caller-enforced `--allow-network` and environment-only provider keys.
- Wired `crypto_fetch_history.py` to the adapter while preserving dry-run/no-write defaults, refusing network fetches without `--allow-network`, and emitting cache metadata for cursor, pagination, provider state, and browser/provider-key boundaries.
- Extended `crypto_normalize_transactions.py` with normalized cache metadata and `--write-replay-cache` generation from normalized rows, including replay-window continuity metadata without raw provider payloads or secrets.
- Updated the Crypto local data contract for D309-D318 provider-cache and replay-cache requirements; no browser-side provider calls, frontend provider integration, Worker API, SEC pipeline, source pipeline, persistence/auth/storage, or secret-handling changes are part of D309-D318.

## D299-D308 Crypto Data Integrity + Multi-Step Transaction Pipeline Foundation

- Began the CryptoPhotonic data integrity pipeline with a local data contract, sample normalized wallet history, and sample replay cache artifacts that are explicitly fixture/sample-only.
- Added local dry-run script skeletons for wallet-history cache preparation, normalized transaction schema output, and CSV review export; provider/network use remains explicit and provider keys are environment-only.
- Extended Crypto UI/replay labels to distinguish fixture/cache/Worker/no-history/parser-limited states while keeping the browser limited to static/cache/Worker-normalized data only.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D299-D308.

## D289-D298 Final UX Consolidation + Institutional Presentation Pass

- Consolidated StockPhotonic and CryptoPhotonic first-load presentation around calmer institutional headings, tighter mode/action rhythm, and less developer-oriented default copy.
- Quieted active/selected chrome, minimap, legends, breadcrumbs, replay chips, contextual inspectors, fullscreen restore affordances, and replay workspace strips so the active graph surface remains dominant.
- Tightened mobile spacing, bottom-sheet inspectors, drawer sizing, graph overlays, replay strips, and fullscreen restore controls to avoid awkward stacking while preserving the graph-first posture.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D289-D298.

## D279-D288 Institutional Interaction Polish + Contextual Flow Refinement

- Smoothed StockPhotonic and CryptoPhotonic inspector-open transitions so contextual panels feel attached to the active graph state while surrounding mode chrome quiets instead of competing.
- Tuned selected Stock nodes, Crypto wallets, selected flows, and replay pulses toward clearer rings and calmer suppression rather than high-glow emphasis.
- Refined replay and fullscreen posture with slower Crypto flow stepping, softer replay/corridor chips, subtler restore affordances, and mobile rules that avoid stacked inspector, drawer, and overlay controls.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D279-D288.

## D269-D278 Visual QA Simplification + Layout Collision Cleanup

- Tightened StockPhotonic graph-first mode ownership so first-load Explore remains graph plus primary/command controls, and inspector-open state suppresses competing status, route, legend, minimap, and investigation chrome.
- Kept CryptoPhotonic Flow calm with compact provider-boundary visibility, collapsed source/wallet details by default, and replay/history surfaces hidden unless Replay or staged data makes them relevant.
- Preserved primary actions, secondary overflow, command-palette access, fullscreen graph-first behavior, and mobile one-strip/one-drawer posture without adding product capability.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D269-D278.

## D259-D268 Functional Integrity Audit + Dead-Control Cleanup

- Audited StockPhotonic and CryptoPhotonic visible control paths so default actions either execute, show deterministic unavailable copy, or stay behind command/search/disclosure surfaces.
- Tightened Crypto Live Feed and Wallet Lookup state language around fixture, Worker replacement graph, unavailable Worker endpoint, loading, no returned events, and preview-only replay separation without adding provider access.
- Kept mobile graph controls limited to route/replay step buttons and kept command-palette defaults concise while advanced unavailable commands remain searchable with disabled reasons.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D259-D268.

## D249-D258 Institutional UX Simplification Pass 2 - Primary Action Workflow Rebuild

- Rebuilt StockPhotonic and CryptoPhotonic mode flows around one primary action per mode, with secondary graph/replay/source controls preserved behind compact overflow or disclosure surfaces.
- Standardized mode-owned next-action cues so only 2-3 relevant actions appear at a time while command-palette search still reaches advanced systems.
- Simplified first-load and mobile workflow posture around calm defaults, one contextual inspector surface per product, one mobile bottom control strip, and one contextual drawer.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D249-D258.

## D239-D248 Institutional UX Simplification Pass 1 - Surface Hierarchy Reset

- Reset StockPhotonic and CryptoPhotonic graph surfaces around mode-based hierarchy so Explore/Flow defaults to the graph plus minimal controls, Analyst shows contextual next actions, Review narrows toward source/evidence controls, and Replay owns replay/corridor/lineage surfaces.
- Collapsed low-priority HUD, status, legend, route, breadcrumb, minimap, handoff, and replay chrome by mode rather than removing the underlying D151-D238 systems.
- Made fullscreen graph-first by default, with nonessential HUD hidden behind compact restore/control affordances.
- Simplified command-palette default scope so current-mode actions appear first while search still reaches grouped commands and subtitles.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D239-D248.

## D229-D238 Institutional Surface Polish + Dense-Graph Usability Pass

- Tightened StockPhotonic dense HUD surfaces with compact status, handoff, active legend, narrative, and route workspace overflow behavior driven by existing session graph state.
- Added CryptoPhotonic dense semantic compaction for status strips, handoff cues, fullscreen side panels, and replay workspace narrative/corridor/lineage surfaces without changing replay data semantics.
- Improved mobile fullscreen route and replay control placement with horizontal, graph-first control docks and compact command-palette spacing while preserving grouped, searchable commands and subtitles.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D229-D238.

## D219-D228 Institutional Dual-Surface Workflow Refinement + Analyst Productivity Hardening

- Refined the shared command palette with searchable command subtitles, grouped scan summaries, active mode/preset badges, and deterministic disabled-state reasons.
- Added compact StockPhotonic handoff cues for selection, route, corridor, topology, and session workspace next actions without changing graph data or source semantics.
- Added compact CryptoPhotonic mode/preset/replay/corridor status cues plus wallet/replay handoff actions for staged history, preview replay, corridor traversal, and lineage-aware replay work.
- Tightened mobile/touch productivity with command access on both graph surfaces, route/replay previous/next affordances, compact status chips, and fullscreen graph-first obstruction controls.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D219-D228.

## D209-D218 Institutional Replay Intelligence + Cross-Domain Flow Correlation

- Added bounded Crypto replay corridor intelligence for dominant corridors, corridor transitions, congestion zones, repeated pathways, route divergence, overlap, and staged continuity confidence.
- Expanded replay traversal cognition with corridor progression breadcrumbs, next/previous corridor commands, cluster/bridge/concentration focus commands, and session-only corridor/continuity view toggles.
- Added shared graph OS flow language for convergence, divergence, concentration, bridge significance, corridor continuity, and replay/readability suppression while preserving distinct Stock company-relationship semantics and Crypto wallet-flow semantics.
- Replay continuity interpretation remains deterministic, cached with replay intelligence summaries, preview-only, and session-only; it does not imply wallet identity, liquidity truth, or market causality.
- No production data, backend/provider/API, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D209-D218.

## D199-D208 Cross-Market Intelligence Convergence

- Expanded CryptoPhotonic replay investigation intelligence with deterministic, metadata-derived narratives for active wallet focus, replay event focus, visible liquidity corridors, token concentration zones, convergence/divergence, bridge-wallet visibility, and replay anomaly cues.
- Added compact replay flow summaries, reasoning chips, session-only replay investigation stack, jump-back actions, flow lineage, and neighborhood continuity without changing backend/provider/API contracts.
- Extended the command palette with grouped Crypto Investigation, Crypto Replay, Crypto Flow, and Crypto Workspace actions, plus session-only Crypto analyst presets for Replay Investigation, Liquidity Flow, Concentration Focus, and Wallet Corridor Focus.
- Preserved StockPhotonic/CryptoPhotonic product boundaries: Stock remains market relationship/topology/evidence oriented, while Crypto remains wallet flow/liquidity movement/replay chronology oriented.
- No production data, Worker, SEC pipeline, source pipeline, persistence/auth/storage, or browser-side provider-call changes are part of D199-D208.
