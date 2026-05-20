(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const OVERLAY_FOUNDATIONS = Object.freeze([
        foundation('ownership', 'Ownership', 'capital_exposure', ['cluster', 'relationship', 'inspection']),
        foundation('etf_overlap', 'ETF Overlap', 'capital_exposure', ['cluster', 'relationship', 'inspection']),
        foundation('geopolitical', 'Geopolitical', 'macro_context', ['macro', 'cluster']),
        foundation('ai_compute', 'AI Compute', 'market_topology', ['macro', 'cluster', 'relationship']),
        foundation('energy', 'Energy', 'market_topology', ['macro', 'cluster', 'relationship']),
        foundation('supply_chain', 'Supply Chain', 'market_topology', ['cluster', 'relationship', 'inspection']),
        foundation('openalex', 'OpenAlex', 'research_context', ['cluster', 'relationship', 'inspection']),
        foundation('institutional_exposure', 'Institutional Exposure', 'capital_exposure', ['cluster', 'relationship']),
        foundation('liquidity', 'Liquidity', 'market_context', ['macro', 'cluster'])
    ]);

    function createGraphScalabilityController(options = {}) {
        const maxEntries = Math.max(12, Number(options.maxEntries) || 80);
        const caches = {
            route: createLru(maxEntries),
            comparison: createLru(maxEntries),
            labelAnchors: createLru(maxEntries),
            corridorLanes: createLru(maxEntries),
            strategicHubs: createLru(maxEntries),
            semanticTiles: createLru(maxEntries),
            minimap: createLru(maxEntries),
            replayChunks: createLru(maxEntries)
        };

        function buildModel(context = {}) {
            const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
            const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
            const semantic = context.stockSemanticZoomState || context.semanticZoom || {};
            const density = context.graphScalingModel?.density || getDensity(nodes.length, links.length);
            const signature = getSignature(context, nodes, links, semantic);

            const viewportEdgeBudget = getViewportEdgeBudget({ nodes, links, semantic, density, context });
            const labelAnchorCache = getOrBuild(caches.labelAnchors, `labels:${signature}`, () => buildLabelAnchorCache(nodes, links, context, density));
            const corridorLaneIndex = getOrBuild(caches.corridorLanes, `corridors:${signature}`, () => buildCorridorLaneIndex(links, context, density));
            const strategicHubIndex = getOrBuild(caches.strategicHubs, `hubs:${signature}`, () => buildStrategicHubIndex(nodes, links, context));
            const semanticTiles = getOrBuild(caches.semanticTiles, `tiles:${signature}`, () => buildSemanticTilePrep(nodes, links, context, density));
            const minimapPlan = getOrBuild(caches.minimap, `minimap:${signature}`, () => buildMinimapScalingPlan(nodes, links, density));
            const replayChunks = getOrBuild(caches.replayChunks, `replay:${signature}`, () => buildReplayChunkPrep(context, links, density));
            const renderQueues = buildBoundedRenderQueues(nodes, links, context, density, semantic, viewportEdgeBudget);
            const adaptiveQuality = buildAdaptiveQualityPlan(context, density, semantic, viewportEdgeBudget);
            const memoryBudget = buildGraphMemoryBudget(nodes, links, density);
            const annotationBudget = buildAnnotationThrottlePlan(context, density, semantic);
            const routeCachePlan = buildRouteCacheRefinementPlan(context, density);

            return {
                signature,
                density,
                viewportEdgeBudget,
                labelAnchorCache,
                corridorLaneIndex,
                strategicHubIndex,
                semanticTiles,
                minimapPlan,
                replayChunks,
                renderQueues,
                adaptiveQuality,
                memoryBudget,
                annotationBudget,
                routeCachePlan,
                routeCache: caches.route.stats(),
                comparisonCache: caches.comparison.stats(),
                progressiveHydration: {
                    prepared: true,
                    clientOnly: true,
                    fullBackendHydration: false,
                    recommendedBatchSize: density.key === 'mega' ? 80 : density.key === 'very_dense' ? 120 : 180,
                    dormantNodeLimit: Math.max(0, nodes.length - (density.key === 'mega' ? 160 : density.key === 'very_dense' ? 220 : nodes.length))
                },
                performanceContract: {
                    perFrameScans: false,
                    derivedOnRefresh: true,
                    dataMutation: false,
                    boundedRenderQueues: true,
                    dynamicQualityScaling: true,
                    progressiveHydrationPrepOnly: true
                }
            };
        }

        function rememberRoute(route, context = {}) {
            if (!route) return null;
            const key = route.id || `${route.mode || 'route'}:${route.linkKeys?.size || route.links?.length || 0}:${context.selectedNode?.id || ''}`;
            caches.route.set(key, summarizeRouteCacheEntry(route));
            return key;
        }

        function rememberComparison(comparison) {
            if (!comparison) return null;
            const key = comparison.id || comparison.label || `comparison:${comparison.routeCount || 0}:${comparison.sharedLinkKeys?.size || 0}`;
            caches.comparison.set(key, {
                id: comparison.id,
                label: comparison.label,
                routeCount: comparison.routeCount || comparison.routes?.length || 0,
                sharedEdgeCount: comparison.sharedLinkKeys?.size || 0,
                nodeCount: comparison.nodeIds?.size || 0,
                createdAt: Date.now()
            });
            return key;
        }

        function getCacheStats() {
            return Object.fromEntries(Object.entries(caches).map(([key, cache]) => [key, cache.stats()]));
        }

        return {
            buildModel,
            rememberRoute,
            rememberComparison,
            getCacheStats
        };
    }

    function createOverlayFoundationRegistry() {
        const active = new Set();
        const definitions = OVERLAY_FOUNDATIONS.map(item => ({ ...item }));

        function getDefinitions() {
            return definitions.map(item => ({
                ...item,
                active: active.has(item.key),
                enabled: false
            }));
        }

        function setActive(key, value) {
            const found = definitions.find(item => item.key === key);
            if (!found || found.enabled !== true) return false;
            if (value) active.add(key);
            else active.delete(key);
            return true;
        }

        function getSummary(semantic = {}) {
            const tier = semantic.tier || 'cluster';
            return {
                total: definitions.length,
                active: [...active],
                enabled: definitions.filter(item => item.enabled).map(item => item.key),
                dormant: definitions.filter(item => !item.enabled).map(item => item.key),
                tierReady: definitions.filter(item => item.semanticTiers.includes(tier)).map(item => item.key),
                disabledByDefault: true,
                dataLoaded: false,
                mockData: false
            };
        }

        return {
            getDefinitions,
            setActive,
            getSummary
        };
    }

    function getViewportEdgeBudget({ nodes, links, semantic, density, context }) {
        const width = Number(context.canvasWidth || context.viewportWidth || 0);
        const height = Number(context.canvasHeight || context.viewportHeight || 0);
        const pixelBudget = width && height ? Math.round((width * height) / 1900) : 360;
        const semanticMultiplier = semantic.tier === 'macro'
            ? 0.58
            : semantic.tier === 'cluster'
                ? 0.78
                : semantic.tier === 'relationship'
                    ? 1.04
                    : 1.24;
        const densityMultiplier = density.key === 'mega'
            ? 0.64
            : density.key === 'very_dense'
                ? 0.78
                : density.key === 'dense'
                    ? 0.92
                    : 1;
        const protectedCount =
            (context.activeRouteComparison?.linkKeys?.size || 0) +
            (context.activeRelationshipRoute?.linkKeys?.size || 0) +
            (context.focusLinkKeys?.size || 0);
        const budget = Math.max(80, Math.round(pixelBudget * semanticMultiplier * densityMultiplier) + protectedCount);
        return {
            visibleNodeCount: nodes.length,
            visibleEdgeCount: links.length,
            budget: Math.min(links.length, budget),
            suppressedEstimate: Math.max(0, links.length - budget),
            protectedEdgeCount: protectedCount,
            semanticTier: semantic.tier || 'relationship',
            densityKey: density.key
        };
    }

    function buildLabelAnchorCache(nodes, links, context, density) {
        const edgeCountByNode = new Map();
        links.forEach(link => {
            if (link.source?.id !== undefined) edgeCountByNode.set(link.source.id, (edgeCountByNode.get(link.source.id) || 0) + 1);
            if (link.target?.id !== undefined) edgeCountByNode.set(link.target.id, (edgeCountByNode.get(link.target.id) || 0) + 1);
        });
        const limit = density.key === 'mega' ? 26 : density.key === 'very_dense' ? 34 : density.key === 'dense' ? 44 : 64;
        const anchors = nodes
            .map(node => ({
                nodeId: node.id,
                label: node.ticker || node.name || '',
                degree: Number(node.degree || 0),
                visibleDegree: edgeCountByNode.get(node.id) || 0,
                priority: (edgeCountByNode.get(node.id) || 0) * 2 + Number(node.degree || 0) + (context.topLabelIds?.has(node.id) ? 120 : 0)
            }))
            .sort((a, b) => b.priority - a.priority || String(a.label).localeCompare(String(b.label)))
            .slice(0, limit);
        return {
            anchors,
            limit,
            densityKey: density.key,
            cachedAt: Date.now()
        };
    }

    function buildCorridorLaneIndex(links, context, density) {
        const buckets = new Map();
        links.forEach(link => {
            const spatial = context.getGraphLinkSpatialMeta?.(link) || {};
            const key = spatial.primaryCorridorKey || spatial.corridorKeys?.[0] || '';
            if (!key) return;
            const bucket = buckets.get(key) || {
                key,
                label: spatial.label || formatKey(key),
                edgeCount: 0,
                sourceBacked: 0,
                secBacked: 0,
                strength: 0,
                links: []
            };
            bucket.edgeCount += 1;
            bucket.strength += Number(link.strength) || 0;
            if (context.relationshipHasSourceEvidence?.(link)) bucket.sourceBacked += 1;
            if (context.isSecBackedConnection?.(link)) bucket.secBacked += 1;
            if (bucket.links.length < getLaneSampleLimit(density)) bucket.links.push(link);
            buckets.set(key, bucket);
        });
        const lanes = [...buckets.values()]
            .map(bucket => ({
                ...bucket,
                avgStrength: bucket.edgeCount ? bucket.strength / bucket.edgeCount : 0,
                sourceBackedRatio: bucket.edgeCount ? bucket.sourceBacked / bucket.edgeCount : 0
            }))
            .sort((a, b) => b.edgeCount - a.edgeCount || b.avgStrength - a.avgStrength || a.label.localeCompare(b.label));
        return {
            lanes,
            topLanes: lanes.slice(0, density.key === 'mega' ? 4 : 6),
            laneCount: lanes.length,
            sampleLimit: getLaneSampleLimit(density),
            cachedAt: Date.now()
        };
    }

    function buildStrategicHubIndex(nodes, links, context) {
        const hubProfiles = typeof context.stockGraphIntelligence?.getStrategicHubProfiles === 'function'
            ? context.stockGraphIntelligence.getStrategicHubProfiles(nodes, context, 18)
            : [];
        const visibleEdgeCount = new Map();
        links.forEach(link => {
            if (link.source?.id !== undefined) visibleEdgeCount.set(link.source.id, (visibleEdgeCount.get(link.source.id) || 0) + 1);
            if (link.target?.id !== undefined) visibleEdgeCount.set(link.target.id, (visibleEdgeCount.get(link.target.id) || 0) + 1);
        });
        const fallback = nodes
            .map(node => ({
                node,
                nodeId: node.id,
                ticker: node.ticker || node.name || '',
                score: (visibleEdgeCount.get(node.id) || 0) * 2 + Number(node.degree || 0)
            }))
            .sort((a, b) => b.score - a.score || String(a.ticker).localeCompare(String(b.ticker)))
            .slice(0, 18);
        const hubs = hubProfiles.length ? hubProfiles : fallback;
        return {
            hubs,
            byNodeId: new Map(hubs.map(item => [item.node?.id ?? item.nodeId, item])),
            top: hubs.slice(0, 8),
            cachedAt: Date.now()
        };
    }

    function buildSemanticTilePrep(nodes, links, context, density) {
        const tileSize = density.key === 'mega' ? 460 : density.key === 'very_dense' ? 380 : 320;
        const tiles = new Map();
        const getPosition = context.getNodeLayoutPosition || (node => node || { x: 0, y: 0 });
        nodes.forEach(node => {
            const position = getPosition(node);
            const key = `${Math.floor((Number(position.x) || 0) / tileSize)}:${Math.floor((Number(position.y) || 0) / tileSize)}`;
            const tile = tiles.get(key) || { key, nodeCount: 0, edgeCount: 0, hubScore: 0, nodeIds: [] };
            tile.nodeCount += 1;
            tile.hubScore += Number(node.degree || 0);
            if (tile.nodeIds.length < 12) tile.nodeIds.push(node.id);
            tiles.set(key, tile);
        });
        links.forEach(link => {
            const source = link.source ? getPosition(link.source) : null;
            if (!source) return;
            const key = `${Math.floor((Number(source.x) || 0) / tileSize)}:${Math.floor((Number(source.y) || 0) / tileSize)}`;
            const tile = tiles.get(key);
            if (tile) tile.edgeCount += 1;
        });
        const ordered = [...tiles.values()].sort((a, b) => b.hubScore - a.hubScore || b.edgeCount - a.edgeCount);
        return {
            tileSize,
            tileCount: ordered.length,
            priorityTiles: ordered.slice(0, 12),
            hydratedTiles: ordered.slice(0, density.key === 'mega' ? 6 : 10).map(tile => tile.key),
            cachedAt: Date.now()
        };
    }

    function buildMinimapScalingPlan(nodes, links, density) {
        return {
            nodeSampleLimit: density.key === 'mega' ? 340 : density.key === 'very_dense' ? 460 : 620,
            edgeSampleLimit: density.key === 'mega' ? 240 : density.key === 'very_dense' ? 330 : 520,
            corridorSampleLimit: density.key === 'mega' ? 4 : 6,
            drawEveryFrame: false,
            rebuildOnViewportChange: true,
            nodeCount: nodes.length,
            edgeCount: links.length
        };
    }

    function buildReplayChunkPrep(context, links, density) {
        const routeKeys = [
            ...(context.activeRouteComparison?.linkKeys || []),
            ...(context.activeRelationshipRoute?.linkKeys || [])
        ];
        const chunkSize = density.key === 'mega' ? 48 : density.key === 'very_dense' ? 64 : 90;
        return {
            chunkSize,
            routeChunkCount: Math.ceil(routeKeys.length / Math.max(1, chunkSize)),
            visibleChunkCount: Math.ceil(links.length / Math.max(1, chunkSize)),
            prepOnly: true,
            replayArchitectureUnchanged: true
        };
    }

    function buildBoundedRenderQueues(nodes, links, context, density, semantic, viewportEdgeBudget) {
        const protectedLinkKeys = new Set([
            ...(context.activeRouteComparison?.linkKeys || []),
            ...(context.activeRelationshipRoute?.linkKeys || []),
            ...(context.focusLinkKeys || []),
            ...(context.portfolioEdgeKeys || [])
        ]);
        const edgeLimit = Math.max(80, Number(viewportEdgeBudget.budget) || links.length);
        const nodeLimit = density.key === 'mega' ? 260 : density.key === 'very_dense' ? 360 : density.key === 'dense' ? 480 : nodes.length;
        const labelLimit = density.key === 'mega'
            ? semantic.tier === 'inspection' ? 44 : 24
            : density.key === 'very_dense'
                ? semantic.tier === 'inspection' ? 58 : 36
                : density.key === 'dense'
                    ? 52
                    : 84;
        const edgeQueue = links
            .map(link => ({
                key: link.key,
                priority: getQueueLinkPriority(link, context, protectedLinkKeys),
                protected: protectedLinkKeys.has(link.key)
            }))
            .sort((a, b) => Number(b.protected) - Number(a.protected) || b.priority - a.priority)
            .slice(0, edgeLimit);
        const labelQueue = nodes
            .map(node => ({
                nodeId: node.id,
                label: node.ticker || node.name || '',
                priority: getQueueNodePriority(node, context)
            }))
            .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
            .slice(0, labelLimit);
        return {
            edgeQueue,
            labelQueue,
            nodeQueueLimit: Math.min(nodes.length, nodeLimit),
            edgeQueueLimit: edgeLimit,
            labelQueueLimit: labelLimit,
            protectedEdgeCount: protectedLinkKeys.size,
            bounded: true,
            noPerFrameFullScanRequired: true
        };
    }

    function buildAdaptiveQualityPlan(context, density, semantic, viewportEdgeBudget) {
        const activeMotion = Boolean(context.activeRouteComparison || context.activeRelationshipRoute || context.selectedNode || context.graphStoryMode);
        const densityScale = density.key === 'mega'
            ? 0.62
            : density.key === 'very_dense'
                ? 0.74
                : density.key === 'dense'
                    ? 0.86
                    : 1;
        const semanticScale = semantic.tier === 'macro'
            ? 0.74
            : semantic.tier === 'cluster'
                ? 0.86
                : semantic.tier === 'inspection'
                    ? 1.08
                    : 1;
        const quality = Math.max(0.48, Math.min(1, densityScale * semanticScale + (activeMotion ? 0.08 : 0)));
        return {
            quality,
            edgeAlphaScale: Math.max(0.42, quality),
            glowScale: Math.max(0.36, quality * 0.92),
            animationFrameBudgetMs: density.key === 'mega' ? 10 : density.key === 'very_dense' ? 11.5 : 13,
            minimapFrameBudgetMs: density.key === 'mega' ? 3.4 : 4.8,
            routeRevealChunkSize: density.key === 'mega' ? 16 : density.key === 'very_dense' ? 22 : 32,
            replayChunkSize: density.key === 'mega' ? 36 : density.key === 'very_dense' ? 48 : 64,
            annotationFrameThrottleMs: density.key === 'mega' ? 180 : density.key === 'very_dense' ? 130 : 90,
            viewportEdgeBudget: viewportEdgeBudget.budget
        };
    }

    function buildGraphMemoryBudget(nodes, links, density) {
        const nodeBytes = nodes.length * 420;
        const edgeBytes = links.length * 520;
        const cacheBytes = density.key === 'mega' ? 420000 : density.key === 'very_dense' ? 360000 : 300000;
        return {
            estimatedBytes: nodeBytes + edgeBytes + cacheBytes,
            nodeBudget: density.key === 'mega' ? 900 : density.key === 'very_dense' ? 1200 : 1800,
            edgeBudget: density.key === 'mega' ? 1800 : density.key === 'very_dense' ? 2600 : 4200,
            cacheEntryBudget: density.key === 'mega' ? 48 : 72,
            progressiveHydrationPrepared: true,
            clientOnly: true
        };
    }

    function buildAnnotationThrottlePlan(context, density, semantic) {
        const baseLimit = density.key === 'mega' ? 3 : density.key === 'very_dense' ? 4 : 6;
        return {
            maxVisibleAnnotations: context.selectedNode || context.activeRouteComparison || context.activeRelationshipRoute
                ? baseLimit + 1
                : baseLimit,
            renderIntervalMs: density.key === 'mega' ? 180 : density.key === 'very_dense' ? 130 : 90,
            routeAnnotationPriority: Boolean(context.activeRouteComparison || context.activeRelationshipRoute),
            semanticTier: semantic.tier || 'relationship',
            throttleDomWrites: true
        };
    }

    function buildRouteCacheRefinementPlan(context, density) {
        const activeRouteSize =
            (context.activeRouteComparison?.linkKeys?.size || 0) +
            (context.activeRelationshipRoute?.linkKeys?.size || 0);
        return {
            activeRouteSize,
            chunkSize: density.key === 'mega' ? 18 : density.key === 'very_dense' ? 24 : 34,
            revisitShortcutLimit: density.key === 'mega' ? 5 : 8,
            comparisonBranchLimit: 4,
            preserveRouteComparison: true,
            cacheOnlyDerivedViews: true
        };
    }

    function getQueueLinkPriority(link, context, protectedLinkKeys) {
        const strength = Math.max(0, Math.min(1, Number(link?.strength) || 0));
        let score = strength * 120;
        if (protectedLinkKeys.has(link.key)) score += 1400;
        if (context.relationshipHasSourceEvidence?.(link)) score += 70;
        if (context.isSecBackedConnection?.(link)) score += 90;
        score += Math.min(120, (Number(link.source?.degree) || 0) + (Number(link.target?.degree) || 0));
        return score;
    }

    function getQueueNodePriority(node, context) {
        let score = Number(node?.degree) || 0;
        if (context.selectedNode?.id === node.id) score += 1400;
        if (context.focusNeighborIds?.has(node.id)) score += 480;
        if (context.activeRouteComparison?.nodeIds?.has(node.id) || context.activeRelationshipRoute?.nodeIds?.has(node.id)) score += 820;
        if (context.topLabelIds?.has(node.id)) score += 260;
        score += Math.max(0, 300 - (Number(node.rank) || 300)) * 0.2;
        return score;
    }

    function summarizeRouteCacheEntry(route) {
        return {
            id: route.id || '',
            label: route.label || route.shortLabel || 'Route',
            mode: route.mode || '',
            nodeCount: route.nodeIds?.size || route.nodes?.length || 0,
            edgeCount: route.linkKeys?.size || route.links?.length || 0,
            createdAt: Date.now()
        };
    }

    function getOrBuild(cache, key, build) {
        const cached = cache.get(key);
        if (cached) return cached;
        const value = build();
        cache.set(key, value);
        return value;
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
                    limit,
                    keys: [...map.keys()].slice(-6)
                };
            }
        };
    }

    function getSignature(context, nodes, links, semantic) {
        return [
            nodes.length,
            links.length,
            Math.round((Number(context.scale) || 1) * 20),
            semantic.tier || '',
            context.largeGraphMode || context.largeGraphNavigationModel?.mode || '',
            context.activeEcosystemOverlayKey || '',
            context.activeAnalystOverlayKey || '',
            context.activeGuidedDiscoveryKey || '',
            context.selectedNode?.id || '',
            context.activeRouteComparison?.id || '',
            context.activeRelationshipRoute?.id || ''
        ].join('|');
    }

    function getDensity(nodeCount, edgeCount) {
        const ratio = edgeCount / Math.max(1, nodeCount);
        if (nodeCount > 520 || edgeCount > 1100 || ratio > 4.2) return { key: 'mega', label: 'Mega graph', nodeCount, edgeCount, ratio };
        if (nodeCount > 160 || edgeCount > 360 || ratio > 3.15) return { key: 'very_dense', label: 'Very dense', nodeCount, edgeCount, ratio };
        if (nodeCount > 100 || edgeCount > 210 || ratio > 2.25) return { key: 'dense', label: 'Dense', nodeCount, edgeCount, ratio };
        return { key: 'core', label: 'Core graph', nodeCount, edgeCount, ratio };
    }

    function getLaneSampleLimit(density) {
        if (density.key === 'mega') return 36;
        if (density.key === 'very_dense') return 48;
        if (density.key === 'dense') return 60;
        return 80;
    }

    function foundation(key, label, family, semanticTiers) {
        return {
            key,
            label,
            family,
            semanticTiers,
            enabled: false,
            dataLoaded: false,
            mockData: false,
            mutatesProductionGraph: false,
            browserIngestion: false
        };
    }

    function formatKey(key) {
        return String(key || 'corridor')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicGraph.scalableInfrastructure = {
        OVERLAY_FOUNDATIONS,
        createGraphScalabilityController,
        createOverlayFoundationRegistry
    };
})();
