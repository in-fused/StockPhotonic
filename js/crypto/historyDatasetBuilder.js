(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_DATASET_BUILDER_VERSION = 'd110_history_dataset_builder_v1';
    const DEFAULT_MAX_ROWS = 10000;
    const DEFAULT_MAX_TRANSFERS = 25000;
    const LARGE_HISTORY_WARNING_THRESHOLD = 1000;

    function buildHistoryDataset(stagedRows = [], options = {}) {
        const rows = Array.isArray(stagedRows) ? stagedRows : [];
        const maxRows = clampPositiveInteger(options.maxRows, DEFAULT_MAX_ROWS);
        const maxTransfers = clampPositiveInteger(options.maxTransfers, DEFAULT_MAX_TRANSFERS);
        const trackedWallet = normalizeAddress(options.trackedWallet || options.wallet || '');
        const processedRows = rows.slice(0, maxRows);
        const walletsByAddress = new Map();
        const tokensByKey = new Map();
        const transactionsByKey = new Map();
        const groupsBySignature = new Map();
        const warnings = [];
        const counters = {
            stagedRowsReceived: rows.length,
            stagedRowsProcessed: processedRows.length,
            stagedRowsOmittedByLimit: Math.max(0, rows.length - processedRows.length),
            transferCandidatesObserved: 0,
            transferRowsIncluded: 0,
            transferRowsOmittedByLimit: 0,
            transferRowsOmittedMissingWallets: 0,
            duplicateTransferRowsSkipped: 0,
            rowsMissingTimestamp: 0,
            rowsMissingSignature: 0,
            rowsMissingWalletData: 0,
            rowsMissingTokenData: 0
        };

        if (trackedWallet) {
            addWallet(walletsByAddress, trackedWallet, {
                label: 'Tracked Wallet',
                label_source: 'history_preview_input',
                confidence: 0.9,
                metadata: {
                    tracked_wallet_input: true,
                    preview_only: true,
                    no_identity_claim: true,
                    no_ownership_claim: true
                }
            });
        }

        processedRows.forEach((row, rowIndex) => {
            const normalizedRow = normalizeStagedTransactionRow(row, {
                rowIndex,
                trackedWallet
            });

            addObservedWallets(walletsByAddress, normalizedRow);
            addObservedToken(tokensByKey, normalizedRow);

            const transferItems = normalizedRow.transferItems.length
                ? normalizedRow.transferItems
                : [row];
            if (!normalizedRow.timestamp) counters.rowsMissingTimestamp += 1;
            if (!normalizedRow.signature) counters.rowsMissingSignature += 1;
            if (!normalizedRow.sourceWallet && !normalizedRow.destinationWallet && !hasTransferWalletData(transferItems)) counters.rowsMissingWalletData += 1;
            if (!normalizedRow.tokenSymbol && !normalizedRow.tokenMint && !hasTransferTokenData(transferItems)) counters.rowsMissingTokenData += 1;
            const signature = normalizedRow.signature;
            const groupId = signature ? `txgroup:solana:history:${safeId(signature)}` : '';

            transferItems.forEach((transferItem, transferIndex) => {
                counters.transferCandidatesObserved += 1;
                if (transactionsByKey.size >= maxTransfers) {
                    counters.transferRowsOmittedByLimit += 1;
                    return;
                }

                const normalizedTransfer = normalizeStagedTransfer(transferItem, {
                    row: normalizedRow,
                    rowIndex,
                    transferIndex,
                    groupId,
                    trackedWallet
                });

                addObservedWallets(walletsByAddress, normalizedTransfer);
                addObservedToken(tokensByKey, normalizedTransfer);

                if (!normalizedTransfer.sourceWallet || !normalizedTransfer.destinationWallet) {
                    counters.transferRowsOmittedMissingWallets += 1;
                    return;
                }

                const dedupeKey = getTransferDedupeKey(normalizedTransfer);
                if (transactionsByKey.has(dedupeKey)) {
                    counters.duplicateTransferRowsSkipped += 1;
                    return;
                }

                const transaction = buildGraphTransaction(normalizedTransfer, transactionsByKey.size);
                transactionsByKey.set(dedupeKey, transaction);
                counters.transferRowsIncluded += 1;

                if (signature) {
                    recordTransactionGroup(groupsBySignature, normalizedTransfer, transaction);
                }
            });
        });

        if (rows.length > maxRows) {
            warnings.push(`Staged history exceeded ${maxRows} rows; only the first ${maxRows} rows were prepared.`);
        }
        if (counters.transferRowsOmittedByLimit) {
            warnings.push(`Staged transfers exceeded ${maxTransfers} graph-ready rows; remaining rows were counted but not included.`);
        }
        if (counters.transferCandidatesObserved >= LARGE_HISTORY_WARNING_THRESHOLD) {
            warnings.push('Large staged history. Keep this dataset preview-only until indexed paging and explicit visual preview opt-in are added.');
        }
        if (counters.transferRowsOmittedMissingWallets) {
            warnings.push('Some staged transfer rows were omitted from graph-ready transactions because source or destination wallet data was missing.');
        }

        const transactions = [...transactionsByKey.values()];
        const transactionGroups = [...groupsBySignature.values()]
            .map(group => finalizeTransactionGroup(group))
            .filter(group => group.signature || group.id);

        const dataset = {
            metadata: buildDatasetMetadata({
                options,
                trackedWallet,
                counters,
                warnings,
                walletCount: walletsByAddress.size,
                tokenCount: tokensByKey.size,
                transactionCount: transactions.length,
                transactionGroupCount: transactionGroups.length
            }),
            wallets: [...walletsByAddress.values()],
            tokens: [...tokensByKey.values()],
            entities: [],
            transactions,
            transaction_groups: transactionGroups
        };

        dataset.metadata.dataset_metrics = getDatasetMetrics(dataset);
        return dataset;
    }

    function normalizeStagedTransactionRow(row = {}, context = {}) {
        const timestampInfo = normalizeTimestamp(firstDefined(
            row.timestamp,
            row.block_time,
            row.blockTime,
            row.time,
            row.slot_time,
            row.received_at,
            row.created_at,
            row.datetime
        ));
        const signature = normalizeSignature(firstDefined(
            row.signature,
            row.transaction_hash,
            row.transactionHash,
            row.tx_hash,
            row.hash,
            row.id
        ));
        const sourceWallet = normalizeAddress(firstDefined(
            row.source_wallet,
            row.sourceWallet,
            row.from,
            row.source,
            row.fromUserAccount,
            row.from_user_account
        ));
        const destinationWallet = normalizeAddress(firstDefined(
            row.destination_wallet,
            row.destinationWallet,
            row.to,
            row.destination,
            row.target,
            row.toUserAccount,
            row.to_user_account
        ));
        const token = normalizeTokenFields(row);
        const amount = normalizeAmountFields(row, token);
        const transactionType = normalizeTransactionType(row);

        return {
            raw: row,
            rowIndex: context.rowIndex || 0,
            timestamp: timestampInfo.iso,
            timestampMs: timestampInfo.ms,
            signature,
            sourceWallet,
            destinationWallet,
            tokenSymbol: token.symbol,
            tokenMint: token.mint,
            amount: amount.amount,
            amountDisplay: amount.display,
            transactionType: transactionType.raw,
            transactionTypeKey: transactionType.key,
            transactionTypeLabel: transactionType.label,
            transferItems: getTransferItems(row),
            trackedWallet: context.trackedWallet || ''
        };
    }

    function normalizeStagedTransfer(transfer = {}, context = {}) {
        const row = context.row || {};
        const timestampInfo = normalizeTimestamp(firstDefined(
            transfer.timestamp,
            transfer.block_time,
            transfer.blockTime,
            transfer.time,
            row.timestamp
        ));
        const signature = normalizeSignature(firstDefined(
            transfer.signature,
            transfer.transaction_hash,
            transfer.transactionHash,
            transfer.hash,
            row.signature
        ));
        const sourceWallet = normalizeAddress(firstDefined(
            transfer.source_wallet,
            transfer.sourceWallet,
            transfer.from,
            transfer.source,
            transfer.fromUserAccount,
            transfer.from_user_account,
            row.sourceWallet
        ));
        const destinationWallet = normalizeAddress(firstDefined(
            transfer.destination_wallet,
            transfer.destinationWallet,
            transfer.to,
            transfer.destination,
            transfer.target,
            transfer.toUserAccount,
            transfer.to_user_account,
            row.destinationWallet
        ));
        const token = normalizeTokenFields(transfer, row);
        const amount = normalizeAmountFields(transfer, token, row);
        const transactionType = normalizeTransactionType(transfer, row);

        return {
            raw: transfer,
            rowIndex: context.rowIndex || 0,
            transferIndex: context.transferIndex || 0,
            timestamp: timestampInfo.iso || row.timestamp || '',
            timestampMs: timestampInfo.ms || row.timestampMs || 0,
            signature,
            sourceWallet,
            destinationWallet,
            tokenSymbol: token.symbol,
            tokenMint: token.mint,
            amount: amount.amount,
            amountDisplay: amount.display,
            transactionType: transactionType.raw,
            transactionTypeKey: transactionType.key,
            transactionTypeLabel: transactionType.label,
            transactionGroupId: context.groupId || '',
            trackedWallet: context.trackedWallet || row.trackedWallet || ''
        };
    }

    function buildGraphTransaction(item = {}, index = 0) {
        const idBase = item.signature
            ? `${safeId(item.signature)}:${item.transferIndex}`
            : `row-${item.rowIndex + 1}:${item.transferIndex}`;
        const trackedWalletRole = getTrackedWalletRole(item.trackedWallet, item.sourceWallet, item.destinationWallet);
        return {
            id: `tx:solana:history-preview:${idBase}`,
            type: 'transaction',
            transaction_hash: item.signature || `history-preview-row-${item.rowIndex + 1}`,
            transaction_type: item.transactionType,
            transaction_type_key: item.transactionTypeKey,
            transaction_type_label: item.transactionTypeLabel,
            chain: 'solana',
            source_wallet: item.sourceWallet,
            destination_wallet: item.destinationWallet,
            token_mint: item.tokenMint,
            symbol: item.tokenSymbol,
            amount: item.amount,
            amount_display: item.amountDisplay,
            usd_value: 0,
            timestamp: item.timestamp || null,
            confidence: 0.64,
            label_source: 'history_preview_staged_row',
            transaction_group_id: item.transactionGroupId,
            leg_index: item.transferIndex,
            tracked_wallet_role: trackedWalletRole,
            direction: roleToDirection(trackedWalletRole),
            metadata: {
                preview_only: true,
                not_merged: true,
                source_format: 'staged_wallet_history',
                row_index: item.rowIndex,
                transfer_index: item.transferIndex,
                signature_present: Boolean(item.signature),
                timestamp_present: Boolean(item.timestamp),
                token_data_present: Boolean(item.tokenSymbol || item.tokenMint),
                amount_display_present: Boolean(item.amountDisplay),
                tracked_wallet: item.trackedWallet || '',
                tracked_wallet_role: trackedWalletRole,
                direction: roleToDirection(trackedWalletRole),
                no_identity_claim: true,
                no_ownership_claim: true,
                no_risk_claim: true,
                no_criminality_claim: true,
                no_investment_claim: true
            }
        };
    }

    function addObservedWallets(walletsByAddress, item = {}) {
        [item.sourceWallet, item.destinationWallet].forEach(address => {
            if (!address) return;
            addWallet(walletsByAddress, address, {
                label: shortValue(address),
                label_source: 'history_preview_observation',
                confidence: 0.64,
                metadata: {
                    preview_only: true,
                    address_observation_only: true,
                    no_identity_claim: true,
                    no_ownership_claim: true
                }
            });
        });
    }

    function addWallet(walletsByAddress, address, fields = {}) {
        const normalized = normalizeAddress(address);
        if (!normalized || walletsByAddress.has(normalized)) return;
        walletsByAddress.set(normalized, {
            id: `wallet:solana:${normalized}`,
            type: 'wallet',
            address: normalized,
            chain: 'solana',
            label: fields.label || shortValue(normalized),
            label_source: fields.label_source || 'history_preview_observation',
            confidence: Number.isFinite(Number(fields.confidence)) ? Number(fields.confidence) : 0.64,
            metadata: {
                ...(fields.metadata || {}),
                preview_only: true
            }
        });
    }

    function addObservedToken(tokensByKey, item = {}) {
        if (!item.tokenSymbol && !item.tokenMint) return;
        const mint = item.tokenMint || getPreviewTokenMint(item.tokenSymbol);
        const key = normalizeAddress(mint || item.tokenSymbol);
        if (!key || tokensByKey.has(key)) return;
        tokensByKey.set(key, {
            id: `token:solana:${key}`,
            type: 'token',
            symbol: item.tokenSymbol || shortValue(mint) || 'TOKEN',
            name: item.tokenSymbol || 'Token',
            token_mint: mint,
            contract_address: mint,
            chain: 'solana',
            decimals: 0,
            label_source: 'history_preview_observation',
            confidence: item.tokenMint ? 0.7 : 0.45,
            metadata: {
                preview_only: true,
                mint_missing: !item.tokenMint,
                no_investment_claim: true
            }
        });
    }

    function recordTransactionGroup(groupsBySignature, item = {}, transaction = {}) {
        const signature = item.signature || '';
        if (!signature) return;
        const existing = groupsBySignature.get(signature) || {
            id: item.transactionGroupId || `txgroup:solana:history:${safeId(signature)}`,
            chain: 'solana',
            signature,
            transaction_type: item.transactionType || '',
            transaction_type_key: item.transactionTypeKey || 'UNKNOWN',
            transaction_type_label: item.transactionTypeLabel || 'Unknown / Unclassified',
            source_program: '',
            source_label: '',
            leg_count: 0,
            primary_wallet: item.trackedWallet || '',
            primary_wallet_role: '',
            direction: '',
            tokens_involved: new Set(),
            token_mints: new Set(),
            timestamp: item.timestamp || null,
            metadata: {
                preview_only: true,
                not_merged: true,
                safely_inferred_from_signature: true,
                no_identity_claim: true,
                no_ownership_claim: true,
                no_risk_claim: true,
                no_criminality_claim: true,
                no_investment_claim: true
            }
        };
        existing.leg_count += 1;
        if (!existing.timestamp && item.timestamp) existing.timestamp = item.timestamp;
        if (item.tokenSymbol) existing.tokens_involved.add(item.tokenSymbol);
        if (item.tokenMint) existing.token_mints.add(item.tokenMint);
        if (!existing.primary_wallet_role && transaction.tracked_wallet_role) {
            existing.primary_wallet_role = transaction.tracked_wallet_role;
            existing.direction = transaction.direction;
        }
        groupsBySignature.set(signature, existing);
    }

    function finalizeTransactionGroup(group = {}) {
        return {
            ...group,
            tokens_involved: [...group.tokens_involved].sort(),
            token_mints: [...group.token_mints].sort(),
            metadata: {
                ...(group.metadata || {}),
                leg_count: group.leg_count
            }
        };
    }

    function buildDatasetMetadata(details = {}) {
        const counters = details.counters || {};
        const warnings = Array.isArray(details.warnings) ? details.warnings : [];
        return {
            version: HISTORY_DATASET_BUILDER_VERSION,
            source: 'wallet_history_staged_preview_dataset',
            source_label: 'Wallet History Preview Dataset',
            generated_at: new Date().toISOString(),
            chain: 'solana',
            wallet: details.trackedWallet || '',
            tracked_wallet: details.trackedWallet || '',
            provider: String(details.options?.provider || ''),
            provider_label: String(details.options?.providerLabel || ''),
            provider_configured: details.options?.providerConfigured === true,
            pages_loaded: Math.max(0, Number(details.options?.pagesLoaded) || 0),
            provider_pages_loaded: Math.max(0, Number(details.options?.providerPagesLoaded) || 0),
            preview_only: true,
            not_merged: true,
            merged_into_active_graph: false,
            active_graph_unchanged: true,
            graph_ready_staging_only: true,
            visual_preview_enabled: false,
            replay_enabled: false,
            browser_provider_calls: false,
            api_key_exposure: false,
            direct_provider_calls_added: false,
            future_phase: 'Opt-in visual preview and lifetime replay can consume this staged dataset later.',
            boundary: 'Graph-ready staging only. This dataset is not rendered and is not merged into the active Wallet Lookup graph.',
            no_claims: {
                identity: false,
                ownership: false,
                risk: false,
                criminality: false,
                investment: false
            },
            warnings,
            counts: {
                ...counters,
                wallets: details.walletCount || 0,
                tokens: details.tokenCount || 0,
                transactions: details.transactionCount || 0,
                transaction_groups: details.transactionGroupCount || 0
            }
        };
    }

    function getDatasetMetrics(dataset = {}) {
        const metadata = dataset.metadata || {};
        const counts = metadata.counts || {};
        return {
            version: metadata.version || HISTORY_DATASET_BUILDER_VERSION,
            previewOnly: metadata.preview_only === true,
            notMerged: metadata.not_merged === true,
            activeGraphUnchanged: metadata.active_graph_unchanged === true,
            wallets: countArray(dataset.wallets),
            tokens: countArray(dataset.tokens),
            transactions: countArray(dataset.transactions),
            transactionGroups: countArray(dataset.transaction_groups),
            stagedRowsReceived: Number(counts.stagedRowsReceived) || 0,
            stagedRowsProcessed: Number(counts.stagedRowsProcessed) || 0,
            transferCandidatesObserved: Number(counts.transferCandidatesObserved) || 0,
            transferRowsIncluded: Number(counts.transferRowsIncluded) || 0,
            transferRowsOmittedMissingWallets: Number(counts.transferRowsOmittedMissingWallets) || 0,
            transferRowsOmittedByLimit: Number(counts.transferRowsOmittedByLimit) || 0,
            duplicateTransferRowsSkipped: Number(counts.duplicateTransferRowsSkipped) || 0,
            rowsMissingTimestamp: Number(counts.rowsMissingTimestamp) || 0,
            rowsMissingSignature: Number(counts.rowsMissingSignature) || 0,
            rowsMissingWalletData: Number(counts.rowsMissingWalletData) || 0,
            rowsMissingTokenData: Number(counts.rowsMissingTokenData) || 0,
            warnings: Array.isArray(metadata.warnings) ? metadata.warnings.slice() : [],
            boundary: metadata.boundary || ''
        };
    }

    function buildHistoryDatasetText(dataset = {}) {
        return JSON.stringify(dataset || {}, null, 2);
    }

    function getTransferItems(row = {}) {
        return [
            ...(Array.isArray(row.transfers) ? row.transfers : []),
            ...(Array.isArray(row.tokenTransfers) ? row.tokenTransfers : []),
            ...(Array.isArray(row.token_transfers) ? row.token_transfers : []),
            ...(Array.isArray(row.nativeTransfers) ? row.nativeTransfers : []),
            ...(Array.isArray(row.native_transfers) ? row.native_transfers : [])
        ].filter(item => item && typeof item === 'object');
    }

    function normalizeTimestamp(value) {
        if (value == null || value === '') return { iso: '', ms: 0 };
        const numeric = Number(value);
        const date = Number.isFinite(numeric)
            ? new Date(numeric < 1000000000000 ? numeric * 1000 : numeric)
            : new Date(value);
        const ms = date.getTime();
        if (!Number.isFinite(ms)) return { iso: '', ms: 0 };
        return { iso: new Date(ms).toISOString(), ms };
    }

    function normalizeSignature(value) {
        return String(value || '').trim();
    }

    function normalizeTokenFields(item = {}, fallback = {}) {
        const symbol = String(firstDefined(
            item.symbol,
            item.token_symbol,
            item.tokenSymbol,
            item.token?.symbol,
            fallback.tokenSymbol,
            fallback.symbol,
            fallback.token_symbol
        ) || '').trim();
        let mint = normalizeAddress(firstDefined(
            item.token_mint,
            item.tokenMint,
            item.mint,
            item.token_address,
            item.tokenAddress,
            item.contract_address,
            item.contractAddress,
            item.token,
            item.token?.mint,
            fallback.tokenMint,
            fallback.token_mint,
            fallback.mint
        ));
        const hasNativeAmount = firstDefined(
            item.lamports,
            item.raw_lamports,
            item.amount_lamports,
            item.rawAmountLamports
        ) != null;
        if (!mint && (isSolSymbol(symbol) || hasNativeAmount)) {
            mint = 'native:sol';
        }
        return {
            symbol: symbol || (mint === 'native:sol' ? 'SOL' : ''),
            mint
        };
    }

    function normalizeAmountFields(item = {}, token = {}, fallback = {}) {
        const display = String(firstDefined(
            item.amount_display,
            item.amountDisplay,
            item.uiAmountString,
            item.ui_amount_string,
            item.displayAmount,
            fallback.amountDisplay,
            fallback.amount_display
        ) || '').trim();
        const decimals = normalizeDecimals(firstDefined(
            item.decimals,
            item.token_decimals,
            item.rawTokenAmount?.decimals,
            item.raw_token_amount?.decimals,
            fallback.decimals
        ));
        const lamports = firstDefined(
            item.lamports,
            item.raw_lamports,
            item.amount_lamports,
            item.rawAmountLamports
        );
        const rawTokenAmount = getRawTokenAmount(item);
        const amountCandidate = firstDefined(
            item.uiAmount,
            item.ui_amount,
            item.tokenAmount,
            item.token_amount,
            item.amount,
            rawTokenAmount,
            fallback.amount
        );

        let amount = parseNumber(amountCandidate);
        if (lamports != null) {
            amount = parseNumber(lamports) / 1000000000;
        } else if (rawTokenAmount != null && decimals != null) {
            amount = parseNumber(rawTokenAmount) / (10 ** decimals);
        }

        const safeAmount = Number.isFinite(amount) ? amount : 0;
        const safeDisplay = display || (safeAmount || token.symbol ? `${trimAmount(safeAmount)} ${token.symbol || ''}`.trim() : '');
        return {
            amount: safeAmount,
            display: safeDisplay
        };
    }

    function normalizeTransactionType(item = {}, fallback = {}) {
        const raw = String(firstDefined(
            item.transaction_type,
            item.transactionType,
            item.type,
            item.event_type,
            item.eventType,
            fallback.transactionType,
            fallback.transaction_type,
            'unknown'
        ) || 'unknown').trim();
        const key = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_') || 'UNKNOWN';
        return {
            raw,
            key,
            label: raw ? raw.replace(/[_-]+/g, ' ') : 'Unknown / Unclassified'
        };
    }

    function getRawTokenAmount(item = {}) {
        if (item.rawTokenAmount && typeof item.rawTokenAmount === 'object') {
            return firstDefined(item.rawTokenAmount.tokenAmount, item.rawTokenAmount.amount);
        }
        if (item.raw_token_amount && typeof item.raw_token_amount === 'object') {
            return firstDefined(item.raw_token_amount.tokenAmount, item.raw_token_amount.amount);
        }
        return firstDefined(item.rawTokenAmount, item.raw_token_amount, item.raw_amount, item.rawAmount);
    }

    function getTransferDedupeKey(item = {}) {
        return [
            item.signature || `row-${item.rowIndex + 1}`,
            item.sourceWallet,
            item.destinationWallet,
            item.tokenMint,
            item.tokenSymbol,
            item.amountDisplay || item.amount,
            item.timestamp,
            item.transactionType
        ].map(value => String(value ?? '').trim()).join('|');
    }

    function hasTransferWalletData(items = []) {
        return items.some(item => normalizeAddress(firstDefined(
            item?.source_wallet,
            item?.sourceWallet,
            item?.from,
            item?.source,
            item?.fromUserAccount,
            item?.from_user_account,
            item?.destination_wallet,
            item?.destinationWallet,
            item?.to,
            item?.destination,
            item?.target,
            item?.toUserAccount,
            item?.to_user_account
        )));
    }

    function hasTransferTokenData(items = []) {
        return items.some(item => normalizeAddress(firstDefined(
            item?.symbol,
            item?.token_symbol,
            item?.tokenSymbol,
            item?.token_mint,
            item?.tokenMint,
            item?.mint,
            item?.token_address,
            item?.tokenAddress,
            item?.contract_address,
            item?.contractAddress,
            item?.token
        )) || firstDefined(
            item?.lamports,
            item?.raw_lamports,
            item?.amount_lamports,
            item?.rawAmountLamports
        ) != null);
    }

    function getTrackedWalletRole(trackedWallet = '', source = '', destination = '') {
        const tracked = normalizeAddress(trackedWallet);
        if (!tracked) return '';
        if (normalizeAddress(source) === tracked && normalizeAddress(destination) === tracked) return 'self_transfer';
        if (normalizeAddress(source) === tracked) return 'source';
        if (normalizeAddress(destination) === tracked) return 'destination';
        return 'counterparty_path';
    }

    function roleToDirection(role = '') {
        if (role === 'source') return 'outbound';
        if (role === 'destination') return 'inbound';
        if (role === 'self_transfer') return 'self';
        return '';
    }

    function firstDefined(...values) {
        return values.find(value => value !== undefined && value !== null && value !== '');
    }

    function normalizeAddress(value) {
        return String(value || '').trim();
    }

    function isSolSymbol(symbol = '') {
        return String(symbol || '').trim().toUpperCase() === 'SOL';
    }

    function getPreviewTokenMint(symbol = '') {
        const normalized = safeId(symbol || 'token');
        return normalized ? `preview-token:${normalized}` : '';
    }

    function normalizeDecimals(value) {
        const number = Number(value);
        if (Number.isInteger(number) && number >= 0 && number <= 18) return number;
        return null;
    }

    function parseNumber(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const match = String(value ?? '').replaceAll(',', '').trim().match(/-?\d+(?:\.\d+)?/);
        const number = Number(match?.[0]);
        return Number.isFinite(number) ? number : 0;
    }

    function trimAmount(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '0';
        return number.toLocaleString(undefined, {
            maximumFractionDigits: number >= 100 ? 2 : 6
        });
    }

    function shortValue(value) {
        const text = String(value || '');
        if (text.length <= 14) return text || 'Unknown';
        return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    function safeId(value) {
        return String(value || '')
            .trim()
            .replace(/[^a-z0-9:_-]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 160);
    }

    function clampPositiveInteger(value, fallback) {
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0) return fallback;
        return Math.min(number, 100000);
    }

    function countArray(value) {
        return Array.isArray(value) ? value.length : 0;
    }

    namespace.historyDatasetBuilder = {
        HISTORY_DATASET_BUILDER_VERSION,
        DEFAULT_MAX_ROWS,
        DEFAULT_MAX_TRANSFERS,
        buildHistoryDataset,
        buildHistoryDatasetText,
        getDatasetMetrics,
        normalizeStagedTransactionRow
    };
})();
