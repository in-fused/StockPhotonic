"use strict";

const { getCache, setCache } = require("./_shared/cache");
const { fetchWalletHistoryPage, getProviderConfig, isValidWallet, normalizeLimit } = require("./_shared/provider");
const { normalizeProviderTransactionsToEvents } = require("./_shared/normalize");

const CACHE_TTL_SECONDS = 45;
const BOUNDARY_FIELDS = {
  browser_provider_calls: false,
  provider_keys_included: false,
  raw_provider_payloads_included: false,
};

module.exports = async function walletActivityHandler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "OPTIONS") {
    return sendJson(res, 405, emptyResponse({
      status: "method_not_allowed",
      message: "Use GET for wallet activity lookup.",
    }));
  }
  if (req.method === "OPTIONS") return sendJson(res, 204, null);

  const query = getQuery(req);
  const wallet = safeString(query.wallet);
  const limit = normalizeLimit(query.limit);

  if (!wallet) {
    return sendJson(res, 400, emptyResponse({
      status: "missing_wallet",
      message: "Wallet query parameter is required. No provider request was made.",
      wallet,
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
      limit,
      metadata: {
        provider_configured: false,
        provider_unavailable: true,
        no_data_merged: true,
      },
    }));
  }

  const cacheParts = { endpoint: "wallet-activity", wallet, limit, cursor: null };
  const cached = getCache("crypto-wallet-activity", cacheParts, { ttlSeconds: CACHE_TTL_SECONDS });
  if (cached.hit) {
    return sendJson(res, 200, withCacheMetadata(cached.value, cached.metadata));
  }

  const providerPage = await fetchWalletHistoryPage({ wallet, limit, cursor: null }, process.env);
  const events = providerPage.status === "ok"
    ? normalizeProviderTransactionsToEvents(providerPage.transactions, {
        wallet,
        nextCursor: providerPage.next_cursor,
        ingestionSource: "helius_wallet_lookup",
      })
    : [];
  const response = buildResponse(providerPage, events, cached.metadata);
  setCache("crypto-wallet-activity", cacheParts, response, { ttlSeconds: CACHE_TTL_SECONDS });
  return sendJson(res, 200, response);
};

function buildResponse(providerPage, events, cacheMetadata) {
  const metadata = buildMetadata(providerPage, {
    ...cacheMetadata,
    cache_status: "miss",
    cache_hit: false,
  });
  const zeroEvents = events.length === 0;
  return {
    status: providerPage.status || "ok",
    wallet: providerPage.wallet || "",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    message: providerPage.message || (zeroEvents ? "Zero real provider events returned for this bounded page. No sample fallback is included." : "Sanitized wallet activity returned."),
    events,
    next_cursor: providerPage.next_cursor ?? null,
    nextCursor: providerPage.next_cursor ?? null,
    more_available: Boolean(providerPage.more_available),
    moreAvailable: Boolean(providerPage.more_available),
    cursor_exhausted: Boolean(providerPage.cursor_exhausted),
    rate_limited: Boolean(metadata.rate_limited),
    retry_after_seconds: metadata.retry_after_seconds,
    provider_limited: Boolean(metadata.provider_limited),
    cache_id: metadata.cache_id,
    metadata: {
      ...metadata,
      events_returned: events.length,
      zero_events: zeroEvents,
      wallet_lookup_replacement_graph: true,
      wallet_lookup_fixture_merge: false,
      no_sample_fallback: true,
      no_data_merged: zeroEvents,
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
    cursor: null,
    current_cursor: null,
    next_cursor: null,
    more_available: false,
    cursor_exhausted: false,
    requested_limit: options.limit || 10,
    returned_count: 0,
    cache_id: null,
    cache_status: "miss",
    cache_hit: false,
    cache_ttl_seconds: null,
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
    message: options.message || "No wallet activity returned. No sample fallback is included.",
    events: [],
    next_cursor: null,
    nextCursor: null,
    more_available: false,
    moreAvailable: false,
    cursor_exhausted: false,
    rate_limited: false,
    retry_after_seconds: null,
    provider_limited: false,
    cache_id: null,
    metadata,
  };
}

function buildMetadata(providerPage, cacheMetadata) {
  const pageMetadata = providerPage.metadata || {};
  return {
    ...commonBoundaryMetadata(),
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_configured: pageMetadata.provider_configured === true,
    provider_unavailable: pageMetadata.provider_unavailable === true,
    rate_limited: pageMetadata.rate_limited === true,
    retry_after_seconds: pageMetadata.retry_after_seconds ?? null,
    provider_limited: pageMetadata.provider_limited === true,
    provider_limit_reached: pageMetadata.provider_limit_reached === true,
    provider_limit_reason: pageMetadata.provider_limit_reason || "",
    cursor: providerPage.cursor ?? null,
    current_cursor: providerPage.current_cursor ?? null,
    next_cursor: providerPage.next_cursor ?? null,
    more_available: Boolean(providerPage.more_available),
    cursor_exhausted: Boolean(providerPage.cursor_exhausted),
    requested_limit: pageMetadata.requested_limit || providerPage.requested_limit || 10,
    returned_count: providerPage.returned_count || 0,
    provider_page_count: providerPage.provider_page_count || 0,
    cache_id: cacheMetadata.cache_id,
    cache_status: cacheMetadata.cache_status,
    cache_hit: cacheMetadata.cache_hit,
    cache_ttl_seconds: cacheMetadata.cache_ttl_seconds,
    cache_namespace: cacheMetadata.cache_namespace,
    cache_storage: cacheMetadata.cache_storage,
    full_history_loaded: false,
    full_history_claim_allowed: false,
  };
}

function withCacheMetadata(payload, cacheMetadata) {
  return {
    ...payload,
    cache_id: cacheMetadata.cache_id,
    metadata: {
      ...(payload.metadata || {}),
      ...cacheMetadata,
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
