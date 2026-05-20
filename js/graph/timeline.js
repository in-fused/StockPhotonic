(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const MAX_EVENTS = 16;

    function buildStockTimeline(context = {}) {
        const events = [];
        const workspace = context.investigationWorkspaceSummary || {};
        const semantic = context.stockSemanticZoomState || context.semanticZoom || {};

        if (context.selectedNode) {
            events.push({
                id: `focus:${context.selectedNode.id}`,
                kind: 'node',
                label: context.selectedNode.ticker || context.selectedNode.name || 'Focus',
                detail: 'Active focus',
                nodeId: context.selectedNode.id,
                active: true,
                priority: 130
            });
        }

        if (context.activeRouteComparison?.routes?.length) {
            const routeEvents = buildRouteComparisonEvents(context.activeRouteComparison, context.routeComparisonSequenceIndex);
            events.push(...routeEvents);
        } else if (context.activeRelationshipRoute?.nodes?.length) {
            const routeEvents = buildRouteEvents(context.activeRelationshipRoute, context.routeComparisonSequenceIndex);
            events.push(...routeEvents);
        }

        if (context.largeGraphNavigationModel?.isActive) {
            events.push({
                id: `navigation:${context.largeGraphNavigationModel.mode}:${context.largeGraphNavigationModel.focusLabel}`,
                kind: context.largeGraphNavigationModel.focusKind || 'navigation',
                label: context.largeGraphNavigationModel.modeShortLabel || context.largeGraphNavigationModel.modeLabel || 'Navigate',
                detail: context.largeGraphNavigationModel.focusLabel || 'Graph navigation',
                value: context.largeGraphNavigationModel.corridorKey || context.largeGraphNavigationModel.ecosystemKey || context.largeGraphNavigationModel.mode,
                active: true,
                priority: 95
            });
        }

        if (context.graphIntelligenceModel?.analystOverlay?.active) {
            const layer = context.graphIntelligenceModel.analystOverlay;
            events.push({
                id: `layer:${layer.key}`,
                kind: 'layer',
                label: layer.shortLabel || layer.label || 'Layer',
                detail: `${layer.edgeCount || layer.linkKeys?.size || 0} edges`,
                value: layer.key,
                active: true,
                priority: 82
            });
        }

        if (context.graphIntelligenceModel?.overlay) {
            const overlay = context.graphIntelligenceModel.overlay;
            events.push({
                id: `ecosystem:${overlay.key}`,
                kind: 'ecosystem',
                label: overlay.shortLabel || overlay.label || 'Ecosystem',
                detail: `${overlay.links?.length || 0} edges`,
                value: overlay.key,
                active: true,
                priority: 78
            });
        }

        const queued = Array.isArray(workspace.investigationQueue) ? workspace.investigationQueue : [];
        queued.slice(0, 4).forEach((item, index) => {
            events.push({
                id: `queue:${item.id}`,
                kind: 'queue',
                label: item.shortLabel || item.label || `Queued ${index + 1}`,
                detail: item.kind || 'Queued investigation',
                queueIndex: index,
                priority: 48 - index
            });
        });

        const activeStack = Array.isArray(workspace.activeInvestigationStack) ? workspace.activeInvestigationStack : [];
        activeStack.slice(0, 4).forEach((item, index) => {
            events.push({
                id: `stack:${item.id || index}`,
                kind: item.kind || 'stack',
                label: item.shortLabel || item.label || `Focus ${index + 1}`,
                detail: 'Investigation stack',
                stackIndex: index,
                value: item.value,
                priority: 52 - index
            });
        });

        const routeLineage = Array.isArray(workspace.activeRouteLineage) ? workspace.activeRouteLineage : [];
        routeLineage.slice(0, 3).forEach((item, index) => {
            events.push({
                id: `route-lineage:${item.id || index}`,
                kind: item.kind || 'route-lineage',
                label: item.shortLabel || item.label || `Route ${index + 1}`,
                detail: `${item.edgeCount || 0} edges`,
                routeLineageIndex: index,
                priority: 50 - index
            });
        });

        const corridorLineage = Array.isArray(workspace.activeCorridorLineage) ? workspace.activeCorridorLineage : [];
        corridorLineage.slice(0, 3).forEach((item, index) => {
            events.push({
                id: `corridor-lineage:${item.id || item.key || index}`,
                kind: 'corridor',
                label: item.shortLabel || item.label || `Corridor ${index + 1}`,
                detail: `${item.edgeCount || 0} edges`,
                value: item.key,
                corridorLineageIndex: index,
                priority: 49 - index
            });
        });

        const replayContinuity = Array.isArray(workspace.replayChronologyContinuity) ? workspace.replayChronologyContinuity : [];
        replayContinuity.slice(0, 3).forEach((item, index) => {
            events.push({
                id: `replay-continuity:${item.id || index}`,
                kind: 'replay-continuity',
                label: item.shortLabel || item.label || `Replay ${index + 1}`,
                detail: item.totalSteps ? `Step ${item.selectedStep || 0}/${item.totalSteps}` : 'Replay continuity',
                replayContinuityIndex: index,
                priority: 47 - index
            });
        });

        const snapshots = Array.isArray(workspace.snapshots) ? workspace.snapshots : [];
        snapshots.slice(0, 4).forEach((snapshot, index) => {
            events.push({
                id: `snapshot:${snapshot.id}`,
                kind: 'snapshot',
                label: snapshot.shortLabel || snapshot.label || `Snapshot ${index + 1}`,
                detail: snapshot.summary || 'Workspace snapshot',
                snapshotIndex: index,
                priority: 42 - index
            });
        });

        const history = Array.isArray(workspace.jumpHistory) ? workspace.jumpHistory : Array.isArray(workspace.breadcrumbs) ? workspace.breadcrumbs : [];
        history.slice(0, 6).forEach((entry, index) => {
            events.push({
                id: `history:${entry.id || index}`,
                kind: entry.kind || 'history',
                label: entry.shortLabel || entry.label || 'Revisit',
                detail: 'Jump history',
                historyIndex: index,
                value: entry.value,
                priority: 30 - index
            });
        });

        const uniqueEvents = compactUnique(events)
            .sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || String(a.label).localeCompare(String(b.label)))
            .slice(0, MAX_EVENTS)
            .map((event, index) => ({
                ...event,
                index
            }));

        return {
            version: 'd165_graph_timeline_v1',
            events: uniqueEvents,
            activeEventCount: uniqueEvents.filter(event => event.active).length,
            routeEventCount: uniqueEvents.filter(event => event.kind === 'route-step' || event.kind === 'comparison-step').length,
            snapshotCount: snapshots.length,
            queueCount: queued.length,
            semanticTier: semantic.tier || 'relationship',
            signature: uniqueEvents.map(event => `${event.id}:${event.active ? 1 : 0}`).join('|'),
            sessionOnly: true
        };
    }

    function buildReplayTimeline(context = {}) {
        const events = Array.isArray(context.events) ? context.events : [];
        const bookmarks = Array.isArray(context.bookmarks) ? context.bookmarks : [];
        const currentStep = Math.max(0, Number(context.currentStep) || 0);
        const totalSteps = Math.max(0, Number(context.totalSteps || events.length) || 0);
        const markers = [];

        if (totalSteps) {
            markers.push({
                id: 'replay:start',
                kind: 'boundary',
                label: 'Start',
                step: 0,
                positionPct: 0,
                active: currentStep === 0
            });
            markers.push({
                id: `replay:current:${currentStep}`,
                kind: 'current',
                label: `Step ${currentStep}`,
                step: currentStep,
                positionPct: totalSteps ? (currentStep / totalSteps) * 100 : 0,
                active: true
            });
            markers.push({
                id: 'replay:end',
                kind: 'boundary',
                label: 'End',
                step: totalSteps,
                positionPct: 100,
                active: currentStep === totalSteps
            });
        }

        bookmarks.slice(0, 8).forEach(bookmark => {
            const step = Math.max(0, Math.min(totalSteps, Number(bookmark.step || bookmark.selectedStep || 0) || 0));
            markers.push({
                id: `bookmark:${bookmark.id || step}`,
                kind: bookmark.kind || 'bookmark',
                label: bookmark.label || `Step ${step}`,
                step,
                positionPct: totalSteps ? (step / totalSteps) * 100 : 0,
                active: step === currentStep
            });
        });

        return {
            version: 'd165_replay_timeline_v1',
            markers: compactUnique(markers).sort((a, b) => a.step - b.step),
            currentStep,
            totalSteps,
            signature: `${currentStep}/${totalSteps}|${bookmarks.map(item => item.id || item.step).join(',')}`,
            sessionOnly: true
        };
    }

    function buildRouteComparisonEvents(comparison, activeIndex = -1) {
        const nodes = [];
        const seen = new Set();
        (comparison.routes || []).forEach(route => {
            (route.nodes || []).forEach(node => {
                if (!node || seen.has(node.id)) return;
                seen.add(node.id);
                nodes.push(node);
            });
        });
        return nodes.slice(0, 10).map((node, index) => ({
            id: `comparison-step:${comparison.id}:${node.id}`,
            kind: 'comparison-step',
            label: node.ticker || node.name || `Step ${index + 1}`,
            detail: comparison.label || 'Route comparison',
            nodeId: node.id,
            routeIndex: index,
            active: index === activeIndex,
            priority: 72 - index
        }));
    }

    function buildRouteEvents(route, activeIndex = -1) {
        return (route.nodes || []).slice(0, 10).map((node, index) => ({
            id: `route-step:${route.id || route.mode || route.label}:${node.id}`,
            kind: 'route-step',
            label: node.ticker || node.name || `Step ${index + 1}`,
            detail: route.shortLabel || route.label || 'Route',
            nodeId: node.id,
            routeIndex: index,
            active: index === activeIndex,
            priority: 70 - index
        }));
    }

    function compactUnique(events) {
        const seen = new Set();
        return events.filter(event => {
            const key = event.id || `${event.kind}:${event.label}:${event.value || event.nodeId || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    window.StockPhotonicGraph.timeline = {
        buildStockTimeline,
        buildReplayTimeline
    };
})();
