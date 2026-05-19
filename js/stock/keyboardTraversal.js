(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    function getTraversalTargets(kind, context = {}) {
        if (kind === 'hub') return getHubTargets(context);
        if (kind === 'bridge') return getBridgeTargets(context);
        if (kind === 'corridor') return getCorridorTargets(context);
        if (kind === 'route') return getRouteTargets(context);
        return [];
    }

    function getHubTargets(context = {}) {
        const hubs = context.largeGraphNavigationModel?.hubSummaries?.length
            ? context.largeGraphNavigationModel.hubSummaries
            : context.stockGraphIntelligence?.getStrategicHubProfiles?.(context.visibleNodes || [], context, 18) || [];
        return hubs
            .map(item => item.node || item)
            .filter(Boolean)
            .map(node => ({
                type: 'node',
                key: node.id,
                node,
                label: node.ticker || node.name || 'Strategic hub'
            }));
    }

    function getBridgeTargets(context = {}) {
        const profiles = context.stockGraphIntelligence?.getStrategicHubProfiles?.(context.visibleNodes || [], context, 28) || [];
        const bridges = profiles
            .filter(item => {
                const roles = item.profile?.roles || [];
                return roles.includes('ecosystem_bridge') || roles.includes('corridor_company') || roles.includes('cross_sector_anchor');
            })
            .map(item => item.node)
            .filter(Boolean);
        const fallback = bridges.length ? [] : getHubTargets(context).map(item => item.node).slice(0, 8);
        return [...bridges, ...fallback]
            .filter(Boolean)
            .map(node => ({
                type: 'node',
                key: node.id,
                node,
                label: node.ticker || node.name || 'Bridge company'
            }));
    }

    function getCorridorTargets(context = {}) {
        const buckets = context.largeGraphNavigationModel?.corridorBuckets?.length
            ? context.largeGraphNavigationModel.corridorBuckets
            : context.stockLargeGraphNavigation?.buildNavigationModel?.({
                ...context,
                mode: 'overview'
            })?.corridorBuckets || [];
        return buckets.map(bucket => ({
            type: 'corridor',
            key: bucket.key,
            label: bucket.label || titleCase(bucket.key),
            bucket
        }));
    }

    function getRouteTargets(context = {}) {
        const comparisonNodes = context.stockRouteComparison?.getTraversalNodes?.(
            context.activeRouteComparison,
            context.activeRelationshipRoute
        ) || [];
        return comparisonNodes.map(node => ({
            type: 'node',
            key: node.id,
            node,
            label: node.ticker || node.name || 'Route node'
        }));
    }

    function nextCursor(currentIndex, count, direction = 1) {
        if (!count) return -1;
        const safe = Number.isFinite(currentIndex) ? currentIndex : -1;
        return (safe + (direction < 0 ? -1 : 1) + count) % count;
    }

    function describeTargets(kind, count) {
        const label = kind === 'hub'
            ? 'strategic hubs'
            : kind === 'bridge'
                ? 'bridge companies'
                : kind === 'corridor'
                    ? 'corridor lanes'
                    : 'route nodes';
        return count ? `${count} ${label} available` : `No ${label} visible`;
    }

    function titleCase(value) {
        return String(value || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicStock.keyboardTraversal = {
        getTraversalTargets,
        nextCursor,
        describeTargets
    };
})();
