(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const LIMITS = Object.freeze({
        breadcrumbs: 9,
        stack: 12,
        routes: 6,
        corridors: 6,
        hubs: 8,
        checkpoints: 6,
        collections: 4
    });

    function createSessionWorkspace(options = {}) {
        const now = typeof options.now === 'function' ? options.now : () => Date.now();
        const state = {
            breadcrumbs: [],
            stack: [],
            pinnedRoutes: [],
            pinnedCorridors: [],
            pinnedHubs: [],
            replayCheckpoints: [],
            routeCollections: [],
            activeWorkspaceId: 'session'
        };

        function remember(kind, payload = {}, meta = {}) {
            const entry = normalizeEntry(kind, payload, meta, now());
            if (!entry) return null;
            pushUnique(state.stack, entry, LIMITS.stack);
            if (kind !== 'heartbeat') pushUnique(state.breadcrumbs, entry, LIMITS.breadcrumbs);
            return entry;
        }

        function pinRoute(route, meta = {}) {
            const routeLike = normalizeRoute(route, meta);
            if (!routeLike) return null;
            pushUnique(state.pinnedRoutes, routeLike, LIMITS.routes);
            remember('route-pin', routeLike, { label: routeLike.label });
            return routeLike;
        }

        function pinCorridor(corridor, meta = {}) {
            const item = normalizeCorridor(corridor, meta);
            if (!item) return null;
            pushUnique(state.pinnedCorridors, item, LIMITS.corridors);
            remember('corridor-pin', item, { label: item.label });
            return item;
        }

        function pinHub(node, profile = {}, meta = {}) {
            const item = normalizeHub(node, profile, meta);
            if (!item) return null;
            pushUnique(state.pinnedHubs, item, LIMITS.hubs);
            remember('hub-pin', item, { label: item.label });
            return item;
        }

        function addReplayCheckpoint(checkpoint = {}, meta = {}) {
            const item = normalizeCheckpoint(checkpoint, meta, now());
            if (!item) return null;
            pushUnique(state.replayCheckpoints, item, LIMITS.checkpoints);
            remember('replay-checkpoint', item, { label: item.label });
            return item;
        }

        function collectCurrentRoutes(label = 'Route collection') {
            const routes = state.pinnedRoutes.slice(0, LIMITS.routes);
            if (!routes.length) return null;
            const collection = {
                id: `collection:${signature(label)}:${routes.map(route => route.id).join('|')}`,
                kind: 'route-collection',
                label: String(label || 'Route collection'),
                routeCount: routes.length,
                routes,
                createdAt: now()
            };
            pushUnique(state.routeCollections, collection, LIMITS.collections);
            remember('route-collection', collection, { label: collection.label });
            return collection;
        }

        function clear() {
            state.breadcrumbs = [];
            state.stack = [];
            state.pinnedRoutes = [];
            state.pinnedCorridors = [];
            state.pinnedHubs = [];
            state.replayCheckpoints = [];
            state.routeCollections = [];
        }

        function remove(kind, id) {
            const key = String(id || '');
            const list = getList(state, kind);
            if (!list) return false;
            const before = list.length;
            const next = list.filter(item => item.id !== key);
            list.splice(0, list.length, ...next);
            return next.length !== before;
        }

        function getSummary(context = {}) {
            const active = [];
            if (context.activeRouteComparison) active.push('comparison');
            else if (context.activeRelationshipRoute) active.push('route');
            if (context.largeGraphNavigationModel?.focusKind === 'corridor') active.push('corridor');
            if (context.selectedNode) active.push('hub');
            if (context.sourceCoverageLensEnabled) active.push('evidence');

            return {
                activeWorkspaceId: state.activeWorkspaceId,
                active,
                stackDepth: state.stack.length,
                breadcrumbCount: state.breadcrumbs.length,
                pinnedRouteCount: state.pinnedRoutes.length,
                pinnedCorridorCount: state.pinnedCorridors.length,
                pinnedHubCount: state.pinnedHubs.length,
                replayCheckpointCount: state.replayCheckpoints.length,
                routeCollectionCount: state.routeCollections.length,
                latest: state.stack[0] || null,
                breadcrumbs: state.breadcrumbs.slice(0, LIMITS.breadcrumbs),
                pinnedRoutes: state.pinnedRoutes.slice(0, LIMITS.routes),
                pinnedCorridors: state.pinnedCorridors.slice(0, LIMITS.corridors),
                pinnedHubs: state.pinnedHubs.slice(0, LIMITS.hubs),
                replayCheckpoints: state.replayCheckpoints.slice(0, LIMITS.checkpoints),
                routeCollections: state.routeCollections.slice(0, LIMITS.collections),
                reversible: true,
                persistence: 'in-session only'
            };
        }

        return {
            state,
            remember,
            pinRoute,
            pinCorridor,
            pinHub,
            addReplayCheckpoint,
            collectCurrentRoutes,
            remove,
            clear,
            getSummary
        };
    }

    function normalizeEntry(kind, payload = {}, meta = {}, createdAt = Date.now()) {
        const label = meta.label || payload.label || payload.shortLabel || payload.ticker || payload.name || kind;
        if (!label) return null;
        const id = meta.id || payload.id || `${kind}:${signature(label)}:${payload.key || payload.value || ''}`;
        return {
            id: String(id),
            kind: String(kind || 'item'),
            label: String(label),
            value: String(payload.value ?? payload.key ?? payload.id ?? ''),
            createdAt,
            meta: {
                routeId: payload.routeId || payload.id || '',
                nodeId: payload.nodeId || payload.id || '',
                corridorKey: payload.corridorKey || payload.key || '',
                mode: payload.mode || meta.mode || ''
            }
        };
    }

    function normalizeRoute(route, meta = {}) {
        if (!route) return null;
        const summary = meta.summary || route.summary || {};
        const label = route.label || meta.label || 'Pinned route';
        const id = route.id || `${route.mode || 'route'}:${signature(label)}:${route.linkKeys?.size || route.links?.length || 0}`;
        return {
            id: String(id),
            kind: route.routeCount || route.routes ? 'route-comparison' : 'route',
            label: String(label),
            shortLabel: route.shortLabel || label,
            mode: route.mode || meta.mode || '',
            color: route.color || meta.color || '#ffffff',
            nodeCount: route.nodeIds?.size || route.nodes?.length || summary.nodeCount || 0,
            edgeCount: route.linkKeys?.size || route.links?.length || summary.linkCount || 0,
            sharedEdgeCount: route.sharedLinkKeys?.size || meta.sharedEdgeCount || 0,
            sourceBacked: summary.sourceBacked || meta.sourceBacked || route.evidence?.sourceBacked || 0,
            secBacked: summary.secBacked || meta.secBacked || route.evidence?.secBacked || 0,
            ref: route,
            createdAt: Date.now()
        };
    }

    function normalizeCorridor(corridor, meta = {}) {
        if (!corridor) return null;
        const key = corridor.key || corridor.corridorKey || meta.key || '';
        if (!key) return null;
        const label = corridor.label || corridor.shortLabel || meta.label || formatKey(key);
        return {
            id: `corridor:${key}`,
            kind: 'corridor',
            key,
            label,
            edgeCount: Number(corridor.edgeCount || corridor.visibleEdgeCount || corridor.links?.length || meta.edgeCount || 0),
            sourceBacked: Number(corridor.sourceBacked || meta.sourceBacked || 0),
            color: corridor.color || meta.color || '#67e8f9',
            ref: corridor,
            createdAt: Date.now()
        };
    }

    function normalizeHub(node, profile = {}, meta = {}) {
        if (!node) return null;
        const label = node.ticker || node.name || meta.label || 'Pinned hub';
        return {
            id: `hub:${node.id}`,
            kind: 'hub',
            nodeId: node.id,
            label,
            role: profile.primaryRoleLabel || profile.roleLabel || meta.role || 'Strategic hub',
            degree: Number(node.degree || profile.degree || 0),
            corridorCount: Number(profile.corridorCount || 0),
            sourceBackedRatio: Number(profile.sourceBackedRatio || 0),
            ref: node,
            createdAt: Date.now()
        };
    }

    function normalizeCheckpoint(checkpoint = {}, meta = {}, createdAt = Date.now()) {
        const selectedStep = Number(checkpoint.selectedStep || checkpoint.currentStep || meta.selectedStep || 0);
        const label = checkpoint.label || meta.label || (selectedStep ? `Replay step ${selectedStep}` : 'Replay checkpoint');
        return {
            id: checkpoint.id || `replay:${checkpoint.windowId || 'window'}:${selectedStep}`,
            kind: 'replay-checkpoint',
            label,
            selectedStep,
            totalSteps: Number(checkpoint.totalSteps || meta.totalSteps || 0),
            windowLabel: checkpoint.windowLabel || meta.windowLabel || '',
            createdAt
        };
    }

    function getList(state, kind) {
        const map = {
            routes: 'pinnedRoutes',
            route: 'pinnedRoutes',
            corridors: 'pinnedCorridors',
            corridor: 'pinnedCorridors',
            hubs: 'pinnedHubs',
            hub: 'pinnedHubs',
            checkpoints: 'replayCheckpoints',
            checkpoint: 'replayCheckpoints',
            collections: 'routeCollections',
            collection: 'routeCollections'
        };
        return state[map[kind]] || null;
    }

    function pushUnique(list, item, limit) {
        if (!item?.id) return;
        const next = [
            item,
            ...list.filter(existing => existing.id !== item.id)
        ].slice(0, limit);
        list.splice(0, list.length, ...next);
    }

    function signature(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'item';
    }

    function formatKey(key) {
        return String(key || 'Corridor')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicStock.investigationContinuity = {
        createSessionWorkspace
    };
})();
