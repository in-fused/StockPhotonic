(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;

    const CHAIN = 'solana';
    const SOURCE = 'solana_offline_fixture';
    const NATIVE_SOL_MINT = 'solana:native-sol';
    const LIVE_DATA_SECURITY_BOUNDARY = Object.freeze({
        status: 'disabled_planning_only',
        browser_secret_policy: 'Public browser code must never contain API keys, bearer tokens, private RPC URLs, or signing material.',
        key_storage_policy: 'Future Helius, Solana, and Jupiter credentials must remain in local environment variables or a managed secret store.',
        live_call_requirement: 'Live blockchain calls require a future backend/proxy or local-only secure runner before enablement.',
        fixture_policy: 'Public fixtures remain dev-only, synthetic, and safe to ship without secrets.',
        request_filtering_policy: 'A secure runtime must validate wallet scopes, signatures, pagination, time windows, response size, and provider endpoints before making live calls.',
        response_sanitization_policy: 'Provider responses must be reduced to graph-ready wallet, token, hub, transaction, and route records before browser delivery.',
        forbidden_in_browser: [
            'API key loading',
            'secret manager access',
            'live RPC fetches',
            'WebSocket subscriptions',
            'swap execution',
            'transaction signing'
        ]
    });
    const REAL_DATA_PIPELINE = Object.freeze({
        order: ['Input', 'Adapter', 'Graph', 'UI', 'Replay'],
        input: [
            'Helius Enhanced Transactions payloads returned by a future secure runtime.',
            'Solana WebSocket events later, routed through the same secure runtime.',
            'Jupiter route context later, used only as sanitized swap metadata.'
        ],
        adapter: [
            'Normalize provider payloads into CryptoPhotonic metadata, wallets, tokens, entities, and transactions.',
            'Keep provider-specific raw fields only as safe metadata needed for debugging or route context.'
        ],
        graph: [
            'Pass normalized datasets through CryptoPhotonic.core.normalizeDataset() and CryptoPhotonic.graph.buildGraph().',
            'Preserve existing node, edge, hub, exposure, and flow edge contracts.'
        ],
        ui: [
            'Reuse existing CryptoPhotonic rendering and interaction logic.',
            'Do not create a live-data-specific UI rendering path for the first milestone.'
        ],
        replay: [
            'Let graph.buildFlowReplayPlan() derive ordered replay flows from normalized flow edges.',
            'Append future sanitized transactions by merging/deduping the dataset, then rebuilding graph/replay state.'
        ]
    });
    const REQUIRED_DATA_SHAPE = Object.freeze({
        dataset: {
            required_top_level_keys: ['metadata', 'wallets', 'tokens', 'entities', 'transactions'],
            metadata: ['name', 'environment', 'chain', 'adapter', 'production_meaning', 'live_blockchain_fetching']
        },
        transaction: {
            required_fields: [
                'id',
                'transaction_type',
                'transaction_hash',
                'chain',
                'source_wallet',
                'destination_wallet',
                'token_mint',
                'contract_address',
                'symbol',
                'amount',
                'usd_value',
                'timestamp',
                'confidence',
                'label_source',
                'hub_ids',
                'flow_role',
                'route_id',
                'metadata'
            ],
            graph_keys: ['source_wallet', 'destination_wallet', 'token_mint', 'symbol', 'transaction_hash', 'chain', 'amount', 'usd_value', 'timestamp', 'hub_ids'],
            id_format: 'tx:solana:<signature>:<transfer_index>',
            transfer_sources: ['nativeTransfers', 'tokenTransfers', 'events.swap']
        },
        wallet: {
            required_fields: ['id', 'type', 'address', 'chain', 'label', 'label_source', 'confidence', 'metadata'],
            id_format: 'wallet:solana:<address>',
            label_policy: 'Default to short address unless a reviewed label or secure-runtime allowlist provides a hub label.'
        },
        token: {
            required_fields: ['id', 'type', 'symbol', 'name', 'token_mint', 'contract_address', 'chain', 'decimals', 'label_source', 'confidence', 'metadata'],
            id_format: 'token:solana:<mint>',
            native_sol_mint: NATIVE_SOL_MINT
        },
        hub_labeling_inputs: {
            required_fields_when_present: ['id', 'type', 'label', 'category', 'chain', 'label_source', 'confidence', 'related_wallets', 'related_programs', 'metadata'],
            transaction_link_fields: ['hub_ids', 'exchange_hub_id', 'protocol_hub_id', 'route_hub_id', 'pool_hub_id', 'liquidity_pool_hub_id', 'bridge_hub_id', 'counterparty_hub_id'],
            first_milestone_required: false
        },
        swap_route: {
            required_fields_when_present: ['route_id', 'transaction_hash', 'source_wallet', 'input_token_mint', 'output_token_mint', 'input_amount', 'output_amount', 'usd_value', 'legs', 'metadata'],
            transaction_mapping: 'Represent each animated route leg as a normal transaction with flow_role "swap_route" and the same route_id.',
            first_milestone_required: false
        }
    });
    const MINIMUM_LIVE_DATA_SET = Object.freeze({
        milestone: 'first_live_candidate',
        scope: [
            'single wallet tracking',
            'recent transactions',
            'parsed native SOL transfers',
            'parsed SPL token transfers'
        ],
        primary_provider: 'Helius Enhanced Transactions',
        excluded: [
            'wallet clustering',
            'multi-wallet watchlists',
            'entity attribution without reviewed allowlists',
            'realtime WebSocket subscriptions',
            'Jupiter route lookup',
            'swap execution',
            'transaction signing',
            'browser-side provider calls'
        ]
    });
    const REPLAY_INTEGRATION_PLAN = Object.freeze({
        current_path: [
            'Adapter emits normalized transactions.',
            'Graph builder creates flow edges.',
            'buildFlowReplayPlan() sorts flow edges into flowReplay.ordered_flows.',
            'Existing UI animation reads activeFlowId from the replay state.'
        ],
        future_append_path: [
            'Secure runtime returns sanitized recent or new transactions.',
            'Adapter normalizes transfers.',
            'Merge by transaction_hash plus transfer index.',
            'Rebuild graph/replay state so new flows enter the existing ordered replay queue.'
        ],
        animation_policy: 'Reuse the existing flow replay and pulse logic; do not add live-specific animation primitives for the first milestone.'
    });

    function createHeliusEnhancedTransactionPlan(options = {}) {
        return createDisabledLiveDataPlan({
            id: 'helius_enhanced_transactions',
            provider: 'Helius',
            target: 'Enhanced Transactions',
            source_priority: 'primary',
            phase_role: 'first_live_milestone_source',
            adapter_status: 'stub_only_no_fetch',
            intended_use: [
                'Power the first live candidate by converting recent single-wallet transaction history into parsed transfer records.',
                'Normalize enriched Solana transaction records into CryptoPhotonic wallet, token, entity, and flow graphs.',
                'Preserve offline fixture compatibility as the default development mode.'
            ],
            required_secure_runtime: 'backend_proxy_or_local_secure_runner',
            required_secret_names: options.required_secret_names || ['HELIUS_API_KEY'],
            browser_parameters_allowed: [
                'one public Solana wallet address after secure-runtime validation',
                'public fixture path',
                'synthetic transaction signature list',
                'non-secret feature flag'
            ],
            minimum_live_dataset: { ...MINIMUM_LIVE_DATA_SET }
        });
    }

    function createSolanaWebSocketPlan(options = {}) {
        return createDisabledLiveDataPlan({
            id: 'solana_realtime_websocket',
            provider: 'Helius/Solana',
            target: 'WebSocket realtime transaction stream',
            source_priority: 'later_realtime',
            phase_role: 'post_recent_transactions_realtime_append',
            adapter_status: 'stub_only_no_subscription',
            intended_use: [
                'Prepare future realtime flow updates for watched wallets, hubs, or programs.',
                'Route all subscriptions through a secure runtime so browser code never receives provider secrets.'
            ],
            required_secure_runtime: 'backend_proxy_or_local_secure_runner',
            required_secret_names: options.required_secret_names || ['HELIUS_API_KEY', 'SOLANA_RPC_URL'],
            browser_parameters_allowed: [
                'synthetic watchlist id',
                'offline fixture replay mode',
                'non-secret feature flag'
            ],
            minimum_live_dataset: {
                ...MINIMUM_LIVE_DATA_SET,
                excluded: [...MINIMUM_LIVE_DATA_SET.excluded, 'first milestone dependency until recent-transaction path is secure']
            }
        });
    }

    function createJupiterRouteContextPlan(options = {}) {
        return createDisabledLiveDataPlan({
            id: 'jupiter_route_context',
            provider: 'Jupiter',
            target: 'Route and swap context',
            source_priority: 'later_swap_context',
            phase_role: 'post_transfer_parsing_context_enrichment',
            adapter_status: 'stub_only_no_route_request',
            intended_use: [
                'Annotate Solana swap-like fixture flows with future route, quote, and pool context.',
                'Keep swap execution, signing, and live quote requests outside browser public code.'
            ],
            required_secure_runtime: 'backend_proxy_or_local_secure_runner',
            required_secret_names: options.required_secret_names || [],
            browser_parameters_allowed: [
                'synthetic route id',
                'offline fixture route metadata',
                'non-secret feature flag'
            ],
            minimum_live_dataset: {
                ...MINIMUM_LIVE_DATA_SET,
                excluded: [...MINIMUM_LIVE_DATA_SET.excluded, 'required swap context in first milestone']
            }
        });
    }

    function createDisabledLiveDataPlan(plan = {}) {
        return {
            ...plan,
            chain: CHAIN,
            pipeline: { ...REAL_DATA_PIPELINE },
            required_data_shape: { ...REQUIRED_DATA_SHAPE },
            replay_integration: { ...REPLAY_INTEGRATION_PLAN },
            live_enabled: false,
            live_blockchain_fetching: false,
            loads_browser_api_keys: false,
            fetch_implemented: false,
            websocket_implemented: false,
            swap_execution_enabled: false,
            request_filtering_required: true,
            response_sanitization_required: true,
            security_boundary: { ...LIVE_DATA_SECURITY_BOUNDARY }
        };
    }

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
                ],
                live_data_boundary: {
                    status: LIVE_DATA_SECURITY_BOUNDARY.status,
                    browser_secret_policy: LIVE_DATA_SECURITY_BOUNDARY.browser_secret_policy,
                    live_call_requirement: LIVE_DATA_SECURITY_BOUNDARY.live_call_requirement
                }
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
        extractSolanaTransfers,
        createHeliusEnhancedTransactionPlan,
        createSolanaWebSocketPlan,
        createJupiterRouteContextPlan
    };
})();
