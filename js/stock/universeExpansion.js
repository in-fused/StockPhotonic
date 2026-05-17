(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const previewIndexCache = new WeakMap();

    function normalizeTicker(value) {
        return String(value || '').trim().toUpperCase();
    }

    function safeArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function extractRecords(payload) {
        if (Array.isArray(payload)) return payload.filter(Boolean);
        return safeArray(payload?.records).filter(Boolean);
    }

    function extractBatches(payload) {
        if (Array.isArray(payload?.expansion_batches)) return payload.expansion_batches.filter(Boolean);
        if (Array.isArray(payload?.batches)) return payload.batches.filter(Boolean);
        return [];
    }

    function buildPreviewIndexes(records, batches) {
        if (previewIndexCache.has(records)) return previewIndexCache.get(records);

        const ecosystemOptions = new Map();
        const corridorOptions = new Map();
        const batchById = new Map();
        const recordsByTicker = new Map();
        const readinessCounts = new Map();
        const blockerCounts = new Map();

        batches.forEach(batch => {
            const batchId = String(batch?.batch_id || '').trim();
            if (batchId) batchById.set(batchId, batch);
        });

        records.forEach(record => {
            const ticker = normalizeTicker(record?.ticker);
            if (ticker) recordsByTicker.set(ticker, record);
            const readiness = String(record?.readiness_state || 'pending_review');
            readinessCounts.set(readiness, (readinessCounts.get(readiness) || 0) + 1);
            safeArray(record?.blockers).forEach(blocker => {
                const key = String(blocker || '').trim();
                if (key) blockerCounts.set(key, (blockerCounts.get(key) || 0) + 1);
            });
            safeArray(record?.ecosystem_assignments).forEach(assignment => {
                const key = String(assignment?.ecosystem_key || '').trim();
                if (key && !ecosystemOptions.has(key)) {
                    ecosystemOptions.set(key, {
                        key,
                        label: assignment?.label || formatKeyLabel(key)
                    });
                }
            });
            safeArray(record?.corridor_assignments).forEach(assignment => {
                const key = String(assignment?.corridor_key || '').trim();
                if (key && !corridorOptions.has(key)) {
                    corridorOptions.set(key, {
                        key,
                        label: assignment?.label || formatKeyLabel(key)
                    });
                }
            });
        });

        const model = {
            ecosystemOptions: [...ecosystemOptions.values()].sort((a, b) => a.label.localeCompare(b.label)),
            corridorOptions: [...corridorOptions.values()].sort((a, b) => a.label.localeCompare(b.label)),
            batchById,
            recordsByTicker,
            readinessCounts: [...readinessCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
            blockerCounts: [...blockerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        };
        previewIndexCache.set(records, model);
        return model;
    }

    function formatKeyLabel(key) {
        return String(key || 'Preview')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    function getRecordEcosystemKeys(record) {
        return safeArray(record?.ecosystem_assignments)
            .map(assignment => String(assignment?.ecosystem_key || '').trim())
            .filter(Boolean);
    }

    function getRecordCorridorKeys(record) {
        return safeArray(record?.corridor_assignments)
            .map(assignment => String(assignment?.corridor_key || '').trim())
            .filter(Boolean);
    }

    function getRecordBatchIds(record) {
        return safeArray(record?.expansion_batch_ids)
            .map(batchId => String(batchId || '').trim())
            .filter(Boolean);
    }

    function getAnchorTickers(record, batchById) {
        const directAnchors = safeArray(record?.preview?.preview_anchor_tickers)
            .map(normalizeTicker)
            .filter(Boolean);
        if (directAnchors.length) return directAnchors;

        const batchAnchors = getRecordBatchIds(record)
            .flatMap(batchId => safeArray(batchById.get(batchId)?.preview_anchor_tickers || batchById.get(batchId)?.anchor_tickers))
            .map(normalizeTicker)
            .filter(Boolean);
        return [...new Set(batchAnchors)];
    }

    function getPreviewNodeRadius(record) {
        const score = Number(record?.strategic_hub_preview?.staged_hub_score || record?.readiness_score || 0);
        if (score >= 10) return 8.8;
        if (score >= 8) return 8;
        if (score >= 6) return 7.2;
        return 6.6;
    }

    function getCandidateSearchText(node) {
        const record = node?.candidateCompany || node || {};
        return [
            record.ticker,
            record.name,
            record.sector_proposal,
            record.industry_proposal,
            record.industry_group_proposal,
            record.expansion_rationale,
            ...getRecordEcosystemKeys(record),
            ...getRecordCorridorKeys(record),
            ...getRecordBatchIds(record)
        ].join(' ').toLowerCase();
    }

    function buildPreviewGraph(payload, options = {}) {
        const records = extractRecords(payload);
        const batches = extractBatches(payload);
        const indexes = buildPreviewIndexes(records, batches);
        const productionNodeByTicker = options.productionNodeByTicker || new Map();
        const color = options.nodeColor || '#a3e635';
        const anchorLinkColor = options.anchorLinkColor || '#bef264';
        const nodes = [];
        const links = [];

        records.forEach((record, index) => {
            const ticker = normalizeTicker(record?.ticker);
            if (!ticker) return;
            const anchorTickers = getAnchorTickers(record, indexes.batchById)
                .filter(anchorTicker => productionNodeByTicker.has(anchorTicker))
                .slice(0, 5);
            const node = {
                id: `candidate-company-preview-node-${ticker}`,
                isCandidateCompanyPreviewNode: true,
                ticker,
                name: record.name || `${ticker} candidate company`,
                sector: record.sector_proposal || 'Candidate Company Preview',
                industry: record.industry_proposal || 'Candidate company',
                industryGroup: record.industry_group_proposal || 'Candidate Company Preview',
                rank: 'preview',
                market_cap: 0,
                color,
                radius: getPreviewNodeRadius(record),
                degree: anchorTickers.length,
                candidateCompany: record,
                previewAnchorTickers: anchorTickers,
                previewIndex: index,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0
            };
            nodes.push(node);
            anchorTickers.slice(0, 2).forEach((anchorTicker, anchorIndex) => {
                const anchor = productionNodeByTicker.get(anchorTicker);
                if (!anchor) return;
                links.push({
                    key: `candidate-company-preview-${ticker}-${anchorTicker}-${anchorIndex}`,
                    isCandidateCompanyPreviewLink: true,
                    source: anchor,
                    target: node,
                    sourceTicker: anchorTicker,
                    targetTicker: ticker,
                    type: 'candidate_corridor_assignment',
                    label: `${ticker} candidate corridor assignment`,
                    strength: 0.34,
                    confidence: null,
                    color: anchorLinkColor,
                    candidateCompany: record,
                    previewSemantics: record?.preview?.preview_edge_semantics || 'corridor_assignment_not_relationship',
                    relationship_claim_created: false,
                    relationship_authority: false,
                    production_write_allowed: false
                });
            });
        });

        return {
            records,
            batches,
            indexes,
            nodes,
            links,
            summary: buildSummary(records, batches)
        };
    }

    function positionPreviewNodes(nodes, options = {}) {
        const getAnchorPosition = options.getAnchorPosition;
        const hashNumber = options.hashNumber || basicHashNumber;
        const clusterSpacing = Number(options.clusterSpacing || 1);
        const fallbackRadius = Number(options.fallbackRadius || 1180);
        const batchOrder = new Map();
        nodes.forEach(node => {
            const batchId = getRecordBatchIds(node.candidateCompany)[0] || 'candidate';
            if (!batchOrder.has(batchId)) batchOrder.set(batchId, batchOrder.size);
        });

        nodes.forEach((node, index) => {
            const record = node.candidateCompany || {};
            const anchorPositions = safeArray(node.previewAnchorTickers)
                .map(ticker => (typeof getAnchorPosition === 'function' ? getAnchorPosition(ticker) : null))
                .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
            const batchId = getRecordBatchIds(record)[0] || 'candidate';
            const batchIndex = batchOrder.get(batchId) || 0;
            const seed = hashNumber(`${node.ticker}:${batchId}:${index}`);
            const angle = ((seed % 360) / 360) * Math.PI * 2 + batchIndex * 0.42;
            const localOffset = 210 + (seed % 125) + (index % 5) * 24;
            const distance = localOffset * clusterSpacing;
            if (anchorPositions.length) {
                const centroid = anchorPositions.reduce((sum, point) => ({
                    x: sum.x + point.x,
                    y: sum.y + point.y
                }), { x: 0, y: 0 });
                centroid.x /= anchorPositions.length;
                centroid.y /= anchorPositions.length;
                node.x = centroid.x + Math.cos(angle) * distance;
                node.y = centroid.y + Math.sin(angle) * distance * 0.82;
                return;
            }
            const fallbackAngle = (batchIndex / Math.max(1, batchOrder.size)) * Math.PI * 2 - Math.PI / 2;
            node.x = Math.cos(fallbackAngle) * fallbackRadius + Math.cos(angle) * 120;
            node.y = Math.sin(fallbackAngle) * fallbackRadius * 0.72 + Math.sin(angle) * 98;
        });
    }

    function buildSummary(records, batches) {
        const readinessCounts = Counter(records, record => record?.readiness_state || 'pending_review');
        const blockerCounts = Counter(records.flatMap(record => safeArray(record?.blockers)));
        const ecosystems = Counter(records.flatMap(getRecordEcosystemKeys));
        const corridors = Counter(records.flatMap(getRecordCorridorKeys));
        return {
            candidateCompanyCount: records.length,
            expansionBatchCount: batches.length,
            readyForPreviewCount: readinessCounts.get('ready_for_preview') || 0,
            needsSourceReviewCount: readinessCounts.get('needs_source_review') || 0,
            blockerCounts: [...blockerCounts.entries()],
            ecosystemCounts: [...ecosystems.entries()],
            corridorCounts: [...corridors.entries()]
        };
    }

    function Counter(values, getKey = value => value) {
        const map = new Map();
        values.forEach(value => {
            const key = String(getKey(value) || '').trim();
            if (!key) return;
            map.set(key, (map.get(key) || 0) + 1);
        });
        return map;
    }

    function basicHashNumber(value) {
        let hash = 0;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
        }
        return Math.abs(hash);
    }

    function recordMatchesFocus(record, filters = {}) {
        if (!record) return false;
        if (filters.ecosystemKey && !getRecordEcosystemKeys(record).includes(filters.ecosystemKey)) return false;
        if (filters.corridorKey && !getRecordCorridorKeys(record).includes(filters.corridorKey)) return false;
        if (filters.strategicHubOnly && !record?.strategic_hub_preview?.strategic_hub_candidate) return false;
        if (filters.search) {
            const text = [
                record.ticker,
                record.name,
                record.sector_proposal,
                record.industry_proposal,
                record.industry_group_proposal,
                record.expansion_rationale,
                ...getRecordEcosystemKeys(record),
                ...getRecordCorridorKeys(record),
                ...getRecordBatchIds(record)
            ].join(' ').toLowerCase();
            if (!text.includes(String(filters.search).toLowerCase())) return false;
        }
        if (filters.sector && record.sector_proposal !== filters.sector) return false;
        if (filters.industryGroup && record.industry_group_proposal !== filters.industryGroup) return false;
        return true;
    }

    function getDensityLimit(mode) {
        if (mode === 'all') return Infinity;
        if (mode === 'compact') return 18;
        if (mode === 'hubs') return 16;
        return 36;
    }

    window.StockPhotonicStock.universeExpansion = {
        normalizeTicker,
        extractRecords,
        extractBatches,
        buildPreviewGraph,
        positionPreviewNodes,
        buildPreviewIndexes,
        getRecordEcosystemKeys,
        getRecordCorridorKeys,
        getRecordBatchIds,
        getCandidateSearchText,
        recordMatchesFocus,
        getDensityLimit,
        formatKeyLabel
    };
})();
