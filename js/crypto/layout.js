(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    if (!core) {
        throw new Error('CryptoPhotonic core module must load before layout module');
    }

    function layoutGraph(graph, options = {}) {
        const width = Math.max(320, Number(options.width) || 960);
        const height = Math.max(420, Number(options.height) || 620);
        const workspace = getWorkspaceBounds(width, height);
        const center = { x: width * 0.48, y: height * 0.5 };
        const walletNodes = [...(graph.walletNodes || [])].sort(sortByStableNodeKey);
        const tokenNodes = [...(graph.tokenNodes || [])].sort(sortByStableNodeKey);
        const hubNodes = [...(graph.hubNodes || graph.entityNodes || [])].sort((a, b) => (b.aggregate_value_usd || 0) - (a.aggregate_value_usd || 0) || sortByStableNodeKey(a, b));
        const flowEdges = [...(graph.flowEdges || [])].sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
        const maxFlowValue = Math.max(1, ...flowEdges.map(edge => Number(edge.usd_value) || 0));
        const maxNodeExposure = Math.max(1, ...graph.nodes.map(node => Number(node.exposure_usd || node.aggregate_value_usd) || 0));
        const maxWalletExposure = Math.max(1, ...walletNodes.map(node => Number(node.exposure_usd) || 0));
        const maxTokenExposure = Math.max(1, ...tokenNodes.map(node => Number(node.exposure_usd) || 0));
        const walletLabelRanks = rankNodesByValue(walletNodes, node => Number(node.exposure_usd) || 0);
        const tokenLabelRanks = rankNodesByValue(tokenNodes, node => Number(node.exposure_usd) || 0);
        const positions = new Map();
        const hubPositions = placeHubs(hubNodes, center, width, height, positions);
        const clusters = groupWallets(walletNodes, graph.labelEdges || [], graph.nodeById);
        const clusterEntries = [...clusters.entries()].sort(([a], [b]) => a.localeCompare(b));
        const topologyScale = getTopologyScale(graph);
        const fallbackClusterRadius = Math.min(width, height) * (0.38 + Math.min(0.08, clusterEntries.length * 0.012));

        clusterEntries.forEach(([clusterKey, wallets], clusterIndex) => {
            const hubAnchor = hubPositions.get(clusterKey);
            const clusterAngle = clusterEntries.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * clusterIndex) / clusterEntries.length;
            const clusterCenter = hubAnchor || {
                x: center.x + Math.cos(clusterAngle) * fallbackClusterRadius,
                y: center.y + Math.sin(clusterAngle) * fallbackClusterRadius * 0.72
            };
            const hubNode = graph.nodeById?.get(clusterKey);
            const walletRadius = Math.max(128, Math.min(330, ((hubNode?.radius || 26) + 98 + wallets.length * 24) * topologyScale));

            wallets
                .sort((a, b) => (b.exposure_usd || 0) - (a.exposure_usd || 0) || sortByStableNodeKey(a, b))
                .forEach((wallet, walletIndex) => {
                    const angle = wallets.length === 1
                        ? clusterAngle + Math.PI
                        : clusterAngle + (Math.PI * 2 * walletIndex) / wallets.length;
                    positions.set(wallet.id, {
                        x: clusterCenter.x + Math.cos(angle) * walletRadius,
                        y: clusterCenter.y + Math.sin(angle) * walletRadius * 0.82,
                        cluster_key: clusterKey,
                        layer: 'wallet'
                    });
                });
        });

        hubNodes.forEach(hub => {
            if (positions.has(hub.id)) return;
            const relatedWalletPositions = (graph.labelEdges || [])
                .filter(edge => edge.target === hub.id)
                .map(edge => positions.get(edge.source))
                .filter(Boolean);
            const anchor = centroidOrDefault(relatedWalletPositions, center);
            positions.set(hub.id, {
                x: anchor.x,
                y: anchor.y,
                cluster_key: hub.label,
                layer: 'hub'
            });
        });

        tokenNodes.forEach((token, tokenIndex) => {
            const relatedWalletPositions = (graph.exposureEdges || [])
                .filter(edge => edge.target === token.id)
                .map(edge => positions.get(edge.source))
                .filter(Boolean);
            const anchor = centroidOrDefault(relatedWalletPositions, {
                x: center.x + Math.cos(tokenIndex) * Math.min(width, height) * 0.18,
                y: center.y + Math.sin(tokenIndex) * Math.min(width, height) * 0.14
            });
            const offsetAngle = -Math.PI / 2 + tokenIndex * 1.08;
            const tokenDistance = clamp(174 + relatedWalletPositions.length * 24, 184, 330);
            positions.set(token.id, {
                x: anchor.x + Math.cos(offsetAngle) * tokenDistance,
                y: anchor.y + Math.sin(offsetAngle) * tokenDistance * 0.86,
                cluster_key: token.cluster_key,
                layer: 'token'
            });
        });

        let laidOutNodes = graph.nodes.map(node => {
            const position = positions.get(node.id) || center;
            return {
                ...node,
                x: clamp(position.x, 42, width - 42),
                y: clamp(position.y, 42, height - 42),
                layout_layer: position.layer || node.type,
                label_priority: getLabelPriority(node, walletLabelRanks, tokenLabelRanks, maxWalletExposure, maxTokenExposure),
                radius: getNodeRadius(node, maxNodeExposure),
                color: getNodeColor(node)
            };
        });
        laidOutNodes = resolveNodeOverlaps(laidOutNodes, width, height);

        const laidOutEdges = graph.edges.map(edge => {
            const isLargeValue = edge.type === core.EDGE_TYPES.FLOW && (Number(edge.usd_value) || 0) >= maxFlowValue * 0.72;
            return {
                ...edge,
                width: getEdgeWidth(edge, maxFlowValue),
                opacity: getEdgeOpacity(edge, isLargeValue),
                color: getEdgeColor(edge),
                is_large_value: isLargeValue
            };
        });

        return {
            ...graph,
            nodes: laidOutNodes,
            edges: laidOutEdges,
            nodeById: new Map(laidOutNodes.map(node => [node.id, node])),
            walletNodes: laidOutNodes.filter(node => node.type === core.NODE_TYPES.WALLET),
            tokenNodes: laidOutNodes.filter(node => node.type === core.NODE_TYPES.TOKEN),
            hubNodes: laidOutNodes.filter(isHubNode),
            entityNodes: laidOutNodes.filter(isHubNode),
            flowEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.FLOW),
            exposureEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.EXPOSURE),
            labelEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.LABEL),
            bounds: { width, height },
            workspace,
            layout: {
                mode: 'liquidity_topology_v3',
                supports_transaction_tree_expansion: true,
                supports_cluster_breathing_room: true,
                supports_flow_topology_grouping: true,
                workspace_padding_x: workspace.paddingX,
                workspace_padding_y: workspace.paddingY,
                max_flow_value: maxFlowValue,
                major_wallet_threshold: Math.max(1, maxWalletExposure * 0.42),
                major_token_threshold: Math.max(1, maxTokenExposure * 0.5)
            }
        };
    }

    function getWorkspaceBounds(width, height) {
        const paddingX = Math.max(width * 2.35, 760);
        const paddingY = Math.max(height * 2.35, 840);
        return {
            minX: -paddingX,
            maxX: width + paddingX,
            minY: -paddingY,
            maxY: height + paddingY,
            width: width + paddingX * 2,
            height: height + paddingY * 2,
            paddingX,
            paddingY
        };
    }

    function getTopologyScale(graph) {
        const nodeCount = graph?.nodes?.length || 0;
        const flowCount = graph?.flowEdges?.length || 0;
        if (nodeCount > 120 || flowCount > 260) return 1.22;
        if (nodeCount > 70 || flowCount > 150) return 1.14;
        if (nodeCount > 36 || flowCount > 80) return 1.08;
        return 1;
    }

    function placeHubs(hubNodes, center, width, height, positions) {
        const hubPositions = new Map();
        const anchorRadius = Math.min(width, height) * (hubNodes.length <= 1 ? 0 : Math.min(0.43, 0.32 + hubNodes.length * 0.012));
        hubNodes.forEach((hub, hubIndex) => {
            const angle = hubNodes.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * hubIndex) / hubNodes.length;
            const valueRankOffset = Math.max(0, hubIndex - 1) * 16;
            const position = {
                x: center.x + Math.cos(angle) * (anchorRadius + valueRankOffset),
                y: center.y + Math.sin(angle) * (anchorRadius + valueRankOffset) * 0.82,
                cluster_key: hub.id,
                layer: 'hub'
            };
            positions.set(hub.id, position);
            hubPositions.set(hub.id, position);
        });
        return hubPositions;
    }

    function rankNodesByValue(nodes, getValue) {
        return new Map([...nodes]
            .sort((a, b) => getValue(b) - getValue(a) || sortByStableNodeKey(a, b))
            .map((node, index) => [node.id, index]));
    }

    function getLabelPriority(node, walletLabelRanks, tokenLabelRanks, maxWalletExposure, maxTokenExposure) {
        if (isHubNode(node)) return 'hub';
        const exposure = Number(node.exposure_usd) || 0;
        if (node.type === core.NODE_TYPES.TOKEN) {
            const rank = tokenLabelRanks.get(node.id) ?? Infinity;
            return rank < 2 || exposure >= maxTokenExposure * 0.5 ? 'major' : 'minor';
        }
        if (node.type === core.NODE_TYPES.WALLET) {
            const rank = walletLabelRanks.get(node.id) ?? Infinity;
            return rank < 3 || exposure >= maxWalletExposure * 0.42 ? 'major' : 'minor';
        }
        return 'minor';
    }

    function resolveNodeOverlaps(nodes, width, height) {
        const laidOut = nodes.map(node => ({ ...node }));
        const densityScale = laidOut.length > 120 ? 1.3 : laidOut.length > 70 ? 1.18 : 1.08;
        const padding = 26 * densityScale;

        for (let pass = 0; pass < 14; pass += 1) {
            let moved = false;
            for (let i = 0; i < laidOut.length; i += 1) {
                for (let j = i + 1; j < laidOut.length; j += 1) {
                    const a = laidOut[i];
                    const b = laidOut[j];
                    const minDistance = (a.radius || 18) + (b.radius || 18) + padding;
                    let dx = b.x - a.x;
                    let dy = b.y - a.y;
                    let distance = Math.hypot(dx, dy);

                    if (distance >= minDistance) continue;
                    if (distance < 0.01) {
                        const angle = stableAngle(`${a.id}:${b.id}`);
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                        distance = 1;
                    }

                    const push = (minDistance - distance) / distance;
                    const aWeight = isHubNode(a) ? 0.34 : isHubNode(b) ? 0.66 : 0.5;
                    const bWeight = 1 - aWeight;
                    a.x -= dx * push * aWeight;
                    a.y -= dy * push * aWeight;
                    b.x += dx * push * bWeight;
                    b.y += dy * push * bWeight;
                    moved = true;
                }
            }

            laidOut.forEach(node => {
                const margin = Math.max(46, (node.radius || 18) + 18);
                node.x = clamp(node.x, margin, width - margin);
                node.y = clamp(node.y, margin, height - margin);
            });

            if (!moved) break;
        }

        return laidOut;
    }

    function stableAngle(value) {
        let hash = 0;
        String(value).split('').forEach(char => {
            hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        });
        return ((Math.abs(hash) % 360) / 180) * Math.PI;
    }

    function groupWallets(walletNodes, labelEdges, nodeById) {
        const labelByWalletId = new Map();
        labelEdges.forEach(edge => {
            if (edge.type !== core.EDGE_TYPES.LABEL) return;
            const walletId = edge.source;
            const hubId = edge.target;
            const hub = nodeById?.get(hubId);
            if (!isHubNode(hub)) return;
            const weight = Number(edge.usd_value) || Number(hub.aggregate_value_usd) || Number(edge.transaction_count) || 1;
            const existing = labelByWalletId.get(walletId);
            if (!existing || weight > existing.weight || (weight === existing.weight && hubId.localeCompare(existing.hubId) < 0)) {
                labelByWalletId.set(walletId, { hubId, weight });
            }
        });

        return walletNodes.reduce((groups, wallet) => {
            const key = labelByWalletId.get(wallet.id)?.hubId || wallet.cluster_key || wallet.chain || 'wallets';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(wallet);
            return groups;
        }, new Map());
    }

    function centroidOrDefault(points, fallback) {
        if (!points.length) return { ...fallback };
        const totals = points.reduce((acc, point) => ({
            x: acc.x + point.x,
            y: acc.y + point.y
        }), { x: 0, y: 0 });
        return {
            x: totals.x / points.length,
            y: totals.y / points.length
        };
    }

    function getNodeRadius(node, maxNodeExposure = 1) {
        const exposure = Math.max(0, Number(node.exposure_usd) || 0);
        const ratio = Math.sqrt(exposure / Math.max(1, maxNodeExposure));
        if (node.type === core.NODE_TYPES.TOKEN) return clamp(15 + ratio * 16, 16, 31);
        if (isHubNode(node)) return clamp(25 + ratio * 24 + Math.min(8, (node.transaction_count || 0) * 1.2), 26, 52);
        return clamp(17 + ratio * 22, 18, 39);
    }

    function getNodeColor(node) {
        if (node.type === core.NODE_TYPES.TOKEN) return '#fbbf24';
        if (isHubNode(node)) {
            if (node.category === core.HUB_CATEGORIES.EXCHANGE) return '#38bdf8';
            if (node.category === core.HUB_CATEGORIES.DEFI_PROTOCOL) return '#34d399';
            if (node.category === core.HUB_CATEGORIES.LIQUIDITY_POOL) return '#f59e0b';
            if (node.category === core.HUB_CATEGORIES.BRIDGE) return '#fb7185';
            return '#a78bfa';
        }
        if (node.chain === 'polygon') return '#c084fc';
        return '#22d3ee';
    }

    function getEdgeWidth(edge, maxFlowValue) {
        if (edge.type === core.EDGE_TYPES.LABEL) {
            const ratio = Math.sqrt(Math.max(0, Number(edge.usd_value) || 0) / Math.max(1, maxFlowValue));
            return 0.8 + ratio * 1.8;
        }
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0.8 + Math.min(1.45, Math.sqrt(Math.max(0, edge.usd_value || 0)) / 260);
        const ratio = Math.max(0, Math.min(1, (Number(edge.usd_value) || 0) / maxFlowValue));
        return 1.25 + Math.sqrt(ratio) * 5.8;
    }

    function getEdgeOpacity(edge, isLargeValue = false) {
        if (edge.type === core.EDGE_TYPES.LABEL) return edge.usd_value ? 0.22 : 0.13;
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0.2;
        return isLargeValue ? 0.9 : 0.38;
    }

    function getEdgeColor(edge) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return '#facc15';
        if (edge.type === core.EDGE_TYPES.LABEL) {
            if (edge.hub_category === core.HUB_CATEGORIES.EXCHANGE) return '#38bdf8';
            if (edge.hub_category === core.HUB_CATEGORIES.DEFI_PROTOCOL) return '#34d399';
            if (edge.hub_category === core.HUB_CATEGORIES.LIQUIDITY_POOL) return '#f59e0b';
            if (edge.hub_category === core.HUB_CATEGORIES.BRIDGE) return '#fb7185';
            return '#a78bfa';
        }
        if (edge.flow_role === 'swap_route') return '#34d399';
        return edge.chain === 'polygon' ? '#d946ef' : '#22d3ee';
    }

    function sortByStableNodeKey(a, b) {
        return String(a.chain || '').localeCompare(String(b.chain || ''))
            || String(a.label || a.symbol || a.address || a.id).localeCompare(String(b.label || b.symbol || b.address || b.id));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function isHubNode(node) {
        return node?.type === core.NODE_TYPES.HUB || node?.type === core.NODE_TYPES.ENTITY;
    }

    namespace.layout = {
        layoutGraph
    };
})();
