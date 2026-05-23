"use strict";

const { getCacheDiagnostics } = require("./_shared/cache");
const { DEFAULT_LIMIT, DEFAULT_MAX_PAGE_CAP, MAX_LIMIT, getProviderConfig } = require("./_shared/provider");

const BOUNDARY_FIELDS = {
  browser_provider_calls: false,
  provider_keys_included: false,
  raw_provider_payloads_included: false,
};

module.exports = async function providerDiagnosticsHandler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "OPTIONS") {
    return sendJson(res, 405, {
      status: "method_not_allowed",
      message: "Use GET for provider diagnostics.",
      providerDiagnostics: buildDiagnostics(),
      metadata: commonMetadata(),
    });
  }

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, null);
  }

  const diagnostics = buildDiagnostics();
  return sendJson(res, 200, {
    status: "diagnostics_ok",
    provider: diagnostics.active_provider,
    providerDiagnostics: diagnostics,
    metadata: {
      ...commonMetadata(),
      provider_configured: diagnostics.configured,
      provider_unavailable: !diagnostics.configured,
      no_history_page_loaded: true,
      rate_limited: false,
      retry_after_seconds: null,
      provider_limited: false,
      rate_limit_defaults: diagnostics.rate_limit_defaults,
      cache: diagnostics.cache,
    },
  });
};

function buildDiagnostics() {
  const provider = getProviderConfig(process.env);
  return {
    configured: provider.configured,
    active_provider: "helius",
    provider_label: provider.provider_label,
    provider_family: provider.provider_family,
    provider_grade: "partial",
    archive_readiness: provider.configured ? "bounded_cursor" : "missing_env_key",
    replay_suitability: "medium",
    missing_env_vars: provider.missing_env_vars,
    capabilities: {
      ...provider.capabilities,
      backendOnly: true,
      browserProviderCalls: false,
      apiKeyExposure: false,
      rawProviderPayloadExposure: false,
    },
    cache: getCacheDiagnostics(),
    rate_limit_defaults: {
      default_limit: DEFAULT_LIMIT,
      max_limit: MAX_LIMIT,
      max_pages_per_scan: DEFAULT_MAX_PAGE_CAP,
      retry_after_header_supported: true,
      stop_on_rate_limit: true,
    },
    boundary: {
      ...BOUNDARY_FIELDS,
      provider_key_env_var: "HELIUS_API_KEY",
      provider_key_value_included: false,
      keyed_urls_included: false,
      request_headers_included: false,
    },
  };
}

function commonMetadata() {
  return {
    ...BOUNDARY_FIELDS,
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    cache_status: "diagnostics",
    cache_hit: false,
    cache_ttl_seconds: null,
    wallet_identity_claimed: false,
    ownership_claimed: false,
    source_of_funds_claimed: false,
    risk_claimed: false,
    criminality_claimed: false,
    complete_history_claimed: false,
    liquidity_truth_claimed: false,
  };
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
