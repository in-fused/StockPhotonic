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
                ${renderActiveContextStrip(context, stats)}

                <div class="flex items-start justify-between gap-4 mb-5">
                    <div>
                        <div class="text-xs text-cyan-300/80 font-mono tracking-[2px]">${stats.contextLabel}</div>
                        <h2 class="font-display text-3xl text-white mt-1">Nexus Intelligence</h2>
                        <div class="text-sm text-white/60 mt-1">Command view of the strongest companies, relationships, and clusters in the current static dataset.</div>
                    </div>
                    <button onclick="fitGraph()" class="focus-button w-9 h-9 rounded-full border border-white/15 text-white/70" title="Fit graph">
                        <i class="fa-solid fa-compress"></i>
                    </button>
                </div>

                <div class="grid grid-cols-3 gap-3 mb-6">
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

                ${renderIntelligenceSummaryPanel(stats, context)}
                ${renderKeyNetworkInsights(stats, context)}
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
            isSecBackedConnection,
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
        const secBackedConnections = [...linksForStats]
            .filter(link => typeof isSecBackedConnection === 'function' && isSecBackedConnection(link))
            .sort((a, b) => {
                const dateCompare = String(b.verified_date || '').localeCompare(String(a.verified_date || ''));
                if (dateCompare) return dateCompare;
                return (Number(b.confidence) || 0) - (Number(a.confidence) || 0) ||
                    (Number(b.strength) || 0) - (Number(a.strength) || 0);
            })
            .slice(0, 3);
        const topIndustryCorrelations = getIndustryGroupCorrelations(linksForStats).slice(0, 5);
        const sectorDistribution = getCompanyDistribution(nodesForStats, node => node.sector || 'Other').slice(0, 6);
        const industryGroupDistribution = getCompanyDistribution(nodesForStats, node => getCompanyIndustryGroup(node) || 'Other').slice(0, 6);
        const topSectorPairs = getDashboardSectorPairs(linksForStats).slice(0, 3);
        const bridgeNodes = getDashboardBridgeNodes(nodesForStats, linksForStats).slice(0, 3);

        return {
            contextLabel: activeContext ? 'VISIBLE GRAPH' : 'STATIC DATASET',
            visibleNodeCount: visibleNodes.length,
            visibleEdgeCount: visibleLinks.length,
            topHubs,
            strongestConnections,
            secBackedConnections,
            topIndustryCorrelations,
            topSectorPairs,
            bridgeNodes,
            sectorDistribution,
            industryGroupDistribution,
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

    function getDashboardSectorPairs(links) {
        const pairs = new Map();
        links.forEach(link => {
            const sourceSector = link.source?.sector || 'Other';
            const targetSector = link.target?.sector || 'Other';
            const pair = [sourceSector, targetSector].sort((a, b) => String(a).localeCompare(String(b)));
            const key = pair.join('::');
            const existing = pairs.get(key) || { sectors: pair, edgeCount: 0, totalStrength: 0 };
            existing.edgeCount += 1;
            existing.totalStrength += Number(link.strength) || 0;
            pairs.set(key, existing);
        });

        return [...pairs.values()]
            .map(item => ({
                ...item,
                avgStrengthPercent: item.edgeCount ? Math.round((item.totalStrength / item.edgeCount) * 100) : 0
            }))
            .sort((a, b) => b.edgeCount - a.edgeCount || b.avgStrengthPercent - a.avgStrengthPercent || a.sectors.join('').localeCompare(b.sectors.join('')));
    }

    function getDashboardBridgeNodes(nodes, links) {
        const visibleNodeIds = new Set(nodes.map(node => node.id));
        const bridgeMap = new Map(nodes.map(node => [node.id, { node, sectors: new Set(), degree: 0 }]));
        links.forEach(link => {
            [
                [link.source, link.target],
                [link.target, link.source]
            ].forEach(([node, otherNode]) => {
                if (!node || !otherNode || !visibleNodeIds.has(node.id)) return;
                const entry = bridgeMap.get(node.id);
                if (!entry) return;
                entry.degree += 1;
                if (otherNode.sector && otherNode.sector !== node.sector) entry.sectors.add(otherNode.sector);
            });
        });

        return [...bridgeMap.values()]
            .filter(item => item.degree > 0)
            .sort((a, b) => b.sectors.size - a.sectors.size || b.degree - a.degree || ((a.node.rank || 9999) - (b.node.rank || 9999)));
    }

    function renderActiveContextStrip(context, stats) {
        const { escapeHtml } = context;
        const filters = [
            context.currentSector || '',
            context.currentIndustryGroup || '',
            context.currentSearch ? `Search: ${context.currentSearch}` : ''
        ].filter(Boolean).join(' / ') || 'All companies';
        const focusOn = Boolean(context.focusModeEnabled || (typeof context.isFocusModeActive === 'function' && context.isFocusModeActive()));
        const threshold = Number(context.signalStrengthThreshold || 0);
        const portfolio = stats?.portfolioExposure?.active
            ? `${stats.portfolioExposure.matchedCount || 0} matched`
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

    function renderIntelligenceSummaryPanel(stats, context) {
        return `
                <div class="rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4 mb-6">
                    <div class="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <div class="sidebar-section-title mb-1">Intelligence Summary</div>
                            <div class="text-sm text-white/60">The strongest signals in the visible network.</div>
                        </div>
                        <div class="text-[10px] text-cyan-100/60 font-mono">${stats.contextLabel}</div>
                    </div>
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        ${renderCommandCenterCard('Most Connected Nodes', renderDashboardHubList(stats.topHubs, context))}
                        ${renderCommandCenterCard('Strongest Relationships', renderDashboardConnectionList(stats.strongestConnections, context))}
                        ${renderCommandCenterCard('SEC-Backed Edges', renderDashboardSecBackedList(stats.secBackedConnections, context))}
                        ${renderCommandCenterCard('Sector Distribution', renderDashboardDistribution(stats.sectorDistribution.slice(0, 4), stats.visibleNodeCount, '#67e8f9', 'rgba(0, 249, 255, 0.45)', context))}
                        ${renderCommandCenterCard('Industry Cluster Concentration', renderIndustryClusterConcentration(stats, context), 'xl:col-span-2')}
                    </div>
                </div>
            `;
    }

    function renderCommandCenterCard(title, body, extraClass = '') {
        return `
                <div class="rounded-2xl border border-white/10 bg-black/20 p-3 ${extraClass}">
                    <div class="text-[10px] text-white/45 font-mono tracking-[1.4px] mb-2">${title.toUpperCase()}</div>
                    <div class="space-y-2">${body}</div>
                </div>
            `;
    }

    function renderDashboardSecBackedList(items, context) {
        const { escapeHtml, formatConnectionType, formatVerifiedDate } = context;
        if (!items.length) return '<div class="text-sm text-white/35">No SEC-backed production edges in the current view.</div>';

        return items.map(link => `
                <div class="connection-row sec-backed-connection-row rounded-2xl p-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">${escapeHtml(link.source.ticker || '')} <span class="text-white/35">to</span> ${escapeHtml(link.target.ticker || '')}</div>
                            <div class="text-xs text-white/50 leading-snug mt-1">${escapeHtml(link.label || 'SEC-backed relationship')}</div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-sm font-mono text-yellow-100">${Math.round((Number(link.strength) || 0) * 100)}%</div>
                            <div class="text-[10px] text-white/42">${escapeHtml(formatConnectionType(link.type || 'link'))}</div>
                        </div>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
                        <span class="sec-edge-badge px-2 py-0.5 rounded-full">SEC BACKED</span>
                        <span class="text-white/42">CONF ${Number(link.confidence) || 0}/5</span>
                        <span class="text-white/42">VERIFIED ${escapeHtml(formatVerifiedDate(link.verified_date))}</span>
                    </div>
                </div>
            `).join('');
    }

    function renderIndustryClusterConcentration(stats, context) {
        const { escapeHtml } = context;
        if (!stats.industryGroupDistribution.length) return '<div class="text-sm text-white/35">No industry clusters available.</div>';
        const total = Math.max(stats.visibleNodeCount, stats.industryGroupDistribution.reduce((sum, [, count]) => sum + count, 0), 1);
        const topGroups = stats.industryGroupDistribution.slice(0, 3);
        const concentration = Math.round((topGroups.reduce((sum, [, count]) => sum + count, 0) / total) * 100);

        return `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div class="summary-tile rounded-2xl p-3 md:col-span-1">
                        <div class="text-[10px] text-white/40 font-mono">TOP 3 CLUSTERS</div>
                        <div class="font-display text-2xl text-white">${concentration}%</div>
                        <div class="text-xs text-white/45 mt-1">of visible companies</div>
                    </div>
                    <div class="md:col-span-2 space-y-2">
                        ${topGroups.map(([label, count]) => `
                            <div class="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                                <span class="text-white/75 truncate">${escapeHtml(label)}</span>
                                <span class="font-mono text-cyan-100/75">${count}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
    }

    function renderKeyNetworkInsights(stats, context) {
        const { escapeHtml } = context;
        const insights = getKeyNetworkInsightSentences(stats, context);
        return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Key Network Insights</div>
                    <div class="rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/5 p-4">
                        <div class="space-y-3">
                            ${insights.map(insight => `
                                <div class="flex items-start gap-3 text-sm text-white/78 leading-relaxed">
                                    <i class="fa-solid fa-bolt text-cyan-200/75 mt-1 text-xs"></i>
                                    <div>${escapeHtml(insight)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
    }

    function getKeyNetworkInsightSentences(stats, context) {
        const { formatConnectionType } = context;
        const hubNames = stats.topHubs.slice(0, 3).map(item => item.node.ticker || item.node.name).filter(Boolean);
        const topSectorPair = stats.topSectorPairs[0];
        const bridge = stats.bridgeNodes[0];
        const strongest = stats.strongestConnections[0];
        const topCluster = stats.industryGroupDistribution[0];

        return [
            hubNames.length
                ? `${hubNames.join(', ')} are the main hubs because they touch the most company relationships in this view.`
                : 'No clear hub stands out in the current view.',
            topSectorPair
                ? `${topSectorPair.sectors.join(' and ')} form the most active sector corridor, with ${topSectorPair.edgeCount} visible relationship${topSectorPair.edgeCount === 1 ? '' : 's'}.`
                : 'No sector corridor is visible at the current filters.',
            bridge
                ? `${bridge.node.ticker || bridge.node.name} bridges ${bridge.sectors.size || 1} outside sector${bridge.sectors.size === 1 ? '' : 's'}, so it can explain movement between otherwise separate groups.`
                : 'No strong cross-sector bridge is visible at the current filters.',
            strongest
                ? `${strongest.source.ticker || strongest.source.name} to ${strongest.target.ticker || strongest.target.name} is unusually strong for a ${formatConnectionType(strongest.type || 'link').toLowerCase()} relationship.`
                : 'No unusually strong relationship is visible at the current threshold.',
            topCluster
                ? `${topCluster[0]} is the densest industry cluster, so changes there may affect more companies than smaller groups.`
                : 'Industry concentration is not available for the current view.'
        ];
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
