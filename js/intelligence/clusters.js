(function () {
    window.StockPhotonicIntelligence = window.StockPhotonicIntelligence || {};

    function getSharedConnections(nodeId, context) {
        const node = context.nodeById.get(nodeId) || context.getNodeFromDomId(nodeId);
        if (!node) return [];

        const cacheKey = `shared:${node.id}`;
        if (context.graphIntelligenceCache.has(cacheKey)) return context.graphIntelligenceCache.get(cacheKey);

        const selectedNeighbors = context.adjacencyById.get(node.id) || [];
        const directNeighborIds = new Set(selectedNeighbors.map(item => item.node.id));
        const candidates = new Map();

        selectedNeighbors.forEach(selectedNeighborItem => {
            const sharedNeighbor = selectedNeighborItem.node;
            const selectedStrength = context.getConnectionStrength(selectedNeighborItem.link);

            (context.adjacencyById.get(sharedNeighbor.id) || []).forEach(candidateItem => {
                const candidate = candidateItem.node;
                if (!candidate || candidate.id === node.id) return;

                const candidateStrength = context.getConnectionStrength(candidateItem.link);
                const pathStrength = (selectedStrength + candidateStrength) / 2;
                const existing = candidates.get(candidate.id) || {
                    node: candidate,
                    count: 0,
                    totalStrength: 0,
                    sharedNeighbors: [],
                    sharedNeighborIds: new Set(),
                    directlyConnected: directNeighborIds.has(candidate.id)
                };

                if (existing.sharedNeighborIds.has(sharedNeighbor.id)) return;

                existing.count += 1;
                existing.totalStrength += pathStrength;
                existing.sharedNeighborIds.add(sharedNeighbor.id);
                existing.sharedNeighbors.push({
                    node: sharedNeighbor,
                    strength: pathStrength,
                    sourceStrength: selectedStrength,
                    targetStrength: candidateStrength
                });
                candidates.set(candidate.id, existing);
            });
        });

        const sharedConnections = [...candidates.values()]
            .map(item => ({
                ...item,
                avgStrength: item.count ? item.totalStrength / item.count : 0,
                score: item.count * (item.count ? item.totalStrength / item.count : 0),
                sharedNeighbors: item.sharedNeighbors.sort((a, b) =>
                    b.strength - a.strength ||
                    String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
                )
            }))
            .sort((a, b) =>
                b.count - a.count ||
                b.avgStrength - a.avgStrength ||
                (b.node.degree - a.node.degree) ||
                ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            );

        context.graphIntelligenceCache.set(cacheKey, sharedConnections);
        return sharedConnections;
    }

    function getNodeCluster(nodeId, context) {
        const node = context.nodeById.get(nodeId) || context.getNodeFromDomId(nodeId);
        if (!node) return { clusterNodes: [], clusterItems: [], clusterStrength: 0 };

        const cacheKey = `cluster:${node.id}`;
        if (context.graphIntelligenceCache.has(cacheKey)) return context.graphIntelligenceCache.get(cacheKey);

        const clusterItemsById = new Map();
        clusterItemsById.set(node.id, {
            node,
            role: 'selected',
            count: 0,
            avgStrength: 1,
            score: 1,
            directLink: null,
            sharedNeighbors: []
        });

        (context.adjacencyById.get(node.id) || [])
            .filter(item => context.getConnectionStrength(item.link) >= context.clusterMinStrength)
            .forEach(item => {
                const strength = context.getConnectionStrength(item.link);
                clusterItemsById.set(item.node.id, {
                    node: item.node,
                    role: 'direct',
                    count: 1,
                    avgStrength: strength,
                    score: strength,
                    directLink: item.link,
                    sharedNeighbors: []
                });
            });

        getSharedConnections(node.id, context)
            .filter(item => item.count >= context.clusterSharedConnectionMin && item.avgStrength >= context.clusterMinStrength)
            .forEach(item => {
                const existing = clusterItemsById.get(item.node.id);
                const supportScore = context.clamp(item.avgStrength * Math.min(1.35, 0.7 + item.count * 0.18), 0, 1);

                if (existing) {
                    existing.count = Math.max(existing.count, item.count);
                    existing.avgStrength = Math.max(existing.avgStrength, item.avgStrength);
                    existing.score = Math.max(existing.score, supportScore);
                    existing.sharedNeighbors = item.sharedNeighbors;
                    if (existing.role !== 'selected') existing.role = existing.role === 'direct' ? 'direct-shared' : 'shared';
                    return;
                }

                clusterItemsById.set(item.node.id, {
                    node: item.node,
                    role: 'shared',
                    count: item.count,
                    avgStrength: item.avgStrength,
                    score: supportScore,
                    directLink: null,
                    sharedNeighbors: item.sharedNeighbors
                });
            });

        const clusterItems = [...clusterItemsById.values()].sort((a, b) => {
            if (a.role === 'selected') return -1;
            if (b.role === 'selected') return 1;
            return b.score - a.score ||
                b.count - a.count ||
                (b.node.degree - a.node.degree) ||
                ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''));
        });
        const scoredItems = clusterItems.filter(item => item.role !== 'selected');
        const clusterStrength = scoredItems.length
            ? scoredItems.reduce((sum, item) => sum + context.clamp(item.score, 0, 1), 0) / scoredItems.length
            : 0;
        const cluster = {
            clusterNodes: clusterItems.map(item => item.node),
            clusterItems,
            clusterStrength
        };

        context.graphIntelligenceCache.set(cacheKey, cluster);
        return cluster;
    }

    function getHiddenRelationships(nodeId, context) {
        return getSharedConnections(nodeId, context)
            .filter(item => !item.directlyConnected && item.count >= context.clusterSharedConnectionMin)
            .slice(0, context.clusterSectionLimit);
    }

    function getSharedNeighborTickerList(item, limit = 3) {
        return (item.sharedNeighbors || [])
            .slice(0, limit)
            .map(shared => shared.node.ticker || shared.node.name || '')
            .filter(Boolean)
            .join(', ');
    }

    window.StockPhotonicIntelligence.clusters = {
        getSharedConnections,
        getNodeCluster,
        getHiddenRelationships,
        getSharedNeighborTickerList
    };
})();
