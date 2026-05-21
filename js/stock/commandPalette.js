(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const GROUPS = [
        'Navigate',
        'Topology',
        'Workspace',
        'Route / Corridor',
        'Overlay',
        'Replay / Timeline',
        'Crypto Investigation',
        'Crypto Replay',
        'Crypto Flow',
        'Crypto Workspace',
        'Snapshot / Investigation'
    ];

    const GROUP_META = Object.freeze({
        'Navigate': {
            summary: 'Modes, fullscreen, focus, and product handoff',
            keywords: 'mode fullscreen focus preset product graph controls'
        },
        'Topology': {
            summary: 'Hub, corridor, and topology validation jumps',
            keywords: 'hub central pressure validation topology'
        },
        'Workspace': {
            summary: 'Session-only pins, stacks, and workspaces',
            keywords: 'session workspace pin memory handoff'
        },
        'Route / Corridor': {
            summary: 'Route comparison, route stepping, and corridor lanes',
            keywords: 'compare route corridor lane trace path step'
        },
        'Overlay': {
            summary: 'Evidence, bridge, corridor, and source layers',
            keywords: 'overlay layer evidence source bridge corridor'
        },
        'Replay / Timeline': {
            summary: 'Stock chronology and replay checkpoints',
            keywords: 'replay timeline chronology checkpoint'
        },
        'Crypto Investigation': {
            summary: 'Replay lineage, narratives, and active event focus',
            keywords: 'crypto replay lineage narrative event center'
        },
        'Crypto Replay': {
            summary: 'Preview-only replay stepping and focus cycling',
            keywords: 'crypto replay next previous focus corridor continuity'
        },
        'Crypto Flow': {
            summary: 'Replay corridor, bridge wallet, and token focus',
            keywords: 'crypto flow corridor bridge wallet token concentration'
        },
        'Crypto Workspace': {
            summary: 'Crypto replay workspace and session presets',
            keywords: 'crypto workspace preset replay liquidity concentration'
        },
        'Snapshot / Investigation': {
            summary: 'Snapshots, staged investigations, and labels',
            keywords: 'snapshot stage queue labels investigation'
        }
    });

    const COMMAND_COPY = Object.freeze({
        'fit-graph': ['Fit current visible graph without changing filters.', 'fit zoom viewport'],
        'reset-graph': ['Reset filters, layout, and graph workspace state.', 'reset clear'],
        'fullscreen-stock': ['Toggle graph-first Stock workspace.', 'fullscreen expand compress stock'],
        'focus-mode': ['Dim unrelated nodes around the current selection.', 'focus selected dim'],
        'perspective-mode': ['Toggle depth cues on the same 2D graph.', 'depth perspective'],
        'orb-map': ['Open or hide the spatial orb overview.', 'orb spatial map'],
        'controls': ['Open progressive controls for the active mode.', 'drawer controls sliders'],
        'focus-stock-search': ['Search or select a StockPhotonic company.', 'stock search company ticker select'],
        'mode-explore': ['Broad graph scanning mode.', 'explore ux mode'],
        'mode-analyst': ['Route, topology, and workspace workflow mode.', 'analyst ux mode'],
        'mode-review': ['Evidence and source-review workflow mode.', 'review ux mode'],
        'mode-replay': ['Chronology and replay checkpoint workflow mode.', 'replay ux mode'],
        'crypto-mode-flow': ['Wallet and flow inspection mode.', 'crypto flow ux mode'],
        'crypto-mode-analyst': ['Wallet and corridor focus mode.', 'crypto analyst ux mode'],
        'crypto-mode-review': ['Source and data boundary review mode.', 'crypto review ux mode'],
        'crypto-mode-replay': ['Preview replay workspace mode.', 'crypto replay ux mode'],
        'preset-exploration': ['Balanced overview preset.', 'preset exploration balanced'],
        'preset-discovery-investigation': ['Guided hubs, overlays, and stack handoff.', 'preset discovery investigation'],
        'preset-performance': ['Lean overlays for dense graph work.', 'preset performance safe'],
        'center-selected-node': ['Center the selected company or relationship context.', 'selected node center'],
        'fit-selected-neighborhood': ['Zoom to the selected company neighborhood.', 'selected neighborhood fit'],
        'jump-selected-node': ['Return to the selected graph item.', 'selected node jump'],
        'topology-summary': ['Open deterministic topology summary for the visible graph.', 'topology summary validation'],
        'topology-centrality': ['Focus the highest central visible hub.', 'central hub topology'],
        'topology-corridor-pressure': ['Jump to the highest-pressure corridor.', 'pressure corridor'],
        'preset-topology': ['Show topology validation and strategic hubs.', 'preset topology'],
        'workspace-new': ['Create a new session-only workspace.', 'workspace session create'],
        'workspace-next': ['Move to the next session-only workspace.', 'workspace next'],
        'workspace-prev': ['Move to the previous session-only workspace.', 'workspace previous'],
        'pin-current-route': ['Pin the active route or comparison in session memory.', 'pin route comparison'],
        'pin-current-corridor': ['Pin the active corridor lane in session memory.', 'pin corridor'],
        'pin-selected-hub': ['Pin the selected company hub in session memory.', 'pin hub selected'],
        'clear-session-workspace': ['Clear only session workspace memory.', 'clear session workspace'],
        'compare-strongest-route': ['Compare the strongest visible relationship path.', 'compare strongest route'],
        'compare-source-route': ['Compare source-backed route evidence.', 'compare source backed route'],
        'compare-ecosystem-route': ['Compare route through active ecosystem context.', 'compare ecosystem route'],
        'compare-bridge-route': ['Compare bridge-company route context.', 'compare bridge route'],
        'preset-route': ['Start route mode or fit the active route.', 'preset route'],
        'preset-corridor-investigation': ['Open corridor density and lane focus.', 'preset corridor investigation'],
        'fit-comparison': ['Fit the active route comparison.', 'fit route comparison'],
        'clear-comparison': ['Clear the active route comparison.', 'clear route comparison'],
        'route-workspace': ['Open compact route workspace for the active comparison.', 'route workspace'],
        'route-forward': ['Step to the next route node.', 'route step next'],
        'route-backward': ['Step to the previous route node.', 'route step previous'],
        'inspect-strongest-route': ['Trace strongest route from current context.', 'trace strongest route'],
        'isolate-corridor': ['Focus the dominant visible corridor.', 'dominant corridor isolate'],
        'next-corridor': ['Move to the next corridor lane.', 'next corridor lane'],
        'previous-corridor': ['Move to the previous corridor lane.', 'previous corridor lane'],
        'next-hub': ['Move to the next strategic hub.', 'next hub'],
        'previous-hub': ['Move to the previous strategic hub.', 'previous hub'],
        'next-bridge': ['Move to the next bridge company.', 'next bridge company'],
        'previous-bridge': ['Move to the previous bridge company.', 'previous bridge company'],
        'overlay-source-confidence': ['Show source-confidence readability layer.', 'source confidence overlay'],
        'overlay-strategic-hubs': ['Show strategic hub layer.', 'strategic hubs overlay'],
        'overlay-corridor-density': ['Show corridor density layer.', 'corridor density overlay'],
        'overlay-bridge-company': ['Show bridge-company layer.', 'bridge company overlay'],
        'source-lens': ['Toggle source coverage lens.', 'source lens evidence'],
        'sec-preview': ['Toggle SEC-backed preview relationships.', 'SEC preview source'],
        'candidate-preview': ['Toggle candidate-company preview nodes.', 'candidate preview'],
        'clear-overlays': ['Clear graph intelligence overlays.', 'clear overlays'],
        'preset-evidence': ['Review mode with source lens.', 'preset evidence'],
        'preset-evidence-investigation': ['Evidence gaps, source layer, and review controls.', 'preset evidence investigation'],
        'stock-replay-neighborhood': ['Open replay neighborhood from current Stock context.', 'stock replay neighborhood'],
        'preset-replay-investigation': ['Replay mode with chronology checkpoints.', 'preset replay investigation'],
        'stock-chronology-next': ['Move to the next graph chronology event.', 'chronology next'],
        'stock-chronology-prev': ['Move to the previous graph chronology event.', 'chronology previous'],
        'stock-replay-checkpoint': ['Save a session-only replay checkpoint.', 'replay checkpoint session'],
        'crypto-replay': ['Toggle preview-only Crypto replay workspace.', 'crypto replay workspace'],
        'crypto-preset-replay-investigation': ['Session-only replay stack, lineage, and narratives.', 'crypto preset replay investigation'],
        'crypto-preset-liquidity-flow': ['Session-only visible corridor focus.', 'crypto preset liquidity flow'],
        'crypto-preset-concentration-focus': ['Session-only staged token concentration focus.', 'crypto preset concentration'],
        'crypto-preset-wallet-corridor': ['Session-only wallet corridor focus.', 'crypto preset wallet corridor'],
        'crypto-replay-neighborhood': ['Open staged replay neighborhood details.', 'crypto replay neighborhood'],
        'crypto-replay-lineage': ['Open session-only replay lineage.', 'crypto replay lineage'],
        'crypto-replay-jump-back': ['Jump back through session replay lineage.', 'crypto replay jump back'],
        'crypto-replay-toggle-narratives': ['Show or hide deterministic replay narratives.', 'crypto replay narratives'],
        'crypto-center-replay': ['Center the selected staged replay transfer.', 'crypto replay center transfer'],
        'crypto-replay-next-event': ['Step to the next staged replay event.', 'crypto replay next event'],
        'crypto-replay-previous-event': ['Step to the previous staged replay event.', 'crypto replay previous event'],
        'crypto-replay-cycle-focus': ['Cycle replay focus forward through staged events.', 'crypto replay focus next'],
        'crypto-replay-cycle-focus-prev': ['Cycle replay focus backward through staged events.', 'crypto replay focus previous'],
        'crypto-replay-next-corridor': ['Move to the next visible replay corridor transition.', 'crypto replay next corridor'],
        'crypto-replay-previous-corridor': ['Move to the previous visible replay corridor transition.', 'crypto replay previous corridor'],
        'crypto-replay-focus-cluster': ['Focus repeated staged replay pattern.', 'crypto replay cluster'],
        'crypto-replay-toggle-corridor-overlay': ['Toggle session-only corridor overlay.', 'crypto replay corridor overlay'],
        'crypto-replay-toggle-continuity-view': ['Toggle session-only continuity view.', 'crypto replay continuity'],
        'crypto-flow-corridor-isolate': ['Isolate dominant visible replay corridor.', 'crypto flow corridor isolate'],
        'crypto-replay-bridge-wallet': ['Focus address-level bridge wallet context.', 'crypto bridge wallet'],
        'crypto-replay-concentration-zone': ['Focus token-row concentration zone.', 'crypto concentration token'],
        'crypto-wallet-corridor-focus': ['Focus selected or bridge wallet corridor.', 'crypto wallet corridor'],
        'snapshot-current': ['Capture a session-only graph snapshot.', 'snapshot session'],
        'stage-current': ['Queue current context for session workflow.', 'stage queue investigation'],
        'source-gap-filter': ['Open evidence gap filter.', 'source evidence gap'],
        'clear-selected-relationship': ['Clear the selected relationship context.', 'clear relationship selection'],
        'clear-route-trace': ['Clear relationship route trace.', 'clear route trace'],
        'crypto-labels': ['Cycle Crypto label density.', 'crypto labels density'],
        'crypto-center': ['Center the tracked wallet.', 'crypto center wallet']
    });

    const CRYPTO_REPLAY_STATE_COMMAND_KEYS = new Set([
        'replay-narrative',
        'replay-dataset',
        'replay-event',
        'replay-focus',
        'replay-lineage',
        'replay-corridor',
        'replay-next-corridor',
        'replay-previous-corridor',
        'replay-cluster',
        'replay-bridge-wallet',
        'replay-token-concentration',
        'replay-wallet-corridor',
        'replay-corridor-overlay',
        'replay-continuity-view'
    ]);

    const DEFAULT_STOCK_COMMANDS = Object.freeze({
        explore: [
            'focus-stock-search',
            'controls',
            'mode-analyst',
            'mode-review',
            'mode-replay',
            'crypto-product'
        ],
        analyst: [
            'mode-analyst',
            'compare-source-route',
            'inspect-strongest-route',
            'next-corridor',
            'route-workspace',
            'controls',
            'mode-review'
        ],
        review: [
            'mode-review',
            'source-lens',
            'overlay-source-confidence',
            'source-workbench',
            'source-gap-filter',
            'controls',
            'mode-replay'
        ],
        replay: [
            'mode-replay',
            'stock-replay-neighborhood',
            'controls',
            'mode-analyst',
            'mode-review'
        ]
    });

    const DEFAULT_CRYPTO_COMMANDS = Object.freeze({
        flow: [
            'crypto-mode-flow',
            'crypto-center',
            'crypto-mode-analyst',
            'crypto-mode-review',
            'stock-product'
        ],
        analyst: [
            'crypto-mode-analyst',
            'crypto-center',
            'crypto-labels',
            'crypto-mode-review',
            'crypto-mode-replay',
            'stock-product'
        ],
        review: [
            'crypto-mode-review',
            'crypto-mode-flow',
            'crypto-mode-analyst',
            'crypto-fullscreen',
            'stock-product'
        ],
        replay: [
            'crypto-mode-replay',
            'crypto-replay',
            'crypto-mode-analyst',
            'crypto-mode-review',
            'stock-product'
        ]
    });

    const state = {
        initialized: false,
        open: false,
        index: 0,
        query: '',
        availabilitySignature: '',
        availabilityAt: 0,
        availability: new Map()
    };

    function initialize() {
        if (state.initialized) return;
        const palette = getPalette();
        const input = getInput();
        const results = getResults();
        if (!palette || !input || !results) return;
        state.initialized = true;

        document.addEventListener('keydown', handleGlobalKeydown, true);
        palette.addEventListener('click', handlePaletteClick, true);
        input.addEventListener('input', handleInput, true);
        input.addEventListener('keydown', handleInputKeydown, true);

        window.openPhotonicCommandPalette = openCommandPalette;
        window.closePhotonicCommandPalette = closeCommandPalette;
        updatePaletteCopy();
    }

    function openCommandPalette() {
        const palette = getPalette();
        const input = getInput();
        if (!palette || !input) return;
        state.open = true;
        state.index = 0;
        state.query = '';
        input.value = '';
        palette.classList.add('is-open');
        palette.setAttribute('aria-hidden', 'false');
        updatePaletteCopy();
        render();
        window.setTimeout(() => input.focus(), 0);
    }

    function closeCommandPalette() {
        const palette = getPalette();
        if (!palette) return;
        state.open = false;
        palette.classList.remove('is-open');
        palette.setAttribute('aria-hidden', 'true');
    }

    function handleGlobalKeydown(event) {
        const key = String(event.key || '').toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === 'k') {
            event.preventDefault();
            event.stopImmediatePropagation();
            openCommandPalette();
            return;
        }
        if (state.open && event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeCommandPalette();
        }
    }

    function handlePaletteClick(event) {
        if (!state.open) return;
        const palette = getPalette();
        if (event.target === palette) {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeCommandPalette();
            return;
        }
        const row = event.target.closest?.('[data-command-id]');
        if (!row) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        runCommand(row.dataset.commandId);
    }

    function handleInput(event) {
        state.query = event.target.value || '';
        state.index = 0;
        event.stopImmediatePropagation();
        render();
    }

    function handleInputKeydown(event) {
        const commands = getFilteredCommands();
        if (event.key === 'ArrowDown') {
            state.index = commands.length ? (state.index + 1) % commands.length : 0;
            event.preventDefault();
            event.stopImmediatePropagation();
            render();
        } else if (event.key === 'ArrowUp') {
            state.index = commands.length ? (state.index - 1 + commands.length) % commands.length : 0;
            event.preventDefault();
            event.stopImmediatePropagation();
            render();
        } else if (event.key === 'Enter') {
            const command = commands[state.index] || commands[0];
            if (command) runCommand(command.id);
            event.preventDefault();
            event.stopImmediatePropagation();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeCommandPalette();
        }
    }

    function getCommands() {
        return [
            command('fit-graph', 'Fit Visible Graph', 'Navigate', () => callGlobal('fitGraph')),
            command('reset-graph', 'Reset Graph Workspace', 'Navigate', () => callGlobal('resetAll')),
            command('fullscreen-stock', 'Toggle Stock Fullscreen', 'Navigate', () => callGlobal('toggleGraphFullscreen')),
            command('focus-mode', 'Toggle Focus Mode', 'Navigate', () => callGlobal('toggleFocusMode')),
            command('perspective-mode', 'Toggle Perspective Mode', 'Navigate', () => callGlobal('togglePerspectiveMode')),
            command('orb-map', 'Toggle Orb Map', 'Navigate', () => callGlobal('toggleOrbMap')),
            command('controls', 'Open Graph Controls', 'Navigate', () => window.setGraphControlDrawer?.(true)),
            command('focus-stock-search', 'Search / Select Company', 'Navigate', () => focusStockCompanySearch()),
            command('mode-explore', 'Explore UX Mode', 'Navigate', () => window.setStockUxMode?.('explore')),
            command('mode-analyst', 'Analyst UX Mode', 'Navigate', () => window.setStockUxMode?.('analyst')),
            command('mode-review', 'Review UX Mode', 'Navigate', () => window.setStockUxMode?.('review')),
            command('mode-replay', 'Replay UX Mode', 'Navigate', () => window.setStockUxMode?.('replay')),
            command('crypto-mode-flow', 'Crypto Flow Mode', 'Navigate', () => setCryptoUxModeFromPalette('flow')),
            command('crypto-mode-analyst', 'Crypto Analyst Mode', 'Navigate', () => setCryptoUxModeFromPalette('analyst')),
            command('crypto-mode-review', 'Crypto Review Mode', 'Navigate', () => setCryptoUxModeFromPalette('review')),
            command('crypto-mode-replay', 'Crypto Replay Mode', 'Navigate', () => setCryptoUxModeFromPalette('replay')),
            command('preset-exploration', 'Preset: Exploration Mode', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'exploration')),
            command('preset-discovery-investigation', 'Preset: Discovery Investigation', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'discovery_investigation')),
            command('preset-performance', 'Preset: Performance Mode', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'performance')),
            command('large-overview', 'Large Graph Overview', 'Navigate', () => callGlobal('setLargeGraphMode', 'overview')),
            command('large-ecosystem', 'Ecosystem Focus', 'Navigate', () => callGlobal('setLargeGraphMode', 'ecosystem_focus'), { disabledReason: () => stockReadyReason() }),
            command('large-neighborhood', 'Neighborhood Isolation', 'Navigate', () => callGlobal('setLargeGraphMode', 'neighborhood'), { disabledReason: () => stockReadyReason() }),
            command('large-hubs', 'Strategic Hub Mode', 'Navigate', () => callGlobal('setLargeGraphMode', 'strategic_hubs'), { disabledReason: () => stockReadyReason() }),
            command('large-production', 'Production-Only Graph', 'Navigate', () => callGlobal('setLargeGraphMode', 'production_only'), { disabledReason: () => stockReadyReason() }),
            command('large-preview', 'Preview-Only Graph', 'Navigate', () => callGlobal('setLargeGraphMode', 'preview_only'), { disabledReason: () => stockReadyReason() }),
            command('center-selected-node', 'Center Selected Node', 'Navigate', () => callGlobal('centerSelectedNode'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('fit-selected-neighborhood', 'Fit Selected Neighborhood', 'Navigate', () => callGlobal('fitSelectedNeighborhood'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('jump-selected-node', 'Jump To Selected Node', 'Navigate', () => callGlobal('jumpToSelectedGraphNode'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('graph-workbench', 'Open Graph Intelligence', 'Navigate', () => callGlobal('setAppView', 'graph')),
            command('source-workbench', 'Open Source Workbench', 'Navigate', () => callGlobal('setAppView', 'source')),
            command('stock-product', 'Switch To StockPhotonic', 'Navigate', () => callGlobal('setProductView', 'stock')),
            command('crypto-product', 'Switch To CryptoPhotonic', 'Navigate', () => callGlobal('setProductView', 'crypto')),
            command('crypto-fullscreen', 'Toggle Crypto Fullscreen', 'Navigate', () => window.CryptoPhotonic?.ui?.setFullscreen?.(!window.CryptoPhotonic?.ui?.getState?.().fullscreen), { disabledReason: () => cryptoReadyReason() }),

            command('topology-summary', 'Show Topology Summary', 'Topology', () => callGlobal('showTopologySummary')),
            command('topology-centrality', 'Jump Market-Central Hub', 'Topology', () => callGlobal('jumpToMarketCentralHub'), { disabledReason: () => stockReadyReason() }),
            command('topology-corridor-pressure', 'Jump Pressure Corridor', 'Topology', () => callGlobal('jumpToPressureCorridor'), { disabledReason: () => stockReadyReason() }),
            command('preset-topology', 'Preset: Topology Mode', 'Topology', () => callGlobal('applyGraphAnalystPreset', 'topology'), { disabledReason: () => stockReadyReason() }),

            command('workspace-new', 'New Session Workspace', 'Workspace', () => callGlobal('createAnalystWorkspace')),
            command('workspace-next', 'Next Session Workspace', 'Workspace', () => callGlobal('cycleAnalystWorkspace', 1)),
            command('workspace-prev', 'Previous Session Workspace', 'Workspace', () => callGlobal('cycleAnalystWorkspace', -1)),
            command('pin-current-route', 'Pin Current Route', 'Workspace', () => callGlobal('pinCurrentRoute'), { disabledReason: () => stockDisabledReason('route-step') }),
            command('pin-current-corridor', 'Pin Current Corridor', 'Workspace', () => callGlobal('pinCurrentCorridor'), { disabledReason: () => stockDisabledReason('corridor-active') }),
            command('pin-selected-hub', 'Pin Selected Hub', 'Workspace', () => callGlobal('pinSelectedHub'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('clear-session-workspace', 'Clear Session Workspace', 'Workspace', () => callGlobal('clearInvestigationWorkspace')),

            command('compare-strongest-route', 'Compare Strongest Route', 'Route / Corridor', () => callGlobal('compareStrongestRoute'), { disabledReason: () => stockDisabledReason('compare') }),
            command('compare-source-route', 'Compare Source-Backed Route', 'Route / Corridor', () => callGlobal('compareSourceBackedRoute'), { disabledReason: () => stockDisabledReason('compare') }),
            command('compare-ecosystem-route', 'Compare Ecosystem Route', 'Route / Corridor', () => callGlobal('compareEcosystemRoute'), { disabledReason: () => stockDisabledReason('compare') }),
            command('compare-bridge-route', 'Compare Bridge-Company Route', 'Route / Corridor', () => callGlobal('compareBridgeCompanyRoute'), { disabledReason: () => stockDisabledReason('compare') }),
            command('preset-route', 'Preset: Route Mode', 'Route / Corridor', () => callGlobal('applyGraphAnalystPreset', 'route'), { disabledReason: () => stockDisabledReason('compare') }),
            command('preset-corridor-investigation', 'Preset: Corridor Investigation', 'Route / Corridor', () => callGlobal('applyGraphAnalystPreset', 'corridor_investigation'), { disabledReason: () => stockReadyReason() }),
            command('fit-comparison', 'Fit Route Comparison', 'Route / Corridor', () => callGlobal('fitRouteComparison'), { disabledReason: () => stockDisabledReason('comparison') }),
            command('clear-comparison', 'Clear Route Comparison', 'Route / Corridor', () => callGlobal('clearRouteComparison'), { disabledReason: () => stockDisabledReason('comparison') }),
            command('route-workspace', 'Open Current Route Workspace', 'Route / Corridor', () => callGlobal('openCurrentRouteWorkspace'), { disabledReason: () => stockDisabledReason('comparison') }),
            command('route-forward', 'Step Route Forward', 'Route / Corridor', () => callGlobal('stepRouteNode', 1), { disabledReason: () => stockDisabledReason('route-step') }),
            command('route-backward', 'Step Route Backward', 'Route / Corridor', () => callGlobal('stepRouteNode', -1), { disabledReason: () => stockDisabledReason('route-step') }),
            command('inspect-strongest-route', 'Trace Strongest Route', 'Route / Corridor', () => callGlobal('traceRelationshipRoute', 'strongest'), { disabledReason: () => stockDisabledReason('compare') }),
            command('isolate-corridor', 'Isolate Dominant Corridor', 'Route / Corridor', () => callGlobal('isolateDominantCorridor'), { disabledReason: () => stockReadyReason() }),
            command('next-corridor', 'Next Corridor Lane', 'Route / Corridor', () => callGlobal('nextCorridorLane'), { disabledReason: () => stockDisabledReason('corridors') }),
            command('previous-corridor', 'Previous Corridor Lane', 'Route / Corridor', () => callGlobal('previousCorridorLane'), { disabledReason: () => stockDisabledReason('corridors') }),
            command('next-hub', 'Next Strategic Hub', 'Route / Corridor', () => callGlobal('nextStrategicHub'), { disabledReason: () => stockDisabledReason('hubs') }),
            command('previous-hub', 'Previous Strategic Hub', 'Route / Corridor', () => callGlobal('previousStrategicHub'), { disabledReason: () => stockDisabledReason('hubs') }),
            command('next-bridge', 'Next Bridge Company', 'Route / Corridor', () => callGlobal('nextBridgeCompany'), { disabledReason: () => stockDisabledReason('bridges') }),
            command('previous-bridge', 'Previous Bridge Company', 'Route / Corridor', () => callGlobal('previousBridgeCompany'), { disabledReason: () => stockDisabledReason('bridges') }),

            command('overlay-source-confidence', 'Source Confidence Layer', 'Overlay', () => callGlobal('setAnalystOverlay', 'source_confidence')),
            command('overlay-strategic-hubs', 'Strategic Hubs Layer', 'Overlay', () => callGlobal('setAnalystOverlay', 'strategic_hubs')),
            command('overlay-corridor-density', 'Corridor Density Layer', 'Overlay', () => callGlobal('setAnalystOverlay', 'corridor_density')),
            command('overlay-bridge-company', 'Bridge Company Layer', 'Overlay', () => callGlobal('setAnalystOverlay', 'bridge_company')),
            command('source-lens', 'Toggle Source Coverage Lens', 'Overlay', () => callGlobal('toggleSourceCoverageLens')),
            command('sec-preview', 'Toggle SEC Preview', 'Overlay', () => callGlobal('toggleSecPreviewRelationships')),
            command('candidate-preview', 'Toggle Candidate Companies', 'Overlay', () => callGlobal('toggleCandidateCompanyPreview')),
            command('clear-overlays', 'Clear Graph Overlays', 'Overlay', () => callGlobal('clearGraphIntelligenceOverlays')),
            command('preset-evidence', 'Preset: Evidence Mode', 'Overlay', () => callGlobal('applyGraphAnalystPreset', 'evidence')),
            command('preset-evidence-investigation', 'Preset: Evidence Investigation', 'Overlay', () => callGlobal('applyGraphAnalystPreset', 'evidence_investigation')),
            command('center-ecosystem', 'Center Active Ecosystem', 'Overlay', () => callGlobal('centerActiveEcosystem'), { disabledReason: () => stockReadyReason() }),
            command('focus-bridges', 'Focus Bridge Companies', 'Overlay', () => callGlobal('focusBridgeCompanies'), { disabledReason: () => stockDisabledReason('bridges') }),

            command('stock-replay-neighborhood', 'Open Stock Replay Neighborhood', 'Replay / Timeline', () => callGlobal('openStockReplayNeighborhood'), { disabledReason: () => stockDisabledReason('replay-context') }),
            command('preset-replay-investigation', 'Preset: Replay Investigation', 'Replay / Timeline', () => callGlobal('applyGraphAnalystPreset', 'replay_investigation')),
            command('stock-chronology-next', 'Next Graph Chronology Event', 'Replay / Timeline', () => callGlobal('stepGraphChronology', 1), { disabledReason: () => stockDisabledReason('timeline') }),
            command('stock-chronology-prev', 'Previous Graph Chronology Event', 'Replay / Timeline', () => callGlobal('stepGraphChronology', -1), { disabledReason: () => stockDisabledReason('timeline') }),
            command('stock-replay-checkpoint', 'Save Stock Replay Checkpoint', 'Replay / Timeline', () => callGlobal('addStockReplayCheckpoint'), { disabledReason: () => stockDisabledReason('replay-checkpoint') }),
            command('crypto-replay', 'Toggle Crypto Replay Workspace', 'Crypto Workspace', () => window.CryptoPhotonic?.ui?.toggleReplayWorkspaceMode?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-workspace') }),
            command('crypto-preset-replay-investigation', 'Crypto Replay Investigation preset', 'Crypto Workspace', () => window.CryptoPhotonic?.ui?.applyCryptoAnalystPreset?.('replay_investigation'), { disabledReason: () => cryptoCommandDisabledReason('replay-workspace') }),
            command('crypto-preset-liquidity-flow', 'Crypto Liquidity Flow preset', 'Crypto Workspace', () => window.CryptoPhotonic?.ui?.applyCryptoAnalystPreset?.('liquidity_flow'), { disabledReason: () => cryptoCommandDisabledReason('preset-liquidity-flow') }),
            command('crypto-preset-concentration-focus', 'Crypto Concentration Focus preset', 'Crypto Workspace', () => window.CryptoPhotonic?.ui?.applyCryptoAnalystPreset?.('concentration_focus'), { disabledReason: () => cryptoCommandDisabledReason('replay-token-concentration') }),
            command('crypto-preset-wallet-corridor', 'Crypto Wallet Corridor Focus preset', 'Crypto Workspace', () => window.CryptoPhotonic?.ui?.applyCryptoAnalystPreset?.('wallet_corridor_focus'), { disabledReason: () => cryptoCommandDisabledReason('replay-wallet-corridor') }),

            command('crypto-replay-neighborhood', 'Open Crypto Replay Neighborhood', 'Crypto Investigation', () => window.CryptoPhotonic?.ui?.openReplayNeighborhood?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-event') }),
            command('crypto-replay-lineage', 'Open Crypto Replay Lineage', 'Crypto Investigation', () => window.CryptoPhotonic?.ui?.openReplayLineage?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-dataset') }),
            command('crypto-replay-jump-back', 'Jump Back Crypto Replay Lineage', 'Crypto Investigation', () => window.CryptoPhotonic?.ui?.jumpBackReplayLineage?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-lineage') }),
            command('crypto-replay-toggle-narratives', 'Toggle Crypto Replay Narratives', 'Crypto Investigation', () => window.CryptoPhotonic?.ui?.toggleReplayNarratives?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-narrative') }),
            command('crypto-center-replay', 'Center Active Crypto Replay Transfer', 'Crypto Investigation', () => window.CryptoPhotonic?.ui?.centerCurrentReplayTransfer?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-event') }),

            command('crypto-replay-next-event', 'Next Crypto Replay Event', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.nextReplayEvent?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-event') }),
            command('crypto-replay-previous-event', 'Previous Crypto Replay Event', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.previousReplayEvent?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-event') }),
            command('crypto-replay-cycle-focus', 'Cycle Crypto Replay Focus', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.cycleReplayFocus?.(1), { disabledReason: () => cryptoCommandDisabledReason('replay-focus') }),
            command('crypto-replay-cycle-focus-prev', 'Cycle Crypto Replay Focus Back', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.cycleReplayFocus?.(-1), { disabledReason: () => cryptoCommandDisabledReason('replay-focus') }),
            command('crypto-replay-next-corridor', 'Next Replay Corridor', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.stepReplayCorridor?.(1), { disabledReason: () => cryptoCommandDisabledReason('replay-next-corridor') }),
            command('crypto-replay-previous-corridor', 'Previous Replay Corridor', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.stepReplayCorridor?.(-1), { disabledReason: () => cryptoCommandDisabledReason('replay-previous-corridor') }),
            command('crypto-replay-focus-cluster', 'Focus Replay Cluster', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.focusReplayCluster?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-cluster') }),
            command('crypto-replay-toggle-corridor-overlay', 'Toggle Replay Corridor Overlay', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.toggleReplayCorridorOverlay?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-corridor-overlay') }),
            command('crypto-replay-toggle-continuity-view', 'Toggle Replay Continuity View', 'Crypto Replay', () => window.CryptoPhotonic?.ui?.toggleReplayContinuityView?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-continuity-view') }),

            command('crypto-flow-corridor-isolate', 'Isolate Crypto Flow Corridor', 'Crypto Flow', () => window.CryptoPhotonic?.ui?.isolateReplayFlowCorridor?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-corridor') }),
            command('crypto-replay-bridge-wallet', 'Focus Replay Bridge Wallet', 'Crypto Flow', () => window.CryptoPhotonic?.ui?.focusReplayBridgeWallet?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-bridge-wallet') }),
            command('crypto-replay-concentration-zone', 'Focus Replay Concentration Zone', 'Crypto Flow', () => window.CryptoPhotonic?.ui?.focusReplayConcentrationZone?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-token-concentration') }),
            command('crypto-wallet-corridor-focus', 'Focus Crypto Wallet Corridor', 'Crypto Flow', () => window.CryptoPhotonic?.ui?.focusReplayWalletCorridor?.(), { disabledReason: () => cryptoCommandDisabledReason('replay-wallet-corridor') }),

            command('snapshot-current', 'Capture Graph Snapshot', 'Snapshot / Investigation', () => callGlobal('captureCurrentGraphSnapshot')),
            command('stage-current', 'Stage Current Investigation', 'Snapshot / Investigation', () => callGlobal('queueCurrentInvestigation')),
            command('source-gap-filter', 'Show Evidence Gap Filter', 'Snapshot / Investigation', () => callGlobal('showEvidenceGapFilter')),
            command('clear-selected-relationship', 'Clear Selected Relationship', 'Snapshot / Investigation', () => callGlobal('clearSelectedRelationship')),
            command('clear-route-trace', 'Clear Route Trace', 'Snapshot / Investigation', () => callGlobal('clearRelationshipRoute')),
            command('crypto-labels', 'Cycle Crypto Labels', 'Snapshot / Investigation', () => window.CryptoPhotonic?.ui?.cycleLabelDensity?.(), { disabledReason: () => cryptoReadyReason() }),
            command('crypto-center', 'Center Tracked Wallet', 'Snapshot / Investigation', () => window.CryptoPhotonic?.ui?.centerTrackedWallet?.(), { disabledReason: () => cryptoReadyReason() })
        ].filter(item => GROUPS.includes(item.group));
    }

    function command(id, label, group, action, options = {}) {
        const copy = COMMAND_COPY[id] || [];
        return {
            id,
            label,
            group,
            action,
            subtitle: options.subtitle || copy[0] || '',
            keywords: joinKeywords(options.keywords, copy[1], GROUP_META[group]?.keywords),
            disabledReason: options.disabledReason || ''
        };
    }

    function getFilteredCommands() {
        const query = normalize(state.query);
        const commands = getCommands();
        if (!query) return getDefaultCommandsForCurrentMode(commands);
        return commands.filter(item => normalize(`${item.label} ${item.group} ${item.subtitle} ${item.keywords} ${GROUP_META[item.group]?.summary || ''}`).includes(query));
    }

    function getDefaultCommandsForCurrentMode(commands = []) {
        const isCrypto = document.body?.classList?.contains('is-crypto-active');
        const mode = isCrypto
            ? document.body?.dataset?.cryptoUxMode || 'flow'
            : document.body?.dataset?.stockUxMode || 'explore';
        const orderedIds = isCrypto
            ? DEFAULT_CRYPTO_COMMANDS[mode] || DEFAULT_CRYPTO_COMMANDS.flow
            : DEFAULT_STOCK_COMMANDS[mode] || DEFAULT_STOCK_COMMANDS.explore;
        const byId = new Map(commands.map(item => [item.id, item]));
        const scoped = orderedIds.map(id => byId.get(id)).filter(Boolean);
        const enabledScoped = scoped.filter(item => !getCommandDisabledReason(item));
        return enabledScoped.length ? enabledScoped : scoped.length ? scoped : commands.slice(0, 14);
    }

    function render() {
        const results = getResults();
        if (!results) return;
        const commands = getFilteredCommands();
        if (state.index >= commands.length) state.index = Math.max(0, commands.length - 1);
        if (!commands.length) {
            results.innerHTML = '<div class="photonic-command-empty">No matching graph actions</div>';
            return;
        }
        const grouped = new Map();
        commands.forEach((item, index) => {
            const entries = grouped.get(item.group) || [];
            entries.push({ item, index });
            grouped.set(item.group, entries);
        });
        results.innerHTML = GROUPS.map(group => {
            const groupCommands = grouped.get(group) || [];
            if (!groupCommands.length) return '';
            const meta = GROUP_META[group] || {};
            return `
                <div class="photonic-command-section-label">
                    <span>${escapeHtml(group)}</span>
                    <small>${escapeHtml(getGroupSummaryCopy(groupCommands.length, meta.summary))}</small>
                </div>
                ${groupCommands.map(entry => renderRow(entry.item, entry.index)).join('')}
            `;
        }).join('');
    }

    function renderRow(item, index) {
        const disabled = getCommandDisabledReason(item);
        const status = getCommandRowStatus(item, disabled);
        const subtitle = getCommandSubtitle(item, disabled);
        return `
            <button type="button"
                class="photonic-command-row ${index === state.index ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''} ${status.current ? 'is-current' : ''}"
                data-command-id="${escapeHtml(item.id)}"
                ${disabled ? 'aria-disabled="true"' : ''}>
                <span class="photonic-command-row-main">
                    <span class="photonic-command-row-title">${escapeHtml(item.label)}</span>
                    <span class="photonic-command-row-subtitle">${escapeHtml(subtitle)}</span>
                </span>
                <small class="photonic-command-row-status ${disabled ? 'is-disabled' : status.current ? 'is-current' : ''}">${escapeHtml(disabled || status.label || item.group)}</small>
            </button>
        `;
    }

    function runCommand(id) {
        const item = getCommands().find(commandItem => commandItem.id === id);
        if (!item) return;
        if (getCommandDisabledReason(item)) {
            render();
            return;
        }
        closeCommandPalette();
        item.action();
    }

    function getCommandDisabledReason(item) {
        const reason = typeof item.disabledReason === 'function' ? item.disabledReason() : item.disabledReason;
        return String(reason || '');
    }

    function getCommandSubtitle(item, disabled = '') {
        if (item.subtitle) return item.subtitle;
        if (disabled) return GROUP_META[item.group]?.summary || item.group;
        return GROUP_META[item.group]?.summary || item.group;
    }

    function getCommandRowStatus(item, disabled = '') {
        if (disabled) return { label: 'Unavailable', current: false };
        const stockSnapshot = item.id.startsWith('mode-') || item.id.startsWith('preset-') || item.id === 'fullscreen-stock'
            ? getStockSnapshot()
            : {};
        const stockMode = document.body?.dataset?.stockUxMode || 'explore';
        const cryptoMode = document.body?.dataset?.cryptoUxMode || 'flow';
        const cryptoState = item.id.startsWith('crypto-') ? window.CryptoPhotonic?.ui?.getState?.() || {} : {};

        const stockModeMap = {
            'mode-explore': 'explore',
            'mode-analyst': 'analyst',
            'mode-review': 'review',
            'mode-replay': 'replay'
        };
        const cryptoModeMap = {
            'crypto-mode-flow': 'flow',
            'crypto-mode-analyst': 'analyst',
            'crypto-mode-review': 'review',
            'crypto-mode-replay': 'replay'
        };
        if (stockModeMap[item.id] && stockModeMap[item.id] === stockMode) return { label: 'Current', current: true };
        if (cryptoModeMap[item.id] && cryptoModeMap[item.id] === cryptoMode) return { label: 'Current', current: true };
        if (item.id === 'fullscreen-stock' && document.body?.classList?.contains('graph-fullscreen-active')) return { label: 'Open', current: true };
        if (item.id === 'crypto-fullscreen' && cryptoState.fullscreen) return { label: 'Open', current: true };

        const stockPresetMap = {
            'preset-exploration': 'exploration',
            'preset-discovery-investigation': 'discovery_investigation',
            'preset-performance': 'performance',
            'preset-topology': 'topology',
            'preset-route': 'route',
            'preset-corridor-investigation': 'corridor_investigation',
            'preset-evidence': 'evidence',
            'preset-evidence-investigation': 'evidence_investigation',
            'preset-replay-investigation': 'replay_investigation'
        };
        if (stockPresetMap[item.id] && stockSnapshot.activePresetKey === stockPresetMap[item.id]) {
            return { label: 'Active', current: true };
        }

        const cryptoPresetMap = {
            'crypto-preset-replay-investigation': 'replay_investigation',
            'crypto-preset-liquidity-flow': 'liquidity_flow',
            'crypto-preset-concentration-focus': 'concentration_focus',
            'crypto-preset-wallet-corridor': 'wallet_corridor_focus'
        };
        if (cryptoPresetMap[item.id] && cryptoState.activePresetKey === cryptoPresetMap[item.id]) {
            return { label: 'Active', current: true };
        }
        if (item.id === 'crypto-replay' && cryptoState.historyPreview?.workspaceMode) return { label: 'Open', current: true };
        if (item.id.startsWith('crypto-')) return { label: cryptoMode === 'replay' ? 'Replay mode' : 'Crypto' };
        if (item.group === 'Workspace' || item.group === 'Snapshot / Investigation') return { label: 'Session-only' };
        return { label: item.group };
    }

    function stockDisabledReason(key) {
        const snapshot = getStockSnapshot();
        const signature = snapshot.commandSignature || `${Date.now()}`;
        const now = Date.now();
        if (signature !== state.availabilitySignature || now - state.availabilityAt > 300) {
            state.availabilitySignature = signature;
            state.availabilityAt = now;
            state.availability.clear();
        }
        if (!state.availability.has(key)) {
            const value = typeof window.getStockCommandAvailability === 'function'
                ? window.getStockCommandAvailability(key)
                : { disabled: false, reason: '' };
            state.availability.set(key, value);
        }
        const availability = state.availability.get(key);
        return availability?.disabled ? availability.reason || 'Command unavailable in this graph state.' : '';
    }

    function stockReadyReason() {
        const snapshot = getStockSnapshot();
        return snapshot.visibleEdgeCount || snapshot.visibleNodeCount
            ? ''
            : 'Stock graph is not ready yet.';
    }

    function cryptoCommandDisabledReason(key) {
        const commandKey = String(key || '');
        const availability = window.CryptoPhotonic?.ui?.getCommandAvailability?.(key);
        if (availability?.disabled) return availability.reason || 'Crypto command unavailable in this graph state.';
        if (!availability && CRYPTO_REPLAY_STATE_COMMAND_KEYS.has(commandKey) && !isCryptoInitialized()) {
            return 'CryptoPhotonic is not initialized yet.';
        }
        return '';
    }

    function cryptoReadyReason() {
        return isCryptoInitialized() ? '' : 'Open CryptoPhotonic first.';
    }

    function isCryptoInitialized() {
        const cryptoState = window.CryptoPhotonic?.ui?.getState?.();
        return Boolean(cryptoState?.initialized);
    }

    function focusStockCompanySearch() {
        callGlobal('setProductView', 'stock');
        window.setStockUxMode?.('explore');
        window.setPhotonicControlLayer?.('primary');
        window.setGraphControlDrawer?.(true);
        window.requestAnimationFrame?.(() => {
            const input = document.getElementById('search-input');
            input?.focus();
            input?.select?.();
        });
    }

    function setCryptoUxModeFromPalette(mode) {
        callGlobal('setProductView', 'crypto');
        if (typeof window.CryptoPhotonic?.ui?.runPrimaryModeAction === 'function') {
            window.CryptoPhotonic.ui.runPrimaryModeAction(mode);
            return;
        }
        window.setCryptoUxMode?.(mode);
    }

    function callGlobal(name, ...args) {
        const fn = window[name];
        if (typeof fn === 'function') return fn(...args);
        return null;
    }

    function getStockSnapshot() {
        return typeof window.getStockGraphOsSnapshot === 'function'
            ? window.getStockGraphOsSnapshot()
            : {};
    }

    function updatePaletteCopy() {
        const hint = document.querySelector('#photonic-command-palette .photonic-command-hint');
        if (hint) {
            hint.textContent = 'Current mode actions first. Search for advanced controls when needed.';
        }
    }

    function getGroupSummaryCopy(count, summary = '') {
        return summary || `${count} searchable ${count === 1 ? 'action' : 'actions'}`;
    }

    function getPalette() {
        return document.getElementById('photonic-command-palette');
    }

    function getInput() {
        return document.getElementById('photonic-command-input');
    }

    function getResults() {
        return document.getElementById('photonic-command-results');
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function joinKeywords(...parts) {
        return parts
            .flatMap(part => Array.isArray(part) ? part : [part])
            .map(part => String(part || '').trim())
            .filter(Boolean)
            .join(' ');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    window.StockPhotonicStock.commandPalette = {
        initialize,
        openCommandPalette,
        closeCommandPalette,
        getCommands
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
