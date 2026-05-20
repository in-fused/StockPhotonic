(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};
    const core = namespace.core;
    const graphEngine = namespace.graph;
    const layoutEngine = namespace.layout;
    const topologyTools = namespace.topologyIntelligence || {};
    const viewportUtils = window.StockPhotonicGraph?.viewport || {};
    const semanticZoomTools = window.StockPhotonicGraph?.semanticZoom || {};

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
    const DEFAULT_WORKER_WALLET_HISTORY_ENDPOINT = '/api/crypto/wallet-history';

    const state = {
        initialized: false,
        active: false,
        graph: null,
        selectedId: null,
        selectedFlowId: null,
        hoveredId: null,
        hoveredFlowId: null,
        focusSelection: true,
        tokenIsolation: 'all',
        interactionIndex: null,
        topologyModel: null,
        semanticZoom: null,
        lastSemanticUiKey: '',
        lastBreadcrumbKey: '',
        canvas: null,
        ctx: null,
        hoverOverlay: null,
        root: null,
        detailPanel: null,
        statusPanel: null,
        mobileDrawer: null,
        investigationTab: 'summary',
        mobileDrawerState: 'collapsed',
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
        history: {
            controller: null,
            moduleLoadPromise: null,
            previewModuleLoadPromise: null,
            datasetBuilderLoadPromise: null,
            graphRendererLoadPromise: null,
            replayAnimatorLoadPromise: null,
            inFlight: false,
            lastError: '',
            lastMessage: '',
            pagesLoaded: 0,
            providerPagesLoaded: 0,
            totalLoadedTransactions: 0,
            loadedTransactions: [],
            moreAvailable: false,
            nextCursor: null,
            backendProviderConnected: false,
            providerConfigured: false,
            lastStatus: 'idle',
            lastMetadata: {},
            progress: null,
            provider: '',
            providerLabel: '',
            providerCapabilities: null,
            providerDiagnostics: null,
            providerDiagnosticsInFlight: false,
            scanManifest: null,
            scanId: '',
            gapFlags: [],
            warnings: [],
            replayWindow: null,
            scanCache: null,
            replayReconstruction: null
        },
        historyPreview: {
            plan: null,
            dataset: null,
            datasetMetrics: null,
            generatedAt: 0,
            datasetGeneratedAt: 0,
            graphVisible: false,
            workspaceMode: false,
            graphRenderResult: null,
            graphRenderedAt: 0,
            replayAnimator: null,
            replayStatus: null,
            activeReplayWindow: null,
            replayWindowCache: new Map(),
            replayWindowResponse: null,
            checkpoint: null,
            selectedEvent: null,
            audit: {
                filters: {
                    token: 'all',
                    direction: 'all',
                    counterparty: 'all',
                    majorOnly: false
                },
                selectedStep: 0,
                selectedWallet: '',
                expandedStep: 0,
                neighborhood: {
                    mode: 'none',
                    wallet: '',
                    token: 'all',
                    route: '',
                    clusterKey: '',
                    clusterKind: ''
                },
                breadcrumbs: [],
                recentSteps: [],
                investigationStack: [],
                flowLineage: []
            },
            narrativesVisible: true,
            corridorOverlayVisible: true,
            continuityViewVisible: true,
            focusCycleIndex: 0,
            replaySpeed: 'standard',
            lastMessage: ''
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
        cinematicMotion: {
            offsets: new Map(),
            lastFrameAt: 0,
            active: false
        },
        labelDensity: 'balanced',
        labelDensityUserSet: false,
        viewport: {
            x: 0,
            y: 0,
            scale: 1
        },
        touchPointers: new Map(),
        pinch: null,
        drag: null,
        lastClick: null,
        manualNodePositions: new Map(),
        renderPerf: {
            rafId: null,
            inRender: false,
            pending: false
        },
        hoverPerf: {
            lastAt: 0,
            lastPoint: null,
            key: '',
            overlayKey: '',
            throttleMs: 42
        },
        lastPointerType: 'mouse'
    };
    state.flowQueue = state.flowReplay;

    const ZOOM_LIMITS = { min: 0.48, max: 2.35 };
    const DRAG_SELECT_THRESHOLD = 5;
    const QUICK_INSPECT_MS = 320;
    const QUICK_INSPECT_DISTANCE = 10;
    const TOUCH_HIT_TARGET = {
        nodeExtraPx: 24,
        flowExtraPx: 28,
        stableExtraPx: 12,
        hoverThrottleMs: 70
    };
    const DESKTOP_HIT_TARGET = {
        nodeExtraPx: 11,
        flowExtraPx: 14,
        stableExtraPx: 6,
        hoverThrottleMs: 42
    };
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
    const HISTORY_PREVIEW_TRANSACTION_LIMIT = 10000;
    const HISTORY_PREVIEW_GRAPH_LIMITS = Object.freeze({
        maxTransactions: 320,
        maxNodes: 240,
        maxEdges: 360
    });
    const HISTORY_REPLAY_CHUNK_SIZE = 80;
    const HISTORY_REPLAY_WINDOW_CACHE_LIMIT = 6;
    const HISTORY_REPLAY_CHECKPOINT_STORAGE_PREFIX = 'cryptophotonic:replay-checkpoint:v1:';
    const HISTORY_REPLAY_CHECKPOINT_LATEST_KEY = `${HISTORY_REPLAY_CHECKPOINT_STORAGE_PREFIX}latest`;
    const HISTORY_REPLAY_SPEEDS = Object.freeze({
        inspect: 'Inspect',
        standard: 'Standard',
        fast: 'Fast'
    });
    const LIVE_POLL_MS = { min: 3000, max: 5000, default: 4000 };
    const DATA_MODES = Object.freeze({
        GENERATED: 'generated_fixture',
        WALLET: 'wallet_lookup',
        LIVE: 'live_feed'
    });
    const LABEL_DENSITY_ORDER = Object.freeze(['minimal', 'balanced', 'detailed']);
    const MOBILE_DRAWER_STATES = Object.freeze(['collapsed', 'half', 'expanded']);
    const LABEL_DENSITY_MODES = Object.freeze({
        minimal: {
            label: 'Minimal',
            icon: 'fa-compress',
            title: 'Minimal labels: tracked wallet, selections, and only the strongest flow labels.'
        },
        balanced: {
            label: 'Balanced',
            icon: 'fa-tags',
            title: 'Balanced labels: readable wallet lookup labels with major flows and hover detail.'
        },
        detailed: {
            label: 'Detailed',
            icon: 'fa-layer-group',
            title: 'Detailed labels: more labels when zoomed in, still collision-aware.'
        }
    });
    const LAMPORTS_PER_SOL = 1000000000;
    const RAW_SOL_LAMPORT_HEURISTIC_MIN = 1000000;
    const SOURCE_LABELS = {
        generated: 'Generated Fixture',
        solana_sample: 'Generated Fixture',
        legacy_sample: 'Generated Fixture',
        built_in: 'Generated Fixture',
        worker_feed: 'Live Feed (Worker Events)',
        worker_wallet_lookup: 'Wallet Lookup (Worker Replacement)'
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
        state.hoverOverlay = document.getElementById('crypto-graph-hover-overlay') || createHoverOverlay();
        state.mobileDrawer = document.getElementById('crypto-mobile-investigation-drawer');
        configureLiveFeed(options);
        loadHistoryGraphPreviewModule();

        state.ctx = state.canvas.getContext('2d');
        state.canvas.style.cursor = 'grab';
        state.canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
        state.canvas.addEventListener('pointerdown', handleCanvasPointerDown);
        state.canvas.addEventListener('pointermove', handleCanvasPointerMove);
        state.canvas.addEventListener('pointerup', handleCanvasPointerUp);
        state.canvas.addEventListener('pointercancel', handleCanvasPointerCancel);
        state.canvas.addEventListener('lostpointercapture', handleCanvasPointerCancel);
        state.canvas.addEventListener('mouseleave', handleCanvasLeave);
        const replayCanvas = document.getElementById('crypto-history-workspace-canvas');
        replayCanvas?.addEventListener('click', handleReplayWorkspaceCanvasClick);
        replayCanvas?.addEventListener('pointermove', handleReplayWorkspaceCanvasPointerMove);
        replayCanvas?.addEventListener('mouseleave', handleReplayWorkspaceCanvasLeave);
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
        document.getElementById('crypto-mobile-label-density-toggle')?.addEventListener('click', cycleLabelDensity);
        document.getElementById('crypto-mobile-focus-selection')?.addEventListener('click', toggleFocusSelection);
        document.getElementById('crypto-mobile-open-details')?.addEventListener('click', openMobileDetailsPanel);
        document.getElementById('crypto-mobile-replay-workspace')?.addEventListener('click', () => setReplayWorkspaceMode(!state.historyPreview.workspaceMode));
        document.getElementById('crypto-replay-workspace-exit')?.addEventListener('click', () => setReplayWorkspaceMode(false));
        document.getElementById('crypto-replay-workspace-build')?.addEventListener('click', () => buildHistoryPreviewDataset());
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.historyPreview.workspaceMode) {
                event.preventDefault();
                setReplayWorkspaceMode(false);
                return;
            }
            if (event.key !== 'Escape' || !state.fullscreen) return;
            event.preventDefault();
            setFullscreen(false);
        });
        window.addEventListener('resize', handleWindowResize);

        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(handleWindowResize);
            state.resizeObserver.observe(state.canvas.parentElement || state.canvas);
        }

        const dataset = await loadSampleDataset();
        state.dataset = cloneDataset(dataset);
        const graph = graphEngine.buildGraph(dataset);
        state.graph = layoutEngine.layoutGraph(graph, getCanvasSize());
        state.flowReplayEnabled = Boolean(state.graph.flowReplayEnabled);
        applyDefaultLabelDensityForDataMode(state.dataMode);
        state.historyPreview.checkpoint = loadReplayAuditCheckpoint({ allowLatest: true });
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
        updateInteractionDock();
        syncLabelDensityControls();
        return state.graph;
    }

    function setActive(active) {
        state.active = Boolean(active);
        updateFlowAnimationLoop();
        updateLivePolling();
        if (!state.active || !state.initialized) return;
        resizeAndRender();
        renderDetails();
        updateInteractionDock();
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
        resetHistoryState();
    }

    function resetHistoryState(wallet = '') {
        if (state.history.controller?.reset) {
            state.history.controller.reset(wallet);
        }
        state.history.inFlight = false;
        state.history.lastError = '';
        state.history.lastMessage = '';
        state.history.pagesLoaded = 0;
        state.history.providerPagesLoaded = 0;
        state.history.totalLoadedTransactions = 0;
        state.history.loadedTransactions = [];
        state.history.moreAvailable = false;
        state.history.nextCursor = null;
        state.history.backendProviderConnected = false;
        state.history.providerConfigured = false;
        state.history.lastStatus = 'idle';
        state.history.lastMetadata = {};
        state.history.progress = null;
        state.history.provider = '';
        state.history.providerLabel = '';
        state.history.providerCapabilities = null;
        state.history.providerDiagnostics = null;
        state.history.providerDiagnosticsInFlight = false;
        state.history.scanManifest = null;
        state.history.scanId = '';
        state.history.gapFlags = [];
        state.history.warnings = [];
        state.history.replayWindow = null;
        state.history.scanCache = null;
        state.history.replayReconstruction = null;
        state.historyPreview.plan = null;
        state.historyPreview.dataset = null;
        state.historyPreview.datasetMetrics = null;
        state.historyPreview.generatedAt = 0;
        state.historyPreview.datasetGeneratedAt = 0;
        state.historyPreview.graphVisible = false;
        state.historyPreview.graphRenderResult = null;
        state.historyPreview.graphRenderedAt = 0;
        state.historyPreview.activeReplayWindow = null;
        state.historyPreview.replayWindowResponse = null;
        state.historyPreview.replayWindowCache?.clear?.();
        detachHistoryReplayAnimator({ preserveStatus: false });
        resetHistoryPreviewAuditState();
        state.historyPreview.replaySpeed = 'standard';
        state.historyPreview.lastMessage = '';
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
            return 'Wallet Lookup replaces the active graph with one secure Worker response. It is not merged with generated fixtures, Live Feed events, or staged history.';
        }
        if (state.dataMode === DATA_MODES.LIVE) {
            return 'Live Feed shows only sanitized Worker events. No provider keys, wallet-history pages, or browser provider calls are used.';
        }
        if (!state.live.endpointValid) {
            return 'Generated Fixture uses local sample files. Load Activity in Wallet Lookup asks the secure Worker for recent activity.';
        }
        if (state.walletLookup.eventCount > 0 || state.walletLookup.mergedEventCount > 0) {
            return 'Generated Fixture uses local sample files. Wallet Lookup results stay separate and replace the graph only when loaded.';
        }
        if (state.live.workerAvailable) {
            return 'Browser fetches only sanitized Worker feed events. No provider keys or direct provider calls are used.';
        }
        if (state.datasetSourceKind === 'generated') {
            return 'Generated Fixture uses local sample files for repeatable QA. Wallet Lookup and Live Feed remain separate Worker-backed modes.';
        }
        return 'Generated Fixture uses local sample files. Wallet Lookup and Live Feed remain separate Worker-backed modes.';
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

        const statusHost = document.getElementById('crypto-status-panel') || state.root.querySelector('.crypto-panel > div:first-child');
        if (!statusHost) return;

        const existing = document.getElementById('crypto-solana-status');
        const replayWasPlaying = Boolean(state.historyPreview.replayAnimator?.getStatus?.().playing || state.historyPreview.replayStatus?.playing);
        if (existing) {
            detachHistoryReplayAnimator({ preserveStatus: true });
            existing.remove();
        }

        const status = document.createElement('div');
        status.id = 'crypto-solana-status';
        status.className = 'crypto-status-stack grid gap-2 text-sm text-cyan-50/78';
        status.innerHTML = `
            ${renderGeneratedDataManager(metadata, isGeneratedFixture, isSolana)}
            ${renderFlowFilters()}
            ${renderFlowQueueStatus()}
        `;
        statusHost.appendChild(status);
        state.statusPanel = status;
        bindStatusControls(status);
        updateReplayWorkspaceShell();
        renderDetails({ resumeReplay: replayWasPlaying });
        updateInteractionDock();
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
                    <div class="min-w-0">
                        <div class="text-white/38">DATA SOURCE / MODE</div>
                        <div class="${sourceTone} break-words">Source: ${escapeHtml(sourceLabel)}</div>
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
                <div class="crypto-data-source-snapshot mt-2 text-white/56">
                    <div>Mode: Worker replacement graph</div>
                    <div title="${escapeAttr(tracked || 'No tracked wallet loaded')}">Tracked: ${escapeHtml(tracked ? shortLongValue(tracked) : '-')}</div>
                    <div>Returned / Visible: ${escapeHtml(state.walletLookup.eventCount || 0)} / ${escapeHtml(visible)}</div>
                </div>
            `;
        }
        if (state.dataMode === DATA_MODES.LIVE) {
            return `
                <div class="crypto-data-source-snapshot mt-2 text-white/56">
                    <div>Mode: Sanitized live feed</div>
                    <div>Events: ${escapeHtml(state.live.eventCount || 0)} returned / ${escapeHtml(state.live.mergedEventCount || 0)} shown</div>
                    <div>Last Poll: ${escapeHtml(state.live.lastPollAt ? formatDateTime(state.live.lastPollAt) : '-')}</div>
                </div>
            `;
        }
        return `
            <div class="crypto-data-source-snapshot mt-2 text-white/56">
                <div>Mode: Local QA fixture</div>
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
            [DATA_MODES.GENERATED]: 'Use local reviewed fixtures for repeatable QA without relying on Worker availability.',
            [DATA_MODES.WALLET]: 'Replace the active graph with recent activity returned by the secure Worker for one wallet.',
            [DATA_MODES.LIVE]: 'Show sanitized Worker feed events only; the browser does not call chain providers.'
        };
        return `
            <div class="crypto-mode-switch flex flex-wrap gap-1.5" role="group" aria-label="CryptoPhotonic data mode">
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
                ${renderControlHelp('Load Activity asks the secure Worker for recent wallet activity and replaces the current graph. Refresh repeats the last lookup without merging generated fixture, live feed, or staged history data.')}
                <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
                    <label class="grid gap-1 min-w-0 text-white/52">
                        <span title="Solana wallet address to investigate through the Worker wallet-activity endpoint.">Wallet Address</span>
                        <input id="crypto-wallet-lookup-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" value="${escapeAttr(value)}" placeholder="Solana wallet address" class="w-full min-h-10 bg-slate-950/80 border border-cyan-200/15 rounded-xl px-3 py-2 text-cyan-50/82 outline-none placeholder:text-white/28">
                    </label>
                    <div class="crypto-wallet-lookup-action-grid grid gap-2">
                        <button id="crypto-wallet-lookup-submit" type="submit" ${state.walletLookup.inFlight ? 'disabled' : ''} title="Load recent sanitized wallet activity from the Worker and replace the active graph." class="min-h-10 rounded-xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load Activity</button>
                        <button id="crypto-wallet-lookup-refresh" type="button" ${state.walletLookup.inFlight || !(state.walletLookup.lastWallet || value) ? 'disabled' : ''} title="Run the last wallet lookup again without changing the entered address." class="min-h-10 rounded-xl border border-cyan-200/15 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Refresh</button>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <label class="flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-cyan-200/15 bg-slate-950/35 px-3 py-2 text-white/58" title="Advanced: include meaningful addresses one additional transfer hop away when the Worker response contains them.">
                        <input id="crypto-wallet-depth-toggle" type="checkbox" ${state.walletLookup.graphDepth > 1 ? 'checked' : ''} ${state.dataMode === DATA_MODES.WALLET ? '' : 'disabled'} class="h-4 w-4 accent-cyan-300">
                        <span class="min-w-0 break-words">Include 2-hop wallet addresses</span>
                    </label>
                    <div id="crypto-wallet-lookup-status" class="crypto-wallet-status-line rounded-xl border border-white/10 bg-slate-950/32 px-3 py-2 text-white/56">${escapeHtml(status)}</div>
                </div>
                ${renderWalletHistoryControls()}
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

    function renderWalletHistoryControls() {
        if (state.dataMode !== DATA_MODES.WALLET) return '';
        const disabled = isWalletHistoryLoadMoreDisabled();
        const status = getWalletHistoryStatusLabel();
        const coverage = getWalletHistoryCoverage();
        const badges = getWalletHistoryStatusBadges();
        return `
            <div class="grid grid-cols-1 gap-2 items-center">
                <div id="crypto-wallet-history-status" class="crypto-wallet-status-line rounded-xl border border-white/10 bg-slate-950/32 px-3 py-2 text-white/56">${escapeHtml(status)}</div>
                <div class="crypto-wallet-history-mini-grid grid gap-2 text-[11px]">
                    <div class="rounded-lg border border-cyan-200/12 bg-cyan-300/8 px-2.5 py-2 text-cyan-50/76">
                        <div class="text-white/36">Coverage</div>
                        <div class="mt-0.5 font-semibold">${escapeHtml(coverage.label)}</div>
                    </div>
                    <div class="rounded-lg border ${coverage.moreAvailable ? 'border-yellow-200/18 bg-yellow-300/8 text-yellow-50/78' : 'border-emerald-200/16 bg-emerald-300/8 text-emerald-50/76'} px-2.5 py-2">
                        <div class="text-white/36">More</div>
                        <div class="mt-0.5 font-semibold">${escapeHtml(coverage.moreAvailable ? 'Available' : 'Not available')}</div>
                    </div>
                    <div class="rounded-lg border border-sky-200/14 bg-sky-300/8 px-2.5 py-2 text-sky-50/76">
                        <div class="text-white/36">Confidence</div>
                        <div class="mt-0.5 font-semibold">${escapeHtml(`${coverage.confidence}%`)}</div>
                    </div>
                    <div class="rounded-lg border border-fuchsia-200/14 bg-fuchsia-300/8 px-2.5 py-2 text-fuchsia-50/78">
                        <div class="text-white/36">Replay</div>
                        <div class="mt-0.5 font-semibold">${escapeHtml(`${coverage.replayCoverage}% / ${getWalletHistoryReplaySuitability()}`)}</div>
                    </div>
                </div>
                ${badges.length ? `<div class="flex flex-wrap gap-1.5">${badges.map(badge => `<span class="rounded-full border ${escapeAttr(badge.className)} px-2 py-1 text-[10px] font-mono">${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
                <div class="crypto-wallet-history-action-grid grid gap-2">
                    <button id="crypto-wallet-history-load-more" type="button" ${disabled ? 'disabled' : ''} title="${escapeAttr(disabled ? getWalletHistoryLoadMoreDisabledTitle() : 'Load the next backend-provided wallet history page into staging only. The current graph is unchanged.')}" class="min-h-10 rounded-xl border border-emerald-200/18 bg-emerald-300/10 px-3 py-2 text-emerald-50/82 hover:border-emerald-100/35 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(disabled && state.history.providerPagesLoaded > 0 && !state.history.moreAvailable ? 'No More History' : 'Load Next Page')}</button>
                    <button id="crypto-wallet-history-load-5" type="button" ${disabled ? 'disabled' : ''} title="${escapeAttr(disabled ? getWalletHistoryLoadMoreDisabledTitle() : 'Sequentially load up to 5 Worker history pages, stopping on cursor exhaustion, rate limit, or provider limit.')}" class="min-h-10 rounded-xl border border-emerald-200/18 bg-emerald-300/10 px-3 py-2 text-emerald-50/82 hover:border-emerald-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load 5 Pages</button>
                    <button id="crypto-wallet-history-load-until-limit" type="button" ${disabled ? 'disabled' : ''} title="${escapeAttr(disabled ? getWalletHistoryLoadMoreDisabledTitle() : 'Sequentially load until the Worker reports no cursor, a rate limit, or a provider limit. Guarded to prevent runaway loops.')}" class="min-h-10 rounded-xl border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-yellow-50/82 hover:border-yellow-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load Until Limit</button>
                </div>
            </div>
        `;
    }

    function getWalletHistoryLoadMoreDisabledTitle() {
        if (state.walletLookup.inFlight) return 'Wallet Lookup is still loading. Wait before staging more history.';
        if (state.history.inFlight) return 'History is already loading through the Worker.';
        if (state.history.providerDiagnosticsInFlight) return 'Provider diagnostics are checking Worker readiness. Wait before staging history.';
        if (!(state.walletLookup.lastWallet || state.walletLookup.walletInput)) return 'Enter and load a wallet before staging history.';
        if (state.history.providerPagesLoaded > 0 && !state.history.moreAvailable) return getWalletHistoryStuckMessage();
        if (!state.history.backendProviderConnected) return 'Worker wallet-history adapter is not connected; browser provider calls remain disabled.';
        return 'History loading is unavailable for the current state.';
    }

    function getWalletHistoryStatusLabel() {
        if (state.history.inFlight) {
            const progress = state.history.progress;
            if (progress?.message) {
                const target = progress.target ? ` of ${progress.target}` : ' until limit';
                return `History: ${progress.message} / ${state.history.totalLoadedTransactions} tx tracked / page ${progress.current}${target}`;
            }
            return 'History: loading next backend page';
        }
        if (state.history.providerDiagnosticsInFlight) return 'History: checking provider diagnostics through the Worker';
        if (state.history.lastError) return `History: ${state.history.lastError}`;
        if (state.history.pagesLoaded > 0) {
            const next = state.history.nextCursor ? shortLongValue(state.history.nextCursor) : 'none';
            const providerState = getWalletHistoryProviderStateDisplay().toLowerCase();
            const cacheState = getWalletHistoryCacheDisplay().toLowerCase();
            const more = state.history.moreAvailable ? 'more available' : 'no next page';
            return `History: ${state.history.pagesLoaded} page${state.history.pagesLoaded === 1 ? '' : 's'} loaded / ${state.history.totalLoadedTransactions} tx tracked / ${more} / next cursor ${next} / provider ${providerState} / cache ${cacheState}`;
        }
        if (state.dataMode === DATA_MODES.WALLET) {
            return state.history.backendProviderConnected
                ? 'History: ready to call Worker wallet-history / provider state unknown'
                : 'History: ready for backend pagination after wallet lookup / backend adapter pending';
        }
        return 'History: wallet mode only';
    }

    function isWalletHistoryLoadMoreDisabled() {
        const hasWallet = Boolean(state.walletLookup.lastWallet || state.walletLookup.walletInput);
        const noMoreBackendPages = state.history.providerPagesLoaded > 0 && !state.history.moreAvailable;
        return state.walletLookup.inFlight
            || state.history.inFlight
            || state.history.providerDiagnosticsInFlight
            || !hasWallet
            || noMoreBackendPages
            || !state.history.backendProviderConnected;
    }

    function getWalletHistoryCoverage() {
        const pages = Math.max(0, Number(state.history.pagesLoaded) || 0);
        const providerPages = Math.max(0, Number(state.history.providerPagesLoaded) || 0);
        const tx = Math.max(0, Number(state.history.totalLoadedTransactions) || 0);
        const moreAvailable = Boolean(state.history.moreAvailable);
        const manifest = getWalletHistoryScanManifest();
        const confidence = getWalletHistoryCompletenessConfidence();
        const replayCoverage = getWalletHistoryReplayCoverage();
        const coverage = String(state.history.lastMetadata?.history_coverage || '').replaceAll('_', ' ');
        const limited = isWalletHistoryLimitedByProvider();
        const rateLimited = state.history.lastStatus === 'provider_rate_limited' || state.history.lastMetadata?.rate_limited === true;
        const cursorExhausted = state.history.lastMetadata?.cursor_exhausted === true || state.history.lastMetadata?.history_depth_estimate?.cursor_exhausted === true;
        const fullLoaded = (manifest.full_history_loaded === true || state.history.lastMetadata?.full_history_loaded === true) && cursorExhausted && !moreAvailable && !limited && !rateLimited && pages > 0;
        const label = pages
            ? `${tx} tx / ${pages} page${pages === 1 ? '' : 's'}${providerPages ? ` / ${providerPages} provider` : ''}`
            : 'No staged pages';
        const detail = rateLimited
            ? `Rate limited; full history not loaded. Confidence ${confidence}%.`
            : limited
                ? `Limited by provider; full history not loaded. Confidence ${confidence}%.`
                : moreAvailable
                    ? `Full history not loaded; provider has another cursor. Replay coverage ${replayCoverage}%.`
                    : fullLoaded
                        ? `Best-effort complete: provider returned no next cursor and no blocking scan gaps. Confidence ${confidence}%.`
                        : pages
                            ? `Full history is not proven complete. Confidence ${confidence}%.`
                            : 'Load wallet activity or history pages to estimate coverage.';
        return {
            pages,
            providerPages,
            tx,
            moreAvailable,
            coverage,
            label,
            detail,
            fullLoaded,
            limited,
            rateLimited,
            confidence,
            replayCoverage
        };
    }

    function getWalletHistoryStatusBadges() {
        const coverage = getWalletHistoryCoverage();
        const badges = [];
        if (coverage.rateLimited) badges.push({ label: 'Rate Limited', className: 'border-red-200/20 bg-red-300/10 text-red-50/78' });
        if (coverage.limited) badges.push({ label: 'Limited by Provider', className: 'border-yellow-200/18 bg-yellow-300/10 text-yellow-50/78' });
        if (getWalletHistoryGapFlags().length) badges.push({ label: 'Gap Flags', className: 'border-yellow-200/18 bg-yellow-300/10 text-yellow-50/78' });
        if (getWalletHistoryProviderGrade().toLowerCase() === 'archive') badges.push({ label: 'Archive Path', className: 'border-sky-200/22 bg-sky-300/10 text-sky-50/82' });
        if (coverage.moreAvailable || (coverage.pages && !coverage.fullLoaded && !coverage.limited && !coverage.rateLimited)) badges.push({ label: 'Partial History', className: 'border-yellow-200/18 bg-yellow-300/10 text-yellow-50/78' });
        if (coverage.fullLoaded && !coverage.limited && !coverage.rateLimited) badges.push({ label: 'Likely Complete (best effort)', className: 'border-emerald-200/18 bg-emerald-300/10 text-emerald-50/78' });
        if (state.history.lastStatus === 'provider_unavailable') badges.push({ label: 'provider unavailable', className: 'border-yellow-200/18 bg-yellow-300/10 text-yellow-50/78' });
        if (!state.history.providerConfigured && state.history.pagesLoaded > 0) badges.push({ label: 'provider unconfirmed', className: 'border-white/12 bg-white/[0.045] text-white/58' });
        return badges;
    }

    function isWalletHistoryLimitedByProvider() {
        const metadata = state.history.lastMetadata || {};
        return state.history.lastStatus === 'provider_limited'
            || metadata.limited_by_provider === true
            || metadata.provider_limit_reached === true
            || metadata.history_coverage === 'limited_by_provider';
    }

    function getWalletHistoryScanManifest() {
        const manifest = state.history.scanManifest || state.history.lastMetadata?.scan_manifest || null;
        return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
    }

    function getWalletHistoryScanCache() {
        const cache = state.history.scanCache
            || state.history.lastMetadata?.scan_cache
            || getWalletHistoryScanManifest().cache_state
            || null;
        return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
    }

    function getWalletHistoryReplayReconstruction() {
        const reconstruction = state.history.replayReconstruction
            || state.history.lastMetadata?.replay_reconstruction
            || getWalletHistoryScanManifest().replay_reconstruction
            || null;
        return reconstruction && typeof reconstruction === 'object' && !Array.isArray(reconstruction) ? reconstruction : {};
    }

    function getWalletHistoryCompletenessConfidence() {
        const manifest = getWalletHistoryScanManifest();
        const value = manifest.completeness_confidence
            ?? state.history.lastMetadata?.completeness_confidence
            ?? getWalletHistoryProviderDiagnostics().completeness_confidence
            ?? 0;
        return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    }

    function getWalletHistoryReplayCoverage() {
        const replayWindow = state.history.replayWindow || state.history.lastMetadata?.replay_window || {};
        const value = replayWindow.coverage_pct ?? getWalletHistoryScanManifest().replay_coverage_pct;
        if (Number.isFinite(Number(value))) return Math.max(0, Math.min(100, Math.round(Number(value))));
        const tx = Math.max(0, Number(state.history.totalLoadedTransactions) || 0);
        if (!tx) return 0;
        if (getWalletHistoryScanManifest().full_history_loaded === true) return 100;
        return Math.min(88, 18 + Math.floor(Math.log10(tx + 1) * 28));
    }

    function getWalletHistoryProviderGrade() {
        return String(
            state.history.lastMetadata?.provider_grade
            || getWalletHistoryScanManifest().provider_grade
            || getWalletHistoryProviderDiagnostics().provider_grade
            || 'basic'
        );
    }

    function getWalletHistoryReplaySuitability() {
        return String(
            state.history.lastMetadata?.replay_suitability
            || getWalletHistoryScanManifest().replay_suitability
            || getWalletHistoryProviderDiagnostics().replay_suitability
            || 'low'
        );
    }

    function getWalletHistoryArchiveReadiness() {
        return String(
            state.history.lastMetadata?.archive_readiness
            || getWalletHistoryProviderDiagnostics().archive_readiness
            || 'unknown'
        ).replaceAll('_', ' ');
    }

    function getWalletHistoryGapFlags() {
        return mergeUiStringLists(
            state.history.gapFlags,
            state.history.lastMetadata?.gap_flags,
            getWalletHistoryScanManifest().gap_flags
        );
    }

    function getWalletHistoryWarnings() {
        return mergeUiStringLists(
            state.history.warnings,
            state.history.lastMetadata?.warnings,
            getWalletHistoryScanManifest().warnings
        );
    }

    function formatHistoryFlag(value = '') {
        return String(value || '').replaceAll('_', ' ');
    }

    function getWalletHistoryStuckMessage() {
        if (state.history.lastStatus === 'provider_rate_limited') return 'History pagination is rate limited. Wait before retrying; full history is not loaded.';
        if (isWalletHistoryLimitedByProvider()) return 'History pagination is limited by the provider. No additional safe cursor is available.';
        if (state.history.lastStatus === 'provider_unavailable') return 'History provider is unavailable for the next page. No data was merged.';
        return 'No additional Worker history cursor is staged. Full wallet-history completeness is not guaranteed.';
    }

    function renderWalletIntelligencePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) return '';
        const intelligence = buildWalletIntelligence();
        const emptyState = getWalletLookupEmptyStateDetails(intelligence);
        const depthNote = getWalletDepthExpansionNote();
        return `
            <details class="crypto-collapse crypto-intelligence-collapse" open>
                <summary>
                    <span>Wallet Intelligence</span>
                    <span>${escapeHtml(intelligence.visibleLegs)} visible legs</span>
                </summary>
                <div class="crypto-collapse-body">
            <div class="rounded-2xl border border-emerald-200/18 bg-emerald-300/10 p-3 sm:p-4">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                        <div class="text-white/38">WALLET INTELLIGENCE</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/86">Wallet Lookup Readout</div>
                        <div class="mt-1 max-w-2xl text-white/58 leading-relaxed">Secure Worker activity only. The visible graph shows wallet/address relationships observed in transfer data; it does not make identity claims about people, entities, or ownership.</div>
                    </div>
                    <div class="shrink-0 flex flex-wrap items-center gap-2">
                        ${renderWalletInvestigationReportAction()}
                        ${renderWalletLookupStatusBadge(intelligence.lookupStatus)}
                    </div>
                </div>
                ${renderWalletLookupConfidenceStatus(intelligence)}
                ${renderWalletActionableInsights(intelligence)}
                ${emptyState ? renderWalletEmptyStateCard(emptyState) : ''}
                ${depthNote ? renderWalletDepthNoteCard(depthNote) : ''}
                ${renderWalletHistoryBrowserPanel()}
                ${renderWalletHistoryGraphPreviewPanel()}
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
                </div>
            </details>
        `;
    }

    function renderInvestigationWorkspace() {
        const activeTab = getInvestigationTab();
        return `
            <section class="crypto-investigation-workspace" aria-label="CryptoPhotonic investigation workspace">
                <div class="crypto-investigation-header">
                    <div class="min-w-0">
                        <div class="crypto-kicker">INVESTIGATION WORKSPACE</div>
                        <h2>Wallet Lookup Workspace</h2>
                        <p>${escapeHtml(getInvestigationWorkspaceSubtitle())}</p>
                    </div>
                    ${state.dataMode === DATA_MODES.WALLET ? renderWalletInvestigationReportAction() : ''}
                </div>
                <div class="crypto-investigation-tabs" role="tablist" aria-label="Investigation sections">
                    ${getInvestigationTabs().map(tab => renderInvestigationTabButton(tab, activeTab)).join('')}
                </div>
                <div class="crypto-investigation-content" role="tabpanel" aria-labelledby="crypto-investigation-tab-${escapeAttr(activeTab)}">
                    ${renderInvestigationTabContent(activeTab)}
                </div>
            </section>
        `;
    }

    function getInvestigationTabs() {
        return [
            { id: 'summary', label: 'Summary' },
            { id: 'flows', label: 'Flows' },
            { id: 'history', label: 'History' },
            { id: 'replay', label: 'Replay' },
            { id: 'details', label: 'Details' }
        ];
    }

    function getInvestigationTab() {
        const tabs = new Set(getInvestigationTabs().map(tab => tab.id));
        if (!tabs.has(state.investigationTab)) state.investigationTab = 'summary';
        return state.investigationTab;
    }

    function setInvestigationTab(tab) {
        const tabs = new Set(getInvestigationTabs().map(item => item.id));
        state.investigationTab = tabs.has(tab) ? tab : 'summary';
        renderDetails();
        return state.investigationTab;
    }

    function renderInvestigationTabButton(tab, activeTab) {
        const active = tab.id === activeTab;
        const hasSelection = tab.id === 'details' && Boolean(state.selectedId || state.selectedFlowId || state.historyPreview.selectedEvent);
        return `
            <button id="crypto-investigation-tab-${escapeAttr(tab.id)}" type="button" role="tab" aria-selected="${active ? 'true' : 'false'}" data-has-selection="${hasSelection ? 'true' : 'false'}" data-crypto-investigation-tab="${escapeAttr(tab.id)}" class="crypto-investigation-tab">
                ${escapeHtml(tab.label)}${hasSelection ? '<span class="crypto-tab-selection-dot" aria-hidden="true"></span>' : ''}
            </button>
        `;
    }

    function getInvestigationWorkspaceSubtitle() {
        if (state.dataMode === DATA_MODES.WALLET) {
            const intelligence = buildWalletIntelligence();
            return `${intelligence.visibleLegs} visible flow legs from the current Worker wallet lookup. History and replay stay staged and preview-only.`;
        }
        if (state.dataMode === DATA_MODES.LIVE) return 'Live Feed mode is active. Use Wallet Lookup for staged history and replay investigation tools.';
        return 'Generated Fixture mode is active. Use Wallet Lookup to replace the graph with a Worker response and unlock history/replay drill-downs.';
    }

    function renderInvestigationTabContent(tab) {
        if (tab === 'flows') return renderWalletFlowsWorkspacePanel();
        if (tab === 'history') return renderWalletHistoryWorkspacePanel();
        if (tab === 'replay') return renderWalletReplayWorkspacePanel();
        if (tab === 'details') return renderInvestigationDetailsPanelContent();
        return renderWalletSummaryWorkspacePanel();
    }

    function renderGuidedActionGrid(actions = [], options = {}) {
        const helper = namespace.historyWorkspace?.renderGuidedActionGrid;
        if (helper) {
            return helper(actions, options, {
                getAttributes: getGuidedActionAttributes,
                emptyHtml: renderWalletInlineEmpty('No guided actions are available for the current graph state.')
            });
        }
        const title = options.title || 'Guided Next Actions';
        const subtitle = options.subtitle || '';
        const available = actions.filter(Boolean);
        return `
            <section class="crypto-guided-actions crypto-workspace-card">
                <div class="crypto-card-heading">
                    <div>
                        <span>${escapeHtml(title)}</span>
                        ${subtitle ? `<div class="mt-1 text-white/48 leading-relaxed">${escapeHtml(subtitle)}</div>` : ''}
                    </div>
                    <span>${escapeHtml(available.length)} action${available.length === 1 ? '' : 's'}</span>
                </div>
                <div class="crypto-guided-action-grid">
                    ${available.map(renderGuidedActionCard).join('') || renderWalletInlineEmpty('No guided actions are available for the current graph state.')}
                </div>
            </section>
        `;
    }

    function renderGuidedActionCard(action = {}) {
        const helper = namespace.historyWorkspace?.renderGuidedActionCard;
        if (helper) {
            return helper(action, { getAttributes: getGuidedActionAttributes });
        }
        const attrs = getGuidedActionAttributes(action);
        const disabled = action.disabled || !attrs ? 'disabled' : '';
        const tone = action.tone === 'strong'
            ? 'is-strong'
            : action.tone === 'warn'
                ? 'is-warn'
                : '';
        return `
            <button type="button" ${attrs} ${disabled} title="${escapeAttr(action.titleText || action.detail || action.title || '')}" class="crypto-guided-action ${tone}">
                <span class="crypto-guided-action-label">${escapeHtml(action.title || 'Open')}</span>
                <span class="crypto-guided-action-detail">${escapeHtml(action.detail || '')}</span>
            </button>
        `;
    }

    function getGuidedActionAttributes(action = {}) {
        if (action.flowId) {
            return `data-crypto-flow-id="${escapeAttr(action.flowId)}" data-crypto-open-details="true"`;
        }
        if (action.walletAddress) {
            return `data-crypto-wallet-address="${escapeAttr(action.walletAddress)}" data-crypto-open-details="true"`;
        }
        if (action.tab) {
            return `data-crypto-investigation-tab-target="${escapeAttr(action.tab)}"`;
        }
        if (action.historyAction) {
            return `data-crypto-history-action="${escapeAttr(action.historyAction)}"`;
        }
        if (action.tokenFilter) {
            return `data-crypto-token-filter="${escapeAttr(action.tokenFilter)}"`;
        }
        if (action.tokenIsolation) {
            return `data-crypto-token-isolation="${escapeAttr(action.tokenIsolation)}"`;
        }
        if (action.clearTokenIsolation) {
            return 'data-crypto-token-isolation="all"';
        }
        if (action.depth) {
            return `data-crypto-depth="${escapeAttr(action.depth)}"`;
        }
        return '';
    }

    function renderMobileInvestigationDrawer() {
        const drawer = state.mobileDrawer;
        if (!drawer || !state.graph) return;
        const drawerState = normalizeMobileDrawerState(state.mobileDrawerState);
        state.mobileDrawerState = drawerState;
        drawer.dataset.state = drawerState;
        MOBILE_DRAWER_STATES.forEach(stateName => {
            drawer.classList.toggle(`is-${stateName}`, drawerState === stateName);
        });
        drawer.setAttribute('aria-expanded', drawerState === 'expanded' ? 'true' : 'false');

        const selection = getMobileSelectedSummary();
        const activeTab = getInvestigationTab();
        drawer.innerHTML = `
            <div class="crypto-mobile-drawer-inner">
                <button type="button" class="crypto-mobile-drawer-handle" data-crypto-mobile-drawer-cycle aria-label="Change investigation drawer height"></button>
                <div class="crypto-mobile-drawer-topline">
                    <div class="crypto-mobile-drawer-title">
                        <div class="crypto-mobile-drawer-kicker">${escapeHtml(selection.kicker)}</div>
                        <div class="crypto-mobile-drawer-name">${escapeHtml(selection.title)}</div>
                        <div class="crypto-mobile-drawer-meta">${escapeHtml(selection.meta)}</div>
                    </div>
                    <div class="crypto-mobile-drawer-state-controls" role="group" aria-label="Drawer height">
                        ${MOBILE_DRAWER_STATES.map(stateName => `
                            <button type="button" class="crypto-mobile-drawer-button" data-crypto-mobile-drawer-state="${escapeAttr(stateName)}" aria-pressed="${drawerState === stateName ? 'true' : 'false'}">${escapeHtml(getMobileDrawerStateLabel(stateName))}</button>
                        `).join('')}
                    </div>
                </div>
                <div class="crypto-mobile-drawer-shortcuts" role="group" aria-label="Investigation shortcuts">
                    ${renderMobileDrawerShortcut('summary', 'Summary', activeTab)}
                    ${renderMobileDrawerShortcut('details', 'Details', activeTab)}
                    ${renderMobileDrawerShortcut('flows', 'Flows', activeTab)}
                </div>
                ${selection.hasSelection ? renderMobileDrawerSelection(selection) : renderMobileDrawerEmpty(selection)}
            </div>
        `;
        bindMobileInvestigationDrawerControls(drawer);
    }

    function bindMobileInvestigationDrawerControls(drawer) {
        drawer.querySelectorAll('[data-crypto-mobile-drawer-state]').forEach(button => {
            button.addEventListener('click', () => setMobileDrawerState(button.dataset.cryptoMobileDrawerState || 'half'));
        });
        drawer.querySelector('[data-crypto-mobile-drawer-cycle]')?.addEventListener('click', () => {
            const index = MOBILE_DRAWER_STATES.indexOf(state.mobileDrawerState);
            setMobileDrawerState(MOBILE_DRAWER_STATES[(index + 1) % MOBILE_DRAWER_STATES.length] || 'half');
        });
        drawer.querySelectorAll('[data-crypto-investigation-tab-target]').forEach(button => {
            button.addEventListener('click', () => {
                setInvestigationTab(button.dataset.cryptoInvestigationTabTarget || 'summary');
                if (button.dataset.cryptoInvestigationTabTarget === 'details') setMobileDrawerState('expanded');
            });
        });
        drawer.querySelectorAll('[data-crypto-mobile-open-details]').forEach(button => {
            button.addEventListener('click', openMobileDetailsPanel);
        });
        drawer.querySelectorAll('[data-crypto-copy-value]').forEach(button => {
            button.addEventListener('click', () => copyGuidedValue(button.dataset.cryptoCopyValue || '', button));
        });
    }

    function renderMobileDrawerShortcut(tab, label, activeTab) {
        return `
            <button type="button" class="crypto-mobile-drawer-button" data-crypto-investigation-tab-target="${escapeAttr(tab)}" aria-pressed="${activeTab === tab ? 'true' : 'false'}">
                ${escapeHtml(label)}
            </button>
        `;
    }

    function renderMobileDrawerSelection(selection) {
        return `
            <section class="crypto-mobile-drawer-selected" aria-label="Selected object summary">
                <div class="crypto-mobile-drawer-summary-grid">
                    ${selection.stats.map(item => `
                        <div class="crypto-mobile-drawer-stat">
                            <span>${escapeHtml(item.label)}</span>
                            <strong>${escapeHtml(item.value)}</strong>
                        </div>
                    `).join('')}
                </div>
                <div class="crypto-mobile-drawer-actions">
                    <button type="button" class="crypto-mobile-drawer-button" data-crypto-mobile-open-details="true">Full Details</button>
                    ${selection.copyActions.map(action => `
                        <button type="button" class="crypto-mobile-drawer-button" data-crypto-copy-value="${escapeAttr(action.value)}">${escapeHtml(action.label)}</button>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderMobileDrawerEmpty(selection) {
        return `
            <div class="crypto-mobile-drawer-empty">
                ${escapeHtml(selection.emptyCopy)}
            </div>
        `;
    }

    function getMobileSelectedSummary() {
        const selectedFlow = getSelectedFlowEdge();
        if (selectedFlow) return getMobileFlowSummary(selectedFlow);

        const node = state.selectedId ? state.graph?.nodeById.get(state.selectedId) : null;
        if (node) return getMobileNodeSummary(node);

        if (state.historyPreview.selectedEvent) {
            return getMobileReplayEventSummary(state.historyPreview.selectedEvent);
        }

        const flowCount = getVisibleFlowEdges().length;
        return {
            hasSelection: false,
            kicker: 'INVESTIGATION DRAWER',
            title: `${flowCount} visible flow${flowCount === 1 ? '' : 's'}`,
            meta: 'Tap a node or transfer leg to pin its summary here.',
            emptyCopy: 'Summary, Details, and Flows stay one tap away while the graph remains the main touch target.',
            stats: [getMobileSemanticStat()],
            copyActions: []
        };
    }

    function getMobileFlowSummary(edge) {
        const source = state.graph?.nodeById.get(edge.source);
        const target = state.graph?.nodeById.get(edge.target);
        const signature = edge.transaction_hash || edge.signature || '';
        return {
            hasSelection: true,
            kicker: 'SELECTED FLOW',
            title: `${getNormalizedFlowAmountDisplay(edge)} ${edge.symbol || ''}`.trim(),
            meta: `${compactNodeLabel(source)} -> ${compactNodeLabel(target)}`,
            stats: [
                getMobileSemanticStat(),
                { label: 'Direction', value: formatFlowDirectionRelativeToTracked(edge) },
                { label: 'Value', value: edge.usd_value ? core.formatUsd(edge.usd_value) : '-' },
                { label: 'Type', value: edge.transaction_type_label || edge.flow_role || 'Flow' },
                { label: 'Signature', value: signature ? shortHash(signature) : '-' }
            ],
            copyActions: [
                { label: 'Copy Summary', value: buildSelectedFlowSummary(edge) },
                signature ? { label: 'Copy Signature', value: signature } : null,
                { label: 'Copy Source', value: getFlowSourceAddress(edge) },
                { label: 'Copy Destination', value: getFlowTargetAddress(edge) }
            ].filter(action => action?.value)
        };
    }

    function getMobileNodeSummary(node) {
        const address = node.address || node.token_mint || '';
        const relatedFlows = getRelatedEdges(node.id, core.EDGE_TYPES.FLOW).filter(edgeMatchesActiveFilters);
        const relatedHubFlows = isHubNode(node) ? getRelatedHubFlows(node).filter(edgeMatchesActiveFilters) : [];
        const visibleFlowCount = mergeUniqueEdges([...relatedFlows, ...relatedHubFlows]).length;
        const exposure = Number(node.exposure_usd || node.aggregate_value_usd) > 0
            ? core.formatUsd(node.exposure_usd || node.aggregate_value_usd)
            : '-';
        return {
            hasSelection: true,
            kicker: getNodeRoleLabel(node).toUpperCase(),
            title: compactNodeLabel(node),
            meta: address ? shortLongValue(address) : describeWalletRelationship(node),
            stats: [
                getMobileSemanticStat(),
                { label: 'Role', value: describeWalletRelationship(node) },
                { label: 'Flows', value: `${visibleFlowCount}` },
                { label: 'Exposure', value: exposure },
                { label: 'Chain', value: node.chain || 'solana' }
            ],
            copyActions: [
                address ? { label: node.type === core.NODE_TYPES.TOKEN ? 'Copy Mint' : 'Copy Address', value: address } : null
            ].filter(Boolean)
        };
    }

    function getMobileReplayEventSummary(event = {}) {
        const signature = event.signature || event.transaction_hash || '';
        const sourceWallet = event.sourceWallet || event.source_wallet || '';
        const destinationWallet = event.destinationWallet || event.destination_wallet || '';
        return {
            hasSelection: true,
            kicker: 'REPLAY EVENT',
            title: `Step ${event.step || '-'} / ${getHistoryReplayAmountTokenLabel(event)}`,
            meta: 'Preview dataset only. Active graph unchanged.',
            stats: [
                getMobileSemanticStat(),
                { label: 'Direction', value: getHistoryReplayDirectionLabel(event.direction) },
                { label: 'Time', value: event.timestamp ? formatPreviewTimestamp(event.timestamp) : '-' },
                { label: 'Source', value: sourceWallet ? shortLongValue(sourceWallet) : '-' },
                { label: 'Destination', value: destinationWallet ? shortLongValue(destinationWallet) : '-' }
            ],
            copyActions: [
                { label: 'Copy Event', value: buildReplayEventSummary(event) },
                signature ? { label: 'Copy Signature', value: signature } : null
            ].filter(Boolean)
        };
    }

    function getMobileSemanticStat() {
        const semantic = state.semanticZoom || getCryptoSemanticZoomState();
        return {
            label: 'Detail',
            value: semantic.tierLabel || 'Graph'
        };
    }

    function setMobileDrawerState(nextState, options = {}) {
        state.mobileDrawerState = normalizeMobileDrawerState(nextState);
        if (!options.skipRender) renderMobileInvestigationDrawer();
        return state.mobileDrawerState;
    }

    function openMobileDrawerForSelection(preferredState = 'half') {
        if (!isMobileViewport()) return;
        setMobileDrawerState(preferredState, { skipRender: true });
    }

    function normalizeMobileDrawerState(nextState) {
        return MOBILE_DRAWER_STATES.includes(nextState) ? nextState : 'collapsed';
    }

    function getMobileDrawerStateLabel(stateName) {
        if (stateName === 'expanded') return 'Full';
        if (stateName === 'half') return 'Half';
        return 'Min';
    }

    function openMobileDetailsPanel() {
        setInvestigationTab('details');
        setMobileDrawerState('expanded');
        return state.investigationTab;
    }

    function renderWalletSummaryWorkspacePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) return renderNonWalletSummaryWorkspacePanel();
        const intelligence = buildWalletIntelligence();
        const emptyState = getWalletLookupEmptyStateDetails(intelligence);
        const topCounterparty = intelligence.mostActiveCounterparty
            ? `${shortLongValue(intelligence.mostActiveCounterparty.address)} (${intelligence.mostActiveCounterparty.count}x)`
            : '-';
        const topToken = intelligence.mostActiveToken
            ? `${intelligence.mostActiveToken.symbol} (${intelligence.mostActiveToken.count} leg${intelligence.mostActiveToken.count === 1 ? '' : 's'})`
            : '-';
        const summaryRows = [
            ['Tracked Wallet', intelligence.trackedWallet ? shortLongValue(intelligence.trackedWallet) : '-', intelligence.trackedWallet || 'No tracked wallet loaded.'],
            ['Visible Flows', intelligence.visibleLegs, 'Visible flow legs under the active filters.'],
            ['Top Counterparty', topCounterparty, intelligence.mostActiveCounterparty?.address || topCounterparty],
            ['Top Token', topToken, 'Most active token in visible normalized flows.'],
            ['Provider', getWalletHistoryProviderStateDisplay(), getWalletHistoryConfigurationTitle()],
            ['Replay', getHistoryReplayStateLabel(getHistoryReplayStatus(), Boolean(state.historyPreview.dataset), isHistoryPreviewDatasetStale()), 'Preview replay state.']
        ];
        return `
            <div class="crypto-tab-section crypto-summary-section">
                ${emptyState ? renderWalletEmptyStateCard(emptyState) : ''}
                ${renderGuidedActionGrid(buildSummaryGuidedActions(intelligence), {
                    title: 'Guided Investigation',
                    subtitle: 'Start with the largest movement, the most repeated counterparty, then stage history and replay only when needed.'
                })}
                <div class="grid gap-1.5">
                    ${summaryRows.map(([label, value, title]) => renderWalletHistoryStatusRow(label, value, title)).join('')}
                </div>
                <div class="crypto-summary-note">
                    ${escapeHtml(getWalletHistoryNotice())}
                </div>
                <details class="crypto-collapse crypto-intelligence-collapse">
                    <summary>
                        <span>More Summary Metrics</span>
                        <span>${escapeHtml(intelligence.sourceLabel)}</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        <div class="crypto-summary-grid">
                            ${renderWorkspaceMetric('Source', intelligence.sourceLabel)}
                            ${renderWorkspaceMetric('Last Loaded', intelligence.lastLoadedLabel)}
                            ${renderWorkspaceMetric('Noise Removed', intelligence.filteredLegs, { title: getWalletFilteredLegCopy(intelligence.filteredLegs) })}
                            ${renderWorkspaceMetric('Dominant Direction', intelligence.dominantDirection?.label || '-')}
                            ${renderWorkspaceMetric('Largest Normalized Flow', intelligence.largestFlow)}
                            ${renderWorkspaceMetric('History Cache', getWalletHistoryCacheDisplay(), { title: getWalletHistoryCacheTitle() })}
                        </div>
                    </div>
                </details>
            </div>
        `;
    }

    function buildSummaryGuidedActions(intelligence = {}) {
        const actions = [];
        actions.push({
            title: 'Inspect largest flow',
            detail: intelligence.largestFlowEdge
                ? `${intelligence.largestFlow} / ${formatFlowDirectionRelativeToTracked(intelligence.largestFlowEdge)}`
                : 'No visible flow is available under the current filters.',
            flowId: intelligence.largestFlowEdge?.id || '',
            disabled: !intelligence.largestFlowEdge,
            tone: intelligence.largestFlowEdge ? 'strong' : 'idle'
        });
        actions.push({
            title: 'Review top counterparty',
            detail: intelligence.mostActiveCounterparty
                ? `${shortLongValue(intelligence.mostActiveCounterparty.address)} / ${intelligence.mostActiveCounterparty.count} visible leg${intelligence.mostActiveCounterparty.count === 1 ? '' : 's'}`
                : 'No counterparty address is ranked yet.',
            walletAddress: intelligence.mostActiveCounterparty?.address || '',
            disabled: !intelligence.mostActiveCounterparty,
            tone: intelligence.mostActiveCounterparty ? 'strong' : 'idle'
        });
        actions.push({
            title: 'Open History',
            detail: state.history.pagesLoaded
                ? `${state.history.totalLoadedTransactions || state.history.loadedTransactions.length} staged row${(state.history.totalLoadedTransactions || state.history.loadedTransactions.length) === 1 ? '' : 's'} available.`
                : 'Load or review staged history without changing the graph.',
            tab: 'history'
        });
        actions.push({
            title: 'Open Replay',
            detail: state.historyPreview.dataset
                ? 'Preview dataset is ready for static graph or replay.'
                : 'Build a preview dataset before animation.',
            tab: 'replay'
        });
        return actions;
    }

    function renderNonWalletSummaryWorkspacePanel() {
        const visibleFlows = getVisibleFlowEdges();
        return `
            <div class="crypto-tab-section">
                <div class="crypto-empty-state">
                    <div class="crypto-kicker">GRAPH-FIRST MODE</div>
                    <h3>${escapeHtml(getCurrentSourceLabel())}</h3>
                    <p>Use Wallet Lookup to replace the graph with a secure Worker response. History, replay, and report tools stay separate from Generated Fixture and Live Feed data.</p>
                </div>
                <div class="crypto-summary-grid">
                    ${renderWorkspaceMetric('Source', getCurrentSourceLabel())}
                    ${renderWorkspaceMetric('Visible Flows', visibleFlows.length)}
                    ${renderWorkspaceMetric('Wallet Nodes', state.graph?.walletNodes?.length || 0)}
                    ${renderWorkspaceMetric('Token Nodes', state.graph?.tokenNodes?.length || 0)}
                </div>
            </div>
        `;
    }

    function renderWalletFlowsWorkspacePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) {
            return `
                <div class="crypto-tab-section">
                    <div class="crypto-empty-state">
                        <div class="crypto-kicker">FLOWS</div>
                        <h3>Wallet Lookup required</h3>
                        <p>Switch to Wallet Lookup and load a wallet to rank counterparties, summarize token movement, and inspect the visible flow timeline.</p>
                    </div>
                </div>
            `;
        }
        const intelligence = buildWalletIntelligence();
        const depthNote = getWalletDepthExpansionNote();
        return `
            <div class="crypto-tab-section">
                ${renderGuidedActionGrid(buildFlowsGuidedActions(intelligence), {
                    title: 'Flow Drill-Down',
                    subtitle: 'Use explicit inspect actions to open Details; list selections stay in this tab for comparison.'
                })}
                ${renderWalletActionableInsights(intelligence)}
                ${depthNote ? renderWalletDepthNoteCard(depthNote) : ''}
                <section class="crypto-workspace-card">
                    <div class="crypto-card-heading">
                        <span>Top Counterparties</span>
                        <span>${escapeHtml(Math.min(intelligence.counterparties.length, WALLET_INTELLIGENCE_LIMITS.counterparties))} shown</span>
                    </div>
                    <div class="crypto-card-list">
                        ${intelligence.counterparties.slice(0, WALLET_INTELLIGENCE_LIMITS.counterparties).map(renderCounterpartyRankRow).join('') || renderWalletInlineEmpty('No visible counterparty wallet addresses after filters.')}
                    </div>
                </section>
                <details class="crypto-collapse crypto-intelligence-collapse">
                    <summary>
                        <span>Token Flow Summary</span>
                        <span>${escapeHtml(Math.min(intelligence.tokens.length, WALLET_INTELLIGENCE_LIMITS.tokens))} shown</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        <div class="crypto-two-column-list">
                            ${intelligence.tokens.slice(0, WALLET_INTELLIGENCE_LIMITS.tokens).map(renderTokenFlowSummaryRow).join('') || renderWalletInlineEmpty('No token flow summary is available for the visible wallet graph.')}
                        </div>
                    </div>
                </details>
                <details class="crypto-collapse crypto-intelligence-collapse">
                    <summary>
                        <span>Flow Timeline</span>
                        <span>${escapeHtml(Math.min((intelligence.timeline || []).length, WALLET_INTELLIGENCE_LIMITS.timeline))} rows</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        ${renderWalletTimelineSection(intelligence.timeline)}
                    </div>
                </details>
            </div>
        `;
    }

    function buildFlowsGuidedActions(intelligence = {}) {
        const selectedFlow = getSelectedFlowEdge();
        const selectedNode = state.selectedId ? state.graph?.nodeById.get(state.selectedId) : null;
        const selectedAddress = selectedNode?.type === core.NODE_TYPES.WALLET ? selectedNode.address : '';
        const actions = [];
        actions.push({
            title: selectedFlow ? 'Inspect selected flow' : 'Select largest flow',
            detail: selectedFlow
                ? `${getNormalizedFlowAmountDisplay(selectedFlow)} / ${formatFlowDirectionRelativeToTracked(selectedFlow)}`
                : intelligence.largestFlowEdge
                    ? `${intelligence.largestFlow} / ${formatFlowDirectionRelativeToTracked(intelligence.largestFlowEdge)}`
                    : 'No visible flow can be selected yet.',
            flowId: selectedFlow?.id || intelligence.largestFlowEdge?.id || '',
            disabled: !(selectedFlow || intelligence.largestFlowEdge),
            tone: selectedFlow || intelligence.largestFlowEdge ? 'strong' : 'idle'
        });
        actions.push({
            title: selectedAddress ? 'Inspect selected counterparty' : 'Review top counterparty',
            detail: selectedAddress
                ? `${shortLongValue(selectedAddress)} is selected in the graph.`
                : intelligence.mostActiveCounterparty
                    ? `${shortLongValue(intelligence.mostActiveCounterparty.address)} / ${intelligence.mostActiveCounterparty.relationship}`
                    : 'No ranked counterparty is available.',
            walletAddress: selectedAddress || intelligence.mostActiveCounterparty?.address || '',
            disabled: !(selectedAddress || intelligence.mostActiveCounterparty),
            tone: selectedAddress || intelligence.mostActiveCounterparty ? 'strong' : 'idle'
        });
        actions.push({
            title: 'Open selected details',
            detail: selectedFlow
                ? 'Details will show the selected flow profile and copy actions.'
                : selectedNode
                    ? 'Details will show the selected node profile and related visible flows.'
                    : 'Select a node or flow first.',
            tab: 'details',
            disabled: !(selectedFlow || selectedNode)
        });
        const tokenIsolation = getPreferredTokenIsolationAction(intelligence, selectedFlow, selectedNode);
        actions.push(tokenIsolation);
        return actions;
    }

    function getPreferredTokenIsolationAction(intelligence = {}, selectedFlow = null, selectedNode = null) {
        if (state.tokenIsolation !== 'all') {
            return {
                title: 'Show all tokens',
                detail: `${getTokenIsolationLabel(state.tokenIsolation)} isolation is active; restore full flow context.`,
                clearTokenIsolation: true
            };
        }
        const tokenFromNode = getTokenIsolationFromNode(selectedNode);
        const tokenKey = selectedFlow ? getTokenKeyForEdge(selectedFlow) : tokenFromNode.key || intelligence.mostActiveToken?.filterKey || '';
        const tokenLabel = selectedFlow
            ? (selectedFlow.symbol || shortLongValue(selectedFlow.token_mint) || 'selected token')
            : tokenFromNode.label || intelligence.mostActiveToken?.symbol || '';
        return {
            title: 'Isolate token flows',
            detail: tokenKey
                ? `Fade other flow edges and focus ${tokenLabel || 'this token'}.`
                : 'Select a token or flow before isolating token movement.',
            tokenIsolation: tokenKey,
            disabled: !tokenKey,
            tone: tokenKey ? 'strong' : 'idle'
        };
    }

    function getTokenIsolationFromNode(node = null) {
        if (!node || node.type !== core.NODE_TYPES.TOKEN) return { key: '', label: '' };
        return {
            key: `${node.token_mint || ''}|${node.symbol || ''}`,
            label: node.symbol || node.name || 'token'
        };
    }

    function getTokenIsolationLabel(tokenKey = state.tokenIsolation) {
        if (!tokenKey || tokenKey === 'all') return 'All tokens';
        const [, symbol = ''] = String(tokenKey).split('|');
        if (symbol) return symbol;
        const tokenNode = (state.graph?.tokenNodes || []).find(node => `${node.token_mint || ''}|${node.symbol || ''}` === tokenKey);
        return tokenNode?.symbol || shortLongValue(String(tokenKey).split('|')[0]) || 'Selected token';
    }

    function renderWalletHistoryWorkspacePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) {
            return `
                <div class="crypto-tab-section">
                    <div class="crypto-empty-state">
                        <div class="crypto-kicker">HISTORY</div>
                        <h3>Staged history is wallet-only</h3>
                        <p>Load a Wallet Lookup response first. Additional pages are staged through the Worker wallet-history endpoint and are never merged into the active graph.</p>
                    </div>
                </div>
            `;
        }
        return `
            <div class="crypto-tab-section">
                ${renderGuidedActionGrid(buildHistoryGuidedActions(), {
                    title: 'History Staging Actions',
                    subtitle: 'History stays staged through the Worker. Preview datasets are separate artifacts and never merge into the active graph.'
                })}
                ${renderWalletHistoryBrowserPanel()}
            </div>
        `;
    }

    function buildHistoryGuidedActions() {
        const rowCount = state.history.loadedTransactions.length;
        const hasDataset = Boolean(state.historyPreview.dataset);
        return [
            {
                title: 'Build preview dataset',
                detail: rowCount
                    ? `${rowCount} staged row${rowCount === 1 ? '' : 's'} can be converted for preview.`
                    : 'Build a dataset shell, then load history rows for transfer steps.',
                historyAction: 'build-dataset',
                disabled: state.history.inFlight,
                tone: rowCount ? 'strong' : 'idle'
            },
            {
                title: 'Open Replay',
                detail: hasDataset
                    ? 'Preview dataset is ready for static graph and replay controls.'
                    : 'Open the replay sandbox when you are ready to build or render.',
                tab: 'replay',
                tone: hasDataset ? 'strong' : 'idle'
            },
            {
                title: 'Load more history',
                detail: state.history.moreAvailable
                    ? 'Fetch the next Worker history page into staging only.'
                    : 'No additional cursor is currently staged.',
                historyAction: 'load-more',
                disabled: isWalletHistoryLoadMoreDisabled(),
                tone: state.history.moreAvailable ? 'strong' : 'idle'
            }
        ];
    }

    function renderWalletReplayWorkspacePanel() {
        if (state.dataMode !== DATA_MODES.WALLET) {
            return `
                <div class="crypto-tab-section">
                    <div class="crypto-empty-state">
                        <div class="crypto-kicker">REPLAY</div>
                        <h3>Preview-only replay is wallet-only</h3>
                        <p>Build a preview dataset from staged Wallet Lookup history before rendering the separate static graph or animation canvas.</p>
                    </div>
                </div>
            `;
        }
        return `
            <div class="crypto-tab-section">
                ${renderGuidedActionGrid(buildReplayGuidedActions(), {
                    title: 'Replay Investigation Actions',
                    subtitle: 'Replay controls operate on the preview dataset canvas only; inspected events are not added to the active graph.'
                })}
                ${renderWalletHistoryGraphPreviewPanel()}
            </div>
        `;
    }

    function buildReplayGuidedActions() {
        const status = getHistoryReplayStatus();
        const hasDataset = Boolean(state.historyPreview.dataset);
        const currentStep = Number(status.currentStep) || 0;
        const totalSteps = getHistoryReplayTotalSteps(status);
        return [
            {
                title: 'Inspect current event',
                detail: currentStep
                    ? `Step ${currentStep}/${totalSteps || status.totalSteps || 0} / ${getHistoryReplayAmountTokenLabel(status)}`
                    : 'Step, scrub, or start replay before inspecting an event.',
                historyAction: 'inspect-replay-event',
                disabled: !hasDataset || !currentStep,
                tone: hasDataset && currentStep ? 'strong' : 'idle'
            },
            {
                title: hasDataset ? 'Start preview replay' : 'Build preview dataset',
                detail: hasDataset
                    ? 'Animate the separate preview canvas without changing Wallet Lookup.'
                    : 'Create graph-ready staged data before animation.',
                historyAction: hasDataset ? 'start-replay' : 'build-dataset',
                disabled: state.history.inFlight,
                tone: hasDataset ? 'strong' : 'idle'
            },
            {
                title: state.historyPreview.workspaceMode ? 'Exit Replay Workspace' : 'Open Replay Workspace',
                detail: state.historyPreview.workspaceMode
                    ? 'Return the main stage to the active Wallet Lookup graph.'
                    : 'Use the large graph stage for preview-only replay.',
                historyAction: 'toggle-replay-workspace',
                tone: state.historyPreview.workspaceMode ? 'warn' : 'strong'
            },
            {
                title: 'Open Details',
                detail: state.historyPreview.selectedEvent
                    ? 'Details is showing the last inspected preview event.'
                    : 'Details will show graph selections or the inspected replay event.',
                tab: 'details',
                disabled: !(state.selectedId || state.selectedFlowId || state.historyPreview.selectedEvent)
            }
        ];
    }

    function renderWorkspaceMetric(label, value, options = {}) {
        const helper = namespace.statusPanels?.renderWorkspaceMetric;
        if (helper) return helper(label, value, options);
        const raw = String(value ?? '-');
        const valueClass = options.mono ? 'crypto-metric-value is-mono' : 'crypto-metric-value';
        return `
            <div class="crypto-workspace-metric" title="${escapeAttr(options.title || raw)}">
                <div class="crypto-metric-label">${escapeHtml(label)}</div>
                <div class="${valueClass}">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function isHistoryPreviewDatasetStale() {
        const metadata = state.historyPreview.dataset?.metadata || {};
        if (metadata.replay_window_generation_key) {
            return metadata.replay_window_generation_key !== getReplayDatasetGenerationKey(getActiveReplayWindowDescriptor());
        }
        return Boolean(state.historyPreview.datasetMetrics
            && Number(state.historyPreview.datasetMetrics.stagedRowsReceived || 0) !== Number((state.history.loadedTransactions || []).length));
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
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            ? `data-crypto-flow-id="${escapeAttr(action.flowId)}" data-crypto-open-details="true"`
            : action.walletAddress
                ? `data-crypto-wallet-address="${escapeAttr(action.walletAddress)}" data-crypto-open-details="true"`
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

    function renderWalletHistoryBrowserPanel() {
        const rows = getWalletHistoryBrowserRows(24);
        const loadMoreDisabled = isWalletHistoryLoadMoreDisabled();
        const diagnosticsDisabled = state.history.providerDiagnosticsInFlight || state.history.inFlight;
        const clearDisabled = state.history.inFlight || (!state.history.pagesLoaded && !state.history.loadedTransactions.length);
        const copyDisabled = state.history.inFlight || (!state.history.pagesLoaded && !state.history.lastMessage && !state.history.lastError);
        const coverage = getWalletHistoryCoverage();
        const badges = getWalletHistoryStatusBadges();
        const scanCache = getWalletHistoryScanCache();
        const compactRows = [
            ['Coverage', coverage.label, coverage.detail],
            ['Provider', `${getWalletHistoryProviderDisplay()} / ${getWalletHistoryProviderStateDisplay()}`, getWalletHistoryConfigurationTitle()],
            ['Confidence', `${getWalletHistoryCompletenessConfidence()}% / replay ${getWalletHistoryReplayCoverage()}%`, 'Confidence and replay coverage are scan-state estimates, not completeness claims.'],
            ['Cache', getWalletHistoryCacheDisplay(), getWalletHistoryCacheTitle()],
            ['Scan Cache', getWalletHistoryScanCacheLabel(scanCache), getWalletHistoryScanCacheTitle(scanCache)],
            ['Next Cursor', state.history.nextCursor ? shortLongValue(state.history.nextCursor) : 'None', state.history.nextCursor || 'No additional cursor is staged.']
        ];
        return `
            <section class="rounded-xl border border-cyan-200/16 bg-slate-950/30 p-3">
                <div class="flex flex-col gap-2">
                    <div class="min-w-0">
                        <div class="text-white/38">WALLET HISTORY BROWSER</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/86">Replay Staging</div>
                        <div class="mt-1 max-w-3xl text-white/56 leading-relaxed">Worker history pages stay staged and feed preview replay only. The active Wallet Lookup graph is unchanged.</div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                        <button id="crypto-wallet-history-browser-load-more" type="button" ${loadMoreDisabled ? 'disabled' : ''} title="Load the next history page from the Worker wallet-history endpoint only." class="min-h-10 rounded-xl border border-emerald-200/22 bg-emerald-300/12 px-3 py-2 text-emerald-50/84 hover:border-emerald-100/38 disabled:opacity-50 disabled:cursor-not-allowed">Load Next Page</button>
                        <button id="crypto-wallet-history-browser-load-5" type="button" ${loadMoreDisabled ? 'disabled' : ''} title="Load up to 5 Worker history pages sequentially, stopping on cursor exhaustion, rate limit, or provider limit." class="min-h-10 rounded-xl border border-emerald-200/22 bg-emerald-300/12 px-3 py-2 text-emerald-50/84 hover:border-emerald-100/38 disabled:opacity-50 disabled:cursor-not-allowed">Load 5 Pages</button>
                        <button id="crypto-wallet-history-browser-load-until-limit" type="button" ${loadMoreDisabled ? 'disabled' : ''} title="Load sequentially until no safe next page is available. The action is capped to prevent runaway loops." class="min-h-10 rounded-xl border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-yellow-50/82 hover:border-yellow-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Load Until Limit</button>
                        <button id="crypto-wallet-history-diagnostics" type="button" ${diagnosticsDisabled ? 'disabled' : ''} title="Check Worker provider readiness and limits without fetching history pages or changing the active graph." class="min-h-10 rounded-xl border border-sky-200/22 bg-sky-300/10 px-3 py-2 text-sky-50/84 hover:border-sky-100/38 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(state.history.providerDiagnosticsInFlight ? 'Checking Provider' : 'Provider Capability Check')}</button>
                        <button id="crypto-wallet-history-clear" type="button" ${clearDisabled ? 'disabled' : ''} title="Clear staged history rows without changing the current graph." class="min-h-10 rounded-xl border border-white/12 bg-white/[0.045] px-3 py-2 text-white/70 hover:border-cyan-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Clear Loaded History</button>
                        <button id="crypto-wallet-history-copy" type="button" ${copyDisabled ? 'disabled' : ''} title="Copy a compact staged history snapshot." class="min-h-10 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Copy History Snapshot</button>
                    </div>
                </div>
                <div class="mt-3 rounded-lg border border-cyan-200/14 bg-cyan-300/8 px-3 py-2.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-white/38">HISTORY COVERAGE</div>
                        <div class="text-cyan-50/78 font-semibold">${escapeHtml(coverage.label)}</div>
                    </div>
                    <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div class="h-full ${coverage.moreAvailable ? 'bg-yellow-300/72' : 'bg-emerald-300/68'}" style="width:${escapeAttr(getWalletHistoryCoverageBarWidth(coverage))}%"></div>
                    </div>
                    <div class="mt-2 text-white/54 leading-relaxed">${escapeHtml(coverage.detail)}</div>
                    ${badges.length ? `<div class="mt-2 flex flex-wrap gap-1.5">${badges.map(badge => `<span class="rounded-full border ${escapeAttr(badge.className)} px-2 py-1 text-[10px] font-mono">${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="mt-3 grid gap-1.5">
                    ${compactRows.map(([label, value, title]) => renderWalletHistoryStatusRow(label, value, title)).join('')}
                </div>
                <div class="mt-2 rounded-lg border ${state.history.lastError ? 'border-yellow-200/22 bg-yellow-300/10 text-yellow-50/82' : 'border-cyan-200/12 bg-cyan-300/8 text-cyan-50/72'} px-3 py-2 leading-relaxed">${escapeHtml(getWalletHistoryNotice())}</div>
                ${renderWalletHistoryWarningStrip()}
                <details class="crypto-collapse crypto-history-collapse mt-2">
                    <summary>
                        <span>Scan / Provider Metadata</span>
                        <span>${escapeHtml(getWalletHistoryProviderGrade())} / ${escapeHtml(getWalletHistoryArchiveReadiness())}</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            ${renderWalletHistoryMetric('Provider Grade', getWalletHistoryProviderGrade(), 'Provider capability grade reported by the Worker. This is not a completeness claim by itself.')}
                            ${renderWalletHistoryMetric('Archive Ready', getWalletHistoryArchiveReadiness(), 'Archive readiness reported by Worker diagnostics or the current history page.')}
                            ${renderWalletHistoryMetric('Depth Estimate', getWalletHistoryDepthEstimateDisplay(), getWalletHistoryDepthEstimateTitle())}
                            ${renderWalletHistoryMetric('Scan', state.history.scanId ? shortLongValue(state.history.scanId) : 'Not started', state.history.scanId || 'No scan manifest has been reported yet.')}
                            ${renderWalletHistoryMetric('Gap Flags', getWalletHistoryGapFlags().length ? getWalletHistoryGapFlags().map(formatHistoryFlag).join(', ') : 'None reported', 'Gap flags degrade confidence and can stop progressive loading.')}
                            ${renderWalletHistoryMetric('Last Status', getWalletHistoryLastStatusDisplay(), getWalletHistoryLastMessage())}
                        </div>
                        ${renderWalletHistoryProviderDiagnosticsPanel()}
                    </div>
                </details>
                <details class="crypto-collapse crypto-history-collapse mt-2">
                    <summary>
                        <span>Staged Rows</span>
                        <span>${escapeHtml(rows.length)} shown / ${escapeHtml(state.history.totalLoadedTransactions || 0)} tracked</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        <div class="grid gap-2">
                            ${rows.map(renderWalletHistoryBrowserRow).join('') || renderWalletInlineEmpty(getWalletHistoryEmptyMessage())}
                        </div>
                    </div>
                </details>
            </section>
        `;
    }

    function renderWalletHistoryStatusRow(label, value, title = '') {
        const helper = namespace.statusPanels?.renderHistoryStatusRow;
        if (helper) return helper(label, value, title);
        return `
            <div class="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2" title="${escapeAttr(title || String(value ?? '-'))}">
                <span class="shrink-0 text-white/38">${escapeHtml(label)}</span>
                <span class="min-w-0 text-right text-[11px] font-semibold text-cyan-50/82 break-words">${escapeHtml(String(value ?? '-') || '-')}</span>
            </div>
        `;
    }

    function getWalletHistoryCoverageBarWidth(coverage = getWalletHistoryCoverage()) {
        if (!coverage.pages) return 8;
        if (coverage.rateLimited || coverage.limited) return 42;
        if (coverage.moreAvailable) return Math.min(78, 28 + coverage.pages * 12);
        if (coverage.fullLoaded) return 92;
        return Math.min(72, 34 + coverage.pages * 10);
    }

    function renderWalletHistoryGraphPreviewPanel() {
        const summary = buildHistoryGraphPreviewSummary();
        const plan = state.historyPreview.plan;
        const datasetMetrics = state.historyPreview.datasetMetrics;
        const planStale = plan && Number(plan.stagedEventCount || 0) !== Number(summary.transferEventCount || 0);
        const datasetStale = datasetMetrics && Number(datasetMetrics.stagedRowsReceived || 0) !== Number((state.history.loadedTransactions || []).length);
        const previewDisabled = state.history.inFlight;
        const datasetDisabled = state.history.inFlight;
        const clearDisabled = state.history.inFlight || (!plan && !state.historyPreview.dataset);
        const datasetCopyDisabled = state.history.inFlight || !state.historyPreview.dataset;
        const copyDisabled = state.history.inFlight || !plan;
        const graphToggleDisabled = state.history.inFlight;
        const coverage = getWalletHistoryCoverage();
        const replayWindow = getHistoryReplayWindowStatus(summary);
        const graphToggleLabel = state.historyPreview.workspaceMode ? 'Refresh Large Graph' : 'Open Large Graph';
        const workspaceLabel = state.historyPreview.workspaceMode ? 'Exit Replay Mode' : 'Open Replay Workspace';
        const replayRows = [
            ['Dataset', datasetMetrics ? `${datasetMetrics.transactions || 0} transfers / ${datasetStale ? 'refresh needed' : 'current'}` : 'Not built', getHistoryPreviewDatasetNotice(summary)],
            ['Window', replayWindow.windowLabel, replayWindow.windowTitle],
            ['Coverage', `${getWalletHistoryReplayCoverage()}% replay / ${getWalletHistoryCompletenessConfidence()}% confidence`, coverage.detail],
            ['Timeline', getHistoryTimelineCoverageLabel(summary), getHistoryTimelineCoverageTitle(summary, coverage)],
            ['Cache', getWalletHistoryScanCacheLabel(), getWalletHistoryScanCacheTitle()],
            ['Render Cap', `${replayWindow.renderCap} transfers / ${HISTORY_PREVIEW_GRAPH_LIMITS.maxNodes} nodes`, 'Replay rendering is capped and windowed to prevent browser freezes.']
        ];
        return `
            <section class="rounded-xl border border-fuchsia-200/18 bg-fuchsia-300/8 p-3">
                <div class="flex flex-col gap-3">
                    <div class="min-w-0">
                        <div class="text-white/38">HISTORY GRAPH PREVIEW / REPLAY SANDBOX</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/86">Large Replay Workspace</div>
                        <div class="mt-1 max-w-3xl text-white/58 leading-relaxed">Replay visualization now belongs to the main graph stage. This sidebar keeps compact controls, scan status, warnings, and export actions only.</div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button id="crypto-history-preview-build-dataset" type="button" ${datasetDisabled ? 'disabled' : ''} title="Build a graph-ready preview dataset from staged history without rendering or merging it." class="min-h-10 rounded-xl border border-emerald-200/22 bg-emerald-300/12 px-3 py-2 text-emerald-50/84 hover:border-emerald-100/38 disabled:opacity-50 disabled:cursor-not-allowed">Build Preview Dataset</button>
                        <button id="crypto-history-preview-copy-dataset" type="button" ${datasetCopyDisabled ? 'disabled' : ''} title="Copy the graph-ready preview dataset JSON. The active graph remains unchanged." class="min-h-10 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Copy Preview Dataset JSON</button>
                        <button id="crypto-history-replay-workspace-toggle" type="button" title="Use the main graph stage for preview-only replay without merging history into Wallet Lookup." class="min-h-10 rounded-xl border border-fuchsia-200/24 bg-fuchsia-300/12 px-3 py-2 text-fuchsia-50/86 hover:border-fuchsia-100/40">${escapeHtml(workspaceLabel)}</button>
                        <button id="crypto-history-preview-graph-toggle" type="button" ${graphToggleDisabled ? 'disabled' : ''} title="Render the preview graph in the large graph-stage replay workspace. This does not change Wallet Lookup." class="min-h-10 rounded-xl border border-sky-200/22 bg-sky-300/10 px-3 py-2 text-sky-50/84 hover:border-sky-100/38 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(graphToggleLabel)}</button>
                        <button id="crypto-history-preview-plan" type="button" ${previewDisabled ? 'disabled' : ''} title="Generate a staged lifetime replay plan without animating or changing the active graph." class="min-h-10 rounded-xl border border-fuchsia-200/24 bg-fuchsia-300/12 px-3 py-2 text-fuchsia-50/86 hover:border-fuchsia-100/40 disabled:opacity-50 disabled:cursor-not-allowed">Preview Lifetime Replay</button>
                        <button id="crypto-history-preview-clear" type="button" ${clearDisabled ? 'disabled' : ''} title="Clear the replay preview plan without clearing staged history or changing the graph." class="min-h-10 rounded-xl border border-white/12 bg-white/[0.045] px-3 py-2 text-white/70 hover:border-cyan-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Clear Preview</button>
                        <button id="crypto-history-preview-copy" type="button" ${copyDisabled ? 'disabled' : ''} title="Copy the staged replay plan as JSON." class="min-h-10 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Copy Replay Plan</button>
                    </div>
                </div>
                <div class="mt-3 grid gap-1.5">
                    ${replayRows.map(([label, value, title]) => renderWalletHistoryStatusRow(label, value, title)).join('')}
                </div>
                ${renderHistoryPreviewGraphCanvasPanel(summary, datasetMetrics, datasetStale)}
                <div class="mt-3 rounded-lg border border-yellow-200/14 bg-yellow-300/8 px-3 py-2 text-yellow-50/76 leading-relaxed">
                    ${escapeHtml(getHistoryGraphPreviewNotice(summary, planStale))}
                </div>
                <details class="crypto-collapse crypto-history-preview-collapse mt-2">
                    <summary>
                        <span>Replay Details</span>
                        <span>${escapeHtml(summary.replayReadinessLabel)}</span>
                    </summary>
                    <div class="crypto-collapse-body">
                        ${datasetMetrics ? renderHistoryPreviewDatasetMetrics(datasetMetrics, datasetStale) : `<div class="text-white/54 leading-relaxed">${escapeHtml(getHistoryPreviewDatasetNotice(summary))}</div>`}
                        ${plan ? renderHistoryReplayPlanDetails(plan, planStale) : ''}
                        <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            ${renderWalletHistoryMetric('Unique Wallets', summary.uniqueWalletCount, 'Distinct wallet/address values seen in staged history only.')}
                            ${renderWalletHistoryMetric('Unique Tokens', summary.uniqueTokenCount, 'Distinct token symbols or mints seen in staged history only.')}
                            ${renderWalletHistoryMetric('Earliest', formatPreviewTimestamp(summary.earliestTimestamp), summary.earliestTimestamp || 'No timestamp available.')}
                            ${renderWalletHistoryMetric('Latest', formatPreviewTimestamp(summary.latestTimestamp), summary.latestTimestamp || 'No timestamp available.')}
                            ${renderWalletHistoryMetric('Funding', getPreviewFundingLabel(summary.firstFundingCandidate), getPreviewFundingTitle(summary.firstFundingCandidate))}
                            ${renderWalletHistoryMetric('Readiness', `${summary.replayReadinessScore}/100`, summary.replayReadinessLabel)}
                        </div>
                        <div class="mt-2 rounded-lg border border-yellow-200/14 bg-yellow-300/8 px-3 py-2.5">
                            <div class="text-white/38">MISSING DATA FOR INCEPTION REPLAY</div>
                            <div class="mt-2 grid gap-1.5">
                                ${summary.missingData.map(item => `<div class="text-yellow-50/76 leading-snug">${escapeHtml(item)}</div>`).join('') || `<div class="text-emerald-50/76">No blocking staged-history fields detected. Progressive expansion is still required before graph replay.</div>`}
                            </div>
                        </div>
                    </div>
                </details>
                <div class="mt-2 rounded-lg border border-cyan-200/14 bg-cyan-300/8 px-3 py-2.5">
                    <div class="text-white/38">BOUNDARY</div>
                    <div class="mt-2 text-cyan-50/72 leading-relaxed">Preview replay uses staged history only, draws in the large graph workspace, and never merges into the active Wallet Lookup graph.</div>
                    <div class="mt-2 text-white/46">${escapeHtml(state.historyPreview.lastMessage || 'Build a preview dataset when staged history is ready to inspect.')}</div>
                </div>
            </section>
        `;
    }

    function renderHistoryPreviewDatasetMetrics(metrics = {}, stale = false) {
        const warning = (metrics.warnings || [])[0] || '';
        const staleCopy = stale
            ? '<div class="mt-2 rounded-lg border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-yellow-50/78 leading-relaxed">Staged history changed after this dataset was built. Build Preview Dataset again before copying.</div>'
            : '';
        return `
            <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${renderWalletHistoryMetric('Wallets', metrics.wallets, 'Deduped preview wallet nodes.')}
                ${renderWalletHistoryMetric('Tokens', metrics.tokens, 'Deduped preview token nodes.')}
                ${renderWalletHistoryMetric('Transfers', metrics.transactions, 'Graph-ready transfer rows with source and destination wallets.')}
                ${renderWalletHistoryMetric('Groups', metrics.transactionGroups, 'Signature-based transaction groups inferred safely.')}
                ${renderWalletHistoryMetric('Rows', `${metrics.stagedRowsProcessed}/${metrics.stagedRowsReceived}`, 'Processed staged rows / received staged rows.')}
                ${renderWalletHistoryMetric('Duplicates', metrics.duplicateTransferRowsSkipped, 'Duplicate staged transfer rows skipped.')}
                ${renderWalletHistoryMetric('Missing Wallets', metrics.transferRowsOmittedMissingWallets, 'Transfer candidates omitted because graph endpoints were missing.')}
                ${renderWalletHistoryMetric('Preview Only', metrics.previewOnly && metrics.notMerged ? 'Yes' : 'Check', metrics.boundary || 'Dataset is preview-only and not merged.')}
            </div>
            <div class="mt-2 text-white/54 leading-relaxed">${escapeHtml(metrics.boundary || 'Preview dataset built. Active graph unchanged.')}</div>
            ${warning ? `<div class="mt-2 rounded-lg border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-yellow-50/78 leading-relaxed">${escapeHtml(warning)}</div>` : ''}
            ${staleCopy}
        `;
    }

    function getHistoryTimelineCoverageLabel(summary = {}) {
        const start = formatPreviewTimestamp(summary.earliestTimestamp);
        const end = formatPreviewTimestamp(summary.latestTimestamp);
        const pct = Math.max(0, Math.min(100, Number(summary.timestampCoveragePct) || 0));
        if (start && end && start !== end) return `${start} to ${end} / ${pct}% timestamped`;
        if (start) return `${start} / ${pct}% timestamped`;
        return `${pct}% timestamped`;
    }

    function getHistoryTimelineCoverageTitle(summary = {}, coverage = getWalletHistoryCoverage()) {
        const parts = [
            coverage.detail,
            summary.earliestTimestamp ? `Earliest staged timestamp: ${summary.earliestTimestamp}.` : 'No earliest staged timestamp.',
            summary.latestTimestamp ? `Latest staged timestamp: ${summary.latestTimestamp}.` : 'No latest staged timestamp.',
            'This describes staged rows only and avoids claiming complete wallet history.'
        ];
        return parts.join(' ');
    }

    function renderHistoryPreviewGraphCanvasPanel(summary = {}, datasetMetrics = null, datasetStale = false) {
        const visible = state.historyPreview.graphVisible;
        const workspaceActive = Boolean(state.historyPreview.workspaceMode);
        const result = state.historyPreview.graphRenderResult;
        const sourceTransfers = Number(datasetMetrics?.transactions || summary.transferEventCount || 0);
        const capped = sourceTransfers > HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions;
        const status = visible
            ? result
                ? `${result.renderedNodes || 0} nodes / ${result.renderedEdges || 0} edges / ${result.renderedTransfers || 0} transfers rendered`
                : 'Rendering when the panel is attached'
            : 'Hidden';
        const warnings = [
            'Preview only.',
            'Not merged into the active Wallet Lookup graph.',
            'Not full history; only staged pages are available.',
            'No identity, ownership, risk, criminality, or investment claims.',
            capped ? `Large dataset: render capped at ${HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions} transfers.` : ''
        ].filter(Boolean);
        const workspaceCopy = workspaceActive
            ? 'Large replay canvas active in the main graph stage.'
            : visible
                ? 'Open the Replay Workspace to view the large canvas.'
                : 'Open Large Graph to render staged replay in the main graph stage.';

        return `
            <div class="min-w-0 rounded-lg border border-sky-200/16 bg-sky-300/8 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-white/38">LARGE REPLAY CANVAS</div>
                        <div class="mt-0.5 text-sky-50/74">${escapeHtml(status)}</div>
                    </div>
                    <div class="text-white/38">${escapeHtml(workspaceActive ? 'Workspace active' : 'Workspace closed')}</div>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    ${warnings.map(item => `<div class="rounded-md border border-yellow-200/14 bg-yellow-300/8 px-2 py-1.5 text-yellow-50/74 leading-snug">${escapeHtml(item)}</div>`).join('')}
                </div>
                ${renderHistoryReplayControls(summary, datasetMetrics, datasetStale)}
                <div class="mt-3 rounded-lg border border-fuchsia-200/16 bg-fuchsia-300/8 px-3 py-3 text-fuchsia-50/76 leading-relaxed">${escapeHtml(workspaceCopy)}</div>
                <div id="crypto-history-preview-render-status" class="mt-2 text-white/48 leading-relaxed">${escapeHtml(getHistoryPreviewGraphRenderStatusText(result, datasetStale))}</div>
                <div id="crypto-history-preview-render-warnings" class="mt-2 grid gap-1.5">${renderHistoryPreviewGraphWarnings(result?.warnings || [])}</div>
            </div>
        `;
    }

    function renderHistoryReplayControls(summary = {}, datasetMetrics = null, datasetStale = false) {
        const status = getHistoryReplayStatus();
        const hasDataset = Boolean(state.historyPreview.dataset && datasetMetrics);
        const totalSteps = getHistoryReplayTotalSteps(status, datasetMetrics);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(status.currentStep || 0)));
        const speed = state.historyPreview.replaySpeed || status.speed || 'standard';
        const disabled = state.history.inFlight || datasetStale;
        const pauseDisabled = disabled || !status.playing;
        const stepDisabled = disabled || !hasDataset || !totalSteps;
        const resetDisabled = disabled || (!hasDataset && !state.historyPreview.replayStatus);
        const stepCopy = totalSteps ? `${currentStep}/${totalSteps}` : hasDataset ? '0/0' : 'Dataset required';
        const progressPct = totalSteps ? Math.round((currentStep / totalSteps) * 100) : 0;
        const coveragePct = getWalletHistoryReplayCoverage();
        const replayState = getHistoryReplayStateLabel(status, hasDataset, datasetStale);
        const stateClasses = getHistoryReplayStateClasses(status, hasDataset, datasetStale);
        const targetCanvasCopy = 'large Replay Workspace canvas';
        const jumpChips = buildHistoryReplayJumpChips(summary, status, totalSteps);
        return `
            <div class="mt-3 rounded-lg border border-fuchsia-200/16 bg-fuchsia-300/10 p-3">
                <div class="flex flex-col gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="text-white/38">LIFETIME REPLAY PROTOTYPE</div>
                            <div id="crypto-history-replay-state-pill" class="rounded-full border ${stateClasses} px-2.5 py-1 text-[10px] font-mono">${escapeHtml(replayState)}</div>
                        </div>
                        <div id="crypto-history-replay-status" class="mt-1 text-fuchsia-50/78">${escapeHtml(getHistoryReplayStatusText(status, hasDataset, datasetStale))}</div>
                        <div class="mt-1 text-white/48 leading-relaxed">Opt-in animation uses only the preview dataset and draws only into the ${escapeHtml(targetCanvasCopy)}. It is not full wallet history unless enough pages are loaded, is never merged with the active graph, and makes no identity, ownership, risk, or investment claims.</div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button id="crypto-history-replay-start" type="button" ${disabled ? 'disabled' : ''} title="Start the preview-only replay animation in the large Replay Workspace canvas." class="min-h-10 rounded-xl border border-fuchsia-200/24 bg-fuchsia-300/14 px-3 py-2 text-fuchsia-50/86 hover:border-fuchsia-100/40 disabled:opacity-50 disabled:cursor-not-allowed">Start Replay</button>
                        <button id="crypto-history-replay-pause" type="button" ${pauseDisabled ? 'disabled' : ''} title="Pause the preview-only replay animation." class="min-h-10 rounded-xl border border-white/12 bg-white/[0.045] px-3 py-2 text-white/72 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Pause Replay</button>
                        <button id="crypto-history-replay-step" type="button" ${stepDisabled ? 'disabled' : ''} title="Reveal one replay step from the preview dataset." class="min-h-10 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-cyan-50/82 hover:border-cyan-100/35 disabled:opacity-50 disabled:cursor-not-allowed">Step Replay</button>
                        <button id="crypto-history-replay-reset" type="button" ${resetDisabled ? 'disabled' : ''} title="Reset the preview-only replay canvas to the tracked wallet root." class="min-h-10 rounded-xl border border-yellow-200/18 bg-yellow-300/8 px-3 py-2 text-yellow-50/78 hover:border-yellow-100/32 disabled:opacity-50 disabled:cursor-not-allowed">Reset Replay</button>
                    </div>
                </div>
                <label class="mt-3 block rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2.5">
                    <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span class="text-white/38">Replay Scrubber</span>
                        <span id="crypto-history-replay-scrubber-label" class="font-mono text-[10px] text-fuchsia-50/74">${escapeHtml(stepCopy)}</span>
                    </div>
                    <input id="crypto-history-replay-scrubber" type="range" min="0" max="${escapeAttr(totalSteps)}" step="1" value="${escapeAttr(currentStep)}" ${stepDisabled ? 'disabled' : ''} aria-label="Replay scrubber" class="block min-h-11 w-full cursor-pointer accent-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-50" />
                </label>
                <div class="mt-3 rounded-lg border border-fuchsia-200/14 bg-slate-950/34 px-3 py-2.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-white/38">TIMELINE PROGRESS</div>
                        <div id="crypto-history-replay-progress-percent" class="font-mono text-[10px] text-fuchsia-50/76">${escapeHtml(`${progressPct}% played / ${coveragePct}% coverage`)}</div>
                    </div>
                    <div class="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div id="crypto-history-replay-progress-bar" class="h-full bg-fuchsia-300/78" style="width:${escapeAttr(progressPct)}%"></div>
                    </div>
                </div>
                <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button id="crypto-history-replay-jump-start" type="button" ${stepDisabled || currentStep <= 0 ? 'disabled' : ''} title="Jump to the start of the staged preview replay." class="min-h-9 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-white/68 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Start</button>
                    <button id="crypto-history-replay-prev-event" type="button" ${stepDisabled || currentStep <= 0 ? 'disabled' : ''} title="Step to the previous staged preview event." class="min-h-9 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-white/68 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                    <button id="crypto-history-replay-next-event" type="button" ${stepDisabled || currentStep >= totalSteps ? 'disabled' : ''} title="Step to the next staged preview event." class="min-h-9 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-white/68 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
                    <button id="crypto-history-replay-jump-end" type="button" ${stepDisabled || currentStep >= totalSteps ? 'disabled' : ''} title="Jump to the latest staged preview event." class="min-h-9 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-white/68 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">End</button>
                </div>
                <div class="mt-3 crypto-history-replay-jump-strip" aria-label="Replay bookmarks">
                    ${jumpChips.map(chip => `
                        <button type="button" data-crypto-history-replay-jump-step="${escapeAttr(chip.step || 0)}" ${chip.disabled || stepDisabled ? 'disabled' : ''} title="${escapeAttr(chip.title || chip.label)}">
                            <span>${escapeHtml(chip.label)}</span>
                            <strong>${escapeHtml(chip.step ? `#${chip.step}` : '-')}</strong>
                        </button>
                    `).join('') || '<div class="text-white/38">Bookmarks appear after replay events are available.</div>'}
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <span class="text-white/38 mr-1">Speed</span>
                    ${Object.entries(HISTORY_REPLAY_SPEEDS).map(([value, label]) => `
                        <button type="button" data-crypto-history-replay-speed="${escapeAttr(value)}" ${disabled ? 'disabled' : ''} title="Set replay speed to ${escapeAttr(label)}." class="min-h-9 rounded-xl border ${value === speed ? 'border-fuchsia-100/42 bg-fuchsia-300/18 text-fuchsia-50/88' : 'border-white/10 bg-white/[0.035] text-white/62'} px-3 py-1.5 hover:border-fuchsia-100/30 disabled:opacity-50 disabled:cursor-not-allowed">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
                <div id="crypto-history-replay-live-status" class="mt-2 text-white/48 leading-relaxed">${escapeHtml(getHistoryReplayLiveStatusText(status))}</div>
            </div>
        `;
    }

    function getHistoryReplayStatus() {
        const status = state.historyPreview.replayAnimator?.getStatus?.() || state.historyPreview.replayStatus || {};
        return {
            playing: Boolean(status.playing),
            currentStep: Number(status.currentStep) || 0,
            totalSteps: Number(status.totalSteps) || 0,
            timestamp: status.timestamp || '',
            signature: status.signature || '',
            amount: Number(status.amount) || 0,
            amountDisplay: status.amountDisplay || '',
            token: status.token || '',
            direction: status.direction || '',
            sourceWallet: status.sourceWallet || '',
            destinationWallet: status.destinationWallet || '',
            currentEvent: status.currentEvent || null,
            selectedStep: Number(status.selectedStep || state.historyPreview.audit?.selectedStep) || 0,
            selectedEvent: status.selectedEvent || state.historyPreview.selectedEvent || null,
            eventSummaries: Array.isArray(status.eventSummaries) ? status.eventSummaries : [],
            activePath: status.activePath || null,
            audit: status.audit || null,
            completedStepCount: Number(status.completedStepCount) || 0,
            futureStepCount: Number(status.futureStepCount) || 0,
            speed: status.speed || state.historyPreview.replaySpeed || 'standard',
            speedLabel: status.speedLabel || HISTORY_REPLAY_SPEEDS[status.speed || state.historyPreview.replaySpeed] || 'Standard',
            done: Boolean(status.done),
            warning: status.warning || '',
            replayCoveragePct: status.replayCoveragePct ?? getWalletHistoryReplayCoverage(),
            completenessConfidence: status.completenessConfidence ?? getWalletHistoryCompletenessConfidence(),
            archiveReadiness: status.archiveReadiness || getWalletHistoryArchiveReadiness(),
            providerGrade: status.providerGrade || getWalletHistoryProviderGrade(),
            scanId: status.scanId || state.history.scanId || getWalletHistoryScanManifest().scan_id || '',
            replayWindow: status.replayWindow || state.historyPreview.dataset?.metadata?.replay_window || null,
            replayReconstruction: status.replayReconstruction || state.historyPreview.dataset?.metadata?.replay_reconstruction || null,
            windowing: status.windowing || null,
            timelineSegments: Array.isArray(status.timelineSegments) ? status.timelineSegments : [],
            replayNeighborhood: status.replayNeighborhood || null,
            replayClusters: status.replayClusters || null
        };
    }

    function hasHistoryPreviewDataset() {
        return Boolean(state.historyPreview.dataset || state.historyPreview.plan || state.historyPreview.datasetMetrics);
    }

    function resetHistoryPreviewAuditState(options = {}) {
        const previous = state.historyPreview.audit || {};
        state.historyPreview.selectedEvent = null;
        state.historyPreview.audit = {
            filters: options.preserveFilters
                ? normalizeReplayAuditFilters(previous.filters)
                : {
                    token: 'all',
                    direction: 'all',
                    counterparty: 'all',
                    majorOnly: false
            },
            selectedStep: 0,
            selectedWallet: options.preserveFilters ? previous.selectedWallet || '' : '',
            expandedStep: 0,
            neighborhood: options.preserveNeighborhood
                ? normalizeReplayNeighborhoodFocus(previous.neighborhood)
                : normalizeReplayNeighborhoodFocus(),
            breadcrumbs: options.preserveBreadcrumbs && Array.isArray(previous.breadcrumbs) ? previous.breadcrumbs.slice(-7) : [],
            recentSteps: options.preserveRecent && Array.isArray(previous.recentSteps) ? previous.recentSteps.slice(0, 8) : [],
            investigationStack: options.preserveRecent && Array.isArray(previous.investigationStack) ? previous.investigationStack.slice(0, 8) : [],
            flowLineage: options.preserveRecent && Array.isArray(previous.flowLineage) ? previous.flowLineage.slice(0, 8) : []
        };
    }

    function normalizeReplayNeighborhoodFocus(focus = {}) {
        const mode = String(focus?.mode || 'none');
        return {
            mode: ['none', 'transfer', 'wallet', 'counterparties', 'route', 'token', 'cluster'].includes(mode) ? mode : 'none',
            wallet: String(focus?.wallet || ''),
            token: String(focus?.token || 'all'),
            route: String(focus?.route || ''),
            clusterKey: String(focus?.clusterKey || focus?.cluster_key || ''),
            clusterKind: String(focus?.clusterKind || focus?.cluster_kind || '')
        };
    }

    function normalizeReplayAuditFilters(filters = {}) {
        const helper = namespace.replayWorkspace?.normalizeAuditFilters;
        if (helper) return helper(filters);
        return {
            token: String(filters.token || 'all'),
            direction: String(filters.direction || 'all'),
            counterparty: String(filters.counterparty || 'all'),
            majorOnly: filters.majorOnly === true || filters.majorOnly === 'true'
        };
    }

    function inspectCurrentHistoryReplayEvent() {
        const event = getSelectedHistoryReplayEvent() || getCurrentHistoryReplayEvent();
        if (!event) {
            state.historyPreview.lastMessage = 'No replay event is selected yet. Start, step, or scrub the preview replay first.';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return null;
        }
        state.selectedId = null;
        state.selectedFlowId = null;
        state.flowReplay.activeFlowId = null;
        state.historyPreview.selectedEvent = event;
        state.investigationTab = 'details';
        openMobileDrawerForSelection('expanded');
        render();
        renderDetails();
        return event;
    }

    function getCurrentHistoryReplayEvent() {
        const status = getHistoryReplayStatus();
        const currentStep = Number(status.currentStep) || 0;
        if (!currentStep) return null;
        const currentEvent = status.currentEvent || null;
        const events = getHistoryReplayEvents(status);
        const event = currentEvent
            ? { ...currentEvent, step: currentStep }
            : events.find(item => Number(item.step) === currentStep) || null;
        if (!event) return null;
        return {
            ...event,
            step: currentStep,
            totalSteps: getHistoryReplayTotalSteps(status),
            timestamp: event.timestamp || status.timestamp || '',
            signature: event.signature || event.transaction_hash || status.signature || '',
            amount: event.amount ?? status.amount,
            amountDisplay: event.amountDisplay || event.amount_display || status.amountDisplay || '',
            token: event.token || event.symbol || status.token || '',
            direction: event.direction || status.direction || '',
            sourceWallet: event.sourceWallet || event.source_wallet || status.sourceWallet || '',
            destinationWallet: event.destinationWallet || event.destination_wallet || status.destinationWallet || ''
        };
    }

    function getSelectedHistoryReplayEvent(status = getHistoryReplayStatus()) {
        const selectedStep = Number(state.historyPreview.audit?.selectedStep || status.selectedStep) || 0;
        const selectedEvent = state.historyPreview.selectedEvent || status.selectedEvent || null;
        const events = getHistoryReplayEvents(status);
        const event = selectedStep
            ? events.find(item => Number(item.step) === selectedStep) || selectedEvent
            : selectedEvent || getCurrentHistoryReplayEvent();
        if (!event) return null;
        return buildHistoryReplayEventSnapshot(event, status, selectedStep || event.step || status.currentStep);
    }

    function buildHistoryReplayEventSnapshot(event = {}, status = getHistoryReplayStatus(), step = event.step) {
        return {
            ...event,
            step: Math.max(0, Number(step || event.step) || 0),
            totalSteps: getHistoryReplayTotalSteps(status),
            timestamp: event.timestamp || status.timestamp || '',
            signature: event.signature || event.transaction_hash || status.signature || '',
            amount: event.amount ?? status.amount,
            amountDisplay: event.amountDisplay || event.amount_display || status.amountDisplay || '',
            token: event.token || event.symbol || status.token || '',
            direction: event.direction || status.direction || '',
            sourceWallet: event.sourceWallet || event.source_wallet || status.sourceWallet || '',
            destinationWallet: event.destinationWallet || event.destination_wallet || status.destinationWallet || ''
        };
    }

    async function selectHistoryReplayEventByStep(step = 0, options = {}) {
        const total = getHistoryReplayTotalSteps();
        const targetStep = Math.max(0, Math.min(total, Math.round(Number(step) || 0)));
        if (!targetStep) return null;
        const animator = state.historyPreview.replayAnimator || await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        let status = animator?.seek ? animator.seek(targetStep) : await seekHistoryReplayStep(targetStep, { quiet: true, select: false });
        if (options.pause !== false) animator?.pause?.();
        if (animator?.selectStep) status = animator.selectStep(targetStep);
        status = status || getHistoryReplayStatus();
        const events = getHistoryReplayEvents(status);
        const event = events.find(item => Number(item.step) === targetStep) || status.selectedEvent || status.currentEvent || null;
        if (!event) return null;
        const snapshot = buildHistoryReplayEventSnapshot(event, status, targetStep);
        state.historyPreview.selectedEvent = snapshot;
        state.historyPreview.audit.selectedStep = targetStep;
        state.historyPreview.audit.selectedWallet = options.wallet || state.historyPreview.audit.selectedWallet || '';
        recordReplayAuditVisit(snapshot, options);
        state.historyPreview.lastMessage = options.message || 'Replay transfer selected for audit drilldown. Active Wallet Lookup graph unchanged.';
        updateHistoryReplayStatus(status);
        if (options.openDetails) {
            state.investigationTab = 'details';
            openMobileDrawerForSelection('expanded');
            renderDetails();
        } else {
            updateReplayWorkspaceShell();
        }
        return snapshot;
    }

    function recordReplayAuditVisit(event = {}, options = {}) {
        const audit = state.historyPreview.audit;
        const step = Number(event.step) || 0;
        if (!step) return;
        audit.recentSteps = [step, ...(audit.recentSteps || []).filter(item => Number(item) !== step)].slice(0, 8);
        const crumb = {
            id: `step-${step}-${event.signature || Date.now()}`,
            step,
            label: `#${step} ${getHistoryReplayAmountTokenLabel(event)}`,
            title: getHistoryReplayEventTitle(event),
            route: getHistoryReplayRouteLabel(event),
            sourceWallet: event.sourceWallet || '',
            destinationWallet: event.destinationWallet || ''
        };
        const shouldAddCrumb = options.addBreadcrumb !== false;
        if (shouldAddCrumb) {
            audit.breadcrumbs = [
                ...(audit.breadcrumbs || []).filter(item => Number(item.step) !== step),
                crumb
            ].slice(-7);
        }
        recordReplayInvestigationStackEntry(event, crumb, options);
        if (options.persistCheckpoint !== false) persistReplayAuditCheckpoint(options.checkpointReason || 'selection');
    }

    function recordReplayInvestigationStackEntry(event = {}, crumb = {}, options = {}) {
        const audit = state.historyPreview.audit || {};
        const step = Number(event.step || crumb.step) || 0;
        if (!step) return;
        const route = getReplayEventRouteKey(event);
        const token = String(event.token || event.symbol || '').toUpperCase();
        const entry = {
            id: `replay-stack:${step}:${event.signature || crumb.id || ''}`,
            step,
            label: crumb.label || `#${step} ${getHistoryReplayAmountTokenLabel(event)}`,
            detail: token || getHistoryReplayDirectionLabel(event.direction || ''),
            title: crumb.title || getHistoryReplayEventTitle(event),
            route,
            token,
            sourceWallet: event.sourceWallet || '',
            destinationWallet: event.destinationWallet || '',
            createdAt: Date.now(),
            sessionOnly: true
        };
        audit.investigationStack = pushReplayAuditItem(audit.investigationStack, entry, 8);
        const flowEntry = {
            ...entry,
            id: `flow-lineage:${route || token || step}:${step}`,
            label: route ? 'Flow corridor' : token ? `${token} flow` : `Step ${step}`,
            detail: route ? getHistoryReplayRouteLabel(event) : token || `#${step}`
        };
        audit.flowLineage = pushReplayAuditItem(audit.flowLineage, flowEntry, 8);
        if (options.wallet) {
            audit.selectedWallet = options.wallet;
        }
        state.historyPreview.audit = audit;
    }

    function pushReplayAuditItem(items = [], item = {}, limit = 8) {
        if (!item?.id) return Array.isArray(items) ? items.slice(0, limit) : [];
        return [
            item,
            ...(Array.isArray(items) ? items : []).filter(existing => existing.id !== item.id)
        ].slice(0, limit);
    }

    function buildReplayAuditCheckpoint(reason = 'manual') {
        const status = getHistoryReplayStatus();
        const windowStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), status);
        const helper = namespace.replayWorkspace?.buildReplayCheckpoint;
        const context = {
            reason,
            status,
            windowStatus,
            scanId: state.history.scanId || getWalletHistoryScanManifest().scan_id || '',
            wallet: state.walletLookup.lastWallet || state.walletLookup.walletInput || '',
            selectedEvent: state.historyPreview.selectedEvent || status.selectedEvent || status.currentEvent || null,
            selectedStep: state.historyPreview.audit?.selectedStep || status.selectedStep || status.currentStep || 0,
            totalSteps: getHistoryReplayTotalSteps(status),
            audit: state.historyPreview.audit,
            auditFilters: normalizeReplayAuditFilters(state.historyPreview.audit?.filters),
            neighborhood: normalizeReplayNeighborhoodFocus(state.historyPreview.audit?.neighborhood),
            breadcrumbs: state.historyPreview.audit?.breadcrumbs || [],
            recentEvents: state.historyPreview.audit?.recentSteps || []
        };
        if (helper) return helper(context);
        return {
            version: 'd135_replay_audit_checkpoint_v1',
            savedAt: new Date().toISOString(),
            reason,
            scanId: context.scanId,
            wallet: context.wallet,
            currentStep: Number(status.currentStep) || 0,
            selectedStep: Number(context.selectedStep) || 0,
            totalSteps: context.totalSteps,
            windowId: windowStatus.windowId || '',
            windowIndex: windowStatus.currentWindowIndex || 0,
            windowLabel: windowStatus.windowLabel || '',
            filters: context.auditFilters,
            selectedCounterparty: context.auditFilters.counterparty !== 'all' ? context.auditFilters.counterparty : '',
            selectedToken: context.auditFilters.token !== 'all' ? context.auditFilters.token : '',
            neighborhood: context.neighborhood,
            breadcrumbs: (context.breadcrumbs || []).slice(-7),
            recentSteps: (context.recentEvents || []).slice(0, 8),
            boundary: {
                previewOnly: true,
                stagedHistoryOnly: true,
                workerBacked: true,
                activeGraphUnchanged: true,
                noFullHistoryClaim: true
            }
        };
    }

    function persistReplayAuditCheckpoint(reason = 'manual') {
        const checkpoint = buildReplayAuditCheckpoint(reason);
        if (!checkpoint) return null;
        state.historyPreview.checkpoint = checkpoint;
        try {
            const key = getReplayCheckpointStorageKey(checkpoint.scanId || state.history.scanId);
            const serialized = JSON.stringify(checkpoint);
            window.localStorage?.setItem(key, serialized);
            window.localStorage?.setItem(HISTORY_REPLAY_CHECKPOINT_LATEST_KEY, serialized);
        } catch (error) {
            state.historyPreview.lastMessage = 'Replay checkpoint kept for this session only; local storage is unavailable.';
        }
        updateReplayWorkspaceShell();
        return checkpoint;
    }

    function loadReplayAuditCheckpoint(options = {}) {
        const normalize = namespace.replayWorkspace?.normalizeReplayCheckpoint || (value => value);
        const candidates = [];
        const scanId = state.history?.scanId || getWalletHistoryScanManifest().scan_id || '';
        try {
            if (scanId) candidates.push(window.localStorage?.getItem(getReplayCheckpointStorageKey(scanId)));
            if (options.allowLatest) candidates.push(window.localStorage?.getItem(HISTORY_REPLAY_CHECKPOINT_LATEST_KEY));
        } catch (error) {
            return state.historyPreview?.checkpoint || null;
        }
        for (const item of candidates) {
            if (!item) continue;
            try {
                const checkpoint = normalize(JSON.parse(item));
                if (isReplayCheckpointCompatible(checkpoint, options)) return checkpoint;
            } catch (error) {
                // Ignore malformed local checkpoint records.
            }
        }
        return null;
    }

    function isReplayCheckpointCompatible(checkpoint = null, options = {}) {
        if (!checkpoint) return false;
        const scanId = state.history?.scanId || getWalletHistoryScanManifest().scan_id || '';
        if (scanId && checkpoint.scanId && checkpoint.scanId !== scanId && !options.allowLatest) return false;
        return checkpoint.boundary?.previewOnly !== false
            && checkpoint.boundary?.stagedHistoryOnly !== false
            && checkpoint.boundary?.workerBacked !== false;
    }

    function getReplayCheckpointStorageKey(scanId = '') {
        const scope = String(scanId || state.history.scanId || state.walletLookup.lastWallet || 'global')
            .replace(/[^A-Za-z0-9._:-]/g, '_')
            .slice(0, 180) || 'global';
        return `${HISTORY_REPLAY_CHECKPOINT_STORAGE_PREFIX}${scope}`;
    }

    async function resumeReplayAuditCheckpoint() {
        const checkpoint = state.historyPreview.checkpoint || loadReplayAuditCheckpoint({ allowLatest: true });
        if (!checkpoint) {
            state.historyPreview.lastMessage = 'No replay checkpoint is available to resume.';
            updateReplayWorkspaceShell();
            return null;
        }
        state.historyPreview.checkpoint = checkpoint;
        state.historyPreview.audit.filters = normalizeReplayAuditFilters(checkpoint.filters);
        state.historyPreview.audit.selectedWallet = checkpoint.selectedCounterparty || '';
        state.historyPreview.audit.neighborhood = normalizeReplayNeighborhoodFocus(checkpoint.neighborhood);
        state.historyPreview.replayAnimator?.setNeighborhoodFocus?.(state.historyPreview.audit.neighborhood);
        const activeWindow = getActiveReplayWindowDescriptor();
        if (checkpoint.windowIndex && (!activeWindow?.windowIndex || checkpoint.windowIndex !== activeWindow.windowIndex)) {
            await activateReplayWindow(checkpoint.windowIndex, {
                reason: 'checkpoint',
                preserveAudit: true,
                skipSeek: true
            });
        }
        const targetStep = Math.max(0, Number(checkpoint.selectedStep || checkpoint.currentStep) || 0);
        if (targetStep) {
            return selectHistoryReplayEventByStep(targetStep, {
                pause: true,
                addBreadcrumb: false,
                message: 'Replay checkpoint restored inside the preview-only staged workspace.'
            });
        }
        state.historyPreview.lastMessage = 'Replay checkpoint restored filters and window context.';
        updateReplayWorkspaceShell();
        return checkpoint;
    }

    function getHistoryReplayTotalSteps(status = getHistoryReplayStatus(), datasetMetrics = state.historyPreview.datasetMetrics) {
        const statusTotal = Number(status.totalSteps) || 0;
        if (statusTotal) return statusTotal;
        const datasetTotal = Number(datasetMetrics?.transactions) || Number(state.historyPreview.dataset?.transactions?.length) || 0;
        return Math.max(0, Math.min(datasetTotal, HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions));
    }

    function getHistoryReplayWindowStatus(summary = buildHistoryGraphPreviewSummary(), status = getHistoryReplayStatus()) {
        const reconstruction = state.historyPreview.dataset?.metadata?.replay_reconstruction || getWalletHistoryReplayReconstruction();
        const replayWindow = state.historyPreview.dataset?.metadata?.replay_window || state.history.replayWindow || state.history.lastMetadata?.replay_window || {};
        const activeWindow = state.historyPreview.activeReplayWindow || null;
        const totalSteps = getHistoryReplayTotalSteps(status);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(status.currentStep) || 0));
        const chunkSize = Math.max(1, Number(activeWindow?.chunkSize || reconstruction.chunk_size || replayWindow.chunk_size || HISTORY_REPLAY_CHUNK_SIZE) || HISTORY_REPLAY_CHUNK_SIZE);
        const windowCount = Math.max(0, Number(activeWindow?.windowCount || reconstruction.total_windows || replayWindow.total_windows) || Math.ceil((summary.transferEventCount || state.history.loadedTransactions?.length || totalSteps || 0) / chunkSize));
        const currentWindowIndex = currentStep
            ? Math.max(1, Number(activeWindow?.windowIndex) || Math.ceil(currentStep / chunkSize))
            : Math.max(0, Number(activeWindow?.windowIndex || reconstruction.current_window_index || replayWindow.current_window_index) || (windowCount ? 1 : 0));
        const windowStart = Number(activeWindow?.ordinalStart) || (currentWindowIndex ? ((currentWindowIndex - 1) * chunkSize) + 1 : 0);
        const windowEnd = Number(activeWindow?.ordinalEnd) || (currentWindowIndex ? Math.min(Math.max(state.history.loadedTransactions?.length || totalSteps, Number(reconstruction.total_transactions) || 0), currentWindowIndex * chunkSize) : 0);
        const renderCap = Math.max(1, Number(reconstruction.render_cap_transactions || replayWindow.render_cap_transactions || HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions) || HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions);
        const timelineSegments = Array.isArray(activeWindow?.timelineSegments) && activeWindow.timelineSegments.length
            ? activeWindow.timelineSegments
            : Array.isArray(reconstruction.timeline_segments) && reconstruction.timeline_segments.length
            ? reconstruction.timeline_segments
            : Array.isArray(replayWindow.timeline_segments)
                ? replayWindow.timeline_segments
                : [];
        const partial = activeWindow?.partial === true || (reconstruction.reconstruction_complete !== true && getWalletHistoryScanManifest().full_history_loaded !== true);
        const continuation = activeWindow?.continuation || replayWindow.continuation || {};
        const boundary = activeWindow?.boundary || replayWindow.boundary || {};
        const sortOrder = getWalletHistoryScanManifest().cursor_state?.sort_order || 'unknown';
        const newestFirst = sortOrder === 'desc';
        const canContinueOlder = activeWindow
            ? Boolean(continuation.can_continue_older || (newestFirst ? currentWindowIndex < windowCount : currentWindowIndex > 1))
            : Boolean(continuation.can_continue_older || state.history.moreAvailable || (newestFirst ? currentWindowIndex < windowCount : currentWindowIndex > 1));
        const canContinueNewer = activeWindow
            ? Boolean(continuation.can_continue_newer || (newestFirst ? currentWindowIndex > 1 : currentWindowIndex < windowCount))
            : Boolean(continuation.can_continue_newer || (newestFirst ? currentWindowIndex > 1 : currentWindowIndex < windowCount));
        const windowLabel = activeWindow?.windowLabel
            || replayWindow.window_label
            || reconstruction.current_window_label
            || replayWindow.window_label
            || (currentWindowIndex ? `Window ${currentWindowIndex}/${windowCount || currentWindowIndex} (${windowStart}-${windowEnd || '?'})` : 'Window pending');
        return {
            id: activeWindow?.id || replayWindow.window_id || replayWindow.id || '',
            windowId: activeWindow?.windowId || activeWindow?.id || replayWindow.window_id || replayWindow.id || '',
            scanId: state.history.scanId || replayWindow.scan_id || '',
            chunkSize,
            currentStep,
            totalSteps,
            currentWindowIndex,
            windowIndex: currentWindowIndex,
            windowCount,
            totalWindows: windowCount,
            windowStart,
            windowEnd,
            ordinalStart: windowStart,
            ordinalEnd: windowEnd,
            windowLabel,
            windowTitle: `${windowLabel}. Chunk size ${chunkSize}. ${partial ? 'Replay is partial and may expand as older pages load.' : 'Reconstruction is best-effort complete for staged rows.'}`,
            renderCap,
            timelineSegments,
            rangePosition: activeWindow?.rangePosition || replayWindow.range_position || '',
            rangePositionLabel: formatReplayWindowRangePosition(activeWindow?.rangePosition || replayWindow.range_position || ''),
            continuation,
            boundary,
            canContinueOlder,
            canContinueNewer,
            olderRequiresProviderPage: Boolean(continuation.older_requires_provider_page || (state.history.moreAvailable && !canContinueOlder)),
            newerRequiresProviderPage: Boolean(continuation.newer_requires_provider_page),
            olderWindowIndex: Number(continuation.older_window_index) || (newestFirst ? currentWindowIndex + 1 : currentWindowIndex - 1),
            newerWindowIndex: Number(continuation.newer_window_index) || (newestFirst ? currentWindowIndex - 1 : currentWindowIndex + 1),
            continuityWarning: partial
                ? 'This replay is only a staged window. Continue controls move between available Worker-backed windows or load another staged page when needed.'
                : '',
            continuityConfidence: replayWindow.continuity_confidence || reconstruction.continuity_confidence || null,
            gapMap: replayWindow.gap_map || reconstruction.gap_map || getWalletHistoryScanManifest().replay_gap_map || null,
            oldestFirstReady: reconstruction.oldest_first_ready === true || replayWindow.oldest_first_ready === true,
            oldestFirstRequired: reconstruction.oldest_first_reconstruction_required === true || replayWindow.oldest_first_reconstruction_required === true,
            progressiveExpansion: reconstruction.progressive_expansion_available === true || replayWindow.progressive_expansion_available === true || state.history.moreAvailable,
            partial
        };
    }

    function getActiveReplayWindowDescriptor(options = {}) {
        if (options.window) return normalizeReplayWindowDescriptor(options.window);
        if (state.historyPreview.activeReplayWindow) return normalizeReplayWindowDescriptor(state.historyPreview.activeReplayWindow);
        const reconstruction = getWalletHistoryReplayReconstruction();
        const replayWindow = state.history.replayWindow || state.history.lastMetadata?.replay_window || {};
        const totalRows = Math.max(0, (state.history.loadedTransactions || []).length);
        const chunkSize = Math.max(1, Number(reconstruction.chunk_size || replayWindow.chunk_size || HISTORY_REPLAY_CHUNK_SIZE) || HISTORY_REPLAY_CHUNK_SIZE);
        const windowCount = Math.max(0, Number(reconstruction.total_windows || replayWindow.total_windows) || (totalRows ? Math.ceil(totalRows / chunkSize) : 0));
        if (!windowCount) return null;
        const requestedIndex = Number(replayWindow.current_window_index || reconstruction.current_window_index) || windowCount || 1;
        const windowIndex = Math.max(1, Math.min(windowCount, requestedIndex));
        const ordinalStart = ((windowIndex - 1) * chunkSize) + 1;
        const ordinalEnd = Math.min(totalRows || Number(reconstruction.total_transactions) || ordinalStart, windowIndex * chunkSize);
        return normalizeReplayWindowDescriptor({
            id: replayWindow.window_id || replayWindow.id || '',
            scanId: state.history.scanId || replayWindow.scan_id || '',
            windowIndex,
            windowCount,
            chunkSize,
            ordinalStart,
            ordinalEnd,
            windowLabel: replayWindow.window_label || `Replay window ${windowIndex}/${windowCount} (${ordinalStart}-${ordinalEnd})`,
            rangePosition: replayWindow.range_position || '',
            continuation: replayWindow.continuation || null,
            boundary: replayWindow.boundary || null,
            partial: replayWindow.partial === true || getWalletHistoryScanManifest().full_history_loaded !== true,
            timelineSegments: Array.isArray(replayWindow.timeline_segments)
                ? replayWindow.timeline_segments
                : Array.isArray(reconstruction.timeline_segments)
                    ? reconstruction.timeline_segments
                    : []
        });
    }

    function normalizeReplayWindowDescriptor(window = null) {
        if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
        const windowIndex = Math.max(0, Number(window.windowIndex || window.window_index || window.current_window_index) || 0);
        const windowCount = Math.max(0, Number(window.windowCount || window.totalWindows || window.total_windows) || 0);
        const ordinalStart = Math.max(0, Number(window.ordinalStart || window.ordinal_start || window.windowStart) || 0);
        const ordinalEnd = Math.max(0, Number(window.ordinalEnd || window.ordinal_end || window.windowEnd) || 0);
        return {
            id: String(window.id || window.windowId || window.window_id || ''),
            windowId: String(window.windowId || window.window_id || window.id || ''),
            scanId: String(window.scanId || window.scan_id || state.history.scanId || ''),
            windowIndex,
            windowCount,
            chunkSize: Math.max(1, Number(window.chunkSize || window.chunk_size || HISTORY_REPLAY_CHUNK_SIZE) || HISTORY_REPLAY_CHUNK_SIZE),
            ordinalStart,
            ordinalEnd,
            windowLabel: String(window.windowLabel || window.window_label || (windowIndex ? `Replay window ${windowIndex}/${windowCount || windowIndex} (${ordinalStart}-${ordinalEnd})` : 'Replay window pending')),
            rangePosition: String(window.rangePosition || window.range_position || ''),
            continuation: window.continuation && typeof window.continuation === 'object' ? { ...window.continuation } : null,
            boundary: window.boundary && typeof window.boundary === 'object' ? { ...window.boundary } : null,
            partial: window.partial === true,
            continuityConfidence: window.continuityConfidence || window.continuity_confidence || null,
            gapMap: window.gapMap || window.gap_map || null,
            timelineSegments: Array.isArray(window.timelineSegments)
                ? window.timelineSegments.slice(0, 24)
                : Array.isArray(window.timeline_segments)
                    ? window.timeline_segments.slice(0, 24)
                    : [],
            transactions: Array.isArray(window.transactions) ? window.transactions.slice(0, HISTORY_PREVIEW_TRANSACTION_LIMIT) : null
        };
    }

    function getReplayWindowSourceRows(window = getActiveReplayWindowDescriptor()) {
        if (Array.isArray(window?.transactions) && window.transactions.length) {
            return window.transactions.slice(0, HISTORY_PREVIEW_TRANSACTION_LIMIT);
        }
        const rows = Array.isArray(state.history.loadedTransactions) ? state.history.loadedTransactions : [];
        if (!window?.ordinalStart || !window?.ordinalEnd) return rows.slice(0, HISTORY_PREVIEW_TRANSACTION_LIMIT);
        return rows.slice(Math.max(0, window.ordinalStart - 1), Math.min(rows.length, window.ordinalEnd)).slice(0, HISTORY_PREVIEW_TRANSACTION_LIMIT);
    }

    function getReplayDatasetGenerationKey(window = getActiveReplayWindowDescriptor()) {
        const scan = state.history.scanId || getWalletHistoryScanManifest().scan_id || 'no-scan';
        const total = (state.history.loadedTransactions || []).length;
        if (!window) return `${scan}:all:${total}`;
        return [
            scan,
            window.windowId || window.id || `w${window.windowIndex || 0}`,
            window.windowIndex || 0,
            window.ordinalStart || 0,
            window.ordinalEnd || 0,
            total
        ].join(':');
    }

    function cacheReplayWindowDataset(key = '', dataset = null, metrics = null) {
        if (!key || !dataset || !state.historyPreview.replayWindowCache?.set) return;
        state.historyPreview.replayWindowCache.set(key, {
            dataset,
            metrics,
            cachedAt: Date.now()
        });
        while (state.historyPreview.replayWindowCache.size > HISTORY_REPLAY_WINDOW_CACHE_LIMIT) {
            const oldestKey = state.historyPreview.replayWindowCache.keys().next().value;
            state.historyPreview.replayWindowCache.delete(oldestKey);
        }
    }

    function formatReplayWindowRangePosition(value = '') {
        const text = String(value || '').replaceAll('_', ' ').trim();
        if (!text) return 'Staged Segment';
        return text.replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function getHistoryReplayStateLabel(status = getHistoryReplayStatus(), hasDataset = Boolean(state.historyPreview.dataset), datasetStale = false) {
        if (datasetStale) return 'Refresh Dataset';
        if (!hasDataset) return 'Dataset Required';
        if (status.playing) return 'Playing';
        if (status.done) return 'Ended';
        if ((Number(status.currentStep) || 0) > 0) return 'Paused';
        return 'Ready';
    }

    function getHistoryReplayStateClasses(status = getHistoryReplayStatus(), hasDataset = Boolean(state.historyPreview.dataset), datasetStale = false) {
        if (datasetStale || !hasDataset) return 'border-yellow-200/24 bg-yellow-300/10 text-yellow-50/82';
        if (status.playing) return 'border-cyan-200/32 bg-cyan-300/14 text-cyan-50/88';
        if (status.done) return 'border-emerald-200/24 bg-emerald-300/10 text-emerald-50/82';
        return 'border-fuchsia-200/24 bg-fuchsia-300/12 text-fuchsia-50/84';
    }

    function getHistoryReplayAmountTokenLabel(status = getHistoryReplayStatus()) {
        const helper = namespace.replayWorkspace?.formatAmountToken;
        if (helper) return helper(status);
        const amount = String(status.amountDisplay || '').trim()
            || (Number(status.amount) ? String(status.amount) : '');
        const token = String(status.token || '').trim();
        if (amount && token && !amount.toLowerCase().includes(token.toLowerCase())) return `${amount} ${token}`;
        return amount || token || 'No amount/token';
    }

    function getHistoryReplayDirectionLabel(direction = '') {
        const helper = namespace.replayWorkspace?.formatDirectionLabel;
        if (helper) return helper(direction);
        const text = String(direction || '').trim();
        if (!text) return 'No direction';
        return text.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function getHistoryReplayRouteLabel(status = getHistoryReplayStatus()) {
        const helper = namespace.replayWorkspace?.formatRoute;
        if (helper) return helper(status);
        const source = status.sourceWallet ? shortLongValue(status.sourceWallet) : 'source unknown';
        const destination = status.destinationWallet ? shortLongValue(status.destinationWallet) : 'destination unknown';
        if (!status.sourceWallet && !status.destinationWallet) return 'No current transfer path';
        return `${source} -> ${destination}`;
    }

    function buildHistoryReplayJumpChips(summary = {}, status = getHistoryReplayStatus(), totalSteps = 0) {
        const helper = namespace.replayWorkspace?.deriveBookmarks;
        if (helper) {
            return helper({
                dataset: state.historyPreview.dataset,
                events: getHistoryReplayEvents(status),
                status,
                summary,
                totalSteps,
                warnings: getWalletHistoryWarnings(),
                windowStatus: getHistoryReplayWindowStatus(summary, status)
            });
        }
        const events = getHistoryReplayEvents(status);
        const chips = [];
        const addChip = (key, label, event, title) => {
            const step = Math.max(0, Math.min(totalSteps || events.length, Number(event?.step) || 0));
            chips.push({
                key,
                label,
                step,
                title: event ? title : `${label} is not available from the current preview dataset.`,
                disabled: !event || !step
            });
        };

        const funding = summary.firstFundingCandidate
            ? findHistoryReplayEvent(events, {
                signature: summary.firstFundingCandidate.signature,
                timestamp: summary.firstFundingCandidate.timestamp,
                wallet: summary.firstFundingCandidate.wallet,
                token: summary.firstFundingCandidate.token
            })
            : null;
        addChip('funding', 'First Funding', funding, summary.firstFundingCandidate ? getPreviewFundingTitle(summary.firstFundingCandidate) : '');

        const largest = getLargestHistoryReplayEvent(events);
        addChip('largest', 'Largest Flow', largest, largest ? getHistoryReplayEventTitle(largest) : '');

        const counterparty = (summary.highActivityCounterparties || [])[0] || null;
        const counterpartyEvent = counterparty
            ? findHistoryReplayEvent(events, { wallet: counterparty.address })
            : null;
        addChip('counterparty', 'Most Active', counterpartyEvent, counterparty ? `${counterparty.eventCount || 0} staged events for ${counterparty.address}` : '');

        const earliest = getTimelineHistoryReplayEvent(events, 'earliest');
        addChip('earliest', 'Earliest', earliest, earliest ? getHistoryReplayEventTitle(earliest) : '');

        const latest = getTimelineHistoryReplayEvent(events, 'latest');
        addChip('latest', 'Latest', latest, latest ? getHistoryReplayEventTitle(latest) : '');

        return chips;
    }

    function getHistoryReplayEvents(status = getHistoryReplayStatus()) {
        const helper = namespace.replayWorkspace?.normalizeReplayEvents;
        if (helper) {
            return helper({
                status,
                dataset: state.historyPreview.dataset,
                limits: HISTORY_PREVIEW_GRAPH_LIMITS
            });
        }
        const source = Array.isArray(status.eventSummaries) && status.eventSummaries.length
            ? status.eventSummaries
            : buildHistoryReplayEventsFromDataset();
        return source.map((event, index) => ({
            ...event,
            step: Math.max(1, Number(event.step) || index + 1),
            timestampMs: getHistoryTimestampMs(event.timestamp),
            amountValue: getHistoryReplayEventAmountValue(event),
            sourceWallet: event.sourceWallet || event.source_wallet || '',
            destinationWallet: event.destinationWallet || event.destination_wallet || '',
            signature: event.signature || event.transaction_hash || ''
        }));
    }

    function buildHistoryReplayEventsFromDataset() {
        return (state.historyPreview.dataset?.transactions || [])
            .slice(0, HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions)
            .map((transaction, index) => ({
                step: index + 1,
                timestamp: transaction.timestamp || '',
                signature: transaction.transaction_hash || transaction.signature || '',
                amount: transaction.amount || 0,
                amountDisplay: transaction.amount_display || transaction.amountDisplay || '',
                token: transaction.symbol || transaction.token_mint || '',
                direction: transaction.direction || transaction.metadata?.direction || '',
                sourceWallet: transaction.source_wallet || '',
                destinationWallet: transaction.destination_wallet || ''
            }))
            .sort((a, b) => getHistoryTimestampMs(a.timestamp) - getHistoryTimestampMs(b.timestamp) || a.step - b.step)
            .map((event, index) => ({ ...event, step: index + 1 }));
    }

    function findHistoryReplayEvent(events = [], criteria = {}) {
        const signature = String(criteria.signature || '').trim();
        const wallet = String(criteria.wallet || '').trim();
        const token = String(criteria.token || '').trim();
        const timestampMs = getHistoryTimestampMs(criteria.timestamp);
        if (signature) {
            const match = events.find(event => event.signature === signature);
            if (match) return match;
        }
        return events.find(event => {
            const touchesWallet = !wallet || event.sourceWallet === wallet || event.destinationWallet === wallet;
            const matchesToken = !token || event.token === token;
            const matchesTime = !timestampMs || Math.abs((event.timestampMs || 0) - timestampMs) <= 1000;
            return touchesWallet && matchesToken && matchesTime;
        }) || null;
    }

    function getLargestHistoryReplayEvent(events = []) {
        return events
            .filter(event => Number.isFinite(event.amountValue) && event.amountValue > 0)
            .sort((a, b) => b.amountValue - a.amountValue || (a.timestampMs || 0) - (b.timestampMs || 0))[0] || null;
    }

    function getTimelineHistoryReplayEvent(events = [], mode = 'earliest') {
        const timestamped = events.filter(event => event.timestampMs);
        if (!timestamped.length) return null;
        return timestamped.sort((a, b) => mode === 'latest'
            ? b.timestampMs - a.timestampMs || b.step - a.step
            : a.timestampMs - b.timestampMs || a.step - b.step)[0] || null;
    }

    function getHistoryReplayEventAmountValue(event = {}) {
        const amount = Number(event.amount);
        if (Number.isFinite(amount) && amount > 0) return amount;
        const displayNumber = Number(String(event.amountDisplay || '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(displayNumber) ? displayNumber : 0;
    }

    function getHistoryReplayEventTitle(event = {}) {
        const parts = [
            `Step ${event.step || 0}`,
            event.timestamp ? formatPreviewTimestamp(event.timestamp) : '',
            getHistoryReplayAmountTokenLabel(event),
            event.direction ? getHistoryReplayDirectionLabel(event.direction) : '',
            event.signature ? shortLongValue(event.signature) : ''
        ].filter(Boolean);
        return parts.join(' / ');
    }

    function getHistoryReplayStatusText(status = getHistoryReplayStatus(), hasDataset = Boolean(state.historyPreview.dataset), datasetStale = false) {
        const totalSteps = getHistoryReplayTotalSteps(status);
        const currentStep = Number(status.currentStep) || 0;
        if (datasetStale) return 'Dataset changed after it was built. Rebuild Preview Dataset before replaying.';
        if (!hasDataset) return 'Build Preview Dataset before starting the opt-in lifetime replay.';
        if (!totalSteps) return 'Replay is ready to initialize, but the preview dataset has no graph-ready transfer steps yet.';
        if (status.playing) return 'Replay running in the separate preview canvas only.';
        if (status.done) return 'Replay complete for the currently staged preview dataset.';
        if (currentStep > 0) return 'Replay paused. Step, reset, or resume from the current preview step.';
        return 'Replay ready. Start or step through the staged wallet history preview.';
    }

    function getHistoryReplayLiveStatusText(status = getHistoryReplayStatus()) {
        const total = Number(status.totalSteps) || 0;
        const current = Number(status.currentStep) || 0;
        const timestamp = status.timestamp ? formatPreviewTimestamp(status.timestamp) : 'No timestamp';
        const signature = status.signature ? shortLongValue(status.signature) : 'No signature';
        const amount = getHistoryReplayAmountTokenLabel(status);
        const direction = getHistoryReplayDirectionLabel(status.direction);
        const speed = status.speedLabel || HISTORY_REPLAY_SPEEDS[status.speed] || 'Standard';
        return `Step ${current}/${total}. Timestamp: ${timestamp}. Signature: ${signature}. Amount/token: ${amount}. Direction: ${direction}. Speed: ${speed}. Replay coverage ${getWalletHistoryReplayCoverage()}%.`;
    }

    function getHistoryPreviewGraphRenderStatusText(result = null, datasetStale = false) {
        if (datasetStale) return 'Dataset changed after the preview dataset was built. Rebuild and show again for a current preview.';
        if (!state.historyPreview.dataset) return 'Build Preview Dataset before rendering the large replay graph.';
        if (!result) return 'Preview graph renderer is preparing the large replay canvas.';
        if (!result.renderedTransfers) return 'No graph-ready transfer rows are available to render yet.';
        return 'Large preview canvas rendered from the capped preview dataset only. The active Wallet Lookup graph was not changed.';
    }

    function renderHistoryPreviewGraphWarnings(warnings = []) {
        const items = warnings.slice(0, 3);
        if (!items.length) return '<div class="text-white/38">No renderer cap warnings beyond the preview-only boundary.</div>';
        return items
            .map(item => `<div class="rounded-md border border-yellow-200/14 bg-yellow-300/8 px-2 py-1.5 text-yellow-50/74 leading-snug">${escapeHtml(item)}</div>`)
            .join('');
    }

    function getHistoryPreviewDatasetNotice(summary = {}) {
        if (state.history.inFlight) return 'History is loading. Build the preview dataset after the Worker page is staged.';
        if (!summary.transactionCount) return 'No staged history yet. Load wallet activity or history pages before building a graph-ready preview dataset.';
        return 'Build Preview Dataset prepares wallets, tokens, transactions, and safely inferred transaction groups. Show Preview Graph can render that artifact separately without merging or animating the active graph.';
    }

    function renderHistoryReplayPlanDetails(plan = {}, stale = false) {
        const warning = plan.warning ? `<div class="mt-2 rounded-lg border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-yellow-50/78 leading-relaxed">${escapeHtml(plan.warning)}</div>` : '';
        return `
            <div class="mt-3 rounded-lg border border-fuchsia-200/16 bg-fuchsia-300/10 px-3 py-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-white/38">STAGED PLAN</div>
                    <div class="text-white/42">${escapeHtml(stale ? 'Refresh recommended' : 'Current staged rows')}</div>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${renderWalletHistoryMetric('Steps', plan.estimatedReplaySteps, 'Estimated replay chunks for staged events.')}
                    ${renderWalletHistoryMetric('Chunk', plan.suggestedChunkSize, 'Suggested events per replay chunk.')}
                    ${renderWalletHistoryMetric('Staged Events', plan.stagedEventCount, 'Events included when the plan was generated.')}
                    ${renderWalletHistoryMetric('Speeds', (plan.suggestedSpeedOptions || []).map(item => item.label).join(', ') || '-', 'Suggested replay speed presets.')}
                </div>
                ${warning}
            </div>
        `;
    }

    function renderHistoryPreviewCounterparty(item = {}) {
        const tokens = Array.isArray(item.tokens) && item.tokens.length ? item.tokens.join(', ') : '-';
        return `
            <div class="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2" title="${escapeAttr(item.address || '')}">
                <div class="font-mono text-[11px] text-cyan-50/82 break-words">${escapeHtml(shortLongValue(item.address || '-'))}</div>
                <div class="mt-1 text-white/50">${escapeHtml(item.eventCount || 0)} staged event${item.eventCount === 1 ? '' : 's'} / inbound ${escapeHtml(item.inboundToTracked || 0)} / outbound ${escapeHtml(item.outboundFromTracked || 0)}</div>
                <div class="mt-1 text-white/36 break-words">Tokens: ${escapeHtml(tokens)}</div>
            </div>
        `;
    }

    function renderWalletHistoryMetric(label, value, title = '') {
        const helper = namespace.statusPanels?.renderHistoryMetric;
        if (helper) return helper(label, value, title);
        const raw = String(value ?? '-');
        return `
            <div class="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-2" title="${escapeAttr(title || raw)}">
                <div class="text-white/34">${escapeHtml(label)}</div>
                <div class="mt-1 text-[11px] font-semibold text-cyan-50/82 break-words">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function renderWalletHistoryWarningStrip() {
        const warnings = getWalletHistoryWarnings().slice(0, 3);
        const helper = namespace.statusPanels?.renderWarningStrip;
        if (helper) return helper(warnings);
        if (!warnings.length) return '';
        return `
            <div class="mt-2 grid grid-cols-1 gap-1.5">
                ${warnings.map(warning => `<div class="rounded-lg border border-yellow-200/16 bg-yellow-300/8 px-3 py-2 text-yellow-50/76 leading-relaxed">${escapeHtml(warning)}</div>`).join('')}
            </div>
        `;
    }

    function renderWalletHistoryProviderDiagnosticsPanel() {
        const diagnostics = getWalletHistoryProviderDiagnostics();
        const candidates = getWalletHistoryProviderCandidates(diagnostics);
        const missing = getDiagnosticsMissingEnvVars(diagnostics);
        const limits = [
            `Max page ${diagnostics.maxSafePageSize || diagnostics.max_safe_page_size || '-'}`,
            `Cache ${diagnostics.cacheTtlSeconds || diagnostics.cache_ttl_seconds || '-'}s`,
            `Rate ${diagnostics.rateLimitFetches || diagnostics.rate_limit_fetches || '-'}/${diagnostics.rateLimitWindowSeconds || diagnostics.rate_limit_window_seconds || '-'}s`
        ].join(' / ');
        return `
            <div class="mt-3 rounded-lg border border-sky-200/14 bg-sky-300/8 px-3 py-2.5">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="text-white/38">PROVIDER DIAGNOSTICS</div>
                        <div class="mt-1 text-sm font-semibold text-cyan-50/84 break-words">${escapeHtml(getProviderDiagnosticsTitle(diagnostics))}</div>
                    </div>
                    <div class="rounded-full border ${diagnostics.configured ? 'border-emerald-200/20 bg-emerald-300/10 text-emerald-50/78' : 'border-yellow-200/20 bg-yellow-300/10 text-yellow-50/78'} px-2.5 py-1 text-[10px] font-mono">
                        ${escapeHtml(diagnostics.configured ? 'CONFIGURED' : 'UNCONFIGURED')}
                    </div>
                </div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-[11px]">
                    ${renderWalletHistoryMetric('Active Provider', diagnostics.activeProvider || diagnostics.active_provider || 'none')}
                    ${renderWalletHistoryMetric('Family', diagnostics.provider_family || 'unknown')}
                    ${renderWalletHistoryMetric('Grade', diagnostics.provider_grade || 'basic')}
                    ${renderWalletHistoryMetric('Archive', String(diagnostics.archive_readiness || 'unknown').replaceAll('_', ' '))}
                    ${renderWalletHistoryMetric('Replay', `${diagnostics.replay_suitability || 'low'} / ${String(diagnostics.replay_readiness || 'unknown').replaceAll('_', ' ')}`)}
                    ${renderWalletHistoryMetric('Pagination', diagnostics.paginationSupported || diagnostics.pagination_supported ? `Yes / ${diagnostics.cursorType || diagnostics.cursor_type || 'cursor'}` : 'No')}
                    ${renderWalletHistoryMetric('Ordering', diagnostics.chronological_ordering_support ? 'Chronological capable' : 'Unknown')}
                    ${renderWalletHistoryMetric('Token Accounts', diagnostics.token_account_coverage_support ? 'Supported' : 'Unknown')}
                    ${renderWalletHistoryMetric('Deterministic Cursor', diagnostics.deterministic_pagination_support ? 'Supported' : 'Unknown')}
                    ${renderWalletHistoryMetric('Gap Detection', diagnostics.gap_detection_support ? 'Supported' : 'Unknown')}
                    ${renderWalletHistoryMetric('Cache / Rate', limits)}
                    ${renderWalletHistoryMetric('Missing Env', missing.length ? missing.join(', ') : 'None reported')}
                </div>
                <div class="mt-2 text-white/54 leading-relaxed">${escapeHtml(getWalletHistoryProviderLimitationCopy(diagnostics))}</div>
                <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    ${candidates.map(renderWalletHistoryProviderCandidate).join('') || renderWalletInlineEmpty('No provider candidates were reported by the Worker.')}
                </div>
            </div>
        `;
    }

    function renderWalletHistoryProviderCandidate(candidate = {}) {
        const configured = candidate.configured === true;
        const active = candidate.active === true;
        const tone = active
            ? configured
                ? 'border-emerald-200/20 bg-emerald-300/10'
                : 'border-yellow-200/20 bg-yellow-300/10'
            : 'border-white/10 bg-white/[0.035]';
        const missing = Array.isArray(candidate.missing_env_vars) ? candidate.missing_env_vars : [];
        return `
            <div class="min-w-0 rounded-lg border ${tone} px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="font-semibold text-cyan-50/84 break-words">${escapeHtml(candidate.label || candidate.id || 'Provider')}</div>
                    <div class="text-[10px] font-mono text-white/46">${escapeHtml(active ? 'ACTIVE' : configured ? 'READY' : 'CANDIDATE')}</div>
                </div>
                <div class="mt-1 text-white/52 leading-snug">${escapeHtml(candidate.readiness || '-')}</div>
                <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] text-white/48">
                    <div>Auth: ${escapeHtml(candidate.auth_required || 'provider-specific')}</div>
                    <div>Depth: ${escapeHtml(candidate.expected_depth || 'unknown')}</div>
                    <div>Pagination: ${escapeHtml(candidate.pagination_model || candidate.capabilities?.cursor_type || 'unknown')}</div>
                    <div>Grade: ${escapeHtml(candidate.provider_grade || candidate.capabilities?.provider_grade || 'basic')}</div>
                    <div>Replay: ${escapeHtml(candidate.replay_suitability || candidate.capabilities?.replay_suitability || 'low')}</div>
                    <div>Archive: ${escapeHtml(String(candidate.archive_readiness || candidate.capabilities?.archive_readiness || 'unknown').replaceAll('_', ' '))}</div>
                    <div>Frontend: ${escapeHtml(candidate.frontend_allowed ? 'allowed' : 'blocked')}</div>
                </div>
                <div class="mt-1.5 text-[10px] text-white/44 leading-snug">${escapeHtml(candidate.limitations || (missing.length ? `Missing ${missing.join(', ')}` : 'No additional limitation reported.'))}</div>
            </div>
        `;
    }

    function renderWalletHistoryBrowserRow(row = {}) {
        return `
            <div class="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
                <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span class="font-mono text-[10px] text-white/44">${escapeHtml(row.timestamp || '-')}</span>
                            <span class="rounded-full border border-cyan-200/16 bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-50/78">${escapeHtml(row.type || 'Unknown / Unclassified')}</span>
                            <span class="font-mono text-[10px] text-white/36" title="${escapeAttr(row.signatureFull || '')}">${escapeHtml(row.signature || '-')}</span>
                        </div>
                        <div class="mt-1 text-cyan-50/78 break-words">${escapeHtml(row.relationship || 'Wallet relationship unavailable')}</div>
                    </div>
                    <div class="sm:text-right text-white/48">
                        <div class="break-words">${escapeHtml(row.tokens || 'Tokens unavailable')}</div>
                        <div class="mt-0.5 text-[10px]">${escapeHtml(row.transferCount)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function getWalletHistoryBrowserRows(limit = 24) {
        return (state.history.loadedTransactions || [])
            .slice(0, limit)
            .map((transaction, index) => summarizeWalletHistoryTransaction(transaction, index));
    }

    function summarizeWalletHistoryTransaction(transaction = {}, index = 0) {
        const signature = getHistoryTransactionSignature(transaction, index);
        const type = getHistoryTransactionTypeLabel(transaction);
        const tokens = getHistoryTokenSymbols(transaction);
        const transferCount = getHistoryTransferCount(transaction);
        return {
            timestamp: formatHistoryTimestamp(getHistoryTransactionTimestamp(transaction)),
            type,
            signatureFull: signature,
            signature: signature ? shortHash(signature) : `row-${index + 1}`,
            relationship: getHistoryWalletRelationship(transaction),
            tokens: tokens.length ? tokens.join(', ') : '',
            transferCount: transferCount == null
                ? 'Transfer count unavailable'
                : `${transferCount} transfer${transferCount === 1 ? '' : 's'}`
        };
    }

    function getWalletHistoryProviderDisplay() {
        const diagnostics = getWalletHistoryProviderDiagnostics();
        const label = diagnostics.capabilities?.label
            || diagnostics.activeProvider
            || diagnostics.active_provider
            || state.history.providerLabel
            || state.history.provider
            || 'Worker history provider';
        return label.length > 28 ? shortLongValue(label) : label;
    }

    function getWalletHistoryProviderStateDisplay() {
        if (state.history.inFlight) return 'Loading';
        if (state.history.providerDiagnosticsInFlight) return 'Checking';
        if (state.history.lastStatus === 'provider_rate_limited') return 'Rate-limited';
        if (state.history.lastStatus === 'provider_limited') return 'Limited by provider';
        if (state.history.lastStatus === 'provider_unavailable') return 'Unavailable';
        if (state.history.lastStatus === 'provider_not_configured' || state.history.lastStatus === 'provider_placeholder') return 'Unconfigured';
        if (getWalletHistoryProviderDiagnostics().configured === true) return 'Configured';
        if (state.history.providerConfigured) return 'Configured';
        if (state.history.backendProviderConnected) return 'Unknown';
        return 'Unconnected';
    }

    function getWalletHistoryProviderDiagnostics() {
        const metadataDiagnostics = state.history.lastMetadata?.provider_diagnostics || {};
        const stored = state.history.providerDiagnostics || {};
        const merged = {
            ...metadataDiagnostics,
            ...stored
        };
        const capabilities = merged.capabilities || state.history.lastMetadata?.provider_capabilities || state.history.providerCapabilities || {};
        return {
            ...merged,
            activeProvider: merged.active_provider || state.history.lastMetadata?.active_provider || state.history.provider || 'none',
            configured: merged.configured ?? state.history.lastMetadata?.provider_configured ?? state.history.providerConfigured ?? false,
            capabilities,
            paginationSupported: merged.pagination_supported ?? state.history.lastMetadata?.pagination_supported ?? capabilities.pagination_supported ?? null,
            cursorType: merged.cursor_type || state.history.lastMetadata?.cursor_type || capabilities.cursor_type || '',
            maxSafePageSize: merged.max_safe_page_size || state.history.lastMetadata?.max_safe_page_size || capabilities.max_safe_page_size || '',
            rateLimitWindowSeconds: merged.rate_limit_window_seconds || state.history.lastMetadata?.rate_limit_window_seconds || '',
            rateLimitFetches: merged.rate_limit_fetches || state.history.lastMetadata?.rate_limit_fetches || '',
            cacheTtlSeconds: merged.cache_ttl_seconds || state.history.lastMetadata?.cache_ttl_seconds || '',
            provider_family: merged.provider_family || state.history.lastMetadata?.provider_family || capabilities.provider_family || '',
            archive_readiness: merged.archive_readiness || state.history.lastMetadata?.archive_readiness || capabilities.archive_readiness || '',
            replay_readiness: merged.replay_readiness || state.history.lastMetadata?.replay_readiness || capabilities.replay_readiness || '',
            provider_grade: merged.provider_grade || state.history.lastMetadata?.provider_grade || capabilities.provider_grade || '',
            replay_suitability: merged.replay_suitability || state.history.lastMetadata?.replay_suitability || capabilities.replay_suitability || '',
            completeness_confidence: merged.completeness_confidence ?? state.history.lastMetadata?.completeness_confidence ?? capabilities.completeness_confidence ?? 0,
            chronological_ordering_support: merged.chronological_ordering_support ?? state.history.lastMetadata?.chronological_ordering_support ?? capabilities.chronological_ordering_support ?? false,
            token_account_coverage_support: merged.token_account_coverage_support ?? state.history.lastMetadata?.token_account_coverage_support ?? capabilities.token_account_coverage_support ?? false,
            deterministic_pagination_support: merged.deterministic_pagination_support ?? state.history.lastMetadata?.deterministic_pagination_support ?? capabilities.deterministic_pagination_support ?? false,
            gap_detection_support: merged.gap_detection_support ?? state.history.lastMetadata?.gap_detection_support ?? capabilities.gap_detection_support ?? false,
            candidates: getWalletHistoryProviderCandidates(merged),
            missingEnvVars: getDiagnosticsMissingEnvVars(merged)
        };
    }

    function getWalletHistoryProviderCandidates(diagnostics = getWalletHistoryProviderDiagnostics()) {
        const candidates = diagnostics.candidates || diagnostics.provider_candidates || state.history.lastMetadata?.provider_candidates || [];
        return Array.isArray(candidates) ? candidates : [];
    }

    function getDiagnosticsMissingEnvVars(diagnostics = getWalletHistoryProviderDiagnostics()) {
        const missing = diagnostics.missingEnvVars || diagnostics.missing_env_vars || state.history.lastMetadata?.missing_env_vars || [];
        return Array.isArray(missing) ? missing.filter(Boolean) : [];
    }

    function getProviderDiagnosticsTitle(diagnostics = getWalletHistoryProviderDiagnostics()) {
        const active = diagnostics.activeProvider || diagnostics.active_provider || 'none';
        const cursor = diagnostics.cursorType || diagnostics.cursor_type || 'none';
        return `${active} / cursor ${cursor} / ${diagnostics.configured ? 'ready for Worker-backed pages' : 'configuration incomplete'}`;
    }

    function getWalletHistoryProviderLimitationCopy(diagnostics = getWalletHistoryProviderDiagnostics()) {
        const active = String(diagnostics.activeProvider || diagnostics.active_provider || '').toLowerCase();
        if (active.includes('helius')) {
            return 'Helius history uses the Worker-side getTransactionsForAddress archive path when configured. Completeness is still scan-state dependent and degrades on rate limits, cursor stalls, ordering issues, or gap flags.';
        }
        if (active.includes('lana')) {
            return 'lana.ai remains a placeholder until public API and authentication documentation are verified; the Worker will not call it from this UI.';
        }
        if (active.includes('generic')) {
            return 'Generic provider support is Worker-side only. Its lifetime depth depends on the configured external endpoint, its cursor contract, and its archive coverage.';
        }
        return 'Full lifetime wallet history requires archive-grade indexed provider coverage. Standard page cursors and public RPC access do not prove completeness.';
    }

    function getWalletHistoryCacheDisplay() {
        const metadata = state.history.lastMetadata || {};
        if (metadata.cache_hit === true) return 'Hit';
        if (metadata.cache_status === 'miss') return 'Miss';
        if (metadata.cache_status === 'bypass') return 'Bypass';
        return 'Not reported';
    }

    function getWalletHistoryCacheTitle() {
        const metadata = state.history.lastMetadata || {};
        const ttl = metadata.cache_ttl_seconds ? ` TTL ${metadata.cache_ttl_seconds}s.` : '';
        const rate = metadata.rate_limit_status ? ` Rate: ${metadata.rate_limit_status}.` : '';
        const coverage = metadata.history_coverage ? ` Coverage: ${String(metadata.history_coverage).replaceAll('_', ' ')}.` : '';
        return `Worker reported cache status: ${metadata.cache_status || 'not reported'}.${ttl}${rate}${coverage}`;
    }

    function getWalletHistoryScanCacheLabel(cache = getWalletHistoryScanCache()) {
        if (!cache || !Object.keys(cache).length) return 'Not reported';
        const pages = Number(cache.normalized_pages_persisted) || 0;
        const tx = Number(cache.normalized_transactions_persisted) || 0;
        const stateLabel = cache.persisted ? 'Persisted' : 'Pending';
        return `${stateLabel} / ${pages} page${pages === 1 ? '' : 's'} / ${tx} tx`;
    }

    function getWalletHistoryScanCacheTitle(cache = getWalletHistoryScanCache()) {
        if (!cache || !Object.keys(cache).length) {
            return 'The Worker has not reported persisted scan-cache metadata yet.';
        }
        const storage = cache.storage || 'unavailable';
        const pageStatus = String(cache.normalized_page_persistence || 'not_started').replaceAll('_', ' ');
        const txStatus = String(cache.normalized_transaction_persistence || 'not_started').replaceAll('_', ' ');
        const replay = cache.replay_reconstruction_cached ? 'Replay reconstruction cache is present.' : 'Replay reconstruction cache is not present.';
        return `Worker-only ${storage} scan cache. Pages: ${pageStatus}. Transactions: ${txStatus}. ${replay} Browser receives metadata only.`;
    }

    function getWalletHistoryDepthEstimateDisplay() {
        const depth = state.history.lastMetadata?.history_depth_estimate || {};
        const pages = Number(depth.pages_observed) || state.history.providerPagesLoaded || state.history.pagesLoaded || 0;
        const tx = Number(depth.transactions_observed) || state.history.totalLoadedTransactions || 0;
        const possible = state.history.lastMetadata?.total_possible_estimate ?? depth.max_transactions;
        if (Number.isFinite(Number(possible)) && Number(possible) >= tx) {
            return `${tx}/${Number(possible)} tx`;
        }
        return `${pages} page${pages === 1 ? '' : 's'} / ${tx} tx`;
    }

    function getWalletHistoryDepthEstimateTitle() {
        const depth = state.history.lastMetadata?.history_depth_estimate || {};
        const parts = [
            `Pages observed: ${depth.pages_observed ?? state.history.providerPagesLoaded ?? 0}.`,
            `Transactions observed: ${depth.transactions_observed ?? state.history.totalLoadedTransactions ?? 0}.`,
            `Cursor exhausted: ${depth.cursor_exhausted === true ? 'yes' : depth.cursor_exhausted === false ? 'no' : 'unknown'}.`,
            `Provider max pages: ${depth.max_pages ?? 'unknown'}.`,
            `Provider max transactions: ${depth.max_transactions ?? 'unknown'}.`,
            `Basis: ${String(depth.basis || 'not reported').replaceAll('_', ' ')}.`
        ];
        return parts.join(' ');
    }

    function getWalletHistoryConfigurationTitle() {
        if (state.history.providerConfigured) return 'Provider reported configured through the Worker response.';
        if (state.history.lastStatus === 'provider_rate_limited') return 'Provider is configured, but the Worker or upstream provider is rate-limiting history pagination.';
        if (state.history.lastStatus === 'provider_limited') return 'Provider is configured, but this wallet/page is limited by provider coverage or permissions.';
        if (state.history.lastStatus === 'provider_unavailable') return 'Provider is configured, but the Worker could not load this history page.';
        if (state.history.lastStatus === 'provider_not_configured') return 'Configure the Worker wallet history provider and secrets before loading real history pages.';
        if (isLanaPlaceholderHistoryState()) return 'lana placeholder is staged only; no browser-side provider call is made.';
        return 'Provider is unavailable, unconfigured, or not reported by the Worker yet.';
    }

    function getWalletHistoryLastStatusDisplay() {
        if (state.history.inFlight) return 'loading';
        if (state.history.lastStatus === 'provider_not_configured') return 'provider_not_configured';
        if (state.history.lastStatus === 'provider_limited') return 'provider_limited';
        if (state.history.lastError) return 'attention';
        return state.history.lastStatus || 'idle';
    }

    function getWalletHistoryLastMessage() {
        return state.history.lastError || state.history.lastMessage || 'No history status message yet.';
    }

    function getWalletHistoryNotice() {
        if (state.history.inFlight) return state.history.progress?.message
            ? `${state.history.progress.message}. ${state.history.totalLoadedTransactions} unique tx staged so far.`
            : 'Loading the next staged history page through the Worker wallet-history endpoint.';
        if (state.history.lastError) return state.history.lastError;
        if (state.history.lastStatus === 'provider_rate_limited') return state.history.lastMessage || 'History provider is rate-limited. Wait briefly before loading another staged page.';
        if (state.history.lastStatus === 'provider_limited') return state.history.lastMessage || 'History page is limited by provider coverage or permissions. Full history is not loaded.';
        if (state.history.lastStatus === 'provider_unavailable') return state.history.lastMessage || 'History provider is configured, but this page could not be loaded.';
        if (state.history.lastStatus === 'provider_not_configured') return state.history.lastMessage || 'Worker history provider is not configured.';
        if (state.history.lastStatus === 'diagnostics_ok') return state.history.lastMessage || 'Provider diagnostics are current. No history page was fetched or staged.';
        if (getWalletHistoryGapFlags().length) return `Scan gap flags reported: ${getWalletHistoryGapFlags().map(formatHistoryFlag).join(', ')}. Replay remains incomplete.`;
        if (isLanaPlaceholderHistoryState()) return 'lana placeholder history is not a browser provider. Configure it behind the Worker before loading real pages.';
        if (!state.history.backendProviderConnected) return 'History provider is unavailable in the browser until the Worker adapter is connected; direct provider calls remain disabled.';
        if (state.history.pagesLoaded && !state.history.loadedTransactions.length) return 'History page loaded, but it did not contain inspectable transactions.';
        if (state.history.providerPagesLoaded > 0 && !state.history.moreAvailable) return getWalletHistoryStuckMessage();
        if (!state.history.providerConfigured) return 'Provider configuration has not been confirmed by a history page yet.';
        return state.history.lastMessage || 'History is staged for inspection only. The graph still reflects Wallet Lookup replacement data.';
    }

    function getWalletHistoryEmptyMessage() {
        if (state.history.inFlight) return 'Loading staged history rows.';
        if (state.history.pagesLoaded) return 'No inspectable transactions were returned in the loaded history pages.';
        return 'Load wallet activity, then use Load More History to stage older pages for inspection.';
    }

    function isLanaPlaceholderHistoryState() {
        const text = `${state.history.provider || ''} ${state.history.providerLabel || ''} ${state.history.lastMessage || ''}`.toLowerCase();
        return text.includes('lana');
    }

    function getHistoryTransactionTimestamp(transaction = {}) {
        return transaction.timestamp
            || transaction.block_time
            || transaction.blockTime
            || transaction.time
            || transaction.received_at
            || transaction.created_at
            || '';
    }

    function formatHistoryTimestamp(value) {
        if (value == null || value === '') return '';
        const numeric = Number(value);
        const date = Number.isFinite(numeric)
            ? new Date(numeric < 1000000000000 ? numeric * 1000 : numeric)
            : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function getHistoryTransactionTypeLabel(transaction = {}) {
        const raw = transaction.transaction_type
            || transaction.transactionType
            || transaction.type
            || transaction.event_type
            || 'unknown';
        return core.interpretTransactionType?.(raw)?.label || String(raw || 'Unknown / Unclassified').replaceAll('_', ' ');
    }

    function getHistoryTransactionSignature(transaction = {}, index = 0) {
        return String(transaction.signature || transaction.transaction_hash || transaction.hash || transaction.id || `history-${index + 1}`).trim();
    }

    function getHistoryWalletRelationship(transaction = {}) {
        const explicit = transaction.wallet_relationship
            || transaction.relationship
            || transaction.tracked_wallet_relationship
            || transaction.tracked_wallet_role;
        if (explicit) return String(explicit).replaceAll('_', ' ');
        const tracked = core.normalizeAddress(state.history.controller?.wallet || state.walletLookup.lastWallet || state.walletLookup.walletInput || '');
        const transfers = Array.isArray(transaction.transfers) ? transaction.transfers : [];
        const firstTransfer = transfers[0] || transaction;
        const source = firstTransfer.from || firstTransfer.source_wallet || firstTransfer.source;
        const destination = firstTransfer.to || firstTransfer.destination_wallet || firstTransfer.destination || firstTransfer.target;
        const role = getTrackedWalletRole(tracked, source, destination);
        return role ? String(role).replaceAll('_', ' ') : '';
    }

    function getHistoryTokenSymbols(transaction = {}) {
        const symbols = new Set();
        [transaction.token_symbol, transaction.symbol, transaction.tokenSymbol].forEach(value => {
            if (value) symbols.add(String(value).trim());
        });
        (Array.isArray(transaction.tokens) ? transaction.tokens : []).forEach(token => {
            const symbol = token?.symbol || token?.token_symbol || token?.tokenSymbol;
            if (symbol) symbols.add(String(symbol).trim());
        });
        (Array.isArray(transaction.transfers) ? transaction.transfers : []).forEach(transfer => {
            const symbol = transfer?.token_symbol || transfer?.symbol || transfer?.tokenSymbol;
            if (symbol) symbols.add(String(symbol).trim());
        });
        return [...symbols].filter(Boolean).slice(0, 5);
    }

    function getHistoryTransferCount(transaction = {}) {
        const value = transaction.transfer_count ?? transaction.transferCount ?? transaction.transfers_count;
        if (value != null && value !== '') {
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        }
        if (Array.isArray(transaction.transfers)) return transaction.transfers.length;
        return null;
    }

    function buildHistoryGraphPreviewSummary() {
        const options = getHistoryPreviewBuildOptions();
        const builder = namespace.historyGraphPreview?.buildPreviewSummary;
        if (builder) return builder(state.history.loadedTransactions, options);
        return buildFallbackHistoryGraphPreviewSummary(state.history.loadedTransactions, options);
    }

    function getHistoryPreviewBuildOptions() {
        const trackedWallet = state.history.controller?.wallet || state.walletLookup.lastWallet || state.walletLookup.walletInput || '';
        const coverage = getWalletHistoryCoverage();
        return {
            trackedWallet,
            provider: state.history.provider || '',
            providerLabel: state.history.providerLabel || '',
            providerConfigured: state.history.providerConfigured,
            providerState: getWalletHistoryProviderStateDisplay(),
            cache: getWalletHistoryCacheDisplay(),
            pagesLoaded: state.history.pagesLoaded,
            providerPagesLoaded: state.history.providerPagesLoaded,
            historyCoverage: coverage.label,
            historyCoverageDetail: coverage.detail,
            fullHistoryLoaded: coverage.fullLoaded,
            limitedByProvider: coverage.limited,
            rateLimited: coverage.rateLimited,
            providerGrade: getWalletHistoryProviderGrade(),
            replaySuitability: getWalletHistoryReplaySuitability(),
            completenessConfidence: getWalletHistoryCompletenessConfidence(),
            archiveReadiness: getWalletHistoryArchiveReadiness(),
            replayCoveragePct: getWalletHistoryReplayCoverage(),
            scanManifest: getWalletHistoryScanManifest(),
            scanCache: getWalletHistoryScanCache(),
            replayReconstruction: getWalletHistoryReplayReconstruction(),
            gapFlags: getWalletHistoryGapFlags(),
            warnings: getWalletHistoryWarnings(),
            replayWindow: state.history.replayWindow || state.history.lastMetadata?.replay_window || null,
            nextCursor: state.history.nextCursor,
            moreAvailable: state.history.moreAvailable,
            maxRows: HISTORY_PREVIEW_TRANSACTION_LIMIT
        };
    }

    function buildFallbackHistoryGraphPreviewSummary(transactions = [], options = {}) {
        const rows = Array.isArray(transactions) ? transactions : [];
        const wallets = new Set();
        const tokens = new Set();
        const timestamps = [];
        let transferEventCount = 0;

        rows.forEach((transaction, index) => {
            [transaction.wallet, transaction.source_wallet, transaction.destination_wallet, transaction.from, transaction.to].forEach(value => {
                const normalized = String(value || '').trim();
                if (normalized) wallets.add(normalized);
            });
            getHistoryTokenSymbols(transaction).forEach(symbol => tokens.add(symbol));
            const timestamp = getHistoryTransactionTimestamp(transaction);
            const timestampMs = getHistoryTimestampMs(timestamp);
            if (timestampMs) timestamps.push(timestampMs);
            transferEventCount += Math.max(1, getHistoryTransferCount(transaction) || 1);
            if (!wallets.size) wallets.add(`history-row-${index + 1}`);
        });

        const score = rows.length
            ? Math.min(65, 18 + Math.min(22, transferEventCount * 2) + (timestamps.length ? 18 : 0) + (tokens.size ? 7 : 0))
            : 0;
        const missingData = [];
        if (!rows.length) missingData.push('No staged history rows are loaded yet.');
        if (!timestamps.length) missingData.push('Timestamps are required to order lifetime replay steps.');
        if (!options.trackedWallet) missingData.push('Tracked wallet metadata is required for inception replay.');
        if (!options.providerConfigured) missingData.push('History provider configuration has not been confirmed by a Worker history page.');
        missingData.push('Progressive graph expansion is required before drawing staged history.');

        return {
            version: 'd109_history_graph_preview_fallback',
            previewOnly: true,
            mergedIntoActiveGraph: false,
            generatedAt: new Date().toISOString(),
            trackedWallet: options.trackedWallet || '',
            providerConfigured: Boolean(options.providerConfigured),
            pagesLoaded: Math.max(0, Number(options.pagesLoaded) || 0),
            providerPagesLoaded: Math.max(0, Number(options.providerPagesLoaded) || 0),
            transactionCount: rows.length,
            transferEventCount,
            uniqueWalletCount: wallets.size,
            uniqueTokenCount: tokens.size,
            earliestTimestamp: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : '',
            latestTimestamp: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : '',
            timestampCoveragePct: transferEventCount ? Math.round((timestamps.length / transferEventCount) * 100) : 0,
            firstFundingCandidate: null,
            highActivityCounterparties: [],
            replayReadinessScore: score,
            replayReadinessLabel: score ? 'Preview module loading' : 'No staged history',
            missingData,
            warnings: transferEventCount > 1000 ? ['Large staged history. Use conservative chunks before future replay.'] : []
        };
    }

    function buildFallbackReplayPlan(summary = {}) {
        const eventCount = Math.max(0, Number(summary.transferEventCount) || Number(summary.transactionCount) || 0);
        const chunk = eventCount <= 50 ? 10 : eventCount <= 500 ? 25 : eventCount <= 2000 ? 50 : 100;
        return {
            version: 'd109_history_graph_preview_fallback',
            previewOnly: true,
            generatedAt: new Date().toISOString(),
            wallet: summary.trackedWallet || '',
            estimatedReplaySteps: eventCount ? Math.ceil(eventCount / chunk) : 0,
            suggestedChunkSize: chunk,
            suggestedSpeedOptions: [
                { label: 'Inspect', delayMs: 1600 },
                { label: 'Standard', delayMs: 850 },
                { label: 'Fast Scan', delayMs: 260 }
            ],
            stagedEventCount: eventCount,
            stagedTransactionCount: Math.max(0, Number(summary.transactionCount) || 0),
            warning: eventCount > 1000 ? 'Large staged history. Future replay should use indexed chunks and explicit confirmation.' : '',
            missingDataNeeded: summary.missingData || [],
            phases: [
                'Validate staged history ordering.',
                'Chunk staged events without merging into the active graph.',
                'Expand graph progressively before drawing lifetime replay.'
            ],
            boundary: 'Preview plan only. It is not animated and is not merged with the active Wallet Lookup graph.'
        };
    }

    function getHistoryTimestampMs(value) {
        if (value == null || value === '') return 0;
        const numeric = Number(value);
        const date = Number.isFinite(numeric)
            ? new Date(numeric < 1000000000000 ? numeric * 1000 : numeric)
            : new Date(value);
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : 0;
    }

    function formatPreviewTimestamp(value) {
        if (!value) return '-';
        return formatHistoryTimestamp(value) || '-';
    }

    function getPreviewFundingLabel(candidate = null) {
        if (!candidate) return 'Not inferable';
        return candidate.wallet ? shortLongValue(candidate.wallet) : 'Candidate';
    }

    function getPreviewFundingTitle(candidate = null) {
        if (!candidate) return 'First funding candidate cannot be inferred from the current staged rows.';
        const parts = [
            `Wallet: ${candidate.wallet || '-'}`,
            `Direction: ${String(candidate.direction || '-').replaceAll('_', ' ')}`,
            `Time: ${candidate.timestamp || '-'}`,
            `Token: ${candidate.token || '-'}`,
            `Signature: ${candidate.signature || '-'}`
        ];
        return parts.join(' / ');
    }

    function getHistoryGraphPreviewNotice(summary = {}, stale = false) {
        const coverage = getWalletHistoryCoverage();
        if (state.history.inFlight) return 'History is loading. The preview will update after the Worker page is staged.';
        if (stale) return 'A replay plan exists, but staged history changed after it was generated. Preview Lifetime Replay will refresh the plan.';
        if (!summary.transactionCount) return 'No history loaded. The sandbox is visible so the replay boundary and missing data are explicit before pagination starts.';
        if (!summary.earliestTimestamp && !summary.latestTimestamp) return 'History is staged, but no timestamps are available. Replay ordering will need timestamp coverage before animation.';
        if ((summary.warnings || []).length) return summary.warnings[0];
        return `Staged history has been summarized for replay planning only: ${coverage.label}. ${coverage.detail} No active graph nodes or flow edges were added.`;
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

    function renderWalletInvestigationReportAction() {
        return `
            <button id="crypto-wallet-report-open" type="button" title="Export a Wallet Lookup investigation snapshot from the current visible graph, staged history status, selection, and replay preview state." aria-haspopup="dialog" class="crypto-wallet-report-action rounded-full border border-cyan-200/24 bg-cyan-300/12 px-3 py-1.5 text-cyan-50/84 hover:border-cyan-100/40 hover:bg-cyan-300/18">
                Export Investigation Snapshot
            </button>
        `;
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
                    <button type="button" data-crypto-wallet-address="${escapeAttr(item.address)}" data-crypto-open-details="true" class="mt-2 rounded-lg border border-cyan-200/18 bg-cyan-300/10 px-2.5 py-1.5 text-xs text-cyan-50/78 hover:border-cyan-100/35">Inspect</button>
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
        const openAttr = state.selectedFlowId ? 'open' : '';
        return `
            <details class="crypto-collapse crypto-timeline-collapse mt-2.5" ${openAttr}>
                <summary>
                    <span>Timeline</span>
                    <span>${escapeHtml(flows.length)} shown</span>
                </summary>
                <div class="crypto-collapse-body">
            <section class="rounded-xl border border-cyan-200/14 bg-slate-950/28 p-3">
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
                </div>
            </details>
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
                <div class="grid grid-cols-1 gap-1.5">
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
        status.querySelector('#crypto-wallet-history-load-more')?.addEventListener('click', () => {
            loadMoreWalletHistory({ pages: 1 });
        });
        status.querySelector('#crypto-wallet-history-load-5')?.addEventListener('click', () => {
            loadMoreWalletHistory({ pages: 5 });
        });
        status.querySelector('#crypto-wallet-history-load-until-limit')?.addEventListener('click', () => {
            loadMoreWalletHistory({ untilLimit: true });
        });
        status.querySelector('#crypto-wallet-history-browser-load-more')?.addEventListener('click', () => {
            loadMoreWalletHistory({ pages: 1 });
        });
        status.querySelector('#crypto-wallet-history-browser-load-5')?.addEventListener('click', () => {
            loadMoreWalletHistory({ pages: 5 });
        });
        status.querySelector('#crypto-wallet-history-browser-load-until-limit')?.addEventListener('click', () => {
            loadMoreWalletHistory({ untilLimit: true });
        });
        status.querySelector('#crypto-wallet-history-diagnostics')?.addEventListener('click', () => {
            checkWalletHistoryProviderCapability();
        });
        status.querySelector('#crypto-wallet-history-clear')?.addEventListener('click', () => {
            clearLoadedWalletHistory();
        });
        status.querySelector('#crypto-wallet-history-copy')?.addEventListener('click', event => {
            copyWalletHistorySnapshot(event.currentTarget);
        });
        status.querySelector('#crypto-history-preview-build-dataset')?.addEventListener('click', () => {
            buildHistoryPreviewDataset();
        });
        status.querySelector('#crypto-history-preview-copy-dataset')?.addEventListener('click', event => {
            copyHistoryPreviewDataset(event.currentTarget);
        });
        status.querySelector('#crypto-history-replay-workspace-toggle')?.addEventListener('click', () => {
            toggleReplayWorkspaceMode();
        });
        status.querySelector('#crypto-history-preview-graph-toggle')?.addEventListener('click', () => {
            toggleHistoryPreviewGraph();
        });
        status.querySelector('#crypto-history-preview-plan')?.addEventListener('click', () => {
            previewLifetimeReplay();
        });
        status.querySelector('#crypto-history-preview-clear')?.addEventListener('click', () => {
            clearHistoryGraphPreview();
        });
        status.querySelector('#crypto-history-preview-copy')?.addEventListener('click', event => {
            copyHistoryReplayPlan(event.currentTarget);
        });
        status.querySelector('#crypto-history-replay-start')?.addEventListener('click', () => {
            startHistoryReplay();
        });
        status.querySelector('#crypto-history-replay-pause')?.addEventListener('click', () => {
            pauseHistoryReplay();
        });
        status.querySelector('#crypto-history-replay-step')?.addEventListener('click', () => {
            stepHistoryReplay(1);
        });
        status.querySelector('#crypto-history-replay-reset')?.addEventListener('click', () => {
            resetHistoryReplay();
        });
        status.querySelector('#crypto-history-replay-prev-event')?.addEventListener('click', () => {
            stepHistoryReplay(-1);
        });
        status.querySelector('#crypto-history-replay-next-event')?.addEventListener('click', () => {
            stepHistoryReplay(1);
        });
        status.querySelector('#crypto-history-replay-jump-start')?.addEventListener('click', () => {
            seekHistoryReplayStep(0, { label: 'Replay jumped to the start of the preview canvas only.' });
        });
        status.querySelector('#crypto-history-replay-jump-end')?.addEventListener('click', () => {
            seekHistoryReplayStep(getHistoryReplayTotalSteps(), { label: 'Replay jumped to the final staged preview event only.' });
        });
        status.querySelector('#crypto-history-replay-scrubber')?.addEventListener('input', event => {
            seekHistoryReplayStep(Number(event.target.value) || 0, {
                label: 'Replay scrubber moved the separate preview canvas only.',
                quiet: true
            });
        });
        status.querySelectorAll('[data-crypto-history-replay-jump-step]').forEach(button => {
            button.addEventListener('click', () => {
                seekHistoryReplayStep(Number(button.dataset.cryptoHistoryReplayJumpStep) || 0, {
                    label: 'Replay jumped to the selected key event in the preview canvas only.'
                });
            });
        });
        status.querySelectorAll('[data-crypto-history-replay-speed]').forEach(button => {
            button.addEventListener('click', () => {
                setHistoryReplaySpeed(button.dataset.cryptoHistoryReplaySpeed || 'standard');
            });
        });
        status.querySelector('#crypto-wallet-depth-toggle')?.addEventListener('change', event => {
            setWalletLookupDepth(event.target.checked ? 2 : 1);
        });
        status.querySelector('#crypto-wallet-report-open')?.addEventListener('click', () => {
            openWalletInvestigationReportPreview();
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
                selectFlow(button.dataset.cryptoFlowId || '', {
                    openDetails: button.dataset.cryptoOpenDetails === 'true'
                });
            });
        });
        status.querySelectorAll('[data-crypto-wallet-address]').forEach(button => {
            button.addEventListener('click', () => {
                selectWalletAddress(button.dataset.cryptoWalletAddress || '', {
                    openDetails: button.dataset.cryptoOpenDetails === 'true'
                });
            });
        });
        status.querySelectorAll('[data-crypto-token-filter]').forEach(button => {
            button.addEventListener('click', () => {
                setTokenFilter(button.dataset.cryptoTokenFilter || 'all');
            });
        });
        status.querySelectorAll('[data-crypto-token-isolation]').forEach(button => {
            button.addEventListener('click', () => {
                setTokenIsolation(button.dataset.cryptoTokenIsolation || 'all');
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
            loadHistoryGraphPreviewModule();
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
        applyDefaultLabelDensityForDataMode(DATA_MODES.WALLET);
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
            await seedWalletHistoryFromWorkerPayload(payload, events, normalizedWallet);
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

    async function seedWalletHistoryFromWorkerPayload(payload = {}, events = [], wallet = '') {
        try {
            const controller = await ensureHistoryController(wallet);
            if (!controller) {
                applyHistorySnapshot({
                    pagesLoaded: events.length ? 1 : 0,
                    totalLoadedTransactions: events.length,
                    moreAvailable: false,
                    nextCursor: null,
                    lastError: '',
                    lastMessage: 'History controller unavailable; current wallet lookup remains unchanged'
                });
                return;
            }
            const nextCursor = getHistoryNextCursor(payload);
            controller.seedPage({
                provider: 'worker_wallet_lookup',
                wallet,
                cursor: getHistoryCurrentCursor(payload),
                nextCursor,
                transactions: events,
                moreAvailable: Boolean(nextCursor),
                status: 'ok',
                message: nextCursor
                    ? 'Initial Worker wallet page is tracked; backend pagination cursor is available'
                    : 'Initial Worker wallet page is tracked; no pagination cursor returned',
                metadata: {
                    ...(payload.metadata || {}),
                    worker_endpoint_contract: DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT,
                    initial_wallet_lookup_seed: true,
                    browser_provider_calls: false,
                    no_data_merged: true
                }
            }, { replace: true, wallet });
            applyHistorySnapshot(controller.getSnapshot());
        } catch (error) {
            state.history.lastError = error?.message || 'History controller unavailable';
        }
    }

    async function loadMoreWalletHistory(options = {}) {
        const wallet = state.walletLookup.lastWallet || state.walletLookup.walletInput || '';
        state.investigationTab = 'history';
        state.history.inFlight = true;
        state.history.lastError = '';
        state.history.progress = {
            mode: options.untilLimit ? 'until_limit' : 'batch',
            current: 1,
            target: options.untilLimit ? null : Math.max(1, Number(options.pages) || 1),
            totalTransactions: state.history.totalLoadedTransactions,
            message: options.untilLimit ? 'Loading page 1 of ?' : `Loading page 1 of ${Math.max(1, Number(options.pages) || 1)}`
        };
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        try {
            const controller = await ensureHistoryController(wallet);
            if (!controller) {
                state.history.lastError = 'History controller unavailable';
                return null;
            }
            const progressHandler = snapshot => {
                applyHistorySnapshot(snapshot);
                state.history.inFlight = true;
                renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            };
            const snapshot = typeof controller.loadPages === 'function'
                ? await controller.loadPages({
                    wallet,
                    pages: options.untilLimit ? undefined : Math.max(1, Number(options.pages) || 1),
                    untilLimit: options.untilLimit === true,
                    onProgress: progressHandler
                })
                : await controller.loadNextPage({ wallet });
            applyHistorySnapshot(snapshot);
            normalizeWalletHistoryUnavailableStatus();
            return snapshot;
        } catch (error) {
            state.history.lastError = getSafeWalletHistoryErrorMessage(error);
            state.history.lastStatus = isRawWalletHistoryEndpointMissingError(error) ? 'provider_not_configured' : state.history.lastStatus;
            state.history.lastMessage = isRawWalletHistoryEndpointMissingError(error)
                ? 'wallet history endpoint unavailable; no data merged'
                : state.history.lastMessage;
            return null;
        } finally {
            state.history.inFlight = false;
            state.history.progress = null;
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        }
    }

    async function checkWalletHistoryProviderCapability() {
        const wallet = state.walletLookup.lastWallet || state.walletLookup.walletInput || '';
        state.investigationTab = 'history';
        state.history.providerDiagnosticsInFlight = true;
        state.history.lastError = '';
        state.history.lastMessage = 'Checking Worker provider diagnostics without loading history pages.';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        try {
            const controller = await ensureHistoryController(wallet);
            const provider = controller?.provider || createWorkerHistoryProvider();
            if (!provider || typeof provider.getProviderDiagnostics !== 'function') {
                state.history.lastError = 'Provider diagnostics unavailable from the Worker adapter.';
                return null;
            }

            const result = await provider.getProviderDiagnostics(wallet);
            const diagnostics = result.providerDiagnostics || result.metadata?.provider_diagnostics || null;
            state.history.providerDiagnostics = diagnostics;
            state.history.lastMetadata = {
                ...(state.history.lastMetadata || {}),
                ...(result.metadata || {}),
                provider_diagnostics: diagnostics || result.metadata?.provider_diagnostics || null
            };
            state.history.lastStatus = result.status || state.history.lastStatus || 'diagnostics_ok';
            state.history.lastMessage = result.message || 'Provider diagnostics loaded. No history page was fetched or staged.';
            state.history.providerConfigured = diagnostics?.configured === true || result.metadata?.provider_configured === true;
            state.history.provider = diagnostics?.active_provider || result.provider || state.history.provider;
            state.history.providerLabel = diagnostics?.capabilities?.label || state.history.providerLabel || result.provider || '';
            state.history.providerCapabilities = diagnostics?.capabilities || state.history.providerCapabilities;
            return result;
        } catch (error) {
            state.history.lastError = getSafeWalletHistoryErrorMessage(error);
            state.history.lastMessage = 'Provider diagnostics failed. No history page was fetched or staged.';
            return null;
        } finally {
            state.history.providerDiagnosticsInFlight = false;
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        }
    }

    function normalizeWalletHistoryUnavailableStatus() {
        if (!isRawWalletHistoryEndpointMissingText(state.history.lastError) && !isRawWalletHistoryEndpointMissingText(state.history.lastMessage)) return;
        state.history.lastStatus = 'provider_not_configured';
        state.history.lastError = 'provider_not_configured: wallet history endpoint unavailable; no data merged';
        state.history.lastMessage = 'wallet history endpoint unavailable; no data merged';
        state.history.providerConfigured = false;
        state.history.backendProviderConnected = false;
        state.history.lastMetadata = {
            ...(state.history.lastMetadata || {}),
            provider_configured: false,
            wallet_history_endpoint_unavailable: true,
            no_data_merged: true,
            browser_provider_calls: false
        };
    }

    function getSafeWalletHistoryErrorMessage(error) {
        if (isRawWalletHistoryEndpointMissingError(error)) {
            return 'provider_not_configured: wallet history endpoint unavailable; no data merged';
        }
        return error?.message || 'History load unavailable';
    }

    function isRawWalletHistoryEndpointMissingError(error) {
        return isRawWalletHistoryEndpointMissingText(error?.message || error);
    }

    function isRawWalletHistoryEndpointMissingText(value) {
        return /wallet history returned 404|wallet-history.*404|returned 404/i.test(String(value || ''));
    }

    function clearLoadedWalletHistory() {
        const wallet = state.walletLookup.lastWallet || state.walletLookup.walletInput || '';
        state.investigationTab = 'history';
        if (state.history.controller?.reset) {
            applyHistorySnapshot(state.history.controller.reset(wallet));
        } else {
            resetHistoryState(wallet);
        }
        state.historyPreview.plan = null;
        state.historyPreview.dataset = null;
        state.historyPreview.datasetMetrics = null;
        state.historyPreview.generatedAt = 0;
        state.historyPreview.datasetGeneratedAt = 0;
        state.historyPreview.graphVisible = false;
        state.historyPreview.graphRenderResult = null;
        state.historyPreview.graphRenderedAt = 0;
        state.historyPreview.activeReplayWindow = null;
        state.historyPreview.replayWindowResponse = null;
        state.historyPreview.replayWindowCache?.clear?.();
        detachHistoryReplayAnimator({ preserveStatus: false });
        resetHistoryPreviewAuditState();
        state.historyPreview.replaySpeed = 'standard';
        state.historyPreview.lastMessage = 'Replay preview cleared with staged history; the Wallet Lookup graph was not changed.';
        state.history.lastMessage = 'Loaded history staging cleared; the Wallet Lookup graph was not changed.';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
    }

    async function copyWalletHistorySnapshot(button) {
        const original = button?.textContent || 'Copy History Snapshot';
        state.investigationTab = 'history';
        try {
            await writeTextToClipboard(buildWalletHistorySnapshotText());
            state.history.lastMessage = 'History snapshot copied. Staged rows remain inspection-only.';
            if (button) button.textContent = 'Copied';
        } catch (error) {
            state.history.lastMessage = 'Clipboard unavailable. History snapshot was not copied.';
            if (button) button.textContent = 'Copy Failed';
        }
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        window.setTimeout(() => {
            if (button) button.textContent = original;
        }, 1400);
    }

    function buildWalletHistorySnapshotText() {
        const snapshot = {
            name: 'CryptoPhotonic Wallet History Snapshot',
            generatedAt: new Date().toISOString(),
            boundary: 'History pages are staged for inspection only and are not merged into the graph.',
            wallet: state.history.controller?.wallet || state.walletLookup.lastWallet || state.walletLookup.walletInput || '',
            provider: state.history.provider || '',
            providerLabel: state.history.providerLabel || '',
            providerConfigured: state.history.providerConfigured,
            providerDiagnostics: getWalletHistoryProviderDiagnostics(),
            providerGrade: getWalletHistoryProviderGrade(),
            archiveReadiness: getWalletHistoryArchiveReadiness(),
            completenessConfidence: getWalletHistoryCompletenessConfidence(),
            replayCoveragePct: getWalletHistoryReplayCoverage(),
            scanManifest: getWalletHistoryScanManifest(),
            replayWindow: getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), getHistoryReplayStatus()),
            replayCheckpoint: state.historyPreview.checkpoint || null,
            gapFlags: getWalletHistoryGapFlags(),
            warnings: getWalletHistoryWarnings(),
            pagesLoaded: state.history.pagesLoaded,
            providerPagesLoaded: state.history.providerPagesLoaded,
            totalUniqueTransactionsTracked: state.history.totalLoadedTransactions,
            nextCursor: state.history.nextCursor || null,
            lastStatus: getWalletHistoryLastStatusDisplay(),
            lastMessage: getWalletHistoryLastMessage(),
            rows: getWalletHistoryBrowserRows(100).map(row => ({
                timestamp: row.timestamp,
                transactionType: row.type,
                signature: row.signatureFull,
                walletRelationship: row.relationship,
                tokenSymbols: row.tokens,
                transferCount: row.transferCount
            }))
        };
        return JSON.stringify(snapshot, null, 2);
    }

    async function buildHistoryPreviewDataset(options = {}) {
        state.investigationTab = 'replay';
        await loadHistoryGraphPreviewModule();
        const activeWindow = getActiveReplayWindowDescriptor(options);
        if (activeWindow) state.historyPreview.activeReplayWindow = activeWindow;
        const generationKey = getReplayDatasetGenerationKey(activeWindow);
        const cachedDataset = !options.force && state.historyPreview.replayWindowCache?.get?.(generationKey);
        if (cachedDataset) {
            state.historyPreview.dataset = cachedDataset.dataset;
            state.historyPreview.datasetMetrics = cachedDataset.metrics;
            state.historyPreview.datasetGeneratedAt = Date.now();
            state.historyPreview.graphRenderResult = null;
            state.historyPreview.graphRenderedAt = 0;
            detachHistoryReplayAnimator({ preserveStatus: false });
            resetHistoryPreviewAuditState({ preserveFilters: true, preserveBreadcrumbs: true, preserveRecent: true, preserveNeighborhood: true });
            state.historyPreview.lastMessage = 'Replay window dataset restored from local staged-window cache. Active Wallet Lookup graph unchanged.';
            if (!options.skipRenderStatus) renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return cachedDataset.dataset;
        }
        const builder = namespace.historyGraphPreview?.buildPreviewDataset
            || namespace.historyDatasetBuilder?.buildHistoryDataset;
        const sourceRows = getReplayWindowSourceRows(activeWindow);
        const rawDataset = builder
            ? builder(sourceRows, getHistoryPreviewBuildOptions())
            : buildFallbackHistoryPreviewDataset();
        const dataset = prepareHistoryPreviewDatasetForReplay(enrichHistoryPreviewDatasetMetadata(rawDataset, {
            activeWindow,
            generationKey,
            sourceRows
        }));
        const metrics = getHistoryPreviewDatasetMetrics(dataset);
        state.historyPreview.dataset = dataset;
        state.historyPreview.datasetMetrics = metrics;
        state.historyPreview.datasetGeneratedAt = Date.now();
        state.historyPreview.graphRenderResult = null;
        state.historyPreview.graphRenderedAt = 0;
        if (state.historyPreview.workspaceMode) state.historyPreview.graphVisible = true;
        detachHistoryReplayAnimator({ preserveStatus: false });
        resetHistoryPreviewAuditState({
            preserveFilters: options.preserveAudit === true,
            preserveBreadcrumbs: options.preserveAudit === true,
            preserveRecent: options.preserveAudit === true,
            preserveNeighborhood: options.preserveAudit === true
        });
        cacheReplayWindowDataset(generationKey, dataset, metrics);
        state.historyPreview.lastMessage = metrics.transactions
            ? state.historyPreview.workspaceMode
                ? 'Preview dataset built from staged history only. Large Replay Workspace canvas is ready; active graph unchanged.'
                : 'Preview dataset built from staged history only. Active graph unchanged; render is available only in the separate preview canvas.'
            : 'Preview dataset shell built. Load staged history with wallet data before graph-ready transfer rows can be included.';
        if (!options.skipRenderStatus) renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        return dataset;
    }

    function enrichHistoryPreviewDatasetMetadata(dataset = {}, options = {}) {
        const activeWindow = normalizeReplayWindowDescriptor(options.activeWindow || state.historyPreview.activeReplayWindow);
        const replayWindow = activeWindow
            ? {
                ...(state.history.replayWindow || state.history.lastMetadata?.replay_window || {}),
                id: activeWindow.id || activeWindow.windowId,
                window_id: activeWindow.windowId || activeWindow.id,
                scan_id: activeWindow.scanId,
                current_window_index: activeWindow.windowIndex,
                window_index: activeWindow.windowIndex,
                total_windows: activeWindow.windowCount,
                window_label: activeWindow.windowLabel,
                range_position: activeWindow.rangePosition,
                ordinal_start: activeWindow.ordinalStart,
                ordinal_end: activeWindow.ordinalEnd,
                chunk_size: activeWindow.chunkSize,
                partial: activeWindow.partial,
                continuity_confidence: activeWindow.continuityConfidence || activeWindow.continuity_confidence || state.history.replayWindow?.continuity_confidence || state.history.lastMetadata?.replay_window?.continuity_confidence || null,
                gap_map: activeWindow.gapMap || activeWindow.gap_map || state.history.replayWindow?.gap_map || state.history.lastMetadata?.replay_window?.gap_map || null,
                continuation: activeWindow.continuation,
                boundary: activeWindow.boundary,
                timeline_segments: activeWindow.timelineSegments
            }
            : state.history.replayWindow || state.history.lastMetadata?.replay_window || {};
        const manifest = getWalletHistoryScanManifest();
        const scanCache = getWalletHistoryScanCache();
        const replayReconstruction = getWalletHistoryReplayReconstruction();
        const warnings = mergeUiStringLists(dataset.metadata?.warnings, getWalletHistoryWarnings(), replayWindow.warnings, replayWindow.generation_warnings);
        const sourceRows = Array.isArray(options.sourceRows) ? options.sourceRows : getReplayWindowSourceRows(activeWindow);
        return {
            ...dataset,
            metadata: {
                ...(dataset.metadata || {}),
                scan_manifest_version: state.history.lastMetadata?.scan_manifest_version || manifest.scan_manifest_version || 'd130_scan_manifest_v1',
                scan_id: state.history.scanId || manifest.scan_id || '',
                scan_manifest: manifest.scan_id ? manifest : null,
                provider_grade: getWalletHistoryProviderGrade(),
                replay_suitability: getWalletHistoryReplaySuitability(),
                completeness_confidence: getWalletHistoryCompletenessConfidence(),
                archive_readiness: getWalletHistoryArchiveReadiness(),
                replay_coverage_pct: getWalletHistoryReplayCoverage(),
                replay_window: replayWindow && typeof replayWindow === 'object' ? { ...replayWindow } : null,
                scan_cache: scanCache && typeof scanCache === 'object' ? { ...scanCache } : null,
                replay_reconstruction: replayReconstruction && typeof replayReconstruction === 'object' ? { ...replayReconstruction } : null,
                replay_gap_map: replayWindow?.gap_map || replayReconstruction?.gap_map || getWalletHistoryScanManifest().replay_gap_map || null,
                replay_continuity_confidence: replayWindow?.continuity_confidence || replayReconstruction?.continuity_confidence || null,
                gap_flags: getWalletHistoryGapFlags(),
                warnings,
                replay_generation_warnings: warnings,
                replay_window_generation_key: options.generationKey || getReplayDatasetGenerationKey(activeWindow),
                replay_window_source_rows: sourceRows.length,
                replay_window_source_rows_total: (state.history.loadedTransactions || []).length,
                replay_window_active: activeWindow ? {
                    id: activeWindow.id || activeWindow.windowId || '',
                    window_id: activeWindow.windowId || activeWindow.id || '',
                    window_index: activeWindow.windowIndex || 0,
                    total_windows: activeWindow.windowCount || 0,
                    ordinal_start: activeWindow.ordinalStart || 0,
                    ordinal_end: activeWindow.ordinalEnd || 0,
                    label: activeWindow.windowLabel || '',
                    range_position: activeWindow.rangePosition || '',
                    preview_only: true,
                    staged_history_only: true,
                    worker_backed: true
                } : null,
                replay_scaling: {
                    preview_only: true,
                    active_graph_unchanged: true,
                    max_staged_rows: HISTORY_PREVIEW_TRANSACTION_LIMIT,
                    max_preview_transactions: HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions,
                    max_preview_nodes: HISTORY_PREVIEW_GRAPH_LIMITS.maxNodes,
                    max_preview_edges: HISTORY_PREVIEW_GRAPH_LIMITS.maxEdges,
                    max_replay_neighborhood_events: 18,
                    max_replay_clusters: 8,
                    progressive_expansion_required: true
                }
            }
        };
    }

    async function toggleHistoryPreviewGraph() {
        state.investigationTab = 'replay';
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        state.historyPreview.graphVisible = true;
        state.historyPreview.lastMessage = state.historyPreview.datasetMetrics?.transactions
            ? 'Large Replay Workspace preview graph shown. Active Wallet Lookup graph unchanged.'
            : 'Replay Workspace is open, but no graph-ready transfer rows are available yet.';
        if (!state.historyPreview.workspaceMode) {
            setReplayWorkspaceMode(true, { force: true });
            return;
        }
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
    }

    async function renderHistoryGraphPreviewCanvas(root = state.detailPanel, options = {}) {
        updateReplayWorkspaceShell();
        if (!state.historyPreview.graphVisible) return null;
        const canvas = getHistoryPreviewCanvas(root);
        if (!canvas || !state.historyPreview.dataset) {
            updateHistoryGraphPreviewRenderStatus(null);
            return null;
        }

        if (state.historyPreview.workspaceMode || state.historyPreview.replayStatus || state.historyPreview.replayAnimator) {
            const animator = await initializeHistoryReplayAnimator(root, {
                stepIndex: state.historyPreview.replayStatus?.currentStep || 0
            });
            if (animator && (options.resumeReplay || state.historyPreview.replayStatus?.playing)) {
                animator.start({ resume: true, stepIndex: state.historyPreview.replayStatus?.currentStep || 0 });
            } else {
                animator?.render?.();
            }
            const status = animator?.getStatus?.() || null;
            if (status) {
                state.historyPreview.graphRenderResult = {
                    renderedNodes: status.renderedNodes || 0,
                    renderedEdges: status.renderedEdges || 0,
                    renderedTransfers: status.totalSteps || 0,
                    warnings: status.warnings || [],
                    previewOnly: true,
                    notMerged: true
                };
                state.historyPreview.graphRenderedAt = Date.now();
                updateHistoryGraphPreviewRenderStatus(state.historyPreview.graphRenderResult);
            }
            return status;
        }

        await loadHistoryGraphRendererModule();
        const renderer = namespace.historyGraphRenderer?.renderPreviewDataset;
        if (!renderer) {
            const result = {
                renderedNodes: 0,
                renderedEdges: 0,
                renderedTransfers: 0,
                warnings: ['History graph renderer module unavailable.'],
                previewOnly: true,
                notMerged: true
            };
            state.historyPreview.graphRenderResult = result;
            updateHistoryGraphPreviewRenderStatus(result);
            updateReplayWorkspaceShell();
            return result;
        }

        try {
            const result = renderer(canvas, state.historyPreview.dataset, HISTORY_PREVIEW_GRAPH_LIMITS);
            state.historyPreview.graphRenderResult = result;
            state.historyPreview.graphRenderedAt = Date.now();
            updateHistoryGraphPreviewRenderStatus(result);
            updateReplayWorkspaceShell();
            return result;
        } catch (error) {
            const result = {
                renderedNodes: 0,
                renderedEdges: 0,
                renderedTransfers: 0,
                warnings: [error?.message || 'Preview graph render failed.'],
                previewOnly: true,
                notMerged: true
            };
            state.historyPreview.graphRenderResult = result;
            state.historyPreview.graphRenderedAt = Date.now();
            updateHistoryGraphPreviewRenderStatus(result);
            updateReplayWorkspaceShell();
            return result;
        }
    }

    function updateHistoryGraphPreviewRenderStatus(result = state.historyPreview.graphRenderResult) {
        const status = document.getElementById('crypto-history-preview-render-status');
        if (status) {
            const datasetStale = state.historyPreview.datasetMetrics
                && Number(state.historyPreview.datasetMetrics.stagedRowsReceived || 0) !== Number((state.history.loadedTransactions || []).length);
            status.textContent = getHistoryPreviewGraphRenderStatusText(result, datasetStale);
        }
        const workspaceStatus = document.getElementById('crypto-replay-workspace-render-status');
        if (workspaceStatus) {
            workspaceStatus.textContent = result
                ? `${result.renderedNodes || 0} nodes / ${result.renderedEdges || 0} edges / ${result.renderedTransfers || 0} transfers`
                : state.historyPreview.dataset
                    ? 'Large preview graph preparing'
                    : 'Dataset required';
        }
        const warnings = document.getElementById('crypto-history-preview-render-warnings');
        if (warnings) warnings.innerHTML = renderHistoryPreviewGraphWarnings(result?.warnings || []);
    }

    async function startHistoryReplay() {
        if (state.history.inFlight) return null;
        state.investigationTab = 'replay';
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        state.historyPreview.graphVisible = true;
        if (!state.historyPreview.workspaceMode) {
            setReplayWorkspaceMode(true, { force: true });
        }
        state.historyPreview.lastMessage = state.historyPreview.datasetMetrics?.transactions
            ? 'Preview replay started in the large Replay Workspace canvas. Active Wallet Lookup graph unchanged.'
            : 'Replay canvas opened, but no graph-ready preview transfer steps are available yet.';
        if (state.historyPreview.workspaceMode) renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        const animator = await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        animator?.start?.();
        return animator?.getStatus?.() || null;
    }

    async function pauseHistoryReplay() {
        const animator = state.historyPreview.replayAnimator || await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        animator?.pause?.();
        return animator?.getStatus?.() || null;
    }

    async function stepHistoryReplay(direction = 1) {
        state.investigationTab = 'replay';
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        state.historyPreview.graphVisible = true;
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        else renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        const animator = await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        const status = animator?.step?.(direction) || animator?.getStatus?.() || null;
        const currentStep = Number(status?.currentStep) || 0;
        if (currentStep) {
            const events = getHistoryReplayEvents(status);
            const event = events.find(item => Number(item.step) === currentStep) || status.currentEvent || null;
            if (event) {
                state.historyPreview.selectedEvent = buildHistoryReplayEventSnapshot(event, status, currentStep);
                state.historyPreview.audit.selectedStep = currentStep;
                recordReplayAuditVisit(state.historyPreview.selectedEvent, { addBreadcrumb: true });
            }
        }
        return status;
    }

    async function seekHistoryReplayStep(stepIndex = 0, options = {}) {
        state.investigationTab = 'replay';
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const wasPlaying = Boolean(state.historyPreview.replayAnimator?.getStatus?.().playing || state.historyPreview.replayStatus?.playing);
        const needsRender = !state.historyPreview.graphVisible || !getHistoryPreviewCanvas();
        state.historyPreview.graphVisible = true;
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (needsRender) {
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        }
        const animator = await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        if (!animator?.seek) return null;
        const total = getHistoryReplayTotalSteps(animator.getStatus?.() || getHistoryReplayStatus());
        const safeStep = Math.max(0, Math.min(total, Math.round(Number(stepIndex) || 0)));
        let status = animator.seek(safeStep);
        if (wasPlaying && safeStep < total) {
            status = animator.start({ resume: true, stepIndex: safeStep });
        }
        if (options.select !== false && safeStep) {
            animator.selectStep?.(safeStep);
            const events = getHistoryReplayEvents(status);
            const event = events.find(item => Number(item.step) === safeStep) || status.selectedEvent || status.currentEvent || null;
            if (event) {
                state.historyPreview.selectedEvent = buildHistoryReplayEventSnapshot(event, status, safeStep);
                state.historyPreview.audit.selectedStep = safeStep;
                recordReplayAuditVisit(state.historyPreview.selectedEvent, {
                    addBreadcrumb: true,
                    persistCheckpoint: options.persistCheckpoint
                });
            }
        }
        if (!options.quiet && options.label) state.historyPreview.lastMessage = options.label;
        updateHistoryReplayStatus(status);
        return status;
    }

    async function resetHistoryReplay() {
        state.investigationTab = 'replay';
        const animator = state.historyPreview.replayAnimator || await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        persistReplayAuditCheckpoint('before-reset');
        animator?.reset?.();
        state.historyPreview.selectedEvent = null;
        state.historyPreview.audit.selectedStep = 0;
        state.historyPreview.lastMessage = 'Replay reset to the tracked-wallet root inside the preview canvas only.';
        updateHistoryReplayStatus(animator?.getStatus?.() || getHistoryReplayStatus());
        return animator?.getStatus?.() || null;
    }

    async function setHistoryReplaySpeed(speed = 'standard') {
        const safeSpeed = HISTORY_REPLAY_SPEEDS[speed] ? speed : 'standard';
        state.historyPreview.replaySpeed = safeSpeed;
        if (state.historyPreview.replayAnimator?.setSpeed) {
            state.historyPreview.replayAnimator.setSpeed(safeSpeed);
        } else {
            state.historyPreview.replayStatus = {
                ...(state.historyPreview.replayStatus || {}),
                speed: safeSpeed,
                speedLabel: HISTORY_REPLAY_SPEEDS[safeSpeed]
            };
            updateHistoryReplayStatus(state.historyPreview.replayStatus);
        }
        return safeSpeed;
    }

    async function initializeHistoryReplayAnimator(root = state.detailPanel, options = {}) {
        const canvas = getHistoryPreviewCanvas(root);
        if (!canvas || !state.historyPreview.dataset) return null;
        await loadHistoryGraphRendererModule();
        await loadHistoryReplayAnimatorModule();
        const factory = namespace.historyReplayAnimator?.createReplayAnimator;
        if (!factory) {
            updateHistoryReplayStatus({
                currentStep: 0,
                totalSteps: 0,
                speed: state.historyPreview.replaySpeed,
                speedLabel: HISTORY_REPLAY_SPEEDS[state.historyPreview.replaySpeed] || 'Standard',
                warning: 'History replay animator module unavailable.'
            });
            return null;
        }

        if (state.historyPreview.replayAnimator?.canvas !== canvas) {
            detachHistoryReplayAnimator({ preserveStatus: true });
        }
        if (!state.historyPreview.replayAnimator) {
            state.historyPreview.replayAnimator = factory(canvas, state.historyPreview.dataset, {
                ...HISTORY_PREVIEW_GRAPH_LIMITS,
                speed: state.historyPreview.replaySpeed,
                initialStep: options.stepIndex ?? state.historyPreview.replayStatus?.currentStep ?? 0,
                selectedStep: state.historyPreview.audit?.selectedStep || options.stepIndex || state.historyPreview.replayStatus?.selectedStep || state.historyPreview.replayStatus?.currentStep || 0,
                auditFilters: normalizeReplayAuditFilters(state.historyPreview.audit?.filters),
                neighborhoodFocus: normalizeReplayNeighborhoodFocus(state.historyPreview.audit?.neighborhood),
                onStatus: updateHistoryReplayStatus
            });
            state.historyPreview.replayStatus = state.historyPreview.replayAnimator.getStatus?.() || state.historyPreview.replayStatus;
        }
        state.historyPreview.replayAnimator?.setAuditFilters?.(normalizeReplayAuditFilters(state.historyPreview.audit?.filters));
        state.historyPreview.replayAnimator?.setNeighborhoodFocus?.(normalizeReplayNeighborhoodFocus(state.historyPreview.audit?.neighborhood));
        if (state.historyPreview.audit?.selectedStep) {
            state.historyPreview.replayAnimator?.selectStep?.(state.historyPreview.audit.selectedStep);
        }
        return state.historyPreview.replayAnimator;
    }

    function detachHistoryReplayAnimator(options = {}) {
        if (state.historyPreview.replayAnimator?.destroy) {
            const status = state.historyPreview.replayAnimator.getStatus?.();
            state.historyPreview.replayAnimator.destroy();
            if (options.preserveStatus && status) state.historyPreview.replayStatus = status;
        } else if (!options.preserveStatus) {
            state.historyPreview.replayStatus = null;
        }
        state.historyPreview.replayAnimator = null;
        if (!options.preserveStatus) state.historyPreview.replayStatus = null;
    }

    function updateHistoryReplayStatus(status = {}) {
        const normalized = {
            ...status,
            speed: status.speed || state.historyPreview.replaySpeed || 'standard',
            speedLabel: status.speedLabel || HISTORY_REPLAY_SPEEDS[status.speed || state.historyPreview.replaySpeed] || 'Standard'
        };
        state.historyPreview.replayStatus = normalized;
        state.historyPreview.replaySpeed = normalized.speed;
        if (Number(normalized.selectedStep)) state.historyPreview.audit.selectedStep = Number(normalized.selectedStep);

        const datasetStale = state.historyPreview.datasetMetrics
            && Number(state.historyPreview.datasetMetrics.stagedRowsReceived || 0) !== Number((state.history.loadedTransactions || []).length);
        const topStatus = document.getElementById('crypto-history-replay-status');
        if (topStatus) {
            topStatus.textContent = getHistoryReplayStatusText(normalized, Boolean(state.historyPreview.dataset), datasetStale);
        }
        const liveStatus = document.getElementById('crypto-history-replay-live-status');
        if (liveStatus) liveStatus.textContent = getHistoryReplayLiveStatusText(normalized);
        const totalSteps = getHistoryReplayTotalSteps(normalized);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(normalized.currentStep) || 0));
        const scrubber = document.getElementById('crypto-history-replay-scrubber');
        if (scrubber) {
            scrubber.max = String(totalSteps);
            scrubber.value = String(currentStep);
            scrubber.disabled = Boolean(state.history.inFlight || datasetStale || !state.historyPreview.dataset || !totalSteps);
        }
        const scrubberLabel = document.getElementById('crypto-history-replay-scrubber-label');
        if (scrubberLabel) scrubberLabel.textContent = totalSteps ? `${currentStep}/${totalSteps}` : '0/0';
        const progressPct = totalSteps ? Math.round((currentStep / totalSteps) * 100) : 0;
        const progressPercent = document.getElementById('crypto-history-replay-progress-percent');
        if (progressPercent) progressPercent.textContent = `${progressPct}% played / ${getWalletHistoryReplayCoverage()}% coverage`;
        const progressBar = document.getElementById('crypto-history-replay-progress-bar');
        if (progressBar) progressBar.style.width = `${progressPct}%`;
        const currentRoute = document.getElementById('crypto-history-replay-current-route');
        if (currentRoute) currentRoute.textContent = getHistoryReplayRouteLabel(normalized);
        const statePill = document.getElementById('crypto-history-replay-state-pill');
        if (statePill) {
            statePill.textContent = getHistoryReplayStateLabel(normalized, Boolean(state.historyPreview.dataset), datasetStale);
            statePill.className = `rounded-full border ${getHistoryReplayStateClasses(normalized, Boolean(state.historyPreview.dataset), datasetStale)} px-2.5 py-1 text-[10px] font-mono`;
        }
        const workspaceStatus = document.getElementById('crypto-replay-workspace-status');
        if (workspaceStatus) {
            workspaceStatus.textContent = getHistoryReplayStatusText(normalized, Boolean(state.historyPreview.dataset), datasetStale);
        }
        const workspaceProgress = document.getElementById('crypto-replay-workspace-progress');
        if (workspaceProgress) workspaceProgress.textContent = `${currentStep}/${totalSteps}`;
        const workspaceProgressBar = document.getElementById('crypto-replay-workspace-progress-bar');
        if (workspaceProgressBar) workspaceProgressBar.style.width = `${progressPct}%`;
        const workspaceRoute = document.getElementById('crypto-replay-workspace-route');
        if (workspaceRoute) workspaceRoute.textContent = getHistoryReplayRouteLabel(normalized);
        const workspaceScrubber = document.getElementById('crypto-replay-workspace-scrubber');
        if (workspaceScrubber) {
            workspaceScrubber.max = String(totalSteps);
            workspaceScrubber.value = String(currentStep);
            workspaceScrubber.disabled = Boolean(state.history.inFlight || datasetStale || !state.historyPreview.dataset || !totalSteps);
        }
        const workspaceStart = document.getElementById('crypto-replay-workspace-start');
        if (workspaceStart) {
            workspaceStart.textContent = normalized.playing ? 'Pause' : 'Play';
            workspaceStart.disabled = Boolean(state.history.inFlight || datasetStale || !state.historyPreview.dataset);
        }
        const workspacePrev = document.getElementById('crypto-replay-workspace-prev');
        if (workspacePrev) workspacePrev.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep <= 0);
        const workspaceNext = document.getElementById('crypto-replay-workspace-next');
        if (workspaceNext) workspaceNext.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep >= totalSteps);
        const windowStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), normalized);
        const workspaceWindowPrev = document.getElementById('crypto-replay-workspace-window-prev');
        if (workspaceWindowPrev) workspaceWindowPrev.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || !windowStatus.canContinueNewer);
        const workspaceWindowNext = document.getElementById('crypto-replay-workspace-window-next');
        if (workspaceWindowNext) workspaceWindowNext.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || (!windowStatus.canContinueOlder && !windowStatus.olderRequiresProviderPage));
        const checkpointSave = document.getElementById('crypto-replay-workspace-checkpoint-save');
        if (checkpointSave) checkpointSave.disabled = Boolean(state.history.inFlight || datasetStale || !state.historyPreview.dataset || !totalSteps);
        const checkpointResume = document.getElementById('crypto-replay-workspace-checkpoint-resume');
        if (checkpointResume) checkpointResume.disabled = !state.historyPreview.checkpoint;
        const pauseButton = document.getElementById('crypto-history-replay-pause');
        if (pauseButton) pauseButton.disabled = !normalized.playing || Boolean(state.history.inFlight || datasetStale);
        const previousButton = document.getElementById('crypto-history-replay-prev-event');
        if (previousButton) previousButton.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep <= 0);
        const nextButton = document.getElementById('crypto-history-replay-next-event');
        if (nextButton) nextButton.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep >= totalSteps);
        const startButton = document.getElementById('crypto-history-replay-jump-start');
        if (startButton) startButton.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep <= 0);
        const endButton = document.getElementById('crypto-history-replay-jump-end');
        if (endButton) endButton.disabled = Boolean(state.history.inFlight || datasetStale || !totalSteps || currentStep >= totalSteps);
        if (state.historyPreview.workspaceMode) updateReplayWorkspaceShell();
        updateInteractionDock();
    }

    async function copyHistoryPreviewDataset(button) {
        const original = button?.textContent || 'Copy Preview Dataset JSON';
        state.investigationTab = 'replay';
        const dataset = state.historyPreview.dataset;
        if (!dataset) {
            state.historyPreview.lastMessage = 'Build Preview Dataset before copying JSON.';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
            return;
        }
        const textBuilder = namespace.historyGraphPreview?.buildPreviewDatasetText
            || namespace.historyDatasetBuilder?.buildHistoryDatasetText;
        const text = textBuilder ? textBuilder(dataset) : JSON.stringify(dataset, null, 2);
        try {
            await writeTextToClipboard(text);
            state.historyPreview.lastMessage = 'Preview dataset JSON copied. It remains graph-ready staging only; active graph unchanged.';
            if (button) button.textContent = 'Copied';
        } catch (error) {
            state.historyPreview.lastMessage = 'Clipboard unavailable. Preview dataset JSON was not copied.';
            if (button) button.textContent = 'Copy Failed';
        }
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        window.setTimeout(() => {
            if (button) button.textContent = original;
        }, 1400);
    }

    function prepareHistoryPreviewDatasetForReplay(dataset = {}) {
        const transactions = Array.isArray(dataset.transactions) ? dataset.transactions : [];
        const maxReplayTransactions = HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions;
        if (transactions.length <= maxReplayTransactions) return dataset;

        const scored = transactions.map((transaction, index) => ({
            transaction,
            index,
            timestampMs: getHistoryTimestampMs(transaction.timestamp),
            score: scoreHistoryReplayTransaction(transaction)
        }));
        const anchors = [
            ...scored.filter(item => item.timestampMs).sort((a, b) => a.timestampMs - b.timestampMs).slice(0, 12),
            ...scored.filter(item => item.timestampMs).sort((a, b) => b.timestampMs - a.timestampMs).slice(0, 12)
        ];
        const selected = new Map();
        anchors.forEach(item => selected.set(item.index, item));
        scored
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || a.timestampMs - b.timestampMs || a.index - b.index)
            .forEach(item => {
                if (selected.size < maxReplayTransactions) selected.set(item.index, item);
            });
        if (selected.size < maxReplayTransactions) {
            scored.forEach(item => {
                if (selected.size < maxReplayTransactions) selected.set(item.index, item);
            });
        }

        const selectedTransactions = [...selected.values()]
            .sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index)
            .map(item => item.transaction);
        const warnings = [
            ...(Array.isArray(dataset.metadata?.warnings) ? dataset.metadata.warnings : []),
            `Replay density filter selected ${selectedTransactions.length} major/timeline transfer rows from ${transactions.length} graph-ready rows. Trivial rows remain omitted from the preview animation cap.`
        ];

        return {
            ...dataset,
            metadata: {
                ...(dataset.metadata || {}),
                replay_density_filter: {
                    enabled: true,
                    source_transactions: transactions.length,
                    selected_transactions: selectedTransactions.length,
                    cap: maxReplayTransactions,
                    trivial_events_skipped: Math.max(0, transactions.length - selectedTransactions.length),
                    basis: 'major_flows_plus_timeline_anchors',
                    preview_only: true
                },
                warnings,
                counts: {
                    ...(dataset.metadata?.counts || {}),
                    replayDensitySourceTransactions: transactions.length,
                    replayDensitySelectedTransactions: selectedTransactions.length
                }
            },
            transactions: selectedTransactions
        };
    }

    function scoreHistoryReplayTransaction(transaction = {}) {
        const amount = Math.abs(Number(transaction.amount) || parseHistoryAmount(transaction.amount_display));
        const hasEndpoints = Boolean(transaction.source_wallet && transaction.destination_wallet);
        if (!hasEndpoints) return 0;
        let score = 1;
        if (amount > 0) score += Math.min(40, Math.log10(amount + 1) * 8);
        if (transaction.direction && transaction.direction !== 'self') score += 8;
        if (transaction.symbol || transaction.token_mint) score += 5;
        if (transaction.timestamp) score += 4;
        if (transaction.transaction_group_id) score += 3;
        if (/swap|transfer|sale|buy|sell|mint/i.test(transaction.transaction_type || transaction.transaction_type_label || '')) score += 3;
        return score;
    }

    function parseHistoryAmount(value) {
        const match = String(value || '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
        const number = Number(match?.[0]);
        return Number.isFinite(number) ? Math.abs(number) : 0;
    }

    function getHistoryPreviewDatasetMetrics(dataset = {}) {
        const metricsBuilder = namespace.historyGraphPreview?.getPreviewDatasetMetrics
            || namespace.historyDatasetBuilder?.getDatasetMetrics;
        if (metricsBuilder) return metricsBuilder(dataset);
        const metadata = dataset.metadata || {};
        return {
            previewOnly: metadata.preview_only === true,
            notMerged: metadata.not_merged === true,
            activeGraphUnchanged: metadata.active_graph_unchanged === true,
            wallets: Array.isArray(dataset.wallets) ? dataset.wallets.length : 0,
            tokens: Array.isArray(dataset.tokens) ? dataset.tokens.length : 0,
            transactions: Array.isArray(dataset.transactions) ? dataset.transactions.length : 0,
            transactionGroups: Array.isArray(dataset.transaction_groups) ? dataset.transaction_groups.length : 0,
            stagedRowsReceived: Number(metadata.counts?.stagedRowsReceived) || 0,
            stagedRowsProcessed: Number(metadata.counts?.stagedRowsProcessed) || 0,
            duplicateTransferRowsSkipped: Number(metadata.counts?.duplicateTransferRowsSkipped) || 0,
            transferRowsOmittedMissingWallets: Number(metadata.counts?.transferRowsOmittedMissingWallets) || 0,
            warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
            boundary: metadata.boundary || 'Preview dataset only. Active graph unchanged.'
        };
    }

    function buildFallbackHistoryPreviewDataset() {
        return {
            metadata: {
                version: 'd110_history_dataset_builder_unavailable',
                generated_at: new Date().toISOString(),
                preview_only: true,
                not_merged: true,
                merged_into_active_graph: false,
                active_graph_unchanged: true,
                graph_ready_staging_only: true,
                browser_provider_calls: false,
                api_key_exposure: false,
                boundary: 'Dataset builder module unavailable. Active graph unchanged.',
                no_claims: {
                    identity: false,
                    ownership: false,
                    risk: false,
                    criminality: false,
                    investment: false
                },
                counts: {
                    stagedRowsReceived: (state.history.loadedTransactions || []).length,
                    stagedRowsProcessed: 0,
                    transferRowsIncluded: 0
                },
                warnings: ['History dataset builder module unavailable; no graph-ready transfer rows were prepared.']
            },
            wallets: [],
            tokens: [],
            entities: [],
            transactions: [],
            transaction_groups: []
        };
    }

    async function previewLifetimeReplay() {
        state.investigationTab = 'replay';
        await loadHistoryGraphPreviewModule();
        const summary = buildHistoryGraphPreviewSummary();
        const builder = namespace.historyGraphPreview?.buildReplayPlan;
        state.historyPreview.plan = builder
            ? builder(summary, { trackedWallet: summary.trackedWallet })
            : buildFallbackReplayPlan(summary);
        state.historyPreview.generatedAt = Date.now();
        state.historyPreview.lastMessage = summary.transferEventCount
            ? 'Replay plan generated from staged history only. No graph merge or animation was started.'
            : 'Replay readiness checklist generated. Load history pages before planning a real lifetime replay.';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
    }

    function clearHistoryGraphPreview() {
        state.investigationTab = 'replay';
        state.historyPreview.plan = null;
        state.historyPreview.dataset = null;
        state.historyPreview.datasetMetrics = null;
        state.historyPreview.generatedAt = 0;
        state.historyPreview.datasetGeneratedAt = 0;
        state.historyPreview.graphVisible = false;
        state.historyPreview.graphRenderResult = null;
        state.historyPreview.graphRenderedAt = 0;
        state.historyPreview.activeReplayWindow = null;
        state.historyPreview.replayWindowResponse = null;
        state.historyPreview.replayWindowCache?.clear?.();
        detachHistoryReplayAnimator({ preserveStatus: false });
        resetHistoryPreviewAuditState();
        state.historyPreview.replaySpeed = 'standard';
        state.historyPreview.lastMessage = 'Preview artifacts cleared. Staged history and the active graph were not changed.';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
    }

    async function copyHistoryReplayPlan(button) {
        const original = button?.textContent || 'Copy Replay Plan';
        state.investigationTab = 'replay';
        const summary = buildHistoryGraphPreviewSummary();
        const plan = state.historyPreview.plan || buildFallbackReplayPlan(summary);
        const textBuilder = namespace.historyGraphPreview?.buildReplayPlanText;
        const text = textBuilder
            ? textBuilder(summary, plan)
            : JSON.stringify({ name: 'CryptoPhotonic Lifetime Replay Preview Plan', summary, plan }, null, 2);
        try {
            await writeTextToClipboard(text);
            state.historyPreview.lastMessage = 'Replay plan copied. It remains preview-only and graph-neutral.';
            if (button) button.textContent = 'Copied';
        } catch (error) {
            state.historyPreview.lastMessage = 'Clipboard unavailable. Replay plan was not copied.';
            if (button) button.textContent = 'Copy Failed';
        }
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        window.setTimeout(() => {
            if (button) button.textContent = original;
        }, 1400);
    }

    async function ensureHistoryController(wallet = '') {
        await loadHistoryModules();
        const Controller = namespace.historyController?.HistoryController;
        if (!Controller) return null;
        const provider = createWorkerHistoryProvider();
        if (!state.history.controller) {
            state.history.controller = new Controller({ wallet, provider, pageLimit: HISTORY_PREVIEW_TRANSACTION_LIMIT });
        } else if (wallet && state.history.controller.wallet !== wallet && !state.history.pagesLoaded) {
            state.history.controller.reset(wallet);
        }
        state.history.controller.setProvider?.(provider);
        applyHistorySnapshot(state.history.controller.getSnapshot());
        return state.history.controller;
    }

    function createWorkerHistoryProvider() {
        const Provider = namespace.historyProvider?.WorkerWalletHistoryProvider;
        if (!Provider) return null;
        const endpoint = resolveWalletHistoryEndpoint();
        if (!endpoint) return null;
        return new Provider({
            endpoint,
            limit: 10
        });
    }

    function loadHistoryModules() {
        if (namespace.historyProvider?.WalletHistoryProvider && namespace.historyController?.HistoryController) {
            loadHistoryGraphPreviewModule();
            return Promise.resolve(true);
        }
        if (state.history.moduleLoadPromise) return state.history.moduleLoadPromise;
        state.history.moduleLoadPromise = Promise.resolve()
            .then(() => loadCryptoScript('js/crypto/historyProvider.js'))
            .then(() => loadCryptoScript('js/crypto/historyController.js'))
            .then(() => loadHistoryGraphPreviewModule())
            .then(() => Boolean(namespace.historyController?.HistoryController))
            .catch(error => {
                state.history.lastError = error?.message || 'History modules unavailable';
                return false;
            });
        return state.history.moduleLoadPromise;
    }

    function loadHistoryGraphPreviewModule() {
        if (namespace.historyGraphPreview?.buildPreviewSummary && namespace.historyDatasetBuilder?.buildHistoryDataset) return Promise.resolve(true);
        if (state.history.previewModuleLoadPromise) return state.history.previewModuleLoadPromise;
        state.history.previewModuleLoadPromise = loadHistoryDatasetBuilderModule()
            .then(() => loadCryptoScript('js/crypto/historyGraphPreview.js'))
            .then(() => Boolean(namespace.historyGraphPreview?.buildPreviewSummary))
            .catch(error => {
                state.historyPreview.lastMessage = error?.message || 'History graph preview module unavailable';
                return false;
            });
        return state.history.previewModuleLoadPromise;
    }

    function loadHistoryDatasetBuilderModule() {
        if (namespace.historyDatasetBuilder?.buildHistoryDataset) return Promise.resolve(true);
        if (state.history.datasetBuilderLoadPromise) return state.history.datasetBuilderLoadPromise;
        state.history.datasetBuilderLoadPromise = loadCryptoScript('js/crypto/historyDatasetBuilder.js')
            .then(() => Boolean(namespace.historyDatasetBuilder?.buildHistoryDataset))
            .catch(error => {
                state.historyPreview.lastMessage = error?.message || 'History dataset builder module unavailable';
                return false;
            });
        return state.history.datasetBuilderLoadPromise;
    }

    function loadHistoryGraphRendererModule() {
        if (namespace.historyGraphRenderer?.renderPreviewDataset) return Promise.resolve(true);
        if (state.history.graphRendererLoadPromise) return state.history.graphRendererLoadPromise;
        state.history.graphRendererLoadPromise = loadCryptoScript('js/crypto/historyGraphRenderer.js')
            .then(() => Boolean(namespace.historyGraphRenderer?.renderPreviewDataset))
            .catch(error => {
                state.historyPreview.lastMessage = error?.message || 'History graph renderer module unavailable';
                return false;
            });
        return state.history.graphRendererLoadPromise;
    }

    function loadHistoryReplayAnimatorModule() {
        if (namespace.historyReplayAnimator?.createReplayAnimator) return Promise.resolve(true);
        if (state.history.replayAnimatorLoadPromise) return state.history.replayAnimatorLoadPromise;
        state.history.replayAnimatorLoadPromise = loadCryptoScript('js/crypto/historyReplayAnimator.js')
            .then(() => Boolean(namespace.historyReplayAnimator?.createReplayAnimator))
            .catch(error => {
                state.historyPreview.lastMessage = error?.message || 'History replay animator module unavailable';
                return false;
            });
        return state.history.replayAnimatorLoadPromise;
    }

    function loadCryptoScript(src) {
        if (!document?.createElement || !document?.head) return Promise.resolve(false);
        const existing = [...document.scripts || []].find(script => script.getAttribute('src')?.split('?')[0] === src);
        if (existing) return Promise.resolve(true);
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.src = `${src}?v=${Date.now()}`;
            script.async = false;
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
    }

    function applyHistorySnapshot(snapshot = {}) {
        state.history.pagesLoaded = Math.max(0, Number(snapshot.pagesLoaded) || 0);
        state.history.providerPagesLoaded = Math.max(0, Number(snapshot.providerPagesLoaded) || 0);
        state.history.totalLoadedTransactions = Math.max(0, Number(snapshot.totalLoadedTransactions) || 0);
        state.history.moreAvailable = Boolean(snapshot.moreAvailable);
        state.history.nextCursor = snapshot.nextCursor ?? null;
        state.history.lastError = snapshot.lastError || '';
        state.history.lastMessage = snapshot.lastMessage || '';
        state.history.lastStatus = snapshot.lastStatus || 'idle';
        state.history.lastMetadata = snapshot.lastMetadata || {};
        state.history.progress = snapshot.progress || null;
        state.history.providerConfigured = Boolean(snapshot.providerConfigured);
        state.history.provider = snapshot.provider || '';
        state.history.providerLabel = snapshot.providerLabel || snapshot.providerCapabilities?.label || snapshot.provider || '';
        state.history.providerCapabilities = snapshot.providerCapabilities || null;
        state.history.providerDiagnostics = snapshot.lastMetadata?.provider_diagnostics || state.history.providerDiagnostics || null;
        state.history.scanManifest = snapshot.scanManifest || snapshot.lastMetadata?.scan_manifest || state.history.scanManifest || null;
        state.history.scanId = snapshot.scanId || snapshot.lastMetadata?.scan_id || state.history.scanManifest?.scan_id || state.history.scanId || '';
        state.history.gapFlags = mergeUiStringLists(snapshot.gapFlags, snapshot.lastMetadata?.gap_flags, state.history.scanManifest?.gap_flags);
        state.history.warnings = mergeUiStringLists(snapshot.warnings, snapshot.lastMetadata?.warnings, state.history.scanManifest?.warnings);
        state.history.replayWindow = snapshot.replayWindow || snapshot.lastMetadata?.replay_window || state.history.replayWindow || null;
        state.historyPreview.replayWindowResponse = snapshot.replayWindowResponse || state.historyPreview.replayWindowResponse || null;
        state.history.scanCache = snapshot.scanCache || snapshot.lastMetadata?.scan_cache || state.history.scanManifest?.cache_state || state.history.scanCache || null;
        state.history.replayReconstruction = snapshot.replayReconstruction || snapshot.lastMetadata?.replay_reconstruction || state.history.scanManifest?.replay_reconstruction || state.history.replayReconstruction || null;
        state.history.loadedTransactions = Array.isArray(snapshot.loadedTransactions) ? snapshot.loadedTransactions.slice(0, HISTORY_PREVIEW_TRANSACTION_LIMIT) : [];
        state.history.backendProviderConnected = Boolean(snapshot.provider && snapshot.providerCapabilities && snapshot.providerCapabilities.browserProviderCalls === false && !snapshot.providerCapabilities.backendOnly);
        state.historyPreview.checkpoint = loadReplayAuditCheckpoint({ allowLatest: true }) || state.historyPreview.checkpoint || null;
    }

    function mergeUiStringLists(...lists) {
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

    function getHistoryCurrentCursor(payload = {}) {
        return payload.cursor ?? payload.current_cursor ?? payload.page?.cursor ?? null;
    }

    function getHistoryNextCursor(payload = {}) {
        return payload.nextCursor
            ?? payload.next_cursor
            ?? payload.cursor_next
            ?? payload.pagination?.nextCursor
            ?? payload.pagination?.next_cursor
            ?? payload.page?.nextCursor
            ?? payload.page?.next_cursor
            ?? null;
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
        state.historyPreview.selectedEvent = null;
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

    function resolveWalletHistoryEndpoint() {
        const configuredValue = [
            window.CryptoPhotonicWorkerWalletHistoryEndpoint,
            state.root?.dataset?.workerWalletHistoryEndpoint
        ].find(value => typeof value === 'string' && value.trim());
        if (configuredValue) {
            const configuredEndpoint = resolveWorkerEndpoint({
                configuredValue,
                defaultEndpoint: DEFAULT_WORKER_WALLET_HISTORY_ENDPOINT
            });
            return configuredEndpoint.valid ? configuredEndpoint.endpoint : '';
        }

        const fromLookupEndpoint = deriveSiblingWorkerEndpoint(
            resolveWalletLookupEndpoint(),
            DEFAULT_WORKER_WALLET_ACTIVITY_ENDPOINT,
            DEFAULT_WORKER_WALLET_HISTORY_ENDPOINT
        );
        if (fromLookupEndpoint) return fromLookupEndpoint;

        return deriveSiblingWorkerEndpoint(
            state.live.endpoint,
            DEFAULT_WORKER_FEED_ENDPOINT,
            DEFAULT_WORKER_WALLET_HISTORY_ENDPOINT
        );
    }

    function deriveSiblingWorkerEndpoint(endpoint, expectedPath, nextPath) {
        if (!endpoint) return '';
        try {
            const parsed = endpoint.startsWith('/')
                ? new URL(endpoint, window.location.origin)
                : new URL(endpoint);
            if (!isSafeWorkerUrl(parsed, {
                expectedPath,
                allowExternal: true
            })) return '';
            parsed.pathname = parsed.pathname.slice(0, -expectedPath.length) + nextPath;
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
        state.hoveredId = null;
        state.hoveredFlowId = null;
        state.tokenIsolation = 'all';
        state.historyPreview.selectedEvent = null;
        state.manualNodePositions.clear();
        applyDefaultLabelDensityForDataMode(state.dataMode);
        hideHoverOverlay();
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

    function handleWindowResize() {
        applyDefaultLabelDensityForDataMode(state.dataMode);
        resizeAndRender();
        refreshReplayWorkspaceCanvasAfterResize();
        renderMobileInvestigationDrawer();
        updateInteractionDock();
    }

    function refreshReplayWorkspaceCanvasAfterResize() {
        if (!state.historyPreview.workspaceMode) return;
        updateReplayWorkspaceShell();
        window.requestAnimationFrame(() => {
            if (state.historyPreview.replayAnimator?.render) {
                state.historyPreview.replayAnimator.render();
                return;
            }
            renderHistoryGraphPreviewCanvas(getHistoryPreviewRenderRoot());
        });
    }

    function scheduleRender() {
        if (!state.ctx || !state.graph) return;
        if (state.renderPerf.rafId) {
            state.renderPerf.pending = true;
            return;
        }
        state.renderPerf.rafId = requestAnimationFrame(() => {
            state.renderPerf.rafId = null;
            state.renderPerf.pending = false;
            render();
        });
    }

    function render() {
        if (!state.ctx || !state.graph || state.renderPerf.inRender) {
            if (state.renderPerf.inRender) scheduleRender();
            return;
        }

        state.renderPerf.inRender = true;
        let restoreCryptoMotion = null;
        let cryptoMotionActive = false;
        try {
            const { width, height } = state.graph.bounds;
            const ctx = state.ctx;
            updateFlowReplay(performance.now());
            state.flowMotion.now = performance.now();
            const visibleFlowEdges = getVisibleFlowEdges();
            const rawVisibleEdges = getVisibleEdges(visibleFlowEdges);
            state.topologyModel = buildCryptoTopologyModel(visibleFlowEdges);
            state.semanticZoom = getCryptoSemanticZoomState(visibleFlowEdges, state.topologyModel);
            syncCryptoSemanticUi();
            renderCryptoSpatialBreadcrumbs();
            const interaction = getInteractionState(visibleFlowEdges);
            interaction.semanticZoom = state.semanticZoom;
            interaction.topologyModel = state.topologyModel;
            const visibleEdges = getRenderableEdges(rawVisibleEdges, interaction);
            interaction.visibleFlowEdges = visibleFlowEdges;
            interaction.visibleFlowCount = visibleFlowEdges.length;
            interaction.labelLayout = createLabelLayout(width, height);
            const cinematicFrame = applyCryptoCinematicMotion(interaction, visibleFlowEdges);
            restoreCryptoMotion = cinematicFrame.restore;
            cryptoMotionActive = cinematicFrame.active;
            ctx.clearRect(0, 0, width, height);
            drawBackdrop(ctx, width, height);

            ctx.save();
            ctx.translate(state.viewport.x, state.viewport.y);
            ctx.scale(state.viewport.scale, state.viewport.scale);

            const nodeById = state.graph.nodeById;
            drawCryptoFlowCorridors(ctx, visibleFlowEdges, nodeById, interaction);
            visibleEdges
                .filter(edge => edge.type !== core.EDGE_TYPES.LABEL)
                .sort((a, b) => edgeLayerOrder(a) - edgeLayerOrder(b) || (a.width || 0) - (b.width || 0))
                .forEach(edge => drawEdge(ctx, edge, nodeById, interaction, { drawFlowLabels: false }));

            visibleEdges
                .filter(edge => edge.type === core.EDGE_TYPES.LABEL)
                .forEach(edge => drawEdge(ctx, edge, nodeById, interaction));

            state.graph.nodes
                .slice()
                .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
                .forEach(node => drawNode(ctx, node, interaction));

            visibleFlowEdges
                .slice()
                .sort((a, b) => getFlowLabelPriority(b, interaction) - getFlowLabelPriority(a, interaction))
                .forEach(edge => drawFlowEdgeLabel(ctx, edge, nodeById, interaction));

            ctx.restore();
        } finally {
            restoreCryptoMotion?.();
            state.renderPerf.inRender = false;
        }
        if (cryptoMotionActive && !state.renderPerf.pending) {
            scheduleRender();
            return;
        }
        if (state.renderPerf.pending) {
            state.renderPerf.pending = false;
            scheduleRender();
        }
    }

    function getRenderableEdges(edges, interaction) {
        const list = Array.isArray(edges) ? edges : [];
        if (interaction?.hasFocus || list.length <= 520 && interaction?.semanticZoom?.tierRank >= 2) return list;
        const semantic = interaction?.semanticZoom || state.semanticZoom || {};
        const semanticLimit = semantic.tier === 'macro'
            ? 360
            : semantic.tier === 'cluster' ? 520 : 0;
        const limit = semanticLimit || (list.length > 1200 ? 620 : list.length > 820 ? 720 : 840);
        if (list.length <= limit) return list;
        return list
            .slice()
            .sort((a, b) => getCryptoEdgePriority(b, interaction) - getCryptoEdgePriority(a, interaction))
            .slice(0, limit);
    }

    function getCryptoEdgePriority(edge = {}, interaction = {}) {
        let score = Number(edge.usd_value || 0) > 0 ? Math.log10(Number(edge.usd_value || 0) + 1) * 18 : 0;
        if (edge.type === core.EDGE_TYPES.FLOW) score += 120;
        if (edge.is_large_value) score += 160;
        if (edge.flow_role === 'swap_route') score += 70;
        if (edge.type === core.EDGE_TYPES.EXPOSURE) score += 34;
        if (edge.type === core.EDGE_TYPES.LABEL) score += 20 + Math.min(80, Number(edge.transaction_count || 0) * 8);
        if (interaction.topologyModel?.priorityFlowIds?.has(edge.id)) score += 220;
        if (interaction.topologyModel?.exchangeFlowIds?.has(edge.id)) score += 90;
        if (interaction.topologyModel?.funnelFlowIds?.has(edge.id)) score += 70;
        if (interaction.topologyModel?.replayFlowIds?.has(edge.id)) score += 60;
        return score;
    }

    function getVisibleEdges(visibleFlowEdges = getVisibleFlowEdges()) {
        if (!state.graph) return [];
        const visibleFlowIds = new Set(visibleFlowEdges.map(edge => edge.id));
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

    function buildCryptoTopologyModel(visibleFlowEdges = getVisibleFlowEdges()) {
        if (!topologyTools.buildTopologyModel) return null;
        return topologyTools.buildTopologyModel({
            graph: state.graph,
            visibleFlowEdges,
            selectedId: state.selectedId,
            selectedFlowId: state.selectedFlowId,
            mode: document.body?.dataset?.cryptoUxMode || 'flow'
        });
    }

    function getCryptoSemanticZoomState(visibleFlowEdges = getVisibleFlowEdges(), topologyModel = state.topologyModel) {
        if (!semanticZoomTools.getCryptoSemanticState) {
            return {
                tier: 'relationship',
                tierRank: 2,
                tierLabel: 'Relationship',
                showFlowLabels: true,
                showAmounts: true,
                weakFlowAlpha: 0.58,
                weakFlowWidthMultiplier: 0.86,
                flowLabelAlpha: 0.74,
                maxNodeLabels: getMaxVisibleGraphLabels()
            };
        }
        return semanticZoomTools.getCryptoSemanticState({
            scale: state.viewport.scale || 1,
            nodeCount: state.graph?.nodes?.length || 0,
            edgeCount: state.graph?.edges?.length || visibleFlowEdges.length,
            mode: document.body?.dataset?.cryptoUxMode || 'flow',
            dataMode: state.dataMode,
            labelDensity: state.labelDensity,
            selectedId: state.selectedId,
            selectedFlowId: state.selectedFlowId,
            replayActiveFlowId: state.flowReplay.activeFlowId,
            replayActive: state.flowReplay.playing || state.historyPreview.workspaceMode,
            tokenIsolationActive: state.tokenIsolation !== 'all',
            mobile: isMobileViewport(),
            topologyModel
        });
    }

    function syncCryptoSemanticUi() {
        const semantic = state.semanticZoom;
        if (!semantic) return;
        const key = `${semantic.tier}|${semantic.mode}|${semantic.densityKey}`;
        if (state.lastSemanticUiKey === key) return;
        state.lastSemanticUiKey = key;
        state.root?.dataset && (state.root.dataset.semanticZoomTier = semantic.tier);
        state.root?.dataset && (state.root.dataset.semanticDensity = semantic.densityKey || '');
        const wrap = state.canvas?.parentElement;
        if (wrap?.dataset) {
            wrap.dataset.semanticZoomTier = semantic.tier;
            wrap.dataset.semanticDensity = semantic.densityKey || '';
        }
        renderCryptoSpatialBreadcrumbs();
    }

    function renderCryptoSpatialBreadcrumbs() {
        const container = document.getElementById('crypto-spatial-breadcrumbs');
        if (!container || !state.graph) return;
        const selectedNode = state.selectedId ? state.graph.nodeById.get(state.selectedId) : null;
        const selectedFlow = getSelectedFlowEdge();
        const tokenIsolation = state.tokenIsolation !== 'all' ? getTokenIsolationLabel(state.tokenIsolation) : '';
        const parts = semanticZoomTools.buildCryptoBreadcrumbParts?.({
            semanticZoom: state.semanticZoom || getCryptoSemanticZoomState(),
            scale: state.viewport.scale || 1,
            mode: document.body?.dataset?.cryptoUxMode || 'flow',
            dataModeLabel: getCurrentSourceLabel(),
            selectedNodeLabel: selectedNode ? compactNodeLabel(selectedNode) : '',
            selectedFlowLabel: selectedFlow ? getFlowBreadcrumbLabel(selectedFlow) : '',
            replayActive: state.historyPreview.workspaceMode || state.flowReplay.playing,
            tokenIsolationLabel: tokenIsolation,
            selectedId: state.selectedId,
            selectedFlowId: state.selectedFlowId,
            replayActiveFlowId: state.flowReplay.activeFlowId,
            tokenIsolationActive: state.tokenIsolation !== 'all',
            nodeCount: state.graph?.nodes?.length || 0,
            edgeCount: state.graph?.edges?.length || 0,
            labelDensity: state.labelDensity,
            mobile: isMobileViewport()
        }) || [];
        if (state.historyPreview.workspaceMode) {
            const event = getSelectedHistoryReplayEvent(getHistoryReplayStatus());
            if (event?.step) {
                parts.push({
                    label: `Replay #${event.step}`,
                    title: `${getHistoryReplayAmountTokenLabel(event)} / staged replay event`
                });
            }
            const neighborhood = state.historyPreview.audit?.neighborhood || {};
            if (neighborhood.mode && neighborhood.mode !== 'none') {
                parts.push({
                    label: `${String(neighborhood.mode).replaceAll('_', ' ')} neighborhood`,
                    title: 'Active replay neighborhood focus'
                });
            }
        }
        const signature = parts.map(part => part.label).join('|');
        if (signature === state.lastBreadcrumbKey) return;
        state.lastBreadcrumbKey = signature;
        container.innerHTML = parts.map(part => `<span title="${escapeAttr(part.title || part.label)}">${escapeHtml(part.label)}</span>`).join('');
    }

    function getFlowBreadcrumbLabel(edge = {}) {
        const type = edge.transaction_type_label || edge.flow_role || 'Flow';
        const amount = getNormalizedFlowAmountDisplay(edge);
        return `${type}${amount ? ` ${amount}` : ''}`.trim();
    }

    function getTokenIsolationLabel(value = '') {
        if (!value || value === 'all') return '';
        const [mint, symbol] = String(value).split('|');
        return `${symbol || shortLongValue(mint) || 'Token'} exposure`;
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

    function edgeMatchesTokenIsolation(edge) {
        if (!edge || state.tokenIsolation === 'all') return true;
        return getTokenKeyForEdge(edge) === state.tokenIsolation;
    }

    function getTokenKeyForEdge(edge = {}) {
        return `${edge.token_mint || ''}|${edge.symbol || ''}`;
    }

    function exposureEdgeMatchesFilters(edge) {
        if (state.filters.token === 'all') return true;
        const token = state.graph?.nodeById.get(edge.target);
        if (token) return `${token.token_mint || ''}|${token.symbol || ''}` === state.filters.token;
        return `${edge.token_mint || ''}|${edge.symbol || ''}` === state.filters.token
            || `${edge.target || ''}|${edge.symbol || ''}` === state.filters.token;
    }

    function selectFlow(flowId, options = {}) {
        const edge = (state.graph?.flowEdges || []).find(item => item.id === flowId && edgeMatchesActiveFilters(item));
        if (!edge) return null;
        state.selectedFlowId = edge.id;
        state.selectedId = null;
        state.historyPreview.selectedEvent = null;
        if (options.openDetails) state.investigationTab = 'details';
        state.flowReplay.activeFlowId = edge.id;
        state.flowReplay.lastStepAt = performance.now();
        openMobileDrawerForSelection(options.openDetails ? 'expanded' : 'half');
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        render();
        renderDetails();
        updateFlowAnimationLoop();
        updateInteractionDock();
        return edge;
    }

    function selectWalletAddress(address = '', options = {}) {
        const node = getWalletNodeForAddress(address);
        if (!node) return null;
        state.selectedId = node.id;
        state.selectedFlowId = null;
        state.historyPreview.selectedEvent = null;
        if (options.openDetails) state.investigationTab = 'details';
        state.flowReplay.activeFlowId = null;
        openMobileDrawerForSelection(options.openDetails ? 'expanded' : 'half');
        render();
        renderDetails();
        updateInteractionDock();
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

    function setTokenIsolation(filterValue = 'all') {
        state.tokenIsolation = filterValue || 'all';
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        render();
        renderDetails();
        updateInteractionDock();
        return state.tokenIsolation;
    }

    function toggleFocusSelection() {
        state.focusSelection = !state.focusSelection;
        render();
        updateInteractionDock();
        return state.focusSelection;
    }

    function normalizeLabelDensity(mode) {
        const key = String(mode || '').toLowerCase();
        return LABEL_DENSITY_MODES[key] ? key : 'balanced';
    }

    function getLabelDensityMode() {
        return LABEL_DENSITY_MODES[state.labelDensity] || LABEL_DENSITY_MODES.balanced;
    }

    function setLabelDensity(mode, options = {}) {
        const nextMode = normalizeLabelDensity(mode);
        state.labelDensity = nextMode;
        if (!options.systemDefault) state.labelDensityUserSet = true;
        render();
        syncLabelDensityControls();
        updateInteractionDock();
        if (state.historyPreview.graphVisible) {
            renderHistoryGraphPreviewCanvas(getHistoryPreviewRenderRoot(), { resumeReplay: false });
        }
        return state.labelDensity;
    }

    function cycleLabelDensity() {
        const currentIndex = LABEL_DENSITY_ORDER.indexOf(state.labelDensity);
        const nextIndex = currentIndex < 0 ? 1 : (currentIndex + 1) % LABEL_DENSITY_ORDER.length;
        return setLabelDensity(LABEL_DENSITY_ORDER[nextIndex]);
    }

    function applyDefaultLabelDensityForDataMode(mode) {
        if (state.labelDensityUserSet) return;
        state.labelDensity = getResponsiveDefaultLabelDensity(mode);
        syncLabelDensityControls();
    }

    function getResponsiveDefaultLabelDensity(mode = state.dataMode) {
        if (isMobileViewport()) return 'minimal';
        return mode === DATA_MODES.WALLET ? 'balanced' : 'balanced';
    }

    function isMobileViewport() {
        return Boolean(window.matchMedia?.('(max-width: 768px)').matches)
            || (state.canvas?.parentElement?.clientWidth || state.canvas?.clientWidth || window.innerWidth || 0) < 640;
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

    function applyCryptoCinematicMotion(interaction = {}, visibleFlowEdges = []) {
        const graph = state.graph;
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
        if (!nodes.length) return { active: false, restore: null };

        const now = performance.now();
        const motion = state.cinematicMotion;
        const dt = motion.lastFrameAt ? Math.min(0.06, Math.max(0.001, (now - motion.lastFrameAt) / 1000)) : 1 / 60;
        motion.lastFrameAt = now;
        const semanticRank = Number(interaction.semanticZoom?.tierRank ?? state.semanticZoom?.tierRank ?? 2);
        const response = 1 - Math.exp(-(semanticRank >= 3 ? 13 : semanticRank === 2 ? 11 : 8) * dt);
        const scale = Math.max(0.35, state.viewport.scale || 1);
        const bubbleRadius = (semanticRank >= 3 ? 112 : semanticRank === 2 ? 94 : 72) / scale;
        const maxPush = (semanticRank >= 3 ? 46 : semanticRank === 2 ? 36 : 24) / scale;
        const nodeById = graph.nodeById || new Map(nodes.map(node => [node.id, node]));
        const focusAnchors = getCryptoFocusAnchors(interaction, visibleFlowEdges, nodeById);
        const targets = new Map();

        if (focusAnchors.length) {
            nodes.forEach(node => {
                if (!node || focusAnchors.some(anchor => anchor.id === node.id)) return;
                let target = { x: 0, y: 0 };
                focusAnchors.forEach(anchor => {
                    const dx = node.x - anchor.x;
                    const dy = node.y - anchor.y;
                    const distance = Math.max(1, Math.hypot(dx, dy));
                    const connected = interaction.connectedNodeIds?.has(node.id) || interaction.tokenIsolationNodeIds?.has(node.id);
                    const limit = bubbleRadius * (connected ? 1.72 : 1.08);
                    if (distance > limit) return;
                    const weight = Math.pow(1 - Math.min(1, distance / limit), connected ? 1.2 : 1.55);
                    const push = weight * maxPush * (connected ? 1.18 : 0.78);
                    target.x += (dx / distance) * push;
                    target.y += (dy / distance) * push;
                });
                if (Math.hypot(target.x, target.y) > 0.08) targets.set(node.id, target);
            });
        }

        const changedNodes = [];
        const allIds = new Set([...motion.offsets.keys(), ...targets.keys()]);
        let active = false;
        allIds.forEach(id => {
            const target = targets.get(id) || { x: 0, y: 0 };
            const current = motion.offsets.get(id) || { x: 0, y: 0 };
            current.x += (target.x - current.x) * response;
            current.y += (target.y - current.y) * response;
            const magnitude = Math.hypot(current.x, current.y);
            if (magnitude < 0.08 && !targets.has(id)) {
                motion.offsets.delete(id);
                return;
            }
            motion.offsets.set(id, current);
            const node = nodeById.get(id);
            if (!node) return;
            node.x += current.x;
            node.y += current.y;
            changedNodes.push({ node, x: current.x, y: current.y });
            active = active || Math.hypot(target.x - current.x, target.y - current.y) * scale > 0.35 || (!targets.has(id) && magnitude * scale > 0.35);
        });

        motion.active = active;
        return {
            active,
            restore: () => {
                changedNodes.forEach(item => {
                    item.node.x -= item.x;
                    item.node.y -= item.y;
                });
            }
        };
    }

    function getCryptoFocusAnchors(interaction = {}, visibleFlowEdges = [], nodeById = new Map()) {
        const anchors = [];
        const addNode = node => {
            if (!node || anchors.some(anchor => anchor.id === node.id)) return;
            anchors.push({ id: node.id, x: node.x, y: node.y });
        };
        addNode(nodeById.get(state.selectedId));
        const selectedFlow = visibleFlowEdges.find(edge => edge.id === interaction.selectedFlowId || edge.id === interaction.replayActiveFlowId);
        if (selectedFlow) {
            addNode(nodeById.get(selectedFlow.source));
            addNode(nodeById.get(selectedFlow.target));
        }
        if (!anchors.length && state.historyPreview.workspaceMode) {
            const replayEdge = visibleFlowEdges.find(edge => edge.id === state.flowReplay.activeFlowId) || visibleFlowEdges[0];
            if (replayEdge) {
                addNode(nodeById.get(replayEdge.source));
                addNode(nodeById.get(replayEdge.target));
            }
        }
        return anchors.slice(0, 3);
    }

    function drawCryptoFlowCorridors(ctx, visibleFlowEdges = [], nodeById = new Map(), interaction = {}) {
        if (!visibleFlowEdges.length) return;
        const semantic = interaction.semanticZoom || state.semanticZoom || {};
        if (semantic.tier === 'inspection' && !interaction.hasReplayFocus && !interaction.selectedFlowId) return;
        const buckets = new Map();
        visibleFlowEdges.forEach(edge => {
            const key = getCryptoFlowCorridorKey(edge, interaction);
            if (!key) return;
            const bucket = buckets.get(key) || {
                key,
                label: getCryptoFlowCorridorLabel(edge, key),
                color: getCryptoFlowCorridorColor(edge, key),
                edges: [],
                value: 0,
                active: false
            };
            bucket.edges.push(edge);
            bucket.value += Number(edge.usd_value) || 0;
            bucket.active = bucket.active || edge.id === interaction.selectedFlowId || edge.id === interaction.replayActiveFlowId;
            buckets.set(key, bucket);
        });
        const top = [...buckets.values()]
            .filter(bucket => bucket.edges.length >= 2 || bucket.active)
            .sort((a, b) => Number(b.active) - Number(a.active) || b.edges.length - a.edges.length || b.value - a.value)
            .slice(0, interaction.hasReplayFocus ? 2 : semantic.tierRank <= 1 ? 4 : 3);
        if (!top.length) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        top.forEach((bucket, index) => {
            ctx.globalAlpha = bucket.active ? 0.16 : semantic.tierRank <= 1 ? 0.095 : 0.065;
            ctx.strokeStyle = bucket.color;
            ctx.lineWidth = (bucket.active ? 14 : 9 - index) / Math.max(0.7, Math.sqrt(state.viewport.scale || 1));
            ctx.shadowBlur = bucket.active ? 18 : 8;
            ctx.shadowColor = bucket.color;
            if (bucket.active || interaction.hasReplayFocus) {
                ctx.setLineDash([18, 22]);
                ctx.lineDashOffset = -((state.flowMotion.now || performance.now()) / 80);
            } else {
                ctx.setLineDash([]);
            }
            bucket.edges.slice(0, bucket.active ? 84 : 56).forEach(edge => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return;
                const curve = getCryptoEdgeCurve(source, target, edge, getEdgeBend(edge) * 1.12);
                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.quadraticCurveTo(curve.control.x, curve.control.y, target.x, target.y);
                ctx.stroke();
            });
        });
        ctx.restore();
    }

    function getCryptoFlowCorridorKey(edge = {}, interaction = {}) {
        if (edge.id === interaction.replayActiveFlowId) return 'replay_path';
        if (edge.flow_role === 'swap_route' || /swap|route|bridge|pool/i.test(edge.flow_role || edge.transaction_type_label || '')) return 'liquidity_corridor';
        if (edge.symbol || edge.token_mint) return `token:${edge.symbol || edge.token_mint}`;
        return `direction:${getEdgeDirection(edge)}`;
    }

    function getCryptoFlowCorridorLabel(edge = {}, key = '') {
        if (key === 'replay_path') return 'Replay path';
        if (key === 'liquidity_corridor') return 'Liquidity corridor';
        if (key.startsWith('token:')) return `${edge.symbol || 'Token'} flow`;
        return String(getEdgeDirection(edge) || 'Flow').replaceAll('_', ' ');
    }

    function getCryptoFlowCorridorColor(edge = {}, key = '') {
        if (key === 'replay_path') return 'rgba(244, 114, 182, 0.9)';
        if (key === 'liquidity_corridor') return 'rgba(34, 211, 238, 0.82)';
        if (key.startsWith('token:')) return edge.color || 'rgba(250, 204, 21, 0.78)';
        return getEdgeDirection(edge) === 'inbound' ? 'rgba(96, 165, 250, 0.76)' : 'rgba(52, 211, 153, 0.76)';
    }

    function getCryptoEdgeCurve(source, target, edge = {}, bend = 0) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        return {
            distance,
            normal,
            control: {
                x: (source.x + target.x) / 2 + normal.x * bend,
                y: (source.y + target.y) / 2 + normal.y * bend
            }
        };
    }

    function drawEdge(ctx, edge, nodeById, interaction, options = {}) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const style = getEdgeInteractionStyle(edge, interaction);

        const curve = getCryptoEdgeCurve(source, target, edge, getEdgeBend(edge));
        const control = curve.control;
        const distance = curve.distance;

        ctx.save();
        ctx.globalAlpha = style.opacity;
        ctx.shadowColor = style.shadowColor;
        ctx.shadowBlur = style.shadowBlur;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const strokeColor = edge.color || '#22d3ee';
        const gradientStroke = edge.type === core.EDGE_TYPES.FLOW
            ? ctx.createLinearGradient(source.x, source.y, target.x, target.y)
            : null;
        if (gradientStroke) {
            gradientStroke.addColorStop(0, 'rgba(148, 163, 184, 0.34)');
            gradientStroke.addColorStop(0.42, strokeColor);
            gradientStroke.addColorStop(1, '#fef3c7');
        }
        ctx.strokeStyle = gradientStroke || strokeColor;
        ctx.lineWidth = style.width;
        ctx.setLineDash(edge.type === core.EDGE_TYPES.LABEL ? [4, 6] : edge.flow_role === 'swap_route' ? [9, 5] : []);
        if (style.glowTrack && edge.type === core.EDGE_TYPES.FLOW) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, style.opacity * 0.34);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(236, 254, 255, 0.72)';
            ctx.lineWidth = style.width + 6;
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
            ctx.stroke();
            ctx.restore();
        }
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
        ctx.stroke();
        if (style.selected && edge.type === core.EDGE_TYPES.FLOW) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, style.opacity * 0.92);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(254, 243, 199, 0.92)';
            ctx.lineWidth = Math.max(2.2, style.width * 0.42);
            ctx.beginPath();
            ctx.moveTo(source.x, source.y);
            ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
            ctx.stroke();
            ctx.restore();
        }
        ctx.setLineDash([]);

        if (edge.type === core.EDGE_TYPES.FLOW) {
            drawArrow(ctx, control, target, style.selected ? '#fef3c7' : strokeColor, style.arrowSize, style.selected || style.glowTrack);
            drawFlowPulse(ctx, edge, source, control, target, distance, interaction);
            if (options.drawFlowLabels !== false) {
                drawWalletLookupEdgeLabel(ctx, edge, source, target, control, interaction);
            }
        }
        ctx.restore();
    }

    function drawFlowEdgeLabel(ctx, edge, nodeById, interaction) {
        if (state.dataMode !== DATA_MODES.WALLET || edge.type !== core.EDGE_TYPES.FLOW) return;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return;
        const { control } = getCryptoEdgeCurve(source, target, edge, getEdgeBend(edge));
        drawWalletLookupEdgeLabel(ctx, edge, source, target, control, interaction);
    }

    function drawWalletLookupEdgeLabel(ctx, edge, source, target, control, interaction) {
        if (state.dataMode !== DATA_MODES.WALLET || edge.type !== core.EDGE_TYPES.FLOW) return;
        const labelStyle = getWalletLookupEdgeLabelStyle(edge, interaction);
        if (!labelStyle.visible) return;
        const fromTo = `${shortLongValue(source.address || edge.source_wallet || source.id)} \u2192 ${shortLongValue(target.address || edge.destination_wallet || target.id)}`;
        const amount = formatFlowAmountLabel(edge);
        const tokenAmount = labelStyle.showAmount ? amount : '';

        ctx.save();
        ctx.font = '700 10px Inter, sans-serif';
        const firstWidth = ctx.measureText(fromTo).width;
        ctx.font = '600 9px Inter, sans-serif';
        const secondWidth = tokenAmount ? ctx.measureText(tokenAmount).width : 0;
        const boxWidth = Math.min(Math.max(firstWidth, secondWidth) + 14, getMaxFlowLabelWidth());
        const boxHeight = tokenAmount ? 30 : 19;
        const labelPosition = placeFlowLabel(edge, source, target, control, {
            width: boxWidth,
            height: boxHeight,
            force: labelStyle.force,
            interaction
        });
        if (!labelPosition) {
            ctx.restore();
            return;
        }

        ctx.globalAlpha *= labelStyle.alpha;
        ctx.translate(labelPosition.x, labelPosition.y);
        roundedRectPath(ctx, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 8);
        ctx.fillStyle = labelStyle.force ? 'rgba(2, 6, 23, 0.9)' : 'rgba(2, 6, 23, 0.7)';
        ctx.fill();
        ctx.strokeStyle = labelStyle.force ? 'rgba(253, 224, 71, 0.56)' : 'rgba(103, 232, 249, 0.24)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ecfeff';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.fillText(fromTo, 0, tokenAmount ? -6 : 0, boxWidth - 10);
        if (tokenAmount) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.88)';
            ctx.font = '600 9px Inter, sans-serif';
            ctx.fillText(tokenAmount, 0, 8, boxWidth - 10);
        }
        ctx.restore();
    }

    function getWalletLookupEdgeLabelStyle(edge, interaction) {
        const force = interaction.hoveredFlowId === edge.id
            || interaction.selectedFlowId === edge.id
            || interaction.replayActiveFlowId === edge.id;
        const zoom = state.viewport.scale || 1;
        const density = state.labelDensity;
        const major = isMajorFlowLabel(edge, interaction);
        const visible = interaction.visibleFlowEdges || getVisibleFlowEdges();
        const semantic = interaction.semanticZoom || state.semanticZoom || getCryptoSemanticZoomState(visible);
        const topologyPriority = Boolean(interaction.topologyModel?.priorityFlowIds?.has(edge.id));

        if (force) {
            return { visible: true, alpha: 1, showAmount: true, force: true };
        }

        if ((semantic.tier === 'macro' || zoom < 0.58) && !major && !topologyPriority) {
            return { visible: false, alpha: 0, showAmount: false, force: false };
        }

        if (semantic.tier === 'macro') {
            return {
                visible: major || topologyPriority,
                alpha: semantic.flowLabelAlpha || 0.42,
                showAmount: false,
                force: false
            };
        }

        if (semantic.tier === 'cluster') {
            return {
                visible: major || topologyPriority || visible.length <= 5,
                alpha: semantic.flowLabelAlpha || 0.56,
                showAmount: semantic.showAmounts && (major || topologyPriority),
                force: false
            };
        }

        if (density === 'minimal') {
            const visibleTop = visible.length <= 5 && major;
            return {
                visible: visibleTop || (major && zoom >= 1.05),
                alpha: Math.min(0.86, (zoom < 0.82 ? 0.48 : 0.72) * (semantic.flowLabelAlpha || 1)),
                showAmount: semantic.showAmounts && major && zoom >= 0.84,
                force: false
            };
        }

        if (density === 'detailed') {
            const lowPriorityVisible = visible.length <= 14 && zoom >= 0.98;
            return {
                visible: major || lowPriorityVisible,
                alpha: major ? (zoom < 0.72 ? 0.5 : 0.86) : 0.44,
                showAmount: semantic.showAmounts && major,
                force: false
            };
        }

        const balancedVisible = major || (visible.length <= 7 && zoom >= 0.9);
        return {
            visible: balancedVisible,
            alpha: major ? (zoom < 0.72 ? 0.52 : 0.78) : 0.42,
            showAmount: semantic.showAmounts && major && zoom >= 0.72,
            force: false
        };
    }

    function shouldDrawWalletLookupEdgeLabel(edge, interaction) {
        return getWalletLookupEdgeLabelStyle(edge, interaction).visible;
    }

    function isMajorFlowLabel(edge, interaction) {
        return Boolean(edge.is_large_value
            || state.flowMotion.topFlowIds.has(edge.id)
            || interaction.connectedEdgeIds.has(edge.id)
            || interaction.replayActiveFlowId === edge.id);
    }

    function getFlowLabelPriority(edge, interaction) {
        if (interaction.selectedFlowId === edge.id || interaction.hoveredFlowId === edge.id) return 1000;
        if (interaction.replayActiveFlowId === edge.id) return 900;
        if (interaction.connectedEdgeIds.has(edge.id)) return 800;
        if (edge.is_large_value) return 700 + (Number(edge.usd_value) || 0);
        if (state.flowMotion.topFlowIds.has(edge.id)) return 500 + (Number(edge.usd_value) || 0);
        return Number(edge.usd_value) || 0;
    }

    function getMaxFlowLabelWidth() {
        const width = state.graph?.bounds?.width || getCanvasSize().width;
        const mobileMax = width < 520 ? 146 : 190;
        if (state.labelDensity === 'minimal') return Math.min(150, mobileMax);
        if (state.labelDensity === 'detailed') return Math.min(220, Math.max(160, mobileMax + 24));
        return Math.min(186, mobileMax);
    }

    function placeFlowLabel(edge, source, target, control, metrics) {
        const layout = metrics.interaction?.labelLayout;
        const distance = Math.max(1, Math.hypot(target.x - source.x, target.y - source.y));
        const normal = { x: -(target.y - source.y) / distance, y: (target.x - source.x) / distance };
        const lane = (hashString(edge.id || `${edge.source}:${edge.target}`) % 7) - 3;
        const baseT = 0.42 + (((hashString(`${edge.id}:label-t`) % 25) - 12) / 100);
        const offsets = [
            { t: baseT, n: lane * 5 },
            { t: clamp(baseT + 0.16, 0.18, 0.82), n: lane * 5 + 10 },
            { t: clamp(baseT - 0.16, 0.18, 0.82), n: lane * 5 - 10 },
            { t: clamp(baseT + 0.28, 0.16, 0.84), n: lane * 5 + 18 },
            { t: clamp(baseT - 0.28, 0.16, 0.84), n: lane * 5 - 18 }
        ];

        for (const candidate of offsets) {
            const point = pointOnQuadratic(source, control, target, candidate.t);
            const x = point.x + normal.x * candidate.n;
            const y = point.y + normal.y * candidate.n;
            const box = layout
                ? layout.clampBox({
                    x: x - metrics.width / 2,
                    y: y - metrics.height / 2,
                    width: metrics.width,
                    height: metrics.height
                })
                : {
                    x: x - metrics.width / 2,
                    y: y - metrics.height / 2,
                    width: metrics.width,
                    height: metrics.height
                };
            if (!layout || layout.register(box)) {
                return {
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2
                };
            }
        }

        if (metrics.force && layout) {
            const point = pointOnQuadratic(source, control, target, clamp(baseT, 0.18, 0.82));
            const box = layout.clampBox({
                x: point.x - metrics.width / 2,
                y: point.y - metrics.height / 2,
                width: metrics.width,
                height: metrics.height
            });
            layout.register(box, { force: true });
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }

        return null;
    }

    function createLabelLayout(width, height) {
        const boxes = [];
        const padding = state.viewport.scale < 0.75 ? 10 : 6;
        const margin = Math.max(8, width < 520 ? 12 : 8);
        const maxLabels = getMaxVisibleGraphLabels();
        return {
            boxes,
            clampBox(box) {
                return {
                    ...box,
                    x: clamp(box.x, margin, Math.max(margin, width - box.width - margin)),
                    y: clamp(box.y, margin, Math.max(margin, height - box.height - margin))
                };
            },
            register(box, options = {}) {
                const paddedBox = {
                    x: box.x - padding,
                    y: box.y - padding,
                    width: box.width + padding * 2,
                    height: box.height + padding * 2
                };
                if (!options.force && boxes.length >= maxLabels) return false;
                if (!options.force && boxes.some(existing => boxesOverlap(existing, paddedBox))) return false;
                boxes.push(paddedBox);
                return true;
            }
        };
    }

    function getMaxVisibleGraphLabels() {
        const mobile = isMobileViewport();
        const density = state.labelDensity;
        const semanticMax = Number(state.semanticZoom?.maxNodeLabels || 0);
        let base = 0;
        if (state.dataMode === DATA_MODES.WALLET) {
            if (density === 'minimal') base = mobile ? 6 : 9;
            else if (density === 'detailed') base = mobile ? 12 : 20;
            else base = mobile ? 8 : 13;
            return semanticMax ? Math.min(base, semanticMax) : base;
        }
        if (density === 'minimal') base = mobile ? 8 : 12;
        else if (density === 'detailed') base = mobile ? 18 : 30;
        else base = mobile ? 12 : 22;
        return semanticMax ? Math.min(base, semanticMax) : base;
    }

    function boxesOverlap(a, b) {
        return a.x < b.x + b.width
            && a.x + a.width > b.x
            && a.y < b.y + b.height
            && a.y + a.height > b.y;
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

    function getEdgeBend(edge = {}) {
        if (edge.type === core.EDGE_TYPES.EXPOSURE) return -18;
        if (edge.type !== core.EDGE_TYPES.FLOW) return 0;
        const lane = (hashString(edge.id || `${edge.source}:${edge.target}`) % 5) - 2;
        const tokenLane = (hashString(`${edge.symbol || edge.token_mint || getEdgeDirection(edge)}:corridor`) % 5) - 2;
        const replayBoost = edge.id === state.flowReplay.activeFlowId || edge.id === state.selectedFlowId ? 8 : 0;
        const liquidityBoost = /swap|route|bridge|pool/i.test(edge.flow_role || edge.transaction_type_label || '') ? 5 : 0;
        return 25 + lane * 6 + tokenLane * 3 + replayBoost + liquidityBoost;
    }

    function drawArrow(ctx, from, to, color, size = 8, emphasized = false) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const tip = {
            x: to.x - Math.cos(angle) * 18,
            y: to.y - Math.sin(angle) * 18
        };
        if (emphasized) {
            ctx.save();
            ctx.fillStyle = 'rgba(236, 254, 255, 0.88)';
            ctx.shadowColor = color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.moveTo(tip.x + Math.cos(angle) * 2, tip.y + Math.sin(angle) * 2);
            ctx.lineTo(to.x - Math.cos(angle - 0.48) * (22 + size), to.y - Math.sin(angle - 0.48) * (22 + size));
            ctx.lineTo(to.x - Math.cos(angle + 0.48) * (22 + size), to.y - Math.sin(angle + 0.48) * (22 + size));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
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
        const selectedFlowEndpoint = Boolean(interaction.selectedFlowId && connected && !selected);
        const trackedWallet = isTrackedWalletNode(node);
        const radius = node.radius + (trackedWallet ? 7 : 0) + (selected ? 5 : hovered ? 3 : 0);
        const showLabel = shouldShowNodeLabel(node, { selected, hovered, connected, selectedFlowEndpoint, trackedWallet, interaction });
        const labelAlpha = showLabel ? (muted ? 0.3 : 0.92) : 0;

        ctx.save();
        if ((selected || hovered || trackedWallet || selectedFlowEndpoint || (interaction.hasTokenIsolation && connected)) && !muted) {
            ctx.save();
            ctx.globalAlpha = selected ? 0.3 : trackedWallet ? 0.22 : hovered ? 0.18 : selectedFlowEndpoint ? 0.16 : 0.1;
            ctx.fillStyle = selected ? 'rgba(255, 255, 255, 0.92)' : node.color;
            ctx.shadowColor = selected ? '#67e8f9' : node.color;
            ctx.shadowBlur = selected ? 30 : trackedWallet ? 26 : 16;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + (selected ? 13 : trackedWallet ? 11 : 8), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.shadowColor = node.color;
        ctx.shadowBlur = trackedWallet ? 30 : selected ? 28 : hovered ? 17 : selectedFlowEndpoint ? 15 : connected ? 8 : 3;
        ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.strokeStyle = trackedWallet ? '#ecfeff' : selected ? '#fef3c7' : hovered ? '#ffffff' : selectedFlowEndpoint ? '#67e8f9' : node.color;
        ctx.lineWidth = trackedWallet ? 4.4 : selected ? 4 : hovered ? 2.6 : selectedFlowEndpoint ? 2.7 : connected ? 1.8 : 1.1;
        if (isHubNode(node)) {
            ctx.globalAlpha = muted ? 0.34 : 0.88;
            ctx.strokeStyle = node.color;
            ctx.lineWidth = selected ? 2.8 : hovered ? 2.2 : 1.4;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = muted ? (interaction.hasSelected ? 0.28 : 0.42) : 1;
            ctx.strokeStyle = selected ? '#fef3c7' : hovered ? '#ffffff' : selectedFlowEndpoint ? '#67e8f9' : node.color;
            ctx.lineWidth = selected ? 4 : hovered ? 2.6 : selectedFlowEndpoint ? 2.7 : connected ? 1.8 : 1.1;
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (selected && !muted) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 0.92;
            ctx.strokeStyle = '#67e8f9';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        } else if (hovered && !selected && !muted) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 0.62;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

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
        const labelText = labelForNode(node);
        const labelWidth = Math.min(ctx.measureText(labelText).width, getMaxNodeLabelWidth(node));
        const labelHeight = 15;
        const forceLabel = trackedWallet || selected || hovered || selectedFlowEndpoint;
        const labelBox = placeNodeLabel(node, radius, labelWidth, labelHeight, interaction, forceLabel);
        if (!labelBox) {
            ctx.restore();
            return;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(labelText, labelBox.x + labelBox.width / 2, labelBox.y + 1, labelWidth);
        ctx.restore();
    }

    function placeNodeLabel(node, radius, labelWidth, labelHeight, interaction, forceLabel = false) {
        const layout = interaction.labelLayout;
        const gap = Math.max(7, state.viewport.scale < 0.75 ? 10 : 7);
        const candidates = [
            { x: node.x - labelWidth / 2, y: node.y + radius + gap },
            { x: node.x - labelWidth / 2, y: node.y - radius - labelHeight - gap },
            { x: node.x + radius + gap, y: node.y - labelHeight / 2 },
            { x: node.x - radius - labelWidth - gap, y: node.y - labelHeight / 2 }
        ];
        let fallback = null;

        for (const candidate of candidates) {
            const box = layout
                ? layout.clampBox({ ...candidate, width: labelWidth, height: labelHeight })
                : { ...candidate, width: labelWidth, height: labelHeight };
            fallback ||= box;
            if (!layout || layout.register(box)) return box;
        }

        if (!forceLabel || !layout || !fallback) return null;
        layout.register(fallback, { force: true });
        return fallback;
    }

    function handleCanvasWheel(event) {
        if (!state.graph || !state.canvas) return;
        event.preventDefault();
        state.lastPointerType = 'wheel';
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
        scheduleRender();
    }

    function handleCanvasPointerDown(event) {
        if (!state.graph || !state.canvas) return;
        state.lastPointerType = event.pointerType || 'mouse';
        markFlowInteraction();
        hideHoverOverlay();
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
        const node = getNodeAtWorldPoint(worldPoint, { pointerType: event.pointerType });
        const edge = node ? null : getFlowEdgeAtWorldPoint(worldPoint, { pointerType: event.pointerType });

        state.canvas.setPointerCapture?.(event.pointerId);
        const touchTapOnlyNode = event.pointerType === 'touch' && node;
        state.drag = {
            pointerId: event.pointerId,
            mode: touchTapOnlyNode ? 'pan' : node ? 'node' : edge ? 'edge' : 'pan',
            nodeId: node?.id || null,
            edgeId: edge?.id || null,
            startScreen: screenPoint,
            lastScreen: screenPoint,
            startNode: node ? { x: node.x, y: node.y } : null,
            startViewport: { ...state.viewport },
            moved: false
        };
        setGraphInteractionMode(state.drag.mode === 'node' ? 'dragging-node' : 'panning');
        event.preventDefault();
    }

    function handleCanvasPointerMove(event) {
        if (!state.graph || !state.canvas) return;
        state.lastPointerType = event.pointerType || state.lastPointerType || 'mouse';
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
                scheduleRender();
            }
            state.drag.lastScreen = screenPoint;
            event.preventDefault();
            return;
        }

        updateHoverFromScreenPoint(screenPoint, { pointerType: event.pointerType });
    }

    function handleCanvasPointerUp(event) {
        if (!state.graph || !state.canvas) return;
        state.lastPointerType = event.pointerType || state.lastPointerType || 'mouse';
        if (event.pointerType === 'touch' && endTouchPointer(event)) {
            event.preventDefault();
            return;
        }
        markFlowInteraction();
        const drag = state.drag;
        if (drag?.pointerId === event.pointerId) {
            state.canvas.releasePointerCapture?.(event.pointerId);
            state.drag = null;
            setGraphInteractionMode(null);

            if (!drag.moved && drag.nodeId) {
                const openDetails = registerQuickInspect('node', drag.nodeId, getScreenPoint(event), event.pointerType);
                state.selectedId = drag.nodeId;
                state.selectedFlowId = null;
                state.historyPreview.selectedEvent = null;
                if (openDetails) state.investigationTab = 'details';
                openMobileDrawerForSelection(openDetails ? 'expanded' : 'half');
                render();
                renderDetails();
                updateInteractionDock();
            }
            if (!drag.moved && drag.edgeId) {
                selectFlow(drag.edgeId, {
                    openDetails: registerQuickInspect('flow', drag.edgeId, getScreenPoint(event), event.pointerType)
                });
            }

            updateHoverFromScreenPoint(getScreenPoint(event), { pointerType: event.pointerType, force: true });
            event.preventDefault();
            return;
        }

        setGraphInteractionMode(null);
        updateHoverFromScreenPoint(getScreenPoint(event), { pointerType: event.pointerType, force: true });
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
        setGraphInteractionMode(null);
        hideHoverOverlay();
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
        setGraphInteractionMode('pinching');
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
        scheduleRender();
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
        setGraphInteractionMode(null);
        hideHoverOverlay();
        scheduleRender();
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
        setGraphInteractionMode(null);
        hideHoverOverlay();
        if (!state.hoveredId && !state.hoveredFlowId) return;
        state.hoveredId = null;
        state.hoveredFlowId = null;
        scheduleRender();
    }

    async function handleReplayWorkspaceCanvasClick(event) {
        if (!state.historyPreview.workspaceMode || !state.historyPreview.dataset) return;
        const hit = await getReplayWorkspaceHit(event);
        if (!hit) return;
        if (hit.type === 'edge' && hit.step) {
            await selectHistoryReplayEventByStep(hit.step, {
                pause: true,
                addBreadcrumb: true,
                message: 'Replay edge selected for transfer audit drilldown. Active Wallet Lookup graph unchanged.'
            });
            return;
        }
        if (hit.type === 'node') {
            const wallet = hit.wallet || '';
            if (wallet) {
                await followReplayAuditWallet(wallet, 'node-click');
                state.historyPreview.lastMessage = 'Replay node filtered related staged replay events only.';
            } else if (hit.token) {
                updateReplayAuditFilter('token', String(hit.token).toUpperCase());
                state.historyPreview.lastMessage = 'Replay token node filtered related staged replay events only.';
            } else if (hit.step) {
                await selectHistoryReplayEventByStep(hit.step, {
                    pause: true,
                    addBreadcrumb: false,
                    message: 'Replay node selected related staged replay context only.'
                });
            }
        }
    }

    async function handleReplayWorkspaceCanvasPointerMove(event) {
        if (!state.historyPreview.workspaceMode || !state.historyPreview.dataset) return;
        const canvas = event.currentTarget;
        const hit = await getReplayWorkspaceHit(event, { initialize: false });
        if (canvas) canvas.style.cursor = hit ? 'pointer' : 'grab';
    }

    function handleReplayWorkspaceCanvasLeave(event) {
        if (event.currentTarget) event.currentTarget.style.cursor = 'grab';
    }

    async function getReplayWorkspaceHit(event, options = {}) {
        const canvas = event.currentTarget || document.getElementById('crypto-history-workspace-canvas');
        if (!canvas) return null;
        let animator = state.historyPreview.replayAnimator;
        if (!animator && options.initialize !== false) {
            animator = await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot());
        }
        if (!animator?.hitTest) return null;
        const rect = canvas.getBoundingClientRect();
        return animator.hitTest({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        });
    }

    function renderDetails(options = {}) {
        if (!state.detailPanel || !state.graph) return;
        state.detailPanel.innerHTML = renderInvestigationWorkspace();
        bindInvestigationWorkspaceControls(state.detailPanel);
        updateReplayWorkspaceShell();
        renderHistoryGraphPreviewCanvas(getHistoryPreviewRenderRoot(), options);
        renderMobileInvestigationDrawer();
    }

    function getHistoryPreviewRenderRoot() {
        if (state.historyPreview.workspaceMode) {
            return document.getElementById('crypto-replay-workspace-stage') || state.root || state.detailPanel;
        }
        return state.detailPanel;
    }

    function getHistoryPreviewCanvas(root = getHistoryPreviewRenderRoot()) {
        if (state.historyPreview.workspaceMode) {
            return document.getElementById('crypto-history-workspace-canvas');
        }
        return root?.querySelector?.('#crypto-history-preview-canvas') || null;
    }

    function setReplayWorkspaceMode(active, options = {}) {
        const nextActive = Boolean(active);
        if (state.historyPreview.workspaceMode === nextActive && !options.force) return state.historyPreview.workspaceMode;
        const replayWasPlaying = Boolean(state.historyPreview.replayAnimator?.getStatus?.().playing || state.historyPreview.replayStatus?.playing);
        detachHistoryReplayAnimator({ preserveStatus: true });
        state.historyPreview.workspaceMode = nextActive;
        if (nextActive) {
            state.investigationTab = 'replay';
            state.mobileDrawerState = 'collapsed';
            if (state.historyPreview.dataset) state.historyPreview.graphVisible = true;
            state.historyPreview.lastMessage = state.historyPreview.dataset
                ? 'Replay Workspace Mode is active. Preview graph renders large and remains staged, preview-only, and not merged.'
                : 'Replay Workspace Mode is active. Build Preview Dataset before rendering the large replay graph.';
        } else {
            state.historyPreview.lastMessage = 'Replay Workspace Mode closed. Active Wallet Lookup graph state is preserved.';
        }
        updateReplayWorkspaceShell();
        updateInteractionDock();
        renderDetails({ resumeReplay: replayWasPlaying });
        if (!nextActive) {
            resizeAndRender();
        } else {
            renderHistoryGraphPreviewCanvas(getHistoryPreviewRenderRoot(), { resumeReplay: replayWasPlaying });
        }
        return state.historyPreview.workspaceMode;
    }

    function toggleReplayWorkspaceMode() {
        return setReplayWorkspaceMode(!state.historyPreview.workspaceMode);
    }

    async function openReplayNeighborhood() {
        state.investigationTab = 'replay';
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        state.historyPreview.graphVisible = true;
        const status = getHistoryReplayStatus();
        const selected = getSelectedHistoryReplayEvent(status);
        if (!selected) {
            await seekHistoryReplayStep(Math.max(1, Number(status.currentStep) || 1), {
                label: 'Replay neighborhood opened around the current staged transfer.',
                quiet: true
            });
        }
        await runReplayAuditAction('expand-transfer');
        state.historyPreview.lastMessage = 'Replay neighborhood opened with staged transfer context only. Wallet Lookup graph remains unchanged.';
        updateReplayWorkspaceShell();
        return state.historyPreview.audit?.neighborhood || null;
    }

    async function centerCurrentReplayTransfer() {
        state.investigationTab = 'replay';
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        const status = getHistoryReplayStatus();
        const selected = getSelectedHistoryReplayEvent(status);
        const step = Number(selected?.step || status.currentStep) || 1;
        await seekHistoryReplayStep(step, {
            label: 'Replay camera centered on the current staged transfer.',
            quiet: false
        });
        await runReplayAuditAction('center-transfer');
        return getSelectedHistoryReplayEvent(getHistoryReplayStatus());
    }

    async function stepReplayWorkspaceEvent(direction = 1) {
        if (!state.historyPreview.workspaceMode) return false;
        const status = await stepHistoryReplay(direction);
        const currentStep = Number(status?.currentStep || state.historyPreview.audit?.selectedStep) || 0;
        state.historyPreview.lastMessage = direction < 0
            ? 'Replay stepped to the previous staged event. Active Wallet Lookup graph unchanged.'
            : 'Replay stepped to the next staged event. Active Wallet Lookup graph unchanged.';
        if (currentStep) {
            await selectHistoryReplayEventByStep(currentStep, {
                pause: true,
                addBreadcrumb: true,
                message: state.historyPreview.lastMessage
            });
        } else {
            updateReplayWorkspaceShell();
        }
        renderCryptoSpatialBreadcrumbs();
        return getSelectedHistoryReplayEvent(getHistoryReplayStatus()) || true;
    }

    function nextReplayEvent() {
        return stepReplayWorkspaceEvent(1);
    }

    function previousReplayEvent() {
        return stepReplayWorkspaceEvent(-1);
    }

    function setReplayNarrativesVisible(visible = true) {
        state.historyPreview.narrativesVisible = visible !== false;
        state.historyPreview.lastMessage = state.historyPreview.narrativesVisible
            ? 'Replay narratives are visible. Wording is derived from staged replay metadata only.'
            : 'Replay narratives are hidden; replay reasoning chips remain available.';
        updateReplayWorkspaceShell();
        return state.historyPreview.narrativesVisible;
    }

    function toggleReplayNarratives() {
        return setReplayNarrativesVisible(state.historyPreview.narrativesVisible === false);
    }

    async function openReplayLineage() {
        state.investigationTab = 'replay';
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        state.historyPreview.graphVisible = true;
        state.historyPreview.narrativesVisible = true;
        state.historyPreview.lastMessage = 'Replay lineage opened from session-only replay stack and staged flow context.';
        updateReplayWorkspaceShell();
        return state.historyPreview.audit?.investigationStack || [];
    }

    async function jumpBackReplayLineage() {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        const status = getHistoryReplayStatus();
        const currentStep = Number(state.historyPreview.audit?.selectedStep || status.selectedStep || status.currentStep) || 0;
        const stack = [
            ...(state.historyPreview.audit?.investigationStack || []),
            ...(state.historyPreview.audit?.recentSteps || []).map(step => ({ step, label: `Step ${step}` })),
            ...(state.historyPreview.audit?.breadcrumbs || []).slice().reverse()
        ];
        const seen = new Set();
        const target = stack.find(item => {
            const step = Number(item.step) || 0;
            if (!step || step === currentStep || seen.has(step)) return false;
            seen.add(step);
            return true;
        });
        if (!target?.step) {
            state.historyPreview.lastMessage = 'No prior replay lineage focus is available in this session.';
            updateReplayWorkspaceShell();
            return null;
        }
        return selectHistoryReplayEventByStep(target.step, {
            pause: true,
            addBreadcrumb: false,
            message: 'Replay jumped back to the prior session-only lineage focus.'
        });
    }

    async function cycleReplayFocus(direction = 1) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const events = (context?.filteredEvents?.length ? context.filteredEvents : context?.events || [])
            .filter(event => Number(event.step) > 0);
        if (!events.length) {
            state.historyPreview.lastMessage = 'No staged replay events are available for focus cycling.';
            updateReplayWorkspaceShell();
            return null;
        }
        const currentStep = Number(context?.selectedEvent?.step || context?.currentStep) || 0;
        const currentIndex = Math.max(0, events.findIndex(event => Number(event.step) === currentStep));
        const delta = Number(direction) < 0 ? -1 : 1;
        const nextIndex = (currentIndex + delta + events.length) % events.length;
        state.historyPreview.focusCycleIndex = nextIndex;
        return selectHistoryReplayEventByStep(events[nextIndex].step, {
            pause: true,
            addBreadcrumb: true,
            message: 'Replay focus cycled through staged replay events only.'
        });
    }

    async function stepReplayCorridor(direction = 1) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const profile = context?.replayIntelligence?.corridorProfile || {};
        const targetStep = Number(direction) < 0
            ? Number(profile.previousCorridorStep) || 0
            : Number(profile.nextCorridorStep) || 0;
        const targetRoute = Number(direction) < 0
            ? profile.previousCorridorRoute || ''
            : profile.nextCorridorRoute || '';
        if (!targetStep) {
            state.historyPreview.lastMessage = Number(direction) < 0
                ? 'No previous replay corridor transition is visible in the staged replay window.'
                : 'No next replay corridor transition is visible in the staged replay window.';
            updateReplayWorkspaceShell();
            return null;
        }
        if (targetRoute) {
            setReplayNeighborhoodFocus({
                mode: 'route',
                route: targetRoute
            }, 'Replay corridor traversal narrowed to the selected staged route transition.', { persist: false });
        }
        return selectHistoryReplayEventByStep(targetStep, {
            pause: true,
            addBreadcrumb: true,
            message: Number(direction) < 0
                ? 'Replay moved to the previous visible corridor transition in staged data only.'
                : 'Replay moved to the next visible corridor transition in staged data only.'
        });
    }

    async function focusReplayCluster(options = {}) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const clusters = context?.clusters || {};
        const cluster = [
            ...(clusters.routes || []),
            ...(clusters.tokens || []),
            ...(clusters.counterparties || []),
            ...(clusters.hotspots || [])
        ].sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.label || '').localeCompare(String(b.label || '')))[0] || null;
        if (!cluster) {
            state.historyPreview.lastMessage = 'No replay cluster is visible above the bounded staged-row threshold.';
            updateReplayWorkspaceShell();
            return null;
        }
        setReplayNeighborhoodFocus({
            mode: 'cluster',
            clusterKey: cluster.key || '',
            clusterKind: cluster.kind || '',
            route: cluster.route || '',
            token: cluster.token || 'all',
            wallet: cluster.wallet || ''
        }, 'Replay cluster focus uses repeated staged replay patterns only.', { persist: false });
        const target = cluster.events?.[0] || (context.events || []).find(event => {
            if (cluster.route) return getReplayEventRouteKey(event) === cluster.route;
            if (cluster.token) return String(event.token || event.symbol || '').toUpperCase() === cluster.token;
            if (cluster.wallet) return [
                event.sourceWallet || event.source_wallet,
                event.destinationWallet || event.destination_wallet
            ].includes(cluster.wallet);
            return false;
        });
        if (target?.step) {
            return selectHistoryReplayEventByStep(target.step, {
                pause: true,
                addBreadcrumb: true,
                persistCheckpoint: options.persist !== false,
                message: 'Replay cluster focus uses repeated staged replay patterns only.'
            });
        }
        return cluster;
    }

    async function isolateReplayFlowCorridor(options = {}) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const corridor = context?.replayIntelligence?.flowSummary?.topCorridor || null;
        if (!corridor?.key) {
            state.historyPreview.lastMessage = 'No repeated replay corridor is visible in the staged replay window.';
            updateReplayWorkspaceShell();
            return null;
        }
        setReplayNeighborhoodFocus({
            mode: 'route',
            route: corridor.key
        }, 'Dominant visible replay corridor isolated from staged replay rows only.', { persist: false });
        const event = (context.events || []).find(item => getReplayEventRouteKey(item) === corridor.key);
        if (event?.step) {
            return selectHistoryReplayEventByStep(event.step, {
                pause: true,
                addBreadcrumb: true,
                persistCheckpoint: options.persist !== false,
                message: 'Dominant visible replay corridor isolated from staged replay rows only.'
            });
        }
        return corridor;
    }

    async function focusReplayLiquidityConcentration(options = {}) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const tokenZone = context?.replayIntelligence?.flowSummary?.topToken || null;
        if (!tokenZone?.token) {
            state.historyPreview.lastMessage = 'No token concentration zone is visible in the staged replay window.';
            updateReplayWorkspaceShell();
            return null;
        }
        const filters = normalizeReplayAuditFilters(state.historyPreview.audit?.filters);
        filters.token = tokenZone.token;
        state.historyPreview.audit.filters = filters;
        state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
        setReplayNeighborhoodFocus({
            mode: 'token',
            token: tokenZone.token
        }, 'Replay concentration focus uses token visibility from staged replay rows only.', { persist: false });
        const event = (context.events || []).find(item => String(item.token || item.symbol || '').toUpperCase() === tokenZone.token);
        if (event?.step) {
            return selectHistoryReplayEventByStep(event.step, {
                pause: true,
                addBreadcrumb: true,
                persistCheckpoint: options.persist !== false,
                message: 'Replay concentration focus uses token visibility from staged replay rows only.'
            });
        }
        return tokenZone;
    }

    function focusReplayConcentrationZone(options = {}) {
        return focusReplayLiquidityConcentration(options);
    }

    async function focusReplayBridgeWallet(options = {}) {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const bridge = context?.replayIntelligence?.flowSummary?.topBridgeWallet || null;
        const wallet = bridge?.wallet || '';
        if (!wallet) {
            state.historyPreview.lastMessage = 'No replay bridge wallet is visible across staged replay corridors.';
            updateReplayWorkspaceShell();
            return null;
        }
        const filters = normalizeReplayAuditFilters(state.historyPreview.audit?.filters);
        filters.counterparty = wallet;
        state.historyPreview.audit.filters = filters;
        state.historyPreview.audit.selectedWallet = wallet;
        state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
        setReplayNeighborhoodFocus({
            mode: 'wallet',
            wallet
        }, 'Replay bridge-wallet focus uses address-level staged corridor overlap only.', { persist: false });
        const target = (context.events || []).find(item =>
            (item.sourceWallet || item.source_wallet) === wallet ||
            (item.destinationWallet || item.destination_wallet) === wallet);
        if (target?.step) {
            return selectHistoryReplayEventByStep(target.step, {
                pause: true,
                addBreadcrumb: true,
                persistCheckpoint: options.persist !== false,
                message: 'Replay bridge-wallet focus uses address-level staged corridor overlap only.'
            });
        }
        return bridge;
    }

    async function focusReplayWalletCorridor() {
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        if (!state.historyPreview.dataset) {
            await buildHistoryPreviewDataset({ skipRenderStatus: true });
        }
        const context = buildCurrentReplayWorkspaceContext();
        const selected = context?.selectedEvent || context?.currentEvent || null;
        const bridgeWallet = context?.replayIntelligence?.flowSummary?.topBridgeWallet?.wallet || '';
        const wallet = selected?.destinationWallet || selected?.sourceWallet || bridgeWallet || '';
        if (!wallet) {
            state.historyPreview.lastMessage = 'No replay wallet corridor is available in the staged replay window.';
            updateReplayWorkspaceShell();
            return null;
        }
        const filters = normalizeReplayAuditFilters(state.historyPreview.audit?.filters);
        filters.counterparty = wallet;
        state.historyPreview.audit.filters = filters;
        state.historyPreview.audit.selectedWallet = wallet;
        state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
        return setReplayNeighborhoodFocus({
            mode: 'wallet',
            wallet
        }, 'Wallet corridor focus is derived from visible staged replay rows only.', { persist: false });
    }

    function toggleReplayCorridorOverlay(force) {
        state.historyPreview.corridorOverlayVisible = typeof force === 'boolean'
            ? force
            : state.historyPreview.corridorOverlayVisible === false;
        state.historyPreview.lastMessage = state.historyPreview.corridorOverlayVisible
            ? 'Replay corridor overlay is visible. Corridor wording is derived from staged replay rows only.'
            : 'Replay corridor overlay is hidden for this session. Replay data and filters are unchanged.';
        updateReplayWorkspaceShell();
        return state.historyPreview.corridorOverlayVisible;
    }

    function toggleReplayContinuityView(force) {
        state.historyPreview.continuityViewVisible = typeof force === 'boolean'
            ? force
            : state.historyPreview.continuityViewVisible === false;
        state.historyPreview.lastMessage = state.historyPreview.continuityViewVisible
            ? 'Replay continuity view is visible. Confidence remains staged-window only.'
            : 'Replay continuity view is hidden for this session. Continuity state is still used by reasoning chips.';
        updateReplayWorkspaceShell();
        return state.historyPreview.continuityViewVisible;
    }

    async function applyCryptoAnalystPreset(key = '') {
        const presetKey = String(key || '').trim();
        if (presetKey === 'replay_investigation') {
            window.setCryptoUxMode?.('replay');
            state.focusSelection = true;
            state.historyPreview.narrativesVisible = true;
            setLabelDensity('balanced', { systemDefault: true });
            if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
            if (!state.historyPreview.dataset) await buildHistoryPreviewDataset({ skipRenderStatus: true });
            await setHistoryReplaySpeed('inspect');
            await openReplayLineage();
        } else if (presetKey === 'liquidity_flow') {
            window.setCryptoUxMode?.('analyst');
            state.focusSelection = true;
            state.historyPreview.narrativesVisible = true;
            setTokenIsolation('all');
            setLabelDensity('balanced', { systemDefault: true });
            if (state.historyPreview.dataset) await isolateReplayFlowCorridor({ persist: false });
        } else if (presetKey === 'concentration_focus') {
            window.setCryptoUxMode?.('replay');
            state.focusSelection = true;
            state.historyPreview.narrativesVisible = true;
            setLabelDensity('minimal', { systemDefault: true });
            await focusReplayLiquidityConcentration({ persist: false });
        } else if (presetKey === 'wallet_corridor_focus') {
            window.setCryptoUxMode?.('replay');
            state.focusSelection = true;
            state.historyPreview.narrativesVisible = true;
            setLabelDensity('balanced', { systemDefault: true });
            await focusReplayWalletCorridor();
        } else {
            return null;
        }
        state.historyPreview.lastMessage = getCryptoPresetMessage(presetKey);
        updateInteractionDock();
        updateReplayWorkspaceShell();
        render();
        renderDetails();
        return { key: presetKey, sessionOnly: true, previewOnly: true };
    }

    function getCryptoPresetMessage(key = '') {
        if (key === 'replay_investigation') return 'Crypto preset applied: Replay Investigation. Session-only replay stack and narratives are active.';
        if (key === 'liquidity_flow') return 'Crypto preset applied: Liquidity Flow. Visible corridor focus uses staged graph state only.';
        if (key === 'concentration_focus') return 'Crypto preset applied: Concentration Focus. Token visibility is staged replay metadata only.';
        if (key === 'wallet_corridor_focus') return 'Crypto preset applied: Wallet Corridor Focus. Address context is observational only.';
        return 'Crypto preset applied for this session only.';
    }

    function buildCurrentReplayWorkspaceContext() {
        const status = getHistoryReplayStatus();
        const summary = buildHistoryGraphPreviewSummary();
        const totalSteps = getHistoryReplayTotalSteps(status);
        const audit = state.historyPreview.audit || {};
        const helper = namespace.replayWorkspace?.buildReplayContext;
        if (!helper) return null;
        return helper({
            status,
            dataset: state.historyPreview.dataset,
            summary,
            events: getHistoryReplayEvents(status),
            bookmarks: buildHistoryReplayJumpChips(summary, status, totalSteps),
            warnings: getWalletHistoryWarnings(),
            windowStatus: getHistoryReplayWindowStatus(summary, status),
            totalSteps,
            selectedEvent: getSelectedHistoryReplayEvent(status),
            auditFilters: normalizeReplayAuditFilters(audit.filters),
            neighborhoodFocus: normalizeReplayNeighborhoodFocus(audit.neighborhood),
            breadcrumbs: audit.breadcrumbs || [],
            recentEvents: audit.recentSteps || [],
            investigationStack: audit.investigationStack || [],
            flowLineage: audit.flowLineage || [],
            narrativesVisible: state.historyPreview.narrativesVisible !== false,
            corridorOverlayVisible: state.historyPreview.corridorOverlayVisible !== false,
            continuityViewVisible: state.historyPreview.continuityViewVisible !== false
        });
    }

    function getCryptoCommandAvailability(key = '') {
        if (!state.initialized) return { disabled: true, reason: 'CryptoPhotonic is not initialized yet.' };
        const status = getHistoryReplayStatus();
        const hasDataset = Boolean(state.historyPreview.dataset);
        const totalSteps = getHistoryReplayTotalSteps(status);
        const workspaceOpen = Boolean(state.historyPreview.workspaceMode);
        const audit = state.historyPreview.audit || {};
        if (key === 'replay-workspace' || key === 'preset-liquidity-flow') return { disabled: false, reason: '' };
        if (key === 'replay-narrative') {
            return workspaceOpen ? { disabled: false, reason: '' } : { disabled: true, reason: 'Open Crypto replay workspace first.' };
        }
        if (key === 'replay-dataset') {
            return hasDataset ? { disabled: false, reason: '' } : { disabled: true, reason: 'Build a Crypto preview replay dataset first.' };
        }
        if (key === 'replay-event' || key === 'replay-focus') {
            return workspaceOpen && hasDataset && totalSteps
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'Open Crypto replay workspace with staged replay steps first.' };
        }
        if (key === 'replay-corridor-overlay' || key === 'replay-continuity-view') {
            return workspaceOpen
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'Open Crypto replay workspace first.' };
        }
        if (key === 'replay-lineage') {
            const hasLineage = (audit.investigationStack || []).length || (audit.recentSteps || []).length || (audit.breadcrumbs || []).length;
            return workspaceOpen && hasLineage
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'Select replay events to build session lineage first.' };
        }
        if (key === 'replay-corridor') {
            const context = hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            return context?.replayIntelligence?.flowSummary?.topCorridor
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'No repeated replay corridor is visible yet.' };
        }
        if (key === 'replay-next-corridor' || key === 'replay-previous-corridor') {
            const context = workspaceOpen && hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            const profile = context?.replayIntelligence?.corridorProfile || {};
            const step = key === 'replay-next-corridor'
                ? Number(profile.nextCorridorStep) || 0
                : Number(profile.previousCorridorStep) || 0;
            return step
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'No replay corridor transition is visible in that direction.' };
        }
        if (key === 'replay-cluster') {
            const context = hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            return context?.clusters?.total
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'No replay cluster is visible above the bounded threshold.' };
        }
        if (key === 'replay-token-concentration') {
            const context = hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            return context?.replayIntelligence?.flowSummary?.topToken
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'No token concentration zone is visible yet.' };
        }
        if (key === 'replay-bridge-wallet') {
            const context = hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            return context?.replayIntelligence?.flowSummary?.topBridgeWallet
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'No bridge wallet spans visible replay corridors yet.' };
        }
        if (key === 'replay-wallet-corridor') {
            const context = hasDataset ? buildCurrentReplayWorkspaceContext() : null;
            const selected = context?.selectedEvent || context?.currentEvent || null;
            return selected?.sourceWallet || selected?.destinationWallet || context?.replayIntelligence?.flowSummary?.topBridgeWallet
                ? { disabled: false, reason: '' }
                : { disabled: true, reason: 'Select a replay event or bridge wallet first.' };
        }
        return { disabled: false, reason: '' };
    }

    function updateReplayWorkspaceShell() {
        const active = Boolean(state.historyPreview.workspaceMode);
        state.root?.classList.toggle('is-replay-workspace', active);
        const overlay = document.getElementById('crypto-replay-workspace-overlay');
        if (!overlay) return;
        overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (!active) {
            overlay.innerHTML = '';
            return;
        }
        if (!state.historyPreview.dataset || !state.historyPreview.graphVisible) clearHistoryWorkspaceCanvas();
        overlay.innerHTML = renderReplayWorkspaceOverlay();
        bindReplayWorkspaceOverlayControls(overlay);
    }

    function clearHistoryWorkspaceCanvas() {
        const canvas = document.getElementById('crypto-history-workspace-canvas');
        const ctx = canvas?.getContext?.('2d');
        if (!canvas || !ctx) return;
        const rect = canvas.getBoundingClientRect?.();
        const width = Math.max(1, Math.floor(rect?.width || canvas.clientWidth || canvas.width || 1));
        const height = Math.max(1, Math.floor(rect?.height || canvas.clientHeight || canvas.height || 1));
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
            canvas.width = Math.floor(width * ratio);
            canvas.height = Math.floor(height * ratio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function renderReplayWorkspaceOverlay() {
        const status = getHistoryReplayStatus();
        const hasDataset = Boolean(state.historyPreview.dataset);
        const stale = isHistoryPreviewDatasetStale();
        const result = state.historyPreview.graphRenderResult;
        const totalSteps = getHistoryReplayTotalSteps(status);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(status.currentStep) || 0));
        const progressPct = totalSteps ? Math.round((currentStep / totalSteps) * 100) : 0;
        const coverage = getWalletHistoryCoverage();
        const summary = buildHistoryGraphPreviewSummary();
        const windowStatus = getHistoryReplayWindowStatus(summary, status);
        const graphCopy = hasDataset
            ? result
                ? `${result.renderedNodes || 0} nodes / ${result.renderedEdges || 0} edges / ${result.renderedTransfers || 0} transfers`
                : 'Large preview graph preparing'
            : 'Dataset required';
        const readinessCopy = hasDataset
            ? getHistoryReplayStatusText(status, hasDataset, stale)
            : 'Build Preview Dataset from staged history to render the large replay graph. No data is merged into Wallet Lookup.';
        const startDisabled = !hasDataset || stale || state.history.inFlight;
        const replayCoverage = getWalletHistoryReplayCoverage();
        const confidence = getWalletHistoryCompletenessConfidence();
        const speed = status.speed || state.historyPreview.replaySpeed || 'standard';
        const scrubberDisabled = !hasDataset || stale || state.history.inFlight || !totalSteps;
        const warnings = mergeUiStringLists(getWalletHistoryWarnings(), result?.warnings, windowStatus.partial ? ['Partial replay window. More history may exist outside staged pages.'] : []).slice(0, 3);
        const oldestLabel = windowStatus.timelineSegments[0]?.earliest_timestamp
            ? formatPreviewTimestamp(windowStatus.timelineSegments[0].earliest_timestamp)
            : 'Oldest staged';
        const newestSegment = windowStatus.timelineSegments[windowStatus.timelineSegments.length - 1] || {};
        const newestLabel = newestSegment.latest_timestamp
            ? formatPreviewTimestamp(newestSegment.latest_timestamp)
            : 'Newest staged';
        const events = getHistoryReplayEvents(status);
        const bookmarks = buildHistoryReplayJumpChips(summary, status, totalSteps);
        const selectedEvent = getSelectedHistoryReplayEvent(status);
        const audit = state.historyPreview.audit || {};
        const checkpoint = state.historyPreview.checkpoint || loadReplayAuditCheckpoint({ allowLatest: true });
        state.historyPreview.checkpoint = checkpoint || state.historyPreview.checkpoint || null;
        const helper = namespace.replayWorkspace?.renderOverlay;
        if (helper) {
            return helper({
                status,
                hasDataset,
                dataset: state.historyPreview.dataset,
                summary,
                events,
                selectedEvent,
                auditFilters: normalizeReplayAuditFilters(audit.filters),
                neighborhoodFocus: normalizeReplayNeighborhoodFocus(audit.neighborhood),
                breadcrumbs: audit.breadcrumbs || [],
                recentEvents: audit.recentSteps || [],
                investigationStack: audit.investigationStack || [],
                flowLineage: audit.flowLineage || [],
                narrativesVisible: state.historyPreview.narrativesVisible !== false,
                corridorOverlayVisible: state.historyPreview.corridorOverlayVisible !== false,
                continuityViewVisible: state.historyPreview.continuityViewVisible !== false,
                checkpoint,
                bookmarks,
                stale,
                stateInFlight: state.history.inFlight,
                totalSteps,
                currentStep,
                progressPct,
                coverageDetail: coverage.detail,
                windowStatus,
                graphCopy,
                readinessCopy,
                startDisabled,
                replayCoverage,
                confidence,
                gapFlags: getWalletHistoryGapFlags(),
                scanManifest: getWalletHistoryScanManifest(),
                providerState: getWalletHistoryProviderStateDisplay(),
                providerGrade: getWalletHistoryProviderGrade(),
                speed,
                scrubberDisabled,
                warnings,
                oldestLabel,
                newestLabel,
                speedOptions: HISTORY_REPLAY_SPEEDS,
                metaItems: [
                    { label: 'Canvas', value: graphCopy, options: { id: 'crypto-replay-workspace-render-status' } },
                    { label: 'Window', value: windowStatus.windowLabel },
                    { label: 'Current Path', value: getHistoryReplayRouteLabel(status), options: { mono: true, id: 'crypto-replay-workspace-route' } },
                    { label: 'Coverage', value: `${replayCoverage}% replay / ${coverage.label}` },
                    { label: 'Confidence', value: `${confidence}% / ${getWalletHistoryProviderGrade()}` },
                    { label: 'Scan Cache', value: getWalletHistoryScanCacheLabel() }
                ]
            });
        }
        return `
            <div id="crypto-replay-workspace-stage" class="crypto-replay-workspace-panel crypto-replay-workspace-toolbar">
                <div class="crypto-replay-toolbar-main">
                    <div class="min-w-0">
                        <div class="text-[10px] font-mono tracking-[1.2px] text-fuchsia-100/78">REPLAY WORKSPACE MODE</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/90">Preview replay only / not merged</div>
                        <div id="crypto-replay-workspace-status" class="mt-1 text-xs text-fuchsia-50/78 leading-relaxed">${escapeHtml(readinessCopy)}</div>
                    </div>
                    <div class="crypto-replay-workspace-actions">
                        <button id="crypto-replay-workspace-build" type="button" class="is-primary" ${state.history.inFlight ? 'disabled' : ''}>Build Dataset</button>
                        <button id="crypto-replay-workspace-show" type="button" ${!hasDataset || state.history.inFlight ? 'disabled' : ''}>Render Graph</button>
                        <button id="crypto-replay-workspace-start" type="button" ${startDisabled ? 'disabled' : ''}>${escapeHtml(status.playing ? 'Pause' : 'Play')}</button>
                        <button id="crypto-replay-workspace-exit" type="button">Exit</button>
                    </div>
                </div>
                <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/46">
                    <span>${escapeHtml(oldestLabel)}</span>
                    <span id="crypto-replay-workspace-progress">${escapeHtml(`${currentStep}/${totalSteps}`)}</span>
                    <span>${escapeHtml(newestLabel)}</span>
                </div>
                <input id="crypto-replay-workspace-scrubber" type="range" min="0" max="${escapeAttr(totalSteps)}" step="1" value="${escapeAttr(currentStep)}" ${scrubberDisabled ? 'disabled' : ''} aria-label="Large replay workspace timeline" class="mt-1 block min-h-10 w-full cursor-pointer accent-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-50" />
                <div class="h-2 overflow-hidden rounded-full bg-white/10">
                    <div id="crypto-replay-workspace-progress-bar" class="h-full bg-fuchsia-300/78" style="width:${escapeAttr(progressPct)}%"></div>
                </div>
                <div class="mt-2 crypto-replay-workspace-controls">
                    <button id="crypto-replay-workspace-prev" type="button" ${scrubberDisabled || currentStep <= 0 ? 'disabled' : ''}>Prev</button>
                    <button id="crypto-replay-workspace-next" type="button" ${scrubberDisabled || currentStep >= totalSteps ? 'disabled' : ''}>Next</button>
                    <button id="crypto-replay-workspace-window-prev" type="button" ${scrubberDisabled || windowStatus.currentWindowIndex <= 1 ? 'disabled' : ''}>Prev Window</button>
                    <button id="crypto-replay-workspace-window-next" type="button" ${scrubberDisabled || (windowStatus.windowCount && windowStatus.currentWindowIndex >= windowStatus.windowCount) ? 'disabled' : ''}>Next Window</button>
                    <button id="crypto-replay-workspace-reset" type="button" ${!hasDataset ? 'disabled' : ''}>Reset</button>
                    ${Object.entries(HISTORY_REPLAY_SPEEDS).map(([value, label]) => `
                        <button type="button" data-crypto-replay-workspace-speed="${escapeAttr(value)}" ${state.history.inFlight ? 'disabled' : ''} class="${value === speed ? 'is-primary' : ''}">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
            </div>
            <div class="crypto-replay-workspace-bottom">
                <div class="crypto-replay-workspace-panel crypto-replay-workspace-meta">
                    <div class="crypto-replay-meta-grid">
                        ${renderReplayWorkspaceMeta('Canvas', graphCopy, { id: 'crypto-replay-workspace-render-status' })}
                        ${renderReplayWorkspaceMeta('Window', windowStatus.windowLabel)}
                        ${renderReplayWorkspaceMeta('Current Path', getHistoryReplayRouteLabel(status), { mono: true, id: 'crypto-replay-workspace-route' })}
                        ${renderReplayWorkspaceMeta('Coverage', `${replayCoverage}% replay / ${coverage.label}`)}
                        ${renderReplayWorkspaceMeta('Confidence', `${confidence}% / ${getWalletHistoryProviderGrade()}`)}
                        ${renderReplayWorkspaceMeta('Scan Cache', getWalletHistoryScanCacheLabel())}
                    </div>
                    <div class="mt-2 text-xs text-white/52 leading-relaxed">${escapeHtml(coverage.detail)} No identity, ownership, risk, criminality, or investment claims.</div>
                    ${warnings.length ? `<div class="mt-2 grid gap-1.5">${warnings.map(warning => `<div class="rounded-md border border-yellow-200/14 bg-yellow-300/8 px-2 py-1.5 text-yellow-50/74">${escapeHtml(warning)}</div>`).join('')}</div>` : ''}
                </div>
            </div>
        `;
    }

    function renderReplayWorkspaceMeta(label, value, options = {}) {
        const helper = namespace.replayWorkspace?.renderMeta;
        if (helper) return helper(label, value, options);
        const id = options.id ? ` id="${escapeAttr(options.id)}"` : '';
        const valueClass = options.mono ? 'font-mono' : 'font-semibold';
        return `
            <div class="rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-2">
                <div class="text-white/36">${escapeHtml(label)}</div>
                <div${id} class="mt-1 ${valueClass} text-cyan-50/82 break-words">${escapeHtml(String(value ?? '-') || '-')}</div>
            </div>
        `;
    }

    function bindReplayWorkspaceOverlayControls(root) {
        const helper = namespace.replayWorkspace?.bindOverlayControls;
        if (helper) {
            helper(root, {
                buildDataset: () => buildHistoryPreviewDataset(),
                showGraph: () => {
                    state.historyPreview.graphVisible = true;
                    state.historyPreview.lastMessage = 'Large replay workspace preview graph shown. Active Wallet Lookup graph unchanged.';
                    renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
                },
                togglePlay: () => {
                    const status = getHistoryReplayStatus();
                    if (status.playing) {
                        pauseHistoryReplay();
                    } else {
                        startHistoryReplay();
                    }
                },
                step: delta => stepHistoryReplay(delta),
                reset: () => resetHistoryReplay(),
                jumpStart: () => seekHistoryReplayStep(0, { label: 'Replay jumped to the start of the preview canvas only.' }),
                jumpEnd: () => seekHistoryReplayStep(getHistoryReplayTotalSteps(), { label: 'Replay jumped to the final staged preview event only.' }),
                jumpMajor: delta => jumpHistoryReplayMajor(delta),
                jumpBookmark: (step, key) => jumpHistoryReplayBookmark(step, key),
                jumpWindow: delta => jumpReplayWorkspaceWindow(delta),
                jumpBoundary: boundary => jumpReplayBoundary(boundary),
                saveCheckpoint: () => persistReplayAuditCheckpoint('manual'),
                resumeCheckpoint: () => resumeReplayAuditCheckpoint(),
                selectStep: (step, options) => selectHistoryReplayEventByStep(step, {
                    ...(options || {}),
                    pause: true,
                    addBreadcrumb: true
                }),
                updateFilter: (key, value) => updateReplayAuditFilter(key, value),
                resetFilters: () => resetReplayAuditFilters(),
                auditAction: (action, details) => runReplayAuditAction(action, details),
                seek: value => seekHistoryReplayStep(value, {
                    label: 'Replay workspace timeline moved the preview-only canvas.',
                    quiet: true
                }),
                setSpeed: value => setHistoryReplaySpeed(value || 'standard'),
                exit: () => setReplayWorkspaceMode(false)
            });
            return;
        }
        root.querySelector('#crypto-replay-workspace-build')?.addEventListener('click', () => buildHistoryPreviewDataset());
        root.querySelector('#crypto-replay-workspace-show')?.addEventListener('click', () => {
            state.historyPreview.graphVisible = true;
            state.historyPreview.lastMessage = 'Large replay workspace preview graph shown. Active Wallet Lookup graph unchanged.';
            renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        });
        root.querySelector('#crypto-replay-workspace-start')?.addEventListener('click', () => {
            const status = getHistoryReplayStatus();
            if (status.playing) {
                pauseHistoryReplay();
            } else {
                startHistoryReplay();
            }
        });
        root.querySelector('#crypto-replay-workspace-prev')?.addEventListener('click', () => stepHistoryReplay(-1));
        root.querySelector('#crypto-replay-workspace-next')?.addEventListener('click', () => stepHistoryReplay(1));
        root.querySelector('#crypto-replay-workspace-jump-start')?.addEventListener('click', () => seekHistoryReplayStep(0, { label: 'Replay jumped to the start of the preview canvas only.' }));
        root.querySelector('#crypto-replay-workspace-jump-end')?.addEventListener('click', () => seekHistoryReplayStep(getHistoryReplayTotalSteps(), { label: 'Replay jumped to the final staged preview event only.' }));
        root.querySelector('#crypto-replay-workspace-prev-major')?.addEventListener('click', () => jumpHistoryReplayMajor(-1));
        root.querySelector('#crypto-replay-workspace-next-major')?.addEventListener('click', () => jumpHistoryReplayMajor(1));
        root.querySelector('#crypto-replay-workspace-reset')?.addEventListener('click', () => resetHistoryReplay());
        root.querySelector('#crypto-replay-workspace-window-prev')?.addEventListener('click', () => jumpReplayWorkspaceWindow(-1));
        root.querySelector('#crypto-replay-workspace-window-next')?.addEventListener('click', () => jumpReplayWorkspaceWindow(1));
        root.querySelector('#crypto-replay-workspace-boundary-oldest')?.addEventListener('click', () => jumpReplayBoundary('oldest'));
        root.querySelector('#crypto-replay-workspace-boundary-newest')?.addEventListener('click', () => jumpReplayBoundary('newest'));
        root.querySelector('#crypto-replay-workspace-checkpoint-save')?.addEventListener('click', () => persistReplayAuditCheckpoint('manual'));
        root.querySelector('#crypto-replay-workspace-checkpoint-resume')?.addEventListener('click', () => resumeReplayAuditCheckpoint());
        root.querySelector('#crypto-replay-workspace-scrubber')?.addEventListener('input', event => {
            seekHistoryReplayStep(Number(event.target.value) || 0, {
                label: 'Replay workspace timeline moved the preview-only canvas.',
                quiet: true
            });
        });
        root.querySelectorAll('[data-crypto-replay-workspace-speed]').forEach(button => {
            button.addEventListener('click', () => setHistoryReplaySpeed(button.dataset.cryptoReplayWorkspaceSpeed || 'standard'));
        });
        root.querySelectorAll('[data-crypto-replay-bookmark-step]').forEach(button => {
            button.addEventListener('click', () => {
                jumpHistoryReplayBookmark(
                    Number(button.dataset.cryptoReplayBookmarkStep) || 0,
                    button.dataset.cryptoReplayBookmarkKey || ''
                );
            });
        });
        root.querySelector('#crypto-replay-workspace-exit')?.addEventListener('click', () => setReplayWorkspaceMode(false));
    }

    function jumpHistoryReplayMajor(delta = 1) {
        const status = getHistoryReplayStatus();
        const summary = buildHistoryGraphPreviewSummary();
        const totalSteps = getHistoryReplayTotalSteps(status);
        const context = namespace.replayWorkspace?.buildReplayContext?.({
            status,
            dataset: state.historyPreview.dataset,
            summary,
            events: getHistoryReplayEvents(status),
            bookmarks: buildHistoryReplayJumpChips(summary, status, totalSteps),
            warnings: getWalletHistoryWarnings(),
            windowStatus: getHistoryReplayWindowStatus(summary, status),
            totalSteps
        });
        const targetStep = delta < 0
            ? Number(context?.majorNavigation?.previousStep) || 0
            : Number(context?.majorNavigation?.nextStep) || 0;
        if (!targetStep) return null;
        return seekHistoryReplayStep(targetStep, {
            label: 'Replay jumped to the nearest major staged event in the preview-only workspace.'
        });
    }

    function jumpHistoryReplayBookmark(step = 0, key = '') {
        const targetStep = Math.max(0, Math.min(getHistoryReplayTotalSteps(), Math.round(Number(step) || 0)));
        if (!targetStep) return null;
        return seekHistoryReplayStep(targetStep, {
            label: key
                ? `Replay jumped to bookmark ${key} in the preview-only workspace.`
                : 'Replay jumped to the selected bookmark in the preview-only workspace.'
        });
    }

    function jumpReplayWorkspaceWindow(delta = 1) {
        return continueReplayWindow(delta < 0 ? 'newer' : 'older');
    }

    async function continueReplayWindow(direction = 'older') {
        const status = getHistoryReplayStatus();
        const windowStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), status);
        const newestFirst = (getWalletHistoryScanManifest().cursor_state?.sort_order || '') === 'desc';
        const current = Math.max(1, Number(windowStatus.currentWindowIndex) || 1);
        let targetWindow = direction === 'newer'
            ? (Number(windowStatus.newerWindowIndex) || (newestFirst ? current - 1 : current + 1))
            : (Number(windowStatus.olderWindowIndex) || (newestFirst ? current + 1 : current - 1));
        targetWindow = Math.max(1, targetWindow);

        if (direction === 'older' && targetWindow > Math.max(windowStatus.windowCount || 0, current) && state.history.moreAvailable) {
            state.historyPreview.lastMessage = 'Continuing older requires another Worker history page; loading one staged page before rebuilding the replay window.';
            await loadMoreWalletHistory({ pages: 1 });
            const refreshedStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), getHistoryReplayStatus());
            targetWindow = Math.min(Math.max(1, targetWindow), Math.max(1, refreshedStatus.windowCount || targetWindow));
        }

        if (direction === 'newer' && current <= 1 && newestFirst) {
            state.historyPreview.lastMessage = 'No newer staged replay window is available in the current scan cache.';
            updateReplayWorkspaceShell();
            return null;
        }

        return activateReplayWindow(targetWindow, {
            direction,
            reason: direction === 'older' ? 'continue-older' : 'continue-newer',
            preserveAudit: true
        });
    }

    async function activateReplayWindow(windowIndex = 1, options = {}) {
        const descriptor = await requestReplayWindowDescriptor(windowIndex, options);
        if (!descriptor) {
            state.historyPreview.lastMessage = 'Replay window is not available from staged Worker-backed data yet.';
            updateReplayWorkspaceShell();
            return null;
        }
        if (options.persistCheckpoint === true) persistReplayAuditCheckpoint(options.reason || 'window-swap');
        state.historyPreview.activeReplayWindow = descriptor;
        state.historyPreview.graphVisible = true;
        if (!state.historyPreview.workspaceMode) setReplayWorkspaceMode(true, { force: true });
        await buildHistoryPreviewDataset({
            force: true,
            replayWindow: descriptor,
            preserveAudit: options.preserveAudit === true,
            skipRenderStatus: true
        });
        const animator = await initializeHistoryReplayAnimator(getHistoryPreviewRenderRoot(), { stepIndex: 0 });
        const total = getHistoryReplayTotalSteps(animator?.getStatus?.() || getHistoryReplayStatus());
        const targetStep = options.skipSeek
            ? 0
            : options.direction === 'newer'
                ? total
                : Math.min(1, total);
        if (targetStep) await seekHistoryReplayStep(targetStep, {
            quiet: true,
            persistCheckpoint: false,
            label: `Replay continued into ${descriptor.windowLabel}. Active Wallet Lookup graph unchanged.`
        });
        state.historyPreview.lastMessage = `Replay window active: ${descriptor.windowLabel}. This is a staged segment only, not complete lifetime history.`;
        renderSolanaStatusCopy({ metadata: state.graph?.metadata || {} });
        return descriptor;
    }

    async function requestReplayWindowDescriptor(windowIndex = 1, options = {}) {
        const localDescriptor = buildLocalReplayWindowDescriptor(windowIndex);
        const scanId = state.history.scanId || getWalletHistoryScanManifest().scan_id || '';
        if (!scanId) return localDescriptor;
        try {
            const controller = await ensureHistoryController(state.walletLookup.lastWallet || state.walletLookup.walletInput || '');
            const snapshot = controller?.loadReplayWindow
                ? await controller.loadReplayWindow({
                    windowIndex,
                    direction: options.direction || 'current',
                    anchorStep: getHistoryReplayStatus().currentStep || 0,
                    limit: HISTORY_PREVIEW_GRAPH_LIMITS.maxTransactions
                })
                : null;
            if (snapshot) applyHistorySnapshot(snapshot);
            const response = snapshot?.replayWindowResponse || state.historyPreview.replayWindowResponse || null;
            const replayWindow = response?.metadata?.replay_window || response?.replayWindow || null;
            const transactions = Array.isArray(response?.transactions) ? response.transactions : [];
            if (replayWindow) {
                return normalizeReplayWindowDescriptor({
                    ...replayWindow,
                    transactions: transactions.length ? transactions : localDescriptor?.transactions || null
                });
            }
        } catch (error) {
            state.historyPreview.lastMessage = 'Worker replay-window metadata unavailable; using already staged Worker rows for this window.';
        }
        return localDescriptor;
    }

    function buildLocalReplayWindowDescriptor(windowIndex = 1) {
        const rows = state.history.loadedTransactions || [];
        const reconstruction = getWalletHistoryReplayReconstruction();
        const replayWindow = state.history.replayWindow || state.history.lastMetadata?.replay_window || {};
        const chunkSize = Math.max(1, Number(reconstruction.chunk_size || replayWindow.chunk_size || HISTORY_REPLAY_CHUNK_SIZE) || HISTORY_REPLAY_CHUNK_SIZE);
        const windowCount = rows.length ? Math.ceil(rows.length / chunkSize) : Math.max(0, Number(reconstruction.total_windows || replayWindow.total_windows) || 0);
        if (!windowCount) return null;
        const safeIndex = Math.max(1, Math.min(windowCount, Math.round(Number(windowIndex) || 1)));
        const ordinalStart = ((safeIndex - 1) * chunkSize) + 1;
        const ordinalEnd = Math.min(rows.length || Number(reconstruction.total_transactions) || ordinalStart, safeIndex * chunkSize);
        const newestFirst = (getWalletHistoryScanManifest().cursor_state?.sort_order || '') === 'desc';
        return normalizeReplayWindowDescriptor({
            id: `${state.history.scanId || 'local'}:${safeIndex}:${ordinalStart}:${ordinalEnd}`,
            scanId: state.history.scanId || '',
            windowIndex: safeIndex,
            windowCount,
            chunkSize,
            ordinalStart,
            ordinalEnd,
            windowLabel: `Replay window ${safeIndex}/${windowCount} (${ordinalStart}-${ordinalEnd})`,
            rangePosition: windowCount === 1
                ? 'single_staged_range'
                : safeIndex === (newestFirst ? 1 : windowCount)
                    ? 'newest_staged_range'
                    : safeIndex === (newestFirst ? windowCount : 1)
                        ? 'oldest_staged_range'
                        : 'middle_staged_range',
            partial: getWalletHistoryScanManifest().full_history_loaded !== true,
            continuityConfidence: replayWindow.continuity_confidence || reconstruction.continuity_confidence || null,
            gapMap: replayWindow.gap_map || reconstruction.gap_map || getWalletHistoryScanManifest().replay_gap_map || null,
            continuation: {
                can_continue_older: newestFirst ? safeIndex < windowCount : safeIndex > 1,
                can_continue_newer: newestFirst ? safeIndex > 1 : safeIndex < windowCount,
                older_window_index: newestFirst ? safeIndex + 1 : safeIndex - 1,
                newer_window_index: newestFirst ? safeIndex - 1 : safeIndex + 1,
                older_requires_provider_page: newestFirst ? safeIndex >= windowCount && state.history.moreAvailable : safeIndex <= 1 && state.history.moreAvailable,
                newer_requires_provider_page: false,
                next_cursor_available: Boolean(state.history.nextCursor),
                no_full_history_claim: true
            },
            boundary: {
                is_oldest_staged_window: newestFirst ? safeIndex === windowCount : safeIndex === 1,
                is_newest_staged_window: newestFirst ? safeIndex === 1 : safeIndex === windowCount,
                missing_windows_possible: getWalletHistoryScanManifest().full_history_loaded !== true,
                staged_segment_only: true,
                preview_only: true
            }
        });
    }

    function jumpReplayBoundary(boundary = 'oldest') {
        const total = getHistoryReplayTotalSteps();
        const target = boundary === 'newest' ? total : Math.min(1, total);
        if (!target) return null;
        return seekHistoryReplayStep(target, {
            label: boundary === 'newest'
                ? 'Replay jumped to the newest boundary of this staged window.'
                : 'Replay jumped to the oldest boundary of this staged window.'
        });
    }

    function updateReplayAuditFilter(key = '', value = '') {
        const filters = normalizeReplayAuditFilters(state.historyPreview.audit?.filters);
        if (key === 'majorOnly') {
            filters.majorOnly = value === true || value === 'true';
        } else if (key === 'token' || key === 'direction' || key === 'counterparty') {
            filters[key] = String(value || 'all');
        }
        state.historyPreview.audit.filters = filters;
        state.historyPreview.audit.selectedWallet = filters.counterparty !== 'all' ? filters.counterparty : '';
        state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
        persistReplayAuditCheckpoint('filter-change');
        const filtered = namespace.replayWorkspace?.filterReplayEvents
            ? namespace.replayWorkspace.filterReplayEvents(getHistoryReplayEvents(), filters)
            : getHistoryReplayEvents();
        const currentSelected = Number(state.historyPreview.audit.selectedStep) || 0;
        const stillVisible = filtered.some(event => Number(event.step) === currentSelected);
        if (!stillVisible && filtered[0]) {
            selectHistoryReplayEventByStep(filtered[0].step, {
                pause: true,
                addBreadcrumb: false,
                message: 'Replay filter selected the first matching staged transfer. Active Wallet Lookup graph unchanged.'
            });
        } else {
            updateReplayWorkspaceShell();
        }
        state.historyPreview.lastMessage = 'Replay audit filters applied to staged preview data only.';
    }

    function resetReplayAuditFilters() {
        state.historyPreview.audit.filters = {
            token: 'all',
            direction: 'all',
            counterparty: 'all',
            majorOnly: false
        };
        state.historyPreview.audit.selectedWallet = '';
        state.historyPreview.replayAnimator?.setAuditFilters?.(state.historyPreview.audit.filters);
        state.historyPreview.lastMessage = 'Replay audit filters reset. Active Wallet Lookup graph unchanged.';
        persistReplayAuditCheckpoint('filter-reset');
        updateReplayWorkspaceShell();
    }

    async function runReplayAuditAction(action = '', details = {}) {
        const event = getSelectedHistoryReplayEvent();
        if (action === 'select-breadcrumb') {
            return selectHistoryReplayEventByStep(details.step, { pause: true, addBreadcrumb: false });
        }
        if (action === 'remove-breadcrumb') {
            state.historyPreview.audit.breadcrumbs = (state.historyPreview.audit.breadcrumbs || [])
                .filter(crumb => crumb.id !== details.crumbId);
            updateReplayWorkspaceShell();
            return null;
        }
        if (action === 'save-checkpoint') {
            state.historyPreview.lastMessage = 'Replay audit checkpoint saved locally for this staged replay context.';
            return persistReplayAuditCheckpoint('manual');
        }
        if (action === 'resume-checkpoint') {
            return resumeReplayAuditCheckpoint();
        }
        if (action === 'toggle-narratives') {
            return toggleReplayNarratives();
        }
        if (action === 'next-corridor') {
            return stepReplayCorridor(1);
        }
        if (action === 'previous-corridor') {
            return stepReplayCorridor(-1);
        }
        if (action === 'focus-cluster') {
            return focusReplayCluster();
        }
        if (action === 'focus-bridge-wallet') {
            return focusReplayBridgeWallet();
        }
        if (action === 'focus-concentration-zone') {
            return focusReplayConcentrationZone();
        }
        if (action === 'toggle-corridor-overlay') {
            return toggleReplayCorridorOverlay();
        }
        if (action === 'toggle-continuity-view') {
            return toggleReplayContinuityView();
        }
        if (action === 'continue-older' || action === 'continue-newer') {
            return continueReplayWindow(action === 'continue-older' ? 'older' : 'newer');
        }
        if (action === 'jump-boundary-oldest' || action === 'jump-boundary-newest') {
            return jumpReplayBoundary(action === 'jump-boundary-newest' ? 'newest' : 'oldest');
        }
        if (action === 'collapse-neighborhood') {
            return setReplayNeighborhoodFocus(null, 'Replay neighborhood collapsed. Staged replay data and Wallet Lookup graph are unchanged.');
        }
        if (action === 'focus-corridor') {
            const route = details.route || '';
            const step = Number(details.step) || 0;
            if (route) {
                setReplayNeighborhoodFocus({
                    mode: 'route',
                    route
                }, 'Replay corridor focus narrowed to staged same-route rows only.', { persist: false });
            }
            if (step) {
                return selectHistoryReplayEventByStep(step, {
                    pause: true,
                    addBreadcrumb: true,
                    message: 'Replay corridor focus narrowed to staged same-route rows only.'
                });
            }
            updateReplayWorkspaceShell();
            return route ? { route, stagedHistoryOnly: true } : null;
        }
        if (!event) {
            state.historyPreview.lastMessage = 'Select a replay transfer before running replay audit actions.';
            updateReplayWorkspaceShell();
            return null;
        }
        if (action === 'follow-source' || action === 'follow-destination') {
            const wallet = details.wallet || (action === 'follow-source' ? event.sourceWallet : event.destinationWallet) || '';
            if (!wallet) return null;
            return followReplayAuditWallet(wallet, action);
        }
        if (action === 'center-transfer') {
            await selectHistoryReplayEventByStep(event.step, {
                pause: true,
                addBreadcrumb: true,
                message: 'Replay camera centered on the selected staged transfer only.'
            });
            return event;
        }
        if (action === 'inspect-related') {
            state.investigationTab = 'details';
            state.historyPreview.selectedEvent = event;
            openMobileDrawerForSelection('expanded');
            renderDetails();
            state.historyPreview.lastMessage = 'Details now reflects the selected staged replay transfer and its derived replay-only relationships.';
            return event;
        }
        if (action === 'expand-transfer') {
            state.historyPreview.audit.expandedStep = Number(event.step) || 0;
            const filters = normalizeReplayAuditFilters(state.historyPreview.audit.filters);
            filters.token = event.token ? String(event.token).toUpperCase() : filters.token;
            state.historyPreview.audit.filters = filters;
            state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
            setReplayNeighborhoodFocus({
                mode: 'transfer',
                token: filters.token,
                route: getReplayEventRouteKey(event)
            }, 'Replay expansion is scoped to the selected staged transfer neighborhood only.');
            state.historyPreview.lastMessage = 'Replay expansion is scoped to staged transfer neighbors and token context only.';
            updateReplayWorkspaceShell();
            return event;
        }
        if (action === 'expand-wallet') {
            return setReplayNeighborhoodFocus({
                mode: 'wallet',
                wallet: details.wallet || event.destinationWallet || event.sourceWallet || ''
            }, 'Replay wallet neighborhood expanded from staged replay rows only.');
        }
        if (action === 'expand-counterparties') {
            return setReplayNeighborhoodFocus({
                mode: 'counterparties',
                wallet: details.wallet || event.destinationWallet || event.sourceWallet || ''
            }, 'Related counterparties highlighted inside staged replay rows only.');
        }
        if (action === 'expand-route') {
            return setReplayNeighborhoodFocus({
                mode: 'route',
                route: details.route || getReplayEventRouteKey(event)
            }, 'Same-route staged replay neighborhood expanded without merging into Wallet Lookup.');
        }
        if (action === 'expand-token') {
            return setReplayNeighborhoodFocus({
                mode: 'token',
                token: details.token || event.token || event.symbol || ''
            }, 'Token-specific staged replay neighborhood expanded.');
        }
        if (action === 'expand-cluster') {
            return setReplayNeighborhoodFocus({
                mode: 'cluster',
                clusterKey: details.clusterKey || '',
                clusterKind: details.clusterKind || '',
                route: details.route || getReplayEventRouteKey(event),
                token: details.token || event.token || event.symbol || '',
                wallet: details.wallet || event.destinationWallet || event.sourceWallet || ''
            }, 'Replay cluster expanded from repeated staged replay patterns only.');
        }
        if (action === 'continue-around') {
            const total = getHistoryReplayTotalSteps();
            const step = Number(event.step) || 0;
            if (step <= 1) return continueReplayWindow('newer');
            if (total && step >= total) return continueReplayWindow('older');
            state.historyPreview.audit.expandedStep = step;
            persistReplayAuditCheckpoint('continue-around-transfer');
            state.historyPreview.lastMessage = 'Replay continuation is centered around this staged transfer. Use boundary controls to move windows.';
            updateReplayWorkspaceShell();
            return event;
        }
        if (action === 'continue-route') {
            return continueReplayPath('route', {
                route: details.route || getReplayEventRouteKey(event)
            });
        }
        if (action === 'follow-outbound') {
            return continueReplayPath('outbound', {
                wallet: details.wallet || event.destinationWallet || ''
            });
        }
        if (action === 'follow-inbound') {
            return continueReplayPath('inbound', {
                wallet: details.wallet || event.sourceWallet || ''
            });
        }
        if (action === 'continue-token-path') {
            return continueReplayPath('token', {
                token: details.token || event.token || event.symbol || ''
            });
        }
        if (action === 'continue-counterparty') {
            const wallet = details.wallet || event.destinationWallet || event.sourceWallet || '';
            if (!wallet) return null;
            persistReplayAuditCheckpoint('continue-related-counterparty');
            return followReplayAuditWallet(wallet, 'follow-destination');
        }
        if (action === 'continue-token') {
            const token = details.token || event.token || event.symbol || '';
            if (!token) return null;
            const filters = normalizeReplayAuditFilters(state.historyPreview.audit.filters);
            filters.token = String(token).toUpperCase();
            state.historyPreview.audit.filters = filters;
            state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
            persistReplayAuditCheckpoint('continue-related-token');
            state.historyPreview.lastMessage = 'Replay audit is continuing with the related token filter inside staged replay data only.';
            updateReplayWorkspaceShell();
            return event;
        }
        if (action === 'jump-related') {
            const relationships = namespace.replayWorkspace?.deriveReplayRelationships?.(event, getHistoryReplayEvents()) || {};
            const target = Number(details.direction) < 0 ? relationships.previousRelated : relationships.nextRelated;
            if (target?.step) {
                return selectHistoryReplayEventByStep(target.step, {
                    pause: true,
                    addBreadcrumb: true,
                    message: 'Replay jumped to the next derived related staged transfer.'
                });
            }
        }
        return null;
    }

    function setReplayNeighborhoodFocus(focus = null, message = '', options = {}) {
        const normalized = normalizeReplayNeighborhoodFocus(focus || {});
        state.historyPreview.audit.neighborhood = normalized;
        state.historyPreview.replayAnimator?.setNeighborhoodFocus?.(normalized);
        const selected = getSelectedHistoryReplayEvent();
        if (selected?.step && normalized.mode !== 'none') {
            recordReplayInvestigationStackEntry(selected, {
                id: `neighborhood-${normalized.mode}-${selected.step}`,
                step: selected.step,
                label: `${normalized.mode} #${selected.step}`,
                title: message || getHistoryReplayEventTitle(selected)
            }, { persistCheckpoint: false });
        }
        pruneReplayInvestigationState();
        if (options.persist !== false) {
            persistReplayAuditCheckpoint(normalized.mode === 'none' ? 'neighborhood-reset' : 'neighborhood-expansion');
        }
        state.historyPreview.lastMessage = message || 'Replay neighborhood updated from staged replay data only.';
        updateReplayWorkspaceShell();
        return normalized;
    }

    async function continueReplayPath(kind = 'route', details = {}) {
        const current = getSelectedHistoryReplayEvent() || getCurrentHistoryReplayEvent();
        if (!current) {
            state.historyPreview.lastMessage = 'Select a staged replay transfer before continuing a replay path.';
            updateReplayWorkspaceShell();
            return null;
        }
        const currentStep = Number(current.step) || 0;
        const route = details.route || getReplayEventRouteKey(current);
        const token = String(details.token || current.token || current.symbol || '').toUpperCase();
        const wallet = String(details.wallet || '').trim();
        const events = getHistoryReplayEvents().slice().sort((a, b) => Number(a.step) - Number(b.step));
        const after = events.filter(event => Number(event.step) > currentStep);
        const before = events.filter(event => Number(event.step) < currentStep).reverse();
        const predicate = event => {
            if (kind === 'route') return route && getReplayEventRouteKey(event) === route;
            if (kind === 'token') return token && String(event.token || event.symbol || '').toUpperCase() === token;
            if (kind === 'outbound') return wallet && String(event.sourceWallet || event.source_wallet || '') === wallet;
            if (kind === 'inbound') return wallet && String(event.destinationWallet || event.destination_wallet || '') === wallet;
            return false;
        };
        const target = after.find(predicate) || (kind === 'inbound' ? before.find(predicate) : null);
        if (target?.step) {
            const focus = kind === 'route'
                ? { mode: 'route', route }
                : kind === 'token'
                    ? { mode: 'token', token }
                    : { mode: 'wallet', wallet };
            setReplayNeighborhoodFocus(focus, 'Replay path continuation narrowed to staged replay rows only.');
            return selectHistoryReplayEventByStep(target.step, {
                pause: true,
                addBreadcrumb: true,
                message: getReplayContinuationMessage(kind, true)
            });
        }
        const windowStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), getHistoryReplayStatus());
        if (windowStatus.canContinueOlder || windowStatus.olderRequiresProviderPage) {
            state.historyPreview.lastMessage = getReplayContinuationMessage(kind, false);
            setReplayNeighborhoodFocus(kind === 'route'
                ? { mode: 'route', route }
                : kind === 'token'
                    ? { mode: 'token', token }
                    : { mode: 'wallet', wallet }, state.historyPreview.lastMessage);
            return continueReplayWindow('older');
        }
        state.historyPreview.lastMessage = 'No next staged replay event matches that continuation. This does not prove the chain ends.';
        updateReplayWorkspaceShell();
        return null;
    }

    function getReplayContinuationMessage(kind = 'route', found = false) {
        const label = kind === 'route'
            ? 'same-route'
            : kind === 'token'
                ? 'token-specific'
                : kind === 'outbound'
                    ? 'outbound'
                    : 'inbound';
        return found
            ? `Replay continued to the next ${label} staged event. Continuity remains staged-only.`
            : `No ${label} continuation is visible in this staged window; moving to an older staged window may still be uncertain.`;
    }

    function getReplayEventRouteKey(event = {}) {
        const source = String(event.sourceWallet || event.source_wallet || '').trim();
        const destination = String(event.destinationWallet || event.destination_wallet || '').trim();
        return source && destination ? `${source}>${destination}` : '';
    }

    function pruneReplayInvestigationState() {
        const audit = state.historyPreview.audit || {};
        audit.breadcrumbs = Array.isArray(audit.breadcrumbs) ? audit.breadcrumbs.slice(-7) : [];
        audit.recentSteps = Array.isArray(audit.recentSteps)
            ? audit.recentSteps.map(step => Math.max(0, Number(step) || 0)).filter(Boolean).slice(0, 8)
            : [];
        audit.investigationStack = Array.isArray(audit.investigationStack)
            ? audit.investigationStack.filter(item => Number(item.step) > 0).slice(0, 8)
            : [];
        audit.flowLineage = Array.isArray(audit.flowLineage)
            ? audit.flowLineage.filter(item => Number(item.step) > 0).slice(0, 8)
            : [];
        audit.neighborhood = normalizeReplayNeighborhoodFocus(audit.neighborhood);
        state.historyPreview.audit = audit;
        if (state.historyPreview.replayWindowCache?.size > HISTORY_REPLAY_WINDOW_CACHE_LIMIT) {
            while (state.historyPreview.replayWindowCache.size > HISTORY_REPLAY_WINDOW_CACHE_LIMIT) {
                const oldestKey = state.historyPreview.replayWindowCache.keys().next().value;
                state.historyPreview.replayWindowCache.delete(oldestKey);
            }
        }
    }

    function followReplayAuditWallet(wallet = '', source = '') {
        const filters = normalizeReplayAuditFilters(state.historyPreview.audit.filters);
        filters.counterparty = wallet || 'all';
        state.historyPreview.audit.filters = filters;
        state.historyPreview.audit.selectedWallet = wallet;
        state.historyPreview.audit.neighborhood = normalizeReplayNeighborhoodFocus({ mode: 'wallet', wallet });
        state.historyPreview.replayAnimator?.setAuditFilters?.(filters);
        state.historyPreview.replayAnimator?.setNeighborhoodFocus?.(state.historyPreview.audit.neighborhood);
        persistReplayAuditCheckpoint('follow-counterparty');
        const events = namespace.replayWorkspace?.filterReplayEvents
            ? namespace.replayWorkspace.filterReplayEvents(getHistoryReplayEvents(), filters)
            : getHistoryReplayEvents().filter(event => event.sourceWallet === wallet || event.destinationWallet === wallet);
        const currentStep = Number(state.historyPreview.audit.selectedStep || getHistoryReplayStatus().currentStep) || 0;
        const target = events.find(event => Number(event.step) >= currentStep) || events[0] || null;
        state.historyPreview.lastMessage = source === 'follow-source'
            ? 'Replay audit is following the source wallet within staged replay data only.'
            : 'Replay audit is following the destination wallet within staged replay data only.';
        if (target?.step) {
            return selectHistoryReplayEventByStep(target.step, {
                pause: true,
                wallet,
                addBreadcrumb: true
            });
        }
        updateReplayWorkspaceShell();
        return null;
    }

    function bindInvestigationWorkspaceControls(root) {
        root.querySelectorAll('[data-crypto-investigation-tab]').forEach(button => {
            button.addEventListener('click', () => {
                setInvestigationTab(button.dataset.cryptoInvestigationTab || 'summary');
            });
        });
        root.querySelectorAll('[data-crypto-investigation-tab-target]').forEach(button => {
            button.addEventListener('click', () => {
                setInvestigationTab(button.dataset.cryptoInvestigationTabTarget || 'summary');
            });
        });
        root.querySelectorAll('[data-crypto-copy-value]').forEach(button => {
            button.addEventListener('click', () => {
                copyGuidedValue(button.dataset.cryptoCopyValue || '', button);
            });
        });
        root.querySelectorAll('[data-crypto-history-action]').forEach(button => {
            button.addEventListener('click', () => {
                runGuidedHistoryAction(button.dataset.cryptoHistoryAction || '');
            });
        });
        bindStatusControls(root);
    }

    function renderInvestigationDetailsPanelContent() {
        if (!state.graph) return '<div class="text-sm text-white/45">No crypto graph is loaded.</div>';
        const selectedFlow = getSelectedFlowEdge();
        if (selectedFlow) {
            return renderSelectedFlowDetailPanel(selectedFlow);
        }

        const node = state.selectedId ? state.graph.nodeById.get(state.selectedId) : null;
        if (!node && state.historyPreview.selectedEvent) {
            return renderSelectedReplayEventDetailPanel(state.historyPreview.selectedEvent);
        }
        if (!node) {
            return renderInvestigationDetailsEmptyState();
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
        const nodeAddress = node.address || node.token_mint || '';
        const nodeCopyLabel = node.type === core.NODE_TYPES.TOKEN ? 'Copy token mint' : 'Copy selected address';
        const selectionLabel = isHubNode(node) ? 'Selected hub node' : node.type === core.NODE_TYPES.TOKEN ? 'Selected token node' : 'Selected wallet node';
        return `
            ${renderDetailsSelectionHeader({
                kicker: `${isHubNode(node) ? 'ENTITY HUB' : node.type.toUpperCase()} NODE`,
                title: labelForNode(node),
                status: selectionLabel,
                body: contextCopy,
                actions: [
                    nodeAddress ? renderCopyButton(nodeCopyLabel, nodeAddress) : '',
                    primaryFlow ? renderCopyButton('Copy connected flow summary', buildSelectedFlowSummary(primaryFlow)) : ''
                ]
            })}
            ${renderDetailsFocusActionPanel(primaryFlow, node)}
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

    function renderInvestigationDetailsEmptyState() {
        const intelligence = state.dataMode === DATA_MODES.WALLET ? buildWalletIntelligence() : null;
        return `
            <div class="crypto-empty-state">
                <div class="crypto-kicker">DETAILS</div>
                <h3>No graph selection</h3>
                <p>Click a wallet, token, hub, or visible transfer edge in the graph to update this tab. Use Inspect actions when you want to jump here from Summary, Flows, History, or Replay.</p>
            </div>
            ${renderGuidedActionGrid(buildDetailsEmptyGuidedActions(intelligence), {
                title: 'Start Inspecting',
                subtitle: 'Selections stay readable here with copy actions and source-boundary notes.'
            })}
            ${intelligence ? renderDetailSection('Current Lookup', `
                ${detailRow('Tracked Wallet', intelligence.trackedWallet || '-', { shorten: true })}
                ${detailRow('Returned Events', intelligence.returnedEvents)}
                ${detailRow('Visible Transfer Legs', intelligence.visibleLegs)}
                ${detailRow('Filtered / Noise Removed', intelligence.filteredLegs)}
                ${detailRow('Last Loaded', intelligence.lastLoadedLabel)}
            `) : ''}
        `;
    }

    function buildDetailsEmptyGuidedActions(intelligence = null) {
        if (!intelligence) return [
            { title: 'Open Summary', detail: 'Review graph source and visible-flow counts.', tab: 'summary' },
            { title: 'Open Flows', detail: 'Compare timeline, counterparties, and tokens.', tab: 'flows' }
        ];
        return [
            {
                title: 'Inspect largest flow',
                detail: intelligence.largestFlowEdge ? intelligence.largestFlow : 'No visible flow is selected.',
                flowId: intelligence.largestFlowEdge?.id || '',
                disabled: !intelligence.largestFlowEdge,
                tone: intelligence.largestFlowEdge ? 'strong' : 'idle'
            },
            {
                title: 'Review top counterparty',
                detail: intelligence.mostActiveCounterparty ? shortLongValue(intelligence.mostActiveCounterparty.address) : 'No counterparty is ranked.',
                walletAddress: intelligence.mostActiveCounterparty?.address || '',
                disabled: !intelligence.mostActiveCounterparty
            },
            { title: 'Open History', detail: 'Stage additional Worker history pages only.', tab: 'history' },
            { title: 'Open Replay', detail: 'Use preview-only graph and animation tools.', tab: 'replay' }
        ];
    }

    function renderDetailsFocusActionPanel(edge = null, node = null) {
        const action = getPreferredTokenIsolationAction(buildWalletIntelligence(), edge, node);
        const focusAction = {
            title: state.focusSelection ? 'Focus selection on' : 'Focus selection off',
            detail: state.focusSelection
                ? 'Selected nodes and flows isolate their direct context in the active graph.'
                : 'Full graph context is visible; selections still glow without fading unrelated items.',
            tab: 'details',
            disabled: true
        };
        return renderGuidedActionGrid([action, focusAction], {
            title: 'Graph Focus',
            subtitle: 'Token isolation is a visual overlay on the active graph; replay preview data remains separate.'
        });
    }

    function renderSelectedFlowDetailPanel(edge) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        const signature = edge.transaction_hash || edge.signature || '';
        return `
            ${renderDetailsSelectionHeader({
                kicker: 'TRANSFER FLOW',
                title: 'Selected Flow',
                status: 'Selected flow edge',
                body: 'Visible transfer leg from the current graph and active filters. This is an address-to-address observation, not an identity claim.',
                actions: [
                    renderCopyButton('Copy selected flow summary', buildSelectedFlowSummary(edge)),
                    signature ? renderCopyButton('Copy selected signature', signature) : '',
                    renderCopyButton('Copy source address', getFlowSourceAddress(edge)),
                    renderCopyButton('Copy destination address', getFlowTargetAddress(edge))
                ]
            })}
            ${renderDetailsFocusActionPanel(edge)}
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
                    ${detailRow('Signature', edge.transaction_hash || edge.signature || '-', { shorten: true })}
                    ${detailRow('Source / Boundary', getCurrentSourceLabel())}
                </div>
            </section>
        `;
    }

    function renderSelectedReplayEventDetailPanel(event = {}) {
        const sourceWallet = event.sourceWallet || event.source_wallet || '';
        const destinationWallet = event.destinationWallet || event.destination_wallet || '';
        const signature = event.signature || event.transaction_hash || '';
        const relationships = namespace.replayWorkspace?.deriveReplayRelationships?.(event, getHistoryReplayEvents()) || {};
        return `
            ${renderDetailsSelectionHeader({
                kicker: 'PREVIEW REPLAY EVENT',
                title: `Replay Step ${event.step || '-'}`,
                status: 'Preview-only selected event',
                body: 'This event comes from the staged history preview dataset. It is not merged into the active Wallet Lookup graph and does not create graph selection state.',
                actions: [
                    renderCopyButton('Copy replay event summary', buildReplayEventSummary(event)),
                    signature ? renderCopyButton('Copy selected signature', signature) : '',
                    sourceWallet ? renderCopyButton('Copy source address', sourceWallet) : '',
                    destinationWallet ? renderCopyButton('Copy destination address', destinationWallet) : ''
                ]
            })}
            ${renderDetailSection('Replay Event Profile', `
                ${detailRow('Step', `${event.step || '-'}${event.totalSteps ? ` / ${event.totalSteps}` : ''}`)}
                ${detailRow('Direction', getHistoryReplayDirectionLabel(event.direction))}
                ${detailRow('Amount / Token', getHistoryReplayAmountTokenLabel(event))}
                ${detailRow('Timestamp', event.timestamp ? formatPreviewTimestamp(event.timestamp) : '-')}
                ${detailRow('Source Wallet', sourceWallet || '-', { shorten: true })}
                ${detailRow('Destination Wallet', destinationWallet || '-', { shorten: true })}
                ${detailRow('Signature', signature || '-', { shorten: true })}
                ${detailRow('Source / Boundary', 'Preview dataset from staged Worker history. Active graph unchanged.')}
            `)}
            ${renderDetailSection('Replay Audit Links', `
                ${detailRow('Same Counterparty', `${relationships.sameCounterparty?.length || 0} staged transfer${relationships.sameCounterparty?.length === 1 ? '' : 's'}`)}
                ${detailRow('Same Token', `${relationships.sameToken?.length || 0} staged transfer${relationships.sameToken?.length === 1 ? '' : 's'}`)}
                ${detailRow('Nearby Timestamp', `${relationships.nearbyTime?.length || 0} staged transfer${relationships.nearbyTime?.length === 1 ? '' : 's'}`)}
                ${detailRow('Repeated Route', `${relationships.repeatedRoute?.length || 0} staged transfer${relationships.repeatedRoute?.length === 1 ? '' : 's'}`)}
                ${detailRow('Previous Related', relationships.previousRelated ? `Step ${relationships.previousRelated.step}` : '-')}
                ${detailRow('Next Related', relationships.nextRelated ? `Step ${relationships.nextRelated.step}` : '-')}
            `)}
            ${renderDetailSection('Relationship To Tracked Wallet', `
                ${detailRow('Tracked Wallet', getRelationshipWallet() || state.walletLookup.lastWallet || '-', { shorten: true })}
                ${detailRow('Interpretation', event.direction ? getHistoryReplayDirectionLabel(event.direction) : 'Replay direction unavailable')}
                ${detailRow('Claims Boundary', 'Address-to-address observation only; no identity, ownership, risk, criminality, or investment claims.')}
            `)}
        `;
    }

    function renderDetailsSelectionHeader(options = {}) {
        const helper = namespace.investigationWorkspace?.renderSelectionHeader;
        if (helper) return helper(options);
        const actions = (options.actions || []).filter(Boolean).join('');
        return `
            <section class="crypto-details-selected">
                <div class="crypto-details-selected-copy">
                    <div class="crypto-kicker">${escapeHtml(options.kicker || 'DETAILS')}</div>
                    <h3>${escapeHtml(options.title || 'Selected Object')}</h3>
                    <div class="crypto-selection-pill">${escapeHtml(options.status || 'Selected')}</div>
                    ${options.body ? `<p>${escapeHtml(options.body)}</p>` : ''}
                </div>
                ${actions ? `<div class="crypto-details-actions">${actions}</div>` : ''}
            </section>
        `;
    }

    function renderCopyButton(label, value) {
        const helper = namespace.investigationWorkspace?.renderCopyButton;
        if (helper) return helper(label, value);
        const text = String(value || '');
        if (!text) return '';
        return `
            <button type="button" data-crypto-copy-value="${escapeAttr(text)}" class="crypto-copy-action">
                ${escapeHtml(label)}
            </button>
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
        const helper = namespace.investigationWorkspace?.renderDetailSection;
        if (helper) return helper(title, rows);
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

    function openWalletInvestigationReportPreview() {
        closeWalletInvestigationReportPreview();
        const report = buildWalletInvestigationReport();
        const backdrop = document.createElement('div');
        backdrop.id = 'crypto-wallet-report-preview';
        backdrop.className = 'fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-950/82 px-3 py-4 sm:p-6';
        backdrop.innerHTML = `
            <section class="crypto-wallet-report-modal w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-cyan-200/18 bg-slate-950/96 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="crypto-wallet-report-title">
                <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                    <div class="min-w-0">
                        <div class="text-[10px] font-mono tracking-[1.3px] text-cyan-100/68">WALLET LOOKUP EXPORT</div>
                        <h3 id="crypto-wallet-report-title" class="mt-1 text-lg font-display text-cyan-50/90">Investigation Snapshot</h3>
                        <div class="mt-1 text-xs text-white/52">${escapeHtml(report.statusLine)}</div>
                    </div>
                    <button id="crypto-wallet-report-close" type="button" class="min-h-10 rounded-xl border border-white/15 px-3 py-2 text-white/70 hover:border-cyan-100/30" aria-label="Close investigation report preview">
                        Close
                    </button>
                </div>
                <div class="grid gap-3 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4 max-h-[calc(92vh-8rem)]">
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        ${renderReportPreviewMetric('Visible Legs', report.metrics.visibleLegs)}
                        ${renderReportPreviewMetric('Noise Removed', report.metrics.filteredLegs)}
                        ${renderReportPreviewMetric('History', report.metrics.historyStatus)}
                        ${renderReportPreviewMetric('Replay', report.metrics.replayStatus)}
                    </div>
                    <div class="rounded-xl border border-yellow-200/18 bg-yellow-300/10 px-3 py-2 text-xs leading-relaxed text-yellow-50/78">
                        <div class="font-semibold text-yellow-50/90">What this report is / is not</div>
                        <div class="mt-1">${escapeHtml(report.whatThisIsCopy)}</div>
                        <div class="mt-1">${escapeHtml(report.whatThisIsNotCopy)}</div>
                    </div>
                    <section class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div class="min-w-0">
                            <div class="mb-1 text-[10px] font-mono tracking-[1.2px] text-cyan-100/62">READABLE MARKDOWN SUMMARY</div>
                            <pre id="crypto-wallet-report-text" class="crypto-wallet-report-preview max-h-[44vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/28 p-3 text-[11px] leading-relaxed text-cyan-50/82">${escapeHtml(report.markdown)}</pre>
                        </div>
                        <div class="min-w-0">
                            <div class="mb-1 text-[10px] font-mono tracking-[1.2px] text-cyan-100/62">COPYABLE JSON SNAPSHOT</div>
                            <pre id="crypto-wallet-report-json" class="crypto-wallet-report-preview max-h-[44vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/28 p-3 text-[11px] leading-relaxed text-cyan-50/82">${escapeHtml(report.jsonText)}</pre>
                        </div>
                    </section>
                </div>
                <div class="flex flex-col gap-2 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div id="crypto-wallet-report-copy-status" class="min-h-5 text-xs text-white/46">${escapeHtml(report.copyHint)}</div>
                    <div class="crypto-wallet-report-actions flex flex-col sm:flex-row gap-2">
                        <button id="crypto-wallet-report-copy-markdown" type="button" class="min-h-11 rounded-xl border border-emerald-200/24 bg-emerald-300/14 px-4 py-2 text-sm font-semibold text-emerald-50/88 hover:border-emerald-100/40">
                            Copy Markdown
                        </button>
                        <button id="crypto-wallet-report-copy-json" type="button" class="min-h-11 rounded-xl border border-cyan-200/24 bg-cyan-300/12 px-4 py-2 text-sm font-semibold text-cyan-50/88 hover:border-cyan-100/40">
                            Copy JSON
                        </button>
                        <button id="crypto-wallet-report-download-json" type="button" class="min-h-11 rounded-xl border border-white/15 bg-white/[0.045] px-4 py-2 text-sm font-semibold text-white/76 hover:border-cyan-100/32">
                            Download JSON
                        </button>
                    </div>
                </div>
            </section>
        `;

        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) closeWalletInvestigationReportPreview();
        });
        backdrop.querySelector('#crypto-wallet-report-close')?.addEventListener('click', closeWalletInvestigationReportPreview);
        backdrop.querySelector('#crypto-wallet-report-copy-markdown')?.addEventListener('click', event => {
            copyWalletInvestigationReport(report.markdown, event.currentTarget, {
                success: 'Markdown summary copied to clipboard.',
                fallback: 'Clipboard unavailable. Select the Markdown preview manually.',
                previewId: 'crypto-wallet-report-text'
            });
        });
        backdrop.querySelector('#crypto-wallet-report-copy-json')?.addEventListener('click', event => {
            copyWalletInvestigationReport(report.jsonText, event.currentTarget, {
                success: 'JSON snapshot copied to clipboard.',
                fallback: 'Clipboard unavailable. Select the JSON preview manually.',
                previewId: 'crypto-wallet-report-json'
            });
        });
        backdrop.querySelector('#crypto-wallet-report-download-json')?.addEventListener('click', event => {
            downloadWalletInvestigationSnapshot(report, event.currentTarget);
        });
        document.body.appendChild(backdrop);
        backdrop.querySelector('#crypto-wallet-report-copy-markdown')?.focus();
    }

    function closeWalletInvestigationReportPreview() {
        document.getElementById('crypto-wallet-report-preview')?.remove();
    }

    function renderReportPreviewMetric(label, value) {
        return `
            <div class="min-w-0 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
                <div class="text-white/36">${escapeHtml(label)}</div>
                <div class="mt-1 font-semibold text-cyan-50/86 break-words">${escapeHtml(value)}</div>
            </div>
        `;
    }

    async function copyWalletInvestigationReport(text, button, options = {}) {
        const status = document.getElementById('crypto-wallet-report-copy-status');
        const original = button?.textContent || 'Copy';
        try {
            await writeTextToClipboard(text);
            if (button) button.textContent = 'Copied';
            if (status) status.textContent = options.success || 'Report copied to clipboard.';
        } catch (error) {
            if (button) button.textContent = 'Select Text';
            if (status) status.textContent = options.fallback || 'Clipboard unavailable. Select the preview text manually.';
            selectWalletReportPreviewText(options.previewId);
        }
        window.setTimeout(() => {
            if (button) button.textContent = original;
        }, 1400);
    }

    function downloadWalletInvestigationSnapshot(report, button) {
        const status = document.getElementById('crypto-wallet-report-copy-status');
        const original = button?.textContent || 'Download JSON';
        try {
            const blob = new Blob([report.jsonText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getWalletInvestigationSnapshotFilename(report.snapshot);
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            if (button) button.textContent = 'Downloaded';
            if (status) status.textContent = 'JSON snapshot download started.';
        } catch (error) {
            if (button) button.textContent = 'Download Failed';
            if (status) status.textContent = 'Download unavailable in this browser context. Copy JSON instead.';
        }
        window.setTimeout(() => {
            if (button) button.textContent = original;
        }, 1400);
    }

    async function writeTextToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // Fall back for local/static contexts where clipboard permission is blocked.
            }
        }
        if (fallbackCopyReportText(text)) return true;
        throw new Error('Clipboard unavailable');
    }

    async function copyGuidedValue(value, button) {
        const text = String(value || '');
        if (!text) return false;
        const original = button?.textContent || 'Copy';
        try {
            await writeTextToClipboard(text);
            if (button) button.textContent = 'Copied';
            return true;
        } catch (error) {
            if (button) button.textContent = 'Copy Failed';
            return false;
        } finally {
            window.setTimeout(() => {
                if (button) button.textContent = original;
            }, 1400);
        }
    }

    async function runGuidedHistoryAction(action) {
        if (action === 'build-dataset') {
            await buildHistoryPreviewDataset();
            return;
        }
        if (action === 'load-more') {
            await loadMoreWalletHistory();
            return;
        }
        if (action === 'provider-diagnostics') {
            await checkWalletHistoryProviderCapability();
            return;
        }
        if (action === 'start-replay') {
            await startHistoryReplay();
            return;
        }
        if (action === 'toggle-replay-workspace') {
            toggleReplayWorkspaceMode();
            return;
        }
        if (action === 'inspect-replay-event') {
            inspectCurrentHistoryReplayEvent();
        }
    }

    function fallbackCopyReportText(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (error) {
            copied = false;
        }
        textarea.remove();
        return copied;
    }

    function selectWalletReportPreviewText(previewId = 'crypto-wallet-report-text') {
        const reportText = document.getElementById(previewId) || document.getElementById('crypto-wallet-report-text');
        const selection = window.getSelection?.();
        if (!reportText || !selection) return;
        const range = document.createRange();
        range.selectNodeContents(reportText);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function buildWalletInvestigationReport() {
        const snapshot = buildWalletInvestigationSnapshot();
        const markdown = buildWalletInvestigationMarkdown(snapshot);
        const jsonText = JSON.stringify(snapshot, null, 2);

        return {
            snapshot,
            text: markdown,
            markdown,
            jsonText,
            statusLine: snapshot.status.summary,
            whatThisIsCopy: snapshot.report_boundaries.what_this_is,
            whatThisIsNotCopy: snapshot.report_boundaries.what_this_is_not,
            copyHint: 'Copy Markdown for a readable note, copy JSON for structured export, or download the JSON file.',
            metrics: {
                visibleLegs: snapshot.lookup.visible_flows,
                filteredLegs: snapshot.lookup.filtered_noise_removed_count,
                historyStatus: snapshot.history.status,
                replayStatus: snapshot.replay_preview.status
            }
        };
    }

    function buildWalletInvestigationSnapshot() {
        const intelligence = buildWalletIntelligence();
        const selectedFlow = getSelectedFlowEdge();
        const emptyState = getWalletLookupEmptyStateDetails(intelligence);
        const statusLine = getWalletReportStatusLine(intelligence, emptyState);
        const selectedNode = state.selectedId ? state.graph?.nodeById.get(state.selectedId) : null;
        const replayStatus = getHistoryReplayStatus();
        const replayWindowStatus = getHistoryReplayWindowStatus(buildHistoryGraphPreviewSummary(), replayStatus);
        const replayDatasetStale = isHistoryPreviewDatasetStale();
        const historyRows = state.history.loadedTransactions || [];
        const datasetMetrics = state.historyPreview.datasetMetrics || null;
        const graphRender = state.historyPreview.graphRenderResult || null;
        const trackedWallet = intelligence.trackedWallet || '';
        const lastLoadedIso = state.walletLookup.lastLoadedAt ? safeDateIso(state.walletLookup.lastLoadedAt) : null;

        return {
            snapshot_type: 'cryptophotonic_wallet_investigation_snapshot',
            phase: 'D125',
            schema_version: '1.0',
            generated_at: new Date().toISOString(),
            status: {
                summary: statusLine,
                wallet_loaded: Boolean(state.walletLookup.lastWallet || state.walletLookup.lastLoadedAt),
                wallet_lookup_in_flight: Boolean(state.walletLookup.inFlight)
            },
            mode: {
                key: state.dataMode,
                label: getCurrentSourceLabel(),
                source: intelligence.sourceLabel || getCurrentSourceLabel(),
                source_kind: state.datasetSourceKind || '',
                worker_replacement_graph: state.dataMode === DATA_MODES.WALLET,
                active_graph_source: state.dataMode === DATA_MODES.WALLET
                    ? 'Current Wallet Lookup replacement graph'
                    : getCurrentSourceLabel()
            },
            lookup: {
                tracked_wallet: trackedWallet,
                tracked_wallet_short: trackedWallet ? shortLongValue(trackedWallet) : '',
                last_loaded_at: lastLoadedIso,
                last_loaded_display: state.walletLookup.lastLoadedAt ? formatReportDateTime(state.walletLookup.lastLoadedAt) : 'Not loaded',
                returned_events: intelligence.returnedEvents,
                visible_flows: intelligence.visibleLegs,
                filtered_noise_removed_count: intelligence.filteredLegs,
                graph_depth: intelligence.graphDepth,
                active_filters: {
                    transaction_type: state.filters.transactionType,
                    token: getTokenIsolationLabel(state.filters.token),
                    token_key: state.filters.token,
                    direction: state.filters.direction,
                    has_active_filter: hasActiveFlowFilter()
                }
            },
            highlights: {
                top_counterparty: intelligence.mostActiveCounterparty
                    ? serializeCounterpartySnapshot(intelligence.mostActiveCounterparty)
                    : null,
                top_token: intelligence.mostActiveToken
                    ? serializeTokenSnapshot(intelligence.mostActiveToken)
                    : null,
                largest_flow: intelligence.largestFlowEdge
                    ? serializeFlowSnapshot(intelligence.largestFlowEdge)
                    : null,
                dominant_direction: intelligence.dominantDirection || null,
                recent_activity_density: intelligence.recentActivityDensity || null
            },
            selection: buildInvestigationSnapshotSelection(selectedFlow, selectedNode),
            history: {
                status: getWalletHistoryLastStatusDisplay(),
                provider: getWalletHistoryProviderDisplay(),
                provider_state: getWalletHistoryProviderStateDisplay(),
                provider_grade: getWalletHistoryProviderGrade(),
                archive_readiness: getWalletHistoryArchiveReadiness(),
                completeness_confidence: getWalletHistoryCompletenessConfidence(),
                replay_coverage_pct: getWalletHistoryReplayCoverage(),
                scan_id: state.history.scanId || null,
                gap_flags: getWalletHistoryGapFlags(),
                warnings: getWalletHistoryWarnings(),
                cache: getWalletHistoryCacheDisplay(),
                cache_detail: getWalletHistoryCacheTitle(),
                pages_loaded: state.history.pagesLoaded,
                provider_pages_loaded: state.history.providerPagesLoaded,
                staged_transaction_rows: historyRows.length,
                unique_transactions_tracked: state.history.totalLoadedTransactions,
                next_cursor: state.history.nextCursor || null,
                more_available: Boolean(state.history.moreAvailable),
                replay_window: {
                    id: replayWindowStatus.windowId || replayWindowStatus.id || '',
                    label: replayWindowStatus.windowLabel || '',
                    index: replayWindowStatus.currentWindowIndex || 0,
                    total_windows: replayWindowStatus.windowCount || 0,
                    ordinal_start: replayWindowStatus.windowStart || 0,
                    ordinal_end: replayWindowStatus.windowEnd || 0,
                    partial: Boolean(replayWindowStatus.partial),
                    can_continue_older: Boolean(replayWindowStatus.canContinueOlder || replayWindowStatus.olderRequiresProviderPage),
                    can_continue_newer: Boolean(replayWindowStatus.canContinueNewer)
                },
                last_message: getWalletHistoryLastMessage(),
                last_error: state.history.lastError || '',
                staged_only: true,
                active_graph_unchanged: true
            },
            replay_preview: {
                status: getHistoryReplayStateLabel(replayStatus, Boolean(state.historyPreview.dataset), replayDatasetStale),
                preview_dataset_built: Boolean(state.historyPreview.dataset),
                preview_dataset_stale: Boolean(replayDatasetStale),
                preview_plan_built: Boolean(state.historyPreview.plan),
                workspace_mode: Boolean(state.historyPreview.workspaceMode),
                graph_visible: Boolean(state.historyPreview.graphVisible),
                playing: Boolean(replayStatus.playing),
                current_step: Number(replayStatus.currentStep) || 0,
                total_steps: getHistoryReplayTotalSteps(replayStatus),
                window_label: replayWindowStatus.windowLabel || '',
                checkpoint: state.historyPreview.checkpoint ? {
                    saved_at: state.historyPreview.checkpoint.savedAt || '',
                    selected_step: state.historyPreview.checkpoint.selectedStep || 0,
                    window_index: state.historyPreview.checkpoint.windowIndex || 0,
                    has_filters: Boolean(state.historyPreview.checkpoint.filters && JSON.stringify(state.historyPreview.checkpoint.filters) !== JSON.stringify({ token: 'all', direction: 'all', counterparty: 'all', majorOnly: false }))
                } : null,
                speed: replayStatus.speedLabel || replayStatus.speed || '',
                selected_event: state.historyPreview.selectedEvent
                    ? serializeReplayEventSnapshot(state.historyPreview.selectedEvent)
                    : replayStatus.currentEvent
                        ? serializeReplayEventSnapshot(replayStatus.currentEvent)
                        : null,
                dataset_metrics: datasetMetrics ? {
                    wallets: datasetMetrics.wallets,
                    tokens: datasetMetrics.tokens,
                    transfers: datasetMetrics.transactions,
                    rows_processed: datasetMetrics.stagedRowsProcessed,
                    rows_received: datasetMetrics.stagedRowsReceived,
                    duplicate_transfer_rows_skipped: datasetMetrics.duplicateTransferRowsSkipped,
                    missing_wallet_rows_omitted: datasetMetrics.transferRowsOmittedMissingWallets,
                    preview_only: Boolean(datasetMetrics.previewOnly),
                    not_merged: Boolean(datasetMetrics.notMerged)
                } : null,
                render_result: graphRender ? {
                    rendered_nodes: graphRender.renderedNodes || 0,
                    rendered_edges: graphRender.renderedEdges || 0,
                    rendered_transfers: graphRender.renderedTransfers || 0,
                    capped: Boolean(graphRender.capped)
                } : null,
                preview_only: true,
                active_graph_unchanged: true
            },
            report_boundaries: {
                what_this_is: 'A point-in-time export of the current CryptoPhotonic UI state: Wallet Lookup graph readout, active filters, selected item, staged history status, and replay preview status.',
                what_this_is_not: 'Not a complete wallet history, identity finding, ownership finding, criminality or risk assessment, investment recommendation, or browser-side provider query.',
                safety_boundaries: [
                    'Wallet Lookup uses the secure Worker response and replacement graph behavior.',
                    'No browser-side provider calls are made by this export.',
                    'No API keys or secrets are included.',
                    'Staged history remains staged only and is not merged into the active graph.',
                    'Replay remains preview-only and does not change the active Wallet Lookup graph.',
                    'Address relationships are observations from visible transfer data only.'
                ]
            }
        };
    }

    function buildWalletInvestigationMarkdown(snapshot = {}) {
        const topCounterparty = snapshot.highlights?.top_counterparty;
        const topToken = snapshot.highlights?.top_token;
        const largestFlow = snapshot.highlights?.largest_flow;
        const selection = snapshot.selection || {};
        const lines = [
            'CryptoPhotonic Wallet Lookup Investigation Report',
            `Generated: ${formatReportDateTime(snapshot.generated_at)}`,
            '',
            'What this report is:',
            `- ${snapshot.report_boundaries?.what_this_is}`,
            '',
            'What this report is not:',
            `- ${snapshot.report_boundaries?.what_this_is_not}`,
            '',
            'Report boundaries:',
            ...(snapshot.report_boundaries?.safety_boundaries || []).map(item => `- ${item}`),
            '',
            'Lookup snapshot:',
            `- Mode/source: ${snapshot.mode?.label || '-'} / ${snapshot.mode?.source || '-'}`,
            `- Tracked wallet: ${snapshot.lookup?.tracked_wallet || 'No wallet loaded'}`,
            `- Last loaded time: ${snapshot.lookup?.last_loaded_display || 'Not loaded'}`,
            `- Lookup state: ${snapshot.status?.summary || '-'}`,
            `- Visible flows: ${snapshot.lookup?.visible_flows ?? 0}`,
            `- Filtered/noise removed count: ${snapshot.lookup?.filtered_noise_removed_count ?? 0}`,
            `- Top counterparty: ${topCounterparty ? formatCounterpartySnapshotMarkdown(topCounterparty) : 'None visible'}`,
            `- Top token: ${topToken ? formatTokenSnapshotMarkdown(topToken) : 'None visible'}`,
            `- Largest flow: ${largestFlow ? formatFlowSnapshotMarkdown(largestFlow) : 'None visible'}`,
            '',
            'Selected item:',
            ...formatSnapshotSelectionMarkdown(selection),
            '',
            'History status:',
            `- Provider: ${snapshot.history?.provider || '-'}`,
            `- Provider state: ${snapshot.history?.provider_state || '-'}`,
            `- Provider grade: ${snapshot.history?.provider_grade || '-'}`,
            `- Confidence: ${snapshot.history?.completeness_confidence ?? 0}%`,
            `- Replay coverage: ${snapshot.history?.replay_coverage_pct ?? 0}%`,
            `- Cache: ${snapshot.history?.cache || '-'}`,
            `- Status: ${snapshot.history?.status || '-'}`,
            `- Staged rows: ${snapshot.history?.staged_transaction_rows ?? 0}`,
            `- Pages loaded: ${snapshot.history?.pages_loaded ?? 0}`,
            `- Staged-only boundary: ${snapshot.history?.staged_only ? 'Yes' : 'Check'}`,
            '',
            'Replay preview status:',
            `- Status: ${snapshot.replay_preview?.status || '-'}`,
            `- Dataset built: ${snapshot.replay_preview?.preview_dataset_built ? 'Yes' : 'No'}`,
            `- Dataset stale: ${snapshot.replay_preview?.preview_dataset_stale ? 'Yes' : 'No'}`,
            `- Workspace mode: ${snapshot.replay_preview?.workspace_mode ? 'Open' : 'Closed'}`,
            `- Progress: ${snapshot.replay_preview?.current_step ?? 0}/${snapshot.replay_preview?.total_steps ?? 0}`,
            `- Preview-only boundary: ${snapshot.replay_preview?.preview_only ? 'Yes' : 'Check'}`,
            '',
            'Notes:',
            '- Counts reflect the current visible graph and active filters.',
            '- Program-like and infrastructure/noise legs may be removed before graphing.',
            '- Addresses are shown as graph observations only; labels are source/context hints, not identity or ownership conclusions.'
        ];

        return lines.join('\n');
    }

    function buildInvestigationSnapshotSelection(selectedFlow = null, selectedNode = null) {
        if (selectedFlow) {
            return {
                type: 'flow',
                present: true,
                flow: serializeFlowSnapshot(selectedFlow)
            };
        }
        if (selectedNode) {
            return {
                type: selectedNode.type || 'node',
                present: true,
                node: serializeNodeSnapshot(selectedNode)
            };
        }
        if (state.historyPreview.selectedEvent) {
            return {
                type: 'replay_preview_event',
                present: true,
                replay_event: serializeReplayEventSnapshot(state.historyPreview.selectedEvent)
            };
        }
        return {
            type: 'none',
            present: false,
            note: 'No node, flow, or replay preview event is selected.'
        };
    }

    function serializeCounterpartySnapshot(item = {}) {
        return {
            address: item.address || '',
            address_short: item.address ? shortLongValue(item.address) : '',
            visible_legs: item.count || 0,
            inbound_legs: item.inbound || 0,
            outbound_legs: item.outbound || 0,
            mixed_legs: item.mixed || 0,
            relationship: item.relationship || 'Wallet flow observed',
            tokens: Array.isArray(item.tokens) ? item.tokens : [],
            total_usd: Number(item.totalUsd) || 0,
            latest_timestamp: item.latestTimestamp ? safeDateIso(item.latestTimestamp) : null
        };
    }

    function serializeTokenSnapshot(item = {}) {
        return {
            symbol: item.symbol || 'Token',
            mint: item.mint || '',
            visible_legs: item.count || 0,
            inbound_legs: item.inbound || 0,
            outbound_legs: item.outbound || 0,
            mixed_legs: item.mixed || 0,
            direction_label: item.directionLabel || '',
            total_amount: item.amountAvailable ? Number(item.totalAmount) || 0 : null,
            amount_available: Boolean(item.amountAvailable),
            total_usd: Number(item.totalUsd) || 0
        };
    }

    function serializeFlowSnapshot(edge = {}) {
        const sourceAddress = getFlowSourceAddress(edge);
        const targetAddress = getFlowTargetAddress(edge);
        return {
            id: edge.id || '',
            source_wallet: sourceAddress || '',
            source_wallet_short: sourceAddress ? shortLongValue(sourceAddress) : '',
            destination_wallet: targetAddress || '',
            destination_wallet_short: targetAddress ? shortLongValue(targetAddress) : '',
            normalized_amount: getNormalizedFlowAmountDisplay(edge),
            amount: Number.isFinite(Number(edge.amount)) ? Number(edge.amount) : null,
            symbol: edge.symbol || '',
            token_mint: edge.token_mint || '',
            usd_value: Number(edge.usd_value) || 0,
            direction_vs_tracked: formatFlowDirectionRelativeToTracked(edge),
            transaction_type: edge.transaction_type_label || core.interpretTransactionType?.(edge.transaction_type).label || 'Unknown / Unclassified',
            timestamp: edge.timestamp ? safeDateIso(edge.timestamp) : null,
            transaction_hash: edge.transaction_hash || edge.signature || '',
            visible_under_filters: edgeMatchesActiveFilters(edge)
        };
    }

    function serializeNodeSnapshot(node = {}) {
        return {
            id: node.id || '',
            type: node.type || '',
            label: labelForNode(node),
            address: node.address || '',
            address_short: node.address ? shortLongValue(node.address) : '',
            token_mint: node.token_mint || '',
            token_mint_short: node.token_mint ? shortLongValue(node.token_mint) : '',
            symbol: node.symbol || '',
            chain: node.chain || '',
            relationship_to_tracked_wallet: node.type === core.NODE_TYPES.WALLET ? describeWalletRelationship(node) : '',
            visible_context_only: true
        };
    }

    function serializeReplayEventSnapshot(event = {}) {
        const sourceWallet = event.sourceWallet || event.source_wallet || '';
        const destinationWallet = event.destinationWallet || event.destination_wallet || '';
        return {
            step: Number(event.step) || 0,
            total_steps: Number(event.totalSteps) || 0,
            source_wallet: sourceWallet,
            source_wallet_short: sourceWallet ? shortLongValue(sourceWallet) : '',
            destination_wallet: destinationWallet,
            destination_wallet_short: destinationWallet ? shortLongValue(destinationWallet) : '',
            amount_token: getHistoryReplayAmountTokenLabel(event),
            direction: getHistoryReplayDirectionLabel(event.direction),
            timestamp: event.timestamp ? safeDateIso(event.timestamp) : null,
            signature: event.signature || event.transaction_hash || '',
            preview_only: true,
            active_graph_unchanged: true
        };
    }

    function formatCounterpartySnapshotMarkdown(item = {}) {
        const value = item.total_usd > 0 ? ` / ${core.formatUsd(item.total_usd)}` : '';
        const tokens = item.tokens?.length ? item.tokens.join(', ') : '-';
        return `${item.address || '-'} | ${item.visible_legs || 0} visible leg${item.visible_legs === 1 ? '' : 's'} | ${item.relationship || 'Wallet flow observed'} | tokens: ${tokens}${value}`;
    }

    function formatTokenSnapshotMarkdown(item = {}) {
        const amount = item.amount_available ? `${formatCompactNumber(item.total_amount)} ${item.symbol}` : 'amount unavailable';
        const value = item.total_usd > 0 ? ` / ${core.formatUsd(item.total_usd)}` : '';
        return `${item.symbol || 'Token'} | ${item.visible_legs || 0} visible leg${item.visible_legs === 1 ? '' : 's'} | ${item.inbound_legs || 0} received / ${item.outbound_legs || 0} sent / ${item.mixed_legs || 0} mixed | ${amount}${value}`;
    }

    function formatFlowSnapshotMarkdown(flow = {}) {
        const value = flow.usd_value > 0 ? ` / ${core.formatUsd(flow.usd_value)}` : '';
        return `${flow.normalized_amount || '-'} ${flow.symbol || ''}${value} | ${flow.direction_vs_tracked || '-'} | ${flow.source_wallet_short || '-'} -> ${flow.destination_wallet_short || '-'}`;
    }

    function formatSnapshotSelectionMarkdown(selection = {}) {
        if (!selection.present) return ['- No selected node, flow, or replay preview event.'];
        if (selection.flow) {
            const flow = selection.flow;
            return [
                '- Type: visible flow',
                `- Flow: ${formatFlowSnapshotMarkdown(flow)}`,
                `- Transaction type: ${flow.transaction_type || '-'}`,
                `- Timestamp: ${flow.timestamp || '-'}`,
                `- Transaction hash: ${flow.transaction_hash || '-'}`
            ];
        }
        if (selection.node) {
            const node = selection.node;
            return [
                `- Type: ${node.type || 'node'}`,
                `- Label: ${node.label || '-'}`,
                `- Address/token: ${node.address || node.token_mint || '-'}`,
                `- Relationship: ${node.relationship_to_tracked_wallet || 'Visible graph context only'}`
            ];
        }
        if (selection.replay_event) {
            const event = selection.replay_event;
            return [
                '- Type: replay preview event',
                `- Step: ${event.step || 0}/${event.total_steps || 0}`,
                `- Amount/token: ${event.amount_token || '-'}`,
                `- Direction: ${event.direction || '-'}`,
                `- Signature: ${event.signature || '-'}`
            ];
        }
        return ['- Selection unavailable.'];
    }

    function getWalletInvestigationSnapshotFilename(snapshot = {}) {
        const wallet = snapshot.lookup?.tracked_wallet_short || 'no-wallet';
        const timestamp = String(snapshot.generated_at || new Date().toISOString())
            .replaceAll(':', '')
            .replaceAll('.', '')
            .replace('T', '-')
            .replace('Z', 'Z');
        return `cryptophotonic-investigation-snapshot-${sanitizeFilenamePart(wallet)}-${sanitizeFilenamePart(timestamp)}.json`;
    }

    function sanitizeFilenamePart(value) {
        return String(value || 'snapshot')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'snapshot';
    }

    function safeDateIso(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
    }

    function getWalletReportStatusLine(intelligence, emptyState) {
        if (state.walletLookup.inFlight) return 'Wallet lookup is loading from the secure Worker.';
        if (emptyState?.title) return `${emptyState.title}: ${emptyState.body}`;
        if (!state.walletLookup.lastWallet && !state.walletLookup.lastLoadedAt) return 'No wallet loaded.';
        if (state.walletLookup.lastLoadedAt && intelligence.returnedEvents === 0) return 'Secure Worker response loaded with no recent sanitized activity.';
        if (intelligence.returnedEvents > 0 && intelligence.visibleLegs === 0) return 'Fully filtered activity state: returned activity has no visible transfer legs after filters/noise removal.';
        return 'Wallet lookup report is based on the current visible graph.';
    }

    function formatCounterpartyReportLines(counterparties = []) {
        const rows = counterparties.slice(0, 6).map((item, index) => `${index + 1}. ${formatCounterpartyReportLine(item)}`);
        return rows.length ? rows : ['- None visible'];
    }

    function formatCounterpartyReportLine(item = {}) {
        const tokens = Array.isArray(item.tokens) && item.tokens.length ? item.tokens.join(', ') : '-';
        const value = item.totalUsd > 0 ? ` / ${core.formatUsd(item.totalUsd)}` : '';
        return `${item.address || '-'} | ${item.count || 0} visible leg${item.count === 1 ? '' : 's'} | ${item.relationship || 'Wallet flow observed'} | tokens: ${tokens}${value}`;
    }

    function formatTokenReportLines(tokens = []) {
        const rows = tokens.slice(0, 6).map((item, index) => `${index + 1}. ${formatTokenReportLine(item)}`);
        return rows.length ? rows : ['- None visible'];
    }

    function formatTokenReportLine(item = {}) {
        const amount = item.amountAvailable ? `${formatCompactNumber(item.totalAmount)} ${item.symbol}` : 'amount unavailable';
        const value = item.totalUsd > 0 ? ` / ${core.formatUsd(item.totalUsd)}` : '';
        return `${item.symbol || 'Token'} | ${item.count || 0} visible leg${item.count === 1 ? '' : 's'} | ${item.inbound || 0} received / ${item.outbound || 0} sent / ${item.mixed || 0} mixed | ${amount}${value}`;
    }

    function formatSelectedFlowReportLines(edge) {
        if (!edge) return ['- No selected visible flow. Select a visible transfer leg to include inspector details.'];
        const sourceAddress = getFlowSourceAddress(edge);
        const targetAddress = getFlowTargetAddress(edge);
        const tokenLabel = edge.token_mint
            ? `${edge.symbol || 'Token'} / ${edge.token_mint}`
            : edge.symbol || 'Token';
        return [
            `- Source wallet: ${sourceAddress || '-'}`,
            `- Destination wallet: ${targetAddress || '-'}`,
            `- Normalized amount: ${getNormalizedFlowAmountDisplay(edge)}`,
            `- Token / mint: ${tokenLabel}`,
            `- Direction vs tracked wallet: ${formatFlowDirectionRelativeToTracked(edge)}`,
            `- Transaction type: ${edge.transaction_type_label || core.interpretTransactionType?.(edge.transaction_type).label || 'Unknown / Unclassified'}`,
            `- Timestamp: ${edge.timestamp ? formatReportDateTime(edge.timestamp) : '-'}`,
            `- Transaction hash: ${edge.transaction_hash || '-'}`
        ];
    }

    function buildSelectedFlowSummary(edge = {}) {
        if (!edge) return '';
        return formatSelectedFlowReportLines(edge)
            .concat([
                `- Source boundary: ${getCurrentSourceLabel()}`,
                '- Sanitized boundary: visible graph fields only; no browser provider calls.',
                '- Claims boundary: address-to-address observation only.'
            ])
            .join('\n');
    }

    function buildReplayEventSummary(event = {}) {
        const sourceWallet = event.sourceWallet || event.source_wallet || '';
        const destinationWallet = event.destinationWallet || event.destination_wallet || '';
        const signature = event.signature || event.transaction_hash || '';
        return [
            'CryptoPhotonic preview replay event',
            `- Step: ${event.step || '-'}${event.totalSteps ? ` / ${event.totalSteps}` : ''}`,
            `- Source wallet: ${sourceWallet || '-'}`,
            `- Destination wallet: ${destinationWallet || '-'}`,
            `- Amount/token: ${getHistoryReplayAmountTokenLabel(event)}`,
            `- Direction: ${getHistoryReplayDirectionLabel(event.direction)}`,
            `- Timestamp: ${event.timestamp ? formatPreviewTimestamp(event.timestamp) : '-'}`,
            `- Signature: ${signature || '-'}`,
            '- Source boundary: staged history preview dataset only.',
            '- Active graph unchanged; no merge behavior.'
        ].join('\n');
    }

    function formatReportDateTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
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
        const helper = namespace.investigationWorkspace?.renderDetailRow;
        if (helper) return helper(label, value, { ...options, shortener: shortLongValue });
        const rawValue = String(value ?? '-');
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
        if (context.selected || context.hovered || context.selectedFlowEndpoint) return true;

        const zoom = state.viewport.scale || 1;
        const density = state.labelDensity;
        const isMajor = node.label_priority === 'major';
        const connected = Boolean(context.connected);
        const focused = Boolean(context.interaction.hasFocus);
        const semantic = context.interaction.semanticZoom || state.semanticZoom || getCryptoSemanticZoomState();
        const topology = context.interaction.topologyModel || state.topologyModel || {};
        const topologyHub = Boolean(topology.hubNodeIds?.has(node.id));

        if (semantic.tier === 'macro') {
            return Boolean(isTrackedWalletNode(node) || topologyHub || (isHubNode(node) && connected) || (connected && isMajor));
        }

        if (semantic.tier === 'cluster') {
            if (isHubNode(node) || topologyHub) return true;
            if (node.type === core.NODE_TYPES.TOKEN) return isMajor || connected;
            return connected && isMajor || (!focused && isMajor && zoom >= 0.78);
        }

        if (state.dataMode === DATA_MODES.WALLET) {
            if (density === 'minimal') {
                if (isHubNode(node)) return connected && zoom >= 0.82;
                return connected && isMajor && zoom >= 0.95;
            }
            if (density === 'balanced') {
                if (isHubNode(node)) return zoom >= 0.72 || connected;
                if (node.type === core.NODE_TYPES.TOKEN) return (isMajor && zoom >= 0.72) || (connected && zoom >= 0.64);
                return isMajor && (!focused || connected) && zoom >= 0.68;
            }
            if (isHubNode(node) || node.type === core.NODE_TYPES.TOKEN) return zoom >= 0.58 || connected;
            return zoom >= 0.92 || (connected && isMajor);
        }

        if (isHubNode(node)) return density !== 'minimal' || connected || zoom >= 0.95;

        if (!focused) {
            if (density === 'minimal') return isMajor && zoom >= 0.92;
            if (density === 'detailed') return isMajor || zoom >= 1.1;
            return isMajor && zoom >= 0.72;
        }
        return connected && (isMajor || density === 'detailed');
    }

    function getMaxNodeLabelWidth(node = {}) {
        const width = state.graph?.bounds?.width || getCanvasSize().width;
        if (isTrackedWalletNode(node)) return Math.min(132, Math.max(96, width * 0.24));
        if (isHubNode(node)) return Math.min(150, Math.max(92, width * 0.25));
        if (node.type === core.NODE_TYPES.TOKEN) return 90;
        if (state.labelDensity === 'minimal') return 82;
        if (state.labelDensity === 'detailed') return 118;
        return 96;
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
        scheduleRender();
    }

    function updateHoverFromScreenPoint(screenPoint, options = {}) {
        if (!screenPoint || !state.canvas) return;
        const pointerType = options.pointerType || state.lastPointerType || 'mouse';
        if (pointerType === 'touch') {
            hideHoverOverlay();
            return;
        }
        const now = performance.now();
        const hitTarget = getHitTargetProfile(pointerType);
        if (!options.force && state.hoverPerf.lastPoint && now - state.hoverPerf.lastAt < hitTarget.hoverThrottleMs) {
            const drift = Math.hypot(screenPoint.x - state.hoverPerf.lastPoint.x, screenPoint.y - state.hoverPerf.lastPoint.y);
            if (drift < 4) return;
        }
        state.hoverPerf.lastAt = now;
        state.hoverPerf.lastPoint = { ...screenPoint };

        const worldPoint = screenToWorld(screenPoint);
        const hovered = getNodeAtWorldPoint(worldPoint, {
            pointerType,
            preferredId: state.hoveredId || state.selectedId
        });
        const hoveredFlow = hovered ? null : getFlowEdgeAtWorldPoint(worldPoint, {
            pointerType,
            preferredId: state.hoveredFlowId || state.selectedFlowId
        });
        const nextHoveredId = hovered?.id || null;
        const nextHoveredFlowId = hoveredFlow?.id || null;
        state.canvas.style.cursor = hovered ? 'grab' : hoveredFlow ? 'pointer' : 'grab';
        updateHoverOverlay(hovered, hoveredFlow, screenPoint);
        if (nextHoveredId === state.hoveredId && nextHoveredFlowId === state.hoveredFlowId) return;
        state.hoveredId = nextHoveredId;
        state.hoveredFlowId = nextHoveredFlowId;
        scheduleRender();
    }

    function registerQuickInspect(type, id, screenPoint, pointerType = state.lastPointerType) {
        if (pointerType === 'touch') return false;
        const now = performance.now();
        const previous = state.lastClick;
        state.lastClick = {
            type,
            id,
            at: now,
            screenPoint: screenPoint ? { ...screenPoint } : null
        };
        if (!previous || previous.type !== type || previous.id !== id || !previous.screenPoint || !screenPoint) return false;
        const closeEnough = Math.hypot(previous.screenPoint.x - screenPoint.x, previous.screenPoint.y - screenPoint.y) <= QUICK_INSPECT_DISTANCE;
        return closeEnough && now - previous.at <= QUICK_INSPECT_MS;
    }

    function setGraphInteractionMode(mode) {
        const wrapper = state.canvas?.parentElement;
        if (state.canvas) {
            state.canvas.style.cursor = mode ? 'grabbing' : state.hoveredFlowId ? 'pointer' : 'grab';
        }
        if (!wrapper) return;
        wrapper.classList.toggle('is-panning', mode === 'panning');
        wrapper.classList.toggle('is-dragging-node', mode === 'dragging-node');
        wrapper.classList.toggle('is-pinching', mode === 'pinching');
    }

    function createHoverOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'crypto-graph-hover-overlay';
        overlay.className = 'crypto-graph-hover-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        const parent = state.canvas?.parentElement;
        if (parent) parent.appendChild(overlay);
        return overlay;
    }

    function updateHoverOverlay(node, edge, screenPoint) {
        const overlay = state.hoverOverlay;
        if (!overlay || !state.canvas || state.drag || state.pinch) return;
        if (!node && !edge) {
            hideHoverOverlay();
            return;
        }
        const overlayKey = node ? `node:${node.id}` : `flow:${edge.id}`;
        if (state.hoverPerf.overlayKey !== overlayKey) {
            overlay.innerHTML = node ? renderNodeHoverOverlay(node) : renderFlowHoverOverlay(edge);
            state.hoverPerf.overlayKey = overlayKey;
        }
        overlay.setAttribute('aria-hidden', 'false');
        positionHoverOverlay(screenPoint);
        overlay.classList.add('is-visible');
    }

    function hideHoverOverlay() {
        const overlay = state.hoverOverlay;
        if (!overlay) return;
        overlay.classList.remove('is-visible');
        overlay.setAttribute('aria-hidden', 'true');
        state.hoverPerf.overlayKey = '';
    }

    function positionHoverOverlay(screenPoint) {
        const overlay = state.hoverOverlay;
        const parent = state.canvas?.parentElement;
        if (!overlay || !parent || !screenPoint) return;
        const padding = 10;
        const offset = 16;
        const parentWidth = parent.clientWidth || state.canvas.clientWidth || 320;
        const parentHeight = parent.clientHeight || state.canvas.clientHeight || 420;
        const width = overlay.offsetWidth || 210;
        const height = overlay.offsetHeight || 82;
        let left = screenPoint.x + offset;
        let top = screenPoint.y + offset;
        if (left + width + padding > parentWidth) left = screenPoint.x - width - offset;
        if (top + height + padding > parentHeight) top = screenPoint.y - height - offset;
        overlay.style.left = `${clamp(left, padding, Math.max(padding, parentWidth - width - padding))}px`;
        overlay.style.top = `${clamp(top, padding, Math.max(padding, parentHeight - height - padding))}px`;
    }

    function renderNodeHoverOverlay(node = {}) {
        const connections = state.interactionIndex?.neighborsByNode.get(node.id)?.size
            || state.interactionIndex?.edgesByNode.get(node.id)?.length
            || 0;
        const exposure = Number(node.exposure_usd || node.aggregate_value_usd) > 0
            ? ` / ${core.formatUsd(node.exposure_usd || node.aggregate_value_usd)}`
            : '';
        return `
            <div class="crypto-hover-kicker">${escapeHtml(getNodeRoleLabel(node))}</div>
            <div class="crypto-hover-title">${escapeHtml(shortLongValue(node.address || node.token_mint || labelForNode(node) || node.id))}</div>
            <div class="crypto-hover-meta">${escapeHtml(connections)} connection${connections === 1 ? '' : 's'}${escapeHtml(exposure)}</div>
        `;
    }

    function renderFlowHoverOverlay(edge = {}) {
        const source = state.graph?.nodeById.get(edge.source);
        const target = state.graph?.nodeById.get(edge.target);
        const direction = formatFlowDirectionRelativeToTracked(edge);
        const route = `${shortLongValue(getFlowSourceAddress(edge) || source?.id)} -> ${shortLongValue(getFlowTargetAddress(edge) || target?.id)}`;
        const value = Number(edge.usd_value) > 0 ? ` / ${core.formatUsd(edge.usd_value)}` : '';
        const kind = edge.transaction_type_label || edge.flow_role || 'Flow';
        return `
            <div class="crypto-hover-kicker">${escapeHtml(direction)}</div>
            <div class="crypto-hover-title">${escapeHtml(getNormalizedFlowAmountDisplay(edge))} ${escapeHtml(edge.symbol || '')}</div>
            <div class="crypto-hover-meta">${escapeHtml(kind)}${escapeHtml(value)} / ${escapeHtml(route)}</div>
        `;
    }

    function getNodeRoleLabel(node = {}) {
        if (node.type === core.NODE_TYPES.TOKEN) return 'Token';
        if (isTrackedWalletNode(node)) return 'Tracked wallet';
        if (isHubNode(node)) return 'Entity context';
        return state.dataMode === DATA_MODES.WALLET ? 'Counterparty wallet' : 'Wallet';
    }

    function getHitTargetProfile(pointerType = state.lastPointerType) {
        return pointerType === 'touch' ? TOUCH_HIT_TARGET : DESKTOP_HIT_TARGET;
    }

    function getNodeAtWorldPoint(point, options = {}) {
        if (!point) return null;
        const hitTarget = getHitTargetProfile(options.pointerType);
        const scale = state.viewport.scale || 1;
        return state.graph.nodes
            .slice()
            .map(node => {
                const stable = node.id === options.preferredId || node.id === state.selectedId;
                const radius = (node.radius || 18) + (hitTarget.nodeExtraPx + (stable ? hitTarget.stableExtraPx : 0)) / scale;
                return {
                    node,
                    stable,
                    radius,
                    distance: Math.hypot(node.x - point.x, node.y - point.y)
                };
            })
            .filter(item => item.distance <= item.radius)
            .sort((a, b) => Number(b.stable) - Number(a.stable)
                || (a.distance / Math.max(1, a.radius)) - (b.distance / Math.max(1, b.radius))
                || (b.node.radius || 0) - (a.node.radius || 0))[0]?.node || null;
    }

    function getFlowEdgeAtWorldPoint(point, options = {}) {
        if (!point || !state.graph) return null;
        const hitTarget = getHitTargetProfile(options.pointerType);
        const tolerance = Math.max(8, hitTarget.flowExtraPx / (state.viewport.scale || 1));
        return getVisibleFlowEdges()
            .slice()
            .sort((a, b) => (b.width || 0) - (a.width || 0) || (b.usd_value || 0) - (a.usd_value || 0))
            .map(edge => ({
                edge,
                stable: edge.id === options.preferredId || edge.id === state.selectedFlowId,
                distance: distanceToFlowEdge(point, edge, options)
            }))
            .filter(item => {
                const edgeTolerance = tolerance + (item.stable ? hitTarget.stableExtraPx / (state.viewport.scale || 1) : 0);
                return Number.isFinite(item.distance) && item.distance <= edgeTolerance;
            })
            .sort((a, b) => Number(b.stable) - Number(a.stable)
                || a.distance - b.distance
                || (b.edge.usd_value || 0) - (a.edge.usd_value || 0))[0]?.edge || null;
    }

    function distanceToFlowEdge(point, edge, options = {}) {
        const source = state.graph.nodeById.get(edge.source);
        const target = state.graph.nodeById.get(edge.target);
        if (!source || !target) return Number.POSITIVE_INFINITY;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const normal = { x: -dy / distance, y: dx / distance };
        const control = {
            x: (source.x + target.x) / 2 + normal.x * getEdgeBend(edge),
            y: (source.y + target.y) / 2 + normal.y * getEdgeBend(edge)
        };
        let minDistance = Number.POSITIVE_INFINITY;
        const steps = options.pointerType === 'touch' ? 24 : 18;
        for (let step = 0; step <= steps; step += 1) {
            const curvePoint = pointOnQuadratic(source, control, target, step / steps);
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
        state.historyPreview.selectedEvent = null;
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
        if (active) {
            applyDefaultLabelDensityForDataMode(state.dataMode);
            if (isMobileViewport() && state.mobileDrawerState === 'collapsed') {
                setMobileDrawerState('half', { skipRender: true });
            }
        }
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
        updateInteractionDock();
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
        const flowCount = state.graph.flowEdges?.length || 0;
        const graphScaleBoost = state.graph.nodes.length > 90 || flowCount > 160 ? 0.055 : state.graph.nodes.length > 48 || flowCount > 90 ? 0.032 : 0;
        const spreadBoost = directWallets.length > 12 ? 0.06 : directWallets.length > 7 ? 0.035 : 0;
        const radius = clamp(Math.min(width, height) * (0.31 + spreadBoost + graphScaleBoost), 150, 318);
        directWallets.forEach((node, index) => {
            const angle = directWallets.length === 1
                ? -Math.PI / 2
                : -Math.PI / 2 + (Math.PI * 2 * index) / directWallets.length;
            node.x = center.x + Math.cos(angle) * radius;
            node.y = center.y + Math.sin(angle) * radius * 0.82;
            node.label_priority = index < 12 ? 'major' : node.label_priority;
        });

        const tokenNodes = state.graph.tokenNodes || [];
        const tokenRadius = radius + (tokenNodes.length > 10 ? 142 : tokenNodes.length > 6 ? 124 : 102);
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

    function getInteractionState(visibleFlowEdges = getVisibleFlowEdges()) {
        const activeIds = new Set([state.selectedId, state.hoveredId].filter(Boolean));
        const connectedNodeIds = new Set(activeIds);
        const connectedEdgeIds = new Set();
        const index = state.interactionIndex;
        const visibleFlowById = new Map(visibleFlowEdges.map(edge => [edge.id, edge]));
        const selectedFlowEdge = state.selectedFlowId
            ? visibleFlowById.get(state.selectedFlowId)
            : null;
        const hoveredFlowEdge = state.hoveredFlowId
            ? visibleFlowById.get(state.hoveredFlowId)
            : null;
        const replayActiveFlowId = state.flowReplay.activeFlowId;
        const replayActiveEdge = replayActiveFlowId
            ? (state.graph.flowEdges || []).find(edge => edge.id === replayActiveFlowId)
            : null;
        const replayFocusActive = Boolean(replayActiveEdge && (state.flowReplay.playing || state.focusSelection || replayActiveFlowId !== state.selectedFlowId));
        const hasTokenIsolation = state.tokenIsolation !== 'all';
        const tokenIsolationEdgeIds = new Set();
        const tokenIsolationNodeIds = new Set();

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
        if (hoveredFlowEdge) {
            connectedEdgeIds.add(hoveredFlowEdge.id);
            connectedNodeIds.add(hoveredFlowEdge.source);
            connectedNodeIds.add(hoveredFlowEdge.target);
        }
        if (hasTokenIsolation) {
            visibleFlowEdges.forEach(edge => {
                if (!edgeMatchesTokenIsolation(edge)) return;
                tokenIsolationEdgeIds.add(edge.id);
                tokenIsolationNodeIds.add(edge.source);
                tokenIsolationNodeIds.add(edge.target);
                connectedEdgeIds.add(edge.id);
                connectedNodeIds.add(edge.source);
                connectedNodeIds.add(edge.target);
            });
        }

        return {
            activeIds,
            connectedNodeIds,
            connectedEdgeIds,
            tokenIsolationEdgeIds,
            tokenIsolationNodeIds,
            selectedFlowId: selectedFlowEdge?.id || null,
            hoveredFlowId: hoveredFlowEdge?.id || null,
            hasFocus: Boolean(replayActiveEdge)
                && replayFocusActive
                || hasTokenIsolation
                || (state.focusSelection && (Boolean(state.selectedId) || Boolean(selectedFlowEdge))),
            hasSelectionFocus: Boolean(state.focusSelection && (state.selectedId || selectedFlowEdge)),
            hasSelected: Boolean(state.selectedId || selectedFlowEdge),
            hasTokenIsolation,
            replayActiveFlowId,
            hasReplayFocus: replayFocusActive
        };
    }

    function getEdgeInteractionStyle(edge, interaction) {
        const baseOpacity = edge.opacity || 0.7;
        const baseWidth = edge.width || 1.4;
        const isFlow = edge.type === core.EDGE_TYPES.FLOW;
        const isSelectedFlow = interaction.selectedFlowId === edge.id;
        const isHoveredFlow = interaction.hoveredFlowId === edge.id;
        const isReplayActive = interaction.replayActiveFlowId === edge.id;
        const hasReplayFocus = interaction.hasReplayFocus;
        const tokenDimmed = interaction.hasTokenIsolation
            && isFlow
            && !interaction.tokenIsolationEdgeIds.has(edge.id);
        const ambientPulsed = isFlow
            && state.flowMotion.enabled
            && state.flowMotion.ambientEnabled
            && !hasReplayFocus
            && state.flowMotion.topFlowIds.has(edge.id)
            && (state.flowMotion.now || performance.now()) >= state.flowMotion.userInteractingUntil;
        const semantic = interaction.semanticZoom || state.semanticZoom || {};
        const topology = interaction.topologyModel || state.topologyModel || {};
        const priorityFlow = Boolean(topology.priorityFlowIds?.has(edge.id) || topology.exchangeFlowIds?.has(edge.id) || topology.funnelFlowIds?.has(edge.id));

        if (tokenDimmed) {
            return {
                opacity: 0.075,
                width: Math.max(0.55, baseWidth * 0.48),
                shadowBlur: 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 6,
                glowTrack: false,
                dimmed: true
            };
        }

        if (isSelectedFlow) {
            return {
                opacity: 1,
                width: baseWidth + 3.7,
                shadowBlur: 28,
                shadowColor: edge.color || '#67e8f9',
                arrowSize: 13,
                glowTrack: true,
                selected: true
            };
        }

        if (isReplayActive) {
            return {
                opacity: 1,
                width: baseWidth + 3,
                shadowBlur: 24,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 12,
                glowTrack: true
            };
        }

        if (hasReplayFocus && isFlow) {
            return {
                opacity: Math.max(0.1, baseOpacity * 0.42),
                width: Math.max(0.7, baseWidth * 0.72),
                shadowBlur: 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: 7,
                glowTrack: false
            };
        }

        if (!interaction.hasFocus) {
            const semanticDim = semantic.tierRank <= 1 && isFlow && !priorityFlow && !isHoveredFlow && !ambientPulsed;
            const topologyBoost = priorityFlow && isFlow && semantic.tierRank <= 1;
            return {
                opacity: isHoveredFlow
                    ? 1
                    : topologyBoost ? Math.max(0.72, baseOpacity)
                        : ambientPulsed ? Math.min(0.88, baseOpacity + 0.05)
                            : semanticDim ? Math.max(0.08, (semantic.weakFlowAlpha || 0.24) * baseOpacity)
                                : isFlow ? Math.max(0.38, baseOpacity * 0.76) : Math.max(0.24, baseOpacity * 0.55),
                width: isHoveredFlow
                    ? baseWidth + 2.4
                    : topologyBoost ? baseWidth + 1.1
                        : ambientPulsed ? baseWidth + 0.55
                            : semanticDim ? Math.max(0.5, baseWidth * (semantic.weakFlowWidthMultiplier || 0.6)) : baseWidth,
                shadowBlur: isHoveredFlow ? 16 : topologyBoost ? 12 : ambientPulsed ? 9 : edge.is_large_value ? 7 : 0,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: isHoveredFlow || topologyBoost ? 11 : 8,
                glowTrack: isHoveredFlow || topologyBoost
            };
        }

        const connected = interaction.connectedEdgeIds.has(edge.id);
        const isExposure = edge.type === core.EDGE_TYPES.EXPOSURE;
        const isLargeFlow = isFlow && edge.is_large_value;

        if (connected) {
            return {
                opacity: isFlow ? 1 : isExposure ? 0.56 : 0.34,
                width: baseWidth + (isFlow ? 2.7 : isExposure ? 0.45 : 0.1),
                shadowBlur: isFlow ? 19 : 6,
                shadowColor: edge.color || '#22d3ee',
                arrowSize: isFlow ? 11 : 8,
                glowTrack: isFlow
            };
        }

        return {
            opacity: isLargeFlow ? 0.26 : isFlow ? 0.09 : isExposure ? 0.1 : 0.06,
            width: isLargeFlow ? Math.max(baseWidth, 2.2) : Math.max(0.5, baseWidth * 0.56),
            shadowBlur: 0,
            shadowColor: edge.color || '#22d3ee',
            arrowSize: 6,
            glowTrack: false
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

    function updateInteractionDock() {
        const fullscreenButton = document.getElementById('crypto-dock-fullscreen');
        if (fullscreenButton) {
            fullscreenButton.setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
            fullscreenButton.classList.toggle('is-active', state.fullscreen);
            fullscreenButton.title = state.fullscreen
                ? 'Exit CryptoPhotonic fullscreen graph'
                : 'Open CryptoPhotonic fullscreen graph';
            const icon = fullscreenButton.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-expand', !state.fullscreen);
                icon.classList.toggle('fa-compress', state.fullscreen);
            }
            const label = fullscreenButton.querySelector('span');
            if (label) label.textContent = state.fullscreen ? 'Exit Fullscreen' : 'Fullscreen';
        }

        const focusButton = document.getElementById('crypto-dock-focus-selection');
        if (focusButton) {
            focusButton.classList.toggle('is-active', state.focusSelection);
            focusButton.setAttribute('aria-pressed', state.focusSelection ? 'true' : 'false');
            focusButton.title = state.focusSelection
                ? 'Focus Selection is on: selected nodes and flows isolate direct context.'
                : 'Focus Selection is off: show the full graph while keeping selections highlighted.';
            const label = focusButton.querySelector('span');
            if (label) label.textContent = state.focusSelection ? 'Focus On' : 'Focus Off';
        }

        const mobileFocusButton = document.getElementById('crypto-mobile-focus-selection');
        if (mobileFocusButton) {
            mobileFocusButton.classList.toggle('is-active', state.focusSelection);
            mobileFocusButton.setAttribute('aria-pressed', state.focusSelection ? 'true' : 'false');
            mobileFocusButton.title = state.focusSelection
                ? 'Focus Selection on: selected nodes and flows isolate direct context.'
                : 'Focus Selection off: keep the full graph visible.';
        }

        const mobileDetailsButton = document.getElementById('crypto-mobile-open-details');
        if (mobileDetailsButton) {
            const hasSelection = Boolean(state.selectedId || state.selectedFlowId || state.historyPreview.selectedEvent);
            mobileDetailsButton.classList.toggle('is-active', getInvestigationTab() === 'details' && hasSelection);
            mobileDetailsButton.disabled = !state.graph;
            mobileDetailsButton.classList.toggle('is-disabled', mobileDetailsButton.disabled);
            mobileDetailsButton.title = hasSelection
                ? 'Open full Details tab for the selected object.'
                : 'Open Details tab. Tap a node or flow to pin an object first.';
        }

        syncLabelDensityControls();

        const walletMode = state.dataMode === DATA_MODES.WALLET;
        const loadButton = document.getElementById('crypto-dock-load-activity');
        if (loadButton) {
            loadButton.classList.toggle('is-hidden', !walletMode);
            loadButton.disabled = !walletMode || state.walletLookup.inFlight;
            loadButton.classList.toggle('is-disabled', loadButton.disabled);
            loadButton.setAttribute('aria-disabled', loadButton.disabled ? 'true' : 'false');
            loadButton.title = state.walletLookup.inFlight
                ? 'Wallet activity is already loading.'
                : 'Load activity for the wallet address in Wallet Lookup mode.';
        }

        const replayWorkspaceButton = document.getElementById('crypto-dock-replay-workspace');
        if (replayWorkspaceButton) {
            replayWorkspaceButton.classList.toggle('is-active', state.historyPreview.workspaceMode);
            replayWorkspaceButton.setAttribute('aria-pressed', state.historyPreview.workspaceMode ? 'true' : 'false');
            replayWorkspaceButton.title = state.historyPreview.workspaceMode
                ? 'Exit Replay Workspace Mode and restore the active Wallet Lookup graph canvas.'
                : 'Open the large preview-only replay workspace. No history data is merged.';
            const icon = replayWorkspaceButton.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-clapperboard', !state.historyPreview.workspaceMode);
                icon.classList.toggle('fa-arrow-right-from-bracket', state.historyPreview.workspaceMode);
            }
            const label = replayWorkspaceButton.querySelector('span');
            if (label) label.textContent = state.historyPreview.workspaceMode ? 'Exit Replay' : 'Replay Mode';
        }

        const mobileReplayWorkspaceButton = document.getElementById('crypto-mobile-replay-workspace');
        if (mobileReplayWorkspaceButton) {
            const hasPreviewDataset = hasHistoryPreviewDataset();
            mobileReplayWorkspaceButton.classList.toggle('is-hidden', !hasPreviewDataset);
            mobileReplayWorkspaceButton.classList.toggle('is-active', state.historyPreview.workspaceMode);
            mobileReplayWorkspaceButton.setAttribute('aria-pressed', state.historyPreview.workspaceMode ? 'true' : 'false');
            mobileReplayWorkspaceButton.disabled = !hasPreviewDataset;
            mobileReplayWorkspaceButton.classList.toggle('is-disabled', mobileReplayWorkspaceButton.disabled);
            mobileReplayWorkspaceButton.title = state.historyPreview.workspaceMode
                ? 'Exit preview replay workspace.'
                : 'Open preview replay workspace. Active Wallet Lookup graph stays unchanged.';
            const icon = mobileReplayWorkspaceButton.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-clapperboard', !state.historyPreview.workspaceMode);
                icon.classList.toggle('fa-arrow-right-from-bracket', state.historyPreview.workspaceMode);
            }
        }

        const replayButton = document.getElementById('crypto-dock-replay-toggle');
        if (replayButton) {
            const status = getHistoryReplayStatus();
            const hasDataset = Boolean(state.historyPreview.dataset);
            const datasetStale = state.historyPreview.datasetMetrics
                && Number(state.historyPreview.datasetMetrics.stagedRowsReceived || 0) !== Number((state.history.loadedTransactions || []).length);
            const disabled = state.history.inFlight || Boolean(datasetStale);
            replayButton.classList.toggle('is-hidden', !hasDataset);
            replayButton.disabled = !hasDataset || disabled;
            replayButton.classList.toggle('is-disabled', replayButton.disabled);
            replayButton.classList.toggle('is-active', Boolean(status.playing));
            replayButton.setAttribute('aria-pressed', status.playing ? 'true' : 'false');
            replayButton.setAttribute('aria-disabled', replayButton.disabled ? 'true' : 'false');
            replayButton.title = datasetStale
                ? 'Rebuild Preview Dataset before replaying.'
                : status.playing
                    ? 'Pause the preview-only lifetime replay.'
                    : 'Start the preview-only lifetime replay.';
            const icon = replayButton.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-play', !status.playing);
                icon.classList.toggle('fa-pause', status.playing);
            }
            const label = replayButton.querySelector('span');
            if (label) label.textContent = status.playing ? 'Pause Replay' : 'Start Replay';
        }
    }

    function syncLabelDensityControls() {
        const mode = getLabelDensityMode();
        const buttons = [
            document.getElementById('crypto-dock-label-density'),
            document.getElementById('crypto-mobile-label-density-toggle')
        ].filter(Boolean);
        buttons.forEach(button => {
            button.classList.toggle('is-active', state.labelDensity !== 'balanced');
            button.setAttribute('aria-pressed', state.labelDensity !== 'balanced' ? 'true' : 'false');
            button.title = `Label Density: ${mode.label}. ${mode.title}`;
            button.setAttribute('aria-label', `Cycle graph label density. Current mode: ${mode.label}`);
            const icon = button.querySelector('i');
            if (icon) {
                Object.values(LABEL_DENSITY_MODES).forEach(item => icon.classList.remove(item.icon));
                icon.classList.add('fa-solid', mode.icon);
            }
            const label = button.querySelector('span');
            if (label) label.textContent = `Labels: ${mode.label}`;
        });
    }

    function loadWalletActivityFromDock() {
        if (state.dataMode !== DATA_MODES.WALLET) return false;
        const input = document.getElementById('crypto-wallet-lookup-input');
        const wallet = input?.value || state.walletLookup.walletInput || state.walletLookup.lastWallet || '';
        loadWalletActivity(wallet);
        return true;
    }

    async function toggleHistoryReplayFromDock() {
        if (!state.historyPreview.dataset) return false;
        const status = getHistoryReplayStatus();
        if (status.playing) {
            await pauseHistoryReplay();
        } else {
            await startHistoryReplay();
        }
        updateInteractionDock();
        return true;
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
        toggleFocusSelection,
        setLabelDensity,
        cycleLabelDensity,
        setTokenIsolation,
        playFlowReplay: () => setFlowReplayPlaying(true),
        pauseFlowReplay: () => setFlowReplayPlaying(false),
        toggleFlowReplay,
        stepFlowReplay,
        loadWalletActivityFromDock,
        toggleHistoryReplayFromDock,
        setReplayWorkspaceMode,
        toggleReplayWorkspaceMode,
        openReplayNeighborhood,
        openReplayLineage,
        jumpBackReplayLineage,
        cycleReplayFocus,
        stepReplayCorridor,
        isolateReplayFlowCorridor,
        focusReplayLiquidityConcentration,
        focusReplayConcentrationZone,
        focusReplayCluster,
        focusReplayBridgeWallet,
        focusReplayWalletCorridor,
        toggleReplayCorridorOverlay,
        toggleReplayContinuityView,
        setReplayNarrativesVisible,
        toggleReplayNarratives,
        applyCryptoAnalystPreset,
        centerCurrentReplayTransfer,
        nextReplayEvent,
        previousReplayEvent,
        updateInteractionDock,
        getCommandAvailability: getCryptoCommandAvailability,
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
