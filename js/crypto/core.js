(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const NODE_TYPES = Object.freeze({
        WALLET: 'wallet',
        TOKEN: 'token',
        ENTITY: 'entity'
    });

    const EDGE_TYPES = Object.freeze({
        FLOW: 'transaction_flow',
        EXPOSURE: 'token_exposure',
        LABEL: 'label_link'
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
                label: 'Sample Entity Group A',
                source: 'dev_sample',
                confidence: 0.48,
                wallets: [
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

    function normalizeConfidence(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.max(0, Math.min(1, number));
    }

    function normalizeNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
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
        return {
            id: entity.id || entityId(label, source),
            type: NODE_TYPES.ENTITY,
            label,
            chain: normalizeChain(entity.chain),
            label_source: source,
            confidence: normalizeConfidence(entity.confidence),
            wallets: Array.isArray(entity.wallets) ? entity.wallets.map(normalizeAddress).filter(Boolean) : [],
            metadata: { ...entity.metadata }
        };
    }

    function normalizeTransaction(transaction = {}) {
        const chain = normalizeChain(transaction.chain);
        const transactionHash = String(transaction.transaction_hash || transaction.hash || transaction.tx_hash || '').trim();
        return {
            id: transaction.id || `tx:${chain}:${transactionHash || cryptoSafeId(transaction)}`,
            type: 'transaction',
            transaction_hash: transactionHash,
            chain,
            source_wallet: normalizeAddress(transaction.source_wallet || transaction.from || transaction.source),
            destination_wallet: normalizeAddress(transaction.destination_wallet || transaction.to || transaction.target),
            token_mint: normalizeAddress(transaction.token_mint || transaction.contract_address || transaction.token),
            symbol: String(transaction.symbol || '').trim(),
            amount: normalizeNumber(transaction.amount),
            usd_value: normalizeNumber(transaction.usd_value),
            timestamp: transaction.timestamp || transaction.block_time || null,
            confidence: normalizeConfidence(transaction.confidence),
            label_source: transaction.label_source || transaction.source || 'unknown',
            metadata: { ...transaction.metadata }
        };
    }

    function normalizeDataset(dataset = {}) {
        const wallets = (Array.isArray(dataset.wallets) ? dataset.wallets : []).map(normalizeWallet).filter(wallet => wallet.address);
        const tokens = (Array.isArray(dataset.tokens) ? dataset.tokens : []).map(normalizeToken).filter(token => token.token_mint);
        const entities = (Array.isArray(dataset.entities) ? dataset.entities : []).map(normalizeEntity);
        const transactions = (Array.isArray(dataset.transactions) ? dataset.transactions : [])
            .map(normalizeTransaction)
            .filter(transaction => transaction.source_wallet && transaction.destination_wallet);

        return {
            metadata: { ...(dataset.metadata || {}) },
            wallets,
            tokens,
            entities,
            transactions
        };
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
        EDGE_TYPES,
        normalizeDataset,
        normalizeWallet,
        normalizeToken,
        normalizeEntity,
        normalizeTransaction,
        normalizeAddress,
        normalizeChain,
        normalizeConfidence,
        normalizeNumber,
        walletId,
        tokenId,
        entityId,
        shortAddress,
        formatUsd,
        getSampleDataset
    };
})();
