(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    function buildTopologyModel(options = {}) {
        const graph = options.graph || {};
        const visibleFlowEdges = Array.isArray(options.visibleFlowEdges) ? options.visibleFlowEdges : [];
        const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
        const edgeById = new Map(visibleFlowEdges.map(edge => [edge.id, edge]));
        const valueByNode = new Map();
        const flowCountByNode = new Map();
        const tokenExposure = new Map();
        const exchangeFlowIds = new Set();
        const funnelFlowIds = new Set();
        const replayFlowIds = new Set();

        visibleFlowEdges.forEach(edge => {
            const value = Math.max(0, Number(edge.usd_value) || 0);
            [edge.source, edge.target].forEach(id => {
                valueByNode.set(id, (valueByNode.get(id) || 0) + value);
                flowCountByNode.set(id, (flowCountByNode.get(id) || 0) + 1);
            });
            if (edge.symbol || edge.token_mint) {
                const key = `${edge.token_mint || ''}|${edge.symbol || ''}`;
                tokenExposure.set(key, (tokenExposure.get(key) || 0) + value);
            }
            if (isExchangeLikeFlow(edge, graph)) exchangeFlowIds.add(edge.id);
            if (isFunnelFlow(edge)) funnelFlowIds.add(edge.id);
        });

        const replay = graph.flowReplay?.ordered_flows || [];
        replay.slice(0, 80).forEach(item => {
            if (edgeById.has(item.id)) replayFlowIds.add(item.id);
        });

        const hubNodeIds = new Set(
            nodes
                .filter(node => isHubNode(node) || (flowCountByNode.get(node.id) || 0) >= 4)
                .map(node => node.id)
        );
        const priorityFlowIds = new Set(
            visibleFlowEdges
                .slice()
                .sort((a, b) => getFlowPriority(b, valueByNode, flowCountByNode, exchangeFlowIds, funnelFlowIds, replayFlowIds) -
                    getFlowPriority(a, valueByNode, flowCountByNode, exchangeFlowIds, funnelFlowIds, replayFlowIds))
                .slice(0, getPriorityFlowLimit(visibleFlowEdges.length))
                .map(edge => edge.id)
        );
        const clusterSummaries = buildClusterSummaries(nodes, valueByNode, flowCountByNode);

        return {
            nodeCount: nodes.length,
            visibleFlowCount: visibleFlowEdges.length,
            hubNodeIds,
            priorityFlowIds,
            exchangeFlowIds,
            funnelFlowIds,
            replayFlowIds,
            tokenExposure,
            clusterSummaries,
            selectedNodeId: options.selectedId || '',
            selectedFlowId: options.selectedFlowId || '',
            mode: options.mode || document.body?.dataset?.cryptoUxMode || 'flow'
        };
    }

    function getFlowPriority(edge, valueByNode, flowCountByNode, exchangeFlowIds, funnelFlowIds, replayFlowIds) {
        const value = Math.log10(Math.max(0, Number(edge.usd_value) || 0) + 1) * 18;
        const sourceCount = flowCountByNode.get(edge.source) || 0;
        const targetCount = flowCountByNode.get(edge.target) || 0;
        const endpointValue = Math.log10((valueByNode.get(edge.source) || 0) + (valueByNode.get(edge.target) || 0) + 1) * 4;
        return value +
            endpointValue +
            Math.min(60, (sourceCount + targetCount) * 5) +
            (edge.is_large_value ? 90 : 0) +
            (exchangeFlowIds.has(edge.id) ? 70 : 0) +
            (funnelFlowIds.has(edge.id) ? 46 : 0) +
            (replayFlowIds.has(edge.id) ? 38 : 0);
    }

    function buildClusterSummaries(nodes, valueByNode, flowCountByNode) {
        const clusters = new Map();
        nodes.forEach(node => {
            const key = node.cluster_key || node.chain || node.type || 'cluster';
            const row = clusters.get(key) || {
                key,
                label: formatClusterLabel(key),
                nodeCount: 0,
                flowCount: 0,
                exposureUsd: 0
            };
            row.nodeCount += 1;
            row.flowCount += flowCountByNode.get(node.id) || 0;
            row.exposureUsd += valueByNode.get(node.id) || Number(node.exposure_usd || node.aggregate_value_usd) || 0;
            clusters.set(key, row);
        });
        return [...clusters.values()]
            .sort((a, b) => b.exposureUsd - a.exposureUsd || b.flowCount - a.flowCount || a.label.localeCompare(b.label))
            .slice(0, 8);
    }

    function isExchangeLikeFlow(edge, graph) {
        if (!edge) return false;
        const source = graph.nodeById?.get(edge.source);
        const target = graph.nodeById?.get(edge.target);
        return [source, target].some(node =>
            isHubNode(node) &&
            ['exchange', 'defi_protocol', 'liquidity_pool', 'bridge'].includes(String(node.category || '').toLowerCase())
        ) || /\b(exchange|swap|pool|bridge|dex|route)\b/i.test(`${edge.flow_role || ''} ${edge.source_label || ''} ${edge.source_program || ''}`);
    }

    function isFunnelFlow(edge = {}) {
        return /\b(funnel|deposit|withdraw|bridge|swap|route|pool)\b/i.test([
            edge.transaction_type,
            edge.transaction_type_label,
            edge.flow_role,
            edge.source_label,
            edge.source_program
        ].join(' '));
    }

    function getPriorityFlowLimit(edgeCount) {
        if (edgeCount > 420) return 90;
        if (edgeCount > 220) return 72;
        if (edgeCount > 100) return 54;
        return 38;
    }

    function formatClusterLabel(key) {
        return String(key || 'cluster')
            .replace(/^hub:/, '')
            .replace(/^token:/, 'token ')
            .replace(/[_:|-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase())
            .slice(0, 34);
    }

    function isHubNode(node) {
        return Boolean(node && core && (node.type === core.NODE_TYPES.HUB || node.type === core.NODE_TYPES.ENTITY));
    }

    namespace.topologyIntelligence = {
        buildTopologyModel
    };
})();
