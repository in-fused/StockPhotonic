(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_PROVIDER_VERSION = 'd130_provider_scan_manifest_contract_v1';
    const ARCHIVE_HISTORY_CONTRACT_VERSION = 'd129_archive_history_contract_v1';

    class WalletHistoryProvider {
        constructor(options = {}) {
            this.id = options.id || 'wallet-history-provider';
            this.label = options.label || 'Wallet History Provider';
            this.providerKind = options.providerKind || 'abstract';
            this.supportsPagination = options.supportsPagination !== false;
            this.backendOnly = options.backendOnly !== false;
            this.providerGrade = options.providerGrade || 'basic';
            this.replaySuitability = options.replaySuitability || 'low';
            this.completenessConfidence = clampConfidence(options.completenessConfidence);
            this.historicalDepth = options.historicalDepth || 'unknown';
            this.orderingGuarantee = options.orderingGuarantee || 'unknown';
            this.cursorGuarantee = options.cursorGuarantee || 'unknown';
            this.coverageScope = options.coverageScope || 'unknown';
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
                providerGrade: this.providerGrade,
                replaySuitability: this.replaySuitability,
                completenessConfidence: this.completenessConfidence,
                historicalDepth: this.historicalDepth,
                orderingGuarantee: this.orderingGuarantee,
                cursorGuarantee: this.cursorGuarantee,
                coverageScope: this.coverageScope,
                archiveContractVersion: ARCHIVE_HISTORY_CONTRACT_VERSION,
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

    class WorkerWalletHistoryProvider extends WalletHistoryProvider {
        constructor(options = {}) {
            super({
                id: options.id || 'worker-wallet-history-provider',
                label: options.label || 'Worker Wallet History Provider',
                providerKind: 'worker',
                supportsPagination: true,
                backendOnly: false
            });
            this.endpoint = String(options.endpoint || '/api/crypto/wallet-history').trim();
            this.limit = Math.max(1, Math.min(50, Number(options.limit) || 10));
        }

        async getHistoryPage(wallet, cursor = null, options = {}) {
            const normalizedWallet = String(wallet || '').trim();
            if (!normalizedWallet) {
                throw new Error('Wallet history requires a wallet address');
            }
            if (!this.endpoint) {
                throw new Error('Worker wallet history endpoint unavailable');
            }

            const separator = this.endpoint.includes('?') ? '&' : '?';
            const params = new URLSearchParams({
                wallet: normalizedWallet,
                limit: String(this.limit)
            });
            if (cursor) params.set('cursor', String(cursor));
            const loadedPages = Math.max(0, Number(options.loadedPages) || 0);
            const loadedTransactions = Math.max(0, Number(options.loadedTransactions) || 0);
            const scanId = String(options.scanId || options.scanManifest?.scan_id || '').trim();
            if (loadedPages) params.set('loaded_pages', String(Math.floor(loadedPages)));
            if (loadedTransactions) params.set('loaded_transactions', String(Math.floor(loadedTransactions)));
            if (/^[A-Za-z0-9._:-]{1,180}$/.test(scanId)) params.set('scan_id', scanId);

            const response = await fetch(`${this.endpoint}${separator}${params.toString()}`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                if (payload && typeof payload === 'object' && (payload.status || payload.message)) {
                    return normalizeHistoryPage({
                        ...payload,
                        wallet: payload.wallet || normalizedWallet,
                        cursor,
                        provider: payload.provider || this.id,
                        metadata: {
                            ...(payload.metadata || {}),
                            worker_endpoint_contract: '/api/crypto/wallet-history',
                            browser_provider_calls: false
                        }
                    });
                }
                return normalizeHistoryPage({
                    provider: this.id,
                    wallet: normalizedWallet,
                    cursor,
                    nextCursor: null,
                    transactions: [],
                    moreAvailable: false,
                    status: response.status === 404 ? 'provider_not_configured' : 'provider_unavailable',
                    message: response.status === 404
                        ? 'Worker wallet-history endpoint unavailable. No provider data was loaded or merged.'
                        : 'Worker wallet-history endpoint returned an unavailable status. No provider data was loaded or merged.',
                    metadata: {
                        worker_endpoint_contract: '/api/crypto/wallet-history',
                        worker_http_status: response.status,
                        browser_provider_calls: false,
                        provider_configured: false,
                        no_data_merged: true
                    }
                });
            }

            return normalizeHistoryPage({
                ...(payload || {}),
                wallet: payload?.wallet || normalizedWallet,
                cursor,
                provider: payload?.provider || this.id,
                metadata: {
                    ...(payload?.metadata || {}),
                    worker_endpoint_contract: '/api/crypto/wallet-history',
                    browser_provider_calls: false
                }
            });
        }

        async getProviderDiagnostics(wallet = '') {
            if (!this.endpoint) {
                throw new Error('Worker wallet history endpoint unavailable');
            }

            const separator = this.endpoint.includes('?') ? '&' : '?';
            const params = new URLSearchParams({
                diagnostics: '1',
                limit: String(this.limit)
            });
            const normalizedWallet = String(wallet || '').trim();
            if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalizedWallet)) {
                params.set('wallet', normalizedWallet);
            }

            const response = await fetch(`${this.endpoint}${separator}${params.toString()}`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            const payload = await response.json().catch(() => null);
            const metadata = payload && typeof payload === 'object' ? (payload.metadata || {}) : {};
            return {
                provider: payload?.provider || this.id,
                wallet: payload?.wallet || normalizedWallet,
                status: payload?.status || (response.ok ? 'diagnostics_ok' : 'provider_unavailable'),
                message: payload?.message || (response.ok
                    ? 'Provider diagnostics loaded from Worker metadata.'
                    : 'Provider diagnostics unavailable from Worker metadata.'),
                metadata: {
                    ...metadata,
                    worker_endpoint_contract: '/api/crypto/wallet-history',
                    browser_provider_calls: false,
                    no_history_page_loaded: true
                },
                providerDiagnostics: payload?.providerDiagnostics || metadata.provider_diagnostics || null
            };
        }

        getCapabilities() {
            return {
                ...super.getCapabilities(),
                endpointContract: '/api/crypto/wallet-history',
                workerBacked: true,
                browserProviderCalls: false,
                apiKeyExposure: false
            };
        }
    }

    class HeliusHistoryProvider extends BackendOnlyStubProvider {
        constructor(options = {}) {
            super({
                id: 'helius-history-provider',
                label: 'Helius History Provider',
                providerKind: 'helius',
                providerGrade: 'partial',
                replaySuitability: 'medium',
                completenessConfidence: 55,
                historicalDepth: 'provider_defined',
                orderingGuarantee: 'reverse_chronological',
                cursorGuarantee: 'best_effort',
                coverageScope: 'wallet_with_token_accounts',
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
                providerGrade: options.providerGrade || 'basic',
                replaySuitability: options.replaySuitability || 'low',
                completenessConfidence: options.completenessConfidence ?? 0,
                historicalDepth: options.historicalDepth || 'provider_defined',
                orderingGuarantee: options.orderingGuarantee || 'unknown',
                cursorGuarantee: options.cursorGuarantee || 'unknown',
                coverageScope: options.coverageScope || 'provider_defined',
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
        const metadata = page.metadata || {};

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
                ...metadata,
                history_provider_contract: HISTORY_PROVIDER_VERSION,
                archive_contract_version: metadata.archive_contract_version || ARCHIVE_HISTORY_CONTRACT_VERSION,
                scan_manifest_version: metadata.scan_manifest_version || 'd130_scan_manifest_v1',
                scan_id: metadata.scan_id || metadata.scan_manifest?.scan_id || '',
                scan_manifest: normalizeScanManifest(metadata.scan_manifest),
                provider_grade: metadata.provider_grade || 'basic',
                replay_suitability: metadata.replay_suitability || 'low',
                completeness_confidence: clampConfidence(metadata.completeness_confidence),
                historical_depth: metadata.historical_depth || 'unknown',
                ordering_guarantee: metadata.ordering_guarantee || 'unknown',
                cursor_guarantee: metadata.cursor_guarantee || 'unknown',
                coverage_scope: metadata.coverage_scope || 'unknown',
                provider_family: metadata.provider_family || metadata.provider_diagnostics?.provider_family || 'unknown',
                archive_readiness: metadata.archive_readiness || metadata.provider_diagnostics?.archive_readiness || 'unknown',
                replay_readiness: metadata.replay_readiness || metadata.provider_diagnostics?.replay_readiness || 'unknown',
                gap_flags: Array.isArray(metadata.gap_flags) ? metadata.gap_flags.slice(0, 16) : [],
                warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice(0, 16) : [],
                replay_window: normalizeReplayWindow(metadata.replay_window),
                supports_pagination: true,
                browser_provider_calls: false
            }
        };
    }

    function normalizeScanManifest(manifest = null) {
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
        return {
            scan_id: String(manifest.scan_id || ''),
            wallet: String(manifest.wallet || ''),
            provider: String(manifest.provider || ''),
            provider_grade: String(manifest.provider_grade || 'basic'),
            replay_suitability: String(manifest.replay_suitability || 'low'),
            started_at: String(manifest.started_at || ''),
            updated_at: String(manifest.updated_at || ''),
            cursor_state: manifest.cursor_state && typeof manifest.cursor_state === 'object' ? { ...manifest.cursor_state } : {},
            pages_loaded: Math.max(0, Number(manifest.pages_loaded) || 0),
            transactions_loaded: Math.max(0, Number(manifest.transactions_loaded) || 0),
            earliest_timestamp: String(manifest.earliest_timestamp || ''),
            latest_timestamp: String(manifest.latest_timestamp || ''),
            provider_limit_reached: manifest.provider_limit_reached === true,
            rate_limited: manifest.rate_limited === true,
            completeness_confidence: clampConfidence(manifest.completeness_confidence),
            full_history_loaded: manifest.full_history_loaded === true,
            gap_flags: Array.isArray(manifest.gap_flags) ? manifest.gap_flags.slice(0, 16) : [],
            warnings: Array.isArray(manifest.warnings) ? manifest.warnings.slice(0, 16) : []
        };
    }

    function normalizeReplayWindow(windowMetadata = null) {
        if (!windowMetadata || typeof windowMetadata !== 'object' || Array.isArray(windowMetadata)) return null;
        return {
            preview_only: windowMetadata.preview_only !== false,
            staged_history_only: windowMetadata.staged_history_only !== false,
            rows_in_page: Math.max(0, Number(windowMetadata.rows_in_page) || 0),
            rows_loaded_estimate: Math.max(0, Number(windowMetadata.rows_loaded_estimate) || 0),
            earliest_timestamp: String(windowMetadata.earliest_timestamp || ''),
            latest_timestamp: String(windowMetadata.latest_timestamp || ''),
            coverage_pct: clampConfidence(windowMetadata.coverage_pct),
            coverage_basis: String(windowMetadata.coverage_basis || ''),
            replay_suitability: String(windowMetadata.replay_suitability || ''),
            completeness_confidence: clampConfidence(windowMetadata.completeness_confidence),
            warnings: Array.isArray(windowMetadata.warnings)
                ? windowMetadata.warnings.slice(0, 8)
                : Array.isArray(windowMetadata.generation_warnings)
                    ? windowMetadata.generation_warnings.slice(0, 8)
                    : []
        };
    }

    function clampConfidence(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.max(0, Math.min(100, Math.round(number)));
    }

    namespace.historyProvider = {
        HISTORY_PROVIDER_VERSION,
        ARCHIVE_HISTORY_CONTRACT_VERSION,
        WalletHistoryProvider,
        WorkerWalletHistoryProvider,
        HeliusHistoryProvider,
        PlaceholderExternalProvider,
        normalizeHistoryPage
    };
})();
