(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const RECENT_EVIDENCE_DAYS = 180;
    const STALE_REVIEW_DAYS = 365;

    const SOURCE_AGE_STATES = {
        verified_recently: {
            key: 'verified_recently',
            label: 'Verified recently',
            shortLabel: 'RECENT',
            rank: 3,
            reviewRecommended: false,
            isStale: false
        },
        aging_evidence: {
            key: 'aging_evidence',
            label: 'Aging evidence',
            shortLabel: 'AGING',
            rank: 2,
            reviewRecommended: false,
            isStale: false
        },
        stale_review_recommended: {
            key: 'stale_review_recommended',
            label: 'Stale review recommended',
            shortLabel: 'STALE',
            rank: 1,
            reviewRecommended: true,
            isStale: true
        },
        no_verified_date: {
            key: 'no_verified_date',
            label: 'No verified date',
            shortLabel: 'NO DATE',
            rank: 0,
            reviewRecommended: true,
            isStale: false
        },
        candidate_preview: {
            key: 'candidate_preview',
            label: 'Candidate preview',
            shortLabel: 'PREVIEW',
            rank: 0,
            reviewRecommended: true,
            isStale: false
        }
    };

    const SOURCE_HOST_CATEGORIES = {
        sec_source: {
            key: 'sec_source',
            label: 'SEC source',
            shortLabel: 'SEC',
            filterLabel: 'SEC source',
            rank: 5
        },
        official_company_ir: {
            key: 'official_company_ir',
            label: 'Company IR URL',
            shortLabel: 'IR',
            filterLabel: 'Official company IR',
            rank: 4
        },
        official_partner_customer_page: {
            key: 'official_partner_customer_page',
            label: 'Partner/customer page URL',
            shortLabel: 'PARTNER PAGE',
            filterLabel: 'Official partner/customer page',
            rank: 3
        },
        secondary_research: {
            key: 'secondary_research',
            label: 'Secondary/research source',
            shortLabel: 'RESEARCH',
            filterLabel: 'Secondary/research source',
            rank: 2
        },
        other_url: {
            key: 'other_url',
            label: 'Other source URL',
            shortLabel: 'URL',
            filterLabel: 'Other source URL',
            rank: 1
        },
        candidate_only: {
            key: 'candidate_only',
            label: 'Candidate-only source',
            shortLabel: 'CANDIDATE',
            filterLabel: 'Candidate-only source',
            rank: 0
        }
    };

    const SOURCE_HOST_CATEGORY_LIST = Object.values(SOURCE_HOST_CATEGORIES)
        .sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));

    const REVIEW_GROUPS = {
        sec_preview_review: {
            key: 'sec_preview_review',
            label: 'SEC preview review',
            shortLabel: 'SEC PREVIEW',
            priority: 5
        },
        missing_source: {
            key: 'missing_source',
            label: 'Missing source',
            shortLabel: 'NO SOURCE',
            priority: 4
        },
        stale_review: {
            key: 'stale_review',
            label: 'Stale review recommended',
            shortLabel: 'STALE',
            priority: 3
        },
        low_confidence: {
            key: 'low_confidence',
            label: 'Low confidence',
            shortLabel: 'LOW CONF',
            priority: 2
        },
        candidate_preview: {
            key: 'candidate_preview',
            label: 'Candidate preview',
            shortLabel: 'PREVIEW',
            priority: 1
        },
        no_verified_date: {
            key: 'no_verified_date',
            label: 'No verified date',
            shortLabel: 'NO DATE',
            priority: 1
        },
        needs_review: {
            key: 'needs_review',
            label: 'Needs review',
            shortLabel: 'REVIEW',
            priority: 4
        },
        context_only: {
            key: 'context_only',
            label: 'Context-only signal',
            shortLabel: 'CONTEXT',
            priority: 1
        }
    };

    const SECONDARY_SOURCE_HOST_PATTERNS = [
        'reuters.com',
        'bloomberg.com',
        'wsj.com',
        'cnbc.com',
        'marketwatch.com',
        'seekingalpha.com',
        'finance.yahoo.com',
        'nasdaq.com',
        'morningstar.com',
        'spglobal.com',
        'marketscreener.com',
        'annualreports.com'
    ];

    const IR_URL_PATTERN = /(investor|investors|ir\.|\/ir\/|shareholder|sec-filings|financial-information|annual-report|quarterly-results|news-releases)/i;
    const PARTNER_URL_PATTERN = /(partner|partners|customer|customers|case-study|case-studies|news|press|blog|project|solution|solutions|ecosystem|collaboration|alliance)/i;

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getValidSourceUrls(sourceUrls) {
        return Array.isArray(sourceUrls)
            ? sourceUrls.map(url => String(url || '').trim()).filter(url => /^https?:\/\//i.test(url))
            : [];
    }

    function getCandidateSourceUrls(record) {
        const candidate = record?.candidate || record || {};
        return [
            ...getValidSourceUrls(record?.source_urls),
            ...getValidSourceUrls(candidate.source_urls),
            candidate.archive_url
        ].map(url => String(url || '').trim())
            .filter(url => /^https?:\/\//i.test(url));
    }

    function getAllSourceUrls(record) {
        return [...new Set(getCandidateSourceUrls(record))];
    }

    function getSourceHost(url) {
        try {
            return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
        } catch (error) {
            return '';
        }
    }

    function isCandidateRecord(record) {
        const status = normalizeText(record?.source_status || record?.review_status || record?.candidate?.review_status);
        return Boolean(
            record?.isSecPreviewLink ||
            record?.is_candidate_preview ||
            record?.candidate ||
            status.includes('candidate') ||
            status.includes('pending_review')
        );
    }

    function isSecPreviewRecord(record) {
        const text = [
            record?.source_label,
            record?.source_type,
            record?.candidate?.source_type,
            record?.provenance
        ].map(normalizeText).join(' ');
        return Boolean(
            record?.isSecPreviewLink ||
            (isCandidateRecord(record) && text.includes('sec')) ||
            getAllSourceUrls(record).some(url => /sec\.gov/i.test(url))
        );
    }

    function getVerifiedDateValue(record) {
        return record?.verified_date ||
            record?.candidate?.filing_date ||
            record?.filing_date ||
            '';
    }

    function parseDateValue(value) {
        const text = String(value || '').trim();
        if (!text) return null;

        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    function getDateAgeInfo(value, options = {}) {
        if (options.candidatePreview) {
            return {
                ...SOURCE_AGE_STATES.candidate_preview,
                date: String(value || ''),
                ageDays: null
            };
        }

        const date = parseDateValue(value);
        if (!date) {
            return {
                ...SOURCE_AGE_STATES.no_verified_date,
                date: '',
                ageDays: null
            };
        }

        const now = options.now instanceof Date ? options.now : new Date();
        const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
        const state = ageDays > STALE_REVIEW_DAYS
            ? SOURCE_AGE_STATES.stale_review_recommended
            : ageDays > RECENT_EVIDENCE_DAYS
                ? SOURCE_AGE_STATES.aging_evidence
                : SOURCE_AGE_STATES.verified_recently;

        return {
            ...state,
            date: String(value || ''),
            ageDays
        };
    }

    function getSourceAgeInfo(record, options = {}) {
        return getDateAgeInfo(getVerifiedDateValue(record), {
            ...options,
            candidatePreview: isCandidateRecord(record)
        });
    }

    function classifySourceUrl(url, record = {}) {
        const host = getSourceHost(url);
        const path = (() => {
            try {
                const parsed = new URL(url);
                return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
            } catch (error) {
                return String(url || '').toLowerCase();
            }
        })();
        const registryTools = window.StockPhotonicStock?.sourceRegistry;
        const registryCategory = registryTools?.classifyUrl?.(url);
        const mappedRegistryKey = registryTools?.toSourceReviewCategoryKey?.(registryCategory?.key);
        if (host && mappedRegistryKey && SOURCE_HOST_CATEGORIES[mappedRegistryKey]) {
            return SOURCE_HOST_CATEGORIES[mappedRegistryKey];
        }

        if (!host && isCandidateRecord(record)) return SOURCE_HOST_CATEGORIES.candidate_only;
        if (/(\.|^)sec\.gov$/i.test(host)) return SOURCE_HOST_CATEGORIES.sec_source;
        if (SECONDARY_SOURCE_HOST_PATTERNS.some(pattern => host === pattern || host.endsWith(`.${pattern}`))) {
            return SOURCE_HOST_CATEGORIES.secondary_research;
        }
        if (IR_URL_PATTERN.test(path)) return SOURCE_HOST_CATEGORIES.official_company_ir;
        if (PARTNER_URL_PATTERN.test(path)) return SOURCE_HOST_CATEGORIES.official_partner_customer_page;
        return SOURCE_HOST_CATEGORIES.other_url;
    }

    function getSourceHostDiversity(record) {
        const urls = getAllSourceUrls(record);
        const hosts = [...new Set(urls.map(getSourceHost).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        const categories = urls.length
            ? [...new Map(urls.map(url => {
                const category = classifySourceUrl(url, record);
                return [category.key, category];
            })).values()]
            : isCandidateRecord(record)
                ? [SOURCE_HOST_CATEGORIES.candidate_only]
                : [];

        categories.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));

        return {
            urls,
            hosts,
            categories,
            categoryKeys: categories.map(category => category.key),
            primaryCategory: categories[0] || null,
            hostCount: hosts.length,
            urlCount: urls.length,
            categoryCount: categories.length
        };
    }

    function relationshipMatchesSourceHostCategory(record, categoryKey) {
        if (!categoryKey) return true;
        return getSourceHostDiversity(record).categoryKeys.includes(categoryKey);
    }

    function getSourceHostCategoryLabel(categoryKey) {
        return SOURCE_HOST_CATEGORIES[categoryKey]?.label || 'Source URL';
    }

    function getSourceHostFilterOptions() {
        return SOURCE_HOST_CATEGORY_LIST.map(category => ({
            key: category.key,
            label: category.filterLabel || category.label
        }));
    }

    function getConfidenceScore(record) {
        const direct = Number(record?.confidence_score ?? record?.confidence ?? record?.confidence_hint ?? record?.candidate?.confidence_hint);
        if (!Number.isFinite(direct) || direct <= 0) return null;
        return direct <= 1 ? Math.round(direct * 5) : Math.round(direct);
    }

    function getReviewFlags(record, options = {}) {
        const evidenceCount = Number(record?.evidence_count ?? options.evidenceCount ?? 0);
        const sourceUrls = getAllSourceUrls(record);
        const confidenceScore = getConfidenceScore(record);
        const sourceAge = getSourceAgeInfo(record, options);
        const candidatePreview = isCandidateRecord(record);
        const secPreview = isSecPreviewRecord(record);
        const policy = getEvidencePolicy(record, { evidenceCount });

        return {
            lowConfidence: confidenceScore === null || confidenceScore <= 2,
            missingSource: !candidatePreview && sourceUrls.length === 0,
            staleReview: sourceAge.key === SOURCE_AGE_STATES.stale_review_recommended.key,
            noVerifiedDate: sourceAge.key === SOURCE_AGE_STATES.no_verified_date.key,
            candidatePreview,
            secPreview,
            fastTrackVisibility: Boolean(policy.fastTrackVisibility),
            evidenceTierKey: policy.tier?.key || 'needs_review',
            reviewerDecisionKey: policy.reviewerDecisionState?.key || 'accepted_for_review',
            reviewPressureReduced: shouldReduceReviewPressure(record, { evidenceCount }),
            sourceAge,
            sourceUrls,
            confidenceScore
        };
    }

    function getReviewGroup(record, options = {}) {
        const flags = getReviewFlags(record, options);
        if (flags.reviewPressureReduced) return null;
        if (flags.secPreview && flags.candidatePreview) return REVIEW_GROUPS.sec_preview_review;
        if (flags.evidenceTierKey === 'needs_review' && !flags.candidatePreview) return REVIEW_GROUPS.needs_review;
        if (flags.missingSource) return REVIEW_GROUPS.missing_source;
        if (flags.staleReview) return REVIEW_GROUPS.stale_review;
        if (flags.lowConfidence) return REVIEW_GROUPS.low_confidence;
        if (flags.candidatePreview) return REVIEW_GROUPS.candidate_preview;
        if (flags.evidenceTierKey === 'context_only') return REVIEW_GROUPS.context_only;
        if (flags.noVerifiedDate) return REVIEW_GROUPS.no_verified_date;
        return null;
    }

    function getReviewReasonLabels(record, options = {}) {
        const flags = getReviewFlags(record, options);
        const labels = [];
        if (flags.secPreview && flags.candidatePreview) labels.push('SEC preview');
        if (flags.candidatePreview) labels.push('Candidate preview');
        if (flags.fastTrackVisibility) labels.push('Fast-track visible');
        if (flags.reviewPressureReduced) labels.push('Review pressure reduced');
        if (flags.evidenceTierKey === 'context_only') labels.push('Context-only');
        if (flags.evidenceTierKey === 'needs_review') labels.push('Needs review');
        if (flags.missingSource) labels.push('Missing source');
        if (flags.staleReview) labels.push('Stale review recommended');
        if (flags.noVerifiedDate) labels.push('No verified date');
        if (flags.lowConfidence) labels.push('Low confidence');
        return [...new Set(labels)];
    }

    function shouldQueueRelationship(record, options = {}) {
        return Boolean(getReviewGroup(record, options));
    }

    function getReviewPriority(record, options = {}) {
        const group = getReviewGroup(record, options);
        if (!group) return 0;
        const confidenceScore = getConfidenceScore(record) || 0;
        const ageInfo = getSourceAgeInfo(record, options);
        const ageBoost = ageInfo.ageDays ? Math.min(3, Math.floor(ageInfo.ageDays / STALE_REVIEW_DAYS)) : 0;
        return (group?.priority || 0) * 10 + ageBoost + (confidenceScore <= 2 ? 1 : 0);
    }

    function getEvidencePolicy(record, options = {}) {
        const tools = window.StockPhotonicStock?.evidencePolicy;
        if (tools?.getEvidencePolicy) return tools.getEvidencePolicy(record, options);
        return {
            tier: { key: 'needs_review', label: 'Needs review', shortLabel: 'REVIEW' },
            reviewerDecisionState: { key: 'accepted_for_review', label: 'Accepted for review', shortLabel: 'REVIEW' },
            fastTrackVisibility: false
        };
    }

    function shouldReduceReviewPressure(record, options = {}) {
        const tools = window.StockPhotonicStock?.evidencePolicy;
        return Boolean(tools?.shouldReduceReviewPressure?.(record, options));
    }

    window.StockPhotonicStock.sourceReview = {
        RECENT_EVIDENCE_DAYS,
        STALE_REVIEW_DAYS,
        SOURCE_AGE_STATES,
        SOURCE_HOST_CATEGORIES,
        SOURCE_HOST_CATEGORY_LIST,
        REVIEW_GROUPS,
        normalizeText,
        getValidSourceUrls,
        getAllSourceUrls,
        getSourceHost,
        isCandidateRecord,
        isSecPreviewRecord,
        getVerifiedDateValue,
        getDateAgeInfo,
        getSourceAgeInfo,
        classifySourceUrl,
        getSourceHostDiversity,
        relationshipMatchesSourceHostCategory,
        getSourceHostCategoryLabel,
        getSourceHostFilterOptions,
        getReviewFlags,
        getReviewGroup,
        getReviewReasonLabels,
        shouldQueueRelationship,
        getReviewPriority,
        getEvidencePolicy
    };
})();
