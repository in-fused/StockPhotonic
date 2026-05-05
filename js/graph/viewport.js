(function () {
    const PERSPECTIVE_MIN_YAW = -0.92;
    const PERSPECTIVE_MAX_YAW = 0.92;
    const PERSPECTIVE_MIN_PITCH = -0.2;
    const PERSPECTIVE_MAX_PITCH = 0.68;
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
        currentYaw: 0,
        currentPitch: 0,
        targetYaw: 0,
        targetPitch: 0,
        rawYaw: 0,
        rawPitch: 0,
        velocityYaw: 0,
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
        return {
            enabled,
            yaw: enabled ? clampFinite(perspective.yaw, PERSPECTIVE_MIN_YAW, PERSPECTIVE_MAX_YAW) : 0,
            pitch: enabled ? clampFinite(perspective.pitch, PERSPECTIVE_MIN_PITCH, PERSPECTIVE_MAX_PITCH) : 0
        };
    }

    function initializePerspectiveMotion(input, now) {
        perspectiveMotion.enabled = input.enabled;
        perspectiveMotion.initialized = input.enabled;
        perspectiveMotion.currentYaw = input.yaw;
        perspectiveMotion.currentPitch = input.pitch;
        perspectiveMotion.targetYaw = input.yaw;
        perspectiveMotion.targetPitch = input.pitch;
        perspectiveMotion.rawYaw = input.yaw;
        perspectiveMotion.rawPitch = input.pitch;
        perspectiveMotion.velocityYaw = 0;
        perspectiveMotion.velocityPitch = 0;
        perspectiveMotion.lastFrameAt = now;
    }

    function setPerspectivePointerActive(active) {
        perspectiveMotion.pointerActive = Boolean(active);
        if (active) {
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.velocityYaw = 0;
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
        perspectiveMotion.velocityYaw = 0;
        perspectiveMotion.velocityPitch = 0;
        perspectiveMotion.targetYaw = perspectiveMotion.currentYaw;
        perspectiveMotion.targetPitch = perspectiveMotion.currentPitch;
    }

    function stepPerspectiveMotion(transform, now = getNow()) {
        const input = getPerspectiveInput(transform);
        if (!input.enabled) {
            perspectiveMotion.enabled = false;
            perspectiveMotion.initialized = false;
            perspectiveMotion.pointerActive = false;
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.velocityYaw = 0;
            perspectiveMotion.velocityPitch = 0;
            return false;
        }

        if (!perspectiveMotion.initialized || !perspectiveMotion.enabled) {
            initializePerspectiveMotion(input, now);
            return false;
        }

        const elapsed = Math.max(0, now - perspectiveMotion.lastFrameAt);
        const dt = Math.min(PERSPECTIVE_MAX_DT, elapsed / 1000 || 1 / 60);
        const rawDeltaYaw = input.yaw - perspectiveMotion.rawYaw;
        const rawDeltaPitch = input.pitch - perspectiveMotion.rawPitch;
        const rawChanged = Math.abs(rawDeltaYaw) > PERSPECTIVE_EPSILON || Math.abs(rawDeltaPitch) > PERSPECTIVE_EPSILON;

        if (rawChanged) {
            perspectiveMotion.targetYaw = input.yaw;
            perspectiveMotion.targetPitch = input.pitch;
            if ((perspectiveMotion.pointerActive || perspectiveMotion.releasedNeedsSample) && dt > 0) {
                const nextVelocityYaw = rawDeltaYaw / dt;
                const nextVelocityPitch = rawDeltaPitch / dt;
                perspectiveMotion.velocityYaw = perspectiveMotion.velocityYaw * 0.3 + nextVelocityYaw * 0.7;
                perspectiveMotion.velocityPitch = perspectiveMotion.velocityPitch * 0.3 + nextVelocityPitch * 0.7;
            } else {
                perspectiveMotion.velocityYaw = 0;
                perspectiveMotion.velocityPitch = 0;
            }
            perspectiveMotion.releasedNeedsSample = false;
            perspectiveMotion.rawYaw = input.yaw;
            perspectiveMotion.rawPitch = input.pitch;
        } else if (!perspectiveMotion.pointerActive) {
            perspectiveMotion.releasedNeedsSample = false;
            if (Math.abs(perspectiveMotion.velocityYaw) > PERSPECTIVE_VELOCITY_EPSILON) {
                const nextTargetYaw = clampFinite(
                    perspectiveMotion.targetYaw + perspectiveMotion.velocityYaw * dt,
                    PERSPECTIVE_MIN_YAW,
                    PERSPECTIVE_MAX_YAW
                );
                if (nextTargetYaw === PERSPECTIVE_MIN_YAW || nextTargetYaw === PERSPECTIVE_MAX_YAW) {
                    perspectiveMotion.velocityYaw = 0;
                }
                perspectiveMotion.targetYaw = nextTargetYaw;
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
        perspectiveMotion.velocityYaw *= decay;
        perspectiveMotion.velocityPitch *= decay;

        if (Math.abs(perspectiveMotion.velocityYaw) <= PERSPECTIVE_VELOCITY_EPSILON) {
            perspectiveMotion.velocityYaw = 0;
        }
        if (Math.abs(perspectiveMotion.velocityPitch) <= PERSPECTIVE_VELOCITY_EPSILON) {
            perspectiveMotion.velocityPitch = 0;
        }

        const alpha = easeOutCubic(1 - Math.exp(-PERSPECTIVE_RESPONSE * dt));
        const yawDelta = perspectiveMotion.targetYaw - perspectiveMotion.currentYaw;
        const pitchDelta = perspectiveMotion.targetPitch - perspectiveMotion.currentPitch;
        perspectiveMotion.currentYaw += yawDelta * alpha;
        perspectiveMotion.currentPitch += pitchDelta * alpha;

        const yawSettled = Math.abs(perspectiveMotion.targetYaw - perspectiveMotion.currentYaw) <= PERSPECTIVE_EPSILON;
        const pitchSettled = Math.abs(perspectiveMotion.targetPitch - perspectiveMotion.currentPitch) <= PERSPECTIVE_EPSILON;
        if (yawSettled) perspectiveMotion.currentYaw = perspectiveMotion.targetYaw;
        if (pitchSettled) perspectiveMotion.currentPitch = perspectiveMotion.targetPitch;

        perspectiveMotion.lastFrameAt = now;
        return !yawSettled ||
            !pitchSettled ||
            Math.abs(perspectiveMotion.velocityYaw) > 0 ||
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
            perspectiveMotion.velocityYaw = 0;
            perspectiveMotion.velocityPitch = 0;
            return {
                enabled: false,
                yaw: 0,
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
        return {
            enabled: true,
            yaw: perspectiveMotion.currentYaw,
            pitch: perspectiveMotion.currentPitch,
            centerX: canvasWidth * 0.5,
            centerY: canvasHeight * 0.5,
            focalLength: Math.max(canvasWidth, canvasHeight) * 1.8
        };
    }

    function projectPerspectivePoint(x, y, transform) {
        const perspective = getPerspectiveState(transform);
        if (!perspective.enabled) return { x, y, perspectiveScale: 1, depth: 0, depthNormalized: 0 };

        const relativeX = x - perspective.centerX;
        const relativeY = y - perspective.centerY;
        const sinYaw = Math.sin(perspective.yaw);
        const cosYaw = Math.cos(perspective.yaw);
        const sinPitch = Math.sin(perspective.pitch);
        const cosPitch = Math.cos(perspective.pitch);

        const rotatedX = relativeX * cosYaw;
        const yawDepth = -relativeX * sinYaw;
        const rotatedY = relativeY * cosPitch - yawDepth * sinPitch;
        const depth = relativeY * sinPitch + yawDepth * cosPitch;
        const perspectiveScale = perspective.focalLength / Math.max(1, perspective.focalLength + depth);

        return {
            x: perspective.centerX + rotatedX * perspectiveScale,
            y: perspective.centerY + rotatedY * perspectiveScale,
            perspectiveScale,
            depth,
            depthNormalized: Math.max(-1, Math.min(1, depth / perspective.focalLength))
        };
    }

    function unprojectPerspectivePoint(x, y, transform) {
        const perspective = getPerspectiveState(transform);
        if (!perspective.enabled) return { x, y };

        const screenX = x - perspective.centerX;
        const screenY = y - perspective.centerY;
        const sinYaw = Math.sin(perspective.yaw);
        const cosYaw = Math.cos(perspective.yaw);
        const sinPitch = Math.sin(perspective.pitch);
        const cosPitch = Math.cos(perspective.pitch);
        const focal = perspective.focalLength;
        const depthFromX = -sinYaw * cosPitch;
        const depthFromY = sinPitch;
        const yFromX = sinYaw * sinPitch;

        const a11 = screenX * depthFromX - focal * cosYaw;
        const a12 = screenX * depthFromY;
        const b1 = -screenX * focal;
        const a21 = screenY * depthFromX - focal * yFromX;
        const a22 = screenY * depthFromY - focal * cosPitch;
        const b2 = -screenY * focal;
        const determinant = a11 * a22 - a12 * a21;

        if (Math.abs(determinant) < 0.0001) {
            return { x, y };
        }

        const relativeX = (b1 * a22 - a12 * b2) / determinant;
        const relativeY = (a11 * b2 - b1 * a21) / determinant;
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
        getFitView,
        getScreenNodeRadius,
        isNodeInFrame,
        stepPerspectiveMotion,
        setPerspectivePointerActive,
        releasePerspectivePointer,
        cancelPerspectiveMotion
    };
})();
