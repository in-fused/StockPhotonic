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
        const entityNodes = [...(graph.entityNodes || [])].sort(sortByStableNodeKey);
        const flowEdges = [...(graph.flowEdges || [])].sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
        const maxFlowValue = Math.max(1, ...flowEdges.map(edge => Number(edge.usd_value) || 0));
        const positions = new Map();
        const clusters = groupWallets(walletNodes, graph.labelEdges || []);
        const clusterEntries = [...clusters.entries()].sort(([a], [b]) => a.localeCompare(b));
        const clusterRadius = Math.min(width, height) * 0.26;

        clusterEntries.forEach(([clusterKey, wallets], clusterIndex) => {
            const clusterAngle = clusterEntries.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * clusterIndex) / clusterEntries.length;
            const clusterCenter = {
                x: center.x + Math.cos(clusterAngle) * clusterRadius,
                y: center.y + Math.sin(clusterAngle) * clusterRadius * 0.72
            };
            const walletRadius = Math.max(48, Math.min(118, 42 + wallets.length * 14));

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

        entityNodes.forEach(entity => {
            const relatedWalletPositions = (graph.labelEdges || [])
                .filter(edge => edge.source === entity.id)
                .map(edge => positions.get(edge.target))
                .filter(Boolean);
            positions.set(entity.id, {
                ...centroidOrDefault(relatedWalletPositions, center),
                x: centroidOrDefault(relatedWalletPositions, center).x,
                y: centroidOrDefault(relatedWalletPositions, center).y - 86,
                cluster_key: entity.label,
                layer: 'entity'
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
                radius: getNodeRadius(node),
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
            entityNodes: laidOutNodes.filter(node => node.type === core.NODE_TYPES.ENTITY),
            flowEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.FLOW),
            exposureEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.EXPOSURE),
            labelEdges: laidOutEdges.filter(edge => edge.type === core.EDGE_TYPES.LABEL),
            bounds: { width, height },
            layout: {
                mode: 'deterministic_cluster_v1',
                supports_transaction_tree_expansion: true,
                max_flow_value: maxFlowValue
            }
        };
    }

    function groupWallets(walletNodes, labelEdges) {
        const labelByWalletId = new Map();
        labelEdges.forEach(edge => {
            if (edge.type === core.EDGE_TYPES.LABEL) labelByWalletId.set(edge.target, edge.source);
        });

        return walletNodes.reduce((groups, wallet) => {
            const key = labelByWalletId.get(wallet.id) || wallet.cluster_key || wallet.chain || 'wallets';
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

    function getNodeRadius(node) {
        const exposure = Math.max(0, Number(node.exposure_usd) || 0);
        if (node.type === core.NODE_TYPES.TOKEN) return clamp(14 + Math.sqrt(exposure) / 92, 16, 28);
        if (node.type === core.NODE_TYPES.ENTITY) return 18;
        return clamp(16 + Math.sqrt(exposure) / 82, 18, 34);
    }

    function getNodeColor(node) {
        if (node.type === core.NODE_TYPES.TOKEN) return '#fbbf24';
        if (node.type === core.NODE_TYPES.ENTITY) return '#a78bfa';
        if (node.chain === 'polygon') return '#c084fc';
        return '#22d3ee';
    }

    function getEdgeWidth(edge, maxFlowValue) {
        if (edge.type === core.EDGE_TYPES.LABEL) return 1;
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 1.4 + Math.min(2.2, Math.sqrt(Math.max(0, edge.usd_value || 0)) / 170);
        const ratio = Math.max(0, Math.min(1, (Number(edge.usd_value) || 0) / maxFlowValue));
        return 1.8 + ratio * 5.2;
    }

    function getEdgeOpacity(edge, isLargeValue = false) {
        if (edge.type === core.EDGE_TYPES.LABEL) return 0.38;
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0.56;
        return isLargeValue ? 0.95 : 0.76;
    }

    function getEdgeColor(edge) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return '#facc15';
        if (edge.type === core.EDGE_TYPES.LABEL) return '#a78bfa';
        return edge.chain === 'polygon' ? '#d946ef' : '#22d3ee';
    }

    function sortByStableNodeKey(a, b) {
        return String(a.chain || '').localeCompare(String(b.chain || ''))
            || String(a.label || a.symbol || a.address || a.id).localeCompare(String(b.label || b.symbol || b.address || b.id));
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    namespace.layout = {
        layoutGraph
    };
})();
