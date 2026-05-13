import {
  normalizeEvent,
  UnsafeEventInputError,
  InvalidEventInputError,
} from "./sanitize.js";
import { createRuntimeStorage } from "./storage.js";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 100;
const DEFAULT_WALLET_ACTIVITY_LIMIT = 10;
const MAX_WALLET_ACTIVITY_LIMIT = 25;
const DEFAULT_WALLET_HISTORY_LIMIT = 10;
const MAX_WALLET_HISTORY_LIMIT = 50;
const WALLET_HISTORY_PROVIDER_LIMITED_STATUSES = new Set([400, 401, 403, 404, 410]);
const WALLET_HISTORY_CACHE_TTL_SECONDS = 45;
const WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS = 60;
const WALLET_HISTORY_RATE_LIMIT_FETCHES = 12;
const WALLET_LOOKUP_COOLDOWN_MS = 60 * 1000;
const WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION = "d129_archive_history_contract_v1";
const WALLET_HISTORY_SCAN_MANIFEST_VERSION = "d130_scan_manifest_v1";
const WALLET_HISTORY_SCAN_CACHE_VERSION = "d131_persisted_scan_cache_v1";
const WALLET_HISTORY_REPLAY_RECONSTRUCTION_VERSION = "d131_replay_reconstruction_v1";
const WALLET_HISTORY_REPLAY_WINDOW_VERSION = "d135_replay_window_v1";
const WALLET_HISTORY_REPLAY_GAP_MAP_VERSION = "d136_replay_gap_map_v1";
const WALLET_LOOKUP_CACHE_KEY_PREFIX = "crypto-wallet-lookup:";
const WALLET_HISTORY_CACHE_KEY_PREFIX = "crypto-wallet-history:page:";
const WALLET_HISTORY_RATE_KEY_PREFIX = "crypto-wallet-history:rate:";
const WALLET_HISTORY_SCAN_KEY_PREFIX = "crypto-wallet-history:scan:";
const WALLET_HISTORY_SCAN_PAGE_KEY_PREFIX = "crypto-wallet-history:scan-page:";
const WALLET_HISTORY_SCAN_PAGE_REF_KEY_PREFIX = "crypto-wallet-history:scan-page-ref:";
const WALLET_HISTORY_SCAN_TRANSACTION_KEY_PREFIX = "crypto-wallet-history:scan-transaction:";
const WALLET_HISTORY_REPLAY_CACHE_KEY_PREFIX = "crypto-wallet-history:replay-cache:";
const MAX_WALLET_LOOKUP_CACHE_ITEMS = 100;
const MAX_WALLET_HISTORY_CACHE_ITEMS = 160;
const MAX_WALLET_HISTORY_RATE_ITEMS = 160;
const MAX_WALLET_HISTORY_SCAN_ITEMS = 120;
const MAX_WALLET_HISTORY_SCAN_PAGE_ITEMS = 220;
const MAX_WALLET_HISTORY_SCAN_TRANSACTION_ITEMS = 1500;
const MAX_WALLET_HISTORY_REPLAY_CACHE_ITEMS = 120;
const MAX_TEST_EVENT_BATCH = 10;
const MAX_HELIUS_WEBHOOK_BATCH = 10;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const HELIUS_ADDRESS_HISTORY_ENDPOINT = "https://api-mainnet.helius-rpc.com/v0/addresses";
const HELIUS_RPC_ENDPOINT = "https://mainnet.helius-rpc.com/";
const HELIUS_ARCHIVE_METHOD = "getTransactionsForAddress";
const HELIUS_ARCHIVE_TRANSACTION_DETAILS = "full";
const WALLET_HISTORY_SCAN_TTL_SECONDS = 24 * 60 * 60;
const WALLET_HISTORY_SCAN_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const WALLET_HISTORY_REPLAY_CHUNK_SIZE = 80;
const WALLET_HISTORY_REPLAY_RENDER_CAP = 320;
const WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS = 320;
const WALLET_HISTORY_REPLAY_MAX_TIMELINE_SEGMENTS = 128;
const DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS = "balanceChanged";
const SUPPORTED_HELIUS_HISTORY_TOKEN_ACCOUNTS = new Set(["none", "balanceChanged", "all"]);
const SUPPORTED_HELIUS_HISTORY_SORT_ORDERS = new Set(["asc", "desc"]);
const SUPPORTED_HELIUS_HISTORY_STATUS_FILTERS = new Set(["any", "succeeded", "failed"]);
const WALLET_HISTORY_PROVIDER_CANDIDATES = Object.freeze([
  {
    id: "helius",
    label: "Helius getTransactionsForAddress archive history",
    readiness: "worker_ready_when_selected_and_HELIUS_API_KEY_is_configured",
    auth_required: "HELIUS_API_KEY Worker secret",
    expected_depth: "archive-path provider history; scan completeness still depends on cursor exhaustion and gap checks",
    pagination_model: "paginationToken cursor",
    limitations: "Archive path can still be limited by plan, credits, rate limits, schema drift, malformed ordering, or token-account coverage settings.",
    provider_grade: "archive",
    replay_suitability: "high",
    completeness_confidence: 72,
    historical_depth: "provider_defined_archive_path",
    ordering_guarantee: "bidirectional_slot_transaction_index",
    cursor_guarantee: "stable_pagination_token_best_effort",
    coverage_scope: "wallet_with_token_accounts",
    provider_family: "helius",
    archive_readiness: "archive_path_available",
    replay_readiness: "chronological_replay_ready_when_scan_exhausts_without_gaps",
    chronological_ordering_support: true,
    token_account_coverage_support: true,
    deterministic_pagination_support: true,
    gap_detection_support: true,
    frontend_allowed: false,
    worker_backed: true,
  },
  {
    id: "generic",
    label: "Generic Worker-side external wallet history endpoint",
    readiness: "worker_ready_when_selected_and_CRYPTO_WALLET_HISTORY_URL_is_configured",
    auth_required: "Optional CRYPTO_WALLET_HISTORY_BEARER_TOKEN Worker secret",
    expected_depth: "depends on the configured upstream provider",
    pagination_model: "generic cursor query parameter and nextCursor response",
    limitations: "Coverage, ordering, cursor guarantees, and totals depend on the external endpoint contract.",
    provider_grade: "basic",
    replay_suitability: "low",
    completeness_confidence: 25,
    historical_depth: "provider_defined",
    ordering_guarantee: "unknown",
    cursor_guarantee: "unknown",
    coverage_scope: "provider_defined",
    provider_family: "generic_external",
    archive_readiness: "depends_on_configured_upstream",
    replay_readiness: "low_until_upstream_contract_proves_ordering",
    chronological_ordering_support: false,
    token_account_coverage_support: false,
    deterministic_pagination_support: false,
    gap_detection_support: false,
    frontend_allowed: false,
    worker_backed: true,
  },
  {
    id: "lana",
    label: "lana.ai wallet history placeholder",
    readiness: "placeholder_only_no_public_api_or_auth_docs_verified",
    auth_required: "unknown until public API/auth documentation is verified",
    expected_depth: "unknown",
    pagination_model: "unknown",
    limitations: "Placeholder only. The Worker does not call lana.ai without clear public API/auth documentation.",
    provider_grade: "basic",
    replay_suitability: "low",
    completeness_confidence: 0,
    historical_depth: "unknown",
    ordering_guarantee: "unknown",
    cursor_guarantee: "unknown",
    coverage_scope: "unknown",
    provider_family: "lana",
    archive_readiness: "placeholder_only",
    replay_readiness: "not_ready",
    chronological_ordering_support: false,
    token_account_coverage_support: false,
    deterministic_pagination_support: false,
    gap_detection_support: false,
    frontend_allowed: false,
    worker_backed: false,
  },
  {
    id: "rpc_archive",
    label: "Future RPC/archive provider placeholder",
    readiness: "future_archive_grade_provider_not_implemented",
    auth_required: "provider-specific Worker secret or private endpoint",
    expected_depth: "archive-grade only if the provider supplies complete indexed account history",
    pagination_model: "provider-specific signature, slot, or indexed cursor",
    limitations: "Not implemented. Standard RPC alone is not enough to prove full lifetime wallet history at scale.",
    provider_grade: "basic",
    replay_suitability: "low",
    completeness_confidence: 0,
    historical_depth: "unknown",
    ordering_guarantee: "unknown",
    cursor_guarantee: "unknown",
    coverage_scope: "unknown",
    provider_family: "archive_rpc",
    archive_readiness: "future_provider_not_implemented",
    replay_readiness: "not_ready",
    chronological_ordering_support: false,
    token_account_coverage_support: false,
    deterministic_pagination_support: false,
    gap_detection_support: false,
    frontend_allowed: false,
    worker_backed: false,
  },
]);
const HELIUS_ALLOWED_WALLETS = [
  "CryptoPhotonicControlledWallet1111111111111111111",
];
const walletLookupMemoryCache = new Map();
const walletHistoryMemoryCache = new Map();
const walletHistoryRateMemoryCache = new Map();
const walletHistoryScanMemoryCache = new Map();
const walletHistoryScanPageMemoryCache = new Map();
const walletHistoryScanPageRefMemoryCache = new Map();
const walletHistoryScanTransactionMemoryCache = new Map();
const walletHistoryReplayCacheMemoryCache = new Map();

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-cryptophotonic-webhook-secret",
};

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const storage = createRuntimeStorage(env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: JSON_HEADERS,
      });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json(await storage.getRuntimeStatus());
      }

      if (request.method === "GET" && url.pathname === "/api/crypto/events") {
        const feedQuery = parseEventFeedQuery(url);
        const events = await storage.listEvents();
        const filteredEvents = applyEventFilters(events, feedQuery.filters).slice(0, feedQuery.limit);

        return json({
          events: filteredEvents,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
            source: "secure_runtime_feed",
            count: filteredEvents.length,
            filters_applied: feedQuery.filtersApplied,
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/api/crypto/wallet-activity") {
        const query = parseWalletActivityQuery(url);
        const heliusApiKey = safeString(env.HELIUS_API_KEY);
        if (!heliusApiKey) {
          return json({
            error: "wallet_lookup_not_configured",
            message: "HELIUS_API_KEY is not configured. Set it as a Wrangler secret before using wallet lookup.",
            metadata: {
              sanitized: true,
              production_meaning: false,
              live_blockchain_fetching: false,
              source: "helius_wallet_lookup",
            },
          }, 503);
        }

        const cacheStatus = await getWalletLookupCacheStatus(env, query.wallet);
        const cachedEvents = applyEventFilters(await storage.listEvents(), {
          since: null,
          wallet: query.wallet,
          token: null,
          transaction_type: null,
        }).slice(0, query.limit);

        if (cacheStatus.fresh && cachedEvents.length > 0) {
          return json({
            events: cachedEvents,
            metadata: {
              sanitized: true,
              production_meaning: false,
              live_blockchain_fetching: false,
              source: "helius_wallet_lookup_cache",
              count: cachedEvents.length,
              wallet: query.wallet,
              limit: query.limit,
              provider_fetch_performed: false,
              cooldown_seconds_remaining: Math.ceil(cacheStatus.remainingMs / 1000),
            },
          });
        }

        const providerTransactions = await fetchHeliusAddressHistory({
          wallet: query.wallet,
          limit: query.limit,
          heliusApiKey,
        });
        const receivedAt = new Date().toISOString();
        const events = normalizeHeliusWalletLookupPayload(providerTransactions, {
          wallet: query.wallet,
          receivedAt,
        });
        const results = [];

        for (const event of events) {
          results.push(await storage.addEvent(event));
        }

        await putWalletLookupCacheStatus(env, query.wallet, {
          fetchedAt: receivedAt,
          count: results.length,
        });

        return json({
          events: results.map((result) => result.event),
          stored: results.filter((result) => result.stored).length,
          duplicate: results.every((result) => result.duplicate),
          duplicates: results.filter((result) => result.duplicate).length,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
            source: "helius_wallet_lookup",
            count: results.length,
            wallet: query.wallet,
            limit: query.limit,
            provider_fetch_performed: true,
            cooldown_seconds: Math.round(WALLET_LOOKUP_COOLDOWN_MS / 1000),
          },
        });
      }

      if (request.method === "GET" && isWalletHistoryReplayWindowEndpointPath(url.pathname)) {
        const query = parseWalletHistoryReplayWindowQuery(url);
        const replayWindow = await fetchWalletHistoryReplayWindow(query, env);
        return json(replayWindow, replayWindow.httpStatus || 200);
      }

      if (request.method === "GET" && isWalletHistoryEndpointPath(url.pathname)) {
        const query = parseWalletHistoryQuery(url);
        const page = await fetchWalletHistoryPage(query, env);
        return json(page, page.httpStatus || 200);
      }

      if (request.method === "POST" && url.pathname === "/api/crypto/test-event") {
        const payload = await readJson(request);
        const events = normalizeTestEventPayload(payload);
        const results = [];

        for (const event of events) {
          results.push(await storage.addEvent(event));
        }

        const responseBody = {
          stored: results.filter((result) => result.stored).length,
          duplicate: results.every((result) => result.duplicate),
          duplicates: results.filter((result) => result.duplicate).length,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
            source: "secure_runtime_feed",
            count: results.length,
          },
        };

        if (Array.isArray(payload)) {
          responseBody.events = results.map((result) => result.event);
        } else {
          responseBody.event = results[0].event;
        }

        return json(responseBody, results.every((result) => result.duplicate) ? 200 : 201);
      }

      if (request.method === "POST" && url.pathname === "/webhooks/helius") {
        const authMetadata = verifyHeliusWebhookAuth(request, env);
        const allowedWallets = getAllowedHeliusWallets(env);
        const payload = await readJson(request);
        const events = normalizeHeliusWebhookPayload(payload, {
          allowedWallets,
          receivedAt: new Date().toISOString(),
        });
        const results = [];

        for (const event of events) {
          results.push(await storage.addEvent(event));
        }

        return json({
          stored: results.filter((result) => result.stored).length,
          duplicate: results.every((result) => result.duplicate),
          duplicates: results.filter((result) => result.duplicate).length,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
            source: "helius_webhook",
            count: results.length,
            webhook_auth: authMetadata,
            watchlist_size: allowedWallets.length,
          },
        }, results.every((result) => result.duplicate) ? 200 : 202);
      }

      if (request.method === "POST" && url.pathname === "/api/crypto/dev/clear-events") {
        if (!isDevEnvironment(env)) {
          return json({
            error: "not_found",
          }, 404);
        }

        const result = await storage.clearEvents();
        return json({
          cleared: result.cleared,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
            source: "secure_runtime_feed",
          },
        });
      }

      return json({
        error: "not_found",
      }, 404);
    } catch (error) {
      return handleError(error);
    }
  },
};

class InvalidEventQueryError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "InvalidEventQueryError";
    this.issues = issues;
  }
}

class WebhookAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebhookAuthError";
  }
}

class WebhookConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebhookConfigError";
  }
}

class WebhookScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebhookScopeError";
  }
}

class WalletLookupProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "WalletLookupProviderError";
    this.status = status;
  }
}

class WalletHistoryProviderError extends Error {
  constructor(message, status = 502, code = "wallet_history_provider_unavailable", provider = "") {
    super(message);
    this.name = "WalletHistoryProviderError";
    this.status = status;
    this.code = code;
    this.provider = provider;
  }
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new InvalidEventInputError("Content-Type must be application/json.");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new InvalidEventInputError("Request body is too large.");
  }

  const text = await request.text();
  if (!text.trim()) {
    throw new InvalidEventInputError("Request body must be valid JSON.");
  }

  if (text.length > MAX_JSON_BODY_BYTES) {
    throw new InvalidEventInputError("Request body is too large.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidEventInputError("Request body must be valid JSON.");
  }
}

function normalizeTestEventPayload(payload) {
  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > MAX_TEST_EVENT_BATCH) {
      throw new InvalidEventInputError(`Event array must contain 1 to ${MAX_TEST_EVENT_BATCH} items.`);
    }

    return payload.map((event) => normalizeEvent(event, {
      ingestionSource: "local_test_event",
      receivedAt: new Date().toISOString(),
    }));
  }

  return [normalizeEvent(payload, {
    ingestionSource: "local_test_event",
    receivedAt: new Date().toISOString(),
  })];
}

function normalizeHeliusWebhookPayload(payload, options) {
  const transactions = getHeliusTransactions(payload, {
    maxBatch: MAX_HELIUS_WEBHOOK_BATCH,
    label: "Helius webhook",
  });

  return transactions.map((transaction, index) => {
    const event = reduceHeliusTransaction(transaction, index, options.receivedAt);
    const normalized = normalizeEvent(event, {
      ingestionSource: "helius_webhook",
      receivedAt: options.receivedAt,
    });

    if (!isEventInAllowedWalletScope(normalized, options.allowedWallets)) {
      throw new WebhookScopeError("Helius webhook event is outside the controlled wallet watchlist.");
    }

    return normalized;
  });
}

function normalizeHeliusWalletLookupPayload(payload, options) {
  const transactions = getHeliusTransactions(payload, {
    maxBatch: MAX_WALLET_ACTIVITY_LIMIT,
    label: "Helius wallet lookup",
    allowEmpty: true,
  });

  return transactions.slice(0, MAX_WALLET_ACTIVITY_LIMIT).map((transaction, index) => {
    const event = reduceHeliusTransaction(transaction, index, options.receivedAt, {
      trackedWallet: options.wallet,
      source: "worker-wallet-lookup",
    });

    return normalizeEvent(event, {
      ingestionSource: "helius_wallet_lookup",
      receivedAt: options.receivedAt,
    });
  });
}

function getHeliusTransactions(payload, options = {}) {
  const maxBatch = options.maxBatch || MAX_HELIUS_WEBHOOK_BATCH;
  const label = options.label || "Helius webhook";
  const allowEmpty = options.allowEmpty === true;
  let transactions;

  if (Array.isArray(payload)) {
    transactions = payload;
  } else if (payload && typeof payload === "object" && Array.isArray(payload.transactions)) {
    transactions = payload.transactions;
  } else if (payload && typeof payload === "object" && typeof payload.signature === "string") {
    transactions = [payload];
  } else {
    throw new InvalidEventInputError(`${label} payload must be an array of transactions or a transaction object.`);
  }

  if ((!allowEmpty && transactions.length === 0) || transactions.length > maxBatch) {
    const minimum = allowEmpty ? 0 : 1;
    throw new InvalidEventInputError(`${label} payload must contain ${minimum} to ${maxBatch} transactions.`);
  }

  if (!transactions.every((transaction) => transaction && typeof transaction === "object" && !Array.isArray(transaction))) {
    throw new InvalidEventInputError(`${label} transactions must be JSON objects.`);
  }

  return transactions;
}

function reduceHeliusTransaction(transaction, index, receivedAt, options = {}) {
  const signature = safeString(transaction.signature);
  if (!signature) {
    throw new InvalidEventInputError("Helius webhook transaction is missing a signature.");
  }

  const wallets = collectHeliusWallets(transaction);
  addWallet(wallets, options.trackedWallet, "tracked");
  if (wallets.length === 0) {
    throw new InvalidEventInputError("Helius webhook transaction has no wallet accounts to scope.");
  }

  return {
    id: `helius-${signature.slice(0, 64)}`,
    chain: "solana",
    signature,
    timestamp: normalizeHeliusTimestamp(transaction.timestamp, receivedAt),
    transaction_type: safeString(transaction.type || transaction.transactionType) || "unknown",
    source: safeString(options.source) || "helius-webhook",
    wallets,
    tokens: collectHeliusTokens(transaction),
    transfers: collectHeliusTransfers(transaction),
  };
}

function collectHeliusWallets(transaction) {
  const wallets = [];

  for (const account of safeObjectList(transaction.accountData)) {
    addWallet(wallets, account.account, "account");
  }

  for (const transfer of safeObjectList(transaction.nativeTransfers)) {
    addWallet(wallets, transfer.fromUserAccount, "sender");
    addWallet(wallets, transfer.toUserAccount, "receiver");
  }

  for (const transfer of safeObjectList(transaction.tokenTransfers)) {
    addWallet(wallets, transfer.fromUserAccount, "sender");
    addWallet(wallets, transfer.toUserAccount, "receiver");
  }

  const nftEvent = transaction.events && typeof transaction.events === "object" ? transaction.events.nft : null;
  if (nftEvent && typeof nftEvent === "object") {
    addWallet(wallets, nftEvent.seller, "seller");
    addWallet(wallets, nftEvent.buyer, "buyer");
  }

  return wallets;
}

function collectHeliusTokens(transaction) {
  const tokens = [];

  for (const transfer of safeObjectList(transaction.tokenTransfers)) {
    addToken(tokens, {
      symbol: transfer.tokenSymbol,
      mint: transfer.mint,
      decimals: transfer.decimals,
    });
  }

  return tokens;
}

function collectHeliusTransfers(transaction) {
  const transfers = [];

  for (const transfer of safeObjectList(transaction.nativeTransfers)) {
    transfers.push({
      token_symbol: "SOL",
      amount: safeString(transfer.amount),
      from: safeString(transfer.fromUserAccount),
      to: safeString(transfer.toUserAccount),
    });
  }

  for (const transfer of safeObjectList(transaction.tokenTransfers)) {
    transfers.push({
      token_symbol: safeString(transfer.tokenSymbol || transfer.mint),
      amount: safeString(transfer.tokenAmount),
      from: safeString(transfer.fromUserAccount),
      to: safeString(transfer.toUserAccount),
    });
  }

  return transfers;
}

function addWallet(wallets, address, role) {
  const normalizedAddress = safeString(address);
  if (!normalizedAddress || wallets.some((wallet) => equalsFilter(wallet.address, normalizedAddress))) {
    return;
  }

  wallets.push({
    address: normalizedAddress,
    role,
  });
}

function addToken(tokens, token) {
  const mint = safeString(token.mint);
  const symbol = safeString(token.symbol);
  if ((!mint && !symbol) || tokens.some((stored) => mint && equalsFilter(stored.mint, mint))) {
    return;
  }

  tokens.push({
    symbol,
    mint,
    decimals: token.decimals,
  });
}

function safeObjectList(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 32)
    : [];
}

function safeString(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 256) : null;
}

function normalizeHeliusTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 1000000000000 ? value * 1000 : value;
    return toIsoTimestamp(millis, fallback);
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(value.trim())) {
      const millis = numeric < 1000000000000 ? numeric * 1000 : numeric;
      return toIsoTimestamp(millis, fallback);
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return fallback;
}

function toIsoTimestamp(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function isEventInAllowedWalletScope(event, allowedWallets) {
  return event.wallets.some((wallet) => (
    allowedWallets.some((allowedWallet) => equalsFilter(wallet.address, allowedWallet))
  ));
}

function getAllowedHeliusWallets(env = {}) {
  const configuredWallets = parseWalletList(env.CRYPTO_HELIUS_ALLOWED_WALLETS);
  const wallets = configuredWallets.length > 0 ? configuredWallets : HELIUS_ALLOWED_WALLETS;
  const uniqueWallets = [];

  for (const wallet of wallets) {
    if (!uniqueWallets.some((stored) => equalsFilter(stored, wallet))) {
      uniqueWallets.push(wallet);
    }
  }

  if (uniqueWallets.length < 1 || uniqueWallets.length > 3) {
    throw new WebhookConfigError("Helius wallet watchlist must contain 1 to 3 wallets.");
  }

  return uniqueWallets;
}

function parseWalletList(value) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((wallet) => wallet.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function verifyHeliusWebhookAuth(request, env = {}) {
  const expected = safeString(env.HELIUS_WEBHOOK_AUTH_HEADER || env.HELIUS_WEBHOOK_SECRET);
  if (!expected) {
    if (isDevEnvironment(env)) {
      return {
        configured: false,
        verified: false,
        mode: "local_dev_auth_not_configured",
      };
    }

    throw new WebhookConfigError("HELIUS_WEBHOOK_AUTH_HEADER must be configured before accepting Helius webhooks.");
  }

  const authorization = request.headers.get("authorization") || "";
  const fallbackSecret = request.headers.get("x-cryptophotonic-webhook-secret") || "";
  const matchesAuthorization = authorization === expected || authorization === `Bearer ${expected}`;

  if (!matchesAuthorization && fallbackSecret !== expected) {
    throw new WebhookAuthError("Invalid Helius webhook authorization header.");
  }

  return {
    configured: true,
    verified: true,
    mode: "authorization_header",
  };
}

function parseWalletActivityQuery(url) {
  const allowedParams = new Set(["wallet", "limit"]);
  const issues = [];

  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      issues.push({
        param: key,
        reason: "unsupported_query_param",
      });
    }
  }

  const wallet = parseSolanaWalletAddress(url.searchParams.get("wallet"), issues);
  const limit = parseWalletActivityLimit(url.searchParams.get("limit"), issues);

  if (issues.length > 0) {
    throw new InvalidEventQueryError("Wallet activity query parameters are invalid.", issues);
  }

  return {
    wallet,
    limit,
  };
}

function parseSolanaWalletAddress(value, issues) {
  const wallet = typeof value === "string" ? value.trim() : "";
  if (!wallet) {
    issues.push({
      param: "wallet",
      reason: "required",
    });
    return null;
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    issues.push({
      param: "wallet",
      reason: "must_be_base58_solana_address_32_to_44_chars",
    });
    return null;
  }

  return wallet;
}

function parseWalletActivityLimit(value, issues) {
  if (value === null) {
    return DEFAULT_WALLET_ACTIVITY_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    issues.push({
      param: "limit",
      reason: "must_be_integer",
    });
    return DEFAULT_WALLET_ACTIVITY_LIMIT;
  }

  const limit = Number(value);
  if (limit < 1 || limit > MAX_WALLET_ACTIVITY_LIMIT) {
    issues.push({
      param: "limit",
      reason: `must_be_between_1_and_${MAX_WALLET_ACTIVITY_LIMIT}`,
    });
    return DEFAULT_WALLET_ACTIVITY_LIMIT;
  }

  return limit;
}

function parseWalletHistoryQuery(url) {
  const allowedParams = new Set(["wallet", "cursor", "scan_id", "limit", "loaded_pages", "loaded_transactions", "diagnostics"]);
  const issues = [];

  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      issues.push({
        param: key,
        reason: "unsupported_query_param",
      });
    }
  }

  const diagnostics = parseBooleanQueryFlag(url.searchParams.get("diagnostics"));
  const walletParam = url.searchParams.get("wallet");
  const wallet = diagnostics && !walletParam
    ? ""
    : parseSolanaWalletAddress(walletParam, issues);
  const cursor = parseWalletHistoryCursor(url.searchParams.get("cursor"), issues);
  const scanId = parseWalletHistoryScanId(url.searchParams.get("scan_id"), issues);
  const limitResult = parseWalletHistoryLimit(url.searchParams.get("limit"), issues);
  const observedPages = parseWalletHistoryObservedCount(url.searchParams.get("loaded_pages"), "loaded_pages", issues);
  const observedTransactions = parseWalletHistoryObservedCount(url.searchParams.get("loaded_transactions"), "loaded_transactions", issues);

  if (issues.length > 0) {
    throw new InvalidEventQueryError("Wallet history query parameters are invalid.", issues);
  }

  return {
    wallet,
    cursor,
    scanId,
    limit: limitResult.limit,
    requestedLimit: limitResult.requestedLimit,
    limitCapped: limitResult.capped,
    observedPages,
    observedTransactions,
    diagnostics,
  };
}

function parseWalletHistoryReplayWindowQuery(url) {
  const allowedParams = new Set(["scan_id", "window_id", "window_index", "direction", "anchor_step", "limit"]);
  const issues = [];

  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      issues.push({
        param: key,
        reason: "unsupported_query_param",
      });
    }
  }

  const scanId = parseWalletHistoryScanId(url.searchParams.get("scan_id"), issues);
  if (!scanId) {
    issues.push({
      param: "scan_id",
      reason: "required_for_replay_window",
    });
  }
  const windowIndex = parseReplayWindowIndex(url.searchParams.get("window_index"), issues);
  const direction = parseReplayWindowDirection(url.searchParams.get("direction"), issues);
  const anchorStep = parseReplayWindowAnchorStep(url.searchParams.get("anchor_step"), issues);
  const limit = parseReplayWindowLimit(url.searchParams.get("limit"), issues);
  const windowId = parseReplayWindowId(url.searchParams.get("window_id"), issues);

  if (issues.length > 0) {
    throw new InvalidEventQueryError("Replay window query parameters are invalid.", issues);
  }

  return {
    scanId,
    windowId,
    windowIndex,
    direction,
    anchorStep,
    limit,
  };
}

function parseReplayWindowIndex(value, issues) {
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(String(value))) {
    issues.push({
      param: "window_index",
      reason: "must_be_positive_integer",
    });
    return null;
  }
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 1 || index > 100000) {
    issues.push({
      param: "window_index",
      reason: "must_be_between_1_and_100000",
    });
    return null;
  }
  return index;
}

function parseReplayWindowAnchorStep(value, issues) {
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(String(value))) {
    issues.push({
      param: "anchor_step",
      reason: "must_be_positive_integer",
    });
    return null;
  }
  const step = Number(value);
  if (!Number.isSafeInteger(step) || step < 1 || step > 10000000) {
    issues.push({
      param: "anchor_step",
      reason: "must_be_between_1_and_10000000",
    });
    return null;
  }
  return step;
}

function parseReplayWindowLimit(value, issues) {
  if (value === null || value === "") return WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS;
  if (!/^\d+$/.test(String(value))) {
    issues.push({
      param: "limit",
      reason: "must_be_integer",
    });
    return WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS) {
    issues.push({
      param: "limit",
      reason: `must_be_between_1_and_${WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS}`,
    });
    return WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS;
  }
  return limit;
}

function parseReplayWindowDirection(value, issues) {
  const direction = safeString(value || "current").toLowerCase();
  const allowed = new Set(["current", "older", "newer", "oldest", "newest", "anchor"]);
  if (!allowed.has(direction)) {
    issues.push({
      param: "direction",
      reason: "must_be_current_older_newer_oldest_newest_or_anchor",
    });
    return "current";
  }
  return direction;
}

function parseReplayWindowId(value, issues) {
  if (value === null || value === "") return "";
  const id = safeString(value);
  if (!id || id.length > 220 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    issues.push({
      param: "window_id",
      reason: "must_be_safe_window_id_up_to_220_chars",
    });
    return "";
  }
  return id;
}

function parseWalletHistoryScanId(value, issues) {
  if (value === null) {
    return null;
  }

  const scanId = String(value || "").trim();
  if (!scanId || scanId.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(scanId)) {
    issues.push({
      param: "scan_id",
      reason: "must_be_safe_scan_id_up_to_180_chars",
    });
    return null;
  }

  return scanId;
}

function parseBooleanQueryFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseWalletHistoryObservedCount(value, param, issues) {
  if (value === null) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    issues.push({
      param,
      reason: "must_be_non_negative_integer",
    });
    return 0;
  }

  return Math.min(1000000, Number(value));
}

function parseWalletHistoryCursor(value, issues) {
  if (value === null) {
    return null;
  }

  const cursor = String(value || "").trim();
  if (!cursor || cursor.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(cursor)) {
    issues.push({
      param: "cursor",
      reason: "must_be_safe_cursor_token_up_to_160_chars",
    });
    return null;
  }

  return cursor;
}

function parseWalletHistoryLimit(value, issues) {
  if (value === null) {
    return {
      limit: DEFAULT_WALLET_HISTORY_LIMIT,
      requestedLimit: DEFAULT_WALLET_HISTORY_LIMIT,
      capped: false,
    };
  }

  if (!/^\d+$/.test(value)) {
    issues.push({
      param: "limit",
      reason: "must_be_integer",
    });
    return {
      limit: DEFAULT_WALLET_HISTORY_LIMIT,
      requestedLimit: DEFAULT_WALLET_HISTORY_LIMIT,
      capped: false,
    };
  }

  const requestedLimit = Number(value);
  const safeRequestedLimit = Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_WALLET_HISTORY_LIMIT;
  const limit = Math.max(1, Math.min(MAX_WALLET_HISTORY_LIMIT, safeRequestedLimit));
  return {
    limit,
    requestedLimit: safeRequestedLimit,
    capped: limit !== safeRequestedLimit,
  };
}

function isWalletHistoryEndpointPath(pathname) {
  return pathname === "/api/crypto/wallet-history" || pathname === "/api/crypto/wallet-history/";
}

function isWalletHistoryReplayWindowEndpointPath(pathname) {
  return pathname === "/api/crypto/wallet-history/replay-window"
    || pathname === "/api/crypto/wallet-history/replay-window/";
}

async function fetchWalletHistoryReplayWindow(query, env = {}) {
  const manifest = await readWalletHistoryScanManifest(env, query.scanId);
  if (!manifest?.scan_id) {
    return {
      status: "replay_window_unavailable",
      httpStatus: 404,
      message: "Replay window metadata was not found for this scan id. No provider was called and no raw payload was exposed.",
      events: [],
      transactions: [],
      moreAvailable: false,
      metadata: {
        endpoint_contract: "/api/crypto/wallet-history/replay-window",
        replay_window_version: WALLET_HISTORY_REPLAY_WINDOW_VERSION,
        scan_id: safeString(query.scanId),
        provider_fetch_performed: false,
        browser_provider_calls: false,
        provider_secret_exposed: false,
        raw_provider_payload_exposed: false,
        no_data_merged: true,
      },
    };
  }

  const reconstruction = sanitizeReplayReconstructionMetadata(manifest.replay_reconstruction);
  const descriptor = buildReplayWindowDescriptor(manifest, reconstruction, query);
  const transactions = await readReplayWindowTransactions(env, manifest, reconstruction, descriptor);
  const responseStatus = transactions.length ? "ok" : "replay_window_metadata_only";
  const cacheState = sanitizeWalletHistoryScanCacheState(manifest.cache_state);

  return {
    status: responseStatus,
    message: transactions.length
      ? "Replay window loaded from Worker-side normalized scan cache. Returned rows are sanitized staged history only."
      : "Replay window metadata loaded, but no normalized cached transactions were available for this window.",
    wallet: manifest.wallet,
    provider: manifest.provider,
    cursor: null,
    nextCursor: null,
    moreAvailable: descriptor.continuation.can_continue_older || descriptor.continuation.can_continue_newer,
    events: transactions,
    transactions,
    metadata: {
      endpoint_contract: "/api/crypto/wallet-history/replay-window",
      replay_window_version: WALLET_HISTORY_REPLAY_WINDOW_VERSION,
      scan_manifest_version: WALLET_HISTORY_SCAN_MANIFEST_VERSION,
      scan_cache_version: WALLET_HISTORY_SCAN_CACHE_VERSION,
      replay_reconstruction_version: WALLET_HISTORY_REPLAY_RECONSTRUCTION_VERSION,
      scan_id: manifest.scan_id,
      scan_manifest: manifest,
      scan_cache: cacheState,
      replay_reconstruction: reconstruction,
      replay_window: descriptor,
      replay_window_cache_status: transactions.length ? "sanitized_window_rows_loaded" : "metadata_only",
      replay_window_transactions_returned: transactions.length,
      provider_grade: manifest.provider_grade,
      replay_suitability: manifest.replay_suitability,
      completeness_confidence: manifest.completeness_confidence,
      full_history_loaded: manifest.full_history_loaded,
      provider_limit_reached: manifest.provider_limit_reached,
      rate_limited: manifest.rate_limited,
      gap_flags: manifest.gap_flags,
      warnings: descriptor.warnings,
      provider_fetch_performed: false,
      browser_provider_calls: false,
      provider_secret_exposed: false,
      raw_provider_payload_exposed: false,
      no_data_merged: true,
    },
  };
}

async function fetchWalletHistoryPage(query, env = {}) {
  if (query.diagnostics) {
    return walletHistoryDiagnosticsPage(query, env);
  }

  const provider = createWalletHistoryProvider(env);
  if (!provider.configured) {
    return walletHistoryProviderNotConfiguredPage(query, provider, env);
  }

  const cacheKey = walletHistoryPageCacheKey(query, provider.id);
  const cachedPage = await readWalletHistoryPageCache(env, cacheKey);
  if (cachedPage) {
    const guardedCachedPage = withWalletHistoryGuardrailMetadata(cachedPage, {
      cacheStatus: "hit",
      cacheHit: true,
      providerFetchPerformed: false,
      rateLimitStatus: "not_checked_cache_hit",
      query,
      env,
    });
    return attachWalletHistoryScanManifest(guardedCachedPage, {
      env,
      query,
      providerId: provider.id,
    });
  }

  const rateLimit = await claimWalletHistoryProviderFetch(env, query, provider.id);
  if (!rateLimit.allowed) {
    const limitedPage = walletHistoryProviderRateLimitedPage(query, {
      provider: provider.id,
      message: "Wallet history provider fetch rate limit reached for this wallet. Wait briefly before loading more pages.",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      source: "worker_rate_limit_guardrail",
      env,
    });
    return attachWalletHistoryScanManifest(limitedPage, {
      env,
      query,
      providerId: provider.id,
    });
  }

  const providerPage = await provider.fetchPage(query);
  const guardedPage = withWalletHistoryGuardrailMetadata(providerPage, {
    cacheStatus: "miss",
    cacheHit: false,
    providerFetchPerformed: true,
    rateLimitStatus: providerPage?.status === "provider_rate_limited" ? "limited" : "allowed",
    rateLimitRemaining: rateLimit.remaining,
    query,
    env,
  });
  const page = await attachWalletHistoryScanManifest(guardedPage, {
    env,
    query,
    providerId: provider.id,
  });

  if (isCacheableWalletHistoryPage(page)) {
    await putWalletHistoryPageCache(env, cacheKey, page);
  }

  return page;
}

function isCacheableWalletHistoryPage(page = {}) {
  return page.status === "ok"
    && Array.isArray(page.events)
    && page.metadata?.provider_secret_exposed === false
    && page.metadata?.raw_provider_payload_exposed === false;
}

function withWalletHistoryGuardrailMetadata(page = {}, options = {}) {
  const providerId = safeString(page.provider) || normalizeProviderId(options.env?.CRYPTO_WALLET_HISTORY_PROVIDER || options.env?.CRYPTO_HISTORY_PROVIDER) || "none";
  const diagnostics = buildWalletHistoryProviderDiagnostics(options.env || {}, providerId);
  return normalizeWalletHistoryResponse({
    ...page,
    metadata: {
      ...(page.metadata || {}),
      ...diagnostics,
      cache_status: options.cacheStatus,
      cache_hit: Boolean(options.cacheHit),
      cache_ttl_seconds: WALLET_HISTORY_CACHE_TTL_SECONDS,
      rate_limit_status: options.rateLimitStatus,
      rate_limit_window_seconds: WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
      provider_fetch_performed: Boolean(options.providerFetchPerformed),
      ...(Number.isFinite(options.rateLimitRemaining) ? { rate_limit_remaining: options.rateLimitRemaining } : {}),
      ...buildWalletHistoryDepthMetadata(options.query, {
        page,
        providerFetchPerformed: options.providerFetchPerformed,
        rateLimited: options.rateLimitStatus === "limited" || page.status === "provider_rate_limited",
      }),
    },
  });
}

async function readWalletHistoryPageCache(env = {}, key) {
  try {
    if (env.CRYPTO_EVENTS_KV) {
      const cached = await env.CRYPTO_EVENTS_KV.get(key, "json");
      return isFreshWalletHistoryCacheRecord(cached) ? cached.page : null;
    }

    const cached = walletHistoryMemoryCache.get(key);
    if (!isFreshWalletHistoryCacheRecord(cached)) {
      walletHistoryMemoryCache.delete(key);
      return null;
    }
    return cached.page;
  } catch {
    return null;
  }
}

async function putWalletHistoryPageCache(env = {}, key, page) {
  const payload = {
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + WALLET_HISTORY_CACHE_TTL_SECONDS * 1000).toISOString(),
    page,
  };

  try {
    if (env.CRYPTO_EVENTS_KV) {
      await env.CRYPTO_EVENTS_KV.put(key, JSON.stringify(payload), {
        expirationTtl: WALLET_HISTORY_CACHE_TTL_SECONDS,
      });
      return;
    }

    walletHistoryMemoryCache.set(key, payload);
    trimMap(walletHistoryMemoryCache, MAX_WALLET_HISTORY_CACHE_ITEMS);
  } catch {
    // Cache failures must not block the normalized history response.
  }
}

function isFreshWalletHistoryCacheRecord(cached) {
  if (!cached || typeof cached !== "object" || Array.isArray(cached)) {
    return false;
  }
  const expiresAt = Date.parse(cached.expiresAt || "");
  return Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && cached.page
    && typeof cached.page === "object"
    && !Array.isArray(cached.page);
}

async function claimWalletHistoryProviderFetch(env = {}, query, providerId) {
  const maxFetches = getWalletHistoryRateLimitFetches(env);
  const now = Date.now();
  const key = walletHistoryRateLimitKey(query.wallet, providerId);
  const existing = await readWalletHistoryRateRecord(env, key);
  const windowStartedAt = Number(existing?.windowStartedAt) || 0;
  const elapsedMs = now - windowStartedAt;
  const windowMs = WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const record = elapsedMs >= 0 && elapsedMs < windowMs
    ? {
      windowStartedAt,
      providerFetches: Math.max(0, Number(existing.providerFetches) || 0),
    }
    : {
      windowStartedAt: now,
      providerFetches: 0,
    };

  if (record.providerFetches >= maxFetches) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - record.windowStartedAt)) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  record.providerFetches += 1;
  await putWalletHistoryRateRecord(env, key, record);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, maxFetches - record.providerFetches),
  };
}

function getWalletHistoryRateLimitFetches(env = {}) {
  const configured = Number(env.CRYPTO_WALLET_HISTORY_RATE_LIMIT_FETCHES);
  if (!Number.isFinite(configured)) {
    return WALLET_HISTORY_RATE_LIMIT_FETCHES;
  }

  return Math.max(1, Math.min(60, Math.floor(configured)));
}

async function readWalletHistoryRateRecord(env = {}, key) {
  try {
    if (env.CRYPTO_EVENTS_KV) {
      const record = await env.CRYPTO_EVENTS_KV.get(key, "json");
      return record && typeof record === "object" && !Array.isArray(record) ? record : null;
    }

    return walletHistoryRateMemoryCache.get(key) || null;
  } catch {
    return null;
  }
}

async function putWalletHistoryRateRecord(env = {}, key, record) {
  try {
    if (env.CRYPTO_EVENTS_KV) {
      await env.CRYPTO_EVENTS_KV.put(key, JSON.stringify(record), {
        expirationTtl: WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
      });
      return;
    }

    walletHistoryRateMemoryCache.set(key, record);
    trimMap(walletHistoryRateMemoryCache, MAX_WALLET_HISTORY_RATE_ITEMS);
  } catch {
    // Rate-limit persistence is best-effort unless KV is available.
  }
}

function walletHistoryPageCacheKey(query, providerId) {
  const wallet = String(query.wallet || "").trim().toLowerCase();
  const cursor = query.cursor ? String(query.cursor).trim() : "initial";
  const scan = query.scanId ? String(query.scanId).trim() : "no-scan";
  return `${WALLET_HISTORY_CACHE_KEY_PREFIX}${providerId}:${wallet}:l${query.limit}:s:${scan}:c:${cursor}`;
}

function walletHistoryRateLimitKey(wallet, providerId) {
  return `${WALLET_HISTORY_RATE_KEY_PREFIX}${providerId}:${String(wallet || "").trim().toLowerCase()}`;
}

function trimMap(map, maxItems) {
  while (map.size > maxItems) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function walletHistoryDiagnosticsPage(query, env = {}) {
  const providerId = normalizeProviderId(env.CRYPTO_WALLET_HISTORY_PROVIDER || env.CRYPTO_HISTORY_PROVIDER) || "none";
  const diagnostics = buildWalletHistoryProviderDiagnostics(env, providerId);
  const status = diagnostics.provider_configured ? "diagnostics_ok" : "provider_not_configured";
  return normalizeWalletHistoryResponse({
    wallet: query.wallet || "",
    provider: diagnostics.active_provider,
    cursor: null,
    nextCursor: null,
    events: [],
    moreAvailable: false,
    status,
    message: diagnostics.provider_configured
      ? "Provider capability diagnostics loaded from the Worker. No history page was fetched."
      : "Provider capability diagnostics loaded from the Worker. Configure missing Worker environment values before loading history pages.",
    metadata: {
      ...diagnostics,
      source: "wallet_history_provider_diagnostics",
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      cache_status: "diagnostics_bypass",
      cache_hit: false,
      cache_ttl_seconds: WALLET_HISTORY_CACHE_TTL_SECONDS,
      rate_limit_status: "not_checked_diagnostics",
      rate_limit_window_seconds: WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
      provider_fetch_performed: false,
      no_history_page_loaded: true,
      no_data_merged: true,
      page_size: 0,
      more_available: false,
      history_coverage: "diagnostics_only",
      full_history_loaded: false,
      limited_by_provider: false,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: 0,
        pageObserved: false,
        providerFetchPerformed: false,
        providerLimitReached: false,
        rateLimited: false,
        basis: "diagnostics_only",
      }),
    },
  });
}

function buildWalletHistoryProviderDiagnostics(env = {}, providerId = "none") {
  const activeProvider = normalizeProviderId(providerId) || "none";
  const candidates = buildWalletHistoryProviderCandidates(env, activeProvider);
  const activeCandidate = candidates.find((candidate) => candidate.id === activeProvider) || null;
  const missingEnvVars = getWalletHistoryMissingEnvVars(env, activeProvider);
  const capabilities = getWalletHistoryProviderCapabilities(activeProvider);
  const archiveProfile = getWalletHistoryProviderArchiveProfile(activeProvider);
  const providerConfigured = Boolean(activeCandidate?.configured) && missingEnvVars.length === 0;

  return {
    active_provider: activeProvider,
    provider_configured: providerConfigured,
    provider_capabilities: capabilities,
    ...archiveProfile,
    pagination_supported: capabilities.pagination_supported,
    cursor_type: capabilities.cursor_type,
    max_safe_page_size: MAX_WALLET_HISTORY_LIMIT,
    rate_limit_window_seconds: WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
    rate_limit_fetches: getWalletHistoryRateLimitFetches(env),
    cache_ttl_seconds: WALLET_HISTORY_CACHE_TTL_SECONDS,
    provider_candidates: candidates,
    missing_env_vars: missingEnvVars,
    frontend_allowed: false,
    worker_backed: Boolean(activeCandidate?.worker_backed),
    diagnostics_version: "d130_provider_diagnostics_v1",
    archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    scan_manifest_version: WALLET_HISTORY_SCAN_MANIFEST_VERSION,
    provider_diagnostics: {
      active_provider: activeProvider,
      configured: providerConfigured,
      capabilities,
      ...archiveProfile,
      pagination_supported: capabilities.pagination_supported,
      cursor_type: capabilities.cursor_type,
      max_safe_page_size: MAX_WALLET_HISTORY_LIMIT,
      rate_limit_window_seconds: WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
      rate_limit_fetches: getWalletHistoryRateLimitFetches(env),
      cache_ttl_seconds: WALLET_HISTORY_CACHE_TTL_SECONDS,
      candidates,
      missing_env_vars: missingEnvVars,
      frontend_allowed: false,
      worker_backed: Boolean(activeCandidate?.worker_backed),
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
      scan_manifest_version: WALLET_HISTORY_SCAN_MANIFEST_VERSION,
    },
  };
}

function buildWalletHistoryProviderCandidates(env = {}, activeProvider = "none") {
  return WALLET_HISTORY_PROVIDER_CANDIDATES.map((candidate) => {
    const missingEnvVars = getWalletHistoryMissingEnvVars(env, candidate.id);
    const configured = candidate.id === "lana" || candidate.id === "rpc_archive"
      ? false
      : missingEnvVars.length === 0;
    return {
      ...candidate,
      ...getWalletHistoryProviderArchiveProfile(candidate.id),
      active: candidate.id === activeProvider,
      configured,
      missing_env_vars: missingEnvVars,
      capabilities: getWalletHistoryProviderCapabilities(candidate.id),
    };
  });
}

function getWalletHistoryMissingEnvVars(env = {}, providerId = "none") {
  if (providerId === "helius") {
    const missing = [];
    if (!safeString(env.CRYPTO_WALLET_HISTORY_PROVIDER || env.CRYPTO_HISTORY_PROVIDER)) missing.push("CRYPTO_WALLET_HISTORY_PROVIDER");
    if (!safeString(env.HELIUS_API_KEY)) missing.push("HELIUS_API_KEY");
    return missing;
  }
  if (providerId === "generic") {
    const missing = [];
    if (!safeString(env.CRYPTO_WALLET_HISTORY_PROVIDER || env.CRYPTO_HISTORY_PROVIDER)) missing.push("CRYPTO_WALLET_HISTORY_PROVIDER");
    if (!parseGenericHistoryEndpoint(env.CRYPTO_WALLET_HISTORY_URL)) missing.push("CRYPTO_WALLET_HISTORY_URL");
    return missing;
  }
  if (providerId === "lana") {
    return ["LANA_PUBLIC_API_DOCS", "LANA_AUTH_CONFIGURATION"];
  }
  if (providerId === "rpc_archive") {
    return ["ARCHIVE_PROVIDER_ENDPOINT", "ARCHIVE_PROVIDER_AUTH"];
  }
  return ["CRYPTO_WALLET_HISTORY_PROVIDER"];
}

function getWalletHistoryProviderCapabilities(providerId = "none") {
  if (providerId === "helius") {
    return {
      id: "helius",
      label: "Helius getTransactionsForAddress archive history",
      ...getWalletHistoryProviderArchiveProfile("helius"),
      pagination_supported: true,
      cursor_type: "pagination_token",
      max_safe_page_size: MAX_WALLET_HISTORY_LIMIT,
      expected_depth: "provider_defined_archive_path",
      adapter_family: "helius_getTransactionsForAddress",
      legacy_fallback_adapter: "helius_enhanced_address_transactions",
      transaction_details: HELIUS_ARCHIVE_TRANSACTION_DETAILS,
      chronological_ordering_support: true,
      token_account_coverage_support: true,
      deterministic_pagination_support: true,
      gap_detection_support: true,
      limitations: [
        "Full history is not proven until a scan exhausts pagination without gap flags.",
        "Helius archive scans may still be limited by plan quotas, credits, schema changes, and rate limits.",
        "Legacy address-history fallback remains available but is downgraded to partial replay suitability.",
      ],
    };
  }
  if (providerId === "generic") {
    return {
      id: "generic",
      label: "Generic Worker-side external wallet history endpoint",
      ...getWalletHistoryProviderArchiveProfile("generic"),
      pagination_supported: true,
      cursor_type: "generic_cursor",
      max_safe_page_size: MAX_WALLET_HISTORY_LIMIT,
      expected_depth: "provider_defined",
      adapter_family: "generic_worker_endpoint",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      limitations: [
        "Full history depth depends on the configured external endpoint.",
        "The Worker only trusts sanitized events and nextCursor-style pagination.",
      ],
    };
  }
  if (providerId === "lana") {
    return {
      id: "lana",
      label: "lana.ai placeholder",
      ...getWalletHistoryProviderArchiveProfile("lana"),
      pagination_supported: false,
      cursor_type: "unknown",
      max_safe_page_size: 0,
      expected_depth: "unknown",
      adapter_family: "placeholder",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      limitations: [
        "Placeholder only until public API and authentication documentation is verified.",
      ],
    };
  }
  if (providerId === "rpc_archive") {
    return {
      id: "rpc_archive",
      label: "Future RPC/archive provider placeholder",
      ...getWalletHistoryProviderArchiveProfile("rpc_archive"),
      pagination_supported: false,
      cursor_type: "provider_specific",
      max_safe_page_size: 0,
      expected_depth: "archive_grade_if_indexed_provider_available",
      adapter_family: "future_archive_provider",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      limitations: [
        "Not implemented.",
        "Standard RPC alone does not prove complete lifetime wallet history.",
      ],
    };
  }
  return {
    id: "none",
    label: "No active wallet history provider",
    ...getWalletHistoryProviderArchiveProfile("none"),
    pagination_supported: false,
    cursor_type: "none",
    max_safe_page_size: 0,
    expected_depth: "none",
    adapter_family: "none",
    chronological_ordering_support: false,
    token_account_coverage_support: false,
    deterministic_pagination_support: false,
    gap_detection_support: false,
    limitations: [
      "Configure CRYPTO_WALLET_HISTORY_PROVIDER and provider-specific Worker secrets before loading history pages.",
    ],
  };
}

function getWalletHistoryProviderArchiveProfile(providerId = "none") {
  if (providerId === "helius") {
    return {
      provider_grade: "archive",
      replay_suitability: "high",
      completeness_confidence: 72,
      historical_depth: "provider_defined_archive_path",
      ordering_guarantee: "bidirectional_slot_transaction_index",
      cursor_guarantee: "stable_pagination_token_best_effort",
      coverage_scope: "wallet_with_token_accounts",
      provider_family: "helius",
      archive_readiness: "archive_path_available",
      replay_readiness: "chronological_replay_ready_when_scan_exhausts_without_gaps",
      chronological_ordering_support: true,
      token_account_coverage_support: true,
      deterministic_pagination_support: true,
      gap_detection_support: true,
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    };
  }
  if (providerId === "generic") {
    return {
      provider_grade: "basic",
      replay_suitability: "low",
      completeness_confidence: 25,
      historical_depth: "provider_defined",
      ordering_guarantee: "unknown",
      cursor_guarantee: "unknown",
      coverage_scope: "provider_defined",
      provider_family: "generic_external",
      archive_readiness: "depends_on_configured_upstream",
      replay_readiness: "low_until_upstream_contract_proves_ordering",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    };
  }
  if (providerId === "lana") {
    return {
      provider_grade: "basic",
      replay_suitability: "low",
      completeness_confidence: 0,
      historical_depth: "unknown",
      ordering_guarantee: "unknown",
      cursor_guarantee: "unknown",
      coverage_scope: "unknown",
      provider_family: "lana",
      archive_readiness: "placeholder_only",
      replay_readiness: "not_ready",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    };
  }
  if (providerId === "rpc_archive") {
    return {
      provider_grade: "basic",
      replay_suitability: "low",
      completeness_confidence: 0,
      historical_depth: "unknown",
      ordering_guarantee: "unknown",
      cursor_guarantee: "unknown",
      coverage_scope: "unknown",
      provider_family: "archive_rpc",
      archive_readiness: "future_provider_not_implemented",
      replay_readiness: "not_ready",
      chronological_ordering_support: false,
      token_account_coverage_support: false,
      deterministic_pagination_support: false,
      gap_detection_support: false,
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    };
  }
  return {
    provider_grade: "basic",
    replay_suitability: "low",
    completeness_confidence: 0,
    historical_depth: "unknown",
    ordering_guarantee: "unknown",
    cursor_guarantee: "unknown",
    coverage_scope: "none",
    provider_family: "none",
    archive_readiness: "not_configured",
    replay_readiness: "not_ready",
    chronological_ordering_support: false,
    token_account_coverage_support: false,
    deterministic_pagination_support: false,
    gap_detection_support: false,
    archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
  };
}

function createWalletHistoryProvider(env = {}) {
  const providerId = normalizeProviderId(env.CRYPTO_WALLET_HISTORY_PROVIDER || env.CRYPTO_HISTORY_PROVIDER);

  if (!providerId) {
    return {
      id: "none",
      configured: false,
      message: "No wallet history provider is configured. Set CRYPTO_WALLET_HISTORY_PROVIDER to helius, lana, or generic before using backend history pagination.",
      metadata: {
        provider_configured: false,
        missing: ["CRYPTO_WALLET_HISTORY_PROVIDER"],
      },
    };
  }

  if (providerId === "helius") {
    const heliusApiKey = safeString(env.HELIUS_API_KEY);
    if (!heliusApiKey) {
      return {
        id: "helius",
        configured: false,
        message: "Helius wallet history is selected, but HELIUS_API_KEY is not configured as a Worker secret.",
        metadata: {
          provider_configured: false,
          missing: ["HELIUS_API_KEY"],
        },
      };
    }

    return {
      id: "helius",
      configured: true,
      fetchPage: (query) => fetchHeliusWalletHistoryPage(query, env, heliusApiKey),
    };
  }

  if (providerId === "lana") {
    return {
      id: "lana",
      configured: false,
      message: "lana.ai is registered as a placeholder candidate only. No public wallet history API docs were found for D107, so the Worker will not call lana.ai.",
      metadata: {
        provider_configured: false,
        public_docs_found: false,
        no_provider_call_performed: true,
      },
    };
  }

  if (providerId === "generic") {
    const endpoint = parseGenericHistoryEndpoint(env.CRYPTO_WALLET_HISTORY_URL);
    if (!endpoint) {
      return {
        id: "generic",
        configured: false,
        message: "Generic wallet history is selected, but CRYPTO_WALLET_HISTORY_URL is not configured as a safe HTTPS Worker-side endpoint.",
        metadata: {
          provider_configured: false,
          missing: ["CRYPTO_WALLET_HISTORY_URL"],
        },
      };
    }

    return {
      id: "generic",
      configured: true,
      fetchPage: (query) => fetchGenericWalletHistoryPage(query, env, endpoint),
    };
  }

  throw new WalletHistoryProviderError(
    `Unsupported wallet history provider "${providerId}". Supported providers are helius, lana, and generic.`,
    400,
    "unsupported_provider",
    providerId,
  );
}

function normalizeProviderId(value) {
  const provider = safeString(value);
  if (!provider) {
    return "";
  }

  const normalized = provider.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "helius" || normalized === "helius_history" || normalized === "helius_wallet_history" || normalized === "helius_archive" || normalized === "helius_gettransactionsforaddress") {
    return "helius";
  }
  if (normalized === "lana" || normalized === "lana_ai" || normalized === "lana_wallet_history") {
    return "lana";
  }
  if (normalized === "generic" || normalized === "external" || normalized === "generic_external" || normalized === "external_wallet_history") {
    return "generic";
  }

  return normalized;
}

function walletHistoryProviderNotConfiguredPage(query, provider, env = {}) {
  const diagnostics = buildWalletHistoryProviderDiagnostics(env, provider.id);
  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: provider.id,
    cursor: query.cursor,
    nextCursor: null,
    events: [],
    moreAvailable: false,
    status: provider.id === "lana" ? "provider_placeholder" : "provider_not_configured",
    message: provider.message,
    metadata: {
      ...provider.metadata,
      ...diagnostics,
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      cache_status: "bypass",
      cache_hit: false,
      rate_limit_status: "not_checked_provider_unconfigured",
      status_alias: "provider_not_configured",
      page_size: 0,
      more_available: false,
      history_coverage: "provider_not_configured",
      full_history_loaded: false,
      limited_by_provider: false,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: 0,
        providerFetchPerformed: false,
        providerLimitReached: false,
        rateLimited: false,
        basis: "provider_not_configured",
      }),
    },
  });
}

async function fetchHeliusWalletHistoryPage(query, env, heliusApiKey) {
  if (getHeliusHistoryAdapterMode(env) === "legacy") {
    return fetchHeliusLegacyWalletHistoryPage(query, env, heliusApiKey, {
      legacySelected: true,
    });
  }

  const archivePage = await fetchHeliusArchiveWalletHistoryPage(query, env, heliusApiKey);
  if (archivePage.status === "ok" || archivePage.status === "provider_rate_limited" || !isHeliusLegacyFallbackEnabled(env)) {
    return archivePage;
  }

  const legacyPage = await fetchHeliusLegacyWalletHistoryPage(query, env, heliusApiKey, {
    fallbackFromArchive: true,
    archiveStatus: archivePage.status,
  });

  return normalizeWalletHistoryResponse({
    ...legacyPage,
    metadata: {
      ...(legacyPage.metadata || {}),
      provider_grade: "partial",
      replay_suitability: "medium",
      completeness_confidence: degradeCompletenessConfidence(55, ["legacy_fallback_after_archive_adapter_failure"]),
      archive_adapter_fallback: true,
      archive_adapter_status: archivePage.status,
      archive_adapter_warning: "Helius archive path did not produce a usable page; the Worker used the legacy address-history adapter and downgraded replay confidence.",
      gap_flags: dedupeStrings([
        ...safeStringList(legacyPage.metadata?.gap_flags),
        "legacy_fallback_after_archive_adapter_failure",
      ]),
      warnings: dedupeStrings([
        ...safeStringList(legacyPage.metadata?.warnings),
        "Legacy fallback page is useful for bounded inspection but does not prove archive-grade completeness.",
      ]),
    },
  });
}

async function fetchHeliusArchiveWalletHistoryPage(query, env, heliusApiKey) {
  const sortOrder = getHeliusHistorySortOrder(env);
  const tokenAccounts = getHeliusHistoryTokenAccounts(env);
  const statusFilter = getHeliusHistoryStatusFilter(env);
  const providerUrl = new URL(HELIUS_RPC_ENDPOINT);
  providerUrl.searchParams.set("api-key", heliusApiKey);

  const requestParams = {
    transactionDetails: HELIUS_ARCHIVE_TRANSACTION_DETAILS,
    sortOrder,
    commitment: "finalized",
    limit: query.limit,
    maxSupportedTransactionVersion: 0,
    filters: {
      status: statusFilter,
      tokenAccounts,
    },
  };
  if (query.cursor) {
    requestParams.paginationToken = query.cursor;
  }

  let response;
  try {
    response = await fetch(providerUrl.toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "cryptophotonic-wallet-history",
        method: HELIUS_ARCHIVE_METHOD,
        params: [
          query.wallet,
          requestParams,
        ],
      }),
    });
  } catch {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius archive history request failed before a response was returned.",
    });
  }

  if (!response.ok) {
    if (response.status === 429) {
      return walletHistoryProviderRateLimitedPage(query, {
        provider: "helius",
        message: "Helius archive history rate limit reached. Wait before continuing this scan.",
        statusCode: response.status,
      });
    }

    if (WALLET_HISTORY_PROVIDER_LIMITED_STATUSES.has(response.status)) {
      return walletHistoryProviderLimitedPage(query, {
        provider: "helius",
        message: "Helius archive history could not return this page. The Worker normalized the provider response and exposed no raw provider payload.",
        statusCode: response.status,
      });
    }

    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius archive history is temporarily unavailable. The Worker normalized the provider response and exposed no raw provider payload.",
      statusCode: response.status,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius archive history returned an unexpected response envelope.",
    });
  }

  if (payload.error && typeof payload.error === "object") {
    const errorCode = safeString(payload.error.code);
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius archive history returned a JSON-RPC error. The Worker did not expose the raw provider error.",
      statusCode: errorCode || "json_rpc_error",
    });
  }

  const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
    ? payload.result
    : null;
  if (!result || !Array.isArray(result.data)) {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius archive history returned an unexpected result shape.",
    });
  }

  const rows = result.data.slice(0, query.limit);
  const normalizableRows = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  const receivedAt = new Date().toISOString();
  const events = normalizeHeliusArchiveWalletHistoryPayload(normalizableRows, {
    wallet: query.wallet,
    receivedAt,
  });
  const candidateCursor = safeString(result.paginationToken);
  const cursorAdvanced = isDistinctHistoryCursor(candidateCursor, query.cursor);
  const nextCursor = cursorAdvanced ? candidateCursor : null;
  const moreAvailable = Boolean(nextCursor);
  const quality = analyzeHeliusArchivePage(rows, {
    query,
    sortOrder,
    tokenAccounts,
    nextCursor,
    cursorAdvanced,
    normalizedEventCount: events.length,
  });
  const providerLimitReached = quality.providerLimitReached;
  const fullHistoryLoaded = !moreAvailable && !providerLimitReached && !quality.schemaMismatch;
  const completenessConfidence = calculateCompletenessConfidence({
    providerId: "helius",
    fullHistoryLoaded,
    moreAvailable,
    providerLimitReached,
    rateLimited: false,
    gapFlags: quality.gapFlags,
    baseConfidence: getWalletHistoryProviderArchiveProfile("helius").completeness_confidence,
  });
  const replaySuitability = deriveReplaySuitability("high", {
    gapFlags: quality.gapFlags,
    fullHistoryLoaded,
    moreAvailable,
    providerLimitReached,
    rateLimited: false,
  });
  const status = providerLimitReached || quality.schemaMismatch ? "provider_limited" : "ok";
  const message = providerLimitReached
    ? "Helius archive history stopped before a safe next cursor could be proven."
    : rows.length
      ? "Wallet history page loaded from the Worker-side Helius archive adapter."
      : "Helius archive history returned no transactions for this page.";

  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: "helius",
    cursor: query.cursor,
    nextCursor,
    events,
    moreAvailable,
    status,
    message,
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      source: "helius_archive_wallet_history",
      adapter_family: "helius_getTransactionsForAddress",
      provider_family: "helius",
      archive_adapter_method: HELIUS_ARCHIVE_METHOD,
      transaction_details: HELIUS_ARCHIVE_TRANSACTION_DETAILS,
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      count: events.length,
      provider_transaction_count: rows.length,
      page_size: rows.length,
      token_accounts: tokenAccounts,
      sort_order: sortOrder,
      status_filter: statusFilter,
      cursor_kind: query.cursor ? "pagination_token" : "initial",
      cursor_advanced: cursorAdvanced,
      cursor_stalled: quality.gapFlags.includes("cursor_stall"),
      more_available: moreAvailable,
      more_available_reason: moreAvailable
        ? "provider_returned_pagination_token"
        : providerLimitReached
          ? "provider_exhaustion_ambiguous"
          : "provider_returned_no_pagination_token",
      history_coverage: fullHistoryLoaded ? "cursor_exhausted_best_effort" : providerLimitReached ? "limited_by_provider" : "partial_provider_page",
      full_history_loaded: fullHistoryLoaded,
      limited_by_provider: providerLimitReached,
      provider_fetch_performed: true,
      provider_grade: "archive",
      replay_suitability: replaySuitability,
      completeness_confidence: completenessConfidence,
      transaction_completeness: quality.transactionCompleteness,
      ordering_metadata: quality.orderingMetadata,
      replay_readiness: quality.replayReadiness,
      archive_readiness: "archive_path_worker_ready",
      chronological_ordering_support: true,
      token_account_coverage_support: true,
      deterministic_pagination_support: true,
      gap_detection_support: true,
      gap_flags: quality.gapFlags,
      warnings: quality.warnings,
      replay_window: buildReplayWindowMetadata(events, {
        query,
        fullHistoryLoaded,
        coverageReason: fullHistoryLoaded ? "cursor_exhausted_best_effort" : moreAvailable ? "partial_scan_window" : "provider_exhaustion_ambiguous",
        replaySuitability,
        completenessConfidence,
      }),
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: rows.length,
        maxPageSize: query.limit,
        cursorAdvanced,
        cursorExhausted: !moreAvailable,
        providerLimitReached,
        rateLimited: false,
        basis: providerLimitReached
          ? "archive_provider_exhaustion_ambiguous"
          : moreAvailable
            ? "archive_pagination_token_available"
            : "archive_cursor_exhausted_best_effort",
      }),
    },
  });
}

async function fetchHeliusLegacyWalletHistoryPage(query, env, heliusApiKey, options = {}) {
  const providerUrl = new URL(`${HELIUS_ADDRESS_HISTORY_ENDPOINT}/${encodeURIComponent(query.wallet)}/transactions`);
  const tokenAccounts = getHeliusHistoryTokenAccounts(env);
  providerUrl.searchParams.set("api-key", heliusApiKey);
  providerUrl.searchParams.set("limit", String(query.limit));
  providerUrl.searchParams.set("sort-order", "desc");
  providerUrl.searchParams.set("token-accounts", tokenAccounts);
  if (query.cursor) {
    providerUrl.searchParams.set("before-signature", query.cursor);
  }

  let response;
  try {
    response = await fetch(providerUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius wallet history request failed before a response was returned.",
    });
  }

  if (!response.ok) {
    if (response.status === 429) {
      return walletHistoryProviderRateLimitedPage(query, {
        provider: "helius",
        message: "Helius wallet history rate limit reached. Wait briefly before loading more pages.",
        statusCode: response.status,
      });
    }

    if (WALLET_HISTORY_PROVIDER_LIMITED_STATUSES.has(response.status)) {
      return walletHistoryProviderLimitedPage(query, {
        provider: "helius",
        message: "Helius wallet history could not return this page. The Worker normalized the provider response; no raw provider error was exposed.",
        statusCode: response.status,
      });
    }

    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius wallet history is temporarily unavailable. The Worker normalized the provider response; no raw provider error was exposed.",
      statusCode: response.status,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: "Helius wallet history returned an unexpected response shape.",
    });
  }

  const transactions = payload.slice(0, query.limit);
  const events = normalizeHeliusWalletHistoryPayload(transactions, {
    wallet: query.wallet,
    receivedAt: new Date().toISOString(),
  });
  const candidateCursor = getLastTransactionSignature(transactions);
  const cursorAdvanced = isDistinctHistoryCursor(candidateCursor, query.cursor);
  const nextCursor = transactions.length >= query.limit && cursorAdvanced ? candidateCursor : null;
  const moreAvailable = Boolean(nextCursor);
  const providerLimitReached = transactions.length >= query.limit && Boolean(candidateCursor) && !cursorAdvanced;
  const status = providerLimitReached ? "provider_limited" : "ok";
  const message = providerLimitReached
    ? "Helius wallet history returned a full page but did not advance the cursor. The Worker stopped pagination at the provider limit."
    : transactions.length
      ? "Wallet history page loaded from the Worker-side Helius adapter."
      : "Wallet history provider returned no transactions for this page.";

  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: "helius",
    cursor: query.cursor,
    nextCursor,
    events,
    moreAvailable,
    status,
    message,
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      source: "helius_wallet_history",
      adapter_family: "helius_enhanced_address_transactions",
      legacy_history_adapter: true,
      archive_adapter_fallback: options.fallbackFromArchive === true,
      archive_adapter_status: options.archiveStatus || null,
      archive_adapter_mode: options.legacySelected ? "legacy_selected" : "legacy_fallback",
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      count: events.length,
      provider_transaction_count: transactions.length,
      page_size: transactions.length,
      token_accounts: tokenAccounts,
      cursor_kind: query.cursor ? "before_signature" : "initial",
      cursor_advanced: cursorAdvanced,
      cursor_stalled: Boolean(transactions.length >= query.limit && candidateCursor && !cursorAdvanced),
      more_available: moreAvailable,
      more_available_reason: moreAvailable
        ? "provider_returned_next_before_signature_cursor"
        : providerLimitReached
          ? "provider_cursor_did_not_advance"
          : "provider_returned_short_or_empty_page",
      history_coverage: providerLimitReached ? "limited_by_provider" : "partial_provider_page",
      full_history_loaded: !moreAvailable,
      limited_by_provider: providerLimitReached,
      provider_fetch_performed: true,
      gap_flags: providerLimitReached ? ["cursor_stalled"] : [],
      warnings: [
        "Legacy Helius address-history adapter remains bounded and is not archive-grade.",
        ...(providerLimitReached ? ["Legacy cursor did not advance; pagination stopped before completeness could be proven."] : []),
      ],
      replay_window: buildReplayWindowMetadata(events, {
        query,
        fullHistoryLoaded: !moreAvailable,
        coverageReason: providerLimitReached ? "legacy_provider_limit" : "legacy_partial_page",
        replaySuitability: providerLimitReached ? "low" : "medium",
        completenessConfidence: providerLimitReached ? 35 : 55,
      }),
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: transactions.length,
        maxPageSize: query.limit,
        cursorAdvanced,
        cursorExhausted: !moreAvailable,
        providerLimitReached,
        rateLimited: false,
        basis: providerLimitReached
          ? "full_page_without_advanced_cursor"
          : moreAvailable
            ? "provider_returned_advanced_cursor"
            : "provider_returned_short_or_empty_page",
      }),
    },
  });
}

function normalizeHeliusWalletHistoryPayload(payload, options) {
  const transactions = getHeliusTransactions(payload, {
    maxBatch: MAX_WALLET_HISTORY_LIMIT,
    label: "Helius wallet history",
    allowEmpty: true,
  });

  return transactions.slice(0, MAX_WALLET_HISTORY_LIMIT).map((transaction, index) => {
    const event = reduceHeliusTransaction(transaction, index, options.receivedAt, {
      trackedWallet: options.wallet,
      source: "worker-wallet-history",
    });

    return normalizeEvent(event, {
      ingestionSource: "helius_wallet_history",
      receivedAt: options.receivedAt,
    });
  });
}

function normalizeHeliusArchiveWalletHistoryPayload(payload, options) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.slice(0, MAX_WALLET_HISTORY_LIMIT).map((transaction, index) => {
    const event = reduceHeliusArchiveTransaction(transaction, index, options.receivedAt, {
      trackedWallet: options.wallet,
      source: "worker-wallet-history-archive",
    });

    return normalizeEvent(event, {
      ingestionSource: "helius_wallet_history",
      receivedAt: options.receivedAt,
    });
  });
}

function reduceHeliusArchiveTransaction(row, index, receivedAt, options = {}) {
  const signature = getHeliusArchiveSignature(row) || `archive-row-${safeString(row?.slot) || "unknown"}-${index + 1}`;
  const wallets = collectHeliusArchiveWallets(row, options.trackedWallet);
  const transfers = collectHeliusArchiveTransfers(row);
  const tokens = collectHeliusArchiveTokens(row, transfers);
  const failed = row?.meta?.err != null || row?.err != null;

  return {
    id: `helius-archive-${signature.slice(0, 64)}`,
    chain: "solana",
    signature,
    timestamp: normalizeHeliusTimestamp(row?.blockTime ?? row?.block_time ?? row?.timestamp, receivedAt),
    transaction_type: failed ? "failed_transaction" : "solana_transaction",
    source: safeString(options.source) || "worker-wallet-history-archive",
    wallets,
    tokens,
    transfers,
  };
}

function getHeliusArchiveSignature(row = {}) {
  return safeString(
    row.signature
    || row.transaction?.signatures?.[0]
    || row.transaction?.signature
    || row.transaction?.transaction?.signatures?.[0]
  );
}

function collectHeliusArchiveWallets(row = {}, trackedWallet = "") {
  const wallets = [];
  addWallet(wallets, trackedWallet, "tracked");
  getHeliusArchiveAccountKeys(row).forEach((account) => {
    addWallet(wallets, account.address, account.signer ? "signer" : "account");
  });
  for (const balance of safeObjectList(row.meta?.preTokenBalances)) {
    addWallet(wallets, balance.owner, "token_owner");
    addWallet(wallets, getArchiveAccountAddress(row, balance.accountIndex), "token_account");
  }
  for (const balance of safeObjectList(row.meta?.postTokenBalances)) {
    addWallet(wallets, balance.owner, "token_owner");
    addWallet(wallets, getArchiveAccountAddress(row, balance.accountIndex), "token_account");
  }
  for (const transfer of collectHeliusArchiveTransfers(row)) {
    addWallet(wallets, transfer.from, "sender");
    addWallet(wallets, transfer.to, "receiver");
  }
  return wallets;
}

function collectHeliusArchiveTokens(row = {}, transfers = collectHeliusArchiveTransfers(row)) {
  const tokens = [];
  const seen = new Set();
  const addToken = (mint, decimals, symbol = "") => {
    const normalizedMint = safeString(mint);
    const normalizedSymbol = safeString(symbol) || (normalizedMint === "native:sol" ? "SOL" : "");
    const key = `${normalizedMint}|${normalizedSymbol}`;
    if ((!normalizedMint && !normalizedSymbol) || seen.has(key)) return;
    seen.add(key);
    tokens.push({
      symbol: normalizedSymbol || shortProviderValue(normalizedMint),
      mint: normalizedMint,
      decimals: Number.isInteger(Number(decimals)) ? Number(decimals) : null,
    });
  };

  for (const balance of safeObjectList(row.meta?.preTokenBalances)) {
    addToken(balance.mint, balance.uiTokenAmount?.decimals);
  }
  for (const balance of safeObjectList(row.meta?.postTokenBalances)) {
    addToken(balance.mint, balance.uiTokenAmount?.decimals);
  }
  for (const transfer of transfers) {
    addToken(transfer.mint || (transfer.token_symbol === "SOL" ? "native:sol" : ""), transfer.decimals, transfer.token_symbol);
  }

  return tokens.slice(0, 32);
}

function collectHeliusArchiveTransfers(row = {}) {
  const transfers = [
    ...collectHeliusArchiveNativeTransfers(row),
    ...collectHeliusArchiveTokenTransfers(row),
  ];
  return transfers.slice(0, 32).map((transfer) => ({
    token_symbol: safeString(transfer.token_symbol),
    amount: safeString(transfer.amount),
    from: safeString(transfer.from),
    to: safeString(transfer.to),
  }));
}

function collectHeliusArchiveNativeTransfers(row = {}) {
  const preBalances = Array.isArray(row.meta?.preBalances) ? row.meta.preBalances : [];
  const postBalances = Array.isArray(row.meta?.postBalances) ? row.meta.postBalances : [];
  const deltas = [];
  for (let index = 0; index < Math.min(preBalances.length, postBalances.length); index += 1) {
    const pre = Number(preBalances[index]);
    const post = Number(postBalances[index]);
    const delta = post - pre;
    const address = getArchiveAccountAddress(row, index);
    if (!address || !Number.isFinite(delta) || delta === 0) continue;
    deltas.push({
      address,
      delta,
      amount: Math.abs(delta) / 1000000000,
    });
  }

  return pairArchiveBalanceDeltas(deltas, {
    token_symbol: "SOL",
    mint: "native:sol",
    decimals: 9,
  });
}

function collectHeliusArchiveTokenTransfers(row = {}) {
  const byKey = new Map();
  const ingest = (balance, side) => {
    const accountIndex = Number(balance?.accountIndex);
    const mint = safeString(balance?.mint);
    const owner = safeString(balance?.owner) || getArchiveAccountAddress(row, accountIndex);
    if (!Number.isInteger(accountIndex) || !mint || !owner) return;
    const decimals = Number(balance?.uiTokenAmount?.decimals);
    const amount = parseArchiveTokenAmount(balance?.uiTokenAmount);
    const key = `${accountIndex}:${mint}:${owner}`;
    const record = byKey.get(key) || {
      address: owner,
      mint,
      decimals: Number.isInteger(decimals) ? decimals : null,
      pre: 0,
      post: 0,
    };
    record[side] = amount;
    byKey.set(key, record);
  };

  for (const balance of safeObjectList(row.meta?.preTokenBalances)) ingest(balance, "pre");
  for (const balance of safeObjectList(row.meta?.postTokenBalances)) ingest(balance, "post");

  const groupedByMint = new Map();
  for (const record of byKey.values()) {
    const delta = record.post - record.pre;
    if (!Number.isFinite(delta) || delta === 0) continue;
    const list = groupedByMint.get(record.mint) || [];
    list.push({
      address: record.address,
      delta,
      amount: Math.abs(delta),
      decimals: record.decimals,
    });
    groupedByMint.set(record.mint, list);
  }

  const transfers = [];
  for (const [mint, deltas] of groupedByMint.entries()) {
    transfers.push(...pairArchiveBalanceDeltas(deltas, {
      token_symbol: shortProviderValue(mint),
      mint,
      decimals: deltas.find((delta) => delta.decimals != null)?.decimals ?? null,
    }));
  }
  return transfers;
}

function pairArchiveBalanceDeltas(deltas = [], token = {}) {
  const negative = deltas
    .filter((item) => item.delta < 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const positive = deltas
    .filter((item) => item.delta > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const fallbackFrom = negative[0]?.address || "";

  return positive.slice(0, 16).map((receiver, index) => ({
    token_symbol: token.token_symbol,
    mint: token.mint,
    decimals: token.decimals,
    amount: formatProviderAmount(receiver.amount),
    from: negative[index]?.address || fallbackFrom,
    to: receiver.address,
  })).filter((transfer) => transfer.amount || transfer.from || transfer.to);
}

function getHeliusArchiveAccountKeys(row = {}) {
  const keys = row.transaction?.message?.accountKeys
    || row.transaction?.transaction?.message?.accountKeys
    || [];
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => {
    if (typeof key === "string") {
      return {
        address: safeString(key),
        signer: false,
      };
    }
    if (key && typeof key === "object") {
      return {
        address: safeString(key.pubkey || key.account || key.address || key.publicKey || key.toString?.()),
        signer: key.signer === true,
      };
    }
    return {
      address: "",
      signer: false,
    };
  }).filter((key) => key.address);
}

function getArchiveAccountAddress(row = {}, accountIndex) {
  const index = Number(accountIndex);
  if (!Number.isInteger(index) || index < 0) return "";
  return getHeliusArchiveAccountKeys(row)[index]?.address || "";
}

function parseArchiveTokenAmount(uiTokenAmount = {}) {
  const uiAmountString = safeString(uiTokenAmount?.uiAmountString);
  if (uiAmountString) {
    const parsed = Number(uiAmountString);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const uiAmount = Number(uiTokenAmount?.uiAmount);
  if (Number.isFinite(uiAmount)) return uiAmount;

  const amount = Number(uiTokenAmount?.amount);
  const decimals = Number(uiTokenAmount?.decimals);
  if (Number.isFinite(amount) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
    return amount / (10 ** decimals);
  }

  return 0;
}

function parseFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function analyzeHeliusArchivePage(rows = [], options = {}) {
  const gapFlags = [];
  const warnings = [];
  const sortOrder = options.sortOrder === "asc" ? "asc" : "desc";
  const limit = Math.max(1, Number(options.query?.limit) || MAX_WALLET_HISTORY_LIMIT);
  const hasFullPage = rows.length >= limit;
  const schemaMismatch = rows.some((row) => !row || typeof row !== "object" || Array.isArray(row));
  if (schemaMismatch) {
    gapFlags.push("schema_mismatch");
    warnings.push("One or more archive rows had an unexpected schema.");
  }

  const rowQuality = rows.map((row, index) => getArchiveRowQuality(row, index));
  const missingOrdering = rowQuality.some((row) => !row.hasOrdering);
  const missingTimestamp = rowQuality.some((row) => !row.hasTimestamp);
  const incompleteRows = rowQuality.some((row) => !row.hasSignature || !row.hasFullDetails);
  if (missingOrdering) {
    gapFlags.push("missing_ordering_fields");
    warnings.push("One or more archive rows is missing slot or transactionIndex ordering fields.");
  }
  if (missingTimestamp) {
    gapFlags.push("missing_timestamp");
    warnings.push("One or more archive rows is missing blockTime; replay timing confidence is degraded.");
  }
  if (incompleteRows) {
    gapFlags.push("incomplete_transaction_rows");
    warnings.push("One or more archive rows is missing a signature or full transaction/meta detail.");
  }

  if (!missingOrdering && hasMalformedArchiveOrdering(rowQuality, sortOrder)) {
    gapFlags.push("malformed_ordering");
    warnings.push("Archive rows were not ordered consistently by slot and transactionIndex.");
  }
  if (!missingTimestamp && hasTimestampInconsistency(rowQuality, sortOrder)) {
    gapFlags.push("timestamp_inconsistency");
    warnings.push("Archive row timestamps do not follow the requested page ordering.");
  }
  if (options.query?.cursor && !options.cursorAdvanced && options.nextCursor) {
    gapFlags.push("cursor_stall");
    warnings.push("Provider returned a cursor that did not advance; pagination stopped.");
  }
  if (hasFullPage && !options.nextCursor) {
    gapFlags.push("provider_exhaustion_ambiguous");
    warnings.push("Provider returned a full page without a next cursor; full-history exhaustion is ambiguous.");
  }
  if (options.normalizedEventCount < rows.length) {
    gapFlags.push("normalization_omitted_rows");
    warnings.push("Not every provider row produced a normalized event.");
  }

  const uniqueFlags = dedupeStrings(gapFlags);
  return {
    gapFlags: uniqueFlags,
    warnings: dedupeStrings(warnings),
    providerLimitReached: uniqueFlags.includes("cursor_stall")
      || uniqueFlags.includes("schema_mismatch")
      || uniqueFlags.includes("malformed_ordering")
      || uniqueFlags.includes("provider_exhaustion_ambiguous"),
    schemaMismatch,
    transactionCompleteness: {
      mode: HELIUS_ARCHIVE_TRANSACTION_DETAILS,
      rows_observed: rows.length,
      rows_with_signature: rowQuality.filter((row) => row.hasSignature).length,
      rows_with_full_details: rowQuality.filter((row) => row.hasFullDetails).length,
      rows_with_timestamp: rowQuality.filter((row) => row.hasTimestamp).length,
      rows_with_ordering: rowQuality.filter((row) => row.hasOrdering).length,
      complete: rowQuality.length > 0 && rowQuality.every((row) => row.hasSignature && row.hasFullDetails && row.hasTimestamp && row.hasOrdering),
    },
    orderingMetadata: {
      requested_sort_order: sortOrder,
      provider_sort_order: sortOrder,
      slot_ordering: missingOrdering ? "degraded_missing_fields" : "validated_page_local",
      transaction_index_ordering: missingOrdering ? "degraded_missing_fields" : "validated_page_local",
      chronological_ordering_supported: true,
    },
    replayReadiness: {
      archive_adapter: HELIUS_ARCHIVE_METHOD,
      preview_only: true,
      normalized_events: options.normalizedEventCount,
      suitable_for_replay: uniqueFlags.length === 0,
      degradation_flags: uniqueFlags,
    },
  };
}

function getArchiveRowQuality(row = {}, index = 0) {
  const item = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const slot = parseFiniteNumberOrNull(item.slot);
  const transactionIndex = parseFiniteNumberOrNull(item.transactionIndex ?? item.transaction_index);
  const blockTime = parseFiniteNumberOrNull(item.blockTime ?? item.block_time ?? item.timestamp);
  return {
    index,
    slot,
    transactionIndex,
    blockTime,
    hasSignature: Boolean(getHeliusArchiveSignature(item)),
    hasTimestamp: blockTime != null,
    hasOrdering: slot != null && transactionIndex != null,
    hasFullDetails: Boolean(item.transaction && typeof item.transaction === "object" && item.meta && typeof item.meta === "object"),
  };
}

function hasMalformedArchiveOrdering(rows = [], sortOrder = "desc") {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (sortOrder === "asc") {
      if (current.slot < previous.slot) return true;
      if (current.slot === previous.slot && current.transactionIndex < previous.transactionIndex) return true;
    } else {
      if (current.slot > previous.slot) return true;
      if (current.slot === previous.slot && current.transactionIndex > previous.transactionIndex) return true;
    }
  }
  return false;
}

function hasTimestampInconsistency(rows = [], sortOrder = "desc") {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (sortOrder === "asc" && current.blockTime < previous.blockTime) return true;
    if (sortOrder === "desc" && current.blockTime > previous.blockTime) return true;
  }
  return false;
}

function getHeliusHistoryTokenAccounts(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_TOKEN_ACCOUNTS) || DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS;
  return SUPPORTED_HELIUS_HISTORY_TOKEN_ACCOUNTS.has(configured)
    ? configured
    : DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS;
}

function getHeliusHistorySortOrder(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_SORT_ORDER).toLowerCase();
  return SUPPORTED_HELIUS_HISTORY_SORT_ORDERS.has(configured) ? configured : "desc";
}

function getHeliusHistoryStatusFilter(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_STATUS).toLowerCase();
  return SUPPORTED_HELIUS_HISTORY_STATUS_FILTERS.has(configured) ? configured : "any";
}

function getHeliusHistoryAdapterMode(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_ADAPTER || env.CRYPTO_HELIUS_HISTORY_PATH).toLowerCase();
  return configured === "legacy" ? "legacy" : "archive";
}

function isHeliusLegacyFallbackEnabled(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_LEGACY_FALLBACK).toLowerCase();
  return configured === "0" || configured === "false" || configured === "no" ? false : true;
}

function getLastTransactionSignature(transactions) {
  const last = Array.isArray(transactions) ? transactions[transactions.length - 1] : null;
  return safeString(last?.signature);
}

function isDistinctHistoryCursor(nextCursor, currentCursor) {
  const next = safeString(nextCursor);
  if (!next) return false;
  const current = safeString(currentCursor);
  return !current || next !== current;
}

function parseGenericHistoryEndpoint(value) {
  const endpoint = safeString(value);
  if (!endpoint) {
    return null;
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function fetchGenericWalletHistoryPage(query, env, endpoint) {
  const providerUrl = new URL(endpoint.toString());
  providerUrl.searchParams.set("wallet", query.wallet);
  providerUrl.searchParams.set("limit", String(query.limit));
  if (query.cursor) {
    providerUrl.searchParams.set("cursor", query.cursor);
  }

  const headers = {
    accept: "application/json",
  };
  const bearerToken = safeString(env.CRYPTO_WALLET_HISTORY_BEARER_TOKEN);
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  let response;
  try {
    response = await fetch(providerUrl.toString(), {
      method: "GET",
      headers,
    });
  } catch {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "generic",
      message: "Generic wallet history request failed before a response was returned.",
    });
  }

  if (!response.ok) {
    if (response.status === 429) {
      return walletHistoryProviderRateLimitedPage(query, {
        provider: "generic",
        message: "Generic wallet history provider rate limit reached. Wait briefly before loading more pages.",
        statusCode: response.status,
      });
    }

    if (WALLET_HISTORY_PROVIDER_LIMITED_STATUSES.has(response.status)) {
      return walletHistoryProviderLimitedPage(query, {
        provider: "generic",
        message: "Generic wallet history provider could not return this page. The Worker normalized the provider response; no raw provider error was exposed.",
        statusCode: response.status,
      });
    }

    return walletHistoryProviderUnavailablePage(query, {
      provider: "generic",
      message: "Generic wallet history provider is temporarily unavailable. The Worker normalized the provider response; no raw provider error was exposed.",
      statusCode: response.status,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return walletHistoryProviderUnavailablePage(query, {
      provider: "generic",
      message: "Generic wallet history provider returned an unexpected response shape.",
    });
  }

  const normalized = normalizeGenericHistoryEvents(payload, {
    wallet: query.wallet,
    receivedAt: new Date().toISOString(),
  });

  const candidateCursor = safeString(
    payload.nextCursor
    || payload.next_cursor
    || payload.cursor_next
    || payload.pagination?.nextCursor
    || payload.pagination?.next_cursor
    || payload.pagination?.cursor_next
  );
  const cursorAdvanced = isDistinctHistoryCursor(candidateCursor, query.cursor);
  const moreAvailable = Boolean((
    payload.moreAvailable
    ?? payload.hasMore
    ?? payload.has_more
    ?? payload.pagination?.moreAvailable
    ?? payload.pagination?.hasMore
    ?? payload.pagination?.has_more
    ?? candidateCursor
  ) && cursorAdvanced);
  const providerReportedMore = Boolean(
    payload.moreAvailable
    ?? payload.hasMore
    ?? payload.has_more
    ?? payload.pagination?.moreAvailable
    ?? payload.pagination?.hasMore
    ?? payload.pagination?.has_more
  );
  const providerLimitReached = providerReportedMore && !moreAvailable;
  const totalPossibleEstimate = getProviderTotalPossibleEstimate(payload);

  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: "generic",
    cursor: query.cursor,
    nextCursor: moreAvailable ? candidateCursor : null,
    events: normalized.events,
    moreAvailable,
    status: providerLimitReached ? "provider_limited" : "ok",
    message: safeString(payload.message) || (providerLimitReached
      ? "Generic wallet history provider reported more data without a usable next cursor. The Worker stopped pagination at the provider limit."
      : "Wallet history page loaded from a Worker-side generic adapter."),
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      source: "generic_wallet_history",
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      count: normalized.events.length,
      skipped_unsafe_items: normalized.skipped,
      page_size: normalized.events.length,
      cursor_advanced: cursorAdvanced,
      cursor_stalled: Boolean(candidateCursor && !cursorAdvanced),
      more_available: moreAvailable,
      more_available_reason: moreAvailable
        ? "provider_returned_next_cursor"
        : providerLimitReached
          ? "provider_reported_more_without_advanced_cursor"
          : "provider_returned_no_advanced_cursor",
      history_coverage: providerLimitReached ? "limited_by_provider" : "partial_provider_page",
      full_history_loaded: !moreAvailable,
      limited_by_provider: providerLimitReached,
      provider_fetch_performed: true,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: normalized.events.length,
        maxPageSize: query.limit,
        cursorAdvanced,
        cursorExhausted: !moreAvailable,
        providerLimitReached,
        rateLimited: false,
        totalPossibleEstimate,
        maxPages: estimateMaxPages(totalPossibleEstimate, query.limit),
        maxTransactions: totalPossibleEstimate,
        basis: providerLimitReached
          ? "provider_reported_more_without_advanced_cursor"
          : moreAvailable
            ? "provider_returned_advanced_cursor"
            : "provider_returned_no_advanced_cursor",
      }),
    },
  });
}

function normalizeGenericHistoryEvents(payload, options) {
  const items = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.transactions)
      ? payload.transactions
      : Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.results)
          ? payload.results
          : Array.isArray(payload.data)
            ? payload.data
            : [];
  const events = [];
  let skipped = 0;

  for (const [index, item] of items.slice(0, MAX_WALLET_HISTORY_LIMIT).entries()) {
    try {
      events.push(normalizeEvent(reduceGenericHistoryItem(item, index, options), {
        ingestionSource: "external_wallet_history",
        receivedAt: options.receivedAt,
      }));
    } catch {
      skipped += 1;
    }
  }

  return {
    events,
    skipped,
  };
}

function reduceGenericHistoryItem(item, index, options) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new InvalidEventInputError("Generic wallet history item must be an object.");
  }

  const signature = safeString(item.signature || item.transaction_hash || item.hash || item.id);
  return {
    id: safeString(item.id) || `external-history-${index}`,
    chain: safeString(item.chain) || "solana",
    signature,
    timestamp: normalizeHeliusTimestamp(item.timestamp || item.blockTime || item.block_time, options.receivedAt),
    transaction_type: safeString(item.transaction_type || item.type) || "unknown",
    source: "generic-wallet-history",
    wallets: safeObjectList(item.wallets).map((wallet) => ({
      address: safeString(wallet.address || wallet.wallet_address),
      role: safeString(wallet.role) || "unknown",
    })),
    tokens: safeObjectList(item.tokens).map((token) => ({
      symbol: safeString(token.symbol),
      mint: safeString(token.mint || token.address),
      decimals: token.decimals,
    })),
    transfers: safeObjectList(item.transfers).map((transfer) => ({
      token_symbol: safeString(transfer.token_symbol || transfer.symbol),
      amount: safeString(transfer.amount),
      from: safeString(transfer.from || transfer.source_wallet),
      to: safeString(transfer.to || transfer.destination_wallet),
    })),
  };
}

function getProviderTotalPossibleEstimate(payload = {}) {
  const candidates = [
    payload.totalPossible,
    payload.total_possible,
    payload.total,
    payload.totalCount,
    payload.total_count,
    payload.pagination?.total,
    payload.pagination?.total_count,
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
  return value == null ? null : Math.floor(Number(value));
}

function estimateMaxPages(totalPossibleEstimate, limit) {
  const total = Number(totalPossibleEstimate);
  const pageLimit = Number(limit);
  if (!Number.isFinite(total) || !Number.isFinite(pageLimit) || pageLimit <= 0) {
    return null;
  }
  return Math.ceil(total / pageLimit);
}

function buildWalletHistoryDepthMetadata(query = {}, options = {}) {
  const page = options.page && typeof options.page === "object" ? options.page : {};
  const pageMetadata = page.metadata && typeof page.metadata === "object" ? page.metadata : {};
  const pageEvents = Array.isArray(page.events)
    ? page.events
    : Array.isArray(page.transactions)
      ? page.transactions
      : [];
  const pageSize = Math.max(0, Number(options.pageSize ?? pageMetadata.page_size ?? pageEvents.length) || 0);
  const limit = Math.max(1, Number(options.maxPageSize ?? query.limit ?? pageMetadata.limit ?? MAX_WALLET_HISTORY_LIMIT) || MAX_WALLET_HISTORY_LIMIT);
  const pageObserved = options.pageObserved !== false;
  const rateLimited = options.rateLimited === true || page.status === "provider_rate_limited" || pageMetadata.rate_limit_status === "limited";
  const providerLimitReached = options.providerLimitReached === true
    || page.status === "provider_limited"
    || pageMetadata.limited_by_provider === true
    || pageMetadata.history_coverage === "limited_by_provider";
  const moreAvailable = Boolean(page.moreAvailable ?? pageMetadata.more_available);
  const nextCursorPresent = Boolean(page.nextCursor ?? pageMetadata.response_next_cursor_present);
  const cursorExhausted = options.cursorExhausted === true || (!rateLimited && !moreAvailable && !nextCursorPresent);
  const pagesBefore = Math.max(0, Number(query.observedPages ?? pageMetadata.pages_observed_before) || 0);
  const transactionsBefore = Math.max(0, Number(query.observedTransactions ?? pageMetadata.transactions_observed_before) || 0);
  const pagesObserved = pagesBefore + (pageObserved && !rateLimited ? 1 : 0);
  const transactionsObserved = transactionsBefore + pageSize;
  const totalPossibleEstimate = getNullablePositiveInteger(options.totalPossibleEstimate ?? pageMetadata.total_possible_estimate);
  const maxTransactions = getNullablePositiveInteger(options.maxTransactions ?? pageMetadata.provider_max_transactions ?? totalPossibleEstimate);
  const maxPages = getNullablePositiveInteger(options.maxPages ?? pageMetadata.provider_max_pages ?? estimateMaxPages(totalPossibleEstimate, limit));
  const basis = safeString(options.basis || pageMetadata.history_depth_basis) || (
    rateLimited
      ? "rate_limited_before_depth_verified"
      : providerLimitReached
        ? "provider_limit_reached"
        : cursorExhausted
          ? "cursor_exhausted_best_effort"
          : "advanced_cursor_available"
  );

  return {
    history_depth_estimate: {
      pages_observed: pagesObserved,
      transactions_observed: transactionsObserved,
      current_page_size: pageSize,
      max_page_size: limit,
      max_pages: maxPages,
      max_transactions: maxTransactions,
      cursor_exhausted: cursorExhausted,
      cursor_advanced: options.cursorAdvanced ?? pageMetadata.cursor_advanced ?? null,
      confidence: totalPossibleEstimate != null
        ? "provider_total_estimate"
        : cursorExhausted && !providerLimitReached
          ? "best_effort_cursor_exhausted"
          : "observed_pages_only",
      basis,
    },
    provider_limit_reached: providerLimitReached,
    rate_limited: rateLimited,
    total_possible_estimate: totalPossibleEstimate,
    provider_max_pages: maxPages,
    provider_max_transactions: maxTransactions,
    cursor_exhausted: cursorExhausted,
    pages_observed_before: pagesBefore,
    transactions_observed_before: transactionsBefore,
  };
}

async function attachWalletHistoryScanManifest(page = {}, options = {}) {
  const query = options.query || {};
  const providerId = options.providerId || safeString(page.provider) || "none";
  const currentManifest = await readWalletHistoryScanManifest(options.env, query.scanId);
  let manifest = updateWalletHistoryScanManifest(currentManifest, page, {
    query,
    providerId,
  });
  const scanCacheState = await persistWalletHistoryScanCache(options.env, manifest, page, query);
  manifest = sanitizeWalletHistoryScanManifest({
    ...manifest,
    cache_state: mergeWalletHistoryScanCacheState(manifest.cache_state, scanCacheState),
    replay_reconstruction: buildReplayReconstructionMetadata(manifest, page, query, scanCacheState),
  });
  await putWalletHistoryScanManifest(options.env, manifest);
  const replayWindowDescriptor = buildReplayWindowDescriptor(manifest, manifest.replay_reconstruction, {
    direction: "current",
    limit: WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS,
  });

  return normalizeWalletHistoryResponse({
    ...page,
    metadata: {
      ...(page.metadata || {}),
      scan_id: manifest.scan_id,
      scan_manifest_version: WALLET_HISTORY_SCAN_MANIFEST_VERSION,
      scan_manifest: manifest,
      cursor_state: manifest.cursor_state,
      pages_loaded: manifest.pages_loaded,
      transactions_loaded: manifest.transactions_loaded,
      earliest_timestamp: manifest.earliest_timestamp,
      latest_timestamp: manifest.latest_timestamp,
      completeness_confidence: manifest.completeness_confidence,
      full_history_loaded: manifest.full_history_loaded,
      provider_limit_reached: manifest.provider_limit_reached,
      rate_limited: manifest.rate_limited,
      gap_flags: manifest.gap_flags,
      warnings: manifest.warnings,
      replay_suitability: manifest.replay_suitability,
      scan_cache: manifest.cache_state,
      replay_reconstruction: manifest.replay_reconstruction,
      replay_window: {
        ...(page.metadata?.replay_window || {}),
        ...replayWindowDescriptor,
        coverage_pct: estimateReplayCoveragePct(manifest),
        scan_id: manifest.scan_id,
        completeness_confidence: manifest.completeness_confidence,
        warnings: manifest.warnings.slice(0, 6),
        chunk_size: manifest.replay_reconstruction.chunk_size,
        render_cap_transactions: manifest.replay_reconstruction.render_cap_transactions,
        current_window_index: manifest.replay_reconstruction.current_window_index,
        total_windows: manifest.replay_reconstruction.total_windows,
        window_label: manifest.replay_reconstruction.current_window_label,
        oldest_first_ready: manifest.replay_reconstruction.oldest_first_ready,
        oldest_first_reconstruction_required: manifest.replay_reconstruction.oldest_first_reconstruction_required,
        progressive_expansion_available: manifest.replay_reconstruction.progressive_expansion_available,
        timeline_segments: manifest.replay_reconstruction.timeline_segments.slice(-6),
      },
    },
  });
}

function updateWalletHistoryScanManifest(existing, page = {}, options = {}) {
  const query = options.query || {};
  const metadata = page.metadata || {};
  const providerId = safeString(page.provider) || safeString(options.providerId) || "none";
  const archiveProfile = getWalletHistoryProviderArchiveProfile(providerId);
  const now = new Date().toISOString();
  const scanId = safeString(existing?.scan_id || query.scanId) || createWalletHistoryScanId(query, providerId);
  const events = Array.isArray(page.events)
    ? page.events
    : Array.isArray(page.transactions)
      ? page.transactions
      : [];
  const timestamps = events
    .map((event) => Date.parse(event.timestamp || event.block_time || event.blockTime || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  const existingEarliest = Date.parse(existing?.earliest_timestamp || "");
  const existingLatest = Date.parse(existing?.latest_timestamp || "");
  const pageEarliest = timestamps.length ? Math.min(...timestamps) : null;
  const pageLatest = timestamps.length ? Math.max(...timestamps) : null;
  const gapFlags = dedupeStrings([
    ...safeStringList(existing?.gap_flags),
    ...safeStringList(metadata.gap_flags),
  ]);
  const rateLimited = existing?.rate_limited === true || metadata.rate_limited === true || page.status === "provider_rate_limited";
  const providerLimitReached = existing?.provider_limit_reached === true
    || metadata.provider_limit_reached === true
    || metadata.limited_by_provider === true
    || page.status === "provider_limited";
  const fullHistoryLoaded = metadata.full_history_loaded === true
    && !rateLimited
    && !providerLimitReached
    && !gapFlags.some((flag) => ["schema_mismatch", "malformed_ordering", "cursor_stall", "provider_exhaustion_ambiguous"].includes(flag));
  const pagesBefore = Math.max(0, Number(query.observedPages ?? existing?.pages_loaded) || 0);
  const transactionsBefore = Math.max(0, Number(query.observedTransactions ?? existing?.transactions_loaded) || 0);
  const pageObserved = page.status !== "provider_rate_limited" && metadata.no_history_page_loaded !== true;
  const pagesLoaded = Math.max(
    Number(existing?.pages_loaded) || 0,
    pagesBefore + (pageObserved ? 1 : 0),
  );
  const transactionsLoaded = Math.max(
    Number(existing?.transactions_loaded) || 0,
    transactionsBefore + events.length,
  );
  const completenessConfidence = calculateCompletenessConfidence({
    providerId,
    fullHistoryLoaded,
    moreAvailable: Boolean(page.moreAvailable),
    providerLimitReached,
    rateLimited,
    gapFlags,
    baseConfidence: Number(metadata.completeness_confidence ?? existing?.completeness_confidence ?? archiveProfile.completeness_confidence),
  });
  const replaySuitability = deriveReplaySuitability(metadata.replay_suitability || archiveProfile.replay_suitability, {
    gapFlags,
    fullHistoryLoaded,
    moreAvailable: Boolean(page.moreAvailable),
    providerLimitReached,
    rateLimited,
  });

  return sanitizeWalletHistoryScanManifest({
    scan_id: scanId,
    wallet: safeString(page.wallet) || safeString(query.wallet) || existing?.wallet || "",
    provider: providerId,
    provider_grade: metadata.provider_grade || archiveProfile.provider_grade,
    replay_suitability: replaySuitability,
    started_at: existing?.started_at || now,
    updated_at: now,
    cursor_state: {
      current_cursor: page.cursor ?? query.cursor ?? null,
      next_cursor: page.nextCursor ?? null,
      cursor_kind: metadata.cursor_kind || metadata.cursor_type || "unknown",
      cursor_advanced: metadata.cursor_advanced ?? null,
      cursor_stalled: metadata.cursor_stalled === true || gapFlags.includes("cursor_stall"),
      sort_order: metadata.sort_order || existing?.cursor_state?.sort_order || "unknown",
      pagination_model: metadata.adapter_family === "helius_getTransactionsForAddress"
        ? "paginationToken"
        : metadata.cursor_kind || existing?.cursor_state?.pagination_model || "provider_defined",
    },
    pages_loaded: pagesLoaded,
    transactions_loaded: transactionsLoaded,
    earliest_timestamp: formatOptionalIsoTimestamp(minFiniteTimestamp(existingEarliest, pageEarliest)),
    latest_timestamp: formatOptionalIsoTimestamp(maxFiniteTimestamp(existingLatest, pageLatest)),
    provider_limit_reached: providerLimitReached,
    rate_limited: rateLimited,
    completeness_confidence: completenessConfidence,
    full_history_loaded: fullHistoryLoaded,
    gap_flags: gapFlags,
    warnings: dedupeStrings([
      ...safeStringList(existing?.warnings),
      ...safeStringList(metadata.warnings),
      ...(fullHistoryLoaded ? ["Cursor exhausted without blocking gap flags; completeness is still best-effort unless provider contract guarantees are independently verified."] : []),
    ]).slice(0, 12),
    cache_state: existing?.cache_state,
    replay_reconstruction: existing?.replay_reconstruction,
  });
}

function sanitizeWalletHistoryScanManifest(manifest = {}) {
  return {
    scan_id: safeString(manifest.scan_id),
    wallet: safeString(manifest.wallet),
    provider: safeString(manifest.provider) || "none",
    provider_grade: safeString(manifest.provider_grade) || "basic",
    replay_suitability: safeString(manifest.replay_suitability) || "low",
    started_at: normalizeManifestTimestamp(manifest.started_at),
    updated_at: normalizeManifestTimestamp(manifest.updated_at),
    cursor_state: sanitizeCursorState(manifest.cursor_state),
    pages_loaded: Math.max(0, Math.floor(Number(manifest.pages_loaded) || 0)),
    transactions_loaded: Math.max(0, Math.floor(Number(manifest.transactions_loaded) || 0)),
    earliest_timestamp: normalizeOptionalManifestTimestamp(manifest.earliest_timestamp),
    latest_timestamp: normalizeOptionalManifestTimestamp(manifest.latest_timestamp),
    provider_limit_reached: manifest.provider_limit_reached === true,
    rate_limited: manifest.rate_limited === true,
    completeness_confidence: clampConfidence(manifest.completeness_confidence),
    full_history_loaded: manifest.full_history_loaded === true,
    gap_flags: safeStringList(manifest.gap_flags).slice(0, 16),
    warnings: safeStringList(manifest.warnings).slice(0, 16),
    cache_state: sanitizeWalletHistoryScanCacheState(manifest.cache_state),
    replay_reconstruction: sanitizeReplayReconstructionMetadata(manifest.replay_reconstruction),
    replay_gap_map: sanitizeReplayGapMap(manifest.replay_gap_map),
  };
}

function sanitizeWalletHistoryScanCacheState(cacheState = {}) {
  const state = cacheState && typeof cacheState === "object" && !Array.isArray(cacheState) ? cacheState : {};
  return {
    version: safeString(state.version) || WALLET_HISTORY_SCAN_CACHE_VERSION,
    storage: safeString(state.storage) || "unavailable",
    persisted: state.persisted === true,
    manifest_linked: state.manifest_linked === true,
    normalized_page_persistence: safeString(state.normalized_page_persistence) || "not_started",
    normalized_transaction_persistence: safeString(state.normalized_transaction_persistence) || "not_started",
    replay_reconstruction_cached: state.replay_reconstruction_cached === true,
    resumable: state.resumable === true,
    normalized_pages_persisted: Math.max(0, Math.floor(Number(state.normalized_pages_persisted) || 0)),
    normalized_transactions_persisted: Math.max(0, Math.floor(Number(state.normalized_transactions_persisted) || 0)),
    last_page_ref: safeString(state.last_page_ref),
    last_page_index: Math.max(0, Math.floor(Number(state.last_page_index) || 0)),
    last_transaction_ref_count: Math.max(0, Math.floor(Number(state.last_transaction_ref_count) || 0)),
    persisted_at: normalizeOptionalManifestTimestamp(state.persisted_at),
    ttl_seconds: Math.max(0, Math.floor(Number(state.ttl_seconds) || WALLET_HISTORY_SCAN_CACHE_TTL_SECONDS)),
    browser_receives_metadata_only: state.browser_receives_metadata_only !== false,
    raw_provider_payload_exposed: false,
    provider_secret_exposed: false,
  };
}

function sanitizeReplayReconstructionMetadata(metadata = {}) {
  const value = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const timelineSegments = Array.isArray(value.timeline_segments)
    ? value.timeline_segments.map(sanitizeReplayTimelineSegment).filter((segment) => segment.segment_id).slice(-WALLET_HISTORY_REPLAY_MAX_TIMELINE_SEGMENTS)
    : [];
  return {
    version: safeString(value.version) || WALLET_HISTORY_REPLAY_RECONSTRUCTION_VERSION,
    preview_only: value.preview_only !== false,
    staged_history_only: value.staged_history_only !== false,
    active_graph_unchanged: value.active_graph_unchanged !== false,
    scan_id: safeString(value.scan_id),
    chunk_size: Math.max(1, Math.floor(Number(value.chunk_size) || WALLET_HISTORY_REPLAY_CHUNK_SIZE)),
    render_cap_transactions: Math.max(1, Math.floor(Number(value.render_cap_transactions) || WALLET_HISTORY_REPLAY_RENDER_CAP)),
    total_transactions: Math.max(0, Math.floor(Number(value.total_transactions) || 0)),
    total_windows: Math.max(0, Math.floor(Number(value.total_windows) || 0)),
    current_window_index: Math.max(0, Math.floor(Number(value.current_window_index) || 0)),
    current_window_start: Math.max(0, Math.floor(Number(value.current_window_start) || 0)),
    current_window_end: Math.max(0, Math.floor(Number(value.current_window_end) || 0)),
    current_window_label: safeString(value.current_window_label),
    earliest_timestamp: normalizeOptionalManifestTimestamp(value.earliest_timestamp),
    latest_timestamp: normalizeOptionalManifestTimestamp(value.latest_timestamp),
    oldest_first_ready: value.oldest_first_ready === true,
    oldest_first_reconstruction_required: value.oldest_first_reconstruction_required === true,
    progressive_expansion_available: value.progressive_expansion_available === true,
    reconstruction_complete: value.reconstruction_complete === true,
    coverage_pct: clampConfidence(value.coverage_pct),
    confidence_degraded: value.confidence_degraded === true,
    continuity_confidence: sanitizeReplayContinuityProfile(value.continuity_confidence),
    gap_map: sanitizeReplayGapMap(value.gap_map),
    timeline_segments: timelineSegments,
    warnings: safeStringList(value.warnings).slice(0, 12),
  };
}

function sanitizeReplayTimelineSegment(segment = {}) {
  const value = segment && typeof segment === "object" && !Array.isArray(segment) ? segment : {};
  return {
    segment_id: safeString(value.segment_id),
    page_ref: safeString(value.page_ref),
    page_index: Math.max(0, Math.floor(Number(value.page_index) || 0)),
    transaction_count: Math.max(0, Math.floor(Number(value.transaction_count) || 0)),
    ordinal_start: Math.max(0, Math.floor(Number(value.ordinal_start) || 0)),
    ordinal_end: Math.max(0, Math.floor(Number(value.ordinal_end) || 0)),
    earliest_timestamp: normalizeOptionalManifestTimestamp(value.earliest_timestamp),
    latest_timestamp: normalizeOptionalManifestTimestamp(value.latest_timestamp),
    sort_order: safeString(value.sort_order) || "unknown",
    cursor_kind: safeString(value.cursor_kind) || "unknown",
    partial: value.partial !== false,
  };
}

function mergeWalletHistoryScanCacheState(existing = {}, next = {}) {
  const current = sanitizeWalletHistoryScanCacheState(existing);
  const incoming = sanitizeWalletHistoryScanCacheState(next);
  return sanitizeWalletHistoryScanCacheState({
    ...current,
    ...incoming,
    persisted: current.persisted === true || incoming.persisted === true,
    manifest_linked: current.manifest_linked === true || incoming.manifest_linked === true,
    replay_reconstruction_cached: current.replay_reconstruction_cached === true || incoming.replay_reconstruction_cached === true,
    normalized_pages_persisted: Math.max(current.normalized_pages_persisted, incoming.normalized_pages_persisted),
    normalized_transactions_persisted: Math.max(current.normalized_transactions_persisted, incoming.normalized_transactions_persisted),
    last_page_ref: incoming.last_page_ref || current.last_page_ref,
    last_page_index: Math.max(current.last_page_index, incoming.last_page_index),
    last_transaction_ref_count: incoming.last_transaction_ref_count || current.last_transaction_ref_count,
    persisted_at: incoming.persisted_at || current.persisted_at,
    resumable: incoming.resumable,
  });
}

async function persistWalletHistoryScanCache(env = {}, manifest = {}, page = {}, query = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  const events = getWalletHistoryPageEvents(page);
  const pageIndex = Math.max(1, Number(safeManifest.pages_loaded) || (Number(query.observedPages) || 0) + 1);
  const storage = env.CRYPTO_EVENTS_KV ? "kv" : "memory";
  const pageRef = safeManifest.scan_id ? `scan-page:${safeManifest.scan_id}:${pageIndex}` : "";
  const baseState = sanitizeWalletHistoryScanCacheState({
    ...(safeManifest.cache_state || {}),
    storage,
    manifest_linked: Boolean(safeManifest.scan_id),
    last_page_ref: pageRef,
    last_page_index: pageIndex,
    last_transaction_ref_count: events.length,
    persisted_at: new Date().toISOString(),
    ttl_seconds: WALLET_HISTORY_SCAN_CACHE_TTL_SECONDS,
    resumable: Boolean(page.nextCursor || safeManifest.cursor_state?.next_cursor) && safeManifest.full_history_loaded !== true,
    browser_receives_metadata_only: true,
  });

  if (!safeManifest.scan_id) {
    return {
      ...baseState,
      persisted: false,
      normalized_page_persistence: "missing_scan_id",
      normalized_transaction_persistence: "missing_scan_id",
      replay_reconstruction_cached: false,
    };
  }

  const transactionRefs = events.map((event, index) => buildWalletHistoryTransactionRef(safeManifest.scan_id, event, index, pageIndex));
  const pageRecord = buildWalletHistoryScanPageRecord(safeManifest, page, query, {
    pageIndex,
    pageRef,
    transactionRefs,
  });
  const replayRecord = buildReplayCacheRecord(safeManifest, page, query, {
    pageIndex,
    pageRef,
    transactionRefs,
  });

  try {
    await putWalletHistoryScanCacheRecord(
      env,
      walletHistoryScanPageKey(safeManifest.scan_id, pageIndex, query.cursor),
      pageRecord,
      walletHistoryScanPageMemoryCache,
      MAX_WALLET_HISTORY_SCAN_PAGE_ITEMS,
    );
    await putWalletHistoryScanCacheRecord(
      env,
      walletHistoryScanPageRefKey(pageRef),
      pageRecord,
      walletHistoryScanPageRefMemoryCache,
      MAX_WALLET_HISTORY_SCAN_PAGE_ITEMS,
    );
    for (const [index, event] of events.entries()) {
      await putWalletHistoryScanCacheRecord(
        env,
        walletHistoryScanTransactionKey(safeManifest.scan_id, transactionRefs[index]),
        buildWalletHistoryScanTransactionRecord(safeManifest, event, index, {
          pageIndex,
          pageRef,
          transactionRef: transactionRefs[index],
          pageTransactionCount: events.length,
        }),
        walletHistoryScanTransactionMemoryCache,
        MAX_WALLET_HISTORY_SCAN_TRANSACTION_ITEMS,
      );
    }
    await putWalletHistoryScanCacheRecord(
      env,
      walletHistoryReplayCacheKey(safeManifest.scan_id),
      replayRecord,
      walletHistoryReplayCacheMemoryCache,
      MAX_WALLET_HISTORY_REPLAY_CACHE_ITEMS,
    );
    return sanitizeWalletHistoryScanCacheState({
      ...baseState,
      persisted: true,
      normalized_page_persistence: "stored",
      normalized_transaction_persistence: events.length ? "stored" : "no_transactions",
      replay_reconstruction_cached: true,
      normalized_pages_persisted: Math.max(baseState.normalized_pages_persisted, pageIndex),
      normalized_transactions_persisted: Math.max(baseState.normalized_transactions_persisted, safeManifest.transactions_loaded),
    });
  } catch {
    return sanitizeWalletHistoryScanCacheState({
      ...baseState,
      persisted: false,
      normalized_page_persistence: "best_effort_failed",
      normalized_transaction_persistence: events.length ? "best_effort_failed" : "no_transactions",
      replay_reconstruction_cached: false,
    });
  }
}

function getWalletHistoryPageEvents(page = {}) {
  return Array.isArray(page.events)
    ? page.events.slice(0, MAX_WALLET_HISTORY_LIMIT)
    : Array.isArray(page.transactions)
      ? page.transactions.slice(0, MAX_WALLET_HISTORY_LIMIT)
      : [];
}

function buildWalletHistoryScanPageRecord(manifest = {}, page = {}, query = {}, options = {}) {
  const events = getWalletHistoryPageEvents(page);
  return {
    version: WALLET_HISTORY_SCAN_CACHE_VERSION,
    kind: "normalized_scan_page",
    scan_id: manifest.scan_id,
    page_ref: options.pageRef,
    page_index: options.pageIndex,
    wallet: manifest.wallet,
    provider: manifest.provider,
    cursor: sanitizeManifestCursor(page.cursor ?? query.cursor),
    next_cursor: sanitizeManifestCursor(page.nextCursor),
    status: safeString(page.status) || "ok",
    persisted_at: new Date().toISOString(),
    manifest_ref: manifest.scan_id,
    replay_window: page.metadata?.replay_window && typeof page.metadata.replay_window === "object"
      ? sanitizeReplayWindowForCache(page.metadata.replay_window)
      : null,
    transaction_refs: Array.isArray(options.transactionRefs) ? options.transactionRefs.slice(0, MAX_WALLET_HISTORY_LIMIT) : [],
    normalized_transactions: events.map((event, index) => sanitizeScanCacheTransaction(event, index)),
    boundary: {
      worker_only_cache: true,
      browser_receives_metadata_only: true,
      raw_provider_payload_exposed: false,
      provider_secret_exposed: false,
    },
  };
}

function buildWalletHistoryScanTransactionRecord(manifest = {}, event = {}, index = 0, options = {}) {
  return {
    version: WALLET_HISTORY_SCAN_CACHE_VERSION,
    kind: "normalized_scan_transaction",
    scan_id: manifest.scan_id,
    manifest_ref: manifest.scan_id,
    page_ref: options.pageRef,
    page_index: options.pageIndex,
    transaction_ref: options.transactionRef,
    ordinal_hint: Math.max(1, (Math.max(0, Number(manifest.transactions_loaded) || 0) - Math.max(0, Number(options.pageTransactionCount) || 0)) + index + 1),
    persisted_at: new Date().toISOString(),
    transaction: sanitizeScanCacheTransaction(event, index),
    boundary: {
      worker_only_cache: true,
      raw_provider_payload_exposed: false,
      provider_secret_exposed: false,
    },
  };
}

function sanitizeReplayWindowForCache(windowMetadata = {}) {
  const value = windowMetadata && typeof windowMetadata === "object" && !Array.isArray(windowMetadata) ? windowMetadata : {};
  return {
    version: safeString(value.version) || WALLET_HISTORY_REPLAY_WINDOW_VERSION,
    id: safeString(value.id || value.window_id),
    window_id: safeString(value.window_id || value.id),
    scan_id: safeString(value.scan_id),
    preview_only: value.preview_only !== false,
    staged_history_only: value.staged_history_only !== false,
    active_graph_unchanged: value.active_graph_unchanged !== false,
    worker_backed: value.worker_backed !== false,
    window_index: Math.max(0, Math.floor(Number(value.window_index || value.current_window_index) || 0)),
    current_window_index: Math.max(0, Math.floor(Number(value.current_window_index || value.window_index) || 0)),
    total_windows: Math.max(0, Math.floor(Number(value.total_windows) || 0)),
    window_label: safeString(value.window_label),
    range_position: safeString(value.range_position),
    ordinal_start: Math.max(0, Math.floor(Number(value.ordinal_start) || 0)),
    ordinal_end: Math.max(0, Math.floor(Number(value.ordinal_end) || 0)),
    rows_in_page: Math.max(0, Math.floor(Number(value.rows_in_page) || 0)),
    rows_in_window_estimate: Math.max(0, Math.floor(Number(value.rows_in_window_estimate) || 0)),
    rows_loaded_estimate: Math.max(0, Math.floor(Number(value.rows_loaded_estimate) || 0)),
    earliest_timestamp: normalizeOptionalManifestTimestamp(value.earliest_timestamp),
    latest_timestamp: normalizeOptionalManifestTimestamp(value.latest_timestamp),
    coverage_pct: clampConfidence(value.coverage_pct),
    coverage_basis: safeString(value.coverage_basis),
    replay_suitability: safeString(value.replay_suitability),
    completeness_confidence: clampConfidence(value.completeness_confidence),
    chunk_size: Math.max(0, Math.floor(Number(value.chunk_size) || 0)),
    render_cap_transactions: Math.max(0, Math.floor(Number(value.render_cap_transactions) || 0)),
    partial: value.partial === true,
    continuation: value.continuation && typeof value.continuation === "object" && !Array.isArray(value.continuation)
      ? {
        can_continue_older: value.continuation.can_continue_older === true,
        can_continue_newer: value.continuation.can_continue_newer === true,
        older_window_index: Math.max(0, Math.floor(Number(value.continuation.older_window_index) || 0)),
        newer_window_index: Math.max(0, Math.floor(Number(value.continuation.newer_window_index) || 0)),
        older_window_id: safeString(value.continuation.older_window_id),
        newer_window_id: safeString(value.continuation.newer_window_id),
        older_requires_provider_page: value.continuation.older_requires_provider_page === true,
        newer_requires_provider_page: value.continuation.newer_requires_provider_page === true,
        next_cursor_available: value.continuation.next_cursor_available === true,
        no_full_history_claim: value.continuation.no_full_history_claim !== false,
      }
      : null,
    continuity_confidence: sanitizeReplayContinuityProfile(value.continuity_confidence),
    gap_map: sanitizeReplayGapMap(value.gap_map),
    boundary: value.boundary && typeof value.boundary === "object" && !Array.isArray(value.boundary)
      ? {
        oldest_staged_window_index: Math.max(0, Math.floor(Number(value.boundary.oldest_staged_window_index) || 0)),
        newest_staged_window_index: Math.max(0, Math.floor(Number(value.boundary.newest_staged_window_index) || 0)),
        is_oldest_staged_window: value.boundary.is_oldest_staged_window === true,
        is_newest_staged_window: value.boundary.is_newest_staged_window === true,
        missing_windows_possible: value.boundary.missing_windows_possible !== false,
        staged_segment_only: value.boundary.staged_segment_only !== false,
        preview_only: value.boundary.preview_only !== false,
      }
      : null,
    warnings: safeStringList(value.warnings || value.generation_warnings).slice(0, 12),
  };
}

function sanitizeScanCacheTransaction(event = {}, index = 0) {
  const value = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  return {
    id: safeString(value.id) || `history-transaction-${index + 1}`,
    chain: safeString(value.chain) || "solana",
    signature: safeString(value.signature || value.transaction_hash || value.hash),
    timestamp: normalizeOptionalManifestTimestamp(value.timestamp || value.block_time || value.blockTime || value.received_at),
    transaction_type: safeString(value.transaction_type || value.type) || "unknown",
    source: safeString(value.source),
    wallets: safeObjectList(value.wallets).slice(0, 64).map((wallet) => ({
      address: safeString(wallet.address || wallet.wallet_address),
      role: safeString(wallet.role) || "unknown",
    })),
    tokens: safeObjectList(value.tokens).slice(0, 64).map((token) => ({
      symbol: safeString(token.symbol || token.token_symbol),
      mint: safeString(token.mint || token.token_mint || token.address),
      decimals: Number.isFinite(Number(token.decimals)) ? Number(token.decimals) : null,
    })),
    transfers: safeObjectList(value.transfers).slice(0, 96).map((transfer) => ({
      token_symbol: safeString(transfer.token_symbol || transfer.symbol),
      token_mint: safeString(transfer.token_mint || transfer.mint),
      amount: safeString(transfer.amount),
      from: safeString(transfer.from || transfer.source_wallet),
      to: safeString(transfer.to || transfer.destination_wallet),
    })),
  };
}

function buildWalletHistoryTransactionRef(scanId, event = {}, index = 0, pageIndex = 0) {
  const signature = safeString(event.signature || event.transaction_hash || event.hash);
  const seed = [
    scanId,
    pageIndex,
    signature || event.id || "transaction",
    event.timestamp || "",
    index,
  ].join(":");
  return `tx:${hashStableString(seed)}`;
}

function buildReplayCacheRecord(manifest = {}, page = {}, query = {}, options = {}) {
  return {
    version: WALLET_HISTORY_REPLAY_RECONSTRUCTION_VERSION,
    kind: "replay_reconstruction_cache",
    scan_id: manifest.scan_id,
    manifest_ref: manifest.scan_id,
    page_ref: options.pageRef,
    persisted_at: new Date().toISOString(),
    reconstruction: buildReplayReconstructionMetadata(manifest, page, query, {
      persisted: true,
      last_page_ref: options.pageRef,
      last_page_index: options.pageIndex,
      last_transaction_ref_count: Array.isArray(options.transactionRefs) ? options.transactionRefs.length : 0,
      replay_reconstruction_cached: true,
    }),
    boundary: {
      preview_only: true,
      staged_history_only: true,
      active_graph_unchanged: true,
      worker_only_cache: true,
    },
  };
}

function buildReplayReconstructionMetadata(manifest = {}, page = {}, query = {}, cacheState = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  const existing = sanitizeReplayReconstructionMetadata(safeManifest.replay_reconstruction);
  const events = getWalletHistoryPageEvents(page);
  const timestamps = events
    .map((event) => Date.parse(event.timestamp || event.block_time || event.blockTime || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  const pageIndex = Math.max(1, Number(cacheState.last_page_index) || Number(safeManifest.pages_loaded) || (Number(query.observedPages) || 0) + 1);
  const ordinalEnd = Math.max(Number(safeManifest.transactions_loaded) || 0, Number(query.observedTransactions || 0) + events.length);
  const ordinalStart = events.length ? Math.max(1, ordinalEnd - events.length + 1) : ordinalEnd;
  const pageRef = safeString(cacheState.last_page_ref) || `scan-page:${safeManifest.scan_id}:${pageIndex}`;
  const sortOrder = safeManifest.cursor_state?.sort_order || page.metadata?.sort_order || "unknown";
  const pageSegment = sanitizeReplayTimelineSegment({
    segment_id: `segment:${pageIndex}:${hashStableString(`${safeManifest.scan_id}:${pageRef}:${ordinalStart}:${ordinalEnd}`)}`,
    page_ref: pageRef,
    page_index: pageIndex,
    transaction_count: events.length,
    ordinal_start: ordinalStart,
    ordinal_end: ordinalEnd,
    earliest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.min(...timestamps) : null),
    latest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.max(...timestamps) : null),
    sort_order: sortOrder,
    cursor_kind: safeManifest.cursor_state?.cursor_kind || "unknown",
    partial: safeManifest.full_history_loaded !== true,
  });
  const timelineSegments = mergeReplayTimelineSegments(existing.timeline_segments, pageSegment);
  const totalTransactions = Math.max(0, Number(safeManifest.transactions_loaded) || ordinalEnd);
  const totalWindows = totalTransactions ? Math.ceil(totalTransactions / WALLET_HISTORY_REPLAY_CHUNK_SIZE) : 0;
  const currentWindowIndex = totalTransactions ? Math.max(1, Math.ceil(Math.max(1, ordinalEnd) / WALLET_HISTORY_REPLAY_CHUNK_SIZE)) : 0;
  const currentWindowStart = currentWindowIndex ? ((currentWindowIndex - 1) * WALLET_HISTORY_REPLAY_CHUNK_SIZE) + 1 : 0;
  const currentWindowEnd = currentWindowIndex ? Math.min(totalTransactions, currentWindowIndex * WALLET_HISTORY_REPLAY_CHUNK_SIZE) : 0;
  const oldestFirstReady = safeManifest.full_history_loaded === true || sortOrder === "asc";
  const warnings = dedupeStrings([
    ...existing.warnings,
    ...safeManifest.warnings,
    safeManifest.full_history_loaded === true ? "" : "Replay reconstruction is partial until pagination exhausts without blocking gaps.",
    sortOrder === "desc" ? "Provider pages are newest-first; oldest-first replay requires reconstruction from cached normalized windows." : "",
  ]).slice(0, 12);
  const gapMap = buildReplayGapMap(safeManifest, existing, {
    ordinal_start: currentWindowStart,
    ordinal_end: currentWindowEnd,
    total_windows: totalWindows,
    current_window_index: currentWindowIndex,
    partial: safeManifest.full_history_loaded !== true,
  });

  return sanitizeReplayReconstructionMetadata({
    ...existing,
    scan_id: safeManifest.scan_id,
    total_transactions: totalTransactions,
    total_windows: totalWindows,
    current_window_index: currentWindowIndex,
    current_window_start: currentWindowStart,
    current_window_end: currentWindowEnd,
    current_window_label: currentWindowIndex
      ? `Window ${currentWindowIndex}/${totalWindows || currentWindowIndex} (${currentWindowStart}-${currentWindowEnd})`
      : "No replay window",
    earliest_timestamp: safeManifest.earliest_timestamp,
    latest_timestamp: safeManifest.latest_timestamp,
    oldest_first_ready: oldestFirstReady,
    oldest_first_reconstruction_required: sortOrder !== "asc",
    progressive_expansion_available: Boolean(page.nextCursor || safeManifest.cursor_state?.next_cursor),
    reconstruction_complete: safeManifest.full_history_loaded === true,
    coverage_pct: estimateReplayCoveragePct(safeManifest),
    confidence_degraded: safeManifest.provider_limit_reached || safeManifest.rate_limited || safeManifest.gap_flags.length > 0 || safeManifest.full_history_loaded !== true,
    continuity_confidence: buildReplayContinuityProfile(safeManifest, gapMap),
    gap_map: gapMap,
    timeline_segments: timelineSegments,
    warnings,
  });
}

function mergeReplayTimelineSegments(existingSegments = [], nextSegment = {}) {
  const byId = new Map();
  (Array.isArray(existingSegments) ? existingSegments : []).forEach((segment) => {
    const safeSegment = sanitizeReplayTimelineSegment(segment);
    if (safeSegment.segment_id) byId.set(safeSegment.segment_id, safeSegment);
  });
  const safeNext = sanitizeReplayTimelineSegment(nextSegment);
  if (safeNext.segment_id && (safeNext.transaction_count || safeNext.page_index)) {
    byId.set(safeNext.segment_id, safeNext);
  }
  return [...byId.values()]
    .sort((a, b) => a.page_index - b.page_index || a.ordinal_start - b.ordinal_start)
    .slice(-WALLET_HISTORY_REPLAY_MAX_TIMELINE_SEGMENTS);
}

function buildReplayWindowDescriptor(manifest = {}, reconstruction = {}, query = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  const safeReconstruction = sanitizeReplayReconstructionMetadata(reconstruction);
  const chunkSize = Math.max(1, Math.min(
    WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS,
    Math.floor(Number(safeReconstruction.chunk_size) || WALLET_HISTORY_REPLAY_CHUNK_SIZE),
  ));
  const totalTransactions = Math.max(0, Math.floor(Number(safeReconstruction.total_transactions || safeManifest.transactions_loaded) || 0));
  const totalWindows = Math.max(0, Math.floor(Number(safeReconstruction.total_windows) || (totalTransactions ? Math.ceil(totalTransactions / chunkSize) : 0)));
  const sortOrder = safeManifest.cursor_state?.sort_order || "unknown";
  const newestFirst = sortOrder === "desc";
  const anchorWindow = query.anchorStep
    ? Math.max(1, Math.ceil(Number(query.anchorStep) / chunkSize))
    : Math.max(1, Number(safeReconstruction.current_window_index) || (newestFirst ? 1 : totalWindows) || 1);
  const requestedWindow = deriveReplayWindowIndex({
    requestedWindowIndex: query.windowIndex,
    direction: query.direction,
    anchorWindow,
    totalWindows,
    newestFirst,
  });
  const windowIndex = totalWindows
    ? Math.max(1, Math.min(totalWindows, requestedWindow))
    : 0;
  const ordinalStart = windowIndex ? ((windowIndex - 1) * chunkSize) + 1 : 0;
  const ordinalEnd = windowIndex ? Math.min(totalTransactions, windowIndex * chunkSize) : 0;
  const oldestWindowIndex = totalWindows ? (newestFirst ? totalWindows : 1) : 0;
  const newestWindowIndex = totalWindows ? (newestFirst ? 1 : totalWindows) : 0;
  const overlappingSegments = getReplayWindowSegments(safeReconstruction.timeline_segments, ordinalStart, ordinalEnd);
  const timestamps = overlappingSegments
    .flatMap((segment) => [Date.parse(segment.earliest_timestamp || ""), Date.parse(segment.latest_timestamp || "")])
    .filter((value) => Number.isFinite(value));
  const rangePosition = getReplayWindowRangePosition(windowIndex, oldestWindowIndex, newestWindowIndex, totalWindows);
  const windowId = safeString(query.windowId)
    || buildReplayWindowId(safeManifest.scan_id, windowIndex, ordinalStart, ordinalEnd);
  const canContinueOlder = windowIndex > 0 && (
    newestFirst
      ? windowIndex < totalWindows
      : windowIndex > 1
  );
  const canContinueNewer = windowIndex > 0 && (
    newestFirst
      ? windowIndex > 1
      : windowIndex < totalWindows
  );
  const olderWindowIndex = canContinueOlder
    ? (newestFirst ? windowIndex + 1 : windowIndex - 1)
    : 0;
  const newerWindowIndex = canContinueNewer
    ? (newestFirst ? windowIndex - 1 : windowIndex + 1)
    : 0;
  const olderNeedsProviderPage = !canContinueOlder
    && safeManifest.full_history_loaded !== true
    && Boolean(safeManifest.cursor_state?.next_cursor);
  const warnings = dedupeStrings([
    ...safeManifest.warnings,
    ...safeReconstruction.warnings,
    safeManifest.full_history_loaded === true ? "" : "Replay window is a staged segment; more history may exist outside cached pages.",
    olderNeedsProviderPage ? "Continuing older requires loading another Worker history page before this window can be materialized." : "",
    safeReconstruction.oldest_first_reconstruction_required ? "Provider pages are not proven oldest-first; chronological replay remains reconstruction-bound." : "",
  ]).slice(0, 12);
  const gapMap = buildReplayGapMap(safeManifest, safeReconstruction, {
    ordinal_start: ordinalStart,
    ordinal_end: ordinalEnd,
    total_windows: totalWindows,
    current_window_index: windowIndex,
    partial: safeManifest.full_history_loaded !== true,
    older_requires_provider_page: olderNeedsProviderPage,
    missing_windows_possible: safeManifest.full_history_loaded !== true || olderNeedsProviderPage,
    timeline_segments: overlappingSegments,
  });
  const continuityProfile = buildReplayContinuityProfile(safeManifest, gapMap);

  return {
    version: WALLET_HISTORY_REPLAY_WINDOW_VERSION,
    id: windowId,
    window_id: windowId,
    scan_id: safeManifest.scan_id,
    wallet: safeManifest.wallet,
    provider: safeManifest.provider,
    preview_only: true,
    staged_history_only: true,
    active_graph_unchanged: true,
    worker_backed: true,
    provider_fetch_performed: false,
    browser_provider_calls: false,
    raw_provider_payload_exposed: false,
    provider_secret_exposed: false,
    requested_direction: safeString(query.direction) || "current",
    requested_window_id: safeString(query.windowId),
    window_index: windowIndex,
    current_window_index: windowIndex,
    total_windows: totalWindows,
    window_label: windowIndex
      ? `Replay window ${windowIndex}/${totalWindows || windowIndex} (${ordinalStart}-${ordinalEnd})`
      : "No replay window",
    range_position: rangePosition,
    chunk_size: chunkSize,
    render_cap_transactions: Math.min(WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS, Number(query.limit) || WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS),
    ordinal_start: ordinalStart,
    ordinal_end: ordinalEnd,
    rows_in_window_estimate: Math.max(0, ordinalEnd - ordinalStart + 1),
    rows_loaded_estimate: safeManifest.transactions_loaded,
    earliest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.min(...timestamps) : null),
    latest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.max(...timestamps) : null),
    coverage_pct: estimateReplayCoveragePct(safeManifest),
    coverage_basis: "scan_cache_replay_window",
    replay_suitability: safeManifest.replay_suitability,
    completeness_confidence: safeManifest.completeness_confidence,
    full_history_loaded: safeManifest.full_history_loaded,
    partial: safeManifest.full_history_loaded !== true,
    continuity_confidence: continuityProfile,
    gap_map: gapMap,
    timeline_segments: overlappingSegments.slice(0, 24),
    continuation: {
      can_continue_older: canContinueOlder,
      can_continue_newer: canContinueNewer,
      older_window_index: olderWindowIndex,
      newer_window_index: newerWindowIndex,
      older_window_id: olderWindowIndex ? buildReplayWindowId(safeManifest.scan_id, olderWindowIndex, ((olderWindowIndex - 1) * chunkSize) + 1, Math.min(totalTransactions, olderWindowIndex * chunkSize)) : "",
      newer_window_id: newerWindowIndex ? buildReplayWindowId(safeManifest.scan_id, newerWindowIndex, ((newerWindowIndex - 1) * chunkSize) + 1, Math.min(totalTransactions, newerWindowIndex * chunkSize)) : "",
      older_requires_provider_page: olderNeedsProviderPage,
      newer_requires_provider_page: false,
      next_cursor_available: Boolean(safeManifest.cursor_state?.next_cursor),
      no_full_history_claim: true,
    },
    boundary: {
      oldest_staged_window_index: oldestWindowIndex,
      newest_staged_window_index: newestWindowIndex,
      is_oldest_staged_window: windowIndex > 0 && windowIndex === oldestWindowIndex,
      is_newest_staged_window: windowIndex > 0 && windowIndex === newestWindowIndex,
      missing_windows_possible: safeManifest.full_history_loaded !== true || olderNeedsProviderPage,
      staged_segment_only: true,
      preview_only: true,
    },
    warnings,
  };
}

function buildReplayGapMap(manifest = {}, reconstruction = {}, window = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  const safeReconstruction = sanitizeReplayReconstructionMetadata(reconstruction);
  const cursorState = sanitizeCursorState(safeManifest.cursor_state);
  const totalWindows = Math.max(0, Number(window.total_windows || safeReconstruction.total_windows) || 0);
  const currentWindow = Math.max(0, Number(window.current_window_index || window.window_index || safeReconstruction.current_window_index) || 0);
  const ordinalStart = Math.max(0, Number(window.ordinal_start || safeReconstruction.current_window_start) || 0);
  const ordinalEnd = Math.max(0, Number(window.ordinal_end || safeReconstruction.current_window_end) || 0);
  const segments = Array.isArray(window.timeline_segments) && window.timeline_segments.length
    ? window.timeline_segments.map(sanitizeReplayTimelineSegment)
    : safeReconstruction.timeline_segments;
  const gaps = [];
  const addGap = (code, label, severity, details = {}) => {
    if (!code || gaps.some((gap) => gap.code === code)) return;
    gaps.push(sanitizeReplayGap({
      code,
      label,
      severity,
      ordinal_start: details.ordinal_start ?? ordinalStart,
      ordinal_end: details.ordinal_end ?? ordinalEnd,
      window_index: details.window_index ?? currentWindow,
      confidence_impact: details.confidence_impact,
      source: details.source,
      boundary: details.boundary,
      note: details.note,
    }));
  };

  if (safeManifest.rate_limited) {
    addGap("rate_limited_replay_continuation", "Rate-limited replay continuation", "high", {
      confidence_impact: 24,
      source: "worker_scan_manifest",
      boundary: "provider",
      note: "Continuation paused by Worker-side rate-limit state.",
    });
  }
  if (safeManifest.provider_limit_reached) {
    addGap("provider_limited_window", "Provider-limited window", "high", {
      confidence_impact: 20,
      source: "worker_scan_manifest",
      boundary: "provider",
      note: "Provider limit prevents claiming a complete continuation.",
    });
  }
  if (cursorState.cursor_stalled) {
    addGap("cursor_ambiguity", "Cursor ambiguity", "high", {
      confidence_impact: 18,
      source: "cursor_state",
      boundary: "cursor",
      note: "Cursor stalled or failed to advance during staged scan.",
    });
  }
  if (cursorState.cursor_advanced === false) {
    addGap("cursor_not_advanced", "Cursor did not advance", "medium", {
      confidence_impact: 14,
      source: "cursor_state",
      boundary: "cursor",
      note: "Cursor movement was not confirmed for this staged continuation.",
    });
  }
  safeManifest.gap_flags.forEach((flag) => {
    const code = safeString(flag);
    if (!code) return;
    addGap(code, code.replaceAll("_", " "), ["schema_mismatch", "malformed_ordering", "provider_exhaustion_ambiguous"].includes(code) ? "high" : "medium", {
      confidence_impact: ["schema_mismatch", "malformed_ordering", "provider_exhaustion_ambiguous"].includes(code) ? 18 : 10,
      source: "scan_gap_flags",
      boundary: code.includes("cursor") ? "cursor" : "replay",
      note: "Gap flag emitted by the Worker normalized history contract.",
    });
  });
  if (safeManifest.full_history_loaded !== true && window.older_requires_provider_page === true) {
    addGap("unknown_older_continuation_region", "Unknown older continuation region", "medium", {
      confidence_impact: 12,
      source: "replay_window",
      boundary: "oldest",
      note: "Another Worker history page is required before the older window can be materialized.",
    });
  }
  if (safeManifest.full_history_loaded !== true && window.missing_windows_possible !== false) {
    addGap("missing_window_risk", "Missing-window risk", "medium", {
      confidence_impact: 10,
      source: "replay_window",
      boundary: "staged_window",
      note: "Staged replay windows may not cover all provider history.",
    });
  }
  if (!safeManifest.earliest_timestamp || !safeManifest.latest_timestamp || segments.some((segment) => !segment.earliest_timestamp || !segment.latest_timestamp)) {
    addGap("missing_timestamp_window", "Missing timestamp window", "medium", {
      confidence_impact: 8,
      source: "timeline_segments",
      boundary: "timeline",
      note: "One or more staged replay segments lacks complete timestamp boundaries.",
    });
  }
  if (safeReconstruction.oldest_first_reconstruction_required) {
    addGap("replay_order_reconstruction_required", "Replay order reconstruction required", "medium", {
      confidence_impact: 12,
      source: "replay_reconstruction",
      boundary: "ordering",
      note: "Provider pages are not proven oldest-first for replay.",
    });
  }
  if (safeManifest.full_history_loaded !== true && !cursorState.next_cursor && !safeManifest.provider_limit_reached && !safeManifest.rate_limited) {
    addGap("provider_exhaustion_ambiguous", "Provider exhaustion ambiguous", "medium", {
      confidence_impact: 14,
      source: "cursor_state",
      boundary: "cursor",
      note: "No continuation cursor is visible, but archive completeness is not proven.",
    });
  }

  const confidenceImpact = gaps.reduce((sum, gap) => sum + Math.max(0, Number(gap.confidence_impact) || 0), 0);
  return sanitizeReplayGapMap({
    version: WALLET_HISTORY_REPLAY_GAP_MAP_VERSION,
    scope: "staged_replay_window",
    scan_id: safeManifest.scan_id,
    window_index: currentWindow,
    total_windows: totalWindows,
    ordinal_start: ordinalStart,
    ordinal_end: ordinalEnd,
    missing_windows_possible: safeManifest.full_history_loaded !== true || window.missing_windows_possible === true,
    provider_limited: safeManifest.provider_limit_reached,
    rate_limited: safeManifest.rate_limited,
    cursor_ambiguous: cursorState.cursor_stalled === true || cursorState.cursor_advanced === false || gaps.some((gap) => gap.code === "provider_exhaustion_ambiguous"),
    timestamp_gaps: gaps.some((gap) => gap.code === "missing_timestamp_window"),
    confidence_impact: confidenceImpact,
    gaps: gaps.slice(0, 12),
    boundary_markers: [
      {
        key: "window_start",
        label: "Known staged segment starts",
        position_pct: 0,
        kind: "known_staged_segment",
      },
      {
        key: "window_end",
        label: "Known staged segment ends",
        position_pct: 100,
        kind: safeManifest.full_history_loaded === true ? "known_staged_segment" : "uncertain_continuation",
      },
    ],
    no_full_history_claim: true,
  });
}

function buildReplayContinuityProfile(manifest = {}, gapMap = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  const safeGapMap = sanitizeReplayGapMap(gapMap);
  const impact = Math.min(70, Math.max(0, Number(safeGapMap.confidence_impact) || 0));
  let score = clampConfidence((Number(safeManifest.completeness_confidence) || 0) - Math.floor(impact * 0.45));
  if (safeManifest.full_history_loaded !== true) score = Math.min(score, 76);
  if (safeManifest.provider_limit_reached) score = Math.min(score, 55);
  if (safeManifest.rate_limited) score = Math.min(score, 48);
  if (safeGapMap.cursor_ambiguous) score = Math.min(score, 58);
  const severeGap = safeGapMap.gaps.some((gap) => gap.severity === "high");
  const level = safeManifest.provider_limit_reached || safeManifest.rate_limited
    ? "provider_limited"
    : safeGapMap.cursor_ambiguous || severeGap
      ? "ambiguous"
      : safeManifest.full_history_loaded === true && !safeGapMap.gaps.length
        ? "high"
        : "partial";
  const label = level === "high"
    ? "High staged continuity"
    : level === "partial"
      ? "Partial staged continuity"
      : level === "provider_limited"
        ? "Provider-limited continuity"
        : "Ambiguous staged continuity";
  return sanitizeReplayContinuityProfile({
    score,
    level,
    label,
    degraded: level !== "high",
    reason_codes: safeGapMap.gaps.map((gap) => gap.code).slice(0, 8),
    gap_count: safeGapMap.gaps.length,
    scope: "staged_continuity",
    no_full_history_claim: true,
  });
}

function sanitizeReplayContinuityProfile(profile = {}) {
  const value = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const level = safeString(value.level) || "partial";
  return {
    score: clampConfidence(value.score),
    level: ["high", "partial", "ambiguous", "provider_limited"].includes(level) ? level : "partial",
    label: safeString(value.label) || "Partial staged continuity",
    degraded: value.degraded !== false,
    reason_codes: safeStringList(value.reason_codes).slice(0, 8),
    gap_count: Math.max(0, Math.floor(Number(value.gap_count) || 0)),
    scope: safeString(value.scope) || "staged_continuity",
    no_full_history_claim: value.no_full_history_claim !== false,
  };
}

function sanitizeReplayGapMap(gapMap = {}) {
  const value = gapMap && typeof gapMap === "object" && !Array.isArray(gapMap) ? gapMap : {};
  return {
    version: safeString(value.version) || WALLET_HISTORY_REPLAY_GAP_MAP_VERSION,
    scope: safeString(value.scope) || "staged_replay_window",
    scan_id: safeString(value.scan_id),
    window_index: Math.max(0, Math.floor(Number(value.window_index) || 0)),
    total_windows: Math.max(0, Math.floor(Number(value.total_windows) || 0)),
    ordinal_start: Math.max(0, Math.floor(Number(value.ordinal_start) || 0)),
    ordinal_end: Math.max(0, Math.floor(Number(value.ordinal_end) || 0)),
    missing_windows_possible: value.missing_windows_possible === true,
    provider_limited: value.provider_limited === true,
    rate_limited: value.rate_limited === true,
    cursor_ambiguous: value.cursor_ambiguous === true,
    timestamp_gaps: value.timestamp_gaps === true,
    confidence_impact: Math.max(0, Math.min(100, Math.floor(Number(value.confidence_impact) || 0))),
    gaps: safeObjectList(value.gaps).slice(0, 12).map(sanitizeReplayGap),
    boundary_markers: safeObjectList(value.boundary_markers).slice(0, 12).map((marker) => ({
      key: safeString(marker.key),
      label: safeString(marker.label),
      position_pct: clampConfidence(marker.position_pct),
      kind: safeString(marker.kind) || "uncertain_continuation",
    })),
    no_full_history_claim: value.no_full_history_claim !== false,
  };
}

function sanitizeReplayGap(gap = {}) {
  const value = gap && typeof gap === "object" && !Array.isArray(gap) ? gap : {};
  const severity = safeString(value.severity) || "medium";
  return {
    code: safeString(value.code),
    label: safeString(value.label) || safeString(value.code).replaceAll("_", " "),
    severity: ["low", "medium", "high"].includes(severity) ? severity : "medium",
    ordinal_start: Math.max(0, Math.floor(Number(value.ordinal_start) || 0)),
    ordinal_end: Math.max(0, Math.floor(Number(value.ordinal_end) || 0)),
    window_index: Math.max(0, Math.floor(Number(value.window_index) || 0)),
    confidence_impact: Math.max(0, Math.min(100, Math.floor(Number(value.confidence_impact) || 0))),
    source: safeString(value.source) || "worker",
    boundary: safeString(value.boundary) || "unknown",
    note: safeString(value.note),
  };
}

function deriveReplayWindowIndex(options = {}) {
  const totalWindows = Math.max(0, Number(options.totalWindows) || 0);
  if (!totalWindows) return 0;
  if (Number(options.requestedWindowIndex)) return Number(options.requestedWindowIndex);
  const anchorWindow = Math.max(1, Math.min(totalWindows, Number(options.anchorWindow) || 1));
  const direction = safeString(options.direction || "current");
  const newestFirst = options.newestFirst === true;
  if (direction === "oldest") return newestFirst ? totalWindows : 1;
  if (direction === "newest") return newestFirst ? 1 : totalWindows;
  if (direction === "older") return newestFirst ? anchorWindow + 1 : anchorWindow - 1;
  if (direction === "newer") return newestFirst ? anchorWindow - 1 : anchorWindow + 1;
  return anchorWindow;
}

function getReplayWindowRangePosition(windowIndex, oldestWindowIndex, newestWindowIndex, totalWindows) {
  if (!windowIndex || !totalWindows) return "empty";
  if (totalWindows === 1) return "single_staged_range";
  if (windowIndex === oldestWindowIndex) return "oldest_staged_range";
  if (windowIndex === newestWindowIndex) return "newest_staged_range";
  return "middle_staged_range";
}

function getReplayWindowSegments(segments = [], ordinalStart = 0, ordinalEnd = 0) {
  if (!ordinalStart || !ordinalEnd) return [];
  return (Array.isArray(segments) ? segments : [])
    .map(sanitizeReplayTimelineSegment)
    .filter((segment) => segment.segment_id && segment.ordinal_end >= ordinalStart && segment.ordinal_start <= ordinalEnd)
    .sort((a, b) => a.ordinal_start - b.ordinal_start || a.page_index - b.page_index);
}

function buildReplayWindowId(scanId, windowIndex, ordinalStart, ordinalEnd) {
  return `replay-window:${safeString(scanId)}:${Math.max(0, Number(windowIndex) || 0)}:${hashStableString(`${scanId}:${windowIndex}:${ordinalStart}:${ordinalEnd}`)}`;
}

async function readReplayWindowTransactions(env = {}, manifest = {}, reconstruction = {}, descriptor = {}) {
  const segments = Array.isArray(descriptor.timeline_segments) ? descriptor.timeline_segments : [];
  const limit = Math.max(1, Math.min(WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS, Number(descriptor.render_cap_transactions) || WALLET_HISTORY_REPLAY_WINDOW_MAX_EVENTS));
  const results = [];
  const seen = new Set();

  for (const segment of segments) {
    const pageRecord = await readWalletHistoryScanPageByRef(env, segment.page_ref);
    const transactions = Array.isArray(pageRecord?.normalized_transactions) ? pageRecord.normalized_transactions : [];
    transactions.forEach((transaction, index) => {
      const ordinal = Math.max(1, Number(segment.ordinal_start) || 1) + index;
      if (ordinal < descriptor.ordinal_start || ordinal > descriptor.ordinal_end) return;
      const safeTransaction = sanitizeReplayWindowTransactionForResponse(transaction, ordinal, descriptor);
      const key = safeTransaction.signature || safeTransaction.transaction_hash || `${safeTransaction.id}:${ordinal}`;
      if (!key || seen.has(key) || results.length >= limit) return;
      seen.add(key);
      results.push(safeTransaction);
    });
    if (results.length >= limit) break;
  }

  return results.sort((a, b) => (Number(a.metadata?.replay_ordinal) || 0) - (Number(b.metadata?.replay_ordinal) || 0));
}

function sanitizeReplayWindowTransactionForResponse(transaction = {}, ordinal = 0, descriptor = {}) {
  const safeTransaction = sanitizeScanCacheTransaction(transaction, ordinal - 1);
  const firstTransfer = safeTransaction.transfers[0] || {};
  return {
    ...safeTransaction,
    transaction_hash: safeTransaction.signature,
    source_wallet: safeString(firstTransfer.from),
    destination_wallet: safeString(firstTransfer.to),
    token_symbol: safeString(firstTransfer.token_symbol),
    token_mint: safeString(firstTransfer.token_mint),
    amount: safeString(firstTransfer.amount),
    amount_display: safeString(firstTransfer.amount),
    metadata: {
      preview_only: true,
      staged_history_only: true,
      worker_backed: true,
      replay_window_id: descriptor.window_id || descriptor.id || "",
      replay_window_index: Math.max(0, Number(descriptor.window_index) || 0),
      replay_ordinal: Math.max(0, Number(ordinal) || 0),
      active_graph_unchanged: true,
    },
  };
}

async function putWalletHistoryScanCacheRecord(env = {}, key, record, memoryCache, maxItems) {
  if (!key || !record || typeof record !== "object" || Array.isArray(record)) return;
  if (env.CRYPTO_EVENTS_KV) {
    await env.CRYPTO_EVENTS_KV.put(key, JSON.stringify(record), {
      expirationTtl: WALLET_HISTORY_SCAN_CACHE_TTL_SECONDS,
    });
    return;
  }
  memoryCache.set(key, record);
  trimMap(memoryCache, maxItems);
}

async function readWalletHistoryScanPageByRef(env = {}, pageRef = "") {
  const safeRef = safeString(pageRef);
  if (!safeRef) return null;
  const key = walletHistoryScanPageRefKey(safeRef);
  try {
    if (env.CRYPTO_EVENTS_KV) {
      const record = await env.CRYPTO_EVENTS_KV.get(key, "json");
      if (record && typeof record === "object" && !Array.isArray(record)) return record;
    }
    const direct = walletHistoryScanPageRefMemoryCache.get(key);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
    for (const record of walletHistoryScanPageMemoryCache.values()) {
      if (record?.page_ref === safeRef) return record;
    }
  } catch {
    return null;
  }
  return null;
}

function walletHistoryScanPageKey(scanId, pageIndex, cursor) {
  const cursorPart = sanitizeManifestCursor(cursor) || "initial";
  return `${WALLET_HISTORY_SCAN_PAGE_KEY_PREFIX}${safeString(scanId)}:${Math.max(1, Number(pageIndex) || 1)}:${cursorPart}`;
}

function walletHistoryScanPageRefKey(pageRef) {
  return `${WALLET_HISTORY_SCAN_PAGE_REF_KEY_PREFIX}${safeString(pageRef)}`;
}

function walletHistoryScanTransactionKey(scanId, transactionRef) {
  return `${WALLET_HISTORY_SCAN_TRANSACTION_KEY_PREFIX}${safeString(scanId)}:${safeString(transactionRef)}`;
}

function walletHistoryReplayCacheKey(scanId) {
  return `${WALLET_HISTORY_REPLAY_CACHE_KEY_PREFIX}${safeString(scanId)}`;
}

function sanitizeCursorState(cursorState = {}) {
  const state = cursorState && typeof cursorState === "object" && !Array.isArray(cursorState) ? cursorState : {};
  return {
    current_cursor: sanitizeManifestCursor(state.current_cursor),
    next_cursor: sanitizeManifestCursor(state.next_cursor),
    cursor_kind: safeString(state.cursor_kind) || "unknown",
    cursor_advanced: state.cursor_advanced === true ? true : state.cursor_advanced === false ? false : null,
    cursor_stalled: state.cursor_stalled === true,
    sort_order: safeString(state.sort_order) || "unknown",
    pagination_model: safeString(state.pagination_model) || "unknown",
  };
}

function sanitizeManifestCursor(value) {
  const cursor = safeString(value);
  if (!cursor) return null;
  return /^[A-Za-z0-9._:-]+$/.test(cursor) ? cursor.slice(0, 180) : null;
}

async function readWalletHistoryScanManifest(env = {}, scanId) {
  const safeScanId = sanitizeManifestCursor(scanId);
  if (!safeScanId) return null;
  const key = walletHistoryScanKey(safeScanId);
  try {
    if (env.CRYPTO_EVENTS_KV) {
      const record = await env.CRYPTO_EVENTS_KV.get(key, "json");
      return record && typeof record === "object" && !Array.isArray(record)
        ? sanitizeWalletHistoryScanManifest(record)
        : null;
    }
    const record = walletHistoryScanMemoryCache.get(key);
    return record && typeof record === "object" && !Array.isArray(record)
      ? sanitizeWalletHistoryScanManifest(record)
      : null;
  } catch {
    return null;
  }
}

async function putWalletHistoryScanManifest(env = {}, manifest = {}) {
  const safeManifest = sanitizeWalletHistoryScanManifest(manifest);
  if (!safeManifest.scan_id) return;
  const key = walletHistoryScanKey(safeManifest.scan_id);
  try {
    if (env.CRYPTO_EVENTS_KV) {
      await env.CRYPTO_EVENTS_KV.put(key, JSON.stringify(safeManifest), {
        expirationTtl: WALLET_HISTORY_SCAN_TTL_SECONDS,
      });
      return;
    }
    walletHistoryScanMemoryCache.set(key, safeManifest);
    trimMap(walletHistoryScanMemoryCache, MAX_WALLET_HISTORY_SCAN_ITEMS);
  } catch {
    // Scan manifests are operational metadata; failures must not block safe history pagination.
  }
}

function walletHistoryScanKey(scanId) {
  return `${WALLET_HISTORY_SCAN_KEY_PREFIX}${safeString(scanId)}`;
}

function createWalletHistoryScanId(query = {}, providerId = "none") {
  const seed = [
    providerId,
    query.wallet || "",
    query.cursor || "initial",
    query.limit || "",
    Date.now(),
    Math.floor(Math.random() * 1000000),
  ].join(":");
  return `scan:${providerId}:${hashStableString(seed)}`;
}

function calculateCompletenessConfidence(options = {}) {
  let score = Number(options.baseConfidence);
  if (!Number.isFinite(score)) {
    score = getWalletHistoryProviderArchiveProfile(options.providerId || "none").completeness_confidence;
  }
  if (options.moreAvailable) score -= 12;
  if (options.providerLimitReached) score -= 28;
  if (options.rateLimited) score -= 35;
  for (const flag of safeStringList(options.gapFlags)) {
    if (flag === "schema_mismatch" || flag === "malformed_ordering") score -= 24;
    else if (flag === "cursor_stall" || flag === "provider_exhaustion_ambiguous") score -= 18;
    else if (flag === "missing_ordering_fields" || flag === "timestamp_inconsistency") score -= 12;
    else if (flag === "missing_timestamp" || flag === "incomplete_transaction_rows") score -= 8;
    else score -= 5;
  }
  if (options.fullHistoryLoaded) score += 6;
  return clampConfidence(score);
}

function degradeCompletenessConfidence(base, gapFlags = []) {
  return calculateCompletenessConfidence({
    baseConfidence: base,
    gapFlags,
    providerLimitReached: gapFlags.length > 0,
  });
}

function deriveReplaySuitability(base = "low", options = {}) {
  if (options.rateLimited || options.providerLimitReached) return "low";
  const flags = safeStringList(options.gapFlags);
  if (flags.some((flag) => ["schema_mismatch", "malformed_ordering", "cursor_stall"].includes(flag))) return "low";
  if (flags.length || options.moreAvailable || !options.fullHistoryLoaded) {
    return base === "high" ? "medium" : base;
  }
  return base;
}

function buildReplayWindowMetadata(events = [], options = {}) {
  const timestamps = events
    .map((event) => Date.parse(event.timestamp || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  const totalLoaded = Math.max(0, Number(options.query?.observedTransactions) || 0) + events.length;
  const fullHistoryLoaded = options.fullHistoryLoaded === true;
  const chunkSize = WALLET_HISTORY_REPLAY_CHUNK_SIZE;
  const totalWindows = totalLoaded ? Math.ceil(totalLoaded / chunkSize) : 0;
  const windowIndex = totalLoaded ? Math.max(1, Math.ceil(totalLoaded / chunkSize)) : 0;
  const ordinalStart = events.length ? Math.max(1, totalLoaded - events.length + 1) : 0;
  const ordinalEnd = totalLoaded;
  const scanId = safeString(options.query?.scanId);
  const windowId = buildReplayWindowId(scanId || "pending-scan", windowIndex, ordinalStart, ordinalEnd);
  return {
    version: WALLET_HISTORY_REPLAY_WINDOW_VERSION,
    id: windowId,
    window_id: windowId,
    scan_id: scanId,
    preview_only: true,
    staged_history_only: true,
    active_graph_unchanged: true,
    worker_backed: true,
    provider_fetch_performed: true,
    browser_provider_calls: false,
    raw_provider_payload_exposed: false,
    provider_secret_exposed: false,
    current_window_index: windowIndex,
    window_index: windowIndex,
    total_windows: totalWindows,
    window_label: windowIndex ? `Replay window ${windowIndex}/${totalWindows || windowIndex} (${ordinalStart}-${ordinalEnd})` : "No replay window",
    range_position: totalWindows <= 1 ? "single_staged_range" : "newest_staged_range",
    ordinal_start: ordinalStart,
    ordinal_end: ordinalEnd,
    rows_in_page: events.length,
    rows_in_window_estimate: events.length,
    rows_loaded_estimate: totalLoaded,
    earliest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.min(...timestamps) : null),
    latest_timestamp: formatOptionalIsoTimestamp(timestamps.length ? Math.max(...timestamps) : null),
    coverage_pct: fullHistoryLoaded ? 100 : estimateReplayCoveragePct({
      transactions_loaded: totalLoaded,
      full_history_loaded: fullHistoryLoaded,
      provider_limit_reached: options.coverageReason === "provider_exhaustion_ambiguous" || options.coverageReason === "legacy_provider_limit",
      rate_limited: false,
    }),
    coverage_basis: options.coverageReason || "staged_page",
    replay_suitability: options.replaySuitability || "low",
    completeness_confidence: clampConfidence(options.completenessConfidence),
    chunk_size: chunkSize,
    render_cap_transactions: WALLET_HISTORY_REPLAY_RENDER_CAP,
    partial: !fullHistoryLoaded,
    continuation: {
      can_continue_older: false,
      can_continue_newer: windowIndex > 1,
      older_window_index: 0,
      newer_window_index: windowIndex > 1 ? windowIndex - 1 : 0,
      older_requires_provider_page: !fullHistoryLoaded,
      newer_requires_provider_page: false,
      next_cursor_available: false,
      no_full_history_claim: true,
    },
    boundary: {
      oldest_staged_window_index: totalWindows || windowIndex,
      newest_staged_window_index: 1,
      is_oldest_staged_window: totalWindows <= 1,
      is_newest_staged_window: true,
      missing_windows_possible: !fullHistoryLoaded,
      staged_segment_only: true,
      preview_only: true,
    },
    generation_warnings: [
      "Replay remains preview-only and uses staged rows only.",
      fullHistoryLoaded ? "Cursor exhaustion was observed, but completeness remains provider-contract dependent." : "More history may exist outside the current staged window.",
    ],
  };
}

function estimateReplayCoveragePct(manifest = {}) {
  if (manifest.full_history_loaded === true) return 100;
  if (manifest.provider_limit_reached || manifest.rate_limited) return Math.min(65, Math.max(18, Math.floor((Number(manifest.transactions_loaded) || 0) / 10)));
  const loaded = Number(manifest.transactions_loaded) || 0;
  if (!loaded) return 0;
  return Math.min(88, 18 + Math.floor(Math.log10(loaded + 1) * 28));
}

function minFiniteTimestamp(...values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.min(...finite) : null;
}

function maxFiniteTimestamp(...values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function formatOptionalIsoTimestamp(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? new Date(number).toISOString() : "";
}

function normalizeManifestTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function normalizeOptionalManifestTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function safeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => safeString(item)).filter(Boolean)
    : [];
}

function dedupeStrings(items = []) {
  return [...new Set(items.map((item) => safeString(item)).filter(Boolean))];
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function formatProviderAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("en-US", {
    maximumFractionDigits: number >= 1 ? 9 : 12,
    useGrouping: false,
  });
}

function shortProviderValue(value) {
  const text = safeString(value);
  if (!text) return "";
  if (text === "native:sol") return "SOL";
  if (text.length <= 12) return text;
  return `${text.slice(0, 5)}...${text.slice(-4)}`;
}

function hashStableString(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getNullablePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.floor(number);
}

function walletHistoryProviderUnavailablePage(query, options) {
  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: options.provider,
    cursor: query.cursor,
    nextCursor: null,
    events: [],
    moreAvailable: false,
    status: "provider_unavailable",
    message: options.message,
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      provider_status: options.statusCode || null,
      status_alias: "unavailable",
      page_size: 0,
      more_available: false,
      history_coverage: "unavailable",
      full_history_loaded: false,
      limited_by_provider: false,
      provider_fetch_performed: true,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: 0,
        providerFetchPerformed: true,
        providerLimitReached: false,
        rateLimited: false,
        basis: "provider_unavailable",
      }),
    },
  });
}

function walletHistoryProviderRateLimitedPage(query, options) {
  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: options.provider,
    cursor: query.cursor,
    nextCursor: query.cursor ?? null,
    events: [],
    moreAvailable: Boolean(query.cursor),
    status: "provider_rate_limited",
    message: options.message,
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      provider_status: options.statusCode || null,
      status_alias: "rate_limited",
      page_size: 0,
      more_available: Boolean(query.cursor),
      history_coverage: "rate_limited",
      full_history_loaded: false,
      limited_by_provider: true,
      provider_fetch_performed: options.source !== "worker_rate_limit_guardrail",
      rate_limit_status: "limited",
      rate_limit_source: options.source || "provider",
      retry_after_seconds: Math.max(1, Number(options.retryAfterSeconds) || WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS),
      cache_status: "miss",
      cache_hit: false,
      cache_ttl_seconds: WALLET_HISTORY_CACHE_TTL_SECONDS,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: 0,
        providerFetchPerformed: false,
        providerLimitReached: false,
        rateLimited: true,
        basis: "rate_limited",
      }),
    },
  });
}

function walletHistoryProviderLimitedPage(query, options) {
  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: options.provider,
    cursor: query.cursor,
    nextCursor: null,
    events: [],
    moreAvailable: false,
    status: "provider_limited",
    message: options.message,
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      limit: query.limit,
      requested_limit: query.requestedLimit,
      limit_capped: Boolean(query.limitCapped),
      provider_status: options.statusCode || null,
      status_alias: "limited_by_provider",
      page_size: 0,
      more_available: false,
      history_coverage: "limited_by_provider",
      full_history_loaded: false,
      limited_by_provider: true,
      provider_fetch_performed: true,
      ...buildWalletHistoryDepthMetadata(query, {
        pageSize: 0,
        providerFetchPerformed: true,
        providerLimitReached: true,
        rateLimited: false,
        basis: "provider_status_limit",
      }),
    },
  });
}

function normalizeWalletHistoryResponse(page) {
  const events = Array.isArray(page.events)
    ? page.events
    : Array.isArray(page.transactions)
      ? page.transactions
      : [];
  const status = safeString(page.status) || "ok";
  const sourceMetadata = page.metadata || {};
  const rateLimited = sourceMetadata.rate_limited === true
    || sourceMetadata.rate_limit_status === "limited"
    || status === "provider_rate_limited";
  const providerLimitReached = sourceMetadata.provider_limit_reached === true
    || sourceMetadata.limited_by_provider === true
    || status === "provider_limited";
  const depthEstimate = sourceMetadata.history_depth_estimate && typeof sourceMetadata.history_depth_estimate === "object"
    ? sourceMetadata.history_depth_estimate
    : {
      pages_observed: 0,
      transactions_observed: events.length,
      current_page_size: events.length,
      max_page_size: Number(sourceMetadata.limit) || MAX_WALLET_HISTORY_LIMIT,
      max_pages: sourceMetadata.provider_max_pages ?? null,
      max_transactions: sourceMetadata.provider_max_transactions ?? null,
      cursor_exhausted: !Boolean(page.nextCursor),
      cursor_advanced: sourceMetadata.cursor_advanced ?? null,
      confidence: "response_only",
      basis: "normalized_response_default",
    };
  const archiveProfile = getWalletHistoryProviderArchiveProfile(safeString(page.provider) || "none");
  const providerDiagnostics = sourceMetadata.provider_diagnostics && typeof sourceMetadata.provider_diagnostics === "object"
    ? sourceMetadata.provider_diagnostics
    : {
      active_provider: safeString(page.provider) || "none",
      configured: sourceMetadata.provider_configured === true,
      capabilities: sourceMetadata.provider_capabilities || getWalletHistoryProviderCapabilities(safeString(page.provider) || "none"),
      ...archiveProfile,
      pagination_supported: sourceMetadata.pagination_supported === true,
      cursor_type: safeString(sourceMetadata.cursor_type) || "unknown",
      max_safe_page_size: Number(sourceMetadata.max_safe_page_size) || MAX_WALLET_HISTORY_LIMIT,
      rate_limit_window_seconds: Number(sourceMetadata.rate_limit_window_seconds) || WALLET_HISTORY_RATE_LIMIT_WINDOW_SECONDS,
      rate_limit_fetches: Number(sourceMetadata.rate_limit_fetches) || WALLET_HISTORY_RATE_LIMIT_FETCHES,
      cache_ttl_seconds: Number(sourceMetadata.cache_ttl_seconds) || WALLET_HISTORY_CACHE_TTL_SECONDS,
      candidates: Array.isArray(sourceMetadata.provider_candidates) ? sourceMetadata.provider_candidates : WALLET_HISTORY_PROVIDER_CANDIDATES,
      missing_env_vars: Array.isArray(sourceMetadata.missing_env_vars) ? sourceMetadata.missing_env_vars : [],
      frontend_allowed: false,
      worker_backed: false,
      archive_contract_version: WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
    };

  return {
    wallet: safeString(page.wallet) || "",
    provider: safeString(page.provider) || "none",
    cursor: page.cursor ?? null,
    nextCursor: page.nextCursor ?? null,
    events,
    transactions: events,
    moreAvailable: Boolean(page.moreAvailable && page.nextCursor),
    status,
    message: safeString(page.message) || "",
    providerDiagnostics,
    metadata: {
      sanitized: true,
      production_meaning: false,
      live_blockchain_fetching: false,
      browser_provider_calls: false,
      provider_secret_exposed: false,
      raw_provider_payload_exposed: false,
      endpoint_contract: "/api/crypto/wallet-history",
      provider_diagnostics: providerDiagnostics,
      ...archiveProfile,
      ...sourceMetadata,
      archive_contract_version: sourceMetadata.archive_contract_version || WALLET_HISTORY_ARCHIVE_CONTRACT_VERSION,
      history_depth_estimate: depthEstimate,
      provider_limit_reached: providerLimitReached,
      rate_limited: rateLimited,
      total_possible_estimate: sourceMetadata.total_possible_estimate ?? null,
      response_more_available: Boolean(page.moreAvailable && page.nextCursor),
      response_next_cursor_present: Boolean(page.nextCursor),
      response_status: status,
    },
  };
}

async function fetchHeliusAddressHistory(options) {
  const providerUrl = new URL(`${HELIUS_ADDRESS_HISTORY_ENDPOINT}/${encodeURIComponent(options.wallet)}/transactions`);
  providerUrl.searchParams.set("api-key", options.heliusApiKey);
  providerUrl.searchParams.set("limit", String(options.limit));

  let response;
  try {
    response = await fetch(providerUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    throw new WalletLookupProviderError("Helius wallet lookup request failed before a response was returned.", 503);
  }

  if (!response.ok) {
    const status = response.status === 429 ? 503 : 502;
    throw new WalletLookupProviderError(`Helius wallet lookup returned ${response.status}.`, status);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new WalletLookupProviderError("Helius wallet lookup returned an unexpected response shape.", 502);
  }

  return payload.slice(0, options.limit);
}

async function getWalletLookupCacheStatus(env = {}, wallet) {
  const cached = await readWalletLookupCache(env, wallet);
  const fetchedAt = Date.parse(cached?.fetchedAt || "");
  if (!Number.isFinite(fetchedAt)) {
    return {
      fresh: false,
      remainingMs: 0,
    };
  }

  const remainingMs = WALLET_LOOKUP_COOLDOWN_MS - (Date.now() - fetchedAt);
  return {
    fresh: remainingMs > 0,
    remainingMs: Math.max(0, remainingMs),
  };
}

async function readWalletLookupCache(env = {}, wallet) {
  if (env.CRYPTO_EVENTS_KV) {
    const cached = await env.CRYPTO_EVENTS_KV.get(walletLookupCacheKey(wallet), "json");
    return cached && typeof cached === "object" ? cached : null;
  }

  return walletLookupMemoryCache.get(walletLookupCacheKey(wallet)) || null;
}

async function putWalletLookupCacheStatus(env = {}, wallet, value) {
  const payload = {
    fetchedAt: value.fetchedAt,
    count: value.count,
  };

  if (env.CRYPTO_EVENTS_KV) {
    await env.CRYPTO_EVENTS_KV.put(walletLookupCacheKey(wallet), JSON.stringify(payload), {
      expirationTtl: Math.max(60, Math.ceil(WALLET_LOOKUP_COOLDOWN_MS / 1000) * 2),
    });
    return;
  }

  walletLookupMemoryCache.set(walletLookupCacheKey(wallet), payload);
  if (walletLookupMemoryCache.size > MAX_WALLET_LOOKUP_CACHE_ITEMS) {
    const firstKey = walletLookupMemoryCache.keys().next().value;
    walletLookupMemoryCache.delete(firstKey);
  }
}

function walletLookupCacheKey(wallet) {
  return `${WALLET_LOOKUP_CACHE_KEY_PREFIX}${String(wallet || "").trim().toLowerCase()}`;
}

function parseEventFeedQuery(url) {
  const allowedParams = new Set(["limit", "since", "wallet", "token", "transaction_type"]);
  const issues = [];

  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) {
      issues.push({
        param: key,
        reason: "unsupported_query_param",
      });
    }
  }

  const limit = parseLimit(url.searchParams.get("limit"), issues);
  const filters = {
    since: parseSince(url.searchParams.get("since"), issues),
    wallet: parseFilterString(url.searchParams.get("wallet"), "wallet", issues),
    token: parseFilterString(url.searchParams.get("token"), "token", issues),
    transaction_type: parseFilterString(url.searchParams.get("transaction_type"), "transaction_type", issues),
  };

  if (issues.length > 0) {
    throw new InvalidEventQueryError("Event feed query parameters are invalid.", issues);
  }

  const filtersApplied = {
    limit,
  };

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      filtersApplied[key] = value;
    }
  }

  return {
    limit,
    filters,
    filtersApplied,
  };
}

function parseLimit(value, issues) {
  if (value === null) {
    return DEFAULT_EVENT_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    issues.push({
      param: "limit",
      reason: "must_be_integer",
    });
    return DEFAULT_EVENT_LIMIT;
  }

  const limit = Number(value);
  if (limit < 1 || limit > MAX_EVENT_LIMIT) {
    issues.push({
      param: "limit",
      reason: `must_be_between_1_and_${MAX_EVENT_LIMIT}`,
    });
    return DEFAULT_EVENT_LIMIT;
  }

  return limit;
}

function parseSince(value, issues) {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime())) {
    issues.push({
      param: "since",
      reason: "must_be_valid_date",
    });
    return null;
  }

  return date.toISOString();
}

function parseFilterString(value, param, issues) {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    issues.push({
      param,
      reason: "must_be_non_empty_string_up_to_256_chars",
    });
    return null;
  }

  return normalized;
}

function applyEventFilters(events, filters) {
  return events.filter((event) => {
    if (filters.since && !isEventSince(event, filters.since)) {
      return false;
    }

    if (filters.wallet && !event.wallets.some((wallet) => equalsFilter(wallet.address, filters.wallet))) {
      return false;
    }

    if (filters.token && !event.tokens.some((token) => (
      equalsFilter(token.symbol, filters.token) || equalsFilter(token.mint, filters.token)
    ))) {
      return false;
    }

    if (filters.transaction_type && !equalsFilter(event.transaction_type, filters.transaction_type)) {
      return false;
    }

    return true;
  });
}

function isEventSince(event, since) {
  const eventTime = new Date(event.received_at || event.timestamp).getTime();
  return !Number.isNaN(eventTime) && eventTime >= new Date(since).getTime();
}

function equalsFilter(left, right) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function isDevEnvironment(env = {}) {
  const environment = String(env.ENVIRONMENT || "").toLowerCase();
  return environment === "local" || environment === "development";
}

function handleError(error) {
  if (error instanceof UnsafeEventInputError) {
    return json({
      error: "unsafe_event_input",
      message: error.message,
      issues: error.issues,
    }, 400);
  }

  if (error instanceof InvalidEventInputError) {
    return json({
      error: "invalid_event_input",
      message: error.message,
    }, 400);
  }

  if (error instanceof InvalidEventQueryError) {
    return json({
      error: "invalid_event_query",
      message: error.message,
      issues: error.issues,
    }, 400);
  }

  if (error instanceof WebhookAuthError) {
    return json({
      error: "invalid_webhook_auth",
      message: error.message,
    }, 401);
  }

  if (error instanceof WebhookConfigError) {
    return json({
      error: "webhook_not_configured",
      message: error.message,
    }, 503);
  }

  if (error instanceof WebhookScopeError) {
    return json({
      error: "webhook_event_out_of_scope",
      message: error.message,
    }, 403);
  }

  if (error instanceof WalletLookupProviderError) {
    return json({
      error: "wallet_lookup_provider_unavailable",
      message: error.message,
    }, error.status);
  }

  if (error instanceof WalletHistoryProviderError) {
    return json({
      error: error.code || "wallet_history_provider_unavailable",
      provider: error.provider || "",
      status: error.code || "wallet_history_provider_unavailable",
      message: error.message,
      metadata: {
        sanitized: true,
        production_meaning: false,
        live_blockchain_fetching: false,
        browser_provider_calls: false,
        provider_secret_exposed: false,
        raw_provider_payload_exposed: false,
        endpoint_contract: "/api/crypto/wallet-history",
        provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      },
    }, error.status);
  }

  return json({
    error: "internal_error",
  }, 500);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}
