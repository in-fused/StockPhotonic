(function () {
    window.StockPhotonicIntelligence = window.StockPhotonicIntelligence || {};

    function parsePortfolioTickers(value) {
        const seen = new Set();
        return String(value || '')
            .split(/[\s,]+/)
            .map(item => item.trim().toUpperCase())
            .filter(Boolean)
            .filter(item => {
                if (seen.has(item)) return false;
                seen.add(item);
                return true;
            });
    }

    function getPortfolioExposureSummary(context) {
        const active = context.isPortfolioAnalysisActive();
        const nexusSummary = getPortfolioNexusSummary(context);
        const matchedIds = new Set(context.matchedPortfolioNodes.map(node => node.id));
        const exposureNodeIds = new Set();
        const hubStatsByNodeId = new Map();
        const edgeItems = [];

        context.matchedPortfolioNodes.forEach(holding => {
            (context.adjacencyById.get(holding.id) || []).forEach(item => {
                exposureNodeIds.add(holding.id);
                exposureNodeIds.add(item.node.id);
                edgeItems.push(item.link);

                if (matchedIds.has(item.node.id)) return;
                const existing = hubStatsByNodeId.get(item.node.id) || {
                    node: item.node,
                    portfolioEdgeCount: 0,
                    totalStrength: 0
                };
                existing.portfolioEdgeCount += 1;
                existing.totalStrength += context.getConnectionStrength(item.link);
                hubStatsByNodeId.set(item.node.id, existing);
            });
        });

        const exposureNodes = [...exposureNodeIds]
            .map(id => context.nodeById.get(id))
            .filter(Boolean);
        const firstDegreeNodes = [...context.portfolioAdjacentNodeIds]
            .map(id => context.nodeById.get(id))
            .filter(Boolean);
        const topHubs = [...hubStatsByNodeId.values()]
            .map(item => ({
                ...item,
                avgStrength: item.portfolioEdgeCount ? item.totalStrength / item.portfolioEdgeCount : 0
            }))
            .sort((a, b) =>
                b.portfolioEdgeCount - a.portfolioEdgeCount ||
                b.avgStrength - a.avgStrength ||
                (b.node.degree - a.node.degree) ||
                ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            )
            .slice(0, 5);
        const strongestEdge = edgeItems
            .sort((a, b) => b.strength - a.strength || String(a.source.ticker || '').localeCompare(String(b.source.ticker || '')))[0] || null;

        return {
            active,
            matchedCount: context.matchedPortfolioNodes.length,
            unmatchedTickers: context.unmatchedPortfolioTickers,
            firstDegreeExposureCount: firstDegreeNodes.length,
            topHubs,
            topSectors: nexusSummary.topExposedSectors?.length ? nexusSummary.topExposedSectors : context.getCompanyDistribution(exposureNodes, node => node.sector || 'Other').slice(0, 5),
            topIndustryGroups: nexusSummary.topExposedIndustryGroups?.length ? nexusSummary.topExposedIndustryGroups : context.getCompanyDistribution(exposureNodes, node => context.getCompanyIndustryGroup(node) || 'Other').slice(0, 5),
            strongestEdge,
            nexus: nexusSummary
        };
    }

    function getPortfolioNexusSummary(context) {
        if (context.portfolioNexusSummary) return context.portfolioNexusSummary;
        return createEmptyPortfolioNexusSummary(context);
    }

    function createEmptyPortfolioNexusSummary(context) {
        return {
            active: context.isPortfolioAnalysisActive(),
            matchedHoldings: context.matchedPortfolioNodes,
            unmatchedTickers: context.unmatchedPortfolioTickers,
            totalAdjacentNodeCount: context.portfolioAdjacentNodeIds.size,
            repeatedExposureNodes: [],
            topNexusCompany: null,
            topExposedSectors: [],
            topExposedIndustryGroups: [],
            strongestPortfolioEdge: null,
            portfolioClusterTouchpoints: [],
            portfolioNexusScore: 0,
            nexusNodesById: new Map()
        };
    }

    function computePortfolioNexusSummary(context) {
        const summary = createEmptyPortfolioNexusSummary(context);
        if (!context.isPortfolioAnalysisActive() || !context.matchedPortfolioNodes.length) return summary;

        const matchedIds = new Set(context.matchedPortfolioNodes.map(node => node.id));
        const nodeStats = [];
        const edgeItemsByKey = new Map();
        const adjacentNodes = [];

        context.matchedPortfolioNodes.forEach(holding => {
            (context.adjacencyById.get(holding.id) || []).forEach(item => {
                if (item.link?.key) edgeItemsByKey.set(item.link.key, item.link);
            });
        });

        context.portfolioConnectionsByNodeId.forEach((connectionItems, nodeId) => {
            const node = context.nodeById.get(nodeId);
            if (!node || matchedIds.has(node.id) || !connectionItems.length) return;

            adjacentNodes.push(node);
            const holdingById = new Map();
            const relationshipTypes = new Set();
            let totalStrength = 0;
            let highConfidenceCount = 0;

            connectionItems.forEach(item => {
                if (item.holding) holdingById.set(item.holding.id, item.holding);
                relationshipTypes.add(item.link?.type || 'link');
                const strength = context.getConnectionStrength(item.link);
                totalStrength += strength;
                if ((Number(item.link?.confidence) || 0) >= 4) highConfidenceCount += 1;
            });

            const edgeCount = connectionItems.length;
            const holdingCount = holdingById.size;
            const avgStrength = edgeCount ? totalStrength / edgeCount : 0;
            const highConfidenceShare = edgeCount ? highConfidenceCount / edgeCount : 0;
            const holdingCoverage = context.matchedPortfolioNodes.length ? holdingCount / context.matchedPortfolioNodes.length : 0;
            const degreeFactor = context.clamp((node.degree || context.degreeById.get(node.id) || 0) / 12, 0, 1);
            const score = Math.round(context.clamp(
                (holdingCoverage * 0.48 + avgStrength * 0.30 + degreeFactor * 0.14 + highConfidenceShare * 0.08) * 100,
                0,
                100
            ));
            const connectedHoldings = [...holdingById.values()]
                .sort((a, b) => String(a.ticker || '').localeCompare(String(b.ticker || '')));

            nodeStats.push({
                node,
                connectedHoldings,
                connectedPortfolioTickers: connectedHoldings.map(holding => holding.ticker || '').filter(Boolean),
                holdingCount,
                portfolioEdgeCount: edgeCount,
                avgStrength,
                relationshipTypes: [...relationshipTypes].sort((a, b) => String(a).localeCompare(String(b))),
                highConfidenceShare,
                score
            });
        });

        nodeStats.sort(sortPortfolioNexusStats);
        const repeatedExposureNodes = nodeStats
            .filter(item => item.holdingCount >= 2)
            .sort(sortPortfolioNexusStats);
        const topNexusCompany = nodeStats[0] || null;
        const strongestPortfolioEdge = [...edgeItemsByKey.values()]
            .filter(Boolean)
            .sort((a, b) =>
                context.getConnectionStrength(b) - context.getConnectionStrength(a) ||
                String(a.source?.ticker || '').localeCompare(String(b.source?.ticker || ''))
            )[0] || null;
        const topScore = topNexusCompany?.score || 0;
        const repeatFactor = context.matchedPortfolioNodes.length > 1
            ? context.clamp(repeatedExposureNodes.length / Math.max(1, context.matchedPortfolioNodes.length), 0, 1)
            : 0;

        summary.totalAdjacentNodeCount = adjacentNodes.length;
        summary.repeatedExposureNodes = repeatedExposureNodes;
        summary.topNexusCompany = topNexusCompany;
        summary.topExposedSectors = context.getCompanyDistribution(adjacentNodes, node => node.sector || 'Other').slice(0, 5);
        summary.topExposedIndustryGroups = context.getCompanyDistribution(adjacentNodes, node => context.getCompanyIndustryGroup(node) || 'Other').slice(0, 5);
        summary.strongestPortfolioEdge = strongestPortfolioEdge;
        summary.portfolioClusterTouchpoints = getPortfolioClusterTouchpoints(nodeStats, context).slice(0, 3);
        summary.portfolioNexusScore = Math.round(context.clamp(topScore * 0.72 + repeatFactor * 28, 0, 100));
        summary.nexusNodesById = new Map(nodeStats.map(item => [item.node.id, item]));
        return summary;
    }

    function sortPortfolioNexusStats(a, b) {
        return b.score - a.score ||
            b.holdingCount - a.holdingCount ||
            b.avgStrength - a.avgStrength ||
            (b.node.degree - a.node.degree) ||
            ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
            String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''));
    }

    function getPortfolioClusterTouchpoints(nodeStats, context) {
        const footprintIds = new Set([
            ...context.matchedPortfolioNodes.map(node => node.id),
            ...context.portfolioAdjacentNodeIds
        ]);
        const centerCandidates = [
            ...context.matchedPortfolioNodes,
            ...nodeStats.slice(0, 8).map(item => item.node)
        ].filter(Boolean);
        const touchpointsByCenterId = new Map();

        centerCandidates.forEach(center => {
            if (touchpointsByCenterId.has(center.id)) return;
            const cluster = context.getNodeCluster(center.id);
            const touchedItems = (cluster.clusterItems || []).filter(item => footprintIds.has(item.node.id));
            const touchedHoldingItems = touchedItems.filter(item => context.isPortfolioNode(item.node));
            if ((cluster.clusterItems || []).length < 2 || touchedItems.length < 2) return;

            const avgStrength = touchedItems.length
                ? touchedItems.reduce((sum, item) => sum + context.clamp(item.avgStrength || item.score || 0, 0, 1), 0) / touchedItems.length
                : 0;
            const score = touchedItems.length * 0.35 +
                touchedHoldingItems.length * 0.65 +
                context.clamp(cluster.clusterStrength || 0, 0, 1) * 2 +
                avgStrength;

            touchpointsByCenterId.set(center.id, {
                center,
                cluster,
                touchedCount: touchedItems.length,
                holdingCount: touchedHoldingItems.length,
                connectedPortfolioTickers: touchedHoldingItems
                    .map(item => item.node.ticker || '')
                    .filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b))),
                avgStrength,
                score,
                topMembers: (cluster.clusterItems || [])
                    .filter(item => item.node.id !== center.id)
                    .slice(0, 4)
                    .map(item => item.node)
            });
        });

        return [...touchpointsByCenterId.values()]
            .sort((a, b) =>
                b.score - a.score ||
                b.touchedCount - a.touchedCount ||
                b.holdingCount - a.holdingCount ||
                String(a.center.ticker || '').localeCompare(String(b.center.ticker || ''))
            );
    }

    function recomputePortfolioExposure(context) {
        if (!context.isPortfolioAnalysisActive()) return;

        const holdingIds = new Set(context.matchedPortfolioNodes.map(node => node.id));
        context.matchedPortfolioNodes.forEach(holding => {
            (context.adjacencyById.get(holding.id) || []).forEach(item => {
                context.portfolioEdgeKeys.add(item.link.key);
                if (holdingIds.has(item.node.id)) return;

                context.portfolioAdjacentNodeIds.add(item.node.id);
                const existing = context.portfolioConnectionsByNodeId.get(item.node.id) || [];
                existing.push({ holding, link: item.link });
                context.portfolioConnectionsByNodeId.set(item.node.id, existing);
            });
        });
    }

    function isPortfolioAnalysisActive(context) {
        return context.portfolioTickerSet.size > 0;
    }

    function isPortfolioNode(node, context) {
        return Boolean(node) && context.matchedPortfolioNodes.some(item => item.id === node.id);
    }

    function isPortfolioAdjacentNode(node, context) {
        return Boolean(node) && !isPortfolioNode(node, context) && context.portfolioAdjacentNodeIds.has(node.id);
    }

    function isPortfolioTopNexusNode(node, context) {
        if (!node || isPortfolioNode(node, context)) return false;
        return getPortfolioNexusSummary(context).topNexusCompany?.node?.id === node.id;
    }

    function isPortfolioRepeatedExposureNode(node, context) {
        if (!node || isPortfolioNode(node, context)) return false;
        return getPortfolioNexusSummary(context).repeatedExposureNodes.some(item => item.node.id === node.id);
    }

    function isPortfolioHighlightedNode(node, context) {
        return isPortfolioNode(node, context) || isPortfolioAdjacentNode(node, context);
    }

    function getPortfolioConnectionItemsForNode(node, context) {
        if (!node) return [];
        return context.portfolioConnectionsByNodeId.get(node.id) || [];
    }

    window.StockPhotonicIntelligence.portfolioNexus = {
        parsePortfolioTickers,
        getPortfolioExposureSummary,
        getPortfolioNexusSummary,
        createEmptyPortfolioNexusSummary,
        computePortfolioNexusSummary,
        sortPortfolioNexusStats,
        getPortfolioClusterTouchpoints,
        recomputePortfolioExposure,
        isPortfolioAnalysisActive,
        isPortfolioNode,
        isPortfolioAdjacentNode,
        isPortfolioTopNexusNode,
        isPortfolioRepeatedExposureNode,
        isPortfolioHighlightedNode,
        getPortfolioConnectionItemsForNode
    };
})();
