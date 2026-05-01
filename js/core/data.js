(function () {
    async function fetchDatasets(cacheBust) {
        const [compRes, connRes] = await Promise.all([
            fetch(`data/companies.json?v=${cacheBust}`),
            fetch(`data/connections.json?v=${cacheBust}`)
        ]);

        if (!compRes.ok || !connRes.ok) {
            throw new Error('Dataset fetch failed');
        }

        return {
            companies: await compRes.json(),
            connections: await connRes.json()
        };
    }

    function deriveIndustryGroup(company, industryGroupRules) {
        if (!company) return 'Other';

        const sector = String(company.sector || '').toLowerCase();
        const descriptorText = [
            company.industry,
            company.name,
            company.ticker
        ].map(value => String(value || '').toLowerCase()).join(' ');

        const matchedRule = industryGroupRules.find(rule => {
            const sectorMatches = !rule.sectorKeywords?.length ||
                rule.sectorKeywords.some(keyword => sector.includes(keyword));
            const keywordMatches = rule.keywords.some(keyword => descriptorText.includes(keyword));
            return sectorMatches && keywordMatches;
        });

        return matchedRule?.group || company.industry || 'Other';
    }

    function normalizeCompany(company, industryGroupRules) {
        return {
            ...company,
            industryGroup: deriveIndustryGroup(company, industryGroupRules)
        };
    }

    function normalizeCompanies(companies, industryGroupRules) {
        return companies.map(company => normalizeCompany(company, industryGroupRules));
    }

    async function loadDatasets(cacheBust, industryGroupRules) {
        const dataset = await fetchDatasets(cacheBust);
        return {
            companies: normalizeCompanies(dataset.companies, industryGroupRules),
            connections: dataset.connections
        };
    }

    function createGraphIndex(companies, connections) {
        const degreeById = new Map();
        const adjacencyById = new Map();

        companies.forEach(company => {
            degreeById.set(company.id, 0);
            adjacencyById.set(company.id, []);
        });

        connections.forEach(connection => {
            if (!degreeById.has(connection.source) || !degreeById.has(connection.target)) return;
            degreeById.set(connection.source, degreeById.get(connection.source) + 1);
            degreeById.set(connection.target, degreeById.get(connection.target) + 1);
        });

        return {
            degreeById,
            adjacencyById
        };
    }

    function sumMarketCap(items) {
        return items.reduce((sum, item) => sum + (Number(item.market_cap) || 0), 0);
    }

    function getDatasetTrustMetrics(companies, connections) {
        const highConfidenceCount = connections.filter(connection => Number(connection.confidence) >= 4).length;
        const latestVerifiedDate = connections.reduce((latest, connection) => {
            const date = typeof connection.verified_date === 'string' ? connection.verified_date : '';
            return date > latest ? date : latest;
        }, '');

        return {
            companyCount: companies.length,
            connectionCount: connections.length,
            highConfidencePercent: connections.length ? Math.round((highConfidenceCount / connections.length) * 100) : 0,
            latestVerifiedDate
        };
    }

    window.StockPhotonicData = {
        fetchDatasets,
        deriveIndustryGroup,
        normalizeCompany,
        normalizeCompanies,
        loadDatasets,
        createGraphIndex,
        sumMarketCap,
        getDatasetTrustMetrics
    };
})();
