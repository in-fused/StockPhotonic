(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const REPLAY_WORKSPACE_VERSION = 'd136_gap_mapping_counterparty_expansion_workspace_ui_v1';
    const REPLAY_CHECKPOINT_VERSION = 'd135_replay_audit_checkpoint_v1';
    const REPLAY_GAP_MAP_VERSION = 'd136_replay_gap_map_v1';
    const REPLAY_CONTINUITY_VERSION = 'd136_staged_continuity_confidence_v1';
    const REPLAY_CLUSTER_VERSION = 'd136_replay_cluster_v1';
    const REPLAY_NEIGHBORHOOD_VERSION = 'd136_replay_neighborhood_v1';
    const DEFAULT_AUDIT_FILTERS = Object.freeze({
        token: 'all',
        direction: 'all',
        counterparty: 'all',
        majorOnly: false
    });
    const REPLAY_EXPANSION_CAPS = Object.freeze({
        maxGapMarkers: 10,
        maxGaps: 12,
        maxNeighborhoodEvents: 18,
        maxNeighborhoodWallets: 12,
        maxClusters: 8,
        maxClusterMembers: 18,
        maxRouteClusters: 5,
        maxTokenClusters: 5,
        maxCounterpartyClusters: 6
    });

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
        const auditFilters = normalizeAuditFilters(context.auditFilters || context.filters);
        const selectedEvent = normalizeSelectedEvent(context.selectedEvent, currentEvent, events);
        const filterOptions = getReplayFilterOptions(events);
        const filteredEvents = filterReplayEvents(events, auditFilters);
        const relationships = deriveReplayRelationships(selectedEvent || currentEvent, events);
        const breadcrumbs = normalizeAuditBreadcrumbs(context.breadcrumbs || context.auditBreadcrumbs);
        const recentEvents = normalizeRecentEvents(context.recentEvents || context.auditRecentEvents, events);
        const windowStatus = normalizeReplayWindowStatus(context.windowStatus || context.replayWindow || context.dataset?.metadata?.replay_window || {});
        const gapMap = deriveReplayGapMap({
            ...context,
            events,
            status,
            windowStatus
        });
        const continuityProfile = deriveReplayContinuityProfile({
            ...context,
            status,
            windowStatus
        }, gapMap);
        const checkpoint = normalizeReplayCheckpoint(context.checkpoint || context.auditCheckpoint || null);
        const clusters = deriveReplayClusters(events, {
            trackedWallet: context.summary?.trackedWallet || context.dataset?.metadata?.wallet || context.dataset?.metadata?.tracked_wallet || '',
            selectedEvent
        });
        const neighborhood = deriveReplayNeighborhood(selectedEvent || currentEvent, events, {
            focus: context.neighborhoodFocus || context.audit?.neighborhood || context.neighborhood || null,
            clusters
        });
        const routeComparison = deriveReplayRouteComparison(currentEvent, selectedEvent, events);
        const eventSummary = summarizeReplayEvent(selectedEvent || currentEvent, {
            status,
            totalSteps,
            confidence: continuityProfile.score ?? context.confidence ?? status.completenessConfidence,
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
            selectedEvent,
            auditFilters,
            filterOptions,
            filteredEvents,
            relationships,
            breadcrumbs,
            recentEvents,
            windowStatus,
            gapMap,
            continuityProfile,
            clusters,
            neighborhood,
            routeComparison,
            checkpoint,
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
        const checkpoint = context.checkpoint || null;
        const warnings = Array.isArray(context.warnings) ? context.warnings.slice(0, 3) : [];
        const metaItems = Array.isArray(context.metaItems) ? context.metaItems : [];
        const bookmarks = context.bookmarks || [];
        const majorNavigation = context.majorNavigation || {};
        const eventSummary = context.eventSummary || {};
        const selectedEvent = context.selectedEvent || context.currentEvent || null;
        const relationships = context.relationships || {};
        const gapMap = context.gapMap || {};
        const continuityProfile = context.continuityProfile || {};
        const neighborhood = context.neighborhood || {};
        const clusters = context.clusters || {};
        const filterOptions = context.filterOptions || getReplayFilterOptions(context.events || []);
        const filteredEvents = context.filteredEvents || [];
        const breadcrumbs = context.breadcrumbs || [];
        const recentEvents = context.recentEvents || [];
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
                        ${renderReplayTimelineGapMarkers(gapMap, totalSteps)}
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
                    <button id="crypto-replay-workspace-window-prev" type="button" ${scrubberDisabled || !windowStatus.canContinueNewer ? 'disabled' : ''}>Continue Newer</button>
                    <button id="crypto-replay-workspace-window-next" type="button" ${scrubberDisabled || (!windowStatus.canContinueOlder && !windowStatus.olderRequiresProviderPage) ? 'disabled' : ''}>Continue Older</button>
                    <button id="crypto-replay-workspace-boundary-oldest" type="button" ${scrubberDisabled || !totalSteps ? 'disabled' : ''}>Window Start</button>
                    <button id="crypto-replay-workspace-boundary-newest" type="button" ${scrubberDisabled || !totalSteps ? 'disabled' : ''}>Window End</button>
                    <button id="crypto-replay-workspace-reset" type="button" ${!hasDataset ? 'disabled' : ''}>Reset</button>
                    <button id="crypto-replay-workspace-checkpoint-save" type="button" ${!hasDataset || !totalSteps ? 'disabled' : ''}>Save Checkpoint</button>
                    <button id="crypto-replay-workspace-checkpoint-resume" type="button" ${!checkpoint ? 'disabled' : ''}>Resume Checkpoint</button>
                    ${Object.entries(speedOptions).map(([value, label]) => `
                        <button type="button" data-crypto-replay-workspace-speed="${escapeAttr(value)}" ${stateInFlight ? 'disabled' : ''} class="${value === speed ? 'is-primary' : ''}">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
                ${renderReplayWindowOverview(windowStatus, checkpoint, warnings)}
                ${renderReplayContinuityPanel(continuityProfile, gapMap)}
                <div class="crypto-replay-bookmark-strip" aria-label="Replay bookmarks">
                    ${bookmarks.map(bookmark => renderBookmark(bookmark, currentBookmarkStep, scrubberDisabled)).join('') || '<div class="crypto-replay-bookmark-empty">Build replay steps to derive bookmarks.</div>'}
                </div>
                ${renderAuditFilters(context.auditFilters, filterOptions, filteredEvents.length, totalSteps, scrubberDisabled)}
                ${renderAuditBreadcrumbs(breadcrumbs, recentEvents)}
            </div>
            <div class="crypto-replay-workspace-panel crypto-replay-workspace-event crypto-replay-audit-panel" id="crypto-replay-workspace-event-readout">
                ${renderCurrentEventReadout(eventSummary)}
                ${renderTransferDrilldown(selectedEvent, {
                    totalSteps,
                    windowStatus,
                    providerState: context.providerState || '',
                    providerGrade: context.providerGrade || '',
                    confidence: continuityProfile.score ?? context.confidence ?? status.completenessConfidence,
                    continuityProfile,
                    gapMap,
                    warnings
                })}
                ${renderReplayAuditActions(selectedEvent, relationships, scrubberDisabled, { checkpoint })}
                ${renderReplayNeighborhoodPanel(neighborhood, clusters, scrubberDisabled)}
                ${renderReplayRouteComparisonPanel(context.routeComparison)}
                ${renderReplayClusterPanel(clusters, scrubberDisabled)}
                ${renderRelatedTransferExploration(relationships)}
                ${renderFilteredEventStrip(filteredEvents, selectedEvent, scrubberDisabled)}
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

    function renderReplayWindowOverview(windowStatus = {}, checkpoint = null, warnings = []) {
        const segments = Array.isArray(windowStatus.timelineSegments) ? windowStatus.timelineSegments : [];
        const windowCount = Math.max(0, Number(windowStatus.windowCount || windowStatus.totalWindows) || 0);
        const currentIndex = Math.max(0, Number(windowStatus.currentWindowIndex || windowStatus.windowIndex) || 0);
        const label = windowStatus.windowLabel || (currentIndex ? `Replay window ${currentIndex}/${windowCount || currentIndex}` : 'Replay window pending');
        const continuityWarnings = [
            windowStatus.continuityWarning,
            windowStatus.partial ? 'Partial staged segment. History outside loaded replay windows may exist.' : '',
            windowStatus.oldestFirstRequired ? 'Oldest-first replay is not proven for this staged range.' : '',
            ...(Array.isArray(warnings) ? warnings : [])
        ].filter(Boolean).slice(0, 3);
        const checkpointCopy = checkpoint
            ? `Checkpoint ${checkpoint.selectedStep || checkpoint.currentStep || 0}/${checkpoint.totalSteps || '-'} / window ${checkpoint.windowIndex || '-'}`
            : 'No checkpoint saved';
        return `
            <section class="crypto-replay-window-overview" aria-label="Replay window continuity">
                <div class="crypto-replay-window-header">
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(windowStatus.rangePositionLabel || formatWindowRangePosition(windowStatus.rangePosition))}</strong>
                </div>
                <div class="crypto-replay-window-strip" aria-hidden="true">
                    ${renderReplayWindowSegments(windowCount, currentIndex)}
                </div>
                <div class="crypto-replay-window-facts">
                    <span>${escapeHtml(formatWindowOrdinalRange(windowStatus))}</span>
                    <span>${escapeHtml(checkpointCopy)}</span>
                </div>
                ${segments.length ? `
                    <div class="crypto-replay-window-segments">
                        ${segments.slice(0, 4).map(segment => {
                            const segmentLabel = getWindowSegmentLabel(segment);
                            return `<span title="${escapeAttr(getWindowSegmentTitle(segment))}">${escapeHtml(segmentLabel)}</span>`;
                        }).join('')}
                    </div>
                ` : ''}
                ${continuityWarnings.length ? `
                    <div class="crypto-replay-continuity-warnings">
                        ${continuityWarnings.map(warning => `<span>${escapeHtml(warning)}</span>`).join('')}
                    </div>
                ` : ''}
            </section>
        `;
    }

    function renderReplayWindowSegments(windowCount = 0, currentIndex = 0) {
        const count = Math.max(1, Math.min(12, Number(windowCount) || 1));
        if (count <= 1) {
            return '<span class="crypto-replay-window-segment is-active"></span>';
        }
        return Array.from({ length: count }, (_, index) => {
            const approxIndex = Math.max(1, Math.round(((index + 1) / count) * windowCount));
            const active = currentIndex && approxIndex === currentIndex;
            const edge = index === 0 || index === count - 1;
            return `<span class="crypto-replay-window-segment ${active ? 'is-active' : ''} ${edge ? 'is-boundary' : ''}"></span>`;
        }).join('');
    }

    function renderReplayTimelineGapMarkers(gapMap = {}, totalSteps = 0) {
        const markers = getReplayGapTimelineMarkers(gapMap, totalSteps).slice(0, REPLAY_EXPANSION_CAPS.maxGapMarkers);
        if (!markers.length) return '';
        return markers.map(marker => `
            <span class="crypto-replay-gap-marker is-${escapeAttr(marker.severity || 'medium')}"
                style="left:${escapeAttr(marker.positionPct)}%"
                title="${escapeAttr(marker.title || marker.label)}"
                aria-hidden="true"></span>
        `).join('');
    }

    function renderReplayContinuityPanel(profile = {}, gapMap = {}) {
        const gaps = Array.isArray(gapMap.gaps) ? gapMap.gaps.slice(0, 5) : [];
        const score = Math.max(0, Math.min(100, Math.round(Number(profile.score) || 0)));
        const level = profile.level || 'partial';
        const label = profile.label || 'Partial staged continuity';
        const detail = profile.detail || getContinuityDetail(profile, gapMap);
        return `
            <section class="crypto-replay-continuity-panel is-${escapeAttr(level)}" aria-label="Replay continuity confidence">
                <div class="crypto-replay-continuity-head">
                    <span>Continuity</span>
                    <strong>${escapeHtml(score)}%</strong>
                </div>
                <div class="crypto-replay-continuity-meter" aria-hidden="true">
                    <span style="width:${escapeAttr(score)}%"></span>
                </div>
                <div class="crypto-replay-continuity-copy">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(detail)}</span>
                </div>
                <div class="crypto-replay-gap-chip-row" aria-label="Replay gap markers">
                    ${gaps.map(gap => `
                        <span class="crypto-replay-gap-chip is-${escapeAttr(gap.severity || 'medium')}" title="${escapeAttr(gap.note || gap.label || gap.code)}">
                            ${escapeHtml(gap.label || formatHistoryLikeFlag(gap.code))}
                        </span>
                    `).join('') || '<span class="crypto-replay-gap-chip is-low">No explicit gap flags in this staged window</span>'}
                </div>
            </section>
        `;
    }

    function getContinuityDetail(profile = {}, gapMap = {}) {
        if (profile.level === 'high') return 'Staged replay order is comparatively strong, but this is still not a full-history proof.';
        if (profile.level === 'provider_limited') return 'Provider or rate-limit boundaries degrade staged replay continuation.';
        if (profile.level === 'ambiguous') return 'Cursor, ordering, timestamp, or exhaustion ambiguity affects continuation trust.';
        if (gapMap.missingWindowsPossible || gapMap.missing_windows_possible) return 'Known staged segment only; continuation outside loaded windows may exist.';
        return 'Continuity is estimated for staged replay windows only.';
    }

    function getReplayGapTimelineMarkers(gapMap = {}, totalSteps = 0) {
        const markers = [];
        const ordinalStart = Number(gapMap.ordinalStart || gapMap.ordinal_start) || 0;
        const ordinalEnd = Number(gapMap.ordinalEnd || gapMap.ordinal_end) || 0;
        const span = Math.max(1, ordinalEnd - ordinalStart + 1);
        (Array.isArray(gapMap.boundaryMarkers || gapMap.boundary_markers) ? (gapMap.boundaryMarkers || gapMap.boundary_markers) : []).forEach(marker => {
            markers.push({
                label: marker.label || marker.key || 'Replay boundary',
                title: marker.label || marker.key || 'Replay boundary',
                positionPct: Math.max(0, Math.min(100, Number(marker.positionPct || marker.position_pct) || 0)),
                severity: marker.kind === 'known_staged_segment' ? 'low' : 'medium'
            });
        });
        (Array.isArray(gapMap.gaps) ? gapMap.gaps : []).forEach((gap, index) => {
            const gapStart = Number(gap.ordinalStart || gap.ordinal_start) || ordinalStart;
            const roughPct = ordinalStart && ordinalEnd
                ? ((Math.max(ordinalStart, gapStart) - ordinalStart) / span) * 100
                : totalSteps
                    ? Math.min(96, Math.max(4, ((index + 1) / (Math.min(8, gapMap.gaps.length || 1) + 1)) * 100))
                    : 50;
            markers.push({
                label: gap.label || formatHistoryLikeFlag(gap.code),
                title: gap.note || gap.label || gap.code || 'Replay gap',
                positionPct: Math.max(2, Math.min(98, Math.round(roughPct))),
                severity: gap.severity || 'medium'
            });
        });
        return markers
            .filter((marker, index, list) => list.findIndex(item => item.label === marker.label && item.positionPct === marker.positionPct) === index)
            .slice(0, REPLAY_EXPANSION_CAPS.maxGapMarkers);
    }

    function formatWindowOrdinalRange(windowStatus = {}) {
        const start = Number(windowStatus.windowStart || windowStatus.ordinalStart) || 0;
        const end = Number(windowStatus.windowEnd || windowStatus.ordinalEnd) || 0;
        if (!start && !end) return 'No staged ordinal range';
        return `Staged rows ${start || '-'}-${end || '-'}`;
    }

    function formatWindowRangePosition(value = '') {
        const text = String(value || '').replaceAll('_', ' ').trim();
        if (!text) return 'staged segment';
        return text.replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function getWindowSegmentTitle(segment = {}) {
        return [
            segment.label || segment.title || '',
            segment.page_index ? `Page ${segment.page_index}` : '',
            segment.ordinal_start || segment.ordinal_end ? `Rows ${segment.ordinal_start || '-'}-${segment.ordinal_end || '-'}` : '',
            segment.earliest_timestamp ? `Earliest ${formatTimestamp(segment.earliest_timestamp)}` : '',
            segment.latest_timestamp ? `Latest ${formatTimestamp(segment.latest_timestamp)}` : '',
            segment.partial ? 'Partial' : ''
        ].filter(Boolean).join(' / ');
    }

    function getWindowSegmentLabel(segment = {}) {
        const explicit = String(segment.label || segment.title || segment.key || '').trim();
        if (explicit) return explicit;
        if (segment.page_index || segment.ordinal_start || segment.ordinal_end) {
            return `#${segment.page_index || '-'} ${segment.ordinal_start || '-'}-${segment.ordinal_end || '-'}`;
        }
        return 'Staged window';
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

    function renderAuditFilters(filters = DEFAULT_AUDIT_FILTERS, options = {}, filteredCount = 0, totalSteps = 0, disabled = false) {
        const safeFilters = normalizeAuditFilters(filters);
        const tokenOptions = options.tokens || [{ value: 'all', label: 'All tokens' }];
        const directionOptions = options.directions || [{ value: 'all', label: 'All directions' }];
        const counterpartyOptions = options.counterparties || [{ value: 'all', label: 'All wallets' }];
        const active = hasActiveReplayFilters(safeFilters);
        return `
            <details class="crypto-replay-audit-filters" ${active ? 'open' : ''}>
                <summary>
                    <span>Audit Filters</span>
                    <strong>${escapeHtml(filteredCount)}/${escapeHtml(totalSteps || 0)}</strong>
                </summary>
                <div class="crypto-replay-filter-grid">
                    ${renderFilterSelect('Token', 'token', safeFilters.token, tokenOptions, disabled)}
                    ${renderFilterSelect('Direction', 'direction', safeFilters.direction, directionOptions, disabled)}
                    ${renderFilterSelect('Counterparty', 'counterparty', safeFilters.counterparty, counterpartyOptions, disabled)}
                    <label class="crypto-replay-filter-toggle">
                        <input type="checkbox" data-crypto-replay-filter="majorOnly" ${safeFilters.majorOnly ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                        <span>Major staged flows</span>
                    </label>
                </div>
                <div class="crypto-replay-filter-footer">
                    <span>${escapeHtml(active ? 'Filters dim unmatched staged replay events only.' : 'All staged replay events are visible.')}</span>
                    <button type="button" data-crypto-replay-clear-filter ${!active || disabled ? 'disabled' : ''}>Reset</button>
                </div>
            </details>
        `;
    }

    function renderFilterSelect(label, key, value, options = [], disabled = false) {
        const normalizedValue = String(value || 'all');
        const safeOptions = ensureSelectedOption(options, normalizedValue);
        return `
            <label class="crypto-replay-filter-field">
                <span>${escapeHtml(label)}</span>
                <select data-crypto-replay-filter="${escapeAttr(key)}" ${disabled ? 'disabled' : ''}>
                    ${safeOptions.map(option => `
                        <option value="${escapeAttr(option.value)}" ${String(option.value) === normalizedValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                    `).join('')}
                </select>
            </label>
        `;
    }

    function renderAuditBreadcrumbs(breadcrumbs = [], recentEvents = []) {
        const chain = deriveBreadcrumbChain(breadcrumbs);
        return `
            <div class="crypto-replay-audit-breadcrumbs" aria-label="Replay audit breadcrumbs">
                <div class="crypto-replay-audit-breadcrumb-header">
                    <span>Audit Trail</span>
                    ${chain ? `<strong title="${escapeAttr(chain)}">${escapeHtml(chain)}</strong>` : '<strong>No chain pinned</strong>'}
                </div>
                <div class="crypto-replay-audit-breadcrumb-strip">
                    ${breadcrumbs.map(crumb => `
                        <span class="crypto-replay-audit-crumb">
                            <button type="button" data-crypto-replay-action="select-breadcrumb" data-crypto-replay-step="${escapeAttr(crumb.step || 0)}" title="${escapeAttr(crumb.title || crumb.label || '')}">${escapeHtml(crumb.label || `Step ${crumb.step || '-'}`)}</button>
                            <button type="button" data-crypto-replay-action="remove-breadcrumb" data-crypto-replay-crumb-id="${escapeAttr(crumb.id || '')}" aria-label="Remove replay breadcrumb">x</button>
                        </span>
                    `).join('') || '<div class="crypto-replay-bookmark-empty">Select replay transfers to build a compact audit trail.</div>'}
                </div>
                ${recentEvents.length ? `
                    <div class="crypto-replay-recent-strip">
                        ${recentEvents.map(event => `
                            <button type="button" data-crypto-replay-select-step="${escapeAttr(event.step || 0)}" data-crypto-replay-select-source="recent-event" title="${escapeAttr(getEventTitle(event))}">
                                ${escapeHtml(`#${event.step || '-'} ${shortValue(event.signature || event.token || event.sourceWallet || '')}`)}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderTransferDrilldown(event = null, context = {}) {
        if (!event) {
            return `
                <section class="crypto-replay-drilldown">
                    <div class="crypto-replay-event-kicker">TRANSFER DRILLDOWN</div>
                    <div class="crypto-replay-empty-compact">Pause, scrub, or click a replay edge to inspect staged transfer context.</div>
                </section>
            `;
        }
        const providerState = context.providerState || context.providerGrade || 'Worker staged';
        const confidence = Number(context.confidence);
        const warnings = Array.isArray(context.warnings) ? context.warnings : [];
        const continuity = context.continuityProfile || {};
        const gapMap = context.gapMap || {};
        return `
            <section class="crypto-replay-drilldown">
                <div class="crypto-replay-event-kicker">TRANSFER DRILLDOWN</div>
                <div class="crypto-replay-drilldown-grid">
                    ${renderDrilldownItem('Source', event.sourceWallet || event.source_wallet || '-', true)}
                    ${renderDrilldownItem('Destination', event.destinationWallet || event.destination_wallet || '-', true)}
                    ${renderDrilldownItem('Amount', event.amountDisplay || event.amount_display || event.amount || '-')}
                    ${renderDrilldownItem('Token', event.token || event.symbol || event.token_mint || '-')}
                    ${renderDrilldownItem('Direction', formatDirectionLabel(event.direction))}
                    ${renderDrilldownItem('Timestamp', formatTimestamp(event.timestamp) || '-')}
                    ${renderDrilldownItem('Signature', event.signature || event.transaction_hash || '-', true)}
                    ${renderDrilldownItem('Replay Step', `${event.step || '-'}${context.totalSteps ? ` / ${context.totalSteps}` : ''}`)}
                    ${renderDrilldownItem('Window', context.windowStatus?.windowLabel || 'Staged window')}
                    ${renderDrilldownItem('Provider / Confidence', `${providerState}${Number.isFinite(confidence) ? ` / ${Math.round(confidence)}%` : ''}`)}
                    ${renderDrilldownItem('Continuity', continuity.label || 'Staged continuity')}
                    ${renderDrilldownItem('Gap Impact', `${gapMap.gaps?.length || 0} marker${gapMap.gaps?.length === 1 ? '' : 's'} / ${gapMap.confidenceImpact || gapMap.confidence_impact || 0}% impact`)}
                </div>
                <div class="crypto-replay-event-warning">${escapeHtml(warnings[0] || event.warning || 'Staged replay warning: partial history may omit transfers outside loaded pages.')}</div>
            </section>
        `;
    }

    function renderDrilldownItem(label, value, mono = false) {
        return `
            <div>
                <span>${escapeHtml(label)}</span>
                <strong class="${mono ? 'is-mono' : ''}" title="${escapeAttr(value)}">${escapeHtml(value)}</strong>
            </div>
        `;
    }

    function renderReplayAuditActions(event = null, relationships = {}, disabled = false, context = {}) {
        const sourceWallet = event?.sourceWallet || event?.source_wallet || '';
        const destinationWallet = event?.destinationWallet || event?.destination_wallet || '';
        const token = event?.token || event?.symbol || event?.token_mint || '';
        const route = event ? getRouteKey(event) : '';
        const noEvent = !event || disabled;
        const previousRelated = relationships.previousRelated?.step || 0;
        const nextRelated = relationships.nextRelated?.step || 0;
        const checkpoint = context.checkpoint || null;
        return `
            <section class="crypto-replay-audit-actions" aria-label="Replay audit actions">
                <button type="button" data-crypto-replay-action="save-checkpoint" ${disabled ? 'disabled' : ''}>Save Checkpoint</button>
                <button type="button" data-crypto-replay-action="resume-checkpoint" ${!checkpoint ? 'disabled' : ''}>Resume Checkpoint</button>
                <button type="button" data-crypto-replay-action="follow-source" data-crypto-replay-wallet="${escapeAttr(sourceWallet)}" ${noEvent || !sourceWallet ? 'disabled' : ''}>Follow Source Wallet</button>
                <button type="button" data-crypto-replay-action="follow-destination" data-crypto-replay-wallet="${escapeAttr(destinationWallet)}" ${noEvent || !destinationWallet ? 'disabled' : ''}>Follow Destination Wallet</button>
                <button type="button" data-crypto-replay-action="center-transfer" ${noEvent ? 'disabled' : ''}>Center Current Transfer</button>
                <button type="button" data-crypto-replay-action="jump-boundary-oldest" ${disabled ? 'disabled' : ''}>Jump To Replay Boundary</button>
                <button type="button" data-crypto-replay-action="inspect-related" ${noEvent ? 'disabled' : ''}>Inspect Related Flows</button>
                <button type="button" data-crypto-replay-action="continue-around" ${noEvent ? 'disabled' : ''}>Continue Around This Transfer</button>
                <button type="button" data-crypto-replay-action="continue-counterparty" data-crypto-replay-wallet="${escapeAttr(destinationWallet || sourceWallet)}" ${noEvent || (!sourceWallet && !destinationWallet) ? 'disabled' : ''}>Continue Related Counterparty</button>
                <button type="button" data-crypto-replay-action="continue-token" data-crypto-replay-token="${escapeAttr(token)}" ${noEvent || !token ? 'disabled' : ''}>Continue Related Token</button>
                <button type="button" data-crypto-replay-action="expand-transfer" ${noEvent ? 'disabled' : ''}>Expand Around This Transfer</button>
                <button type="button" data-crypto-replay-action="expand-wallet" data-crypto-replay-wallet="${escapeAttr(destinationWallet || sourceWallet)}" ${noEvent || (!sourceWallet && !destinationWallet) ? 'disabled' : ''}>Expand Around This Wallet</button>
                <button type="button" data-crypto-replay-action="expand-counterparties" ${noEvent ? 'disabled' : ''}>Expand Related Counterparties</button>
                <button type="button" data-crypto-replay-action="expand-route" data-crypto-replay-route="${escapeAttr(route)}" ${noEvent || !route ? 'disabled' : ''}>Expand Same Route</button>
                <button type="button" data-crypto-replay-action="expand-token" data-crypto-replay-token="${escapeAttr(token)}" ${noEvent || !token ? 'disabled' : ''}>Expand Same Token Neighborhood</button>
                <button type="button" data-crypto-replay-action="expand-cluster" ${noEvent ? 'disabled' : ''}>Expand Current Replay Cluster</button>
                <button type="button" data-crypto-replay-action="collapse-neighborhood" ${disabled ? 'disabled' : ''}>Collapse Neighborhood</button>
                <button type="button" data-crypto-replay-action="continue-route" data-crypto-replay-route="${escapeAttr(route)}" ${noEvent || !route ? 'disabled' : ''}>Continue Along Route</button>
                <button type="button" data-crypto-replay-action="follow-outbound" data-crypto-replay-wallet="${escapeAttr(destinationWallet)}" ${noEvent || !destinationWallet ? 'disabled' : ''}>Follow Outbound Chain</button>
                <button type="button" data-crypto-replay-action="follow-inbound" data-crypto-replay-wallet="${escapeAttr(sourceWallet)}" ${noEvent || !sourceWallet ? 'disabled' : ''}>Follow Inbound Chain</button>
                <button type="button" data-crypto-replay-action="continue-token-path" data-crypto-replay-token="${escapeAttr(token)}" ${noEvent || !token ? 'disabled' : ''}>Continue Token Path</button>
                <button type="button" data-crypto-replay-action="jump-related" data-crypto-replay-direction="-1" ${noEvent || !previousRelated ? 'disabled' : ''}>Previous Related</button>
                <button type="button" data-crypto-replay-action="jump-related" data-crypto-replay-direction="1" ${noEvent || !nextRelated ? 'disabled' : ''}>Next Related</button>
            </section>
        `;
    }

    function renderRelatedTransferExploration(relationships = {}) {
        const groups = [
            ['Same Counterparty', relationships.sameCounterparty || []],
            ['Same Token', relationships.sameToken || []],
            ['Nearby Time', relationships.nearbyTime || []],
            ['Repeated Route', relationships.repeatedRoute || []]
        ];
        return `
            <section class="crypto-replay-related">
                <div class="crypto-replay-related-header">
                    <span>Related Staged Transfers</span>
                    <strong>${escapeHtml(relationships.totalRelated || 0)} derived</strong>
                </div>
                <div class="crypto-replay-related-grid">
                    ${groups.map(([label, events]) => `
                        <div class="crypto-replay-related-card">
                            <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(events.length)}</strong></div>
                            ${events.slice(0, 3).map(event => `
                                <button type="button" data-crypto-replay-select-step="${escapeAttr(event.step || 0)}" data-crypto-replay-select-source="related-transfer" title="${escapeAttr(getEventTitle(event))}">
                                    <span>#${escapeHtml(event.step || '-')}</span>
                                    <strong>${escapeHtml(formatAmountToken(event))}</strong>
                                </button>
                            `).join('') || '<p>No staged match</p>'}
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderReplayNeighborhoodPanel(neighborhood = {}, clusters = {}, disabled = false) {
        const events = Array.isArray(neighborhood.events) ? neighborhood.events : [];
        const active = Boolean(neighborhood.active);
        const wallets = Array.isArray(neighborhood.wallets) ? neighborhood.wallets : [];
        const routes = Array.isArray(neighborhood.routes) ? neighborhood.routes : [];
        const tokens = Array.isArray(neighborhood.tokens) ? neighborhood.tokens : [];
        return `
            <section class="crypto-replay-neighborhood ${active ? 'is-active' : ''}" aria-label="Replay neighborhood">
                <div class="crypto-replay-related-header">
                    <span>Replay Neighborhood</span>
                    <strong>${escapeHtml(events.length)} staged</strong>
                </div>
                <div class="crypto-replay-neighborhood-copy">
                    ${escapeHtml(neighborhood.detail || 'Local staged neighbors are derived only from visible replay rows.')}
                </div>
                <div class="crypto-replay-neighborhood-stats">
                    <span>${escapeHtml(wallets.length)} wallets</span>
                    <span>${escapeHtml(routes.length)} routes</span>
                    <span>${escapeHtml(tokens.length)} tokens</span>
                    <span>${escapeHtml(clusters.total || 0)} clusters</span>
                </div>
                <div class="crypto-replay-neighborhood-strip">
                    ${events.slice(0, 8).map(event => `
                        <button type="button" data-crypto-replay-select-step="${escapeAttr(event.step || 0)}" data-crypto-replay-select-source="neighborhood" ${disabled ? 'disabled' : ''} title="${escapeAttr(getEventTitle(event))}">
                            <span>#${escapeHtml(event.step || '-')}</span>
                            <strong>${escapeHtml(event.token || 'Token')}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">Select a replay transfer or expansion action to reveal a local staged neighborhood.</div>'}
                </div>
                <div class="crypto-replay-neighborhood-actions">
                    <button type="button" data-crypto-replay-action="expand-counterparties" ${disabled ? 'disabled' : ''}>Related Counterparties</button>
                    <button type="button" data-crypto-replay-action="expand-route" data-crypto-replay-route="${escapeAttr(neighborhood.primaryRoute || '')}" ${disabled || !neighborhood.primaryRoute ? 'disabled' : ''}>Same Route</button>
                    <button type="button" data-crypto-replay-action="expand-token" data-crypto-replay-token="${escapeAttr(neighborhood.primaryToken || '')}" ${disabled || !neighborhood.primaryToken ? 'disabled' : ''}>Same Token</button>
                    <button type="button" data-crypto-replay-action="collapse-neighborhood" ${disabled || !active ? 'disabled' : ''}>Reset</button>
                </div>
            </section>
        `;
    }

    function renderReplayRouteComparisonPanel(comparison = {}) {
        if (!comparison?.active) return '';
        return `
            <section class="crypto-replay-route-comparison" aria-label="Replay route comparison">
                <div class="crypto-replay-related-header">
                    <span>Replay Route Comparison</span>
                    <strong>${escapeHtml(comparison.sharedCount || 0)} shared</strong>
                </div>
                <div class="crypto-replay-neighborhood-copy">
                    ${escapeHtml(comparison.detail || 'Current and selected staged event neighborhoods are compared without merging data into Wallet Lookup.')}
                </div>
                <div class="crypto-replay-neighborhood-stats">
                    <span>Current ${escapeHtml(comparison.currentCount || 0)}</span>
                    <span>Selected ${escapeHtml(comparison.selectedCount || 0)}</span>
                    <span>Shared ${escapeHtml(comparison.sharedCount || 0)}</span>
                    <span>${escapeHtml(comparison.primaryRoute || 'No route')}</span>
                </div>
                <div class="crypto-replay-neighborhood-strip">
                    ${(comparison.sharedEvents || []).slice(0, 6).map(event => `
                        <button type="button" data-crypto-replay-select-step="${escapeAttr(event.step || 0)}" data-crypto-replay-select-source="route-comparison" title="${escapeAttr(getEventTitle(event))}">
                            <span>#${escapeHtml(event.step || '-')}</span>
                            <strong>${escapeHtml(event.token || 'Token')}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">No shared staged events between current and selected neighborhoods.</div>'}
                </div>
            </section>
        `;
    }

    function renderReplayClusterPanel(clusters = {}, disabled = false) {
        const clusterItems = [
            ...(clusters.counterparties || []),
            ...(clusters.routes || []),
            ...(clusters.tokens || []),
            ...(clusters.hotspots || [])
        ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, REPLAY_EXPANSION_CAPS.maxClusters);
        return `
            <section class="crypto-replay-clusters" aria-label="Replay clusters">
                <div class="crypto-replay-related-header">
                    <span>Replay Clusters</span>
                    <strong>${escapeHtml(clusters.total || clusterItems.length)}</strong>
                </div>
                <div class="crypto-replay-cluster-list">
                    ${clusterItems.map(cluster => `
                        <button type="button"
                            data-crypto-replay-action="expand-cluster"
                            data-crypto-replay-cluster-key="${escapeAttr(cluster.key || '')}"
                            data-crypto-replay-cluster-kind="${escapeAttr(cluster.kind || '')}"
                            data-crypto-replay-token="${escapeAttr(cluster.token || '')}"
                            data-crypto-replay-wallet="${escapeAttr(cluster.wallet || '')}"
                            data-crypto-replay-route="${escapeAttr(cluster.route || '')}"
                            ${disabled ? 'disabled' : ''}
                            title="${escapeAttr(cluster.detail || cluster.label)}">
                            <span>${escapeHtml(cluster.label)}</span>
                            <strong>${escapeHtml(cluster.count)}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">No repeated staged replay clusters above the bounded threshold yet.</div>'}
                </div>
            </section>
        `;
    }

    function renderFilteredEventStrip(events = [], selectedEvent = null, disabled = false) {
        const selectedStep = Number(selectedEvent?.step) || 0;
        return `
            <section class="crypto-replay-filtered-events">
                <div class="crypto-replay-related-header">
                    <span>Filtered Replay Events</span>
                    <strong>${escapeHtml(events.length)}</strong>
                </div>
                <div class="crypto-replay-filtered-strip">
                    ${events.slice(0, 12).map(event => `
                        <button type="button" class="${Number(event.step) === selectedStep ? 'is-active' : ''}" data-crypto-replay-select-step="${escapeAttr(event.step || 0)}" data-crypto-replay-select-source="filtered-event" ${disabled ? 'disabled' : ''} title="${escapeAttr(getEventTitle(event))}">
                            <span>#${escapeHtml(event.step || '-')}</span>
                            <strong>${escapeHtml(event.token || 'Token')}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">No staged transfer matches the current replay filters.</div>'}
                </div>
            </section>
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
        root.querySelector('#crypto-replay-workspace-boundary-oldest')?.addEventListener('click', () => handlers.jumpBoundary?.('oldest'));
        root.querySelector('#crypto-replay-workspace-boundary-newest')?.addEventListener('click', () => handlers.jumpBoundary?.('newest'));
        root.querySelector('#crypto-replay-workspace-checkpoint-save')?.addEventListener('click', () => handlers.saveCheckpoint?.());
        root.querySelector('#crypto-replay-workspace-checkpoint-resume')?.addEventListener('click', () => handlers.resumeCheckpoint?.());
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
        root.querySelectorAll('[data-crypto-replay-select-step]').forEach(button => {
            button.addEventListener('click', () => {
                handlers.selectStep?.(Number(button.dataset.cryptoReplaySelectStep) || 0, {
                    source: button.dataset.cryptoReplaySelectSource || 'audit-panel'
                });
            });
        });
        root.querySelectorAll('[data-crypto-replay-action]').forEach(button => {
            button.addEventListener('click', () => {
                handlers.auditAction?.(button.dataset.cryptoReplayAction || '', {
                    wallet: button.dataset.cryptoReplayWallet || '',
                    token: button.dataset.cryptoReplayToken || '',
                    route: button.dataset.cryptoReplayRoute || '',
                    clusterKey: button.dataset.cryptoReplayClusterKey || '',
                    clusterKind: button.dataset.cryptoReplayClusterKind || '',
                    step: Number(button.dataset.cryptoReplayStep) || 0,
                    direction: Number(button.dataset.cryptoReplayDirection) || 0,
                    crumbId: button.dataset.cryptoReplayCrumbId || ''
                });
            });
        });
        root.querySelectorAll('[data-crypto-replay-filter]').forEach(control => {
            control.addEventListener('change', event => {
                handlers.updateFilter?.(control.dataset.cryptoReplayFilter || '', event.target.type === 'checkbox'
                    ? event.target.checked
                    : event.target.value);
            });
        });
        root.querySelectorAll('[data-crypto-replay-clear-filter]').forEach(button => {
            button.addEventListener('click', () => handlers.resetFilters?.());
        });
        root.querySelector('#crypto-replay-workspace-exit')?.addEventListener('click', () => handlers.exit?.());
    }

    function deriveReplayGapMap(context = {}) {
        const metadata = context.dataset?.metadata || {};
        const windowStatus = normalizeReplayWindowStatus(context.windowStatus || metadata.replay_window || {});
        const reconstruction = metadata.replay_reconstruction || context.replayReconstruction || {};
        const explicit = normalizeReplayGapMap(
            windowStatus.gapMap
            || windowStatus.gap_map
            || metadata.gap_map
            || metadata.replay_gap_map
            || reconstruction.gap_map
            || context.gapMap
            || null
        );
        if (explicit?.gaps?.length || explicit?.boundaryMarkers?.length) return explicit;

        const events = Array.isArray(context.events) ? context.events : [];
        const gaps = [];
        const addGap = (code, label, severity = 'medium', details = {}) => {
            if (!code || gaps.some(gap => gap.code === code)) return;
            gaps.push(normalizeReplayGap({
                code,
                label,
                severity,
                ordinalStart: details.ordinalStart ?? windowStatus.windowStart,
                ordinalEnd: details.ordinalEnd ?? windowStatus.windowEnd,
                windowIndex: details.windowIndex ?? windowStatus.currentWindowIndex,
                confidenceImpact: details.confidenceImpact,
                source: details.source,
                boundary: details.boundary,
                note: details.note
            }));
        };
        const gapFlags = [
            ...(Array.isArray(context.gapFlags) ? context.gapFlags : []),
            ...(Array.isArray(metadata.gap_flags) ? metadata.gap_flags : []),
            ...(Array.isArray(context.scanManifest?.gap_flags) ? context.scanManifest.gap_flags : [])
        ];
        gapFlags.forEach(flag => addGap(
            String(flag || ''),
            formatHistoryLikeFlag(flag),
            ['cursor_stall', 'malformed_ordering', 'schema_mismatch', 'provider_exhaustion_ambiguous'].includes(String(flag || '')) ? 'high' : 'medium',
            {
                confidenceImpact: ['cursor_stall', 'malformed_ordering', 'schema_mismatch', 'provider_exhaustion_ambiguous'].includes(String(flag || '')) ? 18 : 10,
                source: 'scan_gap_flags',
                boundary: String(flag || '').includes('cursor') ? 'cursor' : 'replay'
            }
        ));
        if (windowStatus.partial) {
            addGap('missing_window_risk', 'Missing-window risk', 'medium', {
                confidenceImpact: 10,
                source: 'replay_window',
                boundary: 'staged_window',
                note: 'Replay is limited to staged windows; other provider history may exist.'
            });
        }
        if (windowStatus.olderRequiresProviderPage || windowStatus.newerRequiresProviderPage) {
            addGap('unknown_continuation_region', 'Unknown continuation region', 'medium', {
                confidenceImpact: 12,
                source: 'replay_window',
                boundary: windowStatus.olderRequiresProviderPage ? 'oldest' : 'newest',
                note: 'Another Worker-backed staged page is needed before this region can be materialized.'
            });
        }
        if (metadata.rate_limited || context.rateLimited || context.providerState === 'provider_rate_limited') {
            addGap('rate_limited_replay_continuation', 'Rate-limited replay continuation', 'high', {
                confidenceImpact: 24,
                source: 'worker_history_status',
                boundary: 'provider'
            });
        }
        if (metadata.provider_limit_reached || context.providerLimited) {
            addGap('provider_limited_window', 'Provider-limited window', 'high', {
                confidenceImpact: 20,
                source: 'worker_history_status',
                boundary: 'provider'
            });
        }
        if (windowStatus.oldestFirstRequired) {
            addGap('replay_order_reconstruction_required', 'Replay order reconstruction required', 'medium', {
                confidenceImpact: 12,
                source: 'replay_reconstruction',
                boundary: 'ordering'
            });
        }
        if (events.some(event => !event.timestamp && !event.timestampMs)) {
            addGap('missing_timestamp_window', 'Missing timestamp window', 'medium', {
                confidenceImpact: 8,
                source: 'staged_events',
                boundary: 'timeline'
            });
        }
        if (!windowStatus.canContinueOlder && !windowStatus.canContinueNewer && windowStatus.partial && !windowStatus.olderRequiresProviderPage) {
            addGap('provider_exhaustion_ambiguous', 'Provider exhaustion ambiguous', 'medium', {
                confidenceImpact: 14,
                source: 'continuation_state',
                boundary: 'cursor'
            });
        }

        const impact = gaps.reduce((sum, gap) => sum + (Number(gap.confidenceImpact) || 0), 0);
        return normalizeReplayGapMap({
            version: REPLAY_GAP_MAP_VERSION,
            scope: 'staged_replay_window',
            scanId: windowStatus.scanId || metadata.scan_id || '',
            windowIndex: windowStatus.currentWindowIndex,
            totalWindows: windowStatus.windowCount,
            ordinalStart: windowStatus.windowStart,
            ordinalEnd: windowStatus.windowEnd,
            missingWindowsPossible: windowStatus.partial || Boolean(windowStatus.boundary?.missing_windows_possible),
            providerLimited: gaps.some(gap => gap.code === 'provider_limited_window'),
            rateLimited: gaps.some(gap => gap.code === 'rate_limited_replay_continuation'),
            cursorAmbiguous: gaps.some(gap => gap.boundary === 'cursor'),
            timestampGaps: gaps.some(gap => gap.code === 'missing_timestamp_window'),
            confidenceImpact: impact,
            gaps,
            boundaryMarkers: [
                { key: 'window-start', label: 'Known staged segment starts', positionPct: 0, kind: 'known_staged_segment' },
                { key: 'window-end', label: windowStatus.partial ? 'Uncertain continuation boundary' : 'Known staged segment ends', positionPct: 100, kind: windowStatus.partial ? 'uncertain_continuation' : 'known_staged_segment' }
            ],
            noFullHistoryClaim: true
        });
    }

    function deriveReplayContinuityProfile(context = {}, gapMap = {}) {
        const windowStatus = normalizeReplayWindowStatus(context.windowStatus || {});
        const metadata = context.dataset?.metadata || {};
        const explicit = normalizeReplayContinuityProfile(
            windowStatus.continuityConfidence
            || windowStatus.continuity_confidence
            || metadata.continuity_confidence
            || metadata.replay_continuity
            || metadata.replay_reconstruction?.continuity_confidence
            || metadata.replay_window?.continuity_confidence
            || context.continuityProfile
            || null
        );
        if (explicit) return explicit;
        const base = Math.max(0, Math.min(100, Math.round(Number(context.confidence ?? context.status?.completenessConfidence ?? metadata.completeness_confidence) || 0)));
        const impact = Math.min(70, Math.max(0, Number(gapMap.confidenceImpact ?? gapMap.confidence_impact) || 0));
        let score = Math.max(0, Math.min(100, base - Math.floor(impact * 0.45)));
        if (windowStatus.partial) score = Math.min(score || 62, 76);
        if (gapMap.providerLimited) score = Math.min(score, 55);
        if (gapMap.rateLimited) score = Math.min(score, 48);
        if (gapMap.cursorAmbiguous) score = Math.min(score, 58);
        const hasHighGap = (gapMap.gaps || []).some(gap => gap.severity === 'high');
        const level = gapMap.providerLimited || gapMap.rateLimited
            ? 'provider_limited'
            : gapMap.cursorAmbiguous || hasHighGap
                ? 'ambiguous'
                : !windowStatus.partial && !(gapMap.gaps || []).length
                    ? 'high'
                    : 'partial';
        const label = level === 'high'
            ? 'High staged continuity'
            : level === 'provider_limited'
                ? 'Provider-limited continuity'
                : level === 'ambiguous'
                    ? 'Ambiguous staged continuity'
                    : 'Partial staged continuity';
        return normalizeReplayContinuityProfile({
            version: REPLAY_CONTINUITY_VERSION,
            score,
            level,
            label,
            degraded: level !== 'high',
            reasonCodes: (gapMap.gaps || []).map(gap => gap.code),
            gapCount: (gapMap.gaps || []).length,
            detail: getContinuityDetail({ level }, gapMap),
            scope: 'staged_continuity',
            noFullHistoryClaim: true
        });
    }

    function normalizeReplayGapMap(gapMap = null) {
        if (!gapMap || typeof gapMap !== 'object' || Array.isArray(gapMap)) return null;
        const gaps = Array.isArray(gapMap.gaps) ? gapMap.gaps.slice(0, REPLAY_EXPANSION_CAPS.maxGaps).map(normalizeReplayGap) : [];
        return {
            version: String(gapMap.version || REPLAY_GAP_MAP_VERSION),
            scope: String(gapMap.scope || 'staged_replay_window'),
            scanId: String(gapMap.scanId || gapMap.scan_id || ''),
            windowIndex: Math.max(0, Number(gapMap.windowIndex || gapMap.window_index) || 0),
            totalWindows: Math.max(0, Number(gapMap.totalWindows || gapMap.total_windows) || 0),
            ordinalStart: Math.max(0, Number(gapMap.ordinalStart || gapMap.ordinal_start) || 0),
            ordinalEnd: Math.max(0, Number(gapMap.ordinalEnd || gapMap.ordinal_end) || 0),
            missingWindowsPossible: gapMap.missingWindowsPossible === true || gapMap.missing_windows_possible === true,
            providerLimited: gapMap.providerLimited === true || gapMap.provider_limited === true,
            rateLimited: gapMap.rateLimited === true || gapMap.rate_limited === true,
            cursorAmbiguous: gapMap.cursorAmbiguous === true || gapMap.cursor_ambiguous === true,
            timestampGaps: gapMap.timestampGaps === true || gapMap.timestamp_gaps === true,
            confidenceImpact: Math.max(0, Math.min(100, Math.round(Number(gapMap.confidenceImpact || gapMap.confidence_impact) || 0))),
            gaps,
            boundaryMarkers: Array.isArray(gapMap.boundaryMarkers || gapMap.boundary_markers)
                ? (gapMap.boundaryMarkers || gapMap.boundary_markers).slice(0, REPLAY_EXPANSION_CAPS.maxGapMarkers).map(marker => ({
                    key: String(marker.key || ''),
                    label: String(marker.label || ''),
                    positionPct: Math.max(0, Math.min(100, Math.round(Number(marker.positionPct || marker.position_pct) || 0))),
                    kind: String(marker.kind || 'uncertain_continuation')
                }))
                : [],
            noFullHistoryClaim: gapMap.noFullHistoryClaim !== false && gapMap.no_full_history_claim !== false
        };
    }

    function normalizeReplayGap(gap = {}) {
        const severity = String(gap.severity || 'medium');
        return {
            code: String(gap.code || ''),
            label: String(gap.label || formatHistoryLikeFlag(gap.code)),
            severity: ['low', 'medium', 'high'].includes(severity) ? severity : 'medium',
            ordinalStart: Math.max(0, Number(gap.ordinalStart || gap.ordinal_start) || 0),
            ordinalEnd: Math.max(0, Number(gap.ordinalEnd || gap.ordinal_end) || 0),
            windowIndex: Math.max(0, Number(gap.windowIndex || gap.window_index) || 0),
            confidenceImpact: Math.max(0, Math.min(100, Math.round(Number(gap.confidenceImpact || gap.confidence_impact) || 0))),
            source: String(gap.source || ''),
            boundary: String(gap.boundary || ''),
            note: String(gap.note || '')
        };
    }

    function normalizeReplayContinuityProfile(profile = null) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
        const level = String(profile.level || 'partial');
        return {
            version: String(profile.version || REPLAY_CONTINUITY_VERSION),
            score: Math.max(0, Math.min(100, Math.round(Number(profile.score) || 0))),
            level: ['high', 'partial', 'ambiguous', 'provider_limited'].includes(level) ? level : 'partial',
            label: String(profile.label || 'Partial staged continuity'),
            degraded: profile.degraded !== false,
            reasonCodes: Array.isArray(profile.reasonCodes || profile.reason_codes)
                ? (profile.reasonCodes || profile.reason_codes).slice(0, 8).map(String)
                : [],
            gapCount: Math.max(0, Number(profile.gapCount || profile.gap_count) || 0),
            detail: String(profile.detail || ''),
            scope: String(profile.scope || 'staged_continuity'),
            noFullHistoryClaim: profile.noFullHistoryClaim !== false && profile.no_full_history_claim !== false
        };
    }

    function deriveReplayClusters(events = [], options = {}) {
        const tracked = normalizeAddressFilter(options.trackedWallet || '');
        const counterpartyCounts = new Map();
        const routeCounts = new Map();
        const tokenCounts = new Map();
        const hotspotCounts = new Map();
        events.forEach(event => {
            const step = Number(event.step) || 0;
            const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
            const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
            [source, destination].filter(value => value && value !== 'all' && value !== tracked).forEach(wallet => {
                const record = counterpartyCounts.get(wallet) || { key: `wallet:${wallet}`, kind: 'counterparty', wallet, label: shortValue(wallet), count: 0, steps: [], events: [] };
                record.count += 1;
                record.steps.push(step);
                record.events.push(event);
                counterpartyCounts.set(wallet, record);
            });
            const route = getRouteKey(event);
            if (route) {
                const record = routeCounts.get(route) || { key: `route:${route}`, kind: 'route', route, label: formatRoute(event), count: 0, steps: [], events: [] };
                record.count += 1;
                record.steps.push(step);
                record.events.push(event);
                routeCounts.set(route, record);
            }
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            if (token !== 'all') {
                const record = tokenCounts.get(token) || { key: `token:${token}`, kind: 'token', token, label: token, count: 0, steps: [], events: [] };
                record.count += 1;
                record.steps.push(step);
                record.events.push(event);
                tokenCounts.set(token, record);
            }
            const time = Number(event.timestampMs) || getTimestampMs(event.timestamp);
            if (time) {
                const bucket = Math.floor(time / (1000 * 60 * 60 * 12));
                const record = hotspotCounts.get(bucket) || { key: `hotspot:${bucket}`, kind: 'hotspot', label: formatTimestamp(event.timestamp) || 'Time hotspot', count: 0, steps: [], events: [] };
                record.count += 1;
                record.steps.push(step);
                record.events.push(event);
                hotspotCounts.set(bucket, record);
            }
        });
        const normalizeCluster = cluster => ({
            ...cluster,
            version: REPLAY_CLUSTER_VERSION,
            steps: cluster.steps.filter(Boolean).slice(0, REPLAY_EXPANSION_CAPS.maxClusterMembers),
            events: cluster.events.slice(0, REPLAY_EXPANSION_CAPS.maxClusterMembers),
            detail: `${cluster.count} staged replay event${cluster.count === 1 ? '' : 's'} share this ${cluster.kind}. Address observation only.`
        });
        const pickClusters = (map, minCount, limit) => [...map.values()]
            .filter(item => item.count >= minCount)
            .sort((a, b) => b.count - a.count || Math.min(...a.steps) - Math.min(...b.steps) || a.label.localeCompare(b.label))
            .slice(0, limit)
            .map(normalizeCluster);
        const counterparties = pickClusters(counterpartyCounts, 2, REPLAY_EXPANSION_CAPS.maxCounterpartyClusters);
        const routes = pickClusters(routeCounts, 2, REPLAY_EXPANSION_CAPS.maxRouteClusters);
        const tokens = pickClusters(tokenCounts, 2, REPLAY_EXPANSION_CAPS.maxTokenClusters);
        const hotspots = pickClusters(hotspotCounts, 3, 3);
        return {
            version: REPLAY_CLUSTER_VERSION,
            counterparties,
            routes,
            tokens,
            hotspots,
            total: counterparties.length + routes.length + tokens.length + hotspots.length,
            capped: counterpartyCounts.size > counterparties.length || routeCounts.size > routes.length || tokenCounts.size > tokens.length,
            previewOnly: true,
            stagedHistoryOnly: true
        };
    }

    function deriveReplayNeighborhood(selectedEvent = null, events = [], options = {}) {
        const focus = normalizeNeighborhoodFocus(options.focus);
        const clusters = options.clusters || deriveReplayClusters(events);
        const selectedStep = Number(selectedEvent?.step) || 0;
        const selectedRoute = selectedEvent ? getRouteKey(selectedEvent) : '';
        const selectedToken = selectedEvent ? normalizeTokenFilter(selectedEvent.token || selectedEvent.symbol || selectedEvent.token_mint) : 'all';
        const selectedWallets = selectedEvent
            ? [selectedEvent.sourceWallet || selectedEvent.source_wallet, selectedEvent.destinationWallet || selectedEvent.destination_wallet].map(normalizeAddressFilter).filter(value => value && value !== 'all')
            : [];
        const eventMatchesFocus = event => {
            const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
            const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
            const route = getRouteKey(event);
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            if (focus.mode === 'wallet') return focus.wallet && (source === focus.wallet || destination === focus.wallet);
            if (focus.mode === 'counterparties') return selectedWallets.includes(source) || selectedWallets.includes(destination);
            if (focus.mode === 'route') return focus.route ? route === focus.route : route && route === selectedRoute;
            if (focus.mode === 'token') return focus.token !== 'all' ? token === focus.token : token !== 'all' && token === selectedToken;
            if (focus.mode === 'cluster') return matchesClusterFocus(event, focus, clusters, selectedEvent);
            if (focus.mode === 'transfer') return selectedEvent ? (
                route && route === selectedRoute
                || (selectedToken !== 'all' && token === selectedToken)
                || selectedWallets.includes(source)
                || selectedWallets.includes(destination)
            ) : false;
            return selectedEvent ? Math.abs((Number(event.step) || 0) - selectedStep) <= 3 : false;
        };
        const related = uniqueEvents(events.filter(event => eventMatchesFocus(event)))
            .sort((a, b) => Number(a.step) - Number(b.step));
        const wallets = [];
        const routes = [];
        const tokens = [];
        related.forEach(event => {
            [event.sourceWallet || event.source_wallet, event.destinationWallet || event.destination_wallet].forEach(wallet => {
                const normalized = normalizeAddressFilter(wallet);
                if (normalized && normalized !== 'all' && !wallets.includes(normalized)) wallets.push(normalized);
            });
            const route = getRouteKey(event);
            if (route && !routes.includes(route)) routes.push(route);
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            if (token !== 'all' && !tokens.includes(token)) tokens.push(token);
        });
        const active = focus.mode !== 'none' || related.length > 1;
        return {
            version: REPLAY_NEIGHBORHOOD_VERSION,
            active,
            mode: focus.mode,
            title: getNeighborhoodTitle(focus, selectedEvent),
            detail: getNeighborhoodDetail(focus, related.length),
            events: related.slice(0, REPLAY_EXPANSION_CAPS.maxNeighborhoodEvents),
            totalEvents: related.length,
            wallets: wallets.slice(0, REPLAY_EXPANSION_CAPS.maxNeighborhoodWallets),
            routes: routes.slice(0, 10),
            tokens: tokens.slice(0, 10),
            primaryRoute: focus.route || selectedRoute || routes[0] || '',
            primaryToken: focus.token !== 'all' ? focus.token : selectedToken !== 'all' ? selectedToken : tokens[0] || '',
            capped: related.length > REPLAY_EXPANSION_CAPS.maxNeighborhoodEvents,
            previewOnly: true,
            stagedHistoryOnly: true
        };
    }

    function normalizeNeighborhoodFocus(focus = null) {
        if (!focus || typeof focus !== 'object' || Array.isArray(focus)) return { mode: 'none', wallet: '', token: 'all', route: '', clusterKey: '', clusterKind: '' };
        const mode = String(focus.mode || 'none');
        return {
            mode: ['none', 'transfer', 'wallet', 'counterparties', 'route', 'token', 'cluster'].includes(mode) ? mode : 'none',
            wallet: normalizeAddressFilter(focus.wallet || ''),
            token: normalizeTokenFilter(focus.token || ''),
            route: String(focus.route || ''),
            clusterKey: String(focus.clusterKey || focus.cluster_key || ''),
            clusterKind: String(focus.clusterKind || focus.cluster_kind || '')
        };
    }

    function deriveReplayRouteComparison(currentEvent = null, selectedEvent = null, events = []) {
        if (!currentEvent || !selectedEvent) {
            return {
                active: false,
                detail: 'Select a replay event to compare its staged neighborhood with the current replay event.'
            };
        }
        const currentStep = Number(currentEvent.step) || 0;
        const selectedStep = Number(selectedEvent.step) || 0;
        if (!currentStep || !selectedStep || currentStep === selectedStep) {
            return {
                active: false,
                detail: 'Current and selected replay event are the same staged step.'
            };
        }

        const currentRoute = getRouteKey(currentEvent);
        const selectedRoute = getRouteKey(selectedEvent);
        const currentToken = normalizeTokenFilter(currentEvent.token || currentEvent.symbol || currentEvent.token_mint);
        const selectedToken = normalizeTokenFilter(selectedEvent.token || selectedEvent.symbol || selectedEvent.token_mint);
        const currentWallets = getEventWalletSet(currentEvent);
        const selectedWallets = getEventWalletSet(selectedEvent);
        const currentNeighborhood = events.filter(event => eventTouchesContext(event, currentRoute, currentToken, currentWallets));
        const selectedNeighborhood = events.filter(event => eventTouchesContext(event, selectedRoute, selectedToken, selectedWallets));
        const selectedSteps = new Set(selectedNeighborhood.map(event => Number(event.step) || 0));
        const sharedEvents = currentNeighborhood.filter(event => selectedSteps.has(Number(event.step) || 0));
        const primaryRoute = currentRoute && currentRoute === selectedRoute
            ? currentRoute
            : currentRoute && selectedRoute ? 'divergent routes' : currentRoute || selectedRoute || '';
        return {
            active: true,
            currentCount: currentNeighborhood.length,
            selectedCount: selectedNeighborhood.length,
            sharedCount: sharedEvents.length,
            sharedEvents,
            primaryRoute,
            detail: sharedEvents.length
                ? 'Shared staged events indicate overlap between the current replay context and the selected event neighborhood.'
                : 'The current and selected event neighborhoods diverge under the staged replay rows currently loaded.'
        };
    }

    function eventTouchesContext(event = {}, route = '', token = 'all', wallets = new Set()) {
        const eventRoute = getRouteKey(event);
        const eventToken = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
        if (route && eventRoute === route) return true;
        if (token && token !== 'all' && eventToken === token) return true;
        if (!wallets.size) return false;
        const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
        const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
        return wallets.has(source) || wallets.has(destination);
    }

    function getEventWalletSet(event = {}) {
        return new Set([
            normalizeAddressFilter(event.sourceWallet || event.source_wallet),
            normalizeAddressFilter(event.destinationWallet || event.destination_wallet)
        ].filter(value => value && value !== 'all'));
    }

    function matchesClusterFocus(event = {}, focus = {}, clusters = {}, selectedEvent = null) {
        const clusterItems = [
            ...(clusters.counterparties || []),
            ...(clusters.routes || []),
            ...(clusters.tokens || []),
            ...(clusters.hotspots || [])
        ];
        const selectedRoute = selectedEvent ? getRouteKey(selectedEvent) : '';
        const selectedToken = selectedEvent ? normalizeTokenFilter(selectedEvent.token || selectedEvent.symbol || selectedEvent.token_mint) : 'all';
        const selectedWallets = selectedEvent
            ? [selectedEvent.sourceWallet || selectedEvent.source_wallet, selectedEvent.destinationWallet || selectedEvent.destination_wallet].map(normalizeAddressFilter)
            : [];
        const cluster = focus.clusterKey
            ? clusterItems.find(item => item.key === focus.clusterKey)
            : clusterItems.find(item => item.route === selectedRoute || (selectedToken !== 'all' && item.token === selectedToken) || selectedWallets.includes(item.wallet));
        if (!cluster) return false;
        const step = Number(event.step) || 0;
        return (cluster.steps || []).includes(step);
    }

    function getNeighborhoodTitle(focus = {}, event = null) {
        if (focus.mode === 'wallet') return `Wallet ${shortValue(focus.wallet)}`;
        if (focus.mode === 'counterparties') return 'Related Counterparties';
        if (focus.mode === 'route') return 'Same Route';
        if (focus.mode === 'token') return `Token ${focus.token}`;
        if (focus.mode === 'cluster') return 'Replay Cluster';
        if (focus.mode === 'transfer' && event) return `Step ${event.step || '-'}`;
        return 'Local Staged Neighborhood';
    }

    function getNeighborhoodDetail(focus = {}, count = 0) {
        const suffix = `${count} staged event${count === 1 ? '' : 's'} matched.`;
        if (focus.mode === 'none') return 'Select expansion actions to stage a bounded local replay neighborhood.';
        return `${suffix} This is a replay-only expansion and does not modify Wallet Lookup.`;
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

    function normalizeSelectedEvent(selectedEvent = null, currentEvent = null, events = []) {
        const selectedStep = Number(selectedEvent?.step || selectedEvent?.selectedStep || 0) || 0;
        if (selectedStep) {
            const match = events.find(event => Number(event.step) === selectedStep);
            return normalizeEvent(match || selectedEvent, selectedStep - 1);
        }
        if (selectedEvent?.signature) {
            const match = events.find(event => event.signature === selectedEvent.signature);
            return normalizeEvent(match || selectedEvent, (match?.step || selectedEvent.step || 1) - 1);
        }
        return currentEvent || null;
    }

    function normalizeAuditFilters(filters = {}) {
        return {
            token: String(filters.token || DEFAULT_AUDIT_FILTERS.token),
            direction: String(filters.direction || DEFAULT_AUDIT_FILTERS.direction),
            counterparty: String(filters.counterparty || DEFAULT_AUDIT_FILTERS.counterparty),
            majorOnly: filters.majorOnly === true || filters.majorOnly === 'true'
        };
    }

    function normalizeReplayWindowStatus(windowStatus = {}) {
        const status = windowStatus && typeof windowStatus === 'object' && !Array.isArray(windowStatus) ? windowStatus : {};
        const continuation = status.continuation && typeof status.continuation === 'object' && !Array.isArray(status.continuation)
            ? status.continuation
            : {};
        const boundary = status.boundary && typeof status.boundary === 'object' && !Array.isArray(status.boundary)
            ? status.boundary
            : {};
        const currentWindowIndex = Math.max(0, Number(status.currentWindowIndex || status.current_window_index || status.windowIndex || status.window_index) || 0);
        const windowCount = Math.max(0, Number(status.windowCount || status.total_windows || status.totalWindows) || 0);
        return {
            ...status,
            id: String(status.id || status.window_id || status.windowId || ''),
            windowId: String(status.windowId || status.window_id || status.id || ''),
            scanId: String(status.scanId || status.scan_id || ''),
            currentWindowIndex,
            windowIndex: currentWindowIndex,
            windowCount,
            totalWindows: windowCount,
            windowStart: Math.max(0, Number(status.windowStart || status.ordinal_start || status.ordinalStart) || 0),
            windowEnd: Math.max(0, Number(status.windowEnd || status.ordinal_end || status.ordinalEnd) || 0),
            windowLabel: String(status.windowLabel || status.window_label || ''),
            rangePosition: String(status.rangePosition || status.range_position || ''),
            chunkSize: Math.max(0, Number(status.chunkSize || status.chunk_size) || 0),
            renderCap: Math.max(0, Number(status.renderCap || status.render_cap_transactions) || 0),
            partial: status.partial === true,
            oldestFirstReady: status.oldestFirstReady === true || status.oldest_first_ready === true,
            oldestFirstRequired: status.oldestFirstRequired === true || status.oldest_first_reconstruction_required === true,
            progressiveExpansion: status.progressiveExpansion === true || status.progressive_expansion_available === true,
            canContinueOlder: status.canContinueOlder === true || continuation.can_continue_older === true,
            canContinueNewer: status.canContinueNewer === true || continuation.can_continue_newer === true,
            olderRequiresProviderPage: status.olderRequiresProviderPage === true || continuation.older_requires_provider_page === true,
            newerRequiresProviderPage: status.newerRequiresProviderPage === true || continuation.newer_requires_provider_page === true,
            olderWindowIndex: Math.max(0, Number(status.olderWindowIndex || continuation.older_window_index) || 0),
            newerWindowIndex: Math.max(0, Number(status.newerWindowIndex || continuation.newer_window_index) || 0),
            boundary,
            continuityConfidence: normalizeReplayContinuityProfile(status.continuityConfidence || status.continuity_confidence || null),
            gapMap: normalizeReplayGapMap(status.gapMap || status.gap_map || null),
            timelineSegments: Array.isArray(status.timelineSegments)
                ? status.timelineSegments
                : Array.isArray(status.timeline_segments)
                    ? status.timeline_segments
                    : [],
            continuityWarning: String(status.continuityWarning || status.continuity_warning || ''),
            warnings: Array.isArray(status.warnings) ? status.warnings.slice(0, 8) : []
        };
    }

    function buildReplayCheckpoint(context = {}) {
        const status = context.status || {};
        const windowStatus = normalizeReplayWindowStatus(context.windowStatus || {});
        const filters = normalizeAuditFilters(context.auditFilters || context.filters || context.audit?.filters || {});
        const selectedEvent = context.selectedEvent || status.selectedEvent || status.currentEvent || null;
        const selectedStep = Math.max(0, Number(context.selectedStep || status.selectedStep || selectedEvent?.step || status.currentStep) || 0);
        return normalizeReplayCheckpoint({
            version: REPLAY_CHECKPOINT_VERSION,
            savedAt: new Date().toISOString(),
            reason: context.reason || 'manual',
            scanId: context.scanId || windowStatus.scanId || status.scanId || '',
            wallet: context.wallet || '',
            currentStep: Math.max(0, Number(status.currentStep) || 0),
            selectedStep,
            totalSteps: Math.max(0, Number(context.totalSteps || status.totalSteps) || 0),
            windowId: windowStatus.windowId,
            windowIndex: windowStatus.currentWindowIndex,
            windowLabel: windowStatus.windowLabel,
            filters,
            selectedCounterparty: filters.counterparty !== 'all' ? filters.counterparty : '',
            selectedToken: filters.token !== 'all' ? filters.token : '',
            neighborhood: normalizeNeighborhoodFocus(context.neighborhood || context.audit?.neighborhood || {}),
            selectedBookmarkKey: context.selectedBookmarkKey || '',
            selectedSignature: selectedEvent?.signature || '',
            breadcrumbs: normalizeAuditBreadcrumbs(context.breadcrumbs || context.audit?.breadcrumbs || []),
            recentSteps: Array.isArray(context.recentEvents || context.audit?.recentSteps)
                ? (context.recentEvents || context.audit?.recentSteps).slice(0, 8)
                : [],
            boundary: {
                previewOnly: true,
                stagedHistoryOnly: true,
                workerBacked: true,
                activeGraphUnchanged: true,
                noFullHistoryClaim: true
            }
        });
    }

    function normalizeReplayCheckpoint(checkpoint = null) {
        if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
        return {
            version: String(checkpoint.version || REPLAY_CHECKPOINT_VERSION),
            savedAt: String(checkpoint.savedAt || checkpoint.saved_at || ''),
            reason: String(checkpoint.reason || ''),
            scanId: String(checkpoint.scanId || checkpoint.scan_id || ''),
            wallet: String(checkpoint.wallet || ''),
            currentStep: Math.max(0, Number(checkpoint.currentStep || checkpoint.current_step) || 0),
            selectedStep: Math.max(0, Number(checkpoint.selectedStep || checkpoint.selected_step) || 0),
            totalSteps: Math.max(0, Number(checkpoint.totalSteps || checkpoint.total_steps) || 0),
            windowId: String(checkpoint.windowId || checkpoint.window_id || ''),
            windowIndex: Math.max(0, Number(checkpoint.windowIndex || checkpoint.window_index) || 0),
            windowLabel: String(checkpoint.windowLabel || checkpoint.window_label || ''),
            filters: normalizeAuditFilters(checkpoint.filters || checkpoint.auditFilters || {}),
            selectedCounterparty: String(checkpoint.selectedCounterparty || checkpoint.selected_counterparty || ''),
            selectedToken: String(checkpoint.selectedToken || checkpoint.selected_token || ''),
            neighborhood: normalizeNeighborhoodFocus(checkpoint.neighborhood || {}),
            selectedBookmarkKey: String(checkpoint.selectedBookmarkKey || checkpoint.selected_bookmark_key || ''),
            selectedSignature: String(checkpoint.selectedSignature || checkpoint.selected_signature || ''),
            breadcrumbs: normalizeAuditBreadcrumbs(checkpoint.breadcrumbs || []),
            recentSteps: Array.isArray(checkpoint.recentSteps || checkpoint.recent_steps)
                ? (checkpoint.recentSteps || checkpoint.recent_steps).map(step => Math.max(0, Number(step?.step || step) || 0)).filter(Boolean).slice(0, 8)
                : [],
            boundary: {
                previewOnly: checkpoint.boundary?.previewOnly !== false,
                stagedHistoryOnly: checkpoint.boundary?.stagedHistoryOnly !== false,
                workerBacked: checkpoint.boundary?.workerBacked !== false,
                activeGraphUnchanged: checkpoint.boundary?.activeGraphUnchanged !== false,
                noFullHistoryClaim: checkpoint.boundary?.noFullHistoryClaim !== false
            }
        };
    }

    function filterReplayEvents(events = [], filters = DEFAULT_AUDIT_FILTERS) {
        const safeFilters = normalizeAuditFilters(filters);
        const threshold = getMajorFlowThreshold(events);
        return events.filter(event => eventMatchesFilters(event, safeFilters, threshold));
    }

    function eventMatchesFilters(event = {}, filters = DEFAULT_AUDIT_FILTERS, majorThreshold = 0) {
        const token = normalizeTokenFilter(filters.token);
        if (token !== 'all' && normalizeTokenFilter(event.token) !== token) return false;
        const direction = normalizeDirectionFilter(filters.direction);
        if (direction !== 'all' && normalizeDirectionFilter(event.direction) !== direction) return false;
        const counterparty = normalizeAddressFilter(filters.counterparty);
        if (counterparty !== 'all') {
            const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
            const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
            if (source !== counterparty && destination !== counterparty) return false;
        }
        if (filters.majorOnly && !(Number(event.amountValue ?? getAmountValue(event)) >= majorThreshold && majorThreshold > 0)) return false;
        return true;
    }

    function hasActiveReplayFilters(filters = DEFAULT_AUDIT_FILTERS) {
        const safeFilters = normalizeAuditFilters(filters);
        return safeFilters.token !== 'all'
            || safeFilters.direction !== 'all'
            || safeFilters.counterparty !== 'all'
            || safeFilters.majorOnly;
    }

    function getReplayFilterOptions(events = []) {
        const tokenCounts = new Map();
        const directionCounts = new Map();
        const counterpartyCounts = new Map();
        events.forEach(event => {
            const token = String(event.token || '').trim();
            if (token) incrementOption(tokenCounts, normalizeTokenFilter(token), token);
            const direction = String(event.direction || '').trim();
            if (direction) incrementOption(directionCounts, normalizeDirectionFilter(direction), formatDirectionLabel(direction));
            [event.sourceWallet, event.destinationWallet].forEach(wallet => {
                const normalized = normalizeAddressFilter(wallet);
                if (normalized && normalized !== 'all') incrementOption(counterpartyCounts, normalized, shortValue(wallet));
            });
        });
        return {
            tokens: [
                { value: 'all', label: 'All tokens' },
                ...sortOptions(tokenCounts)
            ],
            directions: [
                { value: 'all', label: 'All directions' },
                ...sortOptions(directionCounts)
            ],
            counterparties: [
                { value: 'all', label: 'All wallets' },
                ...sortOptions(counterpartyCounts).slice(0, 48)
            ]
        };
    }

    function deriveReplayRelationships(selectedEvent = null, events = []) {
        if (!selectedEvent) {
            return {
                sameCounterparty: [],
                sameToken: [],
                nearbyTime: [],
                repeatedRoute: [],
                previousRelated: null,
                nextRelated: null,
                totalRelated: 0
            };
        }
        const selectedStep = Number(selectedEvent.step) || 0;
        const selectedWallets = new Set([
            normalizeAddressFilter(selectedEvent.sourceWallet || selectedEvent.source_wallet),
            normalizeAddressFilter(selectedEvent.destinationWallet || selectedEvent.destination_wallet)
        ].filter(value => value && value !== 'all'));
        const selectedToken = normalizeTokenFilter(selectedEvent.token || selectedEvent.symbol || selectedEvent.token_mint);
        const selectedRoute = getRouteKey(selectedEvent);
        const selectedTime = Number(selectedEvent.timestampMs) || getTimestampMs(selectedEvent.timestamp);
        const withoutSelected = events.filter(event => Number(event.step) !== selectedStep);
        const sameCounterparty = withoutSelected.filter(event => {
            const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
            const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
            return selectedWallets.has(source) || selectedWallets.has(destination);
        });
        const sameToken = selectedToken === 'all'
            ? []
            : withoutSelected.filter(event => normalizeTokenFilter(event.token || event.symbol || event.token_mint) === selectedToken);
        const repeatedRoute = selectedRoute
            ? withoutSelected.filter(event => getRouteKey(event) === selectedRoute)
            : [];
        const nearbyTime = selectedTime
            ? withoutSelected.filter(event => {
                const value = Number(event.timestampMs) || getTimestampMs(event.timestamp);
                return value && Math.abs(value - selectedTime) <= 1000 * 60 * 60 * 24;
            }).sort((a, b) => Math.abs((a.timestampMs || getTimestampMs(a.timestamp)) - selectedTime) - Math.abs((b.timestampMs || getTimestampMs(b.timestamp)) - selectedTime))
            : [];
        const related = uniqueEvents([...sameCounterparty, ...sameToken, ...nearbyTime, ...repeatedRoute])
            .sort((a, b) => Number(a.step) - Number(b.step));
        return {
            sameCounterparty: sameCounterparty.slice(0, 8),
            sameToken: sameToken.slice(0, 8),
            nearbyTime: nearbyTime.slice(0, 8),
            repeatedRoute: repeatedRoute.slice(0, 8),
            previousRelated: related.filter(event => Number(event.step) < selectedStep).pop() || null,
            nextRelated: related.find(event => Number(event.step) > selectedStep) || null,
            totalRelated: related.length
        };
    }

    function normalizeAuditBreadcrumbs(breadcrumbs = []) {
        return breadcrumbs
            .filter(Boolean)
            .map((crumb, index) => ({
                id: crumb.id || `crumb-${index}-${crumb.step || 0}`,
                label: crumb.label || `Step ${crumb.step || '-'}`,
                title: crumb.title || crumb.route || crumb.label || '',
                step: Number(crumb.step) || 0,
                sourceWallet: crumb.sourceWallet || '',
                destinationWallet: crumb.destinationWallet || ''
            }))
            .slice(-7);
    }

    function normalizeRecentEvents(recentEvents = [], events = []) {
        const byStep = new Map(events.map(event => [Number(event.step) || 0, event]));
        return recentEvents
            .map(item => {
                const step = Number(item?.step || item) || 0;
                return byStep.get(step) || (typeof item === 'object' ? normalizeEvent(item, step - 1) : null);
            })
            .filter(Boolean)
            .filter((event, index, list) => list.findIndex(item => Number(item.step) === Number(event.step)) === index)
            .slice(-6)
            .reverse();
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

    function incrementOption(map, value, label) {
        const key = String(value || '').trim();
        if (!key) return;
        const current = map.get(key) || { value: key, label: String(label || key), count: 0 };
        current.count += 1;
        map.set(key, current);
    }

    function sortOptions(map) {
        return [...map.values()]
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .map(item => ({
                value: item.value,
                label: `${item.label} (${item.count})`
            }));
    }

    function ensureSelectedOption(options = [], selectedValue = 'all') {
        const safeOptions = Array.isArray(options) && options.length ? options.slice() : [{ value: 'all', label: 'All' }];
        const value = String(selectedValue || 'all');
        if (safeOptions.some(option => String(option.value) === value)) return safeOptions;
        return [...safeOptions, { value, label: value === 'all' ? 'All' : `${shortValue(value)} (filtered)` }];
    }

    function deriveBreadcrumbChain(breadcrumbs = []) {
        const wallets = [];
        breadcrumbs.forEach(crumb => {
            const source = crumb.sourceWallet || '';
            const destination = crumb.destinationWallet || '';
            if (source && wallets[wallets.length - 1] !== source) wallets.push(source);
            if (destination && wallets[wallets.length - 1] !== destination) wallets.push(destination);
        });
        return wallets.slice(-5).map(shortValue).join(' -> ');
    }

    function getMajorFlowThreshold(events = []) {
        const amounts = events
            .map(event => Number(event.amountValue ?? getAmountValue(event)) || 0)
            .filter(value => value > 0)
            .sort((a, b) => a - b);
        if (!amounts.length) return 0;
        const index = Math.max(0, Math.floor(amounts.length * 0.75));
        return amounts[Math.min(amounts.length - 1, index)] || amounts[amounts.length - 1] || 0;
    }

    function uniqueEvents(events = []) {
        const seen = new Set();
        const result = [];
        events.forEach(event => {
            const key = event.signature || `${event.step || ''}|${event.sourceWallet || ''}|${event.destinationWallet || ''}|${event.token || ''}`;
            if (!key || seen.has(key)) return;
            seen.add(key);
            result.push(event);
        });
        return result;
    }

    function getRouteKey(event = {}) {
        const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
        const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
        if (!source || !destination || source === 'all' || destination === 'all') return '';
        return `${source}>${destination}`;
    }

    function normalizeTokenFilter(value = '') {
        const text = String(value || '').trim();
        if (!text || text.toLowerCase() === 'all') return 'all';
        return text ? text.toUpperCase() : 'all';
    }

    function normalizeDirectionFilter(value = '') {
        const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (!text || text === 'all') return 'all';
        return text || 'all';
    }

    function normalizeAddressFilter(value = '') {
        const text = String(value || '').trim();
        if (!text || text.toLowerCase() === 'all') return 'all';
        return text || 'all';
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

    function formatHistoryLikeFlag(value = '') {
        const text = String(value || '').trim().replaceAll('_', ' ');
        if (!text) return 'Replay gap';
        return text.replace(/\b\w/g, letter => letter.toUpperCase());
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
        normalizeAuditFilters,
        normalizeReplayWindowStatus,
        deriveReplayGapMap,
        deriveReplayContinuityProfile,
        deriveReplayClusters,
        deriveReplayNeighborhood,
        normalizeReplayGapMap,
        normalizeReplayContinuityProfile,
        buildReplayCheckpoint,
        normalizeReplayCheckpoint,
        filterReplayEvents,
        getReplayFilterOptions,
        deriveReplayRelationships,
        hasActiveReplayFilters,
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
