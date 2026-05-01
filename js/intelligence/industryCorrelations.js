(function () {
    window.StockPhotonicIntelligence = window.StockPhotonicIntelligence || {};

    function getIndustryGroupCorrelations(sourceLinks = null, context) {
        const linksForCorrelation = Array.isArray(sourceLinks)
            ? sourceLinks
            : (context.visibleLinks.length ? context.visibleLinks : context.links);
        const pairStats = new Map();
        const sameGroupStats = new Map();

        linksForCorrelation.forEach(link => {
            if (!link?.source || !link?.target) return;

            const sourceGroup = context.getCompanyIndustryGroup(link.source) || 'Other';
            const targetGroup = context.getCompanyIndustryGroup(link.target) || 'Other';
            const strength = context.getConnectionStrength(link);
            const confidence = Number(link.confidence) || 0;
            const type = link.type || 'link';

            if (sourceGroup === targetGroup) {
                const sameGroup = sameGroupStats.get(sourceGroup) || {
                    group: sourceGroup,
                    edgeCount: 0,
                    totalStrength: 0,
                    highConfidenceEdgeCount: 0
                };
                sameGroup.edgeCount += 1;
                sameGroup.totalStrength += strength;
                if (confidence >= context.highConfidenceEdgeMin) sameGroup.highConfidenceEdgeCount += 1;
                sameGroupStats.set(sourceGroup, sameGroup);
                return;
            }

            const [groupA, groupB] = [sourceGroup, targetGroup].sort((a, b) => String(a).localeCompare(String(b)));
            const key = `${groupA}::${groupB}`;
            const existing = pairStats.get(key) || {
                key,
                groupA,
                groupB,
                edgeCount: 0,
                totalStrength: 0,
                highConfidenceEdgeCount: 0,
                typeCounts: new Map(),
                tickerCounts: new Map()
            };

            existing.edgeCount += 1;
            existing.totalStrength += strength;
            if (confidence >= context.highConfidenceEdgeMin) existing.highConfidenceEdgeCount += 1;
            existing.typeCounts.set(type, (existing.typeCounts.get(type) || 0) + 1);
            [link.source, link.target].forEach(node => {
                const ticker = node?.ticker || node?.name || '';
                if (ticker) existing.tickerCounts.set(ticker, (existing.tickerCounts.get(ticker) || 0) + 1);
            });
            pairStats.set(key, existing);
        });

        const correlations = [...pairStats.values()]
            .map(item => {
                const averageStrength = item.edgeCount ? item.totalStrength / item.edgeCount : 0;
                const dominantConnectionType = [...item.typeCounts.entries()]
                    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || 'link';
                const involvedTickers = [...item.tickerCounts.entries()]
                    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
                    .map(([ticker]) => ticker);

                return {
                    key: item.key,
                    groupA: item.groupA,
                    groupB: item.groupB,
                    edgeCount: item.edgeCount,
                    averageStrength,
                    averageStrengthPercent: Math.round(averageStrength * 100),
                    highConfidenceEdgeCount: item.highConfidenceEdgeCount,
                    involvedTickers,
                    dominantConnectionType
                };
            })
            .sort(sortIndustryCorrelations);

        correlations.sameGroupCorrelations = [...sameGroupStats.values()]
            .map(item => ({
                ...item,
                averageStrength: item.edgeCount ? item.totalStrength / item.edgeCount : 0,
                averageStrengthPercent: item.edgeCount ? Math.round((item.totalStrength / item.edgeCount) * 100) : 0
            }))
            .sort((a, b) => b.edgeCount - a.edgeCount || b.averageStrength - a.averageStrength || String(a.group).localeCompare(String(b.group)));
        correlations.sameGroupEdgeCount = correlations.sameGroupCorrelations.reduce((sum, item) => sum + item.edgeCount, 0);

        return correlations;
    }

    function sortIndustryCorrelations(a, b) {
        return b.edgeCount - a.edgeCount ||
            b.averageStrength - a.averageStrength ||
            b.highConfidenceEdgeCount - a.highConfidenceEdgeCount ||
            String(a.groupA).localeCompare(String(b.groupA)) ||
            String(a.groupB).localeCompare(String(b.groupB));
    }

    function getIndustryCorrelationContextForNode(node, context) {
        if (!node) return null;

        const cacheKey = `industry-correlation-context:${node.id}`;
        if (context.graphIntelligenceCache.has(cacheKey)) return context.graphIntelligenceCache.get(cacheKey);

        const nodeGroup = context.getCompanyIndustryGroup(node);
        const correlations = getIndustryGroupCorrelations(context.links, context);
        const groupCorrelations = correlations
            .filter(item => item.groupA === nodeGroup || item.groupB === nodeGroup)
            .sort(sortIndustryCorrelations);
        if (!groupCorrelations.length) {
            context.graphIntelligenceCache.set(cacheKey, null);
            return null;
        }

        const strongestCorrelation = [...groupCorrelations]
            .sort((a, b) => b.averageStrength - a.averageStrength || b.edgeCount - a.edgeCount || b.highConfidenceEdgeCount - a.highConfidenceEdgeCount)
            [0];
        const adjacentGroups = [...new Set(groupCorrelations.map(item => getCorrelationAdjacentGroup(item, nodeGroup)).filter(Boolean))]
            .sort();
        const directAdjacentGroups = new Set();
        (context.adjacencyById.get(node.id) || []).forEach(item => {
            const adjacentGroup = context.getCompanyIndustryGroup(item.node);
            if (adjacentGroup && adjacentGroup !== nodeGroup) directAdjacentGroups.add(adjacentGroup);
        });

        const topCorrelation = groupCorrelations[0];
        const correlationContext = {
            nodeGroup,
            topCorrelation,
            connectedIndustryGroupCount: adjacentGroups.length,
            strongestAdjacentGroup: getCorrelationAdjacentGroup(strongestCorrelation, nodeGroup),
            strongestAveragePercent: strongestCorrelation?.averageStrengthPercent || 0,
            crossGroupBridge: directAdjacentGroups.size >= 2,
            isStrong: Boolean(topCorrelation) &&
                (topCorrelation.edgeCount >= context.strongIndustryCorrelationMinEdgeCount ||
                    topCorrelation.averageStrength >= context.strongIndustryCorrelationMinAvgStrength)
        };

        context.graphIntelligenceCache.set(cacheKey, correlationContext);
        return correlationContext;
    }

    function getCorrelationAdjacentGroup(correlation, group) {
        if (!correlation || !group) return '';
        if (correlation.groupA === group) return correlation.groupB;
        if (correlation.groupB === group) return correlation.groupA;
        return '';
    }

    function isIndustryCorrelationHintNode(node, context) {
        if (!node || !context.selectedNode || context.isFocusModeActive()) return false;
        if (node.id === context.selectedNode.id) return false;
        if (context.focusNeighborIds.has(node.id)) return false;
        if (context.activeClusterNodeIds.has(node.id)) return false;
        if (context.isNodeDimmedByIndustryGroup(node)) return false;

        const correlationContext = context.getIndustryCorrelationContextForNode
            ? context.getIndustryCorrelationContextForNode(context.selectedNode)
            : getIndustryCorrelationContextForNode(context.selectedNode, context);
        if (!correlationContext?.isStrong || !correlationContext.strongestAdjacentGroup) return false;
        return context.getCompanyIndustryGroup(node) === correlationContext.strongestAdjacentGroup;
    }

    window.StockPhotonicIntelligence.industryCorrelations = {
        getIndustryGroupCorrelations,
        sortIndustryCorrelations,
        getIndustryCorrelationContextForNode,
        getCorrelationAdjacentGroup,
        isIndustryCorrelationHintNode
    };
})();
