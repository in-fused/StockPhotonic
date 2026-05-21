# CSS Architecture

StockPhotonic uses a layered stylesheet split so shared app styles, StockPhotonic styles, CryptoPhotonic styles, review/source surfaces, graph surfaces, and responsive overrides do not accumulate in one catch-all file.

## Load Order

`index.html` loads styles in this order:

1. `css/base.css`
2. `css/shell.css`
3. `css/graph.css`
4. `css/stock.css`
5. `css/crypto.css`
6. `css/review.css`
7. `css/mobile.css`

Keep this order deterministic. `mobile.css` is intentionally last because it contains shared and product-specific responsive/touch overrides.

## File Ownership

- `base.css`: font import, CSS tokens, scrollbar defaults, reset/box sizing, body defaults, global typography helpers.
- `shell.css`: shared page chrome, product tabs, app tabs, mode bars, command palette, shared button states, shared glass panels, shared contextual-inspector header controls, help modal.
- `graph.css`: Stock 2D graph stage, shared graph canvas behavior, progressive graph control drawer, floating Stock graph toolbar, stock minimap, graph breadcrumbs, overlay stats, ecosystem explorer dock, graph-adjacent intelligence cards, fullscreen HUD/panels, Stock contextual-inspector positioning.
- `stock.css`: StockPhotonic-specific controls, selected-company workspace, stock dashboard/sidebar helpers.
- `crypto.css`: CryptoPhotonic-only graph surface, floating Crypto graph toolbar, transient Crypto inspector, topology panel layout, side panels, investigation workspace, status panels, wallet lookup/history/replay/audit surfaces.
- `review.css`: source/evidence review queue, source chips, confidence/trust badges, relationship evidence cards, Source Workbench, collapsible Source Workbench workflow panels, candidate review UI.
- `mobile.css`: shared and product-specific responsive rules, mobile graph-first viewport sizing, bottom-sheet inspectors, fullscreen mobile overrides, touch/pointer-specific protections.

D150 live-refresh Source Workbench selectors, including `.source-live-refresh-*`, belong to `review.css`; their responsive grid overrides belong to `mobile.css`.

D151 graph-first operating-system selectors follow the same ownership split:

- `.graph-first-os`, `.graph-os-bar`, `.crypto-os-bar`, `.graph-mode-*`, `.graph-os-action`, `.photonic-command-*`, and shared `.contextual-inspector-*` header controls live in `shell.css`.
- `.graph-control-drawer`, `.graph-floating-toolbar`, `.graph-minimap-canvas`, `.graph-spatial-breadcrumbs`, Stock `.contextual-inspector` positioning, and Stock graph OS surface rules live in `graph.css`.
- `.crypto-floating-toolbar`, `.crypto-mode-hud`, `.crypto-contextual-inspector`, and Crypto graph-first canvas layout rules live in `crypto.css`.
- `.source-workbench-toggle` and `.source-workbench-panel-body` live in `review.css`.
- Mobile bottom-sheet inspector behavior, compact graph OS controls, mobile command-palette layout, and mobile graph viewport sizing live in `mobile.css`.

D152 semantic graph intelligence keeps the same ownership model:

- Stock semantic minimap states, minimap collapse controls, graph-tier breadcrumb treatment, and canvas-adjacent graph navigation affordances live in `graph.css`.
- Crypto semantic breadcrumbs, Crypto mode/tier chips, and Crypto topology readability affordances live in `crypto.css`.
- Mobile-safe minimap placement, compact spatial breadcrumbs, reduced overlay behavior, and bottom-sheet semantic detail rules live in `mobile.css`.
- Semantic zoom decisions are JavaScript-owned; CSS should only react to stable surface attributes such as `data-semantic-zoom-tier` or product-scoped class names.

D153 cinematic graph interaction preserves the same split:

- Stock cinematic graph surfaces such as `.graph-cinematic-story`, minimap corridor readability, graph breadcrumb transitions, and canvas-adjacent investigation motion affordances live in `graph.css`.
- Shared command-palette entries remain JavaScript-owned by `js/ui/operatingShell.js`; shared command-palette styling stays in `shell.css`.
- Crypto replay workspace transitions, replay canvas polish, flow corridor readability, and Crypto investigation workspace motion live in `crypto.css`.
- Mobile placement for Stock story cues, minimap ergonomics, bottom-sheet movement, and replay workspace compacting lives in `mobile.css`.
- Motion physics, focus repulsion, edge grouping, and corridor lane decisions are JavaScript-owned. CSS may animate chrome and panels, but it should not encode graph semantics or relationship meaning.

D154 route comparison and keyboard traversal preserve the same split:

- Stock route-comparison cards, route workspace chrome, comparison chips, route rows, shared-edge summaries, and graph-adjacent comparison controls live in `graph.css`.
- Command-palette disabled states and compact command reason text live in `shell.css`.
- Crypto replay route-comparison panels and replay traversal summary chrome live in `crypto.css`.
- Mobile route workspace placement, compact comparison controls, bottom-sheet comparison summaries, and touch-safe route actions live in `mobile.css`.
- Route comparison, shared-edge disambiguation, traversal order, disabled-command logic, minimap comparison state, and corridor-aware route styling are JavaScript-owned. CSS should style stable surface classes only and should not encode relationship proof, route authority, or source/evidence semantics.

D155-D160 workspace convergence and scalable intelligence foundations preserve the same split:

- Stock adaptive HUD, in-session workspace memory rail, embedded graph annotation chips, graph-first fullscreen convergence, compact route workspace behavior, active legend compression, and graph-adjacent intelligence card reduction live in `graph.css`.
- Shared command-palette entries for pinning routes, corridors, hubs, replay checkpoints, and clearing session workspace state remain JavaScript-owned by `js/ui/operatingShell.js`; shared command styling remains in `shell.css`.
- Crypto replay workspace compression, replay event panel sizing, replay controls, and fullscreen replay compaction live in `crypto.css`.
- Mobile graph OS rules for bottom-sheet minimization, adaptive HUD scrolling, annotation chip compression, route workspace compacting, graph-only immersion, and minimap touch ergonomics live in `mobile.css`.
- Scalable graph caches, semantic tile prep, corridor lane indexes, label anchor caches, narrative summaries, and disabled overlay foundation definitions are JavaScript-owned. CSS should style stable classes only and must not imply fake overlay data, source authority, or persistence guarantees.

D161-D168 analyst OS, readability, timeline, overlay, and scalability evolution preserve the same split:

- Stock massive-readability UI affordances, analyst layer dock states, graph timeline rail, investigation queue rail, session snapshot buttons, readability suppression state, and graph-first fullscreen placement live in `graph.css`.
- Crypto replay graph chronology controls and replay convergence chrome live in `crypto.css`.
- Mobile graph OS maturity rules for timeline placement, investigation rail compression, touch route/snapshot actions, replay chronology buttons, and fullscreen graph-only ergonomics live in `mobile.css`.
- Readability budgets, semantic edge fading, corridor suppression, node prominence, label queues, graph timeline models, investigation workflow state, analyst overlay derivation, semantic intelligence summaries, render queues, animation budgets, memory budgets, and progressive hydration prep are JavaScript-owned.
- CSS must react only to stable classes/attributes such as `.graph-layer-action.is-active`, `.graph-timeline-rail`, `.graph-investigation-rail`, `.has-readability-suppression`, `.crypto-replay-graph-chronology`, and mobile product scopes. CSS must not encode relationship truth, source authority, overlay membership, route priority, persistence guarantees, or backend assumptions.

D169-D178 institutional spatial OS, topology, multi-workspace, replay intelligence, and performance hardening preserve the same split:

- Stock topology HUD chips, topology intelligence cards, graph workspace tabs, workspace memory refinements, fullscreen graph immersion, and topology-aware graph chrome live in `graph.css`.
- Crypto replay intelligence convergence panels and replay market chronology readouts live in `crypto.css`.
- Mobile graph OS refinements for touch-first workspace tabs, adaptive HUD scrolling, replay intelligence compression, graph timeline ergonomics, and fullscreen graph immersion live in `mobile.css`.
- Spatial topology derivation, multi-workspace state, choreography pacing, overlay conflict suppression, graph-native command actions, replay intelligence summaries, semantic heuristics, route/topology weighting, overlay caches, topology caches, render budgets, and fullscreen performance budgets are JavaScript-owned.
- CSS must not encode topology scores, overlay membership, replay anomaly meaning, source authority, persistence guarantees, browser ingestion behavior, or backend assumptions.

D179-D188 graph OS validation and analyst workflow consolidation keep the same ownership:

- Stock graph OS status/self-check panels, topology validation summaries, overlay/readability summaries, analyst preset chrome, workspace count chips, fullscreen compact HUD placement, and graph-native command section labels live in `graph.css`.
- Mobile touch compression for the graph OS status panel, topology/readability summaries, workspace counts, command section headings, fullscreen restore behavior, and compact preset controls lives in `mobile.css`.
- Topology counts, overlay suppression reasons, readability budgets, active workspace state, command availability, analyst preset behavior, and render budget labels remain JavaScript-owned and session-only.
- No CSS layer should imply persistence, backend/provider/API behavior, production-data mutation, source authority, topology meaning, or overlay truth.

D189-D198 investigation narrative intelligence keeps the same ownership:

- Stock investigation narrative cards, reasoning chips, investigation stack chrome, route lineage chips, and compact HUD narrative surfaces live in `graph.css`.
- Mobile investigation compression, touch-safe narrative chips, compact stack/lineage behavior, and fullscreen mobile narrative ergonomics live in `mobile.css`.
- Narrative derivation, reasoning heuristics, active investigation stack state, quick jump-back payloads, route/corridor/replay lineage, topology interpretation, overlay/readability explanations, and route significance wording remain JavaScript-owned and session-only.
- CSS must not encode evidence truth, topology authority, relationship certainty, source authority, persistence semantics, backend/provider/API assumptions, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D199-D208 cross-market convergence keeps StockPhotonic and CryptoPhotonic on one graph OS philosophy while preserving product semantics:

- Shared reasoning-chip and investigation-lineage chrome remains in `graph.css`; Crypto may reuse those shared classes only for graph OS consistency.
- Crypto replay intelligence panels, compact replay narratives, liquidity topology summaries, replay lineage chrome, replay stack controls, and replay workspace investigation surfaces live in `crypto.css`.
- Mobile replay narrative compression, touch-safe lineage strips, compact fullscreen replay behavior, and replay HUD readability live in `mobile.css`.
- Replay narrative wording, liquidity/topology summaries, reasoning heuristics, replay lineage state, replay presets, and command availability remain JavaScript-owned and session-only.
- CSS must not encode wallet identity, replay certainty, liquidity truth, provider semantics, persistence assumptions, backend behavior, browser-side provider calls, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D209-D218 institutional replay corridor intelligence keeps the same ownership:

- Shared graph OS continuity and traversal chrome, including reusable reasoning-chip/traversal helpers, lives in `graph.css`.
- Crypto replay corridor summaries, corridor transition strips, replay progression breadcrumbs, congestion/overlap chips, replay cluster interpretation, replay focus chips, and replay lineage hierarchy refinements live in `crypto.css`.
- Mobile replay jump strips, lineage chips, corridor summaries, focus cycling controls, stack navigation, and continuity compression live in `mobile.css`.
- Replay corridor derivation, continuity reasoning, traversal state, focus cycling, cluster weighting, chronology intelligence, command availability, and shared Stock/Crypto flow-language interpretation remain JavaScript-owned and session-only.
- CSS must not encode wallet identity, replay certainty, liquidity truth, provider/source authority, persistence assumptions, backend/provider/API behavior, browser-side provider calls, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D219-D228 dual-surface workflow refinement keeps the same ownership:

- Shared command-palette scanability refinements and Stock graph handoff chrome, including `.photonic-command-row-*` and `.graph-workflow-handoff*`, live in `graph.css` because they extend graph OS behavior loaded after shared shell styles.
- Crypto session status and workflow handoff selectors, including `.crypto-session-status-strip`, `.crypto-workflow-handoff*`, and `.crypto-replay-handoff`, live in `crypto.css`.
- Responsive/touch compression for command subtitles, handoff strips, session status chips, and route/replay previous/next affordances lives in `mobile.css`.
- Command subtitles, active preset labels, disabled-state reasons, workflow cue selection, replay corridor availability, and session-only boundaries remain JavaScript-owned.
- CSS must not encode workflow intelligence, source authority, persistence guarantees, provider/API behavior, browser-side provider calls, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D229-D238 institutional surface polish keeps that split:

- Stock dense HUD compaction continues to react to JavaScript-owned graph state such as `.is-density-compressed`; Stock status, legend, narrative, route workspace, and command-palette override rules live in `graph.css`.
- Crypto dense HUD compaction reacts to `js/crypto/ui.js` adding `.is-crypto-density-compressed` from existing semantic zoom state; Crypto status, handoff, and replay workspace overflow rules live in `crypto.css`.
- Mobile fullscreen route/replay dock placement and compact command-palette overrides live in `mobile.css`.
- CSS must not encode workflow intelligence, source authority, persistence guarantees, provider/API behavior, browser-side provider calls, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D239-D248 institutional UX simplification keeps systems intact but collapses inactive chrome by mode:

- Stock surface hierarchy rules for Explore, Analyst, Review, Replay, graph-first fullscreen, and command-palette density live in `graph.css` because they orchestrate Stock graph chrome without changing graph intelligence ownership.
- Crypto source-state clustering, mode-owned status/action visibility, replay-only corridor/lineage chrome, and graph-first fullscreen rules live in `crypto.css`.
- Mobile duplicate-control hiding, contextual route/replay step affordances, breadcrumb suppression, and compact command-palette limits live in `mobile.css`.
- JavaScript may choose current-mode command defaults or render compact source/status rows, but CSS must only react to stable mode attributes and product-scoped classes. Systems remain preserved, hidden, or collapsed by mode.
- CSS must not encode source authority, replay certainty, wallet identity, persistence guarantees, provider/API behavior, browser-side provider calls, Worker behavior, SEC/source-pipeline behavior, or storage/auth behavior.

D249-D258 continues the simplification by making preserved systems mode-owned behind primary actions:

- Stock primary-action rail and secondary tool overflow styles live in `graph.css`; the underlying graph, route, replay, topology, and source systems remain intact and are only hidden, collapsed, or focused by mode.
- Crypto primary-action rail, source-boundary disclosure posture, and mode-owned workflow cues live in `crypto.css`; replay/source/data details remain available behind disclosures and command-palette search.
- Mobile simplification rules for one bottom control strip, one contextual drawer, and overflowed secondary graph tools live in `mobile.css`.
- D249-D258 does not introduce backend/provider/API, browser-side provider-call, Worker, SEC/source-pipeline, persistence/auth/storage, or production-data CSS assumptions.

## Selector Scope Rules

Stock-specific styles should stay under Stock-owned selectors such as `#stock-photonic-surface`, `.stock-*`, `.source-*`, `.relationship-*`, and `.review-*`.

Crypto-specific styles should stay under `#crypto-photonic-view` or `.crypto-*`.

Shared styles should use clearly shared names such as `.interaction-dock`, `.photonic-help-*`, `.glass`, `.focus-button`, `.graph-*`, and `.mobile-graph-*`.

Do not add new StockPhotonic or Source Workbench selectors to `css/crypto.css`. Do not add CryptoPhotonic selectors to `css/stock.css` or `css/review.css`.

## Future Style Changes

Add new styles to the smallest owning stylesheet. If a new rule is shared by both products, place it in `shell.css` or `graph.css` only when the selector name and behavior are genuinely shared.

Avoid dumping future phase styles into one large file. If a new feature adds many rules, either use the closest existing owner or create a narrowly named stylesheet and document its load position.

Mobile ownership follows the same rule: broad responsive behavior goes in `mobile.css`; tightly product-specific mobile rules may stay with the product only when keeping them nearby makes maintenance clearer.
