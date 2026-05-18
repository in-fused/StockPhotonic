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

## Selector Scope Rules

Stock-specific styles should stay under Stock-owned selectors such as `#stock-photonic-surface`, `.stock-*`, `.source-*`, `.relationship-*`, and `.review-*`.

Crypto-specific styles should stay under `#crypto-photonic-view` or `.crypto-*`.

Shared styles should use clearly shared names such as `.interaction-dock`, `.photonic-help-*`, `.glass`, `.focus-button`, `.graph-*`, and `.mobile-graph-*`.

Do not add new StockPhotonic or Source Workbench selectors to `css/crypto.css`. Do not add CryptoPhotonic selectors to `css/stock.css` or `css/review.css`.

## Future Style Changes

Add new styles to the smallest owning stylesheet. If a new rule is shared by both products, place it in `shell.css` or `graph.css` only when the selector name and behavior are genuinely shared.

Avoid dumping future phase styles into one large file. If a new feature adds many rules, either use the closest existing owner or create a narrowly named stylesheet and document its load position.

Mobile ownership follows the same rule: broad responsive behavior goes in `mobile.css`; tightly product-specific mobile rules may stay with the product only when keeping them nearby makes maintenance clearer.
