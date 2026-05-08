(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_GRAPH_PREVIEW_VERSION = 'd109_history_graph_preview_v1';
    const LARGE_EVENT_WARNING_THRESHOLD = 1000;
    const EXTREME_EVENT_WARNING_THRESHOLD = 5000;

    function buildPreviewSummary(transactions = [], options = {}) {
        const rows = Array.isArray(transactions) ? transactions : [];
        const trackedWallet = normalizeAddress(options.trackedWallet || '');
        const providerConfigured = options.providerConfigured === true;
        const walletSet = new Set();
        const tokenSet = new Set();
        const timestamps = [];
        const observedEvents = [];
        const counterparties = new Map();
        let transferEventCount = 0;
        let timestampedEvents = 0;

        rows.forEach((transaction, transactionIndex) => {
            const transactionTimestamp = getTimestampMs(getTransactionTimestamp(transaction));
            if (transactionTimestamp) timestamps.push(transactionTimestamp);
            addTransactionWallets(walletSet, transaction);
            addTransactionTokens(tokenSet, transaction);

            const transfers = getTransactionTransfers(transaction);
            const eventItems = transfers.length ? transfers : [transaction];
            transferEventCount += Math.max(1, eventItems.length);

            eventItems.forEach((eventItem, eventIndex) => {
                const eventTimestamp = getTimestampMs(getTransactionTimestamp(eventItem)) || transactionTimestamp || 0;
                if (eventTimestamp) {
                    timestamps.push(eventTimestamp);
                    timestampedEvents += 1;
                }

                const source = normalizeAddress(
                    eventItem?.from
                    || eventItem?.source_wallet
                    || eventItem?.source
                    || eventItem?.owner
                    || transaction?.source_wallet
                    || transaction?.from
                    || ''
                );
                const destination = normalizeAddress(
                    eventItem?.to
                    || eventItem?.destination_wallet
                    || eventItem?.destination
                    || eventItem?.target
                    || transaction?.destination_wallet
                    || transaction?.to
                    || ''
                );
                const token = getTokenLabel(eventItem) || getTokenLabel(transaction);
                const signature = getTransactionSignature(transaction, transactionIndex);

                if (source) walletSet.add(source);
                if (destination) walletSet.add(destination);
                if (token) tokenSet.add(token);

                const eventRecord = {
                    source,
                    destination,
                    token,
                    signature,
                    timestampMs: eventTimestamp,
                    index: transactionIndex,
                    eventIndex
                };
                observedEvents.push(eventRecord);
                recordCounterparty(counterparties, eventRecord, trackedWallet);
            });
        });

        const firstFundingCandidate = inferFirstFundingCandidate(observedEvents, trackedWallet);
        const highActivityCounterparties = [...counterparties.values()]
            .sort((a, b) => b.score - a.score || b.eventCount - a.eventCount || a.address.localeCompare(b.address))
            .slice(0, 8)
            .map(item => ({
                ...item,
                tokens: [...item.tokens].sort().slice(0, 6)
            }));
        const earliestMs = timestamps.length ? Math.min(...timestamps) : 0;
        const latestMs = timestamps.length ? Math.max(...timestamps) : 0;
        const missingData = getMissingData({
            rows,
            trackedWallet,
            providerConfigured,
            timestampedEvents,
            firstFundingCandidate,
            hasCursor: Boolean(options.nextCursor || options.moreAvailable)
        });
        const replayReadinessScore = scoreReplayReadiness({
            transactionCount: rows.length,
            transferEventCount,
            uniqueWallets: walletSet.size,
            uniqueTokens: tokenSet.size,
            timestampedEvents,
            firstFundingCandidate,
            providerConfigured,
            missingData
        });

        return {
            version: HISTORY_GRAPH_PREVIEW_VERSION,
            previewOnly: true,
            mergedIntoActiveGraph: false,
            generatedAt: new Date().toISOString(),
            trackedWallet,
            providerConfigured,
            pagesLoaded: Math.max(0, Number(options.pagesLoaded) || 0),
            providerPagesLoaded: Math.max(0, Number(options.providerPagesLoaded) || 0),
            transactionCount: rows.length,
            transferEventCount,
            uniqueWalletCount: walletSet.size,
            uniqueTokenCount: tokenSet.size,
            earliestTimestamp: earliestMs ? new Date(earliestMs).toISOString() : '',
            latestTimestamp: latestMs ? new Date(latestMs).toISOString() : '',
            timestampCoveragePct: transferEventCount ? Math.round((timestampedEvents / transferEventCount) * 100) : 0,
            firstFundingCandidate,
            highActivityCounterparties,
            replayReadinessScore,
            replayReadinessLabel: getReadinessLabel(replayReadinessScore),
            missingData,
            warnings: getSummaryWarnings(transferEventCount)
        };
    }

    function buildReplayPlan(summary = {}, options = {}) {
        const eventCount = Math.max(0, Number(summary.transferEventCount) || Number(summary.transactionCount) || 0);
        const chunkSize = getSuggestedChunkSize(eventCount);
        const estimatedReplaySteps = eventCount ? Math.ceil(eventCount / chunkSize) : 0;
        const warning = getReplayWarning(eventCount);
        const missingDataNeeded = [
            ...(Array.isArray(summary.missingData) ? summary.missingData : []),
            'Progressive graph expansion rules for counterparties beyond the tracked wallet.',
            'Merge policy for converting staged history into graph-ready wallet and token nodes.',
            'Replay checkpoint format so long lifetime playback can pause and resume.'
        ];

        return {
            version: HISTORY_GRAPH_PREVIEW_VERSION,
            previewOnly: true,
            generatedAt: new Date().toISOString(),
            wallet: summary.trackedWallet || options.trackedWallet || '',
            estimatedReplaySteps,
            suggestedChunkSize: chunkSize,
            suggestedSpeedOptions: [
                { label: 'Inspect', delayMs: 1600, use: 'Manual investigation and first-funding review.' },
                { label: 'Standard', delayMs: 850, use: 'Default historical playback once expansion is available.' },
                { label: 'Fast Scan', delayMs: 260, use: 'High-level timeline sweep for dense histories.' }
            ],
            stagedEventCount: eventCount,
            stagedTransactionCount: Math.max(0, Number(summary.transactionCount) || 0),
            warning,
            missingDataNeeded: dedupeStrings(missingDataNeeded),
            phases: [
                'Validate staged history ordering and timestamp coverage.',
                'Chunk history into replay windows without merging into the active graph.',
                'Expand counterparties progressively before drawing lifetime paths.',
                'Render replay from a future graph-ready history dataset after user opt-in.'
            ],
            boundary: 'Preview plan only. It is not animated and is not merged with the active Wallet Lookup graph.',
            disclaimers: [
                'No identity, ownership, risk, or investment claims are made.',
                'Browser code must continue using Worker history access only.',
                'Inception replay needs complete historical pagination and progressive graph expansion.'
            ]
        };
    }

    function buildReplayPlanText(summary = {}, plan = buildReplayPlan(summary)) {
        return JSON.stringify({
            name: 'CryptoPhotonic Lifetime Replay Preview Plan',
            summary,
            plan
        }, null, 2);
    }

    function addTransactionWallets(walletSet, transaction = {}) {
        [
            transaction.wallet,
            transaction.address,
            transaction.source_wallet,
            transaction.destination_wallet,
            transaction.from,
            transaction.to
        ].forEach(value => {
            const normalized = normalizeAddress(value);
            if (normalized) walletSet.add(normalized);
        });
        (Array.isArray(transaction.wallets) ? transaction.wallets : []).forEach(wallet => {
            const normalized = normalizeAddress(wallet?.address || wallet?.wallet_address || wallet);
            if (normalized) walletSet.add(normalized);
        });
    }

    function addTransactionTokens(tokenSet, transaction = {}) {
        const token = getTokenLabel(transaction);
        if (token) tokenSet.add(token);
        (Array.isArray(transaction.tokens) ? transaction.tokens : []).forEach(item => {
            const label = getTokenLabel(item);
            if (label) tokenSet.add(label);
        });
    }

    function getTransactionTransfers(transaction = {}) {
        return [
            ...(Array.isArray(transaction.transfers) ? transaction.transfers : []),
            ...(Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : []),
            ...(Array.isArray(transaction.token_transfers) ? transaction.token_transfers : []),
            ...(Array.isArray(transaction.nativeTransfers) ? transaction.nativeTransfers : []),
            ...(Array.isArray(transaction.native_transfers) ? transaction.native_transfers : [])
        ].filter(Boolean);
    }

    function getTransactionTimestamp(item = {}) {
        return item.timestamp
            || item.block_time
            || item.blockTime
            || item.time
            || item.slot_time
            || item.received_at
            || item.created_at
            || '';
    }

    function getTimestampMs(value) {
        if (value == null || value === '') return 0;
        const numeric = Number(value);
        const date = Number.isFinite(numeric)
            ? new Date(numeric < 1000000000000 ? numeric * 1000 : numeric)
            : new Date(value);
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }

    function getTokenLabel(item = {}) {
        const symbol = String(item.symbol || item.token_symbol || item.tokenSymbol || '').trim();
        if (symbol) return symbol;
        const mint = String(item.token_mint || item.mint || item.token || item.token_address || '').trim();
        return mint ? shortenValue(mint) : '';
    }

    function getTransactionSignature(transaction = {}, index = 0) {
        return String(transaction.signature || transaction.transaction_hash || transaction.hash || transaction.id || `history-${index + 1}`).trim();
    }

    function recordCounterparty(counterparties, eventRecord = {}, trackedWallet = '') {
        const addresses = [eventRecord.source, eventRecord.destination].filter(Boolean);
        addresses.forEach(address => {
            if (trackedWallet && address === trackedWallet) return;
            const item = counterparties.get(address) || {
                address,
                eventCount: 0,
                inboundToTracked: 0,
                outboundFromTracked: 0,
                mixed: 0,
                firstSeen: '',
                latestSeen: '',
                latestSeenMs: 0,
                tokens: new Set(),
                score: 0
            };
            item.eventCount += 1;
            if (trackedWallet && eventRecord.destination === trackedWallet && eventRecord.source === address) item.inboundToTracked += 1;
            else if (trackedWallet && eventRecord.source === trackedWallet && eventRecord.destination === address) item.outboundFromTracked += 1;
            else item.mixed += 1;
            if (eventRecord.timestampMs) {
                if (!item.firstSeen || eventRecord.timestampMs < Date.parse(item.firstSeen)) {
                    item.firstSeen = new Date(eventRecord.timestampMs).toISOString();
                }
                if (eventRecord.timestampMs >= item.latestSeenMs) {
                    item.latestSeenMs = eventRecord.timestampMs;
                    item.latestSeen = new Date(eventRecord.timestampMs).toISOString();
                }
            }
            if (eventRecord.token) item.tokens.add(eventRecord.token);
            item.score = item.eventCount * 100 + item.inboundToTracked * 18 + item.outboundFromTracked * 12 + item.mixed * 5;
            counterparties.set(address, item);
        });
    }

    function inferFirstFundingCandidate(events = [], trackedWallet = '') {
        const ordered = events
            .filter(event => event.timestampMs && event.source && event.destination)
            .sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index || a.eventIndex - b.eventIndex);
        if (!ordered.length) return null;

        if (trackedWallet) {
            const inbound = ordered.find(event => event.destination === trackedWallet && event.source !== trackedWallet);
            if (!inbound) return null;
            return {
                wallet: inbound.source,
                direction: 'inbound_to_tracked_wallet',
                timestamp: new Date(inbound.timestampMs).toISOString(),
                token: inbound.token || '',
                signature: inbound.signature || '',
                confidence: 'candidate_only'
            };
        }

        const earliest = ordered[0];
        return {
            wallet: earliest.source || earliest.destination || '',
            direction: 'earliest_observed_transfer_without_tracked_wallet',
            timestamp: new Date(earliest.timestampMs).toISOString(),
            token: earliest.token || '',
            signature: earliest.signature || '',
            confidence: 'low_missing_tracked_wallet'
        };
    }

    function getMissingData(details = {}) {
        const missing = [];
        if (!details.rows.length) missing.push('No staged history rows are loaded yet.');
        if (!details.trackedWallet) missing.push('Tracked wallet metadata is required for inception replay.');
        if (!details.providerConfigured) missing.push('History provider configuration has not been confirmed by a Worker history page.');
        if (!details.timestampedEvents) missing.push('Timestamps are required to order lifetime replay steps.');
        if (!details.firstFundingCandidate) missing.push('First funding candidate is not inferable from staged rows.');
        if (!details.hasCursor) missing.push('Older pagination cursors or complete-history coverage are needed for inception replay.');
        return dedupeStrings(missing);
    }

    function scoreReplayReadiness(details = {}) {
        if (!details.transactionCount || !details.transferEventCount) return 0;
        let score = 10;
        score += Math.min(25, details.transferEventCount * 2);
        score += details.timestampedEvents ? Math.min(25, Math.round((details.timestampedEvents / details.transferEventCount) * 25)) : 0;
        score += details.uniqueWallets > 1 ? 10 : 0;
        score += details.uniqueTokens > 0 ? 6 : 0;
        score += details.firstFundingCandidate ? 14 : 0;
        score += details.providerConfigured ? 10 : 0;
        if (details.transferEventCount > LARGE_EVENT_WARNING_THRESHOLD) score -= 8;
        if (details.missingData.length > 3) score -= 8;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function getReadinessLabel(score) {
        if (score >= 78) return 'Replay planning ready';
        if (score >= 52) return 'Partial replay plan';
        if (score > 0) return 'Needs more staged history';
        return 'No staged history';
    }

    function getSuggestedChunkSize(eventCount) {
        if (eventCount <= 50) return 10;
        if (eventCount <= 500) return 25;
        if (eventCount <= 2000) return 50;
        return 100;
    }

    function getReplayWarning(eventCount) {
        if (eventCount >= EXTREME_EVENT_WARNING_THRESHOLD) {
            return 'Very large staged history. Future replay should require indexed chunks, virtualized timeline rows, and explicit user confirmation before drawing.';
        }
        if (eventCount >= LARGE_EVENT_WARNING_THRESHOLD) {
            return 'Large staged history. Use conservative chunks and avoid attempting a single-frame replay.';
        }
        if (!eventCount) return 'No events are staged, so the plan is a readiness checklist only.';
        return '';
    }

    function getSummaryWarnings(eventCount) {
        const warning = getReplayWarning(eventCount);
        return warning ? [warning] : [];
    }

    function normalizeAddress(value) {
        return String(value || '').trim();
    }

    function shortenValue(value) {
        const text = String(value || '');
        if (text.length <= 18) return text;
        if (text.startsWith('0x')) return `${text.slice(0, 8)}...${text.slice(-6)}`;
        return `${text.slice(0, 7)}...${text.slice(-6)}`;
    }

    function dedupeStrings(items = []) {
        return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];
    }

    namespace.historyGraphPreview = {
        HISTORY_GRAPH_PREVIEW_VERSION,
        LARGE_EVENT_WARNING_THRESHOLD,
        buildPreviewSummary,
        buildReplayPlan,
        buildReplayPlanText
    };
})();
