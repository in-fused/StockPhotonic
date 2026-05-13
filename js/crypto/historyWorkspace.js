(() => {
    const namespace = window.CryptoPhotonic = window.CryptoPhotonic || {};

    const HISTORY_WORKSPACE_VERSION = 'd132_history_workspace_ui_v1';

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

    function renderGuidedActionGrid(actions = [], options = {}, adapters = {}) {
        const title = options.title || 'Guided Next Actions';
        const subtitle = options.subtitle || '';
        const available = actions.filter(Boolean);
        const emptyHtml = adapters.emptyHtml || '<div class="text-white/42">No guided actions are available for the current graph state.</div>';
        return `
            <section class="crypto-guided-actions crypto-workspace-card">
                <div class="crypto-card-heading">
                    <div>
                        <span>${escapeHtml(title)}</span>
                        ${subtitle ? `<div class="mt-1 text-white/48 leading-relaxed">${escapeHtml(subtitle)}</div>` : ''}
                    </div>
                    <span>${escapeHtml(available.length)} action${available.length === 1 ? '' : 's'}</span>
                </div>
                <div class="crypto-guided-action-grid">
                    ${available.map(action => renderGuidedActionCard(action, adapters)).join('') || emptyHtml}
                </div>
            </section>
        `;
    }

    function renderGuidedActionCard(action = {}, adapters = {}) {
        const attrs = typeof adapters.getAttributes === 'function'
            ? adapters.getAttributes(action)
            : getFallbackActionAttributes(action);
        const disabled = action.disabled || !attrs ? 'disabled' : '';
        const tone = action.tone === 'strong'
            ? 'is-strong'
            : action.tone === 'warn'
                ? 'is-warn'
                : '';
        return `
            <button type="button" ${attrs} ${disabled} title="${escapeAttr(action.titleText || action.detail || action.title || '')}" class="crypto-guided-action ${tone}">
                <span class="crypto-guided-action-label">${escapeHtml(action.title || 'Open')}</span>
                <span class="crypto-guided-action-detail">${escapeHtml(action.detail || '')}</span>
            </button>
        `;
    }

    function getFallbackActionAttributes(action = {}) {
        if (action.tab) return `data-crypto-investigation-tab-target="${escapeAttr(action.tab)}"`;
        if (action.historyAction) return `data-crypto-history-action="${escapeAttr(action.historyAction)}"`;
        return '';
    }

    namespace.historyWorkspace = {
        version: HISTORY_WORKSPACE_VERSION,
        renderGuidedActionGrid,
        renderGuidedActionCard
    };
})();
