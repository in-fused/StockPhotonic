(function () {
    function bindCanvasInteractions(options) {
        const {
            canvas,
            windowTarget,
            onResize,
            onWheel,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel,
            onPointerLeave
        } = options;

        windowTarget.addEventListener('resize', onResize);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('pointerdown', event => {
            if (isPrimaryGraphPointer(event)) {
                getPerspectiveMotionController()?.setPerspectivePointerActive?.(true);
            }
            onPointerDown(event);
        });
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', event => {
            onPointerUp(event);
            if (isPrimaryGraphPointer(event)) {
                getPerspectiveMotionController()?.releasePerspectivePointer?.();
            }
        });
        canvas.addEventListener('pointercancel', event => {
            onPointerCancel(event);
            getPerspectiveMotionController()?.cancelPerspectiveMotion?.();
        });
        canvas.addEventListener('lostpointercapture', event => {
            onPointerCancel(event);
            getPerspectiveMotionController()?.cancelPerspectiveMotion?.();
        });
        canvas.addEventListener('pointerleave', onPointerLeave);
        canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    function getPerspectiveMotionController() {
        return window.StockPhotonicGraph?.viewport || null;
    }

    function isPrimaryGraphPointer(event) {
        return event.pointerType !== 'mouse' || event.button === 0 || event.button === 1;
    }

    function normalizeWheelDelta(event, options) {
        let delta = Number(event.deltaY) || 0;
        if (event.deltaMode === 1) delta *= 16;
        if (event.deltaMode === 2) delta *= Math.max(options.canvasHeight, 1);
        return options.clamp(delta, -options.limit, options.limit);
    }

    function findNodeAt(screenX, screenY, options) {
        let closest = null;
        let closestDistance = Infinity;

        options.visibleNodes.forEach(node => {
            const position = options.getNodeLayoutPosition(node);
            const fallback = options.worldToScreen(position.x, position.y);
            const point = {
                x: Number.isFinite(node._screenX) ? node._screenX : fallback.x,
                y: Number.isFinite(node._screenY) ? node._screenY : fallback.y
            };
            const cachedRadius = Number.isFinite(node._screenRadius) ? node._screenRadius : options.getScreenNodeRadius(node);
            const compact = (options.canvasWidth || window.innerWidth || 0) < 680;
            const focusBoost = Math.min(8, Number(node._focusDisplacement || 0) * 0.18);
            const hitRadius = Math.max(compact ? 22 : 16, cachedRadius + (compact ? 15 : 10) + focusBoost);
            const distance = Math.hypot(point.x - screenX, point.y - screenY);
            if (distance <= hitRadius && distance < closestDistance) {
                closest = node;
                closestDistance = distance;
            }
        });

        return closest;
    }

    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    window.StockPhotonicGraph.interactions = {
        bindCanvasInteractions,
        normalizeWheelDelta,
        findNodeAt,
        getPerspectiveMotionController,
        isPrimaryGraphPointer
    };
})();
