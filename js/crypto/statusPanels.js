(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const STATUS_PANELS_VERSION = 'd132_status_panels_ui_v1';

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

    function renderWorkspaceMetric(label, value, options = {}) {
        const raw = String(value ?? '-');
        const valueClass = options.mono ? 'crypto-metric-value is-mono' : 'crypto-metric-value';
        return `
            <div class="crypto-workspace-metric" title="${escapeAttr(options.title || raw)}">
                <div class="crypto-metric-label">${escapeHtml(label)}</div>
                <div class="${valueClass}">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function renderHistoryStatusRow(label, value, title = '') {
        return `
            <div class="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2" title="${escapeAttr(title || String(value ?? '-'))}">
                <span class="shrink-0 text-white/38">${escapeHtml(label)}</span>
                <span class="min-w-0 text-right text-[11px] font-semibold text-cyan-50/82 break-words">${escapeHtml(String(value ?? '-') || '-')}</span>
            </div>
        `;
    }

    function renderHistoryMetric(label, value, title = '') {
        const raw = String(value ?? '-');
        return `
            <div class="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-2" title="${escapeAttr(title || raw)}">
                <div class="text-white/34">${escapeHtml(label)}</div>
                <div class="mt-1 text-[11px] font-semibold text-cyan-50/82 break-words">${escapeHtml(raw || '-')}</div>
            </div>
        `;
    }

    function renderWarningStrip(warnings = []) {
        const items = Array.isArray(warnings) ? warnings.slice(0, 3) : [];
        if (!items.length) return '';
        return `
            <div class="mt-2 grid grid-cols-1 gap-1.5">
                ${items.map(warning => `<div class="rounded-lg border border-yellow-200/16 bg-yellow-300/8 px-3 py-2 text-yellow-50/76 leading-relaxed">${escapeHtml(warning)}</div>`).join('')}
            </div>
        `;
    }

    namespace.statusPanels = {
        version: STATUS_PANELS_VERSION,
        renderWorkspaceMetric,
        renderHistoryStatusRow,
        renderHistoryMetric,
        renderWarningStrip
    };
})();
