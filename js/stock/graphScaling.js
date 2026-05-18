(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const graphScaleCache = new WeakMap();

    function buildScalingModel(context = {}) {
        const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
        const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
        const candidateNodes = Array.isArray(context.visibleCandidateCompanyPreviewNodes)
            ? context.visibleCandidateCompanyPreviewNodes
            : [];
        const candidateLinks = Array.isArray(context.visibleCandidateCompanyPreviewLinks)
            ? context.visibleCandidateCompanyPreviewLinks
            : [];
        const hasCandidatePreview = candidateNodes.length > 0 || candidateLinks.length > 0;
        const cached = hasCandidatePreview ? null : getCachedModel(nodes, links);
        if (cached) return cached;

        const navigation = normalizeNavigationModel(context.largeGraphNavigationModel);
        const density = getDensityBucket(nodes.length + candidateNodes.length, links.length + candidateLinks.length);
        const hubSummaries = buildHubSummaries(nodes, links, context);
        const corridorBuckets = buildCorridorBuckets(links, context);
        const labelPriorityIds = hubSummaries
            .slice(0, getLabelSeedLimit(density, navigation))
            .map(item => item.nodeId)
            .filter(id => id !== null && id !== undefined);
        const routeSummary = buildRouteSummary(links, context, corridorBuckets);

        const model = {
            density,
            hubSummaries,
            corridorBuckets,
            routeSummary,
            labelPriorityIds,
            renderHeuristics: {
                labelLimitTicker: getTickerLabelLimit(density, navigation),
                labelLimitFull: getFullLabelLimit(density, navigation),
                weakEdgeThresholdLift: density.key === 'dense' || density.key === 'very_dense',
                preserveRouteLabels: true,
                preserveSelectedLabels: true,
                preserveOverlayLabels: true,
                candidatePreviewLabelLimit: getCandidatePreviewLabelLimit(density, navigation),
                progressiveDisclosureActive: navigation.active,
                navigationMode: navigation.mode,
                navigationFocusKind: navigation.focusKind
            },
            navigation,
            candidatePreviewScaling: {
                visibleCandidateNodeCount: candidateNodes.length,
                visibleCandidateEdgeCount: candidateLinks.length,
                candidateIndexesCached: true,
                previewDensityControl: context.candidateCompanyDensityMode || 'balanced',
                graphSafePreview: true
            }
        };
        if (!hasCandidatePreview) cacheModel(nodes, links, model);
        return model;
    }

    function normalizeNavigationModel(rawModel) {
        if (!rawModel || typeof rawModel !== 'object') {
            return {
                active: false,
                mode: 'overview',
                modeLabel: 'Overview',
                focusKind: 'all',
                focusLabel: '',
                visibleNodeCount: 0,
                visibleEdgeCount: 0,
                suppressedEdgeCount: 0,
                disclosureRatio: 1
            };
        }
        const disclosure = rawModel.progressiveDisclosure || {};
        return {
            active: Boolean(rawModel.isActive),
            mode: rawModel.mode || 'overview',
            modeLabel: rawModel.modeLabel || 'Overview',
            focusKind: rawModel.focusKind || 'all',
            focusLabel: rawModel.focusLabel || '',
            visibleNodeCount: Number(disclosure.visibleNodeCount || rawModel.nodeIds?.size || 0),
            visibleEdgeCount: Number(disclosure.visibleEdgeCount || rawModel.linkKeys?.size || 0),
            suppressedEdgeCount: Number(disclosure.suppressedEdgeCount || 0),
            disclosureRatio: Number.isFinite(Number(disclosure.disclosureRatio))
                ? Number(disclosure.disclosureRatio)
                : 1,
            sourceBackedVisibleEdges: Number(disclosure.sourceBackedVisibleEdges || 0),
            secBackedVisibleEdges: Number(disclosure.secBackedVisibleEdges || 0)
        };
    }

    function getCachedModel(nodes, links) {
        const nodeCache = graphScaleCache.get(nodes);
        return nodeCache?.get(links) || null;
    }

    function cacheModel(nodes, links, model) {
        let nodeCache = graphScaleCache.get(nodes);
        if (!nodeCache) {
            nodeCache = new WeakMap();
            graphScaleCache.set(nodes, nodeCache);
        }
        nodeCache.set(links, model);
    }

    function getDensityBucket(nodeCount, edgeCount) {
        const ratio = edgeCount / Math.max(1, nodeCount);
        if (nodeCount > 160 || edgeCount > 360 || ratio > 3.15) {
            return { key: 'very_dense', label: 'Very dense', nodeCount, edgeCount, ratio };
        }
        if (nodeCount > 100 || edgeCount > 210 || ratio > 2.25) {
            return { key: 'dense', label: 'Dense', nodeCount, edgeCount, ratio };
        }
        if (nodeCount > 70 || edgeCount > 125 || ratio > 1.7) {
            return { key: 'growth', label: 'Growth ready', nodeCount, edgeCount, ratio };
        }
        return { key: 'core', label: 'Core graph', nodeCount, edgeCount, ratio };
    }

    function buildHubSummaries(nodes, links, context) {
        const stats = new Map();
        nodes.forEach(node => {
            stats.set(node.id, {
                nodeId: node.id,
                ticker: node.ticker || node.name || '',
                degree: node.degree || 0,
                visibleDegree: 0,
                sourceBacked: 0,
                corridorCount: 0,
                score: 0
            });
        });
        const corridorByNode = new Map();
        links.forEach(link => {
            const endpoints = [link.source, link.target].filter(Boolean);
            const corridorKeys = getLinkCorridorKeys(link, context);
            endpoints.forEach(node => {
                const row = stats.get(node.id);
                if (!row) return;
                row.visibleDegree += 1;
                if (context.relationshipHasSourceEvidence?.(link)) row.sourceBacked += 1;
                if (corridorKeys.length) {
                    const set = corridorByNode.get(node.id) || new Set();
                    corridorKeys.forEach(key => set.add(key));
                    corridorByNode.set(node.id, set);
                }
            });
        });
        stats.forEach(row => {
            row.corridorCount = corridorByNode.get(row.nodeId)?.size || 0;
            const sourceRatio = row.visibleDegree ? row.sourceBacked / row.visibleDegree : 0;
            row.score = row.visibleDegree * 2 + row.degree * 0.55 + row.corridorCount * 2.2 + sourceRatio * 4;
        });
        return [...stats.values()]
            .sort((a, b) => b.score - a.score || String(a.ticker).localeCompare(String(b.ticker)));
    }

    function buildCorridorBuckets(links, context) {
        const buckets = new Map();
        links.forEach(link => {
            const keys = getLinkCorridorKeys(link, context);
            keys.forEach(key => {
                const bucket = buckets.get(key) || {
                    key,
                    label: getCorridorLabel(key, context),
                    edgeCount: 0,
                    sourceBacked: 0,
                    strongEdges: 0
                };
                bucket.edgeCount += 1;
                if (context.relationshipHasSourceEvidence?.(link)) bucket.sourceBacked += 1;
                if ((Number(link.strength) || 0) >= 0.75) bucket.strongEdges += 1;
                buckets.set(key, bucket);
            });
        });
        return [...buckets.values()]
            .sort((a, b) => b.edgeCount - a.edgeCount || a.label.localeCompare(b.label));
    }

    function buildRouteSummary(links, context, corridorBuckets) {
        const sourceBacked = links.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = links.filter(link => context.isSecBackedConnection?.(link)).length;
        return {
            visibleEdgeCount: links.length,
            sourceBacked,
            secBacked,
            corridorRouteCount: corridorBuckets.length,
            precomputeModes: [
                'strongest',
                'source_backed',
                'sec_backed',
                ...corridorBuckets.slice(0, 8).map(bucket => bucket.key)
            ]
        };
    }

    function getLinkCorridorKeys(link, context) {
        if (context.stockGraphIntelligence?.getLinkEcosystemKeys) {
            return context.stockGraphIntelligence.getLinkEcosystemKeys(link, context);
        }
        const text = [
            link?.relationship_type,
            link?.type,
            link?.label,
            link?.provenance,
            link?.source?.sector,
            link?.target?.sector,
            link?.source?.industry,
            link?.target?.industry
        ].map(value => String(value || '').toLowerCase()).join(' ');
        const keys = [];
        if (/(ai|gpu|accelerator|hbm|foundry|semiconductor|cloud|data center)/.test(text)) keys.push('ai_compute_foundry_cloud');
        if (/(payment|card|issuer|bank|credit|network)/.test(text)) keys.push('payment_networks_banks');
        if (/(pbm|pharma|drug|formulary|insurance|managed care)/.test(text)) keys.push('pbm_pharma_insurance');
        if (/(aerospace|aircraft|engine|defense|oem)/.test(text)) keys.push('aerospace_oem');
        if (/(energy|oil|gas|power|grid|pipeline|utility)/.test(text)) keys.push('energy_infrastructure');
        if (/(saas|workflow|crm|enterprise|data platform|cloud security)/.test(text)) keys.push('enterprise_saas_cloud');
        if (/(retail|consumer|e-commerce|grocery|restaurant|beverage)/.test(text)) keys.push('retail_consumer');
        return [...new Set(keys)];
    }

    function getCorridorLabel(key, context) {
        const ecosystem = context.stockGraphIntelligence?.getEcosystemDefinition?.(key);
        if (ecosystem?.label) return ecosystem.label;
        return String(key || 'corridor').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function getLabelSeedLimit(density, navigation = {}) {
        if (navigation.active && navigation.mode !== 'production_only') {
            if (density.key === 'very_dense') return 14;
            if (density.key === 'dense') return 18;
            return 22;
        }
        if (density.key === 'very_dense') return 18;
        if (density.key === 'dense') return 24;
        if (density.key === 'growth') return 30;
        return 34;
    }

    function getTickerLabelLimit(density, navigation = {}) {
        if (navigation.active && navigation.mode !== 'production_only') {
            if (density.key === 'very_dense') return 14;
            if (density.key === 'dense') return 20;
            if (density.key === 'growth') return 28;
            return 34;
        }
        if (density.key === 'very_dense') return 20;
        if (density.key === 'dense') return 28;
        if (density.key === 'growth') return 36;
        return 52;
    }

    function getFullLabelLimit(density, navigation = {}) {
        if (navigation.active && navigation.mode !== 'production_only') {
            if (density.key === 'very_dense') return 20;
            if (density.key === 'dense') return 28;
            if (density.key === 'growth') return 36;
            return 44;
        }
        if (density.key === 'very_dense') return 28;
        if (density.key === 'dense') return 38;
        if (density.key === 'growth') return 46;
        return 60;
    }

    function getCandidatePreviewLabelLimit(density, navigation = {}) {
        if (navigation.mode === 'preview_only') return 20;
        if (navigation.active && density.key === 'very_dense') return 10;
        if (density.key === 'very_dense') return 14;
        if (density.key === 'dense') return 20;
        if (density.key === 'growth') return 28;
        return 36;
    }

    function buildGrowthForecast(options = {}) {
        const currentNodeCount = Number(options.currentNodeCount || 0);
        const currentEdgeCount = Number(options.currentEdgeCount || 0);
        const stagedNodeCount = Number(options.stagedNodeCount || 0);
        const previewAnchorEdgeCount = Number(options.previewAnchorEdgeCount || 0);
        const projectedNodeCount = currentNodeCount + stagedNodeCount;
        const previewEdgeCount = currentEdgeCount + previewAnchorEdgeCount;
        const density = getDensityBucket(projectedNodeCount, previewEdgeCount);
        const recommendedLabelLimit = getTickerLabelLimit(density);
        return {
            density,
            currentNodeCount,
            currentEdgeCount,
            stagedNodeCount,
            projectedNodeCount,
            previewAnchorEdgeCount,
            previewEdgeCount,
            recommendedLabelLimit,
            recommendedFullLabelLimit: getFullLabelLimit(density),
            recommendedCandidateLabelLimit: getCandidatePreviewLabelLimit(density),
            labelPressure: getLabelPressure(projectedNodeCount, recommendedLabelLimit),
            mobileSafety: getMobileSafety(projectedNodeCount, previewEdgeCount, density),
            routeComplexity: getRouteComplexity(density),
            simulationOnly: true,
            productionMutation: false
        };
    }

    function getLabelPressure(nodeCount, labelLimit) {
        const ratio = nodeCount / Math.max(1, labelLimit);
        if (ratio > 7) return 'very high';
        if (ratio > 4.5) return 'high';
        if (ratio > 2.8) return 'moderate';
        return 'low';
    }

    function getMobileSafety(nodeCount, edgeCount, density) {
        if (density.key === 'very_dense' || nodeCount > 150 || edgeCount > 330) return 'tight';
        if (density.key === 'dense' || nodeCount > 105 || edgeCount > 220) return 'watch';
        return 'safe';
    }

    function getRouteComplexity(density) {
        if (density.key === 'very_dense') return 'very high';
        if (density.key === 'dense') return 'high';
        if (density.key === 'growth') return 'moderate';
        return 'normal';
    }

    window.StockPhotonicStock.graphScaling = {
        buildScalingModel,
        getDensityBucket,
        buildGrowthForecast
    };
})();
