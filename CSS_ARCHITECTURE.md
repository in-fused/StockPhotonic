# CSS Architecture

The canonical CSS ownership document lives at `docs/CSS_ARCHITECTURE.md`.

D169-D178 keeps the D139 split intact:

- Stock graph readability, analyst layers, topology summary cards, topology HUD chips, graph workspace tabs, graph timeline rail, investigation rail, workspace snapshots, and fullscreen graph placement live in `css/graph.css`.
- Crypto replay chronology, replay convergence chrome, and replay intelligence panels live in `css/crypto.css`.
- Mobile graph OS placement, touch route/snapshot controls, workspace tab sizing, timeline compression, replay intelligence compression, and replay chronology sizing live in `css/mobile.css`.
- JavaScript owns topology derivation, workspace orchestration, choreography pacing, overlay conflict plans, replay intelligence, readability budgets, semantic layer membership, route priority, workflow state, and performance budgets. CSS only styles stable classes and attributes.
