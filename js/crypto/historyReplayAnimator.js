(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;

    const HISTORY_REPLAY_ANIMATOR_VERSION = 'd134_replay_audit_history_replay_animator_v1';
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
            auditFilters: normalizeAuditFilters(options.auditFilters),
            neighborhoodFocus: normalizeNeighborhoodFocus(options.neighborhoodFocus),
            selectedStepIndex: 0,
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
            setAuditFilters,
            setNeighborhoodFocus,
            selectStep,
            hitTest,
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
            state.selectedStepIndex = clampInteger(configureOptions.selectedStep ?? state.stepIndex, state.stepIndex, 0, state.steps.length);
            state.auditFilters = normalizeAuditFilters(configureOptions.auditFilters || state.auditFilters);
            state.neighborhoodFocus = normalizeNeighborhoodFocus(configureOptions.neighborhoodFocus || state.neighborhoodFocus);
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
            state.selectedStepIndex = state.stepIndex;
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
            state.selectedStepIndex = state.stepIndex;
            state.done = state.steps.length > 0 && state.stepIndex >= state.steps.length;
            state.lastAdvanceAt = performanceNow();
            render();
            notifyStatus();
            return getStatus();
        }

        function seek(stepIndex = 0) {
            const wasPlaying = state.playing;
            state.stepIndex = clampInteger(stepIndex, state.stepIndex, 0, state.steps.length);
            state.selectedStepIndex = state.stepIndex;
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
            state.selectedStepIndex = 0;
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

        function setAuditFilters(filters = {}) {
            state.auditFilters = normalizeAuditFilters(filters);
            render();
            notifyStatus();
            return getStatus();
        }

        function setNeighborhoodFocus(focus = {}) {
            state.neighborhoodFocus = normalizeNeighborhoodFocus(focus);
            render();
            notifyStatus();
            return getStatus();
        }

        function selectStep(stepIndex = 0) {
            state.selectedStepIndex = clampInteger(stepIndex, state.stepIndex, 0, state.steps.length);
            render();
            notifyStatus();
            return getStatus();
        }

        function hitTest(point = {}) {
            if (!state.canvas || !state.graph || !state.steps.length) return null;
            return hitTestReplayGraph(state.graph, state.steps, {
                point,
                canvas: state.canvas,
                stepIndex: state.stepIndex,
                selectedStepIndex: state.selectedStepIndex,
                playing: state.playing
            });
        }

        function render(now = performanceNow()) {
            if (!state.canvas || state.destroyed) return getStatus();
            drawReplayFrame(state.canvas, state.graph, {
                steps: state.steps,
                stepIndex: state.stepIndex,
                progress: getCurrentStepProgress(now),
                playing: state.playing,
                selectedStepIndex: state.selectedStepIndex,
                auditFilters: state.auditFilters,
                neighborhoodFocus: state.neighborhoodFocus,
                now,
                metadata: state.metadata,
                limits: state.limits
            });
            return getStatus();
        }

        function getStatus() {
            const current = state.stepIndex > 0 ? state.steps[Math.max(0, state.stepIndex - 1)] || {} : {};
            const selected = state.selectedStepIndex > 0 ? state.steps[Math.max(0, state.selectedStepIndex - 1)] || {} : {};
            const speed = SPEEDS[state.speed] || SPEEDS.standard;
            const activePath = buildActivePathMetadata(current, state.graph, state.stepIndex, state.steps.length);
            const audit = buildAuditStatusMetadata(state.steps, selected, state.auditFilters, state.neighborhoodFocus);
            const replayClusters = buildReplayClusterStatus(state.steps);
            const replayNeighborhood = buildReplayNeighborhoodStatus(state.steps, selected, state.neighborhoodFocus);
            return {
                version: HISTORY_REPLAY_ANIMATOR_VERSION,
                previewOnly: true,
                notMerged: true,
                playing: state.playing,
                done: state.done,
                currentStep: state.stepIndex,
                selectedStep: state.selectedStepIndex,
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
                selectedEvent: state.selectedStepIndex ? summarizeStep(selected, state.selectedStepIndex) : null,
                eventSummaries: state.steps.map((step, index) => ({
                    ...summarizeStep(step, index + 1),
                    replayState: index + 1 < state.stepIndex
                        ? 'completed'
                        : index + 1 === state.stepIndex
                            ? 'current'
                            : 'future'
                })),
                activePath,
                audit,
                completedStepCount: activePath.completedStepCount,
                futureStepCount: activePath.futureStepCount,
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
                replayGapMap: state.metadata.replay_gap_map || state.metadata.gap_map || state.metadata.replay_window?.gap_map || state.metadata.replay_reconstruction?.gap_map || null,
                continuityConfidence: state.metadata.replay_continuity_confidence || state.metadata.continuity_confidence || state.metadata.replay_window?.continuity_confidence || state.metadata.replay_reconstruction?.continuity_confidence || null,
                replayNeighborhood,
                replayClusters,
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
                state.selectedStepIndex = state.stepIndex;
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

        const current = options.steps[Math.max(0, options.stepIndex - 1)] || null;
        const selected = options.steps[Math.max(0, Number(options.selectedStepIndex || 0) - 1)] || current;
        const viewport = getReplayViewport(graph, selected || current, size, options);
        const visibility = getReplayVisibilitySets(options.steps, options.stepIndex);
        const audit = getReplayAuditSets(options.steps, selected, options.auditFilters, options.neighborhoodFocus);
        let rootVisible = false;
        graph.nodes.forEach(node => {
            if (!isTrackedWallet(node, graph)) return;
            visibility.completedNodeIds.add(node.id);
            rootVisible = true;
        });
        if (!rootVisible && options.stepIndex === 0 && options.steps[0]?.edge?.source) {
            visibility.completedNodeIds.add(options.steps[0].edge.source);
        }

        ctx.save();
        ctx.translate(viewport.offset.x, viewport.offset.y);
        ctx.scale(viewport.scale, viewport.scale);

        drawReplayFocusHalo(ctx, graph, selected || current, options);
        drawRevealedEdges(ctx, graph, visibility, current, { ...options, selected, audit });
        drawRevealedNodes(ctx, graph, visibility, current, { ...options, selected, audit });
        drawReplayClusterBadges(ctx, graph, options.steps, audit, options);

        ctx.restore();
        drawReplayProgress(ctx, size.width, size.height, options.stepIndex, options.steps.length, options.playing);
        drawReplayStatePill(ctx, size.width, size.height, options.playing, options.stepIndex, options.steps.length);
        drawReplayBoundaryMarkers(ctx, size.width, size.height, options);
        drawReplayGapOverlays(ctx, size.width, size.height, options);
        drawWatermark(ctx, size.width, size.height);
    }

    function drawRevealedEdges(ctx, graph, visibility, current, options) {
        const nodeById = graph.nodeById || new Map();
        const audit = options.audit || {};
        const selectedEdgeId = options.selected?.edgeId || '';
        (graph.exposureEdges || []).forEach(edge => {
            if (!visibility.completedEdgeIds.has(edge.id) && !visibility.currentEdgeIds.has(edge.id)) return;
            const active = visibility.currentEdgeIds.has(edge.id);
            drawReplayEdge(ctx, edge, nodeById, {
                alpha: active ? 0.34 : 0.16,
                progress: 1,
                color: active ? 'rgba(253, 224, 71, 0.5)' : 'rgba(250, 204, 21, 0.28)',
                dashed: true,
                state: active ? 'current' : 'completed'
            });
        });

        let particleCount = 0;
        (graph.flowEdges || [])
            .slice()
            .sort((a, b) => (a.id === selectedEdgeId ? 1 : 0) - (b.id === selectedEdgeId ? 1 : 0))
            .forEach((edge, index) => {
            const isCurrent = current?.edgeId === edge.id || visibility.currentEdgeIds.has(edge.id);
            const isSelected = selectedEdgeId === edge.id;
            const isNeighbor = audit.neighborhoodEdgeIds?.has(edge.id);
            const filterMismatch = audit.filtersActive && !isSelected && !audit.filteredEdgeIds?.has(edge.id);
            const isCompleted = visibility.completedEdgeIds.has(edge.id);
            const isFuture = visibility.futureEdgeIds.has(edge.id) && !isCurrent && !isCompleted && !isSelected;
            if (!isCurrent && !isCompleted && !isFuture && !isSelected) return;
            const progress = isCurrent ? options.progress : 1;
            const baseAlpha = isSelected
                ? 1
                : isCurrent
                    ? 0.94
                    : isNeighbor
                        ? 0.46
                        : isCompleted
                            ? 0.28
                            : 0.045;
            drawReplayEdge(ctx, edge, nodeById, {
                alpha: filterMismatch ? Math.min(baseAlpha, 0.055) : baseAlpha,
                progress,
                color: isSelected
                    ? 'rgba(253, 224, 71, 0.98)'
                    : isCurrent
                    ? 'rgba(244, 114, 182, 0.96)'
                    : isNeighbor
                        ? 'rgba(103, 232, 249, 0.7)'
                    : isCompleted
                        ? 'rgba(125, 211, 252, 0.58)'
                        : 'rgba(148, 163, 184, 0.32)',
                dashed: false,
                active: isCurrent,
                selected: isSelected,
                neighbor: isNeighbor,
                filterMismatch,
                trail: isCompleted,
                future: isFuture,
                state: isSelected ? 'selected' : isCurrent ? 'current' : isCompleted ? 'completed' : 'future'
            });
            if (!isFuture && options.playing && particleCount < options.limits.maxParticles && progress > 0.08) {
                drawFlowParticle(ctx, edge, nodeById, options.now, index, isCurrent ? progress : 1);
                particleCount += 1;
            }
        });
    }

    function drawRevealedNodes(ctx, graph, visibility, current, options) {
        const currentNodeIds = new Set(current?.nodeIds || []);
        const selectedNodeIds = new Set(options.selected?.nodeIds || []);
        const audit = options.audit || {};
        const orderedNodes = graph.nodes
            .slice()
            .sort((a, b) => previewNodeOrder(a) - previewNodeOrder(b));

        orderedNodes.forEach(node => {
            const root = isTrackedWallet(node, graph);
            const active = currentNodeIds.has(node.id);
            const selected = selectedNodeIds.has(node.id);
            const neighbor = audit.neighborhoodNodeIds?.has(node.id);
            const filterMismatch = audit.filtersActive && !selected && !audit.filteredNodeIds?.has(node.id);
            const completed = visibility.completedNodeIds.has(node.id);
            const future = visibility.futureNodeIds.has(node.id) && !active && !completed && !root && !selected;
            if (!future) return;
            drawReplayNode(ctx, node, graph, {
                active: false,
                root: false,
                selected,
                neighbor,
                filterMismatch,
                playing: options.playing,
                now: options.now,
                revealState: 'future'
            });
        });

        orderedNodes.forEach(node => {
            const root = isTrackedWallet(node, graph);
            const active = currentNodeIds.has(node.id);
            const selected = selectedNodeIds.has(node.id);
            const neighbor = audit.neighborhoodNodeIds?.has(node.id);
            const filterMismatch = audit.filtersActive && !selected && !audit.filteredNodeIds?.has(node.id);
            const completed = visibility.completedNodeIds.has(node.id) || root;
            if (!active && !completed && !selected && !neighbor) return;
            drawReplayNode(ctx, node, graph, {
                active,
                root,
                selected,
                neighbor,
                filterMismatch,
                playing: options.playing,
                now: options.now,
                revealState: selected ? 'selected' : active ? 'current' : 'completed'
            });
        });
    }

    function drawReplayEdge(ctx, edge = {}, nodeById = new Map(), options = {}) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const curve = getCurve(source, target, edge.type === core.EDGE_TYPES.FLOW ? 18 : -12);
        const progress = clamp(options.progress, 0, 1);
        const points = getCurvePoints(curve, progress, 26);
        if (points.length < 2) return;
        const baseWidth = edge.type === core.EDGE_TYPES.FLOW
            ? Math.max(1.05, Math.min(3.2, edge.width || 1.4))
            : 0.85;

        ctx.save();
        ctx.globalAlpha = options.alpha;
        ctx.strokeStyle = options.color;
        ctx.lineWidth = options.selected
            ? Math.max(3.4, baseWidth + 2.9)
            : options.neighbor
                ? Math.max(1.4, baseWidth + 0.5)
                : options.future ? Math.max(0.45, baseWidth * 0.58) : options.trail ? Math.max(0.75, baseWidth * 0.82) : baseWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (options.dashed) ctx.setLineDash([5, 8]);
        if (options.active || options.selected) {
            ctx.globalAlpha = Math.min(1, options.alpha * 0.55);
            ctx.strokeStyle = options.selected ? 'rgba(254, 240, 138, 0.62)' : 'rgba(251, 207, 232, 0.56)';
            ctx.lineWidth += options.selected ? 9.5 : 7.5;
            ctx.shadowColor = options.selected ? 'rgba(250, 204, 21, 0.92)' : 'rgba(244, 114, 182, 0.86)';
            ctx.shadowBlur = options.selected ? 30 : 22;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
            ctx.stroke();
            ctx.globalAlpha = options.alpha;
            ctx.strokeStyle = options.color;
            ctx.lineWidth = edge.type === core.EDGE_TYPES.FLOW
                ? Math.max(options.selected ? 3.2 : 2.6, Math.min(options.selected ? 7 : 5.8, (edge.width || 1.4) + (options.selected ? 3.1 : 2.2)))
                : 1.4;
            ctx.shadowBlur = options.selected ? 24 : 16;
        }
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
        ctx.stroke();
        if (options.trail && edge.type === core.EDGE_TYPES.FLOW) {
            drawMyceliumTrail(ctx, points, options);
        }
        ctx.setLineDash([]);
        if (!options.future && edge.type === core.EDGE_TYPES.FLOW && progress >= 0.86) {
            drawReplayArrow(ctx, points[Math.max(0, points.length - 3)], points[points.length - 1], options.active || options.selected, options.selected);
        }
        ctx.restore();
    }

    function drawMyceliumTrail(ctx, points = [], options = {}) {
        if (points.length < 4) return;
        ctx.save();
        ctx.setLineDash([]);
        ctx.globalAlpha = Math.min(0.38, Math.max(0.12, (options.alpha || 0.2) * 0.92));
        ctx.fillStyle = 'rgba(165, 243, 252, 0.78)';
        points.forEach((point, index) => {
            if (index % 5 !== 0) return;
            const radius = index % 10 === 0 ? 1.65 : 1.05;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function drawReplayArrow(ctx, from, to, active = false, selected = false) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const size = selected ? 8.6 : active ? 7.5 : 6;
        ctx.fillStyle = selected ? 'rgba(254, 240, 138, 0.94)' : active ? 'rgba(245, 208, 254, 0.86)' : 'rgba(165, 243, 252, 0.58)';
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
        const selected = options.selected;
        const neighbor = options.neighbor;
        const filterMismatch = options.filterMismatch;
        const future = options.revealState === 'future';
        const radius = Math.max(7, Math.min(23, (node.radius || 14) * 0.74)) + (root ? 5 : selected ? 6 : active ? 4 : neighbor ? 2 : 0);
        const pulse = !future && options.playing ? 1 + Math.sin((options.now || 0) / 320) * 0.08 : 1;
        const color = filterMismatch ? '#64748b' : future ? '#94a3b8' : root ? '#f0f9ff' : selected ? '#fde047' : active ? '#f0abfc' : token ? '#facc15' : '#67e8f9';

        ctx.save();
        ctx.globalAlpha = filterMismatch ? 0.16 : future ? 0.16 : root ? 0.98 : selected ? 0.98 : neighbor ? 0.72 : token ? 0.78 : 0.84;
        ctx.shadowColor = color;
        ctx.shadowBlur = filterMismatch ? 0 : future ? 0 : root ? 28 : selected ? 34 : active ? 30 : neighbor ? 15 : 8;
        if (active || selected) {
            ctx.strokeStyle = selected ? 'rgba(254, 240, 138, 0.5)' : 'rgba(251, 207, 232, 0.44)';
            ctx.lineWidth = selected ? 2.4 : 2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius * (selected ? 2.28 : 2.08), 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = selected ? 'rgba(250, 204, 21, 0.18)' : 'rgba(244, 114, 182, 0.18)';
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius * 1.72, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
        ctx.strokeStyle = color;
        ctx.lineWidth = root ? 2.6 : selected ? 3 : active ? 2.55 : neighbor ? 1.7 : 1.15;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(2.8, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();
        if (!future && !filterMismatch && (root || token || active || selected || neighbor || (graph.walletNodes || []).length <= 16)) {
            ctx.globalAlpha = root ? 0.93 : selected ? 0.9 : active ? 0.78 : neighbor ? 0.66 : 0.56;
            ctx.fillStyle = root ? '#f8fafc' : 'rgba(226, 232, 240, 0.76)';
            ctx.font = root || selected ? '700 10px Inter, sans-serif' : '500 9px Inter, sans-serif';
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

    function drawReplayBoundaryMarkers(ctx, width, height, options = {}) {
        const metadata = options.metadata || {};
        const replayWindow = metadata.replay_window || {};
        const reconstruction = metadata.replay_reconstruction || {};
        const label = replayWindow.window_label
            || reconstruction.current_window_label
            || metadata.replay_window_active?.label
            || 'Staged replay window';
        const partial = replayWindow.partial === true
            || reconstruction.reconstruction_complete !== true
            || metadata.scan_manifest?.full_history_loaded !== true;
        const leftLabel = replayWindow.boundary?.is_oldest_staged_window ? 'OLDEST STAGED BOUNDARY' : 'WINDOW START';
        const rightLabel = replayWindow.boundary?.is_newest_staged_window ? 'NEWEST STAGED BOUNDARY' : 'WINDOW END';
        const y = Math.max(92, Math.min(height - 82, 96));
        ctx.save();
        ctx.globalAlpha = 0.92;
        drawBoundaryLine(ctx, 18, y, Math.max(72, height - 58), leftLabel, 'left');
        drawBoundaryLine(ctx, width - 18, y, Math.max(72, height - 58), rightLabel, 'right');

        const text = `${label}${partial ? ' / PARTIAL STAGED SEGMENT' : ' / STAGED SEGMENT'}`;
        ctx.font = '800 10px JetBrains Mono, monospace';
        const textWidth = Math.min(width - 36, ctx.measureText(text).width + 24);
        const x = Math.max(14, (width - textWidth) / 2);
        roundedRect(ctx, x, height - 48, textWidth, 26, 13);
        ctx.fillStyle = partial ? 'rgba(113, 63, 18, 0.58)' : 'rgba(8, 47, 73, 0.54)';
        ctx.fill();
        ctx.strokeStyle = partial ? 'rgba(250, 204, 21, 0.34)' : 'rgba(103, 232, 249, 0.32)';
        ctx.stroke();
        ctx.fillStyle = partial ? 'rgba(254, 249, 195, 0.88)' : 'rgba(207, 250, 254, 0.86)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, width / 2, height - 35);
        ctx.restore();
    }

    function drawReplayGapOverlays(ctx, width, height, options = {}) {
        const gapMap = normalizeReplayGapMap(options.metadata?.replay_gap_map
            || options.metadata?.gap_map
            || options.metadata?.replay_window?.gap_map
            || options.metadata?.replay_reconstruction?.gap_map
            || null);
        const gaps = gapMap.gaps || [];
        if (!gaps.length && !gapMap.missingWindowsPossible && !gapMap.cursorAmbiguous) return;
        const barWidth = Math.min(width - 28, 440);
        const x = 14;
        const y = 38;
        const markerCount = Math.min(8, Math.max(1, gaps.length));
        ctx.save();
        gaps.slice(0, markerCount).forEach((gap, index) => {
            const pct = gapMap.ordinalStart && gapMap.ordinalEnd && gap.ordinalStart
                ? clamp((gap.ordinalStart - gapMap.ordinalStart) / Math.max(1, gapMap.ordinalEnd - gapMap.ordinalStart + 1), 0.03, 0.97)
                : (index + 1) / (markerCount + 1);
            const mx = x + barWidth * pct;
            ctx.strokeStyle = gap.severity === 'high' ? 'rgba(248, 113, 113, 0.78)' : 'rgba(250, 204, 21, 0.72)';
            ctx.lineWidth = gap.severity === 'high' ? 2 : 1.4;
            ctx.setLineDash(gap.severity === 'high' ? [3, 4] : [2, 5]);
            ctx.beginPath();
            ctx.moveTo(mx, y - 18);
            ctx.lineTo(mx, y + 9);
            ctx.stroke();
        });
        const label = gapMap.providerLimited || gapMap.rateLimited
            ? 'PROVIDER-LIMITED CONTINUITY'
            : gapMap.cursorAmbiguous
                ? 'CURSOR AMBIGUITY'
                : 'GAP-AWARE STAGED REPLAY';
        ctx.setLineDash([]);
        ctx.font = '800 9px JetBrains Mono, monospace';
        const textWidth = Math.min(width - 28, ctx.measureText(label).width + 18);
        roundedRect(ctx, width - textWidth - 14, 14, textWidth, 21, 10);
        ctx.fillStyle = gapMap.providerLimited || gapMap.rateLimited ? 'rgba(127, 29, 29, 0.52)' : 'rgba(113, 63, 18, 0.48)';
        ctx.fill();
        ctx.strokeStyle = gapMap.providerLimited || gapMap.rateLimited ? 'rgba(248, 113, 113, 0.34)' : 'rgba(250, 204, 21, 0.34)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(254, 249, 195, 0.86)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, width - textWidth / 2 - 14, 24.5);
        ctx.restore();
    }

    function drawReplayClusterBadges(ctx, graph = {}, steps = [], audit = {}, options = {}) {
        const clusters = buildVisibleReplayClusters(steps, audit).slice(0, 5);
        if (!clusters.length) return;
        const nodeById = graph.nodeById || new Map();
        ctx.save();
        clusters.forEach(cluster => {
            const nodes = [...cluster.nodeIds].map(id => nodeById.get(id)).filter(Boolean);
            if (!nodes.length) return;
            const center = nodes.reduce((point, node) => ({
                x: point.x + node.x / nodes.length,
                y: point.y + node.y / nodes.length
            }), { x: 0, y: 0 });
            const label = `${cluster.label} ${cluster.count}`;
            ctx.font = '800 8.5px JetBrains Mono, monospace';
            const width = Math.min(132, Math.max(42, ctx.measureText(label).width + 14));
            const x = center.x - width / 2;
            const y = center.y - 34 - (cluster.offset || 0);
            roundedRect(ctx, x, y, width, 18, 8);
            ctx.fillStyle = cluster.active ? 'rgba(217, 70, 239, 0.34)' : 'rgba(15, 23, 42, 0.76)';
            ctx.fill();
            ctx.strokeStyle = cluster.active ? 'rgba(244, 114, 182, 0.62)' : 'rgba(103, 232, 249, 0.34)';
            ctx.stroke();
            ctx.fillStyle = cluster.active ? 'rgba(253, 244, 255, 0.9)' : 'rgba(207, 250, 254, 0.8)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, center.x, y + 9);
        });
        ctx.restore();
    }

    function drawBoundaryLine(ctx, x, y1, y2, label, align = 'left') {
        ctx.save();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.30)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.translate(x + (align === 'left' ? 9 : -9), y1 + 4);
        ctx.rotate(align === 'left' ? Math.PI / 2 : -Math.PI / 2);
        ctx.font = '800 9px JetBrains Mono, monospace';
        ctx.fillStyle = 'rgba(254, 249, 195, 0.64)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0);
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

    function drawReplayFocusHalo(ctx, graph = {}, current = null, options = {}) {
        if (!current?.edge) return;
        const nodeById = graph.nodeById || new Map();
        const source = nodeById.get(current.edge.source);
        const target = nodeById.get(current.edge.target);
        if (!source || !target) return;
        const progress = clamp(options.progress, 0, 1);
        const curve = getCurve(source, target, 18);
        const focus = pointOnCurve(curve, Math.max(0.15, Math.min(0.85, progress || 0.5)));
        const pulse = options.playing ? 1 + Math.sin((options.now || 0) / 260) * 0.08 : 1;

        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = 'rgba(244, 114, 182, 0.28)';
        ctx.lineWidth = 18;
        ctx.shadowColor = 'rgba(244, 114, 182, 0.7)';
        ctx.shadowBlur = 34;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(curve.control.x, curve.control.y, target.x, target.y);
        ctx.stroke();

        ctx.globalAlpha = 0.24;
        ctx.fillStyle = 'rgba(34, 211, 238, 0.2)';
        ctx.beginPath();
        ctx.arc(focus.x, focus.y, 46 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function getReplayViewport(graph = {}, current = null, size = {}, options = {}) {
        const bounds = getGraphBounds(graph.nodes || []);
        const fullScale = Math.min(
            1.08,
            (size.width * 0.8) / Math.max(1, bounds.width),
            (size.height * 0.73) / Math.max(1, bounds.height)
        );
        const fullOffset = {
            x: size.width * 0.5 - (bounds.minX + bounds.width / 2) * fullScale,
            y: size.height * 0.52 - (bounds.minY + bounds.height / 2) * fullScale
        };

        if (!current?.edge || Number(options.stepIndex) <= 0) {
            return { scale: fullScale, offset: fullOffset, mode: 'full' };
        }

        const activeBounds = getActivePathBounds(current, graph.nodeById || new Map(), bounds);
        const focusScale = Math.min(
            1.42,
            Math.max(
                fullScale,
                (size.width * 0.58) / Math.max(1, activeBounds.width + 140),
                (size.height * 0.54) / Math.max(1, activeBounds.height + 120)
            )
        );
        const focusPoint = {
            x: size.width * (size.width < 700 ? 0.5 : 0.58),
            y: size.height * (size.height < 440 ? 0.5 : 0.52)
        };
        const focusOffset = {
            x: focusPoint.x - (activeBounds.minX + activeBounds.width / 2) * focusScale,
            y: focusPoint.y - (activeBounds.minY + activeBounds.height / 2) * focusScale
        };
        const blend = options.playing ? 0.76 : 0.62;
        const scale = lerp(fullScale, focusScale, blend);

        return {
            scale,
            offset: {
                x: lerp(fullOffset.x, focusOffset.x, blend),
                y: lerp(fullOffset.y, focusOffset.y, blend)
            },
            mode: 'active-path'
        };
    }

    function getActivePathBounds(step = {}, nodeById = new Map(), fallback = null) {
        const nodes = [
            nodeById.get(step.edge?.source),
            nodeById.get(step.edge?.target),
            ...(Array.isArray(step.nodeIds) ? step.nodeIds.map(id => nodeById.get(id)) : [])
        ].filter(Boolean);
        if (!nodes.length) return fallback || { minX: 0, minY: 0, width: 1, height: 1 };
        const bounds = getGraphBounds(nodes);
        const margin = 54;
        return {
            minX: bounds.minX - margin,
            maxX: bounds.maxX + margin,
            minY: bounds.minY - margin,
            maxY: bounds.maxY + margin,
            width: bounds.width + margin * 2,
            height: bounds.height + margin * 2
        };
    }

    function getReplayVisibilitySets(steps = [], stepIndex = 0) {
        const completedNodeIds = new Set();
        const completedEdgeIds = new Set();
        const currentNodeIds = new Set();
        const currentEdgeIds = new Set();
        const futureNodeIds = new Set();
        const futureEdgeIds = new Set();
        const currentIndex = Math.max(0, Math.min(steps.length, Number(stepIndex) || 0)) - 1;

        steps.forEach((step, index) => {
            const nodeSet = index < currentIndex
                ? completedNodeIds
                : index === currentIndex
                    ? currentNodeIds
                    : futureNodeIds;
            const edgeSet = index < currentIndex
                ? completedEdgeIds
                : index === currentIndex
                    ? currentEdgeIds
                    : futureEdgeIds;
            (step.nodeIds || []).forEach(id => nodeSet.add(id));
            if (step.edgeId) edgeSet.add(step.edgeId);
            if (index <= currentIndex) {
                (step.exposureEdgeIds || []).forEach(id => edgeSet.add(id));
            }
        });

        return {
            completedNodeIds,
            completedEdgeIds,
            currentNodeIds,
            currentEdgeIds,
            futureNodeIds,
            futureEdgeIds
        };
    }

    function getReplayAuditSets(steps = [], selected = null, filters = {}, neighborhoodFocus = {}) {
        const safeFilters = normalizeAuditFilters(filters);
        const focus = normalizeNeighborhoodFocus(neighborhoodFocus);
        const filtersActive = hasActiveAuditFilters(safeFilters);
        const threshold = getMajorFlowThreshold(steps);
        const filteredStepIds = new Set();
        const filteredEdgeIds = new Set();
        const filteredNodeIds = new Set();
        const neighborhoodEdgeIds = new Set();
        const neighborhoodNodeIds = new Set(selected?.nodeIds || []);
        const expandedStepIds = new Set();
        const selectedSource = normalizeAddress(selected?.sourceWallet);
        const selectedDestination = normalizeAddress(selected?.destinationWallet);

        steps.forEach(step => {
            const matches = stepMatchesAuditFilters(step, safeFilters, threshold);
            if (matches) {
                filteredStepIds.add(step.index);
                if (step.edgeId) filteredEdgeIds.add(step.edgeId);
                (step.nodeIds || []).forEach(id => filteredNodeIds.add(id));
            }
            const sharesWallet = selected && (
                normalizeAddress(step.sourceWallet) === selectedSource
                || normalizeAddress(step.sourceWallet) === selectedDestination
                || normalizeAddress(step.destinationWallet) === selectedSource
                || normalizeAddress(step.destinationWallet) === selectedDestination
            );
            if (sharesWallet || step.edgeId === selected?.edgeId) {
                if (step.edgeId) neighborhoodEdgeIds.add(step.edgeId);
                (step.nodeIds || []).forEach(id => neighborhoodNodeIds.add(id));
            }
            if (stepMatchesNeighborhoodFocus(step, selected, focus)) {
                expandedStepIds.add(step.index);
                if (step.edgeId) neighborhoodEdgeIds.add(step.edgeId);
                (step.nodeIds || []).forEach(id => neighborhoodNodeIds.add(id));
            }
        });

        return {
            filtersActive,
            neighborhoodActive: focus.mode !== 'none',
            neighborhoodFocus: focus,
            filteredStepIds,
            filteredEdgeIds,
            filteredNodeIds,
            neighborhoodEdgeIds,
            neighborhoodNodeIds,
            expandedStepIds
        };
    }

    function buildAuditStatusMetadata(steps = [], selected = null, filters = {}, neighborhoodFocus = {}) {
        const audit = getReplayAuditSets(steps, selected, filters, neighborhoodFocus);
        return {
            previewOnly: true,
            notMerged: true,
            filters: normalizeAuditFilters(filters),
            filtersActive: audit.filtersActive,
            neighborhoodActive: audit.neighborhoodActive,
            neighborhoodFocus: audit.neighborhoodFocus,
            filteredStepCount: audit.filteredEdgeIds.size,
            selectedStep: selected?.index != null ? Number(selected.index) + 1 : 0,
            selectedEdgeId: selected?.edgeId || '',
            selectedNodeIds: Array.isArray(selected?.nodeIds) ? selected.nodeIds.slice() : [],
            localNeighborhoodEdgeCount: audit.neighborhoodEdgeIds.size,
            expandedStepCount: audit.expandedStepIds.size
        };
    }

    function hitTestReplayGraph(graph = {}, steps = [], options = {}) {
        const point = options.point || {};
        const size = getCanvasSize(options.canvas);
        const stepIndex = Math.max(0, Number(options.stepIndex) || 0);
        const selectedStepIndex = Math.max(0, Number(options.selectedStepIndex) || 0);
        const focusStep = steps[Math.max(0, (selectedStepIndex || stepIndex) - 1)] || steps[Math.max(0, stepIndex - 1)] || null;
        const viewport = getReplayViewport(graph, focusStep, size, {
            stepIndex,
            selectedStepIndex,
            playing: Boolean(options.playing),
            progress: 1
        });
        const world = {
            x: (Number(point.x) - viewport.offset.x) / viewport.scale,
            y: (Number(point.y) - viewport.offset.y) / viewport.scale
        };
        const nodeHit = findReplayNodeHit(graph, world, viewport.scale);
        if (nodeHit) {
            const relatedSteps = getStepsForNode(steps, nodeHit.node.id);
            return {
                type: 'node',
                nodeId: nodeHit.node.id,
                nodeType: nodeHit.node.type || '',
                wallet: nodeHit.node.address || '',
                token: nodeHit.node.token_mint || nodeHit.node.symbol || '',
                step: relatedSteps[0] ? Number(relatedSteps[0].index) + 1 : 0,
                relatedSteps: relatedSteps.map(step => Number(step.index) + 1),
                previewOnly: true,
                notMerged: true
            };
        }
        const edgeHit = findReplayEdgeHit(graph, world, viewport.scale);
        if (!edgeHit) return null;
        const step = steps.find(item => item.edgeId === edgeHit.edge.id) || null;
        return {
            type: 'edge',
            edgeId: edgeHit.edge.id,
            step: step ? Number(step.index) + 1 : 0,
            event: step ? summarizeStep(step, Number(step.index) + 1) : null,
            distance: edgeHit.distance,
            previewOnly: true,
            notMerged: true
        };
    }

    function findReplayNodeHit(graph = {}, world = {}, scale = 1) {
        const tolerance = Math.max(8, 13 / Math.max(0.4, scale));
        return (graph.nodes || [])
            .slice()
            .sort((a, b) => Math.hypot(world.x - a.x, world.y - a.y) - Math.hypot(world.x - b.x, world.y - b.y))
            .map(node => {
                const radius = Math.max(7, Math.min(28, (node.radius || 14) * 0.82));
                const distance = Math.hypot(world.x - node.x, world.y - node.y);
                return { node, distance, radius };
            })
            .find(item => item.distance <= item.radius + tolerance) || null;
    }

    function findReplayEdgeHit(graph = {}, world = {}, scale = 1) {
        const nodeById = graph.nodeById || new Map();
        const tolerance = Math.max(7, 12 / Math.max(0.4, scale));
        return (graph.flowEdges || [])
            .map(edge => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return null;
                const distance = distanceToCurve(world, getCurve(source, target, 18), 28);
                return { edge, distance };
            })
            .filter(Boolean)
            .sort((a, b) => a.distance - b.distance)
            .find(item => item.distance <= tolerance) || null;
    }

    function getStepsForNode(steps = [], nodeId = '') {
        if (!nodeId) return [];
        return steps.filter(step => (step.nodeIds || []).includes(nodeId));
    }

    function distanceToCurve(point, curve, segments = 24) {
        let minDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index <= segments; index += 1) {
            const curvePoint = pointOnCurve(curve, index / segments);
            minDistance = Math.min(minDistance, Math.hypot(point.x - curvePoint.x, point.y - curvePoint.y));
        }
        return minDistance;
    }

    function stepMatchesNeighborhoodFocus(step = {}, selected = null, focus = {}) {
        const safeFocus = normalizeNeighborhoodFocus(focus);
        if (safeFocus.mode === 'none') return false;
        const source = normalizeAddress(step.sourceWallet);
        const destination = normalizeAddress(step.destinationWallet);
        const token = normalizeFilterValue(step.token);
        const route = getStepRouteKey(step);
        if (safeFocus.mode === 'wallet') return safeFocus.wallet && (source === safeFocus.wallet || destination === safeFocus.wallet);
        if (safeFocus.mode === 'route') return safeFocus.route && route === safeFocus.route;
        if (safeFocus.mode === 'token') return safeFocus.token !== 'all' && token === safeFocus.token;
        if (safeFocus.mode === 'counterparties') {
            const selectedWallets = new Set([
                normalizeAddress(selected?.sourceWallet),
                normalizeAddress(selected?.destinationWallet)
            ].filter(Boolean));
            return selectedWallets.has(source) || selectedWallets.has(destination);
        }
        if (safeFocus.mode === 'cluster') {
            if (safeFocus.route && route === safeFocus.route) return true;
            if (safeFocus.token !== 'all' && token === safeFocus.token) return true;
            if (safeFocus.wallet && (source === safeFocus.wallet || destination === safeFocus.wallet)) return true;
            return false;
        }
        if (safeFocus.mode === 'transfer' && selected) {
            const selectedRoute = getStepRouteKey(selected);
            const selectedToken = normalizeFilterValue(selected.token);
            return (selectedRoute && route === selectedRoute)
                || (selectedToken !== 'all' && token === selectedToken)
                || source === normalizeAddress(selected.sourceWallet)
                || source === normalizeAddress(selected.destinationWallet)
                || destination === normalizeAddress(selected.sourceWallet)
                || destination === normalizeAddress(selected.destinationWallet);
        }
        return false;
    }

    function normalizeNeighborhoodFocus(focus = {}) {
        const value = focus && typeof focus === 'object' && !Array.isArray(focus) ? focus : {};
        const mode = String(value.mode || 'none');
        return {
            mode: ['none', 'transfer', 'wallet', 'counterparties', 'route', 'token', 'cluster'].includes(mode) ? mode : 'none',
            wallet: normalizeAddress(value.wallet),
            token: normalizeFilterValue(value.token || 'all'),
            route: String(value.route || ''),
            clusterKey: String(value.clusterKey || value.cluster_key || ''),
            clusterKind: String(value.clusterKind || value.cluster_kind || '')
        };
    }

    function getStepRouteKey(step = {}) {
        const source = normalizeAddress(step.sourceWallet);
        const destination = normalizeAddress(step.destinationWallet);
        return source && destination ? `${source}>${destination}` : '';
    }

    function buildReplayNeighborhoodStatus(steps = [], selected = null, focus = {}) {
        const safeFocus = normalizeNeighborhoodFocus(focus);
        const matching = steps.filter(step => stepMatchesNeighborhoodFocus(step, selected, safeFocus));
        return {
            previewOnly: true,
            stagedHistoryOnly: true,
            mode: safeFocus.mode,
            active: safeFocus.mode !== 'none',
            stepCount: matching.length,
            steps: matching.map(step => Number(step.index) + 1).slice(0, 18),
            capped: matching.length > 18
        };
    }

    function buildReplayClusterStatus(steps = []) {
        const clusters = buildReplayClusters(steps);
        return {
            previewOnly: true,
            stagedHistoryOnly: true,
            total: clusters.length,
            clusters: clusters.slice(0, 8).map(cluster => ({
                kind: cluster.kind,
                label: cluster.label,
                count: cluster.count,
                steps: cluster.steps.slice(0, 18)
            })),
            capped: clusters.length > 8
        };
    }

    function buildVisibleReplayClusters(steps = [], audit = {}) {
        const clusters = buildReplayClusters(steps);
        const activeNodeIds = audit.neighborhoodNodeIds || new Set();
        return clusters
            .map((cluster, index) => ({
                ...cluster,
                active: [...cluster.nodeIds].some(id => activeNodeIds.has(id)),
                offset: (index % 3) * 10
            }))
            .filter(cluster => cluster.count >= 2)
            .sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count)
            .slice(0, 5);
    }

    function buildReplayClusters(steps = []) {
        const maps = {
            route: new Map(),
            token: new Map(),
            wallet: new Map()
        };
        const add = (map, key, partial, step) => {
            if (!key) return;
            const record = map.get(key) || {
                key,
                kind: partial.kind,
                label: partial.label,
                count: 0,
                steps: [],
                nodeIds: new Set()
            };
            record.count += 1;
            record.steps.push(Number(step.index) + 1);
            (step.nodeIds || []).forEach(id => record.nodeIds.add(id));
            map.set(key, record);
        };
        steps.forEach(step => {
            const route = getStepRouteKey(step);
            add(maps.route, route, { kind: 'route', label: 'Route' }, step);
            const token = normalizeFilterValue(step.token);
            if (token !== 'all') add(maps.token, token, { kind: 'token', label: token }, step);
            [step.sourceWallet, step.destinationWallet].map(normalizeAddress).filter(Boolean).forEach(wallet => {
                add(maps.wallet, wallet, { kind: 'wallet', label: shortValue(wallet) }, step);
            });
        });
        return [...maps.route.values(), ...maps.token.values(), ...maps.wallet.values()]
            .filter(cluster => cluster.count >= (cluster.kind === 'wallet' ? 3 : 2))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }

    function normalizeReplayGapMap(gapMap = null) {
        if (!gapMap || typeof gapMap !== 'object' || Array.isArray(gapMap)) {
            return { gaps: [], boundaryMarkers: [], missingWindowsPossible: false, cursorAmbiguous: false, providerLimited: false, rateLimited: false };
        }
        return {
            ordinalStart: Math.max(0, Number(gapMap.ordinalStart || gapMap.ordinal_start) || 0),
            ordinalEnd: Math.max(0, Number(gapMap.ordinalEnd || gapMap.ordinal_end) || 0),
            missingWindowsPossible: gapMap.missingWindowsPossible === true || gapMap.missing_windows_possible === true,
            cursorAmbiguous: gapMap.cursorAmbiguous === true || gapMap.cursor_ambiguous === true,
            providerLimited: gapMap.providerLimited === true || gapMap.provider_limited === true,
            rateLimited: gapMap.rateLimited === true || gapMap.rate_limited === true,
            gaps: Array.isArray(gapMap.gaps) ? gapMap.gaps.slice(0, 10).map(gap => ({
                code: String(gap.code || ''),
                label: String(gap.label || gap.code || 'Gap'),
                severity: String(gap.severity || 'medium'),
                ordinalStart: Math.max(0, Number(gap.ordinalStart || gap.ordinal_start) || 0),
                ordinalEnd: Math.max(0, Number(gap.ordinalEnd || gap.ordinal_end) || 0)
            })) : []
        };
    }

    function normalizeAuditFilters(filters = {}) {
        return {
            token: String(filters.token || 'all'),
            direction: String(filters.direction || 'all'),
            counterparty: String(filters.counterparty || 'all'),
            majorOnly: filters.majorOnly === true || filters.majorOnly === 'true'
        };
    }

    function hasActiveAuditFilters(filters = {}) {
        const safeFilters = normalizeAuditFilters(filters);
        return safeFilters.token !== 'all'
            || safeFilters.direction !== 'all'
            || safeFilters.counterparty !== 'all'
            || safeFilters.majorOnly;
    }

    function stepMatchesAuditFilters(step = {}, filters = {}, majorThreshold = 0) {
        const safeFilters = normalizeAuditFilters(filters);
        const token = normalizeFilterValue(safeFilters.token);
        if (token !== 'all' && normalizeFilterValue(step.token) !== token) return false;
        const direction = normalizeDirectionValue(safeFilters.direction);
        if (direction !== 'all' && normalizeDirectionValue(step.direction) !== direction) return false;
        const counterparty = normalizeAddress(safeFilters.counterparty);
        if (counterparty && counterparty !== 'all') {
            const source = normalizeAddress(step.sourceWallet);
            const destination = normalizeAddress(step.destinationWallet);
            if (source !== counterparty && destination !== counterparty) return false;
        }
        if (safeFilters.majorOnly) {
            const amount = Math.abs(Number(step.amount) || 0);
            if (!majorThreshold || amount < majorThreshold) return false;
        }
        return true;
    }

    function getMajorFlowThreshold(steps = []) {
        const amounts = steps
            .map(step => Math.abs(Number(step.amount) || 0))
            .filter(value => value > 0)
            .sort((a, b) => a - b);
        if (!amounts.length) return 0;
        return amounts[Math.min(amounts.length - 1, Math.floor(amounts.length * 0.75))] || 0;
    }

    function normalizeFilterValue(value = '') {
        const text = String(value || '').trim();
        if (!text || text.toLowerCase() === 'all') return 'all';
        return text ? text.toUpperCase() : 'all';
    }

    function normalizeDirectionValue(value = '') {
        const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!text || text === 'all') return 'all';
        return text || 'all';
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
            width: Math.max(260, Math.floor(parent?.clientWidth || canvas?.clientWidth || 720)),
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

    function buildActivePathMetadata(step = {}, graph = {}, stepIndex = 0, totalSteps = 0) {
        const edge = step.edge || {};
        const nodeIds = [...new Set([
            edge.source,
            edge.target,
            ...(Array.isArray(step.nodeIds) ? step.nodeIds : [])
        ].filter(Boolean))];
        return {
            edgeId: step.edgeId || edge.id || '',
            sourceNodeId: edge.source || '',
            destinationNodeId: edge.target || '',
            nodeIds,
            sourceWallet: step.sourceWallet || edge.source_wallet || '',
            destinationWallet: step.destinationWallet || edge.destination_wallet || '',
            signature: step.signature || edge.transaction_hash || '',
            token: step.token || edge.symbol || edge.token_mint || '',
            step: Math.max(0, Number(stepIndex) || 0),
            totalSteps: Math.max(0, Number(totalSteps) || 0),
            completedStepCount: Math.max(0, Math.min(Math.max(0, Number(totalSteps) || 0), (Number(stepIndex) || 0) > 0 ? (Number(stepIndex) || 0) - 1 : 0)),
            futureStepCount: Math.max(0, (Number(totalSteps) || 0) - (Number(stepIndex) || 0)),
            previewOnly: true,
            notMerged: true,
            cameraMode: step?.edge ? 'active-path' : 'full-replay'
        };
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

    function lerp(start, end, amount) {
        return start + (end - start) * clamp(amount, 0, 1);
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
