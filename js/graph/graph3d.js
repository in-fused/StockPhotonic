(function () {
    const GOLD = '#ffd700';
    const CYAN = '#00f9ff';
    const MAGENTA = '#ff00aa';
    const GREEN = '#00ff9f';
    const FALLBACK_EDGE = '#00f9ff';
    const LABEL_LIMIT = 16;
    const TAU = Math.PI * 2;

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
            this.selectedRecord = null;
            this.hoveredRecord = null;

            this.cameraState = {
                theta: -0.72,
                phi: 1.08,
                radius: 210,
                target: { x: 0, y: 0, z: 0 }
            };
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
            this.onContextMenu = event => event.preventDefault();
        }

        setData(payload = {}) {
            this.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
            this.links = Array.isArray(payload.links) ? payload.links : [];
            this.edgeColors = payload.edgeColors || this.edgeColors;
            this.defaultEdgeColor = payload.defaultEdgeColor || this.defaultEdgeColor;
            this.getCompanyIndustryGroup = payload.getCompanyIndustryGroup || this.getCompanyIndustryGroup;
            this.isSecBackedConnection = payload.isSecBackedConnection || this.isSecBackedConnection;
            this.formatConnectionType = payload.formatConnectionType || this.formatConnectionType;
            this.escapeHtml = payload.escapeHtml || this.escapeHtml;

            this.buildRecords();
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

        buildRecords() {
            this.nodeRecords = [];
            this.linkRecords = [];
            this.nodeRecordById = new Map();

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
                    line: null
                });
            });

            this.nodeRecords.forEach(record => {
                record.degree = Math.max(record.degree, this.linkRecords.reduce((count, link) => {
                    return count + (link.source === record || link.target === record ? 1 : 0);
                }, 0));
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
                this.edgeGroup.add(line);

                if (secMode) {
                    const glow = new THREE.Line(
                        geometry.clone(),
                        new THREE.LineBasicMaterial({
                            color: GOLD,
                            transparent: true,
                            opacity: 0.22,
                            blending: THREE.AdditiveBlending
                        })
                    );
                    this.edgeGroup.add(glow);
                }
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

            [...labelIds].slice(0, LABEL_LIMIT + 2).forEach(id => {
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
            const color = record.id === this.selectedRecord?.id ? '#ffffff' : record.node.color || CYAN;
            const label = createLabelTexture(THREE, record.node.ticker || record.node.name || '', color);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: label.texture,
                transparent: true,
                opacity: record.id === this.selectedRecord?.id ? 0.98 : 0.78,
                depthWrite: false
            }));
            sprite.position.copy(record.position).add(new THREE.Vector3(0, record.radius + 4.4, 0));
            const scale = record.id === this.selectedRecord?.id ? 18 : 14;
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

        onPointerDown(event) {
            if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
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

            const next = this.pickNode(event);
            if (next !== this.hoveredRecord) {
                this.hoveredRecord = next;
                this.refreshLabels();
                this.updateNodeEmphasis();
            }
            if (next) {
                this.showTooltip(event, next);
            } else {
                this.hideTooltip();
            }
        }

        onPointerUp(event) {
            if (!this.drag.active || this.drag.pointerId !== event.pointerId) return;
            if (!this.drag.moved) {
                this.selectRecord(this.pickNode(event));
            }
            this.canvas.releasePointerCapture?.(event.pointerId);
            this.canvas.classList.remove('is-dragging');
            this.drag.active = false;
            this.drag.pointerId = null;
            event.preventDefault();
        }

        onPointerCancel(event) {
            if (this.drag.pointerId !== null) this.canvas.releasePointerCapture?.(this.drag.pointerId);
            this.canvas.classList.remove('is-dragging');
            this.drag.active = false;
            this.drag.pointerId = null;
            if (event?.type === 'pointerleave') this.hideTooltip();
        }

        onWheel(event) {
            event.preventDefault();
            const nextRadius = this.cameraState.radius * Math.exp(clamp(event.deltaY, -180, 180) * 0.0018);
            this.cameraState.radius = clamp(nextRadius, 38, 720);
        }

        pickNode(event) {
            if (!this.camera || !this.raycaster || !this.nodePickables.length) return null;
            const rect = this.canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
            const y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
            this.pointer.set(x, y);
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hit = this.raycaster.intersectObjects(this.nodePickables, false)[0];
            return hit?.object?.userData?.graph3dRecord || null;
        }

        selectRecord(record) {
            this.selectedRecord = record || null;
            this.refreshLabels();
            this.updateNodeEmphasis();
            this.renderDetails();
        }

        updateNodeEmphasis() {
            this.nodeRecords.forEach(record => {
                const active = record === this.selectedRecord || record === this.hoveredRecord;
                const dimmed = this.selectedRecord && record !== this.selectedRecord && !this.areConnected(record, this.selectedRecord);
                if (record.mesh?.material) {
                    record.mesh.material.opacity = active ? 1 : dimmed ? 0.35 : 0.88;
                    record.mesh.scale.setScalar(record.radius * (active ? 1.22 : 1));
                }
                if (record.glow?.material) {
                    record.glow.material.opacity = active ? 0.58 : dimmed ? 0.12 : 0.31;
                }
            });
        }

        areConnected(a, b) {
            if (!a || !b) return false;
            return this.linkRecords.some(link =>
                (link.source === a && link.target === b) ||
                (link.source === b && link.target === a)
            );
        }

        showTooltip(event, record) {
            if (!this.tooltip) return;
            this.tooltip.innerHTML = `
                <div class="font-display text-sm text-white">${this.escapeHtml(record.node.ticker || '')}</div>
                <div class="text-[11px] text-cyan-100/72">${this.escapeHtml(record.node.name || '')}</div>
            `;
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
                <span class="graph3d-stat-pill rounded-full px-2.5 py-1">${this.nodeRecords.length} NODES</span>
                <span class="graph3d-stat-pill rounded-full px-2.5 py-1">${this.linkRecords.length} EDGES</span>
                <span class="graph3d-stat-pill rounded-full px-2.5 py-1">${sectors} SECTORS</span>
                <span class="graph3d-stat-pill rounded-full px-2.5 py-1">${secCount} SEC EDGES</span>
            `;
        }

        renderDetails() {
            if (!this.details) return;
            if (!this.selectedRecord) {
                const secCount = this.linkRecords.filter(link => link.secBacked).length;
                this.details.innerHTML = `
                    <div class="source-workbench-label mb-3">3D Network</div>
                    <div class="font-display text-2xl text-white">Production Graph</div>
                    <div class="mt-4 grid grid-cols-2 gap-3">
                        ${this.renderMetric('Nodes', this.nodeRecords.length)}
                        ${this.renderMetric('Edges', this.linkRecords.length)}
                        ${this.renderMetric('SEC backed', secCount)}
                        ${this.renderMetric('Labels', this.labelsEnabled ? 'On' : 'Off')}
                    </div>
                `;
                return;
            }

            const record = this.selectedRecord;
            const connections = this.getConnectionsForRecord(record);
            const secCount = connections.filter(item => item.linkRecord.secBacked).length;
            const top = connections.slice(0, 5);
            this.details.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <div class="source-workbench-label mb-2">Selected Node</div>
                        <div class="font-display text-3xl text-white">${this.escapeHtml(record.node.ticker || '')}</div>
                        <div class="text-sm text-white/62 mt-1">${this.escapeHtml(record.node.name || '')}</div>
                    </div>
                    <div class="w-4 h-4 rounded-full mt-2" style="background:${this.escapeHtml(record.node.color || CYAN)}; box-shadow:0 0 18px ${this.escapeHtml(record.node.color || CYAN)};"></div>
                </div>
                <div class="mt-4 space-y-2 text-sm text-white/66">
                    <div><span class="text-white/38 font-mono text-[10px] tracking-[1.2px]">SECTOR</span> ${this.escapeHtml(record.node.sector || 'Other')}</div>
                    <div><span class="text-white/38 font-mono text-[10px] tracking-[1.2px]">INDUSTRY GROUP</span> ${this.escapeHtml(this.getCompanyIndustryGroup(record.node) || 'Other')}</div>
                </div>
                <div class="mt-4 grid grid-cols-2 gap-3">
                    ${this.renderMetric('Connections', connections.length)}
                    ${this.renderMetric('SEC backed', secCount)}
                </div>
                <div class="sidebar-section">
                    <div class="sidebar-section-title">Top Relationships</div>
                    <div class="space-y-2">
                        ${top.length ? top.map(item => this.renderRelationshipRow(item)).join('') : '<div class="text-sm text-white/42">No production relationships.</div>'}
                    </div>
                </div>
            `;
        }

        renderMetric(label, value) {
            return `
                <div class="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div class="text-[10px] text-white/38 font-mono tracking-[1.2px]">${this.escapeHtml(label)}</div>
                    <div class="font-display text-xl text-white mt-1">${this.escapeHtml(value)}</div>
                </div>
            `;
        }

        renderRelationshipRow(item) {
            const link = item.linkRecord.link;
            const other = item.other.node;
            const color = item.linkRecord.secBacked ? GOLD : item.linkRecord.color;
            const strength = Math.round(item.linkRecord.strength * 100);
            const secBadge = item.linkRecord.secBacked
                ? '<span class="sec-edge-badge rounded-full px-2 py-0.5 text-[9px] font-mono">SEC</span>'
                : '';
            return `
                <div class="connection-row rounded-2xl p-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-white/90 truncate">${this.escapeHtml(other.ticker || '')} <span class="text-white/42 font-normal">${this.escapeHtml(other.name || '')}</span></div>
                            <div class="text-[11px] text-white/50 mt-1 truncate">${this.escapeHtml(link.label || this.formatConnectionType(link.type))}</div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">${secBadge}<span class="font-mono text-[10px] text-white/45">${strength}%</span></div>
                    </div>
                    <div class="mt-2 h-px" style="background:linear-gradient(90deg, ${this.escapeHtml(color)}, transparent); opacity:.58;"></div>
                </div>
            `;
        }

        getConnectionsForRecord(record) {
            return this.linkRecords
                .filter(link => link.source === record || link.target === record)
                .map(linkRecord => ({
                    linkRecord,
                    other: linkRecord.source === record ? linkRecord.target : linkRecord.source
                }))
                .sort((a, b) =>
                    b.linkRecord.strength - a.linkRecord.strength ||
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

        resetCamera(renderDetails = true) {
            this.cameraState.theta = -0.72;
            this.cameraState.phi = 1.08;
            this.cameraState.radius = this.fitRadius || 210;
            this.cameraState.target = { x: 0, y: 0, z: 0 };
            if (renderDetails) this.renderDetails();
        }

        fitCamera() {
            this.cameraState.target = { x: 0, y: 0, z: 0 };
            this.cameraState.radius = clamp(this.fitRadius * 0.92, 110, 420);
        }

        syncControls() {
            this.syncToggle(this.controls.labels, this.labelsEnabled, this.labelsEnabled ? 'Labels On' : 'Labels Off');
            this.syncToggle(this.controls.sec, this.secEmphasisEnabled, this.secEmphasisEnabled ? 'SEC Emphasis On' : 'SEC Emphasis Off');
            this.syncToggle(this.controls.autoRotate, this.autoRotateEnabled, this.autoRotateEnabled ? 'Auto-Rotate On' : 'Auto-Rotate Off');
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
                    <div class="font-display text-2xl text-white">3D engine unavailable</div>
                    <p class="text-sm text-white/58 mt-3">Three.js did not load from the CDN.</p>
                `;
            }
        }
    }

    window.StockPhotonicGraph3D = {
        create: options => new Graph3DView(options)
    };
})();
