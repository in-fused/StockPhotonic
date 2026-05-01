(function () {
    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function escapeInlineJsString(value) {
        return escapeHtml(String(value)
            .replaceAll('\\', '\\\\')
            .replaceAll("'", "\\'")
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' '));
    }

    window.StockPhotonicUtils = window.StockPhotonicUtils || {};

    window.StockPhotonicUtils.dom = {
        escapeHtml,
        escapeInlineJsString
    };
})();
