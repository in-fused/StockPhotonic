(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const REPLAY_WORKSPACE_VERSION = 'd136_gap_mapping_counterparty_expansion_workspace_ui_v1';
    const REPLAY_CHECKPOINT_VERSION = 'd135_replay_audit_checkpoint_v1';
    const REPLAY_GAP_MAP_VERSION = 'd136_replay_gap_map_v1';
    const REPLAY_CONTINUITY_VERSION = 'd136_staged_continuity_confidence_v1';
    const REPLAY_CLUSTER_VERSION = 'd136_replay_cluster_v1';
    const REPLAY_NEIGHBORHOOD_VERSION = 'd136_replay_neighborhood_v1';
    const REPLAY_INTELLIGENCE_VERSION = 'd199_cross_market_crypto_investigation_v1';
    const REPLAY_CORRIDOR_VERSION = 'd209_replay_corridor_intelligence_v1';
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
        maxCounterpartyClusters: 6,
        maxNarratives: 7,
        maxReasoningChips: 9,
        maxFlowSummaryItems: 4,
        maxLineageItems: 8,
        maxCorridors: 6,
        maxCorridorTransitions: 7,
        maxCongestionZones: 4,
        maxTraversalHints: 4
    });
    const replayIntelligenceCache = {
        key: '',
        value: null
    };

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
        const investigationLineage = deriveReplayInvestigationLineage({
            events,
            currentEvent,
            selectedEvent,
            filteredEvents,
            relationships,
            breadcrumbs,
            recentEvents,
            neighborhood,
            clusters,
            routeComparison,
            currentStep,
            totalSteps,
            investigationStack: context.investigationStack,
            flowLineage: context.flowLineage
        });
        const eventSummary = summarizeReplayEvent(selectedEvent || currentEvent, {
            status,
            totalSteps,
            confidence: continuityProfile.score ?? context.confidence ?? status.completenessConfidence,
            warning: context.warning || status.warning || (Array.isArray(context.warnings) ? context.warnings[0] : '')
        });
        const oldestLabel = context.oldestLabel || getTimelineBoundaryLabel(events, 'oldest') || 'Oldest staged';
        const newestLabel = context.newestLabel || getTimelineBoundaryLabel(events, 'newest') || 'Newest staged';
        const progressPct = totalSteps ? Math.round((currentStep / totalSteps) * 100) : Math.max(0, Math.min(100, Number(context.progressPct) || 0));
        const graphTimeline = window.StockPhotonicGraph?.timeline?.buildReplayTimeline?.({
            events,
            bookmarks,
            currentStep,
            totalSteps
        }) || { markers: [], currentStep, totalSteps };
        const replayIntelligence = deriveReplayIntelligence({
            events,
            currentEvent,
            selectedEvent,
            gapMap,
            continuityProfile,
            clusters,
            neighborhood,
            routeComparison,
            graphTimeline,
            currentStep,
            totalSteps,
            auditFilters,
            filteredEvents,
            breadcrumbs,
            recentEvents,
            investigationLineage,
            relationships
        });

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
            investigationLineage,
            checkpoint,
            eventSummary,
            bookmarks,
            majorNavigation,
            graphTimeline,
            replayIntelligence,
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
        const replayIntelligence = context.replayIntelligence || {};
        const continuityViewVisible = context.continuityViewVisible !== false;
        const corridorOverlayVisible = context.corridorOverlayVisible !== false;
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
                    ${renderReplayGraphChronology(context.graphTimeline, scrubberDisabled)}
                    <div id="crypto-replay-workspace-current-summary" class="crypto-replay-current-summary">${escapeHtml(eventSummary.compact || 'No replay event selected yet.')}</div>
                    ${renderReplayHandoffCues(context, scrubberDisabled)}
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
                ${continuityViewVisible ? renderReplayContinuityPanel(continuityProfile, gapMap) : ''}
                ${renderReplayIntelligencePanel(replayIntelligence, {
                    visible: context.narrativesVisible !== false,
                    corridorsVisible: corridorOverlayVisible
                })}
                <div class="crypto-replay-bookmark-strip" aria-label="Replay bookmarks">
                    ${bookmarks.map(bookmark => renderBookmark(bookmark, currentBookmarkStep, scrubberDisabled)).join('') || '<div class="crypto-replay-bookmark-empty">Build replay steps to derive bookmarks.</div>'}
                </div>
                ${renderAuditFilters(context.auditFilters, filterOptions, filteredEvents.length, totalSteps, scrubberDisabled)}
                ${renderAuditBreadcrumbs(breadcrumbs, recentEvents)}
                ${renderReplayInvestigationStack(context.investigationLineage, scrubberDisabled)}
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

    function renderReplayHandoffCues(context = {}, scrubberDisabled = false) {
        const totalSteps = Math.max(0, Number(context.totalSteps) || 0);
        const currentStep = Math.max(0, Number(context.currentStep) || 0);
        const profile = context.replayIntelligence?.corridorProfile || {};
        const lineage = context.investigationLineage || {};
        const jumpBack = Array.isArray(lineage.jumpBackActions) ? lineage.jumpBackActions[0] : null;
        const clusters = context.clusters || {};
        const cues = [
            {
                label: 'Next Event',
                detail: totalSteps ? `${Math.min(totalSteps, currentStep + 1)}/${totalSteps}` : 'Build dataset first',
                icon: 'fa-forward-step',
                selectStep: Math.min(totalSteps, currentStep + 1),
                disabled: scrubberDisabled || !totalSteps || currentStep >= totalSteps,
                title: 'Move to the next staged replay event.'
            },
            {
                label: 'Next Corridor',
                detail: profile.nextCorridorStep ? `Step ${profile.nextCorridorStep}` : 'No visible transition',
                icon: 'fa-road',
                action: 'next-corridor',
                disabled: scrubberDisabled || !profile.nextCorridorStep,
                title: 'Move to the next visible replay corridor transition. Chronology only.'
            },
            {
                label: 'Lineage Back',
                detail: jumpBack?.step ? `Step ${jumpBack.step}` : 'No prior focus',
                icon: 'fa-rotate-left',
                selectStep: jumpBack?.step || 0,
                disabled: scrubberDisabled || !jumpBack?.step,
                title: 'Jump back to the previous session-only replay focus.'
            },
            {
                label: 'Cluster',
                detail: clusters.total ? `${clusters.total} repeated cues` : 'No cluster',
                icon: 'fa-object-group',
                action: 'focus-cluster',
                disabled: scrubberDisabled || !clusters.total,
                title: 'Focus repeated staged replay patterns when available.'
            }
        ];
        return `
            <div class="crypto-replay-handoff" aria-label="Replay next actions">
                ${cues.map(renderReplayHandoffButton).join('')}
            </div>
        `;
    }

    function renderReplayHandoffButton(cue = {}) {
        const attrs = cue.selectStep
            ? `data-crypto-replay-select-step="${escapeAttr(cue.selectStep)}" data-crypto-replay-select-source="handoff"`
            : cue.action
                ? `data-crypto-replay-action="${escapeAttr(cue.action)}"`
                : '';
        return `
            <button type="button" ${attrs} ${cue.disabled ? 'disabled' : ''} title="${escapeAttr(cue.title || cue.detail || cue.label)}">
                <i class="fa-solid ${escapeAttr(cue.icon || 'fa-arrow-right')}"></i>
                <span>
                    <strong>${escapeHtml(cue.label || 'Next')}</strong>
                    <small>${escapeHtml(cue.detail || '')}</small>
                </span>
            </button>
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

    function renderReplayGraphChronology(graphTimeline = {}, scrubberDisabled = false) {
        const markers = Array.isArray(graphTimeline.markers) ? graphTimeline.markers.slice(0, 10) : [];
        if (!markers.length) return '';
        return `
            <div class="crypto-replay-graph-chronology" aria-label="Replay graph chronology">
                ${markers.map(marker => `
                    <button type="button"
                        data-crypto-replay-jump-step="${escapeAttr(marker.step)}"
                        class="${marker.active ? 'is-active' : ''}"
                        ${scrubberDisabled ? 'disabled' : ''}
                        title="${escapeAttr(marker.label)}">
                        <span style="left:${escapeAttr(marker.positionPct || 0)}%" aria-hidden="true"></span>
                        <strong>${escapeHtml(marker.label)}</strong>
                    </button>
                `).join('')}
            </div>
        `;
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

    function renderReplayIntelligencePanel(intelligence = {}, options = {}) {
        if (!intelligence || !intelligence.version) return '';
        const visible = options.visible !== false;
        const corridorsVisible = options.corridorsVisible !== false;
        const narratives = Array.isArray(intelligence.narratives) ? intelligence.narratives.slice(0, REPLAY_EXPANSION_CAPS.maxNarratives) : [];
        const summaryItems = Array.isArray(intelligence.summaryItems) ? intelligence.summaryItems.slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems) : [];
        const reasoningChips = (Array.isArray(intelligence.reasoningChips) && intelligence.reasoningChips.length
            ? intelligence.reasoningChips
            : intelligence.chips || []).slice(0, REPLAY_EXPANSION_CAPS.maxReasoningChips);
        return `
            <section class="crypto-replay-intelligence-panel ${visible ? '' : 'is-collapsed'}" aria-label="Replay investigation intelligence">
                <div class="crypto-replay-intelligence-head">
                    <span>Replay Intelligence</span>
                    <strong>${escapeHtml(intelligence.focusLabel || 'Staged replay')}</strong>
                    <button type="button" data-crypto-replay-action="toggle-narratives" aria-pressed="${visible ? 'true' : 'false'}" title="${escapeAttr(visible ? 'Hide compact replay narratives' : 'Show compact replay narratives')}">${escapeHtml(visible ? 'Hide' : 'Show')}</button>
                </div>
                <div class="crypto-replay-intelligence-copy">${escapeHtml(intelligence.narrative || 'Replay intelligence is derived from staged transfer metadata only.')}</div>
                ${visible ? `
                    <div class="crypto-replay-narrative-stack" aria-label="Replay investigation narratives">
                        ${narratives.map(item => `
                            <article class="crypto-replay-narrative-row is-${escapeAttr(item.kind || 'note')}">
                                <div>
                                    <span>${escapeHtml(item.title || 'Replay note')}</span>
                                    <p>${escapeHtml(item.body || '')}</p>
                                </div>
                                ${item.badge ? `<strong>${escapeHtml(item.badge)}</strong>` : ''}
                            </article>
                        `).join('')}
                    </div>
                    <div class="crypto-replay-summary-grid" aria-label="Replay flow summary">
                        ${summaryItems.map(item => `
                            <div>
                                <span>${escapeHtml(item.label || '')}</span>
                                <strong title="${escapeAttr(item.title || item.value || '')}">${escapeHtml(item.value || '-')}</strong>
                            </div>
                        `).join('')}
                    </div>
                    ${corridorsVisible ? renderReplayCorridorPanel(intelligence.corridorProfile) : '<div class="crypto-replay-intelligence-copy is-muted">Corridor overlay hidden. Replay continuity and event controls remain session-only.</div>'}
                ` : '<div class="crypto-replay-intelligence-copy is-muted">Narratives hidden. Reasoning chips and replay controls remain active.</div>'}
                <div class="crypto-replay-intelligence-metrics">
                    <span><strong>${escapeHtml(String(intelligence.corridorCount ?? intelligence.routeCount ?? 0))}</strong><small>corridors</small></span>
                    <span><strong>${escapeHtml(String(intelligence.bridgeWalletCount || 0))}</strong><small>bridges</small></span>
                    <span><strong>${escapeHtml(intelligence.concentrationLabel || '0%')}</strong><small>token zone</small></span>
                    <span><strong>${escapeHtml(intelligence.chronologyLabel || '0/0')}</strong><small>step</small></span>
                </div>
                <div class="crypto-replay-intelligence-chips graph-reasoning-chips is-reasoning">
                    ${reasoningChips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}
                </div>
            </section>
        `;
    }

    function renderReplayCorridorPanel(profile = {}) {
        if (!profile || !profile.version) return '';
        const corridors = Array.isArray(profile.corridors) ? profile.corridors.slice(0, REPLAY_EXPANSION_CAPS.maxCorridors) : [];
        const congestion = Array.isArray(profile.congestionZones) ? profile.congestionZones.slice(0, REPLAY_EXPANSION_CAPS.maxCongestionZones) : [];
        const breadcrumbs = Array.isArray(profile.progressionBreadcrumbs) ? profile.progressionBreadcrumbs.slice(0, REPLAY_EXPANSION_CAPS.maxCorridorTransitions) : [];
        const hints = Array.isArray(profile.focusHints) ? profile.focusHints.slice(0, REPLAY_EXPANSION_CAPS.maxTraversalHints) : [];
        return `
            <section class="crypto-replay-corridor-panel graph-continuity-chrome" aria-label="Replay corridor intelligence">
                <div class="crypto-replay-related-header">
                    <span>Corridor Intelligence</span>
                    <strong>${escapeHtml(profile.continuityConfidence || 'staged only')}</strong>
                </div>
                <div class="crypto-replay-corridor-grid">
                    ${renderCorridorMetric('Dominant', profile.dominantLabel || 'No repeat', profile.dominantDetail || 'No repeated corridor visible')}
                    ${renderCorridorMetric('Transition', profile.transitionSignificance || 'No transition', profile.transitionDetail || 'Current route transition is not visible')}
                    ${renderCorridorMetric('Congestion', profile.congestionLabel || 'No zone', profile.congestionDetail || 'No repeated step zone visible')}
                    ${renderCorridorMetric('Overlap', profile.overlapLabel || 'No overlap', profile.overlapDetail || 'No route overlap visible')}
                </div>
                <div class="crypto-replay-corridor-strip graph-traversal-chrome" aria-label="Repeated replay corridors">
                    ${corridors.map(corridor => `
                        <button type="button"
                            data-crypto-replay-action="focus-corridor"
                            data-crypto-replay-route="${escapeAttr(corridor.key || '')}"
                            data-crypto-replay-step="${escapeAttr(corridor.focusStep || corridor.firstStep || 0)}"
                            title="${escapeAttr(corridor.detail || corridor.label || '')}">
                            <span>${escapeHtml(corridor.label || 'Corridor')}</span>
                            <strong>${escapeHtml(`${corridor.count || 0} rows`)}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">No repeated replay pathway is visible in the staged window.</div>'}
                </div>
                <div class="crypto-replay-progression-breadcrumbs" aria-label="Replay corridor transitions">
                    ${breadcrumbs.map(item => `
                        <button type="button"
                            data-crypto-replay-select-step="${escapeAttr(item.step || 0)}"
                            data-crypto-replay-select-source="corridor-transition"
                            title="${escapeAttr(item.title || item.label || '')}">
                            <span>${escapeHtml(item.label || 'Transition')}</span>
                            <strong>#${escapeHtml(item.step || '-')}</strong>
                        </button>
                    `).join('') || '<div class="crypto-replay-empty-compact">Corridor-to-corridor transitions are not visible in this staged range.</div>'}
                </div>
                <div class="crypto-replay-corridor-zones" aria-label="Replay congestion and traversal hints">
                    ${congestion.map(zone => `<span title="${escapeAttr(zone.detail || '')}">${escapeHtml(zone.label || 'Zone')} <strong>${escapeHtml(String(zone.count || 0))}</strong></span>`).join('')}
                    ${hints.map(hint => `<span>${escapeHtml(hint)}</span>`).join('')}
                </div>
            </section>
        `;
    }

    function renderCorridorMetric(label, value, title = '') {
        return `
            <div title="${escapeAttr(title || value || label)}">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value || '-')}</strong>
            </div>
        `;
    }

    function renderReplayInvestigationStack(lineage = {}, disabled = false) {
        const stack = Array.isArray(lineage.stack) ? lineage.stack.slice(0, REPLAY_EXPANSION_CAPS.maxLineageItems) : [];
        const jumpBack = Array.isArray(lineage.jumpBackActions) ? lineage.jumpBackActions.slice(0, 6) : [];
        const flowLineage = Array.isArray(lineage.flowLineage) ? lineage.flowLineage.slice(0, 6) : [];
        if (!stack.length && !jumpBack.length && !flowLineage.length) {
            return `
                <section class="crypto-replay-lineage-panel is-empty" aria-label="Replay investigation stack">
                    <div class="crypto-replay-related-header">
                        <span>Replay Lineage</span>
                        <strong>session-only</strong>
                    </div>
                    <div class="crypto-replay-empty-compact">Select replay transfers to build jump-back lineage for this session.</div>
                </section>
            `;
        }
        const renderLineageButton = (item, source) => `
            <button type="button"
                data-crypto-replay-select-step="${escapeAttr(item.step || 0)}"
                data-crypto-replay-select-source="${escapeAttr(source)}"
                ${disabled || !item.step ? 'disabled' : ''}
                title="${escapeAttr(item.title || item.detail || item.label || '')}">
                <span>${escapeHtml(item.label || `Step ${item.step || '-'}`)}</span>
                <strong>${escapeHtml(item.detail || (item.step ? `#${item.step}` : 'session'))}</strong>
            </button>
        `;
        return `
            <section class="crypto-replay-lineage-panel" aria-label="Replay investigation stack">
                <div class="crypto-replay-related-header">
                    <span>Replay Lineage</span>
                    <strong>${escapeHtml(lineage.neighborhoodContinuity || 'session-only')}</strong>
                </div>
                <div class="crypto-replay-lineage-group">
                    <span>Stack</span>
                    <div class="crypto-replay-lineage-strip graph-investigation-lineage">
                        ${stack.map(item => renderLineageButton(item, 'investigation-stack')).join('') || '<div class="crypto-replay-empty-compact">No replay stack entries yet.</div>'}
                    </div>
                </div>
                <div class="crypto-replay-lineage-group">
                    <span>Jump Back</span>
                    <div class="crypto-replay-lineage-strip graph-investigation-lineage">
                        ${jumpBack.map(item => renderLineageButton(item, 'jump-back')).join('') || '<div class="crypto-replay-empty-compact">No previous replay focus in this session.</div>'}
                    </div>
                </div>
                <div class="crypto-replay-lineage-group">
                    <span>Flow Lineage</span>
                    <div class="crypto-replay-lineage-strip graph-investigation-lineage">
                        ${flowLineage.map(item => renderLineageButton(item, 'flow-lineage')).join('') || '<div class="crypto-replay-empty-compact">No flow lineage selected yet.</div>'}
                    </div>
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
        root.querySelectorAll('[data-crypto-replay-jump-step]').forEach(button => {
            button.addEventListener('click', () => {
                handlers.seek?.(Number(button.dataset.cryptoReplayJumpStep) || 0, {
                    source: 'graph-chronology'
                });
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

    function deriveReplayIntelligence(context = {}) {
        const events = Array.isArray(context.events) ? context.events : [];
        const currentEvent = context.currentEvent || null;
        const selectedEvent = context.selectedEvent || currentEvent;
        const focusEvent = selectedEvent || currentEvent || events[0] || null;
        const cacheKey = getReplayIntelligenceCacheKey(context, events, focusEvent);
        if (replayIntelligenceCache.key === cacheKey && replayIntelligenceCache.value) {
            return replayIntelligenceCache.value;
        }
        const focusRoute = getRouteKey(focusEvent || {});
        const focusToken = normalizeTokenFilter(focusEvent?.token || focusEvent?.symbol || focusEvent?.token_mint);
        const routeEvents = focusRoute ? events.filter(event => getRouteKey(event) === focusRoute) : [];
        const routeSet = new Set(events.map(getRouteKey).filter(Boolean));
        const tokenEvents = focusToken !== 'all'
            ? events.filter(event => normalizeTokenFilter(event.token || event.symbol || event.token_mint) === focusToken)
            : [];
        const gapMap = context.gapMap || {};
        const gaps = Array.isArray(gapMap.gaps) ? gapMap.gaps : [];
        const highGap = gaps.find(gap => gap.severity === 'high') || gaps[0] || null;
        const clusters = context.clusters || {};
        const topCluster = [
            ...(clusters.routes || []),
            ...(clusters.tokens || []),
            ...(clusters.counterparties || []),
            ...(clusters.hotspots || [])
        ].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0) || String(a.label || '').localeCompare(String(b.label || '')))[0] || null;
        const routeComparison = context.routeComparison || {};
        const continuity = context.continuityProfile || {};
        const chronologyLabel = `${Number(context.currentStep) || 0}/${Number(context.totalSteps) || events.length || 0}`;
        const flowSummary = deriveReplayFlowSummary(events, {
            ...context,
            focusEvent,
            focusRoute,
            focusToken,
            gaps,
            highGap,
            routeComparison,
            continuity
        });
        const corridorProfile = deriveReplayCorridorProfile(events, {
            ...context,
            flowSummary,
            focusEvent,
            focusRoute,
            focusToken,
            gaps,
            highGap,
            continuity,
            routeComparison
        });
        const sharedConcepts = deriveSharedGraphOsFlowConcepts({
            flowSummary,
            corridorProfile,
            continuity,
            highGap,
            routeComparison,
            events
        });
        const narratives = deriveReplayNarratives(flowSummary, {
            ...context,
            focusEvent,
            focusRoute,
            focusToken,
            routeEvents,
            routeSet,
            tokenEvents,
            gaps,
            highGap,
            continuity,
            routeComparison,
            corridorProfile,
            sharedConcepts
        });
        const reasoningChips = deriveReplayReasoningChips(flowSummary, {
            ...context,
            focusEvent,
            focusRoute,
            focusToken,
            routeEvents,
            routeSet,
            tokenEvents,
            gaps,
            highGap,
            continuity,
            routeComparison,
            corridorProfile,
            sharedConcepts
        });
        const routeNarrative = routeComparison.active
            ? routeComparison.detail
            : focusRoute
                ? `${routeEvents.length} staged transfer${routeEvents.length === 1 ? '' : 's'} share the active route; ${routeSet.size} route corridor${routeSet.size === 1 ? '' : 's'} are visible in this replay window.`
                : `${events.length} staged transfer${events.length === 1 ? '' : 's'} are available for chronology review.`;
        const anomaly = highGap
            ? `${highGap.label || formatHistoryLikeFlag(highGap.code)} is the strongest replay boundary cue.`
            : focusEvent?.warning
                ? focusEvent.warning
                : continuity.level === 'high'
                    ? 'No explicit replay gap marker is active in the staged window.'
                    : 'Replay is bounded to staged preview history.';
        const focusLabel = focusToken !== 'all'
            ? `${focusToken} / ${focusRoute ? formatRoute(focusEvent) : 'route scan'}`
            : focusRoute ? formatRoute(focusEvent) : 'Chronology scan';
        const result = {
            version: REPLAY_INTELLIGENCE_VERSION,
            focusLabel,
            narrative: `${routeNarrative} ${anomaly}`,
            routeEventCount: routeEvents.length,
            tokenEventCount: tokenEvents.length,
            routeCount: routeSet.size,
            corridorCount: flowSummary.dominantFlowCorridors.length || routeSet.size,
            bridgeWalletCount: flowSummary.bridgeWalletCount,
            concentrationLabel: flowSummary.tokenConcentrationLabel,
            sharedEventCount: Number(routeComparison.sharedCount) || 0,
            gapCount: gaps.length,
            chronologyLabel,
            continuityLevel: continuity.level || 'partial',
            topClusterLabel: topCluster?.label || '',
            flowSummary,
            corridorProfile,
            sharedConcepts,
            narratives,
            summaryItems: flowSummary.summaryItems,
            reasoningChips,
            investigationLineage: context.investigationLineage || {},
            chips: [
                continuity.label || formatHistoryLikeFlag(continuity.level || 'partial'),
                focusToken !== 'all' ? `${focusToken} ${tokenEvents.length}` : '',
                topCluster ? `${formatHistoryLikeFlag(topCluster.kind)} ${topCluster.count}` : '',
                routeComparison.active ? `${routeComparison.sharedCount || 0} shared events` : `${routeSet.size} routes`,
                highGap ? highGap.severity : 'staged only'
            ].filter(Boolean),
            deterministic: true,
            metadataDerivedOnly: true,
            previewOnly: true,
            stagedHistoryOnly: true
        };
        replayIntelligenceCache.key = cacheKey;
        replayIntelligenceCache.value = result;
        return result;
    }

    function getReplayIntelligenceCacheKey(context = {}, events = [], focusEvent = null) {
        const filters = normalizeAuditFilters(context.auditFilters || context.filters || {});
        const gapMap = context.gapMap || {};
        const gaps = Array.isArray(gapMap.gaps) ? gapMap.gaps : [];
        const first = events[0] || {};
        const last = events[events.length - 1] || {};
        const lineage = context.investigationLineage || {};
        return [
            REPLAY_INTELLIGENCE_VERSION,
            events.length,
            Number(context.currentStep) || 0,
            Number(context.totalSteps) || 0,
            focusEvent?.step || 0,
            focusEvent?.signature || '',
            first.signature || first.timestamp || '',
            last.signature || last.timestamp || '',
            filters.token,
            filters.direction,
            filters.counterparty,
            filters.majorOnly ? 'major' : 'all',
            gaps.map(gap => `${gap.code || gap.label}:${gap.severity || ''}`).join(','),
            context.routeComparison?.active ? `${context.routeComparison.sharedCount || 0}:${context.routeComparison.primaryRoute || ''}` : '',
            Array.isArray(lineage.stack) ? lineage.stack.map(item => item.step).join(',') : ''
        ].join('|');
    }

    function deriveReplayFlowSummary(events = [], context = {}) {
        const routeMap = new Map();
        const tokenMap = new Map();
        const walletMap = new Map();
        const totalEvents = events.length;
        let totalAmountWeight = 0;

        events.forEach(event => {
            const amount = Math.max(0, Number(event.amountValue ?? getAmountValue(event)) || 0);
            totalAmountWeight += amount;
            const route = getRouteKey(event);
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
            const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
            if (route) {
                const routeRecord = routeMap.get(route) || {
                    key: route,
                    label: formatRoute(event),
                    count: 0,
                    amountWeight: 0,
                    firstStep: Number(event.step) || 0,
                    lastStep: Number(event.step) || 0,
                    tokenSet: new Set(),
                    source,
                    destination
                };
                routeRecord.count += 1;
                routeRecord.amountWeight += amount;
                routeRecord.firstStep = Math.min(routeRecord.firstStep || Number(event.step) || 0, Number(event.step) || 0);
                routeRecord.lastStep = Math.max(routeRecord.lastStep || 0, Number(event.step) || 0);
                if (token !== 'all') routeRecord.tokenSet.add(token);
                routeMap.set(route, routeRecord);
            }
            if (token !== 'all') {
                const tokenRecord = tokenMap.get(token) || {
                    token,
                    label: token,
                    count: 0,
                    amountWeight: 0,
                    routeSet: new Set(),
                    firstStep: Number(event.step) || 0,
                    lastStep: Number(event.step) || 0
                };
                tokenRecord.count += 1;
                tokenRecord.amountWeight += amount;
                if (route) tokenRecord.routeSet.add(route);
                tokenRecord.firstStep = Math.min(tokenRecord.firstStep || Number(event.step) || 0, Number(event.step) || 0);
                tokenRecord.lastStep = Math.max(tokenRecord.lastStep || 0, Number(event.step) || 0);
                tokenMap.set(token, tokenRecord);
            }
            [
                { wallet: source, role: 'source' },
                { wallet: destination, role: 'destination' }
            ].forEach(item => {
                if (!item.wallet || item.wallet === 'all') return;
                const walletRecord = walletMap.get(item.wallet) || {
                    wallet: item.wallet,
                    label: shortValue(item.wallet),
                    count: 0,
                    amountWeight: 0,
                    inbound: 0,
                    outbound: 0,
                    firstStep: Number(event.step) || 0,
                    lastStep: Number(event.step) || 0,
                    routeSet: new Set(),
                    tokenSet: new Set()
                };
                walletRecord.count += 1;
                walletRecord.amountWeight += amount;
                walletRecord.firstStep = Math.min(walletRecord.firstStep || Number(event.step) || 0, Number(event.step) || 0);
                walletRecord.lastStep = Math.max(walletRecord.lastStep || 0, Number(event.step) || 0);
                if (item.role === 'source') walletRecord.outbound += 1;
                if (item.role === 'destination') walletRecord.inbound += 1;
                if (route) walletRecord.routeSet.add(route);
                if (token !== 'all') walletRecord.tokenSet.add(token);
                walletMap.set(item.wallet, walletRecord);
            });
        });

        const dominantFlowCorridors = [...routeMap.values()]
            .sort((a, b) => b.count - a.count || b.amountWeight - a.amountWeight || a.firstStep - b.firstStep || a.key.localeCompare(b.key))
            .slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems)
            .map(record => ({
                ...record,
                tokenCount: record.tokenSet.size,
                sharePct: totalEvents ? Math.round((record.count / totalEvents) * 100) : 0
            }));
        const topTokenZones = [...tokenMap.values()]
            .sort((a, b) => b.count - a.count || b.amountWeight - a.amountWeight || a.token.localeCompare(b.token))
            .slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems)
            .map(record => ({
                ...record,
                routeCount: record.routeSet.size,
                sharePct: totalEvents ? Math.round((record.count / totalEvents) * 100) : 0
            }));
        const bridgeWallets = [...walletMap.values()]
            .filter(record => record.routeSet.size > 1 || record.count >= 3)
            .sort((a, b) => b.routeSet.size - a.routeSet.size || b.count - a.count || b.amountWeight - a.amountWeight || a.wallet.localeCompare(b.wallet))
            .slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems)
            .map(record => ({
                ...record,
                routeCount: record.routeSet.size,
                tokenCount: record.tokenSet.size,
                sharePct: totalEvents ? Math.round((record.count / totalEvents) * 100) : 0
            }));
        const convergenceZones = [...walletMap.values()]
            .filter(record => record.inbound > 1)
            .sort((a, b) => b.inbound - a.inbound || b.count - a.count || a.wallet.localeCompare(b.wallet))
            .slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems)
            .map(record => ({
                ...record,
                intensity: record.inbound,
                sharePct: totalEvents ? Math.round((record.inbound / totalEvents) * 100) : 0
            }));
        const divergenceZones = [...walletMap.values()]
            .filter(record => record.outbound > 1)
            .sort((a, b) => b.outbound - a.outbound || b.count - a.count || a.wallet.localeCompare(b.wallet))
            .slice(0, REPLAY_EXPANSION_CAPS.maxFlowSummaryItems)
            .map(record => ({
                ...record,
                intensity: record.outbound,
                sharePct: totalEvents ? Math.round((record.outbound / totalEvents) * 100) : 0
            }));

        const focusRouteRecord = context.focusRoute ? routeMap.get(context.focusRoute) || null : null;
        const topToken = topTokenZones[0] || null;
        const topCorridor = dominantFlowCorridors[0] || null;
        const topBridgeWallet = bridgeWallets[0] || null;
        const convergenceIntensity = convergenceZones[0]?.intensity || 0;
        const divergenceIntensity = divergenceZones[0]?.intensity || 0;
        const routeContinuity = focusRouteRecord
            ? `${focusRouteRecord.count} row${focusRouteRecord.count === 1 ? '' : 's'} / steps ${focusRouteRecord.firstStep}-${focusRouteRecord.lastStep}`
            : topCorridor
                ? `${topCorridor.count} row${topCorridor.count === 1 ? '' : 's'} / steps ${topCorridor.firstStep}-${topCorridor.lastStep}`
                : 'No repeated corridor';
        const tokenConcentrationLabel = topToken ? `${topToken.sharePct}%` : '0%';

        return {
            dominantFlowCorridors,
            topTokenZones,
            bridgeWallets,
            convergenceZones,
            divergenceZones,
            topCorridor,
            topToken,
            topBridgeWallet,
            bridgeWalletCount: bridgeWallets.length,
            convergenceIntensity,
            divergenceIntensity,
            routeContinuity,
            tokenConcentrationLabel,
            totalEvents,
            totalAmountWeight,
            summaryItems: [
                {
                    label: 'Dominant Corridor',
                    value: topCorridor ? `${topCorridor.count} rows` : 'No repeat',
                    title: topCorridor ? `${topCorridor.label} / ${topCorridor.sharePct}% of visible staged rows` : 'No repeated visible corridor'
                },
                {
                    label: 'Concentration Zone',
                    value: topToken ? `${topToken.label} ${topToken.sharePct}%` : 'No token zone',
                    title: topToken ? `${topToken.count} staged rows for ${topToken.label}` : 'No token concentration visible'
                },
                {
                    label: 'Bridge Wallets',
                    value: String(bridgeWallets.length),
                    title: topBridgeWallet ? `${topBridgeWallet.label} spans ${topBridgeWallet.routeCount} visible corridors` : 'No multi-corridor wallet visible'
                },
                {
                    label: 'Route Continuity',
                    value: routeContinuity,
                    title: 'Continuity is derived only from loaded staged replay rows'
                }
            ],
            deterministic: true,
            stagedHistoryOnly: true
        };
    }

    function deriveReplayCorridorProfile(events = [], context = {}) {
        const flowSummary = context.flowSummary || {};
        const continuity = context.continuity || context.continuityProfile || {};
        const focusEvent = context.focusEvent || null;
        const focusRoute = context.focusRoute || (focusEvent ? getRouteKey(focusEvent) : '');
        const currentStep = Number(context.currentStep || focusEvent?.step) || 0;
        const totalSteps = Math.max(0, Number(context.totalSteps) || events.length);
        const boundedEvents = events
            .filter(event => Number(event.step) > 0)
            .slice()
            .sort((a, b) => Number(a.step) - Number(b.step))
            .slice(0, Math.max(40, REPLAY_EXPANSION_CAPS.maxCorridors * 80));
        const routeRecords = Array.isArray(flowSummary.dominantFlowCorridors)
            ? flowSummary.dominantFlowCorridors
            : [];
        const corridors = routeRecords.slice(0, REPLAY_EXPANSION_CAPS.maxCorridors).map(record => {
            const routeEvents = boundedEvents.filter(event => getRouteKey(event) === record.key);
            const focusStep = focusRoute === record.key && focusEvent?.step
                ? Number(focusEvent.step)
                : routeEvents[0]?.step || record.firstStep || 0;
            return {
                ...record,
                focusStep,
                detail: `${record.label || 'Replay corridor'} repeats in ${record.count || 0} staged row${record.count === 1 ? '' : 's'} across steps ${record.firstStep || '-'}-${record.lastStep || '-'}. This is route visibility only.`
            };
        });
        const dominant = corridors[0] || null;
        const transitions = deriveReplayCorridorTransitions(boundedEvents);
        const previousTransition = transitions.filter(item => Number(item.step) < currentStep).pop() || null;
        const nextTransition = transitions.find(item => Number(item.step) > currentStep) || null;
        const nearbyTransition = nextTransition || previousTransition || transitions[0] || null;
        const congestionZones = deriveReplayCongestionZones(boundedEvents, totalSteps);
        const overlap = deriveReplayCorridorOverlap(boundedEvents);
        const clusterContinuity = deriveReplayClusterContinuity(context.clusters || {});
        const progressionBreadcrumbs = getCorridorProgressionBreadcrumbs(transitions, currentStep);
        const focusHints = [
            nextTransition ? `Next corridor at #${nextTransition.step}` : '',
            previousTransition ? `Previous corridor at #${previousTransition.step}` : '',
            congestionZones[0] ? `${congestionZones[0].label} has ${congestionZones[0].count} staged rows` : '',
            clusterContinuity.label ? clusterContinuity.label : ''
        ].filter(Boolean).slice(0, REPLAY_EXPANSION_CAPS.maxTraversalHints);
        const score = Number(continuity.score);
        const confidenceLabel = Number.isFinite(score)
            ? `${continuity.label || formatHistoryLikeFlag(continuity.level || 'partial')} ${Math.round(score)}%`
            : continuity.label || formatHistoryLikeFlag(continuity.level || 'partial');
        return {
            version: REPLAY_CORRIDOR_VERSION,
            corridors,
            dominant,
            dominantLabel: dominant ? `${dominant.count || 0} rows` : 'No repeat',
            dominantDetail: dominant
                ? `${dominant.label} is the most repeated visible replay route in staged data.`
                : 'No route repeats in the staged replay window.',
            transitionCount: transitions.length,
            transitions: transitions.slice(0, REPLAY_EXPANSION_CAPS.maxCorridorTransitions),
            previousCorridorStep: previousTransition?.step || 0,
            previousCorridorRoute: previousTransition?.to || previousTransition?.from || '',
            nextCorridorStep: nextTransition?.step || 0,
            nextCorridorRoute: nextTransition?.to || '',
            transitionSignificance: nearbyTransition
                ? `${formatRouteKeyLabel(nearbyTransition.from)} -> ${formatRouteKeyLabel(nearbyTransition.to)}`
                : 'No transition',
            transitionDetail: nearbyTransition
                ? `${transitions.length} corridor transition${transitions.length === 1 ? '' : 's'} are visible inside the staged replay rows.`
                : 'No corridor-to-corridor transition is visible in this staged window.',
            congestionZones,
            congestionLabel: congestionZones[0] ? congestionZones[0].label : 'No zone',
            congestionDetail: congestionZones[0]?.detail || 'No step bucket repeats enough to form a replay congestion cue.',
            repeatedPathways: corridors.filter(corridor => Number(corridor.count) > 1),
            routeDivergenceLabel: transitions.length ? `${transitions.length} transitions` : 'No divergence',
            overlapWallets: overlap.wallets,
            overlapTokens: overlap.tokens,
            overlapLabel: overlap.label,
            overlapDetail: overlap.detail,
            continuityConfidence: confidenceLabel,
            focusHints,
            progressionBreadcrumbs,
            neighborhoodGuidance: getReplayNeighborhoodTraversalGuidance({ focusRoute, nextTransition, previousTransition, dominant, overlap }),
            clusterContinuity,
            boundedEventCount: boundedEvents.length,
            deterministic: true,
            stagedHistoryOnly: true,
            previewOnly: true
        };
    }

    function deriveReplayCorridorTransitions(events = []) {
        const transitions = [];
        let previousRoute = '';
        let previousLabel = '';
        events.forEach(event => {
            const route = getRouteKey(event);
            if (!route) return;
            const label = formatRoute(event);
            if (previousRoute && route !== previousRoute) {
                transitions.push({
                    step: Number(event.step) || 0,
                    from: previousRoute,
                    to: route,
                    label: `${formatRouteKeyLabel(previousRoute)} -> ${formatRouteKeyLabel(route)}`,
                    title: `Replay corridor transition at step ${event.step || '-'} from ${previousLabel || formatRouteKeyLabel(previousRoute)} to ${label}. Chronology only; no market causality implied.`
                });
            }
            previousRoute = route;
            previousLabel = label;
        });
        return transitions
            .filter(item => item.step > 0)
            .slice(0, Math.max(REPLAY_EXPANSION_CAPS.maxCorridorTransitions, 24));
    }

    function deriveReplayCongestionZones(events = [], totalSteps = 0) {
        if (!events.length) return [];
        const maxStep = Math.max(totalSteps, ...events.map(event => Number(event.step) || 0));
        const bucketSize = Math.max(1, Math.ceil(maxStep / 5));
        const buckets = new Map();
        events.forEach(event => {
            const step = Number(event.step) || 0;
            const bucketStart = Math.floor(Math.max(0, step - 1) / bucketSize) * bucketSize + 1;
            const bucketEnd = Math.min(maxStep || bucketStart, bucketStart + bucketSize - 1);
            const key = `${bucketStart}-${bucketEnd}`;
            const record = buckets.get(key) || {
                key,
                start: bucketStart,
                end: bucketEnd,
                label: `Steps ${bucketStart}-${bucketEnd}`,
                count: 0,
                routes: new Set(),
                tokens: new Set()
            };
            record.count += 1;
            const route = getRouteKey(event);
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            if (route) record.routes.add(route);
            if (token !== 'all') record.tokens.add(token);
            buckets.set(key, record);
        });
        return [...buckets.values()]
            .filter(record => record.count > 1)
            .sort((a, b) => b.count - a.count || a.start - b.start)
            .slice(0, REPLAY_EXPANSION_CAPS.maxCongestionZones)
            .map(record => ({
                key: record.key,
                label: record.label,
                count: record.count,
                routeCount: record.routes.size,
                tokenCount: record.tokens.size,
                detail: `${record.count} staged replay row${record.count === 1 ? '' : 's'} in ${record.label}; ${record.routes.size} corridor${record.routes.size === 1 ? '' : 's'} and ${record.tokens.size} token cue${record.tokens.size === 1 ? '' : 's'} visible.`
            }));
    }

    function deriveReplayCorridorOverlap(events = []) {
        const walletRoutes = new Map();
        const tokenRoutes = new Map();
        events.forEach(event => {
            const route = getRouteKey(event);
            if (!route) return;
            [
                normalizeAddressFilter(event.sourceWallet || event.source_wallet),
                normalizeAddressFilter(event.destinationWallet || event.destination_wallet)
            ].filter(value => value && value !== 'all').forEach(wallet => {
                const record = walletRoutes.get(wallet) || { key: wallet, label: shortValue(wallet), routes: new Set(), count: 0 };
                record.routes.add(route);
                record.count += 1;
                walletRoutes.set(wallet, record);
            });
            const token = normalizeTokenFilter(event.token || event.symbol || event.token_mint);
            if (token !== 'all') {
                const record = tokenRoutes.get(token) || { key: token, label: token, routes: new Set(), count: 0 };
                record.routes.add(route);
                record.count += 1;
                tokenRoutes.set(token, record);
            }
        });
        const wallets = [...walletRoutes.values()]
            .filter(record => record.routes.size > 1)
            .sort((a, b) => b.routes.size - a.routes.size || b.count - a.count || a.key.localeCompare(b.key))
            .slice(0, 4)
            .map(record => ({ ...record, routeCount: record.routes.size }));
        const tokens = [...tokenRoutes.values()]
            .filter(record => record.routes.size > 1)
            .sort((a, b) => b.routes.size - a.routes.size || b.count - a.count || a.key.localeCompare(b.key))
            .slice(0, 4)
            .map(record => ({ ...record, routeCount: record.routes.size }));
        const top = wallets[0] || tokens[0] || null;
        return {
            wallets,
            tokens,
            label: top ? `${top.label} ${top.routeCount} routes` : 'No overlap',
            detail: top
                ? `${top.label} appears across ${top.routeCount} visible replay corridor${top.routeCount === 1 ? '' : 's'} in staged data only. This does not imply identity or control.`
                : 'No wallet or token overlap across multiple visible replay corridors.'
        };
    }

    function deriveReplayClusterContinuity(clusters = {}) {
        const items = [
            ...(clusters.routes || []),
            ...(clusters.tokens || []),
            ...(clusters.counterparties || []),
            ...(clusters.hotspots || [])
        ].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0) || String(a.label || '').localeCompare(String(b.label || '')));
        const top = items[0] || null;
        return {
            count: Number(clusters.total || items.length) || 0,
            label: top ? `${top.label} cluster ${top.count}` : '',
            detail: top
                ? `${top.count || 0} staged replay row${top.count === 1 ? '' : 's'} share ${top.kind || 'cluster'} context.`
                : 'No repeated replay cluster is visible above the bounded threshold.'
        };
    }

    function getCorridorProgressionBreadcrumbs(transitions = [], currentStep = 0) {
        if (!transitions.length) return [];
        const before = transitions.filter(item => Number(item.step) < currentStep).slice(-3);
        const after = transitions.filter(item => Number(item.step) >= currentStep).slice(0, 4);
        const selected = before.concat(after);
        return (selected.length ? selected : transitions.slice(0, REPLAY_EXPANSION_CAPS.maxCorridorTransitions))
            .slice(0, REPLAY_EXPANSION_CAPS.maxCorridorTransitions);
    }

    function getReplayNeighborhoodTraversalGuidance(details = {}) {
        if (details.nextTransition) return `Next staged corridor transition is step ${details.nextTransition.step}. Use it as a chronology waypoint, not a causality signal.`;
        if (details.previousTransition) return `Previous staged corridor transition is step ${details.previousTransition.step}. Jump back to compare local replay neighborhoods.`;
        if (details.dominant) return `${details.dominant.label} is the main repeated replay pathway. Follow same-route rows for local continuity.`;
        if (details.overlap?.wallets?.length) return 'Wallet overlap exists across visible corridors; treat it as address reuse only.';
        return 'Replay traversal is limited to local staged chronology and visible neighborhoods.';
    }

    function deriveSharedGraphOsFlowConcepts(context = {}) {
        const summary = context.flowSummary || {};
        const corridorProfile = context.corridorProfile || {};
        const builder = window.StockPhotonicGraph?.readability?.buildSharedFlowInterpretation;
        if (typeof builder === 'function') {
            return builder({
                domain: 'crypto',
                convergenceCount: Number(summary.convergenceIntensity) || 0,
                divergenceCount: Number(summary.divergenceIntensity) || 0,
                concentrationLabel: summary.tokenConcentrationLabel || '0%',
                bridgeCount: Number(summary.bridgeWalletCount) || 0,
                corridorContinuity: corridorProfile.continuityConfidence || summary.routeContinuity || '',
                suppressionReason: context.highGap
                    ? `Replay/readability suppression emphasizes ${context.highGap.label || formatHistoryLikeFlag(context.highGap.code)}.`
                    : 'Replay/readability suppression follows staged focus, filters, and continuity boundaries.',
                distinctSemantics: true
            });
        }
        return {
            version: 'd209_shared_flow_language_fallback_v1',
            chips: [
                summary.convergenceIntensity ? `Convergence ${summary.convergenceIntensity}` : '',
                summary.divergenceIntensity ? `Divergence ${summary.divergenceIntensity}` : '',
                summary.bridgeWalletCount ? `Bridge significance ${summary.bridgeWalletCount}` : '',
                corridorProfile.continuityConfidence ? `Corridor continuity ${corridorProfile.continuityConfidence}` : ''
            ].filter(Boolean),
            deterministic: true,
            distinctSemantics: true
        };
    }

    function formatRouteKeyLabel(key = '') {
        const [source, destination] = String(key || '').split('>');
        if (!source && !destination) return 'No route';
        return `${source ? shortValue(source) : 'source'} -> ${destination ? shortValue(destination) : 'destination'}`;
    }

    function deriveReplayNarratives(summary = {}, context = {}) {
        const narratives = [];
        const focusEvent = context.focusEvent || null;
        const filters = normalizeAuditFilters(context.auditFilters || context.filters || {});
        const activeWallet = filters.counterparty !== 'all'
            ? filters.counterparty
            : focusEvent?.destinationWallet || focusEvent?.destination_wallet || focusEvent?.sourceWallet || focusEvent?.source_wallet || '';
        const activeWalletRecord = activeWallet
            ? [...(summary.bridgeWallets || []), ...(summary.convergenceZones || []), ...(summary.divergenceZones || [])]
                .find(item => item.wallet === activeWallet) || null
            : null;
        const walletRows = activeWalletRecord?.count || (activeWallet
            ? (context.events || []).filter(event => {
                const source = normalizeAddressFilter(event.sourceWallet || event.source_wallet);
                const destination = normalizeAddressFilter(event.destinationWallet || event.destination_wallet);
                return source === activeWallet || destination === activeWallet;
            }).length
            : 0);
        if (activeWallet) {
            narratives.push({
                kind: 'wallet',
                title: 'Active Wallet Focus',
                body: `${shortValue(activeWallet)} appears in ${walletRows} staged replay row${walletRows === 1 ? '' : 's'}. This is address-level flow context only, not an identity or control claim.`,
                badge: walletRows ? `${walletRows} rows` : 'visible'
            });
        }
        if (focusEvent?.step) {
            narratives.push({
                kind: 'event',
                title: 'Replay Event Focus',
                body: `Step ${focusEvent.step} sits at ${context.chronologyLabel || `${context.currentStep || 0}/${context.totalSteps || 0}`} with ${formatAmountToken(focusEvent)} on ${formatRoute(focusEvent)}. Chronology placement does not imply market causality.`,
                badge: `#${focusEvent.step}`
            });
        }
        if (summary.topCorridor) {
            narratives.push({
                kind: 'corridor',
                title: 'Replay Corridor Significance',
                body: `${summary.topCorridor.label} is the most repeated visible corridor with ${summary.topCorridor.count} staged row${summary.topCorridor.count === 1 ? '' : 's'} (${summary.topCorridor.sharePct}%). It reflects loaded replay routing only; ${context.corridorProfile?.routeDivergenceLabel || 'route divergence is not visible'}.`,
                badge: `${summary.topCorridor.sharePct}%`
            });
        }
        if (context.corridorProfile?.overlapWallets?.length || context.corridorProfile?.overlapTokens?.length) {
            narratives.push({
                kind: 'corridor',
                title: 'Replay Corridor Overlap',
                body: `${context.corridorProfile.overlapDetail || 'Corridor overlap is visible in staged replay rows.'} Overlap is graph traversal context only.`,
                badge: context.corridorProfile.overlapLabel || 'overlap'
            });
        }
        if (summary.topToken) {
            narratives.push({
                kind: 'token',
                title: 'Token Concentration Zone',
                body: `${summary.topToken.label} appears in ${summary.topToken.count} of ${summary.totalEvents} staged row${summary.totalEvents === 1 ? '' : 's'} (${summary.topToken.sharePct}%). This is transfer-row visibility, not liquidity truth.`,
                badge: `${summary.topToken.sharePct}%`
            });
        }
        if (summary.convergenceIntensity || summary.divergenceIntensity) {
            const convergence = summary.convergenceZones?.[0];
            const divergence = summary.divergenceZones?.[0];
            narratives.push({
                kind: 'convergence',
                title: 'Replay Convergence / Divergence',
                body: `Top convergence is ${convergence ? `${convergence.intensity} inbound row${convergence.intensity === 1 ? '' : 's'} at ${convergence.label}` : 'not visible'}; top divergence is ${divergence ? `${divergence.intensity} outbound row${divergence.intensity === 1 ? '' : 's'} at ${divergence.label}` : 'not visible'}. Endpoint reuse does not imply common ownership.`,
                badge: `${summary.convergenceIntensity}/${summary.divergenceIntensity}`
            });
        }
        if (summary.bridgeWallets?.length) {
            const top = summary.bridgeWallets[0];
            narratives.push({
                kind: 'bridge',
                title: 'High-Flow Bridge Wallets',
                body: `${summary.bridgeWallets.length} wallet${summary.bridgeWallets.length === 1 ? '' : 's'} connect multiple visible corridors or repeated rows. ${top.label} spans ${top.routeCount} corridor${top.routeCount === 1 ? '' : 's'} in staged data only.`,
                badge: `${summary.bridgeWallets.length} wallets`
            });
        }
        const highGap = context.highGap || null;
        if (highGap || focusEvent?.warning || context.continuity?.level !== 'high') {
            const anomalyCopy = highGap
                ? `${highGap.label || formatHistoryLikeFlag(highGap.code)} is the strongest replay boundary cue.`
                : focusEvent?.warning || 'Replay continuity is partial for the currently staged window.';
            narratives.push({
                kind: 'anomaly',
                title: 'Replay Anomaly Visibility',
                body: `${anomalyCopy} Treat this as visibility into staged replay boundaries, not proof of missing behavior.`,
                badge: highGap?.severity || context.continuity?.level || 'partial'
            });
        }
        return narratives.slice(0, REPLAY_EXPANSION_CAPS.maxNarratives);
    }

    function deriveReplayReasoningChips(summary = {}, context = {}) {
        const chips = [];
        const filters = normalizeAuditFilters(context.auditFilters || context.filters || {});
        const focusRoute = context.focusRoute || '';
        const focusToken = context.focusToken || 'all';
        const routeEvents = Array.isArray(context.routeEvents) ? context.routeEvents : [];
        const highGap = context.highGap || null;
        const continuity = context.continuity || {};
        const currentStep = Number(context.currentStep) || 0;
        const totalSteps = Number(context.totalSteps) || summary.totalEvents || 0;
        const bridge = summary.topBridgeWallet || null;
        const corridorProfile = context.corridorProfile || {};
        const clusterContinuity = corridorProfile.clusterContinuity || {};
        const sharedConcepts = context.sharedConcepts || {};
        const continuityScore = Number(continuity.score);
        chips.push(Number.isFinite(continuityScore)
            ? `Continuity confidence: ${Math.round(continuityScore)}% ${formatHistoryLikeFlag(continuity.level || 'partial')}`
            : `Continuity confidence: ${continuity.label || formatHistoryLikeFlag(continuity.level || 'partial')}`);
        const suppressionReason = hasActiveReplayFilters(filters)
            ? 'filter rows dimmed'
            : focusRoute
                ? 'non-focus corridors subdued'
                : highGap || continuity.level === 'provider_limited' || continuity.level === 'ambiguous'
                    ? 'continuity boundary visible'
                    : 'none active';
        chips.push(`Visibility suppression: ${suppressionReason}`);
        chips.push(clusterContinuity.label
            ? `Cluster significance: ${clusterContinuity.label}`
            : summary.topCorridor
                ? `Cluster significance: corridor ${summary.topCorridor.count}`
                : 'Cluster significance: below threshold');
        chips.push(summary.topCorridor
            ? `Route weighting: ${summary.topCorridor.count} rows / ${summary.topCorridor.sharePct}%`
            : 'Route weighting: no repeated corridor');
        chips.push(highGap
            ? `Anomaly emphasis: ${highGap.severity || 'gap'} boundary`
            : `Anomaly emphasis: ${continuity.level === 'high' ? 'none explicit' : formatHistoryLikeFlag(continuity.level || 'partial')}`);
        chips.push(corridorProfile.transitionCount
            ? `Chronology transition: ${corridorProfile.transitionCount} corridor shifts`
            : totalSteps ? `Chronology transition: step ${currentStep}/${totalSteps}` : 'Chronology transition: no step selected');
        if (corridorProfile.overlapLabel && corridorProfile.overlapLabel !== 'No overlap') {
            chips.push(`Corridor overlap: ${corridorProfile.overlapLabel}`);
        }
        (sharedConcepts.chips || []).slice(0, 2).forEach(chip => chips.push(chip));
        chips.push(focusRoute && routeEvents.length
            ? `Replay edges emphasized: ${routeEvents.length} same-corridor rows`
            : 'Replay edges emphasized: staged chronology context');
        chips.push(filters.counterparty !== 'all'
            ? `Wallet highlighted: ${shortValue(filters.counterparty)} filter`
            : bridge
                ? `Wallet highlighted: ${bridge.routeCount} corridor bridge`
                : 'Wallet highlighted: active replay endpoint');
        chips.push(totalSteps ? `Chronology matters: step ${currentStep}/${totalSteps}` : 'Chronology matters: no step selected');
        chips.push(focusToken !== 'all'
            ? `Token focus: ${focusToken}`
            : summary.topToken
                ? `Token focus: ${summary.topToken.label} concentration`
                : 'Token focus: all visible tokens');
        return chips.filter(Boolean).slice(0, REPLAY_EXPANSION_CAPS.maxReasoningChips);
    }

    function deriveReplayInvestigationLineage(context = {}) {
        const events = Array.isArray(context.events) ? context.events : [];
        const byStep = new Map(events.map(event => [Number(event.step) || 0, event]));
        const stackSource = Array.isArray(context.investigationStack) && context.investigationStack.length
            ? context.investigationStack
            : Array.isArray(context.breadcrumbs) ? context.breadcrumbs.slice().reverse() : [];
        const stack = stackSource
            .map((item, index) => normalizeLineageItem(item, byStep, index, 'stack'))
            .filter(Boolean)
            .slice(0, REPLAY_EXPANSION_CAPS.maxLineageItems);
        const recent = Array.isArray(context.recentEvents) ? context.recentEvents : [];
        const breadcrumbs = Array.isArray(context.breadcrumbs) ? context.breadcrumbs.slice().reverse() : [];
        const selectedStep = Number(context.selectedEvent?.step || context.currentEvent?.step || context.currentStep) || 0;
        const jumpBackActions = uniqueLineageItems([...recent, ...breadcrumbs]
            .map((item, index) => normalizeLineageItem(item, byStep, index, 'jump'))
            .filter(item => item && Number(item.step) !== selectedStep))
            .slice(0, 6);
        const flowSource = Array.isArray(context.flowLineage) && context.flowLineage.length
            ? context.flowLineage
            : deriveFlowLineageFromContext(context);
        const flowLineage = uniqueLineageItems(flowSource
            .map((item, index) => normalizeLineageItem(item, byStep, index, 'flow'))
            .filter(Boolean))
            .slice(0, 6);
        const neighborhood = context.neighborhood || {};
        const neighborhoodContinuity = neighborhood.active
            ? `${Number(neighborhood.events?.length) || 0} neighbor rows`
            : context.routeComparison?.active
                ? `${Number(context.routeComparison.sharedCount) || 0} shared rows`
                : 'session-only';
        return {
            stack,
            jumpBackActions,
            flowLineage,
            neighborhoodContinuity,
            sessionOnly: true,
            previewOnly: true
        };
    }

    function deriveFlowLineageFromContext(context = {}) {
        const items = [];
        const selected = context.selectedEvent || context.currentEvent || null;
        const route = selected ? getRouteKey(selected) : '';
        if (selected?.step) {
            items.push({
                step: selected.step,
                label: `Step ${selected.step}`,
                detail: selected.token || selected.symbol || 'flow',
                title: getEventTitle(selected)
            });
        }
        (context.relationships?.repeatedRoute || []).slice(0, 3).forEach(event => {
            items.push({
                step: event.step,
                label: route ? 'Same corridor' : `Step ${event.step}`,
                detail: event.token || 'route',
                title: getEventTitle(event)
            });
        });
        (context.relationships?.sameToken || []).slice(0, 3).forEach(event => {
            items.push({
                step: event.step,
                label: event.token || 'Same token',
                detail: `#${event.step}`,
                title: getEventTitle(event)
            });
        });
        return items;
    }

    function normalizeLineageItem(item = {}, byStep = new Map(), index = 0, source = 'stack') {
        const step = Math.max(0, Number(item.step || item.selectedStep || item.currentStep || item) || 0);
        const event = byStep.get(step) || (typeof item === 'object' ? item : null);
        if (!step && !event) return null;
        const label = item.label || item.shortLabel || (step ? `Step ${step}` : source);
        const detail = item.detail || item.value || event?.token || event?.symbol || (step ? `#${step}` : 'session');
        return {
            id: item.id || `${source}:${step || index}:${item.signature || event?.signature || ''}`,
            step,
            label: String(label).slice(0, 34),
            detail: String(detail).slice(0, 34),
            title: item.title || item.route || (event ? getEventTitle(event) : label),
            route: item.route || (event ? getRouteKey(event) : ''),
            token: item.token || event?.token || event?.symbol || '',
            source
        };
    }

    function uniqueLineageItems(items = []) {
        const seen = new Set();
        return items.filter(item => {
            const key = item.id || `${item.step}:${item.label}:${item.detail}`;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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
        deriveReplayIntelligence,
        deriveReplayCorridorProfile,
        deriveReplayFlowSummary,
        deriveReplayInvestigationLineage,
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
