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
            escapeHtml,
            formatNumber,
            formatConnectionType
        } = context;

        sidebar.innerHTML = `
                <div class="flex items-start justify-between gap-4 mb-5">
                    <div>
                        <div class="text-xs text-cyan-300/80 font-mono tracking-[2px]">${escapeHtml(node.sector || 'UNKNOWN')}</div>
                        <h2 class="font-display text-3xl text-white mt-1">${escapeHtml(node.ticker || '')}</h2>
                        <div class="text-sm text-white/60 mt-1">${escapeHtml(node.name || '')}</div>
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

    function renderNexusViewSection(node, context) {
        if (!context.isNexusLayoutActive() || !node) return '';

        const summary = context.getNexusSummary(node);
        const groups = ['supply', 'partner', 'competitive', 'capital'];
        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Nexus View</div>
                    <div class="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-3 mb-3 text-xs text-cyan-50/62 leading-relaxed">
                        Counts are grouped from visible direct edges by relationship type only.
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        ${groups.map(groupKey => renderNexusSummaryTile(summary.groups[groupKey], context)).join('')}
                    </div>
                </div>
            `;
    }

    function renderNexusSummaryTile(group, context) {
        const { escapeHtml, formatConnectionType, getConnectionStrength } = context;
        const strongest = group.strongest;
        const strengthText = strongest ? `${Math.round(getConnectionStrength(strongest.link) * 100)}% edge` : 'No visible edge';
        const tickerText = strongest ? `${strongest.node.ticker || strongest.node.name || 'Company'}` : 'None';
        const relationshipText = strongest
            ? `${formatConnectionType(strongest.link.type || 'link')}: ${strongest.link.label || 'Loaded direct edge'}`
            : 'No strongest relationship at current filters';
        return `
                <div class="summary-tile rounded-2xl p-3">
                    <div class="text-[10px] text-white/40 font-mono">${escapeHtml(group.shortLabel.toUpperCase())}</div>
                    <div class="font-display text-2xl text-white">${group.count}</div>
                    <div class="mt-1 text-xs text-white/70 truncate">${escapeHtml(tickerText)}</div>
                    <div class="text-[10px] text-cyan-100/55 font-mono">${escapeHtml(strengthText)}</div>
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
            getValidSourceUrls
        } = context;
        const color = EDGE_COLORS[item.link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(item.link.strength * 100);
        const confidence = Number(item.link.confidence) || 0;
        const confidenceClass = getConfidenceClass(confidence);
        const verifiedDate = formatVerifiedDate(item.link.verified_date);
        const sourceUrls = getValidSourceUrls(item.link.source_urls);
        const sourceLinks = renderConnectionSourceLinks(item.link.source_urls, context);
        const rank = index + 1;
        const topClass = rank <= 3 ? `top-connection top-connection-${rank}` : '';
        const sourceLabel = sourceUrls.length === 1 ? '1 SOURCE' : `${sourceUrls.length} SOURCES`;
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
                            <div class="text-[10px] font-mono" style="color:${color}">${escapeHtml(formatConnectionType(item.link.type || 'link'))}</div>
                            <div class="text-xs text-white/55">${strengthPercent}%</div>
                        </div>
                    </div>
                    <div class="mt-2 text-xs text-white/70 leading-snug">${escapeHtml(item.link.label || 'Curated connection')}</div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                        <span class="confidence-badge ${confidenceClass} px-2 py-0.5 rounded-full text-[10px] font-mono">CONF ${confidence}/5</span>
                        <span class="source-indicator px-2 py-0.5 rounded-full text-[10px] text-cyan-200/78 font-mono">
                            <i class="fa-solid ${sourceUrls.length ? 'fa-link' : 'fa-link-slash'} mr-1"></i>${sourceLabel}
                        </span>
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
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType } = context;
        if (!item) {
            return `
                    <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div class="text-[10px] text-white/38 font-mono tracking-[1.2px]">${escapeHtml(label)}</div>
                        <div class="mt-1 text-sm text-white/35">No visible connection at this threshold.</div>
                    </div>
                `;
        }

        const color = EDGE_COLORS[item.link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(item.link.strength * 100);
        return `
                <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-[10px] text-white/38 font-mono tracking-[1.2px]">${escapeHtml(label)}</div>
                            <div class="mt-1 text-sm text-white/88 font-semibold truncate">${escapeHtml(item.node.ticker || '')} <span class="text-white/45 font-normal">${escapeHtml(item.node.name || '')}</span></div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono" style="color:${color}">${strengthPercent}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(formatConnectionType(item.link.type || 'link'))}</div>
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
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType } = context;
        const entries = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
        if (!entries.length) return '<span class="text-sm text-white/35">No linked companies found.</span>';

        return entries.map(([type, count]) => `
                <span class="px-3 py-1 rounded-full text-xs border border-white/10 bg-white/5" style="color:${EDGE_COLORS[type] || DEFAULT_EDGE_COLOR}">
                    ${escapeHtml(formatConnectionType(type))} ${count}
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
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType, getConnectionStrength } = context;
        if (!link) return '<div class="text-sm text-white/35">No portfolio-connected edge found.</div>';
        const color = EDGE_COLORS[link.type] || DEFAULT_EDGE_COLOR;
        const strengthPercent = Math.round(getConnectionStrength(link) * 100);
        return `
                <div class="connection-row top-connection top-connection-1 rounded-2xl p-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">${escapeHtml(link.source.ticker || '')} <span class="text-white/35">to</span> ${escapeHtml(link.target.ticker || '')}</div>
                            <div class="text-xs text-white/50 leading-snug mt-1">${escapeHtml(link.label || 'Curated connection')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono" style="color:${color}">${strengthPercent}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(formatConnectionType(link.type || 'link'))}</div>
                        </div>
                    </div>
                </div>
            `;
    }

    window.StockPhotonicUI.sidebar = {
        showNodeDetails,
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
