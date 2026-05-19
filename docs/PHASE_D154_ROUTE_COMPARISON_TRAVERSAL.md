# Phase D154 - Route Comparison and Keyboard Spatial Traversal

D154 turns the D151-D153 graph-first shell into an in-session analyst investigation cockpit without changing production graph data, ingestion systems, refresh orchestration, Worker/provider boundaries, storage, auth, or backend requirements.

## Route Comparison

Route comparison is implemented as an additive runtime model in `js/stock/routeComparison.js`. It compares visible route paths only, preserves the existing single-route tracing path, and never creates hidden relationships. Supported comparisons include strongest route, source-backed route, ecosystem route, bridge-company route, and selected strategic route variants when the current graph state provides enough visible context.

The comparison model tracks route labels, route color slots, route link keys, route node ids, shared edge counts, shared nodes, divergence points, convergence points, evidence/source-backed counts, SEC-backed counts, confidence-tier summaries, evidence-tier summaries, and strongest route companies or hubs.

## Shared Edge Disambiguation

Shared edges are identified by normalized visible link keys. The canvas renderer gives shared links a subtle shared glow and split color strokes instead of stacking unreadable lines. Relationship explanations and the compact route workspace expose "shared by routes" context while keeping source, confidence, and evidence labels intact.

## Keyboard Spatial Traversal

Keyboard traversal is implemented in `js/stock/keyboardTraversal.js` and wired through the graph shell. Shortcuts cycle strategic hubs, bridge companies, corridor lanes, compared route nodes, selected neighborhoods, and active Crypto replay events. Keyboard handlers ignore inputs, textareas, selects, contenteditable surfaces, and command-palette text entry so normal typing is not hijacked.

## Command Palette

The command palette now includes route-comparison and traversal commands such as Compare strongest route, Compare source-backed route, Compare ecosystem route, Next strategic hub, Previous bridge company, Next corridor lane, Step route forward, Step route backward, Fit comparison, Clear comparison, Open current route workspace, and Crypto replay traversal commands. Disabled commands remain visible with compact reasons when the current graph state lacks the required selection, route, comparison, or replay context.

## Analyst Workspace Continuity

The selected node, compared routes, graph breadcrumbs, spatial story cue, contextual inspector summary, minimap hints, and compact route workspace all stay in sync during viewport movement. This continuity is in-session only; D154 does not add localStorage, account storage, auth, or persisted workspaces.

## Corridor-Aware Rendering

Route comparison is passed into semantic zoom, cinematic rendering, large-graph navigation, and the minimap. Compared routes are protected from broad throttling, and corridor lanes remain visible so comparison strengthens the existing market-structure map instead of replacing it with overlay clutter.

## Crypto Replay Traversal

Crypto replay workspaces gain next/previous replay event commands, active replay neighborhood centering, replay breadcrumbs, and a compact replay route-comparison panel that compares the current event neighborhood with the staged event neighborhood when local replay data provides enough overlap.

## Mobile Behavior

Mobile keeps the graph and touch interactions primary. Route comparison actions are compact, the workspace adapts to bottom-sheet scale, verbose notes collapse first, and clear/fit/step controls remain available without covering the graph.

## Performance Boundary

Route comparison is cached as a comparison model and passed through render context. Drawing consumes precomputed link and node sets rather than scanning every edge each frame. Optional static route and corridor indexes remain future work if production graph size makes runtime derivation too expensive.
