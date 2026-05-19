(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const STOCK_TIER_LABELS = {
        macro: 'Macro',
        cluster: 'Cluster',
        relationship: 'Relationship',
        inspection: 'Inspection'
    };
    const TIER_RANK = { macro: 0, cluster: 1, relationship: 2, inspection: 3 };
    const semanticCache = new Map();
    const MAX_CACHE_SIZE = 220;

    function getStockSemanticState(context = {}, density = {}) {
        const scale = normalizeNumber(context.scale, 1);
        const densityKey = getStockDensityKey(density, context);
        const mode = getStockMode(context);
        const rawTier = getTierForScale(scale, densityKey, 'stock');
        const selectedOverride = Boolean(
            context.selectedNode ||
            context.hoveredNode ||
            context.activeRelationshipRoute ||
            context.selectedRelationshipLink
        );
        const overlayActive = Boolean(
            context.activeEcosystemOverlayKey ||
            context.sourceCoverageLensEnabled ||
            context.graphIntelligenceModel?.overlay ||
            context.graphIntelligenceModel?.guidedDiscovery ||
            context.largeGraphNavigationModel?.isActive
        );
        const effectiveTier = promoteTier(rawTier, selectedOverride, overlayActive);
        const key = [
            'stock',
            getScaleBucket(scale),
            densityKey,
            mode,
            rawTier,
            effectiveTier,
            selectedOverride ? 1 : 0,
            overlayActive ? 1 : 0,
            context.visibleNodes?.length || 0,
            context.visibleLinks?.length || 0
        ].join('|');
        const cached = semanticCache.get(key);
        if (cached) return cached;

        const rank = TIER_RANK[effectiveTier] ?? 0;
        const modeProfile = getStockModeProfile(mode);
        const state = {
            product: 'stock',
            rawTier,
            tier: effectiveTier,
            tierRank: rank,
            tierLabel: STOCK_TIER_LABELS[effectiveTier] || 'Graph',
            scale,
            scaleBucket: getScaleBucket(scale),
            densityKey,
            mode,
            selectedOverride,
            overlayActive,
            labelBudget: getStockLabelBudget(effectiveTier, densityKey, mode, selectedOverride),
            lowPriorityLabelAlpha: rank >= 3 ? 0.74 : rank === 2 ? 0.58 : rank === 1 ? 0.42 : 0.26,
            weakEdgeThreshold: getStockWeakEdgeThreshold(effectiveTier, densityKey, mode),
            weakEdgeAlpha: rank <= 0 ? 0.2 : rank === 1 ? 0.34 : 0.58,
            weakEdgeWidthMultiplier: rank <= 0 ? 0.54 : rank === 1 ? 0.68 : 0.84,
            showClusterHints: rank <= 1 || modeProfile.clusterHints,
            showCorridorHints: rank <= 1 || modeProfile.corridors,
            showRelationshipDetail: rank >= 2 || selectedOverride,
            showEvidenceMarkers: modeProfile.evidence && (rank >= 2 || selectedOverride),
            showSourceBadges: modeProfile.evidence && rank >= 3,
            showRouteLabels: modeProfile.routes || selectedOverride,
            showOverlayBadges: rank >= 1 || selectedOverride,
            showLowPriorityLabels: rank >= 3,
            maxLabelWidth: rank >= 3 ? 220 : rank === 2 ? 150 : 92,
            minimapDetail: rank <= 0 ? 'corridors' : rank === 1 ? 'clusters' : rank === 2 ? 'routes' : 'selection',
            modeProfile
        };
        cacheSemanticState(key, state);
        return state;
    }

    function getStockLabelDisposition(context = {}, node = {}, labelMode = 'ticker', semantic = null, visual = {}) {
        const state = semantic || getStockSemanticState(context);
        const selected = Boolean(context.selectedNode && context.selectedNode.id === node.id);
        const hovered = Boolean(context.hoveredNode && context.hoveredNode.id === node.id);
        const neighbor = Boolean(context.focusNeighborIds?.has(node.id));
        const route = Boolean(visual.route || visual.selectedEdgeEndpoint);
        const guided = Boolean(visual.guided || visual.navigation);
        const overlay = Boolean(visual.overlay || visual.defaultDiscovery);
        const portfolio = Boolean(context.isPortfolioAnalysisActive?.() && context.isPortfolioHighlightedNode?.(node));
        const strategic = isStrategicStockNode(context, node, visual);
        const topSeed = Boolean(context.topLabelIds?.has(node.id));
        const degree = Number(node.degree || 0);
        const protectedLabel = selected || hovered || route || guided || portfolio;

        if (protectedLabel) {
            return { visible: true, force: true, alpha: 1, priorityBoost: 1600 };
        }

        if (state.tier === 'macro') {
            return {
                visible: strategic && (topSeed || degree >= 8 || overlay),
                force: false,
                alpha: 0.56,
                priorityBoost: strategic ? 420 : 0
            };
        }

        if (state.tier === 'cluster') {
            const visible = strategic || overlay || topSeed || (state.mode !== 'explore' && degree >= 7);
            return {
                visible,
                force: false,
                alpha: strategic ? 0.72 : 0.52,
                priorityBoost: strategic ? 340 : overlay ? 260 : 0
            };
        }

        if (state.tier === 'relationship') {
            const visible = strategic || overlay || neighbor || topSeed || degree >= (state.densityKey === 'mega' ? 8 : 5);
            return {
                visible,
                force: false,
                alpha: neighbor ? 0.82 : strategic ? 0.78 : 0.62,
                priorityBoost: neighbor ? 300 : strategic ? 220 : 0
            };
        }

        return {
            visible: true,
            force: false,
            alpha: labelMode === 'full' ? 0.82 : 0.74,
            priorityBoost: strategic ? 120 : 0
        };
    }

    function getStockEdgeDisposition(context = {}, link = {}, semantic = null, visual = {}) {
        const state = semantic || getStockSemanticState(context);
        const strength = clamp01(Number(link.strength) || 0);
        const protectedEdge = Boolean(
            visual.forceDraw ||
            visual.route ||
            visual.selected ||
            visual.guided ||
            visual.overlay ||
            visual.navigation ||
            visual.corridor ||
            visual.sourceCoverage ||
            context.focusLinkKeys?.has(link.key) ||
            context.portfolioEdgeKeys?.has(link.key)
        );
        const corridor = Boolean(visual.corridor || visual.navigation || visual.overlay || visual.guided);
        const minStrength = protectedEdge ? 0 : state.weakEdgeThreshold;
        return {
            protectedEdge,
            corridor,
            draw: protectedEdge || strength >= minStrength,
            alphaMultiplier: protectedEdge ? 1 : state.weakEdgeAlpha + strength * 0.42,
            widthMultiplier: protectedEdge ? 1 : state.weakEdgeWidthMultiplier,
            shadowMultiplier: protectedEdge ? 1 : state.tierRank <= 1 ? 0.55 : 0.78,
            priorityBoost: protectedEdge ? 1000 : corridor ? 260 : 0
        };
    }

    function buildStockBreadcrumbParts(context = {}) {
        const semantic = context.semanticZoom || getStockSemanticState(context, context.density || {});
        const parts = [];
        const mode = getStockMode(context);
        parts.push({
            label: mode === 'review' ? 'Review' : mode === 'replay' ? 'Replay' : mode === 'analyst' ? 'Analyst' : 'Overview',
            title: 'Operating mode'
        });

        if (context.largeGraphNavigationModel?.isActive && context.formatNavigationLabel) {
            parts.push({
                label: context.formatNavigationLabel(context.largeGraphNavigationModel),
                title: 'Large graph navigation focus'
            });
        } else if (context.layoutLabel) {
            parts.push({ label: context.layoutLabel, title: 'Spatial layout' });
        }

        if (context.activeEcosystemOverlayKey && context.getEcosystemDefinition) {
            const ecosystem = context.getEcosystemDefinition(context.activeEcosystemOverlayKey);
            parts.push({
                label: ecosystem?.shortLabel || ecosystem?.label || 'Ecosystem',
                title: ecosystem?.label || 'Active ecosystem overlay'
            });
        }

        if (context.selectedNode) {
            parts.push({
                label: `${context.selectedNode.ticker || context.selectedNode.name || 'Company'} neighborhood`,
                title: 'Selected company neighborhood'
            });
        }

        if (context.activeRelationshipRoute) {
            parts.push({
                label: context.activeRelationshipRoute.label || 'Route',
                title: 'Active relationship route'
            });
        } else if (context.selectedRelationshipLink) {
            parts.push({
                label: 'Selected edge',
                title: 'Selected relationship edge'
            });
        }

        if (context.sourceCoverageLensEnabled) {
            parts.push({ label: 'Source lens', title: 'Evidence and source coverage lens' });
        }

        parts.push({
            label: `${semantic.tierLabel} detail`,
            title: `Semantic zoom tier at ${semantic.scale.toFixed(2)}x`
        });

        return compactParts(parts, 5);
    }

    function getCryptoSemanticState(options = {}) {
        const scale = normalizeNumber(options.scale, 1);
        const nodeCount = Number(options.nodeCount || 0);
        const edgeCount = Number(options.edgeCount || 0);
        const densityKey = getCryptoDensityKey(nodeCount, edgeCount);
        const mode = getCryptoMode(options);
        const rawTier = getTierForScale(scale, densityKey, 'crypto');
        const selectedOverride = Boolean(options.selectedId || options.selectedFlowId || options.replayActiveFlowId || options.tokenIsolationActive);
        const effectiveTier = promoteTier(rawTier, selectedOverride, Boolean(options.replayActive));
        const key = [
            'crypto',
            getScaleBucket(scale),
            densityKey,
            mode,
            rawTier,
            effectiveTier,
            selectedOverride ? 1 : 0,
            nodeCount,
            edgeCount,
            options.labelDensity || 'balanced'
        ].join('|');
        const cached = semanticCache.get(key);
        if (cached) return cached;

        const rank = TIER_RANK[effectiveTier] ?? 0;
        const reviewMode = mode === 'review';
        const replayMode = mode === 'replay' || Boolean(options.replayActive || options.replayActiveFlowId);
        const state = {
            product: 'crypto',
            rawTier,
            tier: effectiveTier,
            tierRank: rank,
            tierLabel: STOCK_TIER_LABELS[effectiveTier] || 'Graph',
            scale,
            scaleBucket: getScaleBucket(scale),
            densityKey,
            mode,
            selectedOverride,
            showFlowLabels: rank >= 2 || selectedOverride,
            showAmounts: rank >= 2 || selectedOverride,
            showTokenExposure: rank >= 1 || selectedOverride,
            showSourceHints: reviewMode && (rank >= 2 || selectedOverride),
            showReplayPath: replayMode || selectedOverride,
            showLowPriorityLabels: rank >= 3,
            maxNodeLabels: getCryptoLabelBudget(effectiveTier, densityKey, options.labelDensity, options.mobile),
            weakFlowAlpha: rank <= 0 ? 0.18 : rank === 1 ? 0.32 : 0.58,
            weakFlowWidthMultiplier: rank <= 0 ? 0.52 : rank === 1 ? 0.68 : 0.86,
            flowLabelAlpha: rank <= 0 ? 0.38 : rank === 1 ? 0.52 : rank === 2 ? 0.74 : 0.9,
            minimapDetail: rank <= 1 ? 'cluster' : 'route'
        };
        cacheSemanticState(key, state);
        return state;
    }

    function buildCryptoBreadcrumbParts(options = {}) {
        const semantic = options.semanticZoom || getCryptoSemanticState(options);
        const parts = [{ label: 'Crypto', title: 'CryptoPhotonic graph' }];
        const mode = getCryptoMode(options);
        if (mode && mode !== 'flow') parts.push({ label: titleCase(mode), title: 'Operating mode' });
        if (options.dataModeLabel) parts.push({ label: options.dataModeLabel, title: 'Data source mode' });
        if (options.selectedNodeLabel) parts.push({ label: `${options.selectedNodeLabel} cluster`, title: 'Selected wallet or token cluster' });
        if (options.selectedFlowLabel) parts.push({ label: options.selectedFlowLabel, title: 'Selected transaction flow' });
        if (options.replayActive) parts.push({ label: 'Replay window', title: 'Preview replay path' });
        if (options.tokenIsolationLabel) parts.push({ label: options.tokenIsolationLabel, title: 'Token exposure focus' });
        parts.push({ label: `${semantic.tierLabel} detail`, title: `Semantic zoom tier at ${semantic.scale.toFixed(2)}x` });
        return compactParts(parts, 5);
    }

    function getTierForScale(scale, densityKey, product) {
        const denseLift = densityKey === 'mega' ? 0.16 : densityKey === 'very_dense' ? 0.1 : densityKey === 'dense' ? 0.06 : 0;
        const macroMax = product === 'crypto' ? 0.56 + denseLift : 0.48 + denseLift;
        const clusterMax = product === 'crypto' ? 0.88 + denseLift : 0.78 + denseLift;
        const relationshipMax = product === 'crypto' ? 1.28 + denseLift : 1.14 + denseLift;
        if (scale < macroMax) return 'macro';
        if (scale < clusterMax) return 'cluster';
        if (scale < relationshipMax) return 'relationship';
        return 'inspection';
    }

    function promoteTier(rawTier, selectedOverride, overlayActive) {
        let rank = TIER_RANK[rawTier] ?? 0;
        if (selectedOverride) rank = Math.max(rank, 2);
        else if (overlayActive) rank = Math.max(rank, 1);
        return Object.keys(TIER_RANK).find(key => TIER_RANK[key] === rank) || rawTier;
    }

    function getStockDensityKey(density = {}, context = {}) {
        const raw = context.graphScalingModel?.density?.key || '';
        if (raw === 'very_dense' || raw === 'mega' || raw === 'dense') return raw;
        if (density.mega) return 'mega';
        if (density.veryDense) return 'very_dense';
        if (density.dense) return 'dense';
        if (density.large) return 'growth';
        return raw || 'core';
    }

    function getCryptoDensityKey(nodeCount, edgeCount) {
        const ratio = edgeCount / Math.max(1, nodeCount);
        if (nodeCount > 240 || edgeCount > 520 || ratio > 4.5) return 'mega';
        if (nodeCount > 140 || edgeCount > 320 || ratio > 3.35) return 'very_dense';
        if (nodeCount > 72 || edgeCount > 170 || ratio > 2.35) return 'dense';
        if (nodeCount > 36 || edgeCount > 88 || ratio > 1.65) return 'growth';
        return 'core';
    }

    function getStockMode(context = {}) {
        const value = context.getStockUxMode?.() || document.body?.dataset?.stockUxMode || context.mode || 'explore';
        return ['explore', 'analyst', 'review', 'replay'].includes(value) ? value : 'explore';
    }

    function getCryptoMode(options = {}) {
        const value = options.mode || document.body?.dataset?.cryptoUxMode || 'flow';
        return ['flow', 'analyst', 'review', 'replay'].includes(value) ? value : 'flow';
    }

    function getStockModeProfile(mode) {
        if (mode === 'review') return { evidence: true, routes: true, corridors: true, clusterHints: true };
        if (mode === 'replay') return { evidence: false, routes: true, corridors: true, clusterHints: true };
        if (mode === 'analyst') return { evidence: false, routes: true, corridors: true, clusterHints: true };
        return { evidence: false, routes: false, corridors: false, clusterHints: false };
    }

    function getStockLabelBudget(tier, densityKey, mode, selectedOverride) {
        const base = {
            macro: densityKey === 'mega' ? 8 : densityKey === 'very_dense' ? 10 : 12,
            cluster: densityKey === 'mega' ? 14 : densityKey === 'very_dense' ? 18 : 24,
            relationship: densityKey === 'mega' ? 26 : densityKey === 'very_dense' ? 34 : 46,
            inspection: densityKey === 'mega' ? 42 : densityKey === 'very_dense' ? 54 : 72
        }[tier] || 24;
        const modeBoost = mode === 'explore' ? -4 : mode === 'review' ? 6 : 2;
        const selectedBoost = selectedOverride ? 18 : 0;
        return Math.max(6, base + modeBoost + selectedBoost);
    }

    function getCryptoLabelBudget(tier, densityKey, labelDensity, mobile) {
        const densityCut = densityKey === 'mega' ? -8 : densityKey === 'very_dense' ? -5 : densityKey === 'dense' ? -2 : 0;
        const detailBoost = labelDensity === 'detailed' ? 6 : labelDensity === 'minimal' ? -5 : 0;
        const mobileCut = mobile ? -5 : 0;
        const base = { macro: 5, cluster: 9, relationship: 15, inspection: 24 }[tier] || 12;
        return Math.max(3, base + densityCut + detailBoost + mobileCut);
    }

    function getStockWeakEdgeThreshold(tier, densityKey, mode) {
        const densityLift = densityKey === 'mega' ? 0.16 : densityKey === 'very_dense' ? 0.1 : densityKey === 'dense' ? 0.06 : 0;
        const modeLift = mode === 'explore' ? 0.04 : mode === 'review' ? -0.02 : 0;
        const base = { macro: 0.42, cluster: 0.28, relationship: 0.12, inspection: 0 }[tier] ?? 0.18;
        return clamp(base + densityLift + modeLift, 0, 0.62);
    }

    function isStrategicStockNode(context = {}, node = {}, visual = {}) {
        if (visual.role && visual.role.key !== 'normal' && visual.role.key !== 'isolated') return true;
        if (context.topLabelIds?.has(node.id)) return true;
        if ((Number(node.degree) || 0) >= 8) return true;
        return Boolean(visual.overlay || visual.guided || visual.navigation || visual.defaultDiscovery);
    }

    function compactParts(parts, limit) {
        const clean = (parts || []).filter(part => part?.label);
        if (clean.length <= limit) return clean;
        const head = clean.slice(0, Math.max(1, limit - 3));
        const tail = clean.slice(-(limit - head.length));
        return [...head, ...tail];
    }

    function getScaleBucket(scale) {
        return Math.round(scale * 20) / 20;
    }

    function cacheSemanticState(key, value) {
        if (semanticCache.size > MAX_CACHE_SIZE) {
            const removeCount = Math.ceil(MAX_CACHE_SIZE * 0.18);
            [...semanticCache.keys()].slice(0, removeCount).forEach(cacheKey => semanticCache.delete(cacheKey));
        }
        semanticCache.set(key, value);
    }

    function normalizeNumber(value, fallback) {
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }

    function clamp01(value) {
        return clamp(value, 0, 1);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    }

    function titleCase(value) {
        return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicGraph.semanticZoom = {
        getStockSemanticState,
        getStockLabelDisposition,
        getStockEdgeDisposition,
        buildStockBreadcrumbParts,
        getCryptoSemanticState,
        buildCryptoBreadcrumbParts
    };
})();
