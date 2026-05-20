(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const LIMITS = Object.freeze({
        breadcrumbs: 9,
        stack: 12,
        routes: 6,
        corridors: 6,
        hubs: 8,
        checkpoints: 6,
        collections: 4,
        queue: 8,
        tasks: 10,
        history: 12,
        snapshots: 6,
        timeline: 18,
        focus: 14,
        lineage: 10,
        quickJump: 6
    });

    function createSessionWorkspace(options = {}) {
        const now = typeof options.now === 'function' ? options.now : () => Date.now();
        const workspaces = new Map();
        let state = createWorkspaceState('session', 'Session', now());
        workspaces.set(state.id, state);

        function remember(kind, payload = {}, meta = {}) {
            const entry = normalizeEntry(kind, payload, meta, now());
            if (!entry) return null;
            state.updatedAt = entry.createdAt || now();
            pushUnique(state.stack, entry, LIMITS.stack);
            pushUnique(state.activeInvestigationStack, entry, LIMITS.stack);
            pushUnique(state.jumpHistory, entry, LIMITS.history);
            if (isFocusKind(kind)) pushUnique(state.focusHistory, entry, LIMITS.focus);
            pushTimeline(entry);
            if (kind !== 'heartbeat') pushUnique(state.breadcrumbs, entry, LIMITS.breadcrumbs);
            return entry;
        }

        function pinRoute(route, meta = {}) {
            const routeLike = normalizeRoute(route, meta);
            if (!routeLike) return null;
            pushUnique(state.pinnedRoutes, routeLike, LIMITS.routes);
            pushUnique(state.routeWorkspaceStack, routeLike, LIMITS.stack);
            pushUnique(state.activeRouteLineage, routeLike, LIMITS.lineage);
            remember('route-pin', routeLike, { label: routeLike.label });
            return routeLike;
        }

        function pinCorridor(corridor, meta = {}) {
            const item = normalizeCorridor(corridor, meta);
            if (!item) return null;
            pushUnique(state.pinnedCorridors, item, LIMITS.corridors);
            pushUnique(state.activeCorridorLineage, item, LIMITS.lineage);
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
            pushUnique(state.replayWorkspaceStack, item, LIMITS.stack);
            pushUnique(state.replayChronologyContinuity, item, LIMITS.lineage);
            remember('replay-checkpoint', item, { label: item.label });
            return item;
        }

        function recordFocus(kind, payload = {}, meta = {}) {
            const item = remember(kind || payload.kind || 'focus', payload, meta);
            if (item) pushUnique(state.focusHistory, item, LIMITS.focus);
            return item;
        }

        function recordRouteLineage(route, meta = {}) {
            const routeLike = normalizeRoute(route, meta);
            if (!routeLike) return null;
            pushUnique(state.activeRouteLineage, routeLike, LIMITS.lineage);
            pushUnique(state.routeWorkspaceStack, routeLike, LIMITS.stack);
            pushTimeline({
                ...routeLike,
                kind: routeLike.kind === 'route-comparison' ? 'route-lineage' : 'route',
                meta: {
                    routeId: routeLike.id,
                    mode: routeLike.mode || ''
                }
            });
            return routeLike;
        }

        function recordCorridorLineage(corridor, meta = {}) {
            const item = normalizeCorridor(corridor, meta);
            if (!item) return null;
            pushUnique(state.activeCorridorLineage, item, LIMITS.lineage);
            pushTimeline({
                ...item,
                kind: 'corridor-lineage',
                meta: {
                    corridorKey: item.key
                }
            });
            return item;
        }

        function recordReplayContinuity(checkpoint = {}, meta = {}) {
            const item = normalizeCheckpoint(checkpoint, meta, now());
            if (!item) return null;
            pushUnique(state.replayChronologyContinuity, item, LIMITS.lineage);
            pushUnique(state.replayWorkspaceStack, item, LIMITS.stack);
            pushTimeline({
                ...item,
                kind: 'replay-continuity',
                meta: {
                    selectedStep: item.selectedStep,
                    totalSteps: item.totalSteps
                }
            });
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

        function queueInvestigation(target = {}, meta = {}) {
            const item = normalizeWorkflowItem('queued-investigation', target, meta, now());
            if (!item) return null;
            pushUnique(state.investigationQueue, item, LIMITS.queue);
            pushUnique(state.stagingArea, item, LIMITS.queue);
            pushTask({
                id: `task:${item.id}`,
                kind: item.kind,
                label: `Investigate ${item.shortLabel || item.label}`,
                shortLabel: item.shortLabel || item.label,
                payload: item.payload || target.payload || target
            });
            remember('queue', item, { label: item.label });
            return item;
        }

        function activateQueueItem(id) {
            const key = String(id || '');
            const item = state.investigationQueue.find(entry => entry.id === key) || null;
            if (!item) return null;
            state.investigationQueue = [
                item,
                ...state.investigationQueue.filter(entry => entry.id !== key)
            ].slice(0, LIMITS.queue);
            remember('queue-activate', item, { label: item.label });
            return item;
        }

        function pushTask(task = {}, meta = {}) {
            const item = normalizeWorkflowItem(task.kind || 'task', task, meta, now());
            if (!item) return null;
            pushUnique(state.taskStack, item, LIMITS.tasks);
            pushTimeline(item);
            return item;
        }

        function captureSnapshot(snapshot = {}, meta = {}) {
            const item = normalizeSnapshot(snapshot, meta, now());
            if (!item) return null;
            pushUnique(state.snapshots, item, LIMITS.snapshots);
            pushUnique(state.stagingArea, item, LIMITS.queue);
            remember('snapshot', item, { label: item.label });
            return item;
        }

        function clear() {
            state.breadcrumbs = [];
            state.stack = [];
            state.pinnedRoutes = [];
            state.pinnedCorridors = [];
            state.pinnedHubs = [];
            state.replayCheckpoints = [];
            state.routeCollections = [];
            state.investigationQueue = [];
            state.taskStack = [];
            state.jumpHistory = [];
            state.snapshots = [];
            state.chronology = [];
            state.routeWorkspaceStack = [];
            state.replayWorkspaceStack = [];
            state.stagingArea = [];
            state.activeInvestigationStack = [];
            state.focusHistory = [];
            state.activeRouteLineage = [];
            state.activeCorridorLineage = [];
            state.replayChronologyContinuity = [];
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

        function pushTimeline(item) {
            if (!item?.id) return;
            const entry = {
                id: `timeline:${item.id}`,
                kind: item.kind || 'event',
                label: item.label || item.shortLabel || item.kind || 'Event',
                shortLabel: item.shortLabel || item.label || 'Event',
                value: item.value || '',
                createdAt: item.createdAt || now(),
                meta: item.meta || {}
            };
            pushUnique(state.chronology, entry, LIMITS.timeline);
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
                workspaceId: state.id,
                workspaceLabel: state.label,
                workspacePriority: state.priority,
                workspaceCreatedAt: state.createdAt,
                workspaceUpdatedAt: state.updatedAt,
                workspaces: getWorkspaceSummaries(),
                active,
                stackDepth: state.stack.length,
                breadcrumbCount: state.breadcrumbs.length,
                pinnedRouteCount: state.pinnedRoutes.length,
                pinnedCorridorCount: state.pinnedCorridors.length,
                pinnedHubCount: state.pinnedHubs.length,
                replayCheckpointCount: state.replayCheckpoints.length,
                routeCollectionCount: state.routeCollections.length,
                investigationQueueCount: state.investigationQueue.length,
                taskStackCount: state.taskStack.length,
                snapshotCount: state.snapshots.length,
                latest: state.stack[0] || null,
                breadcrumbs: state.breadcrumbs.slice(0, LIMITS.breadcrumbs),
                jumpHistory: state.jumpHistory.slice(0, LIMITS.history),
                chronology: state.chronology.slice(0, LIMITS.timeline),
                routeWorkspaceStack: state.routeWorkspaceStack.slice(0, LIMITS.stack),
                replayWorkspaceStack: state.replayWorkspaceStack.slice(0, LIMITS.stack),
                stagingArea: state.stagingArea.slice(0, LIMITS.queue),
                activeInvestigationStack: state.activeInvestigationStack.slice(0, LIMITS.stack),
                focusHistory: state.focusHistory.slice(0, LIMITS.focus),
                activeRouteLineage: state.activeRouteLineage.slice(0, LIMITS.lineage),
                activeCorridorLineage: state.activeCorridorLineage.slice(0, LIMITS.lineage),
                replayChronologyContinuity: state.replayChronologyContinuity.slice(0, LIMITS.lineage),
                quickJumpBackActions: buildQuickJumpBackActions(state),
                pinnedRoutes: state.pinnedRoutes.slice(0, LIMITS.routes),
                pinnedCorridors: state.pinnedCorridors.slice(0, LIMITS.corridors),
                pinnedHubs: state.pinnedHubs.slice(0, LIMITS.hubs),
                replayCheckpoints: state.replayCheckpoints.slice(0, LIMITS.checkpoints),
                routeCollections: state.routeCollections.slice(0, LIMITS.collections),
                investigationQueue: state.investigationQueue.slice(0, LIMITS.queue),
                taskStack: state.taskStack.slice(0, LIMITS.tasks),
                snapshots: state.snapshots.slice(0, LIMITS.snapshots),
                reversible: true,
                persistence: 'in-session only'
            };
        }

        function createWorkspace(label = 'Workspace', seed = {}, meta = {}) {
            const id = meta.id || `workspace:${signature(label)}:${now()}`;
            const workspace = createWorkspaceState(id, label, now(), {
                priority: Number(meta.priority) || 0
            });
            workspaces.set(workspace.id, workspace);
            state = workspace;
            state.activeWorkspaceId = workspace.id;
            if (seed && Object.keys(seed).length) {
                captureSnapshot(seed, { label: seed.label || label });
            }
            remember('workspace-create', { id: workspace.id, label: workspace.label }, { label: workspace.label });
            return getWorkspaceSummary(workspace);
        }

        function switchWorkspace(id) {
            const key = String(id || '');
            const next = workspaces.get(key);
            if (!next) return null;
            state = next;
            state.activeWorkspaceId = state.id;
            state.updatedAt = now();
            remember('workspace-switch', { id: state.id, label: state.label }, { label: state.label });
            return getWorkspaceSummary(state);
        }

        function cycleWorkspace(direction = 1) {
            const list = getWorkspaceSummaries();
            if (!list.length) return null;
            const currentIndex = Math.max(0, list.findIndex(item => item.id === state.id));
            const delta = direction < 0 ? -1 : 1;
            const nextIndex = (currentIndex + delta + list.length) % list.length;
            return switchWorkspace(list[nextIndex].id);
        }

        function prioritizeWorkspace(id = state.id, priority = 1) {
            const workspace = workspaces.get(String(id || ''));
            if (!workspace) return null;
            workspace.priority = Number(priority) || 0;
            workspace.updatedAt = now();
            return getWorkspaceSummary(workspace);
        }

        function getActiveWorkspaceSnapshot() {
            return {
                id: state.id,
                label: state.label,
                priority: state.priority,
                latestSnapshot: state.snapshots[0] || null,
                latestStackItem: state.stack[0] || null,
                routeStackDepth: state.routeWorkspaceStack.length,
                replayStackDepth: state.replayWorkspaceStack.length,
                stagingDepth: state.stagingArea.length
            };
        }

        function getWorkspaceSummaries() {
            return [...workspaces.values()]
                .map(getWorkspaceSummary)
                .sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
        }

        function getWorkspaceSummary(workspace) {
            return {
                id: workspace.id,
                label: workspace.label,
                shortLabel: workspace.shortLabel,
                active: workspace.id === state.id,
                priority: Number(workspace.priority) || 0,
                stackDepth: workspace.stack.length,
                routeStackDepth: workspace.routeWorkspaceStack.length,
                replayStackDepth: workspace.replayWorkspaceStack.length,
                stagingDepth: workspace.stagingArea.length,
                snapshotCount: workspace.snapshots.length,
                updatedAt: workspace.updatedAt || workspace.createdAt,
                latestLabel: workspace.stack[0]?.shortLabel || workspace.snapshots[0]?.shortLabel || ''
            };
        }

        return {
            get state() { return state; },
            remember,
            pinRoute,
            pinCorridor,
            pinHub,
            addReplayCheckpoint,
            recordFocus,
            recordRouteLineage,
            recordCorridorLineage,
            recordReplayContinuity,
            collectCurrentRoutes,
            queueInvestigation,
            activateQueueItem,
            pushTask,
            captureSnapshot,
            createWorkspace,
            switchWorkspace,
            cycleWorkspace,
            prioritizeWorkspace,
            getActiveWorkspaceSnapshot,
            getWorkspaceSummaries,
            remove,
            clear,
            getSummary
        };
    }

    function createWorkspaceState(id, label, createdAt = Date.now(), options = {}) {
        return {
            id: String(id || 'session'),
            label: String(label || 'Session'),
            shortLabel: String(label || 'Session').slice(0, 18),
            priority: Number(options.priority) || 0,
            breadcrumbs: [],
            stack: [],
            pinnedRoutes: [],
            pinnedCorridors: [],
            pinnedHubs: [],
            replayCheckpoints: [],
            routeCollections: [],
            investigationQueue: [],
            taskStack: [],
            jumpHistory: [],
            snapshots: [],
            chronology: [],
            routeWorkspaceStack: [],
            replayWorkspaceStack: [],
            stagingArea: [],
            activeInvestigationStack: [],
            focusHistory: [],
            activeRouteLineage: [],
            activeCorridorLineage: [],
            replayChronologyContinuity: [],
            activeWorkspaceId: String(id || 'session'),
            createdAt,
            updatedAt: createdAt
        };
    }

    function normalizeWorkflowItem(kind, payload = {}, meta = {}, createdAt = Date.now()) {
        const source = payload.payload || payload;
        const label = meta.label || payload.label || payload.shortLabel || source.label || source.shortLabel || kind;
        if (!label) return null;
        const id = payload.id || meta.id || `${kind}:${signature(label)}:${source.selectedNodeId ?? source.nodeId ?? source.value ?? ''}`;
        return {
            id: String(id),
            kind: String(payload.kind || kind || 'task'),
            label: String(label),
            shortLabel: String(payload.shortLabel || source.shortLabel || label).slice(0, 28),
            value: String(payload.value ?? source.value ?? source.selectedNodeId ?? source.nodeId ?? ''),
            payload: source,
            createdAt,
            meta: {
                nodeId: source.selectedNodeId ?? source.nodeId ?? payload.nodeId ?? '',
                routeId: source.routeComparisonId || payload.routeId || '',
                corridorKey: source.largeGraphCorridorFocus || payload.corridorKey || '',
                layerKey: source.activeAnalystOverlayKey || payload.layerKey || ''
            }
        };
    }

    function normalizeSnapshot(snapshot = {}, meta = {}, createdAt = Date.now()) {
        const label = meta.label || snapshot.label || snapshot.shortLabel || 'Graph snapshot';
        const id = snapshot.id || `snapshot:${signature(label)}:${createdAt}`;
        return {
            id: String(id),
            kind: 'snapshot',
            label: String(label),
            shortLabel: String(snapshot.shortLabel || label).slice(0, 28),
            summary: snapshot.summary || '',
            payload: snapshot,
            createdAt,
            meta: {
                nodeId: snapshot.selectedNodeId ?? '',
                corridorKey: snapshot.largeGraphCorridorFocus || '',
                layerKey: snapshot.activeAnalystOverlayKey || ''
            }
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
            payload: payload.payload || payload,
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
            interpretation: route.interpretation || meta.interpretation || null,
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
            reason: checkpoint.reason || meta.reason || '',
            createdAt
        };
    }

    function buildQuickJumpBackActions(state) {
        const merged = [
            ...state.focusHistory,
            ...state.jumpHistory,
            ...state.snapshots
        ];
        const seen = new Set();
        return merged.filter(item => {
            const key = item.id || `${item.kind}:${item.value || item.label}`;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, LIMITS.quickJump);
    }

    function isFocusKind(kind) {
        return [
            'node',
            'candidate-node',
            'sec-node',
            'relationship',
            'route',
            'route-comparison',
            'corridor',
            'ecosystem',
            'layer',
            'mode',
            'snapshot-restore',
            'restore'
        ].includes(String(kind || ''));
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
