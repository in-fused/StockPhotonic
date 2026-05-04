(function () {
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
        const perspective = transform?.perspective;
        if (!perspective?.enabled) {
            return {
                enabled: false,
                yaw: 0,
                pitch: 0,
                centerX: 0,
                centerY: 0,
                focalLength: 1
            };
        }

        const canvasWidth = Math.max(1, Number(transform.canvasWidth) || 1);
        const canvasHeight = Math.max(1, Number(transform.canvasHeight) || 1);
        return {
            enabled: true,
            yaw: Number.isFinite(perspective.yaw) ? perspective.yaw : 0,
            pitch: Number.isFinite(perspective.pitch) ? perspective.pitch : 0,
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
        isNodeInFrame
    };
})();
