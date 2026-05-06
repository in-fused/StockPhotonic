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
        hoveredId: null,
        interactionIndex: null,
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
        state.canvas.addEventListener('mousemove', handleCanvasMove);
        state.canvas.addEventListener('mouseleave', handleCanvasLeave);
        window.addEventListener('resize', resizeAndRender);

        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(resizeAndRender);
            state.resizeObserver.observe(state.canvas.parentElement || state.canvas);
        }

        const dataset = await loadSampleDataset();
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        rebuildInteractionIndex();
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
        rebuildInteractionIndex();
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
        const interaction = getInteractionState();
        ctx.clearRect(0, 0, width, height);
        drawBackdrop(ctx, width, height);

        const nodeById = state.graph.nodeById;
        state.graph.edges
            .filter(edge => edge.type !== core.EDGE_TYPES.LABEL)
            .sort((a, b) => (a.type === core.EDGE_TYPES.EXPOSURE) - (b.type === core.EDGE_TYPES.EXPOSURE) || (a.width || 0) - (b.width || 0))
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        state.graph.edges
            .filter(edge => edge.type === core.EDGE_TYPES.LABEL)
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        state.graph.nodes
            .slice()
            .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
            .forEach(node => drawNode(ctx, node, interaction));
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

    function drawEdge(ctx, edge, nodeById, interaction) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const style = getEdgeInteractionStyle(edge, interaction);

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
        ctx.globalAlpha = style.opacity;
        ctx.shadowColor = style.shadowColor;
        ctx.shadowBlur = style.shadowBlur;
        ctx.strokeStyle = edge.color || '#22d3ee';
        ctx.lineWidth = style.width;
        ctx.setLineDash(edge.type === core.EDGE_TYPES.LABEL ? [4, 6] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) {
            drawArrow(ctx, control, target, edge.color || '#22d3ee', style.arrowSize);
        }
        ctx.restore();
    }

    function drawArrow(ctx, from, to, color, size = 8) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(to.x - Math.cos(angle) * 18, to.y - Math.sin(angle) * 18);
        ctx.lineTo(to.x - Math.cos(angle - 0.46) * (18 + size), to.y - Math.sin(angle - 0.46) * (18 + size));
        ctx.lineTo(to.x - Math.cos(angle + 0.46) * (18 + size), to.y - Math.sin(angle + 0.46) * (18 + size));
        ctx.closePath();
        ctx.fill();
    }

    function drawNode(ctx, node, interaction) {
        const selected = state.selectedId === node.id;
        const hovered = state.hoveredId === node.id;
        const connected = interaction.connectedNodeIds.has(node.id);
        const focusVisible = interaction.hasFocus;
        const muted = focusVisible && !connected;
        const radius = node.radius + (selected ? 5 : hovered ? 3 : 0);
        const labelAlpha = !focusVisible || selected || hovered || connected ? (muted ? 0.3 : 0.92) : 0;

        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = selected ? 30 : hovered ? 22 : connected ? 13 : 7;
        ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = selected || hovered ? '#ffffff' : node.color;
        ctx.lineWidth = selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(3, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();

        if (labelAlpha <= 0) {
            ctx.restore();
            return;
        }

        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = selected || hovered ? '#ffffff' : 'rgba(226, 232, 240, 0.82)';
        ctx.font = node.type === core.NODE_TYPES.TOKEN ? '600 11px Inter, sans-serif' : '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(labelForNode(node), node.x, node.y + radius + 8);
        ctx.restore();
    }

    function handleCanvasClick(event) {
        if (!state.graph || !state.canvas) return;
        const selected = getNodeAtEvent(event);

        if (!selected) return;
        state.selectedId = selected.id;
        render();
        renderDetails();
    }

    function handleCanvasMove(event) {
        if (!state.graph || !state.canvas) return;
        const hovered = getNodeAtEvent(event);
        const nextHoveredId = hovered?.id || null;
        state.canvas.style.cursor = hovered ? 'pointer' : 'default';
        if (nextHoveredId === state.hoveredId) return;
        state.hoveredId = nextHoveredId;
        render();
    }

    function handleCanvasLeave() {
        if (!state.canvas) return;
        state.canvas.style.cursor = 'default';
        if (!state.hoveredId) return;
        state.hoveredId = null;
        render();
    }

    function renderDetails() {
        if (!state.detailPanel || !state.graph) return;
        const node = state.graph.nodeById.get(state.selectedId) || state.graph.nodes[0];
        if (!node) {
            state.detailPanel.innerHTML = '<div class="text-sm text-white/45">No crypto graph node selected.</div>';
            return;
        }

        const relatedFlows = getRelatedEdges(node.id, core.EDGE_TYPES.FLOW);
        const relatedExposureEdges = getRelatedEdges(node.id, core.EDGE_TYPES.EXPOSURE);
        const relatedPaths = getRelatedPaths(node.id);
        state.detailPanel.innerHTML = `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">${escapeHtml(node.type).toUpperCase()} NODE</div>
            <h3 class="font-display text-2xl mt-1">${escapeHtml(labelForNode(node))}</h3>
            <div class="text-[11px] text-white/42 mt-2">Sample/dev-only crypto graph. No live chain lookup or production attribution.</div>
            <div class="mt-4 grid gap-2 text-xs text-white/68">
                ${detailRow('Chain', node.chain || '-')}
                ${node.address ? detailRow('Address', node.address) : ''}
                ${node.token_mint ? detailRow('Token Mint', node.token_mint) : ''}
                ${node.name && node.type === core.NODE_TYPES.TOKEN ? detailRow('Token', node.name) : ''}
                ${detailRow('Label Source', node.label_source || '-')}
                ${detailRow('Confidence', `${Math.round((node.confidence || 0) * 100)}%`)}
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total In', core.formatUsd(node.total_in_usd || 0)) : ''}
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total Out', core.formatUsd(node.total_out_usd || 0)) : ''}
                ${detailRow(node.type === core.NODE_TYPES.TOKEN ? 'Token Exposure' : 'Exposure', core.formatUsd(node.exposure_usd || 0))}
            </div>
            <div class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">RELATED TRANSACTION FLOWS</div>
                <div class="space-y-2">
                    ${relatedFlows.slice(0, 6).map(edge => renderEdgeSummary(edge, node.id)).join('') || '<div class="text-xs text-white/38">No related sample flows.</div>'}
                </div>
            </div>
            <div class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">TOKEN EXPOSURE LINKS</div>
                <div class="space-y-2">
                    ${relatedExposureEdges.slice(0, 4).map(edge => renderEdgeSummary(edge, node.id)).join('') || '<div class="text-xs text-white/38">No token exposure links for this sample node.</div>'}
                </div>
            </div>
            <div class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">MULTI-HOP SAMPLE PATHS</div>
                <div class="space-y-2">
                    ${relatedPaths.slice(0, 4).map(renderPathSummary).join('') || '<div class="text-xs text-white/38">No multi-hop wallet paths include this node.</div>'}
                </div>
            </div>
        `;
    }

    function renderEdgeSummary(edge, selectedNodeId) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        const direction = edge.type === core.EDGE_TYPES.FLOW
            ? edge.source === selectedNodeId ? 'OUTFLOW' : edge.target === selectedNodeId ? 'INFLOW' : 'FLOW'
            : 'EXPOSURE';
        const label = edge.type === core.EDGE_TYPES.FLOW
            ? `${labelForNode(source)} -> ${labelForNode(target)}`
            : `${labelForNode(source)} / ${labelForNode(target)}`;
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(direction)}</div>
                <div class="text-xs text-white/72 mt-1">${escapeHtml(label)}</div>
                <div class="text-[11px] text-white/42 mt-1">${escapeHtml(edge.symbol || edge.chain || '')} ${edge.usd_value ? core.formatUsd(edge.usd_value) : ''}${edge.transaction_count ? ` across ${escapeHtml(edge.transaction_count)} tx` : ''}</div>
                ${edge.transaction_hash ? `<div class="text-[10px] font-mono text-white/32 mt-1">${escapeHtml(shortHash(edge.transaction_hash))}</div>` : ''}
            </div>
        `;
    }

    function renderPathSummary(path) {
        const labels = path.wallet_ids
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .map(labelForNode)
            .join(' -> ');
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(path.hops)} HOP${path.hops === 1 ? '' : 'S'}</div>
                <div class="text-xs text-white/72 mt-1">${escapeHtml(labels)}</div>
                <div class="text-[11px] text-white/42 mt-1">${core.formatUsd(path.usd_value || 0)} sample flow path</div>
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

    function shortHash(hash) {
        const value = String(hash || '');
        return value.length <= 16 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
    }

    function getNodeAtEvent(event) {
        const point = getCanvasPoint(event);
        if (!point) return null;
        return state.graph.nodes
            .slice()
            .sort((a, b) => (b.radius || 0) - (a.radius || 0))
            .find(node => Math.hypot(node.x - point.x, node.y - point.y) <= (node.radius || 18) + 8);
    }

    function getCanvasPoint(event) {
        if (!state.canvas) return null;
        const rect = state.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function rebuildInteractionIndex() {
        if (!state.graph) return;
        const edgesByNode = new Map();
        const neighborsByNode = new Map();
        const pathsByNode = new Map();

        state.graph.nodes.forEach(node => {
            edgesByNode.set(node.id, []);
            neighborsByNode.set(node.id, new Set());
            pathsByNode.set(node.id, []);
        });

        state.graph.edges.forEach(edge => {
            if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
            if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
            if (!neighborsByNode.has(edge.source)) neighborsByNode.set(edge.source, new Set());
            if (!neighborsByNode.has(edge.target)) neighborsByNode.set(edge.target, new Set());
            edgesByNode.get(edge.source).push(edge);
            edgesByNode.get(edge.target).push(edge);
            neighborsByNode.get(edge.source).add(edge.target);
            neighborsByNode.get(edge.target).add(edge.source);
        });

        (state.graph.walletPaths || []).forEach(path => {
            (path.wallet_ids || []).forEach(nodeId => {
                if (!pathsByNode.has(nodeId)) pathsByNode.set(nodeId, []);
                pathsByNode.get(nodeId).push(path);
            });
        });

        state.interactionIndex = { edgesByNode, neighborsByNode, pathsByNode };
    }

    function getInteractionState() {
        const activeIds = new Set([state.selectedId, state.hoveredId].filter(Boolean));
        const connectedNodeIds = new Set(activeIds);
        const connectedEdgeIds = new Set();
        const index = state.interactionIndex;

        if (index) {
            activeIds.forEach(nodeId => {
                (index.neighborsByNode.get(nodeId) || []).forEach(connectedNodeIds.add, connectedNodeIds);
                (index.edgesByNode.get(nodeId) || []).forEach(edge => connectedEdgeIds.add(edge.id));
            });
        }

        return {
            activeIds,
            connectedNodeIds,
            connectedEdgeIds,
            hasFocus: activeIds.size > 0,
            hasSelected: Boolean(state.selectedId)
        };
    }

    function getEdgeInteractionStyle(edge, interaction) {
        const baseOpacity = edge.opacity || 0.7;
        const baseWidth = edge.width || 1.4;
        if (!interaction.hasFocus) {
            return {
                opacity: baseOpacity,
                width: baseWidth,
                shadowBlur: edge.is_large_value ? 10 : 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 8
            };
        }

        const connected = interaction.connectedEdgeIds.has(edge.id);
        const isFlow = edge.type === core.EDGE_TYPES.FLOW;
        const isExposure = edge.type === core.EDGE_TYPES.EXPOSURE;
        const isLargeFlow = isFlow && edge.is_large_value;

        if (connected) {
            return {
                opacity: isFlow ? 1 : isExposure ? 0.72 : 0.52,
                width: baseWidth + (isFlow ? 2.2 : isExposure ? 0.8 : 0.2),
                shadowBlur: isFlow ? 16 : 7,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: isFlow ? 10 : 8
            };
        }

        return {
            opacity: isLargeFlow ? 0.46 : isFlow ? 0.2 : isExposure ? 0.24 : 0.14,
            width: isLargeFlow ? Math.max(baseWidth, 3) : Math.max(0.8, baseWidth * 0.72),
            shadowBlur: isLargeFlow ? 5 : 0,
            shadowColor: edge.color || '#22d3ee',
            arrowSize: 7
        };
    }

    function getRelatedEdges(nodeId, edgeType) {
        const edges = state.interactionIndex?.edgesByNode.get(nodeId) || [];
        return edges
            .filter(edge => edge.type === edgeType)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function getRelatedPaths(nodeId) {
        const directPaths = state.interactionIndex?.pathsByNode.get(nodeId) || [];
        if (directPaths.length) return directPaths.sort((a, b) => b.usd_value - a.usd_value || a.hops - b.hops);

        const neighborIds = state.interactionIndex?.neighborsByNode.get(nodeId) || new Set();
        const paths = [];
        neighborIds.forEach(neighborId => {
            (state.interactionIndex?.pathsByNode.get(neighborId) || []).forEach(path => paths.push(path));
        });
        return paths
            .filter((path, index, list) => list.findIndex(item => item.edge_ids.join('|') === path.edge_ids.join('|')) === index)
            .sort((a, b) => b.usd_value - a.usd_value || a.hops - b.hops);
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
