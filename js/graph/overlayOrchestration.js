(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const PLAN_VERSION = 'd172_overlay_orchestration_v1';
    const PRIORITY = {
        selection: 100,
        routeComparison: 92,
        route: 88,
        guided: 78,
        analyst: 68,
        ecosystem: 58,
        sourceCoverage: 52,
        navigation: 48,
        topology: 42
    };

    function createOverlayOrchestrator(options = {}) {
        const cache = createLru(Math.max(12, Number(options.maxEntries) || 48));

        function buildPlan(context = {}) {
            const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
            const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
            const density = normalizeDensity(context.graphScalingModel?.density, nodes.length, links.length);
            const semantic = context.stockSemanticZoomState || context.semanticZoom || {};
            const signature = getSignature(context, nodes, links, density, semantic);
            const cached = cache.get(signature);
            if (cached) return cached;

            const layers = collectLayers(context);
            const activeLayers = layers
                .filter(layer => layer.active)
                .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
            const focusActive = Boolean(context.selectedNode || context.selectedRelationshipLink || context.activeRelationshipRoute || context.activeRouteComparison);
            const cluttered = ['mega', 'very_dense'].includes(density.key) || semantic.tier === 'macro';
            const keepCount = cluttered && !focusActive ? 2 : cluttered ? 3 : 4;
            const visibleLayers = activeLayers.slice(0, keepCount);
            const suppressedLayers = activeLayers.slice(keepCount);
            const visibleLayerKeys = new Set(visibleLayers.map(layer => layer.key));
            const suppressedLayerKeys = new Set(suppressedLayers.map(layer => layer.key));
            const dominant = visibleLayers[0] || null;
            const conflicts = buildConflictSet(activeLayers);
            const edgePolicy = buildEdgePolicy({ density, semantic, activeLayers, visibleLayers, focusActive });
            const labelPolicy = buildLabelPolicy({ density, semantic, activeLayers, visibleLayers, focusActive });

            const plan = {
                version: PLAN_VERSION,
                signature,
                densityKey: density.key,
                semanticTier: semantic.tier || 'relationship',
                layers,
                activeLayers,
                visibleLayers,
                suppressedLayers,
                visibleLayerKeys,
                suppressedLayerKeys,
                dominant,
                conflicts,
                edgePolicy,
                labelPolicy,
                summary: {
                    activeLayerCount: activeLayers.length,
                    visibleLayerCount: visibleLayers.length,
                    suppressedLayerCount: suppressedLayers.length,
                    dominantLabel: dominant?.label || '',
                    conflictSuppression: conflicts.size > 0 || suppressedLayers.length > 0,
                    readabilityGated: cluttered,
                    derivedOnly: true,
                    noClutterExpansion: true
                },
                createdAt: Date.now()
            };
            cache.set(signature, plan);
            return plan;
        }

        return {
            buildPlan,
            getCacheStats: () => cache.stats()
        };
    }

    function getLinkAdjustment(plan = null, link = null, visual = {}) {
        if (!plan || !link) return defaultAdjustment();
        const protectedEdge = Boolean(visual.route || visual.routeComparison?.active || visual.selected || visual.guided || visual.forceDraw);
        if (protectedEdge) {
            return {
                draw: true,
                alphaMultiplier: 1,
                widthMultiplier: 1,
                shadowMultiplier: 1,
                priorityBoost: 900,
                reason: 'protected'
            };
        }

        const matching = getVisualLayerKeys(visual);
        const hidden = matching.some(key => plan.suppressedLayerKeys?.has(key));
        const visible = matching.some(key => plan.visibleLayerKeys?.has(key));
        const background = plan.activeLayers?.length && !matching.length;
        if (hidden) {
            return {
                draw: plan.edgePolicy.hiddenLayerDraw,
                alphaMultiplier: plan.edgePolicy.hiddenLayerAlpha,
                widthMultiplier: plan.edgePolicy.hiddenLayerWidth,
                shadowMultiplier: 0.42,
                priorityBoost: -120,
                reason: 'layer-suppressed'
            };
        }
        if (visible) {
            return {
                draw: true,
                alphaMultiplier: plan.edgePolicy.activeLayerAlpha,
                widthMultiplier: plan.edgePolicy.activeLayerWidth,
                shadowMultiplier: 1.08,
                priorityBoost: 180,
                reason: 'visible-layer'
            };
        }
        if (background) {
            return {
                draw: true,
                alphaMultiplier: plan.edgePolicy.backgroundAlpha,
                widthMultiplier: plan.edgePolicy.backgroundWidth,
                shadowMultiplier: 0.72,
                priorityBoost: 0,
                reason: 'background-layer'
            };
        }
        return defaultAdjustment();
    }

    function getNodeAdjustment(plan = null, node = null, visual = {}) {
        if (!plan || !node) return defaultNodeAdjustment();
        const protectedNode = Boolean(visual.route || visual.routeComparison?.active || visual.selectedEdgeEndpoint || visual.guided);
        if (protectedNode) {
            return {
                alphaMultiplier: 1,
                radiusMultiplier: 1.04,
                glowMultiplier: 1.08,
                labelPriorityBoost: 520,
                reason: 'protected'
            };
        }
        const matching = getVisualLayerKeys(visual);
        const hidden = matching.some(key => plan.suppressedLayerKeys?.has(key));
        const visible = matching.some(key => plan.visibleLayerKeys?.has(key));
        const background = plan.activeLayers?.length && !matching.length;
        if (hidden) {
            return {
                alphaMultiplier: plan.labelPolicy.hiddenLayerNodeAlpha,
                radiusMultiplier: 0.96,
                glowMultiplier: 0.72,
                labelPriorityBoost: -80,
                reason: 'layer-suppressed'
            };
        }
        if (visible) {
            return {
                alphaMultiplier: 1,
                radiusMultiplier: 1.02,
                glowMultiplier: 1.08,
                labelPriorityBoost: plan.labelPolicy.activeLayerLabelBoost,
                reason: 'visible-layer'
            };
        }
        if (background) {
            return {
                alphaMultiplier: plan.labelPolicy.backgroundNodeAlpha,
                radiusMultiplier: 1,
                glowMultiplier: 0.86,
                labelPriorityBoost: 0,
                reason: 'background-layer'
            };
        }
        return defaultNodeAdjustment();
    }

    function getReadabilitySummary(plan = null, options = {}) {
        const readability = options.readabilityModel || {};
        const route = options.activeRouteComparison || options.activeRelationshipRoute || null;
        const selected = options.selectedNode || options.selectedRelationshipLink || null;
        const visibleLayers = Array.isArray(plan?.visibleLayers) ? plan.visibleLayers : [];
        const activeLayers = Array.isArray(plan?.activeLayers) ? plan.activeLayers : [];
        const suppressedLayers = Array.isArray(plan?.suppressedLayers) ? plan.suppressedLayers : [];
        const labelMultiplier = Number(plan?.labelPolicy?.labelLimitMultiplier || 1);
        const tickerBudget = Number(readability?.budgets?.tickerLabelBudget || 0);
        const fullBudget = Number(readability?.budgets?.fullLabelBudget || 0);
        const suppressedEdgeCount = count(readability?.suppressedLinkKeys) || Number(readability?.budgets?.suppressedEstimate || 0);
        const protectedEdgeCount = count(readability?.protectedLinkKeys) ||
            Number(readability?.budgets?.protectedLinkCount || 0) ||
            count(route?.linkKeys) ||
            (selected ? 1 : 0);
        return {
            available: Boolean(plan),
            activeOverlayLayer: plan?.dominant?.label || visibleLayers[0]?.label || activeLayers[0]?.label || 'None',
            activeLayerCount: activeLayers.length,
            visibleLayerCount: visibleLayers.length,
            suppressedLayerCount: suppressedLayers.length,
            suppressedLayerLabels: suppressedLayers.map(layer => layer.label).filter(Boolean).slice(0, 4),
            labelBudgetState: tickerBudget || fullBudget
                ? `${tickerBudget || 0} ticker / ${fullBudget || 0} full`
                : `x${labelMultiplier.toFixed(2)}`,
            labelLimitMultiplier: labelMultiplier,
            edgeSuppressionState: suppressedEdgeCount
                ? `${suppressedEdgeCount} edge${suppressedEdgeCount === 1 ? '' : 's'} gated`
                : 'No edge gating',
            suppressedEdgeCount,
            protectedPathState: protectedEdgeCount
                ? `${protectedEdgeCount} protected`
                : 'None active',
            protectedEdgeCount,
            readabilityGatingStatus: plan?.summary?.readabilityGated
                ? 'Density gated'
                : plan ? 'Open'
                    : 'Unavailable',
            conflictSuppression: Boolean(plan?.summary?.conflictSuppression),
            derivedOnly: Boolean(plan?.summary?.derivedOnly ?? true)
        };
    }

    function collectLayers(context = {}) {
        const model = context.graphIntelligenceModel || {};
        return [
            layer('selection', 'Selection', PRIORITY.selection, Boolean(context.selectedNode || context.selectedRelationshipLink), {
                nodeCount: context.selectedNode ? 1 : 0,
                edgeCount: context.selectedRelationshipLink ? 1 : 0
            }),
            layer('routeComparison', 'Route comparison', PRIORITY.routeComparison, Boolean(context.activeRouteComparison), {
                edgeCount: context.activeRouteComparison?.linkKeys?.size || 0,
                nodeCount: context.activeRouteComparison?.nodeIds?.size || 0
            }),
            layer('route', 'Route', PRIORITY.route, Boolean(context.activeRelationshipRoute), {
                edgeCount: context.activeRelationshipRoute?.linkKeys?.size || 0,
                nodeCount: context.activeRelationshipRoute?.nodeIds?.size || 0
            }),
            layer('guided', model.guidedDiscovery?.shortLabel || 'Guided discovery', PRIORITY.guided, Boolean(model.guidedDiscovery), {
                edgeCount: model.guidedDiscovery?.linkKeys?.size || model.guidedDiscovery?.links?.length || 0,
                nodeCount: model.guidedDiscovery?.nodeIds?.size || model.guidedDiscovery?.nodes?.length || 0
            }),
            layer('analyst', model.analystOverlay?.shortLabel || 'Analyst layer', PRIORITY.analyst, Boolean(model.analystOverlay?.active), {
                edgeCount: model.analystOverlay?.edgeCount || model.analystOverlay?.linkKeys?.size || 0,
                nodeCount: model.analystOverlay?.nodeCount || model.analystOverlay?.nodeIds?.size || 0
            }),
            layer('ecosystem', model.overlay?.shortLabel || 'Ecosystem overlay', PRIORITY.ecosystem, Boolean(model.overlay), {
                edgeCount: model.overlay?.linkKeys?.size || model.overlay?.links?.length || 0,
                nodeCount: model.overlay?.nodeIds?.size || model.overlay?.nodes?.length || 0
            }),
            layer('sourceCoverage', 'Evidence lens', PRIORITY.sourceCoverage, Boolean(context.sourceCoverageLensEnabled), {
                edgeCount: context.visibleLinks?.length || 0,
                nodeCount: context.visibleNodes?.length || 0
            }),
            layer('navigation', context.largeGraphNavigationModel?.modeShortLabel || 'Navigation', PRIORITY.navigation, Boolean(context.largeGraphNavigationModel?.isActive), {
                edgeCount: context.largeGraphNavigationModel?.linkKeys?.size || 0,
                nodeCount: context.largeGraphNavigationModel?.nodeIds?.size || 0
            }),
            layer('topology', context.graphTopologyModel?.semanticSummary?.headline || 'Topology', PRIORITY.topology, Boolean(context.graphTopologyModel), {
                edgeCount: context.graphTopologyModel?.routeImportance?.links?.length || 0,
                nodeCount: context.graphTopologyModel?.concentrationZones?.length || 0
            })
        ];
    }

    function layer(key, label, priority, active, meta = {}) {
        return {
            key,
            label,
            priority,
            active,
            edgeCount: Number(meta.edgeCount) || 0,
            nodeCount: Number(meta.nodeCount) || 0
        };
    }

    function buildConflictSet(layers) {
        const conflicts = new Set();
        if (layers.length <= 1) return conflicts;
        const activeKeys = new Set(layers.map(layer => layer.key));
        if (activeKeys.has('sourceCoverage') && activeKeys.has('ecosystem')) conflicts.add('sourceCoverage:ecosystem');
        if (activeKeys.has('sourceCoverage') && activeKeys.has('analyst')) conflicts.add('sourceCoverage:analyst');
        if (activeKeys.has('topology') && (activeKeys.has('routeComparison') || activeKeys.has('route'))) conflicts.add('topology:route');
        if (activeKeys.has('navigation') && activeKeys.has('ecosystem')) conflicts.add('navigation:ecosystem');
        return conflicts;
    }

    function buildEdgePolicy({ density, semantic, activeLayers, visibleLayers, focusActive }) {
        const dense = ['mega', 'very_dense'].includes(density.key);
        const macro = semantic.tier === 'macro';
        const layered = activeLayers.length > 1;
        return {
            backgroundAlpha: dense ? (focusActive ? 0.5 : 0.34) : layered ? 0.58 : 1,
            backgroundWidth: dense ? 0.74 : layered ? 0.86 : 1,
            activeLayerAlpha: macro ? 0.88 : 1,
            activeLayerWidth: visibleLayers.length > 2 ? 0.92 : 1,
            hiddenLayerAlpha: dense ? 0.18 : 0.32,
            hiddenLayerWidth: dense ? 0.48 : 0.64,
            hiddenLayerDraw: true
        };
    }

    function buildLabelPolicy({ density, semantic, activeLayers, focusActive }) {
        const dense = ['mega', 'very_dense'].includes(density.key);
        const layered = activeLayers.length > 1;
        return {
            backgroundNodeAlpha: dense && !focusActive ? 0.72 : layered ? 0.82 : 1,
            hiddenLayerNodeAlpha: dense ? 0.54 : 0.68,
            activeLayerLabelBoost: semantic.tier === 'macro' ? 260 : 180,
            labelLimitMultiplier: dense && layered ? 0.72 : layered ? 0.86 : 1
        };
    }

    function getVisualLayerKeys(visual = {}) {
        const keys = [];
        if (visual.routeComparison?.active) keys.push('routeComparison');
        if (visual.route) keys.push('route');
        if (visual.guided) keys.push('guided');
        if (visual.analystOverlay) keys.push('analyst');
        if (visual.overlay) keys.push('ecosystem');
        if (visual.sourceCoverage) keys.push('sourceCoverage');
        if (visual.navigation) keys.push('navigation');
        if (visual.topology) keys.push('topology');
        if (visual.selected || visual.selectedEdgeEndpoint) keys.push('selection');
        return keys;
    }

    function defaultAdjustment() {
        return {
            draw: true,
            alphaMultiplier: 1,
            widthMultiplier: 1,
            shadowMultiplier: 1,
            priorityBoost: 0,
            reason: 'none'
        };
    }

    function defaultNodeAdjustment() {
        return {
            alphaMultiplier: 1,
            radiusMultiplier: 1,
            glowMultiplier: 1,
            labelPriorityBoost: 0,
            reason: 'none'
        };
    }

    function count(value) {
        if (Array.isArray(value)) return value.length;
        if (value instanceof Map || value instanceof Set) return value.size;
        return 0;
    }

    function normalizeDensity(source = {}, nodeCount = 0, edgeCount = 0) {
        const ratio = Number(source.ratio || source.density || edgeCount / Math.max(1, nodeCount)) || 0;
        const key = source.key || (nodeCount > 520 || edgeCount > 1100 || ratio > 4.2
            ? 'mega'
            : nodeCount > 160 || edgeCount > 360 || ratio > 3.15
                ? 'very_dense'
                : nodeCount > 100 || edgeCount > 210 || ratio > 2.25
                    ? 'dense'
                    : 'core');
        return { key, nodeCount, edgeCount, ratio };
    }

    function getSignature(context, nodes, links, density, semantic) {
        return [
            nodes.length,
            links.length,
            density.key,
            semantic.tier || '',
            context.selectedNode?.id || '',
            context.selectedRelationshipLink?.key || '',
            context.activeRouteComparison?.id || '',
            context.activeRelationshipRoute?.id || '',
            context.activeEcosystemOverlayKey || '',
            context.activeGuidedDiscoveryKey || '',
            context.activeAnalystOverlayKey || '',
            context.sourceCoverageLensEnabled ? 1 : 0,
            context.largeGraphNavigationModel?.cacheKey || context.largeGraphNavigationModel?.mode || '',
            context.graphTopologyModel?.signature || ''
        ].join('|');
    }

    function createLru(limit) {
        const map = new Map();
        return {
            get(key) {
                if (!map.has(key)) return null;
                const value = map.get(key);
                map.delete(key);
                map.set(key, value);
                return value;
            },
            set(key, value) {
                if (map.has(key)) map.delete(key);
                map.set(key, value);
                while (map.size > limit) map.delete(map.keys().next().value);
            },
            stats() {
                return { size: map.size, limit };
            }
        };
    }

    window.StockPhotonicGraph.overlayOrchestration = {
        createOverlayOrchestrator,
        getLinkAdjustment,
        getNodeAdjustment,
        getReadabilitySummary
    };
})();
