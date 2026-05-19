(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const MODES = [
        { key: 'overview', label: 'Overview', shortLabel: 'Overview' },
        { key: 'ecosystem_focus', label: 'Ecosystem Focus', shortLabel: 'Ecosystem' },
        { key: 'corridor_focus', label: 'Corridor Focus', shortLabel: 'Corridor' },
        { key: 'neighborhood', label: 'Neighborhood Isolation', shortLabel: 'Neighborhood' },
        { key: 'strategic_hubs', label: 'Strategic Hubs', shortLabel: 'Hubs' },
        { key: 'route_isolation', label: 'Route Isolation', shortLabel: 'Route' },
        { key: 'production_only', label: 'Production Only', shortLabel: 'Production' },
        { key: 'preview_only', label: 'Preview Only', shortLabel: 'Preview' }
    ];

    const MODE_BY_KEY = new Map(MODES.map(mode => [mode.key, mode]));

    const CORRIDORS = [
        {
            key: 'ai_compute_foundry_cloud',
            label: 'AI Compute / Foundry / Cloud',
            shortLabel: 'AI Compute',
            ecosystemKeys: ['ai_infrastructure', 'semiconductor_supply_chain', 'cloud_hyperscaler'],
            pattern: /\b(ai|accelerator|gpu|hbm|memory|semiconductor|foundry|fab|cloud|hyperscaler|data center|networking|server|power|cooling)\b/i
        },
        {
            key: 'enterprise_workflow_security',
            label: 'Enterprise Workflow / Security',
            shortLabel: 'Workflow',
            ecosystemKeys: ['enterprise_saas_workflow', 'cloud_hyperscaler'],
            pattern: /\b(saas|workflow|crm|productivity|enterprise|software|security|cloud security|data platform|observability|collaboration)\b/i
        },
        {
            key: 'financial_market_infrastructure',
            label: 'Financial Market Infrastructure',
            shortLabel: 'Finance',
            ecosystemKeys: ['financial_payments'],
            pattern: /\b(payment|payments|card|bank|issuer|exchange|market data|clearing|index|ratings|asset manager|broker|financial)\b/i
        },
        {
            key: 'aerospace_defense_industrial',
            label: 'Aerospace / Defense / Industrial',
            shortLabel: 'Aerospace',
            ecosystemKeys: ['energy_infrastructure'],
            pattern: /\b(aerospace|defense|aircraft|engine|oem|industrial|avionics|shipbuilding|mission|supplier)\b/i
        },
        {
            key: 'retail_logistics_distribution',
            label: 'Retail / Logistics / Distribution',
            shortLabel: 'Retail / Logistics',
            ecosystemKeys: [],
            pattern: /\b(retail|commerce|consumer|restaurant|coffee|delivery|logistics|rail|freight|parcel|distribution|warehouse|home improvement)\b/i
        },
        {
            key: 'healthcare_pharma_benefits',
            label: 'Healthcare / Pharma / Benefits',
            shortLabel: 'Healthcare',
            ecosystemKeys: ['healthcare_biotech'],
            pattern: /\b(healthcare|pharma|pharmaceutical|biotech|pbm|benefits|insurance|managed care|medtech|life sciences)\b/i
        },
        {
            key: 'energy_grid_infrastructure',
            label: 'Energy / Grid Infrastructure',
            shortLabel: 'Energy / Grid',
            ecosystemKeys: ['energy_infrastructure'],
            pattern: /\b(energy|oil|gas|power|grid|pipeline|utility|electrical|hvac|cooling|industrial equipment)\b/i
        }
    ];

    const CORRIDOR_BY_KEY = new Map(CORRIDORS.map(corridor => [corridor.key, corridor]));
    const navigationCache = new WeakMap();

    function getModes() {
        return MODES.map(mode => ({ ...mode }));
    }

    function getCorridorDefinitions() {
        return CORRIDORS.map(corridor => ({
            key: corridor.key,
            label: corridor.label,
            shortLabel: corridor.shortLabel
        }));
    }

    function normalizeMode(mode) {
        const key = String(mode || '').trim();
        return MODE_BY_KEY.has(key) ? key : 'overview';
    }

    function buildNavigationModel(context = {}) {
        const mode = normalizeMode(context.mode);
        const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
        const nodes = getNodesForLinks(context.visibleNodes || context.nodes || [], links);
        const cacheKey = getCacheKey(context, mode, links);
        const cached = getCachedModel(links, cacheKey);
        if (cached) return cached;

        const allLinkKeys = new Set(links.map(getLinkKey).filter(Boolean));
        const allNodeIds = new Set(nodes.map(node => node?.id).filter(id => id !== null && id !== undefined));
        const hubSummaries = buildHubSummaries(nodes, links, context);
        const ecosystemBuckets = buildEcosystemBuckets(links, context);
        const corridorBuckets = buildCorridorBuckets(links, context);
        const selectedNode = context.selectedNode || null;
        const activeRoute = context.activeRelationshipRoute || null;
        const activeRouteComparison = context.activeRouteComparison || null;
        const requestedEcosystemKey = String(context.ecosystemKey || '').trim();
        const requestedCorridorKey = String(context.corridorKey || '').trim();
        const effectiveEcosystemKey = requestedEcosystemKey ||
            String(context.activeEcosystemOverlayKey || '').trim() ||
            ecosystemBuckets[0]?.key ||
            '';
        const effectiveCorridorKey = requestedCorridorKey || corridorBuckets[0]?.key || '';

        let linkKeys = new Set(allLinkKeys);
        let nodeIds = new Set(allNodeIds);
        let focusLabel = '';
        let focusKind = 'all';
        let neighborhood = null;
        let route = null;

        if (mode === 'preview_only') {
            linkKeys = new Set();
            nodeIds = selectedNode ? new Set([selectedNode.id]) : new Set();
            focusLabel = 'Preview overlays';
            focusKind = 'preview';
        } else if (mode === 'ecosystem_focus') {
            const filtered = links.filter(link => getLinkEcosystemKeys(link, context).includes(effectiveEcosystemKey));
            linkKeys = new Set(filtered.map(getLinkKey).filter(Boolean));
            nodeIds = getNodeIdSetFromLinks(filtered);
            focusLabel = getEcosystemLabel(effectiveEcosystemKey, context);
            focusKind = 'ecosystem';
        } else if (mode === 'corridor_focus') {
            const filtered = links.filter(link => getLinkCorridorKeys(link, context).includes(effectiveCorridorKey));
            linkKeys = new Set(filtered.map(getLinkKey).filter(Boolean));
            nodeIds = getNodeIdSetFromLinks(filtered);
            focusLabel = getCorridorLabel(effectiveCorridorKey);
            focusKind = 'corridor';
        } else if (mode === 'neighborhood') {
            const center = selectedNode || hubSummaries[0]?.node || null;
            neighborhood = buildNeighborhood(center, context, getNeighborhoodDepth(context), allLinkKeys);
            linkKeys = neighborhood.linkKeys;
            nodeIds = neighborhood.nodeIds;
            focusLabel = center ? `${getNodeLabel(center)} depth ${neighborhood.depth}` : 'No center';
            focusKind = 'neighborhood';
        } else if (mode === 'strategic_hubs') {
            const hubIds = new Set(hubSummaries.slice(0, getHubLimit(links.length)).map(item => item.nodeId));
            const filtered = links.filter(link => hubIds.has(link.source?.id) || hubIds.has(link.target?.id));
            linkKeys = new Set(filtered.map(getLinkKey).filter(Boolean));
            nodeIds = getNodeIdSetFromLinks(filtered);
            hubIds.forEach(id => nodeIds.add(id));
            focusLabel = `${hubIds.size} hubs`;
            focusKind = 'hubs';
        } else if (mode === 'route_isolation') {
            route = buildRouteIsolation(activeRoute, selectedNode, context, allLinkKeys, activeRouteComparison);
            linkKeys = route.linkKeys;
            nodeIds = route.nodeIds;
            focusLabel = route.label;
            focusKind = 'route';
        } else if (mode === 'production_only') {
            focusLabel = 'Production graph';
            focusKind = 'production';
        }

        const visibleLinkCount = [...linkKeys].filter(key => allLinkKeys.has(key)).length;
        const model = {
            mode,
            modeLabel: getModeLabel(mode),
            modeShortLabel: MODE_BY_KEY.get(mode)?.shortLabel || getModeLabel(mode),
            isActive: mode !== 'overview',
            productionOnly: mode === 'production_only',
            previewOnly: mode === 'preview_only',
            focusKind,
            focusLabel,
            ecosystemKey: effectiveEcosystemKey,
            corridorKey: effectiveCorridorKey,
            linkKeys,
            nodeIds,
            hubSummaries,
            ecosystemBuckets,
            corridorBuckets,
            route,
            neighborhood,
            progressiveDisclosure: {
                inputNodeCount: allNodeIds.size,
                inputEdgeCount: allLinkKeys.size,
                visibleNodeCount: nodeIds.size,
                visibleEdgeCount: visibleLinkCount,
                suppressedEdgeCount: Math.max(0, allLinkKeys.size - visibleLinkCount),
                disclosureRatio: allLinkKeys.size ? visibleLinkCount / allLinkKeys.size : 1,
                selectedNeighborhoodDepth: getNeighborhoodDepth(context),
                sourceBackedVisibleEdges: links.filter(link => linkKeys.has(getLinkKey(link)) && context.relationshipHasSourceEvidence?.(link)).length,
                secBackedVisibleEdges: links.filter(link => linkKeys.has(getLinkKey(link)) && context.isSecBackedConnection?.(link)).length
            },
            cacheKey
        };

        cacheModel(links, cacheKey, model);
        return model;
    }

    function getCacheKey(context, mode, links) {
        const selectedId = context.selectedNode?.id ?? '';
        const routeSize = context.activeRelationshipRoute?.linkKeys?.size ?? 0;
        const comparisonSize = context.activeRouteComparison?.linkKeys?.size ?? 0;
        const comparisonId = context.activeRouteComparison?.id || '';
        return [
            mode,
            context.ecosystemKey || '',
            context.corridorKey || '',
            context.activeEcosystemOverlayKey || '',
            selectedId,
            getNeighborhoodDepth(context),
            routeSize,
            comparisonSize,
            comparisonId,
            links.length
        ].join('|');
    }

    function getCachedModel(links, key) {
        const linkCache = navigationCache.get(links);
        return linkCache?.get(key) || null;
    }

    function cacheModel(links, key, model) {
        let linkCache = navigationCache.get(links);
        if (!linkCache) {
            linkCache = new Map();
            navigationCache.set(links, linkCache);
        }
        linkCache.set(key, model);
    }

    function linkPassesMode(link, model) {
        if (!model || !model.isActive) return true;
        if (model.previewOnly) return false;
        return model.linkKeys?.has(getLinkKey(link));
    }

    function nodePassesMode(node, model) {
        if (!model || !model.isActive) return true;
        if (model.previewOnly) return true;
        return model.nodeIds?.has(node?.id);
    }

    function getModeLabel(mode) {
        return MODE_BY_KEY.get(normalizeMode(mode))?.label || 'Overview';
    }

    function formatNavigationLabel(model) {
        if (!model || !model.isActive) return 'Overview';
        return model.focusLabel ? `${model.modeShortLabel}: ${model.focusLabel}` : model.modeShortLabel;
    }

    function buildHubSummaries(nodes, links, context) {
        const stats = new Map();
        nodes.forEach(node => {
            if (!node || node.id === undefined || node.id === null) return;
            stats.set(node.id, {
                node,
                nodeId: node.id,
                ticker: node.ticker || node.name || '',
                degree: Number(node.degree || 0),
                visibleDegree: 0,
                sourceBacked: 0,
                secBacked: 0,
                corridorCount: 0,
                ecosystemCount: 0,
                score: 0
            });
        });

        const corridorByNode = new Map();
        const ecosystemByNode = new Map();
        links.forEach(link => {
            [link.source, link.target].filter(Boolean).forEach(node => {
                const row = stats.get(node.id);
                if (!row) return;
                row.visibleDegree += 1;
                if (context.relationshipHasSourceEvidence?.(link)) row.sourceBacked += 1;
                if (context.isSecBackedConnection?.(link)) row.secBacked += 1;
                appendKeys(corridorByNode, node.id, getLinkCorridorKeys(link, context));
                appendKeys(ecosystemByNode, node.id, getLinkEcosystemKeys(link, context));
            });
        });

        stats.forEach(row => {
            row.corridorCount = corridorByNode.get(row.nodeId)?.size || 0;
            row.ecosystemCount = ecosystemByNode.get(row.nodeId)?.size || 0;
            const sourceRatio = row.visibleDegree ? row.sourceBacked / row.visibleDegree : 0;
            row.score =
                row.visibleDegree * 2.4 +
                row.degree * 0.55 +
                row.corridorCount * 2.6 +
                row.ecosystemCount * 1.9 +
                row.secBacked * 0.45 +
                sourceRatio * 4;
        });

        return [...stats.values()]
            .sort((a, b) => b.score - a.score || String(a.ticker).localeCompare(String(b.ticker)));
    }

    function appendKeys(map, id, keys) {
        if (!keys.length) return;
        const set = map.get(id) || new Set();
        keys.forEach(key => set.add(key));
        map.set(id, set);
    }

    function buildEcosystemBuckets(links, context) {
        const buckets = new Map();
        links.forEach(link => {
            getLinkEcosystemKeys(link, context).forEach(key => {
                const bucket = buckets.get(key) || {
                    key,
                    label: getEcosystemLabel(key, context),
                    edgeCount: 0,
                    sourceBacked: 0,
                    secBacked: 0
                };
                bucket.edgeCount += 1;
                if (context.relationshipHasSourceEvidence?.(link)) bucket.sourceBacked += 1;
                if (context.isSecBackedConnection?.(link)) bucket.secBacked += 1;
                buckets.set(key, bucket);
            });
        });
        return sortBuckets(buckets);
    }

    function buildCorridorBuckets(links, context) {
        const buckets = new Map();
        links.forEach(link => {
            getLinkCorridorKeys(link, context).forEach(key => {
                const bucket = buckets.get(key) || {
                    key,
                    label: getCorridorLabel(key),
                    edgeCount: 0,
                    sourceBacked: 0,
                    secBacked: 0,
                    strongEdges: 0
                };
                bucket.edgeCount += 1;
                if (context.relationshipHasSourceEvidence?.(link)) bucket.sourceBacked += 1;
                if (context.isSecBackedConnection?.(link)) bucket.secBacked += 1;
                if ((Number(link.strength) || 0) >= 0.72) bucket.strongEdges += 1;
                buckets.set(key, bucket);
            });
        });
        return sortBuckets(buckets);
    }

    function sortBuckets(buckets) {
        return [...buckets.values()]
            .sort((a, b) =>
                b.edgeCount - a.edgeCount ||
                b.sourceBacked - a.sourceBacked ||
                String(a.label).localeCompare(String(b.label))
            );
    }

    function buildNeighborhood(center, context, depth, allowedLinkKeys) {
        const nodeIds = new Set();
        const linkKeys = new Set();
        if (!center || center.id === undefined || center.id === null) {
            return { centerNodeId: null, centerTicker: '', depth, nodeIds, linkKeys };
        }

        nodeIds.add(center.id);
        let frontier = new Set([center.id]);
        for (let level = 0; level < depth; level += 1) {
            const next = new Set();
            frontier.forEach(nodeId => {
                const adjacent = context.adjacencyById?.get(nodeId) || [];
                adjacent.forEach(item => {
                    const linkKey = getLinkKey(item.link);
                    if (!allowedLinkKeys.has(linkKey)) return;
                    linkKeys.add(linkKey);
                    if (item.node?.id !== undefined && item.node?.id !== null && !nodeIds.has(item.node.id)) {
                        nodeIds.add(item.node.id);
                        next.add(item.node.id);
                    }
                });
            });
            frontier = next;
            if (!frontier.size) break;
        }

        return {
            centerNodeId: center.id,
            centerTicker: center.ticker || center.name || '',
            depth,
            nodeIds,
            linkKeys
        };
    }

    function buildRouteIsolation(activeRoute, selectedNode, context, allowedLinkKeys, activeRouteComparison = null) {
        if (activeRouteComparison?.linkKeys?.size) {
            const linkKeys = new Set([...activeRouteComparison.linkKeys].filter(key => allowedLinkKeys.has(key)));
            const nodeIds = new Set(activeRouteComparison.nodeIds || []);
            if (!nodeIds.size && Array.isArray(activeRouteComparison.routes)) {
                activeRouteComparison.routes.forEach(route => {
                    (route.links || []).forEach(link => {
                        if (!linkKeys.has(getLinkKey(link))) return;
                        if (link.source) nodeIds.add(link.source.id);
                        if (link.target) nodeIds.add(link.target.id);
                    });
                });
            }
            return {
                label: activeRouteComparison.label || 'Route comparison',
                linkKeys,
                nodeIds
            };
        }

        if (activeRoute?.linkKeys?.size) {
            const linkKeys = new Set([...activeRoute.linkKeys].filter(key => allowedLinkKeys.has(key)));
            const nodeIds = new Set(activeRoute.nodeIds || []);
            if (!nodeIds.size && Array.isArray(activeRoute.links)) {
                activeRoute.links.forEach(link => {
                    if (linkKeys.has(getLinkKey(link))) {
                        if (link.source) nodeIds.add(link.source.id);
                        if (link.target) nodeIds.add(link.target.id);
                    }
                });
            }
            return {
                label: activeRoute.label || 'Active route',
                linkKeys,
                nodeIds
            };
        }

        const fallback = buildNeighborhood(selectedNode, context, 1, allowedLinkKeys);
        return {
            label: selectedNode ? `${getNodeLabel(selectedNode)} local route` : 'Select a company',
            linkKeys: fallback.linkKeys,
            nodeIds: fallback.nodeIds
        };
    }

    function getLinkEcosystemKeys(link, context) {
        const keys = context.stockGraphIntelligence?.getLinkEcosystemKeys?.(link, context) || [];
        return unique(keys);
    }

    function getLinkCorridorKeys(link, context) {
        const ecosystemKeys = getLinkEcosystemKeys(link, context);
        const text = [
            link?.relationship_type,
            link?.type,
            link?.label,
            link?.provenance,
            link?.source?.ticker,
            link?.target?.ticker,
            link?.source?.sector,
            link?.target?.sector,
            link?.source?.industry,
            link?.target?.industry,
            context.getCompanyIndustryGroup?.(link?.source),
            context.getCompanyIndustryGroup?.(link?.target)
        ].map(value => String(value || '')).join(' ');

        const keys = [];
        CORRIDORS.forEach(corridor => {
            const ecosystemMatch = corridor.ecosystemKeys.some(key => ecosystemKeys.includes(key));
            if (ecosystemMatch || corridor.pattern.test(text)) keys.push(corridor.key);
        });
        return unique(keys);
    }

    function getNodesForLinks(nodes, links) {
        const map = new Map();
        (nodes || []).forEach(node => {
            if (node?.id !== undefined && node?.id !== null) map.set(node.id, node);
        });
        (links || []).forEach(link => {
            if (link?.source?.id !== undefined && link?.source?.id !== null) map.set(link.source.id, link.source);
            if (link?.target?.id !== undefined && link?.target?.id !== null) map.set(link.target.id, link.target);
        });
        return [...map.values()];
    }

    function getNodeIdSetFromLinks(links) {
        const ids = new Set();
        links.forEach(link => {
            if (link?.source?.id !== undefined && link?.source?.id !== null) ids.add(link.source.id);
            if (link?.target?.id !== undefined && link?.target?.id !== null) ids.add(link.target.id);
        });
        return ids;
    }

    function getNeighborhoodDepth(context) {
        const depth = Number(context.neighborhoodDepth || 1);
        if (!Number.isFinite(depth)) return 1;
        return Math.max(1, Math.min(3, Math.round(depth)));
    }

    function getHubLimit(edgeCount) {
        if (edgeCount > 240) return 18;
        if (edgeCount > 150) return 15;
        return 12;
    }

    function getLinkKey(link) {
        return link?.key || '';
    }

    function getNodeLabel(node) {
        return node?.ticker || node?.name || 'Selected company';
    }

    function getEcosystemLabel(key, context) {
        return context.stockGraphIntelligence?.getEcosystemDefinition?.(key)?.label ||
            String(key || 'Ecosystem').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function getCorridorLabel(key) {
        return CORRIDOR_BY_KEY.get(key)?.label ||
            String(key || 'Corridor').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function unique(items) {
        return [...new Set((items || []).filter(Boolean))];
    }

    window.StockPhotonicStock.largeGraphNavigation = {
        getModes,
        getCorridorDefinitions,
        buildNavigationModel,
        linkPassesMode,
        nodePassesMode,
        getModeLabel,
        formatNavigationLabel,
        getLinkCorridorKeys
    };
})();
