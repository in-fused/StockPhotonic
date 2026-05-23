"use strict";

const { getCache, setCache } = require("./_shared/cache");
const {
  DEFAULT_MAX_PAGE_CAP,
  fetchWalletHistoryPage,
  getProviderConfig,
  isValidWallet,
  normalizeCursor,
  normalizeLimit,
} = require("./_shared/provider");
const { normalizeProviderTransactions } = require("./_shared/normalize");

const CACHE_TTL_SECONDS = 45;
const BOUNDARY_FIELDS = {
  browser_provider_calls: false,
  provider_keys_included: false,
  raw_provider_payloads_included: false,
};

module.exports = async function walletHistoryHandler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "OPTIONS") {
    return sendJson(res, 405, emptyResponse({
      status: "method_not_allowed",
      message: "Use GET for wallet history pagination.",
    }));
  }
  if (req.method === "OPTIONS") return sendJson(res, 204, null);

  const query = getQuery(req);
  if (query.diagnostics === "1" || query.diagnostics === "true") {
    return sendJson(res, 200, diagnosticsResponse(query));
  }

  const wallet = safeString(query.wallet);
  const cursor = normalizeCursor(query.cursor);
  const limit = normalizeLimit(query.limit);
  const loadedPages = normalizeNonNegativeInteger(query.loaded_pages ?? query.loadedPages);
  const maxPageCap = DEFAULT_MAX_PAGE_CAP;

  if (!wallet) {
    return sendJson(res, 400, emptyResponse({
      status: "missing_wallet",
      message: "Wallet query parameter is required. No provider request was made.",
      wallet,
      cursor,
      limit,
      metadata: {
        error: "missing_wallet",
        no_data_merged: true,
      },
    }));
  }

  if (!isValidWallet(wallet)) {
    return sendJson(res, 400, emptyResponse({
      status: "invalid_wallet",
      message: "Wallet query parameter is not a valid Solana address. No provider request was made.",
      wallet,
      cursor,
      limit,
      metadata: {
        error: "invalid_wallet",
        no_data_merged: true,
      },
    }));
  }

  const providerConfig = getProviderConfig(process.env);
  if (!providerConfig.configured) {
    return sendJson(res, 200, emptyResponse({
      status: "provider_unavailable",
      message: "Provider unavailable: HELIUS_API_KEY is not configured in the server environment.",
      wallet,
      cursor,
      limit,
      metadata: {
        provider_configured: false,
        provider_unavailable: true,
        no_data_merged: true,
      },
    }));
  }

  const cacheParts = { endpoint: "wallet-history", wallet, cursor, limit, loadedPages };
  const cached = getCache("crypto-wallet-history", cacheParts, { ttlSeconds: CACHE_TTL_SECONDS });
  if (cached.hit) {
    return sendJson(res, 200, withCacheMetadata(cached.value, cached.metadata));
  }

  const providerPage = await fetchWalletHistoryPage({
    wallet,
    cursor,
    limit,
    loadedPages,
    maxPageCap,
  }, process.env);
  const transactions = providerPage.status === "ok"
    ? normalizeProviderTransactions(providerPage.transactions, {
        wallet,
        cursor,
        nextCursor: providerPage.next_cursor,
        pageNumber: loadedPages + 1,
      })
    : [];
  const response = buildResponse(providerPage, transactions, {
    ...cached.metadata,
    cache_status: "miss",
    cache_hit: false,
  }, {
    loadedPages,
    maxPageCap,
  });
  setCache("crypto-wallet-history", cacheParts, response, { ttlSeconds: CACHE_TTL_SECONDS });
  return sendJson(res, 200, response);
};

function buildResponse(providerPage, transactions, cacheMetadata, options = {}) {
  const metadata = buildMetadata(providerPage, cacheMetadata, options);
  const zeroRows = transactions.length === 0;
  return {
    status: providerPage.status || "ok",
    wallet: providerPage.wallet || "",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    message: providerPage.message || (zeroRows ? "Zero normalized transactions returned for this bounded history page." : "Sanitized wallet-history page returned."),
    cursor: providerPage.cursor ?? null,
    current_cursor: providerPage.current_cursor ?? null,
    next_cursor: providerPage.next_cursor ?? null,
    nextCursor: providerPage.next_cursor ?? null,
    more_available: Boolean(providerPage.more_available),
    moreAvailable: Boolean(providerPage.more_available),
    cursor_exhausted: Boolean(providerPage.cursor_exhausted),
    rate_limited: Boolean(metadata.rate_limited),
    retry_after_seconds: metadata.retry_after_seconds,
    provider_limited: Boolean(metadata.provider_limited),
    provider_limit_reached: Boolean(metadata.provider_limit_reached),
    cache_id: metadata.cache_id,
    replay_preview_only: true,
    transactions,
    metadata: {
      ...metadata,
      returned_count: transactions.length,
      provider_rows_returned: providerPage.returned_count || 0,
      parser: buildParserSummary(transactions),
      parser_metadata: buildParserSummary(transactions),
      zero_transactions: zeroRows,
      replay_preview_only: true,
      active_graph_unchanged: true,
      no_data_merged: true,
      no_sample_fallback: true,
    },
  };
}

function emptyResponse(options = {}) {
  const provider = getProviderConfig(process.env);
  const metadata = {
    ...commonBoundaryMetadata(),
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_configured: provider.configured,
    provider_unavailable: !provider.configured,
    rate_limited: false,
    retry_after_seconds: null,
    provider_limited: false,
    provider_limit_reached: false,
    cursor: options.cursor ?? null,
    current_cursor: options.cursor ?? null,
    next_cursor: null,
    more_available: false,
    cursor_exhausted: false,
    pages_loaded: 0,
    requested_limit: options.limit || 10,
    returned_count: 0,
    cache_id: null,
    cache_status: "miss",
    cache_hit: false,
    cache_ttl_seconds: null,
    scan_cache: {
      storage: "memory_best_effort",
      persisted: false,
      raw_provider_payload_exposed: false,
      provider_secret_exposed: false,
    },
    replay_preview_only: true,
    active_graph_unchanged: true,
    full_history_loaded: false,
    full_history_claim_allowed: false,
    no_sample_fallback: true,
    ...(options.metadata || {}),
  };
  return {
    status: options.status || "empty",
    wallet: options.wallet || "",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    message: options.message || "No wallet-history page returned. No sample fallback is included.",
    cursor: options.cursor ?? null,
    current_cursor: options.cursor ?? null,
    next_cursor: null,
    nextCursor: null,
    more_available: false,
    moreAvailable: false,
    cursor_exhausted: false,
    rate_limited: false,
    retry_after_seconds: null,
    provider_limited: false,
    provider_limit_reached: false,
    cache_id: null,
    replay_preview_only: true,
    transactions: [],
    metadata,
  };
}

function buildMetadata(providerPage, cacheMetadata, options = {}) {
  const pageMetadata = providerPage.metadata || {};
  const loadedPages = normalizeNonNegativeInteger(options.loadedPages);
  const nextCursor = providerPage.next_cursor ?? null;
  const providerLimited = pageMetadata.provider_limited === true || pageMetadata.provider_limit_reached === true;
  const rateLimited = pageMetadata.rate_limited === true;
  return {
    ...commonBoundaryMetadata(),
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_configured: pageMetadata.provider_configured === true,
    provider_unavailable: pageMetadata.provider_unavailable === true,
    provider_grade: "partial",
    replay_suitability: "medium",
    completeness_confidence: 55,
    historical_depth: "provider_defined",
    ordering_guarantee: "reverse_chronological",
    cursor_guarantee: "best_effort",
    coverage_scope: "wallet_with_token_accounts",
    rate_limited: rateLimited,
    retry_after_seconds: pageMetadata.retry_after_seconds ?? null,
    provider_limited: providerLimited,
    provider_limit_reached: providerLimited,
    provider_limit_reason: pageMetadata.provider_limit_reason || "",
    cursor: providerPage.cursor ?? null,
    current_cursor: providerPage.current_cursor ?? null,
    next_cursor: nextCursor,
    more_available: Boolean(providerPage.more_available),
    cursor_exhausted: Boolean(providerPage.cursor_exhausted),
    pages_loaded: loadedPages + (providerPage.status === "ok" ? 1 : 0),
    requested_limit: pageMetadata.requested_limit || providerPage.requested_limit || 10,
    returned_count: providerPage.returned_count || 0,
    provider_page_count: providerPage.provider_page_count || 0,
    max_page_cap: options.maxPageCap || DEFAULT_MAX_PAGE_CAP,
    cache_id: cacheMetadata.cache_id,
    cache_status: cacheMetadata.cache_status,
    cache_hit: cacheMetadata.cache_hit,
    cache_ttl_seconds: cacheMetadata.cache_ttl_seconds,
    cache_namespace: cacheMetadata.cache_namespace,
    cache_storage: cacheMetadata.cache_storage,
    cache_version: "d369_memory_sanitized_page_cache_v1",
    scan_cache: {
      cache_id: cacheMetadata.cache_id,
      storage: "memory_best_effort",
      persisted: false,
      ttl_seconds: cacheMetadata.cache_ttl_seconds,
      browser_receives_metadata_only: true,
      raw_provider_payload_exposed: false,
      provider_secret_exposed: false,
    },
    provider_diagnostics: buildProviderDiagnostics(),
    scan_id: cacheMetadata.cache_id,
    gap_flags: providerLimited ? ["provider_limited"] : rateLimited ? ["rate_limited"] : [],
    warnings: ["History pages are staged for preview/review only and are not merged into the active graph."],
    replay_preview_only: true,
    active_graph_unchanged: true,
    full_history_loaded: false,
    full_history_claim_allowed: false,
  };
}

function diagnosticsResponse(query = {}) {
  const provider = getProviderConfig(process.env);
  return {
    status: "diagnostics_ok",
    provider: "helius",
    wallet: safeString(query.wallet),
    providerDiagnostics: buildProviderDiagnostics(),
    transactions: [],
    metadata: {
      ...commonBoundaryMetadata(),
      provider: "helius",
      provider_label: "Helius getTransactionsForAddress",
      provider_configured: provider.configured,
      provider_unavailable: !provider.configured,
      no_history_page_loaded: true,
      rate_limited: false,
      retry_after_seconds: null,
      provider_limited: false,
      no_data_merged: true,
    },
  };
}

function buildProviderDiagnostics() {
  const provider = getProviderConfig(process.env);
  return {
    configured: provider.configured,
    active_provider: "helius",
    provider_family: provider.provider_family,
    provider_grade: "partial",
    archive_readiness: provider.configured ? "bounded_cursor" : "missing_env_key",
    replay_suitability: "medium",
    missing_env_vars: provider.missing_env_vars,
    capabilities: provider.capabilities,
  };
}

function buildParserSummary(transactions) {
  const parserLimitedCount = transactions.filter((transaction) => {
    return Array.isArray(transaction.parser_limitations) && transaction.parser_limitations.some((item) => /limited|unavailable|missing/i.test(String(item)));
  }).length;
  const confidenceValues = transactions.map((transaction) => Number(transaction.parser_confidence)).filter(Number.isFinite);
  const averageConfidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
    : null;
  return {
    normalized_transaction_count: transactions.length,
    parser_limited_count: parserLimitedCount,
    average_parser_confidence: averageConfidence,
    raw_provider_payloads_included: false,
  };
}

function withCacheMetadata(payload, cacheMetadata) {
  return {
    ...payload,
    cache_id: cacheMetadata.cache_id,
    metadata: {
      ...(payload.metadata || {}),
      ...cacheMetadata,
      scan_cache: {
        ...(payload.metadata?.scan_cache || {}),
        cache_id: cacheMetadata.cache_id,
        storage: "memory_best_effort",
        persisted: false,
      },
    },
  };
}

function commonBoundaryMetadata() {
  return {
    ...BOUNDARY_FIELDS,
    wallet_identity_claimed: false,
    ownership_claimed: false,
    source_of_funds_claimed: false,
    risk_claimed: false,
    criminality_claimed: false,
    complete_history_claimed: false,
    liquidity_truth_claimed: false,
    production_meaning: false,
    live_blockchain_fetching: false,
  };
}

function getQuery(req) {
  const url = new URL(req.url || "", "http://localhost");
  return Object.fromEntries(url.searchParams.entries());
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function sendJson(res, statusCode, payload) {
  setHeaders(res);
  res.statusCode = statusCode;
  if (statusCode === 204) return res.end();
  return res.end(JSON.stringify(payload, null, 2));
}

function setHeaders(res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
}
