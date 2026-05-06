(function () {
    const PERSPECTIVE_MIN_BEARING = -1.35;
    const PERSPECTIVE_MAX_BEARING = 1.35;
    const PERSPECTIVE_MIN_PITCH = -0.08;
    const PERSPECTIVE_MAX_PITCH = 1.08;
    const PERSPECTIVE_RESPONSE = 12;
    const PERSPECTIVE_INERTIA_DECAY = 0.9;
    const PERSPECTIVE_MAX_DT = 0.05;
    const PERSPECTIVE_EPSILON = 0.00012;
    const PERSPECTIVE_VELOCITY_EPSILON = 0.00035;

    const perspectiveMotion = {
        enabled: false,
        initialized: false,
        pointerActive: false,
        releasedNeedsSample: false,
        currentBearing: 0,
        currentPitch: 0,
        targetBearing: 0,
        targetPitch: 0,
        rawBearing: 0,
        rawPitch: 0,
        velocityBearing: 0,
        velocityPitch: 0,
        lastFrameAt: 0
    };

    function getZeroOrbitOffset() {
        return {
            x: 0,
            y: 0,
            phase: 0,
            phaseCos: 1,
            phaseSin: 0,
            verticalPhaseSin: 0,
            ramp: 0
        };
    }

    function getNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function clampFinite(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
    }

    function easeOutCubic(t) {
        const inverse = 1 - clampFinite(t, 0, 1);
        return 1 - inverse * inverse * inverse;
    }

    function getPerspectiveInput(transform) {
        const perspective = transform?.perspective;
        const enabled = Boolean(perspective?.enabled);
        const rawBearing = perspective?.bearing ?? perspective?.yaw ?? 0;
        return {
            enabled,
            bearing: enabled ? clampFinite(rawBearing, PERSPECTIVE_MIN_BEARING, PERSPECTIVE_MAX_BEARING) : 0,
            pitch: enabled ? clampFinite(perspective.pitch, PERSPECTIVE_MIN_PITCH, PERSPECTIVE_MAX_PITCH) : 0
        };
    }

    function initializePerspectiveMotion(input, now) {
        perspectiveMotion.enabled = input.enabled;
        perspectiveMotion.initialized = input.enabled;
        perspectiveMotion.currentBearing = input.bearing;
        perspectiveMotion.currentPitch = input.pitch;
        perspectiveMotion.targetBearing = input.bearing;
        perspectiveMotion.targetPitch = input.pitch;
        perspectiveMotion.rawBearing = input.bearing;
        perspectiveMotion.rawPitch = input.pitch;
        perspectiveMotion.velocityBearing = 0;
        perspectiveMotion.velocityPitch = 0;
        perspectiveMotion.lastFrameAt = now;
    }

    function setPerspectivePointerActive(active) {
        perspectiveMotion.pointerActive = Boolean(active);
        if (active) {
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.velocityBearing = 0;
            perspectiveMotion.velocityPitch = 0;
        }
    }

    function releasePerspectivePointer() {
        perspectiveMotion.pointerActive = false;
        perspectiveMotion.releasedNeedsSample = true;
    }

    function cancelPerspectiveMotion() {
        perspectiveMotion.pointerActive = false;
        perspectiveMotion.releasedNeedsSample = false;
        perspectiveMotion.velocityBearing = 0;
        perspectiveMotion.velocityPitch = 0;
        perspectiveMotion.targetBearing = perspectiveMotion.currentBearing;
        perspectiveMotion.targetPitch = perspectiveMotion.currentPitch;
    }

    function getPerspectiveMotionSnapshot(transform) {
        const input = getPerspectiveInput(transform);
        if (!input.enabled) {
            return {
                enabled: false,
                bearing: 0,
                pitch: 0,
                targetBearing: 0,
                targetPitch: 0,
                rawBearing: 0,
                rawPitch: 0
            };
        }

        if (!perspectiveMotion.initialized || !perspectiveMotion.enabled) {
            initializePerspectiveMotion(input, getNow());
        }

        return {
            enabled: true,
            bearing: perspectiveMotion.currentBearing,
            pitch: perspectiveMotion.currentPitch,
            targetBearing: perspectiveMotion.targetBearing,
            targetPitch: perspectiveMotion.targetPitch,
            rawBearing: input.bearing,
            rawPitch: input.pitch
        };
    }

    function stepPerspectiveMotion(transform, now = getNow()) {
        const input = getPerspectiveInput(transform);
        if (!input.enabled) {
            perspectiveMotion.enabled = false;
            perspectiveMotion.initialized = false;
            perspectiveMotion.pointerActive = false;
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.velocityBearing = 0;
            perspectiveMotion.velocityPitch = 0;
            return false;
        }

        if (!perspectiveMotion.initialized || !perspectiveMotion.enabled) {
            initializePerspectiveMotion(input, now);
            return false;
        }

        const elapsed = Math.max(0, now - perspectiveMotion.lastFrameAt);
        const dt = Math.min(PERSPECTIVE_MAX_DT, elapsed / 1000 || 1 / 60);
        const rawDeltaBearing = input.bearing - perspectiveMotion.rawBearing;
        const rawDeltaPitch = input.pitch - perspectiveMotion.rawPitch;
        const rawChanged = Math.abs(rawDeltaBearing) > PERSPECTIVE_EPSILON || Math.abs(rawDeltaPitch) > PERSPECTIVE_EPSILON;

        if (rawChanged) {
            perspectiveMotion.targetBearing = input.bearing;
            perspectiveMotion.targetPitch = input.pitch;
            if ((perspectiveMotion.pointerActive || perspectiveMotion.releasedNeedsSample) && dt > 0) {
                const nextVelocityBearing = rawDeltaBearing / dt;
                const nextVelocityPitch = rawDeltaPitch / dt;
                perspectiveMotion.velocityBearing = perspectiveMotion.velocityBearing * 0.3 + nextVelocityBearing * 0.7;
                perspectiveMotion.velocityPitch = perspectiveMotion.velocityPitch * 0.3 + nextVelocityPitch * 0.7;
            } else {
                perspectiveMotion.velocityBearing = 0;
                perspectiveMotion.velocityPitch = 0;
            }
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.rawBearing = input.bearing;
            perspectiveMotion.rawPitch = input.pitch;
        } else if (!perspectiveMotion.pointerActive) {
            perspectiveMotion.releasedNeedsSample = false;
            if (Math.abs(perspectiveMotion.velocityBearing) > PERSPECTIVE_VELOCITY_EPSILON) {
                const nextTargetBearing = clampFinite(
                    perspectiveMotion.targetBearing + perspectiveMotion.velocityBearing * dt,
                    PERSPECTIVE_MIN_BEARING,
                    PERSPECTIVE_MAX_BEARING
                );
                if (nextTargetBearing === PERSPECTIVE_MIN_BEARING || nextTargetBearing === PERSPECTIVE_MAX_BEARING) {
                    perspectiveMotion.velocityBearing = 0;
                }
                perspectiveMotion.targetBearing = nextTargetBearing;
            }

            if (Math.abs(perspectiveMotion.velocityPitch) > PERSPECTIVE_VELOCITY_EPSILON) {
                const nextTargetPitch = clampFinite(
                    perspectiveMotion.targetPitch + perspectiveMotion.velocityPitch * dt,
                    PERSPECTIVE_MIN_PITCH,
                    PERSPECTIVE_MAX_PITCH
                );
                if (nextTargetPitch === PERSPECTIVE_MIN_PITCH || nextTargetPitch === PERSPECTIVE_MAX_PITCH) {
                    perspectiveMotion.velocityPitch = 0;
                }
                perspectiveMotion.targetPitch = nextTargetPitch;
            }
        }

        const decay = Math.pow(PERSPECTIVE_INERTIA_DECAY, dt * 60);
        perspectiveMotion.velocityBearing *= decay;
        perspectiveMotion.velocityPitch *= decay;

        if (Math.abs(perspectiveMotion.velocityBearing) <= PERSPECTIVE_VELOCITY_EPSILON) {
            perspectiveMotion.velocityBearing = 0;
        }
        if (Math.abs(perspectiveMotion.velocityPitch) <= PERSPECTIVE_VELOCITY_EPSILON) {
            perspectiveMotion.velocityPitch = 0;
        }

        const alpha = easeOutCubic(1 - Math.exp(-PERSPECTIVE_RESPONSE * dt));
        const bearingDelta = perspectiveMotion.targetBearing - perspectiveMotion.currentBearing;
        const pitchDelta = perspectiveMotion.targetPitch - perspectiveMotion.currentPitch;
        perspectiveMotion.currentBearing += bearingDelta * alpha;
        perspectiveMotion.currentPitch += pitchDelta * alpha;

        const bearingSettled = Math.abs(perspectiveMotion.targetBearing - perspectiveMotion.currentBearing) <= PERSPECTIVE_EPSILON;
        const pitchSettled = Math.abs(perspectiveMotion.targetPitch - perspectiveMotion.currentPitch) <= PERSPECTIVE_EPSILON;
        if (bearingSettled) perspectiveMotion.currentBearing = perspectiveMotion.targetBearing;
        if (pitchSettled) perspectiveMotion.currentPitch = perspectiveMotion.targetPitch;

        perspectiveMotion.lastFrameAt = now;
        return !bearingSettled ||
            !pitchSettled ||
            Math.abs(perspectiveMotion.velocityBearing) > 0 ||
            Math.abs(perspectiveMotion.velocityPitch) > 0;
    }

    function getOrbitOffset(options) {
        const {
            enabled,
            now,
            startedAt,
            phase,
            canvasWidth,
            canvasHeight,
            radiusRatio,
            minRadius,
            maxRadius,
            rampMs,
            angularSpeed,
            clamp
        } = options;

        if (!enabled) return getZeroOrbitOffset();

        const elapsed = Math.max(0, now - startedAt);
        const baseRadius = Math.min(canvasWidth, canvasHeight) * radiusRatio;
        const radius = clamp(baseRadius || minRadius, minRadius, maxRadius);
        const safeRampMs = Math.max(1, rampMs || 1);
        const ramp = clamp(elapsed / safeRampMs, 0, 1);
        const easedRamp = 1 - Math.pow(1 - ramp, 3);
        const rampCubed = ramp * ramp * ramp;
        const rampFourth = rampCubed * ramp;
        const easedElapsed = ramp < 1
            ? safeRampMs * (rampCubed - rampFourth * 0.5)
            : elapsed - safeRampMs * 0.5;
        const angle = phase + easedElapsed * angularSpeed;
        const phaseCos = Math.cos(angle);
        const phaseSin = Math.sin(angle);
        const verticalPhaseSin = Math.sin(angle * 0.7);

        return {
            x: phaseCos * radius * easedRamp,
            y: verticalPhaseSin * radius * 0.6 * easedRamp,
            phase: angle,
            phaseCos,
            phaseSin,
            verticalPhaseSin,
            ramp: easedRamp
        };
    }

    function createViewController(options) {
        const {
            getScale,
            setScale,
            getOffsetX,
            setOffsetX,
            getOffsetY,
            setOffsetY,
            getAnimationHandle,
            setAnimationHandle,
            requestDraw,
            minScale,
            maxScale,
            clamp,
            requestAnimationFrame: requestFrame,
            cancelAnimationFrame: cancelFrame,
            now
        } = options;

        function cancelViewAnimation() {
            const handle = getAnimationHandle();
            if (!handle) return;
            cancelFrame(handle);
            setAnimationHandle(null);
        }

        function setView(nextScale, nextOffsetX, nextOffsetY) {
            cancelViewAnimation();
            setScale(clamp(nextScale, minScale, maxScale));
            setOffsetX(nextOffsetX);
            setOffsetY(nextOffsetY);
        }

        function animateView(nextScale, nextOffsetX, nextOffsetY, duration) {
            cancelViewAnimation();

            const startScale = getScale();
            const startOffsetX = getOffsetX();
            const startOffsetY = getOffsetY();
            const startedAt = now();
            const safeDuration = Math.max(1, duration || 1);

            const step = frameNow => {
                const t = clamp((frameNow - startedAt) / safeDuration, 0, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                setScale(startScale + (nextScale - startScale) * eased);
                setOffsetX(startOffsetX + (nextOffsetX - startOffsetX) * eased);
                setOffsetY(startOffsetY + (nextOffsetY - startOffsetY) * eased);
                requestDraw();

                if (t < 1) {
                    setAnimationHandle(requestFrame(step));
                } else {
                    setAnimationHandle(null);
                }
            };

            setAnimationHandle(requestFrame(step));
        }

        return {
            setView,
            animateView,
            cancelViewAnimation
        };
    }

    function getEventPoint(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function screenToWorld(x, y, transform) {
        const orbit = transform.orbitOffset || getZeroOrbitOffset();
        const point = unprojectPerspectivePoint(x, y, transform);
        return {
            x: (point.x - transform.offsetX - orbit.x) / transform.scale,
            y: (point.y - transform.offsetY - orbit.y) / transform.scale
        };
    }

    function worldToScreen(x, y, transform) {
        const orbit = transform.orbitOffset || getZeroOrbitOffset();
        const point = {
            x: x * transform.scale + transform.offsetX + orbit.x,
            y: y * transform.scale + transform.offsetY + orbit.y
        };
        return projectPerspectivePoint(point.x, point.y, transform);
    }

    function getPerspectiveState(transform) {
        const input = getPerspectiveInput(transform);
        if (!input.enabled) {
            perspectiveMotion.enabled = false;
            perspectiveMotion.initialized = false;
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.velocityBearing = 0;
            perspectiveMotion.velocityPitch = 0;
            return {
                enabled: false,
                bearing: 0,
                pitch: 0,
                centerX: 0,
                centerY: 0,
                focalLength: 1
            };
        }

        if (!perspectiveMotion.initialized || !perspectiveMotion.enabled) {
            initializePerspectiveMotion(input, getNow());
        }

        const canvasWidth = Math.max(1, Number(transform.canvasWidth) || 1);
        const canvasHeight = Math.max(1, Number(transform.canvasHeight) || 1);
        const fullscreen = Boolean(transform?.perspective?.fullscreen);
        return {
            enabled: true,
            bearing: perspectiveMotion.currentBearing,
            pitch: perspectiveMotion.currentPitch,
            centerX: canvasWidth * 0.5,
            centerY: canvasHeight * 0.54,
            focalLength: Math.max(canvasWidth, canvasHeight) * (fullscreen ? 1.08 : 1.28)
        };
    }

    function projectPerspectivePoint(x, y, transform) {
        const perspective = getPerspectiveState(transform);
        if (!perspective.enabled) return { x, y, perspectiveScale: 1, depth: 0, depthNormalized: 0 };

        const relativeX = x - perspective.centerX;
        const relativeY = y - perspective.centerY;
        const sinBearing = Math.sin(perspective.bearing);
        const cosBearing = Math.cos(perspective.bearing);
        const sinPitch = Math.sin(perspective.pitch);
        const cosPitch = Math.cos(perspective.pitch);

        const planeX = relativeX * cosBearing - relativeY * sinBearing;
        const planeY = relativeX * sinBearing + relativeY * cosBearing;
        const depth = -planeY * sinPitch;
        const perspectiveScale = perspective.focalLength / Math.max(1, perspective.focalLength + depth);

        return {
            x: perspective.centerX + planeX * perspectiveScale,
            y: perspective.centerY + planeY * cosPitch * perspectiveScale,
            perspectiveScale,
            depth,
            depthNormalized: Math.max(-1, Math.min(1, depth / Math.max(1, perspective.focalLength * 0.82)))
        };
    }

    function unprojectPerspectivePoint(x, y, transform) {
        const perspective = getPerspectiveState(transform);
        if (!perspective.enabled) return { x, y };

        const screenX = x - perspective.centerX;
        const screenY = y - perspective.centerY;
        const sinBearing = Math.sin(perspective.bearing);
        const cosBearing = Math.cos(perspective.bearing);
        const sinPitch = Math.sin(perspective.pitch);
        const cosPitch = Math.cos(perspective.pitch);
        const focal = perspective.focalLength;

        const denominator = focal * cosPitch + screenY * sinPitch;
        if (Math.abs(denominator) < 0.0001) {
            return { x, y };
        }

        const planeY = (screenY * focal) / denominator;
        const unscale = (focal - planeY * sinPitch) / focal;
        const planeX = screenX * unscale;
        const relativeX = planeX * cosBearing + planeY * sinBearing;
        const relativeY = -planeX * sinBearing + planeY * cosBearing;
        return {
            x: perspective.centerX + relativeX,
            y: perspective.centerY + relativeY
        };
    }

    function getBoundsForNodes(nodes, getNodeLayoutPosition) {
        return nodes.reduce((acc, node) => {
            const position = getNodeLayoutPosition(node);
            return {
                minX: Math.min(acc.minX, position.x - node.radius),
                maxX: Math.max(acc.maxX, position.x + node.radius),
                minY: Math.min(acc.minY, position.y - node.radius),
                maxY: Math.max(acc.maxY, position.y + node.radius)
            };
        }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    }

    function getPaddedWorkspaceBounds(bounds, options = {}) {
        const normalized = normalizeBounds(bounds);
        const canvasWidth = Math.max(1, Number(options.canvasWidth) || normalized.width || 1);
        const canvasHeight = Math.max(1, Number(options.canvasHeight) || normalized.height || 1);
        const paddingScaleX = Number.isFinite(options.paddingScaleX) ? options.paddingScaleX : 2.25;
        const paddingScaleY = Number.isFinite(options.paddingScaleY) ? options.paddingScaleY : 2.25;
        const paddingX = Math.max(Number(options.minPaddingX) || 0, canvasWidth * paddingScaleX);
        const paddingY = Math.max(Number(options.minPaddingY) || 0, canvasHeight * paddingScaleY);

        return {
            minX: normalized.minX - paddingX,
            maxX: normalized.maxX + paddingX,
            minY: normalized.minY - paddingY,
            maxY: normalized.maxY + paddingY,
            width: normalized.width + paddingX * 2,
            height: normalized.height + paddingY * 2,
            paddingX,
            paddingY
        };
    }

    function clampPointToBounds(point, bounds, options = {}) {
        const normalized = normalizeBounds(bounds);
        const margin = Math.max(0, Number(options.margin) || 0);
        const clamp = options.clamp || clampFinite;
        return {
            x: clamp(point.x, normalized.minX + margin, normalized.maxX - margin),
            y: clamp(point.y, normalized.minY + margin, normalized.maxY - margin)
        };
    }

    function clampViewToWorkspace(view, bounds, options = {}) {
        const normalized = normalizeBounds(bounds);
        const clamp = options.clamp || clampFinite;
        const scale = Math.max(0.001, Number(view.scale) || 1);
        const canvasWidth = Math.max(1, Number(options.canvasWidth) || 1);
        const canvasHeight = Math.max(1, Number(options.canvasHeight) || 1);
        const slackScale = Number.isFinite(options.slackScale) ? options.slackScale : 0.25;
        const slackX = Math.max(Number(options.minSlackX) || 0, canvasWidth * slackScale);
        const slackY = Math.max(Number(options.minSlackY) || 0, canvasHeight * slackScale);
        const minOffsetX = canvasWidth - normalized.maxX * scale - slackX;
        const maxOffsetX = -normalized.minX * scale + slackX;
        const minOffsetY = canvasHeight - normalized.maxY * scale - slackY;
        const maxOffsetY = -normalized.minY * scale + slackY;

        return {
            scale,
            offsetX: minOffsetX <= maxOffsetX
                ? clamp(view.offsetX, minOffsetX, maxOffsetX)
                : (minOffsetX + maxOffsetX) / 2,
            offsetY: minOffsetY <= maxOffsetY
                ? clamp(view.offsetY, minOffsetY, maxOffsetY)
                : (minOffsetY + maxOffsetY) / 2
        };
    }

    function normalizeBounds(bounds = {}) {
        const width = Math.max(1, Number(bounds.width) || Math.abs((Number(bounds.maxX) || 0) - (Number(bounds.minX) || 0)) || 1);
        const height = Math.max(1, Number(bounds.height) || Math.abs((Number(bounds.maxY) || 0) - (Number(bounds.minY) || 0)) || 1);
        const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
        const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
        const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : minX + width;
        const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : minY + height;

        return {
            minX,
            maxX,
            minY,
            maxY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY)
        };
    }

    function getFitView(bounds, options) {
        const {
            canvasWidth,
            canvasHeight,
            padding,
            minScale,
            maxScale,
            clamp
        } = options;
        const width = Math.max(1, bounds.maxX - bounds.minX);
        const height = Math.max(1, bounds.maxY - bounds.minY);
        const nextScale = clamp(Math.min(
            (canvasWidth - padding * 2) / width,
            (canvasHeight - padding * 2) / height
        ), minScale, maxScale);

        return {
            scale: nextScale,
            offsetX: canvasWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * nextScale,
            offsetY: canvasHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * nextScale
        };
    }

    function getScreenNodeRadius(node, scale) {
        return Math.max(3.5, node.radius * Math.sqrt(scale));
    }

    function isNodeInFrame(node, options) {
        const radius = node._screenRadius || getScreenNodeRadius(node, options.scale);
        return node._screenX >= -options.frameMargin - radius &&
            node._screenX <= options.canvasWidth + options.frameMargin + radius &&
            node._screenY >= -options.frameMargin - radius &&
            node._screenY <= options.canvasHeight + options.frameMargin + radius;
    }

    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    window.StockPhotonicGraph.viewport = {
        createViewController,
        getOrbitOffset,
        getEventPoint,
        screenToWorld,
        worldToScreen,
        projectPerspectivePoint,
        unprojectPerspectivePoint,
        getBoundsForNodes,
        getPaddedWorkspaceBounds,
        clampPointToBounds,
        clampViewToWorkspace,
        getFitView,
        getScreenNodeRadius,
        isNodeInFrame,
        stepPerspectiveMotion,
        getPerspectiveMotionSnapshot,
        setPerspectivePointerActive,
        releasePerspectivePointer,
        cancelPerspectiveMotion
    };
})();
