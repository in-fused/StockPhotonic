(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const TIERS = {
        verified: {
            key: 'verified',
            label: 'Verified',
            shortLabel: 'VERIFIED',
            graphLabel: 'Verified',
            rank: 4,
            color: '#7cffc8',
            description: 'SEC, official company, or strong source-backed production evidence.'
        },
        strong_inferred: {
            key: 'strong_inferred',
            label: 'Strong inferred',
            shortLabel: 'STRONG',
            graphLabel: 'Strong inferred',
            rank: 3,
            color: '#7dd3fc',
            description: 'Obvious public ecosystem or competitive relationship from stable metadata. Visibility label only, not official proof.'
        },
        context_only: {
            key: 'context_only',
            label: 'Context only',
            shortLabel: 'CONTEXT',
            graphLabel: 'Context only',
            rank: 2,
            color: '#c4b5fd',
            description: 'Research, OpenAlex, topic, overlap, or weak ecosystem context. Not relationship proof.'
        },
        needs_review: {
            key: 'needs_review',
            label: 'Needs review',
            shortLabel: 'REVIEW',
            graphLabel: 'Needs review',
            rank: 1,
            color: '#fb923c',
            description: 'Ambiguous, candidate-only, weak, conflicting, or unresolved relationship signal.'
        }
    };

    const REVIEWER_DECISION_STATES = {
        accepted_for_visibility: {
            key: 'accepted_for_visibility',
            label: 'Accepted for visibility',
            shortLabel: 'VISIBLE',
            description: 'Safe to show in the graph with its tier label; does not authorize production promotion.'
        },
        accepted_for_review: {
            key: 'accepted_for_review',
            label: 'Accepted for review',
            shortLabel: 'REVIEW',
            description: 'Review queue item; no automatic promotion.'
        },
        pending_preview: {
            key: 'pending_preview',
            label: 'Pending preview',
            shortLabel: 'PENDING',
            description: 'Reviewer has not approved preview progression yet.'
        },
        approved_for_preview: {
            key: 'approved_for_preview',
            label: 'Approved for preview',
            shortLabel: 'PREVIEW',
            description: 'Reviewer approved preview visibility only; no production write is authorized.'
        },
        approved_for_promotion_review: {
            key: 'approved_for_promotion_review',
            label: 'Approved for promotion review',
            shortLabel: 'PROMO REVIEW',
            description: 'Reviewer approved deeper manual promotion review; promotion remains explicit and validated.'
        },
        blocked: {
            key: 'blocked',
            label: 'Blocked',
            shortLabel: 'BLOCKED',
            description: 'Cannot move forward without resolving missing or conflicting inputs.'
        },
        weak_signal: {
            key: 'weak_signal',
            label: 'Weak signal',
            shortLabel: 'WEAK',
            description: 'Visible only as weak context until stronger evidence is attached.'
        },
        enrichment_only: {
            key: 'enrichment_only',
            label: 'Enrichment only',
            shortLabel: 'ENRICH',
            description: 'Can guide research, but cannot prove or promote a relationship.'
        },
        ready_for_promotion_review: {
            key: 'ready_for_promotion_review',
            label: 'Ready for promotion review',
            shortLabel: 'PROMO REVIEW',
            description: 'Candidate has stronger inputs but still requires manual preview, promotion, and validation.'
        },
        production_candidate: {
            key: 'production_candidate',
            label: 'Production candidate',
            shortLabel: 'PROD CAND',
            description: 'Reviewer marked the record for manual promotion tooling and validation; no automatic write is authorized.'
        },
        deferred: {
            key: 'deferred',
            label: 'Deferred',
            shortLabel: 'DEFER',
            description: 'Reviewer postponed the record without promotion authority.'
        }
    };

    const TRUSTED_RELATIONSHIP_CLASSES = {
        competitor: {
            key: 'competitor',
            label: 'Competitor',
            shortLabel: 'COMP',
            safeFastTrack: true,
            minimumConfidence: 3,
            minimumStrength: 0.62,
            keywords: ['competitor', 'competition', 'competes', 'peer', 'rival', 'market structure', 'direct peer']
        },
        ecosystem_overlap: {
            key: 'ecosystem_overlap',
            label: 'Ecosystem overlap',
            shortLabel: 'ECO',
            safeFastTrack: true,
            minimumConfidence: 4,
            minimumStrength: 0.72,
            keywords: ['ecosystem', 'overlap', 'market structure', 'same market', 'shared market', 'platform exposure']
        },
        supplier_ecosystem: {
            key: 'supplier_ecosystem',
            label: 'Supplier ecosystem',
            shortLabel: 'SUP ECO',
            safeFastTrack: false,
            minimumConfidence: 4,
            minimumStrength: 0.78,
            keywords: ['supplier', 'supply', 'customer', 'vendor', 'dependency', 'supply chain']
        },
        cloud_hyperscaler_exposure: {
            key: 'cloud_hyperscaler_exposure',
            label: 'Cloud / hyperscaler exposure',
            shortLabel: 'CLOUD',
            safeFastTrack: true,
            minimumConfidence: 4,
            minimumStrength: 0.70,
            keywords: ['aws', 'azure', 'google cloud', 'gcp', 'oci', 'oracle cloud', 'cloud', 'hyperscaler', 'data center', 'cloud ai']
        },
        semiconductor_supply_chain: {
            key: 'semiconductor_supply_chain',
            label: 'Semiconductor supply chain',
            shortLabel: 'SEMI',
            safeFastTrack: true,
            minimumConfidence: 4,
            minimumStrength: 0.70,
            keywords: ['semiconductor', 'foundry', 'hbm', 'memory', 'lithography', 'wafer', 'fab', 'accelerator', 'gpu', 'chip']
        },
        financial_infrastructure_overlap: {
            key: 'financial_infrastructure_overlap',
            label: 'Financial infrastructure overlap',
            shortLabel: 'FIN',
            safeFastTrack: true,
            minimumConfidence: 4,
            minimumStrength: 0.68,
            keywords: ['payment', 'payments', 'card', 'issuer', 'acquirer', 'bank', 'exchange', 'asset manager', 'capital markets', 'financial infrastructure']
        }
    };

    const TRUSTED_CLASS_LIST = Object.values(TRUSTED_RELATIONSHIP_CLASSES);

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function normalizeKey(value) {
        return normalizeText(value).replace(/[\s-]+/g, '_');
    }

    function hasAnyKeyword(text, keywords) {
        return keywords.some(keyword => text.includes(keyword));
    }

    function getValidSourceUrls(record) {
        const candidate = record?.candidate || {};
        const values = [
            ...(Array.isArray(record?.source_urls) ? record.source_urls : []),
            ...(Array.isArray(candidate.source_urls) ? candidate.source_urls : []),
            record?.source_url,
            record?.filing_url,
            record?.sec_url,
            record?.url,
            candidate.archive_url,
            candidate.source_url,
            candidate.filing_url,
            candidate.sec_url
        ];
        return [...new Set(values.map(url => String(url || '').trim()).filter(url => /^https?:\/\//i.test(url)))];
    }

    function getSourceHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
        } catch (error) {
            return '';
        }
    }

    function getSourcePath(url) {
        try {
            const parsed = new URL(url);
            return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
        } catch (error) {
            return String(url || '').toLowerCase();
        }
    }

    function getConfidenceScore(record) {
        const raw = Number(record?.confidence_score ?? record?.confidence ?? record?.confidence_hint ?? record?.candidate?.confidence_hint);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        return raw <= 1 ? Math.round(raw * 5) : Math.max(1, Math.min(5, Math.round(raw)));
    }

    function getStrengthScore(record) {
        const raw = Number(record?.strength);
        return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    }

    function isCandidateRecord(record) {
        const state = normalizeText(record?.source_status || record?.review_status || record?.candidate?.review_status);
        return Boolean(
            record?.isSecPreviewLink ||
            record?.is_candidate_preview ||
            record?.candidate ||
            state.includes('candidate') ||
            state.includes('pending_review')
        );
    }

    function isOpenAlexContext(record) {
        const tags = Array.isArray(record?.evidence_tags) ? record.evidence_tags.join(' ') : '';
        const text = [
            record?.source,
            record?.source_type,
            record?.provider,
            record?.origin,
            record?.provenance,
            record?.relationship_type,
            record?.type,
            tags
        ].map(normalizeText).join(' ');
        return text.includes('openalex');
    }

    function isSecBacked(record) {
        const text = getRelationshipText(record);
        return text.includes('sec filing') || getValidSourceUrls(record).some(url => /(\.|^)sec\.gov$/i.test(getSourceHost(url)));
    }

    function hasOfficialSource(record) {
        const sourceReview = window.StockPhotonicStock?.sourceReview;
        const categories = sourceReview?.getSourceHostDiversity?.(record)?.categoryKeys || [];
        if (categories.some(key => ['sec_source', 'official_company_ir', 'official_partner_customer_page'].includes(key))) {
            return true;
        }

        return getValidSourceUrls(record).some(url => {
            const host = getSourceHost(url);
            const path = getSourcePath(url);
            return /(\.|^)sec\.gov$/i.test(host) ||
                /(investor|investors|ir\.|\/ir\/|shareholder|sec-filings|annual-report|quarterly-results|news-releases|partner|partners|customer|customers|case-study|press|collaboration|alliance)/i.test(path);
        });
    }

    function getEvidenceCount(record) {
        const sourceCount = getValidSourceUrls(record).length;
        const snippetCount = record?.evidence_snippet || record?.candidate?.evidence_snippet ? 1 : 0;
        const sourceLabelCount = record?.source_label || record?.provenance ? 1 : 0;
        return sourceCount + snippetCount + sourceLabelCount;
    }

    function getEndpointText(endpoint) {
        if (!endpoint || typeof endpoint !== 'object') return '';
        return [
            endpoint.ticker,
            endpoint.name,
            endpoint.sector,
            endpoint.industry,
            endpoint.industryGroup
        ].map(normalizeText).filter(Boolean).join(' ');
    }

    function getRelationshipText(record) {
        const candidate = record?.candidate || {};
        return [
            record?.relationship_type,
            record?.type,
            record?.raw_type,
            record?.label,
            record?.relationship_summary,
            record?.provenance,
            record?.source_label,
            record?.evidence_snippet,
            candidate.relationship_type,
            candidate.evidence_snippet,
            candidate.source,
            candidate.review_status,
            getEndpointText(record?.source),
            getEndpointText(record?.target)
        ].map(normalizeText).filter(Boolean).join(' ');
    }

    function getTrustedRelationshipClass(record) {
        const text = getRelationshipText(record);
        const rawType = normalizeKey(record?.relationship_type || record?.type || record?.candidate?.relationship_type);
        const endpointText = `${getEndpointText(record?.source)} ${getEndpointText(record?.target)}`;

        if (rawType.includes('competitor') || rawType.includes('competition') || rawType.includes('peer') || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.competitor.keywords)) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.competitor, 'relationship type or label indicates peer competition');
        }
        if (rawType.includes('hyperscaler') || rawType.includes('cloud') || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.cloud_hyperscaler_exposure.keywords) || endpointText.includes('cloud / big tech')) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.cloud_hyperscaler_exposure, 'metadata fits cloud or hyperscaler ecosystem exposure');
        }
        if (rawType.includes('semiconductor') || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.semiconductor_supply_chain.keywords) || endpointText.includes('ai / semiconductors')) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.semiconductor_supply_chain, 'metadata fits semiconductor ecosystem context');
        }
        if (rawType.includes('ownership') || rawType.includes('capital') || rawType.includes('financial') || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.financial_infrastructure_overlap.keywords) || endpointText.includes('payments / financial infrastructure')) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.financial_infrastructure_overlap, 'metadata fits financial infrastructure or payment-network overlap');
        }
        if (rawType.includes('supplier') || rawType.includes('customer') || rawType === 'supply' || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.supplier_ecosystem.keywords)) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.supplier_ecosystem, 'metadata indicates supplier or customer ecosystem context');
        }
        if (rawType.includes('ecosystem') || hasAnyKeyword(text, TRUSTED_RELATIONSHIP_CLASSES.ecosystem_overlap.keywords)) {
            return buildClassResult(TRUSTED_RELATIONSHIP_CLASSES.ecosystem_overlap, 'metadata indicates ecosystem overlap');
        }
        return null;
    }

    function buildClassResult(definition, reason) {
        return {
            ...definition,
            reason
        };
    }

    function isStrongInferredEligible(record, trustedClass) {
        if (!trustedClass?.safeFastTrack || isCandidateRecord(record) || isOpenAlexContext(record)) return false;
        if (hasOfficialSource(record)) return false;

        const confidence = getConfidenceScore(record) || 0;
        const strength = getStrengthScore(record);
        return confidence >= trustedClass.minimumConfidence || strength >= trustedClass.minimumStrength;
    }

    function hasUnresolvedCandidateEndpoint(record) {
        if (!isCandidateRecord(record)) return false;
        const candidate = record?.candidate || record || {};
        return !String(candidate.source_ticker || record?.sourceTicker || '').trim() ||
            !String(candidate.target_ticker || record?.targetTicker || '').trim();
    }

    function getEvidencePolicy(record, options = {}) {
        const trustedClass = getTrustedRelationshipClass(record);
        const confidenceScore = getConfidenceScore(record);
        const sourceUrls = getValidSourceUrls(record);
        const evidenceCount = Number(options.evidenceCount ?? record?.evidence_count ?? getEvidenceCount(record)) || 0;
        const candidate = isCandidateRecord(record);
        const openAlex = isOpenAlexContext(record);
        const official = hasOfficialSource(record);
        const secBacked = isSecBacked(record);
        const strongInferred = isStrongInferredEligible(record, trustedClass);
        const hasSource = sourceUrls.length > 0;
        const unresolved = hasUnresolvedCandidateEndpoint(record);

        let tier = TIERS.needs_review;
        let decisionState = REVIEWER_DECISION_STATES.accepted_for_review;
        let explanation = 'Review required before this relationship can be treated as production-quality evidence.';

        if (openAlex) {
            tier = TIERS.context_only;
            decisionState = REVIEWER_DECISION_STATES.enrichment_only;
            explanation = 'Context-only OpenAlex enrichment. It can guide research but is not relationship proof.';
        } else if (candidate) {
            tier = TIERS.needs_review;
            decisionState = unresolved
                ? REVIEWER_DECISION_STATES.blocked
                : secBacked && hasSource && evidenceCount > 0 && (confidenceScore || 0) >= 4
                    ? REVIEWER_DECISION_STATES.ready_for_promotion_review
                    : REVIEWER_DECISION_STATES.accepted_for_review;
            explanation = decisionState.key === 'ready_for_promotion_review'
                ? 'SEC-backed candidate evidence is ready for manual promotion review; promotion is still manual.'
                : 'Candidate or preview evidence requires manual review before any production promotion.';
        } else if (official || secBacked || (hasSource && evidenceCount > 0 && (confidenceScore || 0) >= 4)) {
            tier = TIERS.verified;
            decisionState = REVIEWER_DECISION_STATES.accepted_for_visibility;
            explanation = secBacked
                ? 'Verified SEC-backed production relationship.'
                : 'Verified source-backed production relationship.';
        } else if (strongInferred) {
            tier = TIERS.strong_inferred;
            decisionState = REVIEWER_DECISION_STATES.accepted_for_visibility;
            explanation = `Strong inferred ${trustedClass.label.toLowerCase()} relationship. Safe for graph visibility, not official partnership proof.`;
        } else if (trustedClass || hasSource || evidenceCount > 0) {
            tier = TIERS.context_only;
            decisionState = trustedClass?.safeFastTrack
                ? REVIEWER_DECISION_STATES.weak_signal
                : REVIEWER_DECISION_STATES.accepted_for_review;
            explanation = trustedClass
                ? `Context-only ${trustedClass.label.toLowerCase()} signal; attach stronger sources before promotion claims.`
                : 'Context-only evidence signal; not enough for verified relationship status.';
        }

        return {
            tier,
            tierKey: tier.key,
            trustedClass,
            trustedClassKey: trustedClass?.key || '',
            trustedClassLabel: trustedClass?.label || '',
            reviewerDecisionState: decisionState,
            reviewerDecisionKey: decisionState.key,
            explanation,
            confidenceScore,
            evidenceCount,
            sourceCount: sourceUrls.length,
            officialSource: official,
            secBacked,
            openAlex,
            candidate,
            fastTrackVisibility: tier.key === TIERS.strong_inferred.key,
            manualPromotionAllowed: false,
            sourceUrls
        };
    }

    function getEvidenceTier(record, options = {}) {
        return getEvidencePolicy(record, options).tier;
    }

    function getReviewerDecisionState(record, options = {}) {
        return getEvidencePolicy(record, options).reviewerDecisionState;
    }

    function shouldReduceReviewPressure(record, options = {}) {
        const policy = getEvidencePolicy(record, options);
        return policy.tier.key === TIERS.strong_inferred.key &&
            policy.reviewerDecisionState.key === REVIEWER_DECISION_STATES.accepted_for_visibility.key;
    }

    function getEvidencePolicyTags(record, options = {}) {
        const policy = getEvidencePolicy(record, options);
        const tags = [
            policy.tier.shortLabel,
            policy.trustedClass?.shortLabel || '',
            policy.reviewerDecisionState.shortLabel
        ];
        if (policy.fastTrackVisibility) tags.push('FAST-TRACK VISIBLE');
        if (policy.openAlex) tags.push('OPENALEX CONTEXT');
        if (policy.candidate) tags.push('REVIEW ONLY');
        return [...new Set(tags.filter(Boolean))];
    }

    function summarizeEvidencePolicies(records) {
        const tierCounts = new Map();
        const trustedClassCounts = new Map();
        let fastTrackVisibilityCount = 0;
        let reviewRequiredCount = 0;

        (records || []).forEach(record => {
            const policy = getEvidencePolicy(record);
            tierCounts.set(policy.tier.key, (tierCounts.get(policy.tier.key) || 0) + 1);
            if (policy.trustedClassKey) {
                trustedClassCounts.set(policy.trustedClassKey, (trustedClassCounts.get(policy.trustedClassKey) || 0) + 1);
            }
            if (policy.fastTrackVisibility) fastTrackVisibilityCount += 1;
            if (policy.tier.key === TIERS.needs_review.key) reviewRequiredCount += 1;
        });

        return {
            total: (records || []).length,
            tierCounts: [...tierCounts.entries()].sort((a, b) => (TIERS[b[0]]?.rank || 0) - (TIERS[a[0]]?.rank || 0)),
            trustedClassCounts: [...trustedClassCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
            fastTrackVisibilityCount,
            reviewRequiredCount
        };
    }

    window.StockPhotonicStock.evidencePolicy = {
        TIERS,
        TIER_LIST: Object.values(TIERS).sort((a, b) => b.rank - a.rank),
        REVIEWER_DECISION_STATES,
        REVIEWER_DECISION_STATE_LIST: Object.values(REVIEWER_DECISION_STATES),
        TRUSTED_RELATIONSHIP_CLASSES,
        TRUSTED_CLASS_LIST,
        normalizeText,
        getValidSourceUrls,
        getConfidenceScore,
        getStrengthScore,
        getEvidenceCount,
        isCandidateRecord,
        isOpenAlexContext,
        isSecBacked,
        hasOfficialSource,
        getRelationshipText,
        getTrustedRelationshipClass,
        getEvidencePolicy,
        getEvidenceTier,
        getReviewerDecisionState,
        shouldReduceReviewPressure,
        getEvidencePolicyTags,
        summarizeEvidencePolicies
    };
})();
