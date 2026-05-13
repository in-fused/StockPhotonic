# CryptoPhotonic Frontend Modularization

## D132 Structure

CryptoPhotonic styles that previously lived in the large inline `index.html` stylesheet now load from:

- `css/crypto.css`

The extracted stylesheet intentionally includes some legacy shared/base and StockPhotonic-adjacent rules because the original inline cascade interleaved shared layout, scrollbar, graph, and Crypto selectors. Keep new CryptoPhotonic UI rules in this file. Avoid adding new StockPhotonic-only styling here unless it is part of a shared shell rule that already affects both views.

Crypto UI rendering helpers now load before `js/crypto/ui.js`:

- `js/crypto/statusPanels.js` renders small status/metric/warning fragments.
- `js/crypto/historyWorkspace.js` renders guided history/replay action cards.
- `js/crypto/investigationWorkspace.js` renders reusable detail rows, sections, copy buttons, and selection headers.
- `js/crypto/replayWorkspace.js` renders and binds the Replay Workspace overlay shell.

## Script Load Order

`index.html` keeps the existing non-module script style. The required Crypto order is:

1. `js/crypto/core.js`
2. `js/crypto/graph.js`
3. `js/crypto/layout.js`
4. Extracted UI helpers
5. Worker endpoint globals
6. `js/crypto/ui.js`

`ui.js` owns application state, graph interaction, Worker endpoint safety, dataset normalization, history controller integration, replay state, and mode switching. Helper modules must not call providers, mutate datasets, or merge staged history.

## Namespace Contract

Every extracted helper attaches to:

```js
window.CryptoPhotonic = window.CryptoPhotonic || {};
```

Current helper namespaces:

- `window.CryptoPhotonic.statusPanels`
- `window.CryptoPhotonic.historyWorkspace`
- `window.CryptoPhotonic.investigationWorkspace`
- `window.CryptoPhotonic.replayWorkspace`

`ui.js` calls helpers defensively and keeps fallback render paths so a missing helper script does not crash CryptoPhotonic during development.

## Replay Workspace Layout Rules

Replay Workspace Mode remains preview-only. It uses the staged history preview dataset and never mutates the active Wallet Lookup graph.

Layout rules:

- The replay canvas is the focal point.
- Desktop controls dock to compact left and right rails.
- Mobile controls use compact top and bottom rails.
- No central overlay panel should cover the graph.
- Timeline and playback controls stay visible but edge-adjacent.
- Metadata and warnings stay compact and scroll inside their rail if needed.

Future cinematic replay work should start in `js/crypto/replayWorkspace.js` for shell controls and continue to use the existing replay animator and history graph renderer for canvas behavior.

## Long Text And Sidebar Rules

Wallet addresses, signatures, cursors, provider messages, and status text must not widen side panels.

Use these patterns for new sidebar UI:

- Container grids: `minmax(0, 1fr)`.
- Flex/grid children: `min-width: 0` and `max-width: 100%`.
- Long data strings: `overflow-wrap: anywhere`.
- Inputs and compact labels: `text-overflow: ellipsis` where truncation is preferable.
- Buttons: wrap only at normal word boundaries; avoid one-letter wrapping.

Do not add browser-side provider calls, API key exposure, or staged-history-to-active-graph merge behavior in UI helper modules.
