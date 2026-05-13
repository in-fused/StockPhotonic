(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const REPLAY_WORKSPACE_VERSION = 'd132_replay_workspace_ui_v1';

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

    function renderOverlay(context = {}) {
        const status = context.status || {};
        const hasDataset = Boolean(context.hasDataset);
        const stateInFlight = Boolean(context.stateInFlight);
        const totalSteps = Math.max(0, Number(context.totalSteps) || 0);
        const currentStep = Math.max(0, Math.min(totalSteps, Number(context.currentStep) || 0));
        const progressPct = Math.max(0, Math.min(100, Number(context.progressPct) || 0));
        const speed = context.speed || 'standard';
        const speedOptions = context.speedOptions || {};
        const startDisabled = Boolean(context.startDisabled);
        const scrubberDisabled = Boolean(context.scrubberDisabled);
        const windowStatus = context.windowStatus || {};
        const warnings = Array.isArray(context.warnings) ? context.warnings.slice(0, 3) : [];
        const metaItems = Array.isArray(context.metaItems) ? context.metaItems : [];

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
                    <div class="h-2 overflow-hidden rounded-full bg-white/10">
                        <div id="crypto-replay-workspace-progress-bar" class="h-full bg-fuchsia-300/78" style="width:${escapeAttr(progressPct)}%"></div>
                    </div>
                </div>
                <div class="crypto-replay-workspace-controls">
                    <button id="crypto-replay-workspace-prev" type="button" ${scrubberDisabled || currentStep <= 0 ? 'disabled' : ''}>Prev</button>
                    <button id="crypto-replay-workspace-next" type="button" ${scrubberDisabled || currentStep >= totalSteps ? 'disabled' : ''}>Next</button>
                    <button id="crypto-replay-workspace-window-prev" type="button" ${scrubberDisabled || Number(windowStatus.currentWindowIndex || 0) <= 1 ? 'disabled' : ''}>Prev Window</button>
                    <button id="crypto-replay-workspace-window-next" type="button" ${scrubberDisabled || (windowStatus.windowCount && Number(windowStatus.currentWindowIndex || 0) >= Number(windowStatus.windowCount || 0)) ? 'disabled' : ''}>Next Window</button>
                    <button id="crypto-replay-workspace-reset" type="button" ${!hasDataset ? 'disabled' : ''}>Reset</button>
                    ${Object.entries(speedOptions).map(([value, label]) => `
                        <button type="button" data-crypto-replay-workspace-speed="${escapeAttr(value)}" ${stateInFlight ? 'disabled' : ''} class="${value === speed ? 'is-primary' : ''}">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
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
        root.querySelector('#crypto-replay-workspace-exit')?.addEventListener('click', () => handlers.exit?.());
    }

    namespace.replayWorkspace = {
        version: REPLAY_WORKSPACE_VERSION,
        renderOverlay,
        renderMeta,
        bindOverlayControls
    };
})();
