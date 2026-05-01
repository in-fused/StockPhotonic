(function () {
    window.StockPhotonicUI = window.StockPhotonicUI || {};

    function clampSearchHighlight(context) {
        const { count, highlightedSearchIndex, clamp } = context;
        if (!count) {
            return -1;
        }
        return highlightedSearchIndex < 0 ? 0 : clamp(highlightedSearchIndex, 0, count - 1);
    }

    function renderSearchPanel(context) {
        const {
            panel,
            searchPanelOpen,
            currentSearch,
            nodesForPanel,
            highlightedSearchIndex,
            escapeHtml,
            getCompanyIndustryGroup
        } = context;
        if (!panel) return;

        if (!searchPanelOpen || (!currentSearch && !nodesForPanel.length)) {
            panel.classList.add('hidden');
            panel.innerHTML = '';
            return;
        }

        const heading = currentSearch ? 'MATCHES' : 'RECENT NODES';
        const emptyState = currentSearch && !nodesForPanel.length
            ? '<div class="px-4 py-4 text-sm text-white/45">No company matches this search.</div>'
            : '';
        const resultRows = nodesForPanel
            .map((node, index) => renderSearchResult(node, index, {
                highlightedSearchIndex,
                escapeHtml,
                getCompanyIndustryGroup
            }))
            .join('');

        panel.innerHTML = `
                <div class="px-3 pt-2 pb-1 text-[10px] text-cyan-200/70 font-mono tracking-[2px]">${heading}</div>
                <div class="space-y-1">${resultRows || emptyState}</div>
            `;
        panel.classList.remove('hidden');
    }

    function renderSearchResult(node, index, context) {
        const { highlightedSearchIndex, escapeHtml, getCompanyIndustryGroup } = context;
        const activeClass = index === highlightedSearchIndex ? ' is-active' : '';
        return `
                <button type="button"
                        data-search-node-id="${escapeHtml(node.id)}"
                        data-search-index="${index}"
                        class="search-result${activeClass} w-full rounded-2xl border border-white/10 px-3 py-2 text-left flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex items-baseline gap-2">
                            <span class="font-display text-white text-sm">${escapeHtml(node.ticker || '')}</span>
                            <span class="text-xs text-white/62 truncate">${escapeHtml(node.name || '')}</span>
                        </div>
                        <div class="text-[11px] text-cyan-200/58 mt-0.5 truncate">${escapeHtml(node.sector || 'Unknown Sector')} / ${escapeHtml(getCompanyIndustryGroup(node))}</div>
                    </div>
                    <i class="fa-solid fa-location-crosshairs text-cyan-300/70 shrink-0"></i>
                </button>
            `;
    }

    function getSearchPanelNodes(context) {
        const { currentSearch, searchMatches, getRecentNodes } = context;
        return currentSearch ? searchMatches : getRecentNodes();
    }

    window.StockPhotonicUI.search = {
        clampSearchHighlight,
        renderSearchPanel,
        renderSearchResult,
        getSearchPanelNodes
    };
})();
