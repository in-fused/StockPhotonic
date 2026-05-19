(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const ROUTE_COLORS = ['#22d3ee', '#f0abfc', '#fbbf24', '#34d399'];
    const SHARED_COLOR = '#ffffff';
    const MAX_ROUTE_COUNT = 4;

    function buildRouteComparison(routes = [], context = {}, options = {}) {
        const normalizedRoutes = routes
            .filter(Boolean)
            .slice(0, MAX_ROUTE_COUNT)
            .map((route, index) => normalizeRoute(route, index, context))
            .filter(route => route);
        if (normalizedRoutes.length < 2) return null;

        const linkMembership = new Map();
        const nodeMembership = new Map();
        normalizedRoutes.forEach(route => {
            route.links.forEach(link => {
                const key = getLinkKey(link);
                if (!key) return;
                const entry = linkMembership.get(key) || { link, routes: [] };
                entry.routes.push(route);
                linkMembership.set(key, entry);
            });
            route.nodes.forEach(node => {
                if (!node?.id && node?.id !== 0) return;
                const entry = nodeMembership.get(node.id) || { node, routes: [] };
                entry.routes.push(route);
                nodeMembership.set(node.id, entry);
            });
        });

        const sharedLinkKeys = new Set();
        const linkKeys = new Set();
        const sharedNodeIds = new Set();
        const nodeIds = new Set();
        linkMembership.forEach((entry, key) => {
            linkKeys.add(key);
            if (entry.routes.length > 1) sharedLinkKeys.add(key);
        });
        nodeMembership.forEach((entry, id) => {
            nodeIds.add(id);
            if (entry.routes.length > 1) sharedNodeIds.add(id);
        });

        const topology = deriveRouteTopology(normalizedRoutes, sharedNodeIds);
        const evidence = summarizeComparisonEvidence(normalizedRoutes, context);
        const label = options.label || normalizedRoutes.map(route => route.shortLabel || route.label).join(' vs ');

        return {
            id: options.id || `comparison-${Date.now()}`,
            label,
            routes: normalizedRoutes,
            routeCount: normalizedRoutes.length,
            linkKeys,
            nodeIds,
            linkMembership,
            nodeMembership,
            sharedLinkKeys,
            sharedNodeIds,
            divergenceNodeIds: topology.divergenceNodeIds,
            convergenceNodeIds: topology.convergenceNodeIds,
            divergenceNotes: topology.divergenceNotes,
            convergenceNotes: topology.convergenceNotes,
            evidence,
            createdAt: Date.now()
        };
    }

    function syncComparisonAfterVisibilityChange(comparison, visibleLinkKeys, context = {}) {
        if (!comparison?.routes?.length || !visibleLinkKeys) return comparison || null;
        const routes = comparison.routes.map(route => {
            const links = (route.links || []).filter(link => visibleLinkKeys.has(getLinkKey(link)));
            const nodes = getNodesFromLinks(links, route.nodes?.[0]).filter(Boolean);
            return {
                ...route,
                links,
                nodes,
                linkKeys: new Set(links.map(getLinkKey).filter(Boolean)),
                nodeIds: new Set(nodes.map(node => node.id))
            };
        });
        const visibleRoutes = routes.filter(route => route.links.length || route.nodes.length > 1);
        if (visibleRoutes.length < 2) return comparison;
        return buildRouteComparison(visibleRoutes, context, {
            id: comparison.id,
            label: comparison.label
        }) || comparison;
    }

    function getLinkComparisonVisual(link, comparison) {
        if (!link || !comparison?.linkMembership) return null;
        const entry = comparison.linkMembership.get(getLinkKey(link));
        if (!entry) return null;
        const routeIndexes = entry.routes.map(route => route.index);
        const colors = entry.routes.map(route => route.color);
        const labels = entry.routes.map(route => route.shortLabel || route.label);
        const shared = entry.routes.length > 1;
        return {
            active: true,
            shared,
            routeIndexes,
            routeIds: entry.routes.map(route => route.id),
            routeLabels: labels,
            colors,
            color: shared ? SHARED_COLOR : colors[0] || ROUTE_COLORS[0],
            sharedColor: SHARED_COLOR,
            divergence: comparison.divergenceNodeIds?.has(link.source?.id) || comparison.divergenceNodeIds?.has(link.target?.id),
            convergence: comparison.convergenceNodeIds?.has(link.source?.id) || comparison.convergenceNodeIds?.has(link.target?.id),
            dashPattern: shared ? null : entry.routes[0]?.dashPattern || null,
            label: shared ? `Shared by ${labels.join(' + ')}` : labels[0] || 'Compared route'
        };
    }

    function getNodeComparisonVisual(node, comparison) {
        if (!node || !comparison?.nodeMembership) return null;
        const entry = comparison.nodeMembership.get(node.id);
        if (!entry) return null;
        const shared = entry.routes.length > 1;
        return {
            active: true,
            shared,
            routeIndexes: entry.routes.map(route => route.index),
            routeLabels: entry.routes.map(route => route.shortLabel || route.label),
            color: shared ? SHARED_COLOR : entry.routes[0]?.color || ROUTE_COLORS[0],
            badgeLabel: comparison.divergenceNodeIds?.has(node.id)
                ? 'DIV'
                : comparison.convergenceNodeIds?.has(node.id)
                    ? 'CONV'
                    : shared ? 'SHR' : `R${(entry.routes[0]?.index || 0) + 1}`
        };
    }

    function getTraversalNodes(comparison, activeRoute = null) {
        if (comparison?.routes?.length) {
            const ordered = [];
            const seen = new Set();
            comparison.routes.forEach(route => {
                route.nodes.forEach(node => {
                    if (!node || seen.has(node.id)) return;
                    seen.add(node.id);
                    ordered.push(node);
                });
            });
            return ordered;
        }
        return (activeRoute?.nodes || []).filter(Boolean);
    }

    function getComparisonSummary(comparison) {
        if (!comparison) return null;
        const routeA = comparison.routes?.[0] || null;
        const routeB = comparison.routes?.[1] || null;
        return {
            label: comparison.label || 'Route comparison',
            routeA,
            routeB,
            routes: comparison.routes || [],
            routeCount: comparison.routeCount || comparison.routes?.length || 0,
            sharedEdgeCount: comparison.sharedLinkKeys?.size || 0,
            sharedNodeCount: comparison.sharedNodeIds?.size || 0,
            divergenceNotes: comparison.divergenceNotes || [],
            convergenceNotes: comparison.convergenceNotes || [],
            evidence: comparison.evidence || {}
        };
    }

    function normalizeRoute(route, index, context = {}) {
        const links = Array.isArray(route.links) ? route.links.filter(Boolean) : [];
        const nodes = Array.isArray(route.nodes) && route.nodes.length
            ? uniqueNodes(route.nodes)
            : getNodesFromLinks(links).filter(Boolean);
        const color = route.color || ROUTE_COLORS[index % ROUTE_COLORS.length];
        const mode = route.mode || `route_${index + 1}`;
        const shortLabel = getShortRouteLabel(route, index);
        return {
            ...route,
            id: route.id || `${mode}-${index}`,
            index,
            slot: String.fromCharCode(65 + index),
            mode,
            label: route.label || `Route ${index + 1}`,
            shortLabel,
            color,
            dashPattern: getRouteDashPattern(route),
            nodes,
            links,
            nodeIds: new Set(nodes.map(node => node.id)),
            linkKeys: new Set(links.map(getLinkKey).filter(Boolean)),
            summary: summarizeRoute(route, links, nodes, context)
        };
    }

    function summarizeRoute(route, links, nodes, context = {}) {
        const sourceBacked = links.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = links.filter(link => context.isSecBackedConnection?.(link)).length;
        const avgStrength = links.length
            ? links.reduce((sum, link) => sum + clamp01(Number(link.strength) || 0), 0) / links.length
            : 0;
        const evidenceTiers = countBy(links, link => context.getRelationshipEvidenceTier?.(link)?.label || 'Evidence pending');
        const confidenceTiers = countBy(links, link => context.getRelationshipConfidenceTier?.(link)?.label || 'Confidence pending');
        const strongestNodes = nodes
            .map(node => ({
                node,
                score: getNodeScore(node, context)
            }))
            .sort((a, b) => b.score - a.score || String(a.node?.ticker || a.node?.name || '').localeCompare(String(b.node?.ticker || b.node?.name || '')))
            .slice(0, 4)
            .map(item => item.node);

        return {
            label: route.label || 'Route',
            linkCount: links.length,
            nodeCount: nodes.length,
            sourceBacked,
            secBacked,
            avgStrength,
            evidenceTiers,
            confidenceTiers,
            strongestNodes
        };
    }

    function summarizeComparisonEvidence(routes, context = {}) {
        const allLinks = uniqueLinks(routes.flatMap(route => route.links || []));
        const sourceBacked = allLinks.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = allLinks.filter(link => context.isSecBackedConnection?.(link)).length;
        return {
            totalEdges: allLinks.length,
            sourceBacked,
            secBacked,
            sourceBackedRatio: allLinks.length ? sourceBacked / allLinks.length : 0,
            evidenceTiers: countBy(allLinks, link => context.getRelationshipEvidenceTier?.(link)?.label || 'Evidence pending'),
            confidenceTiers: countBy(allLinks, link => context.getRelationshipConfidenceTier?.(link)?.label || 'Confidence pending')
        };
    }

    function deriveRouteTopology(routes, sharedNodeIds) {
        const divergenceNodeIds = new Set();
        const convergenceNodeIds = new Set();
        const divergenceNotes = [];
        const convergenceNotes = [];
        if (routes.length < 2) {
            return { divergenceNodeIds, convergenceNodeIds, divergenceNotes, convergenceNotes };
        }

        const primary = routes[0].nodes || [];
        routes.slice(1).forEach(route => {
            const secondary = route.nodes || [];
            const minLength = Math.min(primary.length, secondary.length);
            let firstDiff = -1;
            for (let index = 0; index < minLength; index += 1) {
                if (primary[index]?.id !== secondary[index]?.id) {
                    firstDiff = index;
                    break;
                }
            }
            if (firstDiff < 0 && primary.length !== secondary.length) firstDiff = minLength;

            if (firstDiff > 0) {
                const pivot = primary[firstDiff - 1] || secondary[firstDiff - 1];
                if (pivot) {
                    divergenceNodeIds.add(pivot.id);
                    divergenceNotes.push(`${getNodeLabel(pivot)} is where ${routes[0].shortLabel} and ${route.shortLabel} begin to separate.`);
                }
            } else if (primary[0] && secondary[0] && primary[0].id !== secondary[0].id) {
                divergenceNodeIds.add(primary[0].id);
                divergenceNodeIds.add(secondary[0].id);
                divergenceNotes.push(`${routes[0].shortLabel} and ${route.shortLabel} start from different visible companies.`);
            }

            const laterShared = secondary.find((node, index) => index > Math.max(firstDiff, 0) && sharedNodeIds.has(node.id));
            if (laterShared) {
                convergenceNodeIds.add(laterShared.id);
                convergenceNotes.push(`${getNodeLabel(laterShared)} is the first visible reconvergence point for ${route.shortLabel}.`);
            }
        });

        if (!divergenceNotes.length && sharedNodeIds.size) {
            divergenceNotes.push('Routes overlap early; divergence is minimal under the current visible edge set.');
        }
        if (!convergenceNotes.length && sharedNodeIds.size) {
            convergenceNotes.push('Shared edges mark overlap; no later reconvergence node is distinct in this view.');
        }

        return {
            divergenceNodeIds,
            convergenceNodeIds,
            divergenceNotes: divergenceNotes.slice(0, 3),
            convergenceNotes: convergenceNotes.slice(0, 3)
        };
    }

    function getRouteDashPattern(route) {
        const mode = String(route?.mode || '').toLowerCase();
        if (mode === 'sec' || mode.includes('source')) return [8, 7];
        if (mode === 'ecosystem') return [14, 8];
        return null;
    }

    function getShortRouteLabel(route, index) {
        const label = route.shortLabel || route.label || `Route ${index + 1}`;
        return String(label)
            .replace(/\bRoute\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || `Route ${index + 1}`;
    }

    function getNodeScore(node, context = {}) {
        const profile = context.stockGraphIntelligence?.getStrategicHubProfile?.(node, context) || {};
        return Number(profile.score || 0) + Number(node?.degree || 0) * 0.8;
    }

    function getNodesFromLinks(links = [], seed = null) {
        const nodes = [];
        if (seed) nodes.push(seed);
        links.forEach(link => {
            if (link?.source) nodes.push(link.source);
            if (link?.target) nodes.push(link.target);
        });
        return uniqueNodes(nodes);
    }

    function uniqueNodes(nodes = []) {
        return [...new Map(nodes.filter(Boolean).map(node => [node.id, node])).values()];
    }

    function uniqueLinks(links = []) {
        return [...new Map(links.filter(Boolean).map(link => [getLinkKey(link), link])).values()];
    }

    function countBy(items, getKey) {
        const counts = new Map();
        items.forEach(item => {
            const key = String(getKey(item) || '').trim() || 'Unknown';
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    }

    function getNodeLabel(node) {
        return node?.ticker || node?.name || 'Company';
    }

    function getLinkKey(link) {
        return link?.key || '';
    }

    function clamp01(value) {
        return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    }

    window.StockPhotonicStock.routeComparison = {
        ROUTE_COLORS,
        SHARED_COLOR,
        buildRouteComparison,
        syncComparisonAfterVisibilityChange,
        getLinkComparisonVisual,
        getNodeComparisonVisual,
        getTraversalNodes,
        getComparisonSummary
    };
})();
