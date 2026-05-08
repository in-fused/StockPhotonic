(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const providerNamespace = namespace.historyProvider || {};
    const normalizeHistoryPage = providerNamespace.normalizeHistoryPage || ((page = {}) => ({
        provider: String(page.provider || ''),
        wallet: String(page.wallet || ''),
        cursor: page.cursor ?? null,
        nextCursor: page.nextCursor ?? page.next_cursor ?? null,
        transactions: Array.isArray(page.transactions) ? page.transactions : Array.isArray(page.events) ? page.events : [],
        transactionCount: Array.isArray(page.transactions) ? page.transactions.length : Array.isArray(page.events) ? page.events.length : 0,
        moreAvailable: Boolean(page.moreAvailable ?? page.hasMore ?? page.has_more ?? page.nextCursor ?? page.next_cursor),
        status: String(page.status || 'ok'),
        message: String(page.message || ''),
        metadata: page.metadata || {}
    }));

    const HISTORY_CONTROLLER_VERSION = 'd106_history_controller_v1';

    class HistoryController {
        constructor(options = {}) {
            this.provider = options.provider || null;
            this.pageLimit = Math.max(1, Number(options.pageLimit) || 100);
            this.reset(options.wallet || '');
        }

        reset(wallet = '') {
            this.wallet = String(wallet || '').trim();
            this.pages = [];
            this.cursors = [];
            this.nextCursor = null;
            this.moreAvailable = false;
            this.loading = false;
            this.lastError = '';
            this.lastMessage = '';
            this.lastStatus = 'idle';
            this.providerConfigured = false;
            this.providerPagesLoaded = 0;
            this.totalLoadedTransactions = 0;
            this.seenTransactionKeys = new Set();
            this.loadedTransactions = [];
            return this.getSnapshot();
        }

        setProvider(provider) {
            this.provider = provider || null;
            return this.getSnapshot();
        }

        seedPage(page = {}, options = {}) {
            if (options.replace) this.reset(options.wallet || page.wallet || this.wallet);
            if (page.wallet && !this.wallet) this.wallet = String(page.wallet).trim();
            return this.recordPage(page, { seeded: true });
        }

        async loadNextPage(options = {}) {
            if (this.loading) return this.getSnapshot();
            if (!this.wallet && options.wallet) this.wallet = String(options.wallet).trim();
            if (!this.wallet) {
                this.lastError = 'Wallet history requires a wallet address';
                return this.getSnapshot();
            }
            if (!this.provider || typeof this.provider.getHistoryPage !== 'function') {
                this.lastError = 'Backend history provider not connected';
                this.lastMessage = 'Load more is prepared, but browser code will not call Helius, lana.ai, RPC, or other providers directly.';
                return this.getSnapshot();
            }
            if (this.providerPagesLoaded > 0 && !this.moreAvailable) {
                this.lastMessage = 'No additional history cursor is available yet';
                return this.getSnapshot();
            }

            this.loading = true;
            this.lastError = '';
            try {
                const page = await this.provider.getHistoryPage(this.wallet, this.nextCursor);
                this.recordPage(page);
            } catch (error) {
                this.lastError = error?.message || 'History page load failed';
            } finally {
                this.loading = false;
            }

            return this.getSnapshot();
        }

        recordPage(page = {}, options = {}) {
            const normalized = normalizeHistoryPage(page);
            const pageCursor = normalized.cursor ?? this.nextCursor ?? null;
            const pageRecord = {
                ...normalized,
                cursor: pageCursor,
                seeded: Boolean(options.seeded),
                loadedAt: Date.now()
            };

            this.pages.push(pageRecord);
            if (!options.seeded) this.providerPagesLoaded += 1;
            this.cursors.push({
                cursor: pageRecord.cursor,
                nextCursor: pageRecord.nextCursor,
                loadedAt: pageRecord.loadedAt
            });
            this.nextCursor = pageRecord.nextCursor ?? null;
            this.moreAvailable = Boolean(pageRecord.moreAvailable && this.nextCursor);
            this.totalLoadedTransactions += recordNewTransactions(pageRecord.transactions, this.seenTransactionKeys, this.loadedTransactions);
            this.lastMessage = pageRecord.message || '';
            this.lastStatus = pageRecord.status || 'ok';
            this.providerConfigured = pageRecord.metadata?.provider_configured === true
                || (!options.seeded && pageRecord.status === 'ok');
            this.lastError = pageRecord.status === 'ok' ? '' : this.lastMessage || pageRecord.status;
            return this.getSnapshot();
        }

        getSnapshot() {
            return {
                version: HISTORY_CONTROLLER_VERSION,
                wallet: this.wallet,
                provider: this.provider?.id || '',
                providerLabel: this.provider?.label || '',
                providerCapabilities: this.provider?.getCapabilities?.() || null,
                pagesLoaded: this.pages.length,
                providerPagesLoaded: this.providerPagesLoaded,
                cursors: this.cursors.slice(),
                nextCursor: this.nextCursor,
                moreAvailable: this.moreAvailable,
                loading: this.loading,
                lastError: this.lastError,
                lastMessage: this.lastMessage,
                lastStatus: this.lastStatus,
                providerConfigured: this.providerConfigured,
                totalLoadedTransactions: this.totalLoadedTransactions,
                loadedTransactions: this.loadedTransactions.slice(0, this.pageLimit),
                pageLimit: this.pageLimit,
                futureModes: {
                    lifetimeReplay: true,
                    progressiveGraphExpansion: true,
                    inceptionDetection: true
                }
            };
        }
    }

    function recordNewTransactions(transactions = [], seenKeys, loadedTransactions) {
        let count = 0;
        transactions.forEach((transaction, index) => {
            const key = getTransactionKey(transaction, index);
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            loadedTransactions.push(transaction);
            count += 1;
        });
        return count;
    }

    function getTransactionKey(transaction = {}, index = 0) {
        return String(
            transaction.signature
            || transaction.transaction_hash
            || transaction.hash
            || transaction.id
            || `${transaction.timestamp || ''}:${transaction.source_wallet || ''}:${transaction.destination_wallet || ''}:${index}`
        );
    }

    namespace.historyController = {
        HISTORY_CONTROLLER_VERSION,
        HistoryController
    };
})();
