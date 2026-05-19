(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    function buildRouteNarrative(route, context = {}) {
        if (!route) return null;
        const links = route.links || [];
        const nodes = route.nodes || [];
        const evidence = summarizeEvidence(links, context);
        const strongest = links.slice().sort((a, b) => strength(b) - strength(a))[0] || null;
        const tickers = nodes.map(getNodeLabel).filter(Boolean).slice(0, 5);
        const label = route.label || 'Relationship route';
        const compactPath = tickers.length ? tickers.join(' -> ') : 'No visible path';

        return {
            kind: 'route',
            title: label,
            summary: route.explanation || `${label} follows ${links.length} visible edge${links.length === 1 ? '' : 's'} across ${nodes.length} compan${nodes.length === 1 ? 'y' : 'ies'}.`,
            why: strongest
                ? `Strongest visible leg: ${getNodeLabel(strongest.source)} to ${getNodeLabel(strongest.target)} at ${Math.round(strength(strongest) * 100)}% edge strength.`
                : 'No route leg is visible under the current filters.',
            path: compactPath,
            evidence,
            chips: [
                `${links.length} edges`,
                `${nodes.length} nodes`,
                `${evidence.sourceBacked} sourced`,
                `${evidence.secBacked} SEC`
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildRouteComparisonNarrative(comparison, context = {}) {
        if (!comparison) return null;
        const routes = comparison.routes || [];
        const evidence = comparison.evidence || summarizeEvidence(routes.flatMap(route => route.links || []), context);
        const sharedEdges = comparison.sharedLinkKeys?.size || 0;
        const sharedNodes = comparison.sharedNodeIds?.size || 0;
        const divergence = comparison.divergenceNotes?.[0] || 'Visible route divergence is limited under the current filters.';
        const convergence = comparison.convergenceNotes?.[0] || 'No later convergence point is distinct in the current view.';

        return {
            kind: 'route-comparison',
            title: comparison.label || 'Route comparison',
            summary: `${routes.length} deterministic route views are compared with ${sharedEdges} shared edge${sharedEdges === 1 ? '' : 's'} and ${sharedNodes} shared node${sharedNodes === 1 ? '' : 's'}.`,
            why: `${divergence} ${convergence}`,
            evidence,
            chips: [
                `${routes.length} routes`,
                `${sharedEdges} shared`,
                `${evidence.sourceBacked || 0} sourced`,
                `${evidence.secBacked || 0} SEC`
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildCorridorNarrative(corridor, context = {}) {
        if (!corridor) return null;
        const key = corridor.key || corridor.corridorKey || '';
        const meta = context.graphCinematic?.getCorridorMeta?.(key) || {};
        const label = corridor.label || meta.label || formatKey(key);
        const edgeCount = Number(corridor.edgeCount || corridor.visibleEdgeCount || corridor.links?.length || 0);
        const sourceBacked = Number(corridor.sourceBacked || corridor.links?.filter(link => context.relationshipHasSourceEvidence?.(link)).length || 0);

        return {
            kind: 'corridor',
            title: label,
            summary: `${label} groups ${edgeCount} visible relationship edge${edgeCount === 1 ? '' : 's'} into a spatial reading lane.`,
            why: sourceBacked
                ? `${sourceBacked} visible edge${sourceBacked === 1 ? '' : 's'} carry source evidence, so the lane can be investigated from graph context into evidence detail.`
                : 'The lane is a topology cue from loaded relationship metadata; inspect edges before treating it as evidence-backed.',
            evidence: { total: edgeCount, sourceBacked, secBacked: Number(corridor.secBacked || 0) },
            chips: [
                `${edgeCount} edges`,
                `${sourceBacked} sourced`,
                corridor.focusKind || 'corridor'
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildEcosystemNarrative(overlay, context = {}) {
        if (!overlay) return null;
        const evidence = overlay.evidence || summarizeEvidence(overlay.links || [], context);
        const topHub = overlay.topHubs?.[0]?.node || overlay.nodes?.[0] || null;
        const type = overlay.relationshipTypes?.[0]?.[0] || 'mixed relationship metadata';

        return {
            kind: 'ecosystem',
            title: overlay.label || 'Ecosystem overlay',
            summary: `${overlay.shortLabel || overlay.label || 'Overlay'} highlights ${(overlay.links || []).length} visible edge${(overlay.links || []).length === 1 ? '' : 's'} whose loaded metadata fits ${type}.`,
            why: topHub
                ? `${getNodeLabel(topHub)} is the strongest visible hub in this overlay by current graph scoring.`
                : overlay.reason || 'No visible hub dominates this overlay under current filters.',
            evidence,
            chips: [
                `${(overlay.nodes || []).length} nodes`,
                `${(overlay.links || []).length} edges`,
                `${evidence.sourceBacked} sourced`
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildHubSignificanceNarrative(node, profile = {}, context = {}) {
        if (!node) return null;
        const label = getNodeLabel(node);
        const role = profile.primaryRoleLabel || context.role?.label || 'Market hub';
        const sourceRatio = Number(profile.sourceBackedRatio || 0);
        const corridorCount = Number(profile.corridorCount || 0);
        const sectorCount = Number(profile.sectorCount || 0);
        const reason = profile.primaryReason || (profile.isStrategic
            ? `${label} is prominent across high-value market corridors in the loaded graph.`
            : `${label} has ${node.degree || 0} loaded relationship edge${(node.degree || 0) === 1 ? '' : 's'}.`);

        return {
            kind: 'hub',
            title: label,
            summary: `${label} is being treated as ${article(role)} ${role.toLowerCase()} within the current visible topology.`,
            why: reason,
            evidence: {
                total: Number(node.degree || 0),
                sourceBackedRatio: sourceRatio,
                corridorCount,
                sectorCount
            },
            chips: [
                `${node.degree || 0} edges`,
                `${corridorCount} corridors`,
                `${Math.round(sourceRatio * 100)}% sourced`
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildEvidenceSynthesis(links = [], context = {}) {
        const evidence = summarizeEvidence(links, context);
        const confidenceCounts = countBy(links, link => context.getRelationshipConfidenceTier?.(link)?.label || 'Confidence pending');
        const tierCounts = countBy(links, link => context.getRelationshipEvidenceTier?.(link)?.label || 'Evidence pending');
        const dominantConfidence = confidenceCounts[0]?.[0] || 'Confidence pending';
        const dominantTier = tierCounts[0]?.[0] || 'Evidence pending';
        return {
            kind: 'evidence',
            title: 'Evidence synthesis',
            summary: `${evidence.total} visible edge${evidence.total === 1 ? '' : 's'}; ${evidence.sourceBacked} include source evidence and ${evidence.secBacked} are SEC-backed.`,
            why: `Dominant confidence: ${dominantConfidence}. Dominant evidence tier: ${dominantTier}.`,
            evidence,
            confidenceCounts,
            tierCounts,
            chips: [
                `${evidence.sourceBacked}/${evidence.total} sourced`,
                `${evidence.secBacked} SEC`,
                dominantTier
            ],
            sourceAware: true,
            deterministic: true
        };
    }

    function buildReplayStorylineSummary(context = {}) {
        const comparison = context.activeRouteComparison;
        const route = context.activeRelationshipRoute;
        if (comparison) return buildRouteComparisonNarrative(comparison, context);
        if (route) return buildRouteNarrative(route, context);
        const navigation = context.largeGraphNavigationModel || {};
        return {
            kind: 'replay',
            title: navigation.focusLabel || 'Spatial traversal',
            summary: navigation.isActive
                ? `${navigation.modeLabel || 'Navigation'} preserves the current graph context while narrowing the visible topology.`
                : 'Traversal checkpoints are available once a route, comparison, hub, or corridor is active.',
            why: 'This is session memory only; it does not write graph data or promise persistence.',
            evidence: { total: context.visibleLinks?.length || 0, sourceBacked: 0, secBacked: 0 },
            chips: ['session only', navigation.modeShortLabel || 'overview'],
            sourceAware: false,
            deterministic: true
        };
    }

    function summarizeEvidence(links = [], context = {}) {
        const total = links.length;
        const sourceBacked = links.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = links.filter(link => context.isSecBackedConnection?.(link)).length;
        const pending = links.filter(link => !context.relationshipHasSourceEvidence?.(link)).length;
        return {
            total,
            sourceBacked,
            secBacked,
            pending,
            sourceBackedRatio: total ? sourceBacked / total : 0
        };
    }

    function countBy(items, getKey) {
        const counts = new Map();
        items.forEach(item => {
            const key = String(getKey(item) || '').trim() || 'Other';
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function strength(link) {
        return Math.max(0, Math.min(1, Number(link?.strength) || 0));
    }

    function getNodeLabel(node) {
        return node?.ticker || node?.name || '';
    }

    function formatKey(key) {
        return String(key || 'corridor').replace(/[_:|-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function article(value) {
        return /^[aeiou]/i.test(String(value || '')) ? 'an' : 'a';
    }

    window.StockPhotonicStock.narratives = {
        buildRouteNarrative,
        buildRouteComparisonNarrative,
        buildCorridorNarrative,
        buildEcosystemNarrative,
        buildHubSignificanceNarrative,
        buildEvidenceSynthesis,
        buildReplayStorylineSummary,
        summarizeEvidence
    };
})();
