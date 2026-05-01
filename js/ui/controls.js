(function () {
    window.StockPhotonicUI = window.StockPhotonicUI || {};

    function buildSectorFilter(context) {
        const { select, companies, escapeHtml } = context;
        const sectors = [...new Set(companies.map(company => company.sector).filter(Boolean))].sort();
        select.innerHTML = '<option value="">All Sectors</option>' + sectors
            .map(sector => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`)
            .join('');
    }

    function buildIndustryGroupFilter(context) {
        const { select, companies, getCompanyIndustryGroup, escapeHtml } = context;
        if (!select) return;

        const groups = [...new Set(companies.map(getCompanyIndustryGroup).filter(Boolean))].sort();
        select.innerHTML = '<option value="">All Industry Groups</option>' + groups
            .map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
            .join('');
    }

    function updateFocusModeControl(context) {
        const { toggle, focusModeEnabled } = context;
        if (!toggle) return;

        toggle.setAttribute('aria-pressed', focusModeEnabled ? 'true' : 'false');
        toggle.classList.toggle('is-active', focusModeEnabled);
        toggle.title = focusModeEnabled
            ? 'Focus Mode on: selecting a node isolates its first-degree network.'
            : 'Focus Mode off: selected nodes keep the broader graph context.';
    }

    function updateSignalThresholdControl(context) {
        const { slider, value, signalStrengthThreshold } = context;
        if (slider && Number(slider.value) !== signalStrengthThreshold) slider.value = String(signalStrengthThreshold);
        if (value) value.innerText = signalStrengthThreshold.toFixed(2);
    }

    function updateOrbitModeControl(context) {
        const { toggle, orbitEnabled } = context;
        if (!toggle) return;

        toggle.setAttribute('aria-pressed', orbitEnabled ? 'true' : 'false');
        toggle.classList.toggle('is-active', orbitEnabled);
        toggle.title = orbitEnabled
            ? 'Orbit on: ambient camera drift stops on interaction.'
            : 'Orbit off: ambient camera drift is paused.';
    }

    function updatePortfolioPanel(context) {
        const { matchCount, notFound, matchedPortfolioNodes, unmatchedPortfolioTickers } = context;
        if (matchCount) matchCount.innerText = `${matchedPortfolioNodes.length} MATCHED`;
        if (!notFound) return;

        if (!unmatchedPortfolioTickers.length) {
            notFound.innerText = '';
            return;
        }

        const visibleTickers = unmatchedPortfolioTickers.slice(0, 4).join(', ');
        const hiddenCount = unmatchedPortfolioTickers.length - 4;
        notFound.innerText = `NOT FOUND: ${visibleTickers}${hiddenCount > 0 ? ` +${hiddenCount}` : ''}`;
    }

    function updateDatasetTrustPanel(context) {
        const { document, metrics, formatVerifiedDate } = context;
        document.getElementById('trust-company-count').innerText = `${metrics.companyCount} COMPANIES`;
        document.getElementById('trust-connection-count').innerText = `${metrics.connectionCount} EDGES`;
        document.getElementById('trust-high-confidence').innerText = `${metrics.highConfidencePercent}% CONF >=4`;
        document.getElementById('trust-latest-date').innerText = `VERIFIED ${formatVerifiedDate(metrics.latestVerifiedDate)}`;
    }

    function updateGraphOverlayStats(context) {
        const {
            overlay,
            visibleNodes,
            visibleLinks,
            getLayoutModeLabel,
            isFocusModeActive,
            signalStrengthThreshold,
            isPortfolioAnalysisActive,
            matchedPortfolioNodes,
            orbitEnabled,
            escapeHtml
        } = context;
        if (!overlay) return;

        const modeLabel = getLayoutModeLabel();
        const items = [
            `${visibleNodes.length} Visible Nodes`,
            `${visibleLinks.length} Visible Edges`,
            modeLabel
        ];
        if (isFocusModeActive()) items.push('Focus Mode');
        if (signalStrengthThreshold > 0) items.push(`Threshold ${signalStrengthThreshold.toFixed(2)}`);
        if (isPortfolioAnalysisActive()) items.push(`Portfolio ${matchedPortfolioNodes.length}`);
        if (orbitEnabled) items.push('Orbit On');

        overlay.innerHTML = items.map(item => `
                <span class="graph-stat-pill rounded-full px-2.5 py-1 text-[10px] text-cyan-100/75 font-mono tracking-[1.1px]">
                    ${escapeHtml(item)}
                </span>
            `).join('');
    }

    window.StockPhotonicUI.controls = {
        buildSectorFilter,
        buildIndustryGroupFilter,
        updateFocusModeControl,
        updateSignalThresholdControl,
        updateOrbitModeControl,
        updatePortfolioPanel,
        updateDatasetTrustPanel,
        updateGraphOverlayStats
    };
})();
