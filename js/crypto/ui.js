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
        selectedFlowId: null,
        hoveredId: null,
        interactionIndex: null,
        canvas: null,
        ctx: null,
        root: null,
        detailPanel: null,
        statusPanel: null,
        resizeObserver: null,
        fullscreen: false,
        datasetSource: null,
        datasetSourceKind: 'built_in',
        dataset: null,
        dataMode: 'generated_fixture',
        modeVersion: 0,
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
            mergedEventCount: 0,
            graphDepth: 1,
            lastRawDataset: null
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
        touchPointers: new Map(),
        pinch: null,
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
    const WALLET_INTELLIGENCE_LIMITS = {
        counterparties: 4,
        tokens: 4,
        timeline: 8
    };
    const GENERATED_FIXTURE_DIR = 'data/crypto/generated/';
    const WORKER_FEED_LIMIT = 50;
    const LIVE_POLL_MS = { min: 3000, max: 5000, default: 4000 };
    const DATA_MODES = Object.freeze({
        GENERATED: 'generated_fixture',
        WALLET: 'wallet_lookup',
        LIVE: 'live_feed'
    });
    const LAMPORTS_PER_SOL = 1000000000;
    const RAW_SOL_LAMPORT_HEURISTIC_MIN = 1000000;
    const SOURCE_LABELS = {
        generated: 'Generated Fixture',
        solana_sample: 'Generated Fixture',
        legacy_sample: 'Generated Fixture',
        built_in: 'Generated Fixture',
        worker_feed: 'Worker Feed (Realtime)',
        worker_wallet_lookup: 'Wallet Lookup (Live Pull)'
    };
    const NOISE_ADDRESS_PREFIXES = [
        'computebudget111111111111111111111111111111',
        'tokenkegqfezyinwajbnbgkpfxcwubvf9ss623vq5da',
        'tokenzqdbnjbkpecb7cb21qvwxqvfkkcwfbzrg',
        'sysvar',
        '11111111111111111111111111111111',
        'addresslookuptab1e1111111111111111111111111',
        'bpfloader',
        'bpfloaderupgradeab1e11111111111111111111111',
        'vot111111111111111111111111111111111111111',
        'vote111111111111111111111111111111111111111',
        'stake11111111111111111111111111111111111111',
        'atokengpvbdgvxr1bv2hvzbswhbnequgkycwvdsxf',
        'memosq4gqxgabhysygxbdlqnysncmyzry2k69ydt4c',
        'metaqbxxuerdq28cj1rbawkyqm3ybzjb6a8bt518x1s'
    ];

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
        state.canvas.addEventListener('lostpointercapture', handleCanvasPointerCancel);
        state.canvas.addEventListener('mouseleave', handleCanvasLeave);
        document.getElementById('crypto-reset-view')?.addEventListener('click', resetView);
        document.getElementById('crypto-reset-layout')?.addEventListener('click', resetLayout);
        document.getElementById('crypto-fullscreen-toggle')?.addEventListener('click', () => {
            setFullscreen(!state.fullscreen);
        });
        document.getElementById('crypto-mobile-reset-view')?.addEventListener('click', resetView);
        document.getElementById('crypto-mobile-center-wallet')?.addEventListener('click', centerTrackedWallet);
        document.getElementById('crypto-mobile-fullscreen-toggle')?.addEventListener('click', () => {
            setFullscreen(!state.fullscreen);
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !state.fullscreen) return;
            event.preventDefault();
            setFullscreen(false);
        });
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

        return resolveWorkerEndpoint({
            configuredValue,
            defaultEndpoint: DEFAULT_WORKER_FEED_ENDPOINT
        });
    }

    function resolveWorkerEndpoint({ configuredValue, defaultEndpoint }) {
        const hasConfiguredValue = typeof configuredValue === 'string' && configuredValue.trim();
        const rawEndpoint = hasConfiguredValue ? configuredValue.trim() : defaultEndpoint;
        const fallback = { endpoint: defaultEndpoint, valid: false };
        try {
            const parsed = parseWorkerEndpointUrl(rawEndpoint);
            if (isSafeWorkerUrl(parsed, {
                expectedPath: defaultEndpoint,
                allowExternal: Boolean(hasConfiguredValue)
            })) {
                return {
                    endpoint: parsed.origin === window.location.origin ? parsed.pathname : parsed.href,
                    valid: true
                };
            }
        } catch (error) {
            return fallback;
        }

        return fallback;
    }

    function parseWorkerEndpointUrl(rawEndpoint) {
        const endpoint = String(rawEndpoint || '').trim();
        if (!endpoint) throw new Error('Worker endpoint missing');
        if (endpoint.includes('\\')) throw new Error('Worker endpoint backslashes rejected');
        if (endpoint.startsWith('//')) throw new Error('Protocol-relative Worker endpoint rejected');
        if (/^[a-z][a-z0-9+.-]*:/i.test(endpoint)) return new URL(endpoint);

        const path = endpoint.startsWith('/')
            ? endpoint
            : `/${endpoint.replace(/^\.?\//, '')}`;
        return new URL(path, window.location.origin);
    }

    function isSafeWorkerUrl(parsed, options = {}) {
        if (!parsed || !parsed.pathname.endsWith(options.expectedPath)) return false;
        if (parsed.search || parsed.hash || parsed.username || parsed.password) return false;
        if (parsed.origin === window.location.origin) return true;
        return Boolean(options.allowExternal) && parsed.protocol === 'https:';
    }

    function setLiveModeEnabled(enabled) {
        if (enabled) {
            switchDataMode(DATA_MODES.LIVE);
            return state.live;
        }

        if (state.dataMode === DATA_MODES.LIVE) {
            switchDataMode(DATA_MODES.GENERATED);
            return state.live;
        }

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
        if (state.dataMode !== DATA_MODES.LIVE || !state.live.enabled || !state.live.endpointValid || !state.active || !state.initialized) return;

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
        if (state.dataMode !== DATA_MODES.LIVE || !state.live.enabled || !state.live.endpointValid || state.live.inFlight) return null;

        state.live.inFlight = true;
        const requestModeVersion = state.modeVersion;
        try {
            const separator = state.live.endpoint.includes('?') ? '&' : '?';
            const response = await fetch(`${state.live.endpoint}${separator}limit=${WORKER_FEED_LIMIT}`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            if (!response.ok) {
                throw new Error(response.status === 404
                    ? 'Worker feed endpoint not configured for this host.'
                    : `Worker feed returned ${response.status}`);
            }

            const payload = await response.json();
            const events = Array.isArray(payload?.events) ? payload.events : [];
            if (state.dataMode !== DATA_MODES.LIVE || requestModeVersion !== state.modeVersion) return null;
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
            if (requestModeVersion === state.modeVersion && state.dataMode === DATA_MODES.LIVE) {
                state.live.workerAvailable = false;
                state.live.lastError = error?.message || 'Worker feed unavailable';
                state.live.lastPollAt = Date.now();
                renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            }
            return null;
        } finally {
            if (requestModeVersion === state.modeVersion || state.dataMode !== DATA_MODES.LIVE) state.live.inFlight = false;
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

    function convertWorkerEventsToDataset(events = [], options = {}) {
        const wallets = [];
        const tokens = [];
        const transactions = [];
        const trackedWallet = core.normalizeAddress(options.trackedWallet || '');

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

                const amountInfo = normalizeWorkerTransferAmount(transfer, {
                    event,
                    symbol,
                    token,
                    firstToken,
                    chain,
                    tokenMint
                });
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
                    amount: amountInfo.amount,
                    amount_display: amountInfo.display,
                    usd_value: Number(event.usd_value || transfer.usd_value) || 0,
                    timestamp: event.timestamp || event.received_at || new Date().toISOString(),
                    confidence: getWorkerEventConfidence(event),
                    label_source: event.ingestion_source || event.source || 'worker_feed',
                    source_program: event.source || event.ingestion_source || 'secure_runtime_feed',
                    source_label: core.formatSourceLabel(event.source || event.ingestion_source || 'Worker Feed'),
                    direction: '',
                    tracked_wallet_role: getTrackedWalletRole(trackedWallet, sourceWallet, destinationWallet),
                    metadata: {
                        dedupe_key: eventKey,
                        live_transfer_dedupe_key: transferDedupeKey,
                        source_event_id: event.id || '',
                        ingestion_source: event.ingestion_source || '',
                        received_at: event.received_at || '',
                        source_format: 'worker_feed_event',
                        live_feed: options.sourceKind !== 'wallet_lookup',
                        wallet_lookup: options.sourceKind === 'wallet_lookup',
                        sanitized: true,
                        production_meaning: false,
                        live_blockchain_fetching: false,
                        amount_display: amountInfo.display,
                        raw_amount: amountInfo.rawAmount,
                        amount_unit: amountInfo.unit,
                        amount_normalized: amountInfo.normalized,
                        decimals: amountInfo.decimals
                    }
                });
            });
        });

        return {
            metadata: {
                name: options.sourceKind === 'wallet_lookup'
                    ? 'CryptoPhotonic Wallet Lookup'
                    : 'CryptoPhotonic Worker Feed Merge',
                environment: 'secure_runtime_feed',
                chain: 'solana',
                adapter: 'worker_event_feed',
                source: options.sourceKind === 'wallet_lookup' ? 'wallet_lookup_live_pull' : 'secure_runtime_feed',
                wallet: trackedWallet,
                wallet_lookup_mode: options.sourceKind === 'wallet_lookup',
                wallet_lookup_tracked_wallet: trackedWallet,
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
        const previousSelectedFlowId = state.selectedFlowId;
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
        state.selectedFlowId = previousSelectedFlowId && state.graph.flowEdges.some(edge => edge.id === previousSelectedFlowId)
            ? previousSelectedFlowId
            : null;

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
        stopLivePolling();
        state.live.enabled = false;
        state.live.inFlight = false;
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
        state.walletLookup.lastRawDataset = null;
    }

    function getCurrentSourceLabel() {
        if (state.dataMode === DATA_MODES.WALLET) {
            return SOURCE_LABELS.worker_wallet_lookup;
        }
        if (state.dataMode === DATA_MODES.LIVE) {
            return SOURCE_LABELS.worker_feed;
        }
        return SOURCE_LABELS[state.datasetSourceKind] || SOURCE_LABELS.built_in;
    }

    function getSourceBoundaryCopy() {
        if (state.dataMode === DATA_MODES.WALLET) {
            return 'Wallet lookup replaces the active graph with a secure Worker response; it is not merged with generated fixtures.';
        }
        if (state.dataMode === DATA_MODES.LIVE) {
            return 'Live Feed shows only sanitized Worker events. No provider keys or browser provider calls are used.';
        }
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
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const match = String(value ?? '').replaceAll(',', '').trim().match(/-?\d+(?:\.\d+)?/);
        const number = Number(match?.[0]);
        return Number.isFinite(number) ? number : 0;
    }

    function normalizeWorkerTransferAmount(transfer = {}, context = {}) {
        const symbol = String(context.symbol || transfer.token_symbol || transfer.symbol || '').trim();
        const decimals = getWorkerTransferDecimals(transfer, context);
        const unit = String(transfer.unit || transfer.amount_unit || transfer.amountUnit || '').trim().toLowerCase();
        const displayHint = String(transfer.amount_display || transfer.amountDisplay || '').trim();
        const lamports = firstDefined(
            transfer.lamports,
            transfer.raw_lamports,
            transfer.amount_lamports,
            transfer.rawAmountLamports
        );
        const rawTokenAmount = getWorkerRawTokenAmount(transfer);
        const tokenAmount = firstDefined(transfer.tokenAmount, transfer.token_amount);
        const rawCandidate = firstDefined(lamports, rawTokenAmount, tokenAmount, transfer.amount);
        const rawText = String(rawCandidate ?? '').trim();

        if (lamports != null) {
            return buildWorkerAmountInfo(parseWorkerAmount(lamports) / LAMPORTS_PER_SOL, symbol || 'SOL', {
                rawAmount: lamports,
                unit: 'lamports',
                decimals: 9,
                normalized: true,
                displayHint
            });
        }

        if (rawTokenAmount != null && hasUsableDecimals(decimals)) {
            return buildWorkerAmountInfo(parseWorkerAmount(rawTokenAmount) / (10 ** decimals), symbol, {
                rawAmount: rawTokenAmount,
                unit: 'raw_token_amount',
                decimals,
                normalized: true,
                displayHint
            });
        }

        if (rawTokenAmount != null) {
            return buildWorkerAmountInfo(parseWorkerAmount(rawTokenAmount), symbol, {
                rawAmount: rawTokenAmount,
                unit: 'raw_token_amount_missing_decimals',
                decimals,
                normalized: false
            });
        }

        if (tokenAmount != null) {
            return buildWorkerAmountInfo(parseWorkerAmount(tokenAmount), symbol, {
                rawAmount: tokenAmount,
                unit: unit || 'token_amount',
                decimals,
                normalized: true,
                displayHint
            });
        }

        const amount = parseWorkerAmount(transfer.amount);
        if (unit === 'lamports' || unit === 'raw_lamports') {
            return buildWorkerAmountInfo(amount / LAMPORTS_PER_SOL, symbol || 'SOL', {
                rawAmount: transfer.amount,
                unit,
                decimals: 9,
                normalized: true,
                displayHint
            });
        }

        if ((unit === 'raw' || unit === 'base_units' || unit === 'raw_token_amount') && hasUsableDecimals(decimals)) {
            return buildWorkerAmountInfo(amount / (10 ** decimals), symbol, {
                rawAmount: transfer.amount,
                unit,
                decimals,
                normalized: true,
                displayHint
            });
        }

        if (shouldTreatWorkerAmountAsNativeLamports(amount, rawText, symbol, context.event)) {
            return buildWorkerAmountInfo(amount / LAMPORTS_PER_SOL, symbol || 'SOL', {
                rawAmount: transfer.amount,
                unit: 'lamports_inferred',
                decimals: 9,
                normalized: true,
                displayHint
            });
        }

        return buildWorkerAmountInfo(amount, symbol, {
            rawAmount: transfer.amount,
            unit: unit || 'normalized',
            decimals,
            normalized: true,
            displayHint
        });
    }

    function buildWorkerAmountInfo(amount, symbol, options = {}) {
        const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
        const unit = String(options.unit || '');
        const useDisplayHint = options.displayHint && !/raw|lamports/i.test(unit);
        const display = useDisplayHint ? options.displayHint : (symbol || safeAmount ? core.formatTokenAmount?.(safeAmount, symbol) || String(safeAmount) : '');
        return {
            amount: safeAmount,
            display: String(display || '').trim(),
            rawAmount: options.rawAmount ?? null,
            unit,
            decimals: Number.isFinite(Number(options.decimals)) ? Number(options.decimals) : null,
            normalized: options.normalized === true
        };
    }

    function getWorkerTransferDecimals(transfer = {}, context = {}) {
        const values = [
            transfer.decimals,
            transfer.token_decimals,
            transfer.rawTokenAmount?.decimals,
            transfer.raw_token_amount?.decimals,
            context.token?.decimals,
            context.firstToken?.decimals
        ];
        for (const value of values) {
            const number = Number(value);
            if (Number.isInteger(number) && number >= 0 && number <= 18) return number;
        }
        if (isSolSymbol(context.symbol || transfer.token_symbol || transfer.symbol)) return 9;
        return null;
    }

    function getWorkerRawTokenAmount(transfer = {}) {
        if (transfer.rawTokenAmount && typeof transfer.rawTokenAmount === 'object') return transfer.rawTokenAmount.tokenAmount ?? transfer.rawTokenAmount.amount;
        if (transfer.raw_token_amount && typeof transfer.raw_token_amount === 'object') return transfer.raw_token_amount.tokenAmount ?? transfer.raw_token_amount.amount;
        return firstDefined(transfer.rawTokenAmount, transfer.raw_token_amount, transfer.raw_amount, transfer.rawAmount);
    }

    function shouldTreatWorkerAmountAsNativeLamports(amount, rawText, symbol, event = {}) {
        if (!isSolSymbol(symbol)) return false;
        if (!Number.isFinite(amount) || amount <= 0) return false;
        if (rawText.includes('.')) return false;
        const sourceText = `${event.ingestion_source || ''} ${event.source || ''}`.toLowerCase();
        if (sourceText.includes('helius')) return true;
        return amount >= RAW_SOL_LAMPORT_HEURISTIC_MIN;
    }

    function hasUsableDecimals(value) {
        const number = Number(value);
        return Number.isInteger(number) && number >= 0 && number <= 18;
    }

    function isSolSymbol(symbol = '') {
        return String(symbol || '').trim().toUpperCase() === 'SOL';
    }

    function firstDefined(...values) {
        return values.find(value => value !== undefined && value !== null && value !== '');
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
            ${renderWalletIntelligencePanel()}
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
        const sourceSnapshot = renderDataSourceSnapshot(generatedWallet, generatedAt, transactionCount);

        return `
            <div class="crypto-control-group rounded-2xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">DATA SOURCE / MODE</div>
                        <div class="${sourceTone}">Source: ${escapeHtml(sourceLabel)}</div>
                    </div>
                    ${renderDataModeSwitch()}
                </div>
                ${renderControlHelp('Choose the source before investigating. Generated Fixture is local sample data, Wallet Lookup replaces the graph with a secure Worker response, and Live Feed shows sanitized Worker events only.')}
                ${selector}
                ${sourceSnapshot}
                <div class="mt-2 text-yellow-100/76">${escapeHtml(getSourceBoundaryCopy())}</div>
                ${renderWalletLookupControls()}
            </div>
        `;
    }

    function renderDataSourceSnapshot(generatedWallet, generatedAt, transactionCount) {
        if (state.dataMode === DATA_MODES.WALLET) {
            const tracked = state.walletLookup.lastWallet || state.walletLookup.walletInput || state.graph?.metadata?.wallet_lookup_tracked_wallet || '';
            const visible = state.graph?.flowEdges?.length || 0;
            return `
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1 text-white/56">
                    <div>Mode: Replacement wallet graph</div>
                    <div title="${escapeAttr(tracked || 'No tracked wallet loaded')}">Tracked: ${escapeHtml(tracked ? shortLongValue(tracked) : '-')}</div>
                    <div>Returned / Visible: ${escapeHtml(state.walletLookup.eventCount || 0)} / ${escapeHtml(visible)}</div>
                </div>
            `;
        }
        if (state.dataMode === DATA_MODES.LIVE) {
            return `
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1 text-white/56">
                    <div>Mode: Live Worker feed</div>
                    <div>Events: ${escapeHtml(state.live.eventCount || 0)} returned / ${escapeHtml(state.live.mergedEventCount || 0)} shown</div>
                    <div>Last Poll: ${escapeHtml(state.live.lastPollAt ? formatDateTime(state.live.lastPollAt) : '-')}</div>
                </div>
            `;
        }
        return `
            <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1 text-white/56">
                <div title="${escapeAttr(generatedWallet || 'Unavailable')}">Fixture Wallet: ${escapeHtml(generatedWallet ? shortLongValue(generatedWallet) : '-')}</div>
                <div>Generated: ${escapeHtml(generatedAt || '-')}</div>
                <div>Tx: ${escapeHtml(transactionCount ?? '-')}</div>
            </div>
        `;
    }

    function renderDataModeSwitch() {
        const modes = [
            [DATA_MODES.GENERATED, 'Generated Fixture'],
            [DATA_MODES.WALLET, 'Wallet Lookup'],
            [DATA_MODES.LIVE, 'Live Feed']
        ];
        const help = {
            [DATA_MODES.GENERATED]: 'Use local reviewed fixtures to explore graph behavior without relying on Worker availability.',
            [DATA_MODES.WALLET]: 'Replace the active graph with recent activity returned by the secure Worker for one wallet.',
            [DATA_MODES.LIVE]: 'Show sanitized events from the Worker feed; the browser does not call chain providers.'
        };
        return `
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="CryptoPhotonic data mode">
                ${modes.map(([mode, label]) => {
                    const active = state.dataMode === mode;
                    return `<button type="button" data-crypto-mode="${escapeAttr(mode)}" aria-pressed="${active ? 'true' : 'false'}" title="${escapeAttr(help[mode])}" class="rounded-full border ${active ? 'border-emerald-200/40 bg-emerald-300/16 text-emerald-50/90' : 'border-cyan-200/15 bg-slate-950/45 text-cyan-50/70'} px-2.5 py-1 hover:border-cyan-100/35">${escapeHtml(label)}</button>`;
                }).join('')}
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
            <label class="mt-2 flex items-center gap-2 text-white/52 ${state.dataMode === DATA_MODES.GENERATED ? '' : 'opacity-55'}">
                <span title="Local fixture retained for repeatable demos, development, and Worker outage fallback.">Generated Fixture</span>
                <select id="crypto-generated-fixture-select" ${state.dataMode === DATA_MODES.GENERATED ? '' : 'disabled'} class="bg-slate-950/80 border border-cyan-200/15 rounded-xl px-2 py-1 text-cyan-50/82 outline-none disabled:opacity-50">
                    ${options}
                </select>
            </label>
            ${renderControlHelp('Generated fixtures stay available so graph layout, filters, replay, and wallet intelligence can be tested with stable local data.')}
        `;
    }

    function renderWalletLookupControls() {
        const status = getWalletLookupStatusLabel();
        const value = state.walletLookup.walletInput || state.walletLookup.lastWallet || '';
        return `
            <form id="crypto-wallet-lookup-form" class="mt-3 grid gap-2">
                <div class="text-white/38">WALLET INVESTIGATION</div>
                ${renderControlHelp('Load Activity asks the secure Worker for recent wallet activity and replaces the current graph. Refresh repeats the last lookup.')}
                <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
                    <label class="grid gap-1 min-w-0 text-white/52">
                        <span title="Solana wallet address to investigate through the Worker wallet-activity endpoint.">Wallet Address</span>
                        <input id="crypto-wallet-lookup-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" value="${escapeAttr(value)}" placeholder="Solana wallet address" class="w-full min-h-10 bg-slate-950/80 border border-cyan-200/15 rounded-xl px-3 py-2 text-cyan-50/82 outline-none placeholder:text-white/28">
                    </label>
                    <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <button id="crypto-wallet-lookup-submit" type="submit" ${state.walletLookup.inFlight ? 'disabled' : ''} title="Load recent sanitized wallet activity from the Worker and replace the active graph." class="min-h-10 rounded-xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load Activity</button>
                        <button id="crypto-wallet-lookup-refresh" type="button" ${state.walletLookup.inFlight || !(state.walletLookup.lastWallet || value) ? 'disabled' : ''} title="Run the last wallet lookup again without changing the entered address." class="min-h-10 rounded-xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Refresh</button>
                    </div>
                </div>
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label class="flex min-h-10 items-center gap-2 rounded-xl border border-cyan-200/15 bg-slate-950/35 px-3 py-2 text-white/58" title="Advanced: include meaningful addresses one additional transfer hop away when the Worker response contains them.">
                        <input id="crypto-wallet-depth-toggle" type="checkbox" ${state.walletLookup.graphDepth > 1 ? 'checked' : ''} ${state.dataMode === DATA_MODES.WALLET ? '' : 'disabled'} class="h-4 w-4 accent-cyan-300">
                        <span>Include 2-hop wallet addresses</span>
                    </label>
                    <div id="crypto-wallet-lookup-status" class="min-w-0 rounded-xl border border-white/10 bg-slate-950/32 px-3 py-2 text-white/56 break-words">${escapeHtml(status)}</div>
                </div>
            </form>
        `;
    }

    function getWalletLookupStatusLabel() {
        if (state.walletLookup.inFlight) return 'Loading from secure Worker';
        if (state.walletLookup.lastError) return state.walletLookup.lastError;
        if (state.walletLookup.eventCount > 0) {
            return `${state.walletLookup.eventCount} returned / ${state.walletLookup.mergedEventCount} shown`;
        }
        return 'No wallet lookup loaded';
    }

    function renderWalletIntelligencePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) return '';
        const intelligence = buildWalletIntelligence();
        const emptyState = getWalletLookupEmptyStateDetails(intelligence);
        const depthNote = getWalletDepthExpansionNote();
        return `
            <div class="rounded-2xl border border-emerald-200/18 bg-emerald-300/10 p-3 sm:p-4">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                        <div class="text-white/38">WALLET INTELLIGENCE</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/86">Wallet Lookup Readout</div>
                        <div class="mt-1 max-w-2xl text-white/58 leading-relaxed">Secure Worker activity only. The visible graph shows wallet/address relationships observed in transfer data; it does not make identity claims about people, entities, or ownership.</div>
                    </div>
                    ${renderWalletLookupStatusBadge(intelligence.lookupStatus)}
                </div>
                ${renderWalletLookupConfidenceStatus(intelligence)}
                ${renderWalletActionableInsights(intelligence)}
                ${emptyState ? renderWalletEmptyStateCard(emptyState) : ''}
                ${depthNote ? renderWalletDepthNoteCard(depthNote) : ''}
                <div class="mt-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-2.5">
                    <div class="grid gap-2.5 min-w-0">
                        <section class="rounded-xl border border-white/10 bg-white/[0.045] p-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="text-white/38">LOOKUP STATUS</div>
                                <div class="text-white/44">${escapeHtml(intelligence.lastLoadedLabel)}</div>
                            </div>
                            ${renderWalletAddressLine('Tracked Wallet', intelligence.trackedWallet)}
                            <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                ${renderWalletMetric('Returned', intelligence.returnedEvents, 'Worker returned events')}
                                ${renderWalletMetric('Visible Legs', intelligence.visibleLegs, 'Transfer legs currently visible')}
                                ${renderWalletMetric('Noise Removed', intelligence.filteredLegs, getWalletFilteredLegCopy(intelligence.filteredLegs))}
                                ${renderWalletMetric('Depth', `${intelligence.graphDepth}-hop`, 'Wallet lookup graph depth')}
                            </div>
                            <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                ${renderWalletMetric('Source', intelligence.sourceLabel)}
                                ${renderWalletMetric('Ranked Addresses', intelligence.counterparties.length)}
                            </div>
                        </section>
                        <section class="rounded-xl border border-white/10 bg-white/[0.045] p-3">
                            <div class="text-white/38">FLOW HIGHLIGHTS</div>
                            <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                ${renderWalletHighlightMetric('Top Received Token', intelligence.topInboundToken)}
                                ${renderWalletHighlightMetric('Top Sent Token', intelligence.topOutboundToken)}
                                ${renderWalletHighlightMetric('Largest Flow', intelligence.largestFlow)}
                                ${renderWalletHighlightMetric('Repeated Address', intelligence.mostRepeatedCounterparty)}
                            </div>
                        </section>
                    </div>
                    <section class="rounded-xl border border-white/10 bg-white/[0.045] p-3 min-w-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="text-white/38">TOP COUNTERPARTIES</div>
                            <div class="text-white/38">${escapeHtml(Math.min(intelligence.counterparties.length, WALLET_INTELLIGENCE_LIMITS.counterparties))} shown</div>
                        </div>
                        <div class="mt-2 grid gap-2">
                            ${intelligence.counterparties.slice(0, WALLET_INTELLIGENCE_LIMITS.counterparties).map(renderCounterpartyRankRow).join('') || renderWalletInlineEmpty('No visible counterparty wallet addresses after filters.')}
                        </div>
                    </section>
                </div>
                <section class="mt-2.5 rounded-xl border border-white/10 bg-white/[0.045] p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-white/38">TOKEN FLOW SUMMARY</div>
                        <div class="text-white/38">${escapeHtml(Math.min(intelligence.tokens.length, WALLET_INTELLIGENCE_LIMITS.tokens))} tokens shown</div>
                    </div>
                    <div class="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
                        ${intelligence.tokens.slice(0, WALLET_INTELLIGENCE_LIMITS.tokens).map(renderTokenFlowSummaryRow).join('') || renderWalletInlineEmpty('No token flow summary is available for the visible wallet graph.')}
                    </div>
                </section>
                ${renderWalletTimelineSection(intelligence.timeline)}
            </div>
        `;
    }

    function renderWalletActionableInsights(intelligence) {
        const cards = getWalletInsightCards(intelligence);
        const nextActions = intelligence.nextActions || [];
        return `
            <section class="mt-3 rounded-xl border border-emerald-200/16 bg-slate-950/28 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">ACTIONABLE INSIGHTS</div>
                        <div class="mt-0.5 text-white/54">Derived from visible normalized wallet lookup flows only.</div>
                    </div>
                    <div class="text-white/38">${escapeHtml(intelligence.visibleLegs)} visible leg${intelligence.visibleLegs === 1 ? '' : 's'}</div>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    ${cards.map(renderWalletInsightCard).join('')}
                </div>
                <div class="mt-3 rounded-lg border border-cyan-200/12 bg-cyan-300/8 px-3 py-2.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-white/38">WHAT TO INSPECT NEXT</div>
                        <div class="text-white/36">${escapeHtml(nextActions.length)} suggestion${nextActions.length === 1 ? '' : 's'}</div>
                    </div>
                    <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        ${nextActions.map(renderWalletNextAction).join('') || renderWalletInlineEmpty('Load wallet activity or relax filters to reveal inspectable flows.')}
                    </div>
                </div>
            </section>
        `;
    }

    function renderWalletInsightCard(card = {}) {
        const tone = card.tone === 'strong'
            ? 'border-emerald-200/20 bg-emerald-300/10'
            : card.tone === 'warn'
                ? 'border-yellow-200/20 bg-yellow-300/10'
                : 'border-white/10 bg-white/[0.035]';
        return `
            <div class="min-w-0 rounded-lg border ${tone} px-3 py-2.5">
                <div class="text-white/38">${escapeHtml(card.label || '-')}</div>
                <div class="mt-1 text-sm font-semibold text-cyan-50/86 break-words">${escapeHtml(card.value || '-')}</div>
                <div class="mt-1 text-white/48 leading-snug break-words">${escapeHtml(card.detail || '')}</div>
            </div>
        `;
    }

    function renderWalletNextAction(action = {}) {
        const attrs = action.flowId
            ? `data-crypto-flow-id="${escapeAttr(action.flowId)}"`
            : action.walletAddress
                ? `data-crypto-wallet-address="${escapeAttr(action.walletAddress)}"`
                : action.tokenFilter
                    ? `data-crypto-token-filter="${escapeAttr(action.tokenFilter)}"`
                    : action.depth
                        ? `data-crypto-depth="${escapeAttr(action.depth)}"`
                        : '';
        const disabled = attrs ? '' : 'disabled';
        return `
            <button type="button" ${attrs} ${disabled} class="w-full text-left rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2 hover:border-cyan-100/30 disabled:cursor-default disabled:opacity-70">
                <div class="font-semibold text-cyan-50/84">${escapeHtml(action.title || 'Inspect flow')}</div>
                <div class="mt-0.5 text-white/48 leading-snug">${escapeHtml(action.detail || '')}</div>
            </button>
        `;
    }

    function renderWalletMetric(label, value, title = '') {
        const raw = String(value ?? '-');
        return `
            <div class="min-w-0 rounded-xl border border-white/10 bg-slate-950/34 px-2.5 py-2" title="${escapeAttr(title || raw)}">
                <div class="text-white/34">${escapeHtml(label)}</div>
                <div class="mt-1 text-sm font-semibold text-cyan-50/84 break-words">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function renderWalletHighlightMetric(label, value) {
        const raw = String(value ?? '-');
        return `
            <div class="min-w-0 rounded-xl border border-cyan-200/10 bg-slate-950/28 px-3 py-2.5" title="${escapeAttr(raw)}">
                <div class="text-white/38">${escapeHtml(label)}</div>
                <div class="mt-1 text-cyan-50/82 leading-snug break-words">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function renderWalletLookupStatusBadge(status) {
        const loaded = status === 'Loaded';
        const loading = status === 'Loading';
        const classes = loading
            ? 'border-cyan-200/30 bg-cyan-300/14 text-cyan-50/86'
            : loaded
                ? 'border-emerald-200/35 bg-emerald-300/14 text-emerald-50/88'
                : 'border-white/12 bg-white/[0.04] text-white/58';
        return `<div class="shrink-0 rounded-full border ${classes} px-3 py-1.5">${escapeHtml(status)}</div>`;
    }

    function renderWalletLookupConfidenceStatus(intelligence) {
        const items = getWalletLookupQualityItems(intelligence);
        return `
            <section class="mt-3 rounded-xl border border-cyan-200/14 bg-slate-950/30 px-3 py-2.5">
                <div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div class="min-w-0">
                        <div class="text-white/38">DATA QUALITY</div>
                        <div class="mt-1 text-cyan-50/78 leading-relaxed">${escapeHtml(getWalletFilteredLegCopy(intelligence.filteredLegs))}</div>
                        <div class="mt-1 text-white/50 leading-relaxed">Badges explain whether the graph came from a Worker response, whether sanitized fields are in use, and whether wallet lookup replacement mode is active. Visible links remain address-to-address observations only.</div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-1.5 min-w-[0] lg:min-w-[260px]">
                        ${items.map(renderWalletQualityBadge).join('')}
                    </div>
                </div>
            </section>
        `;
    }

    function getWalletLookupQualityItems(intelligence) {
        const metadata = state.graph?.metadata || {};
        const hasWorkerResponse = Boolean(state.walletLookup.lastLoadedAt);
        const workerError = Boolean(state.walletLookup.lastError) && !state.walletLookup.inFlight && !hasWorkerResponse;
        const sanitized = metadata.sanitized === true || state.dataMode === DATA_MODES.WALLET;
        const replacementMode = state.dataMode === DATA_MODES.WALLET && metadata.wallet_lookup_mode === true;
        const filterApplied = hasWorkerResponse || state.walletLookup.inFlight;
        return [
            {
                label: state.walletLookup.inFlight
                    ? 'Requesting Worker'
                    : hasWorkerResponse
                        ? 'Secure Worker Response'
                        : workerError
                            ? 'Worker Response Blocked'
                            : 'No Worker Response Yet',
                tone: hasWorkerResponse ? 'good' : workerError ? 'warn' : 'idle',
                detail: hasWorkerResponse
                    ? `${intelligence.returnedEvents} returned event${intelligence.returnedEvents === 1 ? '' : 's'}`
                    : state.walletLookup.inFlight
                        ? 'Lookup in progress'
                        : 'Enter a wallet to load activity'
            },
            {
                label: sanitized ? 'Sanitized Graph' : 'Sanitization Unknown',
                tone: sanitized ? 'good' : 'warn',
                detail: sanitized ? 'Worker-derived fields only' : 'Review source metadata'
            },
            {
                label: filterApplied ? 'Noise Filter Applied' : 'Noise Filter Ready',
                tone: filterApplied ? 'good' : 'idle',
                detail: `${intelligence.filteredLegs} leg${intelligence.filteredLegs === 1 ? '' : 's'} removed`
            },
            {
                label: replacementMode ? 'Replacement Mode' : 'Mode Pending',
                tone: replacementMode ? 'good' : 'idle',
                detail: replacementMode ? 'Not merged with fixtures' : 'Wallet mode not active'
            }
        ];
    }

    function renderWalletQualityBadge(item) {
        const classes = item.tone === 'good'
            ? 'border-emerald-200/24 bg-emerald-300/12 text-emerald-50/86'
            : item.tone === 'warn'
                ? 'border-yellow-200/24 bg-yellow-300/12 text-yellow-50/84'
                : 'border-white/12 bg-white/[0.035] text-white/62';
        return `
            <div class="min-w-0 rounded-lg border ${classes} px-2.5 py-2">
                <div class="font-semibold leading-snug">${escapeHtml(item.label)}</div>
                <div class="mt-0.5 text-white/48 leading-snug break-words">${escapeHtml(item.detail)}</div>
            </div>
        `;
    }

    function getWalletFilteredLegCopy(count) {
        const value = Math.max(0, Number(count) || 0);
        if (value === 0) return 'No infrastructure/noise transfer legs were removed from this graph.';
        return `${value} infrastructure/noise transfer leg${value === 1 ? '' : 's'} removed before graphing.`;
    }

    function renderWalletAddressLine(label, address) {
        const value = address ? shortLongValue(address) : '-';
        return `
            <div class="mt-2 min-w-0 rounded-xl border border-cyan-200/10 bg-slate-950/32 px-3 py-2" title="${escapeAttr(address || value)}">
                <div class="text-white/34">${escapeHtml(label)}</div>
                <div class="mt-1 font-mono text-[11px] text-cyan-50/82 break-words">${escapeHtml(value)}</div>
            </div>
        `;
    }

    function renderWalletEmptyStateCard(emptyState) {
        const tone = emptyState.tone === 'warn'
            ? 'border-yellow-200/20 bg-yellow-300/10 text-yellow-50/82'
            : 'border-cyan-200/16 bg-cyan-300/10 text-cyan-50/78';
        return `
            <div class="mt-3 rounded-xl border ${tone} px-3 py-2.5">
                <div class="font-semibold">${escapeHtml(emptyState.title)}</div>
                <div class="mt-1 text-white/62 leading-relaxed">${escapeHtml(emptyState.body)}</div>
            </div>
        `;
    }

    function renderWalletDepthNoteCard(note) {
        return `
            <div class="mt-2 rounded-xl border border-cyan-200/16 bg-cyan-300/10 px-3 py-2.5 text-cyan-50/74 leading-relaxed">
                <span class="font-semibold text-cyan-50/88">2-hop check:</span> ${escapeHtml(note)}
            </div>
        `;
    }

    function renderWalletInlineEmpty(message) {
        return `<div class="rounded-lg border border-white/10 bg-slate-950/24 px-3 py-2 text-white/42 leading-relaxed">${escapeHtml(message)}</div>`;
    }

    function renderCounterpartyRankRow(item) {
        const tokens = item.tokens.length ? item.tokens.join(', ') : '-';
        const value = item.totalUsd > 0 ? core.formatUsd(item.totalUsd) : '-';
        return `
            <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-white/10 bg-slate-950/28 px-3 py-2">
                <div class="min-w-0" title="${escapeAttr(item.address)}">
                    <div class="font-mono text-[11px] text-cyan-50/80 break-words">${escapeHtml(shortLongValue(item.address))}</div>
                    <div class="mt-1 text-white/48 leading-snug">${escapeHtml(item.relationship)}</div>
                    <div class="mt-1 text-white/36 break-words">${escapeHtml(tokens)}</div>
                </div>
                <div class="sm:text-right text-white/62">
                    <div class="text-cyan-50/78">${escapeHtml(item.count)} leg${item.count === 1 ? '' : 's'}</div>
                    <div>${escapeHtml(value)}</div>
                </div>
            </div>
        `;
    }

    function renderTokenFlowSummaryRow(item) {
        const amount = item.amountAvailable ? `${formatCompactNumber(item.totalAmount)} ${item.symbol}` : '-';
        const value = item.totalUsd > 0 ? core.formatUsd(item.totalUsd) : '-';
        return `
            <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-white/10 bg-slate-950/28 px-3 py-2">
                <div class="min-w-0" title="${escapeAttr(item.mint || item.symbol)}">
                    <div class="text-cyan-50/80 break-words">${escapeHtml(item.symbol)}</div>
                    <div class="mt-1 text-white/44 leading-snug">${escapeHtml(item.inbound)} received / ${escapeHtml(item.outbound)} sent / ${escapeHtml(item.mixed)} mixed</div>
                    <div class="mt-1 text-white/34 break-words">Amount ${escapeHtml(amount)}</div>
                </div>
                <div class="sm:text-right text-white/62">${escapeHtml(value)}</div>
            </div>
        `;
    }

    function renderWalletTimelineSection(flows = []) {
        const visibleCount = getVisibleFlowEdges().length;
        return `
            <section class="mt-2.5 rounded-xl border border-cyan-200/14 bg-slate-950/28 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">VISIBLE FLOW TIMELINE</div>
                        <div class="mt-0.5 text-white/54">Timeline lists visible transfer legs after filters; newest or highest-value legs appear first and selecting one opens its inspector.</div>
                    </div>
                    <div class="text-white/38">${escapeHtml(flows.length)} shown / ${escapeHtml(visibleCount)} visible</div>
                </div>
                <div class="mt-2 grid gap-2">
                    ${flows.map(renderWalletTimelineItem).join('') || renderWalletInlineEmpty('No visible transfer legs match the active flow filters.')}
                </div>
            </section>
        `;
    }

    function renderWalletTimelineItem(edge, index) {
        const sourceAddress = getFlowSourceAddress(edge);
        const targetAddress = getFlowTargetAddress(edge);
        const timeLabel = getFlowTimelineTimeLabel(edge, index);
        const direction = formatFlowDirection(getEdgeDirection(edge));
        const amount = getNormalizedFlowAmountDisplay(edge);
        const symbol = String(edge.symbol || shortLongValue(edge.token_mint) || 'Token').trim() || 'Token';
        const typeLabel = edge.transaction_type_label || core.interpretTransactionType?.(edge.transaction_type).label || 'Unknown / Unclassified';
        const hash = shortHash(edge.transaction_hash);
        const selected = state.selectedFlowId === edge.id;
        return `
            <button type="button" data-crypto-flow-id="${escapeAttr(edge.id)}" class="w-full text-left rounded-lg border ${selected ? 'border-cyan-200/38 bg-cyan-300/12' : 'border-white/10 bg-white/[0.035]'} px-3 py-2 hover:border-cyan-100/30">
                <div class="grid grid-cols-1 md:grid-cols-[7rem_5.5rem_minmax(0,1fr)_auto] gap-1.5 md:gap-3 md:items-center">
                    <div class="text-[10px] font-mono text-white/44">${escapeHtml(timeLabel)}</div>
                    <div class="text-[10px] font-mono text-cyan-50/72">${escapeHtml(direction)}</div>
                    <div class="min-w-0">
                        <div class="text-cyan-50/84 break-words">${escapeHtml(amount)} <span class="text-white/46">${escapeHtml(symbol)}</span></div>
                        <div class="mt-0.5 font-mono text-[11px] text-white/48 break-words" title="${escapeAttr(`${sourceAddress} -> ${targetAddress}`)}">${escapeHtml(shortLongValue(sourceAddress))} &rarr; ${escapeHtml(shortLongValue(targetAddress))}</div>
                    </div>
                    <div class="md:text-right text-white/46">
                        <div class="text-[10px] font-mono">${escapeHtml(typeLabel)}</div>
                        ${hash ? `<div class="mt-0.5 text-[10px] font-mono text-white/32">${escapeHtml(hash)}</div>` : ''}
                    </div>
                </div>
            </button>
        `;
    }

    function buildWalletIntelligence() {
        const metadata = state.graph?.metadata || {};
        const trackedWallet = core.normalizeAddress(
            metadata.wallet_lookup_tracked_wallet
            || metadata.wallet
            || state.walletLookup.lastWallet
            || state.walletLookup.walletInput
            || ''
        );
        const visibleFlows = getVisibleFlowEdges();
        const sourceLabel = metadata.source_label || getCurrentSourceLabel();
        const filteredLegs = getWalletFilteredLegCount(metadata);
        const tokenSummary = buildWalletTokenFlowSummary(visibleFlows);
        const counterparties = buildWalletCounterpartyRanking(visibleFlows, trackedWallet);
        const largestFlowEdge = getLargestVisibleFlow(visibleFlows);
        const largest = getLargestVisibleFlowLabel(visibleFlows, largestFlowEdge);
        const repeated = getMostRepeatedCounterpartyLabel(counterparties);
        const intelligence = {
            trackedWallet,
            sourceLabel,
            returnedEvents: state.walletLookup.eventCount || 0,
            visibleLegs: visibleFlows.length,
            filteredLegs,
            graphDepth: Number(metadata.wallet_lookup_depth || state.walletLookup.graphDepth) || 1,
            lastLoadedLabel: state.walletLookup.lastLoadedAt ? formatDateTime(state.walletLookup.lastLoadedAt) : '-',
            topInboundToken: getTopTokenLabel(tokenSummary, 'inbound'),
            topOutboundToken: getTopTokenLabel(tokenSummary, 'outbound'),
            dominantDirection: getWalletDominantDirection(visibleFlows),
            mostActiveToken: getMostActiveTokenSummary(tokenSummary),
            mostActiveCounterparty: counterparties[0] || null,
            largestFlowEdge,
            largestFlow: largest,
            mostRepeatedCounterparty: repeated,
            recentActivityDensity: getWalletRecentActivityDensity(visibleFlows),
            filteredNoiseImpact: getWalletFilteredNoiseImpact(filteredLegs, visibleFlows.length),
            depthOpportunity: getWalletDepthOpportunity(),
            lookupStatus: state.walletLookup.inFlight ? 'Loading' : state.walletLookup.lastWallet ? 'Loaded' : 'Waiting',
            counterparties,
            tokens: tokenSummary,
            timeline: buildWalletTimelineFlows(visibleFlows)
        };
        intelligence.nextActions = buildWalletNextActions(intelligence);
        return intelligence;
    }

    function getWalletInsightCards(intelligence = {}) {
        const counterparty = intelligence.mostActiveCounterparty;
        const token = intelligence.mostActiveToken;
        return [
            {
                label: 'Dominant Direction',
                value: intelligence.dominantDirection?.label || '-',
                detail: intelligence.dominantDirection?.detail || 'No visible transfer direction yet.',
                tone: intelligence.dominantDirection?.dominant ? 'strong' : 'idle'
            },
            {
                label: 'Most Active Counterparty',
                value: counterparty ? shortLongValue(counterparty.address) : '-',
                detail: counterparty ? `${counterparty.count} visible leg${counterparty.count === 1 ? '' : 's'} / ${counterparty.relationship}` : 'No repeated visible counterparty address.',
                tone: counterparty?.count > 1 ? 'strong' : 'idle'
            },
            {
                label: 'Most Active Token',
                value: token?.symbol || '-',
                detail: token ? `${token.count} leg${token.count === 1 ? '' : 's'} / ${token.directionLabel}` : 'No token activity visible under current filters.',
                tone: token?.count > 1 ? 'strong' : 'idle'
            },
            {
                label: 'Largest Normalized Flow',
                value: intelligence.largestFlow || '-',
                detail: intelligence.largestFlowEdge ? formatFlowDirectionRelativeToTracked(intelligence.largestFlowEdge) : 'No visible normalized flow to inspect.',
                tone: intelligence.largestFlowEdge ? 'strong' : 'idle'
            },
            {
                label: 'Recent Activity Density',
                value: intelligence.recentActivityDensity?.label || '-',
                detail: intelligence.recentActivityDensity?.detail || 'No timestamps available.',
                tone: intelligence.recentActivityDensity?.tone || 'idle'
            },
            {
                label: 'Filtered-Noise Impact',
                value: intelligence.filteredNoiseImpact?.label || '-',
                detail: intelligence.filteredNoiseImpact?.detail || getWalletFilteredLegCopy(intelligence.filteredLegs),
                tone: intelligence.filteredLegs > 0 ? 'warn' : 'idle'
            }
        ];
    }

    function buildWalletNextActions(intelligence = {}) {
        const actions = [];
        const repeated = (intelligence.counterparties || []).find(item => item.count > 1) || intelligence.mostActiveCounterparty;
        if (repeated) {
            actions.push({
                title: 'Inspect repeated counterparty',
                detail: `${shortLongValue(repeated.address)} appears in ${repeated.count} visible leg${repeated.count === 1 ? '' : 's'}.`,
                walletAddress: repeated.address
            });
        }

        if (intelligence.largestFlowEdge) {
            actions.push({
                title: 'Check largest flow',
                detail: `${getLargestVisibleFlowLabel([intelligence.largestFlowEdge], intelligence.largestFlowEdge)} opens in the selected-flow inspector.`,
                flowId: intelligence.largestFlowEdge.id
            });
        }

        const token = intelligence.mostActiveToken;
        if (token?.filterKey) {
            actions.push({
                title: 'Review token summary',
                detail: `Filter visible flows to ${token.symbol} and compare received vs sent legs.`,
                tokenFilter: token.filterKey
            });
        }

        if (intelligence.depthOpportunity?.useful) {
            actions.push({
                title: 'Toggle 2-hop only if useful',
                detail: intelligence.depthOpportunity.detail,
                depth: 2
            });
        }

        return actions.slice(0, 4);
    }

    function getWalletDominantDirection(edges = []) {
        const counts = { inbound: 0, outbound: 0, mixed: 0 };
        edges.forEach(edge => {
            const direction = getEdgeDirection(edge);
            if (direction === 'inbound') counts.inbound += 1;
            else if (direction === 'outbound') counts.outbound += 1;
            else counts.mixed += 1;
        });

        const total = counts.inbound + counts.outbound + counts.mixed;
        if (!total) {
            return {
                label: 'No visible flow',
                detail: 'No visible transfer legs match the current filters.',
                dominant: false
            };
        }

        const ranked = [
            ['inbound', counts.inbound],
            ['outbound', counts.outbound],
            ['mixed', counts.mixed]
        ].sort((a, b) => b[1] - a[1]);
        const [direction, count] = ranked[0];
        const share = count / total;
        const dominant = share >= 0.6 && count >= 2;
        const label = dominant
            ? `Mostly ${direction === 'mixed' ? 'mixed' : direction}`
            : 'Mixed';
        return {
            label,
            detail: `${counts.inbound} inbound / ${counts.outbound} outbound / ${counts.mixed} mixed visible legs.`,
            dominant
        };
    }

    function getMostActiveTokenSummary(tokens = []) {
        const top = tokens
            .slice()
            .sort((a, b) => b.count - a.count || b.totalUsd - a.totalUsd || a.symbol.localeCompare(b.symbol))[0];
        if (!top) return null;
        const directions = [
            top.inbound ? `${top.inbound} received` : '',
            top.outbound ? `${top.outbound} sent` : '',
            top.mixed ? `${top.mixed} mixed` : ''
        ].filter(Boolean).join(' / ');
        return {
            ...top,
            filterKey: `${top.mint || ''}|${top.symbol || ''}`,
            directionLabel: directions || 'direction unavailable'
        };
    }

    function getWalletRecentActivityDensity(edges = []) {
        const timestamps = edges
            .map(edge => timestampValue(edge.timestamp))
            .filter(value => value > 0)
            .sort((a, b) => b - a);
        if (!timestamps.length) {
            return {
                label: 'No timestamps',
                detail: 'Timeline falls back to graph order and value ranking.',
                tone: 'idle'
            };
        }

        const newest = timestamps[0];
        const oldest = timestamps[timestamps.length - 1];
        const dayMs = 24 * 60 * 60 * 1000;
        const latestDayCount = timestamps.filter(value => newest - value <= dayMs).length;
        const spanDays = Math.max(1, Math.ceil((newest - oldest) / dayMs));
        return {
            label: `${latestDayCount} in latest 24h`,
            detail: `${timestamps.length} timestamped leg${timestamps.length === 1 ? '' : 's'} across ${spanDays} day${spanDays === 1 ? '' : 's'}.`,
            tone: latestDayCount >= 3 ? 'strong' : 'idle'
        };
    }

    function getWalletFilteredNoiseImpact(filteredLegs, visibleLegs) {
        const filtered = Math.max(0, Number(filteredLegs) || 0);
        const visible = Math.max(0, Number(visibleLegs) || 0);
        const total = filtered + visible;
        if (!total) {
            return {
                label: 'No flow legs',
                detail: 'No returned transfer legs are visible yet.'
            };
        }
        const percent = Math.round((filtered / total) * 100);
        return {
            label: filtered ? `${percent}% hidden` : 'No hidden legs',
            detail: filtered ? `${filtered} of ${total} normalized legs were removed as infrastructure/noise.` : 'All normalized legs remain visible under the noise filter.'
        };
    }

    function getWalletDepthOpportunity() {
        if (state.dataMode !== DATA_MODES.WALLET || state.walletLookup.graphDepth > 1 || !state.walletLookup.lastRawDataset || !state.walletLookup.lastWallet) return null;
        const oneHop = filterWalletLookupDataset(state.walletLookup.lastRawDataset, state.walletLookup.lastWallet, 1);
        const twoHop = filterWalletLookupDataset(state.walletLookup.lastRawDataset, state.walletLookup.lastWallet, 2);
        const additionalFlows = Math.max(0, (twoHop.transactions || []).length - (oneHop.transactions || []).length);
        const additionalWallets = Math.max(0, (twoHop.wallets || []).length - (oneHop.wallets || []).length);
        if (!additionalFlows && !additionalWallets) return null;
        return {
            useful: true,
            detail: `2-hop can add ${additionalWallets} wallet${additionalWallets === 1 ? '' : 's'} and ${additionalFlows} flow${additionalFlows === 1 ? '' : 's'} after filtering.`
        };
    }

    function buildWalletTimelineFlows(edges = []) {
        return edges
            .slice()
            .sort((a, b) => compareTimelineFlows(a, b))
            .slice(0, WALLET_INTELLIGENCE_LIMITS.timeline);
    }

    function compareTimelineFlows(a, b) {
        const aTime = timestampValue(a.timestamp);
        const bTime = timestampValue(b.timestamp);
        if (aTime || bTime) return bTime - aTime || (b.usd_value || 0) - (a.usd_value || 0);
        return (b.usd_value || 0) - (a.usd_value || 0) || getFlowGraphOrder(a) - getFlowGraphOrder(b);
    }

    function getWalletFilteredLegCount(metadata = {}) {
        const explicit = Number(metadata.wallet_lookup_noise_removed);
        if (Number.isFinite(explicit)) return Math.max(0, explicit);
        const rawCount = Number(state.walletLookup.lastRawDataset?.transactions?.length);
        if (Number.isFinite(rawCount)) return Math.max(0, rawCount - (state.graph?.flowEdges?.length || 0));
        return 0;
    }

    function buildWalletTokenFlowSummary(edges = []) {
        const byToken = new Map();
        edges.forEach(edge => {
            const symbol = String(edge.symbol || shortLongValue(edge.token_mint) || 'Token').trim() || 'Token';
            const key = `${edge.token_mint || ''}|${symbol}`;
            const current = byToken.get(key) || {
                symbol,
                mint: edge.token_mint || '',
                inbound: 0,
                outbound: 0,
                mixed: 0,
                totalAmount: 0,
                amountAvailable: false,
                totalUsd: 0,
                count: 0
            };
            const direction = getEdgeDirection(edge);
            if (direction === 'inbound') current.inbound += 1;
            else if (direction === 'outbound') current.outbound += 1;
            else current.mixed += 1;
            const amount = Number(edge.amount);
            if (Number.isFinite(amount) && amount > 0) {
                current.totalAmount += amount;
                current.amountAvailable = true;
            }
            current.totalUsd += Math.max(0, Number(edge.usd_value) || 0);
            current.count += 1;
            byToken.set(key, current);
        });

        return [...byToken.values()]
            .sort((a, b) => b.totalUsd - a.totalUsd || b.count - a.count || a.symbol.localeCompare(b.symbol));
    }

    function buildWalletCounterpartyRanking(edges = [], trackedWallet = '') {
        const tracked = core.normalizeAddress(trackedWallet);
        const latestTimestamp = Math.max(0, ...edges.map(edge => timestampValue(edge.timestamp)));
        const byAddress = new Map();

        edges.forEach(edge => {
            const source = core.normalizeAddress(edge.source_wallet);
            const target = core.normalizeAddress(edge.destination_wallet);
            if (!source || !target) return;

            if (source && source !== tracked) {
                addCounterpartyInteraction(byAddress, source, getCounterpartyDirection(source, source, target, tracked), edge, latestTimestamp);
            }
            if (target && target !== tracked && target !== source) {
                addCounterpartyInteraction(byAddress, target, getCounterpartyDirection(target, source, target, tracked), edge, latestTimestamp);
            }
        });

        return [...byAddress.values()]
            .map(item => ({
                ...item,
                relationship: getCounterpartyRelationshipLabel(item),
                tokens: [...item.tokens].sort()
            }))
            .sort((a, b) => b.score - a.score || b.count - a.count || a.address.localeCompare(b.address));
    }

    function addCounterpartyInteraction(byAddress, address, direction, edge, latestTimestamp) {
        const current = byAddress.get(address) || {
            address,
            inbound: 0,
            outbound: 0,
            mixed: 0,
            count: 0,
            totalUsd: 0,
            latestTimestamp: 0,
            tokens: new Set(),
            score: 0
        };
        if (direction === 'inbound') current.inbound += 1;
        else if (direction === 'outbound') current.outbound += 1;
        else current.mixed += 1;
        current.count += 1;
        current.totalUsd += Math.max(0, Number(edge.usd_value) || 0);
        current.latestTimestamp = Math.max(current.latestTimestamp, timestampValue(edge.timestamp));
        if (edge.symbol || edge.token_mint) current.tokens.add(edge.symbol || shortLongValue(edge.token_mint));
        const recencyScore = latestTimestamp > 0 && current.latestTimestamp > 0 ? current.latestTimestamp / latestTimestamp : 0;
        current.score = current.count * 100
            + Math.log10(current.totalUsd + 1) * 28
            + recencyScore * 18;
        byAddress.set(address, current);
    }

    function getCounterpartyDirection(address, source, target, tracked) {
        if (!tracked) return 'mixed';
        if (source === tracked && target === address) return 'outbound';
        if (target === tracked && source === address) return 'inbound';
        return 'mixed';
    }

    function getCounterpartyRelationshipLabel(item = {}) {
        const hasInbound = item.inbound > 0;
        const hasOutbound = item.outbound > 0;
        if ((hasInbound && hasOutbound) || item.mixed > 0) return 'Mixed wallet flow';
        if (hasInbound) return 'Sent to tracked wallet';
        if (hasOutbound) return 'Received from tracked wallet';
        return 'Wallet flow observed';
    }

    function getTopTokenLabel(tokens = [], direction) {
        const ranked = tokens
            .filter(item => Number(item[direction]) > 0)
            .sort((a, b) => (b[direction] || 0) - (a[direction] || 0) || b.totalUsd - a.totalUsd || a.symbol.localeCompare(b.symbol));
        if (!ranked.length) return '-';
        const top = ranked[0];
        const value = top.totalUsd > 0 ? ` / ${core.formatUsd(top.totalUsd)}` : '';
        const label = direction === 'inbound' ? 'received' : 'sent';
        return `${top.symbol} (${top[direction]} ${label} leg${top[direction] === 1 ? '' : 's'}${value})`;
    }

    function getLargestVisibleFlow(edges = []) {
        if (!edges.length) return null;
        const largestByUsd = [...edges].sort((a, b) => (b.usd_value || 0) - (a.usd_value || 0))[0];
        if ((largestByUsd.usd_value || 0) > 0) return largestByUsd;
        return [...edges].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0] || null;
    }

    function getLargestVisibleFlowLabel(edges = [], knownLargest = null) {
        if (!edges.length && !knownLargest) return '-';
        const largestByUsd = knownLargest || getLargestVisibleFlow(edges);
        if (!largestByUsd) return '-';
        if ((largestByUsd.usd_value || 0) > 0) {
            return `${largestByUsd.symbol || 'Token'} ${core.formatUsd(largestByUsd.usd_value)}`;
        }
        return formatFlowAmountLabel(largestByUsd) || '-';
    }

    function formatFlowAmountLabel(edge = {}) {
        const symbol = String(edge.symbol || '').trim();
        const amount = String(edge.amount_display || core.formatTokenAmount?.(edge.amount, symbol) || '').trim();
        if (!amount) return symbol;
        if (!symbol) return amount;
        return amount.toLowerCase().includes(symbol.toLowerCase()) ? amount : `${symbol} ${amount}`;
    }

    function getNormalizedFlowAmountDisplay(edge = {}) {
        const symbol = String(edge.symbol || '').trim();
        const amount = String(edge.amount_display || core.formatTokenAmount?.(edge.amount, symbol) || '').trim();
        return amount || symbol || '-';
    }

    function getFlowSourceAddress(edge = {}) {
        const node = state.graph?.nodeById.get(edge.source);
        return edge.source_wallet || node?.address || edge.source || '';
    }

    function getFlowTargetAddress(edge = {}) {
        const node = state.graph?.nodeById.get(edge.target);
        return edge.destination_wallet || node?.address || edge.target || '';
    }

    function getFlowTimelineTimeLabel(edge = {}, index = 0) {
        if (edge.timestamp) return formatDateTime(edge.timestamp);
        const order = getFlowGraphOrder(edge);
        return `Order #${Number.isFinite(order) ? order + 1 : index + 1}`;
    }

    function getFlowGraphOrder(edge = {}) {
        return (state.graph?.flowEdges || []).findIndex(item => item.id === edge.id);
    }

    function formatFlowDirection(direction) {
        if (direction === 'inbound') return 'Inbound';
        if (direction === 'outbound') return 'Outbound';
        return 'Mixed';
    }

    function formatFlowDirectionRelativeToTracked(edge = {}) {
        const direction = getEdgeDirection(edge);
        if (direction === 'inbound') return 'Inbound to tracked wallet';
        if (direction === 'outbound') return 'Outbound from tracked wallet';
        return getRelationshipWallet() ? 'Mixed / not directly tracked' : 'Mixed / no tracked wallet metadata';
    }

    function getMostRepeatedCounterpartyLabel(counterparties = []) {
        const repeated = [...counterparties].sort((a, b) => b.count - a.count || b.totalUsd - a.totalUsd)[0];
        if (!repeated) return '-';
        return `${shortLongValue(repeated.address)} (${repeated.count}x)`;
    }

    function getWalletLookupEmptyState(intelligence = buildWalletIntelligence()) {
        return getWalletLookupEmptyStateDetails(intelligence)?.body || '';
    }

    function getWalletLookupEmptyStateDetails(intelligence = buildWalletIntelligence()) {
        if (state.walletLookup.inFlight) return '';
        if (!state.walletLookup.lastWallet && !state.walletLookup.eventCount) {
            return {
                title: 'No Wallet Loaded',
                body: 'Enter a wallet address to request sanitized recent activity from the secure Worker. The graph will stay empty until a response is loaded, so no relationships are implied.',
                tone: 'info'
            };
        }
        if (state.walletLookup.lastWallet && state.walletLookup.eventCount === 0 && state.walletLookup.lastLoadedAt) {
            return {
                title: 'No Recent Activity Returned',
                body: 'The secure Worker completed the lookup and returned no recent sanitized transfer activity for this wallet address. No wallet/address relationships are shown because none were returned.',
                tone: 'warn'
            };
        }
        if (state.walletLookup.eventCount > 0 && intelligence.visibleLegs === 0) {
            return {
                title: 'Activity Filtered Out',
                body: 'Recent activity was returned, but no transfer legs remain visible after infrastructure/program-like accounts and active flow filters were removed. This prevents noise from looking like a wallet relationship.',
                tone: 'warn'
            };
        }
        return '';
    }

    function getWalletDepthExpansionNote() {
        if (state.dataMode !== DATA_MODES.WALLET || state.walletLookup.graphDepth <= 1 || !state.walletLookup.lastRawDataset || !state.walletLookup.lastWallet) return '';
        const oneHop = filterWalletLookupDataset(state.walletLookup.lastRawDataset, state.walletLookup.lastWallet, 1);
        const twoHop = filterWalletLookupDataset(state.walletLookup.lastRawDataset, state.walletLookup.lastWallet, 2);
        if ((twoHop.transactions || []).length <= (oneHop.transactions || []).length
            && (twoHop.wallets || []).length <= (oneHop.wallets || []).length) {
            return '2-hop is active, but no additional meaningful wallet nodes survived the noise filter.';
        }
        return '';
    }

    function renderFlowQueueStatus() {
        const orderedCount = state.graph?.flowQueue?.ordered_flow_ids?.length
            || state.graph?.flowReplay?.ordered_flow_ids?.length
            || 0;
        const sourceLabel = getCurrentSourceLabel();
        const motionLabel = state.flowMotion.enabled ? 'Motion: On' : 'Motion: Off';
        const queueLabel = state.flowReplay.playing ? 'Pause Flow Queue' : 'Play Flow Queue';
        const liveLabel = state.dataMode === DATA_MODES.LIVE ? 'Live Feed Active' : 'Switch to Live Feed';
        const liveStatus = getLiveStatusLabel();
        return `
            <div class="crypto-control-group rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">PLAYBACK / MOTION</div>
                        <div class="text-white/66">${escapeHtml(orderedCount)} ordered flows / ${escapeHtml(motionLabel)} / Source: ${escapeHtml(sourceLabel)} / ${escapeHtml(liveStatus)}</div>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        <button id="crypto-live-mode-toggle" type="button" aria-pressed="${state.live.enabled ? 'true' : 'false'}" title="Switch to the sanitized Worker event feed. No browser provider calls are made." class="rounded-full border ${state.live.enabled ? 'border-emerald-200/35 bg-emerald-300/15 text-emerald-50/86' : 'border-cyan-200/15 bg-cyan-300/10 text-cyan-50/78'} px-2.5 py-1 hover:border-cyan-100/35">${escapeHtml(liveLabel)}</button>
                        <button id="crypto-flow-queue-toggle" type="button" title="Play or pause the ordered transfer-flow replay queue." class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">${escapeHtml(queueLabel)}</button>
                        <button id="crypto-flow-queue-step" type="button" title="Advance the queue by one visible flow." class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">Step Flow</button>
                        <button id="crypto-flow-motion-toggle" type="button" title="Turn animated flow pulses on or off without changing graph data." class="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2.5 py-1 text-cyan-50/78 hover:border-cyan-100/35">${escapeHtml(motionLabel)}</button>
                    </div>
                </div>
                ${renderControlHelp('Advanced controls for replaying ordered transfer legs. Play Flow Queue animates the queue, Step Flow advances once, and Motion only changes animation.')}
            </div>
        `;
    }

    function renderFlowFilters() {
        if (!state.graph) return '';
        const typeOptions = buildTransactionTypeOptions();
        const tokenOptions = buildTokenFilterOptions();
        const current = state.filters;
        return `
            <div class="crypto-control-group rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
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
                ${renderControlHelp('Filters hide transfer legs by type, token, or direction. They do not reload data or change the underlying Worker or fixture response.')}
            </div>
        `;
    }

    function renderControlHelp(message) {
        return `<div class="control-help mt-2">${escapeHtml(message)}</div>`;
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
        status.querySelectorAll('[data-crypto-mode]').forEach(button => {
            button.addEventListener('click', () => {
                switchDataMode(button.dataset.cryptoMode);
            });
        });
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
        status.querySelector('#crypto-wallet-lookup-refresh')?.addEventListener('click', () => {
            loadWalletActivity(state.walletLookup.lastWallet || state.walletLookup.walletInput || status.querySelector('#crypto-wallet-lookup-input')?.value || '', { refresh: true });
        });
        status.querySelector('#crypto-wallet-depth-toggle')?.addEventListener('change', event => {
            setWalletLookupDepth(event.target.checked ? 2 : 1);
        });
        status.querySelector('#crypto-live-mode-toggle')?.addEventListener('click', () => {
            setLiveModeEnabled(state.dataMode !== DATA_MODES.LIVE);
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
        status.querySelectorAll('[data-crypto-flow-id]').forEach(button => {
            button.addEventListener('click', () => {
                selectFlow(button.dataset.cryptoFlowId || '');
            });
        });
        status.querySelectorAll('[data-crypto-wallet-address]').forEach(button => {
            button.addEventListener('click', () => {
                selectWalletAddress(button.dataset.cryptoWalletAddress || '');
            });
        });
        status.querySelectorAll('[data-crypto-token-filter]').forEach(button => {
            button.addEventListener('click', () => {
                setTokenFilter(button.dataset.cryptoTokenFilter || 'all');
            });
        });
        status.querySelectorAll('[data-crypto-depth]').forEach(button => {
            button.addEventListener('click', () => {
                setWalletLookupDepth(Number(button.dataset.cryptoDepth) || 1);
            });
        });
        status.querySelector('#crypto-filter-transaction-type')?.addEventListener('change', event => {
            state.filters.transactionType = event.target.value || 'all';
            syncSelectedFlowWithFilters();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
        status.querySelector('#crypto-filter-token')?.addEventListener('change', event => {
            state.filters.token = event.target.value || 'all';
            syncSelectedFlowWithFilters();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
        status.querySelector('#crypto-filter-direction')?.addEventListener('change', event => {
            state.filters.direction = event.target.value || 'all';
            syncSelectedFlowWithFilters();
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            updateStats();
            render();
            renderDetails();
        });
    }

    async function switchDataMode(mode) {
        if (!Object.values(DATA_MODES).includes(mode)) return state.dataMode;
        if (mode === state.dataMode) {
            if (mode === DATA_MODES.LIVE && state.live.enabled) pollWorkerFeed({ animateNew: false });
            return state.dataMode;
        }

        resetFlowQueueState();
        state.dataMode = mode;
        state.modeVersion += 1;
        const requestModeVersion = state.modeVersion;

        if (mode === DATA_MODES.GENERATED) {
            state.live.enabled = false;
            stopLivePolling();
            applyEmptyModeDataset(DATA_MODES.GENERATED);
            const dataset = await loadSampleDataset();
            if (state.dataMode !== DATA_MODES.GENERATED || requestModeVersion !== state.modeVersion) return state.dataMode;
            applyDataset(dataset);
            return state.dataMode;
        }

        if (mode === DATA_MODES.WALLET) {
            const walletValue = state.walletLookup.walletInput || state.walletLookup.lastWallet || '';
            resetWalletLookupState();
            state.walletLookup.walletInput = walletValue;
            applyEmptyModeDataset(DATA_MODES.WALLET, {
                wallet: walletValue
            });
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return state.dataMode;
        }

        resetLiveMergeState();
        applyEmptyModeDataset(DATA_MODES.LIVE);
        if (!state.live.endpointValid) {
            state.live.enabled = false;
            state.live.workerAvailable = false;
            state.live.lastError = 'Worker feed endpoint unavailable';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return state.dataMode;
        }

        state.live.enabled = true;
        updateLivePolling();
        pollWorkerFeed({ animateNew: false });
        return state.dataMode;
    }

    async function switchGeneratedFixture(path) {
        if (!isSafeGeneratedFixturePath(path) || (path === state.datasetSource && state.dataMode === DATA_MODES.GENERATED)) return;
        state.dataMode = DATA_MODES.GENERATED;
        state.modeVersion += 1;
        const requestModeVersion = state.modeVersion;
        resetFlowQueueState();
        applyEmptyModeDataset(DATA_MODES.GENERATED);
        const dataset = await loadSampleDataset({ generatedFixturePath: path });
        if (state.dataMode !== DATA_MODES.GENERATED || requestModeVersion !== state.modeVersion) return;
        applyDataset(dataset);
    }

    async function loadWalletActivity(wallet, options = {}) {
        const normalizedWallet = String(wallet || '').trim();
        state.walletLookup.walletInput = normalizedWallet;
        if (!isValidSolanaWalletAddress(normalizedWallet)) {
            state.walletLookup.lastError = 'Enter a valid Solana wallet address';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        }

        state.dataMode = DATA_MODES.WALLET;
        state.modeVersion += 1;
        state.live.enabled = false;
        stopLivePolling();
        resetFlowQueueState();
        state.walletLookup.eventCount = 0;
        state.walletLookup.mergedEventCount = 0;
        state.walletLookup.lastRawDataset = null;
        applyEmptyModeDataset(DATA_MODES.WALLET, { wallet: normalizedWallet }, {
            preserveWalletInput: true
        });

        const endpoint = resolveWalletLookupEndpoint();
        if (!endpoint) {
            state.walletLookup.lastError = 'Worker wallet lookup endpoint unavailable';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        }

        state.walletLookup.inFlight = true;
        state.walletLookup.lastError = '';
        const requestModeVersion = state.modeVersion;
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });

        try {
            const separator = endpoint.includes('?') ? '&' : '?';
            const response = await fetch(`${endpoint}${separator}wallet=${encodeURIComponent(normalizedWallet)}&limit=10`, {
                cache: 'no-store',
                headers: { accept: 'application/json' }
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(response.status === 404
                    ? 'Worker wallet endpoint not configured for this host.'
                    : payload?.message || `Worker wallet lookup returned ${response.status}`);
            }

            const events = Array.isArray(payload?.events) ? payload.events : [];
            if (state.dataMode !== DATA_MODES.WALLET || requestModeVersion !== state.modeVersion) return null;
            const rawDataset = convertWorkerEventsToDataset(events, {
                trackedWallet: normalizedWallet,
                sourceKind: 'wallet_lookup'
            });
            const walletDataset = filterWalletLookupDataset(rawDataset, normalizedWallet, state.walletLookup.graphDepth);
            applyWalletLookupDataset(walletDataset, normalizedWallet);
            state.walletLookup.lastWallet = normalizedWallet;
            state.walletLookup.lastLoadedAt = Date.now();
            state.walletLookup.eventCount = events.length;
            state.walletLookup.mergedEventCount = walletDataset.transactions.length;
            state.walletLookup.lastRawDataset = rawDataset;
            state.walletLookup.lastError = events.length && walletDataset.transactions.length
                ? ''
                : events.length
                    ? 'Recent activity was filtered to remove program/noise accounts'
                    : 'No recent sanitized activity returned';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return {
                events: events.length,
                transactions: walletDataset.transactions.length,
                refreshed: Boolean(options.refresh)
            };
        } catch (error) {
            if (requestModeVersion === state.modeVersion && state.dataMode === DATA_MODES.WALLET) {
                state.walletLookup.lastError = error?.message || 'Worker wallet lookup unavailable';
                renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            }
            return null;
        } finally {
            if (requestModeVersion === state.modeVersion) {
                state.walletLookup.inFlight = false;
                renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            }
        }
    }

    function applyWalletLookupDataset(dataset = {}, trackedWallet = '') {
        state.datasetSource = 'worker_wallet_lookup';
        state.datasetSourceKind = 'worker_wallet_lookup';
        state.dataMode = DATA_MODES.WALLET;
        state.dataset = cloneDataset(dataset);
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.graph.flowReplayEnabled = true;
        state.graph.flowQueueEnabled = true;
        if (state.graph.flowReplay) {
            state.graph.flowReplay.enabled = true;
            state.graph.flowReplay.mode = 'wallet_lookup_replacement_queue';
            state.graph.flowReplay.future_note = 'Wallet lookup replaces the active dataset instead of merging with fixtures.';
        }
        if (state.graph.flowQueue) {
            state.graph.flowQueue.enabled = true;
            state.graph.flowQueue.mode = 'wallet_lookup_replacement_queue';
        }
        state.flowReplayEnabled = true;
        state.filters = { transactionType: 'all', token: 'all', direction: 'all' };
        state.selectedFlowId = null;
        state.manualNodePositions.clear();
        resetFlowQueueState();
        applyWalletLookupFocusLayout();
        prepareFlowMotion();
        rebuildInteractionIndex();
        const trackedNodeId = getWalletNodeIdForAddress(trackedWallet);
        state.selectedId = trackedNodeId || state.graph.walletNodes?.[0]?.id || state.graph.nodes[0]?.id || null;
        updateStats();
        resizeAndRender();
        renderDetails();
        updateFlowAnimationLoop();
    }

    function filterWalletLookupDataset(dataset = {}, trackedWallet = '', depth = 1) {
        const normalized = core.normalizeDataset(dataset);
        const tracked = core.normalizeAddress(trackedWallet || normalized.metadata?.wallet || normalized.metadata?.wallet_lookup_tracked_wallet || '');
        const maxDepth = depth > 1 ? 2 : 1;
        const meaningfulTransactions = normalized.transactions.filter(transaction => {
            if (!transaction.source_wallet || !transaction.destination_wallet) return false;
            if (isNoiseWalletAddress(transaction.source_wallet, tracked)) return false;
            if (isNoiseWalletAddress(transaction.destination_wallet, tracked)) return false;
            if (isProgramLikeTransaction(transaction, tracked)) return false;
            return true;
        });

        const degree = buildAddressDegreeMap(meaningfulTransactions);
        const degreeFilteredTransactions = meaningfulTransactions.filter(transaction => {
            return !isHighConnectionNoise(transaction.source_wallet, tracked, degree)
                && !isHighConnectionNoise(transaction.destination_wallet, tracked, degree);
        });
        const distances = buildWalletDistances(degreeFilteredTransactions, tracked, maxDepth);
        const scopedTransactions = degreeFilteredTransactions.filter(transaction => {
            const sourceDepth = distances.get(core.normalizeAddress(transaction.source_wallet));
            const targetDepth = distances.get(core.normalizeAddress(transaction.destination_wallet));
            if (!Number.isFinite(sourceDepth) || !Number.isFinite(targetDepth)) return false;
            if (maxDepth <= 1) return sourceDepth === 0 || targetDepth === 0;
            return Math.min(sourceDepth, targetDepth) < maxDepth && Math.max(sourceDepth, targetDepth) <= maxDepth;
        });

        const usedWallets = new Set([tracked].filter(Boolean));
        const usedTokens = new Set();
        const usedHashes = new Set();
        scopedTransactions.forEach(transaction => {
            usedWallets.add(core.normalizeAddress(transaction.source_wallet));
            usedWallets.add(core.normalizeAddress(transaction.destination_wallet));
            if (transaction.token_mint) usedTokens.add(core.normalizeAddress(transaction.token_mint));
            if (transaction.transaction_hash) usedHashes.add(transaction.transaction_hash);
        });

        const walletByAddress = new Map(normalized.wallets.map(wallet => [core.normalizeAddress(wallet.address), wallet]));
        if (tracked && !walletByAddress.has(tracked)) {
            walletByAddress.set(tracked, {
                address: tracked,
                chain: 'solana',
                label: 'Tracked Wallet',
                label_source: 'wallet_lookup_input',
                confidence: 0.9,
                metadata: { wallet_lookup: true }
            });
        }

        return {
            metadata: {
                ...(normalized.metadata || {}),
                source: 'wallet_lookup_live_pull',
                source_label: SOURCE_LABELS.worker_wallet_lookup,
                wallet: tracked,
                wallet_lookup_mode: true,
                wallet_lookup_tracked_wallet: tracked,
                wallet_lookup_depth: maxDepth,
                wallet_lookup_filtered_transactions: scopedTransactions.length,
                wallet_lookup_noise_removed: Math.max(0, normalized.transactions.length - scopedTransactions.length),
                wallet_lookup_noise_filtered: true,
                wallet_lookup_replacement_mode: true,
                wallet_lookup_fixture_merge: false,
                worker_response_secure: true,
                live_blockchain_fetching: false,
                production_meaning: false,
                sanitized: true
            },
            wallets: [...usedWallets]
                .map(address => walletByAddress.get(address) || {
                    address,
                    chain: 'solana',
                    label: core.shortAddress(address),
                    label_source: 'wallet_lookup_transfer',
                    confidence: 0.72,
                    metadata: { wallet_lookup: true }
                })
                .filter(wallet => wallet.address),
            tokens: normalized.tokens.filter(token => usedTokens.has(core.normalizeAddress(token.token_mint))),
            entities: [],
            transactions: scopedTransactions.map(transaction => ({
                ...transaction,
                label_source: transaction.label_source || 'wallet_lookup',
                tracked_wallet_role: transaction.tracked_wallet_role || getTrackedWalletRole(tracked, transaction.source_wallet, transaction.destination_wallet),
                direction: transaction.direction || getTransactionDirectionForWallet(transaction, tracked),
                metadata: {
                    ...(transaction.metadata || {}),
                    wallet_lookup: true,
                    tracked_wallet: tracked,
                    tracked_wallet_role: transaction.tracked_wallet_role || getTrackedWalletRole(tracked, transaction.source_wallet, transaction.destination_wallet),
                    direction: transaction.direction || getTransactionDirectionForWallet(transaction, tracked)
                }
            })),
            transaction_groups: normalized.transaction_groups.filter(group => usedHashes.has(group.signature || group.transaction_hash))
        };
    }

    function setWalletLookupDepth(depth) {
        state.walletLookup.graphDepth = depth > 1 ? 2 : 1;
        if (state.dataMode !== DATA_MODES.WALLET || !state.walletLookup.lastRawDataset || !state.walletLookup.lastWallet) {
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return state.walletLookup.graphDepth;
        }

        const dataset = filterWalletLookupDataset(
            state.walletLookup.lastRawDataset,
            state.walletLookup.lastWallet,
            state.walletLookup.graphDepth
        );
        applyWalletLookupDataset(dataset, state.walletLookup.lastWallet);
        state.walletLookup.mergedEventCount = dataset.transactions.length;
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        return state.walletLookup.graphDepth;
    }

    function buildAddressDegreeMap(transactions = []) {
        const neighbors = new Map();
        transactions.forEach(transaction => {
            const source = core.normalizeAddress(transaction.source_wallet);
            const target = core.normalizeAddress(transaction.destination_wallet);
            if (!source || !target || source === target) return;
            if (!neighbors.has(source)) neighbors.set(source, new Set());
            if (!neighbors.has(target)) neighbors.set(target, new Set());
            neighbors.get(source).add(target);
            neighbors.get(target).add(source);
        });
        return new Map([...neighbors.entries()].map(([address, links]) => [address, links.size]));
    }

    function buildWalletDistances(transactions = [], trackedWallet = '', maxDepth = 1) {
        const tracked = core.normalizeAddress(trackedWallet);
        const distances = new Map();
        if (!tracked) return distances;

        const adjacency = new Map();
        transactions.forEach(transaction => {
            const source = core.normalizeAddress(transaction.source_wallet);
            const target = core.normalizeAddress(transaction.destination_wallet);
            if (!source || !target) return;
            if (!adjacency.has(source)) adjacency.set(source, new Set());
            if (!adjacency.has(target)) adjacency.set(target, new Set());
            adjacency.get(source).add(target);
            adjacency.get(target).add(source);
        });

        distances.set(tracked, 0);
        const queue = [tracked];
        while (queue.length) {
            const current = queue.shift();
            const distance = distances.get(current) || 0;
            if (distance >= maxDepth) continue;
            (adjacency.get(current) || []).forEach(next => {
                if (distances.has(next)) return;
                distances.set(next, distance + 1);
                queue.push(next);
            });
        }
        return distances;
    }

    function isHighConnectionNoise(address, trackedWallet, degree) {
        const normalized = core.normalizeAddress(address);
        return normalized !== core.normalizeAddress(trackedWallet) && (degree.get(normalized) || 0) > 15;
    }

    function isNoiseWalletAddress(address, trackedWallet = '') {
        const normalized = core.normalizeAddress(address);
        if (!normalized || normalized === core.normalizeAddress(trackedWallet)) return false;
        return NOISE_ADDRESS_PREFIXES.some(prefix => normalized.startsWith(prefix));
    }

    function isProgramLikeTransaction(transaction = {}, trackedWallet = '') {
        const source = core.normalizeAddress(transaction.source_wallet);
        const target = core.normalizeAddress(transaction.destination_wallet);
        if (source === core.normalizeAddress(trackedWallet) || target === core.normalizeAddress(trackedWallet)) {
            return false;
        }
        const programText = [
            transaction.source_program,
            transaction.source_label,
            transaction.label_source,
            transaction.metadata?.source_program,
            transaction.metadata?.program_id,
            transaction.metadata?.program,
            transaction.metadata?.role
        ].join(' ').toLowerCase();
        return /\b(program|sysvar|computebudget|tokenkeg)\b/.test(programText)
            && (isNoiseWalletAddress(source, trackedWallet) || isNoiseWalletAddress(target, trackedWallet));
    }

    function getTrackedWalletRole(trackedWallet = '', sourceWallet = '', destinationWallet = '') {
        const tracked = core.normalizeAddress(trackedWallet);
        if (!tracked) return '';
        const source = core.normalizeAddress(sourceWallet);
        const destination = core.normalizeAddress(destinationWallet);
        if (source === tracked && destination === tracked) return 'internal_mixed';
        if (source === tracked) return 'source';
        if (destination === tracked) return 'destination';
        return '';
    }

    function getTransactionDirectionForWallet(transaction = {}, trackedWallet = '') {
        const role = getTrackedWalletRole(trackedWallet, transaction.source_wallet, transaction.destination_wallet);
        if (role === 'source') return 'outbound';
        if (role === 'destination') return 'inbound';
        if (role === 'internal_mixed') return 'internal_mixed';
        return 'counterparty';
    }

    function resolveWalletLookupEndpoint() {
        const configuredValue = [
            window.CryptoPhotonicWorkerWalletActivityEndpoint,
            state.root?.dataset?.workerWalletActivityEndpoint
        ].find(value => typeof value === 'string' && value.trim());
        if (configuredValue) {
            const configuredEndpoint = resolveWorkerEndpoint({
                configuredValue,
                defaultEndpoint: DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT
            });
            return configuredEndpoint.valid ? configuredEndpoint.endpoint : '';
        }

        if (!state.live.endpointValid || !state.live.endpoint) return '';

        try {
            const parsed = state.live.endpoint.startsWith('/')
                ? new URL(state.live.endpoint, window.location.origin)
                : new URL(state.live.endpoint);
            if (!isSafeWorkerUrl(parsed, {
                expectedPath: DEFAULT_WORKER_FEED_ENDPOINT,
                allowExternal: true
            })) return '';
            parsed.pathname = parsed.pathname.slice(0, -DEFAULT_WORKER_FEED_ENDPOINT.length)
                + DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT;
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

    function applyEmptyModeDataset(mode, metadata = {}, options = {}) {
        const sourceKind = mode === DATA_MODES.LIVE ? 'worker_feed' : mode === DATA_MODES.WALLET ? 'worker_wallet_lookup' : 'generated';
        state.datasetSource = sourceKind;
        state.datasetSourceKind = sourceKind;
        if (mode !== DATA_MODES.LIVE) resetLiveMergeState();
        if (mode !== DATA_MODES.WALLET && !options.preserveWalletInput) resetWalletLookupState();
        applyDataset(createEmptyDataset(mode, metadata), {
            resetLive: false,
            resetWallet: false
        });
    }

    function createEmptyDataset(mode, metadata = {}) {
        const isWallet = mode === DATA_MODES.WALLET;
        const isLive = mode === DATA_MODES.LIVE;
        return {
            metadata: {
                name: isWallet ? 'CryptoPhotonic Wallet Lookup' : isLive ? 'CryptoPhotonic Worker Feed' : 'CryptoPhotonic Empty Fixture',
                environment: isLive || isWallet ? 'secure_runtime_feed' : 'sample',
                chain: 'solana',
                adapter: isLive || isWallet ? 'worker_event_feed' : 'local_fixture',
                source: isWallet ? 'wallet_lookup_live_pull' : isLive ? 'secure_runtime_feed' : 'generated_fixture',
                wallet: core.normalizeAddress(metadata.wallet || ''),
                wallet_lookup_mode: isWallet,
                wallet_lookup_tracked_wallet: isWallet ? core.normalizeAddress(metadata.wallet || '') : '',
                wallet_lookup_depth: state.walletLookup.graphDepth,
                wallet_lookup_noise_removed: 0,
                wallet_lookup_noise_filtered: isWallet,
                wallet_lookup_replacement_mode: isWallet,
                wallet_lookup_fixture_merge: false,
                worker_response_secure: isLive || isWallet,
                live_worker_feed_enabled: isLive,
                live_blockchain_fetching: false,
                production_meaning: false,
                sanitized: true
            },
            wallets: [],
            tokens: [],
            entities: [],
            transactions: [],
            transaction_groups: []
        };
    }

    function applyDataset(dataset = {}, options = {}) {
        state.dataset = cloneDataset(dataset);
        if (options.resetLive !== false) resetLiveMergeState();
        if (options.resetWallet !== false) resetWalletLookupState();
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        resetFlowQueueState();
        state.filters = { transactionType: 'all', token: 'all', direction: 'all' };
        state.selectedFlowId = null;
        state.manualNodePositions.clear();
        applyWalletLookupFocusLayout();
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
        applyWalletLookupFocusLayout();
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

    function selectFlow(flowId) {
        const edge = (state.graph?.flowEdges || []).find(item => item.id === flowId && edgeMatchesActiveFilters(item));
        if (!edge) return null;
        state.selectedFlowId = edge.id;
        state.selectedId = null;
        state.flowReplay.activeFlowId = edge.id;
        state.flowReplay.lastStepAt = performance.now();
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        render();
        renderDetails();
        updateFlowAnimationLoop();
        return edge;
    }

    function selectWalletAddress(address = '') {
        const node = getWalletNodeForAddress(address);
        if (!node) return null;
        state.selectedId = node.id;
        state.selectedFlowId = null;
        state.flowReplay.activeFlowId = null;
        render();
        renderDetails();
        return node;
    }

    function setTokenFilter(filterValue = 'all') {
        state.filters.token = filterValue || 'all';
        syncSelectedFlowWithFilters();
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        updateStats();
        render();
        renderDetails();
        return state.filters.token;
    }

    function syncSelectedFlowWithFilters() {
        if (!state.selectedFlowId) return;
        const edge = (state.graph?.flowEdges || []).find(item => item.id === state.selectedFlowId);
        if (!edge || !edgeMatchesActiveFilters(edge)) {
            state.selectedFlowId = null;
            state.flowReplay.activeFlowId = null;
        }
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
        const metadataWallet = core.normalizeAddress(state.graph?.metadata?.wallet_lookup_tracked_wallet || state.graph?.metadata?.generated_wallet || state.graph?.metadata?.wallet || '');
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
            drawWalletLookupEdgeLabel(ctx, edge, source, target, control, interaction);
        }
        ctx.restore();
    }

    function drawWalletLookupEdgeLabel(ctx, edge, source, target, control, interaction) {
        if (state.dataMode !== DATA_MODES.WALLET || edge.type !== core.EDGE_TYPES.FLOW) return;
        if (!shouldDrawWalletLookupEdgeLabel(edge, interaction)) return;
        const point = pointOnQuadratic(source, control, target, 0.5);
        const fromTo = `${shortLongValue(source.address || source.id)} \u2192 ${shortLongValue(target.address || target.id)}`;
        const amount = formatFlowAmountLabel(edge);
        const majorEdge = edge.is_large_value || interaction.connectedEdgeIds.has(edge.id) || interaction.replayActiveFlowId === edge.id || state.flowMotion.topFlowIds.has(edge.id);
        const tokenAmount = majorEdge ? amount : '';

        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.font = '700 10px Inter, sans-serif';
        const firstWidth = ctx.measureText(fromTo).width;
        ctx.font = '600 9px Inter, sans-serif';
        const secondWidth = tokenAmount ? ctx.measureText(tokenAmount).width : 0;
        const boxWidth = Math.max(firstWidth, secondWidth) + 14;
        const boxHeight = tokenAmount ? 32 : 20;
        roundedRectPath(ctx, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 8);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ecfeff';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.fillText(fromTo, 0, tokenAmount ? -6 : 0);
        if (tokenAmount) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.88)';
            ctx.font = '600 9px Inter, sans-serif';
            ctx.fillText(tokenAmount, 0, 8);
        }
        ctx.restore();
    }

    function shouldDrawWalletLookupEdgeLabel(edge, interaction) {
        if (interaction.connectedEdgeIds.has(edge.id) || interaction.replayActiveFlowId === edge.id) return true;
        const visible = getVisibleFlowEdges();
        if (visible.length <= 8) return true;
        return Boolean(edge.is_large_value || state.flowMotion.topFlowIds.has(edge.id));
    }

    function roundedRectPath(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
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
        const trackedWallet = isTrackedWalletNode(node);
        const radius = node.radius + (trackedWallet ? 7 : 0) + (selected ? 5 : hovered ? 3 : 0);
        const showLabel = shouldShowNodeLabel(node, { selected, hovered, connected, interaction });
        const labelAlpha = showLabel ? (muted ? 0.3 : 0.92) : 0;

        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = trackedWallet ? 42 : selected ? 30 : hovered ? 22 : connected ? 13 : 7;
        ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = trackedWallet ? '#ecfeff' : selected || hovered ? '#ffffff' : node.color;
        ctx.lineWidth = trackedWallet ? 4.2 : selected ? 3.4 : hovered ? 2.6 : connected ? 1.8 : 1.1;
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
        ctx.fillStyle = trackedWallet || selected || hovered ? '#ffffff' : 'rgba(226, 232, 240, 0.82)';
        ctx.font = trackedWallet ? '700 12px Inter, sans-serif' : isHubNode(node) ? '700 12px Inter, sans-serif' : node.type === core.NODE_TYPES.TOKEN ? '600 11px Inter, sans-serif' : '500 10px Inter, sans-serif';
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
        if (!screenPoint) return;
        if (event.pointerType === 'touch') {
            state.touchPointers.set(event.pointerId, screenPoint);
            state.canvas.setPointerCapture?.(event.pointerId);
            if (state.touchPointers.size >= 2) {
                beginPinchGesture();
                event.preventDefault();
                return;
            }
        }
        const worldPoint = screenToWorld(screenPoint);
        const node = getNodeAtWorldPoint(worldPoint);
        const edge = node ? null : getFlowEdgeAtWorldPoint(worldPoint);

        state.canvas.setPointerCapture?.(event.pointerId);
        state.drag = {
            pointerId: event.pointerId,
            mode: node ? 'node' : edge ? 'edge' : 'pan',
            nodeId: node?.id || null,
            edgeId: edge?.id || null,
            startScreen: screenPoint,
            lastScreen: screenPoint,
            startNode: node ? { x: node.x, y: node.y } : null,
            startViewport: { ...state.viewport },
            moved: false
        };
        state.canvas.style.cursor = 'grabbing';
        event.preventDefault();
    }

    function handleCanvasPointerMove(event) {
        if (!state.graph || !state.canvas) return;
        const screenPoint = getScreenPoint(event);
        if (!screenPoint) return;
        if (event.pointerType === 'touch' && state.touchPointers.has(event.pointerId)) {
            state.touchPointers.set(event.pointerId, screenPoint);
            if (state.pinch) {
                updatePinchGesture();
                event.preventDefault();
                return;
            }
        }

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
            event.preventDefault();
            return;
        }

        updateHoverFromScreenPoint(screenPoint);
    }

    function handleCanvasPointerUp(event) {
        if (!state.graph || !state.canvas) return;
        if (event.pointerType === 'touch' && endTouchPointer(event)) {
            event.preventDefault();
            return;
        }
        markFlowInteraction();
        const drag = state.drag;
        if (drag?.pointerId === event.pointerId) {
            state.canvas.releasePointerCapture?.(event.pointerId);
            state.drag = null;

            if (drag.mode === 'node' && !drag.moved && drag.nodeId) {
                state.selectedId = drag.nodeId;
                state.selectedFlowId = null;
                render();
                renderDetails();
            }
            if (drag.mode === 'edge' && !drag.moved && drag.edgeId) {
                selectFlow(drag.edgeId);
            }

            updateHoverFromScreenPoint(getScreenPoint(event));
            event.preventDefault();
            return;
        }

        updateHoverFromScreenPoint(getScreenPoint(event));
    }

    function handleCanvasPointerCancel(event) {
        if (!state.canvas) return;
        if (event?.pointerType === 'touch') {
            state.touchPointers.delete(event.pointerId);
            if (state.pinch && state.touchPointers.size < 2) endPinchGesture();
        }
        if (state.drag?.pointerId !== event.pointerId && !state.pinch) return;
        markFlowInteraction();
        state.canvas.releasePointerCapture?.(event.pointerId);
        state.drag = null;
        state.canvas.style.cursor = state.hoveredId ? 'grab' : 'grab';
    }

    function beginPinchGesture() {
        const metrics = getPinchMetrics();
        if (!metrics) return;
        markFlowInteraction();
        state.drag = null;
        state.pinch = {
            ids: metrics.ids,
            startDistance: metrics.distance,
            startScale: state.viewport.scale,
            startWorld: screenToWorld(metrics.midpoint)
        };
        state.canvas.style.cursor = 'grabbing';
    }

    function updatePinchGesture() {
        const metrics = getPinchMetrics(state.pinch?.ids);
        if (!metrics || !state.pinch?.startDistance) return;
        markFlowInteraction();
        const zoomRatio = metrics.distance / state.pinch.startDistance;
        const nextScale = clamp(state.pinch.startScale * zoomRatio, ZOOM_LIMITS.min, ZOOM_LIMITS.max);
        state.viewport.scale = nextScale;
        state.viewport.x = metrics.midpoint.x - state.pinch.startWorld.x * nextScale;
        state.viewport.y = metrics.midpoint.y - state.pinch.startWorld.y * nextScale;
        clampViewport();
        render();
    }

    function endTouchPointer(event) {
        const hadPointer = state.touchPointers.delete(event.pointerId);
        const wasPinching = Boolean(state.pinch);
        if (state.canvas?.hasPointerCapture?.(event.pointerId)) {
            state.canvas.releasePointerCapture(event.pointerId);
        }
        if (!wasPinching) return false;
        if (state.touchPointers.size >= 2) {
            beginPinchGesture();
        } else {
            endPinchGesture();
        }
        return hadPointer || wasPinching;
    }

    function endPinchGesture() {
        state.pinch = null;
        state.drag = null;
        if (state.canvas) state.canvas.style.cursor = 'grab';
        render();
    }

    function getPinchMetrics(preferredIds = null) {
        const ids = (preferredIds || [...state.touchPointers.keys()])
            .filter(id => state.touchPointers.has(id))
            .slice(0, 2);
        if (ids.length < 2) return null;
        const first = state.touchPointers.get(ids[0]);
        const second = state.touchPointers.get(ids[1]);
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        return {
            ids,
            distance,
            midpoint: {
                x: (first.x + second.x) / 2,
                y: (first.y + second.y) / 2
            }
        };
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
        const selectedFlow = getSelectedFlowEdge();
        if (selectedFlow) {
            state.detailPanel.innerHTML = renderSelectedFlowDetailPanel(selectedFlow);
            return;
        }

        const node = state.graph.nodeById.get(state.selectedId) || state.graph.nodes[0];
        if (!node) {
            state.detailPanel.innerHTML = state.dataMode === DATA_MODES.WALLET
                ? renderWalletLookupEmptyDetails()
                : '<div class="text-sm text-white/45">No crypto graph node selected.</div>';
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
        const primaryFlow = getPrimaryInspectorFlowForNode(node, displayedRelatedFlows);
        const contextCopy = state.dataMode === DATA_MODES.WALLET
            ? 'Secure Worker wallet lookup graph. Program and infrastructure-like accounts are filtered; address relationships are not identity claims.'
            : 'Local fixture graph. Source/program labels are hints from sanitized data, not identity claims.';
        state.detailPanel.innerHTML = `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">${escapeHtml(isHubNode(node) ? 'ENTITY HUB' : node.type.toUpperCase())} NODE</div>
            <h3 class="font-display text-2xl mt-1">${escapeHtml(labelForNode(node))}</h3>
            <div class="text-[11px] text-white/42 mt-2">${escapeHtml(contextCopy)}</div>
            ${state.dataMode === DATA_MODES.WALLET ? renderWalletDetailReadout() : ''}
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
            ${primaryFlow ? renderSelectedFlowInspector(primaryFlow, { title: 'Selected Flow Inspector', subtitle: 'Most relevant visible transfer leg connected to this selection.' }) : ''}
            ${isHubNode(node) ? `
                ${renderCardSection('Connected Wallets', connectedWallets, DETAIL_LIMITS.connectedWallets, renderNodeSummary, state.dataMode === DATA_MODES.WALLET ? 'No connected wallet lookup addresses.' : 'No connected sample wallets.')}
            ` : ''}
            ${renderCardSection('Direct Flows', displayedRelatedFlows, DETAIL_LIMITS.directFlows, edge => renderEdgeSummary(edge, node.id), state.dataMode === DATA_MODES.WALLET ? 'No visible wallet lookup transfer legs for this selection.' : 'No related sample flows.')}
            ${renderCardSection('Transaction Groups', relatedGroups, DETAIL_LIMITS.transactionGroups, renderTransactionGroupSummary, 'No transaction groups match this selection.')}
            ${renderCardSection('Token Exposure', relatedExposureEdges, DETAIL_LIMITS.tokenExposure, edge => renderEdgeSummary(edge, node.id), state.dataMode === DATA_MODES.WALLET ? 'No token exposure links for this wallet lookup node.' : 'No token exposure links for this sample node.')}
            ${renderCardSection('Multi-Hop Paths', relatedPaths, DETAIL_LIMITS.multiHopPaths, renderPathSummary, 'No multi-hop wallet paths include this node.')}
        `;
    }

    function renderSelectedFlowDetailPanel(edge) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        return `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">TRANSFER FLOW</div>
            <h3 class="font-display text-2xl mt-1">Selected Flow</h3>
            <div class="text-[11px] text-white/42 mt-2">Visible transfer leg from the current graph and active filters. This is an address-to-address observation, not an identity claim.</div>
            <section class="mt-5 rounded-2xl border border-cyan-200/16 bg-cyan-300/10 p-3">
                <div class="text-[10px] font-mono text-white/40">FLOW</div>
                <div class="mt-2 text-sm text-cyan-50/86 break-words" title="${escapeAttr(`${labelForNode(source)} -> ${labelForNode(target)}`)}">${escapeHtml(compactNodeLabel(source))} &rarr; ${escapeHtml(compactNodeLabel(target))}</div>
                <div class="mt-1 text-xs text-white/48">${escapeHtml(getNormalizedFlowAmountDisplay(edge))} / ${escapeHtml(edge.symbol || shortLongValue(edge.token_mint) || 'Token')}</div>
            </section>
            ${renderSelectedFlowInspector(edge, { title: 'Selected Flow Inspector', subtitle: 'Clicked visible transfer edge.' })}
            ${renderDetailSection('Selection Context', `
                ${detailRow('Source Node', compactNodeLabel(source))}
                ${detailRow('Destination Node', compactNodeLabel(target))}
                ${detailRow('Visible Under Filters', edgeMatchesActiveFilters(edge) ? 'Yes' : 'No')}
            `)}
        `;
    }

    function renderSelectedFlowInspector(edge, options = {}) {
        const title = options.title || 'Selected Flow Inspector';
        const subtitle = options.subtitle || 'Explains the selected visible transfer leg, including normalized amount, token, direction, source, and timestamp.';
        const sourceAddress = getFlowSourceAddress(edge);
        const targetAddress = getFlowTargetAddress(edge);
        const sourceNode = state.graph.nodeById.get(edge.source);
        const targetNode = state.graph.nodeById.get(edge.target);
        const tokenLabel = edge.token_mint
            ? `${edge.symbol || 'Token'} / ${shortLongValue(edge.token_mint)}`
            : edge.symbol || 'Token';
        const sourceLabel = edge.source_label || edge.source_program || edge.label_source || '-';
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div class="text-[10px] font-mono tracking-[1.3px] text-white/45">${escapeHtml(title)}</div>
                    ${edge.transaction_hash ? `<div class="text-[10px] font-mono text-white/34">${escapeHtml(shortHash(edge.transaction_hash))}</div>` : ''}
                </div>
                ${subtitle ? `<div class="mb-2 text-[11px] text-white/42">${escapeHtml(subtitle)}</div>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-white/68">
                    ${detailRow('Normalized Amount', getNormalizedFlowAmountDisplay(edge))}
                    ${detailRow('USD Value', edge.usd_value ? core.formatUsd(edge.usd_value) : '-')}
                    ${detailRow('Source Wallet', sourceAddress || compactNodeLabel(sourceNode), { shorten: true })}
                    ${detailRow('Destination Wallet', targetAddress || compactNodeLabel(targetNode), { shorten: true })}
                    ${detailRow('Token / Mint', tokenLabel, { shorten: Boolean(edge.token_mint) })}
                    ${detailRow('Direction vs Tracked', formatFlowDirectionRelativeToTracked(edge))}
                    ${detailRow('Transaction Type', edge.transaction_type_label || core.interpretTransactionType?.(edge.transaction_type).label || 'Unknown / Unclassified')}
                    ${detailRow('Source Label', sourceLabel)}
                    ${detailRow('Timestamp', edge.timestamp ? formatDateTime(edge.timestamp) : '-')}
                </div>
            </section>
        `;
    }

    function getSelectedFlowEdge() {
        if (!state.selectedFlowId) return null;
        return (state.graph?.flowEdges || []).find(edge => edge.id === state.selectedFlowId && edgeMatchesActiveFilters(edge)) || null;
    }

    function getPrimaryInspectorFlowForNode(node, flows = []) {
        if (!node || !flows.length) return null;
        const activeReplay = state.flowReplay.activeFlowId
            ? flows.find(edge => edge.id === state.flowReplay.activeFlowId)
            : null;
        if (activeReplay) return activeReplay;
        return flows
            .slice()
            .sort((a, b) => compareTimelineFlows(a, b))[0] || null;
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

    function renderWalletLookupEmptyDetails() {
        const intelligence = buildWalletIntelligence();
        const message = getWalletLookupEmptyState(intelligence) || 'Wallet lookup is ready for a Worker response.';
        const depthNote = getWalletDepthExpansionNote();
        return `
            <div class="text-[10px] font-mono tracking-[1.4px] text-cyan-100/72">WALLET LOOKUP</div>
            <h3 class="font-display text-2xl mt-1">No Visible Wallet Flows</h3>
            <div class="text-[11px] text-white/42 mt-2">This panel summarizes the replacement wallet graph returned by the secure Worker.</div>
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="text-sm text-white/72">${escapeHtml(message)}</div>
                ${depthNote ? `<div class="text-xs text-cyan-50/62 mt-2">${escapeHtml(depthNote)}</div>` : ''}
            </section>
            ${renderDetailSection('Lookup Summary', `
                ${detailRow('Tracked Wallet', intelligence.trackedWallet || '-', { shorten: true })}
                ${detailRow('Returned Events', intelligence.returnedEvents)}
                ${detailRow('Visible Transfer Legs', intelligence.visibleLegs)}
                ${detailRow('Filtered / Noise Removed', intelligence.filteredLegs)}
                ${detailRow('Graph Depth', `${intelligence.graphDepth}-hop`)}
                ${detailRow('Last Loaded', intelligence.lastLoadedLabel)}
            `)}
        `;
    }

    function renderWalletDetailReadout() {
        const intelligence = buildWalletIntelligence();
        return renderDetailSection('Wallet Lookup Readout', `
            ${detailRow('Returned / Visible', `${intelligence.returnedEvents} events / ${intelligence.visibleLegs} visible legs`)}
            ${detailRow('Filtered / Noise Removed', intelligence.filteredLegs)}
            ${detailRow('Top Inbound Token', intelligence.topInboundToken)}
            ${detailRow('Top Outbound Token', intelligence.topOutboundToken)}
            ${detailRow('Largest Visible Flow', intelligence.largestFlow)}
            ${detailRow('Most Repeated Counterparty', intelligence.mostRepeatedCounterparty)}
        `);
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
            ? `FROM ${compactNodeLabel(source)} \u2192 TO ${compactNodeLabel(target)}`
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
                <div class="text-[11px] text-white/42 mt-1">${core.formatUsd(path.usd_value || 0)} ${escapeHtml(state.dataMode === DATA_MODES.WALLET ? 'wallet lookup' : 'sample')} flow path</div>
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
        const tracked = core.normalizeAddress(state.graph?.metadata?.wallet_lookup_tracked_wallet || state.graph?.metadata?.generated_wallet || state.graph?.metadata?.wallet || '');
        if (tracked && core.normalizeAddress(node.address) === tracked) return 'Tracked Wallet';
        if (state.dataMode === DATA_MODES.WALLET) return shortLongValue(node.address || node.id);
        return node.label || core.shortAddress(node.address);
    }

    function shouldShowNodeLabel(node, context) {
        if (!node) return false;
        if (isTrackedWalletNode(node)) return true;
        if (state.dataMode === DATA_MODES.WALLET && node.type === core.NODE_TYPES.WALLET) return true;
        if (context.selected || context.hovered) return true;
        if (isHubNode(node)) return true;

        const isMajor = node.label_priority === 'major';
        if (!context.interaction.hasFocus) return isMajor;
        return context.connected && isMajor;
    }

    function isTrackedWalletNode(node = {}) {
        if (node.type !== core.NODE_TYPES.WALLET) return false;
        const tracked = core.normalizeAddress(state.graph?.metadata?.wallet_lookup_tracked_wallet || state.graph?.metadata?.wallet || state.walletLookup.lastWallet);
        return Boolean(tracked && core.normalizeAddress(node.address) === tracked);
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

    function getFlowEdgeAtWorldPoint(point) {
        if (!point || !state.graph) return null;
        const tolerance = Math.max(7, 13 / (state.viewport.scale || 1));
        return getVisibleFlowEdges()
            .slice()
            .sort((a, b) => (b.width || 0) - (a.width || 0) || (b.usd_value || 0) - (a.usd_value || 0))
            .map(edge => ({
                edge,
                distance: distanceToFlowEdge(point, edge)
            }))
            .filter(item => Number.isFinite(item.distance) && item.distance <= tolerance)
            .sort((a, b) => a.distance - b.distance || (b.edge.usd_value || 0) - (a.edge.usd_value || 0))[0]?.edge || null;
    }

    function distanceToFlowEdge(point, edge) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        if (!source || !target) return Number.POSITIVE_INFINITY;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        const control = {
            x: (source.x + target.x) / 2 + normal.x * 24,
            y: (source.y + target.y) / 2 + normal.y * 24
        };
        let minDistance = Number.POSITIVE_INFINITY;
        for (let step = 0; step <= 18; step += 1) {
            const curvePoint = pointOnQuadratic(source, control, target, step / 18);
            minDistance = Math.min(minDistance, Math.hypot(point.x - curvePoint.x, point.y - curvePoint.y));
        }
        return minDistance;
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

    function centerTrackedWallet() {
        if (!state.graph) return;
        const trackedWallet = core.normalizeAddress(
            state.graph.metadata?.wallet_lookup_tracked_wallet
            || state.graph.metadata?.wallet
            || state.walletLookup.lastWallet
            || ''
        );
        const node = getWalletNodeForAddress(trackedWallet)
            || state.graph.nodeById.get(state.selectedId)
            || state.graph.nodes[0];
        if (!node) return;

        const { width, height } = state.graph.bounds || getCanvasSize();
        const nextScale = clamp(Math.max(state.viewport.scale, 1), ZOOM_LIMITS.min, ZOOM_LIMITS.max);
        state.viewport.scale = nextScale;
        state.viewport.x = width * 0.5 - node.x * nextScale;
        state.viewport.y = height * 0.48 - node.y * nextScale;
        clampViewport();
        state.selectedId = node.id;
        state.selectedFlowId = null;
        render();
        renderDetails();
    }

    function resetLayout() {
        if (!state.graph) return;
        state.manualNodePositions.clear();
        state.graph = layoutEngine.layoutGraph(state.graph, getCanvasSize());
        applyWalletLookupFocusLayout();
        prepareFlowMotion();
        rebuildInteractionIndex();
        render();
        renderDetails();
    }

    function setFullscreen(enabled) {
        const active = Boolean(enabled);
        if (state.fullscreen === active) return;
        state.fullscreen = active;
        state.root?.classList.toggle('is-crypto-fullscreen', active);
        document.body.classList.toggle('crypto-graph-fullscreen-active', active);
        updateFullscreenButton();
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                resizeAndRender();
                renderDetails();
            });
        });
    }

    function updateFullscreenButton() {
        const button = document.getElementById('crypto-fullscreen-toggle');
        if (button) {
            button.setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
            button.classList.toggle('is-active', state.fullscreen);
            button.title = state.fullscreen
                ? 'Exit expanded Crypto graph view'
                : 'Expand the Crypto graph canvas for fullscreen investigation';
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-expand', !state.fullscreen);
                icon.classList.toggle('fa-compress', state.fullscreen);
            }
            const label = button.querySelector('span');
            if (label) label.innerText = state.fullscreen ? 'Exit Fullscreen' : 'Expand Graph';
        }

        const mobileButton = document.getElementById('crypto-mobile-fullscreen-toggle');
        const mobileIcon = mobileButton?.querySelector('i');
        mobileButton?.setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
        mobileButton?.setAttribute('title', state.fullscreen ? 'Exit CryptoPhotonic fullscreen graph' : 'Open CryptoPhotonic fullscreen graph');
        mobileButton?.classList.toggle('is-active', state.fullscreen);
        if (mobileIcon) {
            mobileIcon.classList.toggle('fa-expand', !state.fullscreen);
            mobileIcon.classList.toggle('fa-compress', state.fullscreen);
        }
    }

    function resetFlowQueueState() {
        state.flowReplay.playing = false;
        state.flowReplay.index = 0;
        state.flowReplay.activeFlowId = null;
        state.flowReplay.lastStepAt = 0;
        state.live.pendingFlowIds = [];
        if (state.live.pulseTimerId) {
            window.clearTimeout(state.live.pulseTimerId);
            state.live.pulseTimerId = null;
        }
        state.flowMotion.topFlowIds = new Set();
        state.flowQueue = state.flowReplay;
    }

    function applyWalletLookupFocusLayout() {
        if (state.dataMode !== DATA_MODES.WALLET || !state.graph?.nodes?.length) return;
        const trackedWallet = core.normalizeAddress(state.graph.metadata?.wallet_lookup_tracked_wallet || state.graph.metadata?.wallet || state.walletLookup.lastWallet);
        const trackedNode = getWalletNodeForAddress(trackedWallet);
        if (!trackedNode) return;

        const { width, height } = state.graph.bounds || getCanvasSize();
        const center = { x: width * 0.5, y: height * 0.48 };
        trackedNode.x = center.x;
        trackedNode.y = center.y;
        trackedNode.label_priority = 'major';
        trackedNode.radius = Math.max(trackedNode.radius || 0, 44);
        trackedNode.color = '#67e8f9';
        trackedNode.is_tracked_wallet = true;

        const valueByNeighbor = new Map();
        (state.graph.flowEdges || []).forEach(edge => {
            const neighborId = edge.source === trackedNode.id ? edge.target : edge.target === trackedNode.id ? edge.source : '';
            if (!neighborId) return;
            valueByNeighbor.set(neighborId, (valueByNeighbor.get(neighborId) || 0) + (Number(edge.usd_value) || 1));
        });

        const directWallets = [...valueByNeighbor.keys()]
            .map(id => state.graph.nodeById.get(id))
            .filter(node => node?.type === core.NODE_TYPES.WALLET)
            .sort((a, b) => (valueByNeighbor.get(b.id) || 0) - (valueByNeighbor.get(a.id) || 0) || labelForNode(a).localeCompare(labelForNode(b)));
        const radius = clamp(Math.min(width, height) * 0.31, 142, 255);
        directWallets.forEach((node, index) => {
            const angle = directWallets.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * index) / directWallets.length;
            node.x = center.x + Math.cos(angle) * radius;
            node.y = center.y + Math.sin(angle) * radius * 0.82;
            node.label_priority = index < 12 ? 'major' : node.label_priority;
        });

        const tokenNodes = state.graph.tokenNodes || [];
        const tokenRadius = radius + 92;
        tokenNodes.forEach((node, index) => {
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, tokenNodes.length);
            node.x = center.x + Math.cos(angle) * tokenRadius;
            node.y = center.y + Math.sin(angle) * tokenRadius * 0.76;
        });
    }

    function getWalletNodeForAddress(address = '') {
        const normalized = core.normalizeAddress(address);
        if (!normalized) return null;
        return (state.graph?.walletNodes || []).find(node => core.normalizeAddress(node.address) === normalized) || null;
    }

    function getWalletNodeIdForAddress(address = '') {
        return getWalletNodeForAddress(address)?.id || '';
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
        const selectedFlowEdge = state.selectedFlowId
            ? (state.graph.flowEdges || []).find(edge => edge.id === state.selectedFlowId && edgeMatchesActiveFilters(edge))
            : null;
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
        if (selectedFlowEdge) {
            connectedEdgeIds.add(selectedFlowEdge.id);
            connectedNodeIds.add(selectedFlowEdge.source);
            connectedNodeIds.add(selectedFlowEdge.target);
        }

        return {
            activeIds,
            connectedNodeIds,
            connectedEdgeIds,
            hasFocus: activeIds.size > 0 || Boolean(selectedFlowEdge),
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

    function formatDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatCompactNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '-';

        const absolute = Math.abs(number);
        if (absolute >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
        if (absolute >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`;
        return number.toLocaleString(undefined, {
            maximumFractionDigits: absolute < 1 && absolute > 0 ? 4 : 2
        });
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
        centerTrackedWallet,
        resetLayout,
        setFullscreen,
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
