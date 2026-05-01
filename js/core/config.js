(function () {
    const CACHE_BUST = Date.now();
    const EDGE_COLORS = {
        partnership: '#ff00aa',
        supply: '#00ff9f',
        ecosystem: '#ffd700',
        competitor: '#ff6b00',
        investment: '#c026d3'
    };
    const DEFAULT_EDGE_COLOR = '#00f9ff';
    const DRAG_THRESHOLD_PX = 6;
    const MIN_SCALE = 0.16;
    const MAX_SCALE = 2.8;
    const LABEL_TICKER_SCALE = 0.42;
    const LABEL_FULL_SCALE = 1.05;
    const FRAME_MARGIN = 150;
    const WHEEL_ZOOM_SENSITIVITY = 0.0021;
    const WHEEL_DELTA_LIMIT = 180;
    const FIT_ANIMATION_MS = 260;
    const PULSE_DURATION_MS = 900;
    const SEARCH_RESULT_LIMIT = 5;
    const RECENT_NODE_LIMIT = 5;
    const SEARCH_FOCUS_SCALE = 1.12;
    const SEARCH_FOCUS_ANIMATION_MS = 460;
    const SEARCH_PANEL_CLOSE_MS = 140;
    const SEARCH_HIGHLIGHT_MS = 1400;
    const LAYOUT_MODE_SECTOR = 'sector';
    const LAYOUT_MODE_HUB = 'hub';
    const LAYOUT_MODE_NEXUS = 'nexus';
    const SIGNAL_DECLUTTER_THRESHOLD = 0.3;
    const FOCUS_MODE_TRANSITION_MS = 520;
    const CLUSTER_MIN_STRENGTH = 0.35;
    const CLUSTER_SHARED_CONNECTION_MIN = 2;
    const CLUSTER_SECTION_LIMIT = 5;
    const HIGH_CONFIDENCE_EDGE_MIN = 4;
    const STRONG_INDUSTRY_CORRELATION_MIN_EDGE_COUNT = 2;
    const STRONG_INDUSTRY_CORRELATION_MIN_AVG_STRENGTH = 0.72;
    const ORBIT_RADIUS_RATIO = 0.035;
    const ORBIT_MIN_RADIUS = 14;
    const ORBIT_MAX_RADIUS = 34;
    const ORBIT_RAMP_MS = 2800;
    const ORBIT_ANGULAR_SPEED = (Math.PI * 2) / 52000;
    const INDUSTRY_GROUP_RULES = [
        {
            group: 'PBM / Pharmacy Benefits',
            sectorKeywords: ['healthcare', 'pharma', 'pbm'],
            keywords: ['pbm', 'pharmacy benefit', 'retail pharmacy']
        },
        {
            group: 'Insurance / Managed Care',
            sectorKeywords: ['healthcare', 'pharma', 'pbm'],
            keywords: ['managed care', 'health insurance', 'healthcare insurance']
        },
        {
            group: 'MedTech',
            sectorKeywords: ['healthcare', 'pharma', 'pbm'],
            keywords: ['medtech', 'medical device', 'robotic surgery', 'surgical']
        },
        {
            group: 'Life Sciences Tools',
            sectorKeywords: ['healthcare', 'pharma', 'pbm'],
            keywords: ['life sciences', 'diagnostics', 'tools']
        },
        {
            group: 'Pharmaceuticals',
            sectorKeywords: ['healthcare', 'pharma', 'pbm'],
            keywords: ['pharmaceutical', 'biotech', 'drug']
        },
        {
            group: 'EDA / Design Software',
            sectorKeywords: ['ai', 'semiconductor'],
            keywords: ['electronic design automation', 'eda', 'design automation', 'design software']
        },
        {
            group: 'Memory / HBM',
            sectorKeywords: ['ai', 'semiconductor'],
            keywords: ['memory', 'hbm', 'high-bandwidth']
        },
        {
            group: 'Foundry / Manufacturing',
            sectorKeywords: ['ai', 'semiconductor'],
            keywords: ['foundry', 'integrated device manufacturing']
        },
        {
            group: 'Semiconductor Equipment',
            sectorKeywords: ['ai', 'semiconductor'],
            keywords: ['lithography', 'semiconductor manufacturing equipment', 'wafer fabrication', 'process control', 'yield management', 'equipment']
        },
        {
            group: 'AI Accelerators',
            sectorKeywords: ['ai', 'semiconductor'],
            keywords: ['accelerator', 'gpu', 'graphics processing', 'custom silicon', 'cpus, gpus', 'data center accelerators']
        },
        {
            group: 'Cloud Infrastructure',
            sectorKeywords: ['ai', 'semiconductor', 'cloud', 'big tech'],
            keywords: ['cloud', 'data center', 'data infrastructure', 'digital infrastructure', 'ai infrastructure', 'data platforms', 'network security']
        },
        {
            group: 'Banks',
            sectorKeywords: ['payments', 'financial'],
            keywords: ['banking', 'bank']
        },
        {
            group: 'Payments Networks',
            sectorKeywords: ['payments', 'financial'],
            keywords: ['payment network', 'payments network', 'card payment', 'digital payments', 'card issuing']
        },
        {
            group: 'Asset Managers',
            sectorKeywords: ['payments', 'financial'],
            keywords: ['asset manager', 'asset management', 'investment manager']
        },
        {
            group: 'Exchanges / Market Infrastructure',
            sectorKeywords: ['payments', 'financial'],
            keywords: ['exchange', 'clearing', 'market infrastructure']
        },
        {
            group: 'Insurance',
            sectorKeywords: ['payments', 'financial'],
            keywords: ['insurance']
        },
        {
            group: 'E-Commerce',
            sectorKeywords: ['consumer', 'retail', 'cloud', 'big tech'],
            keywords: ['e-commerce', 'online retail', 'digital commerce']
        },
        {
            group: 'Big Box Retail',
            sectorKeywords: ['consumer', 'retail'],
            keywords: ['mass-market retail', 'warehouse club', 'home improvement retail', 'big box']
        },
        {
            group: 'Restaurants / Food Service',
            sectorKeywords: ['consumer', 'retail'],
            keywords: ['restaurant', 'food service', 'quick-service']
        },
        {
            group: 'Consumer Brands',
            sectorKeywords: ['consumer', 'retail', 'cloud', 'big tech'],
            keywords: ['beverage', 'consumer devices', 'consumer brands', 'services and silicon']
        },
        {
            group: 'Energy Producers',
            sectorKeywords: ['energy', 'industrial'],
            keywords: ['integrated oil and gas', 'exploration and production', 'energy producer']
        },
        {
            group: 'Oilfield Services',
            sectorKeywords: ['energy', 'industrial'],
            keywords: ['oilfield services', 'drilling', 'field services']
        },
        {
            group: 'Defense Contractors',
            sectorKeywords: ['energy', 'industrial'],
            keywords: ['aerospace and defense systems', 'defense systems', 'defense contractor']
        },
        {
            group: 'Aerospace OEMs',
            sectorKeywords: ['energy', 'industrial'],
            keywords: ['commercial aerospace', 'defense aerospace']
        },
        {
            group: 'Industrial Suppliers',
            sectorKeywords: ['energy', 'industrial'],
            keywords: ['machinery', 'industrial equipment', 'industrial automation', 'construction machinery', 'agricultural']
        }
    ];
    const EXPLORATION_CHIPS = [
        {
            key: 'ai-infrastructure',
            label: 'AI Infrastructure',
            sector: 'AI / Semiconductors'
        },
        {
            key: 'healthcare-pbm',
            label: 'Healthcare / PBM',
            sector: 'Healthcare / Pharma / PBM',
            industryGroup: 'PBM / Pharmacy Benefits'
        },
        {
            key: 'payments',
            label: 'Payments',
            sector: 'Payments / Financial Infrastructure',
            industryGroup: 'Payments Networks'
        },
        {
            key: 'energy-industrials',
            label: 'Energy / Industrials',
            sector: 'Energy / Industrials'
        },
        {
            key: 'cloud-infrastructure',
            label: 'Cloud Infrastructure',
            sector: 'Cloud / Big Tech',
            industryGroup: 'Cloud Infrastructure'
        }
    ];
    const HUB_CENTER = { x: 0, y: 0 };
    const HUB_RING_GAP = 150;
    const HUB_FIRST_RING_RADIUS = 230;
    const NEXUS_CENTER = { x: 0, y: 0 };
    const NEXUS_AXIS_DISTANCE = 360;
    const NEXUS_AXIS_SPREAD = 640;
    const NEXUS_OUTER_RING_RADIUS = 560;
    const NEXUS_LABEL_DISTANCE = 470;
    const NEXUS_GROUP_SEQUENCE = ['supply', 'partner', 'competitive', 'capital', 'other'];
    const NEXUS_GROUPS = {
        supply: {
            label: 'Suppliers / Supply',
            shortLabel: 'Supply-side',
            types: ['supply', 'supplier_customer']
        },
        partner: {
            label: 'Partners / Ecosystem',
            shortLabel: 'Partner/ecosystem',
            types: ['partnership', 'ecosystem']
        },
        competitive: {
            label: 'Competitors / Peers',
            shortLabel: 'Competitor/peer',
            types: ['competitor', 'peer']
        },
        capital: {
            label: 'Capital / Ownership',
            shortLabel: 'Capital/ownership',
            types: ['investment', 'ownership', 'institutional_ownership', 'shared_holder']
        },
        other: {
            label: 'Other Direct Links',
            shortLabel: 'Other direct links',
            types: []
        }
    };

    window.StockPhotonicConfig = {
        CACHE_BUST,
        EDGE_COLORS,
        DEFAULT_EDGE_COLOR,
        DRAG_THRESHOLD_PX,
        MIN_SCALE,
        MAX_SCALE,
        LABEL_TICKER_SCALE,
        LABEL_FULL_SCALE,
        FRAME_MARGIN,
        WHEEL_ZOOM_SENSITIVITY,
        WHEEL_DELTA_LIMIT,
        FIT_ANIMATION_MS,
        PULSE_DURATION_MS,
        SEARCH_RESULT_LIMIT,
        RECENT_NODE_LIMIT,
        SEARCH_FOCUS_SCALE,
        SEARCH_FOCUS_ANIMATION_MS,
        SEARCH_PANEL_CLOSE_MS,
        SEARCH_HIGHLIGHT_MS,
        LAYOUT_MODE_SECTOR,
        LAYOUT_MODE_HUB,
        LAYOUT_MODE_NEXUS,
        SIGNAL_DECLUTTER_THRESHOLD,
        FOCUS_MODE_TRANSITION_MS,
        CLUSTER_MIN_STRENGTH,
        CLUSTER_SHARED_CONNECTION_MIN,
        CLUSTER_SECTION_LIMIT,
        HIGH_CONFIDENCE_EDGE_MIN,
        STRONG_INDUSTRY_CORRELATION_MIN_EDGE_COUNT,
        STRONG_INDUSTRY_CORRELATION_MIN_AVG_STRENGTH,
        ORBIT_RADIUS_RATIO,
        ORBIT_MIN_RADIUS,
        ORBIT_MAX_RADIUS,
        ORBIT_RAMP_MS,
        ORBIT_ANGULAR_SPEED,
        INDUSTRY_GROUP_RULES,
        EXPLORATION_CHIPS,
        HUB_CENTER,
        HUB_RING_GAP,
        HUB_FIRST_RING_RADIUS,
        NEXUS_CENTER,
        NEXUS_AXIS_DISTANCE,
        NEXUS_AXIS_SPREAD,
        NEXUS_OUTER_RING_RADIUS,
        NEXUS_LABEL_DISTANCE,
        NEXUS_GROUP_SEQUENCE,
        NEXUS_GROUPS
    };
})();
