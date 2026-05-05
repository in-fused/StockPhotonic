(function () {
    const TAU = Math.PI * 2;
    const GOLD = '#fbbf24';
    const CYAN = '#00f9ff';
    const CAMERA_DISTANCE = 3.15;
    const DRAG_THRESHOLD = 4;
    const MIN_ZOOM = 0.68;
    const MAX_ZOOM = 1.82;

    function createOrbMapController(options) {
        const canvas = options.canvas;
        const container = options.container;
        const ctx = canvas?.getContext?.('2d', { alpha: true });
        const supported = Boolean(canvas && ctx);
        const state = {
            enabled: false,
            supported,
            width: 1,
            height: 1,
            dpr: 1,
            zoom: 1,
            rotationX: -0.18,
            rotationY: 0.48,
            nodes: [],
            links: [],
            layoutNodes: [],
            layoutLinks: [],
            screenNodes: [],
            hoveredNode: null,
            selectedNode: null,
            pointer: {
                active: false,
                pointerId: null,
                moved: false,
                startX: 0,
                startY: 0,
                lastX: 0,
                lastY: 0
            }
        };

        if (!supported) {
            return {
                isSupported: () => false,
                isEnabled: () => false,
                setEnabled: () => false,
                setData: () => {},
                setSelectedNode: () => {},
                resize: () => {},
                draw: () => {}
            };
        }

        bindEvents(canvas, state, options);
        resize(state, canvas, options);

        return {
            isSupported: () => state.supported,
            isEnabled: () => state.enabled,
            setEnabled(enabled) {
                state.enabled = Boolean(enabled) && state.supported;
                canvas.classList.toggle('hidden', !state.enabled);
                canvas.setAttribute('aria-hidden', state.enabled ? 'false' : 'true');
                container?.classList.toggle('is-orb-map-active', state.enabled);
                if (state.enabled) {
                    resize(state, canvas, options);
                    setData(state, getDataSnapshot(options), options);
                    draw(state, options);
                }
                return state.enabled;
            },
            setData(data) {
                setData(state, data, options);
                if (state.enabled) draw(state, options);
            },
            setSelectedNode(node) {
                state.selectedNode = node || null;
                if (state.enabled) draw(state, options);
            },
            resize() {
                resize(state, canvas, options);
                if (state.enabled) draw(state, options);
            },
            draw() {
                if (state.enabled) draw(state, options);
            }
        };
    }

    function bindEvents(canvas, state, options) {
        canvas.addEventListener('pointerdown', event => {
            if (!state.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
            state.pointer.active = true;
            state.pointer.pointerId = event.pointerId;
            state.pointer.moved = false;
            state.pointer.startX = event.clientX;
            state.pointer.startY = event.clientY;
            state.pointer.lastX = event.clientX;
            state.pointer.lastY = event.clientY;
            canvas.setPointerCapture?.(event.pointerId);
            canvas.classList.remove('cursor-grab');
            canvas.classList.add('cursor-grabbing');
            event.preventDefault();
        });

        canvas.addEventListener('pointermove', event => {
            if (!state.enabled) return;
            if (state.pointer.active && state.pointer.pointerId === event.pointerId) {
                const dx = event.clientX - state.pointer.lastX;
                const dy = event.clientY - state.pointer.lastY;
                const total = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
                if (total > DRAG_THRESHOLD) state.pointer.moved = true;
                state.rotationY += dx * 0.0065;
                state.rotationX = clamp(state.rotationX + dy * 0.005, -1.12, 1.12);
                state.pointer.lastX = event.clientX;
                state.pointer.lastY = event.clientY;
                draw(state, options);
                event.preventDefault();
                return;
            }

            const point = getCanvasPoint(canvas, event);
            const hovered = findNodeAt(state, point.x, point.y);
            if (hovered !== state.hoveredNode) {
                state.hoveredNode = hovered;
                draw(state, options);
            }
        });

        canvas.addEventListener('pointerup', event => {
            if (!state.pointer.active || state.pointer.pointerId !== event.pointerId) return;
            const point = getCanvasPoint(canvas, event);
            const clickedNode = !state.pointer.moved ? findNodeAt(state, point.x, point.y) : null;
            state.pointer.active = false;
            state.pointer.pointerId = null;
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.classList.add('cursor-grab');
            canvas.classList.remove('cursor-grabbing');
            if (clickedNode && options.onSelectNode) options.onSelectNode(clickedNode.node);
            event.preventDefault();
        });

        canvas.addEventListener('pointercancel', event => {
            state.pointer.active = false;
            state.pointer.pointerId = null;
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.classList.add('cursor-grab');
            canvas.classList.remove('cursor-grabbing');
        });

        canvas.addEventListener('pointerleave', () => {
            if (state.pointer.active || !state.hoveredNode) return;
            state.hoveredNode = null;
            draw(state, options);
        });

        canvas.addEventListener('wheel', event => {
            if (!state.enabled) return;
            const delta = clamp(Number(event.deltaY) || 0, -180, 180);
            state.zoom = clamp(state.zoom * Math.exp(-delta * 0.0017), MIN_ZOOM, MAX_ZOOM);
            draw(state, options);
            event.preventDefault();
        }, { passive: false });

        canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    function setData(state, data, options) {
        state.nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        state.links = Array.isArray(data?.links) ? data.links : [];
        state.selectedNode = data?.selectedNode || state.selectedNode || null;
        const layout = buildOrbLayout(state.nodes, state.links, options);
        state.layoutNodes = layout.nodes;
        state.layoutLinks = layout.links;
    }

    function getDataSnapshot(options) {
        return typeof options.getData === 'function' ? options.getData() : {};
    }

    function resize(state, canvas, options) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, options.devicePixelRatio?.() || window.devicePixelRatio || 1));
        state.width = Math.max(1, rect.width);
        state.height = Math.max(1, rect.height);
        state.dpr = dpr;
        canvas.width = Math.floor(state.width * dpr);
        canvas.height = Math.floor(state.height * dpr);
    }

    function buildOrbLayout(nodes, links, options) {
        const degree = new Map();
        links.forEach(link => {
            if (!link?.source || !link?.target) return;
            degree.set(link.source.id, (degree.get(link.source.id) || 0) + 1);
            degree.set(link.target.id, (degree.get(link.target.id) || 0) + 1);
        });
        const maxDegree = Math.max(1, ...nodes.map(node => degree.get(node.id) || node.degree || 0));
        const sectors = [...new Set(nodes.map(node => node.sector || 'Other'))].sort();
        const sectorIndex = new Map(sectors.map((sector, index) => [sector, index]));
        const sectorBuckets = new Map();
        nodes.forEach(node => {
            const sector = node.sector || 'Other';
            if (!sectorBuckets.has(sector)) sectorBuckets.set(sector, []);
            sectorBuckets.get(sector).push(node);
        });
        sectorBuckets.forEach(bucket => {
            bucket.sort((a, b) => (Number(a.rank) || 9999) - (Number(b.rank) || 9999) || String(a.ticker || '').localeCompare(String(b.ticker || '')));
        });

        const bandCount = Math.min(5, Math.max(3, sectors.length));
        const layoutNodes = nodes.map(node => {
            const sector = node.sector || 'Other';
            const bucket = sectorBuckets.get(sector) || [];
            const localIndex = Math.max(0, bucket.indexOf(node));
            const sIndex = sectorIndex.get(sector) || 0;
            const bandIndex = sIndex % bandCount;
            const bandT = bandCount <= 1 ? 0.5 : bandIndex / (bandCount - 1);
            const latitude = -0.72 + bandT * 1.44 + ((localIndex % 3) - 1) * 0.045;
            const sectorTurn = sectors.length ? sIndex / sectors.length : 0;
            const localSpread = (localIndex - (bucket.length - 1) / 2) * 0.125;
            const seed = hash(`${node.id}:${node.ticker || ''}:${sector}`);
            const longitude = sectorTurn * TAU - Math.PI / 2 + localSpread + ((seed % 100) - 50) * 0.0009;
            const nodeDegree = degree.get(node.id) || node.degree || 0;
            const rank = Number(node.rank) || 9999;
            const rankCentrality = rank <= 50 ? (50 - rank) / 50 : 0;
            const centrality = clamp(nodeDegree / maxDegree * 0.72 + rankCentrality * 0.28, 0, 1);
            const radius = 0.98 - centrality * 0.27 + ((seed % 21) - 10) * 0.0017;
            const cosLat = Math.cos(latitude);
            const point = {
                x: Math.cos(longitude) * cosLat * radius,
                y: Math.sin(latitude) * radius,
                z: Math.sin(longitude) * cosLat * radius
            };

            return {
                node,
                point,
                sector,
                centrality,
                size: clamp(4.5 + Math.sqrt(Math.max(0.05, Number(node.market_cap) || 0.05)) * 1.75 + Math.sqrt(nodeDegree) * 0.9, 5.5, 18)
            };
        });

        const nodeLayoutById = new Map(layoutNodes.map(item => [item.node.id, item]));
        const layoutLinks = links
            .map(link => {
                const source = nodeLayoutById.get(link.source?.id);
                const target = nodeLayoutById.get(link.target?.id);
                if (!source || !target) return null;
                return { link, source, target };
            })
            .filter(Boolean);

        return { nodes: layoutNodes, links: layoutLinks };
    }

    function draw(state, options) {
        const canvas = options.canvas;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        ctx.clearRect(0, 0, state.width, state.height);
        drawOrbBackground(ctx, state);

        const projectedNodes = state.layoutNodes.map(item => ({
            ...item,
            projected: project(item.point, state)
        }));
        const projectedById = new Map(projectedNodes.map(item => [item.node.id, item]));
        state.screenNodes = projectedNodes;

        drawSphereGuide(ctx, state);
        state.layoutLinks
            .map(item => ({
                ...item,
                sourceProjected: projectedById.get(item.source.node.id),
                targetProjected: projectedById.get(item.target.node.id)
            }))
            .filter(item => item.sourceProjected && item.targetProjected)
            .sort((a, b) => averageDepth(a) - averageDepth(b))
            .forEach(item => drawOrbLink(ctx, state, item, options));

        projectedNodes
            .sort((a, b) => a.projected.depth - b.projected.depth)
            .forEach(item => drawOrbNode(ctx, state, item, options));

        drawOrbLabels(ctx, state, projectedNodes, options);
        drawHoverReadout(ctx, state, options);
    }

    function drawOrbBackground(ctx, state) {
        const cx = state.width / 2;
        const cy = state.height / 2;
        const radius = Math.min(state.width, state.height) * 0.48;
        const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * 1.25);
        glow.addColorStop(0, 'rgba(251, 191, 36, 0.18)');
        glow.addColorStop(0.38, 'rgba(0, 249, 255, 0.07)');
        glow.addColorStop(0.72, 'rgba(255, 0, 170, 0.045)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, state.width, state.height);

        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 1;
        const gridStep = Math.max(38, Math.min(state.width, state.height) / 13);
        for (let x = (state.width % gridStep) / 2; x < state.width; x += gridStep) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, state.height);
            ctx.stroke();
        }
        for (let y = (state.height % gridStep) / 2; y < state.height; y += gridStep) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(state.width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawSphereGuide(ctx, state) {
        ctx.save();
        ctx.lineWidth = 1;
        [-0.68, -0.34, 0, 0.34, 0.68].forEach(latitude => {
            drawSphereLine(ctx, state, t => ({
                x: Math.cos(t) * Math.cos(latitude),
                y: Math.sin(latitude),
                z: Math.sin(t) * Math.cos(latitude)
            }), 'rgba(251, 191, 36, 0.22)');
        });
        for (let i = 0; i < 8; i++) {
            const longitude = i / 8 * TAU;
            drawSphereLine(ctx, state, t => ({
                x: Math.cos(longitude) * Math.cos(t),
                y: Math.sin(t),
                z: Math.sin(longitude) * Math.cos(t)
            }), i % 2 ? 'rgba(0, 249, 255, 0.14)' : 'rgba(251, 191, 36, 0.16)');
        }
        ctx.restore();
    }

    function drawSphereLine(ctx, state, pointAt, color) {
        const samples = 96;
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
            const p = project(pointAt((i / samples) * TAU), state);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.shadowBlur = 7;
        ctx.shadowColor = color;
        ctx.stroke();
    }

    function drawOrbLink(ctx, state, item, options) {
        const source = item.source.point;
        const target = item.target.point;
        const strength = clamp(Number(item.link.strength) || 0.4, 0.05, 1);
        const secBacked = Boolean(options.isSecBackedLink?.(item.link));
        const color = secBacked ? GOLD : (options.getLinkColor?.(item.link) || CYAN);
        const alpha = secBacked ? 0.22 + strength * 0.28 : 0.08 + Math.pow(strength, 1.6) * 0.25;
        const width = secBacked ? 0.85 + strength * 1.6 : 0.45 + strength * 1.45;
        const points = getArcPoints(source, target, 18, 0.1 + strength * 0.13);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = secBacked ? 16 : 10;
        ctx.shadowColor = color;
        if (secBacked) ctx.setLineDash([3, 7]);
        ctx.beginPath();
        points.forEach((point, index) => {
            const projected = project(point, state);
            if (index === 0) ctx.moveTo(projected.x, projected.y);
            else ctx.lineTo(projected.x, projected.y);
        });
        ctx.stroke();
        ctx.restore();
    }

    function drawOrbNode(ctx, state, item, options) {
        const p = item.projected;
        const depthAlpha = 0.34 + p.depthT * 0.56;
        const selected = state.selectedNode?.id === item.node.id;
        const hovered = state.hoveredNode?.node?.id === item.node.id;
        const color = options.getNodeColor?.(item.node) || item.node.color || CYAN;
        const radius = item.size * (0.68 + p.scale * 0.22) * (hovered || selected ? 1.2 : 1);

        ctx.save();
        ctx.globalAlpha = selected ? 0.96 : hovered ? 0.9 : depthAlpha;
        const glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, radius * 4.4);
        glow.addColorStop(0, rgba(color, selected ? 0.38 : 0.24));
        glow.addColorStop(0.45, rgba(color, 0.12));
        glow.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 4.4, 0, TAU);
        ctx.fill();

        ctx.shadowBlur = selected ? 26 : hovered ? 21 : 13;
        ctx.shadowColor = color;
        ctx.fillStyle = rgba(color, selected ? 0.92 : 0.64);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, TAU);
        ctx.fill();
        ctx.lineWidth = selected ? 2.1 : 1.15;
        ctx.strokeStyle = selected ? GOLD : rgba('#ffffff', 0.7);
        ctx.stroke();
        ctx.restore();
    }

    function drawOrbLabels(ctx, state, nodes, options) {
        const candidates = nodes
            .filter(item => {
                if (state.selectedNode?.id === item.node.id) return true;
                if (state.hoveredNode?.node?.id === item.node.id) return true;
                return item.centrality >= 0.42 && item.projected.depthT > 0.42;
            })
            .sort((a, b) => b.centrality - a.centrality)
            .slice(0, 30);

        ctx.save();
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        candidates.forEach(item => {
            const label = options.getLabelText?.(item.node) || item.node.ticker || '';
            if (!label) return;
            const p = item.projected;
            const color = options.getNodeColor?.(item.node) || item.node.color || CYAN;
            const selected = state.selectedNode?.id === item.node.id;
            ctx.globalAlpha = selected ? 0.96 : 0.42 + item.projected.depthT * 0.42;
            ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
            const width = ctx.measureText(label).width + 10;
            roundedRect(ctx, p.x - width / 2, p.y + item.size + 8, width, 17, 6);
            ctx.fill();
            ctx.fillStyle = selected ? GOLD : color;
            ctx.fillText(label, p.x, p.y + item.size + 16);
        });
        ctx.restore();
    }

    function drawHoverReadout(ctx, state, options) {
        const item = state.hoveredNode;
        if (!item) return;
        const p = item.projected;
        const label = options.getLabelText?.(item.node) || item.node.ticker || '';
        const sector = item.node.sector || 'Other';
        const text = `${label} / ${sector}`;
        ctx.save();
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        const width = Math.min(ctx.measureText(text).width + 18, state.width - 28);
        const x = clamp(p.x + 16, 14, state.width - width - 14);
        const y = clamp(p.y - 28, 14, state.height - 32);
        ctx.fillStyle = 'rgba(3, 7, 18, 0.86)';
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.36)';
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, width, 24, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(254, 243, 199, 0.92)';
        ctx.fillText(text, x + 9, y + 15);
        ctx.restore();
    }

    function getArcPoints(source, target, samples, lift) {
        const points = [];
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const inverse = 1 - t;
            const mixed = {
                x: source.x * inverse + target.x * t,
                y: source.y * inverse + target.y * t,
                z: source.z * inverse + target.z * t
            };
            const length = Math.max(0.001, Math.hypot(mixed.x, mixed.y, mixed.z));
            const arcLift = Math.sin(t * Math.PI) * lift;
            points.push({
                x: mixed.x / length * (length + arcLift),
                y: mixed.y / length * (length + arcLift),
                z: mixed.z / length * (length + arcLift)
            });
        }
        return points;
    }

    function project(point, state) {
        const rotated = rotate(point, state.rotationX, state.rotationY);
        const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - rotated.z);
        const scale = Math.min(state.width, state.height) * 0.39 * state.zoom;
        const depthT = clamp((rotated.z + 1.16) / 2.32, 0, 1);
        return {
            x: state.width / 2 + rotated.x * scale * perspective,
            y: state.height / 2 + rotated.y * scale * perspective,
            z: rotated.z,
            scale: perspective,
            depth: rotated.z,
            depthT
        };
    }

    function rotate(point, rotationX, rotationY) {
        const cosY = Math.cos(rotationY);
        const sinY = Math.sin(rotationY);
        const x1 = point.x * cosY + point.z * sinY;
        const z1 = -point.x * sinY + point.z * cosY;
        const cosX = Math.cos(rotationX);
        const sinX = Math.sin(rotationX);
        return {
            x: x1,
            y: point.y * cosX - z1 * sinX,
            z: point.y * sinX + z1 * cosX
        };
    }

    function averageDepth(item) {
        return (item.sourceProjected.projected.depth + item.targetProjected.projected.depth) / 2;
    }

    function findNodeAt(state, x, y) {
        let closest = null;
        let closestDistance = Infinity;
        state.screenNodes.forEach(item => {
            const radius = Math.max(14, item.size * item.projected.scale + 8);
            const distance = Math.hypot(item.projected.x - x, item.projected.y - y);
            if (distance <= radius && distance < closestDistance) {
                closest = item;
                closestDistance = distance;
            }
        });
        return closest;
    }

    function getCanvasPoint(canvas, event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function rgba(color, alpha) {
        const hex = String(color || '').replace('#', '');
        if (hex.length !== 6) return `rgba(0, 249, 255, ${alpha})`;
        const value = Number.parseInt(hex, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function hash(value) {
        const text = String(value || '');
        let result = 2166136261;
        for (let i = 0; i < text.length; i++) {
            result ^= text.charCodeAt(i);
            result = Math.imul(result, 16777619);
        }
        return result >>> 0;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    window.StockPhotonicGraph = window.StockPhotonicGraph || {};
    window.StockPhotonicGraph.orb3d = {
        createOrbMapController
    };
})();
