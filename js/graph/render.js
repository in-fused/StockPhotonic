(function () {
    const ORBIT_DEPTH_SCALE = 0.09;
    const ORBIT_DEPTH_Y_OFFSET = 5.5;
    const ORBIT_PARALLAX_Y_OFFSET = 4.5;
    const ORBIT_MIN_DEPTH_MULTIPLIER = 0.9;
    const ORBIT_MAX_DEPTH_MULTIPLIER = 1.12;
    const ORBIT_MAX_PARALLAX_Y = 12;

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
        const perspectiveMotionActive = context.graphViewport?.stepPerspectiveMotion?.(
            context.getPerspectiveTransform?.(),
            now
        ) || false;
        context.onPerspectiveMotionFrame?.(
            context.graphViewport?.getPerspectiveMotionSnapshot?.(context.getPerspectiveTransform?.())
        );
        const ctx = canvas.getContext('2d');
        const orbit = context.getOrbitOffset(now);
        const orbitFrame = getOrbitRenderFrame(context, orbit);
        context.setCurrentOrbitOffset(orbit);
        ctx.setTransform(context.dpr, 0, 0, context.dpr, 0, 0);
        ctx.clearRect(0, 0, context.canvasWidth, context.canvasHeight);

        const density = getDensityProfile(context);
        const semantic = getSemanticState(context, density);
        const readability = getReadabilityState(context, density, semantic);
        context.onReadabilityState?.(readability);
        context.onSemanticZoomState?.(semantic);
        const topologyChoreography = getCinematicSystem(context)?.getTopologyChoreography?.(context, context.graphTopologyModel, {
            now,
            timestamp,
            density,
            semantic
        }) || null;
        drawBackground(context, ctx);
        getReadabilitySystem(context)?.drawSemanticFog?.(context, ctx, readability);
        getTopologySystem(context)?.drawTopologyField?.(context, ctx, context.graphTopologyModel, {
            now,
            timestamp,
            density,
            semantic,
            choreography: topologyChoreography
        });
        updateScreenCache(context, orbitFrame);
        const cinematicFrame = getCinematicSystem(context)?.prepareStockFrame?.(context, {
            now,
            timestamp,
            density,
            semantic
        }) || { active: false };
        drawNexusQuadrantLabels(context, ctx);
        const frameNodes = context.visibleNodes
            .filter(node => isNodeInFrame(context, node))
            .sort(sortByPerspectiveDepth);
        const frameLinks = prioritizeFrameLinks(
            context,
            context.visibleLinks.filter(link => shouldDrawLink(context, link)),
            density,
            semantic,
            readability
        ).sort(sortLinkByPerspectiveDepth);

        ctx.save();
        getCinematicSystem(context)?.drawStockCorridorLanes?.(context, ctx, frameLinks, {
            now,
            timestamp,
            density,
            semantic,
            profile: cinematicFrame.profile
        });
        getCinematicSystem(context)?.drawStockFocusBubble?.(context, ctx, cinematicFrame, timestamp);
        frameLinks.forEach(link => drawLink(context, ctx, link));
        ctx.restore();

        frameNodes.forEach(node => drawNode(context, ctx, node, timestamp));
        drawLabels(context, ctx, frameNodes);

        if (context.orbitEnabled || perspectiveMotionActive || cinematicFrame.active || now < context.pulseUntil || now < context.highlightedNodeUntil || now < context.focusTransitionUntil) {
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
        drawPerspectiveDepthCue(context, ctx);
    }

    function drawPerspectiveDepthCue(context, ctx) {
        if (!context.perspectiveEnabled || !context.graphViewport?.projectPerspectivePoint) return;

        const transform = context.getPerspectiveTransform?.();
        if (!transform?.enabled) return;

        const width = context.canvasWidth;
        const height = context.canvasHeight;
        const centerY = height * 0.54;
        const lineCount = 11;
        const halfWidth = width * 0.92;
        const topY = centerY - height * 0.42;
        const bottomY = centerY + height * 0.78;
        const projectionTransform = {
            perspective: transform,
            canvasWidth: width,
            canvasHeight: height
        };

        ctx.save();
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;

        for (let i = 0; i < lineCount; i++) {
            const t = i / Math.max(1, lineCount - 1);
            const y = topY + (bottomY - topY) * t * t;
            const alpha = 0.015 + t * 0.035;
            const left = context.graphViewport.projectPerspectivePoint(width * 0.5 - halfWidth, y, projectionTransform);
            const right = context.graphViewport.projectPerspectivePoint(width * 0.5 + halfWidth, y, projectionTransform);

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = 'rgba(125, 211, 252, 0.72)';
            ctx.beginPath();
            ctx.moveTo(left.x, left.y);
            ctx.lineTo(right.x, right.y);
            ctx.stroke();
        }

        for (let i = -3; i <= 3; i++) {
            const x = width * 0.5 + i * width * 0.18;
            const near = context.graphViewport.projectPerspectivePoint(x, bottomY, projectionTransform);
            const far = context.graphViewport.projectPerspectivePoint(x, topY, projectionTransform);

            ctx.globalAlpha = 0.018;
            ctx.strokeStyle = 'rgba(255, 0, 170, 0.62)';
            ctx.beginPath();
            ctx.moveTo(near.x, near.y);
            ctx.lineTo(far.x, far.y);
            ctx.stroke();
        }

        ctx.globalAlpha = 0.055;
        ctx.strokeStyle = 'rgba(0, 249, 255, 0.72)';
        ctx.beginPath();
        ctx.moveTo(width * 0.08, centerY);
        ctx.lineTo(width * 0.92, centerY);
        ctx.stroke();
        ctx.restore();
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
        const relationshipVisual = context.getRelationshipVisualMeta?.(link) || {};
        const intelligenceVisual = context.getGraphLinkIntelligenceVisual?.(link) || {};
        const density = getDensityProfile(context);
        const semantic = getSemanticState(context, density);
        const semanticEdge = getSemanticEdgeDisposition(context, link, semantic, intelligenceVisual);
        const readabilityEdge = getReadabilityEdgeAdjustment(context, link, intelligenceVisual, semantic);
        const topologyEdge = getTopologyLinkVisual(context, link);
        const overlayEdge = getOverlayLinkAdjustment(context, link, intelligenceVisual);
        if (!semanticEdge.draw || !readabilityEdge.draw) return;
        if (!overlayEdge.draw) return;
        let color = intelligenceVisual.color || relationshipVisual.color || context.EDGE_COLORS[link.relationship_type] || context.EDGE_COLORS[link.type] || context.DEFAULT_EDGE_COLOR;
        const isFocused = context.selectedNode && context.focusLinkKeys.has(link.key);
        const isHoveredLink = context.hoveredNode && (context.hoveredNode.id === link.source.id || context.hoveredNode.id === link.target.id);
        const hasFocus = Boolean(context.selectedNode);
        const industryFilterActive = context.isIndustryGroupFilterActive();
        const touchesIndustryGroup = industryFilterActive && context.linkTouchesCurrentIndustryGroup(link);
        const isPortfolioLink = context.isPortfolioAnalysisActive() && context.portfolioEdgeKeys.has(link.key);

        const strength = context.clamp(link.strength, 0.05, 1);
        const isStrongSignal = strength >= 0.78;
        const perspectiveShade = getPerspectiveShade(context, link.source, link.target);
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

        if (intelligenceVisual.dimmed && !isFocused && !isHoveredLink && !isPortfolioLink) {
            alpha *= 0.36;
            width = Math.max(0.2, width * 0.72);
        }

        if (topologyEdge?.emphasized && !intelligenceVisual.route && !intelligenceVisual.selected && !intelligenceVisual.routeComparison?.active) {
            color = intelligenceVisual.color || topologyEdge.color || color;
            alpha = Math.max(alpha, topologyEdge.alphaFloor || 0.24);
            width = Math.max(width + (topologyEdge.widthBoost || 0), 0.76 + strength * 0.78);
        }

        if (intelligenceVisual.sourceCoverage && !intelligenceVisual.route && !intelligenceVisual.selected) {
            alpha = Math.max(alpha, 0.28 + strength * 0.18 + (intelligenceVisual.alphaBoost || 0));
            width = Math.max(width + (intelligenceVisual.widthBoost || 0), 0.8 + strength * 0.75);
        }

        if ((intelligenceVisual.overlay || intelligenceVisual.guided) && !intelligenceVisual.route && !intelligenceVisual.selected) {
            alpha = Math.max(alpha, 0.48 + strength * 0.24 + (intelligenceVisual.alphaBoost || 0));
            width = Math.max(width + (intelligenceVisual.widthBoost || 0), 1.15 + strength * 1.6);
        }

        if (intelligenceVisual.route || intelligenceVisual.selected) {
            alpha = Math.max(alpha, intelligenceVisual.selected ? 0.92 : 0.78);
            width = Math.max(width + (intelligenceVisual.widthBoost || 0), intelligenceVisual.selected ? 3.7 : 3.1);
        }

        if (!isFocused && !isHoveredLink && !isPortfolioLink) {
            alpha *= relationshipVisual.alphaMultiplier || 1;
            width = Math.max(0.18, width + (relationshipVisual.widthBoost || 0));
        }

        const densityProtected = Boolean(isFocused || isHoveredLink || isPortfolioLink || touchesIndustryGroup || intelligenceVisual.forceDraw || topologyEdge?.protected || semanticEdge.protectedEdge || readabilityEdge.protectedEdge);
        if (semanticEdge.corridor && !hasFocus && !isHoveredLink && !isPortfolioLink) {
            alpha = Math.max(alpha, semantic.tierRank <= 1 ? 0.34 + strength * 0.2 : 0.28 + strength * 0.18);
            width = Math.max(width, semantic.tierRank <= 1 ? 0.95 + strength * 0.95 : 0.8 + strength * 0.8);
        }
        if (!densityProtected && !semanticEdge.protectedEdge) {
            alpha *= semanticEdge.alphaMultiplier;
            width = Math.max(0.14, width * semanticEdge.widthMultiplier);
        }
        if (!densityProtected && !readabilityEdge.protectedEdge) {
            alpha *= readabilityEdge.alphaMultiplier;
            width = Math.max(0.12, width * readabilityEdge.widthMultiplier);
        }
        if (!densityProtected) {
            alpha *= overlayEdge.alphaMultiplier || 1;
            width = Math.max(0.12, width * (overlayEdge.widthMultiplier || 1));
        }
        if (density.dense && !densityProtected) {
            alpha *= density.veryDense ? 0.58 : 0.72;
            width = Math.max(0.16, width * (density.veryDense ? 0.74 : 0.86));
        }

        ctx.globalAlpha = alpha * perspectiveShade;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = (intelligenceVisual.route || intelligenceVisual.selected
            ? 34
            : isPortfolioLink ? 28 : isFocused ? 24 : isHoveredLink ? 22 : intelligenceVisual.guided ? 24 : intelligenceVisual.overlay ? 22 : isStrongSignal ? 16 : 3 + strength * 5) * semanticEdge.shadowMultiplier;
        ctx.shadowBlur *= readabilityEdge.shadowMultiplier || 1;
        ctx.shadowBlur *= overlayEdge.shadowMultiplier || 1;
        ctx.shadowBlur *= topologyEdge?.shadowMultiplier || 1;
        ctx.shadowColor = isPortfolioLink ? '#ffd700' : color;
        ctx.setLineDash(Array.isArray(intelligenceVisual.dashPattern)
            ? intelligenceVisual.dashPattern
            : Array.isArray(relationshipVisual.dashPattern) ? relationshipVisual.dashPattern : []);

        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const bundle = getCinematicSystem(context)?.getStockEdgeBundle?.(context, link, {
            semantic,
            intelligenceVisual,
            relationshipVisual
        }) || {};
        const curve = link.curveOffset * context.scale + (bundle.offset || 0);
        const controlX = midX + (-dy / distance) * curve;
        const controlY = midY + (dx / distance) * curve;

        if (intelligenceVisual.routeComparison?.active) {
            drawRouteComparisonLink(context, ctx, {
                source,
                target,
                controlX,
                controlY,
                dx,
                dy,
                distance,
                alpha,
                width,
                perspectiveShade,
                semanticEdge,
                comparison: intelligenceVisual.routeComparison
            });
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            return;
        }

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(controlX, controlY, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    }

    function drawRouteComparisonLink(context, ctx, state) {
        const comparison = state.comparison || {};
        const alpha = context.clamp((state.alpha || 0.8) + (comparison.shared ? 0.16 : 0.08), 0.48, 0.96) * (state.perspectiveShade || 1);
        const width = Math.max(2.2, state.width || 2.5);
        const normal = {
            x: -state.dy / Math.max(1, state.distance),
            y: state.dx / Math.max(1, state.distance)
        };

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = comparison.shared ? comparison.sharedColor || '#ffffff' : comparison.color || '#22d3ee';

        if (comparison.shared) {
            ctx.globalAlpha = Math.min(0.34, alpha * 0.36);
            ctx.strokeStyle = comparison.sharedColor || '#ffffff';
            ctx.lineWidth = width + 5.2;
            ctx.shadowBlur = 24 * (state.semanticEdge?.shadowMultiplier || 1);
            drawQuadraticPath(ctx, state.source, state.target, state.controlX, state.controlY);

            const colors = comparison.colors?.length ? comparison.colors : ['#22d3ee', '#f0abfc'];
            colors.slice(0, 2).forEach((color, index) => {
                const offset = (index === 0 ? -1 : 1) * Math.max(3.4, width * 0.72);
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(1.35, width * 0.48);
                ctx.shadowBlur = 16;
                drawQuadraticPath(
                    ctx,
                    state.source,
                    state.target,
                    state.controlX + normal.x * offset,
                    state.controlY + normal.y * offset
                );
            });

            ctx.globalAlpha = Math.min(0.58, alpha * 0.68);
            ctx.strokeStyle = comparison.convergence ? '#d9f99d' : comparison.divergence ? '#fde68a' : '#ffffff';
            ctx.lineWidth = Math.max(1, width * 0.28);
            ctx.shadowBlur = comparison.divergence || comparison.convergence ? 18 : 8;
            drawQuadraticPath(ctx, state.source, state.target, state.controlX, state.controlY);
            ctx.restore();
            return;
        }

        const color = comparison.color || '#22d3ee';
        ctx.globalAlpha = Math.min(0.28, alpha * 0.34);
        ctx.strokeStyle = color;
        ctx.lineWidth = width + 3.4;
        ctx.shadowBlur = 22 * (state.semanticEdge?.shadowMultiplier || 1);
        drawQuadraticPath(ctx, state.source, state.target, state.controlX, state.controlY);

        if (Array.isArray(comparison.dashPattern)) ctx.setLineDash(comparison.dashPattern);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowBlur = 20;
        drawQuadraticPath(ctx, state.source, state.target, state.controlX, state.controlY);
        ctx.restore();
    }

    function drawQuadraticPath(ctx, source, target, controlX, controlY) {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(controlX, controlY, target.x, target.y);
        ctx.stroke();
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
        const perspectiveShade = getPerspectiveShade(context, node);
        const intelligenceVisual = context.getGraphNodeIntelligenceVisual?.(node) || {};
        const readabilityNode = getReadabilityNodeAdjustment(context, node);
        const topologyNode = getTopologyNodeVisual(context, node);
        const overlayNode = getOverlayNodeAdjustment(context, node, intelligenceVisual);
        let alpha = (industryDimmed ? 0.16 : focusDimmed ? 0.18 : isPortfolioTopNexus ? 0.96 : isPortfolioRepeatedExposure ? 0.92 : isPortfolioAdjacent ? 0.84 : isCorrelationHintNode ? 0.78 : 1) * perspectiveShade;
        if (intelligenceVisual.emphasized && !industryDimmed) alpha = Math.max(alpha, intelligenceVisual.route || intelligenceVisual.selectedEdgeEndpoint ? 0.98 : 0.82);
        if (topologyNode?.emphasized && !industryDimmed && !focusDimmed) alpha = Math.max(alpha, topologyNode.alphaFloor || 0.72);
        alpha *= readabilityNode.alphaMultiplier || 1;
        alpha *= overlayNode.alphaMultiplier || 1;
        const color = node.color || '#00f9ff';
        const portfolioHaloColor = isPortfolioHolding
            ? '#ffd700'
            : isPortfolioTopNexus
                ? '#f0abfc'
                : isPortfolioRepeatedExposure
                    ? '#34d399'
                    : isPortfolioAdjacent
                        ? '#a5f3fc'
                        : intelligenceVisual.emphasized
                            ? intelligenceVisual.color || color
                            : topologyNode?.emphasized
                                ? topologyNode.color || color
                            : color;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = (isSelected ? 34 : isPortfolioHolding ? 38 : isSearchHighlighted ? 42 : intelligenceVisual.route || intelligenceVisual.selectedEdgeEndpoint ? 36 : intelligenceVisual.guided ? 28 : isHovered ? 22 : isPortfolioTopNexus ? 32 : intelligenceVisual.overlay || intelligenceVisual.analystOverlay ? 24 : intelligenceVisual.defaultDiscovery ? 18 : isPortfolioRepeatedExposure ? 24 : isPortfolioAdjacent ? 18 : isClusterNode ? 18 : isCorrelationHintNode ? 16 : 12) * (readabilityNode.glowMultiplier || 1);
        ctx.shadowBlur *= overlayNode.glowMultiplier || 1;
        ctx.shadowBlur *= topologyNode?.glowMultiplier || 1;
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

        drawNodeIntelligenceCue(context, ctx, point, radius, intelligenceVisual, {
            industryDimmed,
            focusDimmed,
            isSelected,
            isHovered
        });
        drawTopologyNodeCue(context, ctx, point, radius, topologyNode, {
            industryDimmed,
            focusDimmed,
            isSelected,
            isHovered
        });

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

        const semantic = getSemanticState(context);
        const labelLayout = createStockLabelLayout(context);
        const limit = getLabelLimit(context, labelMode);
        let drawn = 0;

        labels
            .sort((a, b) => labelPriority(context, b) - labelPriority(context, a))
            .forEach(node => {
                if (drawn >= limit) return;
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
                const visual = context.getGraphNodeIntelligenceVisual?.(node) || {};
                const disposition = getSemanticLabelDisposition(context, node, labelMode, semantic, visual);
                const alpha = (industryDimmed ? 0.18 : focusDimmed ? 0.25 : isPortfolioHolding ? 0.94 : isPortfolioAdjacent ? 0.82 : isClusterNode ? 0.86 : isNeighbor ? 0.82 : 0.72) * (disposition.alpha || semantic.lowPriorityLabelAlpha || 1);

                ctx.save();
                const fontSize = labelMode === 'full' ? (isSelected ? 12 : 11) : (isSelected ? 12 : 10);
                ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
                const label = truncateLabel(ctx, rawLabel, getSemanticLabelMaxWidth(labelMode, semantic, disposition));
                const width = ctx.measureText(label).width;
                const box = placeStockLabel(labelLayout, {
                    x: point.x,
                    y: point.y,
                    radius,
                    width: width + 10,
                    height: 16,
                    force: disposition.force || isSelected || isHovered
                });
                if (!box) {
                    ctx.restore();
                    return;
                }
                const x = box.x + 5;
                const y = box.y + 11;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = 'rgba(3, 7, 18, 0.76)';
                ctx.strokeStyle = isPortfolioHolding ? 'rgba(255, 215, 0, 0.62)' : isSelected || isHovered || isClusterNode || isPortfolioAdjacent ? 'rgba(0, 249, 255, 0.58)' : 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 1;
                roundedRect(ctx, box.x, box.y, box.width, box.height, 6);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = isPortfolioHolding ? '#fff7ad' : isSelected ? '#ffffff' : node.color || '#dbeafe';
                ctx.globalAlpha = isSelected || isHovered ? 1 : alpha;
                ctx.fillText(label, x, y);
                drawn += 1;
                ctx.restore();
            });
    }

    function getLabelMode(context) {
        const semantic = getSemanticState(context);
        if (context.scale < context.LABEL_TICKER_SCALE && semantic.tier === 'macro' && (semantic.selectedOverride || semantic.overlayActive || semantic.showCorridorHints)) return 'ticker';
        if (context.scale < context.LABEL_TICKER_SCALE) return 'none';
        if (context.scale < context.LABEL_FULL_SCALE) return 'ticker';
        return 'full';
    }

    function getLabelText(context, node, labelMode) {
        if (labelMode === 'full') return node.name || node.ticker || '';
        return node.ticker || node.name || '';
    }

    function getLabelLimit(context, labelMode) {
        const density = getDensityProfile(context);
        const semantic = getSemanticState(context, density);
        const heuristics = context.graphScalingModel?.renderHeuristics || {};
        const overlayLabelMultiplier = context.graphOverlayPlan?.labelPolicy?.labelLimitMultiplier || 1;
        const fullLimit = Number(heuristics.labelLimitFull);
        const tickerLimit = Number(heuristics.labelLimitTicker);
        const applyOverlayBudget = limit => Math.max(4, Math.round(limit * overlayLabelMultiplier));
        let baseLimit = 0;
        if (labelMode === 'full') {
            if (Number.isFinite(fullLimit) && !context.selectedNode) baseLimit = fullLimit;
            else if (density.mega && !context.selectedNode) baseLimit = 18;
            else if (density.veryDense && !context.selectedNode) baseLimit = 32;
            else if (density.dense && !context.selectedNode) baseLimit = 42;
            else baseLimit = context.selectedNode ? 68 : 54;
            const readabilityBudget = getReadabilityLabelBudget(context, labelMode, semantic);
            return applyOverlayBudget(Math.min(baseLimit, semantic.labelBudget || baseLimit, readabilityBudget || baseLimit));
        }
        if (Number.isFinite(tickerLimit) && !context.selectedNode) baseLimit = tickerLimit;
        else if (density.mega && !context.selectedNode) baseLimit = 12;
        else if (density.veryDense && !context.selectedNode) baseLimit = 22;
        else if (density.dense && !context.selectedNode) baseLimit = 28;
        else baseLimit = context.selectedNode ? 52 : 36;
        const readabilityBudget = getReadabilityLabelBudget(context, labelMode, semantic);
        return applyOverlayBudget(Math.min(baseLimit, semantic.labelBudget || baseLimit, readabilityBudget || baseLimit));
    }

    function shouldDrawLabel(context, node, labelMode) {
        if (labelMode === 'none') return false;
        const density = getDensityProfile(context);
        const semantic = getSemanticState(context, density);
        const intelligenceVisual = context.getGraphNodeIntelligenceVisual?.(node) || {};
        const disposition = getSemanticLabelDisposition(context, node, labelMode, semantic, intelligenceVisual);
        if (disposition.force) return true;
        if (!disposition.visible) return false;
        if (semantic.tier === 'macro' || semantic.tier === 'cluster') return true;
        if (context.selectedNode && context.selectedNode.id === node.id) return true;
        if (context.hoveredNode && context.hoveredNode.id === node.id) return true;
        if (intelligenceVisual.route || intelligenceVisual.selectedEdgeEndpoint) return true;
        if (intelligenceVisual.guided && context.scale > (density.dense ? 0.62 : 0.5)) return true;
        if (intelligenceVisual.defaultDiscovery && context.scale > (density.dense ? 0.68 : 0.56) && intelligenceVisual.role?.key !== 'normal') return true;
        if (intelligenceVisual.overlay && context.scale > (density.dense ? 0.68 : 0.56) && intelligenceVisual.role?.key !== 'normal') return true;
        const topologyVisual = getTopologyNodeVisual(context, node);
        if (topologyVisual?.emphasized && context.scale > (density.dense ? 0.58 : 0.48)) return true;
        if (context.isPortfolioAnalysisActive() && context.isPortfolioHighlightedNode(node)) return true;
        if (context.selectedNode && context.focusNeighborIds.has(node.id)) return true;
        if (context.selectedNode && context.activeClusterNodeIds.has(node.id) && !context.isFocusModeActive()) return true;
        if (density.mega && !context.selectedNode) return context.scale > 0.92 && (context.topLabelIds.has(node.id) || node.degree >= 12);
        if (density.veryDense && !context.selectedNode) return context.scale > 0.82 && (context.topLabelIds.has(node.id) || node.degree >= 8);
        if (density.dense && !context.selectedNode) return context.scale > 0.74 && (context.topLabelIds.has(node.id) || node.degree >= 6);
        if (labelMode === 'full') return true;
        if (context.scale > 0.68 && node.degree >= 2) return true;
        return context.topLabelIds.has(node.id) || node.degree >= 6;
    }

    function labelPriority(context, node) {
        const intelligenceVisual = context.getGraphNodeIntelligenceVisual?.(node) || {};
        const disposition = getSemanticLabelDisposition(context, node, getLabelMode(context), getSemanticState(context), intelligenceVisual);
        const boost = (disposition.priorityBoost || 0) + getReadabilityLabelPriorityBoost(context, node);
        if (intelligenceVisual.route) return boost + 1100 + (node.degree || 0);
        if (intelligenceVisual.selectedEdgeEndpoint) return boost + 1060 + (node.degree || 0);
        if (context.selectedNode && context.selectedNode.id === node.id) return boost + 1000;
        if (intelligenceVisual.guided) return boost + 940 + (node.degree || 0);
        if (context.hoveredNode && context.hoveredNode.id === node.id) return boost + 900;
        if (intelligenceVisual.overlay && intelligenceVisual.role?.key !== 'normal') return boost + 830 + (node.degree || 0);
        if (intelligenceVisual.defaultDiscovery && intelligenceVisual.role?.key !== 'normal') return boost + 800 + (node.degree || 0);
        const topologyVisual = getTopologyNodeVisual(context, node);
        const overlayAdjustment = getOverlayNodeAdjustment(context, node, intelligenceVisual);
        if (topologyVisual?.emphasized) return boost + 680 + (topologyVisual.labelPriorityBoost || 0) + (overlayAdjustment.labelPriorityBoost || 0) + (node.degree || 0);
        if (context.isPortfolioNode(node)) return boost + 780 + node.degree;
        if (context.isPortfolioTopNexusNode(node)) return boost + 720 + node.degree;
        if (context.isPortfolioRepeatedExposureNode(node)) return boost + 670 + node.degree;
        if (context.isPortfolioAdjacentNode(node)) return boost + 620 + node.degree;
        if (context.focusNeighborIds.has(node.id)) return boost + 500 + node.degree;
        if (context.selectedNode && context.activeClusterNodeIds.has(node.id) && !context.isFocusModeActive()) return boost + 360 + node.degree;
        return boost + node.degree * 10 + Math.max(0, 320 - (node.rank || 320)) / 20;
    }

    function getSemanticState(context, density = null) {
        if (context.getSemanticZoomState) return context.getSemanticZoomState(density || getDensityProfile(context));
        return window.StockPhotonicGraph?.semanticZoom?.getStockSemanticState?.(context, density || getDensityProfile(context)) || {
            tier: 'relationship',
            tierRank: 2,
            labelBudget: 42,
            weakEdgeThreshold: 0,
            lowPriorityLabelAlpha: 0.72
        };
    }

    function getSemanticLabelDisposition(context, node, labelMode, semantic, visual) {
        return window.StockPhotonicGraph?.semanticZoom?.getStockLabelDisposition?.(context, node, labelMode, semantic, visual) || {
            visible: true,
            force: false,
            alpha: 1,
            priorityBoost: 0
        };
    }

    function getSemanticEdgeDisposition(context, link, semantic, visual) {
        return window.StockPhotonicGraph?.semanticZoom?.getStockEdgeDisposition?.(context, link, semantic, visual) || {
            draw: true,
            protectedEdge: false,
            corridor: false,
            alphaMultiplier: 1,
            widthMultiplier: 1,
            shadowMultiplier: 1,
            priorityBoost: 0
        };
    }

    function getReadabilityState(context, density, semantic) {
        if (context.graphReadabilityModel) return context.graphReadabilityModel;
        const controller = context.graphReadabilityController || window.StockPhotonicGraph?.readabilityController;
        if (controller?.buildModel) return controller.buildModel(context);
        return null;
    }

    function getReadabilitySystem(context) {
        return context.graphReadability || window.StockPhotonicGraph?.readability || null;
    }

    function getReadabilityEdgeAdjustment(context, link, visual, semantic) {
        return getReadabilitySystem(context)?.getEdgeAdjustment?.(context, link, visual, semantic) || {
            draw: true,
            protectedEdge: false,
            alphaMultiplier: 1,
            widthMultiplier: 1,
            shadowMultiplier: 1,
            priorityBoost: 0
        };
    }

    function getReadabilityNodeAdjustment(context, node) {
        return getReadabilitySystem(context)?.getNodeAdjustment?.(context, node, getSemanticState(context)) || {
            radiusMultiplier: 1,
            alphaMultiplier: 1,
            glowMultiplier: 1,
            labelPriorityBoost: 0
        };
    }

    function getReadabilityLabelBudget(context, labelMode, semantic) {
        return getReadabilitySystem(context)?.getLabelBudget?.(context, labelMode, semantic) || 0;
    }

    function getReadabilityLabelPriorityBoost(context, node) {
        return getReadabilitySystem(context)?.getLabelPriorityBoost?.(context, node) || 0;
    }

    function getReadabilityFrameLinkLimit(context, density, semantic) {
        return getReadabilitySystem(context)?.getFrameLinkLimit?.(context, density, semantic) || 0;
    }

    function getReadabilityLinkPriority(context, link) {
        return getReadabilitySystem(context)?.getLinkRenderPriority?.(context, link) || 0;
    }

    function getTopologySystem(context) {
        return context.graphTopologyEngine || window.StockPhotonicGraph?.topologyEngine || null;
    }

    function getTopologyNodeVisual(context, node) {
        return getTopologySystem(context)?.getNodeTopologyVisual?.(context.graphTopologyModel, node) || null;
    }

    function getTopologyLinkVisual(context, link) {
        return getTopologySystem(context)?.getLinkTopologyVisual?.(context.graphTopologyModel, link) || null;
    }

    function getOverlaySystem(context) {
        return context.graphOverlayOrchestration || window.StockPhotonicGraph?.overlayOrchestration || null;
    }

    function getOverlayLinkAdjustment(context, link, visual) {
        return getOverlaySystem(context)?.getLinkAdjustment?.(context.graphOverlayPlan, link, visual) || {
            draw: true,
            alphaMultiplier: 1,
            widthMultiplier: 1,
            shadowMultiplier: 1,
            priorityBoost: 0
        };
    }

    function getOverlayNodeAdjustment(context, node, visual = {}) {
        return getOverlaySystem(context)?.getNodeAdjustment?.(context.graphOverlayPlan, node, visual) || {
            alphaMultiplier: 1,
            radiusMultiplier: 1,
            glowMultiplier: 1,
            labelPriorityBoost: 0
        };
    }

    function getCinematicSystem(context) {
        return context.graphCinematic || window.StockPhotonicGraph?.cinematic || null;
    }

    function getSemanticLabelMaxWidth(labelMode, semantic, disposition) {
        if (disposition.force) return labelMode === 'full' ? 230 : 110;
        if (semantic?.maxLabelWidth) return labelMode === 'full'
            ? semantic.maxLabelWidth
            : Math.min(semantic.maxLabelWidth, 96);
        return labelMode === 'full' ? 220 : 82;
    }

    function createStockLabelLayout(context) {
        const boxes = [];
        const semantic = getSemanticState(context);
        const padding = semantic.tierRank <= 1 ? 9 : 6;
        const margin = 8;
        return {
            register(box, options = {}) {
                const padded = {
                    x: box.x - padding,
                    y: box.y - padding,
                    width: box.width + padding * 2,
                    height: box.height + padding * 2
                };
                if (!options.force && boxes.some(existing => boxesOverlap(existing, padded))) return false;
                boxes.push(padded);
                return true;
            },
            clampBox(box) {
                return {
                    ...box,
                    x: clampFinite(box.x, margin, Math.max(margin, context.canvasWidth - box.width - margin)),
                    y: clampFinite(box.y, margin, Math.max(margin, context.canvasHeight - box.height - margin))
                };
            }
        };
    }

    function placeStockLabel(layout, metrics) {
        const gap = metrics.force ? 8 : 11;
        const candidates = [
            { x: metrics.x - metrics.width / 2, y: metrics.y + metrics.radius + gap },
            { x: metrics.x - metrics.width / 2, y: metrics.y - metrics.radius - metrics.height - gap },
            { x: metrics.x + metrics.radius + gap, y: metrics.y - metrics.height / 2 },
            { x: metrics.x - metrics.radius - metrics.width - gap, y: metrics.y - metrics.height / 2 }
        ];
        let fallback = null;
        for (const candidate of candidates) {
            const box = layout.clampBox({ ...candidate, width: metrics.width, height: metrics.height });
            fallback ||= box;
            if (layout.register(box, { force: metrics.force })) return box;
        }
        if (!metrics.force || !fallback) return null;
        layout.register(fallback, { force: true });
        return fallback;
    }

    function boxesOverlap(a, b) {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y;
    }

    function getPerspectiveShade(context, ...nodes) {
        if (!context.perspectiveEnabled) return 1;
        const depth = nodes.reduce((sum, node) => sum + Math.max(0, getFiniteNumber(node?._pseudoDepth, 0)), 0) / Math.max(1, nodes.length);
        return context.clamp(1 - depth * 0.28, 0.72, 1);
    }

    function sortByPerspectiveDepth(a, b) {
        return getFiniteNumber(b?._pseudoDepth, 0) - getFiniteNumber(a?._pseudoDepth, 0);
    }

    function sortLinkByPerspectiveDepth(a, b) {
        return getLinkDepth(b) - getLinkDepth(a);
    }

    function getLinkDepth(link) {
        const sourceDepth = getFiniteNumber(link?.source?._pseudoDepth, 0);
        const targetDepth = getFiniteNumber(link?.target?._pseudoDepth, 0);
        return (sourceDepth + targetDepth) * 0.5;
    }

    function getOrbitRenderFrame(context, orbit) {
        const ramp = getFiniteNumber(orbit?.ramp, 0);
        const active = context.orbitEnabled && ramp > 0;
        const easedRamp = active ? context.clamp(ramp, 0, 1) : 0;
        const depthRamp = easedRamp * easedRamp * (3 - 2 * easedRamp);
        return {
            active,
            centerX: context.canvasWidth * 0.5,
            centerY: context.canvasHeight * 0.5,
            invHalfWidth: 1 / Math.max(1, context.canvasWidth * 0.5),
            invHalfHeight: 1 / Math.max(1, context.canvasHeight * 0.5),
            phaseCos: active ? getFiniteNumber(orbit?.phaseCos, 1) : 1,
            phaseSin: active ? getFiniteNumber(orbit?.phaseSin, 0) : 0,
            verticalPhaseSin: active ? getFiniteNumber(orbit?.verticalPhaseSin, 0) : 0,
            ramp: easedRamp,
            depthRamp
        };
    }

    function getPseudoDepth(context, normalizedX, normalizedY, orbitFrame) {
        const depthRamp = getFiniteNumber(orbitFrame.depthRamp, orbitFrame.ramp);
        return context.clamp(
            (normalizedX * orbitFrame.phaseCos * 0.82 + normalizedY * orbitFrame.phaseSin * 0.28) * depthRamp,
            -1,
            1
        );
    }

    function getOrbitParallaxY(normalizedX, pseudoDepth, orbitFrame) {
        const depthRamp = getFiniteNumber(orbitFrame.depthRamp, orbitFrame.ramp);
        return clampFinite(
            pseudoDepth * ORBIT_DEPTH_Y_OFFSET + normalizedX * orbitFrame.verticalPhaseSin * ORBIT_PARALLAX_Y_OFFSET * depthRamp,
            -ORBIT_MAX_PARALLAX_Y,
            ORBIT_MAX_PARALLAX_Y
        );
    }

    function updateScreenCache(context, orbitFrame = null) {
        const frame = orbitFrame || getOrbitRenderFrame(context, null);
        context.visibleNodes.forEach(node => {
            const position = context.getNodeLayoutPosition(node);
            const point = context.worldToScreen(position.x, position.y);
            let radius = getScreenNodeRadius(context, node) * (point.perspectiveScale || 1);
            const readabilityNode = getReadabilityNodeAdjustment(context, node);
            radius *= readabilityNode.radiusMultiplier || 1;
            const topologyNode = getTopologyNodeVisual(context, node);
            if (topologyNode?.radiusMultiplier) radius *= topologyNode.radiusMultiplier;
            const intelligenceVisual = context.getGraphNodeIntelligenceVisual?.(node) || {};
            const overlayNode = getOverlayNodeAdjustment(context, node, intelligenceVisual);
            radius *= overlayNode.radiusMultiplier || 1;
            let pseudoDepth = point.depthNormalized || 0;

            if (frame.active) {
                const normalizedX = context.clamp((point.x - frame.centerX) * frame.invHalfWidth, -1, 1);
                const normalizedY = context.clamp((point.y - frame.centerY) * frame.invHalfHeight, -1, 1);
                pseudoDepth = getPseudoDepth(context, normalizedX, normalizedY, frame);
                point.y += getOrbitParallaxY(normalizedX, pseudoDepth, frame);
                radius *= context.clamp(
                    1 + pseudoDepth * ORBIT_DEPTH_SCALE,
                    ORBIT_MIN_DEPTH_MULTIPLIER,
                    ORBIT_MAX_DEPTH_MULTIPLIER
                );
            }

            node._screenX = point.x;
            node._screenY = point.y;
            node._screenRadius = radius;
            node._pseudoDepth = pseudoDepth;
            node._perspectiveScale = point.perspectiveScale || 1;
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
        const intelligenceVisual = context.getGraphLinkIntelligenceVisual?.(link) || {};
        const semantic = getSemanticState(context);
        const semanticEdge = getSemanticEdgeDisposition(context, link, semantic, intelligenceVisual);
        const readabilityEdge = getReadabilityEdgeAdjustment(context, link, intelligenceVisual, semantic);
        const topologyEdge = getTopologyLinkVisual(context, link);
        const overlayEdge = getOverlayLinkAdjustment(context, link, intelligenceVisual);
        if (!semanticEdge.draw || !readabilityEdge.draw || !overlayEdge.draw) return false;
        const industryFilterActive = context.isIndustryGroupFilterActive();
        const touchesIndustryGroup = industryFilterActive && context.linkTouchesCurrentIndustryGroup(link);
        const isPortfolioLink = context.isPortfolioAnalysisActive() && context.portfolioEdgeKeys.has(link.key);
        const protectedByIntelligence = Boolean(intelligenceVisual.forceDraw || topologyEdge?.protected || semanticEdge.protectedEdge || readabilityEdge.protectedEdge || overlayEdge.reason === 'protected');
        if (context.signalStrengthThreshold <= 0 && !isFocused && !touchesIndustryGroup && !isPortfolioLink && !protectedByIntelligence && link.strength < getWeakEdgeThreshold(context)) return false;

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

    function prioritizeFrameLinks(context, links, density = getDensityProfile(context), semantic = getSemanticState(context, density), readability = getReadabilityState(context, density, semantic)) {
        const limit = getFrameLinkLimit(context, density, semantic);
        if (!limit || links.length <= limit) return links;
        return links
            .slice()
            .sort((a, b) => getLinkRenderPriority(context, b) - getLinkRenderPriority(context, a))
            .slice(0, limit);
    }

    function getFrameLinkLimit(context, density, semantic = getSemanticState(context, density)) {
        if (context.selectedNode || context.activeRelationshipRoute || context.activeRouteComparison || context.selectedRelationshipLink) return 0;
        const navigation = context.graphScalingModel?.navigation || {};
        if (navigation.active && navigation.mode !== 'production_only') return 0;
        const readabilityLimit = getReadabilityFrameLinkLimit(context, density, semantic);
        if (readabilityLimit) return readabilityLimit;
        if (semantic.tier === 'macro' && density.mega) return 180;
        if (semantic.tier === 'macro' && density.veryDense) return 240;
        if (semantic.tier === 'macro' && density.dense) return 300;
        if (semantic.tier === 'cluster' && density.mega) return 280;
        if (semantic.tier === 'cluster' && density.veryDense) return 380;
        if (context.scale < 0.34 && density.mega) return 240;
        if (context.scale < 0.34 && density.veryDense) return 320;
        if (context.scale < 0.42 && density.dense) return 420;
        if (context.scale < 0.58 && density.mega) return 360;
        if (context.scale < 0.58 && density.veryDense) return 520;
        if (context.scale < 0.62 && density.dense) return 680;
        return 0;
    }

    function getLinkRenderPriority(context, link) {
        const visual = context.getGraphLinkIntelligenceVisual?.(link) || {};
        const semantic = getSemanticState(context);
        const semanticEdge = getSemanticEdgeDisposition(context, link, semantic, visual);
        const strength = Number(link?.strength) || 0;
        const readabilityEdge = getReadabilityEdgeAdjustment(context, link, visual, semantic);
        const topologyEdge = getTopologyLinkVisual(context, link);
        const overlayEdge = getOverlayLinkAdjustment(context, link, visual);
        let score = strength * 100 + (semanticEdge.priorityBoost || 0) + (readabilityEdge.priorityBoost || 0) + (topologyEdge?.priorityBoost || 0) + (overlayEdge.priorityBoost || 0) + getReadabilityLinkPriority(context, link);
        if (visual.forceDraw || visual.route || visual.routeComparison?.active || visual.selected || visual.guided || visual.overlay || visual.sourceCoverage) score += 1000;
        if (context.portfolioEdgeKeys?.has(link.key)) score += 850;
        if (context.focusLinkKeys?.has(link.key)) score += 800;
        if (context.isPortfolioAnalysisActive?.() && context.portfolioEdgeKeys?.has(link.key)) score += 360;
        if (context.relationshipHasSourceEvidence?.(link)) score += 120;
        if (context.isSecBackedConnection?.(link)) score += 140;
        const sourceDegree = Number(link?.source?.degree) || 0;
        const targetDegree = Number(link?.target?.degree) || 0;
        return score + Math.min(120, sourceDegree + targetDegree);
    }

    function drawNodeIntelligenceCue(context, ctx, point, radius, visual, state) {
        if (!visual?.emphasized) return;

        const semantic = getSemanticState(context);
        if (visual.sourceCoverage && !visual.route && !visual.selectedEdgeEndpoint && !semantic.showEvidenceMarkers) return;
        if ((visual.overlay || visual.defaultDiscovery) && semantic.tier === 'macro' && visual.role?.key === 'normal') return;

        const color = visual.color || '#67e8f9';
        const alpha = state.industryDimmed
            ? 0.18
            : visual.route || visual.selectedEdgeEndpoint
                ? 0.82
                : visual.sourceCoverage
                    ? 0.58
                    : visual.guided
                        ? 0.52
                    : visual.overlay
                        ? 0.46
                        : visual.defaultDiscovery
                            ? 0.34
                            : visual.cluster ? 0.38 : 0.28;
        if (alpha <= 0) return;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = visual.route || visual.selectedEdgeEndpoint ? 2.2 : visual.sourceCoverage ? 1.55 : 1.15;
        ctx.shadowBlur = visual.route || visual.selectedEdgeEndpoint ? 28 : 16;
        ctx.shadowColor = color;
        if (visual.sourceCoverage?.key === 'missing_source') {
            ctx.setLineDash([3, 6]);
        } else if (visual.cluster && !visual.route) {
            ctx.setLineDash([6, 5]);
        }

        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * (visual.route || visual.selectedEdgeEndpoint ? 2.75 : 2.32), 0, Math.PI * 2);
        ctx.stroke();

        if (visual.route || visual.selectedEdgeEndpoint || visual.guided || visual.navigation || (visual.sourceCoverage && semantic.showSourceBadges) || (visual.overlay && semantic.showOverlayBadges && visual.role?.key !== 'normal') || (visual.defaultDiscovery && semantic.showOverlayBadges && visual.role?.key !== 'normal')) {
            drawNodeIntelligenceBadge(ctx, point, radius, visual.badgeLabel || visual.role?.shortLabel || '', color);
        }

        ctx.restore();
    }

    function drawTopologyNodeCue(context, ctx, point, radius, visual, state) {
        if (!visual?.emphasized) return;
        if (state.industryDimmed || state.focusDimmed && !state.isSelected && !state.isHovered) return;
        const semantic = getSemanticState(context);
        if (semantic.tier === 'inspection' && !state.isSelected && !state.isHovered) return;
        const color = visual.color || '#22d3ee';
        const alpha = state.isSelected || state.isHovered
            ? 0.46
            : semantic.tierRank <= 1 ? 0.28 : 0.2;
        const scale = visual.kind === 'capital' ? 2.65 : visual.kind === 'bridge' ? 2.42 : 2.24;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = visual.kind === 'capital' ? 1.35 : 1;
        ctx.shadowBlur = 16;
        ctx.shadowColor = color;
        if (visual.kind === 'bridge') ctx.setLineDash([4, 7]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * scale, 0, Math.PI * 2);
        ctx.stroke();
        if ((state.isSelected || state.isHovered || semantic.tierRank <= 1) && visual.badgeLabel) {
            drawNodeIntelligenceBadge(ctx, point, radius * 0.92, visual.badgeLabel, color);
        }
        ctx.restore();
    }

    function drawNodeIntelligenceBadge(ctx, point, radius, label, color) {
        if (!label) return;
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const width = Math.max(24, ctx.measureText(label).width + 12);
        const x = point.x - width / 2;
        const y = point.y - radius * 2.9 - 10;
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = 'rgba(3, 7, 18, 0.82)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, width, 17, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.92;
        ctx.fillText(label, point.x, y + 8.5);
        ctx.restore();
    }

    function getWeakEdgeThreshold(context) {
        const density = getDensityProfile(context);
        const semantic = getSemanticState(context, density);
        const densityLift = density.mega ? 0.18 : density.veryDense ? 0.12 : density.dense ? 0.07 : density.large ? 0.04 : 0;
        if (semantic?.weakEdgeThreshold > 0) return Math.max(semantic.weakEdgeThreshold, densityLift);
        if (context.scale < 0.3) return Math.min(0.58, 0.42 + densityLift);
        if (context.scale < 0.46) return Math.min(0.5, 0.32 + densityLift);
        if (context.scale < 0.62) return Math.min(0.38, 0.2 + densityLift);
        if (density.mega && context.scale < 0.92) return 0.2;
        if (density.veryDense && context.scale < 0.82) return 0.14;
        if (density.dense && context.scale < 0.76) return 0.08;
        return 0;
    }

    function getDensityProfile(context) {
        const edgeCount = Array.isArray(context.visibleLinks) ? context.visibleLinks.length : 0;
        const nodeCount = Array.isArray(context.visibleNodes) ? context.visibleNodes.length : 0;
        const density = nodeCount ? edgeCount / Math.max(1, nodeCount) : 0;
        return {
            nodeCount,
            edgeCount,
            density,
            mega: nodeCount > 520 || edgeCount > 1100 || density > 4.2,
            large: nodeCount > 70 || edgeCount > 115,
            dense: density > 2.15 || edgeCount > 125,
            veryDense: density > 2.75 || edgeCount > 165
        };
    }

    function getScreenNodeRadius(context, node) {
        return context.graphViewport.getScreenNodeRadius(node, context.scale);
    }

    function getFiniteNumber(value, fallback) {
        return Number.isFinite(value) ? value : fallback;
    }

    function clampFinite(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
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
        drawNodeIntelligenceCue,
        drawNodeIntelligenceBadge,
        getPerspectiveShade,
        sortByPerspectiveDepth,
        sortLinkByPerspectiveDepth,
        updateScreenCache,
        isNodeInFrame,
        shouldDrawLink,
        getWeakEdgeThreshold,
        getDensityProfile,
        getScreenNodeRadius,
        getOrbitRenderFrame,
        getPseudoDepth,
        getOrbitParallaxY,
        roundedRect,
        truncateLabel
    };
})();
