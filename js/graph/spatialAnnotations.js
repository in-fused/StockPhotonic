(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    function buildStockAnnotationModel(context = {}) {
        const semantic = context.semanticZoom || context.stockSemanticZoomState || {};
        const density = context.graphScalingModel?.density || {};
        const limit = getAnnotationLimit(semantic, density, context);
        const annotations = [];
        const narratives = context.stockNarratives || window.StockPhotonicStock?.narratives || {};

        if (context.activeRouteComparison) {
            const narrative = narratives.buildRouteComparisonNarrative?.(context.activeRouteComparison, context);
            annotations.push(routeComparisonAnnotation(context.activeRouteComparison, narrative));
            const shared = getSharedLinkAnnotation(context.activeRouteComparison, narrative);
            if (shared) annotations.push(shared);
            const convergence = getComparisonNodeAnnotation(context.activeRouteComparison, 'convergence');
            if (convergence) annotations.push(convergence);
        } else if (context.activeRelationshipRoute) {
            const narrative = narratives.buildRouteNarrative?.(context.activeRelationshipRoute, context);
            annotations.push(routeAnnotation(context.activeRelationshipRoute, narrative));
        }

        if (context.selectedNode) {
            const profile = context.stockGraphIntelligence?.getStrategicHubProfile?.(context.selectedNode, context) || {};
            const narrative = narratives.buildHubSignificanceNarrative?.(context.selectedNode, profile, context);
            annotations.push(hubAnnotation(context.selectedNode, narrative, profile));
        }

        const corridor = getActiveCorridor(context);
        if (corridor && annotations.length < limit) {
            const narrative = narratives.buildCorridorNarrative?.(corridor, context);
            annotations.push(corridorAnnotation(corridor, narrative));
        }

        const overlay = context.graphIntelligenceModel?.overlay;
        if (overlay && annotations.length < limit) {
            const narrative = narratives.buildEcosystemNarrative?.(overlay, context);
            annotations.push(overlayAnnotation(overlay, narrative));
        }

        if (!context.selectedNode && !context.activeRelationshipRoute && !context.activeRouteComparison && semantic.tierRank <= 1) {
            const hubs = context.graphScalabilityModel?.strategicHubIndex?.top || [];
            hubs.slice(0, Math.max(0, limit - annotations.length)).forEach(item => {
                const node = item.node || context.nodeById?.get?.(item.nodeId);
                if (!node) return;
                const narrative = narratives.buildHubSignificanceNarrative?.(node, item, context);
                annotations.push(hubAnnotation(node, narrative, item, { subtle: true }));
            });
        }

        const compacted = annotations
            .filter(Boolean)
            .slice(0, limit)
            .map((annotation, index) => ({
                ...annotation,
                priority: Number(annotation.priority || 0) - index * 0.01
            }));

        return {
            annotations: compacted,
            signature: compacted.map(item => `${item.id}:${item.title}:${item.body}`).join('|'),
            semanticTier: semantic.tier || 'relationship',
            densityKey: density.key || 'core',
            generatedAt: Date.now()
        };
    }

    function resolveAnnotationPosition(annotation, context = {}) {
        if (!annotation) return null;
        if (annotation.anchor?.type === 'node') {
            const node = annotation.anchor.node || context.nodeById?.get?.(annotation.anchor.nodeId);
            return projectNode(node, context, annotation.offset);
        }
        if (annotation.anchor?.type === 'link') {
            return projectLink(annotation.anchor.link, context, annotation.offset);
        }
        if (annotation.anchor?.type === 'links') {
            return projectLinks(annotation.anchor.links, context, annotation.offset);
        }
        if (annotation.anchor?.type === 'screen') {
            return {
                x: Number(annotation.anchor.x) || 0,
                y: Number(annotation.anchor.y) || 0
            };
        }
        return null;
    }

    function routeComparisonAnnotation(comparison, narrative) {
        const firstRoute = comparison.routes?.[0] || {};
        const link = firstRoute.links?.[Math.floor((firstRoute.links?.length || 1) / 2)] || comparison.routes?.flatMap(route => route.links || [])[0];
        return {
            id: `comparison:${comparison.id || comparison.label || 'active'}`,
            kind: 'route-comparison',
            title: narrative?.title || comparison.label || 'Compared routes',
            body: narrative?.summary || 'Route comparison active.',
            chips: narrative?.chips || [],
            anchor: link ? { type: 'link', link } : { type: 'screen', x: 80, y: 80 },
            offset: { x: 0, y: -18 },
            tone: 'comparison',
            priority: 100
        };
    }

    function getSharedLinkAnnotation(comparison, narrative) {
        const sharedKey = comparison.sharedLinkKeys?.values?.().next?.().value;
        if (!sharedKey) return null;
        const entry = comparison.linkMembership?.get(sharedKey);
        const link = entry?.link;
        if (!link) return null;
        return {
            id: `shared:${sharedKey}`,
            kind: 'shared-edge',
            title: 'Shared edge',
            body: `${entry.routes?.length || 0} routes share this visible relationship leg.`,
            chips: narrative?.chips?.slice(0, 2) || [],
            anchor: { type: 'link', link },
            offset: { x: 10, y: 10 },
            tone: 'shared',
            priority: 92
        };
    }

    function getComparisonNodeAnnotation(comparison, mode) {
        const ids = mode === 'convergence' ? comparison.convergenceNodeIds : comparison.divergenceNodeIds;
        const nodeId = ids?.values?.().next?.().value;
        if (nodeId === undefined || nodeId === null) return null;
        const note = mode === 'convergence'
            ? comparison.convergenceNotes?.[0] || 'Routes reconverge here.'
            : comparison.divergenceNotes?.[0] || 'Routes diverge here.';
        return {
            id: `${mode}:${nodeId}`,
            kind: mode,
            title: mode === 'convergence' ? 'Convergence' : 'Divergence',
            body: note,
            chips: [],
            anchor: { type: 'node', nodeId },
            offset: { x: 10, y: -28 },
            tone: mode,
            priority: 90
        };
    }

    function routeAnnotation(route, narrative) {
        const link = route.links?.[Math.floor((route.links?.length || 1) / 2)] || route.links?.[0];
        const node = route.nodes?.[Math.floor((route.nodes?.length || 1) / 2)] || route.nodes?.[0];
        return {
            id: `route:${route.id || route.mode || route.label || 'active'}`,
            kind: 'route',
            title: narrative?.title || route.label || 'Relationship route',
            body: narrative?.summary || route.explanation || 'Route active.',
            chips: narrative?.chips || [],
            anchor: link ? { type: 'link', link } : { type: 'node', node },
            offset: { x: 0, y: -18 },
            tone: 'route',
            priority: 96
        };
    }

    function hubAnnotation(node, narrative, profile = {}, options = {}) {
        return {
            id: `hub:${node.id}`,
            kind: 'hub',
            title: narrative?.title || node.ticker || node.name || 'Hub',
            body: narrative?.why || narrative?.summary || profile.primaryReason || 'Strategic graph hub.',
            chips: narrative?.chips || [],
            anchor: { type: 'node', node },
            offset: { x: options.subtle ? 10 : 14, y: options.subtle ? 16 : -30 },
            tone: options.subtle ? 'hub-subtle' : 'hub',
            priority: options.subtle ? 52 : 88
        };
    }

    function corridorAnnotation(corridor, narrative) {
        return {
            id: `corridor:${corridor.key}`,
            kind: 'corridor',
            title: narrative?.title || corridor.label || formatKey(corridor.key),
            body: narrative?.why || narrative?.summary || 'Dominant visible corridor.',
            chips: narrative?.chips || [],
            anchor: { type: 'links', links: corridor.links || [] },
            offset: { x: 0, y: -14 },
            tone: 'corridor',
            priority: 74
        };
    }

    function overlayAnnotation(overlay, narrative) {
        const link = overlay.strongest || overlay.links?.[0] || null;
        const node = overlay.topHubs?.[0]?.node || overlay.nodes?.[0] || null;
        return {
            id: `overlay:${overlay.key || overlay.label}`,
            kind: 'overlay',
            title: narrative?.title || overlay.label || 'Overlay',
            body: narrative?.summary || overlay.reason || 'Overlay active.',
            chips: narrative?.chips || [],
            anchor: link ? { type: 'link', link } : { type: 'node', node },
            offset: { x: 0, y: 18 },
            tone: 'overlay',
            priority: 68
        };
    }

    function getActiveCorridor(context) {
        if (context.largeGraphNavigationModel?.focusKind === 'corridor') {
            const key = context.largeGraphNavigationModel.corridorKey;
            const lane = context.graphScalabilityModel?.corridorLaneIndex?.lanes?.find(item => item.key === key);
            if (lane) return lane;
            return {
                key,
                label: context.largeGraphNavigationModel.focusLabel,
                edgeCount: context.largeGraphNavigationModel.progressiveDisclosure?.visibleEdgeCount || 0,
                links: []
            };
        }
        return context.graphScalabilityModel?.corridorLaneIndex?.topLanes?.[0] || null;
    }

    function projectNode(node, context, offset = {}) {
        if (!node) return null;
        let point = null;
        if (Number.isFinite(node._screenX) && Number.isFinite(node._screenY)) {
            point = { x: node._screenX, y: node._screenY };
        } else {
            const position = context.getNodeLayoutPosition?.(node) || node;
            point = context.worldToScreen?.(position.x || 0, position.y || 0);
        }
        if (!point) return null;
        return {
            x: point.x + (Number(offset.x) || 0),
            y: point.y + (Number(offset.y) || 0)
        };
    }

    function projectLink(link, context, offset = {}) {
        if (!link?.source || !link?.target) return null;
        const source = projectNode(link.source, context);
        const target = projectNode(link.target, context);
        if (!source || !target) return null;
        return {
            x: (source.x + target.x) / 2 + (Number(offset.x) || 0),
            y: (source.y + target.y) / 2 + (Number(offset.y) || 0)
        };
    }

    function projectLinks(links = [], context, offset = {}) {
        let x = 0;
        let y = 0;
        let count = 0;
        links.slice(0, 16).forEach(link => {
            const point = projectLink(link, context);
            if (!point) return;
            x += point.x;
            y += point.y;
            count += 1;
        });
        if (!count) return null;
        return {
            x: x / count + (Number(offset.x) || 0),
            y: y / count + (Number(offset.y) || 0)
        };
    }

    function getAnnotationLimit(semantic = {}, density = {}, context = {}) {
        if (context.isMobile) return density.key === 'mega' ? 2 : 3;
        if (density.key === 'mega') return semantic.tierRank <= 1 ? 3 : 4;
        if (density.key === 'very_dense') return semantic.tierRank <= 1 ? 4 : 5;
        if (semantic.tier === 'inspection') return 6;
        return 5;
    }

    function formatKey(key) {
        return String(key || 'corridor').replace(/[_:|-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicGraph.spatialAnnotations = {
        buildStockAnnotationModel,
        resolveAnnotationPosition
    };
})();
