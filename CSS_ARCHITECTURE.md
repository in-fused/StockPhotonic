# CSS Architecture

The canonical CSS ownership document lives at `docs/CSS_ARCHITECTURE.md`.

D161-D168 keeps the D139 split intact:

- Stock graph readability, analyst layers, graph timeline rail, investigation rail, workspace snapshots, and fullscreen graph placement live in `css/graph.css`.
- Crypto replay chronology and replay convergence chrome live in `css/crypto.css`.
- Mobile graph OS placement, touch route/snapshot controls, timeline compression, and replay chronology sizing live in `css/mobile.css`.
- JavaScript owns readability budgets, semantic layer membership, overlay derivation, route priority, workflow state, and performance budgets. CSS only styles stable classes and attributes.
