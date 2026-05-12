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

    const HISTORY_CONTROLLER_VERSION = 'd130_history_controller_scan_manifest_v1';
    const MAX_PROGRESSIVE_LOAD_PAGES = 20;

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
            this.progressiveLoading = false;
            this.lastError = '';
            this.lastMessage = '';
            this.lastStatus = 'idle';
            this.lastMetadata = {};
            this.scanManifest = null;
            this.scanId = '';
            this.gapFlags = [];
            this.warnings = [];
            this.replayWindow = null;
            this.progress = null;
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
                const page = await this.provider.getHistoryPage(this.wallet, this.nextCursor, {
                    loadedPages: this.providerPagesLoaded,
                    loadedTransactions: this.totalLoadedTransactions,
                    scanId: this.scanId,
                    scanManifest: this.scanManifest
                });
                this.recordPage(page);
            } catch (error) {
                this.lastError = error?.message || 'History page load failed';
            } finally {
                this.loading = false;
            }

            return this.getSnapshot();
        }

        async loadPages(options = {}) {
            if (this.loading || this.progressiveLoading) return this.getSnapshot();
            const requestedPages = options.untilLimit
                ? MAX_PROGRESSIVE_LOAD_PAGES
                : Math.max(1, Math.min(MAX_PROGRESSIVE_LOAD_PAGES, Math.floor(Number(options.pages) || 1)));
            const untilLimit = options.untilLimit === true;
            const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
            let loaded = 0;
            this.progressiveLoading = true;

            try {
                for (let index = 0; index < requestedPages; index += 1) {
                    if (this.providerPagesLoaded > 0 && !this.moreAvailable) break;
                    this.progress = {
                        mode: untilLimit ? 'until_limit' : 'batch',
                        current: index + 1,
                        target: untilLimit ? null : requestedPages,
                        loaded,
                        totalTransactions: this.totalLoadedTransactions,
                        message: untilLimit
                            ? `Loading page ${index + 1} of ?`
                            : `Loading page ${index + 1} of ${requestedPages}`
                    };
                    onProgress?.(this.getSnapshot());
                    const beforePages = this.providerPagesLoaded;
                    await this.loadNextPage(options);
                    if (this.providerPagesLoaded > beforePages) loaded += 1;
                    onProgress?.(this.getSnapshot());
                    if (shouldStopProgressiveLoad(this.getSnapshot())) break;
                    await waitForUiTurn();
                }
            } finally {
                this.progressiveLoading = false;
                this.progress = null;
            }

            return this.getSnapshot();
        }

        recordPage(page = {}, options = {}) {
            const normalized = normalizeHistoryPage(page);
            const previousNextCursor = this.nextCursor ?? null;
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
            if (pageRecord.status === 'ok') {
                this.nextCursor = pageRecord.nextCursor ?? null;
                this.moreAvailable = Boolean(pageRecord.moreAvailable && this.nextCursor);
            } else if (isTerminalHistoryStatus(pageRecord.status)) {
                this.nextCursor = null;
                this.moreAvailable = false;
            } else {
                this.nextCursor = previousNextCursor;
                this.moreAvailable = Boolean(previousNextCursor);
            }
            this.totalLoadedTransactions += recordNewTransactions(pageRecord.transactions, this.seenTransactionKeys, this.loadedTransactions);
            this.lastMessage = pageRecord.message || '';
            this.lastStatus = pageRecord.status || 'ok';
            this.lastMetadata = pageRecord.metadata || {};
            this.scanManifest = normalizeScanManifest(pageRecord.metadata?.scan_manifest || this.scanManifest);
            this.scanId = pageRecord.metadata?.scan_id || this.scanManifest?.scan_id || this.scanId || '';
            this.gapFlags = mergeStringLists(this.gapFlags, pageRecord.metadata?.gap_flags, this.scanManifest?.gap_flags);
            this.warnings = mergeStringLists(this.warnings, pageRecord.metadata?.warnings, this.scanManifest?.warnings);
            this.replayWindow = pageRecord.metadata?.replay_window || this.replayWindow || null;
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
                progressiveLoading: this.progressiveLoading,
                lastError: this.lastError,
                lastMessage: this.lastMessage,
                lastStatus: this.lastStatus,
                lastMetadata: this.lastMetadata,
                scanManifest: this.scanManifest,
                scanId: this.scanId,
                gapFlags: this.gapFlags.slice(0, 16),
                warnings: this.warnings.slice(0, 16),
                replayWindow: this.replayWindow,
                progress: this.progress,
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

    function shouldStopProgressiveLoad(snapshot = {}) {
        const status = String(snapshot.lastStatus || '').trim();
        return !snapshot.moreAvailable
            || status === 'provider_rate_limited'
            || status === 'provider_limited'
            || snapshot.lastMetadata?.rate_limited === true
            || snapshot.lastMetadata?.provider_limit_reached === true
            || snapshot.lastMetadata?.cursor_stalled === true
            || hasBlockingGapFlag(snapshot.lastMetadata?.gap_flags)
            || hasBlockingGapFlag(snapshot.scanManifest?.gap_flags);
    }

    function hasBlockingGapFlag(flags = []) {
        const blocking = new Set([
            'cursor_stall',
            'schema_mismatch',
            'malformed_ordering',
            'provider_exhaustion_ambiguous'
        ]);
        return Array.isArray(flags) && flags.some(flag => blocking.has(String(flag || '').trim()));
    }

    function normalizeScanManifest(manifest = null) {
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
        return {
            ...manifest,
            scan_id: String(manifest.scan_id || ''),
            gap_flags: Array.isArray(manifest.gap_flags) ? manifest.gap_flags.slice(0, 16) : [],
            warnings: Array.isArray(manifest.warnings) ? manifest.warnings.slice(0, 16) : []
        };
    }

    function mergeStringLists(...lists) {
        const values = [];
        lists.forEach(list => {
            if (!Array.isArray(list)) return;
            list.forEach(item => {
                const value = String(item || '').trim();
                if (value && !values.includes(value)) values.push(value);
            });
        });
        return values.slice(0, 16);
    }

    function waitForUiTurn() {
        return new Promise(resolve => setTimeout(resolve, 0));
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

    function isTerminalHistoryStatus(status = '') {
        return [
            'provider_limited',
            'provider_not_configured',
            'provider_placeholder',
            'provider_rate_limited',
            'provider_unavailable'
        ].includes(String(status || '').trim());
    }

    namespace.historyController = {
        HISTORY_CONTROLLER_VERSION,
        HistoryController
    };
})();
