(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_PROVIDER_VERSION = 'd131_provider_scan_cache_contract_v1';
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

        async getReplayWindow(scanId = '', options = {}) {
            const normalizedScanId = String(scanId || options.scanId || '').trim();
            if (!/^[A-Za-z0-9._:-]{1,180}$/.test(normalizedScanId)) {
                throw new Error('Replay window requires a safe Worker scan id');
            }
            if (!this.endpoint) {
                throw new Error('Worker wallet history endpoint unavailable');
            }

            const endpoint = buildReplayWindowEndpoint(this.endpoint);
            const separator = endpoint.includes('?') ? '&' : '?';
            const params = new URLSearchParams({
                scan_id: normalizedScanId,
                direction: normalizeReplayWindowDirection(options.direction)
            });
            if (Number(options.windowIndex) > 0) params.set('window_index', String(Math.floor(Number(options.windowIndex))));
            if (Number(options.anchorStep) > 0) params.set('anchor_step', String(Math.floor(Number(options.anchorStep))));
            if (/^[A-Za-z0-9._:-]{1,220}$/.test(String(options.windowId || '').trim())) {
                params.set('window_id', String(options.windowId).trim());
            }
            const limit = Math.max(1, Math.min(320, Number(options.limit) || 320));
            params.set('limit', String(limit));

            const response = await fetch(`${endpoint}${separator}${params.toString()}`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            const payload = await response.json().catch(() => null);
            const metadata = payload && typeof payload === 'object' ? (payload.metadata || {}) : {};
            const replayWindow = normalizeReplayWindow(metadata.replay_window || payload?.replayWindow || payload?.window);
            return {
                provider: payload?.provider || this.id,
                wallet: payload?.wallet || '',
                status: payload?.status || (response.ok ? 'ok' : 'replay_window_unavailable'),
                message: payload?.message || (response.ok
                    ? 'Replay window loaded from Worker metadata.'
                    : 'Replay window unavailable from Worker metadata.'),
                transactions: Array.isArray(payload?.transactions)
                    ? payload.transactions
                    : Array.isArray(payload?.events)
                        ? payload.events
                        : [],
                events: Array.isArray(payload?.events)
                    ? payload.events
                    : Array.isArray(payload?.transactions)
                        ? payload.transactions
                        : [],
                moreAvailable: Boolean(payload?.moreAvailable),
                replayWindow,
                metadata: {
                    ...metadata,
                    worker_endpoint_contract: '/api/crypto/wallet-history/replay-window',
                    browser_provider_calls: false,
                    no_data_merged: true,
                    replay_window: replayWindow,
                    replay_reconstruction: normalizeReplayReconstruction(metadata.replay_reconstruction),
                    scan_manifest: normalizeScanManifest(metadata.scan_manifest),
                    scan_cache: normalizeScanCache(metadata.scan_cache)
                }
            };
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

    function buildReplayWindowEndpoint(endpoint = '') {
        const text = String(endpoint || '/api/crypto/wallet-history').trim() || '/api/crypto/wallet-history';
        const queryIndex = text.indexOf('?');
        const path = queryIndex >= 0 ? text.slice(0, queryIndex) : text;
        const query = queryIndex >= 0 ? text.slice(queryIndex + 1) : '';
        const replayPath = `${path.replace(/\/+$/, '')}/replay-window`;
        return query ? `${replayPath}?${query}` : replayPath;
    }

    function normalizeReplayWindowDirection(value = 'current') {
        const direction = String(value || 'current').trim().toLowerCase();
        return ['current', 'older', 'newer', 'oldest', 'newest', 'anchor'].includes(direction)
            ? direction
            : 'current';
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
                scan_cache: normalizeScanCache(metadata.scan_cache || metadata.scan_manifest?.cache_state),
                replay_reconstruction: normalizeReplayReconstruction(metadata.replay_reconstruction || metadata.scan_manifest?.replay_reconstruction),
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
            warnings: Array.isArray(manifest.warnings) ? manifest.warnings.slice(0, 16) : [],
            cache_state: normalizeScanCache(manifest.cache_state),
            replay_reconstruction: normalizeReplayReconstruction(manifest.replay_reconstruction)
        };
    }

    function normalizeReplayWindow(windowMetadata = null) {
        if (!windowMetadata || typeof windowMetadata !== 'object' || Array.isArray(windowMetadata)) return null;
        const continuation = windowMetadata.continuation && typeof windowMetadata.continuation === 'object' && !Array.isArray(windowMetadata.continuation)
            ? {
                can_continue_older: windowMetadata.continuation.can_continue_older === true,
                can_continue_newer: windowMetadata.continuation.can_continue_newer === true,
                older_window_index: Math.max(0, Number(windowMetadata.continuation.older_window_index) || 0),
                newer_window_index: Math.max(0, Number(windowMetadata.continuation.newer_window_index) || 0),
                older_window_id: String(windowMetadata.continuation.older_window_id || ''),
                newer_window_id: String(windowMetadata.continuation.newer_window_id || ''),
                older_requires_provider_page: windowMetadata.continuation.older_requires_provider_page === true,
                newer_requires_provider_page: windowMetadata.continuation.newer_requires_provider_page === true,
                next_cursor_available: windowMetadata.continuation.next_cursor_available === true,
                no_full_history_claim: windowMetadata.continuation.no_full_history_claim !== false
            }
            : null;
        const boundary = windowMetadata.boundary && typeof windowMetadata.boundary === 'object' && !Array.isArray(windowMetadata.boundary)
            ? {
                oldest_staged_window_index: Math.max(0, Number(windowMetadata.boundary.oldest_staged_window_index) || 0),
                newest_staged_window_index: Math.max(0, Number(windowMetadata.boundary.newest_staged_window_index) || 0),
                is_oldest_staged_window: windowMetadata.boundary.is_oldest_staged_window === true,
                is_newest_staged_window: windowMetadata.boundary.is_newest_staged_window === true,
                missing_windows_possible: windowMetadata.boundary.missing_windows_possible !== false,
                staged_segment_only: windowMetadata.boundary.staged_segment_only !== false,
                preview_only: windowMetadata.boundary.preview_only !== false
            }
            : null;
        return {
            version: String(windowMetadata.version || 'd135_replay_window_v1'),
            id: String(windowMetadata.id || windowMetadata.window_id || ''),
            window_id: String(windowMetadata.window_id || windowMetadata.id || ''),
            scan_id: String(windowMetadata.scan_id || ''),
            preview_only: windowMetadata.preview_only !== false,
            staged_history_only: windowMetadata.staged_history_only !== false,
            active_graph_unchanged: windowMetadata.active_graph_unchanged !== false,
            worker_backed: windowMetadata.worker_backed !== false,
            rows_in_page: Math.max(0, Number(windowMetadata.rows_in_page) || 0),
            rows_in_window_estimate: Math.max(0, Number(windowMetadata.rows_in_window_estimate) || 0),
            rows_loaded_estimate: Math.max(0, Number(windowMetadata.rows_loaded_estimate) || 0),
            earliest_timestamp: String(windowMetadata.earliest_timestamp || ''),
            latest_timestamp: String(windowMetadata.latest_timestamp || ''),
            coverage_pct: clampConfidence(windowMetadata.coverage_pct),
            coverage_basis: String(windowMetadata.coverage_basis || ''),
            replay_suitability: String(windowMetadata.replay_suitability || ''),
            completeness_confidence: clampConfidence(windowMetadata.completeness_confidence),
            window_index: Math.max(0, Number(windowMetadata.window_index || windowMetadata.current_window_index) || 0),
            chunk_size: Math.max(0, Number(windowMetadata.chunk_size) || 0),
            render_cap_transactions: Math.max(0, Number(windowMetadata.render_cap_transactions) || 0),
            current_window_index: Math.max(0, Number(windowMetadata.current_window_index) || 0),
            total_windows: Math.max(0, Number(windowMetadata.total_windows) || 0),
            window_label: String(windowMetadata.window_label || ''),
            range_position: String(windowMetadata.range_position || ''),
            ordinal_start: Math.max(0, Number(windowMetadata.ordinal_start) || 0),
            ordinal_end: Math.max(0, Number(windowMetadata.ordinal_end) || 0),
            partial: windowMetadata.partial === true,
            oldest_first_ready: windowMetadata.oldest_first_ready === true,
            oldest_first_reconstruction_required: windowMetadata.oldest_first_reconstruction_required === true,
            progressive_expansion_available: windowMetadata.progressive_expansion_available === true,
            continuity_confidence: normalizeReplayContinuityProfile(windowMetadata.continuity_confidence),
            gap_map: normalizeReplayGapMap(windowMetadata.gap_map),
            timeline_segments: Array.isArray(windowMetadata.timeline_segments)
                ? windowMetadata.timeline_segments.slice(0, 12).map(normalizeTimelineSegment)
                : [],
            continuation,
            boundary,
            warnings: Array.isArray(windowMetadata.warnings)
                ? windowMetadata.warnings.slice(0, 8)
                : Array.isArray(windowMetadata.generation_warnings)
                    ? windowMetadata.generation_warnings.slice(0, 8)
                    : []
        };
    }

    function normalizeScanCache(cache = null) {
        if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return null;
        return {
            version: String(cache.version || 'd131_persisted_scan_cache_v1'),
            storage: String(cache.storage || 'unavailable'),
            persisted: cache.persisted === true,
            manifest_linked: cache.manifest_linked === true,
            normalized_page_persistence: String(cache.normalized_page_persistence || 'not_started'),
            normalized_transaction_persistence: String(cache.normalized_transaction_persistence || 'not_started'),
            replay_reconstruction_cached: cache.replay_reconstruction_cached === true,
            resumable: cache.resumable === true,
            normalized_pages_persisted: Math.max(0, Number(cache.normalized_pages_persisted) || 0),
            normalized_transactions_persisted: Math.max(0, Number(cache.normalized_transactions_persisted) || 0),
            last_page_ref: String(cache.last_page_ref || ''),
            last_page_index: Math.max(0, Number(cache.last_page_index) || 0),
            last_transaction_ref_count: Math.max(0, Number(cache.last_transaction_ref_count) || 0),
            persisted_at: String(cache.persisted_at || ''),
            ttl_seconds: Math.max(0, Number(cache.ttl_seconds) || 0),
            browser_receives_metadata_only: cache.browser_receives_metadata_only !== false,
            raw_provider_payload_exposed: cache.raw_provider_payload_exposed === true,
            provider_secret_exposed: cache.provider_secret_exposed === true
        };
    }

    function normalizeReplayReconstruction(reconstruction = null) {
        if (!reconstruction || typeof reconstruction !== 'object' || Array.isArray(reconstruction)) return null;
        return {
            version: String(reconstruction.version || 'd131_replay_reconstruction_v1'),
            preview_only: reconstruction.preview_only !== false,
            staged_history_only: reconstruction.staged_history_only !== false,
            active_graph_unchanged: reconstruction.active_graph_unchanged !== false,
            scan_id: String(reconstruction.scan_id || ''),
            chunk_size: Math.max(0, Number(reconstruction.chunk_size) || 0),
            render_cap_transactions: Math.max(0, Number(reconstruction.render_cap_transactions) || 0),
            total_transactions: Math.max(0, Number(reconstruction.total_transactions) || 0),
            total_windows: Math.max(0, Number(reconstruction.total_windows) || 0),
            current_window_index: Math.max(0, Number(reconstruction.current_window_index) || 0),
            current_window_start: Math.max(0, Number(reconstruction.current_window_start) || 0),
            current_window_end: Math.max(0, Number(reconstruction.current_window_end) || 0),
            current_window_label: String(reconstruction.current_window_label || ''),
            earliest_timestamp: String(reconstruction.earliest_timestamp || ''),
            latest_timestamp: String(reconstruction.latest_timestamp || ''),
            oldest_first_ready: reconstruction.oldest_first_ready === true,
            oldest_first_reconstruction_required: reconstruction.oldest_first_reconstruction_required === true,
            progressive_expansion_available: reconstruction.progressive_expansion_available === true,
            reconstruction_complete: reconstruction.reconstruction_complete === true,
            coverage_pct: clampConfidence(reconstruction.coverage_pct),
            confidence_degraded: reconstruction.confidence_degraded === true,
            continuity_confidence: normalizeReplayContinuityProfile(reconstruction.continuity_confidence),
            gap_map: normalizeReplayGapMap(reconstruction.gap_map),
            timeline_segments: Array.isArray(reconstruction.timeline_segments)
                ? reconstruction.timeline_segments.slice(0, 24).map(normalizeTimelineSegment)
                : [],
            warnings: Array.isArray(reconstruction.warnings) ? reconstruction.warnings.slice(0, 12) : []
        };
    }

    function normalizeTimelineSegment(segment = {}) {
        return {
            segment_id: String(segment.segment_id || ''),
            key: String(segment.key || segment.segment_id || ''),
            label: String(segment.label || segment.title || ''),
            title: String(segment.title || segment.label || ''),
            page_ref: String(segment.page_ref || ''),
            page_index: Math.max(0, Number(segment.page_index) || 0),
            transaction_count: Math.max(0, Number(segment.transaction_count) || 0),
            ordinal_start: Math.max(0, Number(segment.ordinal_start) || 0),
            ordinal_end: Math.max(0, Number(segment.ordinal_end) || 0),
            earliest_timestamp: String(segment.earliest_timestamp || ''),
            latest_timestamp: String(segment.latest_timestamp || ''),
            sort_order: String(segment.sort_order || 'unknown'),
            cursor_kind: String(segment.cursor_kind || 'unknown'),
            active: segment.active === true,
            partial: segment.partial !== false
        };
    }

    function normalizeReplayContinuityProfile(profile = null) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
        const level = String(profile.level || 'partial');
        return {
            score: clampConfidence(profile.score),
            level: ['high', 'partial', 'ambiguous', 'provider_limited'].includes(level) ? level : 'partial',
            label: String(profile.label || 'Partial staged continuity'),
            degraded: profile.degraded !== false,
            reason_codes: Array.isArray(profile.reason_codes) ? profile.reason_codes.slice(0, 8).map(String) : [],
            gap_count: Math.max(0, Number(profile.gap_count) || 0),
            scope: String(profile.scope || 'staged_continuity'),
            no_full_history_claim: profile.no_full_history_claim !== false
        };
    }

    function normalizeReplayGapMap(gapMap = null) {
        if (!gapMap || typeof gapMap !== 'object' || Array.isArray(gapMap)) return null;
        return {
            version: String(gapMap.version || 'd136_replay_gap_map_v1'),
            scope: String(gapMap.scope || 'staged_replay_window'),
            scan_id: String(gapMap.scan_id || ''),
            window_index: Math.max(0, Number(gapMap.window_index) || 0),
            total_windows: Math.max(0, Number(gapMap.total_windows) || 0),
            ordinal_start: Math.max(0, Number(gapMap.ordinal_start) || 0),
            ordinal_end: Math.max(0, Number(gapMap.ordinal_end) || 0),
            missing_windows_possible: gapMap.missing_windows_possible === true,
            provider_limited: gapMap.provider_limited === true,
            rate_limited: gapMap.rate_limited === true,
            cursor_ambiguous: gapMap.cursor_ambiguous === true,
            timestamp_gaps: gapMap.timestamp_gaps === true,
            confidence_impact: clampConfidence(gapMap.confidence_impact),
            gaps: Array.isArray(gapMap.gaps) ? gapMap.gaps.slice(0, 12).map(normalizeReplayGap) : [],
            boundary_markers: Array.isArray(gapMap.boundary_markers)
                ? gapMap.boundary_markers.slice(0, 12).map(marker => ({
                    key: String(marker.key || ''),
                    label: String(marker.label || ''),
                    position_pct: clampConfidence(marker.position_pct),
                    kind: String(marker.kind || 'uncertain_continuation')
                }))
                : [],
            no_full_history_claim: gapMap.no_full_history_claim !== false
        };
    }

    function normalizeReplayGap(gap = {}) {
        const severity = String(gap.severity || 'medium');
        return {
            code: String(gap.code || ''),
            label: String(gap.label || gap.code || ''),
            severity: ['low', 'medium', 'high'].includes(severity) ? severity : 'medium',
            ordinal_start: Math.max(0, Number(gap.ordinal_start) || 0),
            ordinal_end: Math.max(0, Number(gap.ordinal_end) || 0),
            window_index: Math.max(0, Number(gap.window_index) || 0),
            confidence_impact: clampConfidence(gap.confidence_impact),
            source: String(gap.source || ''),
            boundary: String(gap.boundary || ''),
            note: String(gap.note || '')
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
        normalizeHistoryPage,
        normalizeReplayWindow
    };
})();
