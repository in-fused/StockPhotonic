(function () {
    const TAU = Math.PI * 2;
    const GOLD = '#fbbf24';
    const GOLD_SOFT = '#fde68a';
    const CYAN = '#00f9ff';
    const CAMERA_DISTANCE = 3.15;
    const DRAG_THRESHOLD = 4;
    const MIN_ZOOM = 0.68;
    const MAX_ZOOM = 1.82;
    const ROTATION_Y_SENSITIVITY = 0.0065;
    const ROTATION_X_SENSITIVITY = 0.005;
    const ROTATION_DAMPING = 22;
    const ROTATION_INERTIA_DECAY = 0.9;
    const MIN_ROTATION_VELOCITY = 0.000012;
    const ZOOM_SENSITIVITY = 0.0017;
    const ZOOM_DAMPING = 18;
    const AUTO_DRIFT_DELAY = 1400;
    const AUTO_DRIFT_SPEED = 0.012;
    const GOLDEN_RATIO_FRACTION = 0.61803398875;
    const ORB_LAYOUT_DENSITY_MODES = ['balanced', 'wide', 'vertical'];
    const ORB_LAYOUT_DENSITY_PROFILES = {
        balanced: {
            label: 'Balanced',
            latitudes: [-0.88, 0.62, -0.34, 0.94, -0.64, 0.28, -1.04, 0.76, -0.12, 1.08],
            localLatitudeSpread: 0.34,
            localLatitudeWave: 0.08,
            localLongitudeSpread: 0.74,
            sectorLatitudeJitter: 0.11,
            sectorLongitudeJitter: 0.036,
            radiusSpread: 0.048
        },
        wide: {
            label: 'Wide',
            latitudes: [-0.74, 0.78, -0.18, 1.02, -0.98, 0.38, -0.48, 0.14, -1.1, 0.94],
            localLatitudeSpread: 0.38,
            localLatitudeWave: 0.1,
            localLongitudeSpread: 1.06,
            sectorLatitudeJitter: 0.13,
            sectorLongitudeJitter: 0.05,
            radiusSpread: 0.062
        },
        vertical: {
            label: 'Vertical',
            latitudes: [-1.1, 1.08, -0.78, 0.82, -0.48, 0.52, -0.18, 1.18, -1.2, 0.16],
            localLatitudeSpread: 0.54,
            localLatitudeWave: 0.13,
            localLongitudeSpread: 0.58,
            sectorLatitudeJitter: 0.1,
            sectorLongitudeJitter: 0.032,
            radiusSpread: 0.052
        }
    };

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
            targetZoom: 1,
            rotationX: -0.18,
            rotationY: 0.48,
            rotationTargetX: -0.18,
            rotationTargetY: 0.48,
            rotationVelocityX: 0,
            rotationVelocityY: 0,
            animationFrame: null,
            idleDriftTimer: null,
            lastFrameAt: 0,
            lastInteractionAt: 0,
            nodes: [],
            links: [],
            layoutNodes: [],
            layoutLinks: [],
            screenNodes: [],
            hoveredNode: null,
            selectedNode: null,
            focusContext: null,
            layoutDensity: 'balanced',
            sectorAdjustments: new Map(),
            tuningSector: null,
            touchPointers: new Map(),
            pinch: null,
            pointer: {
                active: false,
                pointerId: null,
                mode: 'rotate',
                moved: false,
                startX: 0,
                startY: 0,
                lastX: 0,
                lastY: 0,
                lastMoveAt: 0,
                tuningSector: null
            }
        };

        if (!supported) {
            return {
                isSupported: () => false,
                isEnabled: () => false,
                setEnabled: () => false,
                setData: () => {},
                setSelectedNode: () => {},
                setLayoutDensity: () => 'balanced',
                cycleLayoutDensity: () => 'balanced',
                getLayoutDensity: () => 'balanced',
                resetLayout: () => 'balanced',
                resize: () => {},
                draw: () => {}
            };
        }

        bindEvents(canvas, state, options);
        resize(state, canvas, options);
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                if (!state.enabled) return;
                resize(state, canvas, options);
                draw(state, options);
            })
            : null;
        resizeObserver?.observe(container || canvas);

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
                    state.lastInteractionAt = performance.now();
                    draw(state, options);
                    queueIdleDrift(state, options);
                } else {
                    stopAnimation(state);
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
            setLayoutDensity(mode) {
                state.layoutDensity = normalizeLayoutDensityMode(mode);
                setData(state, getDataSnapshot(options), options);
                if (state.enabled) draw(state, options);
                return state.layoutDensity;
            },
            cycleLayoutDensity() {
                const index = ORB_LAYOUT_DENSITY_MODES.indexOf(state.layoutDensity);
                const nextMode = ORB_LAYOUT_DENSITY_MODES[(Math.max(0, index) + 1) % ORB_LAYOUT_DENSITY_MODES.length];
                return this.setLayoutDensity(nextMode);
            },
            getLayoutDensity() {
                return state.layoutDensity;
            },
            resetLayout() {
                state.layoutDensity = 'balanced';
                state.sectorAdjustments.clear();
                state.tuningSector = null;
                state.pointer.tuningSector = null;
                setData(state, getDataSnapshot(options), options);
                if (state.enabled) draw(state, options);
                return state.layoutDensity;
            },
            resize() {
                resize(state, canvas, options);
                if (state.enabled) draw(state, options);
            },
            draw() {
                if (state.enabled) draw(state, options);
                if (state.enabled) scheduleAnimation(state, options);
            }
        };
    }

    function bindEvents(canvas, state, options) {
        canvas.addEventListener('pointerdown', event => {
            if (!state.enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const point = getCanvasPoint(canvas, event);
            if (event.pointerType === 'touch') {
                state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                canvas.setPointerCapture?.(event.pointerId);
                if (state.touchPointers.size >= 2) {
                    beginPinch(state);
                    markInteraction(state, event.timeStamp);
                    scheduleAnimation(state, options);
                    event.preventDefault();
                    return;
                }
            }
            const tuningTarget = event.shiftKey ? findNodeAt(state, point.x, point.y) : null;
            state.pointer.active = true;
            state.pointer.pointerId = event.pointerId;
            state.pointer.mode = tuningTarget ? 'sector-tune' : 'rotate';
            state.pointer.moved = false;
            state.pointer.startX = event.clientX;
            state.pointer.startY = event.clientY;
            state.pointer.lastX = event.clientX;
            state.pointer.lastY = event.clientY;
            state.pointer.lastMoveAt = event.timeStamp || performance.now();
            state.pointer.tuningSector = tuningTarget?.sector || null;
            state.tuningSector = state.pointer.tuningSector;
            state.rotationTargetX = state.rotationX;
            state.rotationTargetY = state.rotationY;
            state.rotationVelocityX = 0;
            state.rotationVelocityY = 0;
            markInteraction(state, event.timeStamp);
            if (tuningTarget) state.hoveredNode = tuningTarget;
            canvas.setPointerCapture?.(event.pointerId);
            canvas.classList.remove('cursor-grab');
            canvas.classList.add('cursor-grabbing');
            if (tuningTarget) draw(state, options);
            else scheduleAnimation(state, options);
            event.preventDefault();
        });

        canvas.addEventListener('pointermove', event => {
            if (!state.enabled) return;
            if (event.pointerType === 'touch' && state.touchPointers.has(event.pointerId)) {
                state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (state.pinch) {
                    updatePinch(state);
                    markInteraction(state, event.timeStamp);
                    scheduleAnimation(state, options);
                    event.preventDefault();
                    return;
                }
            }
            if (state.pointer.active && state.pointer.pointerId === event.pointerId) {
                const dx = event.clientX - state.pointer.lastX;
                const dy = event.clientY - state.pointer.lastY;
                const now = event.timeStamp || performance.now();
                const dt = Math.max(8, now - (state.pointer.lastMoveAt || now));
                const total = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
                if (total > DRAG_THRESHOLD) state.pointer.moved = true;
                if (state.pointer.mode === 'sector-tune' && state.pointer.tuningSector) {
                    nudgeSector(state, state.pointer.tuningSector, dx * 0.0068, -dy * 0.0049);
                    state.rotationVelocityX = 0;
                    state.rotationVelocityY = 0;
                    draw(state, options);
                } else {
                    state.rotationTargetY += dx * ROTATION_Y_SENSITIVITY;
                    state.rotationTargetX = clamp(state.rotationTargetX + dy * ROTATION_X_SENSITIVITY, -1.12, 1.12);
                    state.rotationVelocityY = clamp(dx * ROTATION_Y_SENSITIVITY / dt, -0.0045, 0.0045);
                    state.rotationVelocityX = clamp(dy * ROTATION_X_SENSITIVITY / dt, -0.0035, 0.0035);
                    scheduleAnimation(state, options);
                }
                state.pointer.lastX = event.clientX;
                state.pointer.lastY = event.clientY;
                state.pointer.lastMoveAt = now;
                markInteraction(state, now);
                event.preventDefault();
                return;
            }

            const point = getCanvasPoint(canvas, event);
            const hovered = findNodeAt(state, point.x, point.y);
            if (hovered !== state.hoveredNode) {
                state.hoveredNode = hovered;
                draw(state, options);
            }
            markInteraction(state, event.timeStamp);
            queueIdleDrift(state, options);
        });

        canvas.addEventListener('pointerup', event => {
            if (event.pointerType === 'touch' && endTouchPointer(state, canvas, event, options)) {
                event.preventDefault();
                return;
            }
            if (!state.pointer.active || state.pointer.pointerId !== event.pointerId) return;
            const wasTuning = state.pointer.mode === 'sector-tune';
            const point = getCanvasPoint(canvas, event);
            const clickedNode = !state.pointer.moved && !wasTuning
                ? findNodeAt(state, point.x, point.y)
                : null;
            state.pointer.active = false;
            state.pointer.pointerId = null;
            state.pointer.mode = 'rotate';
            state.pointer.tuningSector = null;
            state.tuningSector = null;
            if (!wasTuning && (event.timeStamp || performance.now()) - state.pointer.lastMoveAt > 120) {
                state.rotationVelocityX = 0;
                state.rotationVelocityY = 0;
            }
            if (wasTuning) {
                state.rotationVelocityX = 0;
                state.rotationVelocityY = 0;
            }
            markInteraction(state, event.timeStamp);
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.classList.add('cursor-grab');
            canvas.classList.remove('cursor-grabbing');
            if (clickedNode && options.onSelectNode) options.onSelectNode(clickedNode.node);
            scheduleAnimation(state, options);
            event.preventDefault();
        });

        canvas.addEventListener('pointercancel', event => {
            if (event.pointerType === 'touch') {
                state.touchPointers.delete(event.pointerId);
                if (state.pinch && state.touchPointers.size < 2) endPinch(state);
            }
            state.pointer.active = false;
            state.pointer.pointerId = null;
            state.pointer.mode = 'rotate';
            state.pointer.tuningSector = null;
            state.tuningSector = null;
            state.rotationVelocityX = 0;
            state.rotationVelocityY = 0;
            markInteraction(state, event.timeStamp);
            canvas.releasePointerCapture?.(event.pointerId);
            canvas.classList.add('cursor-grab');
            canvas.classList.remove('cursor-grabbing');
            scheduleAnimation(state, options);
        });
        canvas.addEventListener('lostpointercapture', event => {
            if (event.pointerType === 'touch') {
                state.touchPointers.delete(event.pointerId);
                if (state.pinch && state.touchPointers.size < 2) endPinch(state);
            }
        });

        canvas.addEventListener('pointerleave', () => {
            if (state.pointer.active || !state.hoveredNode) return;
            state.hoveredNode = null;
            markInteraction(state);
            draw(state, options);
            queueIdleDrift(state, options);
        });

        canvas.addEventListener('wheel', event => {
            if (!state.enabled) return;
            const delta = clamp(Number(event.deltaY) || 0, -180, 180);
            state.targetZoom = clamp(state.targetZoom * Math.exp(-delta * ZOOM_SENSITIVITY), MIN_ZOOM, MAX_ZOOM);
            markInteraction(state, event.timeStamp);
            scheduleAnimation(state, options);
            event.preventDefault();
        }, { passive: false });

        canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    function beginPinch(state) {
        const metrics = getPinchMetrics(state);
        if (!metrics) return;
        state.pointer.active = false;
        state.pointer.pointerId = null;
        state.pinch = {
            ids: metrics.ids,
            startDistance: metrics.distance,
            startZoom: state.targetZoom
        };
        state.rotationVelocityX = 0;
        state.rotationVelocityY = 0;
    }

    function updatePinch(state) {
        const metrics = getPinchMetrics(state, state.pinch?.ids);
        if (!metrics || !state.pinch?.startDistance) return;
        const zoomRatio = metrics.distance / state.pinch.startDistance;
        state.targetZoom = clamp(state.pinch.startZoom * zoomRatio, MIN_ZOOM, MAX_ZOOM);
        state.zoom = clamp(state.zoom + (state.targetZoom - state.zoom) * 0.45, MIN_ZOOM, MAX_ZOOM);
    }

    function endTouchPointer(state, canvas, event, options) {
        const hadPointer = state.touchPointers.delete(event.pointerId);
        const wasPinching = Boolean(state.pinch);
        if (canvas?.hasPointerCapture?.(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
        }
        if (!wasPinching) return false;
        if (state.touchPointers.size >= 2) {
            beginPinch(state);
        } else {
            endPinch(state);
        }
        markInteraction(state, event.timeStamp);
        scheduleAnimation(state, options);
        return hadPointer || wasPinching;
    }

    function endPinch(state) {
        state.pinch = null;
        state.pointer.active = false;
        state.pointer.pointerId = null;
        state.pointer.mode = 'rotate';
        state.pointer.tuningSector = null;
        state.tuningSector = null;
        state.rotationVelocityX = 0;
        state.rotationVelocityY = 0;
    }

    function getPinchMetrics(state, preferredIds = null) {
        const ids = (preferredIds || [...state.touchPointers.keys()])
            .filter(id => state.touchPointers.has(id))
            .slice(0, 2);
        if (ids.length < 2) return null;
        const first = state.touchPointers.get(ids[0]);
        const second = state.touchPointers.get(ids[1]);
        return {
            ids,
            distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
        };
    }

    function markInteraction(state) {
        state.lastInteractionAt = performance.now();
        clearIdleDrift(state);
    }

    function scheduleAnimation(state, options) {
        if (!state.enabled || state.animationFrame !== null || typeof requestAnimationFrame !== 'function') return;
        clearIdleDrift(state);
        state.animationFrame = requestAnimationFrame(timestamp => runAnimationFrame(state, options, timestamp));
    }

    function stopAnimation(state) {
        clearIdleDrift(state);
        if (state.animationFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(state.animationFrame);
        }
        state.animationFrame = null;
        state.lastFrameAt = 0;
        state.rotationVelocityX = 0;
        state.rotationVelocityY = 0;
    }

    function clearIdleDrift(state) {
        if (state.idleDriftTimer === null || typeof clearTimeout !== 'function') return;
        clearTimeout(state.idleDriftTimer);
        state.idleDriftTimer = null;
    }

    function queueIdleDrift(state, options) {
        if (!state.enabled || state.idleDriftTimer !== null || typeof setTimeout !== 'function') return;
        const now = performance.now();
        const delay = Math.max(0, AUTO_DRIFT_DELAY - (now - state.lastInteractionAt));
        state.idleDriftTimer = setTimeout(() => {
            state.idleDriftTimer = null;
            scheduleAnimation(state, options);
        }, delay);
    }

    function runAnimationFrame(state, options, timestamp) {
        state.animationFrame = null;
        if (!state.enabled) {
            state.lastFrameAt = 0;
            return;
        }

        const dtMs = state.lastFrameAt ? clamp(timestamp - state.lastFrameAt, 1, 48) : 16.67;
        state.lastFrameAt = timestamp;
        const changed = stepOrbMotion(state, timestamp, dtMs);
        if (changed) draw(state, options);

        if (shouldContinueAnimation(state, timestamp)) {
            scheduleAnimation(state, options);
        } else {
            state.lastFrameAt = 0;
            queueIdleDrift(state, options);
        }
    }

    function stepOrbMotion(state, timestamp, dtMs) {
        const dt = dtMs / 1000;
        let changed = false;

        if (!state.pointer.active) {
            const velocityActive = Math.abs(state.rotationVelocityX) > MIN_ROTATION_VELOCITY ||
                Math.abs(state.rotationVelocityY) > MIN_ROTATION_VELOCITY;
            if (velocityActive) {
                state.rotationTargetY += state.rotationVelocityY * dtMs;
                state.rotationTargetX = clamp(state.rotationTargetX + state.rotationVelocityX * dtMs, -1.12, 1.12);
                const decay = Math.pow(ROTATION_INERTIA_DECAY, dtMs / 16.67);
                state.rotationVelocityX *= decay;
                state.rotationVelocityY *= decay;
                if (Math.abs(state.rotationVelocityX) <= MIN_ROTATION_VELOCITY) state.rotationVelocityX = 0;
                if (Math.abs(state.rotationVelocityY) <= MIN_ROTATION_VELOCITY) state.rotationVelocityY = 0;
                changed = true;
            }

            if (state.layoutNodes.length && timestamp - state.lastInteractionAt > AUTO_DRIFT_DELAY) {
                const focusScale = state.hoveredNode || state.selectedNode ? 0.18 : 1;
                state.rotationTargetY += AUTO_DRIFT_SPEED * focusScale * dt;
                changed = true;
            }
        }

        const rotationEase = 1 - Math.exp(-ROTATION_DAMPING * dt);
        const nextRotationX = state.rotationX + (state.rotationTargetX - state.rotationX) * rotationEase;
        const nextRotationY = state.rotationY + (state.rotationTargetY - state.rotationY) * rotationEase;
        if (Math.abs(nextRotationX - state.rotationX) > 0.00005 || Math.abs(nextRotationY - state.rotationY) > 0.00005) {
            state.rotationX = clamp(nextRotationX, -1.12, 1.12);
            state.rotationY = nextRotationY;
            changed = true;
        } else {
            state.rotationX = clamp(state.rotationTargetX, -1.12, 1.12);
            state.rotationY = state.rotationTargetY;
        }

        const zoomEase = 1 - Math.exp(-ZOOM_DAMPING * dt);
        const nextZoom = state.zoom + (state.targetZoom - state.zoom) * zoomEase;
        if (Math.abs(nextZoom - state.zoom) > 0.0005) {
            state.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
            changed = true;
        } else {
            state.zoom = clamp(state.targetZoom, MIN_ZOOM, MAX_ZOOM);
        }

        return changed;
    }

    function shouldContinueAnimation(state, timestamp) {
        if (!state.enabled) return false;
        if (state.pointer.active) return true;
        if (Math.abs(state.rotationVelocityX) > 0 || Math.abs(state.rotationVelocityY) > 0) return true;
        if (Math.abs(state.rotationTargetX - state.rotationX) > 0.00008) return true;
        if (Math.abs(state.rotationTargetY - state.rotationY) > 0.00008) return true;
        if (Math.abs(state.targetZoom - state.zoom) > 0.0006) return true;
        return state.layoutNodes.length > 0 && timestamp - state.lastInteractionAt > AUTO_DRIFT_DELAY;
    }

    function setData(state, data, options) {
        state.nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        state.links = Array.isArray(data?.links) ? data.links : [];
        state.selectedNode = data?.selectedNode || state.selectedNode || null;
        const layout = buildOrbLayout(state.nodes, state.links, options, state);
        state.layoutNodes = layout.nodes;
        state.layoutLinks = layout.links;
        state.focusContext = null;
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

    function buildOrbLayout(nodes, links, options, state = {}) {
        const profile = getLayoutDensityProfile(state.layoutDensity);
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

        const layoutNodes = nodes.map(node => {
            const sector = node.sector || 'Other';
            const bucket = sectorBuckets.get(sector) || [];
            const localIndex = Math.max(0, bucket.indexOf(node));
            const bucketT = bucket.length <= 1 ? 0.5 : localIndex / (bucket.length - 1);
            const sIndex = sectorIndex.get(sector) || 0;
            const seed = hash(`${node.id}:${node.ticker || ''}:${sector}`);
            const sectorAnchor = getSectorAnchor(sector, sIndex, sectors.length, profile);
            const nodeDegree = degree.get(node.id) || node.degree || 0;
            const rank = Number(node.rank) || 9999;
            const rankCentrality = rank <= 50 ? (50 - rank) / 50 : 0;
            const centrality = clamp(nodeDegree / maxDegree * 0.72 + rankCentrality * 0.28, 0, 1);
            const localArc = Math.min(1.24, Math.max(0.5, TAU / Math.max(4, sectors.length || 1)));
            const localTurn = (((localIndex + 1) * GOLDEN_RATIO_FRACTION + (seed % 997) / 997 * 0.09) % 1) - 0.5;
            const localWave = Math.sin((localIndex + 1) * 1.79 + (hash(`sector-wave:${sector}`) % 360) * Math.PI / 180);
            const centralityFocus = 1 - centrality * 0.34;
            const baseLatitude = clamp(
                sectorAnchor.latitude +
                (bucketT - 0.5) * profile.localLatitudeSpread * centralityFocus +
                localWave * profile.localLatitudeWave,
                -1.24,
                1.24
            );
            const baseLongitude = sectorAnchor.longitude +
                localTurn * localArc * profile.localLongitudeSpread * centralityFocus +
                ((seed % 101) - 50) * 0.0009;
            const radius = 0.96 - centrality * 0.22 + sectorAnchor.radiusOffset + ((seed % 31) - 15) * 0.0019;
            const adjustment = getSectorAdjustment(state, sector);
            const latitude = clamp(baseLatitude + adjustment.latitude, -1.28, 1.28);
            const longitude = baseLongitude + adjustment.longitude;
            const point = pointFromOrbital(latitude, longitude, radius);

            return {
                node,
                point,
                sector,
                baseLatitude,
                baseLongitude,
                radius,
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
        const focusContext = getOrbFocusContext(state);
        state.layoutLinks
            .map(item => ({
                ...item,
                sourceProjected: projectedById.get(item.source.node.id),
                targetProjected: projectedById.get(item.target.node.id),
                focusPriority: getOrbLinkFocusPriority(item, focusContext)
            }))
            .filter(item => item.sourceProjected && item.targetProjected)
            .sort((a, b) => a.focusPriority - b.focusPriority || averageDepth(a) - averageDepth(b))
            .forEach(item => drawOrbLink(ctx, state, item, options, focusContext));

        drawTunedSectorHighlight(ctx, state, projectedNodes);

        projectedNodes
            .sort((a, b) => a.projected.depth - b.projected.depth)
            .forEach(item => drawOrbNode(ctx, state, item, options, focusContext));

        drawOrbLabels(ctx, state, projectedNodes, options, focusContext);
        drawHoverReadout(ctx, state, options);
        drawClusterTuningReadout(ctx, state, options);
    }

    function drawOrbBackground(ctx, state) {
        const cx = state.width / 2;
        const cy = state.height / 2;
        const radius = Math.min(state.width, state.height) * 0.48;
        const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * 1.25);
        glow.addColorStop(0, 'rgba(251, 191, 36, 0.24)');
        glow.addColorStop(0.34, 'rgba(251, 191, 36, 0.105)');
        glow.addColorStop(0.58, 'rgba(0, 249, 255, 0.055)');
        glow.addColorStop(0.82, 'rgba(3, 7, 18, 0.12)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, state.width, state.height);

        ctx.save();
        ctx.globalAlpha = 0.045;
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

        ctx.globalAlpha = 0.42;
        for (let i = 0; i < 70; i++) {
            const seed = hash(`orb-star:${i}:${Math.round(state.width)}:${Math.round(state.height)}`);
            const x = (seed % 1000) / 1000 * state.width;
            const y = (Math.floor(seed / 1000) % 1000) / 1000 * state.height;
            const edgeFade = clamp(Math.min(x, y, state.width - x, state.height - y) / Math.min(state.width, state.height) * 7, 0, 1);
            ctx.fillStyle = i % 5 === 0 ? 'rgba(251, 191, 36, 0.42)' : 'rgba(254, 243, 199, 0.26)';
            ctx.beginPath();
            ctx.arc(x, y, (i % 4 === 0 ? 1.15 : 0.7) * edgeFade, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawSphereGuide(ctx, state) {
        ctx.save();
        const cx = state.width / 2;
        const cy = state.height / 2;
        const radius = Math.min(state.width, state.height) * 0.39 * state.zoom;

        const innerGlow = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius * 1.04);
        innerGlow.addColorStop(0, 'rgba(251, 191, 36, 0.04)');
        innerGlow.addColorStop(0.42, 'rgba(0, 249, 255, 0.018)');
        innerGlow.addColorStop(0.78, 'rgba(251, 191, 36, 0.01)');
        innerGlow.addColorStop(1, 'rgba(0, 249, 255, 0)');
        ctx.fillStyle = innerGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();

        const atmosphericFade = ctx.createRadialGradient(cx, cy, radius * 0.62, cx, cy, radius * 1.08);
        atmosphericFade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        atmosphericFade.addColorStop(0.74, 'rgba(0, 249, 255, 0.01)');
        atmosphericFade.addColorStop(1, 'rgba(251, 191, 36, 0.034)');
        ctx.fillStyle = atmosphericFade;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.03, 0, TAU);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(253, 230, 138, 0.14)';
        ctx.lineWidth = 0.85;
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(251, 191, 36, 0.08)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 249, 255, 0.035)';
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(0, 249, 255, 0.045)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.006, 0, TAU);
        ctx.stroke();

        [-0.68, -0.34, 0, 0.34, 0.68].forEach(latitude => {
            drawSphereLine(ctx, state, t => ({
                x: Math.cos(t) * Math.cos(latitude),
                y: Math.sin(latitude),
                z: Math.sin(t) * Math.cos(latitude)
            }), latitude === 0 ? 'rgba(251, 191, 36, 0.105)' : 'rgba(251, 191, 36, 0.06)', latitude === 0 ? 0.65 : 0.45);
        });
        for (let i = 0; i < 8; i++) {
            const longitude = i / 8 * TAU;
            drawSphereLine(ctx, state, t => ({
                x: Math.cos(longitude) * Math.cos(t),
                y: Math.sin(t),
                z: Math.sin(longitude) * Math.cos(t)
            }), i % 2 ? 'rgba(0, 249, 255, 0.04)' : 'rgba(251, 191, 36, 0.055)', 0.42);
        }
        ctx.restore();
    }

    function drawSphereLine(ctx, state, pointAt, color, lineWidth = 1) {
        const samples = 96;
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
            const p = project(pointAt((i / samples) * TAU), state);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.shadowBlur = 2;
        ctx.shadowColor = color;
        ctx.stroke();
    }

    function drawOrbLink(ctx, state, item, options, focusContext) {
        const source = item.source.point;
        const target = item.target.point;
        const strength = clamp(Number(item.link.strength) || 0.4, 0.05, 1);
        const secBacked = Boolean(options.isSecBackedLink?.(item.link));
        const sourceId = item.source.node.id;
        const targetId = item.target.node.id;
        const selectedEdge = Boolean(focusContext?.selectedId && (
            sourceId === focusContext.selectedId ||
            targetId === focusContext.selectedId
        ));
        const hoverEdge = Boolean(focusContext?.hoveredId && (
            sourceId === focusContext.hoveredId ||
            targetId === focusContext.hoveredId
        ));
        const primaryActive = selectedEdge || (!focusContext?.selectedId && hoverEdge);
        const secondaryActive = Boolean(focusContext?.selectedId && hoverEdge && !selectedEdge);
        const inactive = Boolean(focusContext?.hasFocus && !selectedEdge && !hoverEdge);
        const linkColor = options.getLinkColor?.(item.link) || CYAN;
        const color = secBacked ? GOLD : primaryActive ? GOLD_SOFT : linkColor;
        const averageDepthT = clamp((item.sourceProjected.projected.depthT + item.targetProjected.projected.depthT) / 2, 0, 1);
        const depthLayer = getDepthLayer(averageDepthT);
        const quietStrength = 0.74 + Math.pow(strength, 1.45) * 0.26;
        const depthAlpha = 0.24 + depthLayer * 0.76;
        const baseAlpha = secBacked ? 0.15 + strength * 0.23 : 0.045 + Math.pow(strength, 1.9) * 0.2;
        const activeAlpha = primaryActive ? 2.72 : secondaryActive ? 1.48 : inactive ? 0.26 : 1;
        const alpha = baseAlpha * quietStrength * depthAlpha * activeAlpha;
        const activeWidth = primaryActive ? 1.68 : secondaryActive ? 1.24 : inactive ? 0.72 : 1;
        const width = (secBacked ? 0.68 + strength * 1.25 : 0.32 + strength * 1.08) * (0.82 + depthLayer * 0.2) * activeWidth;
        const activeGlow = primaryActive ? 1.9 : secondaryActive ? 1.28 : inactive ? 0.54 : 1;
        const glowBlur = (secBacked ? 17 : 12) * (0.46 + depthLayer * 0.84) * activeGlow;
        const points = getArcPoints(source, target, 18, 0.1 + strength * 0.13);

        ctx.save();
        if (secBacked && !primaryActive && !secondaryActive) ctx.setLineDash([3, 7]);
        strokeProjectedPath(ctx, state, points, color, alpha * (0.34 + depthLayer * 0.26), width + 2.35 + depthLayer * 1.1, glowBlur + 8);
        if (secBacked && !primaryActive && !secondaryActive) ctx.setLineDash([3, 7]);
        else ctx.setLineDash([]);
        strokeProjectedPath(ctx, state, points, color, alpha, width, primaryActive ? glowBlur + 10 : glowBlur);
        ctx.restore();
    }

    function strokeProjectedPath(ctx, state, points, color, alpha, width, shadowBlur) {
        ctx.globalAlpha = Math.min(0.95, alpha);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = shadowBlur;
        ctx.shadowColor = color;
        ctx.beginPath();
        points.forEach((point, index) => {
            const projected = project(point, state);
            if (index === 0) ctx.moveTo(projected.x, projected.y);
            else ctx.lineTo(projected.x, projected.y);
        });
        ctx.stroke();
    }

    function getOrbFocusContext(state) {
        const selectedId = state.selectedNode?.id || null;
        const hoveredId = state.hoveredNode?.node?.id || null;
        const cached = state.focusContext;
        if (
            cached &&
            cached.selectedId === selectedId &&
            cached.hoveredId === hoveredId &&
            cached.links === state.layoutLinks
        ) {
            return cached;
        }

        const selectedNeighbors = new Set();
        const hoverNeighbors = new Set();
        if (selectedId || hoveredId) {
            state.layoutLinks.forEach(item => {
                const sourceId = item.source.node.id;
                const targetId = item.target.node.id;
                if (selectedId && (sourceId === selectedId || targetId === selectedId)) {
                    selectedNeighbors.add(sourceId === selectedId ? targetId : sourceId);
                }
                if (hoveredId && (sourceId === hoveredId || targetId === hoveredId)) {
                    hoverNeighbors.add(sourceId === hoveredId ? targetId : sourceId);
                }
            });
        }

        state.focusContext = {
            selectedId,
            hoveredId,
            selectedNeighbors,
            hoverNeighbors,
            hasFocus: Boolean(selectedId || hoveredId),
            links: state.layoutLinks
        };
        return state.focusContext;
    }

    function getOrbLinkFocusPriority(item, focusContext) {
        if (!focusContext?.hasFocus) return 0;
        const sourceId = item.source.node.id;
        const targetId = item.target.node.id;
        if (focusContext.selectedId && (sourceId === focusContext.selectedId || targetId === focusContext.selectedId)) return 2;
        if (focusContext.hoveredId && (sourceId === focusContext.hoveredId || targetId === focusContext.hoveredId)) return 1;
        return 0;
    }

    function drawOrbNode(ctx, state, item, options, focusContext) {
        const p = item.projected;
        const depthLayer = getDepthLayer(p.depthT);
        const depthAlpha = 0.16 + depthLayer * 0.78;
        const selected = focusContext?.selectedId === item.node.id;
        const hovered = focusContext?.hoveredId === item.node.id;
        const selectedNeighbor = Boolean(focusContext?.selectedNeighbors?.has(item.node.id));
        const hoverNeighbor = Boolean(focusContext?.hoverNeighbors?.has(item.node.id));
        const selectedMode = Boolean(focusContext?.selectedId);
        const unrelated = Boolean(focusContext?.hasFocus && !selected && !hovered && !selectedNeighbor && !hoverNeighbor);
        const tuning = Boolean(state.tuningSector && item.sector === state.tuningSector);
        const hub = item.centrality >= 0.58;
        const color = options.getNodeColor?.(item.node) || item.node.color || CYAN;
        const hubScale = hub ? 1.06 + item.centrality * 0.055 : 1;
        const emphasisScale = selected
            ? 1.64
            : hovered
                ? (selectedMode ? 1.16 : 1.28)
                : selectedNeighbor
                    ? 1.12
                    : hoverNeighbor
                        ? (selectedMode ? 1.035 : 1.08)
                        : tuning
                            ? 1.08
                            : unrelated
                                ? 0.9
                                : hubScale;
        const depthSize = 0.94 + depthLayer * 0.13;
        const radius = item.size * (0.62 + p.scale * 0.28) * depthSize * emphasisScale;
        const glowScale = selected ? 6.35 : hovered ? 5 : selectedNeighbor ? 4.95 : hub ? 4.8 : 4.05;
        const glowAlpha = selected ? 0.62 : hovered ? (selectedMode ? 0.25 : 0.34) : selectedNeighbor ? 0.28 : hoverNeighbor ? 0.2 : unrelated ? 0.07 : hub ? 0.24 : 0.17;
        const coreAlpha = selected
            ? 1
            : hovered
                ? (selectedMode ? 0.72 : 0.84)
                : selectedNeighbor
                    ? 0.76
                    : hoverNeighbor
                        ? 0.58
                        : unrelated
                            ? 0.25 + depthLayer * 0.13
                            : 0.48 + depthLayer * 0.2 + (hub ? 0.08 : 0);
        const rimAlpha = selectedNeighbor
            ? 0.78
            : hoverNeighbor
                ? 0.62
                : unrelated
                    ? 0.28 + depthLayer * 0.16
                    : clamp(0.42 + depthLayer * 0.32 + (hub ? 0.08 : 0), 0.38, 0.86);
        const nodeAlpha = selected
            ? 1
            : hovered
                ? (selectedMode ? 0.78 : 0.94)
                : selectedNeighbor
                    ? 0.9
                    : hoverNeighbor
                        ? (selectedMode ? 0.58 : 0.76)
                        : unrelated
                            ? 0.34 + depthLayer * 0.16
                            : tuning
                                ? Math.min(0.82, depthAlpha + 0.18)
                                : depthAlpha;

        ctx.save();
        ctx.globalAlpha = nodeAlpha;
        const glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, radius * glowScale);
        glow.addColorStop(0, rgba(selected ? GOLD : color, glowAlpha));
        glow.addColorStop(0.4, rgba(color, selected ? 0.24 : selectedNeighbor ? 0.14 : hub ? 0.13 : 0.09));
        glow.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * glowScale, 0, TAU);
        ctx.fill();

        ctx.shadowBlur = selected ? 42 : hovered ? 24 : selectedNeighbor ? 18 : hub ? 16 : unrelated ? 4 : 10 + depthLayer * 5;
        ctx.shadowColor = selected ? GOLD : color;
        ctx.fillStyle = rgba(color, coreAlpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, TAU);
        ctx.fill();
        ctx.lineWidth = selected ? 2.8 : hovered ? 1.65 : selectedNeighbor ? 1.45 : tuning ? 1.2 : hub ? 1.15 : 0.9;
        ctx.strokeStyle = selected ? GOLD_SOFT : hovered ? GOLD : selectedNeighbor ? 'rgba(253, 230, 138, 0.78)' : tuning ? 'rgba(253, 230, 138, 0.72)' : rgba('#ffffff', rimAlpha);
        ctx.stroke();

        if (selected || hovered || selectedNeighbor || hub) {
            ctx.globalAlpha = selected ? 0.96 : hovered ? (selectedMode ? 0.48 : 0.64) : selectedNeighbor ? 0.42 : 0.18 + depthLayer * 0.16;
            ctx.shadowBlur = selected ? 28 : hovered ? 14 : selectedNeighbor ? 12 : 10;
            ctx.strokeStyle = selected ? GOLD : hovered ? rgba(color, 0.92) : selectedNeighbor ? GOLD_SOFT : rgba(color, 0.68);
            ctx.lineWidth = selected ? 1.55 : hovered ? 1 : selectedNeighbor ? 0.95 : 0.75;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius + (selected ? 9 : hovered ? 5 : selectedNeighbor ? 4.5 : 3.5), 0, TAU);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawTunedSectorHighlight(ctx, state, nodes) {
        if (!state.tuningSector) return;

        const sectorNodes = nodes.filter(item => item.sector === state.tuningSector);
        if (!sectorNodes.length) return;

        const minX = Math.min(...sectorNodes.map(item => item.projected.x));
        const maxX = Math.max(...sectorNodes.map(item => item.projected.x));
        const minY = Math.min(...sectorNodes.map(item => item.projected.y));
        const maxY = Math.max(...sectorNodes.map(item => item.projected.y));
        const pad = clamp(Math.min(state.width, state.height) * 0.036, 18, 36);
        const x = clamp(minX - pad, 12, state.width - 24);
        const y = clamp(minY - pad, 12, state.height - 24);
        const maxWidth = Math.max(44, state.width - x - 12);
        const maxHeight = Math.max(34, state.height - y - 12);
        const width = Math.min(Math.max(maxX - minX + pad * 2, 44), maxWidth);
        const height = Math.min(Math.max(maxY - minY + pad * 2, 34), maxHeight);

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.035)';
        ctx.strokeStyle = 'rgba(253, 230, 138, 0.24)';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(251, 191, 36, 0.14)';
        roundedRect(ctx, x, y, width, height, 14);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawOrbLabels(ctx, state, nodes, options, focusContext) {
        const selectedId = focusContext?.selectedId;
        const hoveredId = focusContext?.hoveredId;
        const candidates = nodes
            .map(item => {
                const selected = selectedId === item.node.id;
                const hovered = hoveredId === item.node.id;
                const selectedNeighbor = Boolean(focusContext?.selectedNeighbors?.has(item.node.id));
                const hoverNeighbor = Boolean(focusContext?.hoverNeighbors?.has(item.node.id));
                const hub = item.centrality >= 0.58 && item.projected.depthT > 0.38;
                const neighborLabel = selectedNeighbor || (!selectedId && hoverNeighbor && item.projected.depthT > 0.32);
                const priority = (selected ? 120 : 0) +
                    (hovered ? 96 : 0) +
                    (selectedNeighbor ? 54 : 0) +
                    (!selectedId && hoverNeighbor ? 30 : 0) +
                    item.centrality * 16 +
                    item.projected.depthT * 5;
                return { ...item, selected, hovered, selectedNeighbor, hoverNeighbor, hub, neighborLabel, priority };
            })
            .filter(item => item.selected || item.hovered || item.neighborLabel || item.hub)
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 14);

        ctx.save();
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const occupied = [];
        candidates.forEach(item => {
            const detailed = item.selected || item.hovered;
            const label = getOrbLabel(item.node, options, detailed);
            if (!label) return;
            const p = item.projected;
            const color = options.getNodeColor?.(item.node) || item.node.color || CYAN;
            const maxWidth = detailed ? Math.min(230, state.width * 0.42) : 82;
            const text = fitText(ctx, label, maxWidth - 14);
            const width = Math.min(maxWidth, ctx.measureText(text).width + 14);
            const height = detailed ? 20 : 17;
            const x = clamp(p.x - width / 2, 8, state.width - width - 8);
            const y = clamp(p.y + item.size + 8, 8, state.height - height - 8);
            const box = { x, y, width, height };
            if (!detailed && occupied.some(other => boxesOverlap(box, other))) return;
            occupied.push({ x: x - 4, y: y - 3, width: width + 8, height: height + 6 });

            ctx.globalAlpha = item.selected ? 0.99 : item.hovered ? 0.92 : item.selectedNeighbor ? 0.68 : item.hoverNeighbor ? 0.54 : 0.35 + item.projected.depthT * 0.32;
            ctx.fillStyle = item.selected
                ? 'rgba(39, 25, 4, 0.84)'
                : item.hovered
                    ? 'rgba(18, 20, 24, 0.82)'
                    : item.selectedNeighbor
                        ? 'rgba(17, 24, 39, 0.68)'
                        : 'rgba(2, 6, 23, 0.58)';
            roundedRect(ctx, x, y, width, height, 6);
            ctx.fill();
            ctx.strokeStyle = item.selected ? 'rgba(251, 191, 36, 0.62)' : item.hovered ? rgba(color, 0.44) : item.selectedNeighbor ? 'rgba(251, 191, 36, 0.34)' : 'rgba(251, 191, 36, 0.18)';
            ctx.lineWidth = item.selected || item.hovered ? 1 : 0.75;
            ctx.stroke();
            ctx.fillStyle = item.selected ? GOLD_SOFT : item.hovered ? GOLD : item.selectedNeighbor ? 'rgba(254, 243, 199, 0.92)' : rgba(color, 0.9);
            ctx.fillText(text, x + width / 2, y + height / 2 + 0.5);
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

    function drawClusterTuningReadout(ctx, state) {
        if (!state.tuningSector) return;
        const adjustment = getSectorAdjustment(state, state.tuningSector);
        const longitude = Math.round(adjustment.longitude * 100);
        const latitude = Math.round(adjustment.latitude * 100);
        const title = `Cluster tuning: ${state.tuningSector}`;
        const detail = `Spacing X ${formatSigned(longitude)} / Y ${formatSigned(latitude)} - session only`;
        ctx.save();
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        const width = Math.min(
            Math.max(ctx.measureText(title).width, ctx.measureText(detail).width) + 24,
            state.width - 28
        );
        const x = state.width / 2 - width / 2;
        const y = 16;
        ctx.fillStyle = 'rgba(3, 7, 18, 0.88)';
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.48)';
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, width, 38, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = GOLD_SOFT;
        ctx.textAlign = 'center';
        ctx.fillText(title, state.width / 2, y + 15);
        ctx.fillStyle = 'rgba(254, 243, 199, 0.72)';
        ctx.fillText(detail, state.width / 2, y + 29);
        ctx.restore();
    }

    function getOrbLabel(node, options, detailed = false) {
        const primary = String(options.getLabelText?.(node) || node.ticker || node.name || '').trim();
        if (!detailed) return primary;

        const name = String(node.name || '').trim();
        if (!name || !primary || name.toLowerCase() === primary.toLowerCase()) return primary;
        return `${primary} ${name}`;
    }

    function fitText(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let next = String(text || '').trim();
        while (next.length > 4 && ctx.measureText(`${next}...`).width > maxWidth) {
            next = next.slice(0, -1).trimEnd();
        }
        return `${next}...`;
    }

    function boxesOverlap(a, b) {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
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

    function getLayoutDensityProfile(mode) {
        return ORB_LAYOUT_DENSITY_PROFILES[normalizeLayoutDensityMode(mode)] || ORB_LAYOUT_DENSITY_PROFILES.balanced;
    }

    function normalizeLayoutDensityMode(mode) {
        return ORB_LAYOUT_DENSITY_MODES.includes(mode) ? mode : 'balanced';
    }

    function getSectorAnchor(sector, sectorIndex, sectorCount, profile) {
        const seed = hash(`orb-sector:${sector}`);
        const latitudeSlots = profile.latitudes;
        const slot = sectorIndex % latitudeSlots.length;
        const cycle = Math.floor(sectorIndex / latitudeSlots.length);
        const latitudeJitter = (((seed % 1000) / 1000) - 0.5) * profile.sectorLatitudeJitter;
        const longitudeJitter = (((Math.floor(seed / 1000) % 1000) / 1000) - 0.5) * profile.sectorLongitudeJitter;
        const sparseOffset = sectorCount <= 3 ? sectorIndex / Math.max(1, sectorCount) : sectorIndex * GOLDEN_RATIO_FRACTION;
        const longitude = ((sparseOffset + cycle * 0.137 + longitudeJitter) % 1) * TAU - Math.PI / 2;
        const radiusOffset = (((Math.floor(seed / 1000000) % 1000) / 1000) - 0.5) * profile.radiusSpread;

        return {
            latitude: clamp(latitudeSlots[slot] + latitudeJitter, -1.22, 1.22),
            longitude,
            radiusOffset
        };
    }

    function getSectorAdjustment(state, sector) {
        if (!state?.sectorAdjustments) return { latitude: 0, longitude: 0 };
        if (!state.sectorAdjustments.has(sector)) {
            state.sectorAdjustments.set(sector, { latitude: 0, longitude: 0 });
        }
        return state.sectorAdjustments.get(sector);
    }

    function nudgeSector(state, sector, longitudeDelta, latitudeDelta) {
        const adjustment = getSectorAdjustment(state, sector);
        adjustment.longitude = clamp(adjustment.longitude + longitudeDelta, -1.4, 1.4);
        adjustment.latitude = clamp(adjustment.latitude + latitudeDelta, -0.74, 0.74);
        applySectorAdjustment(state, sector);
    }

    function applySectorAdjustment(state, sector) {
        const adjustment = getSectorAdjustment(state, sector);
        state.layoutNodes.forEach(item => {
            if (item.sector !== sector) return;
            const latitude = clamp(item.baseLatitude + adjustment.latitude, -1.28, 1.28);
            const longitude = item.baseLongitude + adjustment.longitude;
            item.point = pointFromOrbital(latitude, longitude, item.radius);
        });
    }

    function pointFromOrbital(latitude, longitude, radius) {
        const cosLat = Math.cos(latitude);
        return {
            x: Math.cos(longitude) * cosLat * radius,
            y: Math.sin(latitude) * radius,
            z: Math.sin(longitude) * cosLat * radius
        };
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

    function getDepthLayer(depthT) {
        const t = clamp(depthT, 0, 1);
        return t * t * (3 - 2 * t);
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

    function formatSigned(value) {
        return value > 0 ? `+${value}` : String(value);
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
