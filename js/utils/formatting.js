(function () {
    function getConfidenceClass(confidence) {
        if (confidence >= 4) return 'high';
        if (confidence === 3) return 'medium';
        return '';
    }

    function formatVerifiedDate(value) {
        return typeof value === 'string' && value.trim() ? value.trim() : '-';
    }

    function formatNumber(value) {
        return Number(value).toLocaleString(undefined, {
            minimumFractionDigits: value >= 10 ? 1 : 2,
            maximumFractionDigits: value >= 10 ? 1 : 2
        });
    }

    function formatConnectionType(type) {
        const text = String(type || 'none').replace(/[_-]+/g, ' ').trim();
        if (!text) return 'None';
        return text.replace(/\b\w/g, char => char.toUpperCase());
    }

    window.StockPhotonicUtils = window.StockPhotonicUtils || {};

    window.StockPhotonicUtils.formatting = {
        getConfidenceClass,
        formatVerifiedDate,
        formatNumber,
        formatConnectionType
    };
})();
