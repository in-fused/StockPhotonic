(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const CORRIDOR_META = {
        ai_compute_foundry_cloud: {
            label: 'AI Compute',
            color: '#ffd166',
            priority: 8
        },
        enterprise_workflow_security: {
            label: 'Workflow',
            color: '#60a5fa',
            priority: 4
        },
        financial_market_infrastructure: {
            label: 'Finance',
            color: '#c084fc',
            priority: 5
        },
        aerospace_defense_industrial: {
            label: 'Aerospace',
            color: '#facc15',
            priority: 3
        },
        retail_logistics_distribution: {
            label: 'Retail / Logistics',
            color: '#fb923c',
            priority: 2
        },
        healthcare_pharma_benefits: {
            label: 'Healthcare',
            color: '#fb7185',
            priority: 4
        },
        energy_grid_infrastructure: {
            label: 'Energy / Grid',
            color: '#34d399',
            priority: 4
        }
    };

    const stockMotionState = {
        offsets: new Map(),
        lastFrameAt: 0,
        lastSelectedId: null,
        lastSignature: ''
    };

    function getNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
        return Date.now();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    }

    function easeOutCubic(t) {
        const inverse = 1 - clamp(t, 0, 1);
        return 1 - inverse * inverse * inverse;
    }

    function getStockMotionProfile(context = {}, semantic = {}, density = {}) {
        const rank = Number(semantic.tierRank) || 0;
        const denseCut = density.mega ? 0.84 : density.veryDense ? 0.9 : density.dense ? 0.96 : 1;
        const mobile = isCompactCanvas(context);
        const selected = Boolean(context.selectedNode);
        const replay = context.getStockUxMode?.() === 'replay';

        return {
            response: rank <= 0 ? 7.5 : rank === 1 ? 9 : rank === 2 ? 11.5 : 13.5,
            bubbleRadius: clamp(
                (rank <= 0 ? 70 : rank === 1 ? 84 : rank === 2 ? 104 : 124) *
                    (mobile ? 1.12 : 1) *
                    (selected ? 1 : 0.78),
                52,
                mobile ? 148 : 136
            ),
            maxPush: clamp(
                (rank <= 0 ? 22 : rank === 1 ? 30 : rank === 2 ? 42 : 54) *
                    denseCut *
                    (mobile ? 1.14 : 1),
                14,
                mobile ? 62 : 56
            ),
            unfoldPush: clamp(
                (rank <= 1 ? 10 : rank === 2 ? 16 : 22) *
                    denseCut *
                    (replay ? 1.08 : 1),
                6,
                26
            ),
            laneAlpha: rank <= 0 ? 0.1 : rank === 1 ? 0.082 : rank === 2 ? 0.065 : 0.045,
            laneWidth: rank <= 0 ? 15 : rank === 1 ? 12 : rank === 2 ? 9 : 7,
            laneLimit: rank <= 0 ? 4 : rank === 1 ? 4 : rank === 2 ? 3 : 2,
            edgeBundleScale: rank <= 1 ? 1.1 : rank === 2 ? 0.82 : 0.58,
            cameraDuration: rank <= 0 ? 620 : rank === 1 ? 540 : rank === 2 ? 460 : 390
        };
    }

    function prepareStockFrame(context, options = {}) {
        const now = Number(options.now) || getNow();
        const semantic = options.semantic || {};
        const density = options.density || {};
        const profile = getStockMotionProfile(context, semantic, density);
        const active = applyStockFocusRepulsion(context, now, semantic, profile);
        stockMotionState.lastFrameAt = now;
        return {
            active,
            profile,
            semantic,
            density,
            selectedId: context.selectedNode?.id ?? null
        };
    }

    function applyStockFocusRepulsion(context, now, semantic, profile) {
        const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
        const selected = context.selectedNode || null;
        const nodeById = new Map(nodes.map(node => [node.id, node]));
        const dt = stockMotionState.lastFrameAt ? Math.min(0.06, Math.max(0.001, (now - stockMotionState.lastFrameAt) / 1000)) : 1 / 60;
        const response = 1 - Math.exp(-profile.response * dt);
        let active = false;
        const targets = new Map();

        if (selected && Number.isFinite(selected._screenX) && Number.isFinite(selected._screenY)) {
            const selectedPoint = { x: selected._screenX, y: selected._screenY };
            const bubbleRadius = profile.bubbleRadius;
            const routeNodeIds = context.activeRouteComparison?.nodeIds || context.activeRelationshipRoute?.nodeIds || new Set();
            const focusIds = context.focusNeighborIds || new Set();
            const clusterIds = context.activeClusterNodeIds || new Set();
            const affectedRadius = bubbleRadius * (semantic.tierRank >= 3 ? 1.52 : 1.36);
            selected._focusBubbleRadius = bubbleRadius;

            nodes.forEach(node => {
                if (!node || node.id === selected.id) return;
                if (!Number.isFinite(node._screenX) || !Number.isFinite(node._screenY)) return;

                const dx = node._screenX - selectedPoint.x;
                const dy = node._screenY - selectedPoint.y;
                const distance = Math.max(1, Math.hypot(dx, dy));
                const neighbor = focusIds.has(node.id);
                const cluster = clusterIds.has(node.id);
                const route = routeNodeIds.has(node.id);
                if (distance > affectedRadius && !neighbor && !cluster && !route) return;

                const dir = {
                    x: dx / distance,
                    y: dy / distance
                };
                const bubbleWeight = distance < bubbleRadius
                    ? Math.pow(1 - distance / bubbleRadius, 1.55)
                    : 0;
                const unfoldWeight = neighbor || cluster || route
                    ? clamp(1 - distance / (bubbleRadius * 1.9), 0, 1)
                    : 0;
                const labelWeight = neighbor || route ? 1.12 : cluster ? 0.82 : 0.64;
                const push = bubbleWeight * profile.maxPush + unfoldWeight * profile.unfoldPush * labelWeight;
                if (push <= 0.1) return;
                targets.set(node.id, {
                    x: dir.x * push,
                    y: dir.y * push
                });
            });
        }

        if (!selected) {
            nodes.forEach(node => {
                if (node) node._focusBubbleRadius = 0;
            });
        } else if (stockMotionState.lastSelectedId !== selected.id) {
            stockMotionState.lastSelectedId = selected.id;
        }

        const allIds = new Set([...stockMotionState.offsets.keys(), ...targets.keys()]);
        allIds.forEach(id => {
            const target = targets.get(id) || { x: 0, y: 0 };
            const current = stockMotionState.offsets.get(id) || { x: 0, y: 0 };
            current.x += (target.x - current.x) * response;
            current.y += (target.y - current.y) * response;

            const magnitude = Math.hypot(current.x, current.y);
            if (magnitude < 0.28 && !targets.has(id)) {
                stockMotionState.offsets.delete(id);
                return;
            }

            stockMotionState.offsets.set(id, current);
            active = active || Math.hypot(target.x - current.x, target.y - current.y) > 0.36 || (!targets.has(id) && magnitude > 0.36);
            const node = nodeById.get(id);
            if (!node) return;
            node._screenX += current.x;
            node._screenY += current.y;
            node._focusDisplacement = magnitude;
        });

        nodes.forEach(node => {
            if (!node || stockMotionState.offsets.has(node.id)) return;
            node._focusDisplacement = 0;
        });

        return active;
    }

    function drawStockFocusBubble(context, ctx, frame = {}, timestamp = 0) {
        const selected = context.selectedNode;
        if (!selected || !Number.isFinite(selected._screenX) || !Number.isFinite(selected._screenY)) return;
        const radius = selected._focusBubbleRadius || frame.profile?.bubbleRadius || 0;
        if (radius <= 1) return;

        const pulse = 1 + Math.sin((timestamp || getNow()) * 0.0025) * 0.025;
        const color = selected.color || '#67e8f9';
        const x = selected._screenX;
        const y = selected._screenY;

        ctx.save();
        const gradient = ctx.createRadialGradient(x, y, radius * 0.24, x, y, radius * 1.04 * pulse);
        gradient.addColorStop(0, hexToRgba(context, color, 0.035));
        gradient.addColorStop(0.62, hexToRgba(context, color, 0.024));
        gradient.addColorStop(1, hexToRgba(context, color, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.04 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 10]);
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.92 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function drawStockCorridorLanes(context, ctx, links, options = {}) {
        if (!Array.isArray(links) || !links.length) return;
        const semantic = options.semantic || {};
        const density = options.density || {};
        const profile = options.profile || getStockMotionProfile(context, semantic, density);
        if (!shouldDrawStockCorridorLanes(context, semantic, density)) return;

        const buckets = buildCorridorBuckets(context, links);
        if (!buckets.length) return;

        const selectedRouteKeys = context.activeRouteComparison?.linkKeys || context.activeRelationshipRoute?.linkKeys || new Set();
        const focusedKeys = context.focusLinkKeys || new Set();
        const activeCorridorKey = context.largeGraphNavigationModel?.focusKind === 'corridor'
            ? context.largeGraphNavigationModel?.corridorKey
            : '';
        const selectedOnly = Boolean(context.selectedNode || selectedRouteKeys.size);
        const laneLimit = selectedOnly ? Math.min(2, profile.laneLimit) : profile.laneLimit;
        const phase = ((options.timestamp || getNow()) / 1000) % 1000;

        buckets.slice(0, laneLimit).forEach((bucket, laneIndex) => {
            const meta = getCorridorMeta(bucket.key);
            const active = bucket.key === activeCorridorKey || bucket.links.some(link => selectedRouteKeys.has(link.key) || focusedKeys.has(link.key));
            const alpha = clamp(profile.laneAlpha * (active ? 1.56 : 1) * (selectedOnly ? 0.82 : 1), 0.018, 0.14);
            const width = profile.laneWidth + (active ? 4 : 0) - Math.min(2, laneIndex);
            const sample = bucket.links
                .slice()
                .sort((a, b) => getLinkWeight(b) - getLinkWeight(a))
                .slice(0, getLaneEdgeLimit(semantic, density, active));

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = meta.color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowBlur = active ? 18 : 10;
            ctx.shadowColor = meta.color;
            if (active) {
                ctx.setLineDash([18, 24]);
                ctx.lineDashOffset = -phase * 10;
            }
            sample.forEach(link => drawBundledLanePath(context, ctx, link, semantic, laneIndex, active));
            ctx.restore();
        });

        drawCorridorLaneLabels(context, ctx, buckets.slice(0, Math.min(2, laneLimit)), semantic, profile);
    }

    function shouldDrawStockCorridorLanes(context, semantic = {}, density = {}) {
        if (!semantic.showCorridorHints && !context.activeRelationshipRoute && !context.activeRouteComparison && !context.selectedNode) return false;
        const navigation = context.largeGraphNavigationModel;
        if (navigation?.isActive && ['corridor', 'ecosystem', 'hubs', 'route', 'neighborhood'].includes(navigation.focusKind)) return true;
        if (context.activeEcosystemOverlayKey || context.activeGuidedDiscoveryKey || context.activeRelationshipRoute || context.activeRouteComparison) return true;
        if (context.getStockUxMode?.() === 'analyst' || context.getStockUxMode?.() === 'replay') return true;
        if (context.selectedNode) return semantic.tierRank >= 2;
        return semantic.tierRank <= 1 && (density.dense || density.veryDense || density.mega);
    }

    function buildCorridorBuckets(context, links) {
        const buckets = new Map();
        links.forEach(link => {
            const meta = context.getGraphLinkSpatialMeta?.(link) || {};
            const keys = Array.isArray(meta.corridorKeys) ? meta.corridorKeys : [];
            const key = meta.primaryCorridorKey || keys[0] || '';
            if (!key) return;
            const bucket = buckets.get(key) || {
                key,
                links: [],
                score: 0,
                selectedCount: 0
            };
            bucket.links.push(link);
            bucket.score += getLinkWeight(link) + (getCorridorMeta(key).priority || 0);
            if (context.focusLinkKeys?.has(link.key) || context.activeRelationshipRoute?.linkKeys?.has(link.key) || context.activeRouteComparison?.linkKeys?.has(link.key)) {
                bucket.selectedCount += 1;
                bucket.score += 100;
            }
            buckets.set(key, bucket);
        });
        return [...buckets.values()]
            .filter(bucket => bucket.links.length >= 2 || bucket.selectedCount)
            .sort((a, b) => b.selectedCount - a.selectedCount || b.score - a.score || b.links.length - a.links.length);
    }

    function drawBundledLanePath(context, ctx, link, semantic, laneIndex, active) {
        if (!link?.source || !link?.target) return;
        const source = getScreenPoint(context, link.source);
        const target = getScreenPoint(context, link.target);
        if (!source || !target) return;
        const control = getBundledControlPoint(context, link, source, target, semantic, {
            laneIndex,
            active
        });
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
    }

    function getStockEdgeBundle(context, link, options = {}) {
        const semantic = options.semantic || {};
        const spatial = context.getGraphLinkSpatialMeta?.(link) || {};
        const corridorKey = spatial.primaryCorridorKey || spatial.corridorKeys?.[0] || '';
        const corridorIndex = corridorKey ? getCorridorIndex(corridorKey) : 0;
        const relationshipKey = `${link?.source?.id || ''}:${link?.target?.id || ''}:${link?.relationship_type || link?.type || ''}`;
        const parallelLane = (hashString(relationshipKey) % 7) - 3;
        const routeBoost = context.activeRouteComparison?.linkKeys?.has(link?.key) || context.activeRelationshipRoute?.linkKeys?.has(link?.key) ? 1.35 : 1;
        const focusBoost = context.focusLinkKeys?.has(link?.key) ? 1.15 : 1;
        const scale = Math.sqrt(Math.max(0.2, Number(context.scale) || 1));
        const semanticScale = Number.isFinite(semantic.tierRank)
            ? semantic.tierRank <= 1 ? 1.18 : semantic.tierRank === 2 ? 0.82 : 0.56
            : 0.8;
        const offset = (corridorIndex * 5.5 + parallelLane * 2.2) * scale * semanticScale * routeBoost * focusBoost;
        return {
            offset: clamp(offset, -30, 30),
            corridorKey
        };
    }

    function getBundledControlPoint(context, link, source, target, semantic, options = {}) {
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const baseCurve = (Number(link.curveOffset) || 0) * (Number(context.scale) || 1);
        const bundle = getStockEdgeBundle(context, link, { semantic });
        const lane = ((options.laneIndex || 0) - 1.5) * 5.5;
        const activeBoost = options.active ? 5 : 0;
        const curve = baseCurve + bundle.offset + lane + activeBoost;
        return {
            x: midX + (-dy / distance) * curve,
            y: midY + (dx / distance) * curve
        };
    }

    function drawCorridorLaneLabels(context, ctx, buckets, semantic = {}, profile = {}) {
        if (!buckets.length || semantic.tierRank > 1 && !context.largeGraphNavigationModel?.isActive && !context.activeRelationshipRoute && !context.activeRouteComparison) return;
        const used = [];
        buckets.forEach((bucket, index) => {
            const centroid = getBucketCentroid(context, bucket.links);
            if (!centroid) return;
            const meta = getCorridorMeta(bucket.key);
            const label = `${meta.label} ${bucket.links.length}`;
            ctx.save();
            ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
            const width = Math.min(150, Math.max(54, ctx.measureText(label).width + 18));
            const height = 22;
            const box = clampLabelBox(context, {
                x: centroid.x - width / 2,
                y: centroid.y - height / 2 - index * 10,
                width,
                height
            });
            if (used.some(item => boxesOverlap(item, box))) {
                ctx.restore();
                return;
            }
            used.push(box);
            ctx.globalAlpha = clamp((profile.laneAlpha || 0.08) * 5.5, 0.32, 0.68);
            ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
            ctx.strokeStyle = hexToRgba(context, meta.color, 0.38);
            ctx.lineWidth = 1;
            roundedRect(ctx, box.x, box.y, box.width, box.height, 8);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = hexToRgba(context, meta.color, 0.88);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, box.x + box.width / 2, box.y + box.height / 2, box.width - 10);
            ctx.restore();
        });
    }

    function getBucketCentroid(context, links) {
        let x = 0;
        let y = 0;
        let count = 0;
        links.slice(0, 28).forEach(link => {
            const source = getScreenPoint(context, link.source);
            const target = getScreenPoint(context, link.target);
            if (!source || !target) return;
            x += (source.x + target.x) / 2;
            y += (source.y + target.y) / 2;
            count += 1;
        });
        if (!count) return null;
        return { x: x / count, y: y / count };
    }

    function getScreenPoint(context, node) {
        if (!node) return null;
        if (Number.isFinite(node._screenX) && Number.isFinite(node._screenY)) {
            return { x: node._screenX, y: node._screenY };
        }
        const position = context.getNodeLayoutPosition?.(node) || node;
        const point = context.worldToScreen?.(position.x || 0, position.y || 0);
        return point ? { x: point.x, y: point.y } : null;
    }

    function getLaneEdgeLimit(semantic = {}, density = {}, active = false) {
        if (active) return density.mega ? 84 : 120;
        if (semantic.tierRank <= 0) return density.mega ? 60 : 86;
        if (semantic.tierRank === 1) return density.mega ? 72 : 100;
        return density.mega ? 44 : 68;
    }

    function getLinkWeight(link = {}) {
        const strength = clamp(Number(link.strength) || 0.2, 0, 1);
        const sourceDegree = Number(link.source?.degree) || 0;
        const targetDegree = Number(link.target?.degree) || 0;
        return strength * 10 + Math.min(8, (sourceDegree + targetDegree) / 8);
    }

    function getCorridorMeta(key) {
        return CORRIDOR_META[key] || {
            label: formatKeyLabel(key || 'Corridor'),
            color: '#67e8f9',
            priority: 1
        };
    }

    function getCorridorIndex(key) {
        const keys = Object.keys(CORRIDOR_META);
        const index = keys.indexOf(key);
        if (index >= 0) return index - Math.floor(keys.length / 2);
        return (hashString(key) % 7) - 3;
    }

    function getCinematicViewDuration(kind, context = {}, options = {}) {
        const semantic = context.semanticZoomState || context.semanticZoom || {};
        const density = context.graphScalingModel?.density || {};
        const profile = getStockMotionProfile(context, semantic, density);
        const distance = Number(options.distance) || 0;
        const distanceBoost = clamp(distance / 1400, 0, 0.42);
        const base = kind === 'minimap' ? 430 : kind === 'fullscreen' ? 560 : profile.cameraDuration;
        return Math.round(base * (1 + distanceBoost));
    }

    function isMotionSettled() {
        return stockMotionState.offsets.size === 0;
    }

    function isCompactCanvas(context = {}) {
        const width = Number(context.canvasWidth) || 0;
        return width > 0 && width < 680;
    }

    function hexToRgba(context, color, alpha) {
        if (typeof context.hexToRgba === 'function' && /^#/.test(color || '')) {
            return context.hexToRgba(color, alpha);
        }
        if (/^rgba?\(/.test(color || '')) return color;
        return `rgba(103, 232, 249, ${alpha})`;
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const safeWidth = Math.max(0, Number(width) || 0);
        const safeHeight = Math.max(0, Number(height) || 0);
        const r = Math.max(0, Math.min(Number(radius) || 0, safeWidth / 2, safeHeight / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, r);
        ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, r);
        ctx.arcTo(x, y + safeHeight, x, y, r);
        ctx.arcTo(x, y, x + safeWidth, y, r);
        ctx.closePath();
    }

    function clampLabelBox(context, box) {
        const margin = 10;
        return {
            ...box,
            x: clamp(box.x, margin, Math.max(margin, (Number(context.canvasWidth) || 1) - box.width - margin)),
            y: clamp(box.y, margin, Math.max(margin, (Number(context.canvasHeight) || 1) - box.height - margin))
        };
    }

    function boxesOverlap(a, b) {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
    }

    function hashString(value) {
        const text = String(value || '');
        let hash = 0;
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
        }
        return Math.abs(hash);
    }

    function formatKeyLabel(key) {
        return String(key || 'Corridor')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase())
            .slice(0, 34);
    }

    window.StockPhotonicGraph.cinematic = {
        prepareStockFrame,
        drawStockFocusBubble,
        drawStockCorridorLanes,
        getStockEdgeBundle,
        getStockMotionProfile,
        getCinematicViewDuration,
        getCorridorMeta,
        easeOutCubic,
        isMotionSettled
    };
})();
