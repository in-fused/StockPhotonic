(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    const CHAIN = 'solana';
    const SOURCE = 'solana_offline_fixture';
    const NATIVE_SOL_MINT = 'solana:native-sol';

    function normalizeSolanaEnhancedTransaction(tx = {}) {
        return normalizeSolanaTransactionBatch([tx]);
    }

    function normalizeSolanaTransactionBatch(transactions = []) {
        const sourceTransactions = getTransactionList(transactions);
        const transfers = extractSolanaTransfers(sourceTransactions);
        const wallets = extractSolanaWallets(sourceTransactions);
        const tokens = extractSolanaTokens(sourceTransactions);
        const entities = extractSolanaEntities(transactions, sourceTransactions);

        return {
            metadata: {
                name: 'CryptoPhotonic Solana-first offline fixture mode',
                environment: 'dev_offline_fixture',
                chain: CHAIN,
                adapter: 'solana',
                production_meaning: false,
                live_blockchain_fetching: false,
                disclaimer: 'Synthetic Solana-shaped records for local rendering only. No real-world attribution or accusation is implied.',
                future_adapters: [
                    'Helius Enhanced Transactions',
                    'Helius Webhooks',
                    'Solana RPC/WebSocket',
                    'Jupiter'
                ]
            },
            wallets,
            tokens,
            entities,
            transactions: transfers
        };
    }

    function extractSolanaWallets(transactions = []) {
        const walletsByAddress = new Map();
        extractSolanaTransfers(transactions).forEach(transfer => {
            addWallet(walletsByAddress, transfer.source_wallet, transfer);
            addWallet(walletsByAddress, transfer.destination_wallet, transfer);
        });
        return [...walletsByAddress.values()];
    }

    function extractSolanaTokens(transactions = []) {
        const tokensByMint = new Map();
        extractSolanaTransfers(transactions).forEach(transfer => {
            const mint = normalizeAddress(transfer.token_mint || NATIVE_SOL_MINT);
            if (!mint || tokensByMint.has(mint)) return;
            tokensByMint.set(mint, {
                token_mint: mint,
                contract_address: mint,
                chain: CHAIN,
                symbol: transfer.symbol || (mint === NATIVE_SOL_MINT ? 'SOL' : 'SPL'),
                name: transfer.metadata?.token_name || transfer.symbol || (mint === NATIVE_SOL_MINT ? 'Solana' : 'SPL Token'),
                decimals: normalizeNumber(transfer.metadata?.decimals),
                label_source: SOURCE,
                confidence: 0,
                metadata: {
                    fixture_only: true,
                    source_format: transfer.metadata?.source_format || 'solana_transfer'
                }
            });
        });
        return [...tokensByMint.values()];
    }

    function extractSolanaTransfers(transactions = []) {
        return getTransactionList(transactions)
            .flatMap((tx, txIndex) => normalizeTransferRecords(tx, txIndex))
            .filter(transfer => transfer.source_wallet && transfer.destination_wallet);
    }

    function normalizeTransferRecords(tx = {}, txIndex = 0) {
        const signature = String(tx.signature || tx.transaction_hash || tx.hash || `solana-fixture-${txIndex}`).trim();
        const timestamp = normalizeTimestamp(tx.timestamp || tx.blockTime || tx.block_time);
        const records = [];

        getNativeTransfers(tx).forEach((transfer, transferIndex) => {
            const amount = normalizeLamports(transfer.amount ?? transfer.lamports);
            records.push(buildTransaction({
                tx,
                signature,
                timestamp,
                transferIndex,
                sourceWallet: transfer.fromUserAccount || transfer.from || transfer.source_wallet || transfer.source,
                destinationWallet: transfer.toUserAccount || transfer.to || transfer.destination_wallet || transfer.destination,
                tokenMint: NATIVE_SOL_MINT,
                symbol: transfer.symbol || 'SOL',
                amount,
                usdValue: transfer.usd_value,
                format: 'native_transfer',
                transfer
            }));
        });

        getTokenTransfers(tx).forEach((transfer, transferIndex) => {
            records.push(buildTransaction({
                tx,
                signature,
                timestamp,
                transferIndex: records.length + transferIndex,
                sourceWallet: transfer.fromUserAccount || transfer.fromOwner || transfer.from || transfer.source_wallet || transfer.source,
                destinationWallet: transfer.toUserAccount || transfer.toOwner || transfer.to || transfer.destination_wallet || transfer.destination,
                tokenMint: transfer.mint || transfer.tokenMint || transfer.token_mint || transfer.contract_address,
                symbol: transfer.symbol || transfer.tokenSymbol || transfer.token_symbol || 'SPL',
                amount: transfer.tokenAmount ?? transfer.amount ?? transfer.rawTokenAmount?.tokenAmount,
                usdValue: transfer.usd_value,
                decimals: transfer.decimals ?? transfer.rawTokenAmount?.decimals,
                format: 'token_transfer',
                transfer
            }));
        });

        getSwapTransfers(tx).forEach((transfer, transferIndex) => {
            records.push(buildTransaction({
                tx,
                signature,
                timestamp,
                transferIndex: records.length + transferIndex,
                sourceWallet: transfer.source_wallet || transfer.fromUserAccount || transfer.from || transfer.owner,
                destinationWallet: transfer.destination_wallet || transfer.toUserAccount || transfer.to || transfer.counterparty,
                tokenMint: transfer.mint || transfer.tokenMint || transfer.token_mint || (transfer.symbol === 'SOL' ? NATIVE_SOL_MINT : undefined),
                symbol: transfer.symbol || transfer.tokenSymbol || 'SWAP',
                amount: transfer.tokenAmount ?? transfer.amount,
                usdValue: transfer.usd_value,
                decimals: transfer.decimals,
                format: 'swap_leg',
                transfer
            }));
        });

        return records;
    }

    function buildTransaction({
        tx,
        signature,
        timestamp,
        transferIndex,
        sourceWallet,
        destinationWallet,
        tokenMint,
        symbol,
        amount,
        usdValue,
        decimals,
        format,
        transfer
    }) {
        const normalizedMint = normalizeAddress(tokenMint || `${CHAIN}:${symbol || 'spl'}`);
        return {
            id: `tx:${CHAIN}:${signature}:${transferIndex}`,
            transaction_type: tx.type || tx.transactionType || format,
            transaction_hash: signature,
            chain: CHAIN,
            source_wallet: normalizeAddress(sourceWallet),
            destination_wallet: normalizeAddress(destinationWallet),
            token_mint: normalizedMint,
            contract_address: normalizedMint,
            symbol: String(symbol || 'SPL').trim(),
            amount: normalizeNumber(amount),
            usd_value: normalizeNumber(usdValue),
            timestamp,
            confidence: 0,
            label_source: SOURCE,
            hub_ids: collectHubIds(tx, transfer),
            flow_role: format === 'swap_leg' ? 'swap_route' : '',
            route_id: String(tx.route_id || tx.routeId || transfer?.route_id || transfer?.routeId || '').trim(),
            metadata: {
                fixture_only: true,
                source_format: format,
                solana_type: tx.type || tx.transactionType || transfer?.type || null,
                hub_ids: collectHubIds(tx, transfer),
                exchange_hub_id: tx.exchange_hub_id || transfer?.exchange_hub_id || null,
                protocol_hub_id: tx.protocol_hub_id || tx.route_hub_id || transfer?.protocol_hub_id || transfer?.route_hub_id || null,
                pool_hub_id: tx.pool_hub_id || tx.liquidity_pool_hub_id || transfer?.pool_hub_id || transfer?.liquidity_pool_hub_id || null,
                bridge_hub_id: tx.bridge_hub_id || transfer?.bridge_hub_id || null,
                instruction_index: transfer?.instructionIndex ?? transfer?.instruction_index ?? null,
                token_account_source: transfer?.fromTokenAccount || null,
                token_account_destination: transfer?.toTokenAccount || null,
                decimals: normalizeNumber(decimals),
                raw_amount: amount ?? null
            }
        };
    }

    function extractSolanaEntities(input, transactions = []) {
        const roots = [];
        if (!Array.isArray(input) && input && typeof input === 'object') {
            if (Array.isArray(input.entities)) roots.push(...input.entities);
            if (Array.isArray(input.hubs)) roots.push(...input.hubs);
            if (Array.isArray(input.entity_hubs)) roots.push(...input.entity_hubs);
        }

        transactions.forEach(tx => {
            if (Array.isArray(tx.entities)) roots.push(...tx.entities);
            if (Array.isArray(tx.hubs)) roots.push(...tx.hubs);
            if (Array.isArray(tx.entity_hubs)) roots.push(...tx.entity_hubs);
        });

        const seen = new Set();
        return roots
            .map(entity => ({
                ...entity,
                chain: entity.chain || CHAIN,
                label_source: entity.label_source || entity.source || SOURCE,
                source: entity.source || entity.label_source || SOURCE,
                confidence: normalizeNumber(entity.confidence) || 0,
                metadata: {
                    fixture_only: true,
                    ...(entity.metadata || {})
                }
            }))
            .filter(entity => {
                const key = entity.id || `${entity.type || entity.category || 'entity'}:${entity.label || entity.name || ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function collectHubIds(tx = {}, transfer = {}) {
        const values = [
            tx.hub_id,
            tx.entity_id,
            tx.exchange_hub_id,
            tx.protocol_hub_id,
            tx.route_hub_id,
            tx.pool_hub_id,
            tx.liquidity_pool_hub_id,
            tx.bridge_hub_id,
            transfer.hub_id,
            transfer.entity_id,
            transfer.exchange_hub_id,
            transfer.protocol_hub_id,
            transfer.route_hub_id,
            transfer.pool_hub_id,
            transfer.liquidity_pool_hub_id,
            transfer.bridge_hub_id
        ];
        if (Array.isArray(tx.hub_ids)) values.push(...tx.hub_ids);
        if (Array.isArray(tx.entity_ids)) values.push(...tx.entity_ids);
        if (Array.isArray(transfer.hub_ids)) values.push(...transfer.hub_ids);
        if (Array.isArray(transfer.entity_ids)) values.push(...transfer.entity_ids);
        return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    }

    function getTransactionList(input) {
        if (Array.isArray(input)) return input;
        if (Array.isArray(input.transactions)) return input.transactions;
        if (Array.isArray(input.solana_transactions)) return input.solana_transactions;
        if (Array.isArray(input.enhancedTransactions)) return input.enhancedTransactions;
        if (Array.isArray(input.enhanced_transactions)) return input.enhanced_transactions;
        return [];
    }

    function getNativeTransfers(tx) {
        if (Array.isArray(tx.nativeTransfers)) return tx.nativeTransfers;
        if (Array.isArray(tx.native_transfers)) return tx.native_transfers;
        return [];
    }

    function getTokenTransfers(tx) {
        const tokenTransfers = [];
        if (Array.isArray(tx.tokenTransfers)) tokenTransfers.push(...tx.tokenTransfers);
        if (Array.isArray(tx.token_transfers)) tokenTransfers.push(...tx.token_transfers);
        if (Array.isArray(tx.transfers)) {
            tokenTransfers.push(...tx.transfers.filter(transfer => transfer.mint || transfer.tokenMint || transfer.token_mint));
        }
        return tokenTransfers;
    }

    function getSwapTransfers(tx) {
        if (Array.isArray(tx.swapTransfers)) return tx.swapTransfers;
        if (Array.isArray(tx.swap_transfers)) return tx.swap_transfers;

        const swap = tx.events?.swap || tx.swap;
        if (!swap) return [];

        const transfers = [];
        ['nativeInput', 'nativeOutput', 'tokenInputs', 'tokenOutputs'].forEach(key => {
            const value = swap[key];
            const items = Array.isArray(value) ? value : value ? [value] : [];
            items.forEach(item => {
                transfers.push({
                    ...item,
                    type: key,
                    symbol: item.symbol || (key.startsWith('native') ? 'SOL' : item.tokenSymbol),
                    mint: item.mint || item.tokenMint || (key.startsWith('native') ? NATIVE_SOL_MINT : undefined)
                });
            });
        });
        return transfers;
    }

    function addWallet(walletsByAddress, address, transfer) {
        const normalized = normalizeAddress(address);
        if (!normalized || walletsByAddress.has(normalized)) return;
        walletsByAddress.set(normalized, {
            address: normalized,
            chain: CHAIN,
            label: shortAddress(normalized),
            label_source: SOURCE,
            confidence: 0,
            metadata: {
                fixture_only: true,
                first_seen_format: transfer.metadata?.source_format || 'solana_transfer'
            }
        });
    }

    function normalizeTimestamp(value) {
        if (!value) return null;
        if (typeof value === 'number') return new Date(value * 1000).toISOString();
        return String(value);
    }

    function normalizeLamports(value) {
        const number = normalizeNumber(value);
        return number > 1000000 ? number / 1000000000 : number;
    }

    function normalizeAddress(value) {
        return core?.normalizeAddress ? core.normalizeAddress(value) : String(value || '').trim().toLowerCase();
    }

    function normalizeNumber(value) {
        return core?.normalizeNumber ? core.normalizeNumber(value) : Number(value) || 0;
    }

    function shortAddress(value) {
        return core?.shortAddress ? core.shortAddress(value) : String(value || '').slice(0, 10);
    }

    namespace.solanaAdapter = {
        normalizeSolanaEnhancedTransaction,
        normalizeSolanaTransactionBatch,
        extractSolanaWallets,
        extractSolanaTokens,
        extractSolanaEntities,
        extractSolanaTransfers
    };
})();
