# Phase D152 - Semantic Zoom and Spatial Graph Intelligence

D152 makes the D151 graph-first shell adaptive without changing production data, refresh orchestration, ingestion, backend/runtime requirements, replay contracts, route tracing, or Source Workbench governance.

## Semantic Zoom Tiers

The shared semantic zoom helper derives four detail tiers:

- `macro`: cluster, corridor, hub, route, and viewport orientation only.
- `cluster`: important companies, wallet/token groups, selected ecosystems, and route anchors.
- `relationship`: relationship labels, selected-neighborhood context, route clarity, and selected flow detail.
- `inspection`: evidence/source markers, relationship explanations, wallet flow amounts, and review/replay detail.

The tier is derived from zoom scale, graph density, selected node or flow, active route, overlay/lens state, UX mode, viewport state, and Stock versus Crypto context. Selected neighborhoods and active routes override broad throttling so investigation targets remain readable at lower zoom.

## Zoom-Aware Labels and Overlays

Labels are budgeted by tier and density. Strategic hubs, selected nodes, hovered nodes, route nodes, and selected-neighborhood nodes receive priority. Low-priority labels are hidden or faded until close inspection. Crypto wallet labels remain compact and collision-aware, with amount labels reserved for relationship and inspection tiers unless a flow is selected or part of replay.

Canvas-adjacent overlays also follow semantic detail. Macro views expose only orientation hints such as route, hub, corridor, and cluster signals. Relationship and inspection views can expose source/evidence markers and richer relationship badges. Persistent canvas-covering overlays remain out of scope.

## Minimap and Spatial Breadcrumbs

The stock minimap now uses the same semantic model as the main graph. It draws cluster density, viewport rectangle, route hints, selected-neighborhood hints, and tier state. Desktop users can click the minimap to jump the graph viewport, and the minimap can collapse. Mobile keeps the minimap compact or hidden so the graph and bottom sheet remain primary.

Spatial breadcrumbs describe location rather than page structure, for example:

- `Overview > Analyst > AI Infrastructure > NVDA neighborhood > Route`
- `Crypto > Flow > Wallet cluster > Token exposure > Replay`

Breadcrumbs update from active mode, navigation focus, route state, selection, and semantic tier.

## Stock Graph Behavior

StockPhotonic prioritizes strategic hubs, corridors, evidence-backed routes, source-backed relationships, selected company neighborhoods, and ecosystem focus. Weak edges fade first at macro and cluster tiers. Source and evidence markers are reserved for review/detail tiers so the graph explains why a company matters without flooding the canvas.

## Crypto Graph Behavior

CryptoPhotonic classifies topology into wallet clusters, token exposure clusters, exchange/funnel structures, replay paths, and high-priority flows. Macro and cluster tiers emphasize topology and selected flow direction. Relationship and inspection tiers restore compact labels, amounts, replay context, and transaction flow detail.

## Mode-Sensitive Detail

- Explore / Flow: clean graph, simple labels, minimal overlays.
- Analyst: route, hub, corridor, topology, and metric emphasis.
- Review: evidence, source, candidate, and review-state markers.
- Replay: time/path/flow emphasis with supporting labels only where useful.

## 1000+ Node Strategy

D152 remains fully browser-static and read-only. Future 1000+ node work should add optional precomputed semantic tiles, layout snapshots, route/corridor indexes, and cluster summaries that the browser can consume without live provider access or per-frame full graph recomputation. Production graph growth must still pass source-backed identity, duplicate/alias checks, reviewer-owned approval manifests, and validation.
