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
const WALLET_LOOKUP_COOLDOWN_MS = 60 * 1000;
const WALLET_LOOKUP_CACHE_KEY_PREFIX = "crypto-wallet-lookup:";
const MAX_WALLET_LOOKUP_CACHE_ITEMS = 100;
const MAX_TEST_EVENT_BATCH = 10;
const MAX_HELIUS_WEBHOOK_BATCH = 10;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const HELIUS_ADDRESS_HISTORY_ENDPOINT = "https://api-mainnet.helius-rpc.com/v0/addresses";
const DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS = "balanceChanged";
const SUPPORTED_HELIUS_HISTORY_TOKEN_ACCOUNTS = new Set(["none", "balanceChanged", "all"]);
const WALLET_HISTORY_PROVIDER_CANDIDATES = Object.freeze([
  {
    id: "helius",
    label: "Helius Enhanced Transactions address history",
    readiness: "implemented_when_HELIUS_API_KEY_and_CRYPTO_WALLET_HISTORY_PROVIDER_are_configured",
  },
  {
    id: "lana",
    label: "lana.ai wallet history",
    readiness: "placeholder_only_no_public_api_docs_found_d107",
  },
  {
    id: "generic",
    label: "Generic Worker-side external wallet history endpoint",
    readiness: "implemented_when_CRYPTO_WALLET_HISTORY_URL_is_configured",
  },
]);
const HELIUS_ALLOWED_WALLETS = [
  "CryptoPhotonicControlledWallet1111111111111111111",
];
const walletLookupMemoryCache = new Map();

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

      if (request.method === "GET" && url.pathname === "/api/crypto/wallet-history") {
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
  const allowedParams = new Set(["wallet", "cursor", "limit"]);
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
  const cursor = parseWalletHistoryCursor(url.searchParams.get("cursor"), issues);
  const limit = parseWalletHistoryLimit(url.searchParams.get("limit"), issues);

  if (issues.length > 0) {
    throw new InvalidEventQueryError("Wallet history query parameters are invalid.", issues);
  }

  return {
    wallet,
    cursor,
    limit,
  };
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
    return DEFAULT_WALLET_HISTORY_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    issues.push({
      param: "limit",
      reason: "must_be_integer",
    });
    return DEFAULT_WALLET_HISTORY_LIMIT;
  }

  const limit = Number(value);
  if (limit < 1 || limit > MAX_WALLET_HISTORY_LIMIT) {
    issues.push({
      param: "limit",
      reason: `must_be_between_1_and_${MAX_WALLET_HISTORY_LIMIT}`,
    });
    return DEFAULT_WALLET_HISTORY_LIMIT;
  }

  return limit;
}

async function fetchWalletHistoryPage(query, env = {}) {
  const provider = createWalletHistoryProvider(env);
  if (!provider.configured) {
    return walletHistoryProviderNotConfiguredPage(query, provider);
  }

  return provider.fetchPage(query);
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
  if (normalized === "helius" || normalized === "helius_history" || normalized === "helius_wallet_history") {
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

function walletHistoryProviderNotConfiguredPage(query, provider) {
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
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      limit: query.limit,
    },
  });
}

async function fetchHeliusWalletHistoryPage(query, env, heliusApiKey) {
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
    return walletHistoryProviderUnavailablePage(query, {
      provider: "helius",
      message: `Helius wallet history returned ${response.status}.`,
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
  const nextCursor = getLastTransactionSignature(transactions);

  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: "helius",
    cursor: query.cursor,
    nextCursor: transactions.length >= query.limit ? nextCursor : null,
    events,
    moreAvailable: Boolean(transactions.length >= query.limit && nextCursor),
    status: "ok",
    message: transactions.length
      ? "Wallet history page loaded from the Worker-side Helius adapter."
      : "Wallet history provider returned no transactions for this page.",
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      source: "helius_wallet_history",
      limit: query.limit,
      count: events.length,
      token_accounts: tokenAccounts,
      cursor_kind: query.cursor ? "before_signature" : "initial",
      provider_fetch_performed: true,
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

function getHeliusHistoryTokenAccounts(env = {}) {
  const configured = safeString(env.CRYPTO_HELIUS_HISTORY_TOKEN_ACCOUNTS) || DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS;
  return SUPPORTED_HELIUS_HISTORY_TOKEN_ACCOUNTS.has(configured)
    ? configured
    : DEFAULT_HELIUS_HISTORY_TOKEN_ACCOUNTS;
}

function getLastTransactionSignature(transactions) {
  const last = Array.isArray(transactions) ? transactions[transactions.length - 1] : null;
  return safeString(last?.signature);
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
    return walletHistoryProviderUnavailablePage(query, {
      provider: "generic",
      message: `Generic wallet history provider returned ${response.status}.`,
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

  return normalizeWalletHistoryResponse({
    wallet: query.wallet,
    provider: "generic",
    cursor: query.cursor,
    nextCursor: safeString(payload.nextCursor || payload.next_cursor),
    events: normalized.events,
    moreAvailable: Boolean(payload.moreAvailable ?? payload.hasMore ?? payload.has_more ?? payload.nextCursor ?? payload.next_cursor),
    status: "ok",
    message: safeString(payload.message) || "Wallet history page loaded from a Worker-side generic adapter.",
    metadata: {
      provider_configured: true,
      provider_candidates: WALLET_HISTORY_PROVIDER_CANDIDATES,
      source: "generic_wallet_history",
      limit: query.limit,
      count: normalized.events.length,
      skipped_unsafe_items: normalized.skipped,
      provider_fetch_performed: true,
    },
  });
}

function normalizeGenericHistoryEvents(payload, options) {
  const items = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload.transactions)
      ? payload.transactions
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
      provider_status: options.statusCode || null,
      provider_fetch_performed: true,
    },
  });
}

function normalizeWalletHistoryResponse(page) {
  const events = Array.isArray(page.events)
    ? page.events
    : Array.isArray(page.transactions)
      ? page.transactions
      : [];

  return {
    wallet: safeString(page.wallet) || "",
    provider: safeString(page.provider) || "none",
    cursor: page.cursor ?? null,
    nextCursor: page.nextCursor ?? null,
    events,
    moreAvailable: Boolean(page.moreAvailable && page.nextCursor),
    status: safeString(page.status) || "ok",
    message: safeString(page.message) || "",
    metadata: {
      sanitized: true,
      production_meaning: false,
      live_blockchain_fetching: false,
      browser_provider_calls: false,
      provider_secret_exposed: false,
      raw_provider_payload_exposed: false,
      endpoint_contract: "/api/crypto/wallet-history",
      ...(page.metadata || {}),
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
