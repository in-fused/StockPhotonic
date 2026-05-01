(function () {
    window.StockPhotonicUI = window.StockPhotonicUI || {};

    function renderDefaultDashboard(context) {
        const { empty, nodes } = context;
        if (!empty) return;

        if (!nodes.length) {
            empty.innerHTML = `
                    <div class="h-full min-h-[320px] flex flex-col items-center justify-center text-center">
                        <i class="fa-solid fa-project-diagram text-5xl text-white/20 mb-4"></i>
                        <div class="font-semibold text-white/60">Loading graph intelligence</div>
                        <div class="text-xs text-white/35 mt-2 max-w-xs">The dashboard is derived from the static dataset.</div>
                    </div>
                `;
            return;
        }

        const stats = getDefaultDashboardStats(context);
        empty.innerHTML = `
                <div class="flex items-start justify-between gap-4 mb-5">
                    <div>
                        <div class="text-xs text-cyan-300/80 font-mono tracking-[2px]">${stats.contextLabel}</div>
                        <h2 class="font-display text-3xl text-white mt-1">Nexus Intelligence</h2>
                        <div class="text-sm text-white/55 mt-1">Derived from the current static company and connection dataset.</div>
                    </div>
                    <button onclick="fitGraph()" class="focus-button w-9 h-9 rounded-full border border-white/15 text-white/70" title="Fit graph">
                        <i class="fa-solid fa-compress"></i>
                    </button>
                </div>

                <div class="grid grid-cols-3 gap-3 mb-5">
                    <div class="summary-tile rounded-2xl p-3">
                        <div class="text-[10px] text-white/40 font-mono">VISIBLE NODES</div>
                        <div class="font-display text-xl text-white">${stats.visibleNodeCount}</div>
                    </div>
                    <div class="summary-tile rounded-2xl p-3">
                        <div class="text-[10px] text-white/40 font-mono">VISIBLE EDGES</div>
                        <div class="font-display text-xl text-white">${stats.visibleEdgeCount}</div>
                    </div>
                    <div class="summary-tile rounded-2xl p-3">
                        <div class="text-[10px] text-white/40 font-mono">CONF >=4</div>
                        <div class="font-display text-xl text-white">${stats.trust.highConfidencePercent}%</div>
                    </div>
                </div>

                ${renderLayoutHelperSection(context)}
                ${context.renderPortfolioExposureSection(stats.portfolioExposure)}

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Suggested Exploration</div>
                    <div class="flex flex-wrap gap-2">
                        ${renderExplorationChips(context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Top Hub Companies</div>
                    <div class="space-y-2">
                        ${renderDashboardHubList(stats.topHubs, context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Strongest Connections</div>
                    <div class="space-y-2">
                        ${renderDashboardConnectionList(stats.strongestConnections, context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Top Industry Correlations</div>
                    <div class="space-y-2">
                        ${renderDashboardIndustryCorrelationList(stats.topIndustryCorrelations, context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Sector Distribution</div>
                    <div class="space-y-2">
                        ${renderDashboardDistribution(stats.sectorDistribution, stats.visibleNodeCount, '#67e8f9', 'rgba(0, 249, 255, 0.45)', context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Industry Group Distribution</div>
                    <div class="space-y-2">
                        ${renderDashboardDistribution(stats.industryGroupDistribution, stats.visibleNodeCount, '#f0abfc', 'rgba(255, 0, 170, 0.40)', context)}
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-section-title">Dataset Trust Summary</div>
                    ${renderDashboardTrustSummary(stats.trust, context)}
                </div>
            `;
    }

    function renderLayoutHelperSection(context) {
        const { layoutMode, selectedNode, LAYOUT_MODE_NEXUS, LAYOUT_MODE_HUB } = context;
        if (layoutMode === LAYOUT_MODE_NEXUS && !selectedNode) {
            return `
                    <div class="sidebar-section">
                        <div class="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-3 text-sm text-cyan-50/72">
                            Select a company to activate Nexus View.
                        </div>
                    </div>
                `;
        }

        if (layoutMode === LAYOUT_MODE_HUB && !selectedNode) {
            return `
                    <div class="sidebar-section">
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/52">
                            Select a company to center its direct network in Hub Layout.
                        </div>
                    </div>
                `;
        }

        return '';
    }

    function getDefaultDashboardStats(context) {
        const {
            currentSector,
            currentIndustryGroup,
            currentSearch,
            signalStrengthThreshold,
            visibleNodes,
            nodes,
            visibleLinks,
            links,
            getIndustryGroupCorrelations,
            getCompanyIndustryGroup,
            getPortfolioExposureSummary,
            getDatasetTrustMetrics,
            companies,
            connections
        } = context;
        const activeContext = Boolean(currentSector || currentIndustryGroup || currentSearch || signalStrengthThreshold > 0);
        const nodesForStats = visibleNodes.length || activeContext ? visibleNodes : nodes;
        const linksForStats = visibleLinks.length || activeContext ? visibleLinks : links;
        const topHubs = [...nodesForStats]
            .map(node => ({ node, degree: getDashboardNodeDegree(node, context) }))
            .sort((a, b) => b.degree - a.degree || ((a.node.rank || 9999) - (b.node.rank || 9999)) || String(a.node.ticker || '').localeCompare(String(b.node.ticker || '')))
            .slice(0, 5);
        const strongestConnections = [...linksForStats]
            .sort((a, b) => b.strength - a.strength || String(a.source.ticker || '').localeCompare(String(b.source.ticker || '')))
            .slice(0, 5);
        const topIndustryCorrelations = getIndustryGroupCorrelations(linksForStats).slice(0, 5);

        return {
            contextLabel: activeContext ? 'VISIBLE GRAPH' : 'STATIC DATASET',
            visibleNodeCount: visibleNodes.length,
            visibleEdgeCount: visibleLinks.length,
            topHubs,
            strongestConnections,
            topIndustryCorrelations,
            sectorDistribution: getCompanyDistribution(nodesForStats, node => node.sector || 'Other').slice(0, 6),
            industryGroupDistribution: getCompanyDistribution(nodesForStats, node => getCompanyIndustryGroup(node) || 'Other').slice(0, 6),
            portfolioExposure: getPortfolioExposureSummary(),
            trust: getDatasetTrustMetrics(companies, connections)
        };
    }

    function getDashboardNodeDegree(node, context) {
        const { visibleEdgeCountByNodeId, degreeById } = context;
        if (!node) return 0;
        if (visibleEdgeCountByNodeId.has(node.id)) return visibleEdgeCountByNodeId.get(node.id);
        return node.degree || degreeById.get(node.id) || 0;
    }

    function getCompanyDistribution(items, getLabel) {
        const counts = new Map();
        items.forEach(item => {
            const label = getLabel(item) || 'Other';
            counts.set(label, (counts.get(label) || 0) + 1);
        });
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    }

    function renderExplorationChips(context) {
        const { EXPLORATION_CHIPS, escapeHtml } = context;
        return EXPLORATION_CHIPS.map(chip => `
                <button onclick="applyExplorationChip('${escapeHtml(chip.key)}')" class="dashboard-chip rounded-full px-3 py-1.5 text-xs text-cyan-100/78 font-mono">
                    ${escapeHtml(chip.label)}
                </button>
            `).join('');
    }

    function renderDashboardHubList(items, context) {
        const { escapeHtml } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No visible hub companies.</div>';

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
                            <div class="font-display text-lg text-white">${item.degree}</div>
                            <div class="text-[10px] text-cyan-200/58 font-mono">DEGREE</div>
                        </div>
                    </div>
                </button>
            `).join('');
    }

    function renderDashboardConnectionList(items, context) {
        const { EDGE_COLORS, DEFAULT_EDGE_COLOR, escapeHtml, formatConnectionType } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No visible connections at this threshold.</div>';

        return items.map((link, index) => {
            const color = EDGE_COLORS[link.type] || DEFAULT_EDGE_COLOR;
            const strengthPercent = Math.round(link.strength * 100);
            return `
                    <div class="connection-row ${index === 0 ? 'top-connection top-connection-1' : ''} rounded-2xl p-3">
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
                        <div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                            <div class="h-full rounded-full" style="width:${strengthPercent}%; background:${color}; box-shadow:0 0 10px ${color};"></div>
                        </div>
                    </div>
                `;
        }).join('');
    }

    function renderDashboardIndustryCorrelationList(items, context) {
        const { escapeHtml, escapeInlineJsString, formatConnectionType } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No cross-industry correlations in the current graph view.</div>';

        return items.map((item, index) => {
            const sampleTickers = item.involvedTickers.slice(0, 5).join(', ');
            const topClass = index === 0 ? 'top-connection top-connection-1' : '';
            return `
                    <button onclick="applyIndustryCorrelationFilter('${escapeInlineJsString(item.groupA)}', '${escapeInlineJsString(item.groupB)}')" class="connection-row ${topClass} w-full rounded-2xl p-3 text-left hover:bg-white/10 transition">
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-white/90 leading-snug">${escapeHtml(item.groupA)} <span class="text-cyan-200/70">&harr;</span> ${escapeHtml(item.groupB)}</div>
                                <div class="text-xs text-white/48 mt-1">${item.edgeCount} edge${item.edgeCount === 1 ? '' : 's'} · ${item.averageStrengthPercent}% avg · ${escapeHtml(formatConnectionType(item.dominantConnectionType))}</div>
                                <div class="text-[11px] text-white/58 mt-2 truncate">${escapeHtml(sampleTickers || 'No ticker sample')}</div>
                            </div>
                            <div class="text-right shrink-0">
                                <div class="font-display text-lg text-white">${item.highConfidenceEdgeCount}</div>
                                <div class="text-[10px] text-emerald-200/62 font-mono">CONF >=4</div>
                            </div>
                        </div>
                    </button>
                `;
        }).join('');
    }

    function renderDashboardDistribution(entries, total, color, shadowColor, context) {
        const { escapeHtml } = context;
        if (!entries.length) return '<div class="text-sm text-white/35">No visible companies.</div>';
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

    function renderDashboardTrustSummary(metrics, context) {
        const { escapeHtml, formatVerifiedDate } = context;
        return `
                <div class="trust-panel rounded-2xl p-4">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <div class="text-[10px] text-white/40 font-mono">COMPANIES</div>
                            <div class="font-display text-xl text-white">${metrics.companyCount}</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-white/40 font-mono">EDGES</div>
                            <div class="font-display text-xl text-white">${metrics.connectionCount}</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-white/40 font-mono">CONF >=4</div>
                            <div class="font-display text-xl text-white">${metrics.highConfidencePercent}%</div>
                        </div>
                        <div>
                            <div class="text-[10px] text-white/40 font-mono">LATEST VERIFIED</div>
                            <div class="font-display text-xl text-white">${escapeHtml(formatVerifiedDate(metrics.latestVerifiedDate))}</div>
                        </div>
                    </div>
                    <div class="mt-3 pt-3 border-t border-white/10 text-[10px] text-cyan-100/58 font-mono tracking-[1.2px]">STATIC DATASET ONLY</div>
                </div>
            `;
    }

    window.StockPhotonicUI.dashboard = {
        renderDefaultDashboard,
        renderLayoutHelperSection,
        getDefaultDashboardStats,
        getDashboardNodeDegree,
        getCompanyDistribution,
        renderExplorationChips,
        renderDashboardHubList,
        renderDashboardConnectionList,
        renderDashboardIndustryCorrelationList,
        renderDashboardDistribution,
        renderDashboardTrustSummary
    };
})();
