# Phase D134 - Replay Audit Mode and Transfer Drilldown

D134 turns Replay Workspace from cinematic playback into a replay-only audit surface. The active Wallet Lookup graph remains unchanged: staged replay data renders only into `crypto-history-workspace-canvas`, and no replay interaction merges, replaces, or mutates `state.graph`.

## Replay Audit Mode

- Replay steps can be paused, scrubbed, selected from the audit event strip, or selected by clicking replay edges.
- The selected replay transfer drives the drilldown panel, replay highlight, related-transfer cards, breadcrumbs, and Details tab replay readout.
- Clicking a replay edge selects that replay event and pauses audit navigation around that step.
- Clicking a replay wallet node applies a replay-only counterparty filter. Clicking a replay token node applies a replay-only token filter.
- The animator dims unmatched or unrelated replay paths without changing Wallet Lookup filters or active graph state.

## Transfer Drilldown Rules

The drilldown panel shows staged transfer metadata only:

- source wallet and destination wallet
- amount and token
- direction relative to staged normalization
- timestamp and signature
- replay step and replay window
- provider state, provider grade, and confidence labels
- staged replay warnings and partial-window warnings

These fields are observations from the staged replay dataset. They are not identity, ownership, risk, criminality, intent, or investment claims.

## Replay-Only Boundaries

- Browser code still does not call chain providers directly.
- Worker history pages remain the only history-provider access path.
- Replay filters, breadcrumbs, follow actions, related-transfer cards, and expansion actions operate on the staged preview dataset only.
- Replay selections do not set `selectedId` or `selectedFlowId` on the active Wallet Lookup graph.
- Wallet Lookup replacement behavior is unchanged.

## Relationship Derivation

Related transfer exploration is derived only from staged replay rows:

- same counterparty: source or destination wallet overlaps the selected event
- same token: normalized token label matches the selected event
- nearby timestamp: event time is within one day of the selected event
- repeated route: source-to-destination route matches the selected event

The UI reports these as derived staged relationships only. It does not infer common ownership, identity, risk, or intent.

## Audit Limitations

Replay Audit Mode remains bounded by preview caps and staged history availability. Partial windows, provider limits, rate limits, ambiguous cursor exhaustion, or missing timestamps can hide transfers outside the loaded preview data. Major-flow filtering is based on the upper quartile of staged transfer amounts, not forensic materiality.

## Future Archive-Grade Goals

The next archive-grade replay phase should add sanitized replay-window retrieval backed by scan manifests, server-side window materialization, durable audit checkpoints, and window-to-window path continuation. That work should keep the same preview-only canvas boundary and still avoid browser-side provider authority.
