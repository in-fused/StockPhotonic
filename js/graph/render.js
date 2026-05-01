(function () {
    function resizeCanvas(context) {
        const canvas = context.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(2, context.devicePixelRatio() || 1));
        const canvasWidth = Math.max(1, rect.width);
        const canvasHeight = Math.max(1, rect.height);

        context.setDpr(dpr);
        context.setCanvasWidth(canvasWidth);
        context.setCanvasHeight(canvasHeight);
        canvas.width = Math.floor(canvasWidth * dpr);
        canvas.height = Math.floor(canvasHeight * dpr);
        context.requestDraw();
    }

    function requestDraw(context) {
        if (context.getDrawHandle()) return;
        context.setDrawHandle(context.requestAnimationFrame(context.drawGraph));
    }

    function drawGraph(context, timestamp = 0) {
        context.setDrawHandle(null);
        const canvas = context.getCanvas();
        const now = context.now();
        const ctx = canvas.getContext('2d');
        context.setCurrentOrbitOffset(context.getOrbitOffset(now));
        ctx.setTransform(context.dpr, 0, 0, context.dpr, 0, 0);
        ctx.clearRect(0, 0, context.canvasWidth, context.canvasHeight);

        drawBackground(context, ctx);
        updateScreenCache(context);
        drawNexusQuadrantLabels(context, ctx);
        const frameNodes = context.visibleNodes.filter(node => isNodeInFrame(context, node));
        const frameLinks = context.visibleLinks.filter(link => shouldDrawLink(context, link));

        ctx.save();
        frameLinks.forEach(link => drawLink(context, ctx, link));
        ctx.restore();

        frameNodes.forEach(node => drawNode(context, ctx, node, timestamp));
        drawLabels(context, ctx, frameNodes);

        if (context.orbitEnabled || now < context.pulseUntil || now < context.highlightedNodeUntil || now < context.focusTransitionUntil) {
            requestDraw(context);
        }
    }

    function drawBackground(context, ctx) {
        const gradient = ctx.createRadialGradient(
            context.canvasWidth * 0.5,
            context.canvasHeight * 0.5,
            20,
            context.canvasWidth * 0.5,
            context.canvasHeight * 0.5,
            Math.max(context.canvasWidth, context.canvasHeight) * 0.78
        );
        gradient.addColorStop(0, 'rgba(0, 249, 255, 0.045)');
        gradient.addColorStop(0.55, 'rgba(255, 0, 170, 0.025)');
        gradient.addColorStop(1, 'rgba(5, 5, 8, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, context.canvasWidth, context.canvasHeight);
    }

    function drawNexusQuadrantLabels(context, ctx) {
        if (!context.isNexusLayoutActive() || !context.selectedNode) return;

        const summary = context.getNexusSummary(context.selectedNode);
        const labels = [
            { key: 'supply', x: -context.NEXUS_LABEL_DISTANCE, y: -context.NEXUS_AXIS_SPREAD * 0.42, align: 'center' },
            { key: 'partner', x: context.NEXUS_LABEL_DISTANCE, y: -context.NEXUS_AXIS_SPREAD * 0.42, align: 'center' },
            { key: 'competitive', x: 0, y: -context.NEXUS_LABEL_DISTANCE, align: 'center' },
            { key: 'capital', x: 0, y: context.NEXUS_LABEL_DISTANCE, align: 'center' }
        ];

        labels.forEach(label => {
            const group = summary.groups[label.key];
            if (!group || group.count <= 0) return;
            const point = context.worldToScreen(label.x, label.y);
            if (point.x < -120 || point.x > context.canvasWidth + 120 || point.y < -80 || point.y > context.canvasHeight + 80) return;

            const text = `${group.label} ${group.count}`;
            ctx.save();
            ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
            ctx.textAlign = label.align;
            ctx.textBaseline = 'middle';
            const width = ctx.measureText(text).width;
            const x = point.x - width / 2;
            const y = point.y - 12;
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = 'rgba(3, 7, 18, 0.56)';
            ctx.strokeStyle = 'rgba(103, 232, 249, 0.20)';
            ctx.lineWidth = 1;
            roundedRect(ctx, x - 9, y, width + 18, 24, 10);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(207, 250, 254, 0.72)';
            ctx.fillText(text, point.x, y + 12);
            ctx.restore();
        });
    }

    function drawLink(context, ctx, link) {
        const sourcePosition = context.getNodeLayoutPosition(link.source);
        const targetPosition = context.getNodeLayoutPosition(link.target);
        const sourceFallback = context.worldToScreen(sourcePosition.x, sourcePosition.y);
        const targetFallback = context.worldToScreen(targetPosition.x, targetPosition.y);
        const source = {
            x: link.source._screenX ?? sourceFallback.x,
            y: link.source._screenY ?? sourceFallback.y
        };
        const target = {
            x: link.target._screenX ?? targetFallback.x,
            y: link.target._screenY ?? targetFallback.y
        };
        const color = context.EDGE_COLORS[link.type] || context.DEFAULT_EDGE_COLOR;
        const isFocused = context.selectedNode && context.focusLinkKeys.has(link.key);
        const isHoveredLink = context.hoveredNode && (context.hoveredNode.id === link.source.id || context.hoveredNode.id === link.target.id);
        const hasFocus = Boolean(context.selectedNode);
        const industryFilterActive = context.isIndustryGroupFilterActive();
        const touchesIndustryGroup = industryFilterActive && context.linkTouchesCurrentIndustryGroup(link);
        const isPortfolioLink = context.isPortfolioAnalysisActive() && context.portfolioEdgeKeys.has(link.key);

        const strength = context.clamp(link.strength, 0.05, 1);
        const isStrongSignal = strength >= 0.78;
        let alpha = 0.01 + Math.pow(strength, 2.35) * 0.46;
        let width = 0.22 + Math.pow(strength, 1.55) * 2.9;

        if (hasFocus) {
            alpha = isFocused ? 0.74 + strength * 0.22 : 0.01;
            width = isFocused ? width + 1.25 : Math.max(0.25, width * 0.45);
        }

        if (touchesIndustryGroup && !isFocused) {
            alpha = Math.max(alpha, 0.12 + Math.pow(strength, 1.8) * 0.28);
            width = Math.max(width, 0.7 + strength * 1.2);
        }

        if (isHoveredLink) {
            alpha = Math.max(alpha, 0.58 + strength * 0.28);
            width += 0.9;
        }

        if (isStrongSignal && !hasFocus) {
            alpha = Math.max(alpha, 0.42 + strength * 0.18);
            width += 0.45;
        }

        if (isPortfolioLink) {
            alpha = Math.max(alpha, 0.68 + strength * 0.24);
            width = Math.max(width + 0.65, 1.35 + strength * 2.5);
        }

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = isPortfolioLink ? 28 : isFocused ? 24 : isHoveredLink ? 22 : isStrongSignal ? 16 : 3 + strength * 5;
        ctx.shadowColor = isPortfolioLink ? '#ffd700' : color;

        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const curve = link.curveOffset * context.scale;
        const controlX = midX + (-dy / distance) * curve;
        const controlY = midY + (dx / distance) * curve;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(controlX, controlY, target.x, target.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawNode(context, ctx, node, timestamp) {
        if (!node) return;
        const position = context.getNodeLayoutPosition(node);
        const fallback = context.worldToScreen(position.x, position.y);
        const point = { x: node._screenX ?? fallback.x, y: node._screenY ?? fallback.y };
        const radius = node._screenRadius ?? getScreenNodeRadius(context, node);
        const isSelected = context.selectedNode && context.selectedNode.id === node.id;
        const isNeighbor = context.focusNeighborIds.has(node.id);
        const isClusterNode = Boolean(context.selectedNode) && context.activeClusterNodeIds.has(node.id) && !isSelected;
        const isCorrelationHintNode = context.isIndustryCorrelationHintNode(node);
        const isHovered = context.hoveredNode && context.hoveredNode.id === node.id;
        const isSearchHighlighted = context.highlightedNodeId === node.id && context.now() < context.highlightedNodeUntil;
        const isPortfolioHolding = context.isPortfolioAnalysisActive() && context.isPortfolioNode(node);
        const isPortfolioAdjacent = context.isPortfolioAnalysisActive() && context.isPortfolioAdjacentNode(node);
        const isPortfolioTopNexus = context.isPortfolioAnalysisActive() && context.isPortfolioTopNexusNode(node);
        const isPortfolioRepeatedExposure = context.isPortfolioAnalysisActive() && context.isPortfolioRepeatedExposureNode(node);
        const industryDimmed = context.isNodeDimmedByIndustryGroup(node);
        const industryMatched = context.isIndustryGroupFilterActive() && context.nodeMatchesCurrentIndustryGroup(node);
        const focusDimmed = !context.isFocusModeActive() && context.selectedNode && !isSelected && !isNeighbor && !isClusterNode && !isCorrelationHintNode && !isPortfolioHolding && !isPortfolioAdjacent && !industryMatched;
        const isDimmed = focusDimmed || industryDimmed;
        const alpha = industryDimmed ? 0.16 : focusDimmed ? 0.18 : isPortfolioTopNexus ? 0.96 : isPortfolioRepeatedExposure ? 0.92 : isPortfolioAdjacent ? 0.84 : isCorrelationHintNode ? 0.78 : 1;
        const color = node.color || '#00f9ff';
        const portfolioHaloColor = isPortfolioHolding
            ? '#ffd700'
            : isPortfolioTopNexus
                ? '#f0abfc'
                : isPortfolioRepeatedExposure
                    ? '#34d399'
                    : isPortfolioAdjacent
                        ? '#a5f3fc'
                        : color;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = isSelected ? 34 : isPortfolioHolding ? 38 : isSearchHighlighted ? 42 : isHovered ? 22 : isPortfolioTopNexus ? 32 : isPortfolioRepeatedExposure ? 24 : isPortfolioAdjacent ? 18 : isClusterNode ? 18 : isCorrelationHintNode ? 16 : 12;
        ctx.shadowColor = isSelected ? '#ffffff' : portfolioHaloColor;

        const glow = ctx.createRadialGradient(point.x, point.y, 1, point.x, point.y, radius * 4.3);
        glow.addColorStop(0, `${context.hexToRgba(portfolioHaloColor, isPortfolioHolding ? 0.95 : isPortfolioTopNexus ? 0.92 : isPortfolioRepeatedExposure ? 0.86 : isClusterNode ? 0.9 : isCorrelationHintNode ? 0.86 : 0.82)}`);
        glow.addColorStop(0.38, `${context.hexToRgba(portfolioHaloColor, isPortfolioHolding ? 0.38 : isPortfolioTopNexus ? 0.34 : isPortfolioRepeatedExposure ? 0.26 : isClusterNode ? 0.32 : isCorrelationHintNode ? 0.3 : 0.24)}`);
        glow.addColorStop(1, `${context.hexToRgba(color, 0)}`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * (isPortfolioHolding ? 5.7 : isPortfolioTopNexus ? 5.35 : isPortfolioRepeatedExposure ? 4.85 : isClusterNode ? 5.1 : 4.3), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = isDimmed ? 0.28 : 0.86;
        ctx.beginPath();
        ctx.arc(point.x - radius * 0.28, point.y - radius * 0.28, Math.max(1.2, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();

        if (isSearchHighlighted) {
            const remaining = context.clamp((context.highlightedNodeUntil - context.now()) / context.SEARCH_HIGHLIGHT_MS, 0, 1);
            const sweep = 1 + (1 - remaining) * 0.48;
            ctx.globalAlpha = 0.72 * remaining;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.4;
            ctx.shadowBlur = 34;
            ctx.shadowColor = '#00f9ff';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * (2.45 + sweep), 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isPortfolioHolding) {
            ctx.globalAlpha = industryDimmed ? 0.28 : 0.9;
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2.3;
            ctx.shadowBlur = 26;
            ctx.shadowColor = '#ffd700';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 2.55, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = industryDimmed ? 0.14 : 0.32;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 3.35, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isPortfolioTopNexus) {
            ctx.globalAlpha = industryDimmed ? 0.18 : 0.68;
            ctx.strokeStyle = '#f0abfc';
            ctx.lineWidth = 1.8;
            ctx.shadowBlur = 22;
            ctx.shadowColor = '#f0abfc';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 2.35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = industryDimmed ? 0.12 : 0.28;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 3.05, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isPortfolioRepeatedExposure) {
            ctx.globalAlpha = industryDimmed ? 0.12 : 0.38;
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 1.2;
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#34d399';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 2.15, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isPortfolioAdjacent) {
            ctx.globalAlpha = industryDimmed ? 0.14 : 0.36;
            ctx.strokeStyle = '#a5f3fc';
            ctx.lineWidth = 1.1;
            ctx.shadowBlur = 16;
            ctx.shadowColor = '#00f9ff';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 1.9, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (isSelected || isHovered) {
            const pulse = context.now() < context.pulseUntil ? 1 + Math.sin(timestamp * 0.006) * 0.08 : 1;
            ctx.globalAlpha = isSelected ? 0.9 : 0.55;
            ctx.strokeStyle = isSelected ? '#ffffff' : color;
            ctx.lineWidth = isSelected ? 2.2 : 1.4;
            ctx.shadowBlur = isSelected ? 24 : 14;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 2.05 * pulse, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isNeighbor) {
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 1.65, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isClusterNode) {
            ctx.globalAlpha = 0.42;
            ctx.strokeStyle = '#a5f3fc';
            ctx.lineWidth = 1;
            ctx.shadowBlur = 18;
            ctx.shadowColor = '#00f9ff';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 1.9, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isCorrelationHintNode) {
            ctx.globalAlpha = 0.24;
            ctx.strokeStyle = '#f0abfc';
            ctx.lineWidth = 0.9;
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ff00aa';
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius * 1.55, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawLabels(context, ctx, frameNodes) {
        const labelMode = getLabelMode(context);
        if (labelMode === 'none') return;

        const labels = [];
        frameNodes.forEach(node => {
            if (!node || !shouldDrawLabel(context, node, labelMode)) return;
            labels.push(node);
        });

        labels
            .sort((a, b) => labelPriority(context, b) - labelPriority(context, a))
            .slice(0, getLabelLimit(context, labelMode))
            .forEach(node => {
                const position = context.getNodeLayoutPosition(node);
                const fallback = context.worldToScreen(position.x, position.y);
                const point = { x: node._screenX ?? fallback.x, y: node._screenY ?? fallback.y };
                const isSelected = context.selectedNode && context.selectedNode.id === node.id;
                const isNeighbor = context.focusNeighborIds.has(node.id);
                const isClusterNode = Boolean(context.selectedNode) && context.activeClusterNodeIds.has(node.id) && !isSelected;
                const isHovered = context.hoveredNode && context.hoveredNode.id === node.id;
                const radius = node._screenRadius ?? getScreenNodeRadius(context, node);
                const rawLabel = getLabelText(context, node, labelMode);
                if (!rawLabel) return;
                const isPortfolioHolding = context.isPortfolioAnalysisActive() && context.isPortfolioNode(node);
                const isPortfolioAdjacent = context.isPortfolioAnalysisActive() && context.isPortfolioAdjacentNode(node);
                const industryDimmed = context.isNodeDimmedByIndustryGroup(node);
                const industryMatched = context.isIndustryGroupFilterActive() && context.nodeMatchesCurrentIndustryGroup(node);
                const focusDimmed = !context.isFocusModeActive() && context.selectedNode && !isSelected && !isNeighbor && !isClusterNode && !isPortfolioHolding && !isPortfolioAdjacent && !industryMatched;
                const alpha = industryDimmed ? 0.18 : focusDimmed ? 0.25 : isPortfolioHolding ? 0.94 : isPortfolioAdjacent ? 0.82 : isClusterNode ? 0.86 : isNeighbor ? 0.82 : 0.72;

                ctx.save();
                const fontSize = labelMode === 'full' ? (isSelected ? 12 : 11) : (isSelected ? 12 : 10);
                ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
                const label = truncateLabel(ctx, rawLabel, labelMode === 'full' ? 220 : 82);
                const width = ctx.measureText(label).width;
                const x = point.x - width / 2;
                const y = point.y + radius + 14;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = 'rgba(3, 7, 18, 0.76)';
                ctx.strokeStyle = isPortfolioHolding ? 'rgba(255, 215, 0, 0.62)' : isSelected || isHovered || isClusterNode || isPortfolioAdjacent ? 'rgba(0, 249, 255, 0.58)' : 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 1;
                roundedRect(ctx, x - 5, y - 11, width + 10, 16, 6);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = isPortfolioHolding ? '#fff7ad' : isSelected ? '#ffffff' : node.color || '#dbeafe';
                ctx.globalAlpha = isSelected || isHovered ? 1 : alpha;
                ctx.fillText(label, x, y);
                ctx.restore();
            });
    }

    function getLabelMode(context) {
        if (context.scale < context.LABEL_TICKER_SCALE) return 'none';
        if (context.scale < context.LABEL_FULL_SCALE) return 'ticker';
        return 'full';
    }

    function getLabelText(context, node, labelMode) {
        if (labelMode === 'full') return node.name || node.ticker || '';
        return node.ticker || node.name || '';
    }

    function getLabelLimit(context, labelMode) {
        if (labelMode === 'full') return context.selectedNode ? 68 : 54;
        return context.selectedNode ? 52 : 36;
    }

    function shouldDrawLabel(context, node, labelMode) {
        if (labelMode === 'none') return false;
        if (context.selectedNode && context.selectedNode.id === node.id) return true;
        if (context.hoveredNode && context.hoveredNode.id === node.id) return true;
        if (context.isPortfolioAnalysisActive() && context.isPortfolioHighlightedNode(node)) return true;
        if (context.selectedNode && context.focusNeighborIds.has(node.id)) return true;
        if (context.selectedNode && context.activeClusterNodeIds.has(node.id) && !context.isFocusModeActive()) return true;
        if (labelMode === 'full') return true;
        if (context.scale > 0.68 && node.degree >= 2) return true;
        return context.topLabelIds.has(node.id) || node.degree >= 6;
    }

    function labelPriority(context, node) {
        if (context.selectedNode && context.selectedNode.id === node.id) return 1000;
        if (context.hoveredNode && context.hoveredNode.id === node.id) return 900;
        if (context.isPortfolioNode(node)) return 780 + node.degree;
        if (context.isPortfolioTopNexusNode(node)) return 720 + node.degree;
        if (context.isPortfolioRepeatedExposureNode(node)) return 670 + node.degree;
        if (context.isPortfolioAdjacentNode(node)) return 620 + node.degree;
        if (context.focusNeighborIds.has(node.id)) return 500 + node.degree;
        if (context.selectedNode && context.activeClusterNodeIds.has(node.id) && !context.isFocusModeActive()) return 360 + node.degree;
        return node.degree * 10 + Math.max(0, 320 - (node.rank || 320)) / 20;
    }

    function updateScreenCache(context) {
        context.visibleNodes.forEach(node => {
            const position = context.getNodeLayoutPosition(node);
            const point = context.worldToScreen(position.x, position.y);
            node._screenX = point.x;
            node._screenY = point.y;
            node._screenRadius = getScreenNodeRadius(context, node);
        });
    }

    function isNodeInFrame(context, node) {
        return context.graphViewport.isNodeInFrame(node, {
            canvasWidth: context.canvasWidth,
            canvasHeight: context.canvasHeight,
            frameMargin: context.FRAME_MARGIN,
            scale: context.scale
        });
    }

    function shouldDrawLink(context, link) {
        const isFocused = context.selectedNode && context.focusLinkKeys.has(link.key);
        const industryFilterActive = context.isIndustryGroupFilterActive();
        const touchesIndustryGroup = industryFilterActive && context.linkTouchesCurrentIndustryGroup(link);
        const isPortfolioLink = context.isPortfolioAnalysisActive() && context.portfolioEdgeKeys.has(link.key);
        if (context.signalStrengthThreshold <= 0 && !isFocused && !touchesIndustryGroup && !isPortfolioLink && link.strength < getWeakEdgeThreshold(context)) return false;

        const sourceX = link.source._screenX;
        const sourceY = link.source._screenY;
        const targetX = link.target._screenX;
        const targetY = link.target._screenY;
        const minX = Math.min(sourceX, targetX) - context.FRAME_MARGIN;
        const maxX = Math.max(sourceX, targetX) + context.FRAME_MARGIN;
        const minY = Math.min(sourceY, targetY) - context.FRAME_MARGIN;
        const maxY = Math.max(sourceY, targetY) + context.FRAME_MARGIN;
        return maxX >= 0 && minX <= context.canvasWidth && maxY >= 0 && minY <= context.canvasHeight;
    }

    function getWeakEdgeThreshold(context) {
        if (context.scale < 0.3) return 0.42;
        if (context.scale < 0.46) return 0.32;
        if (context.scale < 0.62) return 0.2;
        return 0;
    }

    function getScreenNodeRadius(context, node) {
        return context.graphViewport.getScreenNodeRadius(node, context.scale);
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function truncateLabel(ctx, text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        const ellipsis = '...';
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const candidate = text.slice(0, mid) + ellipsis;
            if (ctx.measureText(candidate).width <= maxWidth) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return text.slice(0, low).trimEnd() + ellipsis;
    }

    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    window.StockPhotonicGraph.render = {
        resizeCanvas,
        requestDraw,
        drawGraph,
        drawBackground,
        drawNexusQuadrantLabels,
        drawLink,
        drawNode,
        drawLabels,
        getLabelMode,
        getLabelText,
        getLabelLimit,
        shouldDrawLabel,
        labelPriority,
        updateScreenCache,
        isNodeInFrame,
        shouldDrawLink,
        getWeakEdgeThreshold,
        getScreenNodeRadius,
        roundedRect,
        truncateLabel
    };
})();
