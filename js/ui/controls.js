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

    function updatePerspectiveModeControl(context) {
        const { toggle, resetButton, perspectiveEnabled } = context;

        if (toggle) {
            const label = toggle.querySelector('span');
            toggle.setAttribute('aria-pressed', perspectiveEnabled ? 'true' : 'false');
            toggle.setAttribute('aria-label', perspectiveEnabled ? 'Perspective Mode on' : 'Perspective Mode off');
            toggle.classList.toggle('is-active', perspectiveEnabled);
            if (label) label.innerText = 'Perspective Mode';
            toggle.title = perspectiveEnabled
                ? 'Perspective Mode on: drag to pan. Shift+drag to rotate/pitch. Scroll to zoom.'
                : 'Perspective Mode off: flat 2D graph rendering.';
        }

        if (resetButton) {
            resetButton.disabled = !perspectiveEnabled;
            resetButton.setAttribute('aria-disabled', perspectiveEnabled ? 'false' : 'true');
            resetButton.title = perspectiveEnabled
                ? 'Reset Perspective bearing and pitch'
                : 'Turn on Perspective Mode to reset bearing and pitch';
        }
    }

    function updatePerspectiveNavigationHud(context) {
        const {
            hud,
            compassNeedle,
            bearingValue,
            pitchValue,
            pitchMeter,
            resetButton,
            presetButtons,
            perspectiveEnabled,
            bearing,
            pitch,
            targetBearing,
            targetPitch,
            rawBearing,
            rawPitch,
            presets,
            minPitch,
            maxPitch
        } = context;
        if (!hud) return;

        hud.classList.toggle('is-active', perspectiveEnabled);
        hud.setAttribute('aria-hidden', perspectiveEnabled ? 'false' : 'true');
        hud.closest('.graph-container')?.classList.toggle('has-perspective-nav', perspectiveEnabled);
        if (!perspectiveEnabled) return;

        const displayBearing = getFiniteNumber(bearing, rawBearing, targetBearing, 0);
        const displayPitch = getFiniteNumber(pitch, rawPitch, targetPitch, 0);
        const nextBearingDegrees = Math.round(displayBearing * 180 / Math.PI);
        const nextPitchDegrees = Math.round(displayPitch * 180 / Math.PI);

        if (compassNeedle) {
            compassNeedle.style.transform = `translate(-50%, -50%) rotate(${nextBearingDegrees}deg)`;
        }
        if (bearingValue) bearingValue.innerText = `${nextBearingDegrees} deg`;
        if (pitchValue) pitchValue.innerText = `${nextPitchDegrees} deg`;
        if (pitchMeter) {
            const min = Number.isFinite(minPitch) ? minPitch : -0.08;
            const max = Number.isFinite(maxPitch) ? maxPitch : 1.08;
            const range = Math.max(0.0001, max - min);
            const amount = Math.max(0, Math.min(1, (displayPitch - min) / range));
            pitchMeter.style.transform = `scaleX(${amount})`;
        }
        if (resetButton) {
            resetButton.disabled = !perspectiveEnabled;
            resetButton.setAttribute('aria-disabled', perspectiveEnabled ? 'false' : 'true');
        }

        const activeBearing = getFiniteNumber(rawBearing, targetBearing, displayBearing);
        const activePitch = getFiniteNumber(rawPitch, targetPitch, displayPitch);
        Object.entries(presetButtons || {}).forEach(([id, button]) => {
            if (!button) return;
            const preset = presets?.[id];
            const active = Boolean(preset) &&
                Math.abs(activeBearing - preset.bearing) <= 0.025 &&
                Math.abs(activePitch - preset.pitch) <= 0.025;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function getFiniteNumber(...values) {
        return values.find(value => Number.isFinite(value)) ?? 0;
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
            perspectiveEnabled,
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
        if (perspectiveEnabled) items.push('Perspective Mode');

        const statsMarkup = items.map(item => `
                <span class="graph-stat-pill rounded-full px-2.5 py-1 text-[10px] text-cyan-100/75 font-mono tracking-[1.1px]">
                    ${escapeHtml(item)}
                </span>
            `).join('');
        const perspectiveHint = perspectiveEnabled
            ? `
                <span class="graph-perspective-hint rounded-2xl px-3 py-1.5 text-[10px] font-mono tracking-[0.9px]">
                    ${escapeHtml('Drag to pan. Shift+drag to rotate/pitch. Scroll to zoom.')}
                </span>
            `
            : '';

        overlay.innerHTML = `${statsMarkup}${perspectiveHint}`;
    }

    window.StockPhotonicUI.controls = {
        buildSectorFilter,
        buildIndustryGroupFilter,
        updateFocusModeControl,
        updateSignalThresholdControl,
        updatePerspectiveModeControl,
        updatePerspectiveNavigationHud,
        updatePortfolioPanel,
        updateDatasetTrustPanel,
        updateGraphOverlayStats
    };
})();
