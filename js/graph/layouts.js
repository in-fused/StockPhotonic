(function () {
    window.StockPhotonicGraph = window.StockPhotonicGraph || {};

    function getValidLayoutMode(mode, options) {
        const {
            sectorMode,
            hubMode,
            nexusMode
        } = options;

        if (mode === hubMode) return hubMode;
        if (mode === nexusMode) return nexusMode;
        return sectorMode;
    }

    function isHubLayoutActive(options) {
        const {
            layoutMode,
            hubMode,
            selectedNode,
            visibleNodeIds
        } = options;

        return layoutMode === hubMode && selectedNode && visibleNodeIds.has(selectedNode.id);
    }

    function isNexusLayoutActive(options) {
        const {
            layoutMode,
            nexusMode,
            selectedNode,
            visibleNodeIds
        } = options;

        return layoutMode === nexusMode && selectedNode && visibleNodeIds.has(selectedNode.id);
    }

    function getLayoutModeLabel(options) {
        const {
            layoutMode,
            hubMode,
            nexusMode,
            isHubActive,
            isNexusActive
        } = options;

        if (layoutMode === nexusMode) {
            return isNexusActive ? 'Company Nexus View' : 'Nexus View: Select Company';
        }
        if (layoutMode === hubMode) {
            return isHubActive ? 'Hub Layout' : 'Hub Layout: Select Company';
        }
        return 'Sector Layout';
    }

    function getNodeLayoutPosition(node, options) {
        const {
            isHubActive,
            isNexusActive,
            hubLayoutPositions,
            nexusLayoutPositions
        } = options;

        if (isNexusActive && nexusLayoutPositions.has(node.id)) {
            return nexusLayoutPositions.get(node.id);
        }
        if (isHubActive && hubLayoutPositions.has(node.id)) {
            return hubLayoutPositions.get(node.id);
        }
        return { x: node.x, y: node.y };
    }

    function getFitNodes(options) {
        const {
            visibleNodes,
            isHubActive,
            isNexusActive,
            hubLayoutPositions,
            nexusLayoutPositions,
            isPortfolioAnalysisActive,
            isPortfolioHighlightedNode
        } = options;

        const baseNodes = isNexusActive
            ? visibleNodes.filter(node => nexusLayoutPositions.has(node.id))
            : isHubActive
                ? visibleNodes.filter(node => hubLayoutPositions.has(node.id))
                : visibleNodes;
        if (!isPortfolioAnalysisActive()) return baseNodes;

        const fitNodeById = new Map(baseNodes.map(node => [node.id, node]));
        visibleNodes
            .filter(isPortfolioHighlightedNode)
            .forEach(node => fitNodeById.set(node.id, node));
        return [...fitNodeById.values()];
    }

    function rebuildHubLayoutPositions(options) {
        const {
            selectedNode,
            adjacencyById,
            visibleNodeIds,
            hubCenter,
            hubRingGap,
            hubFirstRingRadius
        } = options;

        const hubLayoutPositions = new Map();
        hubLayoutPositions.set(selectedNode.id, { ...hubCenter });

        const neighborMap = new Map();
        (adjacencyById.get(selectedNode.id) || []).forEach(item => {
            if (visibleNodeIds.has(item.node.id)) neighborMap.set(item.node.id, item.node);
        });

        const neighbors = [...neighborMap.values()]
            .sort((a, b) => (b.degree - a.degree) || ((a.rank || 9999) - (b.rank || 9999)) || String(a.ticker || '').localeCompare(String(b.ticker || '')));

        let index = 0;
        let ring = 0;
        while (index < neighbors.length) {
            const capacity = Math.min(neighbors.length - index, 10 + ring * 8);
            const radius = hubFirstRingRadius + ring * hubRingGap;
            const angleOffset = ring % 2 ? Math.PI / Math.max(1, capacity) : 0;

            for (let slot = 0; slot < capacity; slot++) {
                const node = neighbors[index + slot];
                const angle = (slot / capacity) * Math.PI * 2 - Math.PI / 2 + angleOffset;
                hubLayoutPositions.set(node.id, {
                    x: hubCenter.x + Math.cos(angle) * radius,
                    y: hubCenter.y + Math.sin(angle) * radius
                });
            }

            index += capacity;
            ring += 1;
        }

        return hubLayoutPositions;
    }

    function rebuildNexusLayoutPositions(options) {
        const {
            selectedNode,
            layoutGroups,
            nexusCenter
        } = options;

        const nexusLayoutPositions = new Map();
        nexusLayoutPositions.set(selectedNode.id, { ...nexusCenter });
        placeNexusLinearGroup(nexusLayoutPositions, layoutGroups.supply, 'left', options);
        placeNexusLinearGroup(nexusLayoutPositions, layoutGroups.partner, 'right', options);
        placeNexusLinearGroup(nexusLayoutPositions, layoutGroups.competitive, 'top', options);
        placeNexusLinearGroup(nexusLayoutPositions, layoutGroups.capital, 'bottom', options);
        placeNexusOuterRing(nexusLayoutPositions, layoutGroups.other, options);
        return nexusLayoutPositions;
    }

    function placeNexusLinearGroup(nexusLayoutPositions, items, side, options) {
        const {
            nexusAxisDistance,
            nexusAxisSpread
        } = options;

        const count = items.length;
        if (!count) return;

        const spread = Math.min(nexusAxisSpread, Math.max(0, (count - 1) * 94));
        items.forEach((item, index) => {
            const t = count === 1 ? 0 : (index / (count - 1)) - 0.5;
            const secondary = t * spread;
            const stagger = count > 1 ? (index % 2 === 0 ? -18 : 18) : 0;
            let x = 0;
            let y = 0;

            if (side === 'left') {
                x = -nexusAxisDistance + stagger;
                y = secondary;
            } else if (side === 'right') {
                x = nexusAxisDistance + stagger;
                y = secondary;
            } else if (side === 'top') {
                x = secondary;
                y = -nexusAxisDistance + stagger;
            } else {
                x = secondary;
                y = nexusAxisDistance + stagger;
            }

            nexusLayoutPositions.set(item.node.id, { x, y });
        });
    }

    function placeNexusOuterRing(nexusLayoutPositions, items, options) {
        const {
            nexusOuterRingRadius
        } = options;

        const count = items.length;
        if (!count) return;

        items.forEach((item, index) => {
            const angle = (index / count) * Math.PI * 2 - Math.PI / 4;
            nexusLayoutPositions.set(item.node.id, {
                x: Math.cos(angle) * nexusOuterRingRadius,
                y: Math.sin(angle) * nexusOuterRingRadius * 0.82
            });
        });
    }

    function getNexusLayoutGroups(node, options) {
        const summary = getNexusSummary(node, options);
        const assignedByNodeId = new Map();
        const { nexusGroupSequence, getConnectionStrength } = options;

        nexusGroupSequence.forEach(groupKey => {
            summary.groups[groupKey].items.forEach(item => {
                const existing = assignedByNodeId.get(item.node.id);
                if (existing && getConnectionStrength(existing.link) >= getConnectionStrength(item.link)) return;
                assignedByNodeId.set(item.node.id, { ...item, groupKey });
            });
        });

        const groups = createEmptyNexusGroups(options);
        [...assignedByNodeId.values()]
            .sort((a, b) => sortNexusItems(a, b, options))
            .forEach(item => groups[item.groupKey].items.push(item));

        return Object.fromEntries(
            Object.entries(groups).map(([key, group]) => [key, group.items])
        );
    }

    function getNexusSummary(node, options) {
        const {
            adjacencyById,
            visibleNodeIds,
            visibleLinkKeys,
            nexusGroupSequence
        } = options;
        const groups = createEmptyNexusGroups(options);
        if (!node) return { groups, total: 0 };

        (adjacencyById.get(node.id) || [])
            .filter(item => visibleNodeIds.has(item.node.id) && visibleLinkKeys.has(item.link.key))
            .forEach(item => {
                const groupKey = getNexusGroupKeyForType(item.link.type, options);
                groups[groupKey].items.push(item);
            });

        let total = 0;
        nexusGroupSequence.forEach(groupKey => {
            const group = groups[groupKey];
            group.items.sort((a, b) => sortNexusItems(a, b, options));
            group.count = group.items.length;
            group.strongest = group.items[0] || null;
            total += group.count;
        });

        return { groups, total };
    }

    function createEmptyNexusGroups(options) {
        const {
            nexusGroupSequence,
            nexusGroups
        } = options;

        return Object.fromEntries(nexusGroupSequence.map(groupKey => [
            groupKey,
            {
                key: groupKey,
                label: nexusGroups[groupKey].label,
                shortLabel: nexusGroups[groupKey].shortLabel,
                items: [],
                count: 0,
                strongest: null
            }
        ]));
    }

    function getNexusGroupKeyForType(type, options) {
        const {
            nexusGroupSequence,
            nexusGroups
        } = options;
        const normalized = String(type || '').toLowerCase();
        const match = nexusGroupSequence.find(groupKey =>
            groupKey !== 'other' && nexusGroups[groupKey].types.includes(normalized)
        );
        return match || 'other';
    }

    function sortNexusItems(a, b, options) {
        const { getConnectionStrength } = options;
        return getConnectionStrength(b.link) - getConnectionStrength(a.link) ||
            (b.node.degree - a.node.degree) ||
            ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
            String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''));
    }

    window.StockPhotonicGraph.layouts = {
        getValidLayoutMode,
        isHubLayoutActive,
        isNexusLayoutActive,
        getLayoutModeLabel,
        getNodeLayoutPosition,
        getFitNodes,
        rebuildHubLayoutPositions,
        rebuildNexusLayoutPositions,
        placeNexusLinearGroup,
        placeNexusOuterRing,
        getNexusLayoutGroups,
        getNexusSummary,
        createEmptyNexusGroups,
        getNexusGroupKeyForType,
        sortNexusItems
    };
})();
