(function () {
    window.StockPhotonicUI = window.StockPhotonicUI || {};

    function renderNodePortfolioBadges(portfolioContext, context) {
        const { escapeHtml, formatConnectionType } = context;
        if (!portfolioContext?.inPortfolio && !portfolioContext?.adjacent) return '';

        const badges = [];
        if (portfolioContext.inPortfolio) {
            badges.push('<span class="px-2.5 py-1 rounded-full border border-yellow-300/35 bg-yellow-300/10 text-yellow-100 text-[10px] font-mono tracking-[1.2px]">IN PORTFOLIO</span>');
        }
        if (portfolioContext.isTopNexus || portfolioContext.isRepeatedExposure) {
            badges.push('<span class="px-2.5 py-1 rounded-full border border-fuchsia-300/35 bg-fuchsia-300/10 text-fuchsia-100 text-[10px] font-mono tracking-[1.2px]">PORTFOLIO NEXUS</span>');
        }
        if (portfolioContext.adjacent) {
            badges.push('<span class="px-2.5 py-1 rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 text-[10px] font-mono tracking-[1.2px]">PORTFOLIO-ADJACENT</span>');
        }

        const connectedLine = portfolioContext.connectedTickers?.length
            ? `<div class="mt-2 text-xs text-cyan-100/68">Connected to portfolio via ${escapeHtml(portfolioContext.connectedTickers.join(', '))}</div>`
            : '';
        const nexusLine = (portfolioContext.isTopNexus || portfolioContext.isRepeatedExposure)
            ? `<div class="mt-2 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/10 p-3 text-xs text-white/70">
                    <div><span class="text-white/38 font-mono">AVG PORTFOLIO EDGE</span> <span class="text-fuchsia-100">${Math.round(portfolioContext.avgPortfolioStrength * 100)}%</span></div>
                    <div class="mt-1"><span class="text-white/38 font-mono">RELATIONSHIPS</span> ${escapeHtml(portfolioContext.relationshipTypes.map(formatConnectionType).join(', ') || 'Curated link')}</div>
                </div>`
            : '';

        return `
                <div class="mt-3">
                    <div class="flex flex-wrap gap-2">${badges.join('')}</div>
                    ${connectedLine}
                    ${nexusLine}
                </div>
            `;
    }

    function showNodeDetails(context) {
        const {
            sidebar,
            empty,
            node,
            connectionsForNode,
            topConnections,
            networkSummary,
            sectorCounts,
            industryGroup,
            industryGroupStats,
            industryCorrelationContext,
            nodeSources,
            whyThisNodeMatters,
            signalClarity,
            relatedCluster,
            sharedExposure,
            hiddenRelationships,
            portfolioContext,
            secPreviewLinksForNode = [],
            escapeHtml,
            formatNumber,
            formatConnectionType
        } = context;

        sidebar.innerHTML = `
                ${renderActiveContextStrip(context)}

                <div class="flex items-start justify-between gap-4 mb-5">
                    <div>
                        <div class="text-xs text-cyan-300/80 font-mono tracking-[2px]">${escapeHtml(node.sector || 'UNKNOWN')}</div>
                        <h2 class="font-display text-3xl text-white mt-1">${escapeHtml(node.ticker || '')}</h2>
                        <div class="text-sm text-white/60 mt-1">${escapeHtml(node.name || '')}</div>
                        <div class="text-xs text-white/42 mt-1 leading-snug">${escapeHtml(node.industry || 'Industry pending')}</div>
                        ${renderNodePortfolioBadges(portfolioContext, context)}
                    </div>
                    <button onclick="clearSelection()" class="focus-button w-9 h-9 rounded-full border border-white/15 text-white/70">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="grid grid-cols-3 gap-3 mb-5">
                    <div class="rounded-2xl bg-white/5 border border-white/10 p-3">
                        <div class="text-[10px] text-white/40 font-mono">RANK</div>
                        <div class="font-display text-xl text-white">#${escapeHtml(node.rank || '-')}</div>
                    </div>
                    <div class="rounded-2xl bg-white/5 border border-white/10 p-3">
                        <div class="text-[10px] text-white/40 font-mono">CAP</div>
                        <div class="font-display text-xl text-white">$${formatNumber(node.market_cap || 0)}T</div>
                    </div>
                    <div class="rounded-2xl bg-white/5 border border-white/10 p-3">
                        <div class="text-[10px] text-white/40 font-mono">DEGREE</div>
                        <div class="font-display text-xl text-white">${connectionsForNode.length}</div>
                    </div>
                </div>

                ${renderCompanyInvestigationWorkspace(context)}

                ${renderSelectedNodeWhyLayer(context)}

                ${renderSecPreviewNodeOverlaySection(secPreviewLinksForNode, context)}

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Network Summary</div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">TOTAL CONNECTIONS</div>
                            <div class="font-display text-2xl text-white">${networkSummary.degree}</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">AVG STRENGTH</div>
                            <div class="font-display text-2xl text-white">${networkSummary.avgStrengthPercent}%</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">CONF >=4</div>
                            <div class="font-display text-2xl text-white">${networkSummary.highConfidencePercent}%</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">COMMON TYPE</div>
                            <div class="text-sm text-white font-semibold truncate">${escapeHtml(formatConnectionType(networkSummary.mostCommonType))}</div>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                        ${renderConnectionTypeMix(networkSummary.typeCounts, context)}
                    </div>
                </div>

                ${renderNexusViewSection(node, context)}

                ${renderRelationshipEvidenceCards(context)}
                ${renderConnectedCompaniesByType(context)}

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Signal Clarity</div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">ACTIVE THRESHOLD</div>
                            <div class="font-display text-2xl text-white">${signalClarity.thresholdLabel}</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">VISIBLE CONNECTIONS</div>
                            <div class="font-display text-2xl text-white">${signalClarity.visibleCount}</div>
                        </div>
                    </div>
                    <div class="mt-3 space-y-2">
                        ${renderSignalClarityConnection('Strongest connection', signalClarity.strongest, context)}
                        ${renderSignalClarityConnection('Weakest visible connection', signalClarity.weakest, context)}
                    </div>
                </div>

                ${renderRelatedClusterSection(relatedCluster, node, context)}
                ${renderSharedExposureSection(sharedExposure, context)}
                ${renderHiddenRelationshipsSection(hiddenRelationships, context)}
                ${renderIndustryCorrelationContextSection(industryCorrelationContext, context)}

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Sector + Industry Context</div>
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-3">
                        <div>
                            <div class="text-[10px] text-white/38 font-mono">SECTOR</div>
                            <div class="text-sm text-white/82">${escapeHtml(node.sector || 'Unknown')}</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-white/38 font-mono">INDUSTRY</div>
                            <div class="text-sm text-white/82 leading-snug">${escapeHtml(node.industry || 'Unknown')}</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-white/38 font-mono">DERIVED INDUSTRY GROUP</div>
                            <div class="text-sm text-cyan-100/90 leading-snug">${escapeHtml(industryGroup)}</div>
                        </div>
                    </div>
                    <div class="mt-3 space-y-2">
                        ${renderSectorDistribution(sectorCounts, networkSummary.degree, context)}
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">CONNECTED INDUSTRY GROUP DISTRIBUTION</div>
                        <div class="mt-2 space-y-2">
                            ${renderIndustryGroupDistribution(industryGroupStats, networkSummary.degree, context)}
                        </div>
                    </div>
                    <div class="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">TOP BY COUNT</div>
                            <div class="mt-2 space-y-2">${renderTopIndustryGroupsByCount(industryGroupStats, context)}</div>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">TOP AVG STRENGTH</div>
                            <div class="mt-2 space-y-2">${renderTopIndustryGroupsByAverageStrength(industryGroupStats, context)}</div>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Why This Node Matters</div>
                    <div class="why-panel rounded-2xl p-4">
                        <div class="text-sm text-white/88 leading-relaxed">${escapeHtml(whyThisNodeMatters)}</div>
                        <div class="mt-3 flex flex-wrap gap-2 text-[10px] font-mono">
                            <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-cyan-200/80">DEGREE ${networkSummary.degree}</span>
                            <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-fuchsia-200/80">${escapeHtml(formatConnectionType(networkSummary.mostCommonType))}</span>
                            <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-emerald-200/80">${sectorCounts.length} SECTORS</span>
                        </div>
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="flex items-center justify-between mb-3">
                        <div class="sidebar-section-title mb-0">Connected Companies</div>
                        <button onclick="fitGraph()" class="focus-button px-3 py-1 rounded-full border border-white/15 text-xs text-white/65">FIT VIEW</button>
                    </div>
                    <div class="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                        ${topConnections.map((item, index) => renderConnectionRow(item, index, context)).join('') || '<div class="text-sm text-white/35">No connected companies in current dataset.</div>'}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Sources</div>
                    ${renderNodeSources(nodeSources, context)}
                </div>
            `;
        sidebar.classList.remove('hidden');
        empty.classList.add('hidden');
    }

    function renderActiveContextStrip(context) {
        const { escapeHtml } = context;
        const filters = [
            context.currentSector || '',
            context.currentIndustryGroup || '',
            context.currentRelationshipType ? context.getRelationshipTypeLabel?.(context.currentRelationshipType) : '',
            context.currentConfidenceTier ? `Confidence: ${context.currentConfidenceTier}` : '',
            context.sourcedOnlyFilter ? 'Sourced only' : '',
            context.secBackedOnlyFilter ? 'SEC-backed only' : '',
            context.portfolioConnectedOnlyFilter ? 'Portfolio links' : '',
            context.crossSectorOnlyFilter ? 'Cross-sector' : '',
            context.currentSearch ? `Search: ${context.currentSearch}` : ''
        ].filter(Boolean).join(' / ') || 'All companies';
        const focusOn = Boolean(context.focusModeEnabled || (typeof context.isFocusModeActive === 'function' && context.isFocusModeActive()));
        const threshold = Number(context.signalStrengthThreshold || 0);
        const portfolioActive = typeof context.isPortfolioAnalysisActive === 'function' && context.isPortfolioAnalysisActive();
        const portfolio = portfolioActive
            ? `${context.matchedPortfolioNodes?.length || 0} matched`
            : 'Inactive';

        return `
                <div class="mb-4 rounded-2xl border border-cyan-300/15 bg-black/25 px-3 py-2">
                    <div class="flex flex-wrap items-center gap-2 text-[10px] font-mono tracking-[1.1px]">
                        <span class="text-cyan-100/70">ACTIVE CONTEXT</span>
                        <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/70">${escapeHtml(filters)}</span>
                        <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">FOCUS ${focusOn ? 'ON' : 'OFF'}</span>
                        <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">SIGNAL ${threshold > 0 ? threshold.toFixed(2) : 'ALL'}</span>
                        <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">PORTFOLIO ${escapeHtml(portfolio)}</span>
                    </div>
                </div>
            `;
    }

    function renderCompanyInvestigationWorkspace(context) {
        const {
            node,
            connectionsForNode,
            networkSummary,
            escapeHtml,
            formatNumber,
            getRelationshipTypeLabel,
            getRelationshipConfidenceTier,
            getRelationshipSourceStatus,
            getRelationshipEvidenceCount
        } = context;
        const summary = getRelationshipEvidenceSummary(connectionsForNode, context);
        const categoryLabels = summary.categoryKeys
            .map(key => getRelationshipTypeLabel?.(key) || key)
            .slice(0, 4);
        const strongest = summary.strongest;
        const strongestLink = strongest?.link;
        const strongestConfidence = strongestLink ? getRelationshipConfidenceTier?.(strongestLink) : null;
        const strongestSource = strongestLink ? getRelationshipSourceStatus?.(strongestLink) : null;
        const strongestEvidenceCount = strongestLink ? getRelationshipEvidenceCount?.(strongestLink) || 0 : 0;
        const strongestLine = strongest
            ? `${escapeHtml(strongest.node.ticker || strongest.node.name || 'Connected company')}: ${escapeHtml(strongestLink.relationship_summary || strongestLink.label || 'Relationship type from curated dataset')}`
            : 'Evidence pending. No direct relationship evidence is visible at the current filters.';

        return `
                <div class="stock-intel-workspace rounded-2xl p-4 mb-5">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <div class="text-[10px] text-cyan-100/70 font-mono tracking-[1.5px]">COMPANY INVESTIGATION WORKSPACE</div>
                            <div class="mt-1 text-sm text-white/82 leading-snug">${escapeHtml(node.name || node.ticker || 'Selected company')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] text-white/38 font-mono">MARKET CAP</div>
                            <div class="font-display text-lg text-white">$${formatNumber(Number(node.market_cap) || 0)}T</div>
                        </div>
                    </div>
                    <div class="mt-3 grid grid-cols-2 gap-3">
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">DIRECT RELATIONSHIPS</div>
                            <div class="font-display text-2xl text-white">${networkSummary.degree}</div>
                            <div class="text-[10px] text-cyan-100/58">${summary.visibleCount} visible now</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">SOURCE SUMMARY</div>
                            <div class="font-display text-2xl text-white">${summary.sourcedCount}</div>
                            <div class="text-[10px] text-cyan-100/58">${summary.secBackedCount} SEC-backed</div>
                        </div>
                    </div>
                    <div class="mt-3 grid grid-cols-1 gap-2 text-xs">
                        <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <div class="text-[10px] text-white/38 font-mono">SECTOR / INDUSTRY</div>
                            <div class="mt-1 text-white/78 leading-snug">${escapeHtml(node.sector || 'Unknown sector')} · ${escapeHtml(node.industry || 'Unknown industry')}</div>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <div class="flex items-center justify-between gap-3">
                                <div class="text-[10px] text-white/38 font-mono">STRONGEST RELATIONSHIP EVIDENCE</div>
                                <div class="text-[10px] font-mono text-cyan-100/70">${strongestConfidence ? escapeHtml(strongestConfidence.shortLabel) : 'PENDING'} · ${strongestSource ? escapeHtml(strongestSource.shortLabel) : 'NO URL'}</div>
                            </div>
                            <div class="mt-1 text-sm text-white/80 leading-snug">${strongestLine}</div>
                            <div class="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
                                <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">${strongestEvidenceCount} evidence item${strongestEvidenceCount === 1 ? '' : 's'}</span>
                                <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">${summary.highConfidenceCount} high confidence</span>
                                <span class="px-2 py-1 rounded-full border border-white/10 bg-white/5 text-white/58">${summary.pendingCount} pending</span>
                            </div>
                        </div>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                        ${categoryLabels.map(label => `<span class="relationship-category-chip px-2.5 py-1 rounded-full text-[10px] font-mono">${escapeHtml(label)}</span>`).join('') || '<span class="text-xs text-white/35">No relationship categories available.</span>'}
                    </div>
                    <div class="mt-3 text-[11px] text-white/45 leading-relaxed">
                        Relationship categories, source state, and confidence are derived from loaded static fields only. Missing evidence is shown as pending instead of inferred.
                    </div>
                </div>
            `;
    }

    function getRelationshipEvidenceSummary(connectionsForNode, context) {
        const {
            getRelationshipTypeKey,
            getRelationshipConfidenceTier,
            getRelationshipEvidenceCount,
            relationshipHasSourceEvidence,
            isSecBackedConnection,
            getConnectionStrength
        } = context;
        const categoryKeys = [...new Set((connectionsForNode || []).map(item => getRelationshipTypeKey?.(item.link) || item.link.relationship_type || item.link.type || 'link'))]
            .sort((a, b) => String(a).localeCompare(String(b)));
        const sourcedCount = (connectionsForNode || []).filter(item => relationshipHasSourceEvidence?.(item.link)).length;
        const secBackedCount = (connectionsForNode || []).filter(item => isSecBackedConnection?.(item.link)).length;
        const highConfidenceCount = (connectionsForNode || []).filter(item => getRelationshipConfidenceTier?.(item.link)?.key === 'high').length;
        const pendingCount = (connectionsForNode || []).filter(item => {
            const tier = getRelationshipConfidenceTier?.(item.link)?.key;
            const evidenceCount = getRelationshipEvidenceCount?.(item.link) || 0;
            return tier === 'pending' || evidenceCount === 0;
        }).length;
        const strongest = [...(connectionsForNode || [])]
            .sort((a, b) => getRelationshipEvidenceScore(b, context) - getRelationshipEvidenceScore(a, context) ||
                (getConnectionStrength?.(b.link) || 0) - (getConnectionStrength?.(a.link) || 0) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || '')))[0] || null;

        return {
            categoryKeys,
            sourcedCount,
            secBackedCount,
            highConfidenceCount,
            pendingCount,
            strongest,
            visibleCount: context.visibleLinkKeys
                ? (connectionsForNode || []).filter(item => context.visibleLinkKeys.has(item.link.key)).length
                : (connectionsForNode || []).length
        };
    }

    function getRelationshipEvidenceScore(item, context) {
        const confidence = context.getRelationshipConfidenceTier?.(item.link)?.rank || 0;
        const evidenceCount = context.getRelationshipEvidenceCount?.(item.link) || 0;
        const sourced = context.relationshipHasSourceEvidence?.(item.link) ? 2 : 0;
        const sec = context.isSecBackedConnection?.(item.link) ? 2 : 0;
        return confidence + evidenceCount + sourced + sec;
    }

    function renderRelationshipEvidenceCards(context) {
        const { connectionsForNode, relationshipCardConnections, escapeHtml } = context;
        const sourceItems = relationshipCardConnections || connectionsForNode || [];
        const items = [...sourceItems]
            .sort((a, b) => getRelationshipEvidenceScore(b, context) - getRelationshipEvidenceScore(a, context) ||
                (context.getConnectionStrength?.(b.link) || 0) - (context.getConnectionStrength?.(a.link) || 0) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || '')))
            .slice(0, 6);

        return `
                <div class="sidebar-section">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <div class="sidebar-section-title mb-0">Why Connected?</div>
                        <div class="text-[10px] text-white/38 font-mono">${items.length} EVIDENCE CARD${items.length === 1 ? '' : 'S'}</div>
                    </div>
                    <div class="relationship-evidence-grid">
                        ${items.map((item, index) => renderRelationshipEvidenceCard(item, index, context)).join('') || `<div class="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/35">${escapeHtml('Evidence pending. No direct relationships are visible at the current filters.')}</div>`}
                    </div>
                </div>
            `;
    }

    function renderRelationshipEvidenceCard(item, index, context) {
        const {
            escapeHtml,
            getRelationshipTypeLabel,
            getRelationshipTypeColor,
            getRelationshipConfidenceTier,
            getRelationshipSourceStatus,
            getRelationshipEvidenceCount,
            getValidSourceUrls,
            getSourceHost,
            getConnectionStrength,
            formatVerifiedDate,
            isSecBackedConnection
        } = context;
        const link = item.link || {};
        const typeLabel = getRelationshipTypeLabel?.(link) || link.relationship_type_label || 'Curated relationship';
        const color = getRelationshipTypeColor?.(link) || context.EDGE_COLORS?.[link.type] || context.DEFAULT_EDGE_COLOR;
        const confidence = getRelationshipConfidenceTier?.(link) || { key: 'pending', shortLabel: 'PENDING', label: 'Evidence pending' };
        const sourceStatus = getRelationshipSourceStatus?.(link) || { key: 'missing_source', label: 'No source URL attached yet', shortLabel: 'NO URL' };
        const evidenceCount = getRelationshipEvidenceCount?.(link) || 0;
        const sourceUrls = getValidSourceUrls?.(link.source_urls) || [];
        const sourceCountText = sourceUrls.length
            ? `${sourceUrls.length} source URL${sourceUrls.length === 1 ? '' : 's'}`
            : sourceStatus.key === 'candidate_preview'
                ? 'SEC filing candidate preview'
                : 'No source URL attached yet';
        const strengthPercent = Math.round((getConnectionStrength?.(link) || Number(link.strength) || 0) * 100);
        const confidenceScore = link.confidence_score || link.confidence || link.confidence_hint || link.candidate?.confidence_hint || '-';
        const explanation = link.relationship_summary || link.label || 'Evidence pending. Relationship type from curated dataset.';
        const tags = (Array.isArray(link.evidence_tags) ? link.evidence_tags : [])
            .slice(0, 5);
        const secBadge = sourceStatus.key === 'candidate_preview'
                ? '<span class="relationship-state-badge preview px-2 py-1 rounded-full text-[10px] font-mono">Candidate preview</span>'
            : isSecBackedConnection?.(link)
                ? '<span class="relationship-state-badge sec px-2 py-1 rounded-full text-[10px] font-mono">SEC-backed</span>'
                : '<span class="relationship-state-badge curated px-2 py-1 rounded-full text-[10px] font-mono">Curated dataset</span>';
        const sourceLinks = sourceUrls.slice(0, 2).map((url, sourceIndex) => `
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()" title="${escapeHtml(url)}" class="source-link inline-flex items-center rounded-full px-2 py-0.5 font-mono truncate">
                    ${escapeHtml(getSourceHost?.(url) || `Source ${sourceIndex + 1}`)}
                </a>
            `).join('');

        return `
                <div onclick="selectConnectionRow(event, ${Number(item.node.id)})" onkeydown="handleConnectionRowKeydown(event, ${Number(item.node.id)})" role="button" tabindex="0" class="relationship-evidence-card rounded-2xl p-3 cursor-pointer" style="--relationship-color:${color}">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="shrink-0 px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-white/45 font-mono">#${index + 1}</span>
                                <div class="text-sm font-semibold text-white/92 truncate">${escapeHtml(item.node.ticker || '')}</div>
                            </div>
                            <div class="mt-1 text-xs text-white/45 truncate">${escapeHtml(item.node.name || '')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] font-mono relationship-type-label">${escapeHtml(typeLabel)}</div>
                            <div class="text-xs text-white/55">${strengthPercent}% edge</div>
                        </div>
                    </div>
                    <div class="mt-3 text-xs text-white/78 leading-relaxed">
                        <span class="text-cyan-100/80 font-mono">Why:</span> ${escapeHtml(explanation)}
                    </div>
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                        <span class="confidence-badge ${escapeHtml(confidence.key)} px-2 py-0.5 rounded-full text-[10px] font-mono">CONF ${escapeHtml(String(confidenceScore))} · ${escapeHtml(confidence.shortLabel)}</span>
                        <span class="source-indicator px-2 py-0.5 rounded-full text-[10px] text-cyan-200/78 font-mono">${escapeHtml(sourceCountText)}</span>
                        ${secBadge}
                        <span class="text-[10px] text-white/42 font-mono">VERIFIED ${escapeHtml(formatVerifiedDate?.(link.verified_date || link.candidate?.filing_date) || '-')}</span>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                        ${tags.map(tag => `<span class="relationship-evidence-tag px-2 py-0.5 rounded-full text-[10px] font-mono">${escapeHtml(tag)}</span>`).join('') || '<span class="relationship-evidence-tag px-2 py-0.5 rounded-full text-[10px] font-mono">Evidence pending</span>'}
                        <span class="relationship-evidence-tag px-2 py-0.5 rounded-full text-[10px] font-mono">${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}</span>
                    </div>
                    ${sourceLinks ? `<div class="mt-2 flex flex-wrap gap-1.5">${sourceLinks}</div>` : ''}
                </div>
            `;
    }

    function renderConnectedCompaniesByType(context) {
        const {
            connectionsForNode,
            relationshipCardConnections,
            escapeHtml,
            getRelationshipTypeKey,
            getRelationshipTypeLabel,
            getRelationshipTypeColor,
            getRelationshipConfidenceTier,
            getRelationshipSourceStatus
        } = context;
        const sourceItems = relationshipCardConnections || connectionsForNode || [];
        const groups = new Map();
        sourceItems.forEach(item => {
            const key = getRelationshipTypeKey?.(item.link) || item.link.relationship_type || item.link.type || 'link';
            const existing = groups.get(key) || {
                key,
                label: getRelationshipTypeLabel?.(key) || key,
                color: getRelationshipTypeColor?.(key) || context.DEFAULT_EDGE_COLOR,
                items: []
            };
            existing.items.push(item);
            groups.set(key, existing);
        });

        const groupList = [...groups.values()]
            .map(group => ({
                ...group,
                items: group.items.sort((a, b) => (context.getConnectionStrength?.(b.link) || 0) - (context.getConnectionStrength?.(a.link) || 0))
            }))
            .sort((a, b) => b.items.length - a.items.length || String(a.label).localeCompare(String(b.label)))
            .slice(0, 6);

        if (!groupList.length) return '';

        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Connected Companies by Type</div>
                    <div class="space-y-2">
                        ${groupList.map(group => `
                            <div class="relationship-type-group rounded-2xl p-3" style="--relationship-color:${group.color}">
                                <div class="flex items-center justify-between gap-3">
                                    <div class="text-xs font-semibold text-white/86 truncate">${escapeHtml(group.label)}</div>
                                    <div class="text-[10px] text-white/44 font-mono">${group.items.length} LINK${group.items.length === 1 ? '' : 'S'}</div>
                                </div>
                                <div class="mt-2 flex flex-wrap gap-1.5">
                                    ${group.items.slice(0, 8).map(item => {
                                        const confidence = getRelationshipConfidenceTier?.(item.link)?.shortLabel || 'PENDING';
                                        const sourceStatus = getRelationshipSourceStatus?.(item.link)?.shortLabel || 'NO URL';
                                        return `
                                            <button onclick="selectNodeById(${Number(item.node.id)})" class="relationship-company-chip rounded-full px-2.5 py-1 text-[10px] font-mono" title="${escapeHtml(item.node.name || item.node.ticker || '')}">
                                                ${escapeHtml(item.node.ticker || item.node.name || '')}
                                                <span>${escapeHtml(confidence)} · ${escapeHtml(sourceStatus)}</span>
                                            </button>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
    }

    function renderSelectedNodeWhyLayer(context) {
        const {
            node,
            topConnections,
            networkSummary,
            sectorCounts,
            industryGroup,
            industryGroupStats,
            portfolioContext,
            escapeHtml,
            formatConnectionType
        } = context;
        const role = getSelectedNodeRole(context);
        const topConnection = topConnections[0];
        const topPartner = topConnection?.node?.ticker || topConnection?.node?.name || '';
        const dominantType = formatConnectionType(networkSummary.mostCommonType || 'link').toLowerCase();
        const leadingSector = sectorCounts[0]?.[0] || node.sector || 'its sector';
        const leadingCluster = industryGroupStats[0]?.group || industryGroup || 'its industry group';
        const connectionLine = topPartner
            ? `${escapeHtml(node.ticker || node.name || 'This company')} matters most through ${escapeHtml(topPartner)}, its strongest visible ${escapeHtml(dominantType)} relationship.`
            : `${escapeHtml(node.ticker || node.name || 'This company')} has no visible curated relationships at the current threshold.`;
        const roleLine = getSelectedNodeRoleSentence(role, node, leadingSector, leadingCluster, portfolioContext, context);

        return `
                <div class="why-panel rounded-2xl p-4 mb-5">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <div class="text-[10px] text-cyan-100/70 font-mono tracking-[1.5px]">WHY THIS MATTERS</div>
                            <div class="mt-2 text-sm text-white/88 leading-relaxed">${roleLine}</div>
                            <div class="mt-2 text-xs text-white/58 leading-relaxed">${connectionLine}</div>
                        </div>
                        <div class="shrink-0 px-2.5 py-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 text-[10px] text-cyan-100/85 font-mono">${escapeHtml(role.label)}</div>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2 text-[10px] font-mono">
                        <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-cyan-200/80">${escapeHtml(role.hubLabel)}</span>
                        <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-fuchsia-200/80">${escapeHtml(role.bridgeLabel)}</span>
                        <span class="px-2 py-1 rounded-full bg-black/25 border border-white/10 text-emerald-200/80">${escapeHtml(role.dependencyLabel)}</span>
                    </div>
                </div>
            `;
    }

    function getSelectedNodeRole(context) {
        const { networkSummary, sectorCounts, portfolioContext } = context;
        const degree = networkSummary.degree || 0;
        const sectorDiversity = sectorCounts.length;
        const highCapCount = networkSummary.highCapCount || 0;
        const dominantType = networkSummary.mostCommonType || 'link';
        const isHub = degree >= 8;
        const isBridge = sectorDiversity >= 3 || (sectorDiversity >= 2 && degree >= 5);
        const isDependency = highCapCount >= 3 || dominantType === 'supply' || portfolioContext?.adjacent || portfolioContext?.isTopNexus;

        return {
            label: isHub ? 'HUB' : isBridge ? 'BRIDGE' : isDependency ? 'DEPENDENCY' : 'CONTEXT',
            isHub,
            isBridge,
            isDependency,
            hubLabel: isHub ? 'Hub' : 'Not a hub',
            bridgeLabel: isBridge ? 'Bridge' : 'Limited bridge',
            dependencyLabel: isDependency ? 'Dependency signal' : 'Low dependency signal'
        };
    }

    function getSelectedNodeRoleSentence(role, node, leadingSector, leadingCluster, portfolioContext, context) {
        const { escapeHtml } = context;
        const ticker = escapeHtml(node.ticker || node.name || 'This company');
        if (role.isHub && role.isBridge) {
            return `${ticker} is both a hub and a bridge: it concentrates attention inside ${escapeHtml(leadingCluster)} while linking into ${escapeHtml(leadingSector)} relationships.`;
        }
        if (role.isHub) {
            return `${ticker} is a hub in this network, so its relationships help explain where attention and dependency are concentrated.`;
        }
        if (role.isBridge) {
            return `${ticker} bridges sectors, which makes it useful for seeing how ${escapeHtml(node.sector || 'one market area')} connects to ${escapeHtml(leadingSector)}.`;
        }
        if (portfolioContext?.adjacent || portfolioContext?.isTopNexus) {
            return `${ticker} is portfolio-adjacent, so its links can reveal indirect exposure around the active holdings.`;
        }
        if (role.isDependency) {
            return `${ticker} acts like a dependency point because its visible relationships are concentrated around important counterparties.`;
        }
        return `${ticker} provides context for ${escapeHtml(leadingCluster)}, with its current importance coming from a smaller set of visible relationships.`;
    }

    function renderNexusViewSection(node, context) {
        if (!context.isNexusLayoutActive() || !node) return '';

        const summary = context.getNexusSummary(node);
        const groups = ['supply', 'partner', 'competitive', 'capital'];
        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Nexus View</div>
                    <div class="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-3 mb-3 text-xs text-cyan-50/62 leading-relaxed">
                        Selected company is the investigation hub. Groups use derived relationship taxonomy; low-confidence or unsourced edges are muted in the graph.
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        ${groups.map(groupKey => renderNexusSummaryTile(summary.groups[groupKey], context)).join('')}
                    </div>
                </div>
            `;
    }

    function renderNexusSummaryTile(group, context) {
        const { escapeHtml, getRelationshipTypeLabel, getRelationshipConfidenceTier, getRelationshipSourceStatus, getConnectionStrength } = context;
        const strongest = group.strongest;
        const strengthText = strongest ? `${Math.round(getConnectionStrength(strongest.link) * 100)}% edge` : 'No visible edge';
        const tickerText = strongest ? `${strongest.node.ticker || strongest.node.name || 'Company'}` : 'None';
        const confidenceText = strongest ? getRelationshipConfidenceTier?.(strongest.link)?.shortLabel || 'PENDING' : 'PENDING';
        const sourceText = strongest ? getRelationshipSourceStatus?.(strongest.link)?.shortLabel || 'NO URL' : 'NO URL';
        const relationshipText = strongest
            ? `${getRelationshipTypeLabel?.(strongest.link) || 'Relationship'}: ${strongest.link.relationship_summary || strongest.link.label || 'Loaded direct edge'}`
            : 'No strongest relationship at current filters';
        return `
                <div class="summary-tile rounded-2xl p-3">
                    <div class="text-[10px] text-white/40 font-mono">${escapeHtml(group.shortLabel.toUpperCase())}</div>
                    <div class="font-display text-2xl text-white">${group.count}</div>
                    <div class="mt-1 text-xs text-white/70 truncate">${escapeHtml(tickerText)}</div>
                    <div class="text-[10px] text-cyan-100/55 font-mono">${escapeHtml(strengthText)} · ${escapeHtml(confidenceText)} · ${escapeHtml(sourceText)}</div>
                    <div class="mt-1 text-[11px] text-white/45 leading-snug line-clamp-2">${escapeHtml(relationshipText)}</div>
                </div>
            `;
    }

    function renderRelatedClusterSection(cluster, selectedNodeForCluster, context) {
        const clusterItems = (cluster?.clusterItems || [])
            .filter(item => item.node.id !== selectedNodeForCluster.id)
            .slice(0, context.CLUSTER_SECTION_LIMIT);
        if (!clusterItems.length) return '';

        const clusterStrengthPercent = Math.round((cluster.clusterStrength || 0) * 100);
        const clusterSize = Math.max(0, (cluster.clusterNodes || []).length - 1);
        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Related Cluster</div>
                    <div class="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-3 mb-3">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <div class="text-[10px] text-white/38 font-mono">CLUSTER NODES</div>
                                <div class="font-display text-2xl text-white">${clusterSize}</div>
                            </div>
                            <div>
                                <div class="text-[10px] text-white/38 font-mono">STRENGTH</div>
                                <div class="font-display text-2xl text-white">${clusterStrengthPercent}%</div>
                            </div>
                        </div>
                    </div>
                    <div class="space-y-2">
                        ${clusterItems.map((item, index) => renderClusterNodeRow(item, index, context)).join('')}
                    </div>
                </div>
            `;
    }

    function renderClusterNodeRow(item, index, context) {
        const { escapeHtml } = context;
        const roleLabel = item.role === 'direct-shared' ? 'Direct + shared' : item.role === 'direct' ? 'Direct edge' : 'Shared overlap';
        const strengthPercent = Math.round((item.avgStrength || item.score || 0) * 100);
        return `
                <button onclick="selectNodeById(${Number(item.node.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex items-start gap-2">
                            <span class="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-white/45 font-mono">#${index + 1}</span>
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-white/90">${escapeHtml(item.node.ticker || '')}</div>
                                <div class="text-xs text-white/45 truncate">${escapeHtml(item.node.name || '')}</div>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-cyan-200">${strengthPercent}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(roleLabel)}</div>
                        </div>
                    </div>
                </button>
            `;
    }

    function renderSharedExposureSection(sharedExposure, context) {
        const items = (sharedExposure || [])
            .filter(item => item.count > 0)
            .slice(0, context.CLUSTER_SECTION_LIMIT);
        if (!items.length) return '';

        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Shared Exposure</div>
                    <div class="space-y-2">
                        ${items.map(item => renderSharedExposureRow(item, context)).join('')}
                    </div>
                </div>
            `;
    }

    function renderSharedExposureRow(item, context) {
        const { escapeHtml, getSharedNeighborTickerList } = context;
        const avgStrengthPercent = Math.round((item.avgStrength || 0) * 100);
        const viaTickers = getSharedNeighborTickerList(item, 3);
        const relationshipLabel = item.directlyConnected ? 'Direct + shared neighbors' : 'Indirect shared neighbors';
        return `
                <button onclick="selectNodeById(${Number(item.node.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90">${escapeHtml(item.node.ticker || '')} <span class="text-white/42 font-normal">${escapeHtml(item.node.name || '')}</span></div>
                            <div class="text-xs text-white/52 mt-1 leading-snug">Overlap through ${escapeHtml(viaTickers || 'shared neighbors')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-fuchsia-100">${item.count}</div>
                            <div class="text-[10px] text-white/42">OVERLAP</div>
                        </div>
                    </div>
                    <div class="mt-2 flex items-center justify-between gap-3 text-[10px] font-mono">
                        <span class="text-cyan-100/68">${escapeHtml(relationshipLabel)}</span>
                        <span class="text-white/55">${avgStrengthPercent}% AVG STRENGTH</span>
                    </div>
                </button>
            `;
    }

    function renderHiddenRelationshipsSection(hiddenRelationships, context) {
        if (!hiddenRelationships?.length) return '';

        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Hidden Relationships</div>
                    <div class="space-y-2">
                        ${hiddenRelationships.map(item => renderHiddenRelationshipRow(item, context)).join('')}
                    </div>
                </div>
            `;
    }

    function renderHiddenRelationshipRow(item, context) {
        const { escapeHtml, getSharedNeighborTickerList } = context;
        const avgStrengthPercent = Math.round((item.avgStrength || 0) * 100);
        const viaTickers = getSharedNeighborTickerList(item, 3);
        return `
                <button onclick="selectNodeById(${Number(item.node.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90">${escapeHtml(item.node.ticker || '')} <span class="text-white/42 font-normal">${escapeHtml(item.node.name || '')}</span></div>
                            <div class="text-xs text-white/60 mt-1 leading-snug">Indirect exposure through ${escapeHtml(viaTickers || 'shared neighbors')}</div>
                            <div class="text-[10px] text-cyan-100/58 font-mono mt-2">COMMON-NEIGHBOR SIGNAL ONLY</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-cyan-200">${item.count}</div>
                            <div class="text-[10px] text-white/42">${avgStrengthPercent}% AVG</div>
                        </div>
                    </div>
                </button>
            `;
    }

    function renderConnectionRow(item, index = 0, context) {
        const {
            EDGE_COLORS,
            DEFAULT_EDGE_COLOR,
            escapeHtml,
            formatConnectionType,
            getConfidenceClass,
            formatVerifiedDate,
            getValidSourceUrls,
            getRelationshipTypeLabel,
            getRelationshipTypeColor,
            getRelationshipConfidenceTier,
            getRelationshipSourceStatus,
            getRelationshipEvidenceCount,
            relationshipHasSourceEvidence,
            isSecBackedConnection
        } = context;
        const color = getRelationshipTypeColor?.(item.link) || EDGE_COLORS[item.link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(item.link.strength * 100);
        const confidence = item.link.confidence_score || Number(item.link.confidence) || item.link.confidence_hint || item.link.candidate?.confidence_hint || 0;
        const confidenceTier = getRelationshipConfidenceTier?.(item.link) || { key: '', shortLabel: 'PENDING', label: 'Evidence pending' };
        const confidenceClass = getConfidenceClass(Number(item.link.confidence_score || item.link.confidence) || 0);
        const verifiedDate = formatVerifiedDate(item.link.verified_date);
        const sourceUrls = getValidSourceUrls(item.link.source_urls);
        const sourceStatus = getRelationshipSourceStatus?.(item.link) || { key: 'missing_source', label: 'No source URL attached yet', shortLabel: 'NO URL' };
        const evidenceCount = getRelationshipEvidenceCount?.(item.link) || 0;
        const sourceLinks = renderConnectionSourceLinks(item.link.source_urls, context);
        const rank = index + 1;
        const topClass = rank <= 3 ? `top-connection top-connection-${rank}` : '';
        const sourceLabel = sourceUrls.length
            ? `${sourceUrls.length} URL${sourceUrls.length === 1 ? '' : 'S'}`
            : sourceStatus.shortLabel;
        const relationshipTypeLabel = getRelationshipTypeLabel?.(item.link) || formatConnectionType(item.link.type || 'link');
        const sourceWarning = relationshipHasSourceEvidence?.(item.link)
            ? ''
            : '<span class="relationship-warning px-2 py-0.5 rounded-full text-[10px] font-mono">Evidence pending</span>';
        const sourceState = sourceStatus.key === 'candidate_preview'
            ? 'Candidate / preview'
            : isSecBackedConnection?.(item.link)
                ? 'SEC-backed'
                : sourceStatus.label;
        return `
                <div onclick="selectConnectionRow(event, ${Number(item.node.id)})" onkeydown="handleConnectionRowKeydown(event, ${Number(item.node.id)})" role="button" tabindex="0" class="connection-row ${topClass} w-full rounded-2xl p-3 text-left block hover:bg-white/10 transition cursor-pointer">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex items-start gap-2">
                            <span class="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-white/45 font-mono">#${rank}</span>
                            <div class="min-w-0">
                                <div class="connection-title text-sm font-semibold text-white/90">${escapeHtml(item.node.ticker || '')}</div>
                                <div class="text-xs text-white/45 truncate">${escapeHtml(item.node.name || '')}</div>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-[10px] font-mono" style="color:${color}">${escapeHtml(relationshipTypeLabel)}</div>
                            <div class="text-xs text-white/55">${strengthPercent}%</div>
                        </div>
                    </div>
                    <div class="mt-2 text-xs text-white/70 leading-snug"><span class="text-cyan-100/78 font-mono">Why:</span> ${escapeHtml(item.link.relationship_summary || item.link.label || 'Evidence pending. Relationship type from curated dataset.')}</div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <span class="confidence-badge ${confidenceClass} px-2 py-0.5 rounded-full text-[10px] font-mono">CONF ${escapeHtml(String(confidence || '-'))} · ${escapeHtml(confidenceTier.shortLabel)}</span>
                        <span class="source-indicator px-2 py-0.5 rounded-full text-[10px] text-cyan-200/78 font-mono">
                            <i class="fa-solid ${sourceUrls.length ? 'fa-link' : 'fa-link-slash'} mr-1"></i>${sourceLabel}
                        </span>
                        <span class="source-indicator px-2 py-0.5 rounded-full text-[10px] text-white/58 font-mono">${escapeHtml(sourceState)}</span>
                        ${sourceWarning}
                        <span class="source-indicator px-2 py-0.5 rounded-full text-[10px] text-white/58 font-mono">${evidenceCount} EVIDENCE</span>
                        <span class="text-[10px] text-white/42 font-mono">VERIFIED ${escapeHtml(verifiedDate)}</span>
                    </div>
                    <div class="mt-2 text-[11px] leading-relaxed text-white/50">${escapeHtml(item.link.provenance || 'No provenance summary available.')}</div>
                    ${sourceLinks}
                    <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div class="h-full rounded-full" style="width:${strengthPercent}%; background:${color}; box-shadow:0 0 10px ${color};"></div>
                    </div>
                </div>
            `;
    }

    function renderConnectionSourceLinks(sourceUrls, context) {
        const { escapeHtml, getValidSourceUrls } = context;
        const urls = getValidSourceUrls(sourceUrls);
        if (!urls.length) return '';

        return `
                <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span class="text-white/38 font-mono uppercase tracking-[1.5px]">Sources:</span>
                    ${urls.map((url, index) => `
                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()" class="source-link inline-flex items-center rounded-full px-2 py-0.5 font-mono truncate">
                            Source ${index + 1}
                        </a>
                    `).join('')}
                </div>
            `;
    }

    function renderSignalClarityConnection(label, item, context) {
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType, getRelationshipTypeLabel, getRelationshipTypeColor } = context;
        if (!item) {
            return `
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.2px]">${escapeHtml(label)}</div>
                        <div class="mt-1 text-sm text-white/35">No visible connection at this threshold.</div>
                    </div>
                `;
        }

        const color = getRelationshipTypeColor?.(item.link) || EDGE_COLORS[item.link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(item.link.strength * 100);
        const typeLabel = getRelationshipTypeLabel?.(item.link) || formatConnectionType(item.link.type || 'link');
        return `
                <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-[10px] text-white/38 font-mono tracking-[1.2px]">${escapeHtml(label)}</div>
                            <div class="mt-1 text-sm text-white/88 font-semibold truncate">${escapeHtml(item.node.ticker || '')} <span class="text-white/45 font-normal">${escapeHtml(item.node.name || '')}</span></div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono" style="color:${color}">${strengthPercent}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(typeLabel)}</div>
                        </div>
                    </div>
                    <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div class="h-full rounded-full" style="width:${strengthPercent}%; background:${color}; box-shadow:0 0 12px ${color};"></div>
                    </div>
                </div>
            `;
    }

    function renderIndustryGroupDistribution(groupStats, degree, context) {
        const { escapeHtml } = context;
        if (!groupStats.length) return '<div class="text-sm text-white/35">No connected industry groups found.</div>';
        const maxCount = Math.max(...groupStats.map(item => item.count), 1);

        return groupStats.map(item => {
            const width = Math.max(8, Math.round((item.count / maxCount) * 100));
            const percent = degree ? Math.round((item.count / degree) * 100) : 0;
            return `
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div class="flex items-center justify-between gap-3 text-xs">
                            <span class="text-white/75 truncate">${item.count} ${escapeHtml(item.group)}</span>
                            <span class="text-white/38 font-mono shrink-0">${percent}%</span>
                        </div>
                        <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div class="h-full rounded-full bg-fuchsia-300/75" style="width:${width}%; box-shadow:0 0 10px rgba(255, 0, 170, 0.42);"></div>
                        </div>
                    </div>
                `;
        }).join('');
    }

    function sortIndustryGroupStatsByCount(a, b) {
        return b.count - a.count ||
            b.avgStrength - a.avgStrength ||
            String(a.group).localeCompare(String(b.group));
    }

    function sortIndustryGroupStatsByAverageStrength(a, b) {
        return b.avgStrength - a.avgStrength ||
            b.count - a.count ||
            String(a.group).localeCompare(String(b.group));
    }

    function renderTopIndustryGroupsByCount(groupStats, context) {
        const { escapeHtml } = context;
        const topGroups = [...groupStats].sort(sortIndustryGroupStatsByCount).slice(0, 3);
        if (!topGroups.length) return '<div class="text-xs text-white/35">No connected groups.</div>';

        return topGroups.map(item => `
                <div class="flex items-center justify-between gap-2 text-xs">
                    <span class="text-white/72 truncate">${escapeHtml(item.group)}</span>
                    <span class="font-mono text-cyan-200/75 shrink-0">${item.count}</span>
                </div>
            `).join('');
    }

    function renderTopIndustryGroupsByAverageStrength(groupStats, context) {
        const { escapeHtml } = context;
        const topGroups = [...groupStats].sort(sortIndustryGroupStatsByAverageStrength).slice(0, 3);
        if (!topGroups.length) return '<div class="text-xs text-white/35">No connected groups.</div>';

        return topGroups.map(item => `
                <div class="flex items-center justify-between gap-2 text-xs">
                    <span class="text-white/72 truncate">${escapeHtml(item.group)}</span>
                    <span class="font-mono text-fuchsia-100/75 shrink-0">${item.avgStrengthPercent}%</span>
                </div>
            `).join('');
    }

    function renderIndustryCorrelationContextSection(correlationContext, context) {
        const { escapeHtml, formatConnectionType, getCorrelationAdjacentGroup } = context;
        if (!correlationContext?.topCorrelation || !correlationContext.strongestAdjacentGroup || correlationContext.connectedIndustryGroupCount < 1) return '';

        const top = correlationContext.topCorrelation;
        const topAdjacentGroup = getCorrelationAdjacentGroup(top, correlationContext.nodeGroup);
        const bridgeLabel = correlationContext.crossGroupBridge ? 'Cross-group bridge' : 'Primarily group-local';
        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Industry Correlation Context</div>
                    <div class="industry-insight-panel rounded-2xl p-3">
                        <div class="text-xs text-white/44">Top group correlation</div>
                        <div class="mt-1 text-sm text-white/88 leading-snug">${escapeHtml(correlationContext.nodeGroup)} <span class="text-cyan-200/75">&harr;</span> ${escapeHtml(topAdjacentGroup)}</div>
                        <div class="mt-3 grid grid-cols-2 gap-3">
                            <div>
                                <div class="text-[10px] text-white/38 font-mono">CONNECTED GROUPS</div>
                                <div class="font-display text-xl text-white">${correlationContext.connectedIndustryGroupCount}</div>
                            </div>
                            <div>
                                <div class="text-[10px] text-white/38 font-mono">TOP EDGES</div>
                                <div class="font-display text-xl text-white">${top.edgeCount}</div>
                            </div>
                        </div>
                        <div class="mt-3 space-y-2 text-xs">
                            <div class="flex items-start justify-between gap-3">
                                <span class="text-white/42">Strongest adjacent group</span>
                                <span class="text-white/82 text-right">${escapeHtml(correlationContext.strongestAdjacentGroup)} ${correlationContext.strongestAveragePercent}%</span>
                            </div>
                            <div class="flex items-start justify-between gap-3">
                                <span class="text-white/42">Dominant type</span>
                                <span class="text-white/82 text-right">${escapeHtml(formatConnectionType(top.dominantConnectionType))}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-3 border-t border-white/10 font-mono text-[10px] tracking-[1.2px] ${correlationContext.crossGroupBridge ? 'text-emerald-200/80' : 'text-white/42'}">
                            ${escapeHtml(bridgeLabel)}
                        </div>
                    </div>
                </div>
            `;
    }

    function renderConnectionTypeMix(typeCounts, context) {
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType, getRelationshipTypeLabel, getRelationshipTypeColor } = context;
        const entries = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
        if (!entries.length) return '<span class="text-sm text-white/35">No linked companies found.</span>';

        return entries.map(([type, count]) => `
                <span class="px-3 py-1 rounded-full text-xs border border-white/10 bg-white/5" style="color:${getRelationshipTypeColor?.(type) || EDGE_COLORS[type] || DEFAULT_EDGE_COLOR}">
                    ${escapeHtml(getRelationshipTypeLabel?.(type) || formatConnectionType(type))} ${count}
                </span>
            `).join('');
    }

    function renderSectorDistribution(sectorCounts, degree, context) {
        const { escapeHtml } = context;
        if (!sectorCounts.length) return '<div class="text-sm text-white/35">No connected sectors found.</div>';
        const maxCount = Math.max(...sectorCounts.map(([, count]) => count), 1);

        return sectorCounts.map(([sector, count]) => {
            const width = Math.max(8, Math.round((count / maxCount) * 100));
            const percent = degree ? Math.round((count / degree) * 100) : 0;
            return `
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div class="flex items-center justify-between gap-3 text-xs">
                            <span class="text-white/75 truncate">${count} ${escapeHtml(sector)}</span>
                            <span class="text-white/38 font-mono shrink-0">${percent}%</span>
                        </div>
                        <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div class="h-full rounded-full bg-cyan-300/75" style="width:${width}%; box-shadow:0 0 10px rgba(0, 249, 255, 0.45);"></div>
                        </div>
                    </div>
                `;
        }).join('');
    }

    function renderNodeSources(sourceItems, context) {
        const { escapeHtml, getSourceHost } = context;
        if (!sourceItems.length) {
            return '<div class="text-sm text-white/35">No public source links attached to this node.</div>';
        }

        const visibleSources = sourceItems.slice(0, 6);
        const hiddenCount = sourceItems.length - visibleSources.length;
        return `
                <div class="space-y-2">
                    ${visibleSources.map(item => `
                        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="source-link node-source-link w-full inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs">
                            <i class="fa-solid fa-arrow-up-right-from-square shrink-0"></i>
                            <span class="truncate">${escapeHtml(getSourceHost(item.url))}</span>
                            <span class="text-white/35 shrink-0">${escapeHtml(item.ticker)}</span>
                        </a>
                    `).join('')}
                    ${hiddenCount > 0 ? `<div class="text-[11px] text-white/38 font-mono">+${hiddenCount} MORE SOURCES IN CONNECTION ROWS</div>` : ''}
                </div>
            `;
    }

    function renderPortfolioExposureSection(summary, context) {
        if (!summary?.active) {
            return `
                    <div class="sidebar-section">
                        <div class="sidebar-section-title">Portfolio Exposure</div>
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/40">No active portfolio analysis.</div>
                    </div>
                `;
        }

        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Portfolio Exposure</div>
                    <div class="rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-3 mb-3">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="text-[10px] text-fuchsia-100/65 font-mono tracking-[1.3px]">PORTFOLIO NEXUS SCORE</div>
                                <div class="font-display text-3xl text-white">${summary.nexus.portfolioNexusScore}</div>
                            </div>
                            <div class="text-right text-[10px] text-white/42 font-mono leading-snug max-w-[150px]">DERIVED FROM CURRENT STATIC GRAPH ONLY</div>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">MATCHED HOLDINGS</div>
                            <div class="font-display text-2xl text-white">${summary.matchedCount}</div>
                        </div>
                        <div class="summary-tile rounded-2xl p-3">
                            <div class="text-[10px] text-white/40 font-mono">1ST-DEGREE EXPOSURE</div>
                            <div class="font-display text-2xl text-white">${summary.firstDegreeExposureCount}</div>
                        </div>
                    </div>
                    ${renderPortfolioUnmatchedTickers(summary.unmatchedTickers, context)}
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">TOP NEXUS COMPANY</div>
                        <div class="mt-2">${renderPortfolioTopNexus(summary.nexus.topNexusCompany, context)}</div>
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">REPEATED EXPOSURE</div>
                        <div class="mt-2 space-y-2">${renderPortfolioRepeatedExposure(summary.nexus.repeatedExposureNodes.slice(0, 5), context)}</div>
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">HIDDEN CLUSTER TOUCHPOINTS</div>
                        <div class="mt-2 space-y-2">${renderPortfolioClusterTouchpoints(summary.nexus.portfolioClusterTouchpoints, context)}</div>
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">TOP SECTORS EXPOSED</div>
                        <div class="mt-2 space-y-2">${renderPortfolioDistribution(summary.topSectors, '#facc15', 'rgba(250, 204, 21, 0.42)', context)}</div>
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">TOP INDUSTRY GROUPS EXPOSED</div>
                        <div class="mt-2 space-y-2">${renderPortfolioDistribution(summary.topIndustryGroups, '#67e8f9', 'rgba(0, 249, 255, 0.42)', context)}</div>
                    </div>
                    <div class="mt-4">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.4px]">STRONGEST PORTFOLIO-CONNECTED EDGE</div>
                        <div class="mt-2">${renderPortfolioStrongestEdge(summary.nexus.strongestPortfolioEdge || summary.strongestEdge, context)}</div>
                    </div>
                </div>
            `;
    }

    function renderPortfolioUnmatchedTickers(tickers, context) {
        const { escapeHtml } = context;
        if (!tickers?.length) return '';
        return `
                <div class="mt-3 rounded-2xl border border-orange-300/20 bg-orange-300/10 p-3">
                    <div class="text-[10px] text-orange-100/70 font-mono tracking-[1.2px]">NOT FOUND</div>
                    <div class="mt-1 text-sm text-white/70">${escapeHtml(tickers.join(', '))}</div>
                </div>
            `;
    }

    function renderPortfolioTopNexus(item, context) {
        const { escapeHtml } = context;
        if (!item) return '<div class="text-sm text-white/35">No non-portfolio nexus company found in the current dataset.</div>';
        return `
                <button onclick="selectPortfolioNexusNode(${Number(item.node.id)})" class="connection-row top-connection top-connection-1 w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex items-baseline gap-2">
                                <span class="text-sm font-semibold text-white/95">${escapeHtml(item.node.ticker || '')}</span>
                                <span class="text-xs text-white/48 truncate">${escapeHtml(item.node.name || '')}</span>
                            </div>
                            <div class="mt-1 text-xs text-fuchsia-100/68 leading-snug">
                                Connected to ${escapeHtml(item.connectedPortfolioTickers.join(', ') || 'portfolio holdings')}
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="font-display text-xl text-white">${item.score}</div>
                            <div class="text-[10px] text-fuchsia-100/58 font-mono">${Math.round(item.avgStrength * 100)}% AVG</div>
                        </div>
                    </div>
                </button>
            `;
    }

    function renderPortfolioRepeatedExposure(items, context) {
        const { escapeHtml } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No company is connected to multiple matched holdings in this dataset.</div>';

        return items.map(item => `
                <button onclick="selectPortfolioNexusNode(${Number(item.node.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">
                                ${escapeHtml(item.node.ticker || '')}
                                <span class="text-white/35">- connected to</span>
                                ${escapeHtml(item.connectedPortfolioTickers.join(', '))}
                            </div>
                            <div class="text-xs text-white/45 truncate">${escapeHtml(item.node.name || '')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-emerald-200">${Math.round(item.avgStrength * 100)}%</div>
                            <div class="text-[10px] text-white/38">AVG</div>
                        </div>
                    </div>
                </button>
            `).join('');
    }

    function renderPortfolioClusterTouchpoints(items, context) {
        const { escapeHtml } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No meaningful hidden clusters touched by the current portfolio.</div>';

        return items.map(item => `
                <button onclick="selectPortfolioNexusNode(${Number(item.center.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">${escapeHtml(item.center.ticker || '')} cluster</div>
                            <div class="text-xs text-white/48 truncate">
                                Touches ${item.touchedCount} portfolio-adjacent node${item.touchedCount === 1 ? '' : 's'}
                            </div>
                            <div class="mt-1 text-[11px] text-cyan-100/55 truncate">
                                ${escapeHtml(item.topMembers.map(node => node.ticker || '').filter(Boolean).join(', ') || 'Static graph cluster')}
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-cyan-200">${Math.round(item.avgStrength * 100)}%</div>
                            <div class="text-[10px] text-white/38">AVG</div>
                        </div>
                    </div>
                </button>
            `).join('');
    }

    function renderPortfolioHubList(items, context) {
        const { escapeHtml } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No portfolio-connected hubs in the current dataset.</div>';

        return items.map((item, index) => `
                <button onclick="selectNodeById(${Number(item.node.id)})" class="connection-row w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0 flex items-center gap-2">
                            <span class="shrink-0 px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-white/45 font-mono">#${index + 1}</span>
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-white/90">${escapeHtml(item.node.ticker || '')}</div>
                                <div class="text-xs text-white/45 truncate">${escapeHtml(item.node.name || '')}</div>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="font-display text-lg text-white">${item.portfolioEdgeCount}</div>
                            <div class="text-[10px] text-cyan-200/58 font-mono">LINKS</div>
                        </div>
                    </div>
                </button>
            `).join('');
    }

    function renderPortfolioDistribution(entries, color, shadowColor, context) {
        const { escapeHtml } = context;
        if (!entries.length) return '<div class="text-sm text-white/35">No edge-derived exposure.</div>';
        const total = entries.reduce((sum, [, count]) => sum + count, 0);
        const maxCount = Math.max(...entries.map(([, count]) => count), 1);

        return entries.map(([label, count]) => {
            const width = Math.max(8, Math.round((count / maxCount) * 100));
            const percent = total ? Math.round((count / total) * 100) : 0;
            return `
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div class="flex items-center justify-between gap-3 text-xs">
                            <span class="text-white/75 truncate">${count} ${escapeHtml(label)}</span>
                            <span class="text-white/38 font-mono shrink-0">${percent}%</span>
                        </div>
                        <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div class="h-full rounded-full" style="width:${width}%; background:${color}; box-shadow:0 0 10px ${shadowColor};"></div>
                        </div>
                    </div>
                `;
        }).join('');
    }

    function renderPortfolioStrongestEdge(link, context) {
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType, getConnectionStrength, getRelationshipTypeLabel, getRelationshipTypeColor } = context;
        if (!link) return '<div class="text-sm text-white/35">No portfolio-connected edge found.</div>';
        const color = getRelationshipTypeColor?.(link) || EDGE_COLORS[link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(getConnectionStrength(link) * 100);
        const typeLabel = getRelationshipTypeLabel?.(link) || formatConnectionType(link.type || 'link');
        return `
                <div class="connection-row top-connection top-connection-1 rounded-2xl p-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">${escapeHtml(link.source.ticker || '')} <span class="text-white/35">to</span> ${escapeHtml(link.target.ticker || '')}</div>
                            <div class="text-xs text-white/50 leading-snug mt-1">${escapeHtml(link.label || 'Curated connection')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono" style="color:${color}">${strengthPercent}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(typeLabel)}</div>
                        </div>
                    </div>
                </div>
            `;
    }

    function renderSecPreviewNodeOverlaySection(links, context) {
        if (!links?.length) return '';
        const { escapeHtml } = context;
        return `
            <div class="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 mb-5">
                <div class="text-[10px] text-cyan-100/85 font-mono tracking-[1.6px]">PREVIEW DATA (NOT VERIFIED)</div>
                <div class="mt-1 text-xs text-white/58">source: SEC filing</div>
                <div class="mt-3 space-y-2">
                    ${links.slice(0, 3).map(link => renderSecPreviewRelationshipRow(link, context)).join('')}
                </div>
                ${links.length > 3 ? `<div class="mt-2 text-[11px] text-white/42 font-mono">+${escapeHtml(String(links.length - 3))} MORE SEC PREVIEW EDGES</div>` : ''}
            </div>
        `;
    }

    function showSecPreviewNodeDetails(context) {
        const {
            sidebar,
            empty,
            node,
            previewLinks = [],
            escapeHtml,
            formatConnectionType
        } = context;
        if (!sidebar || !node) return;

        const links = previewLinks.length ? previewLinks : (node.previewLinks || []);
        const primary = links[0] || null;

        sidebar.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <div class="text-[10px] text-cyan-200/85 font-mono tracking-[2px]">PREVIEW DATA (NOT VERIFIED)</div>
                    <h2 class="font-display text-3xl text-white mt-1">${escapeHtml(node.ticker || '')}</h2>
                    <div class="text-sm text-white/58 mt-1">${escapeHtml(node.name || 'SEC preview relationship candidate')}</div>
                </div>
                <button onclick="clearSelection()" class="focus-button w-9 h-9 rounded-full border border-white/15 text-white/70">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
                <div class="text-[10px] font-mono text-cyan-100/80 tracking-[1.5px]">source: SEC filing</div>
                <div class="mt-2 text-xs leading-relaxed text-white/62">
                    This node exists only in the SEC preview rendering layer. It is not present in production graph data.
                </div>
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-title">Preview Evidence</div>
                ${renderSecPreviewEvidence(primary, context)}
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-title">Preview Relationships</div>
                <div class="space-y-2">
                    ${links.map(link => renderSecPreviewRelationshipRow(link, context)).join('') || '<div class="text-sm text-white/35">No visible preview relationships at this threshold.</div>'}
                </div>
            </div>
        `;

        if (empty) empty.classList.add('hidden');
        sidebar.classList.remove('hidden');
    }

    function showSecPreviewEdgeDetails(context) {
        const {
            sidebar,
            empty,
            link,
            escapeHtml,
            formatConnectionType
        } = context;
        if (!sidebar || !link) return;

        sidebar.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <div class="text-[10px] text-cyan-200/85 font-mono tracking-[2px]">PREVIEW DATA (NOT VERIFIED)</div>
                    <h2 class="font-display text-2xl text-white mt-1">
                        ${escapeHtml(link.sourceTicker || link.source?.ticker || '')}
                        <span class="text-white/35">to</span>
                        ${escapeHtml(link.targetTicker || link.target?.ticker || '')}
                    </h2>
                    <div class="text-sm text-white/58 mt-1">${escapeHtml(formatConnectionType(link.type || 'sec_preview'))}</div>
                </div>
                <button onclick="clearSelection()" class="focus-button w-9 h-9 rounded-full border border-white/15 text-white/70">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div class="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
                <div class="grid grid-cols-1 gap-2 text-xs">
                    <div><span class="text-white/38 font-mono">source:</span> <span class="text-cyan-100/82">SEC filing</span></div>
                    <div><span class="text-white/38 font-mono">confidence_hint:</span> <span class="text-white/82">${escapeHtml(formatSecPreviewValue(link.candidate?.confidence_hint ?? link.confidence))}</span></div>
                    <div><span class="text-white/38 font-mono">relationship_type:</span> <span class="text-white/82">${escapeHtml(formatConnectionType(link.type || 'sec_preview'))}</span></div>
                </div>
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-title">Evidence Snippet</div>
                ${renderSecPreviewEvidence(link, context)}
            </div>
        `;

        if (empty) empty.classList.add('hidden');
        sidebar.classList.remove('hidden');
    }

    function renderSecPreviewRelationshipRow(link, context) {
        const { escapeHtml, formatConnectionType } = context;
        const otherTicker = escapeHtml(link.sourceTicker || link.source?.ticker || '') + ' to ' +
            escapeHtml(link.targetTicker || link.target?.ticker || '');
        return `
            <div class="connection-row rounded-2xl p-3 border-cyan-300/20 bg-cyan-300/5">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-white/88 truncate">${otherTicker}</div>
                        <div class="mt-1 text-[10px] font-mono text-cyan-100/65">source: SEC filing</div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="text-[10px] text-white/42">${escapeHtml(formatConnectionType(link.type || 'sec_preview'))}</div>
                        <div class="text-[10px] text-cyan-100/70 font-mono">confidence_hint ${escapeHtml(formatSecPreviewValue(link.candidate?.confidence_hint ?? link.confidence))}</div>
                    </div>
                </div>
                <div class="mt-2 text-xs text-white/55 leading-relaxed">${escapeHtml(formatEvidenceSnippet(link.candidate?.evidence_snippet || link.evidence_snippet || 'No evidence snippet attached.'))}</div>
            </div>
        `;
    }

    function renderSecPreviewEvidence(link, context) {
        const { escapeHtml } = context;
        const candidate = link?.candidate || {};
        const evidence = candidate.evidence_snippet || link?.evidence_snippet || 'No evidence snippet attached.';
        return `
            <div class="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div class="text-[10px] font-mono text-white/42 mb-2">evidence_snippet</div>
                <div class="text-sm text-white/78 leading-relaxed">${escapeHtml(formatEvidenceSnippet(evidence))}</div>
                <div class="mt-3 grid grid-cols-1 gap-1 text-[11px] text-white/48">
                    <div><span class="font-mono text-white/36">source:</span> SEC filing</div>
                    <div><span class="font-mono text-white/36">confidence_hint:</span> ${escapeHtml(formatSecPreviewValue(candidate.confidence_hint ?? link?.confidence))}</div>
                    <div><span class="font-mono text-white/36">filing_date:</span> ${escapeHtml(formatSecPreviewValue(candidate.filing_date))}</div>
                </div>
            </div>
        `;
    }

    function formatSecPreviewValue(value) {
        if (value === null || value === undefined || value === '') return '-';
        return String(value);
    }

    function formatEvidenceSnippet(value) {
        const text = formatSecPreviewValue(value);
        return text.length > 280 ? `${text.slice(0, 277)}...` : text;
    }

    window.StockPhotonicUI.sidebar = {
        showNodeDetails,
        showSecPreviewNodeDetails,
        showSecPreviewEdgeDetails,
        renderCompanyInvestigationWorkspace,
        renderRelationshipEvidenceCards,
        renderRelationshipEvidenceCard,
        renderConnectedCompaniesByType,
        renderNexusViewSection,
        renderNexusSummaryTile,
        renderRelatedClusterSection,
        renderClusterNodeRow,
        renderSharedExposureSection,
        renderSharedExposureRow,
        renderHiddenRelationshipsSection,
        renderHiddenRelationshipRow,
        renderConnectionRow,
        renderConnectionSourceLinks,
        renderSignalClarityConnection,
        renderConnectionTypeMix,
        renderSectorDistribution,
        renderIndustryGroupDistribution,
        renderTopIndustryGroupsByCount,
        renderTopIndustryGroupsByAverageStrength,
        renderIndustryCorrelationContextSection,
        renderNodeSources,
        renderNodePortfolioBadges,
        renderPortfolioExposureSection,
        renderPortfolioUnmatchedTickers,
        renderPortfolioTopNexus,
        renderPortfolioRepeatedExposure,
        renderPortfolioClusterTouchpoints,
        renderPortfolioHubList,
        renderPortfolioDistribution,
        renderPortfolioStrongestEdge
    };
})();
