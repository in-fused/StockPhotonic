import {
  normalizeEvent,
  UnsafeEventInputError,
  InvalidEventInputError,
} from "./sanitize.js";
import { createRuntimeStorage } from "./storage.js";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 100;
const MAX_TEST_EVENT_BATCH = 10;
const MAX_HELIUS_WEBHOOK_BATCH = 10;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const HELIUS_ALLOWED_WALLETS = [
  "CryptoPhotonicControlledWallet1111111111111111111",
];

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
  const transactions = getHeliusTransactions(payload);

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

function getHeliusTransactions(payload) {
  let transactions;

  if (Array.isArray(payload)) {
    transactions = payload;
  } else if (payload && typeof payload === "object" && Array.isArray(payload.transactions)) {
    transactions = payload.transactions;
  } else if (payload && typeof payload === "object" && typeof payload.signature === "string") {
    transactions = [payload];
  } else {
    throw new InvalidEventInputError("Helius webhook payload must be an array of transactions or a transaction object.");
  }

  if (transactions.length === 0 || transactions.length > MAX_HELIUS_WEBHOOK_BATCH) {
    throw new InvalidEventInputError(`Helius webhook payload must contain 1 to ${MAX_HELIUS_WEBHOOK_BATCH} transactions.`);
  }

  if (!transactions.every((transaction) => transaction && typeof transaction === "object" && !Array.isArray(transaction))) {
    throw new InvalidEventInputError("Helius webhook transactions must be JSON objects.");
  }

  return transactions;
}

function reduceHeliusTransaction(transaction, index, receivedAt) {
  const signature = safeString(transaction.signature);
  if (!signature) {
    throw new InvalidEventInputError("Helius webhook transaction is missing a signature.");
  }

  const wallets = collectHeliusWallets(transaction);
  if (wallets.length === 0) {
    throw new InvalidEventInputError("Helius webhook transaction has no wallet accounts to scope.");
  }

  return {
    id: `helius-${signature.slice(0, 64)}`,
    chain: "solana",
    signature,
    timestamp: normalizeHeliusTimestamp(transaction.timestamp, receivedAt),
    transaction_type: safeString(transaction.type || transaction.transactionType) || "unknown",
    source: "helius-webhook",
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
