(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

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

    function isSourceDateStale(connection, now = new Date()) {
        const value = connection?.verified_date || connection?.candidate?.filing_date;
        if (!value) return true;
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return true;
        const ageDays = (now.getTime() - date.getTime()) / 86400000;
        return ageDays > 365;
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
        const tags = [
            typeInfo.shortLabel,
            confidence.shortLabel,
            sourceStatus.shortLabel
        ];

        if (isSecBackedRelationship(connection)) tags.push('SEC-backed');
        if (isCandidateRelationship(connection)) tags.push('Candidate preview');
        if (!getValidSourceUrls(connection?.source_urls).length) tags.push('No source URL attached yet');
        if (isSourceDateStale(connection)) tags.push('Source date pending/stale');
        return [...new Set(tags.filter(Boolean))];
    }

    function normalizeConnection(connection) {
        const typeInfo = inferRelationshipType(connection);
        const relationshipTypeKey = TAXONOMY[connection?.relationship_type]?.key || typeInfo.key;
        const confidence = getConfidenceTier(connection);
        const confidenceScore = getConfidenceScore(connection);
        const sourceStatus = getSourceStatus(connection);
        const sourceUrls = getValidSourceUrls(connection?.source_urls);

        return {
            ...connection,
            raw_type: connection?.raw_type || connection?.type || '',
            relationship_type: relationshipTypeKey,
            relationship_type_label: TAXONOMY[relationshipTypeKey]?.label || typeInfo.label,
            relationship_group: TAXONOMY[relationshipTypeKey]?.groupKey || typeInfo.groupKey,
            confidence_score: confidenceScore,
            confidence_tier: confidence.key,
            confidence_tier_label: confidence.label,
            evidence_count: getEvidenceCount(connection),
            source_count: sourceUrls.length,
            source_status: sourceStatus.key,
            source_status_label: sourceStatus.label,
            source_stale: isSourceDateStale(connection),
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

    function getRelationshipFilterOptions(connections) {
        return TAXONOMY_LIST
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    function getRelationshipVisualMeta(connection) {
        const confidence = getConfidenceTier(connection);
        const sourceStatus = getSourceStatus(connection);
        const evidenceCount = getEvidenceCount(connection);
        const isWeakEvidence = sourceStatus.key === SOURCE_STATUS.missing_source.key ||
            confidence.key === CONFIDENCE_TIERS.low.key ||
            confidence.key === CONFIDENCE_TIERS.pending.key;
        const isStrongEvidence = evidenceCount > 0 &&
            (confidence.key === CONFIDENCE_TIERS.high.key || sourceStatus.key === SOURCE_STATUS.sec_backed.key);

        return {
            color: getRelationshipTypeColor(connection),
            alphaMultiplier: isWeakEvidence ? 0.52 : isStrongEvidence ? 1.12 : 1,
            widthBoost: isWeakEvidence ? -0.22 : isStrongEvidence ? 0.28 : 0,
            muted: isWeakEvidence,
            strong: isStrongEvidence,
            confidenceKey: confidence.key,
            sourceStatusKey: sourceStatus.key
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
        getConfidenceScore,
        getConfidenceTier,
        getSourceStatus,
        getEvidenceCount,
        getValidSourceUrls,
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
