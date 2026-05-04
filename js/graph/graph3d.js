(function () {
    const GOLD = '#ffd700';
    const CYAN = '#00f9ff';
    const MAGENTA = '#ff00aa';
    const GREEN = '#00ff9f';
    const FALLBACK_EDGE = '#00f9ff';
    const LABEL_LIMIT = 16;
    const TAU = Math.PI * 2;
    const EDGE_HOVER_THRESHOLD = 11;
    const TOUCH_EDGE_HOVER_THRESHOLD = 22;
    const FOCUS_ANIMATION_MS = 620;
    const SEARCH_RESULT_LIMIT = 6;
    const DEPTH_LEVEL_MIN = 1;
    const DEPTH_LEVEL_MAX = 3;
    const MAX_EXPANDED_NODES = 90;
    const MAX_EXPANDED_EDGES = 220;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function hashNumber(value) {
        const text = String(value ?? '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0);
    }

    function normalizeDepthLevel(value) {
        const depth = Number.parseInt(value, 10);
        return clamp(Number.isFinite(depth) ? depth : DEPTH_LEVEL_MIN, DEPTH_LEVEL_MIN, DEPTH_LEVEL_MAX);
    }

    function getValidSourceUrls(sourceUrls) {
        return Array.isArray(sourceUrls)
            ? sourceUrls.map(url => String(url).trim()).filter(url => /^https?:\/\//i.test(url))
            : [];
    }

    function getSourceHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return 'Source URL';
        }
    }

    function createGlowTexture(THREE) {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        gradient.addColorStop(0.22, 'rgba(255, 255, 255, 0.32)');
        gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.08)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 96, 96);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    function createLabelTexture(THREE, text, color) {
        const label = String(text || '').slice(0, 22);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '600 28px Space Grotesk, Inter, sans-serif';
        const textWidth = Math.ceil(ctx.measureText(label).width);
        const width = Math.max(112, textWidth + 38);
        const height = 58;
        canvas.width = width * 2;
        canvas.height = height * 2;
        ctx.scale(2, 2);
        ctx.font = '600 28px Space Grotesk, Inter, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 18;
        ctx.shadowColor = color;
        ctx.fillStyle = 'rgba(3, 7, 18, 0.72)';
        roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 10);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.58;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, 18, height / 2 + 1);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return { texture, width, height };
    }

    function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    class Graph3DView {
        constructor(options) {
            this.canvas = options.canvas;
            this.stage = options.stage;
            this.tooltip = options.tooltip;
            this.details = options.details;
            this.stats = options.stats;
            this.controls = options.controls || {};
            this.searchInput = this.controls.searchInput || null;
            this.searchResults = this.controls.searchResults || null;
            this.edgeColors = options.edgeColors || {};
            this.defaultEdgeColor = options.defaultEdgeColor || FALLBACK_EDGE;
            this.getCompanyIndustryGroup = options.getCompanyIndustryGroup || (node => node?.industryGroup || node?.industry || 'Other');
            this.isSecBackedConnection = options.isSecBackedConnection || (() => false);
            this.formatConnectionType = options.formatConnectionType || (value => String(value || 'Link'));
            this.escapeHtml = options.escapeHtml || escapeHtml;

            this.THREE = null;
            this.renderer = null;
            this.scene = null;
            this.camera = null;
            this.raycaster = null;
            this.pointer = null;
            this.resizeObserver = null;
            this.animationFrame = null;
            this.initialized = false;
            this.active = false;
            this.engineUnavailable = false;

            this.nodes = [];
            this.links = [];
            this.nodeRecords = [];
            this.linkRecords = [];
            this.nodeRecordById = new Map();
            this.adjacencyByRecord = new Map();
            this.expansionCache = null;
            this.topLabelIds = new Set();

            this.nodeGroup = null;
            this.edgeGroup = null;
            this.labelGroup = null;
            this.coreGroup = null;
            this.nodePickables = [];
            this.nodeGeometry = null;
            this.glowTexture = null;

            this.labelsEnabled = true;
            this.secEmphasisEnabled = true;
            this.autoRotateEnabled = false;
            this.neighborhoodModeEnabled = false;
            this.depthLevel = DEPTH_LEVEL_MIN;
            this.selectedRecord = null;
            this.hoveredRecord = null;
            this.selectedEdgeRecord = null;
            this.hoveredEdgeRecord = null;
            this.searchMatches = [];
            this.searchActiveIndex = -1;
            this.searchOpen = false;

            this.cameraState = {
                theta: -0.72,
                phi: 1.08,
                radius: 210,
                target: { x: 0, y: 0, z: 0 }
            };
            this.cameraTransition = null;
            this.fitRadius = 210;

            this.drag = {
                active: false,
                pointerId: null,
                button: 0,
                startX: 0,
                startY: 0,
                lastX: 0,
                lastY: 0,
                moved: false
            };

            this.animate = this.animate.bind(this);
            this.resize = this.resize.bind(this);
            this.onPointerDown = this.onPointerDown.bind(this);
            this.onPointerMove = this.onPointerMove.bind(this);
            this.onPointerUp = this.onPointerUp.bind(this);
            this.onPointerCancel = this.onPointerCancel.bind(this);
            this.onWheel = this.onWheel.bind(this);
            this.onSearchInput = this.onSearchInput.bind(this);
            this.onSearchFocus = this.onSearchFocus.bind(this);
            this.onSearchKeyDown = this.onSearchKeyDown.bind(this);
            this.onSearchResultPointerDown = this.onSearchResultPointerDown.bind(this);
            this.onDocumentPointerDown = this.onDocumentPointerDown.bind(this);
            this.onDepthControlChange = this.onDepthControlChange.bind(this);
            this.onContextMenu = event => event.preventDefault();
            this.bindSearchEvents();
            this.bindDepthControlEvents();
        }

        setData(payload = {}) {
            const selectedNodeId = this.selectedRecord?.id || null;
            const selectedEdgeKey = this.getLinkRecordKey(this.selectedEdgeRecord);
            this.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
            this.links = Array.isArray(payload.links) ? payload.links : [];
            this.edgeColors = payload.edgeColors || this.edgeColors;
            this.defaultEdgeColor = payload.defaultEdgeColor || this.defaultEdgeColor;
            this.getCompanyIndustryGroup = payload.getCompanyIndustryGroup || this.getCompanyIndustryGroup;
            this.isSecBackedConnection = payload.isSecBackedConnection || this.isSecBackedConnection;
            this.formatConnectionType = payload.formatConnectionType || this.formatConnectionType;
            this.escapeHtml = payload.escapeHtml || this.escapeHtml;

            this.buildRecords();
            this.selectedRecord = selectedNodeId ? this.nodeRecordById.get(selectedNodeId) || null : null;
            this.selectedEdgeRecord = selectedEdgeKey
                ? this.linkRecords.find(record => this.getLinkRecordKey(record) === selectedEdgeKey) || null
                : null;
            this.hoveredRecord = null;
            this.hoveredEdgeRecord = null;
            this.updateSearchResults();
            if (this.initialized && !this.engineUnavailable) {
                this.rebuildScene();
                this.resetCamera(false);
                this.renderDetails();
            } else {
                this.renderStats();
                this.renderDetails();
            }
        }

        activate() {
            this.active = true;
            this.init();
            if (!this.engineUnavailable) {
                this.resize();
                this.start();
            }
        }

        deactivate() {
            this.active = false;
            if (this.animationFrame) {
                window.cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
            this.hideTooltip();
        }

        init() {
            if (this.initialized || this.engineUnavailable) return;
            const THREE = window.THREE;
            if (!THREE || !this.canvas) {
                this.engineUnavailable = true;
                this.showUnavailable();
                return;
            }

            this.THREE = THREE;
            this.scene = new THREE.Scene();
            this.scene.fog = new THREE.FogExp2(0x050508, 0.0022);
            this.camera = new THREE.PerspectiveCamera(54, 1, 0.1, 5000);
            this.raycaster = new THREE.Raycaster();
            this.raycaster.params.Line.threshold = 1.6;
            this.pointer = new THREE.Vector2();
            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: true,
                powerPreference: 'high-performance'
            });
            this.renderer.setClearColor(0x050508, 0);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

            this.nodeGeometry = new THREE.SphereGeometry(1, 24, 16);
            this.glowTexture = createGlowTexture(THREE);
            this.createLighting();
            this.createCore();
            this.bindEvents();
            this.rebuildScene();
            this.resetCamera(false);
            this.initialized = true;
            this.syncControls();
        }

        createLighting() {
            const THREE = this.THREE;
            this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
            const cyanLight = new THREE.PointLight(0x00f9ff, 2.4, 420);
            cyanLight.position.set(90, 100, 90);
            this.scene.add(cyanLight);
            const magentaLight = new THREE.PointLight(0xff00aa, 1.6, 420);
            magentaLight.position.set(-110, -70, -40);
            this.scene.add(magentaLight);
        }

        createCore() {
            const THREE = this.THREE;
            this.coreGroup = new THREE.Group();
            const coreMaterial = new THREE.MeshBasicMaterial({
                color: CYAN,
                transparent: true,
                opacity: 0.46,
                wireframe: true
            });
            const core = new THREE.Mesh(new THREE.IcosahedronGeometry(7.2, 2), coreMaterial);
            this.coreGroup.add(core);

            [
                { color: CYAN, rotation: [Math.PI / 2, 0, 0], radius: 15 },
                { color: MAGENTA, rotation: [0, Math.PI / 2, 0.32], radius: 18 },
                { color: GOLD, rotation: [0.7, 0.2, Math.PI / 2], radius: 21 }
            ].forEach(item => {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(item.radius, 0.12, 8, 96),
                    new THREE.MeshBasicMaterial({
                        color: item.color,
                        transparent: true,
                        opacity: 0.48,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    })
                );
                ring.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2]);
                this.coreGroup.add(ring);
            });

            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.glowTexture,
                color: CYAN,
                transparent: true,
                opacity: 0.38,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            }));
            sprite.scale.set(52, 52, 1);
            this.coreGroup.add(sprite);
            this.scene.add(this.coreGroup);
        }

        bindEvents() {
            this.canvas.addEventListener('pointerdown', this.onPointerDown);
            this.canvas.addEventListener('pointermove', this.onPointerMove);
            this.canvas.addEventListener('pointerup', this.onPointerUp);
            this.canvas.addEventListener('pointercancel', this.onPointerCancel);
            this.canvas.addEventListener('pointerleave', this.onPointerCancel);
            this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
            this.canvas.addEventListener('contextmenu', this.onContextMenu);
            window.addEventListener('resize', this.resize);
            if (window.ResizeObserver && this.stage) {
                this.resizeObserver = new ResizeObserver(this.resize);
                this.resizeObserver.observe(this.stage);
            }
        }

        bindSearchEvents() {
            if (!this.searchInput || !this.searchResults) return;
            this.searchInput.addEventListener('input', this.onSearchInput);
            this.searchInput.addEventListener('focus', this.onSearchFocus);
            this.searchInput.addEventListener('keydown', this.onSearchKeyDown);
            this.searchResults.addEventListener('pointerdown', this.onSearchResultPointerDown);
            document.addEventListener('pointerdown', this.onDocumentPointerDown);
        }

        bindDepthControlEvents() {
            const depthSelect = this.controls.depthSelect;
            if (!depthSelect) return;
            depthSelect.addEventListener('change', this.onDepthControlChange);
        }

        onDepthControlChange(event) {
            this.setDepthLevel(event.target?.value);
        }

        onSearchInput() {
            this.updateSearchResults();
        }

        onSearchFocus() {
            this.updateSearchResults();
        }

        onSearchKeyDown(event) {
            const key = event.key;
            if (key === 'Escape') {
                this.closeSearchResults();
                event.preventDefault();
                return;
            }
            if (key === 'Enter') {
                const record = this.searchMatches[this.searchActiveIndex] || this.searchMatches[0] || null;
                if (record) this.selectSearchRecord(record);
                event.preventDefault();
                return;
            }
            if (key !== 'ArrowDown' && key !== 'ArrowUp') return;

            if (!this.searchOpen) this.updateSearchResults();
            if (!this.searchMatches.length) return;
            const direction = key === 'ArrowDown' ? 1 : -1;
            const nextIndex = this.searchActiveIndex < 0
                ? (direction > 0 ? 0 : this.searchMatches.length - 1)
                : (this.searchActiveIndex + direction + this.searchMatches.length) % this.searchMatches.length;
            this.setSearchActiveIndex(nextIndex);
            event.preventDefault();
        }

        onSearchResultPointerDown(event) {
            const option = event.target.closest('[data-graph3d-node-id]');
            if (!option) return;
            const record = this.nodeRecordById.get(option.getAttribute('data-graph3d-node-id'));
            if (!record) return;
            event.preventDefault();
            this.selectSearchRecord(record);
        }

        onDocumentPointerDown(event) {
            if (!this.searchOpen) return;
            if (event.target === this.searchInput || this.searchResults?.contains(event.target)) return;
            this.closeSearchResults();
        }

        updateSearchResults() {
            if (!this.searchInput || !this.searchResults) return;
            const query = this.searchInput.value.trim();
            if (!query) {
                this.searchMatches = [];
                this.searchActiveIndex = -1;
                this.closeSearchResults();
                return;
            }

            this.searchMatches = this.findSearchMatches(query);
            this.searchActiveIndex = this.searchMatches.length ? 0 : -1;
            this.renderSearchResults(query);
        }

        findSearchMatches(query) {
            const normalizedQuery = query.trim().toLowerCase();
            const tickerQuery = query.trim().toUpperCase();
            if (!normalizedQuery) return [];

            return this.nodeRecords
                .map(record => {
                    const ticker = String(record.node.ticker || '').trim().toUpperCase();
                    const name = String(record.node.name || '').trim().toLowerCase();
                    let rank = Infinity;
                    if (ticker === tickerQuery) rank = 0;
                    else if (ticker.startsWith(tickerQuery)) rank = 1;
                    else if (name.startsWith(normalizedQuery)) rank = 2;
                    else if (name.includes(normalizedQuery)) rank = 3;
                    else if (ticker.includes(tickerQuery)) rank = 4;
                    if (rank === Infinity) return null;
                    return { record, rank };
                })
                .filter(Boolean)
                .sort((a, b) =>
                    a.rank - b.rank ||
                    (Number(a.record.node.rank) || 9999) - (Number(b.record.node.rank) || 9999) ||
                    String(a.record.node.ticker || '').localeCompare(String(b.record.node.ticker || ''))
                )
                .slice(0, SEARCH_RESULT_LIMIT)
                .map(item => item.record);
        }

        renderSearchResults(query) {
            if (!this.searchInput || !this.searchResults) return;
            this.searchOpen = true;
            this.searchInput.setAttribute('aria-expanded', 'true');
            this.searchInput.setAttribute('aria-activedescendant', this.searchActiveIndex >= 0 ? `graph3d-search-option-${this.searchActiveIndex}` : '');
            this.searchResults.classList.remove('hidden');

            if (!this.searchMatches.length) {
                this.searchResults.innerHTML = `<div class="graph3d-search-empty" role="status">No 3D matches for "${escapeHtml(query)}".</div>`;
                return;
            }

            this.searchResults.innerHTML = this.searchMatches.map((record, index) => this.renderSearchOption(record, index)).join('');
        }

        renderSearchOption(record, index) {
            const ticker = record.node.ticker || record.id || '';
            const name = record.node.name || 'Unknown company';
            const meta = record.node.sector || this.getCompanyIndustryGroup(record.node) || 'Production node';
            const active = index === this.searchActiveIndex;
            return `
                <button id="graph3d-search-option-${index}" type="button" class="graph3d-search-option rounded-2xl${active ? ' is-active' : ''}" role="option" aria-selected="${active ? 'true' : 'false'}" data-graph3d-node-id="${escapeHtml(record.id)}">
                    <span class="graph3d-search-ticker rounded-full">${escapeHtml(ticker)}</span>
                    <span class="graph3d-search-copy">
                        <span class="graph3d-search-name">${escapeHtml(name)}</span>
                        <span class="graph3d-search-meta">${escapeHtml(meta)}</span>
                    </span>
                </button>
            `;
        }

        setSearchActiveIndex(index) {
            if (!this.searchMatches.length) return;
            this.searchActiveIndex = clamp(index, 0, this.searchMatches.length - 1);
            this.renderSearchResults(this.searchInput?.value || '');
        }

        closeSearchResults() {
            this.searchOpen = false;
            this.searchActiveIndex = -1;
            if (this.searchResults) {
                this.searchResults.classList.add('hidden');
                this.searchResults.innerHTML = '';
            }
            if (this.searchInput) {
                this.searchInput.setAttribute('aria-expanded', 'false');
                this.searchInput.removeAttribute('aria-activedescendant');
            }
        }

        selectSearchRecord(record) {
            if (!record) return;
            this.selectRecord(record);
            this.focusNodeRecord(record);
            if (this.searchInput) this.searchInput.value = record.node.ticker || record.node.name || '';
            this.closeSearchResults();
            this.searchInput?.blur();
        }

        buildRecords() {
            this.nodeRecords = [];
            this.linkRecords = [];
            this.nodeRecordById = new Map();
            this.adjacencyByRecord = new Map();
            this.expansionCache = null;

            this.nodes.forEach(node => {
                const record = {
                    node,
                    id: node.id,
                    degree: Number(node.degree) || 0,
                    position: null,
                    radius: 1,
                    color: node.color || CYAN,
                    mesh: null,
                    glow: null,
                    label: null
                };
                this.nodeRecords.push(record);
                this.nodeRecordById.set(record.id, record);
                this.adjacencyByRecord.set(record, []);
            });

            this.links.forEach(link => {
                const source = this.nodeRecordById.get(link.source?.id ?? link.source);
                const target = this.nodeRecordById.get(link.target?.id ?? link.target);
                if (!source || !target) return;
                const strength = clamp(Number(link.strength) || 0.4, 0.05, 1);
                this.linkRecords.push({
                    link,
                    source,
                    target,
                    strength,
                    color: this.edgeColors[link.type] || this.defaultEdgeColor,
                    secBacked: this.isSecBackedConnection(link),
                    line: null,
                    glow: null
                });
            });

            this.nodeRecords.forEach(record => {
                this.adjacencyByRecord.set(record, []);
            });

            this.linkRecords.forEach(linkRecord => {
                this.adjacencyByRecord.get(linkRecord.source)?.push({
                    linkRecord,
                    other: linkRecord.target
                });
                this.adjacencyByRecord.get(linkRecord.target)?.push({
                    linkRecord,
                    other: linkRecord.source
                });
            });

            this.adjacencyByRecord.forEach(items => {
                items.sort((a, b) =>
                    b.linkRecord.strength - a.linkRecord.strength ||
                    Number(b.linkRecord.secBacked) - Number(a.linkRecord.secBacked) ||
                    String(a.other.node.ticker || '').localeCompare(String(b.other.node.ticker || ''))
                );
            });

            this.nodeRecords.forEach(record => {
                record.degree = Math.max(record.degree, this.adjacencyByRecord.get(record)?.length || 0);
            });

            this.topLabelIds = new Set([...this.nodeRecords]
                .sort((a, b) =>
                    b.degree - a.degree ||
                    (Number(a.node.rank) || 9999) - (Number(b.node.rank) || 9999) ||
                    String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
                )
                .slice(0, LABEL_LIMIT)
                .map(record => record.id));
        }

        rebuildScene() {
            if (!this.scene) return;
            this.clearGroup(this.nodeGroup);
            this.clearGroup(this.edgeGroup);
            this.clearGroup(this.labelGroup);
            this.nodeGroup = new this.THREE.Group();
            this.edgeGroup = new this.THREE.Group();
            this.labelGroup = new this.THREE.Group();
            this.scene.add(this.edgeGroup);
            this.scene.add(this.nodeGroup);
            this.scene.add(this.labelGroup);
            this.nodePickables = [];
            this.layoutRecords();
            this.createEdges();
            this.createNodes();
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.renderStats();
        }

        clearGroup(group) {
            if (!group) return;
            if (group.parent) group.parent.remove(group);
            group.traverse(child => {
                if (child.geometry && child.geometry !== this.nodeGeometry && child.type !== 'Sprite') child.geometry.dispose();
                if (child.material) {
                    if (child.material.map && child.material.map !== this.glowTexture) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }

        layoutRecords() {
            const THREE = this.THREE;
            const sectors = [...new Set(this.nodeRecords.map(record => record.node.sector || 'Other'))].sort();
            const sectorIndex = new Map(sectors.map((sector, index) => [sector, index]));
            const recordsBySector = new Map();
            this.nodeRecords.forEach(record => {
                const sector = record.node.sector || 'Other';
                if (!recordsBySector.has(sector)) recordsBySector.set(sector, []);
                recordsBySector.get(sector).push(record);
            });

            const sectorRadius = clamp(78 + sectors.length * 5.5, 94, 138);
            let maxDistance = 0;
            recordsBySector.forEach((records, sector) => {
                const index = sectorIndex.get(sector) || 0;
                const sectorAngle = (index / Math.max(1, sectors.length)) * TAU - Math.PI / 2;
                const sectorCenter = new THREE.Vector3(
                    Math.cos(sectorAngle) * sectorRadius,
                    Math.sin(index * 1.37) * 32,
                    Math.sin(sectorAngle) * sectorRadius
                );

                const groups = new Map();
                records.forEach(record => {
                    const group = this.getCompanyIndustryGroup(record.node) || 'Other';
                    if (!groups.has(group)) groups.set(group, []);
                    groups.get(group).push(record);
                });

                [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).forEach(([group, groupRecords], groupIndex) => {
                    groupRecords.sort((a, b) =>
                        (Number(a.node.rank) || 9999) - (Number(b.node.rank) || 9999) ||
                        String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
                    );
                    const groupSeed = hashNumber(`${sector}:${group}`);
                    const groupAngle = (groupIndex / Math.max(1, groups.size)) * TAU + (groupSeed % 80) / 160;
                    const groupRadius = groups.size > 1 ? 24 + (groupIndex % 2) * 7 : 0;
                    const groupCenter = sectorCenter.clone().add(new THREE.Vector3(
                        Math.cos(groupAngle) * groupRadius,
                        ((groupSeed % 17) - 8) * 1.6,
                        Math.sin(groupAngle) * groupRadius
                    ));

                    groupRecords.forEach((record, nodeIndex) => {
                        const seed = hashNumber(`${record.node.ticker || record.id}:d39`);
                        const angle = nodeIndex * 2.399963 + (seed % 360) * Math.PI / 900;
                        const localRadius = 5 + Math.sqrt(nodeIndex + 1) * 7.5 + (seed % 7);
                        const vertical = ((seed % 31) - 15) * 0.9 + Math.sin(angle * 1.6) * 8;
                        const depth = Math.cos(angle * 1.12) * localRadius * 0.72;
                        record.position = groupCenter.clone().add(new THREE.Vector3(
                            Math.cos(angle) * localRadius,
                            vertical,
                            Math.sin(angle) * localRadius * 0.54 + depth
                        ));
                        const cap = Math.max(0.04, Number(record.node.market_cap) || 0.04);
                        const rankBoost = Number(record.node.rank) <= 25 ? 0.42 : 0;
                        record.radius = clamp(1.05 + Math.sqrt(cap) * 0.52 + Math.sqrt(record.degree) * 0.13 + rankBoost, 1.05, 4.4);
                        maxDistance = Math.max(maxDistance, record.position.length() + record.radius * 5);
                    });
                });
            });

            this.fitRadius = clamp(maxDistance * 1.8, 145, 430);
        }

        createEdges() {
            const THREE = this.THREE;
            this.linkRecords.forEach(record => {
                const geometry = new THREE.BufferGeometry().setFromPoints([record.source.position, record.target.position]);
                const secMode = record.secBacked && this.secEmphasisEnabled;
                const color = secMode ? GOLD : record.color;
                const opacity = secMode ? 0.86 : 0.18 + record.strength * 0.36;
                const material = secMode
                    ? new THREE.LineDashedMaterial({
                        color,
                        transparent: true,
                        opacity,
                        dashSize: 2.2,
                        gapSize: 1.35,
                        blending: THREE.AdditiveBlending
                    })
                    : new THREE.LineBasicMaterial({
                        color,
                        transparent: true,
                        opacity,
                        blending: THREE.AdditiveBlending
                    });
                const line = new THREE.Line(geometry, material);
                if (secMode) line.computeLineDistances();
                line.userData.graph3dEdgeRecord = record;
                record.line = line;
                this.edgeGroup.add(line);

                const glow = new THREE.Line(
                    geometry.clone(),
                    new THREE.LineBasicMaterial({
                        color,
                        transparent: true,
                        opacity: secMode ? 0.22 : 0,
                        blending: THREE.AdditiveBlending
                    })
                );
                glow.userData.graph3dEdgeRecord = record;
                record.glow = glow;
                this.edgeGroup.add(glow);
            });
        }

        createNodes() {
            const THREE = this.THREE;
            this.nodeRecords.forEach(record => {
                const color = record.node.color || record.color || CYAN;
                const material = new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: 0.92
                });
                const mesh = new THREE.Mesh(this.nodeGeometry, material);
                mesh.position.copy(record.position);
                mesh.scale.setScalar(record.radius);
                mesh.userData.graph3dRecord = record;
                record.mesh = mesh;
                this.nodeGroup.add(mesh);
                this.nodePickables.push(mesh);

                const glow = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: this.glowTexture,
                    color,
                    transparent: true,
                    opacity: 0.34,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                }));
                glow.position.copy(record.position);
                const glowScale = record.radius * 7.2;
                glow.scale.set(glowScale, glowScale, 1);
                record.glow = glow;
                this.nodeGroup.add(glow);
            });
        }

        refreshLabels() {
            if (!this.labelGroup) return;
            this.clearLabelChildren();
            if (!this.labelsEnabled) return;

            const labelIds = new Set(this.topLabelIds);
            if (this.selectedRecord) labelIds.add(this.selectedRecord.id);
            if (this.hoveredRecord) labelIds.add(this.hoveredRecord.id);
            if (this.selectedEdgeRecord) {
                labelIds.add(this.selectedEdgeRecord.source.id);
                labelIds.add(this.selectedEdgeRecord.target.id);
            }
            if (this.hoveredEdgeRecord) {
                labelIds.add(this.hoveredEdgeRecord.source.id);
                labelIds.add(this.hoveredEdgeRecord.target.id);
            }
            if (this.neighborhoodModeEnabled && this.selectedRecord) {
                const expansion = this.getSelectedExpansion();
                [1, 2, 3].slice(0, this.depthLevel).forEach(depth => {
                    const limit = depth === 1 ? 5 : depth === 2 ? 4 : 3;
                    (expansion.nodesByDepth[depth] || []).slice(0, limit).forEach(record => {
                        labelIds.add(record.id);
                    });
                });
            }

            [...labelIds].slice(0, LABEL_LIMIT + 7).forEach(id => {
                const record = this.nodeRecordById.get(id);
                if (!record?.position) return;
                this.addLabel(record);
            });
        }

        clearLabelChildren() {
            const children = [...this.labelGroup.children];
            children.forEach(child => {
                this.labelGroup.remove(child);
                if (child.material?.map) child.material.map.dispose();
                if (child.material) child.material.dispose();
            });
        }

        addLabel(record) {
            const THREE = this.THREE;
            const activeEdgeEndpoint = this.isEndpointOfEdge(record, this.selectedEdgeRecord);
            const depth = this.neighborhoodModeEnabled && this.selectedRecord
                ? this.getSelectedExpansion().nodeDepths.get(record)
                : null;
            const activeNeighbor = Number.isFinite(depth) && depth > 0;
            const activeLabel = record.id === this.selectedRecord?.id || activeEdgeEndpoint || activeNeighbor;
            const color = activeLabel ? '#ffffff' : record.node.color || CYAN;
            const label = createLabelTexture(THREE, record.node.ticker || record.node.name || '', color);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: label.texture,
                transparent: true,
                opacity: activeLabel ? 0.98 : 0.78,
                depthWrite: false
            }));
            sprite.position.copy(record.position).add(new THREE.Vector3(0, record.radius + 4.4, 0));
            const scale = activeLabel ? 18 : 14;
            sprite.scale.set((label.width / label.height) * scale, scale, 1);
            this.labelGroup.add(sprite);
        }

        start() {
            if (this.animationFrame) return;
            this.animationFrame = window.requestAnimationFrame(this.animate);
        }

        animate(timestamp) {
            this.animationFrame = null;
            if (!this.active || !this.renderer || !this.scene || !this.camera) return;

            this.updateCameraTransition(timestamp);
            if (this.autoRotateEnabled && !this.drag.active) {
                this.cameraState.theta += 0.0015;
            }
            if (this.coreGroup) {
                this.coreGroup.rotation.y += 0.003;
                this.coreGroup.rotation.x = Math.sin(timestamp * 0.00045) * 0.12;
            }
            this.updateCamera();
            this.renderer.render(this.scene, this.camera);
            this.animationFrame = window.requestAnimationFrame(this.animate);
        }

        resize() {
            if (!this.renderer || !this.camera || !this.stage) return;
            const rect = this.stage.getBoundingClientRect();
            const width = Math.max(1, Math.floor(rect.width));
            const height = Math.max(1, Math.floor(rect.height));
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        updateCamera() {
            const THREE = this.THREE;
            const state = this.cameraState;
            state.phi = clamp(state.phi, 0.16, Math.PI - 0.16);
            const sinPhi = Math.sin(state.phi);
            const x = state.target.x + state.radius * sinPhi * Math.cos(state.theta);
            const y = state.target.y + state.radius * Math.cos(state.phi);
            const z = state.target.z + state.radius * sinPhi * Math.sin(state.theta);
            this.camera.position.set(x, y, z);
            this.camera.lookAt(new THREE.Vector3(state.target.x, state.target.y, state.target.z));
        }

        updateCameraTransition(timestamp) {
            const transition = this.cameraTransition;
            if (!transition) return;
            const progress = clamp((timestamp - transition.startedAt) / transition.duration, 0, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            this.cameraState.target = {
                x: transition.fromTarget.x + (transition.toTarget.x - transition.fromTarget.x) * eased,
                y: transition.fromTarget.y + (transition.toTarget.y - transition.fromTarget.y) * eased,
                z: transition.fromTarget.z + (transition.toTarget.z - transition.fromTarget.z) * eased
            };
            this.cameraState.radius = transition.fromRadius + (transition.toRadius - transition.fromRadius) * eased;
            if (progress >= 1) this.cameraTransition = null;
        }

        animateCameraTo(target, radius, duration = FOCUS_ANIMATION_MS) {
            this.cameraTransition = {
                startedAt: performance.now(),
                duration,
                fromTarget: { ...this.cameraState.target },
                toTarget: {
                    x: target.x,
                    y: target.y,
                    z: target.z
                },
                fromRadius: this.cameraState.radius,
                toRadius: clamp(radius, 58, 360)
            };
            this.start();
        }

        onPointerDown(event) {
            if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
            this.cameraTransition = null;
            this.drag.active = true;
            this.drag.pointerId = event.pointerId;
            this.drag.button = event.button;
            this.drag.startX = event.clientX;
            this.drag.startY = event.clientY;
            this.drag.lastX = event.clientX;
            this.drag.lastY = event.clientY;
            this.drag.moved = false;
            this.canvas.setPointerCapture?.(event.pointerId);
            this.canvas.classList.add('is-dragging');
            this.canvas.style.cursor = 'grabbing';
            event.preventDefault();
        }

        onPointerMove(event) {
            if (this.drag.active && this.drag.pointerId === event.pointerId) {
                const dx = event.clientX - this.drag.lastX;
                const dy = event.clientY - this.drag.lastY;
                const total = Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY);
                this.drag.moved = this.drag.moved || total > 4;
                this.cameraState.theta -= dx * 0.0065;
                this.cameraState.phi = clamp(this.cameraState.phi + dy * 0.006, 0.18, Math.PI - 0.18);
                this.drag.lastX = event.clientX;
                this.drag.lastY = event.clientY;
                event.preventDefault();
                return;
            }

            const nextNode = this.pickNode(event);
            const nextEdge = nextNode ? null : this.pickEdge(event);
            if (nextNode !== this.hoveredRecord || nextEdge !== this.hoveredEdgeRecord) {
                this.hoveredRecord = nextNode;
                this.hoveredEdgeRecord = nextEdge;
                this.refreshLabels();
                this.updateNodeEmphasis();
                this.updateEdgeEmphasis();
            }
            this.canvas.style.cursor = nextNode || nextEdge ? 'pointer' : 'grab';
            if (nextNode) {
                this.showTooltip(event, nextNode, 'node');
            } else if (nextEdge) {
                this.showTooltip(event, nextEdge, 'edge');
            } else {
                this.hideTooltip();
            }
        }

        onPointerUp(event) {
            if (!this.drag.active || this.drag.pointerId !== event.pointerId) return;
            if (!this.drag.moved) {
                const nodeRecord = this.pickNode(event);
                this.selectRecord(nodeRecord || null);
                if (!nodeRecord) this.selectEdgeRecord(this.pickEdge(event));
            }
            this.canvas.releasePointerCapture?.(event.pointerId);
            this.canvas.classList.remove('is-dragging');
            this.canvas.style.cursor = 'grab';
            this.drag.active = false;
            this.drag.pointerId = null;
            if (event.pointerType !== 'mouse') this.hideTooltip();
            event.preventDefault();
        }

        onPointerCancel(event) {
            if (this.drag.pointerId !== null) this.canvas.releasePointerCapture?.(this.drag.pointerId);
            this.canvas.classList.remove('is-dragging');
            this.canvas.style.cursor = 'grab';
            this.drag.active = false;
            this.drag.pointerId = null;
            this.hoveredRecord = null;
            this.hoveredEdgeRecord = null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.hideTooltip();
        }

        onWheel(event) {
            event.preventDefault();
            this.cameraTransition = null;
            const nextRadius = this.cameraState.radius * Math.exp(clamp(event.deltaY, -180, 180) * 0.0018);
            this.cameraState.radius = clamp(nextRadius, 38, 720);
        }

        pickNode(event) {
            if (!this.camera || !this.raycaster || !this.nodePickables.length) return null;
            this.updatePointerFromEvent(event);
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hit = this.raycaster.intersectObjects(this.nodePickables, false)[0];
            return hit?.object?.userData?.graph3dRecord || null;
        }

        pickEdge(event) {
            if (!this.camera || !this.linkRecords.length || !this.canvas) return null;
            const rect = this.canvas.getBoundingClientRect();
            const pointerX = event.clientX - rect.left;
            const pointerY = event.clientY - rect.top;
            const threshold = event.pointerType === 'touch' ? TOUCH_EDGE_HOVER_THRESHOLD : EDGE_HOVER_THRESHOLD;
            let best = null;
            let bestDistance = Infinity;

            this.linkRecords.forEach(record => {
                const source = this.projectRecordPosition(record.source, rect);
                const target = this.projectRecordPosition(record.target, rect);
                if (!source || !target) return;
                const segmentLength = Math.hypot(target.x - source.x, target.y - source.y);
                if (segmentLength < 4) return;
                const distance = this.pointToSegmentDistance(pointerX, pointerY, source.x, source.y, target.x, target.y);
                const priorityDistance = distance - record.strength * 1.8 - (record.secBacked ? 0.8 : 0);
                if (distance <= threshold && priorityDistance < bestDistance) {
                    best = record;
                    bestDistance = priorityDistance;
                }
            });

            return best;
        }

        updatePointerFromEvent(event) {
            const rect = this.canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
            const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
            this.pointer.set(x, y);
            return rect;
        }

        projectRecordPosition(record, rect) {
            if (!record?.position) return null;
            const projected = record.position.clone().project(this.camera);
            if (projected.z < -1 || projected.z > 1) return null;
            return {
                x: (projected.x * 0.5 + 0.5) * rect.width,
                y: (-projected.y * 0.5 + 0.5) * rect.height
            };
        }

        pointToSegmentDistance(px, py, ax, ay, bx, by) {
            const dx = bx - ax;
            const dy = by - ay;
            const lengthSq = dx * dx + dy * dy;
            if (!lengthSq) return Math.hypot(px - ax, py - ay);
            const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
            const x = ax + t * dx;
            const y = ay + t * dy;
            return Math.hypot(px - x, py - y);
        }

        selectRecord(record) {
            this.selectedRecord = record || null;
            this.selectedEdgeRecord = null;
            this.expansionCache = null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.renderDetails();
        }

        selectEdgeRecord(record) {
            this.selectedEdgeRecord = record || null;
            this.selectedRecord = null;
            this.expansionCache = null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.renderDetails();
        }

        updateNodeEmphasis() {
            const expansion = this.getSelectedExpansion();
            this.nodeRecords.forEach(record => {
                const nodeNeighborhoodActive = this.neighborhoodModeEnabled && this.selectedRecord;
                const selectedNode = record === this.selectedRecord;
                const depth = nodeNeighborhoodActive ? expansion.nodeDepths.get(record) : null;
                const directNeighbor = depth === 1;
                const expandedNeighbor = Number.isFinite(depth) && depth > 1;
                const edgeEndpoint = this.isEndpointOfEdge(record, this.selectedEdgeRecord);
                const hoveredEdgeEndpoint = this.isEndpointOfEdge(record, this.hoveredEdgeRecord);
                const active =
                    selectedNode ||
                    directNeighbor ||
                    expandedNeighbor ||
                    record === this.hoveredRecord ||
                    edgeEndpoint ||
                    hoveredEdgeEndpoint;
                const dimmedByNode = nodeNeighborhoodActive && !Number.isFinite(depth);
                const dimmedByEdge = this.selectedEdgeRecord && !this.isEndpointOfEdge(record, this.selectedEdgeRecord);
                const dimmed = dimmedByNode || dimmedByEdge;
                const expandedNodeDimming = dimmedByNode && this.depthLevel > DEPTH_LEVEL_MIN;
                if (record.mesh?.material) {
                    record.mesh.material.opacity = selectedNode || edgeEndpoint
                        ? 1
                        : directNeighbor || record === this.hoveredRecord || hoveredEdgeEndpoint
                            ? 0.96
                            : depth === 2
                                ? 0.72
                                : depth === 3
                                ? 0.52
                                : dimmed
                                        ? (expandedNodeDimming ? 0.18 : 0.35)
                                        : active
                                            ? 0.88
                                            : 0.88;
                    const scaleBoost = selectedNode || edgeEndpoint
                        ? 1.22
                        : directNeighbor || record === this.hoveredRecord || hoveredEdgeEndpoint
                            ? 1.12
                            : depth === 2
                                ? 1.06
                                : depth === 3
                                    ? 1.02
                                    : 1;
                    record.mesh.scale.setScalar(record.radius * scaleBoost);
                }
                if (record.glow?.material) {
                    record.glow.material.opacity = selectedNode || edgeEndpoint
                        ? 0.62
                        : directNeighbor || record === this.hoveredRecord || hoveredEdgeEndpoint
                            ? 0.48
                            : depth === 2
                                ? 0.28
                                : depth === 3
                                ? 0.16
                                : dimmed
                                        ? (expandedNodeDimming ? 0.07 : 0.12)
                                        : active
                                            ? 0.31
                                            : 0.31;
                }
            });
        }

        updateEdgeEmphasis() {
            const expansion = this.getSelectedExpansion();
            this.linkRecords.forEach(record => {
                const selected = record === this.selectedEdgeRecord;
                const hovered = record === this.hoveredEdgeRecord;
                const nodeNeighborhoodActive = this.neighborhoodModeEnabled && this.selectedRecord;
                const edgeDepth = nodeNeighborhoodActive ? expansion.edgeDepths.get(record) : null;
                const dimmedByNode = nodeNeighborhoodActive && !Number.isFinite(edgeDepth);
                const dimmedByEdge = this.selectedEdgeRecord && !selected;
                const secMode = record.secBacked && this.secEmphasisEnabled;
                const color = secMode ? GOLD : record.color;
                const baseOpacity = secMode ? 0.86 : 0.18 + record.strength * 0.36;
                const neighborhoodOpacity = this.getDepthEdgeOpacity(record, edgeDepth, baseOpacity, secMode);
                const opacity = selected
                    ? 1
                    : hovered
                        ? 0.72
                        : (dimmedByNode || dimmedByEdge)
                            ? (secMode ? 0.14 : 0.055)
                            : Number.isFinite(edgeDepth)
                                ? neighborhoodOpacity
                                : baseOpacity;

                if (record.line?.material) {
                    record.line.material.color.set(color);
                    record.line.material.opacity = opacity;
                }
                if (record.glow?.material) {
                    record.glow.material.color.set(color);
                    record.glow.material.opacity = selected
                        ? (record.secBacked ? 0.62 : 0.44)
                        : hovered
                            ? 0.24
                            : dimmedByNode
                                ? (secMode ? 0.04 : 0)
                                : Number.isFinite(edgeDepth)
                                    ? this.getDepthEdgeGlowOpacity(edgeDepth, secMode)
                                    : secMode
                                        ? 0.22
                                        : 0;
                }
            });
        }

        getDepthEdgeOpacity(record, depth, baseOpacity, secMode) {
            if (depth === 1) return secMode ? 0.9 : Math.max(baseOpacity, 0.48 + record.strength * 0.34);
            if (depth === 2) return secMode ? 0.52 : Math.max(baseOpacity * 0.88, 0.28 + record.strength * 0.2);
            if (depth === 3) return secMode ? 0.3 : Math.max(baseOpacity * 0.62, 0.13 + record.strength * 0.14);
            return baseOpacity;
        }

        getDepthEdgeGlowOpacity(depth, secMode) {
            if (depth === 1) return secMode ? 0.32 : 0.18;
            if (depth === 2) return secMode ? 0.18 : 0.09;
            if (depth === 3) return secMode ? 0.09 : 0.035;
            return 0;
        }

        areConnected(a, b) {
            if (!a || !b) return false;
            return (this.adjacencyByRecord.get(a) || []).some(item => item.other === b);
        }

        getSelectedExpansion() {
            if (!this.neighborhoodModeEnabled || !this.selectedRecord) {
                return this.getEmptyExpansion();
            }

            const cacheKey = [
                this.selectedRecord.id,
                this.depthLevel,
                this.nodeRecords.length,
                this.linkRecords.length
            ].join('|');
            if (this.expansionCache?.key === cacheKey) return this.expansionCache.value;

            const nodeDepths = new Map([[this.selectedRecord, 0]]);
            const parentByRecord = new Map();
            const nodesByDepth = [[], [], [], []];
            nodesByDepth[0].push(this.selectedRecord);
            const queue = [this.selectedRecord];
            const maxExpandedNodes = this.depthLevel > DEPTH_LEVEL_MIN ? MAX_EXPANDED_NODES : Number.POSITIVE_INFINITY;
            const maxExpandedEdges = this.depthLevel > DEPTH_LEVEL_MIN ? MAX_EXPANDED_EDGES : Number.POSITIVE_INFINITY;
            let capped = false;

            for (let index = 0; index < queue.length; index++) {
                const current = queue[index];
                const currentDepth = nodeDepths.get(current);
                if (currentDepth >= this.depthLevel) continue;

                const connections = this.adjacencyByRecord.get(current) || [];
                for (const item of connections) {
                    if (nodeDepths.has(item.other)) continue;
                    if (nodeDepths.size >= maxExpandedNodes) {
                        capped = true;
                        break;
                    }

                    const nextDepth = currentDepth + 1;
                    nodeDepths.set(item.other, nextDepth);
                    parentByRecord.set(item.other, {
                        parent: current,
                        linkRecord: item.linkRecord
                    });
                    nodesByDepth[nextDepth].push(item.other);
                    queue.push(item.other);
                }
                if (capped) break;
            }

            const edgeDepths = new Map();
            const edgeSeen = new Set();
            for (const nodeRecord of nodeDepths.keys()) {
                if (edgeDepths.size >= maxExpandedEdges) {
                    capped = true;
                    break;
                }
                const connections = this.adjacencyByRecord.get(nodeRecord) || [];
                for (const item of connections) {
                    const linkRecord = item.linkRecord;
                    if (edgeSeen.has(linkRecord)) continue;
                    edgeSeen.add(linkRecord);

                    if (edgeDepths.size >= maxExpandedEdges) {
                        capped = true;
                        break;
                    }

                    const sourceDepth = nodeDepths.get(linkRecord.source);
                    const targetDepth = nodeDepths.get(linkRecord.target);
                    if (!Number.isFinite(sourceDepth) || !Number.isFinite(targetDepth)) continue;

                    const maxDepth = Math.max(sourceDepth, targetDepth);
                    if (maxDepth < 1 || maxDepth > this.depthLevel) continue;

                    const edgeDepth = linkRecord.source === this.selectedRecord || linkRecord.target === this.selectedRecord
                        ? 1
                        : Math.min(DEPTH_LEVEL_MAX, Math.max(2, maxDepth));
                    edgeDepths.set(linkRecord, edgeDepth);
                }
            }

            const value = {
                nodeDepths,
                edgeDepths,
                nodesByDepth,
                capped,
                strongestPath: this.getStrongestExpandedPath(parentByRecord, nodeDepths)
            };
            this.expansionCache = { key: cacheKey, value };
            return value;
        }

        getEmptyExpansion() {
            return {
                nodeDepths: new Map(),
                edgeDepths: new Map(),
                nodesByDepth: [[], [], [], []],
                capped: false,
                strongestPath: null
            };
        }

        getStrongestExpandedPath(parentByRecord, nodeDepths) {
            let strongest = null;
            nodeDepths.forEach((depth, record) => {
                if (depth < 2) return;
                const pathRecords = [];
                const pathEdges = [];
                let cursor = record;
                while (cursor) {
                    pathRecords.unshift(cursor);
                    const parent = parentByRecord.get(cursor);
                    if (!parent) break;
                    pathEdges.unshift(parent.linkRecord);
                    cursor = parent.parent;
                }
                if (pathEdges.length < 2) return;

                const minStrength = Math.min(...pathEdges.map(edge => edge.strength));
                const averageStrength = pathEdges.reduce((sum, edge) => sum + edge.strength, 0) / pathEdges.length;
                const score = minStrength * 0.7 + averageStrength * 0.3;
                if (
                    !strongest ||
                    score > strongest.score ||
                    (score === strongest.score && depth > strongest.depth)
                ) {
                    strongest = {
                        depth,
                        score,
                        label: pathRecords.map(item => item.node.ticker || item.node.name || item.id).join(' -> '),
                        strength: Math.round(score * 100),
                        secBacked: pathEdges.some(edge => edge.secBacked),
                        edgeCount: pathEdges.length
                    };
                }
            });
            return strongest;
        }

        isEndpointOfEdge(record, edgeRecord) {
            return Boolean(record && edgeRecord && (edgeRecord.source === record || edgeRecord.target === record));
        }

        showTooltip(event, record, type = 'node') {
            if (!this.tooltip) return;
            if (type === 'edge') {
                const link = record.link || {};
                const strength = Math.round(record.strength * 100);
                const secBadge = record.secBacked
                    ? '<span class="sec-edge-badge rounded-full px-2 py-0.5 text-[10px] font-mono">SEC</span>'
                    : '';
                this.tooltip.innerHTML = `
                    <div class="flex items-center justify-between gap-3">
                        <div class="font-display text-sm text-white">${this.escapeHtml(record.source.node.ticker || '')} -> ${this.escapeHtml(record.target.node.ticker || '')}</div>
                        ${secBadge}
                    </div>
                    <div class="mt-1 text-[11px] text-cyan-100/72">${this.escapeHtml(this.formatConnectionType(link.type || 'link'))}</div>
                    <div class="mt-1 font-mono text-[10px] text-white/52">Strength ${this.escapeHtml(strength)}%</div>
                `;
            } else {
                this.tooltip.innerHTML = `
                    <div class="font-display text-sm text-white">${this.escapeHtml(record.node.ticker || '')}</div>
                    <div class="text-[11px] text-cyan-100/72">${this.escapeHtml(record.node.name || '')}</div>
                `;
            }
            const stageRect = this.stage.getBoundingClientRect();
            this.tooltip.style.left = `${event.clientX - stageRect.left + 14}px`;
            this.tooltip.style.top = `${event.clientY - stageRect.top + 14}px`;
            this.tooltip.classList.remove('hidden');
        }

        hideTooltip() {
            this.tooltip?.classList.add('hidden');
        }

        renderStats() {
            if (!this.stats) return;
            const secCount = this.linkRecords.filter(link => link.secBacked).length;
            const sectors = new Set(this.nodeRecords.map(record => record.node.sector || 'Other')).size;
            this.stats.innerHTML = `
                ${this.renderStatPill('Nodes', this.nodeRecords.length)}
                ${this.renderStatPill('Edges', this.linkRecords.length)}
                ${this.renderStatPill('Sectors', sectors)}
                ${this.renderStatPill('SEC edges', secCount)}
            `;
        }

        renderDetails() {
            if (!this.details) return;
            if (!this.nodeRecords.length && !this.linkRecords.length) {
                this.renderFallbackDetails('3D data unavailable', 'No production network data is available for the 3D view.');
                return;
            }
            if (!this.selectedRecord && !this.selectedEdgeRecord) {
                this.renderGuideDetails();
                return;
            }
            if (this.selectedEdgeRecord) {
                this.renderSelectedEdgeDetails(this.selectedEdgeRecord);
                return;
            }

            const record = this.selectedRecord;
            const connections = this.getConnectionsForRecord(record);
            const directNeighbors = this.getDirectNeighborSummaries(record);
            const secCount = connections.filter(item => item.linkRecord.secBacked).length;
            const top = this.neighborhoodModeEnabled ? directNeighbors.slice(0, 5) : connections.slice(0, 5);
            const strongest = directNeighbors[0] || null;
            const expansion = this.neighborhoodModeEnabled ? this.getSelectedExpansion() : null;
            const neighborhoodSummary = this.neighborhoodModeEnabled
                ? this.renderNeighborhoodSummary(directNeighbors, secCount, strongest)
                : '';
            const expandedSummary = this.neighborhoodModeEnabled && this.depthLevel > 1
                ? this.renderExpandedNetworkSummary(expansion)
                : '';
            const pathInsights = this.renderPathInsights(record, directNeighbors, expansion);
            this.details.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="source-workbench-label mb-2">Selected Node</div>
                        <div class="font-display text-4xl text-white leading-none">${this.escapeHtml(record.node.ticker || '')}</div>
                        <div class="text-base text-cyan-50/78 mt-2 leading-6">${this.escapeHtml(record.node.name || '')}</div>
                    </div>
                    <div class="w-4 h-4 rounded-full mt-2" style="background:${this.escapeHtml(record.node.color || CYAN)}; box-shadow:0 0 18px ${this.escapeHtml(record.node.color || CYAN)};"></div>
                </div>
                <div class="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div class="text-[10px] text-white/42 font-mono">SECTOR</div>
                        <div class="mt-1 text-sm leading-5 text-white/82">${this.escapeHtml(record.node.sector || 'Other')}</div>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div class="text-[10px] text-white/42 font-mono">INDUSTRY GROUP</div>
                        <div class="mt-1 text-sm leading-5 text-white/82">${this.escapeHtml(this.getCompanyIndustryGroup(record.node) || 'Other')}</div>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-3">
                    ${this.renderMetric('Connections', connections.length)}
                    ${this.renderMetric('SEC edges', secCount)}
                </div>
                ${neighborhoodSummary}
                ${expandedSummary}
                ${pathInsights}
                <div class="sidebar-section">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <div class="sidebar-section-title mb-0">${this.neighborhoodModeEnabled ? 'Top Direct Neighbors' : 'Top Relationships'}</div>
                        <div class="text-[11px] text-white/48">${this.escapeHtml(this.neighborhoodModeEnabled ? directNeighbors.length : connections.length)} total</div>
                    </div>
                    <div class="space-y-2">
                        ${top.length ? top.map(item => this.renderRelationshipRow(item)).join('') : '<div class="text-sm text-white/42">No production relationships.</div>'}
                    </div>
                </div>
            `;
        }

        renderPathInsights(record, directNeighbors, expansion) {
            const rows = [];
            const strongestDirect = directNeighbors[0] || null;
            if (strongestDirect) {
                rows.push({
                    label: 'Strongest direct relationship',
                    path: this.getDirectPathLabel(record, strongestDirect.other),
                    strength: Math.round(strongestDirect.linkRecord.strength * 100),
                    secBacked: strongestDirect.linkRecord.secBacked,
                    detail: this.getRelationshipLabel(strongestDirect.linkRecord)
                });
            }

            const strongestSec = directNeighbors.find(item => item.linkRecord.secBacked) || null;
            if (strongestSec) {
                rows.push({
                    label: 'Strongest SEC-backed relationship',
                    path: this.getDirectPathLabel(record, strongestSec.other),
                    strength: Math.round(strongestSec.linkRecord.strength * 100),
                    secBacked: true,
                    detail: this.getRelationshipLabel(strongestSec.linkRecord)
                });
            }

            if (this.neighborhoodModeEnabled && this.depthLevel > 1 && expansion?.strongestPath) {
                rows.push({
                    label: 'Strongest expanded path',
                    path: expansion.strongestPath.label,
                    strength: expansion.strongestPath.strength,
                    secBacked: expansion.strongestPath.secBacked,
                    depth: expansion.strongestPath.depth,
                    detail: `${expansion.strongestPath.edgeCount} relationships`
                });
            }

            const secEmpty = strongestSec
                ? ''
                : '<div class="text-[12px] leading-5 text-white/42">No SEC-backed direct relationship for this node.</div>';
            const empty = rows.length
                ? ''
                : '<div class="text-sm leading-5 text-white/42">No production path context for this node.</div>';

            return `
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Path Insights</div>
                    <div class="space-y-2">
                        ${rows.map(row => this.renderPathInsightRow(row)).join('')}
                        ${secEmpty}
                        ${empty}
                    </div>
                </div>
            `;
        }

        renderPathInsightRow(row) {
            const secBadge = row.secBacked
                ? '<span class="sec-edge-badge rounded-full px-2 py-0.5 text-[10px] font-mono">SEC</span>'
                : '';
            const depthBadge = Number.isFinite(row.depth)
                ? `<span class="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-2 py-0.5 text-[10px] font-mono text-cyan-50/78">Depth ${this.escapeHtml(row.depth)}</span>`
                : '';
            return `
                <div class="graph3d-path-insight-row rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div class="text-[10px] uppercase font-mono text-white/42">${this.escapeHtml(row.label)}</div>
                    <div class="graph3d-path-line mt-1 font-display text-sm leading-5 text-white">${this.escapeHtml(row.path)}</div>
                    <div class="graph3d-path-meta mt-2">
                        <span class="font-mono text-[11px] text-white/58">Strength ${this.escapeHtml(row.strength)}%</span>
                        ${secBadge}
                        ${depthBadge}
                    </div>
                    ${row.detail ? `<div class="mt-2 text-[12px] leading-5 text-cyan-50/58">${this.escapeHtml(row.detail)}</div>` : ''}
                </div>
            `;
        }

        getDirectPathLabel(record, other) {
            return `${this.getRecordTicker(record)} -> ${this.getRecordTicker(other)}`;
        }

        getRecordTicker(record) {
            return record?.node?.ticker || record?.node?.name || record?.id || 'Unknown';
        }

        renderGuideDetails(hint = '') {
            if (!this.details) return;
            const secCount = this.linkRecords.filter(link => link.secBacked).length;
            const hintMarkup = hint
                ? `<div class="mb-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm leading-5 text-cyan-50/78">${this.escapeHtml(hint)}</div>`
                : '';
            this.details.innerHTML = `
                <div class="source-workbench-label mb-3">3D Network Guide</div>
                ${hintMarkup}
                <div class="font-display text-2xl text-white">Explore the production graph</div>
                <p class="mt-2 text-sm leading-6 text-white/62">Rotate, zoom, and select companies without changing filters or underlying graph intelligence.</p>
                <div class="mt-5 space-y-3">
                    ${this.renderGuideRow('fa-arrows-rotate', 'Rotate', 'Drag across the canvas to orbit the network.')}
                    ${this.renderGuideRow('fa-magnifying-glass-plus', 'Zoom', 'Use the mouse wheel or trackpad pinch to move closer or farther away.')}
                    ${this.renderGuideRow('fa-hand-pointer', 'Select', 'Hover or tap a company or relationship; nodes take priority when the pointer is directly over them.')}
                    ${this.renderGuideRow('fa-file-shield', 'SEC emphasis', 'Gold dashed edges mark relationships backed by SEC evidence when emphasis is on.')}
                    ${this.renderGuideRow('fa-tags', 'Labels', 'The labels toggle shows or hides priority tickers plus hovered and selected nodes or relationship endpoints.')}
                    ${this.renderGuideRow('fa-diagram-project', 'Neighborhood Mode', 'When enabled, selecting a company emphasizes its direct neighbors without changing 2D graph state.')}
                    ${this.renderGuideRow('fa-layer-group', 'Depth Level', 'Depth 1 shows direct neighbors; Depth 2 and 3 expand selected-neighborhood emphasis with capped context.')}
                </div>
                <div class="mt-5 grid grid-cols-2 gap-3">
                    ${this.renderMetric('Nodes', this.nodeRecords.length)}
                    ${this.renderMetric('Edges', this.linkRecords.length)}
                    ${this.renderMetric('SEC edges', secCount)}
                    ${this.renderMetric('Neighborhood', this.neighborhoodModeEnabled ? 'On' : 'Off')}
                    ${this.renderMetric('Depth', this.depthLevel)}
                </div>
            `;
        }

        renderNeighborhoodSummary(directNeighbors, secCount, strongest) {
            const strongestLabel = strongest
                ? `${strongest.other.node.ticker || strongest.other.node.name || 'Neighbor'} - ${Math.round(strongest.linkRecord.strength * 100)}%`
                : 'None';
            const relationship = strongest ? this.getRelationshipLabel(strongest.linkRecord) : 'No direct relationships';
            return `
                <div class="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.065] p-3">
                    <div class="flex items-center justify-between gap-3">
                        <div class="source-workbench-label mb-0">Neighborhood Mode</div>
                        <span class="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-2 py-0.5 text-[10px] font-mono text-cyan-50/78">ON</span>
                    </div>
                    <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        ${this.renderCompactMetric('Direct neighbors', directNeighbors.length)}
                        ${this.renderCompactMetric('SEC neighbor edges', secCount)}
                        ${this.renderCompactMetric('Strongest', strongestLabel)}
                    </div>
                    <div class="mt-2 text-[12px] leading-5 text-cyan-50/62">${this.escapeHtml(relationship)}</div>
                </div>
            `;
        }

        renderExpandedNetworkSummary(expansion) {
            if (!expansion) return '';
            const strongestPath = expansion.strongestPath
                ? `${expansion.strongestPath.label} (${expansion.strongestPath.strength}%)`
                : '';
            const capBadge = expansion.capped
                ? '<span class="rounded-full border border-yellow-200/20 bg-yellow-200/10 px-2 py-0.5 text-[10px] font-mono text-yellow-50/78">CAPPED</span>'
                : '';
            return `
                <div class="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div class="flex items-center justify-between gap-3">
                        <div class="source-workbench-label mb-0">Expanded Network</div>
                        ${capBadge}
                    </div>
                    <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        ${this.renderCompactMetric('Expanded nodes', expansion.nodeDepths.size)}
                        ${this.renderCompactMetric('Expanded edges', expansion.edgeDepths.size)}
                        ${strongestPath ? this.renderCompactMetric('Strongest path', strongestPath) : ''}
                    </div>
                </div>
            `;
        }

        renderSelectedEdgeDetails(record) {
            const link = record.link || {};
            const source = record.source.node || {};
            const target = record.target.node || {};
            const strength = `${Math.round(record.strength * 100)}%`;
            const confidence = link.confidence !== undefined && link.confidence !== null && String(link.confidence).trim() !== ''
                ? String(link.confidence)
                : '';
            const relationship = this.getRelationshipLabel(record);
            const type = this.formatConnectionType(link.type || 'link');
            const sourceUrls = getValidSourceUrls(link.source_urls);
            const sourceIndicator = this.getSourceUrlIndicator(sourceUrls);
            const secBadge = record.secBacked
                ? '<span class="sec-edge-badge rounded-full px-2.5 py-1 text-[10px] font-mono tracking-[1px]">SEC BACKED</span>'
                : '';
            const edgeColor = record.secBacked ? GOLD : record.color;
            const pathContext = this.renderSelectedEdgePathContext(record);

            this.details.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="source-workbench-label mb-2">Selected Relationship</div>
                        <div class="font-display text-2xl md:text-3xl text-white leading-tight">${this.escapeHtml(source.ticker || '')} -> ${this.escapeHtml(target.ticker || '')}</div>
                        <div class="text-sm text-cyan-50/70 mt-2 leading-5">${this.escapeHtml(relationship)}</div>
                    </div>
                    <div class="shrink-0">${secBadge}</div>
                </div>
                <div class="mt-4 h-px" style="background:linear-gradient(90deg, ${this.escapeHtml(edgeColor)}, transparent); opacity:.72;"></div>
                <div class="mt-5 grid grid-cols-1 gap-3">
                    <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div class="text-[10px] text-white/42 font-mono">SOURCE COMPANY</div>
                        <div class="mt-1 font-display text-xl text-white">${this.escapeHtml(source.ticker || '')}</div>
                        <div class="mt-1 text-sm leading-5 text-white/64">${this.escapeHtml(source.name || '')}</div>
                    </div>
                    <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div class="text-[10px] text-white/42 font-mono">TARGET COMPANY</div>
                        <div class="mt-1 font-display text-xl text-white">${this.escapeHtml(target.ticker || '')}</div>
                        <div class="mt-1 text-sm leading-5 text-white/64">${this.escapeHtml(target.name || '')}</div>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    ${this.renderDetailField('RELATIONSHIP LABEL', relationship)}
                    ${this.renderDetailField('RELATIONSHIP TYPE', type)}
                    ${this.renderDetailField('STRENGTH', strength)}
                    ${confidence ? this.renderDetailField('CONFIDENCE', confidence) : ''}
                    ${sourceIndicator ? this.renderDetailField('SOURCE URL', sourceIndicator) : ''}
                </div>
                ${pathContext}
                ${link.provenance ? `
                    <div class="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div class="text-[10px] text-white/42 font-mono">PROVENANCE</div>
                        <div class="mt-1 text-sm leading-5 text-white/76">${this.escapeHtml(link.provenance)}</div>
                    </div>
                ` : ''}
            `;
        }

        renderSelectedEdgePathContext(record) {
            if (!this.neighborhoodModeEnabled) return '';
            const expansion = this.getSelectedExpansion();
            const edgeDepth = expansion.edgeDepths.get(record);
            const message = Number.isFinite(edgeDepth)
                ? `This relationship is part of the active expanded neighborhood at depth ${edgeDepth}.`
                : this.selectedRecord
                    ? 'This relationship is outside the active expanded neighborhood.'
                    : 'No active expanded neighborhood while a relationship is selected.';
            return `
                <div class="mt-4 rounded-2xl border border-cyan-300/16 bg-cyan-300/[0.055] p-3">
                    <div class="text-[10px] text-cyan-50/58 font-mono uppercase">Path Context</div>
                    <div class="mt-1 text-sm leading-5 text-cyan-50/74">${this.escapeHtml(message)}</div>
                </div>
            `;
        }

        renderDetailField(label, value) {
            return `
                <div class="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div class="text-[10px] text-white/42 font-mono">${this.escapeHtml(label)}</div>
                    <div class="mt-1 text-sm leading-5 text-white/82">${this.escapeHtml(value)}</div>
                </div>
            `;
        }

        renderFallbackDetails(title, body) {
            this.details.innerHTML = `
                <div class="source-workbench-label mb-3">3D Network</div>
                <div class="rounded-3xl border border-yellow-300/20 bg-yellow-300/10 p-4">
                    <div class="font-display text-2xl text-white">${this.escapeHtml(title)}</div>
                    <p class="text-sm leading-6 text-white/64 mt-2">${this.escapeHtml(body)}</p>
                </div>
            `;
        }

        renderStatPill(label, value) {
            return `
                <span class="graph3d-stat-pill rounded-full px-3 py-1.5">
                    <span class="graph3d-stat-value">${this.escapeHtml(value)}</span>
                    <span class="graph3d-stat-label">${this.escapeHtml(label)}</span>
                </span>
            `;
        }

        renderGuideRow(icon, title, body) {
            return `
                <div class="rounded-2xl border border-white/10 bg-black/20 p-3 flex gap-3">
                    <div class="w-8 h-8 rounded-2xl bg-cyan-300/10 border border-cyan-200/15 text-cyan-100/82 flex items-center justify-center shrink-0">
                        <i class="fa-solid ${this.escapeHtml(icon)} text-xs"></i>
                    </div>
                    <div>
                        <div class="text-sm font-semibold text-white/88">${this.escapeHtml(title)}</div>
                        <div class="text-sm leading-5 text-white/58 mt-0.5">${this.escapeHtml(body)}</div>
                    </div>
                </div>
            `;
        }

        renderMetric(label, value) {
            return `
                <div class="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div class="text-[10px] text-white/42 font-mono">${this.escapeHtml(label)}</div>
                    <div class="font-display text-xl text-white mt-1">${this.escapeHtml(value)}</div>
                </div>
            `;
        }

        renderCompactMetric(label, value) {
            return `
                <div class="rounded-xl border border-white/10 bg-black/20 p-2">
                    <div class="text-[9px] text-white/42 font-mono uppercase leading-4">${this.escapeHtml(label)}</div>
                    <div class="mt-0.5 text-sm font-semibold text-white/88 truncate">${this.escapeHtml(value)}</div>
                </div>
            `;
        }

        renderRelationshipRow(item) {
            const link = item.linkRecord.link;
            const other = item.other.node;
            const color = item.linkRecord.secBacked ? GOLD : item.linkRecord.color;
            const strength = Math.round(item.linkRecord.strength * 100);
            const secBadge = item.linkRecord.secBacked
                ? '<span class="sec-edge-badge rounded-full px-2 py-0.5 text-[10px] font-mono">SEC</span>'
                : '';
            const rowClass = item.linkRecord.secBacked ? 'connection-row sec-backed-connection-row rounded-2xl p-3' : 'connection-row rounded-2xl p-3';
            const relationship = link.label || this.formatConnectionType(link.type);
            return `
                <div class="${rowClass}">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="connection-title text-sm font-semibold text-white/92 truncate">${this.escapeHtml(other.ticker || '')}</div>
                            <div class="text-[12px] text-white/58 mt-0.5 truncate">${this.escapeHtml(other.name || '')}</div>
                            <div class="text-[12px] text-cyan-50/58 mt-2 leading-5">${this.escapeHtml(relationship)}</div>
                        </div>
                        <div class="flex flex-col items-end gap-1.5 shrink-0">
                            ${secBadge}
                            <span class="font-mono text-[11px] text-white/54">${strength}%</span>
                        </div>
                    </div>
                    <div class="mt-2 h-px" style="background:linear-gradient(90deg, ${this.escapeHtml(color)}, transparent); opacity:.58;"></div>
                </div>
            `;
        }

        getRelationshipLabel(record) {
            const link = record?.link || {};
            return link.label || link.provenance || this.formatConnectionType(link.type || 'link');
        }

        getSourceUrlIndicator(sourceUrls) {
            if (!sourceUrls.length) return '';
            const host = getSourceHost(sourceUrls[0]);
            return sourceUrls.length > 1 ? `${host} +${sourceUrls.length - 1}` : host;
        }

        getLinkRecordKey(record) {
            if (!record) return '';
            const link = record.link || {};
            return [
                record.source?.id ?? link.source ?? '',
                record.target?.id ?? link.target ?? '',
                link.type || '',
                link.label || '',
                link.provenance || ''
            ].join('|');
        }

        getConnectionsForRecord(record) {
            return [...(this.adjacencyByRecord.get(record) || [])];
        }

        getDirectNeighborSummaries(record) {
            const byNeighbor = new Map();
            this.getConnectionsForRecord(record).forEach(item => {
                const existing = byNeighbor.get(item.other.id);
                if (
                    !existing ||
                    item.linkRecord.strength > existing.linkRecord.strength ||
                    (item.linkRecord.strength === existing.linkRecord.strength && item.linkRecord.secBacked && !existing.linkRecord.secBacked)
                ) {
                    byNeighbor.set(item.other.id, item);
                }
            });
            return [...byNeighbor.values()].sort((a, b) =>
                b.linkRecord.strength - a.linkRecord.strength ||
                Number(b.linkRecord.secBacked) - Number(a.linkRecord.secBacked) ||
                String(a.other.node.ticker || '').localeCompare(String(b.other.node.ticker || ''))
            );
        }

        setLabelsEnabled(value) {
            this.labelsEnabled = Boolean(value);
            this.refreshLabels();
            this.syncControls();
            this.renderDetails();
        }

        toggleLabels() {
            this.setLabelsEnabled(!this.labelsEnabled);
        }

        setSecEmphasisEnabled(value) {
            this.secEmphasisEnabled = Boolean(value);
            if (this.initialized && !this.engineUnavailable) this.rebuildScene();
            this.syncControls();
            this.renderDetails();
        }

        toggleSecEmphasis() {
            this.setSecEmphasisEnabled(!this.secEmphasisEnabled);
        }

        setAutoRotateEnabled(value) {
            this.autoRotateEnabled = Boolean(value);
            this.syncControls();
            this.start();
        }

        toggleAutoRotate() {
            this.setAutoRotateEnabled(!this.autoRotateEnabled);
        }

        setNeighborhoodModeEnabled(value) {
            this.neighborhoodModeEnabled = Boolean(value);
            this.expansionCache = null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.syncControls();
            this.renderDetails();
        }

        toggleNeighborhoodMode() {
            this.setNeighborhoodModeEnabled(!this.neighborhoodModeEnabled);
        }

        setDepthLevel(value) {
            const nextDepth = normalizeDepthLevel(value);
            if (nextDepth === this.depthLevel) {
                this.syncControls();
                return;
            }
            this.depthLevel = nextDepth;
            this.expansionCache = null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.syncControls();
            this.renderDetails();
        }

        focusSelection() {
            if (!this.nodeRecords.length && !this.linkRecords.length) {
                this.renderDetails();
                return;
            }
            if (this.selectedRecord) {
                this.focusNodeRecord(this.selectedRecord);
                return;
            }
            if (this.selectedEdgeRecord) {
                this.focusEdgeRecord(this.selectedEdgeRecord);
                return;
            }
            this.renderGuideDetails('Select a company or relationship first, then use Focus Selected.');
        }

        focusNodeRecord(record) {
            if (!record?.position) return;
            this.animateCameraTo(record.position, this.getNodeFocusRadius(record));
        }

        focusEdgeRecord(record) {
            if (!record?.source?.position || !record?.target?.position) return;
            const midpoint = record.source.position.clone().add(record.target.position).multiplyScalar(0.5);
            const endpointDistance = record.source.position.distanceTo(record.target.position);
            const radius = clamp(endpointDistance * 1.45 + 58, 96, 260);
            this.animateCameraTo(midpoint, radius);
        }

        getNodeFocusRadius(record) {
            const distances = this.linkRecords
                .filter(link => link.source === record || link.target === record)
                .map(link => {
                    const other = link.source === record ? link.target : link.source;
                    return other?.position ? record.position.distanceTo(other.position) : 0;
                })
                .filter(distance => distance > 0)
                .sort((a, b) => a - b);
            const nearbyDistance = distances.length ? distances[Math.min(distances.length - 1, 5)] : 0;
            return clamp(Math.max(88, nearbyDistance * 1.65, record.radius * 24), 88, 190);
        }

        clearSelection(renderDetails = true) {
            this.cameraTransition = null;
            this.selectedRecord = null;
            this.hoveredRecord = null;
            this.selectedEdgeRecord = null;
            this.hoveredEdgeRecord = null;
            this.expansionCache = null;
            if (this.canvas) this.canvas.style.cursor = 'grab';
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.updateEdgeEmphasis();
            this.hideTooltip();
            if (renderDetails) this.renderDetails();
        }

        resetView() {
            this.cameraTransition = null;
            this.resetCamera(false);
            this.clearSelection(true);
        }

        resetCamera(renderDetails = true) {
            this.cameraTransition = null;
            this.cameraState.theta = -0.72;
            this.cameraState.phi = 1.08;
            this.cameraState.radius = this.fitRadius || 210;
            this.cameraState.target = { x: 0, y: 0, z: 0 };
            if (renderDetails) this.renderDetails();
        }

        fitCamera() {
            this.cameraTransition = null;
            this.cameraState.target = { x: 0, y: 0, z: 0 };
            this.cameraState.radius = clamp(this.fitRadius * 0.92, 110, 420);
        }

        syncControls() {
            this.syncToggle(this.controls.labels, this.labelsEnabled, this.labelsEnabled ? 'Labels On' : 'Labels Off');
            this.syncToggle(this.controls.sec, this.secEmphasisEnabled, this.secEmphasisEnabled ? 'SEC Emphasis On' : 'SEC Emphasis Off');
            this.syncToggle(this.controls.autoRotate, this.autoRotateEnabled, this.autoRotateEnabled ? 'Auto-Rotate On' : 'Auto-Rotate Off');
            this.syncToggle(this.controls.neighborhood, this.neighborhoodModeEnabled, this.neighborhoodModeEnabled ? 'Neighborhood On' : 'Neighborhood Mode');
            if (this.controls.depthSelect) {
                this.controls.depthSelect.value = String(this.depthLevel);
            }
        }

        syncToggle(button, active, label) {
            if (!button) return;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            button.classList.toggle('is-active', active);
            const span = button.querySelector('span');
            if (span) span.innerText = label;
        }

        showUnavailable() {
            if (this.details) {
                this.details.innerHTML = `
                    <div class="source-workbench-label mb-3">3D Network</div>
                    <div class="rounded-3xl border border-yellow-300/20 bg-yellow-300/10 p-4">
                        <div class="font-display text-2xl text-white">3D engine unavailable</div>
                        <p class="text-sm leading-6 text-white/64 mt-2">Three.js did not load from the CDN. The production 2D graph and Source Workbench remain available.</p>
                    </div>
                `;
            }
        }
    }

    window.StockPhotonicGraph3D = {
        create: options => new Graph3DView(options)
    };
})();
