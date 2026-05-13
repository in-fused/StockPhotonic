# Phase D133 - Cinematic Replay Workspace

D133 upgrades CryptoPhotonic Replay Workspace into a graph-first cinematic playback surface while keeping replay preview-only and staged-history-only. The active Wallet Lookup graph is not mutated, replaced, or merged with staged replay history.

## Cinematic Replay Behavior

- The replay canvas progressively reveals wallet-flow steps from the capped staged preview dataset.
- The current source node, destination node, and transfer edge receive the strongest glow and path emphasis.
- Completed transfer paths remain faintly visible as a history trail so the graph appears to grow over time.
- Future transfer paths are drawn only as very dim preview structure until reached.
- The replay camera uses the full graph view at reset/start and biases toward the active flow path after playback reaches a step.
- Reset returns playback to step `0` and restores the full replay camera view; future paths remain only dim preview context.

## Timeline Navigation

Replay Workspace now includes:

- a current-step marker on the timeline track,
- oldest/newest staged labels,
- a compact current-event timestamp/signature/amount summary,
- jump to start/end,
- previous/next major-event navigation,
- bookmark buttons that seek to selected staged replay events.

The controls stay in the rail and compact edge panels so the graph center remains the primary visual surface.

## Bookmark Derivation Rules

Bookmarks are derived only from staged replay preview data:

- first observed flow,
- latest observed flow,
- largest SOL flow,
- largest non-SOL token flow,
- first repeated counterparty event,
- first token-change event,
- provider/gap warning boundary when warnings or partial-window state exist.

Bookmarks are address-and-transfer observations only. They do not imply identity, ownership, risk, criminality, trading advice, or investment conclusions.

## Preview Boundaries

- Replay uses the staged history preview dataset only.
- Replay renders into `crypto-history-workspace-canvas`, separate from the active Wallet Lookup graph canvas.
- Staged history is not merged into Wallet Lookup graph state.
- Wallet Lookup replacement behavior is unchanged.
- Browser code still has no provider authority and makes no provider calls.
- Provider access remains Worker-only.

## Performance Caps

Replay remains bounded by the frontend preview caps:

- `maxTransactions`: capped replay transfer steps,
- `maxNodes`: capped graph nodes,
- `maxEdges`: capped graph edges,
- `maxParticles`: capped animated particles per frame.

The animator continues using requestAnimationFrame with a fixed frame guard and does not create an unbounded loop. Large histories must stay windowed and staged instead of being rendered as a full archive graph in one browser pass.

## Future Oldest-First Path

The next archive-grade replay phase should add explicit replay-window retrieval from manifest-backed staged scans. That path should hydrate sanitized oldest-first windows from the Worker, preserve the same preview-only canvas boundary, and avoid treating partial staged history as complete wallet lifetime history.
