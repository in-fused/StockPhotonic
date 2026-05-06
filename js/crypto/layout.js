(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    if (!core) {
        throw new Error('CryptoPhotonic core module must load before layout module');
    }

    function layoutGraph(graph, options = {}) {
        const width = Math.max(320, Number(options.width) || 960);
        const height = Math.max(420, Number(options.height) || 620);
        const center = { x: width * 0.48, y: height * 0.5 };
        const walletNodes = [...(graph.walletNodes || [])].sort(sortByStableNodeKey);
        const tokenNodes = [...(graph.tokenNodes || [])].sort(sortByStableNodeKey);
        const hubNodes = [...(graph.hubNodes || graph.entityNodes || [])].sort((a, b) => (b.aggregate_value_usd || 0) - (a.aggregate_value_usd || 0) || sortByStableNodeKey(a, b));
        const flowEdges = [...(graph.flowEdges || [])].sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
        const maxFlowValue = Math.max(1, ...flowEdges.map(edge => Number(edge.usd_value) || 0));
        const maxNodeExposure = Math.max(1, ...graph.nodes.map(node => Number(node.exposure_usd || node.aggregate_value_usd) || 0));
        const positions = new Map();
        const hubPositions = placeHubs(hubNodes, center, width, height, positions);
        const clusters = groupWallets(walletNodes, graph.labelEdges || [], graph.nodeById);
        const clusterEntries = [...clusters.entries()].sort(([a], [b]) => a.localeCompare(b));
        const fallbackClusterRadius = Math.min(width, height) * 0.27;

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
            const walletRadius = Math.max(56, Math.min(146, (hubNode?.radius || 26) + 48 + wallets.length * 13));

            wallets
                .sort((a, b) => (b.exposure_usd || 0) - (a.exposure_usd || 0) || sortByStableNodeKey(a, b))
                .forEach((wallet, walletIndex) => {
                    const angle = wallets.length === 1
                        ? clusterAngle + Math.PI
                        : clusterAngle + (Math.PI * 2 * walletIndex) / wallets.length;
                    positions.set(wallet.id, {
                        x: clusterCenter.x + Math.cos(angle) * walletRadius,
                        y: clusterCenter.y + Math.sin(angle) * walletRadius * 0.72,
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
            const offsetAngle = -Math.PI / 2 + tokenIndex * 0.92;
            positions.set(token.id, {
                x: anchor.x + Math.cos(offsetAngle) * 92,
                y: anchor.y + Math.sin(offsetAngle) * 68,
                cluster_key: token.cluster_key,
                layer: 'token'
            });
        });

        const laidOutNodes = graph.nodes.map(node => {
            const position = positions.get(node.id) || center;
            return {
                ...node,
                x: clamp(position.x, 42, width - 42),
                y: clamp(position.y, 42, height - 42),
                layout_layer: position.layer || node.type,
                radius: getNodeRadius(node, maxNodeExposure),
                color: getNodeColor(node)
            };
        });

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
            layout: {
                mode: 'deterministic_hub_flow_v1',
                supports_transaction_tree_expansion: true,
                max_flow_value: maxFlowValue
            }
        };
    }

    function placeHubs(hubNodes, center, width, height, positions) {
        const hubPositions = new Map();
        const anchorRadius = Math.min(width, height) * (hubNodes.length <= 1 ? 0 : 0.2);
        hubNodes.forEach((hub, hubIndex) => {
            const angle = hubNodes.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * hubIndex) / hubNodes.length;
            const valueRankOffset = Math.max(0, hubIndex - 1) * 9;
            const position = {
                x: center.x + Math.cos(angle) * (anchorRadius + valueRankOffset),
                y: center.y + Math.sin(angle) * (anchorRadius + valueRankOffset) * 0.7,
                cluster_key: hub.id,
                layer: 'hub'
            };
            positions.set(hub.id, position);
            hubPositions.set(hub.id, position);
        });
        return hubPositions;
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
            return 1 + ratio * 2.6;
        }
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 1.1 + Math.min(1.9, Math.sqrt(Math.max(0, edge.usd_value || 0)) / 210);
        const ratio = Math.max(0, Math.min(1, (Number(edge.usd_value) || 0) / maxFlowValue));
        return 1.6 + Math.sqrt(ratio) * 6.4;
    }

    function getEdgeOpacity(edge, isLargeValue = false) {
        if (edge.type === core.EDGE_TYPES.LABEL) return edge.usd_value ? 0.5 : 0.34;
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0.42;
        return isLargeValue ? 0.98 : 0.68;
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
