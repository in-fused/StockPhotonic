(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const DENSITY_MULTIPLIERS = {
        core: 1,
        dense: 0.82,
        very_dense: 0.64,
        mega: 0.48
    };
    const TIER_MULTIPLIERS = {
        macro: 0.58,
        cluster: 0.74,
        relationship: 0.96,
        inspection: 1.18
    };

    function createReadabilityController(options = {}) {
        const maxCacheEntries = Math.max(8, Number(options.maxCacheEntries) || 36);
        const modelCache = createLru(maxCacheEntries);

        function buildModel(context = {}) {
            const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
            const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
            const density = normalizeDensity(context.graphScalingModel?.density, nodes.length, links.length);
            const semantic = context.stockSemanticZoomState || context.semanticZoom || {};
            const signature = getSignature(context, nodes, links, density, semantic);
            const cached = modelCache.get(signature);
            if (cached) return cached;

            const protectedLinkKeys = getProtectedLinkKeys(context);
            const activeRouteLinkKeys = getRouteLinkKeys(context);
            const corridorIndex = buildCorridorIndex(links, context, density);
            const nodeMetrics = buildNodeMetrics(nodes, links, context, corridorIndex);
            const edgePriority = buildEdgePriority(links, context, nodeMetrics, corridorIndex, protectedLinkKeys);
            const labelQueue = buildLabelQueue(nodes, context, nodeMetrics, density, semantic);
            const budgets = buildBudgets(context, nodes, links, density, semantic, protectedLinkKeys, labelQueue);
            const activeCorridorKey = getActiveCorridorKey(context, corridorIndex);
            const suppressedLinkKeys = buildSuppressedLinkSet(links, edgePriority, protectedLinkKeys, activeRouteLinkKeys, budgets, density, semantic, activeCorridorKey, context);
            const nodeProminence = buildNodeProminence(nodes, context, nodeMetrics, labelQueue, semantic, density);
            const semanticFog = buildSemanticFog(context, density, semantic, budgets);

            const model = {
                version: 'd161_readability_v1',
                signature,
                density,
                semanticTier: semantic.tier || 'relationship',
                protectedLinkKeys,
                activeRouteLinkKeys,
                suppressedLinkKeys,
                corridorIndex,
                activeCorridorKey,
                nodeMetrics,
                edgePriority,
                labelQueue,
                labelIdSet: new Set(labelQueue.ordered.map(item => item.nodeId)),
                nodeProminence,
                budgets,
                semanticFog,
                reasonChips: buildReasonChips({ density, semantic, budgets, protectedLinkKeys, activeRouteLinkKeys, activeCorridorKey, corridorIndex }),
                notes: {
                    adaptiveEdgeThinning: budgets.edgeBudget < links.length,
                    semanticEdgeFading: density.key !== 'core' || semantic.tierRank <= 1,
                    corridorAwareSuppression: Boolean(activeCorridorKey || corridorIndex.topCorridors.length),
                    nonDestructive: true,
                    dataMutation: false
                },
                createdAt: Date.now()
            };
            modelCache.set(signature, model);
            return model;
        }

        return {
            buildModel,
            getCacheStats: () => modelCache.stats()
        };
    }

    function getEdgeAdjustment(context = {}, link = {}, visual = {}, semantic = {}) {
        const model = context.graphReadabilityModel || null;
        if (!model || !link) {
            return defaultEdgeAdjustment();
        }
        const protectedEdge = isProtectedLink(context, link, visual, model);
        const priority = model.edgePriority?.get(link.key) || 0;
        const strength = clamp01(Number(link.strength) || 0);
        const corridorKey = getLinkCorridorKey(context, link);
        const corridor = corridorKey ? model.corridorIndex?.byKey?.get(corridorKey) : null;
        const activeCorridor = corridorKey && corridorKey === model.activeCorridorKey;
        const suppressed = !protectedEdge && model.suppressedLinkKeys?.has(link.key);
        const densityWeight = DENSITY_MULTIPLIERS[model.density?.key || 'core'] || 1;
        const tierRank = Number(semantic.tierRank ?? 2);
        const lowTier = tierRank <= 1;
        const corridorPressure = corridor && !activeCorridor
            ? clamp01((corridor.edgeCount - (model.budgets?.corridorSampleLimit || 24)) / Math.max(1, corridor.edgeCount))
            : 0;
        const fogMultiplier = protectedEdge
            ? 1
            : clamp(0.32 + densityWeight * 0.68 - corridorPressure * 0.26 - (lowTier ? 0.18 : 0), 0.18, 1);

        if (suppressed) {
            return {
                draw: false,
                protectedEdge,
                contextualReveal: false,
                alphaMultiplier: 0,
                widthMultiplier: 0,
                shadowMultiplier: 0,
                priorityBoost: 0,
                reason: 'density-budget'
            };
        }

        return {
            draw: true,
            protectedEdge,
            contextualReveal: Boolean(protectedEdge || activeCorridor || visual.guided || visual.overlay || visual.navigation),
            alphaMultiplier: protectedEdge ? 1 : fogMultiplier * (0.72 + strength * 0.38),
            widthMultiplier: protectedEdge ? 1 : clamp(0.46 + densityWeight * 0.42 + strength * 0.18 - corridorPressure * 0.14, 0.32, 1),
            shadowMultiplier: protectedEdge ? 1 : clamp(0.42 + densityWeight * 0.4, 0.32, 0.92),
            priorityBoost: protectedEdge ? 1200 : activeCorridor ? 260 : corridor ? 90 : 0,
            corridorKey,
            priority,
            reason: activeCorridor ? 'active-corridor' : corridor ? 'corridor-faded' : 'semantic-density'
        };
    }

    function getNodeAdjustment(context = {}, node = {}, semantic = {}) {
        const model = context.graphReadabilityModel || null;
        const fallback = {
            radiusMultiplier: 1,
            alphaMultiplier: 1,
            glowMultiplier: 1,
            labelPriorityBoost: 0,
            prominence: 'normal'
        };
        if (!model || !node) return fallback;
        const entry = model.nodeProminence?.get(node.id);
        if (!entry) return fallback;
        const selected = context.selectedNode?.id === node.id;
        const hovered = context.hoveredNode?.id === node.id;
        if (selected || hovered) {
            return {
                radiusMultiplier: Math.max(1.16, entry.radiusMultiplier),
                alphaMultiplier: 1,
                glowMultiplier: 1.22,
                labelPriorityBoost: 1000,
                prominence: 'focus'
            };
        }
        return entry;
    }

    function getLabelBudget(context = {}, labelMode = 'ticker', semantic = {}) {
        const model = context.graphReadabilityModel || null;
        if (!model?.budgets) return 0;
        return labelMode === 'full'
            ? model.budgets.fullLabelBudget
            : model.budgets.tickerLabelBudget;
    }

    function getLabelPriorityBoost(context = {}, node = {}) {
        const model = context.graphReadabilityModel || null;
        if (!model || !node) return 0;
        const labelEntry = model.labelQueue?.byNodeId?.get(node.id);
        const prominence = model.nodeProminence?.get(node.id);
        return (labelEntry?.priority || 0) * 0.18 + (prominence?.labelPriorityBoost || 0);
    }

    function getFrameLinkLimit(context = {}, density = {}, semantic = {}) {
        const model = context.graphReadabilityModel || null;
        if (!model?.budgets) return 0;
        if (context.selectedNode || context.activeRelationshipRoute || context.activeRouteComparison || context.selectedRelationshipLink) {
            return 0;
        }
        return model.budgets.frameLinkLimit || 0;
    }

    function getLinkRenderPriority(context = {}, link = {}) {
        const model = context.graphReadabilityModel || null;
        return model?.edgePriority?.get(link.key) || 0;
    }

    function drawSemanticFog(context = {}, ctx, model = null) {
        const readability = model || context.graphReadabilityModel;
        if (!ctx || !readability?.semanticFog?.enabled) return;
        const fog = readability.semanticFog;
        const width = Number(context.canvasWidth) || 0;
        const height = Number(context.canvasHeight) || 0;
        if (width <= 0 || height <= 0) return;

        ctx.save();
        ctx.globalAlpha = fog.alpha;
        ctx.fillStyle = fog.color;
        ctx.fillRect(0, 0, width, height);

        if (fog.edgeFade > 0) {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, `rgba(3, 7, 18, ${fog.edgeFade})`);
            gradient.addColorStop(0.18, 'rgba(3, 7, 18, 0)');
            gradient.addColorStop(0.82, 'rgba(3, 7, 18, 0)');
            gradient.addColorStop(1, `rgba(3, 7, 18, ${fog.edgeFade})`);
            ctx.globalAlpha = 1;
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
    }

    function defaultEdgeAdjustment() {
        return {
            draw: true,
            protectedEdge: false,
            contextualReveal: false,
            alphaMultiplier: 1,
            widthMultiplier: 1,
            shadowMultiplier: 1,
            priorityBoost: 0
        };
    }

    function buildBudgets(context, nodes, links, density, semantic, protectedLinkKeys, labelQueue) {
        const width = Number(context.canvasWidth || context.viewportWidth || 0);
        const height = Number(context.canvasHeight || context.viewportHeight || 0);
        const area = width && height ? width * height : 850000;
        const areaBudget = Math.round(area / 2600);
        const densityMultiplier = DENSITY_MULTIPLIERS[density.key] || 1;
        const tierMultiplier = TIER_MULTIPLIERS[semantic.tier || 'relationship'] || 0.96;
        const protectedCount = protectedLinkKeys.size;
        const baseEdgeBudget = Math.max(92, Math.round(areaBudget * densityMultiplier * tierMultiplier));
        const edgeBudget = clampInteger(baseEdgeBudget + protectedCount, Math.min(links.length, protectedCount || 0), links.length);
        const activeWorkflow = Boolean(context.selectedNode || context.activeRelationshipRoute || context.activeRouteComparison || context.selectedRelationshipLink);
        const frameLinkLimit = activeWorkflow
            ? 0
            : clampInteger(edgeBudget, 0, links.length);
        const baseLabels = density.key === 'mega'
            ? 18
            : density.key === 'very_dense'
                ? 26
                : density.key === 'dense'
                    ? 34
                    : 52;
        const semanticBoost = semantic.tier === 'inspection' ? 18 : semantic.tier === 'relationship' ? 8 : 0;
        const selectedBoost = context.selectedNode ? 28 : 0;
        const tickerLabelBudget = clampInteger(baseLabels + semanticBoost + selectedBoost, 8, labelQueue.ordered.length || nodes.length);
        const fullLabelBudget = clampInteger(Math.round(tickerLabelBudget * 0.74), 6, tickerLabelBudget);

        return {
            edgeBudget,
            frameLinkLimit,
            suppressedEstimate: Math.max(0, links.length - edgeBudget),
            tickerLabelBudget,
            fullLabelBudget,
            corridorSampleLimit: density.key === 'mega' ? 22 : density.key === 'very_dense' ? 30 : density.key === 'dense' ? 40 : 64,
            nodeProminenceLimit: density.key === 'mega' ? 70 : density.key === 'very_dense' ? 96 : density.key === 'dense' ? 128 : 180,
            viewportArea: area,
            protectedLinkCount: protectedCount,
            activeWorkflow
        };
    }

    function buildReasonChips({ density, semantic, budgets, protectedLinkKeys, activeRouteLinkKeys, activeCorridorKey, corridorIndex }) {
        const chips = [];
        if (budgets.suppressedEstimate > 0) {
            chips.push({
                key: 'readability-suppression',
                label: `${budgets.suppressedEstimate} gated`,
                reason: `${budgets.suppressedEstimate} visible edge${budgets.suppressedEstimate === 1 ? '' : 's'} exceed the ${budgets.edgeBudget}-edge readability budget.`
            });
        }
        if (protectedLinkKeys.size || activeRouteLinkKeys.size) {
            const count = Math.max(protectedLinkKeys.size, activeRouteLinkKeys.size);
            chips.push({
                key: 'protected-context',
                label: `${count} protected`,
                reason: 'Selected, route, overlay, or guided edges stay visible before density suppression is applied.'
            });
        }
        if (activeCorridorKey) {
            chips.push({
                key: 'active-corridor',
                label: formatKey(activeCorridorKey),
                reason: 'The active corridor receives extra readability budget before background edges are thinned.'
            });
        } else if (corridorIndex?.topCorridors?.length) {
            chips.push({
                key: 'corridor-priority',
                label: formatKey(corridorIndex.topCorridors[0].key),
                reason: 'The top corridor is prioritized by visible edge count, strength, and source-backed edge count.'
            });
        }
        chips.push({
            key: 'label-budget',
            label: `${budgets.tickerLabelBudget} labels`,
            reason: `Label budget follows ${semantic.tier || 'relationship'} semantic tier and ${density.key || 'core'} graph density.`
        });
        return chips.slice(0, 5);
    }

    function buildSemanticFog(context, density, semantic, budgets) {
        const key = density.key || 'core';
        const tierRank = Number(semantic.tierRank ?? 2);
        const activeFocus = Boolean(context.selectedNode || context.activeRelationshipRoute || context.activeRouteComparison || context.selectedRelationshipLink);
        const baseAlpha = key === 'mega'
            ? 0.075
            : key === 'very_dense'
                ? 0.052
                : key === 'dense'
                    ? 0.036
                    : 0;
        const tierLift = tierRank <= 1 ? 0.024 : tierRank >= 3 ? -0.018 : 0;
        const alpha = clamp(baseAlpha + tierLift - (activeFocus ? 0.026 : 0), 0, 0.095);
        return {
            enabled: alpha > 0.004,
            alpha,
            color: 'rgba(2, 6, 23, 1)',
            edgeFade: key === 'mega' ? 0.13 : key === 'very_dense' ? 0.09 : 0.05,
            suppressedEstimate: budgets.suppressedEstimate
        };
    }

    function buildSuppressedLinkSet(links, edgePriority, protectedLinkKeys, activeRouteLinkKeys, budgets, density, semantic, activeCorridorKey, context) {
        if (!budgets.frameLinkLimit || links.length <= budgets.frameLinkLimit) return new Set();
        const limit = Math.max(0, budgets.frameLinkLimit);
        const ordered = links
            .map(link => ({
                key: link.key,
                link,
                priority: edgePriority.get(link.key) || 0,
                protected: protectedLinkKeys.has(link.key) || activeRouteLinkKeys.has(link.key)
            }))
            .sort((a, b) => Number(b.protected) - Number(a.protected) || b.priority - a.priority || String(a.key).localeCompare(String(b.key)));

        const keep = new Set();
        ordered.slice(0, limit).forEach(item => keep.add(item.key));
        protectedLinkKeys.forEach(key => keep.add(key));
        activeRouteLinkKeys.forEach(key => keep.add(key));

        if (activeCorridorKey) {
            ordered.forEach(item => {
                if (keep.size >= Math.max(limit, budgets.protectedLinkCount + budgets.corridorSampleLimit)) return;
                if (getLinkCorridorKey(context, item.link) === activeCorridorKey) keep.add(item.key);
            });
        }

        return new Set(links.map(link => link.key).filter(key => !keep.has(key)));
    }

    function buildEdgePriority(links, context, nodeMetrics, corridorIndex, protectedLinkKeys) {
        const priority = new Map();
        links.forEach(link => {
            const sourceMetric = nodeMetrics.get(link.source?.id) || {};
            const targetMetric = nodeMetrics.get(link.target?.id) || {};
            const strength = clamp01(Number(link.strength) || 0);
            const corridorKey = getLinkCorridorKey(context, link);
            const corridor = corridorKey ? corridorIndex.byKey.get(corridorKey) : null;
            let score = strength * 180;
            score += Math.min(130, (Number(sourceMetric.visibleDegree) || 0) * 5 + (Number(targetMetric.visibleDegree) || 0) * 5);
            score += Math.min(90, (Number(sourceMetric.ecosystemCount) || 0) * 12 + (Number(targetMetric.ecosystemCount) || 0) * 12);
            score += corridor ? Math.min(110, corridor.priority) : 0;
            if (context.relationshipHasSourceEvidence?.(link)) score += 64;
            if (context.isSecBackedConnection?.(link)) score += 84;
            if (protectedLinkKeys.has(link.key)) score += 1400;
            priority.set(link.key, score);
        });
        return priority;
    }

    function buildNodeMetrics(nodes, links, context, corridorIndex) {
        const metrics = new Map();
        nodes.forEach(node => {
            metrics.set(node.id, {
                node,
                visibleDegree: 0,
                sourceBacked: 0,
                secBacked: 0,
                corridorKeys: new Set(),
                ecosystemKeys: new Set(),
                bridgeSpan: 0
            });
        });

        links.forEach(link => {
            const corridorKey = getLinkCorridorKey(context, link);
            const ecosystemKeys = context.stockGraphIntelligence?.getLinkEcosystemKeys?.(link, context) || [];
            [link.source, link.target].filter(Boolean).forEach((node, index) => {
                const row = metrics.get(node.id);
                if (!row) return;
                row.visibleDegree += 1;
                if (context.relationshipHasSourceEvidence?.(link)) row.sourceBacked += 1;
                if (context.isSecBackedConnection?.(link)) row.secBacked += 1;
                if (corridorKey) row.corridorKeys.add(corridorKey);
                ecosystemKeys.forEach(key => row.ecosystemKeys.add(key));
                const other = index === 0 ? link.target : link.source;
                if (other?.sector && node.sector && other.sector !== node.sector) row.bridgeSpan += 1;
            });
        });

        metrics.forEach(row => {
            row.corridorCount = row.corridorKeys.size;
            row.ecosystemCount = row.ecosystemKeys.size;
            row.sourceBackedRatio = row.visibleDegree ? row.sourceBacked / row.visibleDegree : 0;
        });
        return metrics;
    }

    function buildLabelQueue(nodes, context, nodeMetrics, density, semantic) {
        const ordered = nodes
            .map(node => {
                const metric = nodeMetrics.get(node.id) || {};
                const selected = context.selectedNode?.id === node.id;
                const neighbor = context.focusNeighborIds?.has(node.id);
                const route = context.activeRouteComparison?.nodeIds?.has(node.id) || context.activeRelationshipRoute?.nodeIds?.has(node.id);
                const guided = context.graphIntelligenceModel?.guidedDiscovery?.nodeIds?.has(node.id);
                const overlay = context.graphIntelligenceModel?.overlay?.nodeIds?.has(node.id) || context.graphIntelligenceModel?.analystOverlay?.nodeIds?.has(node.id);
                const strategic = context.stockGraphIntelligence?.getStrategicHubProfile?.(node, context)?.isStrategic;
                const priority =
                    (selected ? 2200 : 0) +
                    (route ? 1600 : 0) +
                    (neighbor ? 900 : 0) +
                    (guided ? 760 : 0) +
                    (overlay ? 700 : 0) +
                    (strategic ? 620 : 0) +
                    (Number(metric.visibleDegree) || 0) * 22 +
                    (Number(metric.corridorCount) || 0) * 74 +
                    (Number(metric.ecosystemCount) || 0) * 58 +
                    (Number(metric.sourceBackedRatio) || 0) * 95 +
                    Math.max(0, 400 - (Number(node.rank) || 400)) * 0.24;
                return {
                    node,
                    nodeId: node.id,
                    label: node.ticker || node.name || '',
                    priority,
                    selected,
                    route,
                    overlay,
                    guided
                };
            })
            .sort((a, b) => b.priority - a.priority || String(a.label).localeCompare(String(b.label)));
        return {
            ordered,
            byNodeId: new Map(ordered.map((item, index) => [item.nodeId, { ...item, index }])),
            densityKey: density.key,
            semanticTier: semantic.tier || 'relationship'
        };
    }

    function buildNodeProminence(nodes, context, nodeMetrics, labelQueue, semantic, density) {
        const prominence = new Map();
        const maxPriority = Math.max(1, labelQueue.ordered[0]?.priority || 1);
        const labelSet = new Set(labelQueue.ordered.slice(0, density.key === 'mega' ? 34 : density.key === 'very_dense' ? 48 : 72).map(item => item.nodeId));

        nodes.forEach(node => {
            const metric = nodeMetrics.get(node.id) || {};
            const labelEntry = labelQueue.byNodeId.get(node.id);
            const priorityRatio = clamp01((labelEntry?.priority || 0) / maxPriority);
            const selected = context.selectedNode?.id === node.id;
            const route = context.activeRouteComparison?.nodeIds?.has(node.id) || context.activeRelationshipRoute?.nodeIds?.has(node.id);
            const important = selected || route || labelSet.has(node.id);
            const densityFade = density.key === 'mega' ? 0.76 : density.key === 'very_dense' ? 0.84 : density.key === 'dense' ? 0.92 : 1;
            const radiusMultiplier = important
                ? clamp(0.94 + priorityRatio * 0.38, 0.96, 1.28)
                : clamp(0.72 + densityFade * 0.28 + priorityRatio * 0.08, 0.72, 1);
            const alphaMultiplier = important
                ? 1
                : clamp(0.48 + densityFade * 0.46 + priorityRatio * 0.14, 0.48, 0.98);
            prominence.set(node.id, {
                radiusMultiplier,
                alphaMultiplier,
                glowMultiplier: important ? 1.05 + priorityRatio * 0.18 : 0.68 + priorityRatio * 0.18,
                labelPriorityBoost: important ? 220 + priorityRatio * 180 : priorityRatio * 60,
                prominence: selected ? 'focus' : route ? 'route' : important ? 'anchor' : 'background',
                visibleDegree: metric.visibleDegree || 0
            });
        });
        return prominence;
    }

    function buildCorridorIndex(links, context, density) {
        const byKey = new Map();
        links.forEach(link => {
            const key = getLinkCorridorKey(context, link);
            if (!key) return;
            const row = byKey.get(key) || {
                key,
                label: formatKey(key),
                edgeCount: 0,
                sourceBacked: 0,
                secBacked: 0,
                strength: 0,
                linkKeys: new Set(),
                priority: 0
            };
            row.edgeCount += 1;
            row.strength += clamp01(Number(link.strength) || 0);
            row.linkKeys.add(link.key);
            if (context.relationshipHasSourceEvidence?.(link)) row.sourceBacked += 1;
            if (context.isSecBackedConnection?.(link)) row.secBacked += 1;
            byKey.set(key, row);
        });
        byKey.forEach(row => {
            row.avgStrength = row.edgeCount ? row.strength / row.edgeCount : 0;
            row.sourceBackedRatio = row.edgeCount ? row.sourceBacked / row.edgeCount : 0;
            row.priority = row.edgeCount * 2 + row.avgStrength * 90 + row.sourceBacked * 3 + row.secBacked * 5;
        });
        const topCorridors = [...byKey.values()]
            .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 5 : 7);
        return {
            byKey,
            topCorridors,
            topKeys: new Set(topCorridors.map(item => item.key))
        };
    }

    function getProtectedLinkKeys(context = {}) {
        const keys = new Set();
        addSet(keys, context.focusLinkKeys);
        addSet(keys, context.portfolioEdgeKeys);
        addSet(keys, context.activeRelationshipRoute?.linkKeys);
        addSet(keys, context.activeRouteComparison?.linkKeys);
        if (context.selectedRelationshipLink?.key) keys.add(context.selectedRelationshipLink.key);
        if (context.graphIntelligenceModel?.guidedDiscovery?.linkKeys) addSet(keys, context.graphIntelligenceModel.guidedDiscovery.linkKeys);
        if (context.graphIntelligenceModel?.overlay?.linkKeys) addSet(keys, context.graphIntelligenceModel.overlay.linkKeys);
        if (context.graphIntelligenceModel?.analystOverlay?.linkKeys) addSet(keys, context.graphIntelligenceModel.analystOverlay.linkKeys);
        return keys;
    }

    function getRouteLinkKeys(context = {}) {
        const keys = new Set();
        addSet(keys, context.activeRelationshipRoute?.linkKeys);
        addSet(keys, context.activeRouteComparison?.linkKeys);
        return keys;
    }

    function isProtectedLink(context, link, visual, model) {
        return Boolean(
            visual.forceDraw ||
            visual.route ||
            visual.routeComparison?.active ||
            visual.selected ||
            visual.guided ||
            visual.overlay ||
            visual.navigation ||
            visual.sourceCoverage ||
            visual.analystOverlay ||
            context.focusLinkKeys?.has(link.key) ||
            context.portfolioEdgeKeys?.has(link.key) ||
            model?.protectedLinkKeys?.has(link.key)
        );
    }

    function getLinkCorridorKey(context, link) {
        const spatial = context.getGraphLinkSpatialMeta?.(link) || {};
        return spatial.primaryCorridorKey || spatial.corridorKeys?.[0] || '';
    }

    function getActiveCorridorKey(context, corridorIndex) {
        if (context.largeGraphNavigationModel?.focusKind === 'corridor') {
            return context.largeGraphNavigationModel.corridorKey || '';
        }
        if (context.activeRelationshipRoute?.links?.length) {
            const counts = new Map();
            context.activeRelationshipRoute.links.forEach(link => {
                const key = getLinkCorridorKey(context, link);
                if (key) counts.set(key, (counts.get(key) || 0) + 1);
            });
            return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        }
        return corridorIndex.topCorridors[0]?.key || '';
    }

    function getSignature(context, nodes, links, density, semantic) {
        return [
            nodes.length,
            links.length,
            density.key,
            semantic.tier || '',
            Math.round((Number(context.scale) || 1) * 24),
            context.selectedNode?.id || '',
            context.selectedRelationshipLink?.key || '',
            context.activeRelationshipRoute?.id || context.activeRelationshipRoute?.label || '',
            context.activeRouteComparison?.id || '',
            context.activeEcosystemOverlayKey || '',
            context.activeGuidedDiscoveryKey || '',
            context.activeAnalystOverlayKey || '',
            context.largeGraphNavigationModel?.cacheKey || context.largeGraphNavigationModel?.mode || ''
        ].join('|');
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
        return {
            key,
            label: source.label || formatKey(key),
            nodeCount,
            edgeCount,
            ratio
        };
    }

    function addSet(target, source) {
        if (!source) return;
        source.forEach(value => target.add(value));
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
                return {
                    size: map.size,
                    limit
                };
            }
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    }

    function clamp01(value) {
        return clamp(value, 0, 1);
    }

    function clampInteger(value, min, max) {
        return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
    }

    function formatKey(key) {
        return String(key || 'Graph')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    function buildSharedFlowInterpretation(options = {}) {
        const domain = String(options.domain || 'stock').toLowerCase() === 'crypto' ? 'crypto' : 'stock';
        const stock = domain === 'stock';
        const convergenceCount = Math.max(0, Number(options.convergenceCount) || 0);
        const divergenceCount = Math.max(0, Number(options.divergenceCount) || 0);
        const bridgeCount = Math.max(0, Number(options.bridgeCount) || 0);
        const concentrationLabel = String(options.concentrationLabel || '').trim();
        const corridorContinuity = String(options.corridorContinuity || '').trim();
        const suppressionReason = String(options.suppressionReason || '').trim();
        const concepts = [];
        if (convergenceCount) {
            concepts.push({
                key: 'convergence',
                label: `Convergence ${convergenceCount}`,
                reason: stock
                    ? `${convergenceCount} visible market relationship cue${convergenceCount === 1 ? '' : 's'} converge under the current graph reading.`
                    : `${convergenceCount} inbound replay endpoint cue${convergenceCount === 1 ? '' : 's'} converge in staged rows only; no ownership claim is implied.`
            });
        }
        if (divergenceCount) {
            concepts.push({
                key: 'divergence',
                label: `Divergence ${divergenceCount}`,
                reason: stock
                    ? `${divergenceCount} visible relationship branch cue${divergenceCount === 1 ? '' : 's'} diverge under the current graph reading.`
                    : `${divergenceCount} outbound replay endpoint cue${divergenceCount === 1 ? '' : 's'} diverge in staged rows only; no control claim is implied.`
            });
        }
        if (concentrationLabel && concentrationLabel !== '0%') {
            concepts.push({
                key: 'concentration',
                label: `Concentration ${concentrationLabel}`,
                reason: stock
                    ? `Concentration reflects visible company/topology density in the current graph state.`
                    : `Concentration reflects token-row visibility in the staged replay window, not liquidity truth.`
            });
        }
        if (bridgeCount) {
            concepts.push({
                key: 'bridge-significance',
                label: `Bridge ${bridgeCount}`,
                reason: stock
                    ? `${bridgeCount} bridge cue${bridgeCount === 1 ? '' : 's'} connect visible company relationship areas.`
                    : `${bridgeCount} address-level bridge cue${bridgeCount === 1 ? '' : 's'} span visible replay corridors; identity is not inferred.`
            });
        }
        if (corridorContinuity) {
            concepts.push({
                key: 'corridor-continuity',
                label: 'Corridor continuity',
                reason: stock
                    ? `Corridor continuity follows visible relationship lanes and in-session graph navigation.`
                    : `Corridor continuity follows staged replay order and loaded route visibility only. ${corridorContinuity}`
            });
        }
        if (suppressionReason) {
            concepts.push({
                key: 'suppression-reasoning',
                label: 'Suppression reasoning',
                reason: suppressionReason
            });
        }
        return {
            version: 'd209_shared_flow_interpretation_v1',
            domain,
            concepts: concepts.slice(0, 6),
            chips: concepts.map(item => item.label).slice(0, 6),
            deterministic: true,
            distinctSemantics: true,
            sessionOnly: true
        };
    }

    window.StockPhotonicGraph.readability = {
        createReadabilityController,
        getEdgeAdjustment,
        getNodeAdjustment,
        getLabelBudget,
        getLabelPriorityBoost,
        getFrameLinkLimit,
        getLinkRenderPriority,
        drawSemanticFog,
        buildSharedFlowInterpretation
    };
})();
