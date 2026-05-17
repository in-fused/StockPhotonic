(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const plannerModelCache = new WeakMap();

    const REVIEWER_DECISION_STATES = {
        pending_preview: {
            key: 'pending_preview',
            label: 'Pending preview',
            shortLabel: 'PENDING',
            rank: 1,
            terminal: false,
            description: 'Candidate is staged for reviewer preview only.'
        },
        approved_for_preview: {
            key: 'approved_for_preview',
            label: 'Approved for preview',
            shortLabel: 'PREVIEW',
            rank: 2,
            terminal: false,
            description: 'Reviewer approved graph-preview visibility; production remains unchanged.'
        },
        approved_for_promotion_review: {
            key: 'approved_for_promotion_review',
            label: 'Approved for promotion review',
            shortLabel: 'PROMO REVIEW',
            rank: 3,
            terminal: false,
            description: 'Reviewer approved deeper manual promotion review; no production write is authorized.'
        },
        blocked: {
            key: 'blocked',
            label: 'Blocked',
            shortLabel: 'BLOCKED',
            rank: 0,
            terminal: true,
            description: 'Safety or source blockers must be resolved before review can continue.'
        },
        enrichment_only: {
            key: 'enrichment_only',
            label: 'Enrichment only',
            shortLabel: 'ENRICH',
            rank: 0,
            terminal: true,
            description: 'Candidate can guide research only and cannot advance to promotion review.'
        },
        production_candidate: {
            key: 'production_candidate',
            label: 'Production candidate',
            shortLabel: 'PROD CAND',
            rank: 4,
            terminal: false,
            description: 'Reviewer marked the candidate for manual promotion tooling and validation.'
        },
        deferred: {
            key: 'deferred',
            label: 'Deferred',
            shortLabel: 'DEFER',
            rank: 0,
            terminal: true,
            description: 'Reviewer intentionally postponed this candidate.'
        }
    };

    const REVIEWER_DECISION_SEQUENCE = [
        'pending_preview',
        'approved_for_preview',
        'approved_for_promotion_review',
        'production_candidate'
    ];

    const REVIEWER_DECISION_ALIASES = {
        accepted_for_review: 'pending_preview',
        pending_reviewer_preview: 'pending_preview',
        pending_review: 'pending_preview',
        ready_for_preview: 'pending_preview',
        preview_ready: 'pending_preview',
        accepted_for_visibility: 'approved_for_preview',
        ready_for_promotion_review: 'approved_for_promotion_review',
        promotion_review: 'approved_for_promotion_review',
        weak_signal: 'enrichment_only',
        enrich_only: 'enrichment_only'
    };

    function safeArray(value) {
        return Array.isArray(value) ? value.filter(Boolean) : [];
    }

    function normalizeTicker(value) {
        return String(value || '').trim().toUpperCase();
    }

    function normalizeKey(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function formatKeyLabel(key) {
        const universeExpansion = window.StockPhotonicStock?.universeExpansion;
        if (universeExpansion?.formatKeyLabel) return universeExpansion.formatKeyLabel(key);
        return String(key || 'review')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    function extractRecords(payload) {
        const universeExpansion = window.StockPhotonicStock?.universeExpansion;
        if (universeExpansion?.extractRecords) return universeExpansion.extractRecords(payload);
        if (Array.isArray(payload)) return payload.filter(Boolean);
        return safeArray(payload?.records);
    }

    function extractBatches(payload) {
        const universeExpansion = window.StockPhotonicStock?.universeExpansion;
        if (universeExpansion?.extractBatches) return universeExpansion.extractBatches(payload);
        if (Array.isArray(payload?.expansion_batches)) return payload.expansion_batches.filter(Boolean);
        if (Array.isArray(payload?.batches)) return payload.batches.filter(Boolean);
        return [];
    }

    function buildPlannerModel(context = {}) {
        const companyPayload = context.companyPayload || {};
        const records = extractRecords(companyPayload);
        const cached = getCachedModel(companyPayload, context);
        if (cached) return cached;

        const batchPayloads = safeArray(context.batchPayloads || [
            companyPayload,
            context.batchPayload
        ]);
        const batches = dedupeByKey(
            batchPayloads.flatMap(extractBatches),
            batch => batch?.batch_id || batch?.label || ''
        );
        const productionCompanies = safeArray(context.companies);
        const productionConnections = safeArray(context.connections);
        const productionTickerSet = new Set(productionCompanies.map(company => normalizeTicker(company?.ticker)).filter(Boolean));
        const recordRows = records.map(record => buildCandidatePlanRecord(record, {
            ...context,
            productionTickerSet
        }));
        const batchRows = buildBatchPlanningRows(recordRows, batches);
        const inputReadyRecords = recordRows.filter(row => row.readiness.inputReady);
        const approvedPromotionRecords = recordRows.filter(row => row.readiness.productionCandidateReady);
        const simulation = buildPromotionSimulation(inputReadyRecords, {
            ...context,
            productionCompanies,
            productionConnections
        });
        const approvedSimulation = buildPromotionSimulation(approvedPromotionRecords, {
            ...context,
            productionCompanies,
            productionConnections
        });
        const model = {
            records: recordRows,
            batches: batchRows,
            summary: buildPlannerSummary(recordRows, batchRows),
            simulation,
            approvedSimulation,
            strongestCandidates: recordRows
                .filter(row => row.readiness.inputReady)
                .sort(sortByReadiness)
                .slice(0, 12),
            weakestCandidates: recordRows
                .slice()
                .sort((a, b) => a.readiness.score - b.readiness.score || a.ticker.localeCompare(b.ticker))
                .slice(0, 12),
            sourceSummary: buildSourceSummary(recordRows),
            lifecycleSummary: buildLifecycleSummary(recordRows),
            blockerSummary: buildBlockerSummary(recordRows),
            safety: {
                reviewOnly: true,
                simulationOnly: true,
                productionWrites: 0,
                companiesWritten: 0,
                connectionsWritten: 0,
                automaticPromotionAllowed: false,
                relationshipCreationAllowed: false
            }
        };
        cacheModel(companyPayload, context, model);
        return model;
    }

    function getCachedModel(companyPayload, context) {
        if (!companyPayload || typeof companyPayload !== 'object') return null;
        const byContext = plannerModelCache.get(companyPayload);
        if (!byContext) return null;
        const key = getContextCacheKey(context);
        return byContext.get(key) || null;
    }

    function cacheModel(companyPayload, context, model) {
        if (!companyPayload || typeof companyPayload !== 'object') return;
        let byContext = plannerModelCache.get(companyPayload);
        if (!byContext) {
            byContext = new Map();
            plannerModelCache.set(companyPayload, byContext);
        }
        byContext.set(getContextCacheKey(context), model);
    }

    function getContextCacheKey(context) {
        const companyCount = safeArray(context.companies).length;
        const connectionCount = safeArray(context.connections).length;
        const batchCount = extractBatches(context.batchPayload).length;
        const reportCount = safeArray(context.reportPayload?.records).length;
        return `${companyCount}:${connectionCount}:${batchCount}:${reportCount}`;
    }

    function buildCandidatePlanRecord(record, context = {}) {
        const productionTickerSet = context.productionTickerSet ||
            new Set(safeArray(context.companies).map(company => normalizeTicker(company?.ticker)).filter(Boolean));
        const ticker = normalizeTicker(record?.ticker);
        const source = buildSourceReadiness(record);
        const duplicateStatus = getDuplicateStatus(record, productionTickerSet);
        const safetyBlockers = getSafetyBlockers(record, source, duplicateStatus);
        const decisionState = getReviewerDecisionState(record, safetyBlockers);
        const strategicHub = scoreStrategicHub(record, source);
        const readiness = scoreProductionReadiness(record, {
            source,
            duplicateStatus,
            strategicHub,
            decisionState,
            safetyBlockers
        });
        const reviewGates = getReviewGates(record, readiness, decisionState);
        const anchorTickers = getAnchorTickers(record);
        return {
            record,
            ticker,
            name: record?.name || ticker,
            batchIds: getBatchIds(record),
            primaryBatchId: record?.primary_batch_id || getBatchIds(record)[0] || 'review',
            ecosystemKeys: getAssignmentKeys(record, 'ecosystem_assignments', 'ecosystem_key'),
            corridorKeys: getAssignmentKeys(record, 'corridor_assignments', 'corridor_key'),
            anchorTickers,
            source,
            duplicateStatus,
            strategicHub,
            decisionState,
            decisionPath: getDecisionPath(decisionState.key),
            nextDecision: getNextDecision(record, decisionState, readiness, safetyBlockers),
            readiness,
            blockers: safetyBlockers,
            reviewGates,
            sourceUrls: getCandidateCompanySourceUrls(record),
            previewAnchorCount: anchorTickers.length,
            reviewOnly: true,
            simulationOnly: true,
            productionWriteAllowed: false,
            relationshipAuthority: false
        };
    }

    function getCandidateCompanySourceUrls(record) {
        return [
            ...safeArray(record?.source_urls),
            record?.official_listing_source_url,
            record?.sec_submission_source_url
        ].map(url => String(url || '').trim())
            .filter(url => /^https?:\/\//i.test(url));
    }

    function buildSourceReadiness(record) {
        const sourceUrls = [...new Set(getCandidateCompanySourceUrls(record))];
        const summary = record?.source_readiness_summary || {};
        const hosts = [...new Set(sourceUrls.map(getSourceHost).filter(Boolean))];
        const officialSourceUrls = sourceUrls.filter(isOfficialSourceUrl);
        const secSourceUrls = sourceUrls.filter(url => /(^|\.)sec\.gov$/i.test(getSourceHost(url)) || /data\.sec\.gov/i.test(getSourceHost(url)));
        const captureAge = getDateAgeDays(record?.capture_date);
        const staleWarnings = [];
        if (captureAge !== null && captureAge > 365) staleWarnings.push('candidate_identity_source_stale');
        if (!sourceUrls.length) staleWarnings.push('missing_source_urls');
        const hasOfficialSource = Boolean(summary.has_official_listing_source || officialSourceUrls.length);
        const hasSecIdentity = Boolean(record?.cik || summary.has_sec_submission_source || secSourceUrls.length);
        const diversityScore = Math.min(10, hosts.length * 4 + Math.max(0, sourceUrls.length - hosts.length) * 1.5);

        return {
            sourceUrls,
            hosts,
            hostCount: hosts.length,
            sourceUrlCount: sourceUrls.length,
            officialSourceCount: officialSourceUrls.length,
            secSourceCount: secSourceUrls.length,
            hasOfficialSource,
            hasSecIdentity,
            hasCik: Boolean(record?.cik),
            diversityScore,
            sourceLifecycleState: summary.source_lifecycle_state || 'review_source_pending',
            staleWarnings,
            weakSource: !hasOfficialSource || !hasSecIdentity || sourceUrls.length < 2,
            reviewOnly: true,
            promotionAuthority: false
        };
    }

    function getSourceHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
        } catch (error) {
            return '';
        }
    }

    function isOfficialSourceUrl(url) {
        const host = getSourceHost(url);
        const path = (() => {
            try {
                const parsed = new URL(url);
                return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
            } catch (error) {
                return String(url || '').toLowerCase();
            }
        })();
        return /(^|\.)sec\.gov$/i.test(host) ||
            /(investor|investors|ir\.|\/ir\/|sec-filings|annual-report|company_tickers_exchange|data\.sec\.gov|submissions)/i.test(path);
    }

    function getDateAgeDays(value) {
        const text = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
        const date = new Date(`${text}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return null;
        return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    }

    function getDuplicateStatus(record, productionTickerSet) {
        const ticker = normalizeTicker(record?.ticker);
        const aliasWarnings = safeArray(record?.alias_conflict_warnings);
        const duplicateWithProduction = Boolean(
            record?.duplicate_ticker_warning ||
            (ticker && productionTickerSet?.has?.(ticker))
        );
        return {
            duplicateWithProduction,
            aliasConflictCount: aliasWarnings.length,
            aliasWarnings,
            duplicateClear: !duplicateWithProduction && !aliasWarnings.length
        };
    }

    function getSafetyBlockers(record, source, duplicateStatus) {
        const blockers = new Set(safeArray(record?.blockers).map(normalizeKey).filter(Boolean));
        if (!source.hasOfficialSource) blockers.add('missing_official_source');
        if (!source.hasSecIdentity) blockers.add('missing_sec_identity');
        if (duplicateStatus.duplicateWithProduction) blockers.add('duplicate_ticker_conflict');
        if (duplicateStatus.aliasConflictCount) blockers.add('alias_conflict_review');
        if (!getAssignmentKeys(record, 'ecosystem_assignments', 'ecosystem_key').length) blockers.add('ecosystem_assignment_missing');
        if (!getAssignmentKeys(record, 'corridor_assignments', 'corridor_key').length) blockers.add('corridor_assignment_missing');
        if (!getAnchorTickers(record).length) blockers.add('preview_anchor_missing');
        if (record?.production_write_allowed === true) blockers.add('unsafe_production_write_flag');
        if (record?.auto_promotion_allowed === true) blockers.add('unsafe_auto_promotion_flag');
        if (record?.relationship_authority === true || record?.ecosystem_membership_authority === true) blockers.add('unsafe_authority_flag');
        return [...blockers].sort();
    }

    function getReviewerDecisionState(record, safetyBlockers = []) {
        if (safetyBlockers.some(key => [
            'duplicate_ticker_conflict',
            'alias_conflict_review',
            'unsafe_production_write_flag',
            'unsafe_auto_promotion_flag',
            'unsafe_authority_flag'
        ].includes(key))) {
            return REVIEWER_DECISION_STATES.blocked;
        }

        const raw = [
            record?.reviewer_decision_state,
            record?.reviewer_state,
            record?.promotion_reviewer_state,
            record?.promotion_decision_state,
            record?.review_status,
            record?.readiness_state
        ].map(normalizeKey).find(Boolean) || 'pending_preview';
        const key = REVIEWER_DECISION_STATES[raw]
            ? raw
            : REVIEWER_DECISION_ALIASES[raw] || 'pending_preview';

        return REVIEWER_DECISION_STATES[key] || REVIEWER_DECISION_STATES.pending_preview;
    }

    function scoreStrategicHub(record, source) {
        const hub = record?.strategic_hub_preview || {};
        const corridorCentrality = normalizeScore(hub.corridor_centrality_score, 20);
        const ecosystemBreadth = normalizeScore(hub.ecosystem_breadth_score, 20);
        const bridgeSignificance = normalizeScore(hub.bridge_significance_score, 20);
        const sourceBacked = source.hasOfficialSource && source.hasSecIdentity
            ? normalizeScore(hub.source_backed_context_score || 2, 5)
            : normalizeScore(hub.source_backed_context_score || 0, 5) * 0.5;
        const stagedScore = Math.round(
            corridorCentrality * 0.28 +
            ecosystemBreadth * 0.22 +
            bridgeSignificance * 0.32 +
            sourceBacked * 0.18
        );
        return {
            score: clamp(stagedScore, 0, 100),
            stagedHubScore: Number(hub.staged_hub_score || 0),
            strategicHubCandidate: Boolean(hub.strategic_hub_candidate),
            corridorCentrality,
            ecosystemBreadth,
            bridgeSignificance,
            sourceBackedConfidence: sourceBacked,
            reviewOnly: true
        };
    }

    function normalizeScore(value, expectedMax) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return 0;
        if (numeric <= 1) return clamp(Math.round(numeric * 100), 0, 100);
        return clamp(Math.round((numeric / expectedMax) * 100), 0, 100);
    }

    function scoreProductionReadiness(record, context) {
        const { source, duplicateStatus, strategicHub, decisionState, safetyBlockers } = context;
        const ecosystemCount = getAssignmentKeys(record, 'ecosystem_assignments', 'ecosystem_key').length;
        const corridorCount = getAssignmentKeys(record, 'corridor_assignments', 'corridor_key').length;
        const anchorCount = getAnchorTickers(record).length;
        const reviewCompleteness = getReviewCompletenessScore(record, decisionState);
        const factors = [
            {
                key: 'official_source_availability',
                label: 'Official source availability',
                points: source.hasOfficialSource ? 15 : 0,
                max: 15,
                satisfied: source.hasOfficialSource
            },
            {
                key: 'sec_identity_support',
                label: 'SEC identity support',
                points: source.hasSecIdentity ? 14 : 0,
                max: 14,
                satisfied: source.hasSecIdentity
            },
            {
                key: 'duplicate_conflict_status',
                label: 'Duplicate conflict status',
                points: duplicateStatus.duplicateClear ? 14 : 0,
                max: 14,
                satisfied: duplicateStatus.duplicateClear
            },
            {
                key: 'corridor_usefulness',
                label: 'Corridor usefulness',
                points: Math.min(12, corridorCount * 5 + Math.min(2, anchorCount)),
                max: 12,
                satisfied: corridorCount > 0
            },
            {
                key: 'ecosystem_usefulness',
                label: 'Ecosystem usefulness',
                points: Math.min(10, ecosystemCount * 5),
                max: 10,
                satisfied: ecosystemCount > 0
            },
            {
                key: 'strategic_hub_score',
                label: 'Strategic hub score',
                points: Math.min(14, Math.round(strategicHub.score * 0.14)),
                max: 14,
                satisfied: strategicHub.score >= 42 || strategicHub.strategicHubCandidate
            },
            {
                key: 'source_diversity',
                label: 'Source diversity',
                points: Math.round(source.diversityScore),
                max: 10,
                satisfied: source.hostCount > 0
            },
            {
                key: 'review_completeness',
                label: 'Review completeness',
                points: reviewCompleteness,
                max: 11,
                satisfied: reviewCompleteness >= 8
            }
        ];
        let score = factors.reduce((sum, factor) => sum + clamp(Number(factor.points) || 0, 0, factor.max), 0);
        if (safetyBlockers.length) score = Math.min(score, safetyBlockers.includes('missing_official_source') ? 58 : 72);
        if (!duplicateStatus.duplicateClear) score = Math.min(score, 52);
        const inputReady = score >= 80 && !safetyBlockers.length;
        const productionCandidateReady = inputReady && ['approved_for_promotion_review', 'production_candidate'].includes(decisionState.key);
        return {
            score: clamp(Math.round(score), 0, 100),
            label: getReadinessLabel(score, inputReady, safetyBlockers),
            factors,
            inputReady,
            productionCandidateReady,
            scoreIsConfidence: false,
            deterministic: true,
            reviewVisible: true,
            automaticPromotionAllowed: false
        };
    }

    function getReviewCompletenessScore(record, decisionState) {
        let score = 0;
        if (record?.expansion_rationale) score += 2;
        if (record?.sector_proposal && record?.industry_group_proposal) score += 2;
        if (getAssignmentKeys(record, 'ecosystem_assignments', 'ecosystem_key').length) score += 2;
        if (getAssignmentKeys(record, 'corridor_assignments', 'corridor_key').length) score += 2;
        if (record?.readiness_state === 'ready_for_preview') score += 1;
        if (decisionState.key !== 'pending_preview') score += 2;
        return Math.min(11, score);
    }

    function getReadinessLabel(score, inputReady, blockers) {
        if (blockers.length) return 'Blocked by safety gates';
        if (inputReady) return 'Input-ready for reviewer promotion review';
        if (score >= 70) return 'High-readiness preview candidate';
        if (score >= 55) return 'Needs review completion';
        return 'Needs source or assignment enrichment';
    }

    function getReviewGates(record, readiness, decisionState) {
        const gates = [];
        if (decisionState.key === 'pending_preview') gates.push('reviewer_preview_decision_pending');
        if (decisionState.key === 'approved_for_preview') gates.push('promotion_review_approval_pending');
        if (readiness.inputReady && !readiness.productionCandidateReady) gates.push('manual_promotion_review_not_approved');
        if (record?.manual_promotion_required !== false) gates.push('manual_promotion_required');
        gates.push('production_validation_required');
        return [...new Set(gates)];
    }

    function getNextDecision(record, decisionState, readiness, safetyBlockers) {
        if (decisionState.key === 'blocked' || safetyBlockers.length) return REVIEWER_DECISION_STATES.blocked;
        if (decisionState.key === 'enrichment_only') return REVIEWER_DECISION_STATES.enrichment_only;
        if (decisionState.key === 'deferred') return REVIEWER_DECISION_STATES.deferred;
        if (!readiness.inputReady && readiness.score < 70) return REVIEWER_DECISION_STATES.enrichment_only;
        const currentIndex = REVIEWER_DECISION_SEQUENCE.indexOf(decisionState.key);
        const nextKey = REVIEWER_DECISION_SEQUENCE[Math.min(REVIEWER_DECISION_SEQUENCE.length - 1, Math.max(0, currentIndex) + 1)];
        return REVIEWER_DECISION_STATES[nextKey] || REVIEWER_DECISION_STATES.pending_preview;
    }

    function getDecisionPath(stateKey) {
        const activeIndex = REVIEWER_DECISION_SEQUENCE.indexOf(stateKey);
        if (activeIndex < 0) return [REVIEWER_DECISION_STATES[stateKey] || REVIEWER_DECISION_STATES.pending_preview];
        return REVIEWER_DECISION_SEQUENCE.map((key, index) => ({
            ...REVIEWER_DECISION_STATES[key],
            complete: index <= activeIndex,
            active: key === stateKey
        }));
    }

    function getBatchIds(record) {
        return safeArray(record?.expansion_batch_ids)
            .map(value => String(value || '').trim())
            .filter(Boolean);
    }

    function getAssignmentKeys(record, fieldName, keyName) {
        return safeArray(record?.[fieldName])
            .map(row => String(row?.[keyName] || '').trim())
            .filter(Boolean);
    }

    function getAnchorTickers(record) {
        return safeArray(record?.preview?.preview_anchor_tickers)
            .map(normalizeTicker)
            .filter(Boolean);
    }

    function buildPlannerSummary(records, batches) {
        return {
            candidateCount: records.length,
            batchCount: batches.length,
            inputReadyCount: records.filter(row => row.readiness.inputReady).length,
            approvedPromotionReviewCount: records.filter(row => row.decisionState.key === 'approved_for_promotion_review').length,
            productionCandidateCount: records.filter(row => row.readiness.productionCandidateReady).length,
            blockedCount: records.filter(row => row.decisionState.key === 'blocked' || row.blockers.length).length,
            enrichmentOnlyCount: records.filter(row => row.decisionState.key === 'enrichment_only').length,
            deferredCount: records.filter(row => row.decisionState.key === 'deferred').length,
            averageReadinessScore: average(records.map(row => row.readiness.score)),
            averageHubScore: average(records.map(row => row.strategicHub.score)),
            reviewOnly: true,
            automaticPromotionAllowed: false
        };
    }

    function buildBatchPlanningRows(records, batches) {
        const batchMap = new Map();
        batches.forEach(batch => {
            const key = String(batch?.batch_id || batch?.label || '').trim();
            if (!key) return;
            batchMap.set(key, {
                batch,
                batchId: key,
                label: batch?.label || formatKeyLabel(key),
                records: []
            });
        });
        records.forEach(row => {
            const batchId = row.primaryBatchId || 'unbatched_review';
            if (!batchMap.has(batchId)) {
                batchMap.set(batchId, {
                    batch: null,
                    batchId,
                    label: formatKeyLabel(batchId),
                    records: []
                });
            }
            batchMap.get(batchId).records.push(row);
        });
        return [...batchMap.values()].map(row => {
            const recordsForBatch = row.records;
            const simulation = buildPromotionSimulation(recordsForBatch.filter(item => item.readiness.inputReady), {
                productionCompanies: [],
                productionConnections: []
            });
            return {
                ...row,
                candidateCount: recordsForBatch.length,
                inputReadyCount: recordsForBatch.filter(item => item.readiness.inputReady).length,
                blockedCount: recordsForBatch.filter(item => item.blockers.length || item.decisionState.key === 'blocked').length,
                approvalNeededCount: recordsForBatch.filter(item => item.readiness.inputReady && !item.readiness.productionCandidateReady).length,
                officialSourceCount: recordsForBatch.filter(item => item.source.hasOfficialSource).length,
                secIdentityCount: recordsForBatch.filter(item => item.source.hasSecIdentity).length,
                averageReadinessScore: average(recordsForBatch.map(item => item.readiness.score)),
                averageHubScore: average(recordsForBatch.map(item => item.strategicHub.score)),
                strongestCandidates: recordsForBatch.slice().sort(sortByReadiness).slice(0, 4),
                weakestCandidates: recordsForBatch.slice().sort((a, b) => a.readiness.score - b.readiness.score || a.ticker.localeCompare(b.ticker)).slice(0, 3),
                topBlockers: countBy(recordsForBatch.flatMap(item => item.blockers)).slice(0, 5),
                ecosystemKeys: [...new Set(recordsForBatch.flatMap(item => item.ecosystemKeys))],
                corridorKeys: [...new Set(recordsForBatch.flatMap(item => item.corridorKeys))],
                simulation
            };
        }).sort((a, b) =>
            b.inputReadyCount - a.inputReadyCount ||
            b.averageReadinessScore - a.averageReadinessScore ||
            a.label.localeCompare(b.label)
        );
    }

    function buildPromotionSimulation(records, context = {}) {
        const productionNodeCount = safeArray(context.productionCompanies).length;
        const productionEdgeCount = safeArray(context.productionConnections).length;
        const stagedNodeCount = records.length;
        const previewAnchorEdgeCount = records.reduce((sum, row) => sum + row.previewAnchorCount, 0);
        const projectedNodeCount = productionNodeCount + stagedNodeCount;
        const projectedEdgeCount = productionEdgeCount;
        const previewEdgeCount = productionEdgeCount + previewAnchorEdgeCount;
        const graphScaling = context.graphScalingTools || window.StockPhotonicStock?.graphScaling;
        const density = graphScaling?.buildGrowthForecast
            ? graphScaling.buildGrowthForecast({
                currentNodeCount: productionNodeCount,
                currentEdgeCount: productionEdgeCount,
                stagedNodeCount,
                previewAnchorEdgeCount
            })
            : buildFallbackGrowthForecast(productionNodeCount, productionEdgeCount, stagedNodeCount, previewAnchorEdgeCount);
        const ecosystemCounts = countBy(records.flatMap(row => row.ecosystemKeys));
        const corridorCounts = countBy(records.flatMap(row => row.corridorKeys));
        const strategicHubCount = records.filter(row => row.strategicHub.strategicHubCandidate).length;
        const hubInflationRisk = getHubInflationRisk(strategicHubCount, stagedNodeCount);
        return {
            productionNodeCount,
            productionEdgeCount,
            stagedNodeCount,
            projectedNodeCount,
            projectedEdgeCount,
            previewAnchorEdgeCount,
            previewEdgeCount,
            projectedEdgeDensity: roundRatio(projectedEdgeCount / Math.max(1, projectedNodeCount)),
            previewAnchorDensity: roundRatio(previewAnchorEdgeCount / Math.max(1, stagedNodeCount)),
            corridorCounts,
            ecosystemCounts,
            topCorridorImpacts: corridorCounts.slice(0, 6),
            topEcosystemImpacts: ecosystemCounts.slice(0, 6),
            strategicHubCount,
            averageReadinessScore: average(records.map(row => row.readiness.score)),
            averageHubScore: average(records.map(row => row.strategicHub.score)),
            hubInflationRisk,
            density,
            overlayReadability: getOverlayReadability(density, ecosystemCounts.length, corridorCounts.length),
            routeComplexity: getRouteComplexity(density),
            labelPressure: density.labelPressure,
            mobileSafety: density.mobileSafety,
            simulationOnly: true,
            productionMutation: false,
            relationshipCreation: false
        };
    }

    function buildFallbackGrowthForecast(currentNodeCount, currentEdgeCount, stagedNodeCount, previewAnchorEdgeCount) {
        const projectedNodeCount = currentNodeCount + stagedNodeCount;
        const previewEdgeCount = currentEdgeCount + previewAnchorEdgeCount;
        const ratio = previewEdgeCount / Math.max(1, projectedNodeCount);
        const densityKey = projectedNodeCount > 160 || previewEdgeCount > 360 || ratio > 3.15
            ? 'very_dense'
            : projectedNodeCount > 100 || previewEdgeCount > 210 || ratio > 2.25
                ? 'dense'
                : projectedNodeCount > 70 || previewEdgeCount > 125 || ratio > 1.7
                    ? 'growth'
                    : 'core';
        const labelLimit = densityKey === 'very_dense' ? 18 : densityKey === 'dense' ? 24 : densityKey === 'growth' ? 30 : 42;
        return {
            density: {
                key: densityKey,
                label: formatKeyLabel(densityKey),
                nodeCount: projectedNodeCount,
                edgeCount: previewEdgeCount,
                ratio
            },
            recommendedLabelLimit: labelLimit,
            labelPressure: getLabelPressure(projectedNodeCount, labelLimit),
            mobileSafety: getMobileSafety(projectedNodeCount, previewEdgeCount),
            previewEdgeCount,
            projectedNodeCount
        };
    }

    function getHubInflationRisk(hubCount, stagedNodeCount) {
        if (!stagedNodeCount) return 'none';
        const ratio = hubCount / stagedNodeCount;
        if (hubCount > 18 || ratio > 0.34) return 'high';
        if (hubCount > 10 || ratio > 0.22) return 'moderate';
        return 'low';
    }

    function getOverlayReadability(density, ecosystemCount, corridorCount) {
        const key = density?.density?.key || density?.key || 'core';
        if (key === 'very_dense' || ecosystemCount > 8 || corridorCount > 8) return 'tight';
        if (key === 'dense' || ecosystemCount > 5 || corridorCount > 5) return 'watch';
        return 'safe';
    }

    function getRouteComplexity(density) {
        const ratio = Number(density?.density?.ratio ?? density?.ratio ?? 0);
        if (ratio > 3.1) return 'very high';
        if (ratio > 2.2) return 'high';
        if (ratio > 1.65) return 'moderate';
        return 'normal';
    }

    function getLabelPressure(nodeCount, labelLimit) {
        const ratio = nodeCount / Math.max(1, labelLimit);
        if (ratio > 7) return 'very high';
        if (ratio > 4.5) return 'high';
        if (ratio > 2.8) return 'moderate';
        return 'low';
    }

    function getMobileSafety(nodeCount, edgeCount) {
        const ratio = edgeCount / Math.max(1, nodeCount);
        if (nodeCount > 150 || edgeCount > 330 || ratio > 3) return 'tight';
        if (nodeCount > 105 || edgeCount > 220 || ratio > 2.2) return 'watch';
        return 'safe';
    }

    function buildSourceSummary(records) {
        const sourceHostCounts = countBy(records.flatMap(row => row.source.hosts));
        return {
            officialSourceCount: records.filter(row => row.source.hasOfficialSource).length,
            secIdentityCount: records.filter(row => row.source.hasSecIdentity).length,
            weakSourceCount: records.filter(row => row.source.weakSource).length,
            staleSourceWarningCount: records.filter(row => row.source.staleWarnings.length).length,
            weakSourceWarnings: records.filter(row => row.source.weakSource).slice(0, 12),
            staleSourceWarnings: records.filter(row => row.source.staleWarnings.length).slice(0, 12),
            strongestOfficialSourceCandidates: records
                .filter(row => row.source.hasOfficialSource && row.source.hasSecIdentity)
                .sort(sortByReadiness)
                .slice(0, 12),
            duplicateRootWarnings: sourceHostCounts
                .filter(([host, count]) => count > 3 && !/(^|\.)sec\.gov$/i.test(host))
                .slice(0, 8),
            sourceHostCounts: sourceHostCounts.slice(0, 12)
        };
    }

    function buildLifecycleSummary(records) {
        return {
            decisionCounts: countBy(records.map(row => row.decisionState.key)),
            nextDecisionCounts: countBy(records.map(row => row.nextDecision.key)),
            inputReadyAwaitingReview: records.filter(row => row.readiness.inputReady && !row.readiness.productionCandidateReady).length,
            productionCandidateReady: records.filter(row => row.readiness.productionCandidateReady).length,
            workflowStates: Object.values(REVIEWER_DECISION_STATES)
        };
    }

    function buildBlockerSummary(records) {
        return {
            blockerCounts: countBy(records.flatMap(row => row.blockers)),
            reviewGateCounts: countBy(records.flatMap(row => row.reviewGates)),
            blockedRecords: records.filter(row => row.blockers.length || row.decisionState.key === 'blocked').slice(0, 16)
        };
    }

    function sortByReadiness(a, b) {
        return b.readiness.score - a.readiness.score ||
            b.strategicHub.score - a.strategicHub.score ||
            a.ticker.localeCompare(b.ticker);
    }

    function countBy(values) {
        const counts = new Map();
        safeArray(values).forEach(value => {
            const key = String(value || '').trim();
            if (!key) return;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function average(values) {
        const numbers = safeArray(values).map(Number).filter(Number.isFinite);
        if (!numbers.length) return 0;
        return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
    }

    function dedupeByKey(rows, getKey) {
        const map = new Map();
        safeArray(rows).forEach(row => {
            const key = String(getKey(row) || '').trim();
            if (key && !map.has(key)) map.set(key, row);
        });
        return [...map.values()];
    }

    function roundRatio(value) {
        return Math.round((Number(value) || 0) * 1000) / 1000;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    }

    window.StockPhotonicStock.promotionPlanner = {
        REVIEWER_DECISION_STATES,
        REVIEWER_DECISION_STATE_LIST: Object.values(REVIEWER_DECISION_STATES),
        REVIEWER_DECISION_SEQUENCE,
        buildPlannerModel,
        buildCandidatePlanRecord,
        buildPromotionSimulation,
        buildSourceReadiness,
        scoreStrategicHub,
        scoreProductionReadiness,
        getCandidateCompanySourceUrls,
        getReviewerDecisionState,
        getDecisionPath,
        formatKeyLabel
    };
})();
