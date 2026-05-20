(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const GROUPS = [
        'Navigate',
        'Topology',
        'Workspace',
        'Route / Corridor',
        'Overlay',
        'Replay / Timeline',
        'Snapshot / Investigation'
    ];

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
            command('mode-explore', 'Explore UX Mode', 'Navigate', () => window.setStockUxMode?.('explore')),
            command('mode-analyst', 'Analyst UX Mode', 'Navigate', () => window.setStockUxMode?.('analyst')),
            command('mode-review', 'Review UX Mode', 'Navigate', () => window.setStockUxMode?.('review')),
            command('mode-replay', 'Replay UX Mode', 'Navigate', () => window.setStockUxMode?.('replay')),
            command('preset-exploration', 'Preset: Exploration Mode', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'exploration')),
            command('preset-discovery-investigation', 'Preset: Discovery Investigation', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'discovery_investigation')),
            command('preset-performance', 'Preset: Performance Mode', 'Navigate', () => callGlobal('applyGraphAnalystPreset', 'performance')),
            command('large-overview', 'Large Graph Overview', 'Navigate', () => callGlobal('setLargeGraphMode', 'overview')),
            command('large-ecosystem', 'Ecosystem Focus', 'Navigate', () => callGlobal('setLargeGraphMode', 'ecosystem_focus')),
            command('large-neighborhood', 'Neighborhood Isolation', 'Navigate', () => callGlobal('setLargeGraphMode', 'neighborhood')),
            command('large-hubs', 'Strategic Hub Mode', 'Navigate', () => callGlobal('setLargeGraphMode', 'strategic_hubs')),
            command('large-production', 'Production-Only Graph', 'Navigate', () => callGlobal('setLargeGraphMode', 'production_only')),
            command('large-preview', 'Preview-Only Graph', 'Navigate', () => callGlobal('setLargeGraphMode', 'preview_only')),
            command('center-selected-node', 'Center Selected Node', 'Navigate', () => callGlobal('centerSelectedNode'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('fit-selected-neighborhood', 'Fit Selected Neighborhood', 'Navigate', () => callGlobal('fitSelectedNeighborhood'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('jump-selected-node', 'Jump To Selected Node', 'Navigate', () => callGlobal('jumpToSelectedGraphNode'), { disabledReason: () => stockDisabledReason('selected-node') }),
            command('graph-workbench', 'Open Graph Intelligence', 'Navigate', () => callGlobal('setAppView', 'graph')),
            command('source-workbench', 'Open Source Workbench', 'Navigate', () => callGlobal('setAppView', 'source')),
            command('stock-product', 'Switch To StockPhotonic', 'Navigate', () => callGlobal('setProductView', 'stock')),
            command('crypto-product', 'Switch To CryptoPhotonic', 'Navigate', () => callGlobal('setProductView', 'crypto')),
            command('crypto-fullscreen', 'Toggle Crypto Fullscreen', 'Navigate', () => window.CryptoPhotonic?.ui?.setFullscreen?.(!window.CryptoPhotonic?.ui?.getState?.().fullscreen)),

            command('topology-summary', 'Show Topology Summary', 'Topology', () => callGlobal('showTopologySummary')),
            command('topology-centrality', 'Jump Market-Central Hub', 'Topology', () => callGlobal('jumpToMarketCentralHub'), { disabledReason: () => stockReadyReason() }),
            command('topology-corridor-pressure', 'Jump Pressure Corridor', 'Topology', () => callGlobal('jumpToPressureCorridor'), { disabledReason: () => stockReadyReason() }),
            command('preset-topology', 'Preset: Topology Mode', 'Topology', () => callGlobal('applyGraphAnalystPreset', 'topology'), { disabledReason: () => stockReadyReason() }),

            command('workspace-new', 'New Session Workspace', 'Workspace', () => callGlobal('createAnalystWorkspace')),
            command('workspace-next', 'Next Session Workspace', 'Workspace', () => callGlobal('cycleAnalystWorkspace', 1)),
            command('workspace-prev', 'Previous Session Workspace', 'Workspace', () => callGlobal('cycleAnalystWorkspace', -1)),
            command('pin-current-route', 'Pin Current Route', 'Workspace', () => callGlobal('pinCurrentRoute'), { disabledReason: () => stockDisabledReason('route-step') }),
            command('pin-current-corridor', 'Pin Current Corridor', 'Workspace', () => callGlobal('pinCurrentCorridor')),
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
            command('center-ecosystem', 'Center Active Ecosystem', 'Overlay', () => callGlobal('centerActiveEcosystem')),
            command('focus-bridges', 'Focus Bridge Companies', 'Overlay', () => callGlobal('focusBridgeCompanies')),

            command('stock-replay-neighborhood', 'Open Stock Replay Neighborhood', 'Replay / Timeline', () => callGlobal('openStockReplayNeighborhood')),
            command('preset-replay-investigation', 'Preset: Replay Investigation', 'Replay / Timeline', () => callGlobal('applyGraphAnalystPreset', 'replay_investigation')),
            command('stock-chronology-next', 'Next Graph Chronology Event', 'Replay / Timeline', () => callGlobal('stepGraphChronology', 1)),
            command('stock-chronology-prev', 'Previous Graph Chronology Event', 'Replay / Timeline', () => callGlobal('stepGraphChronology', -1)),
            command('stock-replay-checkpoint', 'Save Stock Replay Checkpoint', 'Replay / Timeline', () => callGlobal('addStockReplayCheckpoint')),
            command('crypto-replay', 'Toggle Crypto Replay Workspace', 'Replay / Timeline', () => window.CryptoPhotonic?.ui?.toggleReplayWorkspaceMode?.()),
            command('crypto-replay-neighborhood', 'Open Crypto Replay Neighborhood', 'Replay / Timeline', () => window.CryptoPhotonic?.ui?.openReplayNeighborhood?.()),
            command('crypto-replay-next-event', 'Next Crypto Replay Event', 'Replay / Timeline', () => window.CryptoPhotonic?.ui?.nextReplayEvent?.(), { disabledReason: () => cryptoReplayDisabledReason() }),
            command('crypto-replay-previous-event', 'Previous Crypto Replay Event', 'Replay / Timeline', () => window.CryptoPhotonic?.ui?.previousReplayEvent?.(), { disabledReason: () => cryptoReplayDisabledReason() }),
            command('crypto-center-replay', 'Center Active Crypto Replay Transfer', 'Replay / Timeline', () => window.CryptoPhotonic?.ui?.centerCurrentReplayTransfer?.(), { disabledReason: () => cryptoReplayDisabledReason() }),

            command('snapshot-current', 'Capture Graph Snapshot', 'Snapshot / Investigation', () => callGlobal('captureCurrentGraphSnapshot')),
            command('stage-current', 'Stage Current Investigation', 'Snapshot / Investigation', () => callGlobal('queueCurrentInvestigation')),
            command('source-gap-filter', 'Show Evidence Gap Filter', 'Snapshot / Investigation', () => callGlobal('showEvidenceGapFilter')),
            command('clear-selected-relationship', 'Clear Selected Relationship', 'Snapshot / Investigation', () => callGlobal('clearSelectedRelationship')),
            command('clear-route-trace', 'Clear Route Trace', 'Snapshot / Investigation', () => callGlobal('clearRelationshipRoute')),
            command('crypto-labels', 'Cycle Crypto Labels', 'Snapshot / Investigation', () => window.CryptoPhotonic?.ui?.cycleLabelDensity?.()),
            command('crypto-center', 'Center Tracked Wallet', 'Snapshot / Investigation', () => window.CryptoPhotonic?.ui?.centerTrackedWallet?.())
        ].filter(item => GROUPS.includes(item.group));
    }

    function command(id, label, group, action, options = {}) {
        return {
            id,
            label,
            group,
            action,
            keywords: options.keywords || '',
            disabledReason: options.disabledReason || ''
        };
    }

    function getFilteredCommands() {
        const query = normalize(state.query);
        const commands = getCommands();
        if (!query) return commands;
        return commands.filter(item => normalize(`${item.label} ${item.group} ${item.keywords}`).includes(query));
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
        results.innerHTML = GROUPS.map(group => {
            const groupCommands = commands.filter(item => item.group === group);
            if (!groupCommands.length) return '';
            return `
                <div class="photonic-command-section-label">${escapeHtml(group)}</div>
                ${groupCommands.map(item => renderRow(item, commands.indexOf(item))).join('')}
            `;
        }).join('');
    }

    function renderRow(item, index) {
        const disabled = getCommandDisabledReason(item);
        return `
            <button type="button"
                class="photonic-command-row ${index === state.index ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}"
                data-command-id="${escapeHtml(item.id)}"
                ${disabled ? 'aria-disabled="true"' : ''}>
                <span>${escapeHtml(item.label)}</span>
                <small>${escapeHtml(disabled || item.group)}</small>
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

    function cryptoReplayDisabledReason() {
        const cryptoState = window.CryptoPhotonic?.ui?.getState?.();
        return cryptoState?.historyPreview?.workspaceMode
            ? ''
            : 'Open Crypto replay workspace first.';
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
            hint.textContent = 'Graph-native commands grouped by navigation, topology, workspace, routes, overlays, replay, and investigation.';
        }
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
