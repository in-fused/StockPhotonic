(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const SOURCE_CATEGORIES = {
        official_sec_filing: {
            key: 'official_sec_filing',
            label: 'Official SEC filing',
            shortLabel: 'SEC',
            rank: 6
        },
        official_company_ir: {
            key: 'official_company_ir',
            label: 'Official company IR',
            shortLabel: 'IR',
            rank: 5
        },
        official_company_newsroom: {
            key: 'official_company_newsroom',
            label: 'Official newsroom',
            shortLabel: 'NEWS',
            rank: 4
        },
        official_partner_customer_page: {
            key: 'official_partner_customer_page',
            label: 'Partner/customer page',
            shortLabel: 'PARTNER',
            rank: 3
        },
        trusted_industry_report: {
            key: 'trusted_industry_report',
            label: 'Trusted industry report',
            shortLabel: 'REPORT',
            rank: 2
        },
        observed_source_host: {
            key: 'observed_source_host',
            label: 'Observed source host',
            shortLabel: 'HOST',
            rank: 1
        }
    };

    const CATEGORY_ALIASES = {
        official_sec_filing: 'sec_source',
        official_company_ir: 'official_company_ir',
        official_company_newsroom: 'official_partner_customer_page',
        official_partner_customer_page: 'official_partner_customer_page',
        trusted_industry_report: 'secondary_research',
        observed_source_host: 'other_url'
    };

    function normalizeHost(value) {
        try {
            return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
        } catch (error) {
            return '';
        }
    }

    function classifyUrl(url, registry = null) {
        const host = normalizeHost(url);
        const hostRecord = findHostRecord(host, registry);
        if (hostRecord?.category && SOURCE_CATEGORIES[hostRecord.category]) {
            return SOURCE_CATEGORIES[hostRecord.category];
        }

        const path = (() => {
            try {
                const parsed = new URL(url);
                return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
            } catch (error) {
                return String(url || '').toLowerCase();
            }
        })();

        if (/(\.|^)sec\.gov$/i.test(host)) return SOURCE_CATEGORIES.official_sec_filing;
        if (/(investor|investors|ir\.|\/ir\/|sec-filings|financial-information|annual-report|quarterly-results)/i.test(path)) {
            return SOURCE_CATEGORIES.official_company_ir;
        }
        if (/(newsroom|news-releases|press-releases|press-room|media\/press|\/news\/)/i.test(path)) {
            return SOURCE_CATEGORIES.official_company_newsroom;
        }
        if (/(partner|partners|customer|customers|case-study|case-studies|collaboration|alliance|ecosystem)/i.test(path)) {
            return SOURCE_CATEGORIES.official_partner_customer_page;
        }
        if (/(annualreports\.com|spglobal\.com|nasdaq\.com|morningstar\.com|marketscreener\.com)/i.test(host)) {
            return SOURCE_CATEGORIES.trusted_industry_report;
        }
        return SOURCE_CATEGORIES.observed_source_host;
    }

    function findHostRecord(host, registry) {
        if (!host || !registry) return null;
        const records = Array.isArray(registry.records)
            ? registry.records
            : Array.isArray(registry.source_registry_visibility?.trusted_host_samples)
                ? registry.source_registry_visibility.trusted_host_samples
                : [];
        return records.find(record => {
            const candidate = String(record?.host || '').toLowerCase();
            return candidate && (host === candidate || host.endsWith(`.${candidate}`));
        }) || null;
    }

    function toSourceReviewCategoryKey(categoryKey) {
        return CATEGORY_ALIASES[categoryKey] || 'other_url';
    }

    function buildWorkbenchModel(report) {
        if (!report || typeof report !== 'object') return null;
        const summary = report.summary || {};
        const governance = report.source_governance || {};
        const universe = report.universe_expansion || {};
        const corridors = report.corridor_maintenance || {};
        const scaling = report.large_graph_scaling_readiness || {};
        const openAlex = report.openalex_expansion_safety || {};
        const strategicHubEvolution = report.strategic_hub_evolution || {};
        return {
            summary,
            staleQueue: Array.isArray(governance.stale_source_review_queue) ? governance.stale_source_review_queue : [],
            duplicateSourceRows: Array.isArray(governance.duplicate_source_reduction) ? governance.duplicate_source_reduction : [],
            sourceLifecycle: governance.source_lifecycle_tracking || {},
            trustedHosts: Array.isArray(report.source_registry_visibility?.trusted_host_samples)
                ? report.source_registry_visibility.trusted_host_samples
                : [],
            officialCompanySamples: Array.isArray(report.source_registry_visibility?.official_company_samples)
                ? report.source_registry_visibility.official_company_samples
                : [],
            universeReadiness: Array.isArray(universe.readiness_rows) ? universe.readiness_rows : [],
            candidateCompanyPreview: universe.candidate_company_preview || {},
            expansionBatches: Array.isArray(universe.expansion_batches?.batches) ? universe.expansion_batches.batches : [],
            universeBlockers: universe.duplicate_ticker_prevention || {},
            aliasConflicts: universe.alias_conflict_detection || {},
            corridorRows: Array.isArray(corridors.corridor_rows) ? corridors.corridor_rows : [],
            maintenanceQueue: Array.isArray(corridors.maintenance_queue) ? corridors.maintenance_queue : [],
            scaling,
            openAlex,
            strategicHubEvolution,
            safety: report.safety || {}
        };
    }

    window.StockPhotonicStock.sourceRegistry = {
        SOURCE_CATEGORIES,
        classifyUrl,
        toSourceReviewCategoryKey,
        buildWorkbenchModel
    };
})();
