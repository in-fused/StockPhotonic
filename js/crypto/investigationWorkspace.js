(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const INVESTIGATION_WORKSPACE_VERSION = 'd132_investigation_workspace_ui_v1';

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

    function renderSelectionHeader(options = {}) {
        const actions = (options.actions || []).filter(Boolean).join('');
        return `
            <section class="crypto-details-selected">
                <div class="crypto-details-selected-copy">
                    <div class="crypto-kicker">${escapeHtml(options.kicker || 'DETAILS')}</div>
                    <h3>${escapeHtml(options.title || 'Selected Object')}</h3>
                    <div class="crypto-selection-pill">${escapeHtml(options.status || 'Selected')}</div>
                    ${options.body ? `<p>${escapeHtml(options.body)}</p>` : ''}
                </div>
                ${actions ? `<div class="crypto-details-actions">${actions}</div>` : ''}
            </section>
        `;
    }

    function renderCopyButton(label, value) {
        const text = String(value || '');
        if (!text) return '';
        return `
            <button type="button" data-crypto-copy-value="${escapeAttr(text)}" class="crypto-copy-action">
                ${escapeHtml(label)}
            </button>
        `;
    }

    function renderDetailSection(title, rowsHtml) {
        if (!rowsHtml) return '';
        return `
            <section class="mt-5 pt-4 border-t border-white/10">
                <div class="text-[10px] font-mono tracking-[1.3px] text-white/45 mb-2">${escapeHtml(title)}</div>
                <div class="grid gap-2 text-xs text-white/68">${rowsHtml}</div>
            </section>
        `;
    }

    function renderDetailRow(label, value, options = {}) {
        const rawValue = String(value ?? '-');
        const shortener = typeof options.shortener === 'function' ? options.shortener : defaultShortener;
        const visibleValue = options.shorten ? shortener(rawValue) : rawValue;
        return `
            <div class="crypto-detail-row rounded-xl px-3 py-2">
                <div class="text-[10px] font-mono text-white/40">${escapeHtml(label)}</div>
                <div class="mt-1 break-all" title="${escapeAttr(rawValue)}">${escapeHtml(visibleValue)}</div>
            </div>
        `;
    }

    function defaultShortener(value) {
        const text = String(value || '');
        if (text.length <= 18) return text;
        if (text.startsWith('0x')) return `${text.slice(0, 8)}...${text.slice(-6)}`;
        return `${text.slice(0, 7)}...${text.slice(-6)}`;
    }

    namespace.investigationWorkspace = {
        version: INVESTIGATION_WORKSPACE_VERSION,
        renderSelectionHeader,
        renderCopyButton,
        renderDetailSection,
        renderDetailRow
    };
})();
