(function () {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function hashNumber(value) {
        const text = String(value);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
    }

    function hexToRgba(hex, alpha) {
        const clean = String(hex || '#00f9ff').replace('#', '');
        const value = clean.length === 3
            ? clean.split('').map(char => char + char).join('')
            : clean.padEnd(6, '0').slice(0, 6);
        const num = parseInt(value, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    window.StockPhotonicUtils = window.StockPhotonicUtils || {};

    window.StockPhotonicUtils.math = {
        clamp,
        hashNumber,
        hexToRgba
    };
})();
