(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};
    const evidencePolicy = window.StockPhotonicStock.evidencePolicy || {};
    const ecosystemMatchCache = new WeakMap();
    const routeIndexCache = new WeakMap();

    const STRATEGIC_HUB_TICKERS = new Set(['NVDA', 'MSFT', 'AMZN', 'AVGO', 'JPM', 'XOM', 'LLY', 'GOOGL', 'AAPL', 'TSM']);
    const STRATEGIC_HUB_REASONS = {
        NVDA: 'it anchors AI accelerator demand across cloud, silicon, memory, power, and design-tool corridors',
        MSFT: 'it bridges cloud infrastructure, productivity software, enterprise SaaS, and AI platform demand',
        AMZN: 'it connects hyperscale cloud, retail, payments-adjacent infrastructure, and AI compute demand',
        AVGO: 'it links custom silicon, networking, cloud infrastructure, and semiconductor supply-chain exposure',
        JPM: 'it anchors bank, issuer, card-network, and commercial payments corridors',
        XOM: 'it concentrates energy-major exposure across upstream production, services, and industrial demand',
        LLY: 'it anchors pharmaceutical, PBM, insurance, and life-sciences adjacency in the healthcare graph',
        GOOGL: 'it connects search, cloud, AI infrastructure, advertising, devices, and enterprise platform competition',
        AAPL: 'it bridges consumer devices, silicon, services, mobile ecosystems, and platform competition',
        TSM: 'it anchors advanced-node foundry capacity behind AI, cloud, and semiconductor manufacturing corridors'
    };

    const ECOSYSTEMS = {
        ai_infrastructure: {
            key: 'ai_infrastructure',
            label: 'AI Infrastructure',
            shortLabel: 'AI Infra',
            color: '#ffd166',
            description: 'Edges whose existing relationship metadata, labels, or endpoint groups fit AI accelerators, cloud AI, memory, foundry, equipment, EDA, data-center, or power context.',
            relationshipTypes: ['ai_infrastructure', 'hyperscaler_cloud_customer', 'semiconductor_supply_chain', 'data_center_power'],
            rawTypes: ['ecosystem', 'partnership', 'supply'],
            industryGroups: ['AI Accelerators', 'Cloud Infrastructure', 'Memory / HBM', 'Foundry / Manufacturing', 'Semiconductor Equipment', 'EDA / Design Software'],
            sectors: ['AI / Semiconductors', 'Cloud / Big Tech', 'Consumer Mega-Caps'],
            keywords: ['ai infrastructure', 'ai accelerator', 'accelerator', 'gpu', 'training cluster', 'data center', 'hbm', 'custom ai', 'autonomous systems']
        },
        semiconductor_supply_chain: {
            key: 'semiconductor_supply_chain',
            label: 'Semiconductor Chain',
            shortLabel: 'Semi Chain',
            color: '#34d399',
            description: 'Edges already tagged or labeled around chip design, foundry, memory, equipment, HBM, lithography, wafer, and advanced-node manufacturing context.',
            relationshipTypes: ['semiconductor_supply_chain', 'supplier_customer', 'ai_infrastructure'],
            rawTypes: ['supply', 'ecosystem'],
            industryGroups: ['AI Accelerators', 'Memory / HBM', 'Foundry / Manufacturing', 'Semiconductor Equipment', 'EDA / Design Software'],
            sectors: ['AI / Semiconductors'],
            keywords: ['semiconductor', 'foundry', 'hbm', 'memory', 'lithography', 'wafer', 'fab', 'chip design', 'advanced-node', 'yield']
        },
        cloud_hyperscaler: {
            key: 'cloud_hyperscaler',
            label: 'Cloud / Hyperscaler',
            shortLabel: 'Cloud',
            color: '#7dd3fc',
            description: 'Edges whose existing metadata points to cloud, hyperscaler, enterprise platform, and cloud AI infrastructure context.',
            relationshipTypes: ['hyperscaler_cloud_customer', 'ai_infrastructure'],
            rawTypes: ['ecosystem', 'partnership', 'competitor'],
            industryGroups: ['Cloud Infrastructure', 'AI Accelerators'],
            sectors: ['Cloud / Big Tech', 'AI / Semiconductors'],
            keywords: ['cloud', 'hyperscale', 'hyperscaler', 'aws', 'azure', 'oci', 'cloud ai', 'data platform', 'cloud security']
        },
        financial_payments: {
            key: 'financial_payments',
            label: 'Financial / Payments',
            shortLabel: 'Payments',
            color: '#c084fc',
            description: 'Edges already grouped around payments, banks, exchanges, asset managers, insurance, and ownership or capital-market overlap context.',
            relationshipTypes: ['ownership_etf_overlap', 'curated_manual_relationship'],
            rawTypes: ['ecosystem', 'competitor', 'investment'],
            industryGroups: ['Payments Networks', 'Banks', 'Asset Managers', 'Exchanges / Market Infrastructure', 'Insurance'],
            sectors: ['Payments / Financial Infrastructure'],
            keywords: ['payment', 'payments', 'card', 'issuer', 'bank', 'banking', 'credit', 'network', 'equity stake', 'public equity stake']
        },
        energy_infrastructure: {
            key: 'energy_infrastructure',
            label: 'Energy Infrastructure',
            shortLabel: 'Energy',
            color: '#facc15',
            description: 'Edges whose existing labels, types, or endpoint groups fit power, grid, data-center energy, oil and gas, industrial, aerospace, or defense infrastructure context.',
            relationshipTypes: ['data_center_power', 'supplier_customer', 'curated_manual_relationship'],
            rawTypes: ['supply', 'ecosystem', 'competitor'],
            industryGroups: ['Energy Producers', 'Oilfield Services', 'Industrial Suppliers', 'Aerospace OEMs', 'Defense Contractors'],
            sectors: ['Energy / Industrials'],
            keywords: ['energy', 'oil', 'gas', 'power', 'grid', 'oilfield', 'industrial equipment', 'aerospace', 'defense']
        },
        healthcare_biotech: {
            key: 'healthcare_biotech',
            label: 'Healthcare / Biotech',
            shortLabel: 'Health',
            color: '#fb7185',
            description: 'Edges already grouped around PBM, managed care, medtech, life-sciences tools, pharma, biotech, and reimbursement context.',
            relationshipTypes: ['supplier_customer', 'strategic_partnership', 'curated_manual_relationship'],
            rawTypes: ['supply', 'ecosystem', 'partnership'],
            industryGroups: ['PBM / Pharmacy Benefits', 'Insurance / Managed Care', 'MedTech', 'Life Sciences Tools', 'Pharmaceuticals'],
            sectors: ['Healthcare / Pharma / PBM'],
            keywords: ['healthcare', 'pharma', 'pharmaceutical', 'biotech', 'pbm', 'formulary', 'reimbursement', 'life sciences', 'drug development', 'medtech']
        },
        enterprise_saas_workflow: {
            key: 'enterprise_saas_workflow',
            label: 'Enterprise SaaS / Workflow',
            shortLabel: 'SaaS',
            color: '#60a5fa',
            description: 'Edges whose existing metadata fits enterprise software, workflow, data platform, CRM, productivity, marketplace, security, or cloud platform context.',
            relationshipTypes: ['hyperscaler_cloud_customer', 'strategic_partnership', 'curated_manual_relationship'],
            rawTypes: ['ecosystem', 'partnership', 'competitor'],
            industryGroups: ['Cloud Infrastructure', 'E-Commerce'],
            sectors: ['Cloud / Big Tech'],
            keywords: ['enterprise', 'saas', 'workflow', 'crm', 'productivity', 'data platform', 'enterprise software', 'marketplace', 'security']
        }
    };

    const GUIDED_DISCOVERY_FLOWS = {
        ai_infrastructure: {
            key: 'ai_infrastructure',
            label: 'Start with AI Infrastructure',
            shortLabel: 'AI Infra',
            icon: 'fa-brain',
            color: ECOSYSTEMS.ai_infrastructure.color,
            ecosystemKey: 'ai_infrastructure',
            routeMode: 'ecosystem',
            intent: 'Shows visible edges already matching AI infrastructure metadata.'
        },
        semiconductor_chain: {
            key: 'semiconductor_chain',
            label: 'Explore Semiconductor Chain',
            shortLabel: 'Semi Chain',
            icon: 'fa-microchip',
            color: ECOSYSTEMS.semiconductor_supply_chain.color,
            ecosystemKey: 'semiconductor_supply_chain',
            routeMode: 'supply',
            intent: 'Starts with chip, foundry, memory, equipment, EDA, and supply-chain context already present in the graph.'
        },
        strongest_hubs: {
            key: 'strongest_hubs',
            label: 'Find Strongest Hubs',
            shortLabel: 'Hubs',
            icon: 'fa-circle-nodes',
            color: '#22d3ee',
            routeMode: 'strongest',
            intent: 'Highlights visible companies with the most visible relationships.'
        },
        source_backed: {
            key: 'source_backed',
            label: 'Follow Source-Backed Relationships',
            shortLabel: 'Sources',
            icon: 'fa-shield-halved',
            color: '#22d3ee',
            routeMode: 'sec',
            enablesSourceLens: true,
            intent: 'Highlights visible relationships with existing source evidence, with SEC-backed edges ranked first.'
        },
        evidence_gaps: {
            key: 'evidence_gaps',
            label: 'Review Evidence Gaps',
            shortLabel: 'Gaps',
            icon: 'fa-link-slash',
            color: '#f97316',
            enablesSourceLens: true,
            intent: 'Highlights high-value visible relationships that still lack source URLs or direct evidence.'
        },
        portfolio_exposure: {
            key: 'portfolio_exposure',
            label: 'Explore Portfolio Exposure',
            shortLabel: 'Portfolio',
            icon: 'fa-briefcase',
            color: '#fde68a',
            routeMode: 'portfolio',
            intent: 'Highlights visible edges touching an analyzed portfolio when portfolio tickers are present.'
        }
    };

    const GUIDED_DISCOVERY_SEQUENCE = [
        'ai_infrastructure',
        'semiconductor_chain',
        'strongest_hubs',
        'source_backed',
        'evidence_gaps',
        'portfolio_exposure'
    ];

    const RELATIONSHIP_TYPE_MEANINGS = {
        supplier_customer: 'Supply/customer category: the edge is categorized from existing relationship metadata as a supply-side or customer-context relationship.',
        strategic_partnership: 'Partnership category: the edge is categorized from existing metadata as collaboration, alliance, or partnership context.',
        competitor: 'Peer category: the edge is categorized as competitive or market-peer context.',
        hyperscaler_cloud_customer: 'Cloud ecosystem category: the edge is categorized from existing metadata as hyperscaler, cloud platform, or cloud-customer context.',
        semiconductor_supply_chain: 'Semiconductor chain category: the edge is categorized from existing metadata around chip design, foundry, memory, equipment, or manufacturing context.',
        ai_infrastructure: 'AI infrastructure category: the edge is categorized from existing metadata around accelerators, cloud AI, data-center, memory, or AI platform context.',
        data_center_power: 'Data-center/power category: the edge is categorized from existing metadata around data-center energy, power, grid, or utility context.',
        ownership_etf_overlap: 'Capital overlap category: the edge is categorized from existing metadata around ownership, investment, holder, index, or ETF overlap context.',
        sec_backed_preview: 'SEC preview category: the edge is review-only candidate context from the SEC preview layer, not production graph data.',
        curated_manual_relationship: 'Curated category: the edge remains a manually curated relationship in the static dataset and should be read with its source/confidence labels.'
    };

    const ECOSYSTEM_SEQUENCE = [
        'ai_infrastructure',
        'semiconductor_supply_chain',
        'cloud_hyperscaler',
        'financial_payments',
        'energy_infrastructure',
        'healthcare_biotech',
        'enterprise_saas_workflow'
    ];

    const SOURCE_STATE_META = {
        sec_backed: {
            key: 'sec_backed',
            label: 'SEC-backed',
            shortLabel: 'SEC',
            color: '#fbbf24',
            rank: 5
        },
        candidate_preview: {
            key: 'candidate_preview',
            label: 'Candidate preview',
            shortLabel: 'PREVIEW',
            color: '#67e8f9',
            rank: 2
        },
        source_attached: {
            key: 'source_attached',
            label: 'Sourced',
            shortLabel: 'SRC',
            color: '#22d3ee',
            rank: 4
        },
        stale_review: {
            key: 'stale_review',
            label: 'Stale review',
            shortLabel: 'STALE',
            color: '#fb923c',
            rank: 1
        },
        missing_source: {
            key: 'missing_source',
            label: 'Evidence pending',
            shortLabel: 'PEND',
            color: '#f97316',
            rank: 0
        }
    };

    const EVIDENCE_TIER_META = evidencePolicy.TIERS || {
        verified: {
            key: 'verified',
            label: 'Verified',
            shortLabel: 'VERIFIED',
            color: '#7cffc8',
            rank: 4
        },
        strong_inferred: {
            key: 'strong_inferred',
            label: 'Strong inferred',
            shortLabel: 'STRONG',
            color: '#7dd3fc',
            rank: 3
        },
        context_only: {
            key: 'context_only',
            label: 'Context only',
            shortLabel: 'CONTEXT',
            color: '#c4b5fd',
            rank: 2
        },
        needs_review: {
            key: 'needs_review',
            label: 'Needs review',
            shortLabel: 'REVIEW',
            color: '#fb923c',
            rank: 1
        }
    };

    function normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function unique(items) {
        return [...new Set(items.filter(Boolean))];
    }

    function getEcosystemDefinitions() {
        return ECOSYSTEM_SEQUENCE.map(key => ECOSYSTEMS[key]);
    }

    function getEcosystemDefinition(key) {
        return ECOSYSTEMS[key] || null;
    }

    function getGuidedDiscoveryFlows() {
        return GUIDED_DISCOVERY_SEQUENCE.map(key => GUIDED_DISCOVERY_FLOWS[key]);
    }

    function getGuidedDiscoveryFlow(key) {
        return GUIDED_DISCOVERY_FLOWS[key] || null;
    }

    function getRelationshipTypeMeaning(connectionOrType, context = {}) {
        const key = typeof connectionOrType === 'string'
            ? connectionOrType
            : context.getRelationshipTypeKey?.(connectionOrType) || connectionOrType?.relationship_type || connectionOrType?.type;
        return RELATIONSHIP_TYPE_MEANINGS[key] || 'Relationship category: this is a display taxonomy derived from the existing static edge metadata.';
    }

    function buildGraphIntelligenceModel(context) {
        const overlay = context.activeEcosystemOverlayKey
            ? buildEcosystemOverlay(context.activeEcosystemOverlayKey, context)
            : null;
        const selectedStory = context.selectedNode
            ? buildSelectedNodeStory(context.selectedNode, context)
            : null;
        const relationshipExplanation = context.selectedRelationshipLink
            ? buildRelationshipExplanation(context.selectedRelationshipLink, {
                ...context,
                graphIntelligenceModel: { ...(context.graphIntelligenceModel || {}), overlay }
            })
            : null;
        const sourceCoverage = buildSourceCoverageSummary(context);
        const guidedDiscovery = buildGuidedDiscoveryModel(context.activeGuidedDiscoveryKey, {
            ...context,
            overlay
        });
        const evidenceGaps = buildEvidenceGapDiscovery(context);
        const defaultDiscovery = buildDefaultDiscoveryModel(context);

        return {
            overlay,
            selectedStory,
            relationshipExplanation,
            sourceCoverage,
            guidedDiscovery,
            evidenceGaps,
            defaultDiscovery
        };
    }

    function buildEcosystemOverlay(key, context) {
        const ecosystem = getEcosystemDefinition(key);
        if (!ecosystem) return null;

        const linkMatches = (context.visibleLinks || [])
            .map(link => {
                const match = getLinkEcosystemMatch(link, ecosystem, context);
                return match.matched ? { link, match } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.match.score - a.match.score || getStrength(b.link) - getStrength(a.link));

        const nodeIds = new Set();
        linkMatches.forEach(item => {
            if (item.link.source) nodeIds.add(item.link.source.id);
            if (item.link.target) nodeIds.add(item.link.target.id);
        });

        const nodes = (context.visibleNodes || []).filter(node => nodeIds.has(node.id));
        const relationshipTypes = countBy(linkMatches, item =>
            context.getRelationshipTypeLabel?.(item.link) ||
            context.formatConnectionType?.(item.link?.type || 'Relationship') ||
            'Relationship'
        );
        const strongest = linkMatches[0]?.link || null;
        const evidence = summarizeLinksEvidence(linkMatches.map(item => item.link), context);
        const topHubs = getTopNodesForLinks(nodes, linkMatches.map(item => item.link), context, 4);

        return {
            ...ecosystem,
            nodes,
            links: linkMatches.map(item => item.link),
            matches: linkMatches,
            nodeIds,
            linkKeys: new Set(linkMatches.map(item => item.link.key)),
            relationshipTypes,
            strongest,
            evidence,
            topHubs,
            reason: getOverlayReason(linkMatches, ecosystem)
        };
    }

    function getOverlayReason(linkMatches, ecosystem) {
        if (!linkMatches.length) return 'No visible edge metadata currently matches this overlay.';
        const topReasons = countBy(linkMatches, item => item.match.reason).slice(0, 2);
        return topReasons.map(([reason, count]) => `${count} via ${reason}`).join(', ');
    }

    function buildGuidedDiscoveryModel(key, context) {
        const flow = getGuidedDiscoveryFlow(key);
        if (!flow) return null;

        if (flow.ecosystemKey) {
            const overlay = context.overlay?.key === flow.ecosystemKey
                ? context.overlay
                : buildEcosystemOverlay(flow.ecosystemKey, context);
            return buildGuidedDiscoveryResult(flow, overlay.nodes, overlay.links, {
                summary: overlay.links.length
                    ? `${overlay.label} uses ${overlay.links.length} visible edge${overlay.links.length === 1 ? '' : 's'} derived from existing edge metadata.`
                    : `No visible edge currently matches ${overlay.label} under the active filters.`,
                evidence: overlay.evidence,
                relationshipTypes: overlay.relationshipTypes,
                topHubs: overlay.topHubs,
                emptyReason: overlay.links.length ? '' : 'Try clearing filters or lowering the signal threshold.'
            });
        }

        if (flow.key === 'strongest_hubs') {
            const topHubs = getTopNodesForLinks(context.visibleNodes || [], context.visibleLinks || [], context, 6);
            const nodeIds = new Set(topHubs.map(item => item.node.id));
            const links = (context.visibleLinks || [])
                .filter(link => nodeIds.has(link.source?.id) || nodeIds.has(link.target?.id))
                .sort((a, b) => getStrength(b) - getStrength(a))
                .slice(0, 14);
            return buildGuidedDiscoveryResult(flow, topHubs.map(item => item.node), links, {
                summary: topHubs.length
                    ? `The top visible hubs are ranked by visible relationship count, then graph degree and company rank.`
                    : 'No visible hubs are available under the active filters.',
                topHubs,
                evidence: summarizeLinksEvidence(links, context),
                emptyReason: topHubs.length ? '' : 'Clear filters to restore the broader hub view.'
            });
        }

        if (flow.key === 'source_backed') {
            const links = (context.visibleLinks || [])
                .filter(link => context.relationshipHasSourceEvidence?.(link) || context.isSecBackedConnection?.(link))
                .sort((a, b) =>
                    Number(Boolean(context.isSecBackedConnection?.(b))) - Number(Boolean(context.isSecBackedConnection?.(a))) ||
                    getStrength(b) - getStrength(a)
                )
                .slice(0, 18);
            const nodes = uniqueNodes(links.flatMap(link => [link.source, link.target]));
            return buildGuidedDiscoveryResult(flow, nodes, links, {
                summary: links.length
                    ? `Source-backed discovery highlights visible edges with attached evidence; SEC-backed production edges are ranked first.`
                    : 'No sourced visible relationships are available under the active filters.',
                topHubs: getTopNodesForLinks(nodes, links, context, 4),
                evidence: summarizeLinksEvidence(links, context),
                emptyReason: links.length ? '' : 'Turn off restrictive filters or use the source coverage lens to inspect pending evidence.'
            });
        }

        if (flow.key === 'evidence_gaps') {
            const links = getHighValueUnsourcedLinks(context.visibleLinks || [], context, 18);
            const nodes = uniqueNodes(links.flatMap(link => [link.source, link.target]));
            return buildGuidedDiscoveryResult(flow, nodes, links, {
                summary: links.length
                    ? `Evidence-gap discovery ranks visible unsourced edges by strength, confidence, and endpoint graph degree.`
                    : 'No visible unsourced production relationships are available under the active filters.',
                topHubs: getTopNodesForLinks(nodes, links, context, 4),
                evidence: summarizeLinksEvidence(links, context),
                relationshipTypes: countBy(links, link => context.getRelationshipTypeLabel?.(link) || link.type || 'Relationship'),
                emptyReason: links.length ? '' : 'Use the full Source Workbench preflight report for production-wide gaps.'
            });
        }

        if (flow.key === 'portfolio_exposure') {
            const portfolioEdgeKeys = context.portfolioEdgeKeys || new Set();
            const links = (context.visibleLinks || [])
                .filter(link => portfolioEdgeKeys.has(link.key))
                .sort((a, b) => getStrength(b) - getStrength(a));
            const nodes = uniqueNodes([
                ...(context.matchedPortfolioNodes || []),
                ...links.flatMap(link => [link.source, link.target])
            ]);
            return buildGuidedDiscoveryResult(flow, nodes, links, {
                summary: links.length
                    ? `Portfolio discovery highlights visible relationships touching the analyzed portfolio.`
                    : 'Analyze portfolio tickers first, then this guide can highlight the matching exposure edges.',
                topHubs: getTopNodesForLinks(nodes, links, context, 4),
                evidence: summarizeLinksEvidence(links, context),
                emptyReason: links.length ? '' : 'Add tickers in Portfolio Exposure and click Analyze Portfolio.'
            });
        }

        return null;
    }

    function buildGuidedDiscoveryResult(flow, nodes, links, options = {}) {
        const safeNodes = uniqueNodes(nodes || []);
        const safeLinks = Array.isArray(links) ? links.filter(Boolean) : [];
        return {
            flow,
            key: flow.key,
            label: flow.label,
            shortLabel: flow.shortLabel,
            color: flow.color,
            routeMode: flow.routeMode || '',
            nodes: safeNodes,
            links: safeLinks,
            nodeIds: new Set(safeNodes.map(node => node.id)),
            linkKeys: new Set(safeLinks.map(link => link.key)),
            summary: options.summary || flow.intent || '',
            emptyReason: options.emptyReason || '',
            topHubs: options.topHubs || [],
            evidence: options.evidence || { total: safeLinks.length, sourced: 0, sourcedRatio: 0, secBacked: 0, missing: safeLinks.length, stale: 0 },
            relationshipTypes: options.relationshipTypes || [],
            intent: flow.intent || ''
        };
    }

    function buildDefaultDiscoveryModel(context) {
        const visibleNodes = context.visibleNodes || [];
        const visibleLinks = context.visibleLinks || [];
        const topHubs = getTopNodesForLinks(visibleNodes, visibleLinks, context, 4);
        const bridgeNodes = getBridgeNodes(visibleNodes, visibleLinks, context, 3);
        const clusterAnchors = getClusterAnchorNodes(visibleNodes, context, 3);
        const strategicHubs = getStrategicHubProfiles(visibleNodes, context, 4);
        const highlightedNodes = uniqueNodes([
            ...strategicHubs.map(item => item.node),
            ...topHubs.map(item => item.node),
            ...bridgeNodes.map(item => item.node),
            ...clusterAnchors.map(item => item.node)
        ]).slice(0, 8);
        return {
            topHubs,
            bridgeNodes,
            clusterAnchors,
            strategicHubs,
            nodeIds: new Set(highlightedNodes.map(node => node.id)),
            evidence: buildSourceCoverageSummary(context),
            highlightedNodes
        };
    }

    function buildEvidenceGapDiscovery(context) {
        const productionLinks = context.links || [];
        const visibleLinks = context.visibleLinks || [];
        const candidatePreviewCount = Number(context.secPreviewCandidateCount ?? context.secPreviewLinkCount ?? 0) || 0;
        const sourced = productionLinks.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = productionLinks.filter(link => context.isSecBackedConnection?.(link)).length;
        const staleReview = productionLinks.filter(link => context.getRelationshipSourceAgeInfo?.(link)?.key === 'stale_review_recommended').length;
        const missing = productionLinks.filter(link => !context.relationshipHasSourceEvidence?.(link));
        const highValueUnsourced = getHighValueUnsourcedLinks(productionLinks, context, 10);
        const visibleHighValueUnsourced = getHighValueUnsourcedLinks(visibleLinks, context, 8);
        const fastTrackUnsourced = getFastTrackSourceCoverageLinks(productionLinks, context, 10);
        const visibleFastTrackUnsourced = getFastTrackSourceCoverageLinks(visibleLinks, context, 6);
        const manualReviewLinks = getManualReviewLinks(productionLinks, context, 12);
        const relationshipTypeGaps = countBy(missing, link => context.getRelationshipTypeLabel?.(link) || link.type || 'Relationship')
            .map(([label, count]) => {
                const totalForType = productionLinks.filter(link => (context.getRelationshipTypeLabel?.(link) || link.type || 'Relationship') === label).length;
                return {
                    label,
                    count,
                    total: totalForType,
                    sourcedRatio: totalForType ? (totalForType - count) / totalForType : 0
                };
            });
        const tierCounts = countBy(productionLinks, link => getLinkEvidencePolicy(link, context).tier?.key || 'needs_review');
        const trustedClassCounts = countBy(productionLinks, link => getLinkEvidencePolicy(link, context).trustedClassLabel || 'Unclassified')
            .filter(([label]) => label !== 'Unclassified');

        return {
            total: productionLinks.length,
            sourced,
            sourcedRatio: productionLinks.length ? sourced / productionLinks.length : 0,
            secBacked,
            staleReview,
            candidatePreviewCount,
            missingCount: missing.length,
            highValueUnsourced,
            visibleHighValueUnsourced,
            fastTrackUnsourced,
            visibleFastTrackUnsourced,
            manualReviewLinks,
            relationshipTypeGaps,
            tierCounts,
            trustedClassCounts,
            fastTrackCount: fastTrackUnsourced.length,
            manualReviewCount: manualReviewLinks.length
        };
    }

    function getHighValueUnsourcedLinks(sourceLinks, context, limit = 8) {
        return [...(sourceLinks || [])]
            .filter(link => !context.relationshipHasSourceEvidence?.(link))
            .map(link => ({
                link,
                score: getStrength(link) * 4 +
                    ((Number(link.confidence_score ?? link.confidence) || 0) / 5) +
                    (((link.source?.degree || 0) + (link.target?.degree || 0)) * 0.025)
            }))
            .sort((a, b) => b.score - a.score || getStrength(b.link) - getStrength(a.link))
            .slice(0, limit)
            .map(item => item.link);
    }

    function getFastTrackSourceCoverageLinks(sourceLinks, context, limit = 8) {
        return [...(sourceLinks || [])]
            .filter(link => !context.relationshipHasSourceEvidence?.(link))
            .filter(link => getLinkEvidencePolicy(link, context).fastTrackVisibility)
            .sort((a, b) => getPolicyLinkScore(b, context) - getPolicyLinkScore(a, context))
            .slice(0, limit);
    }

    function getManualReviewLinks(sourceLinks, context, limit = 8) {
        return [...(sourceLinks || [])]
            .filter(link => getLinkEvidencePolicy(link, context).tier?.key === 'needs_review')
            .sort((a, b) => getPolicyLinkScore(b, context) - getPolicyLinkScore(a, context))
            .slice(0, limit);
    }

    function getPolicyLinkScore(link, context) {
        return getStrength(link) * 4 +
            ((Number(link.confidence_score ?? link.confidence) || 0) / 5) +
            (((link.source?.degree || 0) + (link.target?.degree || 0)) * 0.025);
    }

    function getTopNodesForLinks(sourceNodes, sourceLinks, context, limit = 4) {
        const visibleDegree = new Map();
        (sourceLinks || []).forEach(link => {
            if (link?.source) visibleDegree.set(link.source.id, (visibleDegree.get(link.source.id) || 0) + 1);
            if (link?.target) visibleDegree.set(link.target.id, (visibleDegree.get(link.target.id) || 0) + 1);
        });

        return [...(sourceNodes || [])]
            .filter(Boolean)
            .map(node => ({
                node,
                visibleDegree: visibleDegree.get(node.id) || 0,
                degree: node.degree || context.adjacencyById?.get(node.id)?.length || 0,
                role: getNodeRole(node, context)
            }))
            .filter(item => item.visibleDegree > 0 || item.degree > 0)
            .sort((a, b) =>
                b.visibleDegree - a.visibleDegree ||
                b.degree - a.degree ||
                ((a.node.rank || 9999) - (b.node.rank || 9999)) ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            )
            .slice(0, limit);
    }

    function getBridgeNodes(sourceNodes, sourceLinks, context, limit = 3) {
        const nodeIds = new Set((sourceNodes || []).map(node => node.id));
        const bridgeMap = new Map((sourceNodes || []).map(node => [node.id, { node, sectors: new Set(), groups: new Set(), degree: 0 }]));

        (sourceLinks || []).forEach(link => {
            [
                [link.source, link.target],
                [link.target, link.source]
            ].forEach(([node, other]) => {
                if (!node || !other || !nodeIds.has(node.id)) return;
                const entry = bridgeMap.get(node.id);
                if (!entry) return;
                entry.degree += 1;
                if (other.sector && other.sector !== node.sector) entry.sectors.add(other.sector);
                const otherGroup = context.getCompanyIndustryGroup?.(other);
                const nodeGroup = context.getCompanyIndustryGroup?.(node);
                if (otherGroup && otherGroup !== nodeGroup) entry.groups.add(otherGroup);
            });
        });

        return [...bridgeMap.values()]
            .filter(item => item.degree > 0 && (item.sectors.size > 0 || item.groups.size > 1))
            .sort((a, b) =>
                b.sectors.size - a.sectors.size ||
                b.groups.size - a.groups.size ||
                b.degree - a.degree ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            )
            .slice(0, limit);
    }

    function getClusterAnchorNodes(sourceNodes, context, limit = 3) {
        return [...(sourceNodes || [])]
            .sort((a, b) =>
                (b.degree || context.adjacencyById?.get(b.id)?.length || 0) -
                (a.degree || context.adjacencyById?.get(a.id)?.length || 0)
            )
            .slice(0, Math.max(12, limit * 8))
            .map(node => {
                const cluster = typeof context.getNodeCluster === 'function'
                    ? context.getNodeCluster(node.id)
                    : { clusterNodes: [], clusterStrength: 0 };
                return {
                    node,
                    memberCount: cluster?.clusterNodes?.length || 0,
                    clusterStrength: cluster?.clusterStrength || 0
                };
            })
            .filter(item => item.memberCount > 1)
            .sort((a, b) =>
                b.memberCount - a.memberCount ||
                b.clusterStrength - a.clusterStrength ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            )
            .slice(0, limit);
    }

    function getDominantEcosystemsForNode(node, context) {
        if (!node) return [];
        return getEcosystemDefinitions()
            .map(ecosystem => {
                const matches = (context.adjacencyById?.get(node.id) || [])
                    .map(item => {
                        const match = getCachedLinkEcosystemMatch(item.link, ecosystem, context);
                        return match.matched ? { ...item, match } : null;
                    })
                    .filter(Boolean);
                const totalStrength = matches.reduce((sum, item) => sum + getStrength(item.link), 0);
                return {
                    ecosystem,
                    key: ecosystem.key,
                    label: ecosystem.label,
                    shortLabel: ecosystem.shortLabel,
                    color: ecosystem.color,
                    count: matches.length,
                    totalStrength,
                    avgStrength: matches.length ? totalStrength / matches.length : 0,
                    matches
                };
            })
            .filter(item => item.count > 0)
            .sort((a, b) =>
                b.count - a.count ||
                b.avgStrength - a.avgStrength ||
                a.label.localeCompare(b.label)
            );
    }

    function getLinkEcosystemKeys(link, context) {
        return getEcosystemDefinitions()
            .filter(ecosystem => getCachedLinkEcosystemMatch(link, ecosystem, context).matched)
            .map(ecosystem => ecosystem.key);
    }

    function getLinkEcosystemMatch(link, ecosystem, context) {
        return getCachedLinkEcosystemMatch(link, ecosystem, context);
    }

    function getCachedLinkEcosystemMatch(link, ecosystem, context) {
        if (!link || !ecosystem) return { matched: false, score: 0, reason: 'no link' };
        let cache = ecosystemMatchCache.get(link);
        if (!cache) {
            cache = new Map();
            ecosystemMatchCache.set(link, cache);
        }
        if (cache.has(ecosystem.key)) return cache.get(ecosystem.key);
        const match = computeLinkEcosystemMatch(link, ecosystem, context);
        cache.set(ecosystem.key, match);
        return match;
    }

    function computeLinkEcosystemMatch(link, ecosystem, context) {

        const typeKey = normalizeText(context.getRelationshipTypeKey?.(link) || link.relationship_type || link.type);
        const rawType = normalizeText(link.raw_type || link.type);
        const typeLabel = normalizeText(context.getRelationshipTypeLabel?.(link));
        const sourceGroup = normalizeText(context.getCompanyIndustryGroup?.(link.source));
        const targetGroup = normalizeText(context.getCompanyIndustryGroup?.(link.target));
        const sourceSector = normalizeText(link.source?.sector);
        const targetSector = normalizeText(link.target?.sector);
        const text = normalizeText([
            link.label,
            link.provenance,
            link.relationship_summary,
            link.evidence_snippet,
            link.source_label,
            link.type,
            link.relationship_type,
            typeLabel,
            link.source?.industry,
            link.target?.industry,
            link.source?.name,
            link.target?.name
        ].join(' '));

        let score = 0;
        const reasons = [];
        if (ecosystem.relationshipTypes.map(normalizeText).includes(typeKey)) {
            score += 5;
            reasons.push('relationship type');
        }
        if (ecosystem.rawTypes.map(normalizeText).some(type => rawType === type || rawType.includes(type))) {
            score += 2;
            reasons.push('raw edge type');
        }
        const keywordHits = ecosystem.keywords.filter(keyword => text.includes(normalizeText(keyword)));
        if (keywordHits.length) {
            score += Math.min(4, keywordHits.length * 2);
            reasons.push('edge label');
        }

        const groupMatches = [sourceGroup, targetGroup]
            .filter(group => ecosystem.industryGroups.map(normalizeText).includes(group)).length;
        const sectorMatches = [sourceSector, targetSector]
            .filter(sector => ecosystem.sectors.map(normalizeText).includes(sector)).length;
        const competitorOnly = typeKey === 'competitor' && !keywordHits.length && !ecosystem.rawTypes.map(normalizeText).includes('competitor');

        if (!competitorOnly && score > 0 && groupMatches >= 2) {
            score += 2;
            reasons.push('endpoint groups');
        } else if (!competitorOnly && groupMatches === 1 && score > 0) {
            score += 1;
        }

        if (!competitorOnly && sectorMatches >= 2 && score > 0) score += 1;

        return {
            matched: score > 0,
            score,
            reason: unique(reasons).join(' + ') || 'edge metadata'
        };
    }

    function buildSelectedNodeStory(node, context) {
        const items = context.adjacencyById?.get(node.id) || [];
        const visibleItems = items.filter(item => context.visibleLinkKeys?.has(item.link.key));
        const activeItems = visibleItems.length ? visibleItems : items;
        const degree = items.length;
        const totalStrength = activeItems.reduce((sum, item) => sum + getStrength(item.link), 0);
        const avgStrength = activeItems.length ? totalStrength / activeItems.length : 0;
        const typeCounts = countBy(activeItems, item => context.getRelationshipTypeLabel?.(item.link) || item.link?.type || 'Relationship');
        const sectorCounts = countBy(activeItems, item => item.node?.sector || 'Other');
        const industryCounts = countBy(activeItems, item => context.getCompanyIndustryGroup?.(item.node) || item.node?.industry || 'Other');
        const ecosystems = getDominantEcosystemsForNode(node, context);
        const sourceSummary = summarizeLinksEvidence(items.map(item => item.link), context);
        const cluster = buildClusterStory(node, context);
        const strategicHubProfile = getStrategicHubProfile(node, context);
        const role = getNodeRole(node, context);
        const strongest = [...items].sort((a, b) => getStrength(b.link) - getStrength(a.link))[0] || null;
        const bridgeSectorCount = sectorCounts.filter(([sector]) => sector && sector !== node.sector).length;

        return {
            node,
            degree,
            visibleDegree: visibleItems.length,
            avgStrength,
            typeCounts,
            sectorCounts,
            industryCounts,
            ecosystems,
            primaryEcosystem: ecosystems[0] || null,
            sourceSummary,
            cluster,
            strategicHubProfile,
            role,
            strongest,
            bridgeSectorCount,
            headline: buildSelectedNodeHeadline(node, {
                degree,
                ecosystems,
                strategicHubProfile,
                role,
                typeCounts,
                bridgeSectorCount
            })
        };
    }

    function buildSelectedNodeHeadline(node, model) {
        const ticker = node.ticker || node.name || 'Selected company';
        const ecosystem = model.ecosystems[0]?.label;
        const dominantType = model.typeCounts[0]?.[0];
        if (model.strategicHubProfile?.isStrategic) {
            return `${ticker} matters as a ${model.strategicHubProfile.primaryRoleLabel.toLowerCase()} because ${model.strategicHubProfile.primaryReason}.`;
        }
        if (ecosystem && model.ecosystems[0].count >= 2) {
            return `${ticker} is prominent in ${ecosystem} through ${model.ecosystems[0].count} direct edge${model.ecosystems[0].count === 1 ? '' : 's'}.`;
        }
        if (model.role.key === 'bridge') {
            return `${ticker} acts as a bridge because its visible neighborhood reaches ${model.bridgeSectorCount} outside sector${model.bridgeSectorCount === 1 ? '' : 's'}.`;
        }
        if (dominantType) {
            return `${ticker} is mostly explained by ${dominantType.toLowerCase()} relationships in the loaded graph.`;
        }
        return `${ticker} has limited visible relationship context in the current graph filters.`;
    }

    function buildClusterStory(node, context) {
        const cluster = typeof context.getNodeCluster === 'function'
            ? context.getNodeCluster(node.id)
            : { clusterItems: [], clusterNodes: [] };
        const clusterNodes = cluster?.clusterNodes || [];
        const nodeIds = new Set(clusterNodes.map(item => item.id));
        const clusterLinks = (context.links || []).filter(link => nodeIds.has(link.source?.id) && nodeIds.has(link.target?.id));
        const strongestHub = [...clusterNodes].sort((a, b) => (b.degree || 0) - (a.degree || 0) || String(a.ticker || '').localeCompare(String(b.ticker || '')))[0] || node;
        const dominantTypes = countBy(clusterLinks, link => context.getRelationshipTypeLabel?.(link) || link.type || 'Relationship');
        const industryGroups = countBy(clusterNodes, clusterNode => context.getCompanyIndustryGroup?.(clusterNode) || clusterNode.industry || 'Other');
        const ecosystemCounts = countBy(clusterLinks.flatMap(link => getLinkEcosystemKeys(link, context)), key => getEcosystemDefinition(key)?.label || key);
        const evidence = summarizeLinksEvidence(clusterLinks, context);

        return {
            memberCount: clusterNodes.length,
            edgeCount: clusterLinks.length,
            strongestHub,
            dominantTypes,
            industryGroups,
            ecosystemCounts,
            evidence,
            clusterStrength: cluster?.clusterStrength || 0
        };
    }

    function buildRelationshipExplanation(link, context) {
        if (!link) return null;
        const source = link.source || {};
        const target = link.target || {};
        const typeLabel = context.getRelationshipTypeLabel?.(link) || context.formatConnectionType?.(link.type || 'Relationship') || 'Relationship';
        const confidence = context.getRelationshipConfidenceTier?.(link) || { label: 'Evidence pending', shortLabel: 'PENDING', key: 'pending' };
        const sourceStatus = context.getRelationshipSourceStatus?.(link) || { label: 'Evidence pending', shortLabel: 'PENDING', key: 'missing_source' };
        const sourceAge = context.getRelationshipSourceAgeInfo?.(link) || { label: 'No verified date', shortLabel: 'NO DATE', key: 'no_verified_date' };
        const diversity = context.getSourceHostDiversity?.(link) || { primaryCategory: null, hostCount: 0, categoryCount: 0 };
        const evidenceCount = Number(context.getRelationshipEvidenceCount?.(link) || link.evidence_count || 0);
        const evidencePolicy = getLinkEvidencePolicy(link, context);
        const ecosystems = getLinkEcosystemKeys(link, context).map(getEcosystemDefinition).filter(Boolean);
        const sameSector = source.sector && source.sector === target.sector;
        const sourceGroup = context.getCompanyIndustryGroup?.(source);
        const targetGroup = context.getCompanyIndustryGroup?.(target);
        const sameGroup = sourceGroup && sourceGroup === targetGroup;

        const pairLabel = `${source.ticker || source.name || 'Source'} to ${target.ticker || target.name || 'Target'}`;
        const summary = link.relationship_summary || link.label || 'Relationship type from curated dataset.';
        const pathExplanation = `${pairLabel} is a direct ${typeLabel.toLowerCase()} edge in the static production graph.`;
        const ecosystemExplanation = ecosystems.length
            ? `Overlay fit: ${ecosystems.map(item => item.label).join(', ')} based on the edge type, label, and endpoint metadata already in the dataset.`
            : sameGroup
                ? `Shared context: both endpoints sit in ${sourceGroup}.`
                : sameSector
                    ? `Shared context: both endpoints sit in ${source.sector}.`
                    : 'Shared context: this edge bridges different visible sector or industry groups.';
        const trustExplanation = evidencePolicy.explanation ||
            (context.isSecBackedConnection?.(link)
                ? 'Evidence state: SEC-backed production edge.'
                : `${sourceStatus.label}; ${confidence.label}; ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}.`);
        const typeMeaning = getRelationshipTypeMeaning(link, context);
        const sourceExplanation = buildSourceExplanation({
            sourceStatus,
            sourceAge,
            diversity,
            evidenceCount,
            secBacked: Boolean(context.isSecBackedConnection?.(link)),
            evidencePolicy
        });
        const routeContext = context.activeRelationshipRoute?.linkKeys?.has(link.key)
            ? `This edge is currently part of the active ${context.activeRelationshipRoute.label || 'relationship route'}.`
            : context.activeRelationshipRoute
                ? `The active ${context.activeRelationshipRoute.label || 'relationship route'} is visible, but this edge is outside that route.`
                : '';
        const overlayContext = context.graphIntelligenceModel?.overlay?.linkKeys?.has(link.key)
            ? `This edge is highlighted by the active ${context.graphIntelligenceModel.overlay.label} overlay.`
            : ecosystems.length
                ? `This edge can appear in ${ecosystems.map(item => item.label).join(', ')} discovery based on loaded metadata.`
                : '';

        return {
            link,
            pairLabel,
            typeLabel,
            summary,
            pathExplanation,
            ecosystemExplanation,
            trustExplanation,
            typeMeaning,
            sourceExplanation,
            routeContext,
            overlayContext,
            confidence,
            sourceStatus,
            sourceAge,
            diversity,
            evidenceCount,
            evidencePolicy,
            ecosystems
        };
    }

    function buildSourceExplanation(details) {
        if (details.evidencePolicy?.tier?.key === 'strong_inferred') {
            return `Source-confidence: ${details.evidencePolicy.explanation}`;
        }
        if (details.evidencePolicy?.tier?.key === 'context_only') {
            return `Source-confidence: context-only enrichment; ${details.evidencePolicy.explanation}`;
        }
        if (details.evidencePolicy?.tier?.key === 'needs_review' && details.evidencePolicy?.candidate) {
            return 'Source-confidence: review-only candidate evidence; manual promotion review is required.';
        }
        if (details.secBacked) {
            return `Source-confidence: SEC-backed production edge with ${details.evidenceCount} evidence item${details.evidenceCount === 1 ? '' : 's'}.`;
        }
        if (details.sourceStatus?.key === 'candidate_preview') {
            return 'Source-confidence: candidate or preview evidence only; it is not production graph data until manually promoted.';
        }
        if (details.sourceStatus?.key === 'missing_source') {
            return 'Source-confidence: no source URL is attached yet, so the graph keeps this relationship in evidence-pending review state.';
        }
        const hostText = details.diversity?.hostCount
            ? `${details.diversity.hostCount} source host${details.diversity.hostCount === 1 ? '' : 's'}`
            : 'source URL attached';
        return `Source-confidence: ${details.sourceStatus?.label || 'Source attached'} with ${hostText}; ${details.sourceAge?.label || 'date state unavailable'}.`;
    }

    function buildRoute(mode, context) {
        const start = context.selectedNode || context.selectedRelationshipLink?.source || null;
        if (!start) {
            return emptyRoute(mode, 'Select a company before tracing a route.');
        }

        if (mode === 'shared' || mode === 'hidden') {
            const sharedRoute = buildSharedExposureRoute(start, context);
            if (sharedRoute.linkKeys.size) return sharedRoute;
        }

        const ecosystemKey = routeModeToEcosystemKey(mode, context);
        const routeLinks = getRouteEligibleLinks(mode, ecosystemKey, context);
        const route = buildGreedyRoute(start, routeLinks, {
            mode,
            ecosystemKey,
            maxSteps: mode === 'strongest' ? 4 : 5,
            context
        });

        if (!route.linkKeys.size && mode !== 'strongest') {
            return buildGreedyRoute(start, context.visibleLinks || [], {
                mode: 'strongest',
                fallbackLabel: getRouteLabel(mode, ecosystemKey, context),
                maxSteps: 3,
                context
            });
        }
        return route;
    }

    function emptyRoute(mode, emptyReason) {
        return {
            mode,
            label: getRouteLabel(mode),
            emptyReason,
            nodes: [],
            links: [],
            nodeIds: new Set(),
            linkKeys: new Set(),
            confidence: 'pending'
        };
    }

    function buildSharedExposureRoute(start, context) {
        const shared = typeof context.getSharedConnections === 'function'
            ? context.getSharedConnections(start.id)
            : [];
        const target = shared.find(item => !item.directlyConnected) || shared[0];
        const sharedNeighbor = target?.sharedNeighbors?.[0]?.node || null;
        if (!target?.node || !sharedNeighbor) return emptyRoute('shared', 'No shared exposure path is visible for this company.');

        const first = findLinkBetween(start.id, sharedNeighbor.id, context);
        const second = findLinkBetween(sharedNeighbor.id, target.node.id, context);
        const links = [first, second].filter(Boolean);
        const nodes = uniqueNodes([start, sharedNeighbor, target.node]);

        return {
            mode: 'shared',
            label: 'Shared Exposure Route',
            nodes,
            links,
            nodeIds: new Set(nodes.map(node => node.id)),
            linkKeys: new Set(links.map(link => link.key)),
            explanation: `${start.ticker || start.name} and ${target.node.ticker || target.node.name} share exposure through ${sharedNeighbor.ticker || sharedNeighbor.name}.`,
            confidence: links.length >= 2 ? 'direct-two-hop' : 'partial'
        };
    }

    function buildGreedyRoute(start, eligibleLinks, options) {
        const context = options.context || {};
        const linksByNodeId = new Map();
        eligibleLinks.forEach(link => {
            if (!link?.source || !link?.target) return;
            if (!linksByNodeId.has(link.source.id)) linksByNodeId.set(link.source.id, []);
            if (!linksByNodeId.has(link.target.id)) linksByNodeId.set(link.target.id, []);
            linksByNodeId.get(link.source.id).push(link);
            linksByNodeId.get(link.target.id).push(link);
        });

        const nodes = [start];
        const links = [];
        const visitedNodeIds = new Set([start.id]);
        const usedLinkKeys = new Set();
        let current = start;

        for (let step = 0; step < (options.maxSteps || 4); step++) {
            const nextLink = (linksByNodeId.get(current.id) || [])
                .filter(link => !usedLinkKeys.has(link.key))
                .map(link => {
                    const other = getOtherNode(link, current.id);
                    const revisitPenalty = visitedNodeIds.has(other?.id) ? -1 : 0;
                    return {
                        link,
                        other,
                        score: getStrength(link) + ((other?.degree || 0) * 0.015) + revisitPenalty
                    };
                })
                .filter(item => item.other)
                .sort((a, b) => b.score - a.score || String(a.other.ticker || '').localeCompare(String(b.other.ticker || '')))[0];

            if (!nextLink || nextLink.score < 0.2) break;
            links.push(nextLink.link);
            usedLinkKeys.add(nextLink.link.key);
            if (!visitedNodeIds.has(nextLink.other.id)) nodes.push(nextLink.other);
            visitedNodeIds.add(nextLink.other.id);
            current = nextLink.other;
        }

        const label = options.fallbackLabel || getRouteLabel(options.mode, options.ecosystemKey, context);
        const explanation = links.length
            ? `${label} follows ${links.length} visible edge${links.length === 1 ? '' : 's'} from ${start.ticker || start.name}.`
            : `No visible ${label.toLowerCase()} is available from ${start.ticker || start.name} under the current filters.`;

        return {
            mode: options.mode,
            ecosystemKey: options.ecosystemKey || '',
            label,
            nodes,
            links,
            nodeIds: new Set(nodes.map(node => node.id)),
            linkKeys: new Set(links.map(link => link.key)),
            explanation,
            confidence: links.length ? 'visible-edges' : 'none'
        };
    }

    function getRouteEligibleLinks(mode, ecosystemKey, context) {
        const index = getRouteLinkIndex(context);
        if (mode === 'strongest') return index.strongest;
        if (mode === 'supply') return index.supply;
        if (mode === 'sec') return index.sec;
        if (mode === 'portfolio') return index.all.filter(link => context.portfolioEdgeKeys?.has(link.key));
        if (ecosystemKey) {
            const ecosystem = getEcosystemDefinition(ecosystemKey);
            return ecosystem ? (index.ecosystems.get(ecosystem.key) || []) : [];
        }
        return index.all;
    }

    function getRouteLinkIndex(context) {
        const visibleLinks = context.visibleLinks || [];
        const cached = routeIndexCache.get(visibleLinks);
        if (cached) return cached;

        const index = {
            all: visibleLinks,
            strongest: [...visibleLinks].sort((a, b) => getStrength(b) - getStrength(a)),
            supply: [],
            sec: [],
            ecosystems: new Map()
        };
        getEcosystemDefinitions().forEach(ecosystem => {
            index.ecosystems.set(ecosystem.key, []);
        });
        visibleLinks.forEach(link => {
            const group = context.getRelationshipGroupKey?.(link);
            const type = context.getRelationshipTypeKey?.(link);
            if (group === 'supply' || ['supplier_customer', 'semiconductor_supply_chain', 'data_center_power'].includes(type)) {
                index.supply.push(link);
            }
            if (context.isSecBackedConnection?.(link)) {
                index.sec.push(link);
            }
            getEcosystemDefinitions().forEach(ecosystem => {
                if (getCachedLinkEcosystemMatch(link, ecosystem, context).matched) {
                    index.ecosystems.get(ecosystem.key).push(link);
                }
            });
        });
        index.supply.sort((a, b) => getStrength(b) - getStrength(a));
        index.sec.sort((a, b) => getStrength(b) - getStrength(a));
        index.ecosystems.forEach(links => links.sort((a, b) => getStrength(b) - getStrength(a)));
        routeIndexCache.set(visibleLinks, index);
        return index;
    }

    function routeModeToEcosystemKey(mode, context) {
        if (ECOSYSTEMS[mode]) return mode;
        if (mode === 'ecosystem') {
            return context.activeEcosystemOverlayKey ||
                getDominantEcosystemsForNode(context.selectedNode, context)[0]?.key ||
                '';
        }
        return '';
    }

    function getRouteLabel(mode, ecosystemKey = '', context = {}) {
        if (mode === 'strongest') return 'Strongest Route';
        if (mode === 'shared' || mode === 'hidden') return 'Shared Exposure Route';
        if (mode === 'supply') return 'Supply Chain Route';
        if (mode === 'sec') return 'SEC-backed Route';
        if (mode === 'portfolio') return 'Portfolio Exposure Route';
        const ecosystem = getEcosystemDefinition(ecosystemKey || mode);
        if (ecosystem) return `${ecosystem.shortLabel} Route`;
        if (context.activeEcosystemOverlayKey) {
            const active = getEcosystemDefinition(context.activeEcosystemOverlayKey);
            if (active) return `${active.shortLabel} Route`;
        }
        return 'Relationship Route';
    }

    function getStrategicHubProfiles(sourceNodes, context, limit = 4) {
        return [...(sourceNodes || [])]
            .map(node => ({ node, profile: getStrategicHubProfile(node, context) }))
            .filter(item => item.profile.isStrategic)
            .sort((a, b) =>
                b.profile.score - a.profile.score ||
                b.profile.degree - a.profile.degree ||
                String(a.node.ticker || '').localeCompare(String(b.node.ticker || ''))
            )
            .slice(0, limit);
    }

    function getStrategicHubProfile(node, context) {
        if (!node) {
            return {
                isStrategic: false,
                roles: [],
                roleLabels: [],
                score: 0,
                degree: 0,
                primaryReason: ''
            };
        }
        const items = context.adjacencyById?.get(node.id) || [];
        const degree = node.degree || items.length;
        const ticker = String(node.ticker || '').toUpperCase();
        const sectors = new Set(items.map(item => item.node?.sector).filter(Boolean));
        const groups = new Set(items.map(item => context.getCompanyIndustryGroup?.(item.node)).filter(Boolean));
        const ecosystems = getDominantEcosystemsForNode(node, context);
        const sourceBackedCount = items.filter(item => context.relationshipHasSourceEvidence?.(item.link)).length;
        const strongEdgeCount = items.filter(item => getStrength(item.link) >= 0.7).length;
        const corridorCount = ecosystems.filter(item => item.count >= 2).length;
        const seededHub = STRATEGIC_HUB_TICKERS.has(ticker);
        const roles = [];

        if (seededHub || degree >= 8) roles.push('strategic_hub');
        if (sectors.size >= 3 || groups.size >= 4 || ecosystems.length >= 3) roles.push('ecosystem_bridge');
        if (corridorCount || ecosystems[0]?.count >= 2) roles.push('corridor_company');
        if (strongEdgeCount >= 3 || degree >= 7) roles.push('repeated_exposure_hub');
        if (sectors.size >= 4 || (seededHub && sectors.size >= 2)) roles.push('cross_sector_anchor');

        const roleLabels = roles.map(role => ({
            strategic_hub: 'Strategic hub',
            ecosystem_bridge: 'Ecosystem bridge',
            corridor_company: 'Corridor company',
            repeated_exposure_hub: 'Repeated exposure hub',
            cross_sector_anchor: 'Cross-sector anchor'
        }[role] || role));
        const sourceBackedRatio = items.length ? sourceBackedCount / items.length : 0;
        const score =
            degree * 1.25 +
            sectors.size * 1.6 +
            groups.size * 1.05 +
            ecosystems.length * 1.2 +
            strongEdgeCount * 0.9 +
            sourceBackedRatio * 4 +
            (seededHub ? 5 : 0);
        const primaryReason = STRATEGIC_HUB_REASONS[ticker] ||
            (ecosystems[0]
                ? `it concentrates ${ecosystems[0].count} ${ecosystems[0].label.toLowerCase()} edge${ecosystems[0].count === 1 ? '' : 's'}`
                : sectors.size > 1
                    ? `it bridges ${sectors.size} visible sector${sectors.size === 1 ? '' : 's'}`
                    : `it has ${degree} relationship${degree === 1 ? '' : 's'} in the loaded graph`);

        return {
            isStrategic: roles.length > 0,
            ticker,
            roles,
            roleLabels,
            primaryRoleLabel: roleLabels[0] || 'Network node',
            primaryReason,
            score,
            degree,
            ecosystemCount: ecosystems.length,
            corridorCount,
            sectorCount: sectors.size,
            industryGroupCount: groups.size,
            sourceBackedCount,
            sourceBackedRatio,
            strongEdgeCount,
            seededHub
        };
    }

    function getNodeVisualMeta(node, context) {
        const route = context.activeRelationshipRoute?.nodeIds?.has(node.id);
        const overlay = context.graphIntelligenceModel?.overlay?.nodeIds?.has(node.id);
        const guided = context.graphIntelligenceModel?.guidedDiscovery?.nodeIds?.has(node.id);
        const defaultDiscovery = !context.selectedNode &&
            !context.selectedRelationshipLink &&
            !context.activeRelationshipRoute &&
            !context.activeEcosystemOverlayKey &&
            !context.sourceCoverageLensEnabled &&
            !context.activeGuidedDiscoveryKey &&
            context.graphIntelligenceModel?.defaultDiscovery?.nodeIds?.has(node.id);
        const selectedEdgeEndpoint = context.selectedRelationshipLink &&
            (context.selectedRelationshipLink.source?.id === node.id || context.selectedRelationshipLink.target?.id === node.id);
        const cluster = context.graphStoryMode === 'cluster' && context.activeClusterNodeIds?.has(node.id);
        const sourceCoverage = context.sourceCoverageLensEnabled
            ? getNodeTrustTierState(node, context)
            : null;
        const role = getNodeRole(node, context);
        const primaryEcosystem = getDominantEcosystemsForNode(node, context)[0] || null;

        let color = primaryEcosystem?.color || role.color;
        let badgeLabel = '';
        if (route) badgeLabel = 'ROUTE';
        else if (selectedEdgeEndpoint) badgeLabel = 'EDGE';
        else if (guided) {
            badgeLabel = context.graphIntelligenceModel?.guidedDiscovery?.shortLabel || 'GUIDE';
            color = context.graphIntelligenceModel?.guidedDiscovery?.color || color;
        }
        else if (sourceCoverage) {
            badgeLabel = sourceCoverage.shortLabel;
            color = sourceCoverage.color;
        } else if (overlay && primaryEcosystem) badgeLabel = primaryEcosystem.shortLabel;
        else if (cluster && role.key !== 'normal') badgeLabel = role.shortLabel;
        else if (defaultDiscovery && role.key !== 'normal') badgeLabel = role.shortLabel;

        return {
            route,
            overlay,
            guided,
            defaultDiscovery,
            selectedEdgeEndpoint,
            cluster,
            role,
            sourceCoverage,
            color,
            badgeLabel,
            emphasized: Boolean(route || selectedEdgeEndpoint || cluster || overlay || guided || sourceCoverage || defaultDiscovery)
        };
    }

    function getLinkVisualMeta(link, context) {
        const route = context.activeRelationshipRoute?.linkKeys?.has(link.key);
        const selected = context.selectedRelationshipLink?.key === link.key;
        const overlay = context.graphIntelligenceModel?.overlay?.linkKeys?.has(link.key);
        const guided = context.graphIntelligenceModel?.guidedDiscovery?.linkKeys?.has(link.key);
        const sourceCoverage = context.sourceCoverageLensEnabled
            ? getLinkTrustTierState(link, context)
            : null;
        const overlayColor = context.graphIntelligenceModel?.overlay?.color;
        const guidedColor = context.graphIntelligenceModel?.guidedDiscovery?.color;
        const routeColor = getRouteColor(context.activeRelationshipRoute, context);
        const sourceColor = sourceCoverage?.color;

        return {
            route,
            selected,
            overlay,
            guided,
            sourceCoverage,
            forceDraw: Boolean(route || selected || overlay || guided),
            dimmed: Boolean((context.activeEcosystemOverlayKey || context.sourceCoverageLensEnabled || context.activeGuidedDiscoveryKey) && !route && !selected && !overlay && !guided),
            color: route ? routeColor : selected ? '#ffffff' : sourceColor || guidedColor || overlayColor || '',
            widthBoost: route ? 2.25 : selected ? 2.4 : guided ? 1.35 : overlay ? 1.1 : sourceCoverage ? 0.35 : 0,
            alphaBoost: route ? 0.45 : selected ? 0.52 : guided ? 0.34 : overlay ? 0.28 : sourceCoverage ? 0.18 : 0,
            dashPattern: sourceCoverage?.key === 'needs_review' ? [3, 7] : sourceCoverage?.key === 'context_only' ? [2, 6] : null
        };
    }

    function getRouteColor(route, context) {
        const ecosystem = getEcosystemDefinition(route?.ecosystemKey);
        if (ecosystem) return ecosystem.color;
        if (route?.mode === 'sec') return SOURCE_STATE_META.sec_backed.color;
        if (route?.mode === 'supply') return ECOSYSTEMS.semiconductor_supply_chain.color;
        if (route?.mode === 'shared') return '#f0abfc';
        if (route?.mode === 'portfolio') return '#fde68a';
        return context.graphIntelligenceModel?.overlay?.color || '#ffffff';
    }

    function getNodeRole(node, context) {
        const items = context.adjacencyById?.get(node.id) || [];
        if (!items.length) {
            return { key: 'isolated', label: 'Isolated', shortLabel: 'ISO', color: '#94a3b8' };
        }

        const degree = node.degree || items.length;
        const allDegrees = (context.nodes || []).map(item => item.degree || 0).sort((a, b) => a - b);
        const p75 = allDegrees.length ? allDegrees[Math.floor(allDegrees.length * 0.75)] : 6;
        const sectorCount = new Set(items.map(item => item.node?.sector).filter(Boolean)).size;
        const groupCount = new Set(items.map(item => context.getCompanyIndustryGroup?.(item.node)).filter(Boolean)).size;
        const ecosystems = getDominantEcosystemsForNode(node, context);
        const hubProfile = getStrategicHubProfile(node, context);

        if (hubProfile.roles.includes('strategic_hub')) {
            return { key: 'strategic_hub', label: 'Strategic hub', shortLabel: 'HUB', color: '#22d3ee' };
        }
        if (hubProfile.roles.includes('cross_sector_anchor')) {
            return { key: 'cross_sector_anchor', label: 'Cross-sector anchor', shortLabel: 'ANCH', color: '#fbbf24' };
        }
        if (hubProfile.roles.includes('ecosystem_bridge')) {
            return { key: 'ecosystem_bridge', label: 'Ecosystem bridge', shortLabel: 'BRG', color: '#f0abfc' };
        }
        if (hubProfile.roles.includes('corridor_company')) {
            return { key: 'corridor_company', label: 'Corridor company', shortLabel: 'COR', color: ecosystems[0]?.color || '#34d399' };
        }
        if (hubProfile.roles.includes('repeated_exposure_hub')) {
            return { key: 'repeated_exposure_hub', label: 'Repeated exposure hub', shortLabel: 'REP', color: '#a5f3fc' };
        }

        if (degree >= Math.max(6, p75)) {
            return { key: 'hub', label: 'Strategic hub', shortLabel: 'HUB', color: '#22d3ee' };
        }
        if (sectorCount >= 3 || groupCount >= 4) {
            return { key: 'bridge', label: 'Bridge', shortLabel: 'BRG', color: '#f0abfc' };
        }
        if (ecosystems[0]?.count >= 2) {
            return { key: 'corridor', label: 'Corridor node', shortLabel: 'COR', color: ecosystems[0].color };
        }
        if (degree <= 1) {
            return { key: 'isolated', label: 'Sparse', shortLabel: 'SP', color: '#94a3b8' };
        }
        return { key: 'normal', label: 'Network node', shortLabel: '', color: '#67e8f9' };
    }

    function getNodeSourceCoverageState(node, context) {
        const items = context.adjacencyById?.get(node.id) || [];
        if (!items.length) return SOURCE_STATE_META.missing_source;
        const states = items.map(item => getLinkSourceCoverageState(item.link, context));
        if (states.some(state => state.key === 'sec_backed')) return SOURCE_STATE_META.sec_backed;
        if (states.some(state => state.key === 'stale_review')) return SOURCE_STATE_META.stale_review;
        if (states.some(state => state.key === 'missing_source')) return SOURCE_STATE_META.missing_source;
        if (states.some(state => state.key === 'candidate_preview')) return SOURCE_STATE_META.candidate_preview;
        return SOURCE_STATE_META.source_attached;
    }

    function getNodeTrustTierState(node, context) {
        const items = context.adjacencyById?.get(node.id) || [];
        if (!items.length) return EVIDENCE_TIER_META.needs_review;
        const states = items.map(item => getLinkTrustTierState(item.link, context));
        if (states.some(state => state.key === 'verified')) return EVIDENCE_TIER_META.verified;
        if (states.some(state => state.key === 'strong_inferred')) return EVIDENCE_TIER_META.strong_inferred;
        if (states.some(state => state.key === 'context_only')) return EVIDENCE_TIER_META.context_only;
        return EVIDENCE_TIER_META.needs_review;
    }

    function getLinkSourceCoverageState(link, context) {
        if (context.isSecBackedConnection?.(link)) return SOURCE_STATE_META.sec_backed;
        const status = context.getRelationshipSourceStatus?.(link);
        const age = context.getRelationshipSourceAgeInfo?.(link);
        if (status?.key === 'candidate_preview') return SOURCE_STATE_META.candidate_preview;
        if (age?.key === 'stale_review_recommended') return SOURCE_STATE_META.stale_review;
        if (status?.key === 'missing_source' || !(context.getRelationshipEvidenceCount?.(link) > 0)) return SOURCE_STATE_META.missing_source;
        return SOURCE_STATE_META.source_attached;
    }

    function getLinkTrustTierState(link, context) {
        const tier = getLinkEvidencePolicy(link, context).tier;
        return EVIDENCE_TIER_META[tier?.key] || EVIDENCE_TIER_META.needs_review;
    }

    function getLinkEvidencePolicy(link, context) {
        if (context.getRelationshipEvidencePolicy) return context.getRelationshipEvidencePolicy(link);
        if (evidencePolicy.getEvidencePolicy) return evidencePolicy.getEvidencePolicy(link, {
            evidenceCount: context.getRelationshipEvidenceCount?.(link)
        });
        return {
            tier: EVIDENCE_TIER_META.needs_review,
            trustedClassLabel: '',
            fastTrackVisibility: false,
            explanation: 'Review required before promotion.'
        };
    }

    function buildSourceCoverageSummary(context) {
        const links = context.visibleLinks || [];
        const counts = countBy(links, link => getLinkSourceCoverageState(link, context).key);
        const tierCounts = countBy(links, link => getLinkTrustTierState(link, context).key);
        const trustedClassCounts = countBy(links, link => getLinkEvidencePolicy(link, context).trustedClassLabel || 'Unclassified')
            .filter(([label]) => label !== 'Unclassified');
        return {
            total: links.length,
            counts,
            states: SOURCE_STATE_META,
            tierCounts,
            tierStates: EVIDENCE_TIER_META,
            trustedClassCounts
        };
    }

    function summarizeLinksEvidence(links, context) {
        const total = links.length;
        const sourced = links.filter(link => context.relationshipHasSourceEvidence?.(link)).length;
        const secBacked = links.filter(link => context.isSecBackedConnection?.(link)).length;
        const missing = links.filter(link => getLinkSourceCoverageState(link, context).key === 'missing_source').length;
        const stale = links.filter(link => getLinkSourceCoverageState(link, context).key === 'stale_review').length;
        return {
            total,
            sourced,
            sourcedRatio: total ? sourced / total : 0,
            secBacked,
            missing,
            stale
        };
    }

    function findLinkBetween(sourceId, targetId, context) {
        return (context.links || []).find(link =>
            (link.source?.id === sourceId && link.target?.id === targetId) ||
            (link.source?.id === targetId && link.target?.id === sourceId)
        ) || null;
    }

    function getOtherNode(link, nodeId) {
        if (link?.source?.id === nodeId) return link.target;
        if (link?.target?.id === nodeId) return link.source;
        return null;
    }

    function uniqueNodes(nodes) {
        return [...new Map(nodes.filter(Boolean).map(node => [node.id, node])).values()];
    }

    function countBy(items, getKey) {
        const counts = new Map();
        items.forEach(item => {
            const key = String(getKey(item) || '').trim() || 'Other';
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    }

    function getStrength(link) {
        return Math.max(0, Math.min(1, Number(link?.strength) || 0));
    }

    window.StockPhotonicStock.graphIntelligence = {
        ECOSYSTEMS,
        ECOSYSTEM_SEQUENCE,
        SOURCE_STATE_META,
        EVIDENCE_TIER_META,
        getEcosystemDefinitions,
        getEcosystemDefinition,
        getGuidedDiscoveryFlows,
        getGuidedDiscoveryFlow,
        getRelationshipTypeMeaning,
        buildGraphIntelligenceModel,
        buildEcosystemOverlay,
        buildGuidedDiscoveryModel,
        buildDefaultDiscoveryModel,
        buildEvidenceGapDiscovery,
        getDominantEcosystemsForNode,
        getLinkEcosystemKeys,
        getLinkEcosystemMatch,
        buildSelectedNodeStory,
        buildClusterStory,
        buildRelationshipExplanation,
        buildRoute,
        getRouteLabel,
        getStrategicHubProfile,
        getStrategicHubProfiles,
        getNodeVisualMeta,
        getLinkVisualMeta,
        getNodeRole,
        getNodeSourceCoverageState,
        getLinkSourceCoverageState,
        getNodeTrustTierState,
        getLinkTrustTierState,
        buildSourceCoverageSummary
    };
})();
