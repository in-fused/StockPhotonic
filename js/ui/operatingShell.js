(function () {
    window.StockPhotonicUI = window.StockPhotonicUI || {};

    const STOCK_MODES = ['explore', 'analyst', 'review', 'replay'];
    const CRYPTO_MODES = ['flow', 'analyst', 'review', 'replay'];
    const CONTROL_LAYERS = ['primary', 'secondary', 'advanced'];
    const TIER_RANK = { primary: 0, secondary: 1, advanced: 2 };

    const state = {
        initialized: false,
        stockMode: 'explore',
        cryptoMode: 'flow',
        controlLayer: 'primary',
        controlDrawerOpen: false,
        stockInspectorPinned: false,
        stockInspectorSuppressed: false,
        cryptoInspectorPinned: false,
        cryptoInspectorSuppressed: false,
        paletteOpen: false,
        paletteIndex: 0,
        paletteQuery: ''
    };

    const stockControlRules = {
        'search-input': { tier: 'primary', modes: ['explore', 'analyst', 'review', 'replay'] },
        'layout-mode': { tier: 'primary', modes: ['explore', 'analyst', 'replay'] },
        'large-graph-mode': { tier: 'primary', modes: ['explore', 'analyst', 'replay'] },
        'large-graph-neighborhood-depth': { tier: 'primary', modes: ['explore', 'analyst', 'replay'] },
        'sector-filter': { tier: 'secondary', modes: ['explore', 'analyst', 'review'] },
        'industry-group-filter': { tier: 'secondary', modes: ['explore', 'analyst', 'review'] },
        'relationship-type-filter': { tier: 'secondary', modes: ['analyst', 'review', 'replay'] },
        'large-graph-ecosystem': { tier: 'secondary', modes: ['explore', 'analyst', 'replay'] },
        'large-graph-corridor': { tier: 'secondary', modes: ['explore', 'analyst', 'replay'] },
        'confidence-tier-filter': { tier: 'advanced', modes: ['analyst', 'review'] },
        'evidence-tier-filter': { tier: 'advanced', modes: ['analyst', 'review'] },
        'source-host-filter': { tier: 'advanced', modes: ['review'] },
        'perspective-reset': { tier: 'secondary', modes: ['explore', 'analyst', 'replay'] },
        'orb-spread-clusters': { tier: 'secondary', modes: ['explore', 'analyst', 'replay'] },
        'orb-reset-layout': { tier: 'advanced', modes: ['analyst', 'replay'] },
        'sourced-only-toggle': { tier: 'secondary', modes: ['analyst', 'review'] },
        'sec-backed-only-toggle': { tier: 'secondary', modes: ['analyst', 'review'] },
        'stale-review-toggle': { tier: 'advanced', modes: ['review'] },
        'missing-evidence-toggle': { tier: 'advanced', modes: ['review'] },
        'portfolio-connected-only-toggle': { tier: 'secondary', modes: ['analyst'] },
        'cross-sector-only-toggle': { tier: 'advanced', modes: ['analyst'] },
        'sec-preview-toggle': { tier: 'secondary', modes: ['review', 'analyst'] },
        'candidate-company-toggle': { tier: 'secondary', modes: ['review', 'analyst'] },
        'candidate-company-only-toggle': { tier: 'advanced', modes: ['review'] },
        'candidate-company-hub-toggle': { tier: 'advanced', modes: ['review'] },
        'candidate-density-mode': { tier: 'advanced', modes: ['review'] },
        'candidate-ecosystem-focus': { tier: 'advanced', modes: ['review'] },
        'candidate-corridor-focus': { tier: 'advanced', modes: ['review'] },
        'graph-hud-toggle': { tier: 'primary', modes: ['explore', 'analyst', 'review', 'replay'] },
        'signal-threshold': { tier: 'advanced', modes: ['analyst', 'replay'] },
        'portfolio-input': { tier: 'advanced', modes: ['analyst'] }
    };

    function initialize() {
        if (state.initialized) return;
        state.initialized = true;
        document.body.dataset.stockUxMode = state.stockMode;
        document.body.dataset.cryptoUxMode = state.cryptoMode;
        document.body.dataset.controlLayer = state.controlLayer;
        document.body.classList.add('graph-first-os');

        classifyStockControls();
        wireModeButtons();
        wireControlDrawer();
        wireCommandPalette();
        wireInspectorObservers();
        enhanceSourceWorkbench();
        setStockUxMode(state.stockMode, { silent: true });
        setCryptoUxMode(state.cryptoMode, { silent: true });
        setControlLayer(state.controlLayer);
        syncStockInspector();
        syncCryptoInspector();
    }

    function classifyStockControls() {
        Object.entries(stockControlRules).forEach(([id, rule]) => {
            const element = document.getElementById(id);
            const host = getControlHost(element);
            if (!host) return;
            host.classList.add('graph-control-item');
            host.dataset.uxTier = rule.tier;
            host.dataset.uxModes = rule.modes.join(' ');
        });
    }

    function getControlHost(element) {
        if (!element) return null;
        if (element.id === 'search-input') return element.closest('.relative') || element;
        if (element.id === 'signal-threshold' || element.id === 'portfolio-input') {
            return element.closest('.signal-control') || element;
        }
        return element;
    }

    function wireModeButtons() {
        document.addEventListener('click', event => {
            const stockButton = event.target.closest('button[data-stock-ux-mode]');
            if (stockButton) {
                setStockUxMode(stockButton.dataset.stockUxMode);
                return;
            }
            const cryptoButton = event.target.closest('button[data-crypto-ux-mode]');
            if (cryptoButton) {
                setCryptoUxMode(cryptoButton.dataset.cryptoUxMode);
            }
        });
    }

    function setStockUxMode(mode, options = {}) {
        const nextMode = STOCK_MODES.includes(mode) ? mode : 'explore';
        state.stockMode = nextMode;
        document.body.dataset.stockUxMode = nextMode;
        updatePressed('button[data-stock-ux-mode]', 'stockUxMode', nextMode);
        if (nextMode === 'review') setControlLayer('advanced');
        else if (nextMode === 'analyst') setControlLayer(state.controlLayer === 'primary' ? 'secondary' : state.controlLayer);
        else if (!options.silent) setControlLayer('primary');
        refreshControlVisibility();
        updateModeHud();
    }

    function setCryptoUxMode(mode) {
        const nextMode = CRYPTO_MODES.includes(mode) ? mode : 'flow';
        state.cryptoMode = nextMode;
        document.body.dataset.cryptoUxMode = nextMode;
        updatePressed('button[data-crypto-ux-mode]', 'cryptoUxMode', nextMode);
        updateModeHud();
    }

    function updatePressed(selector, dataKey, activeValue) {
        document.querySelectorAll(selector).forEach(button => {
            const active = button.dataset[dataKey] === activeValue;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function setControlLayer(layer) {
        state.controlLayer = CONTROL_LAYERS.includes(layer) ? layer : 'primary';
        document.body.dataset.controlLayer = state.controlLayer;
        updatePressed('button[data-control-layer]', 'controlLayer', state.controlLayer);
        refreshControlVisibility();
    }

    function refreshControlVisibility() {
        document.querySelectorAll('.graph-control-item').forEach(host => {
            const tier = host.dataset.uxTier || 'advanced';
            const modes = String(host.dataset.uxModes || '').split(/\s+/).filter(Boolean);
            const tierAllowed = (TIER_RANK[tier] ?? 2) <= (TIER_RANK[state.controlLayer] ?? 0);
            const modeAllowed = !modes.length || modes.includes(state.stockMode);
            host.classList.toggle('is-operating-hidden', !(tierAllowed && modeAllowed));
        });
    }

    function wireControlDrawer() {
        document.addEventListener('click', event => {
            const layerButton = event.target.closest('button[data-control-layer]');
            if (layerButton) setControlLayer(layerButton.dataset.controlLayer);
        });
    }

    function setGraphControlDrawer(open) {
        state.controlDrawerOpen = Boolean(open);
        const drawer = document.getElementById('graph-control-drawer');
        const view = document.getElementById('graph-intelligence-view');
        drawer?.classList.toggle('is-open', state.controlDrawerOpen);
        drawer?.classList.toggle('is-collapsed', !state.controlDrawerOpen);
        view?.classList.toggle('is-control-drawer-open', state.controlDrawerOpen);
        document.querySelectorAll('[data-toggle-graph-controls]').forEach(button => {
            button.setAttribute('aria-pressed', state.controlDrawerOpen ? 'true' : 'false');
            button.classList.toggle('is-active', state.controlDrawerOpen);
        });
        if (state.controlDrawerOpen) refreshControlVisibility();
    }

    function toggleGraphControlDrawer(force) {
        setGraphControlDrawer(typeof force === 'boolean' ? force : !state.controlDrawerOpen);
    }

    function wireCommandPalette() {
        const palette = document.getElementById('photonic-command-palette');
        const input = document.getElementById('photonic-command-input');
        const results = document.getElementById('photonic-command-results');
        if (!palette || !input || !results) return;

        document.addEventListener('keydown', event => {
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 'k') {
                event.preventDefault();
                openCommandPalette();
                return;
            }
            if (event.key === 'Escape' && state.paletteOpen) {
                event.preventDefault();
                closeCommandPalette();
            }
        });

        palette.addEventListener('click', event => {
            if (event.target === palette) closeCommandPalette();
            const row = event.target.closest('[data-command-id]');
            if (row) runCommand(row.dataset.commandId);
        });

        input.addEventListener('input', () => {
            state.paletteQuery = input.value;
            state.paletteIndex = 0;
            renderCommandPalette();
        });

        input.addEventListener('keydown', event => {
            const commands = getFilteredCommands();
            if (event.key === 'ArrowDown') {
                state.paletteIndex = commands.length ? (state.paletteIndex + 1) % commands.length : 0;
                renderCommandPalette();
                event.preventDefault();
            } else if (event.key === 'ArrowUp') {
                state.paletteIndex = commands.length ? (state.paletteIndex - 1 + commands.length) % commands.length : 0;
                renderCommandPalette();
                event.preventDefault();
            } else if (event.key === 'Enter') {
                const command = commands[state.paletteIndex] || commands[0];
                if (command) runCommand(command.id);
                event.preventDefault();
            }
        });
    }

    function openCommandPalette() {
        const palette = document.getElementById('photonic-command-palette');
        const input = document.getElementById('photonic-command-input');
        if (!palette || !input) return;
        state.paletteOpen = true;
        state.paletteIndex = 0;
        state.paletteQuery = '';
        input.value = '';
        palette.classList.add('is-open');
        palette.setAttribute('aria-hidden', 'false');
        renderCommandPalette();
        window.setTimeout(() => input.focus(), 0);
    }

    function closeCommandPalette() {
        const palette = document.getElementById('photonic-command-palette');
        if (!palette) return;
        state.paletteOpen = false;
        palette.classList.remove('is-open');
        palette.setAttribute('aria-hidden', 'true');
    }

    function getCommands() {
        return [
            command('fit-graph', 'Fit graph', 'View', () => callGlobal('fitGraph')),
            command('reset-graph', 'Reset graph workspace', 'View', () => callGlobal('resetAll')),
            command('fullscreen-stock', 'Toggle Stock fullscreen', 'View', () => callGlobal('toggleGraphFullscreen')),
            command('focus-mode', 'Toggle Focus Mode', 'Graph', () => callGlobal('toggleFocusMode')),
            command('perspective-mode', 'Toggle Perspective Mode', 'Graph', () => callGlobal('togglePerspectiveMode')),
            command('orb-map', 'Toggle Orb Map', 'Graph', () => callGlobal('toggleOrbMap')),
            command('controls', 'Open graph controls', 'Controls', () => toggleGraphControlDrawer(true)),
            command('primary-controls', 'Primary controls', 'Controls', () => setControlLayer('primary')),
            command('secondary-controls', 'Secondary controls', 'Controls', () => setControlLayer('secondary')),
            command('advanced-controls', 'Advanced controls', 'Controls', () => setControlLayer('advanced')),
            command('mode-explore', 'Explore Mode', 'Mode', () => setStockUxMode('explore')),
            command('mode-analyst', 'Analyst Mode', 'Mode', () => setStockUxMode('analyst')),
            command('mode-review', 'Review Mode', 'Mode', () => setStockUxMode('review')),
            command('mode-replay', 'Replay Mode', 'Mode', () => setStockUxMode('replay')),
            command('large-overview', 'Large graph overview', 'Navigation', () => callGlobal('setLargeGraphMode', 'overview')),
            command('large-ecosystem', 'Ecosystem focus', 'Navigation', () => callGlobal('setLargeGraphMode', 'ecosystem_focus')),
            command('large-corridor', 'Corridor focus', 'Navigation', () => callGlobal('setLargeGraphMode', 'corridor_focus')),
            command('large-neighborhood', 'Neighborhood isolation', 'Navigation', () => callGlobal('setLargeGraphMode', 'neighborhood')),
            command('large-hubs', 'Strategic hub mode', 'Navigation', () => callGlobal('setLargeGraphMode', 'strategic_hubs')),
            command('large-route', 'Route isolation', 'Navigation', () => callGlobal('setLargeGraphMode', 'route_isolation')),
            command('large-production', 'Production-only graph', 'Navigation', () => callGlobal('setLargeGraphMode', 'production_only')),
            command('large-preview', 'Preview-only graph', 'Navigation', () => callGlobal('setLargeGraphMode', 'preview_only')),
            command('jump-hub', 'Jump to strategic hub', 'Navigation', () => callGlobal('jumpToStrategicHub')),
            command('isolate-corridor', 'Isolate dominant corridor', 'Navigation', () => callGlobal('isolateDominantCorridor')),
            command('inspect-strongest-route', 'Inspect strongest route', 'Navigation', () => callGlobal('traceRelationshipRoute', 'strongest')),
            command('center-ecosystem', 'Center ecosystem', 'Navigation', () => callGlobal('centerActiveEcosystem')),
            command('stock-replay-neighborhood', 'Open replay neighborhood', 'Navigation', () => callGlobal('openStockReplayNeighborhood')),
            command('focus-bridges', 'Focus bridge companies', 'Navigation', () => callGlobal('focusBridgeCompanies')),
            command('compare-routes', 'Compare route paths', 'Navigation', () => callGlobal('compareRoutePaths')),
            command('jump-selected-node', 'Jump to selected node', 'Navigation', () => callGlobal('jumpToSelectedGraphNode')),
            command('source-lens', 'Toggle source coverage lens', 'Evidence', () => callGlobal('toggleSourceCoverageLens')),
            command('sec-preview', 'Toggle SEC preview', 'Evidence', () => callGlobal('toggleSecPreviewRelationships')),
            command('candidate-preview', 'Toggle candidate companies', 'Review', () => callGlobal('toggleCandidateCompanyPreview')),
            command('source-workbench', 'Open Source Workbench', 'Review', () => callGlobal('setAppView', 'source')),
            command('graph-workbench', 'Open Graph Intelligence', 'View', () => callGlobal('setAppView', 'graph')),
            command('stock-product', 'Switch to StockPhotonic', 'Product', () => callGlobal('setProductView', 'stock')),
            command('crypto-product', 'Switch to CryptoPhotonic', 'Product', () => callGlobal('setProductView', 'crypto')),
            command('crypto-fullscreen', 'Toggle Crypto fullscreen', 'Crypto', () => window.CryptoPhotonic?.ui?.setFullscreen?.(!window.CryptoPhotonic?.ui?.getState?.().fullscreen)),
            command('crypto-labels', 'Cycle Crypto labels', 'Crypto', () => window.CryptoPhotonic?.ui?.cycleLabelDensity?.()),
            command('crypto-center', 'Center tracked wallet', 'Crypto', () => window.CryptoPhotonic?.ui?.centerTrackedWallet?.()),
            command('crypto-replay', 'Toggle Crypto replay workspace', 'Crypto', () => window.CryptoPhotonic?.ui?.toggleReplayWorkspaceMode?.()),
            command('crypto-replay-neighborhood', 'Open Crypto replay neighborhood', 'Crypto', () => window.CryptoPhotonic?.ui?.openReplayNeighborhood?.()),
            command('crypto-center-replay', 'Center current replay transfer', 'Crypto', () => window.CryptoPhotonic?.ui?.centerCurrentReplayTransfer?.())
        ];
    }

    function command(id, label, group, action) {
        return { id, label, group, action };
    }

    function getFilteredCommands() {
        const query = normalize(state.paletteQuery);
        const commands = getCommands();
        if (!query) return commands;
        return commands.filter(item => normalize(`${item.label} ${item.group}`).includes(query));
    }

    function renderCommandPalette() {
        const results = document.getElementById('photonic-command-results');
        if (!results) return;
        const commands = getFilteredCommands();
        results.innerHTML = commands.length
            ? commands.map((item, index) => `
                <button type="button" class="photonic-command-row ${index === state.paletteIndex ? 'is-active' : ''}" data-command-id="${escapeHtml(item.id)}">
                    <span>${escapeHtml(item.label)}</span>
                    <small>${escapeHtml(item.group)}</small>
                </button>
            `).join('')
            : '<div class="photonic-command-empty">No matching actions</div>';
    }

    function runCommand(id) {
        const item = getCommands().find(commandItem => commandItem.id === id);
        if (!item) return;
        closeCommandPalette();
        item.action();
    }

    function wireInspectorObservers() {
        const stockSidebar = document.getElementById('sidebar');
        const stockEmpty = document.getElementById('empty-sidebar');
        const cryptoDetail = document.getElementById('crypto-detail-panel');
        const observerConfig = { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] };

        if (stockSidebar || stockEmpty) {
            const observer = new MutationObserver(() => {
                if (stockSidebar && !stockSidebar.classList.contains('hidden')) state.stockInspectorSuppressed = false;
                syncStockInspector();
            });
            if (stockSidebar) observer.observe(stockSidebar, observerConfig);
            if (stockEmpty) observer.observe(stockEmpty, observerConfig);
        }

        if (cryptoDetail) {
            const observer = new MutationObserver(() => {
                if (hasCryptoDetailContent()) state.cryptoInspectorSuppressed = false;
                syncCryptoInspector();
            });
            observer.observe(cryptoDetail, observerConfig);
        }
    }

    function toggleStockInspector(force) {
        const view = document.getElementById('graph-intelligence-view');
        const active = view?.classList.contains('is-inspector-open');
        const next = typeof force === 'boolean' ? force : !active;
        state.stockInspectorPinned = next;
        state.stockInspectorSuppressed = !next;
        syncStockInspector();
    }

    function syncStockInspector() {
        const view = document.getElementById('graph-intelligence-view');
        const sidebar = document.getElementById('sidebar');
        const empty = document.getElementById('empty-sidebar');
        if (!view) return;
        const hasSelection = Boolean(sidebar && !sidebar.classList.contains('hidden'));
        const hasDefault = Boolean(empty && !empty.classList.contains('hidden'));
        const open = !state.stockInspectorSuppressed && (hasSelection || (state.stockInspectorPinned && hasDefault));
        view.classList.toggle('is-inspector-open', open);
        view.classList.toggle('is-inspector-selection', hasSelection && open);
        view.classList.toggle('is-inspector-default', !hasSelection && hasDefault && open);
        view.classList.toggle('is-inspector-dormant', !open);
        document.querySelectorAll('[data-toggle-stock-inspector]').forEach(button => {
            button.setAttribute('aria-pressed', open ? 'true' : 'false');
            button.classList.toggle('is-active', open);
        });
    }

    function toggleCryptoInspector(force) {
        const root = document.getElementById('crypto-photonic-view');
        const active = root?.classList.contains('is-crypto-inspector-open');
        const next = typeof force === 'boolean' ? force : !active;
        state.cryptoInspectorPinned = next;
        state.cryptoInspectorSuppressed = !next;
        syncCryptoInspector();
    }

    function syncCryptoInspector() {
        const root = document.getElementById('crypto-photonic-view');
        if (!root) return;
        const hasDetail = hasCryptoDetailContent();
        const open = !state.cryptoInspectorSuppressed && (hasDetail || state.cryptoInspectorPinned);
        root.classList.toggle('is-crypto-inspector-open', open);
        root.classList.toggle('is-crypto-inspector-dormant', !open);
        document.querySelectorAll('[data-toggle-crypto-inspector]').forEach(button => {
            button.setAttribute('aria-pressed', open ? 'true' : 'false');
            button.classList.toggle('is-active', open);
        });
    }

    function hasCryptoDetailContent() {
        const detail = document.getElementById('crypto-detail-panel');
        if (!detail) return false;
        const text = normalize(detail.textContent);
        return Boolean(text && !text.includes('crypto graph inactive'));
    }

    function enhanceSourceWorkbench() {
        const panels = [...document.querySelectorAll('#source-intelligence-workbench .source-workbench-panel')];
        panels.forEach((panel, index) => {
            if (panel.dataset.collapsibleReady === 'true') return;
            const label = panel.querySelector('.source-workbench-label')?.textContent?.trim() || `Workbench ${index + 1}`;
            const body = document.createElement('div');
            body.className = 'source-workbench-panel-body';
            [...panel.childNodes].forEach(child => body.appendChild(child));

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'source-workbench-toggle';
            button.setAttribute('aria-expanded', 'true');
            button.innerHTML = `<span>${escapeHtml(label)}</span><i class="fa-solid fa-chevron-up" aria-hidden="true"></i>`;
            button.addEventListener('click', () => {
                const collapsed = panel.classList.toggle('is-collapsed');
                button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                const icon = button.querySelector('i');
                icon?.classList.toggle('fa-chevron-up', !collapsed);
                icon?.classList.toggle('fa-chevron-down', collapsed);
            });

            panel.appendChild(button);
            panel.appendChild(body);
            panel.dataset.collapsibleReady = 'true';
            const keepOpen = index < 2 || panel.classList.contains('source-live-refresh-section') || panel.classList.contains('primary-workflow-panel');
            if (!keepOpen) button.click();
        });
    }

    function updateModeHud() {
        const stockHud = document.getElementById('graph-mode-hud');
        if (stockHud) stockHud.textContent = `${titleCase(state.stockMode)} Mode`;
        const cryptoHud = document.getElementById('crypto-mode-hud');
        if (cryptoHud) cryptoHud.textContent = `${titleCase(state.cryptoMode)} Mode`;
    }

    function callGlobal(name, ...args) {
        const fn = window[name];
        if (typeof fn === 'function') fn(...args);
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function titleCase(value) {
        return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    window.openPhotonicCommandPalette = openCommandPalette;
    window.closePhotonicCommandPalette = closeCommandPalette;
    window.toggleGraphControlDrawer = toggleGraphControlDrawer;
    window.setGraphControlDrawer = setGraphControlDrawer;
    window.setStockUxMode = setStockUxMode;
    window.setCryptoUxMode = setCryptoUxMode;
    window.setPhotonicControlLayer = setControlLayer;
    window.toggleStockInspector = toggleStockInspector;
    window.toggleCryptoInspector = toggleCryptoInspector;

    window.StockPhotonicUI.operatingShell = {
        initialize,
        setStockUxMode,
        setCryptoUxMode,
        setControlLayer,
        toggleGraphControlDrawer,
        setGraphControlDrawer,
        openCommandPalette,
        closeCommandPalette,
        syncStockInspector,
        syncCryptoInspector
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
