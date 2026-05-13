(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const REPLAY_WORKSPACE_VERSION = 'd133_cinematic_replay_workspace_ui_v1';

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

    function buildReplayContext(context = {}) {
        const status = context.status || {};
        const events = normalizeReplayEvents(context);
        const totalSteps = Math.max(0, Number(context.totalSteps || status.totalSteps || events.length) || 0);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(context.currentStep ?? status.currentStep) || 0));
        const currentEvent = getCurrentEvent(status, events, currentStep);
        const bookmarks = Array.isArray(context.bookmarks) && context.bookmarks.length
            ? normalizeBookmarks(context.bookmarks, totalSteps)
            : deriveBookmarks({
                ...context,
                status,
                events,
                totalSteps
            });
        const majorNavigation = getMajorNavigation(bookmarks, currentStep, totalSteps);
        const eventSummary = summarizeReplayEvent(currentEvent, {
            status,
            totalSteps,
            confidence: context.confidence ?? status.completenessConfidence,
            warning: context.warning || status.warning || (Array.isArray(context.warnings) ? context.warnings[0] : '')
        });
        const oldestLabel = context.oldestLabel || getTimelineBoundaryLabel(events, 'oldest') || 'Oldest staged';
        const newestLabel = context.newestLabel || getTimelineBoundaryLabel(events, 'newest') || 'Newest staged';
        const progressPct = totalSteps ? Math.round((currentStep / totalSteps) * 100) : Math.max(0, Math.min(100, Number(context.progressPct) || 0));

        return {
            ...context,
            status,
            events,
            totalSteps,
            currentStep,
            progressPct,
            currentEvent,
            eventSummary,
            bookmarks,
            majorNavigation,
            oldestLabel,
            newestLabel
        };
    }

    function renderOverlay(rawContext = {}) {
        const context = buildReplayContext(rawContext);
        const status = context.status || {};
        const hasDataset = Boolean(context.hasDataset);
        const stateInFlight = Boolean(context.stateInFlight);
        const totalSteps = context.totalSteps;
        const currentStep = context.currentStep;
        const progressPct = context.progressPct;
        const speed = context.speed || 'standard';
        const speedOptions = context.speedOptions || {};
        const startDisabled = Boolean(context.startDisabled);
        const scrubberDisabled = Boolean(context.scrubberDisabled);
        const windowStatus = context.windowStatus || {};
        const warnings = Array.isArray(context.warnings) ? context.warnings.slice(0, 3) : [];
        const metaItems = Array.isArray(context.metaItems) ? context.metaItems : [];
        const bookmarks = context.bookmarks || [];
        const majorNavigation = context.majorNavigation || {};
        const eventSummary = context.eventSummary || {};
        const currentBookmarkStep = currentStep || 0;
        const nextMajorDisabled = scrubberDisabled || !majorNavigation.nextStep;
        const previousMajorDisabled = scrubberDisabled || !majorNavigation.previousStep;

        return `
            <div id="crypto-replay-workspace-stage" class="crypto-replay-workspace-panel crypto-replay-workspace-toolbar">
                <div class="crypto-replay-toolbar-main">
                    <div class="min-w-0">
                        <div class="text-[10px] font-mono tracking-[1.2px] text-fuchsia-100/78">REPLAY WORKSPACE MODE</div>
                        <div class="mt-1 text-sm font-display text-cyan-50/90">Preview replay only / not merged</div>
                        <div id="crypto-replay-workspace-status" class="mt-1 text-xs text-fuchsia-50/78 leading-relaxed">${escapeHtml(context.readinessCopy || '')}</div>
                    </div>
                    <div class="crypto-replay-workspace-actions">
                        <button id="crypto-replay-workspace-build" type="button" class="is-primary" ${stateInFlight ? 'disabled' : ''}>Build Dataset</button>
                        <button id="crypto-replay-workspace-show" type="button" ${!hasDataset || stateInFlight ? 'disabled' : ''}>Render Graph</button>
                        <button id="crypto-replay-workspace-start" type="button" ${startDisabled ? 'disabled' : ''}>${escapeHtml(status.playing ? 'Pause' : 'Play')}</button>
                        <button id="crypto-replay-workspace-exit" type="button">Exit</button>
                    </div>
                </div>
                <div class="crypto-replay-timeline-rail">
                    <div class="crypto-replay-workspace-time-labels">
                        <span>${escapeHtml(context.oldestLabel || 'Oldest staged')}</span>
                        <span id="crypto-replay-workspace-progress">${escapeHtml(`${currentStep}/${totalSteps}`)}</span>
                        <span>${escapeHtml(context.newestLabel || 'Newest staged')}</span>
                    </div>
                    <input id="crypto-replay-workspace-scrubber" type="range" min="0" max="${escapeAttr(totalSteps)}" step="1" value="${escapeAttr(currentStep)}" ${scrubberDisabled ? 'disabled' : ''} aria-label="Large replay workspace timeline" class="block min-h-10 w-full cursor-pointer accent-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-50" />
                    <div class="crypto-replay-timeline-track">
                        <div id="crypto-replay-workspace-progress-bar" class="h-full bg-fuchsia-300/78" style="width:${escapeAttr(progressPct)}%"></div>
                        <div class="crypto-replay-current-marker" style="left:${escapeAttr(progressPct)}%" aria-hidden="true"></div>
                    </div>
                    <div id="crypto-replay-workspace-current-summary" class="crypto-replay-current-summary">${escapeHtml(eventSummary.compact || 'No replay event selected yet.')}</div>
                </div>
                <div class="crypto-replay-workspace-controls">
                    <button id="crypto-replay-workspace-jump-start" type="button" ${scrubberDisabled || currentStep <= 0 ? 'disabled' : ''}>Start</button>
                    <button id="crypto-replay-workspace-prev-major" type="button" ${previousMajorDisabled ? 'disabled' : ''}>Prev Major</button>
                    <button id="crypto-replay-workspace-prev" type="button" ${scrubberDisabled || currentStep <= 0 ? 'disabled' : ''}>Prev</button>
                    <button id="crypto-replay-workspace-next" type="button" ${scrubberDisabled || currentStep >= totalSteps ? 'disabled' : ''}>Next</button>
                    <button id="crypto-replay-workspace-next-major" type="button" ${nextMajorDisabled ? 'disabled' : ''}>Next Major</button>
                    <button id="crypto-replay-workspace-jump-end" type="button" ${scrubberDisabled || currentStep >= totalSteps ? 'disabled' : ''}>End</button>
                    <button id="crypto-replay-workspace-window-prev" type="button" ${scrubberDisabled || Number(windowStatus.currentWindowIndex || 0) <= 1 ? 'disabled' : ''}>Prev Window</button>
                    <button id="crypto-replay-workspace-window-next" type="button" ${scrubberDisabled || (windowStatus.windowCount && Number(windowStatus.currentWindowIndex || 0) >= Number(windowStatus.windowCount || 0)) ? 'disabled' : ''}>Next Window</button>
                    <button id="crypto-replay-workspace-reset" type="button" ${!hasDataset ? 'disabled' : ''}>Reset</button>
                    ${Object.entries(speedOptions).map(([value, label]) => `
                        <button type="button" data-crypto-replay-workspace-speed="${escapeAttr(value)}" ${stateInFlight ? 'disabled' : ''} class="${value === speed ? 'is-primary' : ''}">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
                <div class="crypto-replay-bookmark-strip" aria-label="Replay bookmarks">
                    ${bookmarks.map(bookmark => renderBookmark(bookmark, currentBookmarkStep, scrubberDisabled)).join('') || '<div class="crypto-replay-bookmark-empty">Build replay steps to derive bookmarks.</div>'}
                </div>
            </div>
            <div class="crypto-replay-workspace-panel crypto-replay-workspace-event" id="crypto-replay-workspace-event-readout">
                ${renderCurrentEventReadout(eventSummary)}
            </div>
            <div class="crypto-replay-workspace-bottom">
                <div class="crypto-replay-workspace-panel crypto-replay-workspace-meta">
                    <div class="crypto-replay-meta-grid">
                        ${metaItems.map(item => renderMeta(item.label, item.value, item.options || {})).join('')}
                    </div>
                    <div class="mt-2 text-xs text-white/52 leading-relaxed">${escapeHtml(context.coverageDetail || '')} No identity, ownership, risk, criminality, or investment claims.</div>
                    ${warnings.length ? `<div class="mt-2 grid gap-1.5">${warnings.map(warning => `<div class="rounded-md border border-yellow-200/14 bg-yellow-300/8 px-2 py-1.5 text-yellow-50/74">${escapeHtml(warning)}</div>`).join('')}</div>` : ''}
                </div>
            </div>
        `;
    }

    function renderCurrentEventReadout(summary = {}) {
        return `
            <div class="crypto-replay-event-kicker">CURRENT EVENT</div>
            <div class="crypto-replay-event-title">${escapeHtml(summary.title || 'Replay ready')}</div>
            <div class="crypto-replay-event-route">${escapeHtml(summary.route || 'No transfer path selected')}</div>
            <div class="crypto-replay-event-grid">
                <div><span>Time</span><strong>${escapeHtml(summary.time || '-')}</strong></div>
                <div><span>Amount</span><strong>${escapeHtml(summary.amountToken || '-')}</strong></div>
                <div><span>Direction</span><strong>${escapeHtml(summary.direction || '-')}</strong></div>
                <div><span>Signature</span><strong>${escapeHtml(summary.signature || '-')}</strong></div>
            </div>
            <div class="crypto-replay-event-warning">${escapeHtml(summary.warning || 'Preview-only staged history. No identity, ownership, risk, criminality, or investment claims.')}</div>
        `;
    }

    function renderBookmark(bookmark = {}, currentStep = 0, timelineDisabled = false) {
        const disabled = timelineDisabled || bookmark.disabled || !bookmark.step;
        const active = !disabled && Number(bookmark.step) === Number(currentStep);
        const className = [
            'crypto-replay-bookmark',
            active ? 'is-active' : '',
            bookmark.tone ? `is-${bookmark.tone}` : ''
        ].filter(Boolean).join(' ');
        return `
            <button type="button"
                class="${escapeAttr(className)}"
                data-crypto-replay-bookmark-step="${escapeAttr(bookmark.step || 0)}"
                data-crypto-replay-bookmark-key="${escapeAttr(bookmark.key || '')}"
                title="${escapeAttr(bookmark.title || bookmark.reason || bookmark.label || '')}"
                ${disabled ? 'disabled' : ''}>
                <span>${escapeHtml(bookmark.label || 'Bookmark')}</span>
                <strong>${escapeHtml(bookmark.step ? `#${bookmark.step}` : '-')}</strong>
            </button>
        `;
    }

    function renderMeta(label, value, options = {}) {
        const id = options.id ? ` id="${escapeAttr(options.id)}"` : '';
        const valueClass = options.mono ? 'font-mono' : 'font-semibold';
        return `
            <div class="crypto-replay-meta-card rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-2">
                <div class="text-white/36">${escapeHtml(label)}</div>
                <div${id} class="mt-1 ${valueClass} text-cyan-50/82 break-words">${escapeHtml(String(value ?? '-') || '-')}</div>
            </div>
        `;
    }

    function bindOverlayControls(root, handlers = {}) {
        if (!root) return;
        root.querySelector('#crypto-replay-workspace-build')?.addEventListener('click', () => handlers.buildDataset?.());
        root.querySelector('#crypto-replay-workspace-show')?.addEventListener('click', () => handlers.showGraph?.());
        root.querySelector('#crypto-replay-workspace-start')?.addEventListener('click', () => handlers.togglePlay?.());
        root.querySelector('#crypto-replay-workspace-jump-start')?.addEventListener('click', () => handlers.jumpStart?.());
        root.querySelector('#crypto-replay-workspace-jump-end')?.addEventListener('click', () => handlers.jumpEnd?.());
        root.querySelector('#crypto-replay-workspace-prev-major')?.addEventListener('click', () => handlers.jumpMajor?.(-1));
        root.querySelector('#crypto-replay-workspace-next-major')?.addEventListener('click', () => handlers.jumpMajor?.(1));
        root.querySelector('#crypto-replay-workspace-prev')?.addEventListener('click', () => handlers.step?.(-1));
        root.querySelector('#crypto-replay-workspace-next')?.addEventListener('click', () => handlers.step?.(1));
        root.querySelector('#crypto-replay-workspace-reset')?.addEventListener('click', () => handlers.reset?.());
        root.querySelector('#crypto-replay-workspace-window-prev')?.addEventListener('click', () => handlers.jumpWindow?.(-1));
        root.querySelector('#crypto-replay-workspace-window-next')?.addEventListener('click', () => handlers.jumpWindow?.(1));
        root.querySelector('#crypto-replay-workspace-scrubber')?.addEventListener('input', event => {
            handlers.seek?.(Number(event.target.value) || 0);
        });
        root.querySelectorAll('[data-crypto-replay-workspace-speed]').forEach(button => {
            button.addEventListener('click', () => handlers.setSpeed?.(button.dataset.cryptoReplayWorkspaceSpeed || 'standard'));
        });
        root.querySelectorAll('[data-crypto-replay-bookmark-step]').forEach(button => {
            button.addEventListener('click', () => {
                handlers.jumpBookmark?.(
                    Number(button.dataset.cryptoReplayBookmarkStep) || 0,
                    button.dataset.cryptoReplayBookmarkKey || ''
                );
            });
        });
        root.querySelector('#crypto-replay-workspace-exit')?.addEventListener('click', () => handlers.exit?.());
    }

    function normalizeReplayEvents(context = {}) {
        const status = context.status || {};
        const source = Array.isArray(context.events) && context.events.length
            ? context.events
            : Array.isArray(status.eventSummaries) && status.eventSummaries.length
                ? status.eventSummaries
                : buildEventsFromDataset(context.dataset, context.limits);
        return source
            .map((event, index) => normalizeEvent(event, index))
            .sort((a, b) => {
                if (a.timestampMs || b.timestampMs) return (a.timestampMs || Number.MAX_SAFE_INTEGER) - (b.timestampMs || Number.MAX_SAFE_INTEGER) || a.step - b.step;
                return a.step - b.step;
            })
            .map((event, index) => ({ ...event, step: index + 1 }));
    }

    function buildEventsFromDataset(dataset = {}, limits = {}) {
        const max = Math.max(1, Number(limits.maxTransactions || limits.maxPreviewTransactions || 260) || 260);
        return (Array.isArray(dataset?.transactions) ? dataset.transactions : [])
            .slice(0, max)
            .map((transaction, index) => ({
                step: index + 1,
                timestamp: transaction.timestamp || '',
                signature: transaction.transaction_hash || transaction.signature || '',
                amount: transaction.amount || 0,
                amountDisplay: transaction.amount_display || transaction.amountDisplay || '',
                token: transaction.symbol || transaction.token_mint || '',
                direction: transaction.direction || transaction.metadata?.direction || '',
                sourceWallet: transaction.source_wallet || '',
                destinationWallet: transaction.destination_wallet || '',
                warning: transaction.warning || transaction.metadata?.warning || ''
            }));
    }

    function normalizeEvent(event = {}, index = 0) {
        const timestamp = event.timestamp || event.time || '';
        const amountDisplay = event.amountDisplay || event.amount_display || '';
        const amount = Number(event.amount);
        const normalized = {
            ...event,
            step: Math.max(1, Number(event.step) || index + 1),
            timestamp,
            timestampMs: getTimestampMs(timestamp),
            signature: event.signature || event.transaction_hash || '',
            amount: Number.isFinite(amount) ? amount : 0,
            amountDisplay,
            amountValue: getAmountValue(event),
            token: event.token || event.symbol || event.token_mint || '',
            direction: event.direction || '',
            sourceWallet: event.sourceWallet || event.source_wallet || '',
            destinationWallet: event.destinationWallet || event.destination_wallet || '',
            warning: event.warning || event.confidenceWarning || ''
        };
        normalized.amountToken = formatAmountToken(normalized);
        normalized.route = formatRoute(normalized);
        normalized.signatureShort = shortValue(normalized.signature);
        return normalized;
    }

    function deriveBookmarks(context = {}) {
        const events = Array.isArray(context.events) ? context.events : [];
        const totalSteps = Math.max(0, Number(context.totalSteps || events.length) || 0);
        const summary = context.summary || {};
        const windowStatus = context.windowStatus || {};
        const warnings = Array.isArray(context.warnings) ? context.warnings : [];
        const bookmarks = [];
        const add = (key, label, event, reason = '', tone = '') => {
            const step = Math.max(0, Math.min(totalSteps || events.length, Number(event?.step) || 0));
            bookmarks.push({
                key,
                label,
                step,
                title: reason || (event ? getEventTitle(event) : `${label} is not available in staged replay data.`),
                reason,
                disabled: !event || !step,
                tone
            });
        };

        const firstObserved = getTimelineEvent(events, 'earliest') || events[0] || null;
        add('first-observed', 'First Flow', firstObserved, firstObserved ? getEventTitle(firstObserved) : '', 'anchor');

        const latestObserved = getTimelineEvent(events, 'latest') || events[events.length - 1] || null;
        add('latest-observed', 'Latest Flow', latestObserved, latestObserved ? getEventTitle(latestObserved) : '', 'anchor');

        const largestSol = getLargestEvent(events.filter(event => isSolToken(event.token)));
        add('largest-sol-flow', 'Largest SOL', largestSol, largestSol ? getEventTitle(largestSol) : '', 'value');

        const largestToken = getLargestEvent(events.filter(event => !isSolToken(event.token)));
        add('largest-token-flow', 'Largest Token', largestToken, largestToken ? getEventTitle(largestToken) : '', 'value');

        const repeatedCounterparty = getRepeatedCounterpartyEvent(events, summary.trackedWallet || context.dataset?.metadata?.wallet || context.dataset?.metadata?.tracked_wallet || '');
        add(
            'repeated-counterparty',
            'Repeated Wallet',
            repeatedCounterparty,
            repeatedCounterparty?.counterparty
                ? `${repeatedCounterparty.counterpartyCount || 0} staged replay events involving ${repeatedCounterparty.counterparty}. Address observation only.`
                : '',
            'activity'
        );

        const tokenChange = getTokenChangeEvent(events);
        add('token-change', 'Token Change', tokenChange, tokenChange ? getEventTitle(tokenChange) : '', 'token');

        const gapEvent = warnings.length || windowStatus.partial || windowStatus.oldestFirstRequired
            ? events.find(event => Number(event.step) >= Number(windowStatus.windowStart || 1)) || firstObserved
            : null;
        add(
            'gap-boundary',
            'Gap Boundary',
            gapEvent,
            warnings[0] || (windowStatus.partial ? 'Partial staged replay window. More history may exist outside loaded pages.' : ''),
            'warning'
        );

        return normalizeBookmarks(bookmarks, totalSteps).slice(0, 9);
    }

    function normalizeBookmarks(bookmarks = [], totalSteps = 0) {
        return bookmarks
            .map((bookmark, index) => ({
                key: bookmark.key || `bookmark-${index}`,
                label: bookmark.label || 'Bookmark',
                step: Math.max(0, Math.min(totalSteps || Number.MAX_SAFE_INTEGER, Number(bookmark.step) || 0)),
                title: bookmark.title || bookmark.reason || '',
                reason: bookmark.reason || '',
                tone: bookmark.tone || '',
                disabled: Boolean(bookmark.disabled || !bookmark.step)
            }))
            .filter((bookmark, index, list) => list.findIndex(item => item.key === bookmark.key) === index);
    }

    function summarizeReplayEvent(event = null, options = {}) {
        const status = options.status || {};
        const step = Math.max(0, Number(event?.step || status.currentStep) || 0);
        const total = Math.max(0, Number(options.totalSteps || status.totalSteps) || 0);
        const direction = formatDirectionLabel(event?.direction || status.direction || '');
        const amountToken = formatAmountToken(event || status);
        const route = formatRoute(event || status);
        const signature = shortValue(event?.signature || status.signature || '');
        const time = formatTimestamp(event?.timestamp || status.timestamp || '');
        const confidence = Number(options.confidence);
        const warning = event?.warning
            || options.warning
            || (Number.isFinite(confidence) ? `Completeness confidence ${Math.max(0, Math.min(100, Math.round(confidence)))}%. Preview-only staged data.` : '');
        return {
            step,
            totalSteps: total,
            title: step ? `Step ${step}${total ? ` of ${total}` : ''}` : 'Replay ready',
            time: time || 'No timestamp',
            amountToken,
            direction,
            route,
            signature: signature || 'No signature',
            warning,
            compact: step
                ? `Step ${step}/${total || '-'} / ${time || 'No timestamp'} / ${amountToken} / ${signature || 'No signature'}`
                : 'No replay event selected yet.'
        };
    }

    function getCurrentEvent(status = {}, events = [], currentStep = Number(status.currentStep) || 0) {
        if (!currentStep) return null;
        const currentEvent = status.currentEvent ? normalizeEvent(status.currentEvent, currentStep - 1) : null;
        if (currentEvent?.step) return { ...currentEvent, step: currentStep };
        return events.find(event => Number(event.step) === Number(currentStep)) || null;
    }

    function getMajorNavigation(bookmarks = [], currentStep = 0, totalSteps = 0) {
        const steps = [...new Set(
            bookmarks
                .filter(bookmark => !bookmark.disabled && bookmark.step)
                .map(bookmark => Number(bookmark.step) || 0)
                .filter(step => step > 0 && (!totalSteps || step <= totalSteps))
        )].sort((a, b) => a - b);
        return {
            previousStep: steps.filter(step => step < currentStep).pop() || 0,
            nextStep: steps.find(step => step > currentStep) || 0,
            steps
        };
    }

    function getTimelineBoundaryLabel(events = [], mode = 'oldest') {
        const event = getTimelineEvent(events, mode === 'newest' ? 'latest' : 'earliest');
        return event?.timestamp ? formatTimestamp(event.timestamp) : '';
    }

    function getTimelineEvent(events = [], mode = 'earliest') {
        const timestamped = events.filter(event => event.timestampMs);
        if (!timestamped.length) return null;
        return timestamped.slice().sort((a, b) => mode === 'latest'
            ? b.timestampMs - a.timestampMs || b.step - a.step
            : a.timestampMs - b.timestampMs || a.step - b.step)[0] || null;
    }

    function getLargestEvent(events = []) {
        return events
            .filter(event => Number.isFinite(event.amountValue) && event.amountValue > 0)
            .slice()
            .sort((a, b) => b.amountValue - a.amountValue || (a.timestampMs || 0) - (b.timestampMs || 0))[0] || null;
    }

    function getRepeatedCounterpartyEvent(events = [], trackedWallet = '') {
        const tracked = normalizeAddress(trackedWallet);
        const counts = new Map();
        events.forEach(event => {
            [event.sourceWallet, event.destinationWallet].forEach(address => {
                const normalized = normalizeAddress(address);
                if (!normalized || (tracked && normalized === tracked)) return;
                const record = counts.get(normalized) || { address: normalized, count: 0, firstStep: event.step };
                record.count += 1;
                record.firstStep = Math.min(record.firstStep, event.step);
                counts.set(normalized, record);
            });
        });
        const counterparty = [...counts.values()]
            .filter(item => item.count > 1)
            .sort((a, b) => b.count - a.count || a.firstStep - b.firstStep || a.address.localeCompare(b.address))[0];
        if (!counterparty) return null;
        const event = events.find(item => item.sourceWallet === counterparty.address || item.destinationWallet === counterparty.address) || null;
        return event ? { ...event, counterparty: counterparty.address, counterpartyCount: counterparty.count } : null;
    }

    function getTokenChangeEvent(events = []) {
        let previousToken = '';
        for (const event of events) {
            const token = normalizeToken(event.token);
            if (!token) continue;
            if (previousToken && token !== previousToken) return event;
            previousToken = token;
        }
        return null;
    }

    function getEventTitle(event = {}) {
        return [
            `Step ${event.step || 0}`,
            formatTimestamp(event.timestamp),
            formatAmountToken(event),
            formatDirectionLabel(event.direction),
            event.signature ? shortValue(event.signature) : ''
        ].filter(Boolean).join(' / ');
    }

    function formatAmountToken(event = {}) {
        const amount = String(event.amountDisplay || event.amount_display || '').trim()
            || (Number(event.amount) ? String(event.amount) : '');
        const token = String(event.token || event.symbol || event.token_mint || '').trim();
        if (amount && token && !amount.toLowerCase().includes(token.toLowerCase())) return `${amount} ${token}`;
        return amount || token || 'No amount/token';
    }

    function formatDirectionLabel(direction = '') {
        const text = String(direction || '').trim();
        if (!text) return 'No direction';
        return text.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function formatRoute(event = {}) {
        const source = event.sourceWallet || event.source_wallet || '';
        const destination = event.destinationWallet || event.destination_wallet || '';
        if (!source && !destination) return 'No current transfer path';
        return `${source ? shortValue(source) : 'source unknown'} -> ${destination ? shortValue(destination) : 'destination unknown'}`;
    }

    function formatTimestamp(value = '') {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || '');
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function getAmountValue(event = {}) {
        const amount = Number(event.amount);
        if (Number.isFinite(amount) && amount > 0) return Math.abs(amount);
        const displayNumber = Number(String(event.amountDisplay || event.amount_display || '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(displayNumber) ? Math.abs(displayNumber) : 0;
    }

    function getTimestampMs(value = '') {
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeAddress(value = '') {
        return String(value || '').trim();
    }

    function normalizeToken(value = '') {
        return String(value || '').trim().toUpperCase();
    }

    function isSolToken(value = '') {
        const token = normalizeToken(value);
        return token === 'SOL' || token === 'WSOL' || token.includes('SOLANA');
    }

    function shortValue(value) {
        const text = String(value || '');
        if (text.length <= 14) return text;
        return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    namespace.replayWorkspace = {
        version: REPLAY_WORKSPACE_VERSION,
        buildReplayContext,
        normalizeReplayEvents,
        deriveBookmarks,
        summarizeReplayEvent,
        formatAmountToken,
        formatDirectionLabel,
        formatRoute,
        renderOverlay,
        renderMeta,
        bindOverlayControls
    };
})();
