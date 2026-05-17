(function () {
    window.StockPhotonicStock = window.StockPhotonicStock || {};

    const ECOSYSTEMS = {
        ai_infrastructure: {
            key: 'ai_infrastructure',
            label: 'AI Infrastructure',
            shortLabel: 'AI Infra',
            color: '#ffd166',
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
            relationshipTypes: ['hyperscaler_cloud_customer', 'strategic_partnership', 'curated_manual_relationship'],
            rawTypes: ['ecosystem', 'partnership', 'competitor'],
            industryGroups: ['Cloud Infrastructure', 'E-Commerce'],
            sectors: ['Cloud / Big Tech'],
            keywords: ['enterprise', 'saas', 'workflow', 'crm', 'productivity', 'data platform', 'enterprise software', 'marketplace', 'security']
        }
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

    function buildGraphIntelligenceModel(context) {
        const overlay = context.activeEcosystemOverlayKey
            ? buildEcosystemOverlay(context.activeEcosystemOverlayKey, context)
            : null;
        const selectedStory = context.selectedNode
            ? buildSelectedNodeStory(context.selectedNode, context)
            : null;
        const relationshipExplanation = context.selectedRelationshipLink
            ? buildRelationshipExplanation(context.selectedRelationshipLink, context)
            : null;
        const sourceCoverage = buildSourceCoverageSummary(context);

        return {
            overlay,
            selectedStory,
            relationshipExplanation,
            sourceCoverage
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
            reason: getOverlayReason(linkMatches, ecosystem)
        };
    }

    function getOverlayReason(linkMatches, ecosystem) {
        if (!linkMatches.length) return 'No visible edge metadata currently matches this overlay.';
        const topReasons = countBy(linkMatches, item => item.match.reason).slice(0, 2);
        return topReasons.map(([reason, count]) => `${count} via ${reason}`).join(', ');
    }

    function getDominantEcosystemsForNode(node, context) {
        if (!node) return [];
        return getEcosystemDefinitions()
            .map(ecosystem => {
                const matches = (context.adjacencyById?.get(node.id) || [])
                    .map(item => {
                        const match = getLinkEcosystemMatch(item.link, ecosystem, context);
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
            .filter(ecosystem => getLinkEcosystemMatch(link, ecosystem, context).matched)
            .map(ecosystem => ecosystem.key);
    }

    function getLinkEcosystemMatch(link, ecosystem, context) {
        if (!link || !ecosystem) return { matched: false, score: 0, reason: 'no link' };

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
            role,
            strongest,
            bridgeSectorCount,
            headline: buildSelectedNodeHeadline(node, {
                degree,
                ecosystems,
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
        const trustExplanation = context.isSecBackedConnection?.(link)
            ? 'Evidence state: SEC-backed production edge.'
            : `${sourceStatus.label}; ${confidence.label}; ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}.`;

        return {
            link,
            pairLabel,
            typeLabel,
            summary,
            pathExplanation,
            ecosystemExplanation,
            trustExplanation,
            confidence,
            sourceStatus,
            sourceAge,
            diversity,
            evidenceCount,
            ecosystems
        };
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
        const visibleLinks = context.visibleLinks || [];
        if (mode === 'strongest') return visibleLinks;
        if (mode === 'supply') {
            return visibleLinks.filter(link => {
                const group = context.getRelationshipGroupKey?.(link);
                const type = context.getRelationshipTypeKey?.(link);
                return group === 'supply' || ['supplier_customer', 'semiconductor_supply_chain', 'data_center_power'].includes(type);
            });
        }
        if (mode === 'sec') return visibleLinks.filter(link => context.isSecBackedConnection?.(link));
        if (mode === 'portfolio') return visibleLinks.filter(link => context.portfolioEdgeKeys?.has(link.key));
        if (ecosystemKey) {
            const ecosystem = getEcosystemDefinition(ecosystemKey);
            return ecosystem ? visibleLinks.filter(link => getLinkEcosystemMatch(link, ecosystem, context).matched) : [];
        }
        return visibleLinks;
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

    function getNodeVisualMeta(node, context) {
        const route = context.activeRelationshipRoute?.nodeIds?.has(node.id);
        const overlay = context.graphIntelligenceModel?.overlay?.nodeIds?.has(node.id);
        const selectedEdgeEndpoint = context.selectedRelationshipLink &&
            (context.selectedRelationshipLink.source?.id === node.id || context.selectedRelationshipLink.target?.id === node.id);
        const cluster = context.graphStoryMode === 'cluster' && context.activeClusterNodeIds?.has(node.id);
        const sourceCoverage = context.sourceCoverageLensEnabled
            ? getNodeSourceCoverageState(node, context)
            : null;
        const role = getNodeRole(node, context);
        const primaryEcosystem = getDominantEcosystemsForNode(node, context)[0] || null;

        let color = primaryEcosystem?.color || role.color;
        let badgeLabel = '';
        if (route) badgeLabel = 'ROUTE';
        else if (selectedEdgeEndpoint) badgeLabel = 'EDGE';
        else if (sourceCoverage) {
            badgeLabel = sourceCoverage.shortLabel;
            color = sourceCoverage.color;
        } else if (overlay && primaryEcosystem) badgeLabel = primaryEcosystem.shortLabel;
        else if (cluster && role.key !== 'normal') badgeLabel = role.shortLabel;

        return {
            route,
            overlay,
            selectedEdgeEndpoint,
            cluster,
            role,
            sourceCoverage,
            color,
            badgeLabel,
            emphasized: Boolean(route || selectedEdgeEndpoint || cluster || overlay || sourceCoverage)
        };
    }

    function getLinkVisualMeta(link, context) {
        const route = context.activeRelationshipRoute?.linkKeys?.has(link.key);
        const selected = context.selectedRelationshipLink?.key === link.key;
        const overlay = context.graphIntelligenceModel?.overlay?.linkKeys?.has(link.key);
        const sourceCoverage = context.sourceCoverageLensEnabled
            ? getLinkSourceCoverageState(link, context)
            : null;
        const overlayColor = context.graphIntelligenceModel?.overlay?.color;
        const routeColor = getRouteColor(context.activeRelationshipRoute, context);
        const sourceColor = sourceCoverage?.color;

        return {
            route,
            selected,
            overlay,
            sourceCoverage,
            forceDraw: Boolean(route || selected || overlay),
            dimmed: Boolean((context.activeEcosystemOverlayKey || context.sourceCoverageLensEnabled) && !route && !selected && !overlay),
            color: route ? routeColor : selected ? '#ffffff' : sourceColor || overlayColor || '',
            widthBoost: route ? 2.25 : selected ? 2.4 : overlay ? 1.1 : sourceCoverage ? 0.35 : 0,
            alphaBoost: route ? 0.45 : selected ? 0.52 : overlay ? 0.28 : sourceCoverage ? 0.18 : 0,
            dashPattern: sourceCoverage?.key === 'missing_source' ? [3, 7] : sourceCoverage?.key === 'candidate_preview' ? [8, 6] : null
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

    function getLinkSourceCoverageState(link, context) {
        if (context.isSecBackedConnection?.(link)) return SOURCE_STATE_META.sec_backed;
        const status = context.getRelationshipSourceStatus?.(link);
        const age = context.getRelationshipSourceAgeInfo?.(link);
        if (status?.key === 'candidate_preview') return SOURCE_STATE_META.candidate_preview;
        if (age?.key === 'stale_review_recommended') return SOURCE_STATE_META.stale_review;
        if (status?.key === 'missing_source' || !(context.getRelationshipEvidenceCount?.(link) > 0)) return SOURCE_STATE_META.missing_source;
        return SOURCE_STATE_META.source_attached;
    }

    function buildSourceCoverageSummary(context) {
        const links = context.visibleLinks || [];
        const counts = countBy(links, link => getLinkSourceCoverageState(link, context).key);
        return {
            total: links.length,
            counts,
            states: SOURCE_STATE_META
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
        getEcosystemDefinitions,
        getEcosystemDefinition,
        buildGraphIntelligenceModel,
        buildEcosystemOverlay,
        getDominantEcosystemsForNode,
        getLinkEcosystemKeys,
        getLinkEcosystemMatch,
        buildSelectedNodeStory,
        buildClusterStory,
        buildRelationshipExplanation,
        buildRoute,
        getRouteLabel,
        getNodeVisualMeta,
        getLinkVisualMeta,
        getNodeRole,
        getNodeSourceCoverageState,
        getLinkSourceCoverageState,
        buildSourceCoverageSummary
    };
})();
