(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;

    const HISTORY_GRAPH_RENDERER_VERSION = 'd111_history_graph_renderer_v1';
    const DEFAULT_LIMITS = Object.freeze({
        maxTransactions: 220,
        maxNodes: 180,
        maxEdges: 280
    });

    function renderPreviewDataset(canvas, dataset = {}, options = {}) {
        if (!canvas || !canvas.getContext) {
            return buildResult({ warning: 'Preview canvas unavailable.' });
        }
        if (!core || !graphEngine || !layoutEngine) {
            clearCanvas(canvas);
            drawEmptyState(canvas, 'Preview renderer waiting for graph modules.');
            return buildResult({ warning: 'Graph modules unavailable for preview rendering.' });
        }

        const limits = normalizeLimits(options);
        const capped = capPreviewDataset(dataset, limits);
        const graph = graphEngine.buildGraph(capped.dataset);
        const size = getCanvasSize(canvas);
        const laidOutGraph = layoutEngine.layoutGraph(graph, size);
        const renderGraph = capGraphForRender(laidOutGraph, limits);

        drawGraph(canvas, renderGraph);
        return buildResult({
            graph: renderGraph,
            warnings: capped.warnings,
            capped,
            limits,
            sourceCounts: capped.sourceCounts
        });
    }

    function capPreviewDataset(dataset = {}, limits = DEFAULT_LIMITS) {
        const transactions = Array.isArray(dataset.transactions) ? dataset.transactions.slice() : [];
        const sortedTransactions = transactions
            .map((transaction, index) => ({ transaction, index, timestamp: timestampValue(transaction.timestamp) }))
            .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
            .slice(0, limits.maxTransactions)
            .map(item => item.transaction);
        const usedWallets = new Set();
        const usedTokens = new Set();

        sortedTransactions.forEach(transaction => {
            addUsedWallet(usedWallets, transaction.source_wallet);
            addUsedWallet(usedWallets, transaction.destination_wallet);
            addUsedToken(usedTokens, transaction.token_mint);
            addUsedToken(usedTokens, transaction.contract_address);
        });

        const wallets = (Array.isArray(dataset.wallets) ? dataset.wallets : [])
            .filter(wallet => usedWallets.has(normalizeAddress(wallet.address || wallet.wallet_address)))
            .slice(0, limits.maxNodes);
        const tokens = (Array.isArray(dataset.tokens) ? dataset.tokens : [])
            .filter(token => usedTokens.has(normalizeAddress(token.token_mint || token.contract_address || token.address)))
            .slice(0, limits.maxNodes);
        const transactionGroups = (Array.isArray(dataset.transaction_groups) ? dataset.transaction_groups : [])
            .slice(0, Math.min(limits.maxTransactions, 80));
        const warnings = [];
        const sourceCounts = {
            wallets: Array.isArray(dataset.wallets) ? dataset.wallets.length : 0,
            tokens: Array.isArray(dataset.tokens) ? dataset.tokens.length : 0,
            transactions: transactions.length,
            transactionGroups: Array.isArray(dataset.transaction_groups) ? dataset.transaction_groups.length : 0
        };

        if (transactions.length > sortedTransactions.length) {
            warnings.push(`Preview graph capped at ${sortedTransactions.length} of ${transactions.length} transfer rows.`);
        }
        if (sourceCounts.wallets > wallets.length || sourceCounts.tokens > tokens.length) {
            warnings.push('Preview graph renders only nodes connected to the capped transfer sample.');
        }

        return {
            dataset: {
                metadata: {
                    ...(dataset.metadata || {}),
                    preview_only: true,
                    not_merged: true,
                    active_graph_unchanged: true,
                    visual_preview_enabled: true,
                    renderer_version: HISTORY_GRAPH_RENDERER_VERSION
                },
                wallets,
                tokens,
                entities: [],
                transactions: sortedTransactions,
                transaction_groups: transactionGroups
            },
            warnings,
            sourceCounts,
            renderedTransactionCount: sortedTransactions.length
        };
    }

    function capGraphForRender(graph = {}, limits = DEFAULT_LIMITS) {
        const flowEdges = (graph.flowEdges || []).slice(0, limits.maxEdges);
        const flowEdgeIds = new Set(flowEdges.map(edge => edge.id));
        const nodeIds = new Set();
        flowEdges.forEach(edge => {
            nodeIds.add(edge.source);
            nodeIds.add(edge.target);
        });

        (graph.exposureEdges || []).forEach(edge => {
            if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) return;
            if (nodeIds.has(edge.source) && nodeIds.size < limits.maxNodes) nodeIds.add(edge.target);
        });

        const nodes = (graph.nodes || [])
            .filter(node => nodeIds.has(node.id))
            .slice(0, limits.maxNodes);
        const visibleNodeIds = new Set(nodes.map(node => node.id));
        const edges = (graph.edges || [])
            .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
            .filter(edge => edge.type !== core.EDGE_TYPES.FLOW || flowEdgeIds.has(edge.id))
            .slice(0, limits.maxEdges);

        return {
            ...graph,
            nodes,
            edges,
            nodeById: new Map(nodes.map(node => [node.id, node])),
            walletNodes: nodes.filter(node => node.type === core.NODE_TYPES.WALLET),
            tokenNodes: nodes.filter(node => node.type === core.NODE_TYPES.TOKEN),
            hubNodes: [],
            entityNodes: [],
            flowEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.FLOW),
            exposureEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.EXPOSURE),
            labelEdges: [],
            rendererCapped: Boolean((graph.nodes || []).length > nodes.length || (graph.edges || []).length > edges.length)
        };
    }

    function drawGraph(canvas, graph = {}) {
        const ctx = canvas.getContext('2d');
        const size = getCanvasSize(canvas);
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(size.width * ratio);
        canvas.height = Math.floor(size.height * ratio);
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        drawPreviewBackdrop(ctx, size.width, size.height);

        if (!graph.nodes?.length) {
            drawCenteredText(ctx, size.width, size.height, 'No graph-ready history transfers yet.');
            return;
        }

        const bounds = getGraphBounds(graph.nodes);
        const scale = Math.min(
            1.05,
            (size.width * 0.78) / Math.max(1, bounds.width),
            (size.height * 0.72) / Math.max(1, bounds.height)
        );
        const offset = {
            x: size.width * 0.5 - (bounds.minX + bounds.width / 2) * scale,
            y: size.height * 0.52 - (bounds.minY + bounds.height / 2) * scale
        };

        ctx.save();
        ctx.translate(offset.x, offset.y);
        ctx.scale(scale, scale);

        graph.edges
            .slice()
            .sort((a, b) => previewEdgeOrder(a) - previewEdgeOrder(b))
            .forEach(edge => drawPreviewEdge(ctx, edge, graph.nodeById));
        graph.nodes
            .slice()
            .sort((a, b) => previewNodeOrder(a) - previewNodeOrder(b))
            .forEach(node => drawPreviewNode(ctx, node, graph));

        ctx.restore();
        drawWatermark(ctx, size.width, size.height);
    }

    function drawPreviewBackdrop(ctx, width, height) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(8, 13, 28, 0.96)');
        gradient.addColorStop(0.56, 'rgba(20, 25, 42, 0.94)');
        gradient.addColorStop(1, 'rgba(6, 10, 24, 0.98)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
        ctx.lineWidth = 1;
        for (let x = 22; x < width; x += 44) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 22; y < height; y += 44) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    function drawPreviewEdge(ctx, edge = {}, nodeById = new Map()) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        const bend = edge.type === core.EDGE_TYPES.FLOW ? 18 : -12;
        const control = {
            x: (source.x + target.x) / 2 + normal.x * bend,
            y: (source.y + target.y) / 2 + normal.y * bend
        };

        ctx.save();
        ctx.globalAlpha = edge.type === core.EDGE_TYPES.FLOW ? 0.42 : 0.18;
        ctx.strokeStyle = edge.type === core.EDGE_TYPES.FLOW ? 'rgba(125, 211, 252, 0.72)' : 'rgba(250, 204, 21, 0.42)';
        ctx.lineWidth = edge.type === core.EDGE_TYPES.FLOW ? Math.max(0.85, Math.min(2.4, edge.width || 1.2)) : 0.75;
        ctx.setLineDash(edge.type === core.EDGE_TYPES.FLOW ? [] : [5, 7]);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) drawPreviewArrow(ctx, control, target);
        ctx.restore();
    }

    function drawPreviewArrow(ctx, from, to) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const size = 6;
        ctx.fillStyle = 'rgba(165, 243, 252, 0.58)';
        ctx.beginPath();
        ctx.moveTo(to.x - Math.cos(angle) * 15, to.y - Math.sin(angle) * 15);
        ctx.lineTo(to.x - Math.cos(angle - 0.46) * (15 + size), to.y - Math.sin(angle - 0.46) * (15 + size));
        ctx.lineTo(to.x - Math.cos(angle + 0.46) * (15 + size), to.y - Math.sin(angle + 0.46) * (15 + size));
        ctx.closePath();
        ctx.fill();
    }

    function drawPreviewNode(ctx, node = {}, graph = {}) {
        const trackedWallet = normalizeAddress(graph.metadata?.wallet || graph.metadata?.tracked_wallet)
            && normalizeAddress(node.address) === normalizeAddress(graph.metadata?.wallet || graph.metadata?.tracked_wallet);
        const token = node.type === core.NODE_TYPES.TOKEN;
        const radius = Math.max(7, Math.min(22, (node.radius || 14) * 0.72)) + (trackedWallet ? 4 : 0);
        const color = trackedWallet ? '#e0f2fe' : token ? '#facc15' : '#67e8f9';

        ctx.save();
        ctx.globalAlpha = trackedWallet ? 0.95 : token ? 0.7 : 0.78;
        ctx.shadowColor = color;
        ctx.shadowBlur = trackedWallet ? 20 : 7;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
        ctx.strokeStyle = color;
        ctx.lineWidth = trackedWallet ? 2.2 : 1.1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(2.6, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();

        if (shouldDrawLabel(node, graph)) {
            ctx.globalAlpha = trackedWallet ? 0.9 : 0.56;
            ctx.fillStyle = trackedWallet ? '#f8fafc' : 'rgba(226, 232, 240, 0.72)';
            ctx.font = trackedWallet ? '700 10px Inter, sans-serif' : '500 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(labelForNode(node), node.x, node.y + radius + 5);
        }
        ctx.restore();
    }

    function shouldDrawLabel(node = {}, graph = {}) {
        if (normalizeAddress(graph.metadata?.wallet || graph.metadata?.tracked_wallet)
            && normalizeAddress(node.address) === normalizeAddress(graph.metadata?.wallet || graph.metadata?.tracked_wallet)) return true;
        if (node.type === core.NODE_TYPES.TOKEN) return true;
        return (graph.walletNodes || []).length <= 18;
    }

    function labelForNode(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return node.symbol || node.name || 'Token';
        return shortValue(node.address || node.label || node.id);
    }

    function drawWatermark(ctx, width, height) {
        ctx.save();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.28)';
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('PREVIEW ONLY / NOT MERGED / STATIC', width - 14, height - 12);
        ctx.restore();
    }

    function drawCenteredText(ctx, width, height, text) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.62)';
        ctx.font = '600 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, width / 2, height / 2);
    }

    function drawEmptyState(canvas, text) {
        const ctx = canvas.getContext('2d');
        const size = getCanvasSize(canvas);
        ctx.clearRect(0, 0, size.width, size.height);
        drawPreviewBackdrop(ctx, size.width, size.height);
        drawCenteredText(ctx, size.width, size.height, text);
    }

    function clearCanvas(canvas) {
        const ctx = canvas?.getContext?.('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
    }

    function getCanvasSize(canvas) {
        const parent = canvas.parentElement;
        return {
            width: Math.max(260, Math.floor(parent?.clientWidth || canvas.clientWidth || 720)),
            height: Math.max(240, Math.floor(parent?.clientHeight || canvas.clientHeight || 320))
        };
    }

    function getGraphBounds(nodes = []) {
        const xs = nodes.map(node => Number(node.x) || 0);
        const ys = nodes.map(node => Number(node.y) || 0);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            minX,
            maxX,
            minY,
            maxY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY)
        };
    }

    function buildResult(details = {}) {
        const graph = details.graph || {};
        const capped = details.capped || {};
        return {
            version: HISTORY_GRAPH_RENDERER_VERSION,
            previewOnly: true,
            notMerged: true,
            staticOnly: true,
            renderedAt: new Date().toISOString(),
            renderedNodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
            renderedEdges: Array.isArray(graph.edges) ? graph.edges.length : 0,
            renderedTransfers: capped.renderedTransactionCount || (Array.isArray(graph.flowEdges) ? graph.flowEdges.length : 0),
            sourceCounts: details.sourceCounts || {},
            limits: details.limits || DEFAULT_LIMITS,
            replayWindow: graph.metadata?.replay_window || null,
            replayReconstruction: graph.metadata?.replay_reconstruction || null,
            capped: Boolean(capped.warnings?.length || graph.rendererCapped),
            warnings: [
                ...(details.warning ? [details.warning] : []),
                ...(Array.isArray(details.warnings) ? details.warnings : [])
            ]
        };
    }

    function normalizeLimits(options = {}) {
        return {
            maxTransactions: clampInteger(options.maxTransactions, DEFAULT_LIMITS.maxTransactions, 20, 500),
            maxNodes: clampInteger(options.maxNodes, DEFAULT_LIMITS.maxNodes, 20, 320),
            maxEdges: clampInteger(options.maxEdges, DEFAULT_LIMITS.maxEdges, 20, 520)
        };
    }

    function clampInteger(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isInteger(number)) return fallback;
        return Math.max(min, Math.min(max, number));
    }

    function timestampValue(value) {
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    }

    function addUsedWallet(set, value) {
        const normalized = normalizeAddress(value);
        if (normalized) set.add(normalized);
    }

    function addUsedToken(set, value) {
        const normalized = normalizeAddress(value);
        if (normalized) set.add(normalized);
    }

    function normalizeAddress(value) {
        return String(value || '').trim();
    }

    function shortValue(value) {
        const text = String(value || '');
        if (text.length <= 14) return text || 'Wallet';
        return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    function previewEdgeOrder(edge = {}) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0;
        if (edge.type === core.EDGE_TYPES.FLOW) return 1;
        return 2;
    }

    function previewNodeOrder(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return 0;
        return 1;
    }

    namespace.historyGraphRenderer = {
        HISTORY_GRAPH_RENDERER_VERSION,
        DEFAULT_LIMITS,
        renderPreviewDataset,
        capPreviewDataset
    };
})();
