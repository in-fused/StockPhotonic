(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;

    const HISTORY_REPLAY_ANIMATOR_VERSION = 'd115_history_replay_animator_v1';
    const DEFAULT_LIMITS = Object.freeze({
        maxTransactions: 180,
        maxNodes: 160,
        maxEdges: 240,
        maxParticles: 48
    });
    const SPEEDS = Object.freeze({
        inspect: { label: 'Inspect', stepMs: 1250 },
        standard: { label: 'Standard', stepMs: 620 },
        fast: { label: 'Fast', stepMs: 240 }
    });
    const FRAME_MS = 16;

    function createReplayAnimator(canvas, dataset = {}, options = {}) {
        const state = {
            canvas,
            graph: null,
            steps: [],
            stepIndex: 0,
            speed: SPEEDS[options.speed] ? options.speed : 'standard',
            playing: false,
            done: false,
            rafId: null,
            lastAdvanceAt: 0,
            lastFrameAt: 0,
            warnings: [],
            metadata: {},
            destroyed: false,
            onStatus: typeof options.onStatus === 'function' ? options.onStatus : null,
            limits: normalizeLimits(options)
        };
        const animator = {
            canvas,
            configure,
            start,
            pause,
            step,
            seek,
            reset,
            setSpeed,
            render,
            getStatus,
            destroy
        };

        configure(dataset, options);
        return animator;

        function configure(nextDataset = {}, configureOptions = {}) {
            state.limits = normalizeLimits({ ...state.limits, ...configureOptions });
            const prepared = prepareReplayGraph(nextDataset, state.limits, state.canvas);
            state.graph = prepared.graph;
            state.steps = prepared.steps;
            state.warnings = prepared.warnings;
            state.metadata = prepared.metadata || nextDataset.metadata || {};
            state.stepIndex = clampInteger(configureOptions.initialStep, 0, 0, state.steps.length);
            state.done = state.steps.length > 0 && state.stepIndex >= state.steps.length;
            render();
            notifyStatus();
            return animator;
        }

        function start(startOptions = {}) {
            if (!state.steps.length || state.destroyed) {
                render();
                notifyStatus();
                return getStatus();
            }
            const requestedStep = Number.isFinite(Number(startOptions.stepIndex))
                ? Number(startOptions.stepIndex)
                : state.stepIndex;
            state.stepIndex = clampInteger(requestedStep, state.stepIndex, 0, state.steps.length);
            if (state.stepIndex >= state.steps.length || (!startOptions.resume && state.done)) {
                state.stepIndex = 0;
            }
            state.done = false;
            state.playing = true;
            state.lastAdvanceAt = performanceNow();
            scheduleFrame();
            render();
            notifyStatus();
            return getStatus();
        }

        function pause() {
            state.playing = false;
            cancelFrame();
            render();
            notifyStatus();
            return getStatus();
        }

        function step(direction = 1) {
            state.playing = false;
            cancelFrame();
            const delta = direction < 0 ? -1 : 1;
            state.stepIndex = clampInteger(state.stepIndex + delta, state.stepIndex, 0, state.steps.length);
            state.done = state.steps.length > 0 && state.stepIndex >= state.steps.length;
            state.lastAdvanceAt = performanceNow();
            render();
            notifyStatus();
            return getStatus();
        }

        function seek(stepIndex = 0) {
            const wasPlaying = state.playing;
            state.stepIndex = clampInteger(stepIndex, state.stepIndex, 0, state.steps.length);
            state.done = state.steps.length > 0 && state.stepIndex >= state.steps.length;
            if (state.done) state.playing = false;
            state.lastAdvanceAt = performanceNow();
            if (state.playing && !wasPlaying) state.playing = false;
            if (state.playing) scheduleFrame();
            else cancelFrame();
            render();
            notifyStatus();
            return getStatus();
        }

        function reset() {
            state.playing = false;
            state.done = false;
            state.stepIndex = 0;
            state.lastAdvanceAt = performanceNow();
            cancelFrame();
            render();
            notifyStatus();
            return getStatus();
        }

        function setSpeed(speed = 'standard') {
            state.speed = SPEEDS[speed] ? speed : 'standard';
            state.lastAdvanceAt = performanceNow();
            notifyStatus();
            return getStatus();
        }

        function render(now = performanceNow()) {
            if (!state.canvas || state.destroyed) return getStatus();
            drawReplayFrame(state.canvas, state.graph, {
                steps: state.steps,
                stepIndex: state.stepIndex,
                progress: getCurrentStepProgress(now),
                playing: state.playing,
                now,
                limits: state.limits
            });
            return getStatus();
        }

        function getStatus() {
            const current = state.stepIndex > 0 ? state.steps[Math.max(0, state.stepIndex - 1)] || {} : {};
            const speed = SPEEDS[state.speed] || SPEEDS.standard;
            return {
                version: HISTORY_REPLAY_ANIMATOR_VERSION,
                previewOnly: true,
                notMerged: true,
                playing: state.playing,
                done: state.done,
                currentStep: state.stepIndex,
                totalSteps: state.steps.length,
                timestamp: current.timestamp || '',
                signature: current.signature || '',
                amount: current.amount || 0,
                amountDisplay: current.amountDisplay || '',
                token: current.token || '',
                direction: current.direction || '',
                sourceWallet: current.sourceWallet || '',
                destinationWallet: current.destinationWallet || '',
                currentEvent: summarizeStep(current, state.stepIndex),
                eventSummaries: state.steps.map((step, index) => summarizeStep(step, index + 1)),
                speed: state.speed,
                speedLabel: speed.label,
                stepMs: speed.stepMs,
                renderedNodes: state.graph?.nodes?.length || 0,
                renderedEdges: state.graph?.edges?.length || 0,
                warnings: state.warnings.slice(0, 4),
                warning: state.warnings[0] || '',
                replayCoveragePct: clampInteger(state.metadata.replay_coverage_pct || state.metadata.replay_window?.coverage_pct, 0, 0, 100),
                completenessConfidence: clampInteger(state.metadata.completeness_confidence, 0, 0, 100),
                archiveReadiness: state.metadata.archive_readiness || '',
                providerGrade: state.metadata.provider_grade || '',
                scanId: state.metadata.scan_id || '',
                replayWindow: state.metadata.replay_window || null,
                replayReconstruction: state.metadata.replay_reconstruction || null,
                timelineSegments: Array.isArray(state.metadata.replay_reconstruction?.timeline_segments)
                    ? state.metadata.replay_reconstruction.timeline_segments.slice(0, 24)
                    : Array.isArray(state.metadata.replay_window?.timeline_segments)
                        ? state.metadata.replay_window.timeline_segments.slice(0, 12)
                        : [],
                windowing: {
                    chunkSize: Math.max(1, Number(state.metadata.replay_reconstruction?.chunk_size || state.metadata.replay_window?.chunk_size) || state.limits.maxTransactions),
                    renderCapTransactions: state.limits.maxTransactions,
                    renderCapNodes: state.limits.maxNodes,
                    renderCapEdges: state.limits.maxEdges,
                    progressiveReveal: true,
                    batchRendering: true,
                    oldestFirstPrepared: state.metadata.replay_reconstruction?.oldest_first_ready === true || state.metadata.replay_window?.oldest_first_ready === true
                },
                performance: {
                    cappedTransactions: state.limits.maxTransactions,
                    cappedNodes: state.limits.maxNodes,
                    cappedEdges: state.limits.maxEdges,
                    cappedParticles: state.limits.maxParticles,
                    frameMs: FRAME_MS
                }
            };
        }

        function destroy() {
            state.destroyed = true;
            state.playing = false;
            cancelFrame();
        }

        function scheduleFrame() {
            if (state.rafId || state.destroyed) return;
            state.rafId = requestAnimationFrame(runFrame);
        }

        function cancelFrame() {
            if (!state.rafId) return;
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }

        function runFrame(now) {
            state.rafId = null;
            if (!state.playing || state.destroyed) return;
            const speed = SPEEDS[state.speed] || SPEEDS.standard;
            if (now - state.lastAdvanceAt >= speed.stepMs) {
                state.stepIndex = Math.min(state.steps.length, state.stepIndex + 1);
                state.lastAdvanceAt = now;
                state.done = state.stepIndex >= state.steps.length;
                notifyStatus();
                if (state.done) {
                    state.playing = false;
                }
            }
            if (now - state.lastFrameAt >= FRAME_MS) {
                state.lastFrameAt = now;
                render(now);
            }
            if (state.playing) scheduleFrame();
            else {
                render(now);
                notifyStatus();
            }
        }

        function getCurrentStepProgress(now = performanceNow()) {
            if (!state.playing) return 1;
            const speed = SPEEDS[state.speed] || SPEEDS.standard;
            return clamp((now - state.lastAdvanceAt) / Math.max(1, speed.stepMs), 0, 1);
        }

        function notifyStatus() {
            if (state.onStatus) state.onStatus(getStatus());
        }
    }

    function prepareReplayGraph(dataset = {}, limits = DEFAULT_LIMITS, canvas = null) {
        const warnings = [];
        if (!core || !graphEngine || !layoutEngine) {
            return {
                graph: buildEmptyGraph(dataset),
                steps: [],
                warnings: ['Replay animator waiting for graph modules.']
            };
        }

        const capped = namespace.historyGraphRenderer?.capPreviewDataset
            ? namespace.historyGraphRenderer.capPreviewDataset(dataset, limits)
            : capPreviewDataset(dataset, limits);
        warnings.push(...(capped.warnings || []));
        warnings.push(...safeMetadataWarnings(dataset.metadata));

        const size = getCanvasSize(canvas);
        const graph = layoutEngine.layoutGraph(graphEngine.buildGraph(capped.dataset), size);
        const replayGraph = capGraphForReplay(graph, capped.dataset, limits);
        const steps = buildReplaySteps(replayGraph, capped.dataset, limits);
        if (!steps.length) warnings.push('No graph-ready preview transfer rows are available for replay.');
        if ((capped.sourceCounts?.transactions || 0) > steps.length) {
            warnings.push(`Replay capped at ${steps.length} visible transfer step${steps.length === 1 ? '' : 's'}.`);
        }
        replayGraph.metadata = {
            ...(replayGraph.metadata || {}),
            ...(dataset.metadata || {}),
            replay_preview_only: true,
            replay_not_merged: true,
            replay_animator_version: HISTORY_REPLAY_ANIMATOR_VERSION
        };

        return { graph: replayGraph, steps, warnings: dedupeStrings(warnings), metadata: replayGraph.metadata };
    }

    function capGraphForReplay(graph = {}, dataset = {}, limits = DEFAULT_LIMITS) {
        const flowEdges = (graph.flowEdges || []).slice(0, limits.maxEdges);
        const flowEdgeIds = new Set(flowEdges.map(edge => edge.id));
        const nodeIds = new Set();
        flowEdges.forEach(edge => {
            nodeIds.add(edge.source);
            nodeIds.add(edge.target);
        });

        const trackedWallet = normalizeAddress(dataset.metadata?.wallet || dataset.metadata?.tracked_wallet);
        const trackedNode = (graph.walletNodes || []).find(node => normalizeAddress(node.address) === trackedWallet);
        if (trackedNode) nodeIds.add(trackedNode.id);

        const exposureEdges = [];
        (graph.exposureEdges || []).forEach(edge => {
            const touchesFlowWallet = nodeIds.has(edge.source) || nodeIds.has(edge.target);
            if (!touchesFlowWallet || exposureEdges.length >= Math.max(0, limits.maxEdges - flowEdges.length)) return;
            nodeIds.add(edge.source);
            nodeIds.add(edge.target);
            exposureEdges.push(edge);
        });

        const nodes = (graph.nodes || [])
            .filter(node => nodeIds.has(node.id))
            .slice(0, limits.maxNodes);
        const visibleNodeIds = new Set(nodes.map(node => node.id));
        const edges = [...flowEdges, ...exposureEdges]
            .filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
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
            flowEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.FLOW && flowEdgeIds.has(edge.id)),
            exposureEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.EXPOSURE),
            labelEdges: []
        };
    }

    function buildReplaySteps(graph = {}, dataset = {}, limits = DEFAULT_LIMITS) {
        const transactionByEdgeKey = new Map();
        (dataset.transactions || []).forEach((transaction, index) => {
            const key = getTransferKey(transaction, index);
            transactionByEdgeKey.set(key, { transaction, index });
        });

        const exposureByWallet = new Map();
        (graph.exposureEdges || []).forEach(edge => {
            const list = exposureByWallet.get(edge.source) || [];
            list.push(edge);
            exposureByWallet.set(edge.source, list);
        });

        return (graph.flowEdges || [])
            .map((edge, index) => {
                const match = transactionByEdgeKey.get(getEdgeTransferKey(edge, index)) || {};
                const transaction = match.transaction || {};
                const exposureEdges = [
                    ...(exposureByWallet.get(edge.source) || []),
                    ...(exposureByWallet.get(edge.target) || [])
                ].filter(exposure => !edge.symbol || exposure.symbol === edge.symbol || exposure.token_mint === edge.token_mint)
                    .slice(0, 2);
                return {
                    index,
                    edgeId: edge.id,
                    edge,
                    transaction,
                    timestamp: edge.timestamp || transaction.timestamp || '',
                    timestampValue: timestampValue(edge.timestamp || transaction.timestamp),
                    signature: edge.transaction_hash || transaction.transaction_hash || '',
                    amount: edge.amount || transaction.amount || 0,
                    amountDisplay: edge.amount_display || transaction.amount_display || transaction.amountDisplay || '',
                    token: edge.symbol || transaction.symbol || edge.token_mint || transaction.token_mint || '',
                    direction: edge.direction || transaction.direction || transaction.metadata?.direction || '',
                    sourceWallet: edge.source_wallet || transaction.source_wallet || '',
                    destinationWallet: edge.destination_wallet || transaction.destination_wallet || '',
                    nodeIds: [...new Set([edge.source, edge.target, ...exposureEdges.flatMap(exposure => [exposure.source, exposure.target])])],
                    exposureEdgeIds: exposureEdges.map(exposure => exposure.id)
                };
            })
            .sort((a, b) => a.timestampValue - b.timestampValue || a.index - b.index)
            .slice(0, limits.maxTransactions);
    }

    function drawReplayFrame(canvas, graph = {}, options = {}) {
        const ctx = canvas.getContext?.('2d');
        if (!ctx) return;
        const size = getCanvasSize(canvas);
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(size.width * ratio);
        canvas.height = Math.floor(size.height * ratio);
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        drawReplayBackdrop(ctx, size.width, size.height, options.now);

        if (!graph.nodes?.length) {
            drawCenteredText(ctx, size.width, size.height, 'No graph-ready replay transfers yet.');
            drawWatermark(ctx, size.width, size.height);
            return;
        }

        const bounds = getGraphBounds(graph.nodes);
        const scale = Math.min(
            1.08,
            (size.width * 0.8) / Math.max(1, bounds.width),
            (size.height * 0.73) / Math.max(1, bounds.height)
        );
        const offset = {
            x: size.width * 0.5 - (bounds.minX + bounds.width / 2) * scale,
            y: size.height * 0.52 - (bounds.minY + bounds.height / 2) * scale
        };
        const revealed = getRevealedSets(options.steps, options.stepIndex);
        const current = options.steps[Math.max(0, options.stepIndex - 1)] || null;
        let rootVisible = false;
        graph.nodes.forEach(node => {
            if (!isTrackedWallet(node, graph)) return;
            revealed.nodeIds.add(node.id);
            rootVisible = true;
        });
        if (!rootVisible && options.stepIndex === 0 && options.steps[0]?.edge?.source) {
            revealed.nodeIds.add(options.steps[0].edge.source);
        }

        ctx.save();
        ctx.translate(offset.x, offset.y);
        ctx.scale(scale, scale);

        drawRevealedEdges(ctx, graph, revealed, current, options);
        drawRevealedNodes(ctx, graph, revealed, current, options);

        ctx.restore();
        drawReplayProgress(ctx, size.width, size.height, options.stepIndex, options.steps.length, options.playing);
        drawReplayStatePill(ctx, size.width, size.height, options.playing, options.stepIndex, options.steps.length);
        drawWatermark(ctx, size.width, size.height);
    }

    function drawRevealedEdges(ctx, graph, revealed, current, options) {
        const nodeById = graph.nodeById || new Map();
        (graph.exposureEdges || []).forEach(edge => {
            if (!revealed.edgeIds.has(edge.id)) return;
            drawReplayEdge(ctx, edge, nodeById, {
                alpha: 0.2,
                progress: 1,
                color: 'rgba(250, 204, 21, 0.36)',
                dashed: true
            });
        });

        let particleCount = 0;
        (graph.flowEdges || []).forEach((edge, index) => {
            if (!revealed.edgeIds.has(edge.id)) return;
            const isCurrent = current?.edgeId === edge.id;
            const progress = isCurrent ? options.progress : 1;
            drawReplayEdge(ctx, edge, nodeById, {
                alpha: isCurrent ? 1 : 0.52,
                progress,
                color: isCurrent ? 'rgba(244, 114, 182, 0.96)' : 'rgba(125, 211, 252, 0.7)',
                dashed: false,
                active: isCurrent
            });
            if (options.playing && particleCount < options.limits.maxParticles && progress > 0.08) {
                drawFlowParticle(ctx, edge, nodeById, options.now, index, isCurrent ? progress : 1);
                particleCount += 1;
            }
        });
    }

    function drawRevealedNodes(ctx, graph, revealed, current, options) {
        const currentNodeIds = new Set(current?.nodeIds || []);
        graph.nodes
            .slice()
            .sort((a, b) => previewNodeOrder(a) - previewNodeOrder(b))
            .forEach(node => {
                if (!revealed.nodeIds.has(node.id)) return;
                drawReplayNode(ctx, node, graph, {
                    active: currentNodeIds.has(node.id),
                    root: isTrackedWallet(node, graph),
                    playing: options.playing,
                    now: options.now
                });
            });
    }

    function drawReplayEdge(ctx, edge = {}, nodeById = new Map(), options = {}) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const curve = getCurve(source, target, edge.type === core.EDGE_TYPES.FLOW ? 18 : -12);
        const points = getCurvePoints(curve, clamp(options.progress, 0, 1), 26);
        if (points.length < 2) return;

        ctx.save();
        ctx.globalAlpha = options.alpha;
        ctx.strokeStyle = options.color;
        ctx.lineWidth = edge.type === core.EDGE_TYPES.FLOW
            ? Math.max(1.05, Math.min(3.2, edge.width || 1.4))
            : 0.85;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (options.dashed) ctx.setLineDash([5, 8]);
        if (options.active) {
            ctx.globalAlpha = Math.min(1, options.alpha * 0.55);
            ctx.strokeStyle = 'rgba(251, 207, 232, 0.56)';
            ctx.lineWidth += 7.5;
            ctx.shadowColor = 'rgba(244, 114, 182, 0.86)';
            ctx.shadowBlur = 22;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
            ctx.stroke();
            ctx.globalAlpha = options.alpha;
            ctx.strokeStyle = options.color;
            ctx.lineWidth = edge.type === core.EDGE_TYPES.FLOW
                ? Math.max(2.6, Math.min(5.8, (edge.width || 1.4) + 2.2))
                : 1.4;
            ctx.shadowBlur = 16;
        }
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
        ctx.stroke();
        ctx.setLineDash([]);
        if (edge.type === core.EDGE_TYPES.FLOW && options.progress >= 0.86) {
            drawReplayArrow(ctx, points[Math.max(0, points.length - 3)], points[points.length - 1], options.active);
        }
        ctx.restore();
    }

    function drawReplayArrow(ctx, from, to, active = false) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const size = active ? 7.5 : 6;
        ctx.fillStyle = active ? 'rgba(245, 208, 254, 0.86)' : 'rgba(165, 243, 252, 0.58)';
        ctx.beginPath();
        ctx.moveTo(to.x - Math.cos(angle) * 15, to.y - Math.sin(angle) * 15);
        ctx.lineTo(to.x - Math.cos(angle - 0.5) * (15 + size), to.y - Math.sin(angle - 0.5) * (15 + size));
        ctx.lineTo(to.x - Math.cos(angle + 0.5) * (15 + size), to.y - Math.sin(angle + 0.5) * (15 + size));
        ctx.closePath();
        ctx.fill();
    }

    function drawFlowParticle(ctx, edge = {}, nodeById = new Map(), now = 0, index = 0, maxProgress = 1) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const t = Math.min(maxProgress, ((now / 1120) + index * 0.137) % 1);
        const point = pointOnCurve(getCurve(source, target, 18), t);
        ctx.save();
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = 'rgba(240, 249, 255, 0.86)';
        ctx.shadowColor = 'rgba(103, 232, 249, 0.9)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawReplayNode(ctx, node = {}, graph = {}, options = {}) {
        const token = node.type === core.NODE_TYPES.TOKEN;
        const root = options.root;
        const active = options.active;
        const radius = Math.max(7, Math.min(23, (node.radius || 14) * 0.74)) + (root ? 5 : active ? 4 : 0);
        const pulse = options.playing ? 1 + Math.sin((options.now || 0) / 320) * 0.08 : 1;
        const color = root ? '#f0f9ff' : active ? '#f0abfc' : token ? '#facc15' : '#67e8f9';

        ctx.save();
        ctx.globalAlpha = root ? 0.98 : token ? 0.78 : 0.84;
        ctx.shadowColor = color;
        ctx.shadowBlur = root ? 28 : active ? 30 : 8;
        if (active) {
            ctx.strokeStyle = 'rgba(251, 207, 232, 0.44)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius * 2.08, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(244, 114, 182, 0.18)';
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius * 1.72, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
        ctx.strokeStyle = color;
        ctx.lineWidth = root ? 2.6 : active ? 2.55 : 1.15;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(2.8, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();
        if (root || token || active || (graph.walletNodes || []).length <= 16) {
            ctx.globalAlpha = root ? 0.93 : active ? 0.78 : 0.56;
            ctx.fillStyle = root ? '#f8fafc' : 'rgba(226, 232, 240, 0.76)';
            ctx.font = root ? '700 10px Inter, sans-serif' : '500 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(labelForNode(node), node.x, node.y + radius + 5);
        }
        ctx.restore();
    }

    function drawReplayBackdrop(ctx, width, height, now = 0) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(6, 12, 24, 0.98)');
        gradient.addColorStop(0.52, 'rgba(23, 18, 38, 0.94)');
        gradient.addColorStop(1, 'rgba(5, 11, 22, 0.98)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.052)';
        ctx.lineWidth = 1;
        const offset = (now / 80) % 44;
        for (let x = 22 - offset; x < width; x += 44) {
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

    function drawReplayProgress(ctx, width, height, current, total, playing = false) {
        const barWidth = Math.min(width - 28, 440);
        const x = 14;
        const y = 14;
        const pct = total ? clamp(current / total, 0, 1) : 0;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        roundedRect(ctx, x, y, barWidth, 9, 5);
        ctx.fill();
        ctx.fillStyle = playing ? 'rgba(34, 211, 238, 0.82)' : 'rgba(217, 70, 239, 0.74)';
        roundedRect(ctx, x, y, Math.max(0, barWidth * pct), 9, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, barWidth, 9, 5);
        ctx.stroke();
        drawReplayProgressTicks(ctx, x, y + 12, barWidth, total, current);
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(236, 254, 255, 0.78)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`TIMELINE ${current}/${total}`, x, y + 22);
        ctx.restore();
    }

    function drawReplayProgressTicks(ctx, x, y, width, total, current) {
        if (!total) return;
        const tickCount = Math.min(12, total);
        ctx.save();
        for (let i = 0; i <= tickCount; i += 1) {
            const step = Math.round((total / tickCount) * i);
            const tx = x + width * (i / tickCount);
            ctx.strokeStyle = step <= current ? 'rgba(217, 70, 239, 0.55)' : 'rgba(148, 163, 184, 0.24)';
            ctx.beginPath();
            ctx.moveTo(tx, y);
            ctx.lineTo(tx, y + (i === 0 || i === tickCount ? 7 : 5));
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawReplayStatePill(ctx, width, height, playing = false, current = 0, total = 0) {
        const label = playing ? 'PLAYING' : current >= total && total ? 'ENDED' : current > 0 ? 'PAUSED' : 'READY';
        const text = `${label} ${current}/${total}`;
        const x = 14;
        const y = 54;
        ctx.save();
        ctx.font = '700 10px JetBrains Mono, monospace';
        const w = Math.min(width - 28, Math.max(118, ctx.measureText(text).width + 24));
        roundedRect(ctx, x, y, w, 24, 12);
        ctx.fillStyle = playing ? 'rgba(8, 145, 178, 0.38)' : 'rgba(76, 29, 149, 0.42)';
        ctx.fill();
        ctx.strokeStyle = playing ? 'rgba(103, 232, 249, 0.42)' : 'rgba(240, 171, 252, 0.38)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = playing ? 'rgba(207, 250, 254, 0.9)' : 'rgba(250, 232, 255, 0.86)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 12, y + 12);
        ctx.restore();
    }

    function drawWatermark(ctx, width, height) {
        ctx.save();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.3)';
        ctx.font = '700 10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('PREVIEW ONLY / NOT MERGED / REPLAY', width - 14, height - 12);
        ctx.restore();
    }

    function drawCenteredText(ctx, width, height, text) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.62)';
        ctx.font = '600 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, width / 2, height / 2);
    }

    function getRevealedSets(steps = [], stepIndex = 0) {
        const nodeIds = new Set();
        const edgeIds = new Set();
        steps.slice(0, stepIndex).forEach(step => {
            step.nodeIds.forEach(id => nodeIds.add(id));
            edgeIds.add(step.edgeId);
            step.exposureEdgeIds.forEach(id => edgeIds.add(id));
        });
        return { nodeIds, edgeIds };
    }

    function capPreviewDataset(dataset = {}, limits = DEFAULT_LIMITS) {
        const transactions = (Array.isArray(dataset.transactions) ? dataset.transactions : [])
            .map((transaction, index) => ({ transaction, index, timestamp: timestampValue(transaction.timestamp) }))
            .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
            .slice(0, limits.maxTransactions)
            .map(item => item.transaction);
        const usedWallets = new Set();
        const usedTokens = new Set();
        transactions.forEach(transaction => {
            addUsed(usedWallets, transaction.source_wallet);
            addUsed(usedWallets, transaction.destination_wallet);
            addUsed(usedTokens, transaction.token_mint);
            addUsed(usedTokens, transaction.contract_address);
        });
        const wallets = (Array.isArray(dataset.wallets) ? dataset.wallets : [])
            .filter(wallet => usedWallets.has(normalizeAddress(wallet.address || wallet.wallet_address)))
            .slice(0, limits.maxNodes);
        const tokens = (Array.isArray(dataset.tokens) ? dataset.tokens : [])
            .filter(token => usedTokens.has(normalizeAddress(token.token_mint || token.contract_address || token.address)))
            .slice(0, limits.maxNodes);
        return {
            dataset: {
                metadata: {
                    ...(dataset.metadata || {}),
                    preview_only: true,
                    not_merged: true,
                    active_graph_unchanged: true
                },
                wallets,
                tokens,
                entities: [],
                transactions,
                transaction_groups: Array.isArray(dataset.transaction_groups) ? dataset.transaction_groups.slice(0, 80) : []
            },
            warnings: transactions.length < (dataset.transactions || []).length
                ? [`Replay capped at ${transactions.length} of ${(dataset.transactions || []).length} transfer rows.`]
                : [],
            sourceCounts: {
                transactions: Array.isArray(dataset.transactions) ? dataset.transactions.length : 0
            }
        };
    }

    function buildEmptyGraph(dataset = {}) {
        return {
            metadata: dataset.metadata || {},
            nodes: [],
            edges: [],
            nodeById: new Map(),
            walletNodes: [],
            tokenNodes: [],
            flowEdges: [],
            exposureEdges: [],
            labelEdges: []
        };
    }

    function getTransferKey(transaction = {}, index = 0) {
        return [
            transaction.transaction_hash || transaction.signature || index,
            normalizeAddress(transaction.source_wallet),
            normalizeAddress(transaction.destination_wallet),
            normalizeAddress(transaction.token_mint || transaction.symbol)
        ].join('|');
    }

    function getEdgeTransferKey(edge = {}, index = 0) {
        return [
            edge.transaction_hash || index,
            normalizeAddress(edge.source_wallet),
            normalizeAddress(edge.destination_wallet),
            normalizeAddress(edge.token_mint || edge.symbol)
        ].join('|');
    }

    function getCurve(source, target, bend = 18) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        return {
            start: source,
            control: {
                x: (source.x + target.x) / 2 + normal.x * bend,
                y: (source.y + target.y) / 2 + normal.y * bend
            },
            end: target
        };
    }

    function getCurvePoints(curve, progress = 1, segments = 24) {
        const maxT = clamp(progress, 0, 1);
        const points = [];
        const count = Math.max(2, Math.ceil(segments * maxT));
        for (let index = 0; index <= count; index += 1) {
            points.push(pointOnCurve(curve, maxT * (index / count)));
        }
        return points;
    }

    function pointOnCurve(curve, t) {
        const inverse = 1 - t;
        return {
            x: inverse * inverse * curve.start.x + 2 * inverse * t * curve.control.x + t * t * curve.end.x,
            y: inverse * inverse * curve.start.y + 2 * inverse * t * curve.control.y + t * t * curve.end.y
        };
    }

    function getCanvasSize(canvas) {
        const parent = canvas?.parentElement;
        return {
            width: Math.max(300, Math.floor(parent?.clientWidth || canvas?.clientWidth || 720)),
            height: Math.max(240, Math.floor(parent?.clientHeight || canvas?.clientHeight || 320))
        };
    }

    function getGraphBounds(nodes = []) {
        const xs = nodes.map(node => Number(node.x) || 0);
        const ys = nodes.map(node => Number(node.y) || 0);
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
            width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
            height: Math.max(1, Math.max(...ys) - Math.min(...ys))
        };
    }

    function isTrackedWallet(node = {}, graph = {}) {
        const trackedWallet = normalizeAddress(graph.metadata?.wallet || graph.metadata?.tracked_wallet);
        return Boolean(trackedWallet && normalizeAddress(node.address) === trackedWallet);
    }

    function labelForNode(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return node.symbol || node.name || 'Token';
        return shortValue(node.address || node.label || node.id);
    }

    function previewNodeOrder(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return 0;
        return 1;
    }

    function safeMetadataWarnings(metadata = {}) {
        return [
            ...(Array.isArray(metadata?.warnings) ? metadata.warnings : []),
            ...(Array.isArray(metadata?.replay_generation_warnings) ? metadata.replay_generation_warnings : []),
            ...(Array.isArray(metadata?.gap_flags) && metadata.gap_flags.length ? [`Scan gap flags: ${metadata.gap_flags.join(', ')}`] : [])
        ].map(item => String(item || '').trim()).filter(Boolean).slice(0, 8);
    }

    function dedupeStrings(items = []) {
        const values = [];
        items.forEach(item => {
            const value = String(item || '').trim();
            if (value && !values.includes(value)) values.push(value);
        });
        return values;
    }

    function normalizeLimits(options = {}) {
        return {
            maxTransactions: clampInteger(options.maxTransactions, DEFAULT_LIMITS.maxTransactions, 20, 260),
            maxNodes: clampInteger(options.maxNodes, DEFAULT_LIMITS.maxNodes, 20, 260),
            maxEdges: clampInteger(options.maxEdges, DEFAULT_LIMITS.maxEdges, 20, 360),
            maxParticles: clampInteger(options.maxParticles, DEFAULT_LIMITS.maxParticles, 8, 80)
        };
    }

    function clampInteger(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, Math.round(number)));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number(value) || 0));
    }

    function timestampValue(value) {
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    }

    function normalizeAddress(value) {
        return String(value || '').trim();
    }

    function addUsed(set, value) {
        const normalized = normalizeAddress(value);
        if (normalized) set.add(normalized);
    }

    function summarizeStep(step = {}, stepNumber = 0) {
        return {
            step: Math.max(0, Number(stepNumber) || 0),
            index: step.index ?? null,
            edgeId: step.edgeId || '',
            timestamp: step.timestamp || '',
            signature: step.signature || '',
            amount: step.amount || 0,
            amountDisplay: step.amountDisplay || '',
            token: step.token || '',
            direction: step.direction || '',
            sourceWallet: step.sourceWallet || '',
            destinationWallet: step.destinationWallet || ''
        };
    }

    function shortValue(value) {
        const text = String(value || '');
        if (text.length <= 14) return text || 'Wallet';
        return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
        ctx.beginPath();
        ctx.moveTo(x + safeRadius, y);
        ctx.lineTo(x + width - safeRadius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
        ctx.lineTo(x + width, y + height - safeRadius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
        ctx.lineTo(x + safeRadius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
        ctx.lineTo(x, y + safeRadius);
        ctx.quadraticCurveTo(x, y, x + safeRadius, y);
        ctx.closePath();
    }

    function performanceNow() {
        return window.performance?.now?.() || Date.now();
    }

    namespace.historyReplayAnimator = {
        HISTORY_REPLAY_ANIMATOR_VERSION,
        SPEEDS,
        DEFAULT_LIMITS,
        createReplayAnimator
    };
})();
