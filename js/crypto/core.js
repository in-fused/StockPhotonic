(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const NODE_TYPES = Object.freeze({
        WALLET: 'wallet',
        TOKEN: 'token',
        ENTITY: 'entity',
        HUB: 'hub'
    });

    const HUB_CATEGORIES = Object.freeze({
        EXCHANGE: 'exchange',
        DEFI_PROTOCOL: 'defi_protocol',
        LIQUIDITY_POOL: 'liquidity_pool',
        BRIDGE: 'bridge',
        LABELED_ENTITY: 'labeled_entity'
    });

    const EDGE_TYPES = Object.freeze({
        FLOW: 'transaction_flow',
        EXPOSURE: 'token_exposure',
        LABEL: 'label_link'
    });

    const TRANSACTION_TYPE_LABELS = Object.freeze({
        TRANSFER: 'Transfer',
        TOKEN_TRANSFER: 'Token Transfer',
        SWAP: 'Swap',
        CLOSE_ACCOUNT: 'Close Account',
        STAKE_TOKEN: 'Stake',
        COLLECT_REWARD: 'Reward Collection',
        COLLECT_REVENUE: 'Revenue Collection',
        CREATE_ORDER: 'Order Created',
        FILL_ORDER: 'Order Filled',
        UNKNOWN: 'Unknown / Unclassified'
    });

    const SAMPLE_DATASET = Object.freeze({
        metadata: {
            name: 'CryptoPhotonic dev-only sample flow',
            environment: 'sample',
            production_meaning: false,
            disclaimer: 'Synthetic wallet, token, and transaction records for local rendering only. No real-world attribution or accusation is implied.'
        },
        wallets: [
            {
                address: '0xsamplealpha000000000000000000000000000001',
                chain: 'ethereum',
                label: 'Sample Treasury',
                label_source: 'dev_sample',
                confidence: 0.64
            },
            {
                address: '0xsamplebeta0000000000000000000000000000002',
                chain: 'ethereum',
                label: 'Sample Operations',
                label_source: 'dev_sample',
                confidence: 0.58
            },
            {
                address: '0xsamplegamma000000000000000000000000000003',
                chain: 'polygon',
                label: 'Sample Exchange Deposit',
                label_source: 'dev_sample',
                confidence: 0.52
            },
            {
                address: '0xsampledelta000000000000000000000000000004',
                chain: 'ethereum',
                label: 'Unlabeled Sample Wallet',
                label_source: 'dev_sample',
                confidence: 0.31
            }
        ],
        tokens: [
            {
                symbol: 'sUSDC',
                name: 'Sample USD Coin',
                token_mint: '0xsampletokenusdc00000000000000000000000001',
                contract_address: '0xsampletokenusdc00000000000000000000000001',
                chain: 'ethereum',
                decimals: 6,
                label_source: 'dev_sample',
                confidence: 0.66
            },
            {
                symbol: 'sWETH',
                name: 'Sample Wrapped Ether',
                token_mint: '0xsampletokenweth00000000000000000000000002',
                contract_address: '0xsampletokenweth00000000000000000000000002',
                chain: 'ethereum',
                decimals: 18,
                label_source: 'dev_sample',
                confidence: 0.62
            },
            {
                symbol: 'sMATIC',
                name: 'Sample Matic',
                token_mint: '0xsampletokenmatic000000000000000000000003',
                contract_address: '0xsampletokenmatic000000000000000000000003',
                chain: 'polygon',
                decimals: 18,
                label_source: 'dev_sample',
                confidence: 0.59
            }
        ],
        entities: [
            {
                type: 'labeled_entity',
                label: 'Sample Entity Group A',
                source: 'dev_sample',
                confidence: 0.48,
                related_wallets: [
                    '0xsamplealpha000000000000000000000000000001',
                    '0xsamplebeta0000000000000000000000000000002'
                ],
                chain: 'ethereum'
            }
        ],
        transactions: [
            {
                transaction_hash: '0xsampletx0001',
                chain: 'ethereum',
                source_wallet: '0xsamplealpha000000000000000000000000000001',
                destination_wallet: '0xsamplebeta0000000000000000000000000000002',
                token_mint: '0xsampletokenusdc00000000000000000000000001',
                symbol: 'sUSDC',
                amount: 125000,
                usd_value: 125000,
                timestamp: '2026-04-18T14:20:00Z',
                confidence: 0.7,
                label_source: 'dev_sample'
            },
            {
                transaction_hash: '0xsampletx0002',
                chain: 'ethereum',
                source_wallet: '0xsamplebeta0000000000000000000000000000002',
                destination_wallet: '0xsampledelta000000000000000000000000000004',
                token_mint: '0xsampletokenweth00000000000000000000000002',
                symbol: 'sWETH',
                amount: 42.5,
                usd_value: 140250,
                timestamp: '2026-04-18T16:10:00Z',
                confidence: 0.61,
                label_source: 'dev_sample'
            },
            {
                transaction_hash: '0xsampletx0003',
                chain: 'polygon',
                source_wallet: '0xsamplegamma000000000000000000000000000003',
                destination_wallet: '0xsamplealpha000000000000000000000000000001',
                token_mint: '0xsampletokenmatic000000000000000000000003',
                symbol: 'sMATIC',
                amount: 85000,
                usd_value: 61200,
                timestamp: '2026-04-19T09:45:00Z',
                confidence: 0.57,
                label_source: 'dev_sample'
            },
            {
                transaction_hash: '0xsampletx0004',
                chain: 'ethereum',
                source_wallet: '0xsampledelta000000000000000000000000000004',
                destination_wallet: '0xsamplebeta0000000000000000000000000000002',
                token_mint: '0xsampletokenusdc00000000000000000000000001',
                symbol: 'sUSDC',
                amount: 38000,
                usd_value: 38000,
                timestamp: '2026-04-20T11:30:00Z',
                confidence: 0.44,
                label_source: 'dev_sample'
            }
        ]
    });

    function normalizeChain(chain) {
        return String(chain || 'unknown').trim().toLowerCase() || 'unknown';
    }

    function normalizeAddress(address) {
        return String(address || '').trim().toLowerCase();
    }

    function walletId(address, chain = 'unknown') {
        return `${NODE_TYPES.WALLET}:${normalizeChain(chain)}:${normalizeAddress(address)}`;
    }

    function tokenId(tokenMint, chain = 'unknown') {
        return `${NODE_TYPES.TOKEN}:${normalizeChain(chain)}:${normalizeAddress(tokenMint)}`;
    }

    function entityId(label, source = 'unknown') {
        const normalizedLabel = String(label || 'unlabeled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const normalizedSource = String(source || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `${NODE_TYPES.ENTITY}:${normalizedSource}:${normalizedLabel}`;
    }

    function hubId(label, source = 'unknown', category = HUB_CATEGORIES.LABELED_ENTITY) {
        const normalizedLabel = String(label || 'unlabeled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const normalizedSource = String(source || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const normalizedCategory = normalizeHubCategory(category);
        return `${NODE_TYPES.HUB}:${normalizedCategory}:${normalizedSource}:${normalizedLabel}`;
    }

    function normalizeHubCategory(value) {
        const normalized = String(value || HUB_CATEGORIES.LABELED_ENTITY).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        return Object.values(HUB_CATEGORIES).includes(normalized) ? normalized : HUB_CATEGORIES.LABELED_ENTITY;
    }

    function normalizeConfidence(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.max(0, Math.min(1, number));
    }

    function normalizeNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function interpretTransactionType(value = '') {
        const raw = String(value || '').trim();
        const key = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_') || 'UNKNOWN';
        return {
            key: TRANSACTION_TYPE_LABELS[key] ? key : 'UNKNOWN',
            raw,
            label: TRANSACTION_TYPE_LABELS[key] || TRANSACTION_TYPE_LABELS.UNKNOWN
        };
    }

    function formatSourceLabel(value = '') {
        return String(value || '')
            .trim()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, char => char.toUpperCase()) || '';
    }

    function normalizeWallet(wallet = {}) {
        const chain = normalizeChain(wallet.chain);
        const address = normalizeAddress(wallet.address || wallet.wallet_address);
        return {
            id: wallet.id || walletId(address, chain),
            type: NODE_TYPES.WALLET,
            address,
            chain,
            label: wallet.label || wallet.name || shortAddress(address),
            label_source: wallet.label_source || wallet.source || 'unknown',
            confidence: normalizeConfidence(wallet.confidence),
            metadata: { ...wallet.metadata }
        };
    }

    function normalizeToken(token = {}) {
        const chain = normalizeChain(token.chain);
        const tokenMint = normalizeAddress(token.token_mint || token.contract_address || token.address);
        return {
            id: token.id || tokenId(tokenMint, chain),
            type: NODE_TYPES.TOKEN,
            symbol: String(token.symbol || 'TOKEN').trim(),
            name: token.name || token.symbol || 'Token',
            token_mint: tokenMint,
            contract_address: normalizeAddress(token.contract_address || tokenMint),
            chain,
            decimals: normalizeNumber(token.decimals),
            label_source: token.label_source || token.source || 'unknown',
            confidence: normalizeConfidence(token.confidence),
            metadata: { ...token.metadata }
        };
    }

    function normalizeEntity(entity = {}) {
        const label = entity.label || entity.name || 'Unlabeled Entity';
        const source = entity.source || entity.label_source || 'unknown';
        const category = normalizeHubCategory(entity.category || entity.hub_type || entity.entity_type || entity.type);
        const relatedWallets = normalizeStringList(entity.related_wallets || entity.wallets || entity.wallet_addresses)
            .map(normalizeAddress)
            .filter(Boolean);
        const relatedPrograms = normalizeStringList(entity.related_programs || entity.programs || entity.program_ids)
            .map(normalizeAddress)
            .filter(Boolean);
        return {
            id: entity.id || hubId(label, source, category),
            type: NODE_TYPES.HUB,
            label,
            category,
            chain: normalizeChain(entity.chain),
            label_source: source,
            confidence: normalizeConfidence(entity.confidence),
            related_wallets: relatedWallets,
            related_programs: relatedPrograms,
            wallets: relatedWallets,
            metadata: { ...entity.metadata }
        };
    }

    function normalizeTransaction(transaction = {}) {
        const chain = normalizeChain(transaction.chain);
        const transactionHash = String(transaction.transaction_hash || transaction.hash || transaction.tx_hash || '').trim();
        const metadata = { ...transaction.metadata };
        const hubIds = normalizeStringList(transaction.hub_ids || transaction.entity_ids || transaction.related_hubs || metadata.hub_ids);
        [
            transaction.hub_id,
            transaction.entity_id,
            transaction.exchange_hub_id,
            transaction.protocol_hub_id,
            transaction.route_hub_id,
            transaction.pool_hub_id,
            transaction.liquidity_pool_hub_id,
            transaction.bridge_hub_id,
            transaction.counterparty_hub_id,
            metadata.hub_id,
            metadata.entity_id,
            metadata.exchange_hub_id,
            metadata.protocol_hub_id,
            metadata.route_hub_id,
            metadata.pool_hub_id,
            metadata.liquidity_pool_hub_id,
            metadata.bridge_hub_id,
            metadata.counterparty_hub_id
        ].forEach(id => {
            const value = String(id || '').trim();
            if (value && !hubIds.includes(value)) hubIds.push(value);
        });

        return {
            id: transaction.id || `tx:${chain}:${transactionHash || cryptoSafeId(transaction)}`,
            type: 'transaction',
            transaction_type: String(transaction.transaction_type || transaction.type || metadata.source_format || '').trim(),
            transaction_type_key: String(transaction.transaction_type_key || metadata.transaction_type_key || interpretTransactionType(transaction.transaction_type || transaction.type || metadata.solana_type).key).trim(),
            transaction_type_label: String(transaction.transaction_type_label || metadata.transaction_type_label || interpretTransactionType(transaction.transaction_type || transaction.type || metadata.solana_type).label).trim(),
            transaction_hash: transactionHash,
            chain,
            source_wallet: normalizeAddress(transaction.source_wallet || transaction.from || transaction.source),
            destination_wallet: normalizeAddress(transaction.destination_wallet || transaction.to || transaction.target),
            token_mint: normalizeAddress(transaction.token_mint || transaction.contract_address || transaction.token),
            symbol: String(transaction.symbol || '').trim(),
            amount: normalizeNumber(transaction.amount),
            amount_display: String(transaction.amount_display || metadata.amount_display || '').trim(),
            usd_value: normalizeNumber(transaction.usd_value),
            timestamp: transaction.timestamp || transaction.block_time || null,
            confidence: normalizeConfidence(transaction.confidence),
            label_source: transaction.label_source || transaction.source || 'unknown',
            hub_ids: hubIds,
            flow_role: String(transaction.flow_role || metadata.flow_role || '').trim(),
            route_id: String(transaction.route_id || metadata.route_id || '').trim(),
            transaction_group_id: String(transaction.transaction_group_id || metadata.transaction_group_id || '').trim(),
            leg_index: normalizeNumber(transaction.leg_index ?? metadata.leg_index),
            leg_count: normalizeNumber(transaction.leg_count ?? metadata.leg_count),
            source_program: String(transaction.source_program || metadata.source_program || '').trim(),
            source_label: String(transaction.source_label || metadata.source_label || formatSourceLabel(transaction.source_program || metadata.source_program)).trim(),
            direction: String(transaction.direction || metadata.direction || '').trim(),
            tracked_wallet_role: String(transaction.tracked_wallet_role || metadata.tracked_wallet_role || '').trim(),
            metadata
        };
    }

    function normalizeTransactionGroup(group = {}) {
        const typeInfo = interpretTransactionType(group.transaction_type || group.type || group.transaction_type_key);
        const tokens = normalizeStringList(group.tokens_involved || group.tokens || group.token_symbols);
        const tokenMints = normalizeStringList(group.token_mints || group.mints);
        return {
            id: String(group.id || `txgroup:${normalizeChain(group.chain)}:${group.signature || group.transaction_hash || cryptoSafeId(group)}`).trim(),
            chain: normalizeChain(group.chain),
            signature: String(group.signature || group.transaction_hash || '').trim(),
            transaction_type: String(group.transaction_type || group.type || typeInfo.raw).trim(),
            transaction_type_key: String(group.transaction_type_key || typeInfo.key).trim(),
            transaction_type_label: String(group.transaction_type_label || typeInfo.label).trim(),
            source_program: String(group.source_program || group.source || '').trim(),
            source_label: String(group.source_label || formatSourceLabel(group.source_program || group.source)).trim(),
            leg_count: normalizeNumber(group.leg_count),
            primary_wallet: normalizeAddress(group.primary_wallet || group.tracked_wallet),
            primary_wallet_role: String(group.primary_wallet_role || group.tracked_wallet_role || '').trim(),
            direction: String(group.direction || '').trim(),
            tokens_involved: tokens,
            token_mints: tokenMints.map(normalizeAddress).filter(Boolean),
            timestamp: group.timestamp || null,
            fee_payer: normalizeAddress(group.fee_payer || group.feePayer),
            metadata: { ...(group.metadata || {}) }
        };
    }

    function normalizeDataset(dataset = {}) {
        const wallets = (Array.isArray(dataset.wallets) ? dataset.wallets : []).map(normalizeWallet).filter(wallet => wallet.address);
        const tokens = (Array.isArray(dataset.tokens) ? dataset.tokens : []).map(normalizeToken).filter(token => token.token_mint);
        const entities = [
            ...(Array.isArray(dataset.entities) ? dataset.entities : []),
            ...(Array.isArray(dataset.hubs) ? dataset.hubs : []),
            ...(Array.isArray(dataset.entity_hubs) ? dataset.entity_hubs : [])
        ].map(normalizeEntity);
        const transactions = (Array.isArray(dataset.transactions) ? dataset.transactions : [])
            .map(normalizeTransaction)
            .filter(transaction => transaction.source_wallet && transaction.destination_wallet);
        const transactionGroups = (Array.isArray(dataset.transaction_groups) ? dataset.transaction_groups : [])
            .map(normalizeTransactionGroup)
            .filter(group => group.signature || group.id);

        return {
            metadata: { ...(dataset.metadata || {}) },
            wallets,
            tokens,
            entities,
            transactions,
            transaction_groups: transactionGroups
        };
    }

    function normalizeStringList(value) {
        const list = Array.isArray(value) ? value : value ? [value] : [];
        return list.map(item => String(item || '').trim()).filter(Boolean);
    }

    function shortAddress(address) {
        const value = String(address || '');
        if (value.length <= 14) return value || 'Unknown Wallet';
        return `${value.slice(0, 6)}...${value.slice(-4)}`;
    }

    function formatUsd(value) {
        const number = normalizeNumber(value);
        if (Math.abs(number) >= 1000000) return `$${(number / 1000000).toFixed(2)}M`;
        if (Math.abs(number) >= 1000) return `$${(number / 1000).toFixed(1)}K`;
        return `$${number.toFixed(0)}`;
    }

    function formatTokenAmount(value, symbol = '') {
        const number = normalizeNumber(value);
        const token = String(symbol || '').trim();
        const abs = Math.abs(number);
        let text;
        if (!abs) text = '0';
        else if (abs >= 1000000) text = number.toLocaleString(undefined, { maximumFractionDigits: 2 });
        else if (abs >= 1000) text = number.toLocaleString(undefined, { maximumFractionDigits: 3 });
        else if (abs >= 1) text = number.toLocaleString(undefined, { maximumFractionDigits: 6 });
        else text = number.toLocaleString(undefined, { maximumFractionDigits: 9 });
        return token ? `${text} ${token}` : text;
    }

    function cryptoSafeId(value) {
        const text = JSON.stringify(value);
        let hash = 0;
        for (let index = 0; index < text.length; index++) {
            hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
        }
        return Math.abs(hash).toString(36);
    }

    function getSampleDataset() {
        return JSON.parse(JSON.stringify(SAMPLE_DATASET));
    }

    namespace.core = {
        NODE_TYPES,
        HUB_CATEGORIES,
        EDGE_TYPES,
        normalizeDataset,
        normalizeWallet,
        normalizeToken,
        normalizeEntity,
        normalizeTransaction,
        normalizeTransactionGroup,
        normalizeHubCategory,
        normalizeAddress,
        normalizeChain,
        normalizeConfidence,
        normalizeNumber,
        interpretTransactionType,
        formatSourceLabel,
        walletId,
        tokenId,
        entityId,
        hubId,
        shortAddress,
        formatUsd,
        formatTokenAmount,
        getSampleDataset
    };
})();
