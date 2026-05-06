(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;

    if (!core || !graphEngine || !layoutEngine) {
        throw new Error('CryptoPhotonic core, graph, and layout modules must load before UI module');
    }

    const mathUtils = window.StockPhotonicUtils?.math || {};
    const clamp = mathUtils.clamp || ((value, min, max) => Math.max(min, Math.min(max, value)));
    const hashString = mathUtils.hashNumber || ((value) => {
        const text = String(value);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
    });

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
        resizeObserver: null,
        datasetSource: null,
        solanaAdapterLoadPromise: null,
        flowReplayEnabled: false,
        flowReplay: {
            playing: false,
            index: 0,
            activeFlowId: null,
            lastStepAt: 0,
            stepMs: 1150
        },
        flowMotion: {
            enabled: true,
            ambientEnabled: true,
            rafId: null,
            lastFrameAt: 0,
            now: 0,
            topFlowIds: new Set(),
            userInteractingUntil: 0
        },
        viewport: {
            x: 0,
            y: 0,
            scale: 1
        },
        drag: null,
        manualNodePositions: new Map()
    };

    const ZOOM_LIMITS = { min: 0.48, max: 2.35 };
    const DRAG_SELECT_THRESHOLD = 5;
    const FLOW_ANIMATION = {
        maxPulsedEdges: 7,
        frameMs: 33,
        minDurationMs: 1400,
        maxDurationMs: 3600,
        idlePauseMs: 950
    };
    const DETAIL_LIMITS = {
        connectedWallets: 4,
        directFlows: 4,
        tokenExposure: 3,
        multiHopPaths: 3
    };

    async function initialize(options = {}) {
        if (state.initialized) return state.graph;

        state.root = document.getElementById(options.rootId || 'crypto-photonic-view');
        state.canvas = document.getElementById(options.canvasId || 'crypto-flow-canvas');
        state.detailPanel = document.getElementById(options.detailPanelId || 'crypto-detail-panel');
        if (!state.root || !state.canvas || !state.detailPanel) return null;

        state.ctx = state.canvas.getContext('2d');
        state.canvas.style.cursor = 'grab';
        state.canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
        state.canvas.addEventListener('pointerdown', handleCanvasPointerDown);
        state.canvas.addEventListener('pointermove', handleCanvasPointerMove);
        state.canvas.addEventListener('pointerup', handleCanvasPointerUp);
        state.canvas.addEventListener('pointercancel', handleCanvasPointerCancel);
        state.canvas.addEventListener('mouseleave', handleCanvasLeave);
        document.getElementById('crypto-reset-view')?.addEventListener('click', resetView);
        document.getElementById('crypto-reset-layout')?.addEventListener('click', resetLayout);
        window.addEventListener('resize', resizeAndRender);

        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(resizeAndRender);
            state.resizeObserver.observe(state.canvas.parentElement || state.canvas);
        }

        const dataset = await loadSampleDataset();
        renderSolanaStatusCopy(dataset);
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        prepareFlowMotion();
        rebuildInteractionIndex();
        state.selectedId = state.graph.hubNodes?.[0]?.id || state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;
        state.initialized = true;

        updateStats();
        resizeAndRender();
        renderDetails();
        updateFlowAnimationLoop();
        return state.graph;
    }

    function setActive(active) {
        state.active = Boolean(active);
        updateFlowAnimationLoop();
        if (!state.active || !state.initialized) return;
        resizeAndRender();
        renderDetails();
    }

    async function loadSampleDataset() {
        const solanaFixture = await loadLocalJson('data/crypto/solana-sample-flow.json', 'Solana fixture file unavailable');
        if (solanaFixture) {
            const normalized = await normalizeSolanaFixture(solanaFixture);
            if (normalized) {
                state.datasetSource = 'data/crypto/solana-sample-flow.json';
                return normalized;
            }
        }

        const sampleFixture = await loadLocalJson('data/crypto/sample-flow.json', 'Crypto sample file unavailable');
        if (sampleFixture) {
            state.datasetSource = 'data/crypto/sample-flow.json';
            return sampleFixture;
        }

        console.warn('CryptoPhotonic sample data fell back to built-in dev sample');
        state.datasetSource = 'built_in_dev_sample';
        return core.getSampleDataset();
    }

    async function loadLocalJson(path, unavailableMessage) {
        try {
            const response = await fetch(`${path}?v=${Date.now()}`);
            if (!response.ok) throw new Error(unavailableMessage);
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    async function normalizeSolanaFixture(payload = {}) {
        const hasRawSolanaTransactions = Array.isArray(payload.solana_transactions)
            || Array.isArray(payload.enhancedTransactions)
            || Array.isArray(payload.enhanced_transactions);
        const hasGraphDataset = Array.isArray(payload.wallets)
            && Array.isArray(payload.tokens)
            && Array.isArray(payload.transactions);

        if (!hasRawSolanaTransactions) return hasGraphDataset ? payload : null;

        const adapter = await ensureSolanaAdapter();
        if (!adapter) return hasGraphDataset ? payload : null;

        const normalized = adapter.normalizeSolanaTransactionBatch(payload);
        return {
            ...normalized,
            metadata: {
                ...(payload.metadata || {}),
                ...(normalized.metadata || {}),
                source_path: 'data/crypto/solana-sample-flow.json'
            }
        };
    }

    function ensureSolanaAdapter() {
        if (namespace.solanaAdapter) return Promise.resolve(namespace.solanaAdapter);
        if (state.solanaAdapterLoadPromise) return state.solanaAdapterLoadPromise;

        state.solanaAdapterLoadPromise = new Promise(resolve => {
            const script = document.createElement('script');
            script.src = `js/crypto/solanaAdapter.js?v=${Date.now()}`;
            script.async = false;
            script.onload = () => resolve(namespace.solanaAdapter || null);
            script.onerror = () => {
                console.warn('CryptoPhotonic Solana adapter unavailable; using next offline sample fallback');
                resolve(null);
            };
            document.head.appendChild(script);
        });

        return state.solanaAdapterLoadPromise;
    }

    function renderSolanaStatusCopy(dataset = {}) {
        if (!state.root) return;
        const metadata = dataset.metadata || {};
        const isSolana = metadata.adapter === 'solana' || metadata.chain === 'solana';
        const subtitle = state.root.querySelector('h1 + p');
        if (subtitle && isSolana) {
            subtitle.textContent = 'Solana-first offline fixture mode for wallet, SPL token, and swap-like flow graphs';
        }

        const panelHeader = state.root.querySelector('.crypto-panel > div:first-child');
        if (!panelHeader) return;

        const existing = document.getElementById('crypto-solana-status');
        if (existing) existing.remove();

        const status = document.createElement('div');
        status.id = 'crypto-solana-status';
        status.className = 'text-[10px] font-mono tracking-[1.1px] text-cyan-50/78 rounded-2xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2 max-w-md';
        status.innerHTML = isSolana
            ? 'Solana offline fixture mode<br>Live data disabled; API keys not loaded in browser<br>Future live mode requires secure proxy/local runner'
            : 'Offline fixture mode<br>Live data disabled; API keys not loaded in browser<br>Future live mode requires secure proxy/local runner';
        panelHeader.appendChild(status);
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
        applyManualNodePositions();
        clampViewport();
        prepareFlowMotion();
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
        updateFlowReplay(performance.now());
        state.flowMotion.now = performance.now();
        const interaction = getInteractionState();
        ctx.clearRect(0, 0, width, height);
        drawBackdrop(ctx, width, height);

        ctx.save();
        ctx.translate(state.viewport.x, state.viewport.y);
        ctx.scale(state.viewport.scale, state.viewport.scale);

        const nodeById = state.graph.nodeById;
        state.graph.edges
            .filter(edge => edge.type !== core.EDGE_TYPES.LABEL)
            .sort((a, b) => edgeLayerOrder(a) - edgeLayerOrder(b) || (a.width || 0) - (b.width || 0))
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        state.graph.edges
            .filter(edge => edge.type === core.EDGE_TYPES.LABEL)
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        state.graph.nodes
            .slice()
            .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
            .forEach(node => drawNode(ctx, node, interaction));

        ctx.restore();
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
        ctx.setLineDash(edge.type === core.EDGE_TYPES.LABEL ? [4, 6] : edge.flow_role === 'swap_route' ? [9, 5] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) {
            drawArrow(ctx, control, target, edge.color || '#22d3ee', style.arrowSize);
            drawFlowPulse(ctx, edge, source, control, target, distance, interaction);
        }
        ctx.restore();
    }

    function drawFlowPulse(ctx, edge, source, control, target, distance, interaction) {
        if (!isFlowEdgeVisible(source, target)) return;
        const pulse = getFlowPulse(edge, distance, interaction);
        if (!pulse) return;

        const point = pointOnQuadratic(source, control, target, pulse.t);
        const glowPoint = pointOnQuadratic(source, control, target, clamp(pulse.t - 0.055, 0, 1));

        ctx.save();
        ctx.setLineDash([]);
        ctx.globalAlpha = pulse.opacity * 0.34;
        ctx.strokeStyle = edge.color || '#67e8f9';
        ctx.lineWidth = pulse.radius * 1.35;
        ctx.shadowColor = edge.color || '#67e8f9';
        ctx.shadowBlur = pulse.glow;
        ctx.beginPath();
        ctx.moveTo(glowPoint.x, glowPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();

        ctx.globalAlpha = pulse.opacity;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = pulse.glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, pulse.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = pulse.opacity * 0.58;
        ctx.fillStyle = edge.color || '#67e8f9';
        ctx.beginPath();
        ctx.arc(point.x, point.y, pulse.radius * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function isFlowEdgeVisible(source, target) {
        const bounds = state.graph?.bounds;
        if (!bounds) return true;
        const scale = state.viewport.scale || 1;
        const margin = 80 / scale;
        const left = (-state.viewport.x / scale) - margin;
        const top = (-state.viewport.y / scale) - margin;
        const right = ((bounds.width - state.viewport.x) / scale) + margin;
        const bottom = ((bounds.height - state.viewport.y) / scale) + margin;
        const edgeLeft = Math.min(source.x, target.x);
        const edgeRight = Math.max(source.x, target.x);
        const edgeTop = Math.min(source.y, target.y);
        const edgeBottom = Math.max(source.y, target.y);
        return edgeRight >= left && edgeLeft <= right && edgeBottom >= top && edgeTop <= bottom;
    }

    function getFlowPulse(edge, distance, interaction) {
        if (!state.flowMotion.enabled) return null;
        const now = state.flowMotion.now || performance.now();
        const replayActive = state.flowReplay.activeFlowId === edge.id;
        const ambientPaused = now < state.flowMotion.userInteractingUntil;
        const ambientActive = state.flowMotion.ambientEnabled
            && !state.flowReplay.playing
            && !ambientPaused
            && state.flowMotion.topFlowIds.has(edge.id);
        if (!replayActive && !ambientActive) return null;

        const duration = clamp(distance * 10, FLOW_ANIMATION.minDurationMs, FLOW_ANIMATION.maxDurationMs);
        const seed = hashString(edge.id) % duration;
        const t = replayActive
            ? clamp((now - state.flowReplay.lastStepAt) / state.flowReplay.stepMs, 0.08, 0.94)
            : ((now + seed) % duration) / duration;
        const isFocused = interaction.replayActiveFlowId === edge.id;
        return {
            t,
            opacity: isFocused ? 0.82 : 0.48,
            radius: isFocused ? 4.6 : 3.4,
            glow: isFocused ? 18 : 11
        };
    }

    function pointOnQuadratic(source, control, target, t) {
        const oneMinusT = 1 - t;
        return {
            x: oneMinusT * oneMinusT * source.x + 2 * oneMinusT * t * control.x + t * t * target.x,
            y: oneMinusT * oneMinusT * source.y + 2 * oneMinusT * t * control.y + t * t * target.y
        };
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
        const showLabel = shouldShowNodeLabel(node, { selected, hovered, connected, interaction });
        const labelAlpha = showLabel ? (muted ? 0.3 : 0.92) : 0;

        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = selected ? 30 : hovered ? 22 : connected ? 13 : 7;
        ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = selected || hovered ? '#ffffff' : node.color;
        ctx.lineWidth = selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
        if (isHubNode(node)) {
            ctx.globalAlpha = muted ? 0.34 : 0.88;
            ctx.strokeStyle = node.color;
            ctx.lineWidth = selected || hovered ? 2.2 : 1.4;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
            ctx.strokeStyle = selected || hovered ? '#ffffff' : node.color;
            ctx.lineWidth = selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
        }
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
        ctx.font = isHubNode(node) ? '700 12px Inter, sans-serif' : node.type === core.NODE_TYPES.TOKEN ? '600 11px Inter, sans-serif' : '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(labelForNode(node), node.x, node.y + radius + 8);
        ctx.restore();
    }

    function handleCanvasWheel(event) {
        if (!state.graph || !state.canvas) return;
        event.preventDefault();
        markFlowInteraction();

        const point = getScreenPoint(event);
        if (!point) return;
        const worldPoint = screenToWorld(point);
        const zoomIntensity = event.deltaMode === 1 ? 0.08 : 0.0018;
        const nextScale = clamp(
            state.viewport.scale * Math.exp(-event.deltaY * zoomIntensity),
            ZOOM_LIMITS.min,
            ZOOM_LIMITS.max
        );

        state.viewport.scale = nextScale;
        state.viewport.x = point.x - worldPoint.x * nextScale;
        state.viewport.y = point.y - worldPoint.y * nextScale;
        clampViewport();
        render();
    }

    function handleCanvasPointerDown(event) {
        if (!state.graph || !state.canvas) return;
        markFlowInteraction();
        const screenPoint = getScreenPoint(event);
        const worldPoint = screenToWorld(screenPoint);
        const node = getNodeAtWorldPoint(worldPoint);

        state.canvas.setPointerCapture?.(event.pointerId);
        state.drag = {
            pointerId: event.pointerId,
            mode: node ? 'node' : 'pan',
            nodeId: node?.id || null,
            startScreen: screenPoint,
            lastScreen: screenPoint,
            startNode: node ? { x: node.x, y: node.y } : null,
            startViewport: { ...state.viewport },
            moved: false
        };
        state.canvas.style.cursor = 'grabbing';
    }

    function handleCanvasPointerMove(event) {
        if (!state.graph || !state.canvas) return;
        const screenPoint = getScreenPoint(event);
        if (!screenPoint) return;

        if (state.drag?.pointerId === event.pointerId) {
            markFlowInteraction();
            const dx = screenPoint.x - state.drag.startScreen.x;
            const dy = screenPoint.y - state.drag.startScreen.y;
            if (Math.hypot(dx, dy) > DRAG_SELECT_THRESHOLD) state.drag.moved = true;

            if (state.drag.mode === 'node') {
                dragNodeTo(screenPoint);
            } else {
                state.viewport.x = state.drag.startViewport.x + dx;
                state.viewport.y = state.drag.startViewport.y + dy;
                clampViewport();
                render();
            }
            state.drag.lastScreen = screenPoint;
            return;
        }

        updateHoverFromScreenPoint(screenPoint);
    }

    function handleCanvasPointerUp(event) {
        if (!state.graph || !state.canvas) return;
        markFlowInteraction();
        const drag = state.drag;
        if (drag?.pointerId === event.pointerId) {
            state.canvas.releasePointerCapture?.(event.pointerId);
            state.drag = null;

            if (drag.mode === 'node' && !drag.moved && drag.nodeId) {
                state.selectedId = drag.nodeId;
                render();
                renderDetails();
            }

            updateHoverFromScreenPoint(getScreenPoint(event));
            return;
        }

        updateHoverFromScreenPoint(getScreenPoint(event));
    }

    function handleCanvasPointerCancel(event) {
        if (!state.canvas || state.drag?.pointerId !== event.pointerId) return;
        markFlowInteraction();
        state.canvas.releasePointerCapture?.(event.pointerId);
        state.drag = null;
        state.canvas.style.cursor = state.hoveredId ? 'grab' : 'grab';
    }

    function handleCanvasLeave() {
        if (!state.canvas || state.drag) return;
        markFlowInteraction();
        state.canvas.style.cursor = 'grab';
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
        const relatedHubFlows = isHubNode(node) ? getRelatedHubFlows(node) : [];
        const relatedExposureEdges = getRelatedEdges(node.id, core.EDGE_TYPES.EXPOSURE);
        const connectedWallets = isHubNode(node) ? getConnectedWallets(node) : [];
        const displayedRelatedFlows = mergeUniqueEdges([...relatedFlows, ...relatedHubFlows]);
        const relatedPaths = uniqueRelatedPaths(getRelatedPaths(node.id));
        state.detailPanel.innerHTML = `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">${escapeHtml(isHubNode(node) ? 'ENTITY HUB' : node.type.toUpperCase())} NODE</div>
            <h3 class="font-display text-2xl mt-1">${escapeHtml(labelForNode(node))}</h3>
            <div class="text-[11px] text-white/42 mt-2">Sample/dev-only graph. Future: live transfer pulses / route replay after secure data runner.</div>
            ${renderDetailSection('Summary', `
                ${detailRow('Chain', node.chain || '-')}
                ${isHubNode(node) ? detailRow('Hub Category', formatHubCategory(node.category)) : ''}
                ${node.name && node.type === core.NODE_TYPES.TOKEN ? detailRow('Token', node.name) : ''}
                ${detailRow('Label Source', node.label_source || '-')}
                ${detailRow('Confidence', `${Math.round((node.confidence || 0) * 100)}%`)}
                ${node.address ? detailRow('Address', node.address, { shorten: true }) : ''}
                ${node.token_mint ? detailRow('Token Mint', node.token_mint, { shorten: true }) : ''}
                ${state.graph.flowReplay?.enabled === false ? detailRow('Flow Replay', `${state.graph.flowReplay.ordered_flow_ids?.length || 0} ordered flows staged offline`) : ''}
            `)}
            ${renderDetailSection('Value / Exposure', `
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total In', core.formatUsd(node.total_in_usd || 0)) : ''}
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total Out', core.formatUsd(node.total_out_usd || 0)) : ''}
                ${isHubNode(node) ? detailRow('Aggregate Value', core.formatUsd(node.aggregate_value_usd || 0)) : ''}
                ${isHubNode(node) ? detailRow('Transaction Count', node.transaction_count || 0) : ''}
                ${detailRow(node.type === core.NODE_TYPES.TOKEN ? 'Token Exposure' : isHubNode(node) ? 'Hub Exposure' : 'Exposure', core.formatUsd(node.exposure_usd || 0))}
            `)}
            ${isHubNode(node) ? `
                ${renderCardSection('Connected Wallets', connectedWallets, DETAIL_LIMITS.connectedWallets, renderNodeSummary, 'No connected sample wallets.')}
            ` : ''}
            ${renderCardSection('Direct Flows', displayedRelatedFlows, DETAIL_LIMITS.directFlows, edge => renderEdgeSummary(edge, node.id), 'No related sample flows.')}
            ${renderCardSection('Token Exposure', relatedExposureEdges, DETAIL_LIMITS.tokenExposure, edge => renderEdgeSummary(edge, node.id), 'No token exposure links for this sample node.')}
            ${renderCardSection('Multi-Hop Paths', relatedPaths, DETAIL_LIMITS.multiHopPaths, renderPathSummary, 'No multi-hop wallet paths include this node.')}
        `;
    }

    function renderDetailSection(title, rowsHtml) {
        const rows = compactHtmlRows(rowsHtml);
        if (!rows) return '';
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">${escapeHtml(title)}</div>
                <div class="grid gap-2 text-xs text-white/68">${rows}</div>
            </section>
        `;
    }

    function renderCardSection(title, items, limit, renderItem, emptyMessage) {
        const list = Array.isArray(items) ? items : [];
        const displayed = list.slice(0, limit);
        const hiddenCount = Math.max(0, list.length - displayed.length);
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="flex items-center justify-between gap-3 mb-2">
                    <div class="text-[10px] font-mono tracking-[1.3px] text-white/45">${escapeHtml(title)}</div>
                    ${hiddenCount ? `<div class="text-[10px] font-mono text-white/32">+${hiddenCount} more</div>` : ''}
                </div>
                <div class="space-y-2">
                    ${displayed.map(renderItem).join('') || `<div class="text-xs text-white/38">${escapeHtml(emptyMessage)}</div>`}
                </div>
            </section>
        `;
    }

    function compactHtmlRows(rowsHtml) {
        return String(rowsHtml || '').replace(/\s+/g, ' ').trim();
    }

    function renderEdgeSummary(edge, selectedNodeId) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        const direction = edge.type === core.EDGE_TYPES.FLOW
            ? edge.source === selectedNodeId ? 'OUTFLOW' : edge.target === selectedNodeId ? 'INFLOW' : 'FLOW'
            : edge.type === core.EDGE_TYPES.LABEL ? formatRelation(edge.relation) : 'EXPOSURE';
        const label = edge.type === core.EDGE_TYPES.FLOW
            ? `${compactNodeLabel(source)} -> ${compactNodeLabel(target)}`
            : `${compactNodeLabel(source)} / ${compactNodeLabel(target)}`;
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(direction)}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(edge.type === core.EDGE_TYPES.FLOW ? `${labelForNode(source)} -> ${labelForNode(target)}` : `${labelForNode(source)} / ${labelForNode(target)}`)}">${escapeHtml(label)}</div>
                <div class="text-[11px] text-white/42 mt-1">${escapeHtml(edge.symbol || edge.chain || '')} ${edge.usd_value ? core.formatUsd(edge.usd_value) : ''}${edge.transaction_count ? ` across ${escapeHtml(edge.transaction_count)} tx` : ''}</div>
                ${edge.transaction_hash ? `<div class="text-[10px] font-mono text-white/32 mt-1">${escapeHtml(shortHash(edge.transaction_hash))}</div>` : ''}
            </div>
        `;
    }

    function renderNodeSummary(node) {
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(node.chain || 'WALLET')}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(labelForNode(node))}">${escapeHtml(compactNodeLabel(node))}</div>
                <div class="text-[11px] font-mono text-white/42 mt-1" title="${escapeAttr(node.address || node.id)}">${escapeHtml(shortLongValue(node.address || node.id))}</div>
            </div>
        `;
    }

    function renderPathSummary(path) {
        const labels = path.wallet_ids
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .map(compactNodeLabel)
            .join(' -> ');
        const fullLabels = path.wallet_ids
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .map(labelForNode)
            .join(' -> ');
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(path.hops)} HOP${path.hops === 1 ? '' : 'S'}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(fullLabels)}">${escapeHtml(labels)}</div>
                <div class="text-[11px] text-white/42 mt-1">${core.formatUsd(path.usd_value || 0)} sample flow path</div>
            </div>
        `;
    }

    function updateStats() {
        if (!state.graph) return;
        setText('crypto-wallet-count', `${state.graph.walletNodes.length} WALLETS / ${state.graph.hubNodes?.length || 0} HUBS`);
        setText('crypto-token-count', `${state.graph.tokenNodes.length} TOKENS`);
        setText('crypto-flow-count', `${state.graph.flowEdges.length} FLOWS`);
        setText('crypto-path-count', `${state.graph.walletPaths.length} PATHS`);
    }

    function detailRow(label, value, options = {}) {
        const rawValue = String(value);
        const visibleValue = options.shorten ? shortLongValue(rawValue) : rawValue;
        return `
            <div class="crypto-detail-row rounded-xl px-3 py-2">
                <div class="text-[10px] font-mono text-white/40">${escapeHtml(label)}</div>
                <div class="mt-1 break-all" title="${escapeAttr(rawValue)}">${escapeHtml(visibleValue)}</div>
            </div>
        `;
    }

    function labelForNode(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return node.symbol || node.name || 'Token';
        if (isHubNode(node)) return node.label || 'Entity Hub';
        return node.label || core.shortAddress(node.address);
    }

    function shouldShowNodeLabel(node, context) {
        if (!node) return false;
        if (context.selected || context.hovered) return true;
        if (isHubNode(node)) return true;

        const isMajor = node.label_priority === 'major';
        if (!context.interaction.hasFocus) return isMajor;
        return context.connected && isMajor;
    }

    function shortHash(hash) {
        const value = String(hash || '');
        return value.length <= 16 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
    }

    function shortLongValue(value) {
        const text = String(value || '');
        if (text.length <= 18) return text;
        if (text.startsWith('0x')) return `${text.slice(0, 8)}...${text.slice(-6)}`;
        return `${text.slice(0, 7)}...${text.slice(-6)}`;
    }

    function compactNodeLabel(node = {}) {
        if (!node) return '-';
        const label = labelForNode(node);
        if (label && label.length <= 22 && label !== node.address) return label;
        return shortLongValue(node.address || node.token_mint || label || node.id);
    }

    function dragNodeTo(screenPoint) {
        if (!state.drag?.nodeId) return;
        const node = state.graph.nodeById.get(state.drag.nodeId);
        if (!node) return;

        const dx = (screenPoint.x - state.drag.startScreen.x) / state.viewport.scale;
        const dy = (screenPoint.y - state.drag.startScreen.y) / state.viewport.scale;
        const margin = Math.max(38, (node.radius || 18) + 10);
        node.x = clamp(state.drag.startNode.x + dx, margin, state.graph.bounds.width - margin);
        node.y = clamp(state.drag.startNode.y + dy, margin, state.graph.bounds.height - margin);
        state.manualNodePositions.set(node.id, { x: node.x, y: node.y });
        render();
    }

    function updateHoverFromScreenPoint(screenPoint) {
        if (!screenPoint || !state.canvas) return;
        const hovered = getNodeAtWorldPoint(screenToWorld(screenPoint));
        const nextHoveredId = hovered?.id || null;
        state.canvas.style.cursor = hovered ? 'grab' : 'grab';
        if (nextHoveredId === state.hoveredId) return;
        state.hoveredId = nextHoveredId;
        render();
    }

    function getNodeAtWorldPoint(point) {
        if (!point) return null;
        return state.graph.nodes
            .slice()
            .sort((a, b) => (b.radius || 0) - (a.radius || 0))
            .find(node => Math.hypot(node.x - point.x, node.y - point.y) <= (node.radius || 18) + 10 / state.viewport.scale);
    }

    function getScreenPoint(event) {
        if (!state.canvas) return null;
        const rect = state.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function screenToWorld(point) {
        return {
            x: (point.x - state.viewport.x) / state.viewport.scale,
            y: (point.y - state.viewport.y) / state.viewport.scale
        };
    }

    function applyManualNodePositions() {
        if (!state.graph || !state.manualNodePositions.size) return;
        state.manualNodePositions.forEach((position, nodeId) => {
            const node = state.graph.nodeById.get(nodeId);
            if (!node) return;
            const margin = Math.max(38, (node.radius || 18) + 10);
            node.x = clamp(position.x, margin, state.graph.bounds.width - margin);
            node.y = clamp(position.y, margin, state.graph.bounds.height - margin);
        });
    }

    function clampViewport() {
        if (!state.graph) return;
        const { width, height } = state.graph.bounds;
        const scaledWidth = width * state.viewport.scale;
        const scaledHeight = height * state.viewport.scale;
        const slackX = Math.max(120, width * 0.45);
        const slackY = Math.max(120, height * 0.45);
        state.viewport.x = clamp(state.viewport.x, width - scaledWidth - slackX, slackX);
        state.viewport.y = clamp(state.viewport.y, height - scaledHeight - slackY, slackY);
    }

    function resetView() {
        state.viewport = { x: 0, y: 0, scale: 1 };
        clampViewport();
        render();
    }

    function resetLayout() {
        if (!state.graph) return;
        state.manualNodePositions.clear();
        state.graph = layoutEngine.layoutGraph(state.graph, getCanvasSize());
        prepareFlowMotion();
        rebuildInteractionIndex();
        render();
        renderDetails();
    }

    function prepareFlowMotion() {
        if (!state.graph) return;
        state.flowMotion.topFlowIds = new Set(
            (state.graph.flowEdges || [])
                .slice()
                .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0))
                .slice(0, FLOW_ANIMATION.maxPulsedEdges)
                .map(edge => edge.id)
        );

        const replayFlows = state.graph.flowReplay?.ordered_flows || [];
        const activeIndex = clamp(state.flowReplay.index, 0, Math.max(0, replayFlows.length - 1));
        state.flowReplay.index = activeIndex;
        if (state.flowReplay.playing && replayFlows.length) {
            state.flowReplay.activeFlowId = replayFlows[activeIndex]?.id || null;
        } else if (!state.flowReplay.playing) {
            state.flowReplay.activeFlowId = null;
        }
    }

    function markFlowInteraction() {
        state.flowMotion.userInteractingUntil = performance.now() + FLOW_ANIMATION.idlePauseMs;
    }

    function updateFlowAnimationLoop() {
        if (!state.flowMotion.enabled || !state.active || !state.initialized || !state.graph) {
            if (state.flowMotion.rafId) {
                cancelAnimationFrame(state.flowMotion.rafId);
                state.flowMotion.rafId = null;
            }
            return;
        }

        if (!state.flowMotion.rafId) {
            state.flowMotion.lastFrameAt = 0;
            state.flowMotion.rafId = requestAnimationFrame(runFlowAnimationFrame);
        }
    }

    function runFlowAnimationFrame(timestamp) {
        state.flowMotion.rafId = null;
        if (!state.flowMotion.enabled || !state.active || !state.initialized || !state.graph) return;

        state.flowMotion.now = timestamp;
        const replayPulseVisible = Boolean(state.flowReplay.activeFlowId)
            && timestamp - state.flowReplay.lastStepAt <= state.flowReplay.stepMs;
        const ambientVisible = state.flowMotion.ambientEnabled
            && state.flowMotion.topFlowIds.size > 0
            && timestamp >= state.flowMotion.userInteractingUntil;
        const shouldRender = (state.flowReplay.playing || replayPulseVisible || ambientVisible)
            && timestamp - state.flowMotion.lastFrameAt >= FLOW_ANIMATION.frameMs;
        if (shouldRender) {
            state.flowMotion.lastFrameAt = timestamp;
            render();
        }

        state.flowMotion.rafId = requestAnimationFrame(runFlowAnimationFrame);
    }

    function updateFlowReplay(now) {
        const replay = state.graph?.flowReplay;
        const orderedFlows = replay?.ordered_flows || [];
        if (!state.flowReplay.playing || !orderedFlows.length) return;

        if (!state.flowReplay.activeFlowId) {
            state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
            state.flowReplay.lastStepAt = now;
            return;
        }

        if (now - state.flowReplay.lastStepAt < state.flowReplay.stepMs) return;
        stepFlowReplay(1, { keepPlaying: true, now, skipRender: true });
    }

    function setFlowReplayPlaying(playing) {
        const orderedFlows = state.graph?.flowReplay?.ordered_flows || [];
        state.flowReplay.playing = Boolean(playing && orderedFlows.length);
        if (!state.flowReplay.playing) {
            state.flowReplay.activeFlowId = null;
            render();
            return state.flowReplay;
        }

        state.flowReplay.index = clamp(state.flowReplay.index, 0, orderedFlows.length - 1);
        state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
        state.flowReplay.lastStepAt = performance.now();
        updateFlowAnimationLoop();
        render();
        return state.flowReplay;
    }

    function stepFlowReplay(direction = 1, options = {}) {
        const orderedFlows = state.graph?.flowReplay?.ordered_flows || [];
        if (!orderedFlows.length) return state.flowReplay;

        if (state.flowReplay.activeFlowId) {
            const delta = direction < 0 ? -1 : 1;
            state.flowReplay.index = (state.flowReplay.index + delta + orderedFlows.length) % orderedFlows.length;
        } else {
            state.flowReplay.index = clamp(state.flowReplay.index, 0, orderedFlows.length - 1);
        }
        state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
        state.flowReplay.lastStepAt = options.now || performance.now();
        if (!options.keepPlaying) state.flowReplay.playing = false;
        updateFlowAnimationLoop();
        if (!options.skipRender) render();
        return state.flowReplay;
    }

    function toggleFlowReplay() {
        return setFlowReplayPlaying(!state.flowReplay.playing);
    }

    function setFlowAnimationEnabled(enabled) {
        state.flowMotion.enabled = Boolean(enabled);
        if (!state.flowMotion.enabled) {
            state.flowReplay.playing = false;
            state.flowReplay.activeFlowId = null;
        }
        updateFlowAnimationLoop();
        render();
        return state.flowMotion.enabled;
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

        const flowEdgeById = new Map();
        state.graph.edges.forEach(edge => {
            if (edge.type === core.EDGE_TYPES.FLOW) flowEdgeById.set(edge.id, edge);
            if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
            if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
            if (!neighborsByNode.has(edge.source)) neighborsByNode.set(edge.source, new Set());
            if (!neighborsByNode.has(edge.target)) neighborsByNode.set(edge.target, new Set());
            edgesByNode.get(edge.source).push(edge);
            edgesByNode.get(edge.target).push(edge);
            neighborsByNode.get(edge.source).add(edge.target);
            neighborsByNode.get(edge.target).add(edge.source);
        });

        (state.graph.hubNodes || []).forEach(hub => {
            (hub.related_flow_ids || []).forEach(flowId => {
                const flowEdge = flowEdgeById.get(flowId);
                if (!flowEdge) return;
                edgesByNode.get(hub.id).push(flowEdge);
                neighborsByNode.get(hub.id).add(flowEdge.source);
                neighborsByNode.get(hub.id).add(flowEdge.target);
            });
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
        const replayActiveFlowId = state.flowReplay.activeFlowId;
        const replayActiveEdge = replayActiveFlowId
            ? (state.graph.flowEdges || []).find(edge => edge.id === replayActiveFlowId)
            : null;

        if (index) {
            activeIds.forEach(nodeId => {
                (index.neighborsByNode.get(nodeId) || []).forEach(connectedNodeIds.add, connectedNodeIds);
                (index.edgesByNode.get(nodeId) || []).forEach(edge => connectedEdgeIds.add(edge.id));
            });
        }

        if (replayActiveEdge) {
            connectedEdgeIds.add(replayActiveEdge.id);
            connectedNodeIds.add(replayActiveEdge.source);
            connectedNodeIds.add(replayActiveEdge.target);
        }

        return {
            activeIds,
            connectedNodeIds,
            connectedEdgeIds,
            hasFocus: activeIds.size > 0,
            hasSelected: Boolean(state.selectedId),
            replayActiveFlowId,
            hasReplayFocus: Boolean(replayActiveEdge)
        };
    }

    function getEdgeInteractionStyle(edge, interaction) {
        const baseOpacity = edge.opacity || 0.7;
        const baseWidth = edge.width || 1.4;
        const isFlow = edge.type === core.EDGE_TYPES.FLOW;
        const isReplayActive = interaction.replayActiveFlowId === edge.id;
        const hasReplayFocus = interaction.hasReplayFocus;
        const ambientPulsed = isFlow
            && state.flowMotion.enabled
            && state.flowMotion.ambientEnabled
            && !hasReplayFocus
            && state.flowMotion.topFlowIds.has(edge.id)
            && (state.flowMotion.now || performance.now()) >= state.flowMotion.userInteractingUntil;

        if (isReplayActive) {
            return {
                opacity: 1,
                width: baseWidth + 2.8,
                shadowBlur: 22,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 11
            };
        }

        if (hasReplayFocus && isFlow) {
            return {
                opacity: Math.max(0.1, baseOpacity * 0.42),
                width: Math.max(0.7, baseWidth * 0.72),
                shadowBlur: 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 7
            };
        }

        if (!interaction.hasFocus) {
            return {
                opacity: ambientPulsed ? Math.min(0.95, baseOpacity + 0.1) : baseOpacity,
                width: ambientPulsed ? baseWidth + 0.55 : baseWidth,
                shadowBlur: ambientPulsed ? 9 : edge.is_large_value ? 10 : 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 8
            };
        }

        const connected = interaction.connectedEdgeIds.has(edge.id);
        const isExposure = edge.type === core.EDGE_TYPES.EXPOSURE;
        const isLargeFlow = isFlow && edge.is_large_value;

        if (connected) {
            return {
                opacity: isFlow ? 1 : isExposure ? 0.58 : 0.38,
                width: baseWidth + (isFlow ? 2.2 : isExposure ? 0.45 : 0.1),
                shadowBlur: isFlow ? 16 : 7,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: isFlow ? 10 : 8
            };
        }

        return {
            opacity: isLargeFlow ? 0.42 : isFlow ? 0.13 : isExposure ? 0.12 : 0.08,
            width: isLargeFlow ? Math.max(baseWidth, 2.8) : Math.max(0.55, baseWidth * 0.62),
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

    function getRelatedHubFlows(node) {
        if (!node?.related_flow_ids?.length) return [];
        const flowById = new Map((state.graph.flowEdges || []).map(edge => [edge.id, edge]));
        return node.related_flow_ids
            .map(id => flowById.get(id))
            .filter(Boolean)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function mergeUniqueEdges(edges) {
        return edges
            .filter((edge, index, list) => edge && list.findIndex(item => item?.id === edge.id) === index)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function getConnectedWallets(node) {
        return (node.connected_wallet_ids || [])
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .sort((a, b) => (b.exposure_usd || 0) - (a.exposure_usd || 0) || labelForNode(a).localeCompare(labelForNode(b)));
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

    function uniqueRelatedPaths(paths) {
        const bestByRoute = new Map();
        (paths || []).forEach(path => {
            const routeKey = (path.wallet_ids || []).join('>');
            if (!routeKey) return;
            const existing = bestByRoute.get(routeKey);
            if (
                !existing
                || (path.usd_value || 0) > (existing.usd_value || 0)
                || ((path.usd_value || 0) === (existing.usd_value || 0) && (path.hops || 0) < (existing.hops || 0))
            ) {
                bestByRoute.set(routeKey, path);
            }
        });

        return [...bestByRoute.values()]
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0) || (a.hops || 0) - (b.hops || 0));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replaceAll('`', '&#096;');
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    }

    function typeOrder(type) {
        if (type === core.NODE_TYPES.HUB || type === core.NODE_TYPES.ENTITY) return 0;
        if (type === core.NODE_TYPES.TOKEN) return 2;
        return 1;
    }

    function edgeLayerOrder(edge) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0;
        if (edge.type === core.EDGE_TYPES.FLOW) return 1;
        return 2;
    }

    function isHubNode(node) {
        return node?.type === core.NODE_TYPES.HUB || node?.type === core.NODE_TYPES.ENTITY;
    }

    function formatHubCategory(category) {
        return String(category || 'labeled_entity').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function formatRelation(relation) {
        return String(relation || 'HUB LINK').replaceAll('_', ' ').toUpperCase();
    }

    namespace.ui = {
        initialize,
        setActive,
        render,
        resetView,
        resetLayout,
        playFlowReplay: () => setFlowReplayPlaying(true),
        pauseFlowReplay: () => setFlowReplayPlaying(false),
        toggleFlowReplay,
        stepFlowReplay,
        setFlowAnimationEnabled,
        getState: () => ({ ...state })
    };
})();
