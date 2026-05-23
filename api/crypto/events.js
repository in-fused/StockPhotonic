"use strict";

const { getCache, setCache } = require("./_shared/cache");
const { fetchWalletHistoryPage, getProviderConfig, isValidWallet, normalizeLimit } = require("./_shared/provider");
const { normalizeProviderTransactionsToEvents } = require("./_shared/normalize");

const CACHE_TTL_SECONDS = 15;
const DEFAULT_POLL_SECONDS = 20;
const RATE_LIMIT_POLL_SECONDS = 60;
const BOUNDARY_FIELDS = {
  browser_provider_calls: false,
  provider_keys_included: false,
  raw_provider_payloads_included: false,
};

module.exports = async function eventsHandler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "OPTIONS") {
    return sendJson(res, 405, emptyResponse({
      status: "method_not_allowed",
      message: "Use GET for Crypto events.",
    }));
  }
  if (req.method === "OPTIONS") return sendJson(res, 204, null);

  const query = getQuery(req);
  const wallet = safeString(query.wallet);
  const limit = normalizeLimit(query.limit, { defaultLimit: 10, maxLimit: 25 });
  const provider = getProviderConfig(process.env);

  if (!wallet) {
    return sendJson(res, 200, emptyResponse({
      status: "no_wallet_configured",
      message: "No wallet query supplied. No global live feed is faked and no provider request was made.",
      wallet,
      limit,
      metadata: {
        provider_configured: provider.configured,
        provider_unavailable: !provider.configured,
        no_wallet_supplied: true,
        stop_polling: false,
        poll_after_seconds: DEFAULT_POLL_SECONDS,
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
        stop_polling: true,
      },
    }));
  }

  if (!provider.configured) {
    return sendJson(res, 200, emptyResponse({
      status: "provider_unavailable",
      message: "Provider unavailable: HELIUS_API_KEY is not configured in the server environment.",
      wallet,
      limit,
      metadata: {
        provider_configured: false,
        provider_unavailable: true,
        no_data_merged: true,
        poll_after_seconds: RATE_LIMIT_POLL_SECONDS,
      },
    }));
  }

  const cacheParts = { endpoint: "events", wallet, limit, cursor: null };
  const cached = getCache("crypto-events", cacheParts, { ttlSeconds: CACHE_TTL_SECONDS });
  if (cached.hit) {
    return sendJson(res, 200, withCacheMetadata(cached.value, cached.metadata));
  }

  const providerPage = await fetchWalletHistoryPage({ wallet, limit, cursor: null }, process.env);
  const events = providerPage.status === "ok"
    ? normalizeProviderTransactionsToEvents(providerPage.transactions, {
        wallet,
        nextCursor: providerPage.next_cursor,
        ingestionSource: "helius_wallet_history",
      })
    : [];
  const response = buildResponse(providerPage, events, {
    ...cached.metadata,
    cache_status: "miss",
    cache_hit: false,
  });
  setCache("crypto-events", cacheParts, response, { ttlSeconds: CACHE_TTL_SECONDS });
  return sendJson(res, 200, response);
};

function buildResponse(providerPage, events, cacheMetadata) {
  const metadata = buildMetadata(providerPage, cacheMetadata);
  return {
    status: providerPage.status || "ok",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    wallet: providerPage.wallet || "",
    message: providerPage.message || (events.length ? "Sanitized recent wallet events returned." : "Zero recent wallet events returned. No sample/dev events are included."),
    events,
    cursor: providerPage.cursor ?? null,
    current_cursor: providerPage.current_cursor ?? null,
    next_cursor: providerPage.next_cursor ?? null,
    nextCursor: providerPage.next_cursor ?? null,
    more_available: Boolean(providerPage.more_available),
    moreAvailable: Boolean(providerPage.more_available),
    cursor_exhausted: Boolean(providerPage.cursor_exhausted),
    rate_limited: Boolean(metadata.rate_limited),
    retry_after_seconds: metadata.retry_after_seconds,
    stop_polling: Boolean(metadata.stop_polling),
    poll_after_seconds: metadata.poll_after_seconds,
    provider_limited: Boolean(metadata.provider_limited),
    cache_id: metadata.cache_id,
    metadata: {
      ...metadata,
      events_returned: events.length,
      zero_events: events.length === 0,
      no_sample_fallback: true,
      no_global_live_feed: false,
    },
  };
}

function emptyResponse(options = {}) {
  const provider = getProviderConfig(process.env);
  const rateLimited = Boolean(options.metadata?.rate_limited);
  const metadata = {
    ...commonBoundaryMetadata(),
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_configured: provider.configured,
    provider_unavailable: !provider.configured,
    rate_limited: rateLimited,
    retry_after_seconds: options.metadata?.retry_after_seconds ?? null,
    stop_polling: Boolean(options.metadata?.stop_polling),
    poll_after_seconds: options.metadata?.poll_after_seconds ?? (rateLimited ? RATE_LIMIT_POLL_SECONDS : DEFAULT_POLL_SECONDS),
    poll_interval_seconds: DEFAULT_POLL_SECONDS,
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
    no_sample_fallback: true,
    no_global_live_feed: true,
    full_history_loaded: false,
    full_history_claim_allowed: false,
    ...(options.metadata || {}),
  };
  return {
    status: options.status || "empty",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    wallet: options.wallet || "",
    message: options.message || "No events returned. No sample fallback is included.",
    events: [],
    cursor: null,
    current_cursor: null,
    next_cursor: null,
    nextCursor: null,
    more_available: false,
    moreAvailable: false,
    cursor_exhausted: false,
    rate_limited: false,
    retry_after_seconds: null,
    stop_polling: Boolean(metadata.stop_polling),
    poll_after_seconds: metadata.poll_after_seconds,
    provider_limited: false,
    cache_id: null,
    metadata,
  };
}

function buildMetadata(providerPage, cacheMetadata) {
  const pageMetadata = providerPage.metadata || {};
  const retryAfter = pageMetadata.retry_after_seconds ?? null;
  const rateLimited = pageMetadata.rate_limited === true;
  return {
    ...commonBoundaryMetadata(),
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_configured: pageMetadata.provider_configured === true,
    provider_unavailable: pageMetadata.provider_unavailable === true,
    rate_limited: rateLimited,
    retry_after_seconds: retryAfter,
    stop_polling: rateLimited,
    poll_after_seconds: rateLimited && retryAfter ? retryAfter : DEFAULT_POLL_SECONDS,
    poll_interval_seconds: DEFAULT_POLL_SECONDS,
    provider_limited: pageMetadata.provider_limited === true,
    provider_limit_reached: pageMetadata.provider_limit_reached === true,
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
