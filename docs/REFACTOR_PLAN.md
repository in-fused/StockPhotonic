# StockPhotonic Modular Refactor Plan

This plan prepares the current single-file app for a future modular extraction. The current prep phase only adds section markers in `index.html` and documents the target structure. It must not change behavior.

## Target Structure

### `/js/core/`

- `config.js`: constants, thresholds, cache-bust settings, colors, layout labels, and static rule tables.
- `state.js`: shared runtime state for loaded data, visible graph state, selected/hovered nodes, filters, search state, portfolio state, viewport state, and animation handles.
- `data.js`: dataset fetches, load orchestration, normalization, maps, adjacency construction, degree calculation, and top-label seed data.

### `/js/graph/`

- `render.js`: canvas sizing, draw scheduling, background, edges, nodes, labels, and label priority.
- `interactions.js`: pointer handling, click-vs-drag classification, panning, wheel zoom, hit testing, and interaction-driven orbit cancellation.
- `layouts.js`: sector baseline layout, settling, hub layout, Company Nexus View positioning, and layout-mode selection.
- `viewport.js`: fit, animated view transitions, orbit offset, screen/world transforms, frame checks, and viewport cache updates.

### `/js/intelligence/`

- `clusters.js`: shared connection discovery, related clusters, hidden relationships, cluster scoring, and cluster cache behavior.
- `industryCorrelations.js`: derived industry-group correlation scoring, sorting, context extraction, and correlation filter helpers.
- `portfolioNexus.js`: portfolio ticker parsing, matched/unmatched holdings, first-degree exposure, repeated exposure, top nexus company, and Portfolio Nexus Score.

### `/js/ui/`

- `controls.js`: filter controls, threshold controls, layout controls, focus mode, orbit toggle, reset, fit, and panel control syncing.
- `sidebar.js`: selected-node sidebar rendering, source links, connection rows, network summaries, and node-specific intelligence sections.
- `dashboard.js`: default dashboard rendering, top hubs, strongest connections, distribution panels, trust summary, and exploration chips.
- `search.js`: search input events, matching, keyboard navigation, recent nodes, search result rendering, and search-driven node jumps.

### `/js/utils/`

- `formatting.js`: number/date formatting, connection type labels, source host labels, and HTML/inline-JS escaping.
- `math.js`: clamp, hash, curve offset, color conversion, rounded rectangles, label truncation, and geometry helpers.
- `dom.js`: safe DOM lookup/update helpers and reusable UI state helpers.

## Migration Order

Each phase must preserve current behavior, stay independently reviewable, and avoid large all-at-once movement unless explicitly approved.

### Phase R1: Extract Constants / Config Only

Move constants and static config tables into `/js/core/config.js`. Keep names and values unchanged. Verify no runtime order changes.

Status: completed. Constants and static config tables now live in `/js/core/config.js` and are exposed through `window.StockPhotonicConfig`.

### Phase R2: Extract Pure Utility Functions

Move pure formatting, math, escaping, and geometry helpers into `/js/utils/`. Do not move functions that read or mutate app state in this phase.

Status: completed. Pure math, formatting, and escaping helpers now live in `/js/utils/` and are exposed through `window.StockPhotonicUtils`.

### Phase R3: Extract Data Loading and Normalization

Move JSON fetches, data normalization, degree/adjacency construction, and related data maps into `/js/core/data.js`. Preserve the current static JSON paths and cache-bust behavior.

Status: completed. Dataset fetches, company normalization, degree/adjacency map seeding, market-cap totals, and dataset trust metrics now live in `/js/core/data.js` and are exposed through `window.StockPhotonicData`.

### Phase R4: Extract Graph Viewport / Canvas Interaction Helpers

Move viewport transforms, fit/animation helpers, hit testing, pointer handlers, wheel zoom, and canvas event setup into `/js/graph/viewport.js` and `/js/graph/interactions.js`.

Status: completed. Viewport transforms, view animation adapters, orbit offset math, fit/bounds helpers, event point calculation, wheel delta normalization, hit testing, and canvas event binding now live in `/js/graph/viewport.js` and `/js/graph/interactions.js` while `index.html` retains app state and pointer handler control.

### Phase R5: Extract Layout Mode Logic

Move sector, hub, and Company Nexus View layout logic into `/js/graph/layouts.js`. Preserve current selected-node behavior and layout fallback behavior.

Status: completed. Layout mode validation, active-mode checks, fit-node selection, hub positioning, and Company Nexus View grouping/positioning now live in `/js/graph/layouts.js` while `index.html` retains app state and UI wrappers.

### Phase R6: Extract Graph Rendering

Move draw scheduling and canvas rendering into `/js/graph/render.js`. Preserve current draw order, label decisions, opacity, colors, and orbit rendering behavior.

### Phase R7: Extract Intelligence Engines

Move clusters, industry correlations, and portfolio nexus logic into `/js/intelligence/`. Keep all calculations based only on the currently loaded static graph data.

### Phase R8: Extract UI Rendering

Move sidebar, dashboard, search, and controls into `/js/ui/`. Preserve inline-triggered behavior until a reviewed event-binding replacement is ready.

## Manual Smoke Test Checklist

- App loads without white screen
- Data loads 60 companies / 117 connections
- Pan works
- Zoom works
- Node click works
- Search works
- Sector filter works
- Industry filter works
- Signal threshold works
- Focus Mode works
- Orbit toggle works
- Sector Layout works
- Hub Layout works
- Company Nexus View works
- Portfolio input works
- Portfolio Nexus Score appears
- Repeated Exposure appears when available
- Sidebar node details render
- Source links still open
- Reset works
- Fit works
