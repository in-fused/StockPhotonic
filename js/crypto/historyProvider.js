(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_PROVIDER_VERSION = 'd106_provider_contract_v1';

    class WalletHistoryProvider {
        constructor(options = {}) {
            this.id = options.id || 'wallet-history-provider';
            this.label = options.label || 'Wallet History Provider';
            this.providerKind = options.providerKind || 'abstract';
            this.supportsPagination = options.supportsPagination !== false;
            this.backendOnly = options.backendOnly !== false;
        }

        async getHistoryPage(wallet, cursor = null) {
            throw new Error(`${this.label} must implement getHistoryPage(wallet, cursor)`);
        }

        getCapabilities() {
            return {
                id: this.id,
                label: this.label,
                providerKind: this.providerKind,
                supportsPagination: this.supportsPagination,
                backendOnly: this.backendOnly,
                browserProviderCalls: false,
                apiKeyExposure: false
            };
        }
    }

    class BackendOnlyStubProvider extends WalletHistoryProvider {
        constructor(options = {}) {
            super({
                supportsPagination: true,
                backendOnly: true,
                ...options
            });
        }

        async getHistoryPage(wallet, cursor = null) {
            return normalizeHistoryPage({
                provider: this.id,
                wallet,
                cursor,
                nextCursor: cursor || null,
                transactions: [],
                moreAvailable: false,
                status: 'backend_provider_required',
                message: `${this.label} is a backend-only stub. Wire it behind a Worker/server adapter before loading additional history.`
            });
        }
    }

    class HeliusHistoryProvider extends BackendOnlyStubProvider {
        constructor(options = {}) {
            super({
                id: 'helius-history-provider',
                label: 'Helius History Provider',
                providerKind: 'helius',
                ...options
            });
        }
    }

    class PlaceholderExternalProvider extends BackendOnlyStubProvider {
        constructor(options = {}) {
            super({
                id: options.id || 'placeholder-external-history-provider',
                label: options.label || 'Placeholder External History Provider',
                providerKind: options.providerKind || 'external',
                ...options
            });
        }
    }

    function normalizeHistoryPage(page = {}) {
        const transactions = Array.isArray(page.transactions)
            ? page.transactions
            : Array.isArray(page.events)
                ? page.events
                : [];
        const nextCursor = page.nextCursor ?? page.next_cursor ?? page.cursor_next ?? null;
        const moreAvailable = Boolean(page.moreAvailable ?? page.hasMore ?? page.has_more ?? nextCursor);

        return {
            provider: String(page.provider || page.source || ''),
            wallet: String(page.wallet || ''),
            cursor: page.cursor ?? null,
            nextCursor,
            transactions,
            transactionCount: transactions.length,
            moreAvailable,
            status: String(page.status || 'ok'),
            message: String(page.message || ''),
            metadata: {
                ...(page.metadata || {}),
                history_provider_contract: HISTORY_PROVIDER_VERSION,
                supports_pagination: true,
                browser_provider_calls: false
            }
        };
    }

    namespace.historyProvider = {
        HISTORY_PROVIDER_VERSION,
        WalletHistoryProvider,
        HeliusHistoryProvider,
        PlaceholderExternalProvider,
        normalizeHistoryPage
    };
})();
