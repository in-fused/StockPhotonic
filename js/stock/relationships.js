(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};
    const sourceReview = window.StockPhotonicStock.sourceReview || {};
    const evidencePolicy = window.StockPhotonicStock.evidencePolicy || {};

    const DEFAULT_RELATIONSHIP_TYPE = 'curated_manual_relationship';
    const SOURCE_STATUS = {
        sec_backed: {
            key: 'sec_backed',
            label: 'SEC-backed',
            shortLabel: 'SEC',
            isSourced: true,
            warning: false
        },
        candidate_preview: {
            key: 'candidate_preview',
            label: 'Candidate / preview',
            shortLabel: 'PREVIEW',
            isSourced: true,
            warning: false
        },
        source_attached: {
            key: 'source_attached',
            label: 'Source attached',
            shortLabel: 'SOURCED',
            isSourced: true,
            warning: false
        },
        missing_source: {
            key: 'missing_source',
            label: 'No source URL attached yet',
            shortLabel: 'NO URL',
            isSourced: false,
            warning: true
        }
    };

    const CONFIDENCE_TIERS = {
        high: {
            key: 'high',
            label: 'High confidence',
            shortLabel: 'HIGH',
            minScore: 4,
            rank: 3
        },
        medium: {
            key: 'medium',
            label: 'Medium confidence',
            shortLabel: 'MED',
            minScore: 3,
            rank: 2
        },
        low: {
            key: 'low',
            label: 'Low confidence',
            shortLabel: 'LOW',
            minScore: 1,
            rank: 1
        },
        pending: {
            key: 'pending',
            label: 'Evidence pending',
            shortLabel: 'PENDING',
            minScore: 0,
            rank: 0
        }
    };

    const TAXONOMY = {
        supplier_customer: {
            key: 'supplier_customer',
            label: 'Supplier / Customer',
            shortLabel: 'Supply',
            groupKey: 'supply',
            color: '#00ff9f',
            rawTypes: ['supply', 'supplier', 'customer', 'supplier_customer'],
            keywords: ['supplier', 'supply', 'customer', 'vendor', 'dependency']
        },
        strategic_partnership: {
            key: 'strategic_partnership',
            label: 'Strategic Partnership',
            shortLabel: 'Partner',
            groupKey: 'partner',
            color: '#ff00aa',
            rawTypes: ['partnership', 'partner', 'strategic_partnership'],
            keywords: ['partnership', 'partner', 'strategic', 'collaboration', 'alliance']
        },
        competitor: {
            key: 'competitor',
            label: 'Competitor / Peer',
            shortLabel: 'Peer',
            groupKey: 'competitive',
            color: '#ff6b00',
            rawTypes: ['competitor', 'competition', 'peer'],
            keywords: ['competitor', 'competition', 'competes', 'peer', 'rival']
        },
        hyperscaler_cloud_customer: {
            key: 'hyperscaler_cloud_customer',
            label: 'Hyperscaler / Cloud Ecosystem',
            shortLabel: 'Cloud',
            groupKey: 'partner',
            color: '#7dd3fc',
            rawTypes: ['cloud', 'hyperscaler', 'ecosystem'],
            keywords: ['aws', 'azure', 'google cloud', 'gcp', 'oci', 'oracle cloud', 'cloud', 'hyperscaler']
        },
        semiconductor_supply_chain: {
            key: 'semiconductor_supply_chain',
            label: 'Semiconductor Supply Chain',
            shortLabel: 'Semi chain',
            groupKey: 'supply',
            color: '#34d399',
            rawTypes: ['semiconductor_supply_chain'],
            keywords: ['semiconductor', 'foundry', 'hbm', 'memory', 'lithography', 'wafer', 'fab', 'advanced-node']
        },
        ai_infrastructure: {
            key: 'ai_infrastructure',
            label: 'AI Infrastructure',
            shortLabel: 'AI infra',
            groupKey: 'partner',
            color: '#ffd700',
            rawTypes: ['ai_infrastructure', 'ecosystem'],
            keywords: ['ai infrastructure', 'accelerator', 'gpu', 'training cluster', 'data center gpu', 'generative ai']
        },
        data_center_power: {
            key: 'data_center_power',
            label: 'Data Center / Power',
            shortLabel: 'Power',
            groupKey: 'supply',
            color: '#facc15',
            rawTypes: ['data_center_power'],
            keywords: ['data center power', 'power', 'electricity', 'utility', 'energy demand', 'grid']
        },
        ownership_etf_overlap: {
            key: 'ownership_etf_overlap',
            label: 'Ownership / ETF Overlap',
            shortLabel: 'Capital',
            groupKey: 'capital',
            color: '#c026d3',
            rawTypes: ['investment', 'ownership', 'institutional_ownership', 'shared_holder', 'etf_overlap'],
            keywords: ['investment', 'ownership', 'holder', 'shareholder', 'etf', 'index']
        },
        sec_backed_preview: {
            key: 'sec_backed_preview',
            label: 'SEC-backed Preview',
            shortLabel: 'SEC preview',
            groupKey: 'other',
            color: '#67e8f9',
            rawTypes: ['sec_preview', 'sec-backed preview', 'sec_candidate'],
            keywords: ['sec filing', 'candidate preview', 'preview relationship']
        },
        curated_manual_relationship: {
            key: 'curated_manual_relationship',
            label: 'Curated / Manual Relationship',
            shortLabel: 'Curated',
            groupKey: 'other',
            color: '#00f9ff',
            rawTypes: ['curated', 'manual', 'link', 'relationship'],
            keywords: []
        }
    };

    const TAXONOMY_LIST = Object.values(TAXONOMY);

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getRelationshipText(connection) {
        const candidate = connection?.candidate || {};
        return [
            connection?.relationship_type,
            connection?.type,
            connection?.label,
            connection?.provenance,
            connection?.source_label,
            connection?.evidence_snippet,
            candidate.relationship_type,
            candidate.evidence_snippet,
            candidate.review_status,
            candidate.source
        ].map(normalizeText).filter(Boolean).join(' ');
    }

    function getValidSourceUrls(sourceUrls) {
        return Array.isArray(sourceUrls)
            ? sourceUrls.map(url => String(url || '').trim()).filter(url => /^https?:\/\//i.test(url))
            : [];
    }

    function isCandidateRelationship(connection) {
        return Boolean(
            connection?.isSecPreviewLink ||
            connection?.is_candidate_preview ||
            connection?.candidate ||
            normalizeText(connection?.source_status) === SOURCE_STATUS.candidate_preview.key
        );
    }

    function isSecBackedRelationship(connection) {
        const provenance = normalizeText(connection?.provenance);
        const sourceLabel = normalizeText(connection?.source_label);
        const text = getRelationshipText(connection);
        return provenance === 'sec filing' ||
            sourceLabel.includes('sec filing') ||
            text.includes('sec filing') ||
            getValidSourceUrls(connection?.source_urls).some(url => /sec\.gov/i.test(url));
    }

    function inferRelationshipType(connection) {
        const rawType = normalizeText(connection?.relationship_type || connection?.type || connection?.candidate?.relationship_type);
        const text = getRelationshipText(connection);

        if (rawType.includes('sec_preview') || rawType.includes('sec candidate')) {
            return TAXONOMY.sec_backed_preview;
        }

        const rawMatch = TAXONOMY_LIST.find(type =>
            type.rawTypes.some(raw => rawType === raw || rawType.includes(raw))
        );
        if (rawMatch) {
            if (rawMatch.key === 'supplier_customer' && hasAnyKeyword(text, TAXONOMY.semiconductor_supply_chain.keywords)) {
                return TAXONOMY.semiconductor_supply_chain;
            }
            if (rawMatch.key === 'strategic_partnership' && hasAnyKeyword(text, TAXONOMY.hyperscaler_cloud_customer.keywords)) {
                return TAXONOMY.hyperscaler_cloud_customer;
            }
            if (rawMatch.key === 'hyperscaler_cloud_customer' && hasAnyKeyword(text, TAXONOMY.ai_infrastructure.keywords)) {
                return TAXONOMY.ai_infrastructure;
            }
            return rawMatch;
        }

        const keywordMatch = TAXONOMY_LIST.find(type =>
            type.key !== DEFAULT_RELATIONSHIP_TYPE && hasAnyKeyword(text, type.keywords)
        );
        if (keywordMatch) return keywordMatch;

        if (isCandidateRelationship(connection) && isSecBackedRelationship(connection)) {
            return TAXONOMY.sec_backed_preview;
        }

        return TAXONOMY[DEFAULT_RELATIONSHIP_TYPE];
    }

    function hasAnyKeyword(text, keywords) {
        return keywords.some(keyword => text.includes(keyword));
    }

    function getConfidenceScore(connection) {
        const direct = Number(connection?.confidence);
        if (Number.isFinite(direct) && direct > 0) return Math.max(1, Math.min(5, Math.round(direct)));

        const hint = Number(connection?.confidence_hint ?? connection?.candidate?.confidence_hint);
        if (!Number.isFinite(hint) || hint <= 0) return null;
        if (hint <= 1) return Math.max(1, Math.min(5, Math.round(hint * 5)));
        return Math.max(1, Math.min(5, Math.round(hint)));
    }

    function getConfidenceTier(connection) {
        const score = getConfidenceScore(connection);
        if (!score) return CONFIDENCE_TIERS.pending;
        if (score >= 4) return CONFIDENCE_TIERS.high;
        if (score >= 3) return CONFIDENCE_TIERS.medium;
        return CONFIDENCE_TIERS.low;
    }

    function getSourceStatus(connection) {
        if (isCandidateRelationship(connection)) return SOURCE_STATUS.candidate_preview;
        if (isSecBackedRelationship(connection)) return SOURCE_STATUS.sec_backed;
        if (getValidSourceUrls(connection?.source_urls).length > 0) return SOURCE_STATUS.source_attached;
        return SOURCE_STATUS.missing_source;
    }

    function getEvidenceCount(connection) {
        const sourceCount = getValidSourceUrls(connection?.source_urls).length;
        const snippetCount = connection?.evidence_snippet || connection?.candidate?.evidence_snippet ? 1 : 0;
        const sourceLabelCount = connection?.source_label && isCandidateRelationship(connection) ? 1 : 0;
        return sourceCount + snippetCount + sourceLabelCount;
    }

    function getSourceAgeInfo(connection, now = new Date()) {
        if (sourceReview.getSourceAgeInfo) return sourceReview.getSourceAgeInfo(connection, { now });

        const value = connection?.verified_date || connection?.candidate?.filing_date;
        if (!value) {
            return {
                key: 'no_verified_date',
                label: 'No verified date',
                shortLabel: 'NO DATE',
                ageDays: null,
                isStale: false,
                reviewRecommended: true
            };
        }
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) {
            return {
                key: 'no_verified_date',
                label: 'No verified date',
                shortLabel: 'NO DATE',
                ageDays: null,
                isStale: false,
                reviewRecommended: true
            };
        }
        const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
        if (ageDays > 365) {
            return {
                key: 'stale_review_recommended',
                label: 'Stale review recommended',
                shortLabel: 'STALE',
                ageDays,
                isStale: true,
                reviewRecommended: true
            };
        }
        if (ageDays > 180) {
            return {
                key: 'aging_evidence',
                label: 'Aging evidence',
                shortLabel: 'AGING',
                ageDays,
                isStale: false,
                reviewRecommended: false
            };
        }
        return {
            key: 'verified_recently',
            label: 'Verified recently',
            shortLabel: 'RECENT',
            ageDays,
            isStale: false,
            reviewRecommended: false
        };
    }

    function isSourceDateStale(connection, now = new Date()) {
        return getSourceAgeInfo(connection, now).isStale === true;
    }

    function buildRelationshipSummary(connection) {
        const label = String(connection?.label || '').trim();
        if (label) return label;

        const snippet = String(connection?.evidence_snippet || connection?.candidate?.evidence_snippet || '').trim();
        if (snippet) return truncateText(snippet, 180);

        const provenance = String(connection?.provenance || '').trim();
        if (provenance) return `Relationship type from curated dataset. Source note: ${truncateText(provenance, 130)}`;

        return 'Evidence pending. Relationship type from curated dataset.';
    }

    function buildEvidenceTags(connection) {
        const typeInfo = inferRelationshipType(connection);
        const confidence = getConfidenceTier(connection);
        const sourceStatus = getSourceStatus(connection);
        const policy = getEvidencePolicy(connection);
        const tags = [
            typeInfo.shortLabel,
            confidence.shortLabel,
            sourceStatus.shortLabel,
            policy.tier?.shortLabel,
            policy.trustedClass?.shortLabel,
            policy.reviewerDecisionState?.shortLabel
        ];

        if (isSecBackedRelationship(connection)) tags.push('SEC-backed');
        if (isCandidateRelationship(connection)) tags.push('Candidate preview');
        if (policy.fastTrackVisibility) tags.push('Fast-track visible');
        if (policy.openAlex) tags.push('OpenAlex context only');
        if (!getValidSourceUrls(connection?.source_urls).length) tags.push('No source URL attached yet');
        const sourceAge = getSourceAgeInfo(connection);
        if (sourceAge.key === 'stale_review_recommended') tags.push(sourceAge.label);
        if (sourceAge.key === 'no_verified_date') tags.push(sourceAge.label);
        if (sourceAge.key === 'aging_evidence') tags.push(sourceAge.label);
        const hostDiversity = sourceReview.getSourceHostDiversity?.(connection);
        hostDiversity?.categories?.slice(0, 2).forEach(category => tags.push(category.shortLabel || category.label));
        return [...new Set(tags.filter(Boolean))];
    }

    function normalizeConnection(connection) {
        const typeInfo = inferRelationshipType(connection);
        const relationshipTypeKey = TAXONOMY[connection?.relationship_type]?.key || typeInfo.key;
        const confidence = getConfidenceTier(connection);
        const confidenceScore = getConfidenceScore(connection);
        const sourceStatus = getSourceStatus(connection);
        const sourceUrls = getValidSourceUrls(connection?.source_urls);
        const evidenceCount = getEvidenceCount(connection);
        const policy = getEvidencePolicy({
            ...connection,
            relationship_type: relationshipTypeKey,
            confidence_score: confidenceScore,
            confidence_tier: confidence.key,
            evidence_count: evidenceCount,
            source_status: sourceStatus.key
        });
        const sourceAge = getSourceAgeInfo(connection);
        const hostDiversity = sourceReview.getSourceHostDiversity?.(connection) || {
            categories: [],
            categoryKeys: [],
            hosts: [],
            hostCount: 0,
            urlCount: sourceUrls.length,
            categoryCount: 0,
            primaryCategory: null
        };

        return {
            ...connection,
            raw_type: connection?.raw_type || connection?.type || '',
            relationship_type: relationshipTypeKey,
            relationship_type_label: TAXONOMY[relationshipTypeKey]?.label || typeInfo.label,
            relationship_group: TAXONOMY[relationshipTypeKey]?.groupKey || typeInfo.groupKey,
            confidence_score: confidenceScore,
            confidence_tier: confidence.key,
            confidence_tier_label: confidence.label,
            evidence_count: evidenceCount,
            source_count: sourceUrls.length,
            source_status: sourceStatus.key,
            source_status_label: sourceStatus.label,
            evidence_tier: policy.tier?.key || 'needs_review',
            evidence_tier_label: policy.tier?.label || 'Needs review',
            evidence_tier_short_label: policy.tier?.shortLabel || 'REVIEW',
            evidence_tier_rank: policy.tier?.rank || 1,
            trusted_relationship_class: policy.trustedClassKey || '',
            trusted_relationship_class_label: policy.trustedClassLabel || '',
            trusted_relationship_fast_track: Boolean(policy.fastTrackVisibility),
            reviewer_decision_state: policy.reviewerDecisionState?.key || 'accepted_for_review',
            reviewer_decision_label: policy.reviewerDecisionState?.label || 'Accepted for review',
            evidence_policy_explanation: policy.explanation,
            source_stale: sourceAge.isStale,
            source_age_key: sourceAge.key,
            source_age_label: sourceAge.label,
            source_age_days: sourceAge.ageDays,
            source_age_review_recommended: sourceAge.reviewRecommended,
            source_host_categories: hostDiversity.categoryKeys,
            source_host_category_label: hostDiversity.primaryCategory?.label || '',
            source_host_count: hostDiversity.hostCount,
            source_diversity_count: hostDiversity.categoryCount,
            relationship_summary: buildRelationshipSummary(connection),
            evidence_tags: buildEvidenceTags(connection)
        };
    }

    function normalizeConnections(connections) {
        return Array.isArray(connections) ? connections.map(normalizeConnection) : [];
    }

    function normalizePreviewLink(link) {
        return normalizeConnection({
            ...link,
            is_candidate_preview: true,
            source_label: link?.source_label || 'SEC filing',
            relationship_type: link?.relationship_type || link?.type || link?.candidate?.relationship_type || 'sec_backed_preview'
        });
    }

    function getRelationshipTypeKey(connection) {
        return connection?.relationship_type || inferRelationshipType(connection).key;
    }

    function getRelationshipTypeLabel(connectionOrType) {
        const key = typeof connectionOrType === 'string'
            ? connectionOrType
            : getRelationshipTypeKey(connectionOrType);
        return TAXONOMY[key]?.label || formatTypeLabel(key);
    }

    function getRelationshipTypeColor(connectionOrType) {
        const key = typeof connectionOrType === 'string'
            ? connectionOrType
            : getRelationshipTypeKey(connectionOrType);
        return TAXONOMY[key]?.color || TAXONOMY[DEFAULT_RELATIONSHIP_TYPE].color;
    }

    function getRelationshipGroupKey(connection) {
        const key = getRelationshipTypeKey(connection);
        return TAXONOMY[key]?.groupKey || inferRelationshipType(connection).groupKey || 'other';
    }

    function getEvidencePolicy(connection) {
        if (evidencePolicy.getEvidencePolicy) {
            return evidencePolicy.getEvidencePolicy(connection, { evidenceCount: getEvidenceCount(connection) });
        }
        const sourceStatus = getSourceStatus(connection);
        const confidence = getConfidenceTier(connection);
        const fallbackTier = sourceStatus.key === SOURCE_STATUS.sec_backed.key || confidence.key === CONFIDENCE_TIERS.high.key
            ? { key: 'verified', label: 'Verified', shortLabel: 'VERIFIED', rank: 4, color: '#7cffc8' }
            : { key: 'needs_review', label: 'Needs review', shortLabel: 'REVIEW', rank: 1, color: '#fb923c' };
        return {
            tier: fallbackTier,
            tierKey: fallbackTier.key,
            trustedClass: null,
            trustedClassKey: '',
            trustedClassLabel: '',
            reviewerDecisionState: { key: 'accepted_for_review', label: 'Accepted for review', shortLabel: 'REVIEW' },
            reviewerDecisionKey: 'accepted_for_review',
            explanation: fallbackTier.label,
            fastTrackVisibility: false,
            openAlex: false,
            candidate: isCandidateRelationship(connection)
        };
    }

    function getEvidenceTier(connection) {
        return getEvidencePolicy(connection).tier;
    }

    function getTrustedRelationshipClass(connection) {
        return getEvidencePolicy(connection).trustedClass;
    }

    function getReviewerDecisionState(connection) {
        return getEvidencePolicy(connection).reviewerDecisionState;
    }

    function getRelationshipFilterOptions(connections) {
        return TAXONOMY_LIST
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    function getRelationshipVisualMeta(connection) {
        const confidence = getConfidenceTier(connection);
        const sourceStatus = getSourceStatus(connection);
        const evidenceCount = getEvidenceCount(connection);
        const sourceAge = getSourceAgeInfo(connection);
        const policy = getEvidencePolicy(connection);
        const tierKey = policy.tier?.key || 'needs_review';
        const isCandidate = isCandidateRelationship(connection);
        const isWeakEvidence = sourceStatus.key === SOURCE_STATUS.missing_source.key ||
            confidence.key === CONFIDENCE_TIERS.low.key ||
            confidence.key === CONFIDENCE_TIERS.pending.key ||
            sourceAge.key === 'stale_review_recommended' ||
            sourceAge.key === 'no_verified_date';
        const isStrongEvidence = evidenceCount > 0 &&
            sourceAge.key !== 'stale_review_recommended' &&
            (confidence.key === CONFIDENCE_TIERS.high.key || sourceStatus.key === SOURCE_STATUS.sec_backed.key || tierKey === 'verified');
        const staleOrPending = sourceAge.key === 'stale_review_recommended' || sourceAge.key === 'no_verified_date';
        const tierMuted = tierKey === 'context_only' || tierKey === 'needs_review';
        const tierWidthBoost = tierKey === 'verified'
            ? 0.36
            : tierKey === 'strong_inferred'
                ? 0.16
                : tierKey === 'context_only'
                    ? -0.12
                    : -0.3;
        const tierAlphaMultiplier = tierKey === 'verified'
            ? 1.14
            : tierKey === 'strong_inferred'
                ? 0.92
                : tierKey === 'context_only'
                    ? 0.68
                    : 0.46;

        return {
            color: getRelationshipTypeColor(connection),
            alphaMultiplier: staleOrPending && tierKey !== 'strong_inferred' ? 0.42 : isWeakEvidence && tierKey !== 'strong_inferred' ? 0.52 : tierAlphaMultiplier,
            widthBoost: staleOrPending && tierKey !== 'strong_inferred' ? -0.28 : isWeakEvidence && tierKey !== 'strong_inferred' ? -0.22 : isStrongEvidence ? 0.28 + tierWidthBoost : tierWidthBoost,
            dashPattern: isCandidate ? [7, 6] : tierKey === 'context_only' ? [2, 6] : tierKey === 'needs_review' ? [3, 7] : staleOrPending && tierKey !== 'strong_inferred' ? [3, 7] : null,
            muted: isWeakEvidence || tierMuted,
            strong: isStrongEvidence,
            confidenceKey: confidence.key,
            sourceStatusKey: sourceStatus.key,
            sourceAgeKey: sourceAge.key,
            evidenceTierKey: tierKey,
            trustedClassKey: policy.trustedClassKey || '',
            fastTrackVisibility: Boolean(policy.fastTrackVisibility)
        };
    }

    function relationshipHasSourceEvidence(connection) {
        const status = getSourceStatus(connection);
        return status.isSourced && getEvidenceCount(connection) > 0;
    }

    function formatTypeLabel(type) {
        const text = String(type || 'Relationship').replace(/[_-]+/g, ' ').trim();
        if (!text) return 'Relationship';
        return text.replace(/\b\w/g, char => char.toUpperCase());
    }

    function truncateText(value, maxLength) {
        const text = String(value || '').trim();
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
    }

    window.StockPhotonicStock.relationships = {
        TAXONOMY,
        TAXONOMY_LIST,
        SOURCE_STATUS,
        CONFIDENCE_TIERS,
        DEFAULT_RELATIONSHIP_TYPE,
        normalizeConnection,
        normalizeConnections,
        normalizePreviewLink,
        inferRelationshipType,
        getRelationshipTypeKey,
        getRelationshipTypeLabel,
        getRelationshipTypeColor,
        getRelationshipGroupKey,
        getRelationshipFilterOptions,
        getEvidencePolicy,
        getEvidenceTier,
        getTrustedRelationshipClass,
        getReviewerDecisionState,
        getConfidenceScore,
        getConfidenceTier,
        getSourceStatus,
        getEvidenceCount,
        getValidSourceUrls,
        getSourceAgeInfo,
        isCandidateRelationship,
        isSecBackedRelationship,
        isSourceDateStale,
        buildRelationshipSummary,
        buildEvidenceTags,
        getRelationshipVisualMeta,
        relationshipHasSourceEvidence,
        truncateText
    };
})();
