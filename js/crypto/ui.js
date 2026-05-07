(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;
    const viewportUtils = window.StockPhotonicGraph?.viewport || {};

    if (!core || !graphEngine || !layoutEngine) {
        throw new Error('CryptoPhotonic core, graph, and layout modules must load before UI module');
    }

    const mathUtils = window.StockPhotonicUtils?.math || {};
    const clamp = mathUtils.clamp || ((value, min, max) => Math.max(min, Math.min(max, value)));
    const hashString = mathUtils.hashNumber || ((value) => {
        const text = String(value);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
    });

    const DEFAULT_WORKER_FEED_ENDPOINT = '/api/crypto/events';
    const DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT = '/api/crypto/wallet-activity';

    const state = {
        initialized: false,
        active: false,
        graph: null,
        selectedId: null,
        hoveredId: null,
        interactionIndex: null,
        canvas: null,
        ctx: null,
        root: null,
        detailPanel: null,
        statusPanel: null,
        resizeObserver: null,
        datasetSource: null,
        datasetSourceKind: 'built_in',
        dataset: null,
        generatedManifest: null,
        generatedFixtures: [],
        activeGeneratedFixture: null,
        live: {
            enabled: false,
            endpoint: DEFAULT_WORKER_FEED_ENDPOINT,
            endpointValid: true,
            pollMs: 4000,
            pollTimerId: null,
            inFlight: false,
            hasFetched: false,
            workerAvailable: false,
            lastPollAt: 0,
            lastEventAt: '',
            lastError: '',
            eventCount: 0,
            mergedEventCount: 0,
            seenDedupeKeys: new Set(),
            pendingFlowIds: [],
            pulseTimerId: null
        },
        walletLookup: {
            walletInput: '',
            inFlight: false,
            lastWallet: '',
            lastLoadedAt: 0,
            lastError: '',
            eventCount: 0,
            mergedEventCount: 0
        },
        filters: {
            transactionType: 'all',
            token: 'all',
            direction: 'all'
        },
        solanaAdapterLoadPromise: null,
        flowReplayEnabled: false,
        flowReplay: {
            playing: false,
            index: 0,
            activeFlowId: null,
            lastStepAt: 0,
            stepMs: 1150
        },
        flowQueue: null,
        flowMotion: {
            enabled: true,
            ambientEnabled: true,
            rafId: null,
            lastFrameAt: 0,
            now: 0,
            topFlowIds: new Set(),
            userInteractingUntil: 0
        },
        viewport: {
            x: 0,
            y: 0,
            scale: 1
        },
        drag: null,
        manualNodePositions: new Map()
    };
    state.flowQueue = state.flowReplay;

    const ZOOM_LIMITS = { min: 0.48, max: 2.35 };
    const DRAG_SELECT_THRESHOLD = 5;
    const FLOW_ANIMATION = {
        maxPulsedEdges: 7,
        frameMs: 33,
        minDurationMs: 1400,
        maxDurationMs: 3600,
        idlePauseMs: 950
    };
    const DETAIL_LIMITS = {
        connectedWallets: 4,
        directFlows: 4,
        tokenExposure: 3,
        multiHopPaths: 3,
        transactionGroups: 5
    };
    const GENERATED_FIXTURE_DIR = 'data/crypto/generated/';
    const WORKER_FEED_LIMIT = 50;
    const LIVE_POLL_MS = { min: 3000, max: 5000, default: 4000 };
    const SOURCE_LABELS = {
        generated: 'Generated Fixture',
        solana_sample: 'Sample',
        legacy_sample: 'Sample',
        built_in: 'Sample',
        worker_feed: 'Worker Feed',
        worker_wallet_lookup: 'Worker Wallet Lookup'
    };

    async function initialize(options = {}) {
        if (state.initialized) return state.graph;

        state.root = document.getElementById(options.rootId || 'crypto-photonic-view');
        state.canvas = document.getElementById(options.canvasId || 'crypto-flow-canvas');
        state.detailPanel = document.getElementById(options.detailPanelId || 'crypto-detail-panel');
        if (!state.root || !state.canvas || !state.detailPanel) return null;
        configureLiveFeed(options);

        state.ctx = state.canvas.getContext('2d');
        state.canvas.style.cursor = 'grab';
        state.canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
        state.canvas.addEventListener('pointerdown', handleCanvasPointerDown);
        state.canvas.addEventListener('pointermove', handleCanvasPointerMove);
        state.canvas.addEventListener('pointerup', handleCanvasPointerUp);
        state.canvas.addEventListener('pointercancel', handleCanvasPointerCancel);
        state.canvas.addEventListener('mouseleave', handleCanvasLeave);
        document.getElementById('crypto-reset-view')?.addEventListener('click', resetView);
        document.getElementById('crypto-reset-layout')?.addEventListener('click', resetLayout);
        window.addEventListener('resize', resizeAndRender);

        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(resizeAndRender);
            state.resizeObserver.observe(state.canvas.parentElement || state.canvas);
        }

        const dataset = await loadSampleDataset();
        state.dataset = cloneDataset(dataset);
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        prepareFlowMotion();
        rebuildInteractionIndex();
        state.selectedId = state.graph.hubNodes?.[0]?.id || state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;
        state.initialized = true;

        renderSolanaStatusCopy(dataset);
        updateStats();
        resizeAndRender();
        renderDetails();
        updateFlowAnimationLoop();
        updateLivePolling();
        return state.graph;
    }

    function setActive(active) {
        state.active = Boolean(active);
        updateFlowAnimationLoop();
        updateLivePolling();
        if (!state.active || !state.initialized) return;
        resizeAndRender();
        renderDetails();
    }

    async function loadSampleDataset(options = {}) {
        const manifest = await loadLocalJson('data/crypto/generated/manifest.json', 'Generated crypto manifest unavailable');
        applyGeneratedManifest(manifest);
        const requestedPath = isSafeGeneratedFixturePath(options.generatedFixturePath) ? options.generatedFixturePath : '';
        const generatedFixturePath = requestedPath || getPreferredGeneratedFixturePath();
        if (generatedFixturePath) {
            const normalized = await loadGeneratedFixtureDataset(generatedFixturePath);
            if (normalized) return normalized;
        }

        const solanaFixture = await loadLocalJson('data/crypto/solana-sample-flow.json', 'Solana fixture file unavailable');
        if (solanaFixture) {
            const normalized = await normalizeSolanaFixture(solanaFixture, 'data/crypto/solana-sample-flow.json');
            if (normalized) {
                state.datasetSource = 'data/crypto/solana-sample-flow.json';
                state.datasetSourceKind = 'solana_sample';
                state.activeGeneratedFixture = null;
                return normalized;
            }
        }

        const sampleFixture = await loadLocalJson('data/crypto/sample-flow.json', 'Crypto sample file unavailable');
        if (sampleFixture) {
            state.datasetSource = 'data/crypto/sample-flow.json';
            state.datasetSourceKind = 'legacy_sample';
            state.activeGeneratedFixture = null;
            return sampleFixture;
        }

        console.warn('CryptoPhotonic sample data fell back to built-in dev sample');
        state.datasetSource = 'built_in_dev_sample';
        state.datasetSourceKind = 'built_in';
        state.activeGeneratedFixture = null;
        return core.getSampleDataset();
    }

    async function loadGeneratedFixtureDataset(path) {
        const fixture = await loadLocalJson(path, 'Generated crypto fixture unavailable');
        if (!fixture) return null;

        const normalized = await normalizeSolanaFixture(fixture, path);
        if (!normalized) return null;

        const fixtureEntry = getGeneratedFixtureEntry(path);
        const transactionCount = getFixtureTransactionCount(fixture, fixtureEntry);
        normalized.metadata = {
            ...(normalized.metadata || {}),
            ...(fixture.metadata || {}),
            source_path: path,
            generated_wallet: fixtureEntry?.wallet || fixture.metadata?.wallet || '',
            generated_at: fixtureEntry?.generated_at || fixture.metadata?.generated_at || '',
            generated_transaction_count: transactionCount
        };
        state.datasetSource = path;
        state.datasetSourceKind = 'generated';
        state.activeGeneratedFixture = {
            path,
            wallet: normalized.metadata.generated_wallet,
            generated_at: normalized.metadata.generated_at,
            transaction_count: transactionCount,
            source: fixtureEntry?.source || fixture.metadata?.source || '',
            sanitized: fixtureEntry?.sanitized === true || fixture.metadata?.sanitized === true
        };
        return normalized;
    }

    function applyGeneratedManifest(manifest) {
        state.generatedManifest = manifest && typeof manifest === 'object' ? manifest : null;
        state.generatedFixtures = getValidGeneratedFixtures(state.generatedManifest);
    }

    function getValidGeneratedFixtures(manifest) {
        if (!manifest || typeof manifest !== 'object') return [];

        const entries = [];
        const seen = new Set();
        const addEntry = item => {
            const path = typeof item === 'string' ? item.trim() : typeof item?.path === 'string' ? item.path.trim() : '';
            if (!isSafeGeneratedFixturePath(path) || seen.has(path)) return;
            seen.add(path);
            entries.push({
                path,
                wallet: typeof item?.wallet === 'string' ? item.wallet : '',
                generated_at: typeof item?.generated_at === 'string' ? item.generated_at : '',
                transaction_count: Number.isFinite(Number(item?.transaction_count)) ? Number(item.transaction_count) : null,
                source: typeof item?.source === 'string' ? item.source : '',
                sanitized: item?.sanitized === true
            });
        };

        const fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : [];
        fixtures.forEach(addEntry);
        addEntry(manifest.active_fixture);
        return entries;
    }

    function getPreferredGeneratedFixturePath() {
        const activeFixture = typeof state.generatedManifest?.active_fixture === 'string'
            ? state.generatedManifest.active_fixture.trim()
            : '';
        if (isSafeGeneratedFixturePath(activeFixture) && state.generatedFixtures.some(item => item.path === activeFixture)) {
            return activeFixture;
        }
        return state.generatedFixtures[0]?.path || '';
    }

    function getGeneratedFixtureEntry(path) {
        return state.generatedFixtures.find(item => item.path === path) || null;
    }

    function isSafeGeneratedFixturePath(value) {
        const path = String(value || '').trim();
        if (!path || !path.startsWith(GENERATED_FIXTURE_DIR)) return false;
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('//')) return false;
        if (path.includes('\\') || path.includes('?') || path.includes('#')) return false;
        const suffix = path.slice(GENERATED_FIXTURE_DIR.length);
        if (!suffix || !suffix.endsWith('.json')) return false;
        return suffix.split('/').every(part => part && part !== '.' && part !== '..');
    }

    function getFixtureTransactionCount(fixture, fixtureEntry = null) {
        if (Number.isFinite(Number(fixtureEntry?.transaction_count))) return Number(fixtureEntry.transaction_count);
        if (Number.isFinite(Number(fixture?.metadata?.transaction_count))) return Number(fixture.metadata.transaction_count);
        if (Array.isArray(fixture?.solana_transactions)) return fixture.solana_transactions.length;
        if (Array.isArray(fixture?.enhancedTransactions)) return fixture.enhancedTransactions.length;
        if (Array.isArray(fixture?.enhanced_transactions)) return fixture.enhanced_transactions.length;
        if (Array.isArray(fixture?.transactions)) return fixture.transactions.length;
        return null;
    }

    async function loadLocalJson(path, unavailableMessage) {
        try {
            const response = await fetch(`${path}?v=${Date.now()}`);
            if (!response.ok) throw new Error(unavailableMessage);
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    function configureLiveFeed(options = {}) {
        const endpointConfig = resolveWorkerFeedEndpoint(options);
        state.live.endpoint = endpointConfig.endpoint;
        state.live.endpointValid = endpointConfig.valid;
        if (!state.live.endpointValid) {
            state.live.enabled = false;
            state.live.workerAvailable = false;
            state.live.lastError = 'Worker feed endpoint unavailable';
        } else {
            state.live.lastError = '';
        }

        const requestedPollMs = Number(options.workerFeedPollMs ?? options.livePollMs ?? window.CryptoPhotonicLivePollMs);
        state.live.pollMs = clamp(
            Number.isFinite(requestedPollMs) ? requestedPollMs : LIVE_POLL_MS.default,
            LIVE_POLL_MS.min,
            LIVE_POLL_MS.max
        );
    }

    function resolveWorkerFeedEndpoint(options = {}) {
        const configuredValue = [
            options.workerFeedEndpoint,
            options.liveFeedEndpoint,
            window.CryptoPhotonicWorkerFeedEndpoint,
            state.root?.dataset?.workerFeedEndpoint
        ].find(value => typeof value === 'string' && value.trim());

        const rawEndpoint = configuredValue ? configuredValue.trim() : DEFAULT_WORKER_FEED_ENDPOINT;
        const fallback = { endpoint: DEFAULT_WORKER_FEED_ENDPOINT, valid: false };

        try {
            if (rawEndpoint.startsWith('/')) {
                const parsed = new URL(rawEndpoint, window.location.origin);
                if (isSafeWorkerFeedUrl(parsed, { allowExternal: false })) {
                    return { endpoint: parsed.pathname, valid: true };
                }
                return fallback;
            }

            const parsed = new URL(rawEndpoint);
            if (isSafeWorkerFeedUrl(parsed, { allowExternal: false })) {
                return { endpoint: parsed.pathname, valid: true };
            }

            if (configuredValue && isSafeWorkerFeedUrl(parsed, { allowExternal: true })) {
                return { endpoint: parsed.href, valid: true };
            }
        } catch (error) {
            return fallback;
        }

        return fallback;
    }

    function isSafeWorkerFeedUrl(parsed, options = {}) {
        if (!parsed || parsed.pathname !== DEFAULT_WORKER_FEED_ENDPOINT) return false;
        if (parsed.search || parsed.hash || parsed.username || parsed.password) return false;
        if (parsed.origin === window.location.origin) return true;
        return Boolean(options.allowExternal) && parsed.protocol === 'https:';
    }

    function setLiveModeEnabled(enabled) {
        if (enabled && !state.live.endpointValid) {
            state.live.enabled = false;
            state.live.workerAvailable = false;
            state.live.lastError = 'Worker feed endpoint unavailable';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return state.live;
        }

        state.live.enabled = Boolean(enabled);
        if (!state.live.enabled) {
            stopLivePolling();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return state.live;
        }

        updateLivePolling();
        pollWorkerFeed({ animateNew: state.live.hasFetched });
        return state.live;
    }

    function updateLivePolling() {
        stopLivePolling();
        if (!state.live.enabled || !state.live.endpointValid || !state.active || !state.initialized) return;

        state.live.pollTimerId = window.setInterval(() => {
            pollWorkerFeed({ animateNew: true });
        }, state.live.pollMs);
    }

    function stopLivePolling() {
        if (!state.live.pollTimerId) return;
        window.clearInterval(state.live.pollTimerId);
        state.live.pollTimerId = null;
    }

    async function pollWorkerFeed(options = {}) {
        if (!state.live.enabled || !state.live.endpointValid || state.live.inFlight) return null;

        state.live.inFlight = true;
        try {
            const separator = state.live.endpoint.includes('?') ? '&' : '?';
            const response = await fetch(`${state.live.endpoint}${separator}limit=${WORKER_FEED_LIMIT}`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`Worker feed returned ${response.status}`);

            const payload = await response.json();
            const events = Array.isArray(payload?.events) ? payload.events : [];
            state.live.workerAvailable = true;
            state.live.lastError = '';
            state.live.lastPollAt = Date.now();
            state.live.eventCount = events.length;
            const newestTimestamp = getNewestEventTimestamp(events);
            if (newestTimestamp) state.live.lastEventAt = newestTimestamp;

            const result = mergeWorkerFeedEvents(events, {
                animateNew: options.animateNew !== false && state.live.hasFetched
            });
            state.live.hasFetched = true;
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return result;
        } catch (error) {
            state.live.workerAvailable = false;
            state.live.lastError = 'Worker feed unavailable';
            state.live.lastPollAt = Date.now();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        } finally {
            state.live.inFlight = false;
        }
    }

    function mergeWorkerFeedEvents(events = [], options = {}) {
        if (!Array.isArray(events) || !events.length || !state.dataset) {
            return { mergedEvents: 0, mergedTransactions: 0, flowIds: [] };
        }

        const newEvents = events.filter(event => {
            const key = getWorkerEventDedupeKey(event);
            if (!key || state.live.seenDedupeKeys.has(key)) return false;
            state.live.seenDedupeKeys.add(key);
            return true;
        });
        if (!newEvents.length) return { mergedEvents: 0, mergedTransactions: 0, flowIds: [] };

        const incomingDataset = convertWorkerEventsToDataset(newEvents);
        if (!incomingDataset.transactions.length) {
            return { mergedEvents: newEvents.length, mergedTransactions: 0, flowIds: [] };
        }

        state.live.mergedEventCount += newEvents.length;
        state.dataset = mergeGraphDatasets(state.dataset, incomingDataset);
        rebuildGraphAfterLiveMerge(incomingDataset.transactions, { animateNew: options.animateNew });
        return {
            mergedEvents: newEvents.length,
            mergedTransactions: incomingDataset.transactions.length,
            flowIds: incomingDataset.transactions.map(transaction => getFlowEdgeIdForTransaction(transaction))
        };
    }

    function convertWorkerEventsToDataset(events = []) {
        const wallets = [];
        const tokens = [];
        const transactions = [];

        events.forEach(event => {
            const eventKey = getWorkerEventDedupeKey(event);
            const chain = core.normalizeChain(event.chain || 'solana');
            const eventTokens = Array.isArray(event.tokens) ? event.tokens : [];
            const tokenBySymbol = new Map();
            const firstToken = eventTokens[0] || {};
            eventTokens.forEach(token => {
                const normalizedToken = normalizeWorkerToken(token, chain, event);
                if (normalizedToken.token_mint) tokens.push(normalizedToken);
                if (normalizedToken.symbol) tokenBySymbol.set(normalizedToken.symbol.toLowerCase(), normalizedToken);
            });

            const eventWallets = Array.isArray(event.wallets) ? event.wallets : [];
            eventWallets.forEach(wallet => {
                const normalizedWallet = normalizeWorkerWallet(wallet, chain, event);
                if (normalizedWallet.address) wallets.push(normalizedWallet);
            });

            const transfers = Array.isArray(event.transfers) ? event.transfers : [];
            const fallbackTransfer = getFallbackWorkerTransfer(eventWallets);
            const graphTransfers = transfers.length ? transfers : fallbackTransfer ? [fallbackTransfer] : [];
            graphTransfers.forEach((transfer, transferIndex) => {
                const sourceWallet = core.normalizeAddress(transfer.from || transfer.source_wallet || transfer.source);
                const destinationWallet = core.normalizeAddress(transfer.to || transfer.destination_wallet || transfer.destination || transfer.target);
                if (!sourceWallet || !destinationWallet) return;

                wallets.push(normalizeWorkerWallet({ address: sourceWallet, role: 'sender' }, chain, event));
                wallets.push(normalizeWorkerWallet({ address: destinationWallet, role: 'receiver' }, chain, event));

                const symbol = String(transfer.token_symbol || transfer.symbol || firstToken.symbol || '').trim();
                const token = symbol ? tokenBySymbol.get(symbol.toLowerCase()) : null;
                const tokenMint = core.normalizeAddress(token?.token_mint || firstToken.mint || firstToken.token_mint || `${chain}:${symbol || 'token'}`);
                if (tokenMint && !token) {
                    tokens.push(normalizeWorkerToken({
                        symbol: symbol || 'TOKEN',
                        mint: tokenMint,
                        decimals: firstToken.decimals
                    }, chain, event));
                }

                const amount = parseWorkerAmount(transfer.amount);
                const typeInfo = core.interpretTransactionType(event.transaction_type || 'token_transfer');
                const transferDedupeKey = `${eventKey}:${transferIndex}`;
                transactions.push({
                    id: `live:${safeLiveId(transferDedupeKey)}`,
                    transaction_type: event.transaction_type || typeInfo.raw || 'token_transfer',
                    transaction_type_key: typeInfo.key,
                    transaction_type_label: typeInfo.label,
                    transaction_hash: String(event.signature || event.id || eventKey || '').trim(),
                    chain,
                    source_wallet: sourceWallet,
                    destination_wallet: destinationWallet,
                    token_mint: tokenMint,
                    contract_address: tokenMint,
                    symbol,
                    amount,
                    amount_display: String(transfer.amount || (symbol ? core.formatTokenAmount(amount, symbol) : amount)).trim(),
                    usd_value: Number(event.usd_value || transfer.usd_value) || 0,
                    timestamp: event.timestamp || event.received_at || new Date().toISOString(),
                    confidence: getWorkerEventConfidence(event),
                    label_source: event.ingestion_source || event.source || 'worker_feed',
                    source_program: event.source || event.ingestion_source || 'secure_runtime_feed',
                    source_label: core.formatSourceLabel(event.source || event.ingestion_source || 'Worker Feed'),
                    direction: '',
                    tracked_wallet_role: '',
                    metadata: {
                        dedupe_key: eventKey,
                        live_transfer_dedupe_key: transferDedupeKey,
                        source_event_id: event.id || '',
                        ingestion_source: event.ingestion_source || '',
                        received_at: event.received_at || '',
                        source_format: 'worker_feed_event',
                        live_feed: true,
                        sanitized: true,
                        production_meaning: false,
                        live_blockchain_fetching: false,
                        amount_display: String(transfer.amount || '').trim()
                    }
                });
            });
        });

        return {
            metadata: {
                name: 'CryptoPhotonic Worker Feed Merge',
                environment: 'secure_runtime_feed',
                chain: 'solana',
                adapter: 'worker_event_feed',
                source: 'secure_runtime_feed',
                production_meaning: false,
                live_blockchain_fetching: false,
                sanitized: true
            },
            wallets,
            tokens,
            entities: [],
            transactions,
            transaction_groups: []
        };
    }

    function normalizeWorkerWallet(wallet = {}, chain = 'solana', event = {}) {
        const address = core.normalizeAddress(wallet.address || wallet.wallet_address);
        const role = String(wallet.role || '').trim();
        return {
            address,
            chain,
            label: role ? `${core.formatSourceLabel(role)} ${core.shortAddress(address)}` : core.shortAddress(address),
            label_source: event.ingestion_source || event.source || 'worker_feed',
            confidence: getWorkerEventConfidence(event),
            metadata: {
                role,
                source_event_id: event.id || '',
                live_feed: true
            }
        };
    }

    function normalizeWorkerToken(token = {}, chain = 'solana', event = {}) {
        const tokenMint = core.normalizeAddress(token.mint || token.token_mint || token.contract_address || token.address);
        const symbol = String(token.symbol || 'TOKEN').trim();
        return {
            symbol,
            name: symbol || 'Token',
            token_mint: tokenMint,
            contract_address: tokenMint,
            chain,
            decimals: Number(token.decimals) || 0,
            label_source: event.ingestion_source || event.source || 'worker_feed',
            confidence: getWorkerEventConfidence(event),
            metadata: {
                source_event_id: event.id || '',
                live_feed: true
            }
        };
    }

    function getFallbackWorkerTransfer(wallets = []) {
        const sourceWallet = wallets.find(wallet => /sender|source|from/i.test(wallet.role || '')) || wallets[0];
        const destinationWallet = wallets.find(wallet => /receiver|destination|target|to/i.test(wallet.role || '')) || wallets.find(wallet => wallet !== sourceWallet);
        if (!sourceWallet || !destinationWallet) return null;
        return {
            from: sourceWallet.address,
            to: destinationWallet.address,
            amount: ''
        };
    }

    function mergeGraphDatasets(baseDataset = {}, incomingDataset = {}) {
        const base = cloneDataset(baseDataset);
        const incoming = core.normalizeDataset(incomingDataset);
        return {
            metadata: {
                ...(base.metadata || {}),
                source: 'secure_runtime_feed',
                live_worker_feed_enabled: true,
                live_worker_feed_merged_events: state.live.mergedEventCount,
                live_blockchain_fetching: false,
                production_meaning: false,
                sanitized: true
            },
            wallets: mergeByKey(base.wallets || [], incoming.wallets, walletMergeKey),
            tokens: mergeByKey(base.tokens || [], incoming.tokens, tokenMergeKey),
            entities: mergeByKey([
                ...(base.entities || []),
                ...(base.hubs || []),
                ...(base.entity_hubs || [])
            ], incoming.entities, entityMergeKey),
            transactions: mergeByKey(base.transactions || [], incoming.transactions, transactionMergeKey),
            transaction_groups: mergeByKey(base.transaction_groups || [], incoming.transaction_groups, groupMergeKey)
        };
    }

    function rebuildGraphAfterLiveMerge(incomingTransactions = [], options = {}) {
        const previousSelectedId = state.selectedId;
        const graph = graphEngine.buildGraph(state.dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.graph.flowReplayEnabled = true;
        state.graph.flowQueueEnabled = true;
        if (state.graph.flowReplay) {
            state.graph.flowReplay.enabled = true;
            state.graph.flowReplay.mode = 'worker_feed_live_queue';
            state.graph.flowReplay.future_note = 'Sanitized Worker feed events are appended without browser provider calls.';
        }
        if (state.graph.flowQueue) {
            state.graph.flowQueue.enabled = true;
            state.graph.flowQueue.mode = 'worker_feed_live_queue';
        }
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        state.flowReplay.playing = false;
        state.flowReplay.activeFlowId = null;
        state.flowReplay.index = clamp(state.flowReplay.index, 0, Math.max(0, (state.graph.flowReplay?.ordered_flows || []).length - 1));
        applyManualNodePositions();
        prepareFlowMotion();
        rebuildInteractionIndex();
        state.selectedId = previousSelectedId && state.graph.nodeById.has(previousSelectedId)
            ? previousSelectedId
            : state.graph.hubNodes?.[0]?.id || state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;

        const liveFlowIds = incomingTransactions
            .map(transaction => getFlowEdgeIdForTransaction(transaction))
            .filter(id => state.graph.flowEdges.some(edge => edge.id === id));
        if (options.animateNew) enqueueLiveFlowPulses(liveFlowIds);

        updateStats();
        render();
        renderDetails();
        updateFlowAnimationLoop();
    }

    function enqueueLiveFlowPulses(flowIds = []) {
        const ids = [...new Set(flowIds)].filter(Boolean);
        if (!ids.length) return;
        state.live.pendingFlowIds.push(...ids);
        if (!state.flowReplay.activeFlowId) activateNextLivePulse();
    }

    function activateNextLivePulse() {
        if (state.live.pulseTimerId) {
            window.clearTimeout(state.live.pulseTimerId);
            state.live.pulseTimerId = null;
        }

        const nextFlowId = state.live.pendingFlowIds.shift();
        if (!nextFlowId) {
            state.flowReplay.activeFlowId = null;
            render();
            return;
        }

        const orderedFlows = state.graph?.flowReplay?.ordered_flows || [];
        const nextIndex = orderedFlows.findIndex(flow => flow.id === nextFlowId);
        if (nextIndex >= 0) state.flowReplay.index = nextIndex;
        state.flowReplay.activeFlowId = nextFlowId;
        state.flowReplay.lastStepAt = performance.now();
        updateFlowAnimationLoop();
        render();
        state.live.pulseTimerId = window.setTimeout(activateNextLivePulse, state.flowReplay.stepMs);
    }

    function resetLiveMergeState() {
        state.live.workerAvailable = false;
        state.live.lastError = '';
        state.live.eventCount = 0;
        state.live.mergedEventCount = 0;
        state.live.hasFetched = false;
        state.live.lastEventAt = '';
        state.live.seenDedupeKeys.clear();
        state.live.pendingFlowIds = [];
        if (state.live.pulseTimerId) {
            window.clearTimeout(state.live.pulseTimerId);
            state.live.pulseTimerId = null;
        }
    }

    function resetWalletLookupState() {
        state.walletLookup.inFlight = false;
        state.walletLookup.lastWallet = '';
        state.walletLookup.lastLoadedAt = 0;
        state.walletLookup.lastError = '';
        state.walletLookup.eventCount = 0;
        state.walletLookup.mergedEventCount = 0;
    }

    function getCurrentSourceLabel() {
        if (state.walletLookup.eventCount > 0 || state.walletLookup.mergedEventCount > 0) {
            return SOURCE_LABELS.worker_wallet_lookup;
        }
        if (state.live.workerAvailable || state.live.mergedEventCount > 0) {
            return SOURCE_LABELS.worker_feed;
        }
        return SOURCE_LABELS[state.datasetSourceKind] || SOURCE_LABELS.built_in;
    }

    function getSourceBoundaryCopy() {
        if (!state.live.endpointValid) {
            return 'Generated fixtures are local files. Track Wallet asks the secure Worker to fetch recent activity.';
        }
        if (state.walletLookup.eventCount > 0 || state.walletLookup.mergedEventCount > 0) {
            return 'Generated fixtures are local files. Track Wallet asks the secure Worker to fetch recent activity.';
        }
        if (state.live.workerAvailable) {
            return 'Browser fetches only sanitized Worker feed events. No provider keys or direct provider calls are used.';
        }
        if (state.datasetSourceKind === 'generated') {
            return 'Generated fixtures are local files. Track Wallet asks the secure Worker to fetch recent activity.';
        }
        return 'Generated fixtures are local files. Track Wallet asks the secure Worker to fetch recent activity.';
    }

    function getLiveStatusLabel() {
        if (!state.live.endpointValid) return 'Worker Feed OFF / endpoint unavailable';
        if (!state.live.enabled) return `Worker Feed OFF / polls every ${Math.round(state.live.pollMs / 1000)}s when enabled`;
        if (state.live.inFlight) return 'Polling Worker Feed';
        if (state.live.workerAvailable) {
            const merged = `${state.live.mergedEventCount} merged`;
            return `Worker Feed OK / ${merged}`;
        }
        return state.live.lastError || 'Waiting for Worker Feed';
    }

    function getWorkerEventDedupeKey(event = {}) {
        return String(event.dedupe_key || event.id || event.signature || '').trim();
    }

    function getWorkerEventConfidence(event = {}) {
        if (event.ingestion_source === 'helius_webhook') return 0.82;
        if (event.ingestion_source === 'helius_wallet_lookup') return 0.76;
        if (event.ingestion_source === 'fixture_fallback') return 0.42;
        if (event.ingestion_source === 'local_test_event') return 0.58;
        return 0.5;
    }

    function getNewestEventTimestamp(events = []) {
        return events
            .map(event => event.timestamp || event.received_at || '')
            .filter(Boolean)
            .sort((a, b) => timestampValue(b) - timestampValue(a))[0] || '';
    }

    function parseWorkerAmount(value) {
        const number = Number(String(value ?? '').replaceAll(',', '').trim());
        return Number.isFinite(number) ? number : 0;
    }

    function safeLiveId(value) {
        return String(value || 'event').replace(/[^a-z0-9:_-]+/gi, '-').slice(0, 140);
    }

    function getFlowEdgeIdForTransaction(transaction = {}) {
        return `${core.EDGE_TYPES.FLOW}:${transaction.id || transaction.transaction_hash || ''}`;
    }

    function mergeByKey(baseItems = [], incomingItems = [], getKey) {
        const byKey = new Map();
        [...baseItems, ...incomingItems].forEach(item => {
            const key = getKey(item);
            if (!key) return;
            byKey.set(key, { ...(byKey.get(key) || {}), ...item });
        });
        return [...byKey.values()];
    }

    function walletMergeKey(wallet = {}) {
        return `wallet:${core.normalizeChain(wallet.chain)}:${core.normalizeAddress(wallet.address || wallet.wallet_address)}`;
    }

    function tokenMergeKey(token = {}) {
        return `token:${core.normalizeChain(token.chain)}:${core.normalizeAddress(token.token_mint || token.contract_address || token.address)}`;
    }

    function entityMergeKey(entity = {}) {
        return entity.id || `entity:${core.normalizeChain(entity.chain)}:${String(entity.label || entity.name || '').toLowerCase()}`;
    }

    function transactionMergeKey(transaction = {}) {
        const metadata = transaction.metadata || {};
        return metadata.live_transfer_dedupe_key || metadata.dedupe_key || transaction.dedupe_key || transaction.id || transaction.transaction_hash;
    }

    function groupMergeKey(group = {}) {
        return group.id || group.signature || group.transaction_hash;
    }

    function cloneDataset(dataset = {}) {
        return JSON.parse(JSON.stringify(dataset || {}));
    }

    async function normalizeSolanaFixture(payload = {}, sourcePath = '') {
        const hasRawSolanaTransactions = Array.isArray(payload.solana_transactions)
            || Array.isArray(payload.enhancedTransactions)
            || Array.isArray(payload.enhanced_transactions);
        const hasGraphDataset = Array.isArray(payload.wallets)
            && Array.isArray(payload.tokens)
            && Array.isArray(payload.transactions);

        if (!hasRawSolanaTransactions) return hasGraphDataset ? payload : null;

        const adapter = await ensureSolanaAdapter();
        if (!adapter) return hasGraphDataset ? payload : null;

        const normalized = adapter.normalizeSolanaTransactionBatch(payload);
        return {
            ...normalized,
            metadata: {
                ...(normalized.metadata || {}),
                ...(payload.metadata || {}),
                source_path: sourcePath
            }
        };
    }

    function ensureSolanaAdapter() {
        if (namespace.solanaAdapter) return Promise.resolve(namespace.solanaAdapter);
        if (state.solanaAdapterLoadPromise) return state.solanaAdapterLoadPromise;

        state.solanaAdapterLoadPromise = new Promise(resolve => {
            const script = document.createElement('script');
            script.src = `js/crypto/solanaAdapter.js?v=${Date.now()}`;
            script.async = false;
            script.onload = () => resolve(namespace.solanaAdapter || null);
            script.onerror = () => {
                console.warn('CryptoPhotonic Solana adapter unavailable; using next offline sample fallback');
                resolve(null);
            };
            document.head.appendChild(script);
        });

        return state.solanaAdapterLoadPromise;
    }

    function renderSolanaStatusCopy(dataset = {}) {
        if (!state.root) return;
        const metadata = dataset.metadata || {};
        const isSolana = metadata.adapter === 'solana' || metadata.chain === 'solana';
        const isGeneratedFixture = metadata.environment === 'local_secure_runner_generated'
            || metadata.source === 'helius_enhanced_transactions_sanitized';
        const subtitle = state.root.querySelector('h1 + p');
        if (subtitle && isSolana) {
            subtitle.textContent = isGeneratedFixture
                ? 'Solana local runner fixture mode for sanitized wallet, SPL token, and swap-like flow graphs'
                : 'Solana-first offline fixture mode for wallet, SPL token, and swap-like flow graphs';
        }

        const panelHeader = state.root.querySelector('.crypto-panel > div:first-child');
        if (!panelHeader) return;

        const existing = document.getElementById('crypto-solana-status');
        if (existing) existing.remove();

        const status = document.createElement('div');
        status.id = 'crypto-solana-status';
        status.className = 'grid gap-2 text-[10px] font-mono tracking-[1.1px] text-cyan-50/78 max-w-3xl grow md:grow-0';
        status.innerHTML = `
            ${renderGeneratedDataManager(metadata, isGeneratedFixture, isSolana)}
            ${renderFlowFilters()}
            ${renderFlowQueueStatus()}
        `;
        panelHeader.appendChild(status);
        state.statusPanel = status;
        bindStatusControls(status);
    }

    function renderGeneratedDataManager(metadata = {}, isGeneratedFixture = false, isSolana = false) {
        const sourceLabel = getCurrentSourceLabel();
        const activeFixture = state.activeGeneratedFixture || {};
        const generatedWallet = activeFixture.wallet || metadata.generated_wallet || metadata.wallet || '';
        const generatedAt = activeFixture.generated_at || metadata.generated_at || '';
        const transactionCount = activeFixture.transaction_count ?? metadata.generated_transaction_count ?? metadata.transaction_count ?? null;
        const selector = renderGeneratedFixtureSelector();
        const sourceTone = state.live.workerAvailable ? 'text-emerald-100/82' : isGeneratedFixture ? 'text-emerald-100/82' : isSolana ? 'text-cyan-50/78' : 'text-white/68';

        return `
            <div class="rounded-2xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">DATA SOURCE</div>
                        <div class="${sourceTone}">Source: ${escapeHtml(sourceLabel)}</div>
                    </div>
                    ${selector}
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1 text-white/56">
                    <div title="${escapeAttr(generatedWallet || 'Unavailable')}">Fixture Wallet: ${escapeHtml(generatedWallet ? shortLongValue(generatedWallet) : '-')}</div>
                    <div>Generated: ${escapeHtml(generatedAt || '-')}</div>
                    <div>Tx: ${escapeHtml(transactionCount ?? '-')}</div>
                </div>
                <div class="mt-2 text-yellow-100/76">${escapeHtml(getSourceBoundaryCopy())}</div>
                ${renderWalletLookupControls()}
            </div>
        `;
    }

    function renderGeneratedFixtureSelector() {
        const fixtures = state.generatedFixtures || [];
        if (!fixtures.length) {
            return '<div class="text-white/38">No generated fixtures listed</div>';
        }

        const options = [
            state.datasetSourceKind === 'generated' ? '' : '<option value="">Select Generated Fixture</option>',
            ...fixtures.map(item => {
                const label = item.wallet
                    ? `${shortLongValue(item.wallet)} (${item.transaction_count ?? '-'} tx)`
                    : item.path.replace(GENERATED_FIXTURE_DIR, '');
                return `<option value="${escapeAttr(item.path)}" ${item.path === state.datasetSource ? 'selected' : ''}>${escapeHtml(label)}</option>`;
            })
        ].join('');

        return `
            <label class="flex items-center gap-2 text-white/52">
                <span>Generated Fixture</span>
                <select id="crypto-generated-fixture-select" class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1 text-cyan-50/82 outline-none">
                    ${options}
                </select>
            </label>
        `;
    }

    function renderWalletLookupControls() {
        const status = getWalletLookupStatusLabel();
        const value = state.walletLookup.walletInput || state.walletLookup.lastWallet || '';
        return `
            <form id="crypto-wallet-lookup-form" class="mt-3 flex flex-wrap items-end gap-2">
                <label class="grid gap-1 min-w-[240px] grow text-white/52">
                    <span>Track Wallet</span>
                    <input id="crypto-wallet-lookup-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" value="${escapeAttr(value)}" placeholder="Solana wallet address" class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1.5 text-cyan-50/82 outline-none placeholder:text-white/28">
                </label>
                <button id="crypto-wallet-lookup-submit" type="submit" ${state.walletLookup.inFlight ? 'disabled' : ''} class="rounded-xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-1.5 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load Recent Activity</button>
                <div id="crypto-wallet-lookup-status" class="text-white/48">${escapeHtml(status)}</div>
            </form>
        `;
    }

    function getWalletLookupStatusLabel() {
        if (state.walletLookup.inFlight) return 'Loading from secure Worker';
        if (state.walletLookup.lastError) return state.walletLookup.lastError;
        if (state.walletLookup.eventCount > 0) {
            return `${state.walletLookup.eventCount} returned / ${state.walletLookup.mergedEventCount} merged`;
        }
        return 'No wallet lookup loaded';
    }

    function renderFlowQueueStatus() {
        const orderedCount = state.graph?.flowQueue?.ordered_flow_ids?.length
            || state.graph?.flowReplay?.ordered_flow_ids?.length
            || 0;
        const sourceLabel = getCurrentSourceLabel();
        const motionLabel = state.flowMotion.enabled ? 'Motion On' : 'Motion Off';
        const queueLabel = state.flowReplay.playing ? 'Pause Queue' : 'Start Queue';
        const liveLabel = state.live.enabled ? 'Worker Feed: ON' : 'Worker Feed: OFF';
        const liveStatus = getLiveStatusLabel();
        return `
            <div class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">WORKER FLOW QUEUE</div>
                        <div class="text-white/66">${escapeHtml(orderedCount)} ordered flows / ${escapeHtml(motionLabel)} / Source: ${escapeHtml(sourceLabel)} / ${escapeHtml(liveStatus)}</div>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        <button id="crypto-live-mode-toggle" type="button" aria-pressed="${state.live.enabled ? 'true' : 'false'}" class="rounded-full border ${state.live.enabled ? 'border-emerald-200/35 bg-emerald-300/15 text-emerald-50/86' : 'border-cyan-200/15 bg-cyan-300/10 text-cyan-50/78'} px-2.5 py-1 hover:border-cyan-100/35">${escapeHtml(liveLabel)}</button>
                        <button id="crypto-flow-queue-toggle" type="button" class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">${escapeHtml(queueLabel)}</button>
                        <button id="crypto-flow-queue-step" type="button" class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">Step</button>
                        <button id="crypto-flow-motion-toggle" type="button" class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">${escapeHtml(motionLabel)}</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderFlowFilters() {
        if (!state.graph) return '';
        const typeOptions = buildTransactionTypeOptions();
        const tokenOptions = buildTokenFilterOptions();
        const current = state.filters;
        return `
            <div class="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">FLOW FILTERS</div>
                        <div class="text-white/66">${escapeHtml(getVisibleFlowEdges().length)} visible / ${escapeHtml(state.graph.flowEdges.length)} total transfer legs</div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <label class="flex items-center gap-1.5 text-white/52">
                            <span>Type</span>
                            <select id="crypto-filter-transaction-type" class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1 text-cyan-50/82 outline-none">
                                ${typeOptions.map(option => `<option value="${escapeAttr(option.value)}" ${option.value === current.transactionType ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                            </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-white/52">
                            <span>Token</span>
                            <select id="crypto-filter-token" class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1 text-cyan-50/82 outline-none">
                                ${tokenOptions.map(option => `<option value="${escapeAttr(option.value)}" ${option.value === current.token ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                            </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-white/52">
                            <span>Direction</span>
                            <select id="crypto-filter-direction" class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1 text-cyan-50/82 outline-none">
                                ${[
                                    ['all', 'All'],
                                    ['inbound', 'Inbound'],
                                    ['outbound', 'Outbound'],
                                    ['internal_mixed', 'Internal/Mixed']
                                ].map(([value, label]) => `<option value="${value}" ${value === current.direction ? 'selected' : ''}>${label}</option>`).join('')}
                            </select>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    function buildTransactionTypeOptions() {
        const counts = new Map();
        (state.graph.flowEdges || []).forEach(edge => {
            const key = edge.transaction_type_key || core.interpretTransactionType?.(edge.transaction_type).key || 'UNKNOWN';
            const label = edge.transaction_type_label || core.interpretTransactionType?.(edge.transaction_type).label || 'Unknown / Unclassified';
            const current = counts.get(key) || { value: key, label, count: 0 };
            current.count += 1;
            counts.set(key, current);
        });
        (state.graph.transactionGroups || []).forEach(group => {
            const key = group.transaction_type_key || 'UNKNOWN';
            if (counts.has(key)) return;
            counts.set(key, { value: key, label: group.transaction_type_label || 'Unknown / Unclassified', count: 0 });
        });
        return [
            { value: 'all', label: 'All Types' },
            ...[...counts.values()]
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
                .map(item => ({ value: item.value, label: `${item.label} (${item.count})` }))
        ];
    }

    function buildTokenFilterOptions() {
        const counts = new Map();
        (state.graph.flowEdges || []).forEach(edge => {
            const value = `${edge.token_mint || ''}|${edge.symbol || ''}`;
            if (value === '|') return;
            const label = edge.symbol || shortLongValue(edge.token_mint) || 'Token';
            const current = counts.get(value) || { value, label, count: 0 };
            current.count += 1;
            counts.set(value, current);
        });
        return [
            { value: 'all', label: 'All Tokens' },
            ...[...counts.values()]
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
                .map(item => ({ value: item.value, label: `${item.label} (${item.count})` }))
        ];
    }

    function bindStatusControls(status) {
        status.querySelector('#crypto-generated-fixture-select')?.addEventListener('change', event => {
            const path = event.target.value;
            if (path) switchGeneratedFixture(path);
        });
        status.querySelector('#crypto-wallet-lookup-input')?.addEventListener('input', event => {
            state.walletLookup.walletInput = event.target.value;
            state.walletLookup.lastError = '';
        });
        status.querySelector('#crypto-wallet-lookup-form')?.addEventListener('submit', event => {
            event.preventDefault();
            loadWalletActivity(state.walletLookup.walletInput || status.querySelector('#crypto-wallet-lookup-input')?.value || '');
        });
        status.querySelector('#crypto-live-mode-toggle')?.addEventListener('click', () => {
            setLiveModeEnabled(!state.live.enabled);
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        });
        status.querySelector('#crypto-flow-queue-toggle')?.addEventListener('click', () => {
            toggleFlowReplay();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        });
        status.querySelector('#crypto-flow-queue-step')?.addEventListener('click', () => {
            stepFlowReplay(1);
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        });
        status.querySelector('#crypto-flow-motion-toggle')?.addEventListener('click', () => {
            setFlowAnimationEnabled(!state.flowMotion.enabled);
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        });
        status.querySelector('#crypto-filter-transaction-type')?.addEventListener('change', event => {
            state.filters.transactionType = event.target.value || 'all';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
        status.querySelector('#crypto-filter-token')?.addEventListener('change', event => {
            state.filters.token = event.target.value || 'all';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
        status.querySelector('#crypto-filter-direction')?.addEventListener('change', event => {
            state.filters.direction = event.target.value || 'all';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
    }

    async function switchGeneratedFixture(path) {
        if (!isSafeGeneratedFixturePath(path) || path === state.datasetSource) return;
        const dataset = await loadSampleDataset({ generatedFixturePath: path });
        applyDataset(dataset);
    }

    async function loadWalletActivity(wallet) {
        const normalizedWallet = String(wallet || '').trim();
        state.walletLookup.walletInput = normalizedWallet;
        if (!isValidSolanaWalletAddress(normalizedWallet)) {
            state.walletLookup.lastError = 'Enter a valid Solana wallet address';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        }

        const endpoint = resolveWalletLookupEndpoint();
        if (!endpoint) {
            state.walletLookup.lastError = 'Worker wallet lookup endpoint unavailable';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        }

        state.walletLookup.inFlight = true;
        state.walletLookup.lastError = '';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });

        try {
            const separator = endpoint.includes('?') ? '&' : '?';
            const response = await fetch(`${endpoint}${separator}wallet=${encodeURIComponent(normalizedWallet)}&limit=10`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || `Worker wallet lookup returned ${response.status}`);
            }

            const events = Array.isArray(payload?.events) ? payload.events : [];
            const result = mergeWorkerFeedEvents(events, { animateNew: true });
            state.walletLookup.lastWallet = normalizedWallet;
            state.walletLookup.lastLoadedAt = Date.now();
            state.walletLookup.eventCount = events.length;
            state.walletLookup.mergedEventCount += result?.mergedEvents || 0;
            state.walletLookup.lastError = events.length ? '' : 'No recent sanitized activity returned';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return result;
        } catch (error) {
            state.walletLookup.lastError = error?.message || 'Worker wallet lookup unavailable';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        } finally {
            state.walletLookup.inFlight = false;
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        }
    }

    function resolveWalletLookupEndpoint() {
        if (!state.live.endpointValid || !state.live.endpoint) return '';

        try {
            const parsed = state.live.endpoint.startsWith('/')
                ? new URL(state.live.endpoint, window.location.origin)
                : new URL(state.live.endpoint);
            if (parsed.pathname !== DEFAULT_WORKER_FEED_ENDPOINT) return '';
            parsed.pathname = DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT;
            parsed.search = '';
            parsed.hash = '';
            if (parsed.origin === window.location.origin) return parsed.pathname;
            return parsed.protocol === 'https:' ? parsed.href : '';
        } catch (error) {
            return '';
        }
    }

    function isValidSolanaWalletAddress(value) {
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || '').trim());
    }

    function applyDataset(dataset = {}) {
        state.dataset = cloneDataset(dataset);
        resetLiveMergeState();
        resetWalletLookupState();
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        state.flowReplay.playing = false;
        state.flowReplay.index = 0;
        state.flowReplay.activeFlowId = null;
        state.flowReplay.lastStepAt = 0;
        state.filters = { transactionType: 'all', token: 'all', direction: 'all' };
        state.manualNodePositions.clear();
        prepareFlowMotion();
        rebuildInteractionIndex();
        state.selectedId = state.graph.hubNodes?.[0]?.id || state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;
        renderSolanaStatusCopy(dataset);
        updateStats();
        resizeAndRender();
        renderDetails();
        updateFlowAnimationLoop();
        updateLivePolling();
    }

    function resizeAndRender() {
        if (!state.canvas || !state.ctx || !state.graph) return;

        const size = getCanvasSize();
        const ratio = window.devicePixelRatio || 1;
        state.canvas.width = Math.floor(size.width * ratio);
        state.canvas.height = Math.floor(size.height * ratio);
        state.canvas.style.width = `${size.width}px`;
        state.canvas.style.height = `${size.height}px`;
        state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        state.graph = layoutEngine.layoutGraph(state.graph, size);
        applyManualNodePositions();
        clampViewport();
        prepareFlowMotion();
        rebuildInteractionIndex();
        render();
    }

    function getCanvasSize() {
        const parent = state.canvas?.parentElement;
        return {
            width: Math.max(320, Math.floor(parent?.clientWidth || state.canvas?.clientWidth || 900)),
            height: Math.max(420, Math.floor(parent?.clientHeight || state.canvas?.clientHeight || 560))
        };
    }

    function render() {
        if (!state.ctx || !state.graph) return;

        const { width, height } = state.graph.bounds;
        const ctx = state.ctx;
        updateFlowReplay(performance.now());
        state.flowMotion.now = performance.now();
        const interaction = getInteractionState();
        ctx.clearRect(0, 0, width, height);
        drawBackdrop(ctx, width, height);

        ctx.save();
        ctx.translate(state.viewport.x, state.viewport.y);
        ctx.scale(state.viewport.scale, state.viewport.scale);

        const nodeById = state.graph.nodeById;
        getVisibleEdges()
            .filter(edge => edge.type !== core.EDGE_TYPES.LABEL)
            .sort((a, b) => edgeLayerOrder(a) - edgeLayerOrder(b) || (a.width || 0) - (b.width || 0))
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        getVisibleEdges()
            .filter(edge => edge.type === core.EDGE_TYPES.LABEL)
            .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

        state.graph.nodes
            .slice()
            .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
            .forEach(node => drawNode(ctx, node, interaction));

        ctx.restore();
    }

    function getVisibleEdges() {
        if (!state.graph) return [];
        const visibleFlowIds = new Set(getVisibleFlowEdges().map(edge => edge.id));
        const hasFlowFilter = hasActiveFlowFilter();
        return (state.graph.edges || []).filter(edge => {
            if (edge.type === core.EDGE_TYPES.FLOW) return visibleFlowIds.has(edge.id);
            if (edge.type === core.EDGE_TYPES.EXPOSURE) return exposureEdgeMatchesFilters(edge);
            if (edge.type === core.EDGE_TYPES.LABEL) {
                if (!hasFlowFilter) return true;
                const related = edge.related_flow_ids || [];
                return related.some(flowId => visibleFlowIds.has(flowId));
            }
            return true;
        });
    }

    function getVisibleFlowEdges() {
        return (state.graph?.flowEdges || []).filter(edgeMatchesActiveFilters);
    }

    function hasActiveFlowFilter() {
        return state.filters.transactionType !== 'all'
            || state.filters.token !== 'all'
            || state.filters.direction !== 'all';
    }

    function edgeMatchesActiveFilters(edge) {
        if (!edge) return false;
        if (state.filters.transactionType !== 'all' && edge.transaction_type_key !== state.filters.transactionType) return false;
        if (state.filters.token !== 'all') {
            const tokenKey = `${edge.token_mint || ''}|${edge.symbol || ''}`;
            if (tokenKey !== state.filters.token) return false;
        }
        if (state.filters.direction !== 'all' && getEdgeDirection(edge) !== state.filters.direction) return false;
        return true;
    }

    function exposureEdgeMatchesFilters(edge) {
        if (state.filters.token === 'all') return true;
        const token = state.graph?.nodeById.get(edge.target);
        if (token) return `${token.token_mint || ''}|${token.symbol || ''}` === state.filters.token;
        return `${edge.token_mint || ''}|${edge.symbol || ''}` === state.filters.token
            || `${edge.target || ''}|${edge.symbol || ''}` === state.filters.token;
    }

    function getEdgeDirection(edge) {
        if (edge.direction) return edge.direction;
        const trackedWallet = getRelationshipWallet();
        if (!trackedWallet) return 'internal_mixed';
        const sourceMatches = core.normalizeAddress(edge.source_wallet) === trackedWallet;
        const targetMatches = core.normalizeAddress(edge.destination_wallet) === trackedWallet;
        if (sourceMatches && targetMatches) return 'internal_mixed';
        if (sourceMatches) return 'outbound';
        if (targetMatches) return 'inbound';
        return 'internal_mixed';
    }

    function getRelationshipWallet() {
        const metadataWallet = core.normalizeAddress(state.graph?.metadata?.generated_wallet || state.graph?.metadata?.wallet || '');
        if (metadataWallet) return metadataWallet;
        const selected = state.graph?.nodeById.get(state.selectedId);
        return selected?.type === core.NODE_TYPES.WALLET ? core.normalizeAddress(selected.address) : '';
    }

    function drawBackdrop(ctx, width, height) {
        const gradient = ctx.createRadialGradient(width * 0.48, height * 0.45, 40, width * 0.48, height * 0.45, Math.max(width, height) * 0.66);
        gradient.addColorStop(0, 'rgba(34, 211, 238, 0.12)');
        gradient.addColorStop(0.52, 'rgba(168, 85, 247, 0.06)');
        gradient.addColorStop(1, 'rgba(2, 6, 23, 0.14)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 1;
        for (let x = 24; x < width; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 24; y < height; y += 48) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    function drawEdge(ctx, edge, nodeById, interaction) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const style = getEdgeInteractionStyle(edge, interaction);

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        const bend = edge.type === core.EDGE_TYPES.FLOW ? 24 : edge.type === core.EDGE_TYPES.EXPOSURE ? -18 : 0;
        const control = {
            x: (source.x + target.x) / 2 + normal.x * bend,
            y: (source.y + target.y) / 2 + normal.y * bend
        };

        ctx.save();
        ctx.globalAlpha = style.opacity;
        ctx.shadowColor = style.shadowColor;
        ctx.shadowBlur = style.shadowBlur;
        ctx.strokeStyle = edge.color || '#22d3ee';
        ctx.lineWidth = style.width;
        ctx.setLineDash(edge.type === core.EDGE_TYPES.LABEL ? [4, 6] : edge.flow_role === 'swap_route' ? [9, 5] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) {
            drawArrow(ctx, control, target, edge.color || '#22d3ee', style.arrowSize);
            drawFlowPulse(ctx, edge, source, control, target, distance, interaction);
        }
        ctx.restore();
    }

    function drawFlowPulse(ctx, edge, source, control, target, distance, interaction) {
        if (!isFlowEdgeVisible(source, target)) return;
        const pulse = getFlowPulse(edge, distance, interaction);
        if (!pulse) return;

        const point = pointOnQuadratic(source, control, target, pulse.t);
        const glowPoint = pointOnQuadratic(source, control, target, clamp(pulse.t - 0.055, 0, 1));

        ctx.save();
        ctx.setLineDash([]);
        ctx.globalAlpha = pulse.opacity * 0.34;
        ctx.strokeStyle = edge.color || '#67e8f9';
        ctx.lineWidth = pulse.radius * 1.35;
        ctx.shadowColor = edge.color || '#67e8f9';
        ctx.shadowBlur = pulse.glow;
        ctx.beginPath();
        ctx.moveTo(glowPoint.x, glowPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();

        ctx.globalAlpha = pulse.opacity;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = pulse.glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, pulse.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = pulse.opacity * 0.58;
        ctx.fillStyle = edge.color || '#67e8f9';
        ctx.beginPath();
        ctx.arc(point.x, point.y, pulse.radius * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function isFlowEdgeVisible(source, target) {
        const bounds = state.graph?.bounds;
        if (!bounds) return true;
        const scale = state.viewport.scale || 1;
        const margin = 80 / scale;
        const left = (-state.viewport.x / scale) - margin;
        const top = (-state.viewport.y / scale) - margin;
        const right = ((bounds.width - state.viewport.x) / scale) + margin;
        const bottom = ((bounds.height - state.viewport.y) / scale) + margin;
        const edgeLeft = Math.min(source.x, target.x);
        const edgeRight = Math.max(source.x, target.x);
        const edgeTop = Math.min(source.y, target.y);
        const edgeBottom = Math.max(source.y, target.y);
        return edgeRight >= left && edgeLeft <= right && edgeBottom >= top && edgeTop <= bottom;
    }

    function getFlowPulse(edge, distance, interaction) {
        if (!state.flowMotion.enabled) return null;
        const now = state.flowMotion.now || performance.now();
        const replayActive = state.flowReplay.activeFlowId === edge.id;
        const ambientPaused = now < state.flowMotion.userInteractingUntil;
        const ambientActive = state.flowMotion.ambientEnabled
            && !state.flowReplay.playing
            && !ambientPaused
            && state.flowMotion.topFlowIds.has(edge.id);
        if (!replayActive && !ambientActive) return null;

        const duration = clamp(distance * 10, FLOW_ANIMATION.minDurationMs, FLOW_ANIMATION.maxDurationMs);
        const seed = hashString(edge.id) % duration;
        const t = replayActive
            ? clamp((now - state.flowReplay.lastStepAt) / state.flowReplay.stepMs, 0.08, 0.94)
            : ((now + seed) % duration) / duration;
        const isFocused = interaction.replayActiveFlowId === edge.id;
        return {
            t,
            opacity: isFocused ? 0.82 : 0.48,
            radius: isFocused ? 4.6 : 3.4,
            glow: isFocused ? 18 : 11
        };
    }

    function pointOnQuadratic(source, control, target, t) {
        const oneMinusT = 1 - t;
        return {
            x: oneMinusT * oneMinusT * source.x + 2 * oneMinusT * t * control.x + t * t * target.x,
            y: oneMinusT * oneMinusT * source.y + 2 * oneMinusT * t * control.y + t * t * target.y
        };
    }

    function drawArrow(ctx, from, to, color, size = 8) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(to.x - Math.cos(angle) * 18, to.y - Math.sin(angle) * 18);
        ctx.lineTo(to.x - Math.cos(angle - 0.46) * (18 + size), to.y - Math.sin(angle - 0.46) * (18 + size));
        ctx.lineTo(to.x - Math.cos(angle + 0.46) * (18 + size), to.y - Math.sin(angle + 0.46) * (18 + size));
        ctx.closePath();
        ctx.fill();
    }

    function drawNode(ctx, node, interaction) {
        const selected = state.selectedId === node.id;
        const hovered = state.hoveredId === node.id;
        const connected = interaction.connectedNodeIds.has(node.id);
        const focusVisible = interaction.hasFocus;
        const muted = focusVisible && !connected;
        const radius = node.radius + (selected ? 5 : hovered ? 3 : 0);
        const showLabel = shouldShowNodeLabel(node, { selected, hovered, connected, interaction });
        const labelAlpha = showLabel ? (muted ? 0.3 : 0.92) : 0;

        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = selected ? 30 : hovered ? 22 : connected ? 13 : 7;
        ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = selected || hovered ? '#ffffff' : node.color;
        ctx.lineWidth = selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
        if (isHubNode(node)) {
            ctx.globalAlpha = muted ? 0.34 : 0.88;
            ctx.strokeStyle = node.color;
            ctx.lineWidth = selected || hovered ? 2.2 : 1.4;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
            ctx.strokeStyle = selected || hovered ? '#ffffff' : node.color;
            ctx.lineWidth = selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(3, radius * 0.28), 0, Math.PI * 2);
        ctx.fill();

        if (labelAlpha <= 0) {
            ctx.restore();
            return;
        }

        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = selected || hovered ? '#ffffff' : 'rgba(226, 232, 240, 0.82)';
        ctx.font = isHubNode(node) ? '700 12px Inter, sans-serif' : node.type === core.NODE_TYPES.TOKEN ? '600 11px Inter, sans-serif' : '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(labelForNode(node), node.x, node.y + radius + 8);
        ctx.restore();
    }

    function handleCanvasWheel(event) {
        if (!state.graph || !state.canvas) return;
        event.preventDefault();
        markFlowInteraction();

        const point = getScreenPoint(event);
        if (!point) return;
        const worldPoint = screenToWorld(point);
        const zoomIntensity = event.deltaMode === 1 ? 0.08 : 0.0018;
        const nextScale = clamp(
            state.viewport.scale * Math.exp(-event.deltaY * zoomIntensity),
            ZOOM_LIMITS.min,
            ZOOM_LIMITS.max
        );

        state.viewport.scale = nextScale;
        state.viewport.x = point.x - worldPoint.x * nextScale;
        state.viewport.y = point.y - worldPoint.y * nextScale;
        clampViewport();
        render();
    }

    function handleCanvasPointerDown(event) {
        if (!state.graph || !state.canvas) return;
        markFlowInteraction();
        const screenPoint = getScreenPoint(event);
        const worldPoint = screenToWorld(screenPoint);
        const node = getNodeAtWorldPoint(worldPoint);

        state.canvas.setPointerCapture?.(event.pointerId);
        state.drag = {
            pointerId: event.pointerId,
            mode: node ? 'node' : 'pan',
            nodeId: node?.id || null,
            startScreen: screenPoint,
            lastScreen: screenPoint,
            startNode: node ? { x: node.x, y: node.y } : null,
            startViewport: { ...state.viewport },
            moved: false
        };
        state.canvas.style.cursor = 'grabbing';
    }

    function handleCanvasPointerMove(event) {
        if (!state.graph || !state.canvas) return;
        const screenPoint = getScreenPoint(event);
        if (!screenPoint) return;

        if (state.drag?.pointerId === event.pointerId) {
            markFlowInteraction();
            const dx = screenPoint.x - state.drag.startScreen.x;
            const dy = screenPoint.y - state.drag.startScreen.y;
            if (Math.hypot(dx, dy) > DRAG_SELECT_THRESHOLD) state.drag.moved = true;

            if (state.drag.mode === 'node') {
                dragNodeTo(screenPoint);
            } else {
                state.viewport.x = state.drag.startViewport.x + dx;
                state.viewport.y = state.drag.startViewport.y + dy;
                clampViewport();
                render();
            }
            state.drag.lastScreen = screenPoint;
            return;
        }

        updateHoverFromScreenPoint(screenPoint);
    }

    function handleCanvasPointerUp(event) {
        if (!state.graph || !state.canvas) return;
        markFlowInteraction();
        const drag = state.drag;
        if (drag?.pointerId === event.pointerId) {
            state.canvas.releasePointerCapture?.(event.pointerId);
            state.drag = null;

            if (drag.mode === 'node' && !drag.moved && drag.nodeId) {
                state.selectedId = drag.nodeId;
                render();
                renderDetails();
            }

            updateHoverFromScreenPoint(getScreenPoint(event));
            return;
        }

        updateHoverFromScreenPoint(getScreenPoint(event));
    }

    function handleCanvasPointerCancel(event) {
        if (!state.canvas || state.drag?.pointerId !== event.pointerId) return;
        markFlowInteraction();
        state.canvas.releasePointerCapture?.(event.pointerId);
        state.drag = null;
        state.canvas.style.cursor = state.hoveredId ? 'grab' : 'grab';
    }

    function handleCanvasLeave() {
        if (!state.canvas || state.drag) return;
        markFlowInteraction();
        state.canvas.style.cursor = 'grab';
        if (!state.hoveredId) return;
        state.hoveredId = null;
        render();
    }

    function renderDetails() {
        if (!state.detailPanel || !state.graph) return;
        const node = state.graph.nodeById.get(state.selectedId) || state.graph.nodes[0];
        if (!node) {
            state.detailPanel.innerHTML = '<div class="text-sm text-white/45">No crypto graph node selected.</div>';
            return;
        }

        const relatedFlows = getRelatedEdges(node.id, core.EDGE_TYPES.FLOW);
        const relatedHubFlows = isHubNode(node) ? getRelatedHubFlows(node) : [];
        const relatedExposureEdges = getRelatedEdges(node.id, core.EDGE_TYPES.EXPOSURE).filter(exposureEdgeMatchesFilters);
        const connectedWallets = isHubNode(node) ? getConnectedWallets(node) : [];
        const displayedRelatedFlows = mergeUniqueEdges([...relatedFlows, ...relatedHubFlows]).filter(edgeMatchesActiveFilters);
        const relatedPaths = uniqueRelatedPaths(getRelatedPaths(node.id));
        const insight = buildNodeFlowInsight(node, displayedRelatedFlows);
        const relatedGroups = getRelatedTransactionGroups(node, displayedRelatedFlows);
        state.detailPanel.innerHTML = `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">${escapeHtml(isHubNode(node) ? 'ENTITY HUB' : node.type.toUpperCase())} NODE</div>
            <h3 class="font-display text-2xl mt-1">${escapeHtml(labelForNode(node))}</h3>
            <div class="text-[11px] text-white/42 mt-2">Local fixture graph. Source/program labels are hints from sanitized data, not identity claims.</div>
            ${renderDetailSection('Summary', `
                ${detailRow('Chain', node.chain || '-')}
                ${isHubNode(node) ? detailRow('Hub Category', formatHubCategory(node.category)) : ''}
                ${node.name && node.type === core.NODE_TYPES.TOKEN ? detailRow('Token', node.name) : ''}
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Tracked Wallet Relationship', describeWalletRelationship(node)) : ''}
                ${detailRow('Label Source', node.label_source || '-')}
                ${detailRow('Confidence', `${Math.round((node.confidence || 0) * 100)}%`)}
                ${node.address ? detailRow('Address', node.address, { shorten: true }) : ''}
                ${node.token_mint ? detailRow('Token Mint', node.token_mint, { shorten: true }) : ''}
                ${state.graph.flowQueue?.enabled === false || state.graph.flowReplay?.enabled === false ? detailRow('Live Flow Queue', `${state.graph.flowQueue?.ordered_flow_ids?.length || state.graph.flowReplay?.ordered_flow_ids?.length || 0} ordered flows staged offline`) : ''}
            `)}
            ${renderDetailSection('Flow Summary', `
                ${detailRow('Top Types', insight.types || '-')}
                ${detailRow('Tokens Involved', insight.tokens || '-')}
                ${detailRow('Direct In / Out', `${insight.inbound} in / ${insight.outbound} out / ${insight.mixed} mixed`)}
                ${detailRow('Visible Legs', `${displayedRelatedFlows.length} transfer leg${displayedRelatedFlows.length === 1 ? '' : 's'}`)}
            `)}
            ${renderDetailSection('Value / Exposure', `
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total In', core.formatUsd(node.total_in_usd || 0)) : ''}
                ${node.type === core.NODE_TYPES.WALLET ? detailRow('Total Out', core.formatUsd(node.total_out_usd || 0)) : ''}
                ${isHubNode(node) ? detailRow('Aggregate Value', core.formatUsd(node.aggregate_value_usd || 0)) : ''}
                ${isHubNode(node) ? detailRow('Transaction Count', node.transaction_count || 0) : ''}
                ${detailRow(node.type === core.NODE_TYPES.TOKEN ? 'Token Exposure' : isHubNode(node) ? 'Hub Exposure' : 'Exposure', core.formatUsd(node.exposure_usd || 0))}
            `)}
            ${isHubNode(node) ? `
                ${renderCardSection('Connected Wallets', connectedWallets, DETAIL_LIMITS.connectedWallets, renderNodeSummary, 'No connected sample wallets.')}
            ` : ''}
            ${renderCardSection('Direct Flows', displayedRelatedFlows, DETAIL_LIMITS.directFlows, edge => renderEdgeSummary(edge, node.id), 'No related sample flows.')}
            ${renderCardSection('Transaction Groups', relatedGroups, DETAIL_LIMITS.transactionGroups, renderTransactionGroupSummary, 'No transaction groups match this selection.')}
            ${renderCardSection('Token Exposure', relatedExposureEdges, DETAIL_LIMITS.tokenExposure, edge => renderEdgeSummary(edge, node.id), 'No token exposure links for this sample node.')}
            ${renderCardSection('Multi-Hop Paths', relatedPaths, DETAIL_LIMITS.multiHopPaths, renderPathSummary, 'No multi-hop wallet paths include this node.')}
        `;
    }

    function renderDetailSection(title, rowsHtml) {
        const rows = compactHtmlRows(rowsHtml);
        if (!rows) return '';
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">${escapeHtml(title)}</div>
                <div class="grid gap-2 text-xs text-white/68">${rows}</div>
            </section>
        `;
    }

    function renderCardSection(title, items, limit, renderItem, emptyMessage) {
        const list = Array.isArray(items) ? items : [];
        const displayed = list.slice(0, limit);
        const hiddenCount = Math.max(0, list.length - displayed.length);
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="flex items-center justify-between gap-3 mb-2">
                    <div class="text-[10px] font-mono tracking-[1.3px] text-white/45">${escapeHtml(title)}</div>
                    ${hiddenCount ? `<div class="text-[10px] font-mono text-white/32">+${hiddenCount} more</div>` : ''}
                </div>
                <div class="space-y-2">
                    ${displayed.map(renderItem).join('') || `<div class="text-xs text-white/38">${escapeHtml(emptyMessage)}</div>`}
                </div>
            </section>
        `;
    }

    function compactHtmlRows(rowsHtml) {
        return String(rowsHtml || '').replace(/\s+/g, ' ').trim();
    }

    function renderEdgeSummary(edge, selectedNodeId) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        const direction = edge.type === core.EDGE_TYPES.FLOW
            ? edge.source === selectedNodeId ? 'OUTFLOW' : edge.target === selectedNodeId ? 'INFLOW' : 'FLOW'
            : edge.type === core.EDGE_TYPES.LABEL ? formatRelation(edge.relation) : 'EXPOSURE';
        const amount = edge.amount_display || core.formatTokenAmount?.(edge.amount, edge.symbol) || '';
        const typeLabel = edge.transaction_type_label || '';
        const sourceLabel = edge.source_label || '';
        const label = edge.type === core.EDGE_TYPES.FLOW
            ? `${compactNodeLabel(source)} -> ${compactNodeLabel(target)}`
            : `${compactNodeLabel(source)} / ${compactNodeLabel(target)}`;
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(typeLabel ? `${direction} / ${typeLabel}` : direction)}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(edge.type === core.EDGE_TYPES.FLOW ? `${labelForNode(source)} -> ${labelForNode(target)}` : `${labelForNode(source)} / ${labelForNode(target)}`)}">${escapeHtml(label)}</div>
                <div class="text-[11px] text-white/42 mt-1">${escapeHtml(amount || edge.symbol || edge.chain || '')}${sourceLabel ? ` / ${escapeHtml(sourceLabel)}` : ''}${edge.usd_value ? ` / ${core.formatUsd(edge.usd_value)}` : ''}${edge.transaction_count ? ` across ${escapeHtml(edge.transaction_count)} tx` : ''}</div>
                ${edge.transaction_hash ? `<div class="text-[10px] font-mono text-white/32 mt-1">${escapeHtml(shortHash(edge.transaction_hash))}</div>` : ''}
            </div>
        `;
    }

    function renderTransactionGroupSummary(group) {
        const tokens = (group.tokens_involved || []).join(', ') || '-';
        const sourceLabel = group.source_label || group.source_program || 'Source unavailable';
        const role = group.primary_wallet_role ? formatRelation(group.primary_wallet_role) : 'No tracked wallet role';
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(group.transaction_type_label || 'Unknown / Unclassified')}</div>
                <div class="text-xs text-white/72 mt-1">${escapeHtml(group.leg_count || 0)} leg${group.leg_count === 1 ? '' : 's'} / ${escapeHtml(tokens)}</div>
                <div class="text-[11px] text-white/42 mt-1">${escapeHtml(sourceLabel)} / ${escapeHtml(role)}${group.timestamp ? ` / ${escapeHtml(formatDate(group.timestamp))}` : ''}</div>
                ${group.signature ? `<div class="text-[10px] font-mono text-white/32 mt-1">${escapeHtml(shortHash(group.signature))}</div>` : ''}
            </div>
        `;
    }

    function renderNodeSummary(node) {
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(node.chain || 'WALLET')}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(labelForNode(node))}">${escapeHtml(compactNodeLabel(node))}</div>
                <div class="text-[11px] font-mono text-white/42 mt-1" title="${escapeAttr(node.address || node.id)}">${escapeHtml(shortLongValue(node.address || node.id))}</div>
            </div>
        `;
    }

    function renderPathSummary(path) {
        const labels = path.wallet_ids
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .map(compactNodeLabel)
            .join(' -> ');
        const fullLabels = path.wallet_ids
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .map(labelForNode)
            .join(' -> ');
        return `
            <div class="crypto-edge-summary rounded-2xl p-3">
                <div class="text-[10px] font-mono text-cyan-100/70">${escapeHtml(path.hops)} HOP${path.hops === 1 ? '' : 'S'}</div>
                <div class="text-xs text-white/72 mt-1" title="${escapeAttr(fullLabels)}">${escapeHtml(labels)}</div>
                <div class="text-[11px] text-white/42 mt-1">${core.formatUsd(path.usd_value || 0)} sample flow path</div>
            </div>
        `;
    }

    function buildNodeFlowInsight(node, flows = []) {
        const typeCounts = new Map();
        const tokenCounts = new Map();
        let inbound = 0;
        let outbound = 0;
        let mixed = 0;

        flows.forEach(edge => {
            const type = edge.transaction_type_label || 'Unknown / Unclassified';
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
            const token = edge.symbol || shortLongValue(edge.token_mint) || 'Token';
            tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
            const direction = edge.source === node.id ? 'outbound' : edge.target === node.id ? 'inbound' : getEdgeDirection(edge);
            if (direction === 'inbound') inbound += 1;
            else if (direction === 'outbound') outbound += 1;
            else mixed += 1;
        });

        return {
            types: topCountLabels(typeCounts, 3),
            tokens: topCountLabels(tokenCounts, 4),
            inbound,
            outbound,
            mixed
        };
    }

    function getRelatedTransactionGroups(node, flows = []) {
        const relatedIds = new Set(flows.map(edge => edge.transaction_group_id).filter(Boolean));
        if (!relatedIds.size && node.type === core.NODE_TYPES.WALLET) {
            const wallet = core.normalizeAddress(node.address);
            (state.graph.transactionGroups || []).forEach(group => {
                if (core.normalizeAddress(group.primary_wallet) === wallet) relatedIds.add(group.id);
            });
        }
        return (state.graph.transactionGroups || [])
            .filter(group => relatedIds.has(group.id))
            .filter(groupMatchesActiveFilters)
            .sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp));
    }

    function groupMatchesActiveFilters(group) {
        if (state.filters.transactionType !== 'all' && group.transaction_type_key !== state.filters.transactionType) return false;
        if (state.filters.token !== 'all') {
            const [mint, symbol] = state.filters.token.split('|');
            const hasToken = (group.token_mints || []).includes(mint) || (group.tokens_involved || []).includes(symbol);
            if (!hasToken) return false;
        }
        if (state.filters.direction !== 'all' && group.direction !== state.filters.direction) return false;
        return true;
    }

    function describeWalletRelationship(node) {
        const wallet = core.normalizeAddress(node.address);
        const tracked = getRelationshipWallet();
        if (!tracked) return 'No tracked wallet metadata';
        if (wallet === tracked) return 'Tracked Wallet';
        return 'Counterparty / Transfer Leg Wallet';
    }

    function topCountLabels(counts, limit) {
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, limit)
            .map(([label, count]) => `${label} (${count})`)
            .join(', ');
    }

    function updateStats() {
        if (!state.graph) return;
        const visibleFlows = getVisibleFlowEdges();
        setText('crypto-wallet-count', `${state.graph.walletNodes.length} WALLETS / ${state.graph.hubNodes?.length || 0} HUBS`);
        setText('crypto-token-count', `${state.graph.tokenNodes.length} TOKENS`);
        setText('crypto-flow-count', `${visibleFlows.length} / ${state.graph.flowEdges.length} FLOWS`);
        setText('crypto-path-count', `${state.graph.walletPaths.length} PATHS`);
    }

    function detailRow(label, value, options = {}) {
        const rawValue = String(value);
        const visibleValue = options.shorten ? shortLongValue(rawValue) : rawValue;
        return `
            <div class="crypto-detail-row rounded-xl px-3 py-2">
                <div class="text-[10px] font-mono text-white/40">${escapeHtml(label)}</div>
                <div class="mt-1 break-all" title="${escapeAttr(rawValue)}">${escapeHtml(visibleValue)}</div>
            </div>
        `;
    }

    function labelForNode(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return node.symbol || node.name || 'Token';
        if (isHubNode(node)) return node.label || 'Entity Hub';
        const tracked = core.normalizeAddress(state.graph?.metadata?.generated_wallet || state.graph?.metadata?.wallet || '');
        if (tracked && core.normalizeAddress(node.address) === tracked) return 'Tracked Wallet';
        return node.label || core.shortAddress(node.address);
    }

    function shouldShowNodeLabel(node, context) {
        if (!node) return false;
        if (context.selected || context.hovered) return true;
        if (isHubNode(node)) return true;

        const isMajor = node.label_priority === 'major';
        if (!context.interaction.hasFocus) return isMajor;
        return context.connected && isMajor;
    }

    function shortHash(hash) {
        const value = String(hash || '');
        return value.length <= 16 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
    }

    function shortLongValue(value) {
        const text = String(value || '');
        if (text.length <= 18) return text;
        if (text.startsWith('0x')) return `${text.slice(0, 8)}...${text.slice(-6)}`;
        return `${text.slice(0, 7)}...${text.slice(-6)}`;
    }

    function compactNodeLabel(node = {}) {
        if (!node) return '-';
        const label = labelForNode(node);
        if (label && label.length <= 22 && label !== node.address) return label;
        return shortLongValue(node.address || node.token_mint || label || node.id);
    }

    function dragNodeTo(screenPoint) {
        if (!state.drag?.nodeId) return;
        const node = state.graph.nodeById.get(state.drag.nodeId);
        if (!node) return;

        const dx = (screenPoint.x - state.drag.startScreen.x) / state.viewport.scale;
        const dy = (screenPoint.y - state.drag.startScreen.y) / state.viewport.scale;
        const margin = Math.max(38, (node.radius || 18) + 10);
        const position = clampNodeToWorkspace(
            node,
            state.drag.startNode.x + dx,
            state.drag.startNode.y + dy,
            margin
        );
        node.x = position.x;
        node.y = position.y;
        state.manualNodePositions.set(node.id, { x: node.x, y: node.y });
        render();
    }

    function updateHoverFromScreenPoint(screenPoint) {
        if (!screenPoint || !state.canvas) return;
        const hovered = getNodeAtWorldPoint(screenToWorld(screenPoint));
        const nextHoveredId = hovered?.id || null;
        state.canvas.style.cursor = hovered ? 'grab' : 'grab';
        if (nextHoveredId === state.hoveredId) return;
        state.hoveredId = nextHoveredId;
        render();
    }

    function getNodeAtWorldPoint(point) {
        if (!point) return null;
        return state.graph.nodes
            .slice()
            .sort((a, b) => (b.radius || 0) - (a.radius || 0))
            .find(node => Math.hypot(node.x - point.x, node.y - point.y) <= (node.radius || 18) + 10 / state.viewport.scale);
    }

    function getScreenPoint(event) {
        if (!state.canvas) return null;
        const rect = state.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function screenToWorld(point) {
        return {
            x: (point.x - state.viewport.x) / state.viewport.scale,
            y: (point.y - state.viewport.y) / state.viewport.scale
        };
    }

    function applyManualNodePositions() {
        if (!state.graph || !state.manualNodePositions.size) return;
        state.manualNodePositions.forEach((position, nodeId) => {
            const node = state.graph.nodeById.get(nodeId);
            if (!node) return;
            const margin = Math.max(38, (node.radius || 18) + 10);
            const nextPosition = clampNodeToWorkspace(node, position.x, position.y, margin);
            node.x = nextPosition.x;
            node.y = nextPosition.y;
        });
    }

    function getGraphWorkspace() {
        const bounds = state.graph?.bounds || { width: 1, height: 1 };
        return state.graph?.workspace || {
            minX: 0,
            maxX: bounds.width,
            minY: 0,
            maxY: bounds.height,
            width: bounds.width,
            height: bounds.height
        };
    }

    function clampNodeToWorkspace(node, x, y, margin = 0) {
        const workspace = getGraphWorkspace();
        if (viewportUtils.clampPointToBounds) {
            return viewportUtils.clampPointToBounds({ x, y }, workspace, { margin, clamp });
        }
        return {
            x: clamp(x, workspace.minX + margin, workspace.maxX - margin),
            y: clamp(y, workspace.minY + margin, workspace.maxY - margin)
        };
    }

    function clampViewport() {
        if (!state.graph) return;
        const { width, height } = state.graph.bounds;
        const workspace = getGraphWorkspace();
        if (viewportUtils.clampViewToWorkspace) {
            const view = viewportUtils.clampViewToWorkspace({
                scale: state.viewport.scale,
                offsetX: state.viewport.x,
                offsetY: state.viewport.y
            }, workspace, {
                canvasWidth: width,
                canvasHeight: height,
                slackScale: 0.32,
                minSlackX: 120,
                minSlackY: 120,
                clamp
            });
            state.viewport.scale = view.scale;
            state.viewport.x = view.offsetX;
            state.viewport.y = view.offsetY;
            return;
        }

        const slackX = Math.max(120, width * 0.32);
        const slackY = Math.max(120, height * 0.32);
        state.viewport.x = clamp(
            state.viewport.x,
            width - workspace.maxX * state.viewport.scale - slackX,
            -workspace.minX * state.viewport.scale + slackX
        );
        state.viewport.y = clamp(
            state.viewport.y,
            height - workspace.maxY * state.viewport.scale - slackY,
            -workspace.minY * state.viewport.scale + slackY
        );
    }

    function resetView() {
        state.viewport = { x: 0, y: 0, scale: 1 };
        clampViewport();
        render();
    }

    function resetLayout() {
        if (!state.graph) return;
        state.manualNodePositions.clear();
        state.graph = layoutEngine.layoutGraph(state.graph, getCanvasSize());
        prepareFlowMotion();
        rebuildInteractionIndex();
        render();
        renderDetails();
    }

    function prepareFlowMotion() {
        if (!state.graph) return;
        state.flowMotion.topFlowIds = new Set(
            (state.graph.flowEdges || [])
                .slice()
                .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0))
                .slice(0, FLOW_ANIMATION.maxPulsedEdges)
                .map(edge => edge.id)
        );

        const replayFlows = state.graph.flowReplay?.ordered_flows || [];
        const activeIndex = clamp(state.flowReplay.index, 0, Math.max(0, replayFlows.length - 1));
        state.flowReplay.index = activeIndex;
        if (state.flowReplay.playing && replayFlows.length) {
            state.flowReplay.activeFlowId = replayFlows[activeIndex]?.id || null;
        } else if (!state.flowReplay.playing) {
            state.flowReplay.activeFlowId = null;
        }
    }

    function markFlowInteraction() {
        state.flowMotion.userInteractingUntil = performance.now() + FLOW_ANIMATION.idlePauseMs;
    }

    function updateFlowAnimationLoop() {
        if (!state.flowMotion.enabled || !state.active || !state.initialized || !state.graph) {
            if (state.flowMotion.rafId) {
                cancelAnimationFrame(state.flowMotion.rafId);
                state.flowMotion.rafId = null;
            }
            return;
        }

        if (!state.flowMotion.rafId) {
            state.flowMotion.lastFrameAt = 0;
            state.flowMotion.rafId = requestAnimationFrame(runFlowAnimationFrame);
        }
    }

    function runFlowAnimationFrame(timestamp) {
        state.flowMotion.rafId = null;
        if (!state.flowMotion.enabled || !state.active || !state.initialized || !state.graph) return;

        state.flowMotion.now = timestamp;
        const replayPulseVisible = Boolean(state.flowReplay.activeFlowId)
            && timestamp - state.flowReplay.lastStepAt <= state.flowReplay.stepMs;
        const ambientVisible = state.flowMotion.ambientEnabled
            && state.flowMotion.topFlowIds.size > 0
            && timestamp >= state.flowMotion.userInteractingUntil;
        const shouldRender = (state.flowReplay.playing || replayPulseVisible || ambientVisible)
            && timestamp - state.flowMotion.lastFrameAt >= FLOW_ANIMATION.frameMs;
        if (shouldRender) {
            state.flowMotion.lastFrameAt = timestamp;
            render();
        }

        state.flowMotion.rafId = requestAnimationFrame(runFlowAnimationFrame);
    }

    function updateFlowReplay(now) {
        const replay = state.graph?.flowReplay;
        const orderedFlows = replay?.ordered_flows || [];
        if (!state.flowReplay.playing || !orderedFlows.length) return;

        if (!state.flowReplay.activeFlowId) {
            state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
            state.flowReplay.lastStepAt = now;
            return;
        }

        if (now - state.flowReplay.lastStepAt < state.flowReplay.stepMs) return;
        stepFlowReplay(1, { keepPlaying: true, now, skipRender: true });
    }

    function setFlowReplayPlaying(playing) {
        const orderedFlows = state.graph?.flowReplay?.ordered_flows || [];
        state.flowReplay.playing = Boolean(playing && orderedFlows.length);
        if (!state.flowReplay.playing) {
            state.flowReplay.activeFlowId = null;
            render();
            return state.flowReplay;
        }

        state.flowReplay.index = clamp(state.flowReplay.index, 0, orderedFlows.length - 1);
        state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
        state.flowReplay.lastStepAt = performance.now();
        updateFlowAnimationLoop();
        render();
        return state.flowReplay;
    }

    function stepFlowReplay(direction = 1, options = {}) {
        const orderedFlows = state.graph?.flowReplay?.ordered_flows || [];
        if (!orderedFlows.length) return state.flowReplay;

        if (state.flowReplay.activeFlowId) {
            const delta = direction < 0 ? -1 : 1;
            state.flowReplay.index = (state.flowReplay.index + delta + orderedFlows.length) % orderedFlows.length;
        } else {
            state.flowReplay.index = clamp(state.flowReplay.index, 0, orderedFlows.length - 1);
        }
        state.flowReplay.activeFlowId = orderedFlows[state.flowReplay.index]?.id || null;
        state.flowReplay.lastStepAt = options.now || performance.now();
        if (!options.keepPlaying) state.flowReplay.playing = false;
        updateFlowAnimationLoop();
        if (!options.skipRender) render();
        return state.flowReplay;
    }

    function toggleFlowReplay() {
        return setFlowReplayPlaying(!state.flowReplay.playing);
    }

    function setFlowAnimationEnabled(enabled) {
        state.flowMotion.enabled = Boolean(enabled);
        if (!state.flowMotion.enabled) {
            state.flowReplay.playing = false;
            state.flowReplay.activeFlowId = null;
        }
        updateFlowAnimationLoop();
        render();
        return state.flowMotion.enabled;
    }

    function rebuildInteractionIndex() {
        if (!state.graph) return;
        const edgesByNode = new Map();
        const neighborsByNode = new Map();
        const pathsByNode = new Map();

        state.graph.nodes.forEach(node => {
            edgesByNode.set(node.id, []);
            neighborsByNode.set(node.id, new Set());
            pathsByNode.set(node.id, []);
        });

        const flowEdgeById = new Map();
        state.graph.edges.forEach(edge => {
            if (edge.type === core.EDGE_TYPES.FLOW) flowEdgeById.set(edge.id, edge);
            if (!edgesByNode.has(edge.source)) edgesByNode.set(edge.source, []);
            if (!edgesByNode.has(edge.target)) edgesByNode.set(edge.target, []);
            if (!neighborsByNode.has(edge.source)) neighborsByNode.set(edge.source, new Set());
            if (!neighborsByNode.has(edge.target)) neighborsByNode.set(edge.target, new Set());
            edgesByNode.get(edge.source).push(edge);
            edgesByNode.get(edge.target).push(edge);
            neighborsByNode.get(edge.source).add(edge.target);
            neighborsByNode.get(edge.target).add(edge.source);
        });

        (state.graph.hubNodes || []).forEach(hub => {
            (hub.related_flow_ids || []).forEach(flowId => {
                const flowEdge = flowEdgeById.get(flowId);
                if (!flowEdge) return;
                edgesByNode.get(hub.id).push(flowEdge);
                neighborsByNode.get(hub.id).add(flowEdge.source);
                neighborsByNode.get(hub.id).add(flowEdge.target);
            });
        });

        (state.graph.walletPaths || []).forEach(path => {
            (path.wallet_ids || []).forEach(nodeId => {
                if (!pathsByNode.has(nodeId)) pathsByNode.set(nodeId, []);
                pathsByNode.get(nodeId).push(path);
            });
        });

        state.interactionIndex = { edgesByNode, neighborsByNode, pathsByNode };
    }

    function getInteractionState() {
        const activeIds = new Set([state.selectedId, state.hoveredId].filter(Boolean));
        const connectedNodeIds = new Set(activeIds);
        const connectedEdgeIds = new Set();
        const index = state.interactionIndex;
        const replayActiveFlowId = state.flowReplay.activeFlowId;
        const replayActiveEdge = replayActiveFlowId
            ? (state.graph.flowEdges || []).find(edge => edge.id === replayActiveFlowId)
            : null;

        if (index) {
            activeIds.forEach(nodeId => {
                (index.neighborsByNode.get(nodeId) || []).forEach(connectedNodeIds.add, connectedNodeIds);
                (index.edgesByNode.get(nodeId) || []).forEach(edge => connectedEdgeIds.add(edge.id));
            });
        }

        if (replayActiveEdge) {
            connectedEdgeIds.add(replayActiveEdge.id);
            connectedNodeIds.add(replayActiveEdge.source);
            connectedNodeIds.add(replayActiveEdge.target);
        }

        return {
            activeIds,
            connectedNodeIds,
            connectedEdgeIds,
            hasFocus: activeIds.size > 0,
            hasSelected: Boolean(state.selectedId),
            replayActiveFlowId,
            hasReplayFocus: Boolean(replayActiveEdge)
        };
    }

    function getEdgeInteractionStyle(edge, interaction) {
        const baseOpacity = edge.opacity || 0.7;
        const baseWidth = edge.width || 1.4;
        const isFlow = edge.type === core.EDGE_TYPES.FLOW;
        const isReplayActive = interaction.replayActiveFlowId === edge.id;
        const hasReplayFocus = interaction.hasReplayFocus;
        const ambientPulsed = isFlow
            && state.flowMotion.enabled
            && state.flowMotion.ambientEnabled
            && !hasReplayFocus
            && state.flowMotion.topFlowIds.has(edge.id)
            && (state.flowMotion.now || performance.now()) >= state.flowMotion.userInteractingUntil;

        if (isReplayActive) {
            return {
                opacity: 1,
                width: baseWidth + 2.8,
                shadowBlur: 22,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 11
            };
        }

        if (hasReplayFocus && isFlow) {
            return {
                opacity: Math.max(0.1, baseOpacity * 0.42),
                width: Math.max(0.7, baseWidth * 0.72),
                shadowBlur: 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 7
            };
        }

        if (!interaction.hasFocus) {
            return {
                opacity: ambientPulsed ? Math.min(0.95, baseOpacity + 0.1) : baseOpacity,
                width: ambientPulsed ? baseWidth + 0.55 : baseWidth,
                shadowBlur: ambientPulsed ? 9 : edge.is_large_value ? 10 : 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 8
            };
        }

        const connected = interaction.connectedEdgeIds.has(edge.id);
        const isExposure = edge.type === core.EDGE_TYPES.EXPOSURE;
        const isLargeFlow = isFlow && edge.is_large_value;

        if (connected) {
            return {
                opacity: isFlow ? 1 : isExposure ? 0.58 : 0.38,
                width: baseWidth + (isFlow ? 2.2 : isExposure ? 0.45 : 0.1),
                shadowBlur: isFlow ? 16 : 7,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: isFlow ? 10 : 8
            };
        }

        return {
            opacity: isLargeFlow ? 0.42 : isFlow ? 0.13 : isExposure ? 0.12 : 0.08,
            width: isLargeFlow ? Math.max(baseWidth, 2.8) : Math.max(0.55, baseWidth * 0.62),
            shadowBlur: isLargeFlow ? 5 : 0,
            shadowColor: edge.color || '#22d3ee',
            arrowSize: 7
        };
    }

    function getRelatedEdges(nodeId, edgeType) {
        const edges = state.interactionIndex?.edgesByNode.get(nodeId) || [];
        return edges
            .filter(edge => edge.type === edgeType)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function getRelatedHubFlows(node) {
        if (!node?.related_flow_ids?.length) return [];
        const flowById = new Map((state.graph.flowEdges || []).map(edge => [edge.id, edge]));
        return node.related_flow_ids
            .map(id => flowById.get(id))
            .filter(Boolean)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function mergeUniqueEdges(edges) {
        return edges
            .filter((edge, index, list) => edge && list.findIndex(item => item?.id === edge.id) === index)
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0));
    }

    function getConnectedWallets(node) {
        return (node.connected_wallet_ids || [])
            .map(id => state.graph.nodeById.get(id))
            .filter(Boolean)
            .sort((a, b) => (b.exposure_usd || 0) - (a.exposure_usd || 0) || labelForNode(a).localeCompare(labelForNode(b)));
    }

    function getRelatedPaths(nodeId) {
        const directPaths = state.interactionIndex?.pathsByNode.get(nodeId) || [];
        if (directPaths.length) return directPaths.sort((a, b) => b.usd_value - a.usd_value || a.hops - b.hops);

        const neighborIds = state.interactionIndex?.neighborsByNode.get(nodeId) || new Set();
        const paths = [];
        neighborIds.forEach(neighborId => {
            (state.interactionIndex?.pathsByNode.get(neighborId) || []).forEach(path => paths.push(path));
        });
        return paths
            .filter((path, index, list) => list.findIndex(item => item.edge_ids.join('|') === path.edge_ids.join('|')) === index)
            .sort((a, b) => b.usd_value - a.usd_value || a.hops - b.hops);
    }

    function uniqueRelatedPaths(paths) {
        const bestByRoute = new Map();
        (paths || []).forEach(path => {
            const routeKey = (path.wallet_ids || []).join('>');
            if (!routeKey) return;
            const existing = bestByRoute.get(routeKey);
            if (
                !existing
                || (path.usd_value || 0) > (existing.usd_value || 0)
                || ((path.usd_value || 0) === (existing.usd_value || 0) && (path.hops || 0) < (existing.hops || 0))
            ) {
                bestByRoute.set(routeKey, path);
            }
        });

        return [...bestByRoute.values()]
            .sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0) || (a.hops || 0) - (b.hops || 0));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replaceAll('`', '&#096;');
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    }

    function typeOrder(type) {
        if (type === core.NODE_TYPES.HUB || type === core.NODE_TYPES.ENTITY) return 0;
        if (type === core.NODE_TYPES.TOKEN) return 2;
        return 1;
    }

    function edgeLayerOrder(edge) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return 0;
        if (edge.type === core.EDGE_TYPES.FLOW) return 1;
        return 2;
    }

    function isHubNode(node) {
        return node?.type === core.NODE_TYPES.HUB || node?.type === core.NODE_TYPES.ENTITY;
    }

    function formatHubCategory(category) {
        return String(category || 'labeled_entity').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function formatRelation(relation) {
        return String(relation || 'HUB LINK').replaceAll('_', ' ').toUpperCase();
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toISOString().slice(0, 10);
    }

    function timestampValue(value) {
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    namespace.ui = {
        initialize,
        setActive,
        render,
        resetView,
        resetLayout,
        playFlowReplay: () => setFlowReplayPlaying(true),
        pauseFlowReplay: () => setFlowReplayPlaying(false),
        toggleFlowReplay,
        stepFlowReplay,
        getFlowQueue: () => state.flowQueue,
        setFlowAnimationEnabled,
        setLiveModeEnabled,
        setLivePollInterval: pollMs => {
            state.live.pollMs = clamp(Number(pollMs) || LIVE_POLL_MS.default, LIVE_POLL_MS.min, LIVE_POLL_MS.max);
            updateLivePolling();
            return state.live.pollMs;
        },
        getState: () => ({ ...state })
    };
})();
