(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    const TOPOLOGY_VERSION = 'd169_spatial_market_topology_v1';
    const ZONE_COLORS = {
        density: '#22d3ee',
        capital: '#fbbf24',
        infrastructure: '#a78bfa',
        ecosystem: '#34d399',
        bridge: '#f472b6'
    };

    function createTopologyController(options = {}) {
        const cache = createLru(Math.max(12, Number(options.maxEntries) || 42));

        function buildStockTopologyModel(context = {}) {
            const nodes = Array.isArray(context.visibleNodes) ? context.visibleNodes : [];
            const links = Array.isArray(context.visibleLinks) ? context.visibleLinks : [];
            const density = normalizeDensity(context.graphScalingModel?.density, nodes.length, links.length);
            const semantic = context.stockSemanticZoomState || context.semanticZoom || {};
            const signature = getSignature(context, nodes, links, density, semantic);
            const cached = cache.get(signature);
            if (cached) return cached;

            const nodeMetrics = buildNodeMetrics(nodes, links, context);
            const corridorPressures = buildCorridorPressures(links, context, density);
            const densityZones = buildDensityZones(nodes, links, context, nodeMetrics, density);
            const concentrationZones = buildConcentrationZones(nodes, nodeMetrics, context, density);
            const bridgeSaturation = buildBridgeSaturation(nodes, nodeMetrics, context, density);
            const ecosystemOverlap = buildEcosystemOverlap(nodes, links, nodeMetrics, context, density);
            const routeImportance = buildRouteImportance(context, links, nodeMetrics, corridorPressures);
            const nodeVisuals = buildNodeVisuals(nodes, nodeMetrics, concentrationZones, bridgeSaturation, ecosystemOverlap, density);
            const linkVisuals = buildLinkVisuals(links, corridorPressures, routeImportance, context, density);
            const semanticSummary = buildSemanticTopologySummary({
                nodes,
                links,
                density,
                semantic,
                densityZones,
                concentrationZones,
                corridorPressures,
                bridgeSaturation,
                ecosystemOverlap,
                routeImportance
            });

            const model = {
                version: TOPOLOGY_VERSION,
                signature,
                density,
                semanticTier: semantic.tier || 'relationship',
                densityZones,
                concentrationZones,
                corridorPressures,
                bridgeSaturation,
                ecosystemOverlap,
                routeImportance,
                nodeMetrics,
                nodeVisuals,
                linkVisuals,
                semanticSummary,
                visualBudget: buildVisualBudget(density, semantic),
                performanceContract: {
                    derivedOnVisibilityRefresh: true,
                    perFrameFullScans: false,
                    dataMutation: false,
                    backendRequired: false,
                    browserIngestion: false
                },
                createdAt: Date.now()
            };
            cache.set(signature, model);
            return model;
        }

        return {
            buildStockTopologyModel,
            getCacheStats: () => cache.stats()
        };
    }

    function drawTopologyField(context = {}, ctx, model = context.graphTopologyModel || null, options = {}) {
        if (!ctx || !model) return;
        const semantic = options.semantic || context.semanticZoomState || context.stockSemanticZoomState || {};
        const choreography = options.choreography || {};
        const tierRank = Number(semantic.tierRank ?? (semantic.tier === 'macro' ? 0 : semantic.tier === 'cluster' ? 1 : 2));
        const density = model.density || {};
        const showZones = tierRank <= 2 || context.getStockUxMode?.() === 'analyst' || context.getStockUxMode?.() === 'replay';
        if (!showZones) return;

        const zones = [
            ...(model.densityZones || []).slice(0, model.visualBudget?.densityZoneLimit || 4),
            ...(model.concentrationZones || []).slice(0, model.visualBudget?.concentrationZoneLimit || 3)
        ];
        if (!zones.length) return;

        ctx.save();
        zones.forEach((zone, index) => {
            const point = context.worldToScreen?.(zone.x || 0, zone.y || 0);
            if (!point) return;
            const screenRadius = clamp((zone.radius || 180) * Math.max(0.22, Number(context.scale) || 1) * (choreography.fieldRadiusMultiplier || 1), 42, density.key === 'mega' ? 210 : 260);
            if (point.x < -screenRadius || point.x > (context.canvasWidth || 0) + screenRadius || point.y < -screenRadius || point.y > (context.canvasHeight || 0) + screenRadius) return;
            const color = zone.color || ZONE_COLORS[zone.kind] || ZONE_COLORS.density;
            const alpha = clamp((zone.alpha || 0.08) * (tierRank <= 1 ? 1.08 : 0.76) * (index < 2 ? 1 : 0.82) * (choreography.fieldAlphaMultiplier || 1), 0.018, 0.11);
            const gradient = ctx.createRadialGradient(point.x, point.y, screenRadius * 0.08, point.x, point.y, screenRadius);
            gradient.addColorStop(0, toRgba(context, color, alpha));
            gradient.addColorStop(0.56, toRgba(context, color, alpha * 0.38));
            gradient.addColorStop(1, toRgba(context, color, 0));
            ctx.globalAlpha = 1;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(point.x, point.y, screenRadius, 0, Math.PI * 2);
            ctx.fill();

            if (tierRank <= 1 && index < 3) {
                ctx.globalAlpha = alpha * 1.55;
                ctx.strokeStyle = toRgba(context, color, 0.65);
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 12]);
                ctx.beginPath();
                ctx.arc(point.x, point.y, screenRadius * 0.72, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });
        ctx.restore();
    }

    function getNodeTopologyVisual(model, node) {
        if (!model || !node) return null;
        return model.nodeVisuals?.get(node.id) || null;
    }

    function getLinkTopologyVisual(model, link) {
        if (!model || !link) return null;
        return model.linkVisuals?.get(link.key) || null;
    }

    function getValidationSummary(model = null) {
        if (!model) {
            return {
                available: false,
                topologyStatus: 'Unavailable',
                densityZoneCount: 0,
                concentrationZoneCount: 0,
                corridorPressureCount: 0,
                bridgeSaturationCount: 0,
                ecosystemOverlapCount: 0,
                routeImportanceSignalCount: 0,
                semanticSummaryAvailable: false,
                semanticSummaryLabel: 'Unavailable',
                safeFallbackText: 'Topology validation summary will appear after the visible graph model is derived.',
                deterministic: true,
                metadataDerivedOnly: true
            };
        }
        const ecosystemNodes = Array.isArray(model.ecosystemOverlap?.nodes) ? model.ecosystemOverlap.nodes.length : 0;
        const ecosystemLinks = Array.isArray(model.ecosystemOverlap?.links) ? model.ecosystemOverlap.links.length : 0;
        const semanticAvailable = Boolean(model.semanticSummary?.headline || model.semanticSummary?.sentence);
        return {
            available: true,
            topologyStatus: model.version ? 'Ready' : 'Derived',
            densityZoneCount: count(model.densityZones),
            concentrationZoneCount: count(model.concentrationZones),
            corridorPressureCount: count(model.corridorPressures),
            bridgeSaturationCount: count(model.bridgeSaturation),
            ecosystemOverlapCount: ecosystemNodes + ecosystemLinks,
            ecosystemOverlapNodeCount: ecosystemNodes,
            ecosystemOverlapLinkCount: ecosystemLinks,
            routeImportanceSignalCount: count(model.routeImportance?.links),
            semanticSummaryAvailable: semanticAvailable,
            semanticSummaryLabel: semanticAvailable ? 'Available' : 'Fallback only',
            semanticHeadline: model.semanticSummary?.headline || '',
            safeFallbackText: semanticAvailable
                ? model.semanticSummary.sentence || model.semanticSummary.headline
                : 'No semantic topology sentence is available for the current model.',
            deterministic: Boolean(model.semanticSummary?.deterministic ?? true),
            metadataDerivedOnly: Boolean(model.semanticSummary?.metadataDerivedOnly ?? true)
        };
    }

    function buildNodeMetrics(nodes, links, context) {
        const metrics = new Map();
        nodes.forEach(node => {
            metrics.set(node.id, {
                node,
                visibleDegree: 0,
                visibleStrength: 0,
                marketCap: Number(node.market_cap || node.marketCap || 0) || 0,
                rank: Number(node.rank) || 9999,
                sectorKeys: new Set([node.sector].filter(Boolean)),
                industryKeys: new Set([context.getCompanyIndustryGroup?.(node) || node.industryGroup || node.industry].filter(Boolean)),
                ecosystemKeys: new Set(),
                corridorKeys: new Set(),
                sourced: 0,
                secBacked: 0,
                bridgeEdges: 0
            });
        });

        links.forEach(link => {
            const ecosystemKeys = getLinkEcosystemKeys(link, context);
            const corridorKeys = getLinkCorridorKeys(link, context);
            [link.source, link.target].forEach((node, index) => {
                const row = metrics.get(node?.id);
                if (!row) return;
                const other = index === 0 ? link.target : link.source;
                row.visibleDegree += 1;
                row.visibleStrength += clamp01(Number(link.strength) || 0);
                ecosystemKeys.forEach(key => row.ecosystemKeys.add(key));
                corridorKeys.forEach(key => row.corridorKeys.add(key));
                if (other?.sector) row.sectorKeys.add(other.sector);
                const otherIndustry = context.getCompanyIndustryGroup?.(other) || other?.industryGroup || other?.industry || '';
                if (otherIndustry) row.industryKeys.add(otherIndustry);
                if (context.relationshipHasSourceEvidence?.(link)) row.sourced += 1;
                if (context.isSecBackedConnection?.(link)) row.secBacked += 1;
                if (other?.sector && node?.sector && other.sector !== node.sector) row.bridgeEdges += 1;
            });
        });

        metrics.forEach(row => {
            row.avgStrength = row.visibleDegree ? row.visibleStrength / row.visibleDegree : 0;
            row.ecosystemCount = row.ecosystemKeys.size;
            row.corridorCount = row.corridorKeys.size;
            row.sectorCount = row.sectorKeys.size;
            row.industryCount = row.industryKeys.size;
            row.sourceRatio = row.visibleDegree ? row.sourced / row.visibleDegree : 0;
            row.centrality = row.visibleDegree * 2.4 +
                row.avgStrength * 16 +
                row.marketCap * 5.4 +
                Math.max(0, 120 - row.rank) * 0.08 +
                row.corridorCount * 5 +
                row.ecosystemCount * 4 +
                row.bridgeEdges * 1.6 +
                row.secBacked * 1.8 +
                row.sourced * 0.9;
        });

        return metrics;
    }

    function buildCorridorPressures(links, context, density) {
        const byKey = new Map();
        links.forEach(link => {
            const corridorKeys = getLinkCorridorKeys(link, context);
            corridorKeys.forEach(key => {
                const row = byKey.get(key) || {
                    key,
                    label: formatKey(key),
                    shortLabel: formatKey(key).split(' ').slice(0, 2).join(' '),
                    color: getCorridorColor(key),
                    edgeCount: 0,
                    strength: 0,
                    sourced: 0,
                    secBacked: 0,
                    bridgeEdges: 0,
                    routeEdges: 0,
                    linkKeys: new Set()
                };
                row.edgeCount += 1;
                row.strength += clamp01(Number(link.strength) || 0);
                row.linkKeys.add(link.key);
                if (context.relationshipHasSourceEvidence?.(link)) row.sourced += 1;
                if (context.isSecBackedConnection?.(link)) row.secBacked += 1;
                if (link.source?.sector && link.target?.sector && link.source.sector !== link.target.sector) row.bridgeEdges += 1;
                if (context.activeRouteComparison?.linkKeys?.has(link.key) || context.activeRelationshipRoute?.linkKeys?.has(link.key)) row.routeEdges += 1;
                byKey.set(key, row);
            });
        });
        const divisor = density.key === 'mega' ? 34 : density.key === 'very_dense' ? 28 : density.key === 'dense' ? 22 : 16;
        return [...byKey.values()]
            .map(row => ({
                ...row,
                avgStrength: row.edgeCount ? row.strength / row.edgeCount : 0,
                sourceRatio: row.edgeCount ? row.sourced / row.edgeCount : 0,
                pressure: clamp01((row.edgeCount / divisor) * 0.48 + (row.strength / Math.max(1, row.edgeCount)) * 0.28 + (row.bridgeEdges / Math.max(1, row.edgeCount)) * 0.16 + (row.routeEdges ? 0.24 : 0))
            }))
            .sort((a, b) => b.pressure - a.pressure || b.edgeCount - a.edgeCount || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 8 : 10);
    }

    function buildDensityZones(nodes, links, context, nodeMetrics, density) {
        const tileSize = density.key === 'mega' ? 520 : density.key === 'very_dense' ? 440 : density.key === 'dense' ? 360 : 300;
        const tiles = new Map();
        const getPosition = context.getNodeLayoutPosition || (node => node || { x: 0, y: 0 });
        nodes.forEach(node => {
            const position = getPosition(node);
            const key = `${Math.floor((Number(position.x) || 0) / tileSize)}:${Math.floor((Number(position.y) || 0) / tileSize)}`;
            const metric = nodeMetrics.get(node.id) || {};
            const tile = tiles.get(key) || {
                key,
                kind: 'density',
                x: 0,
                y: 0,
                nodeCount: 0,
                edgeCount: 0,
                marketCap: 0,
                score: 0,
                labels: new Map()
            };
            tile.nodeCount += 1;
            tile.x += Number(position.x) || 0;
            tile.y += Number(position.y) || 0;
            tile.marketCap += Number(metric.marketCap) || 0;
            tile.score += Number(metric.centrality) || 0;
            increment(tile.labels, node.sector || 'Market');
            tiles.set(key, tile);
        });
        links.forEach(link => {
            const source = link.source ? getPosition(link.source) : null;
            if (!source) return;
            const key = `${Math.floor((Number(source.x) || 0) / tileSize)}:${Math.floor((Number(source.y) || 0) / tileSize)}`;
            const tile = tiles.get(key);
            if (tile) {
                tile.edgeCount += 1;
                tile.score += clamp01(Number(link.strength) || 0) * 4;
            }
        });
        return [...tiles.values()]
            .filter(tile => tile.nodeCount >= 2 || tile.edgeCount >= 3)
            .map(tile => {
                const dominant = [...tile.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'Market topology';
                return {
                    ...tile,
                    x: tile.x / Math.max(1, tile.nodeCount),
                    y: tile.y / Math.max(1, tile.nodeCount),
                    label: dominant,
                    radius: tileSize * clamp(0.42 + tile.nodeCount / 24 + tile.edgeCount / 70, 0.52, 1.24),
                    color: ZONE_COLORS.density,
                    alpha: clamp(0.038 + tile.score / 900, 0.04, 0.095)
                };
            })
            .sort((a, b) => b.score - a.score || b.edgeCount - a.edgeCount || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 5 : 7);
    }

    function buildConcentrationZones(nodes, nodeMetrics, context, density) {
        const getPosition = context.getNodeLayoutPosition || (node => node || { x: 0, y: 0 });
        return nodes
            .map(node => {
                const metric = nodeMetrics.get(node.id) || {};
                const position = getPosition(node);
                const capitalWeight = Math.sqrt(Math.max(0, Number(metric.marketCap) || 0));
                const infrastructureWeight = Number(metric.visibleDegree || 0) + Number(metric.corridorCount || 0) * 4 + Number(metric.ecosystemCount || 0) * 3;
                const kind = capitalWeight * 4.5 >= infrastructureWeight ? 'capital' : 'infrastructure';
                return {
                    kind,
                    nodeId: node.id,
                    label: node.ticker || node.name || 'Hub',
                    x: Number(position.x) || 0,
                    y: Number(position.y) || 0,
                    marketCap: Number(metric.marketCap) || 0,
                    visibleDegree: Number(metric.visibleDegree) || 0,
                    corridorCount: Number(metric.corridorCount) || 0,
                    ecosystemCount: Number(metric.ecosystemCount) || 0,
                    score: capitalWeight * 10 + infrastructureWeight * 1.7 + Number(metric.sourceRatio || 0) * 8,
                    color: kind === 'capital' ? ZONE_COLORS.capital : ZONE_COLORS.infrastructure,
                    radius: kind === 'capital' ? 240 : 210,
                    alpha: kind === 'capital' ? 0.07 : 0.058
                };
            })
            .filter(zone => zone.score >= (density.key === 'mega' ? 18 : 12))
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 5 : 7);
    }

    function buildBridgeSaturation(nodes, nodeMetrics, context, density) {
        return nodes
            .map(node => {
                const metric = nodeMetrics.get(node.id) || {};
                const score = Number(metric.bridgeEdges || 0) * 3 +
                    Number(metric.sectorCount || 0) * 5 +
                    Number(metric.industryCount || 0) * 2.5 +
                    Number(metric.corridorCount || 0) * 4 +
                    Number(metric.ecosystemCount || 0) * 3 +
                    Number(metric.avgStrength || 0) * 8;
                return {
                    node,
                    nodeId: node.id,
                    label: node.ticker || node.name || 'Bridge',
                    score,
                    bridgeEdges: Number(metric.bridgeEdges) || 0,
                    sectorCount: Number(metric.sectorCount) || 0,
                    corridorCount: Number(metric.corridorCount) || 0,
                    ecosystemCount: Number(metric.ecosystemCount) || 0
                };
            })
            .filter(item => item.score >= (density.key === 'mega' ? 28 : 20))
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 10 : 14);
    }

    function buildEcosystemOverlap(nodes, links, nodeMetrics, context, density) {
        const overlapNodes = nodes
            .map(node => {
                const metric = nodeMetrics.get(node.id) || {};
                return {
                    node,
                    nodeId: node.id,
                    label: node.ticker || node.name || 'Overlap',
                    ecosystemCount: Number(metric.ecosystemCount) || 0,
                    corridorCount: Number(metric.corridorCount) || 0,
                    score: Number(metric.ecosystemCount || 0) * 8 + Number(metric.corridorCount || 0) * 5 + Number(metric.visibleDegree || 0)
                };
            })
            .filter(item => item.ecosystemCount >= 2 || item.corridorCount >= 2)
            .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
            .slice(0, density.key === 'mega' ? 10 : 14);

        const overlapLinks = links
            .map(link => ({
                link,
                key: link.key,
                ecosystemCount: getLinkEcosystemKeys(link, context).length,
                corridorCount: getLinkCorridorKeys(link, context).length,
                strength: clamp01(Number(link.strength) || 0)
            }))
            .filter(item => item.ecosystemCount >= 2 || item.corridorCount >= 2)
            .sort((a, b) => b.ecosystemCount - a.ecosystemCount || b.corridorCount - a.corridorCount || b.strength - a.strength)
            .slice(0, density.key === 'mega' ? 36 : 54);

        return {
            nodes: overlapNodes,
            links: overlapLinks,
            nodeIds: new Set(overlapNodes.map(item => item.nodeId)),
            linkKeys: new Set(overlapLinks.map(item => item.key)),
            intensity: clamp01((overlapNodes.length + overlapLinks.length) / Math.max(1, nodes.length + links.length) * 6)
        };
    }

    function buildRouteImportance(context, links, nodeMetrics, corridorPressures) {
        const route = context.activeRouteComparison || context.activeRelationshipRoute || null;
        const routeKeys = route?.linkKeys || new Set();
        const corridorByKey = new Map((corridorPressures || []).map(item => [item.key, item]));
        const importantLinks = links
            .map(link => {
                const source = nodeMetrics.get(link.source?.id) || {};
                const target = nodeMetrics.get(link.target?.id) || {};
                const corridorKeys = getLinkCorridorKeys(link, context);
                const corridorPressure = corridorKeys.reduce((max, key) => Math.max(max, corridorByKey.get(key)?.pressure || 0), 0);
                const activeRoute = routeKeys.has(link.key);
                const bridge = link.source?.sector && link.target?.sector && link.source.sector !== link.target.sector;
                const score = clamp01(Number(link.strength) || 0) * 48 +
                    Math.min(40, (Number(source.centrality) || 0) + (Number(target.centrality) || 0)) +
                    corridorPressure * 26 +
                    (activeRoute ? 90 : 0) +
                    (bridge ? 12 : 0) +
                    (context.relationshipHasSourceEvidence?.(link) ? 8 : 0) +
                    (context.isSecBackedConnection?.(link) ? 10 : 0);
                return {
                    key: link.key,
                    link,
                    score,
                    activeRoute,
                    bridge,
                    corridorKeys,
                    corridorPressure
                };
            })
            .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)))
            .slice(0, routeKeys.size ? Math.max(18, routeKeys.size) : 28);
        return {
            mode: context.activeRouteComparison ? 'comparison' : context.activeRelationshipRoute ? 'active-route' : 'market-centrality',
            links: importantLinks,
            linkKeys: new Set(importantLinks.map(item => item.key)),
            activeRouteLinkCount: importantLinks.filter(item => item.activeRoute).length,
            avgScore: importantLinks.length ? importantLinks.reduce((sum, item) => sum + item.score, 0) / importantLinks.length : 0
        };
    }

    function buildNodeVisuals(nodes, nodeMetrics, concentrationZones, bridgeSaturation, ecosystemOverlap, density) {
        const visuals = new Map();
        const concentrationIds = new Map(concentrationZones.map(zone => [zone.nodeId, zone]));
        const bridgeIds = new Map(bridgeSaturation.map(item => [item.nodeId, item]));
        const overlapIds = ecosystemOverlap.nodeIds || new Set();
        nodes.forEach(node => {
            const metric = nodeMetrics.get(node.id) || {};
            const concentration = concentrationIds.get(node.id);
            const bridge = bridgeIds.get(node.id);
            const overlap = overlapIds.has(node.id);
            if (!concentration && !bridge && !overlap && Number(metric.centrality || 0) < 18) return;
            const score = Number(concentration?.score || 0) + Number(bridge?.score || 0) * 0.62 + Number(metric.centrality || 0) * 0.38 + (overlap ? 12 : 0);
            visuals.set(node.id, {
                emphasized: true,
                kind: concentration?.kind || (bridge ? 'bridge' : overlap ? 'ecosystem' : 'density'),
                score,
                color: concentration?.color || (bridge ? ZONE_COLORS.bridge : overlap ? ZONE_COLORS.ecosystem : ZONE_COLORS.density),
                alphaFloor: density.key === 'mega' ? 0.72 : 0.78,
                radiusMultiplier: clamp(1 + score / 210, 1.02, 1.18),
                glowMultiplier: clamp(0.9 + score / 180, 0.98, 1.28),
                labelPriorityBoost: clamp(score * 4, 60, 440),
                badgeLabel: concentration?.kind === 'capital' ? 'CAP' : bridge ? 'BRG' : overlap ? 'OVR' : 'HUB'
            });
        });
        return visuals;
    }

    function buildLinkVisuals(links, corridorPressures, routeImportance, context, density) {
        const visuals = new Map();
        const corridorByKey = new Map((corridorPressures || []).map(item => [item.key, item]));
        const routeKeys = routeImportance.linkKeys || new Set();
        links.forEach(link => {
            const corridorKeys = getLinkCorridorKeys(link, context);
            const corridor = corridorKeys.map(key => corridorByKey.get(key)).filter(Boolean).sort((a, b) => b.pressure - a.pressure)[0] || null;
            const routeImportant = routeKeys.has(link.key);
            const bridge = link.source?.sector && link.target?.sector && link.source.sector !== link.target.sector;
            const pressure = Math.max(corridor?.pressure || 0, routeImportant ? 0.88 : 0, bridge ? 0.45 : 0);
            if (pressure < 0.34 && !routeImportant) return;
            visuals.set(link.key, {
                emphasized: true,
                pressure,
                corridorKey: corridor?.key || corridorKeys[0] || '',
                color: routeImportant ? '#ffffff' : corridor?.color || (bridge ? ZONE_COLORS.bridge : ZONE_COLORS.density),
                alphaFloor: clamp(0.2 + pressure * 0.42, 0.24, routeImportant ? 0.78 : 0.58),
                widthBoost: clamp(pressure * 1.25, 0.28, routeImportant ? 1.8 : 1.15),
                shadowMultiplier: clamp(0.85 + pressure * 0.52, 0.92, 1.42),
                priorityBoost: routeImportant ? 720 : clamp(pressure * 280, 80, 320),
                protected: Boolean(routeImportant || pressure > 0.72 && density.key !== 'mega'),
                routeImportant,
                bridgeSaturation: bridge
            });
        });
        return visuals;
    }

    function buildSemanticTopologySummary(parts) {
        const topZone = parts.concentrationZones?.[0] || parts.densityZones?.[0] || null;
        const topCorridor = parts.corridorPressures?.[0] || null;
        const topBridge = parts.bridgeSaturation?.[0] || null;
        const overlapCount = parts.ecosystemOverlap?.nodes?.length || 0;
        const imbalance = calculateTopologyImbalance(parts.densityZones || [], parts.corridorPressures || []);
        const sentence = topCorridor
            ? `${topCorridor.shortLabel || topCorridor.label} is the dominant visible corridor with ${topCorridor.edgeCount} edges; ${topBridge?.label || topZone?.label || 'the current topology'} carries the strongest bridge or concentration cue.`
            : `${parts.nodes.length} visible companies and ${parts.links.length} visible edges are arranged as a ${parts.density.label || parts.density.key || 'loaded'} topology.`;
        return {
            headline: topCorridor?.shortLabel || topZone?.label || 'Market topology',
            sentence,
            topCorridor: topCorridor?.label || '',
            topZone: topZone?.label || '',
            topBridge: topBridge?.label || '',
            overlapCount,
            routeMode: parts.routeImportance?.mode || 'market-centrality',
            imbalance,
            chips: [
                parts.density.label || formatKey(parts.density.key),
                topCorridor ? `${topCorridor.edgeCount} corridor edges` : `${parts.links.length} edges`,
                overlapCount ? `${overlapCount} overlaps` : '',
                imbalance > 0.58 ? 'imbalanced topology' : 'balanced enough'
            ].filter(Boolean).slice(0, 4),
            deterministic: true,
            metadataDerivedOnly: true
        };
    }

    function buildVisualBudget(density, semantic = {}) {
        const tier = semantic.tier || 'relationship';
        return {
            densityZoneLimit: tier === 'macro' ? 5 : density.key === 'mega' ? 3 : 4,
            concentrationZoneLimit: tier === 'macro' ? 4 : 3,
            corridorLabelLimit: density.key === 'mega' ? 2 : 3,
            topologyBadgeLimit: density.key === 'mega' ? 14 : density.key === 'very_dense' ? 20 : 28
        };
    }

    function calculateTopologyImbalance(zones, corridors) {
        const zoneScores = zones.map(zone => Number(zone.score) || 0);
        const corridorScores = corridors.map(corridor => Number(corridor.edgeCount) || 0);
        return Math.max(calculateConcentrationRatio(zoneScores), calculateConcentrationRatio(corridorScores));
    }

    function calculateConcentrationRatio(values) {
        const sorted = values.filter(value => value > 0).sort((a, b) => b - a);
        const total = sorted.reduce((sum, value) => sum + value, 0);
        if (!total) return 0;
        return sorted.slice(0, 2).reduce((sum, value) => sum + value, 0) / total;
    }

    function getLinkEcosystemKeys(link, context) {
        const keys = context.stockGraphIntelligence?.getLinkEcosystemKeys?.(link, context);
        return Array.isArray(keys) ? keys.filter(Boolean) : [];
    }

    function getLinkCorridorKeys(link, context) {
        const spatial = context.getGraphLinkSpatialMeta?.(link) || {};
        if (Array.isArray(spatial.corridorKeys) && spatial.corridorKeys.length) return spatial.corridorKeys.filter(Boolean);
        if (spatial.primaryCorridorKey) return [spatial.primaryCorridorKey];
        return [];
    }

    function getCorridorColor(key) {
        return window.StockPhotonicGraph?.cinematic?.getCorridorMeta?.(key)?.color || ZONE_COLORS.density;
    }

    function normalizeDensity(source = {}, nodeCount = 0, edgeCount = 0) {
        const ratio = Number(source.ratio || source.density || edgeCount / Math.max(1, nodeCount)) || 0;
        const key = source.key || (nodeCount > 520 || edgeCount > 1100 || ratio > 4.2
            ? 'mega'
            : nodeCount > 160 || edgeCount > 360 || ratio > 3.15
                ? 'very_dense'
                : nodeCount > 100 || edgeCount > 210 || ratio > 2.25
                    ? 'dense'
                    : 'core');
        return {
            key,
            label: source.label || formatKey(key),
            nodeCount,
            edgeCount,
            ratio
        };
    }

    function getSignature(context, nodes, links, density, semantic) {
        return [
            nodes.length,
            links.length,
            density.key,
            Math.round((Number(context.scale) || 1) * 18),
            semantic.tier || '',
            context.layoutMode || '',
            context.largeGraphNavigationModel?.cacheKey || context.largeGraphNavigationModel?.mode || '',
            context.activeEcosystemOverlayKey || '',
            context.activeAnalystOverlayKey || '',
            context.activeRelationshipRoute?.id || '',
            context.activeRouteComparison?.id || '',
            context.selectedNode?.id || ''
        ].join('|');
    }

    function createLru(limit) {
        const map = new Map();
        return {
            get(key) {
                if (!map.has(key)) return null;
                const value = map.get(key);
                map.delete(key);
                map.set(key, value);
                return value;
            },
            set(key, value) {
                if (map.has(key)) map.delete(key);
                map.set(key, value);
                while (map.size > limit) map.delete(map.keys().next().value);
            },
            stats() {
                return { size: map.size, limit };
            }
        };
    }

    function increment(map, key) {
        map.set(key, (map.get(key) || 0) + 1);
    }

    function count(value) {
        if (Array.isArray(value)) return value.length;
        if (value instanceof Map || value instanceof Set) return value.size;
        return 0;
    }

    function toRgba(context, color, alpha) {
        if (typeof context.hexToRgba === 'function' && /^#/.test(color || '')) return context.hexToRgba(color, alpha);
        return `rgba(34, 211, 238, ${alpha})`;
    }

    function clamp01(value) {
        return clamp(value, 0, 1);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    }

    function formatKey(key) {
        return String(key || 'topology')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicGraph.topologyEngine = {
        createTopologyController,
        drawTopologyField,
        getNodeTopologyVisual,
        getLinkTopologyVisual,
        getValidationSummary
    };
})();
