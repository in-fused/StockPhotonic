(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    if (!core) {
        throw new Error('CryptoPhotonic core module must load before graph module');
    }

    function buildGraph(input = {}) {
        const dataset = core.normalizeDataset(input);
        const nodeById = new Map();
        const walletByKey = new Map();
        const tokenByKey = new Map();
        const edges = [];
        const exposureByWalletToken = new Map();

        dataset.wallets.forEach(wallet => {
            nodeById.set(wallet.id, {
                ...wallet,
                title: wallet.label || core.shortAddress(wallet.address),
                cluster_key: wallet.label_source === 'dev_sample' && wallet.label ? wallet.label : wallet.chain,
                total_in_usd: 0,
                total_out_usd: 0,
                exposure_usd: 0
            });
            walletByKey.set(walletKey(wallet.address, wallet.chain), wallet.id);
        });

        dataset.tokens.forEach(token => {
            nodeById.set(token.id, {
                ...token,
                title: token.symbol,
                cluster_key: `token:${token.chain}`,
                exposure_usd: 0
            });
            tokenByKey.set(tokenKey(token.token_mint, token.chain), token.id);
        });

        dataset.entities.forEach(entity => {
            nodeById.set(entity.id, {
                ...entity,
                title: entity.label,
                cluster_key: entity.label
            });

            entity.wallets.forEach(address => {
                const walletId = walletByKey.get(walletKey(address, entity.chain))
                    || findWalletIdByAddress(walletByKey, address);
                if (!walletId) return;
                edges.push({
                    id: `${core.EDGE_TYPES.LABEL}:${entity.id}:${walletId}`,
                    type: core.EDGE_TYPES.LABEL,
                    source: entity.id,
                    target: walletId,
                    label_source: entity.label_source,
                    confidence: entity.confidence,
                    production_write: false
                });
            });
        });

        dataset.transactions.forEach((transaction, index) => {
            const sourceWalletId = ensureWalletNode(transaction.source_wallet, transaction.chain, nodeById, walletByKey);
            const destinationWalletId = ensureWalletNode(transaction.destination_wallet, transaction.chain, nodeById, walletByKey);
            const tokenNodeId = ensureTokenNode(transaction, nodeById, tokenByKey);
            const flowEdge = buildFlowEdge(transaction, sourceWalletId, destinationWalletId, index);

            edges.push(flowEdge);
            updateWalletFlowTotals(nodeById.get(sourceWalletId), nodeById.get(destinationWalletId), transaction.usd_value);

            if (tokenNodeId) {
                addExposure(exposureByWalletToken, sourceWalletId, tokenNodeId, transaction, 'source');
                addExposure(exposureByWalletToken, destinationWalletId, tokenNodeId, transaction, 'destination');
                const tokenNode = nodeById.get(tokenNodeId);
                tokenNode.exposure_usd += Math.max(0, transaction.usd_value);
            }
        });

        exposureByWalletToken.forEach(exposure => {
            edges.push({
                id: `${core.EDGE_TYPES.EXPOSURE}:${exposure.wallet_id}:${exposure.token_id}`,
                type: core.EDGE_TYPES.EXPOSURE,
                source: exposure.wallet_id,
                target: exposure.token_id,
                chain: exposure.chain,
                symbol: exposure.symbol,
                amount: exposure.amount,
                usd_value: exposure.usd_value,
                transaction_count: exposure.transaction_count,
                confidence: exposure.confidence,
                label_source: exposure.label_source,
                production_write: false
            });
        });

        const nodes = [...nodeById.values()];
        const graph = {
            metadata: dataset.metadata,
            nodes,
            edges,
            transactions: dataset.transactions,
            nodeById,
            walletNodes: nodes.filter(node => node.type === core.NODE_TYPES.WALLET),
            tokenNodes: nodes.filter(node => node.type === core.NODE_TYPES.TOKEN),
            entityNodes: nodes.filter(node => node.type === core.NODE_TYPES.ENTITY),
            flowEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.FLOW),
            exposureEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.EXPOSURE),
            labelEdges: edges.filter(edge => edge.type === core.EDGE_TYPES.LABEL)
        };

        graph.walletPaths = buildMultiHopPaths(graph, { maxHops: 3 });
        return graph;
    }

    function ensureWalletNode(address, chain, nodeById, walletByKey) {
        const key = walletKey(address, chain);
        const existingId = walletByKey.get(key);
        if (existingId) return existingId;

        const id = core.walletId(address, chain);
        nodeById.set(id, {
            id,
            type: core.NODE_TYPES.WALLET,
            address: core.normalizeAddress(address),
            chain: core.normalizeChain(chain),
            label: core.shortAddress(address),
            title: core.shortAddress(address),
            label_source: 'transaction_input',
            confidence: 0,
            cluster_key: core.normalizeChain(chain),
            total_in_usd: 0,
            total_out_usd: 0,
            exposure_usd: 0,
            metadata: {}
        });
        walletByKey.set(key, id);
        return id;
    }

    function ensureTokenNode(transaction, nodeById, tokenByKey) {
        if (!transaction.token_mint && !transaction.symbol) return null;

        const key = tokenKey(transaction.token_mint || transaction.symbol, transaction.chain);
        const existingId = tokenByKey.get(key);
        if (existingId) return existingId;

        const tokenMint = transaction.token_mint || `${transaction.chain}:${transaction.symbol || 'token'}`;
        const id = core.tokenId(tokenMint, transaction.chain);
        nodeById.set(id, {
            id,
            type: core.NODE_TYPES.TOKEN,
            symbol: transaction.symbol || 'TOKEN',
            name: transaction.symbol || 'Token',
            token_mint: core.normalizeAddress(tokenMint),
            contract_address: core.normalizeAddress(tokenMint),
            chain: core.normalizeChain(transaction.chain),
            label_source: transaction.label_source || 'transaction_input',
            confidence: transaction.confidence || 0,
            title: transaction.symbol || 'TOKEN',
            cluster_key: `token:${core.normalizeChain(transaction.chain)}`,
            exposure_usd: 0,
            metadata: {}
        });
        tokenByKey.set(key, id);
        return id;
    }

    function buildFlowEdge(transaction, sourceWalletId, destinationWalletId, index) {
        const usdValue = Math.max(0, Number(transaction.usd_value) || 0);
        return {
            id: `${core.EDGE_TYPES.FLOW}:${transaction.transaction_hash || index}`,
            type: core.EDGE_TYPES.FLOW,
            source: sourceWalletId,
            target: destinationWalletId,
            source_wallet: transaction.source_wallet,
            destination_wallet: transaction.destination_wallet,
            transaction_hash: transaction.transaction_hash,
            chain: transaction.chain,
            token_mint: transaction.token_mint,
            symbol: transaction.symbol,
            amount: transaction.amount,
            usd_value: usdValue,
            timestamp: transaction.timestamp,
            confidence: transaction.confidence,
            label_source: transaction.label_source,
            priority: usdValue,
            production_write: false
        };
    }

    function addExposure(exposureByWalletToken, walletId, tokenId, transaction, direction) {
        const key = `${walletId}|${tokenId}`;
        const existing = exposureByWalletToken.get(key) || {
            wallet_id: walletId,
            token_id: tokenId,
            chain: transaction.chain,
            symbol: transaction.symbol,
            amount: 0,
            usd_value: 0,
            transaction_count: 0,
            confidence: 0,
            label_source: transaction.label_source,
            directions: new Set()
        };

        existing.amount += Math.max(0, Number(transaction.amount) || 0);
        existing.usd_value += Math.max(0, Number(transaction.usd_value) || 0);
        existing.transaction_count += 1;
        existing.confidence = Math.max(existing.confidence, Number(transaction.confidence) || 0);
        existing.directions.add(direction);
        exposureByWalletToken.set(key, existing);
    }

    function updateWalletFlowTotals(sourceNode, destinationNode, usdValue) {
        const value = Math.max(0, Number(usdValue) || 0);
        if (sourceNode) {
            sourceNode.total_out_usd += value;
            sourceNode.exposure_usd += value;
        }
        if (destinationNode) {
            destinationNode.total_in_usd += value;
            destinationNode.exposure_usd += value;
        }
    }

    function buildMultiHopPaths(graph, options = {}) {
        const maxHops = Math.max(1, Math.min(6, Number(options.maxHops) || 3));
        const walletEdges = graph.flowEdges || [];
        const adjacency = new Map();

        walletEdges.forEach(edge => {
            if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
            adjacency.get(edge.source).push(edge);
        });

        const paths = [];
        const sourceIds = options.sourceWalletId ? [options.sourceWalletId] : [...adjacency.keys()];

        sourceIds.forEach(sourceId => {
            const queue = [{
                nodeId: sourceId,
                edges: [],
                visited: new Set([sourceId]),
                usd_value: 0
            }];

            while (queue.length) {
                const current = queue.shift();
                if (current.edges.length >= maxHops) continue;

                (adjacency.get(current.nodeId) || []).forEach(edge => {
                    if (current.visited.has(edge.target)) return;
                    const nextEdges = [...current.edges, edge];
                    const nextVisited = new Set(current.visited);
                    nextVisited.add(edge.target);
                    const path = {
                        source: sourceId,
                        target: edge.target,
                        hops: nextEdges.length,
                        edge_ids: nextEdges.map(item => item.id),
                        wallet_ids: [sourceId, ...nextEdges.map(item => item.target)],
                        usd_value: current.usd_value + (Number(edge.usd_value) || 0)
                    };

                    if (!options.targetWalletId || path.target === options.targetWalletId) {
                        paths.push(path);
                    }

                    queue.push({
                        nodeId: edge.target,
                        edges: nextEdges,
                        visited: nextVisited,
                        usd_value: path.usd_value
                    });
                });
            }
        });

        return paths.sort((a, b) => b.usd_value - a.usd_value || a.hops - b.hops);
    }

    function walletKey(address, chain) {
        return `${core.normalizeChain(chain)}:${core.normalizeAddress(address)}`;
    }

    function tokenKey(tokenMint, chain) {
        return `${core.normalizeChain(chain)}:${core.normalizeAddress(tokenMint)}`;
    }

    function findWalletIdByAddress(walletByKey, address) {
        const normalized = core.normalizeAddress(address);
        for (const [key, id] of walletByKey.entries()) {
            if (key.endsWith(`:${normalized}`)) return id;
        }
        return null;
    }

    namespace.graph = {
        buildGraph,
        buildMultiHopPaths
    };
})();
