(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    function buildStockMinimapModel(options = {}) {
        const width = Math.max(1, Number(options.width) || 1);
        const height = Math.max(1, Number(options.height) || 1);
        const bounds = normalizeBounds(options.bounds);
        const pad = Math.max(18, Number(options.padding) || 34);
        const innerWidth = Math.max(1, width - pad);
        const innerHeight = Math.max(1, height - pad);
        const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
        const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
        const scale = Math.max(0.0001, Math.min(innerWidth / worldWidth, innerHeight / worldHeight));
        const offsetX = (width - worldWidth * scale) / 2;
        const offsetY = (height - worldHeight * scale) / 2;
        const mapX = x => (x - bounds.minX) * scale + offsetX;
        const mapY = y => (y - bounds.minY) * scale + offsetY;
        const worldX = x => ((x - offsetX) / scale) + bounds.minX;
        const worldY = y => ((y - offsetY) / scale) + bounds.minY;
        const viewport = options.viewportWorldRect || null;

        return {
            width,
            height,
            bounds,
            scale,
            offsetX,
            offsetY,
            mapX,
            mapY,
            worldX,
            worldY,
            viewportRect: viewport ? {
                x: Math.min(mapX(viewport.left), mapX(viewport.right)),
                y: Math.min(mapY(viewport.top), mapY(viewport.bottom)),
                width: Math.abs(mapX(viewport.right) - mapX(viewport.left)),
                height: Math.abs(mapY(viewport.bottom) - mapY(viewport.top))
            } : null
        };
    }

    function drawStockMinimap(ctx, model, options = {}) {
        if (!model || model.width < 24 || model.height < 24) {
            ctx.clearRect(0, 0, Math.max(1, model?.width || 1), Math.max(1, model?.height || 1));
            return;
        }
        const nodes = Array.isArray(options.nodes) ? options.nodes : [];
        const links = Array.isArray(options.links) ? options.links : [];
        const routeLinkKeys = options.routeLinkKeys || new Set();
        const routeComparison = options.routeComparison || null;
        const selectedNodeIds = options.selectedNodeIds || new Set();
        const semantic = options.semanticZoom || {};
        const getNodeLayoutPosition = options.getNodeLayoutPosition || (node => node || { x: 0, y: 0 });
        const edgeLimit = getEdgeLimit(semantic, links.length);

        ctx.clearRect(0, 0, model.width, model.height);
        ctx.fillStyle = 'rgba(3, 7, 18, 0.76)';
        ctx.fillRect(0, 0, model.width, model.height);

        drawMinimapGrid(ctx, model);
        drawMinimapCorridors(ctx, model, links, {
            edgeLimit,
            routeLinkKeys,
            getNodeLayoutPosition,
            getLinkSpatialMeta: options.getLinkSpatialMeta,
            semantic
        });
        drawMinimapEdges(ctx, model, links, {
            edgeLimit,
            routeLinkKeys,
            routeComparison,
            getNodeLayoutPosition,
            semantic
        });
        drawMinimapNodes(ctx, model, nodes, {
            selectedNodeIds,
            getNodeLayoutPosition,
            semantic
        });
        drawViewport(ctx, model);
        drawTierChip(ctx, model, semantic);
    }

    function drawMinimapGrid(ctx, model) {
        ctx.save();
        ctx.globalAlpha = 0.24;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 0.5;
        const step = Math.max(28, model.width / 4);
        for (let x = step; x < model.width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, model.height);
            ctx.stroke();
        }
        for (let y = step; y < model.height; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(model.width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawMinimapCorridors(ctx, model, links, options) {
        if (!options.getLinkSpatialMeta || options.semantic?.tier === 'inspection') return;
        const buckets = new Map();
        links.forEach(link => {
            if (options.routeLinkKeys.has(link.key)) return;
            const spatial = options.getLinkSpatialMeta(link) || {};
            const key = spatial.primaryCorridorKey || spatial.corridorKeys?.[0] || '';
            if (!key) return;
            const bucket = buckets.get(key) || { key, links: [], strength: 0 };
            bucket.links.push(link);
            bucket.strength += Number(link.strength) || 0;
            buckets.set(key, bucket);
        });
        const top = [...buckets.values()]
            .filter(bucket => bucket.links.length >= 2)
            .sort((a, b) => b.links.length - a.links.length || b.strength - a.strength)
            .slice(0, options.semantic?.tier === 'macro' ? 4 : 3);
        if (!top.length) return;

        ctx.save();
        ctx.lineCap = 'round';
        top.forEach((bucket, index) => {
            const meta = window.StockPhotonicGraph?.cinematic?.getCorridorMeta?.(bucket.key) || {};
            ctx.globalAlpha = options.semantic?.tier === 'macro' ? 0.18 : 0.14;
            ctx.strokeStyle = meta.color || 'rgba(103, 232, 249, 0.42)';
            ctx.lineWidth = Math.max(1.2, 2.8 - index * 0.35);
            bucket.links
                .slice(0, Math.min(bucket.links.length, options.edgeLimit))
                .forEach(link => drawSimpleEdge(ctx, model, link, options.getNodeLayoutPosition));
        });
        ctx.restore();
    }

    function drawMinimapEdges(ctx, model, links, options) {
        const normalLinks = links
            .filter(link => !options.routeLinkKeys.has(link.key))
            .slice(0, options.edgeLimit);
        const routeLinks = links.filter(link => options.routeLinkKeys.has(link.key));

        ctx.save();
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = options.semantic?.tier === 'macro'
            ? 'rgba(125, 211, 252, 0.12)'
            : 'rgba(125, 211, 252, 0.18)';
        normalLinks.forEach(link => drawSimpleEdge(ctx, model, link, options.getNodeLayoutPosition));
        ctx.lineWidth = 1.15;
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        routeLinks.forEach(link => {
            const membership = options.routeComparison?.linkMembership?.get(link.key);
            ctx.strokeStyle = membership?.routes?.length > 1
                ? 'rgba(255, 255, 255, 0.9)'
                : membership?.routes?.[0]?.color || 'rgba(255, 255, 255, 0.78)';
            ctx.lineWidth = membership?.routes?.length > 1 ? 1.55 : 1.15;
            drawSimpleEdge(ctx, model, link, options.getNodeLayoutPosition);
        });
        ctx.restore();
    }

    function drawSimpleEdge(ctx, model, link, getNodeLayoutPosition) {
        if (!link?.source || !link?.target) return;
        const source = getNodeLayoutPosition(link.source);
        const target = getNodeLayoutPosition(link.target);
        ctx.beginPath();
        ctx.moveTo(model.mapX(source.x), model.mapY(source.y));
        ctx.lineTo(model.mapX(target.x), model.mapY(target.y));
        ctx.stroke();
    }

    function drawMinimapNodes(ctx, model, nodes, options) {
        ctx.save();
        nodes.forEach(node => {
            const position = options.getNodeLayoutPosition(node);
            const selected = options.selectedNodeIds.has(node.id);
            const hub = (Number(node.degree) || 0) >= 8 || selected;
            ctx.globalAlpha = selected ? 1 : options.semantic?.tier === 'macro' && !hub ? 0.36 : 0.62;
            ctx.fillStyle = selected ? '#ffffff' : node.color || '#67e8f9';
            ctx.beginPath();
            ctx.arc(model.mapX(position.x), model.mapY(position.y), selected ? 2.9 : hub ? 1.9 : 1.35, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function drawViewport(ctx, model) {
        if (!model.viewportRect) return;
        const rect = model.viewportRect;
        ctx.save();
        ctx.globalAlpha = 0.94;
        ctx.strokeStyle = 'rgba(236, 254, 255, 0.84)';
        ctx.lineWidth = 1.1;
        roundedRect(ctx, rect.x, rect.y, Math.max(8, rect.width), Math.max(8, rect.height), 4);
        ctx.stroke();
        ctx.globalAlpha = 0.09;
        ctx.fillStyle = 'rgba(236, 254, 255, 0.72)';
        ctx.fill();
        ctx.restore();
    }

    function drawTierChip(ctx, model, semantic = {}) {
        const label = semantic.tierLabel || '';
        if (!label) return;
        ctx.save();
        ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        const availableWidth = model.width - 12;
        if (availableWidth < 16) {
            ctx.restore();
            return;
        }
        const width = Math.max(16, Math.min(availableWidth, ctx.measureText(label).width + 12));
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        roundedRect(ctx, 6, 6, width, 15, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.82)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 6 + width / 2, 13.5, Math.max(1, width - 6));
        ctx.restore();
    }

    function getEdgeLimit(semantic = {}, edgeCount) {
        if (semantic.tier === 'macro') return Math.min(edgeCount, 180);
        if (semantic.tier === 'cluster') return Math.min(edgeCount, 260);
        if (semantic.tier === 'relationship') return Math.min(edgeCount, 360);
        return Math.min(edgeCount, 520);
    }

    function normalizeBounds(bounds = {}) {
        const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
        const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
        const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : minX + Math.max(1, Number(bounds.width) || 1);
        const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : minY + Math.max(1, Number(bounds.height) || 1);
        return {
            minX,
            maxX,
            minY,
            maxY
        };
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const safeWidth = Math.max(0, Number(width) || 0);
        const safeHeight = Math.max(0, Number(height) || 0);
        if (!safeWidth || !safeHeight) {
            ctx.beginPath();
            return;
        }
        const r = Math.max(0, Math.min(Number(radius) || 0, safeWidth / 2, safeHeight / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + safeWidth, y, x + safeWidth, y + safeHeight, r);
        ctx.arcTo(x + safeWidth, y + safeHeight, x, y + safeHeight, r);
        ctx.arcTo(x, y + safeHeight, x, y, r);
        ctx.arcTo(x, y, x + safeWidth, y, r);
        ctx.closePath();
    }

    window.StockPhotonicGraph.minimap = {
        buildStockMinimapModel,
        drawStockMinimap
    };
})();
