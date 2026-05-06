(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;

    if (!core || !graphEngine || !layoutEngine) {
        throw new Error('CryptoPhotonic core, graph, and layout modules must load before UI module');
    }

    const state = {
        initialized: false,
        active: false,
        graph: null,
        selectedId: null,
        canvas: null,
        ctx: null,
        root: null,
        detailPanel: null,
        resizeObserver: null
    };

    async function initialize(options = {}) {
        if (state.initialized) return state.graph;

        state.root = document.getElementById(options.rootId || 'crypto-photonic-view');
        state.canvas = document.getElementById(options.canvasId || 'crypto-flow-canvas');
        state.detailPanel = document.getElementById(options.detailPanelId || 'crypto-detail-panel');
        if (!state.root || !state.canvas || !state.detailPanel) return null;

        state.ctx = state.canvas.getContext('2d');
        state.canvas.addEventListener('click', handleCanvasClick);
        window.addEventListener('resize', resizeAndRender);

        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(resizeAndRender);
            state.resizeObserver.observe(state.canvas.parentElement || state.canvas);
        }

        const dataset = await loadSampleDataset();
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.selectedId = state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;
        state.initialized = true;

        updateStats();
        resizeAndRender();
        renderDetails();
        return state.graph;
    }

    function setActive(active) {
        state.active = Boolean(active);
        if (!state.active || !state.initialized) return;
        resizeAndRender();
        renderDetails();
    }

    async function loadSampleDataset() {
        try {
            const response = await fetch(`data/crypto/sample-flow.json?v=${Date.now()}`);
            if (!response.ok) throw new Error('Crypto sample file unavailable');
            const payload = await response.json();
            return payload;
        } catch (error) {
            console.warn('CryptoPhotonic sample data fell back to built-in dev sample', error);
            return core.getSampleDataset();
        }
    }

    function resizeAndRender() {
        if (!state.canvas || !state.ctx || !state.graph) return;

        const size = getCanvasSize();
        const ratio = window.devicePixelRatio || 1;
        state.canvas.width = Math.floor(size.width * ratio);
        state.canvas.height = Math.floor(size.height * ratio);
        state.canvas.style.width = `${size.width}px`;
        state.canvas.style.height = `${size.height}px`;
        state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        state.graph = layoutEngine.layoutGraph(state.graph, size);
        render();
    }

    function getCanvasSize() {
        const parent = state.canvas?.parentElement;
        return {
            width: Math.max(320, Math.floor(parent?.clientWidth || state.canvas?.clientWidth || 900)),
            height: Math.max(420, Math.floor(parent?.clientHeight || state.canvas?.clientHeight || 560))
        };
    }

    function render() {
        if (!state.ctx || !state.graph) return;

        const { width, height } = state.graph.bounds;
        const ctx = state.ctx;
        ctx.clearRect(0, 0, width, height);
        drawBackdrop(ctx, width, height);

        const nodeById = state.graph.nodeById;
        state.graph.edges
            .filter(edge => edge.type !== core.EDGE_TYPES.LABEL)
            .sort((a, b) => (a.type === core.EDGE_TYPES.EXPOSURE) - (b.type === core.EDGE_TYPES.EXPOSURE) || (a.width || 0) - (b.width || 0))
            .forEach(edge => drawEdge(ctx, edge, nodeById));

        state.graph.edges
            .filter(edge => edge.type === core.EDGE_TYPES.LABEL)
            .forEach(edge => drawEdge(ctx, edge, nodeById));

        state.graph.nodes
            .slice()
            .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
            .forEach(node => drawNode(ctx, node));
    }

    function drawBackdrop(ctx, width, height) {
        const gradient = ctx.createRadialGradient(width * 0.48, height * 0.45, 40, width * 0.48, height * 0.45, Math.max(width, height) * 0.66);
        gradient.addColorStop(0, 'rgba(34, 211, 238, 0.12)');
        gradient.addColorStop(0.52, 'rgba(168, 85, 247, 0.06)');
        gradient.addColorStop(1, 'rgba(2, 6, 23, 0.14)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 1;
        for (let x = 24; x < width; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 24; y < height; y += 48) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    function drawEdge(ctx, edge, nodeById) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        const bend = edge.type === core.EDGE_TYPES.FLOW ? 24 : edge.type === core.EDGE_TYPES.EXPOSURE ? -18 : 0;
        const control = {
            x: (source.x + target.x) / 2 + normal.x * bend,
            y: (source.y + target.y) / 2 + normal.y * bend
        };

        ctx.save();
        ctx.globalAlpha = edge.opacity || 0.7;
        ctx.strokeStyle = edge.color || '#22d3ee';
        ctx.lineWidth = edge.width || 1.4;
        ctx.setLineDash(edge.type === core.EDGE_TYPES.LABEL ? [4, 6] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) {
            drawArrow(ctx, control, target, edge.color || '#22d3ee');
        }
        ctx.restore();
    }

    function drawArrow(ctx, from, to, color) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const size = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(to.x - Math.cos(angle) * 18, to.y - Math.sin(angle) * 18);
        ctx.lineTo(to.x - Math.cos(angle - 0.46) * (18 + size), to.y - Math.sin(angle - 0.46) * (18 + size));
        ctx.lineTo(to.x - Math.cos(angle + 0.46) * (18 + size), to.y - Math.sin(angle + 0.46) * (18 + size));
        ctx.closePath();
        ctx.fill();
    }

    function drawNode(ctx, node) {
        const selected = state.selectedId === node.id;
        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = selected ? 24 : 12;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = selected ? '#ffffff' : node.color;
        ctx.lineWidth = selected ? 2.6 : 1.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(3, node.radius * 0.28), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = selected ? '#ffffff' : 'rgba(226, 232, 240, 0.82)';
        ctx.font = node.type === core.NODE_TYPES.TOKEN ? '600 11px Inter, sans-serif' : '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(labelForNode(node), node.x, node.y + node.radius + 8);
        ctx.restore();
    }

    function handleCanvasClick(event) {
        if (!state.graph || !state.canvas) return;
        const rect = state.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const selected = state.graph.nodes
            .slice()
            .sort((a, b) => (a.radius || 0) - (b.radius || 0))
            .find(node => Math.hypot(node.x - x, node.y - y) <= (node.radius || 18) + 8);

        if (!selected) return;
        state.selectedId = selected.id;
        render();
        renderDetails();
    }

    function renderDetails() {
        if (!state.detailPanel || !state.graph) return;
        const node = state.graph.nodeById.get(state.selectedId) || state.graph.nodes[0];
        if (!node) {
            state.detailPanel.innerHTML = '<div class="text-sm text-white/45">No crypto graph node selected.</div>';
            return;
        }

        const relatedEdges = state.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
        state.detailPanel.innerHTML = `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">${escapeHtml(node.type).toUpperCase()}</div>
            <h3 class="font-display text-2xl mt-1">${escapeHtml(labelForNode(node))}</h3>
            <div class="mt-4 grid gap-2 text-xs text-white/68">
                ${detailRow('Chain', node.chain || '-')}
                ${node.address ? detailRow('Address', node.address) : ''}
                ${node.token_mint ? detailRow('Token Mint', node.token_mint) : ''}
                ${detailRow('Label Source', node.label_source || '-')}
                ${detailRow('Confidence', `${Math.round((node.confidence || 0) * 100)}%`)}
                ${detailRow('Exposure', core.formatUsd(node.exposure_usd || 0))}
            </div>
            <div class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">RELATED FLOWS</div>
                <div class="space-y-2">
                    ${relatedEdges.slice(0, 6).map(edge => renderEdgeSummary(edge)).join('') || '<div class="text-xs text-white/38">No related sample edges.</div>'}
                </div>
            </div>
        `;
    }

    function renderEdgeSummary(edge) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        const label = edge.type === core.EDGE_TYPES.FLOW
            ? `${labelForNode(source)} -> ${labelForNode(target)}`
            : `${labelForNode(source)} / ${labelForNode(target)}`;
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(edge.type)}</div>
                <div class="text-xs text-white/72 mt-1">${escapeHtml(label)}</div>
                <div class="text-[11px] text-white/42 mt-1">${escapeHtml(edge.symbol || edge.chain || '')} ${edge.usd_value ? core.formatUsd(edge.usd_value) : ''}</div>
            </div>
        `;
    }

    function updateStats() {
        if (!state.graph) return;
        setText('crypto-wallet-count', `${state.graph.walletNodes.length} WALLETS`);
        setText('crypto-token-count', `${state.graph.tokenNodes.length} TOKENS`);
        setText('crypto-flow-count', `${state.graph.flowEdges.length} FLOWS`);
        setText('crypto-path-count', `${state.graph.walletPaths.length} PATHS`);
    }

    function detailRow(label, value) {
        return `
            <div class="crypto-detail-row rounded-xl px-3 py-2">
                <div class="text-[10px] font-mono text-white/40">${escapeHtml(label)}</div>
                <div class="mt-1 break-all">${escapeHtml(String(value))}</div>
            </div>
        `;
    }

    function labelForNode(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return node.symbol || node.name || 'Token';
        if (node.type === core.NODE_TYPES.ENTITY) return node.label || 'Entity';
        return node.label || core.shortAddress(node.address);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    }

    function typeOrder(type) {
        if (type === core.NODE_TYPES.ENTITY) return 0;
        if (type === core.NODE_TYPES.TOKEN) return 2;
        return 1;
    }

    namespace.ui = {
        initialize,
        setActive,
        render,
        getState: () => ({ ...state })
    };
})();
