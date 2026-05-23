"use strict";

const HELIUS_API_KEY_ENV = "HELIUS_API_KEY";
const HELIUS_RPC_ENDPOINT = "https://mainnet.helius-rpc.com/";
const HELIUS_METHOD = "getTransactionsForAddress";
const HELIUS_TRANSACTION_DETAILS = "full";
const HELIUS_SORT_ORDER = "desc";
const HELIUS_COMMITMENT = "finalized";
const HELIUS_TOKEN_ACCOUNTS = "balanceChanged";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const PROVIDER_LIMIT = 1000;
const DEFAULT_MAX_PAGE_CAP = 25;
const REQUEST_TIMEOUT_MS = 12000;
const SOLANA_WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_CURSOR_PATTERN = /^[A-Za-z0-9:._-]{1,220}$/;
const MAX_ACCOUNT_KEYS = 160;
const MAX_INSTRUCTIONS = 180;

function getProviderConfig(env = process.env) {
  const configured = Boolean(safeString(env[HELIUS_API_KEY_ENV]));
  return {
    id: "helius",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    provider_family: "solana_indexer",
    configured,
    env_var: HELIUS_API_KEY_ENV,
    missing_env_vars: configured ? [] : [HELIUS_API_KEY_ENV],
    capabilities: getProviderCapabilities(),
  };
}

function getProviderCapabilities() {
  return {
    label: "Helius getTransactionsForAddress",
    supportsPagination: true,
    supports_cursor: true,
    cursor_model: "paginationToken",
    backendOnly: true,
    browserProviderCalls: false,
    apiKeyExposure: false,
    rawProviderPayloadExposure: false,
    transaction_details: HELIUS_TRANSACTION_DETAILS,
    sort_order: HELIUS_SORT_ORDER,
    token_accounts: HELIUS_TOKEN_ACCOUNTS,
    page_limit_default: DEFAULT_LIMIT,
    page_limit_max: MAX_LIMIT,
    provider_documented_limit: PROVIDER_LIMIT,
    max_pages_per_scan: DEFAULT_MAX_PAGE_CAP,
    completeness_claim_allowed: false,
  };
}

function normalizeLimit(value, options = {}) {
  const fallback = normalizePositiveInteger(options.defaultLimit, DEFAULT_LIMIT);
  const max = normalizePositiveInteger(options.maxLimit, MAX_LIMIT);
  const parsed = normalizePositiveInteger(value, fallback);
  return Math.max(1, Math.min(max, parsed));
}

function normalizeMaxPageCap(value) {
  return Math.max(1, Math.min(DEFAULT_MAX_PAGE_CAP, normalizePositiveInteger(value, DEFAULT_MAX_PAGE_CAP)));
}

function normalizeLoadedPages(value) {
  return Math.max(0, Math.min(100000, normalizePositiveInteger(value, 0)));
}

function normalizeCursor(value) {
  const cursor = safeString(value);
  if (!cursor) return null;
  return SAFE_CURSOR_PATTERN.test(cursor) ? cursor : null;
}

function isValidWallet(value) {
  return SOLANA_WALLET_PATTERN.test(String(value || "").trim());
}

function parseRetryAfterSeconds(value) {
  const text = safeString(value);
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  }
  return null;
}

function buildHeliusWalletHistoryRequest({ wallet, limit, cursor, apiKey }) {
  const providerUrl = new URL(HELIUS_RPC_ENDPOINT);
  providerUrl.searchParams.set("api-key", apiKey);
  const config = {
    transactionDetails: HELIUS_TRANSACTION_DETAILS,
    sortOrder: HELIUS_SORT_ORDER,
    commitment: HELIUS_COMMITMENT,
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
    limit,
    filters: {
      tokenAccounts: HELIUS_TOKEN_ACCOUNTS,
      status: "any",
    },
  };
  if (cursor) config.paginationToken = cursor;
  return {
    url: providerUrl,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "cryptophotonic-wallet-history",
        method: HELIUS_METHOD,
        params: [wallet, config],
      }),
    },
    publicMetadata: {
      provider: "helius",
      provider_label: "Helius getTransactionsForAddress",
      provider_family: "solana_indexer",
      provider_method: HELIUS_METHOD,
      transaction_details: HELIUS_TRANSACTION_DETAILS,
      sort_order: HELIUS_SORT_ORDER,
      token_accounts: HELIUS_TOKEN_ACCOUNTS,
      request_url_included: false,
      request_headers_included: false,
      provider_key_included: false,
    },
  };
}

async function fetchWalletHistoryPage(query = {}, env = process.env) {
  const providerConfig = getProviderConfig(env);
  const wallet = safeString(query.wallet);
  const limit = normalizeLimit(query.limit);
  const cursor = normalizeCursor(query.cursor);
  const loadedPages = normalizeLoadedPages(query.loadedPages);
  const maxPageCap = normalizeMaxPageCap(query.maxPageCap);
  const now = new Date().toISOString();

  if (!wallet || !isValidWallet(wallet)) {
    return emptyProviderPage({
      status: "invalid_wallet",
      message: wallet ? "Wallet query parameter is not a valid Solana address." : "Wallet query parameter is required.",
      wallet,
      limit,
      cursor,
      configured: providerConfig.configured,
      fetchedAt: now,
    });
  }

  if (!providerConfig.configured) {
    return emptyProviderPage({
      status: "provider_unavailable",
      message: "Helius provider is not configured. Set HELIUS_API_KEY in the server environment.",
      wallet,
      limit,
      cursor,
      configured: false,
      fetchedAt: now,
      providerUnavailable: true,
    });
  }

  if (loadedPages >= maxPageCap) {
    return emptyProviderPage({
      status: "provider_limited",
      message: "Server page cap reached before another provider request was made.",
      wallet,
      limit,
      cursor,
      configured: true,
      fetchedAt: now,
      providerLimited: true,
      providerLimitReason: "max_page_cap",
      maxPageCap,
      loadedPages,
    });
  }

  const apiKey = safeString(env[HELIUS_API_KEY_ENV]);
  const request = buildHeliusWalletHistoryRequest({ wallet, limit, cursor, apiKey });
  const started = Date.now();
  let response;
  let payload;

  try {
    response = await fetchWithTimeout(request.url, request.init, REQUEST_TIMEOUT_MS);
    payload = await response.json().catch(() => null);
  } catch (error) {
    return emptyProviderPage({
      status: "provider_unavailable",
      message: "Provider request failed before a sanitized page could be produced.",
      wallet,
      limit,
      cursor,
      configured: true,
      fetchedAt: now,
      providerUnavailable: true,
      providerErrorClass: "fetch_failed",
      elapsedMs: Date.now() - started,
    });
  }

  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  if (response.status === 429) {
    return emptyProviderPage({
      status: "provider_rate_limited",
      message: "Provider rate limit reached. No raw provider payload was returned.",
      wallet,
      limit,
      cursor,
      configured: true,
      fetchedAt: now,
      rateLimited: true,
      retryAfterSeconds,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
    });
  }

  if (!response.ok) {
    return emptyProviderPage({
      status: "provider_unavailable",
      message: "Provider returned a non-success status. No raw provider payload was returned.",
      wallet,
      limit,
      cursor,
      configured: true,
      fetchedAt: now,
      providerUnavailable: true,
      httpStatus: response.status,
      elapsedMs: Date.now() - started,
    });
  }

  if (payload && payload.error) {
    return emptyProviderPage({
      status: "provider_unavailable",
      message: "Provider returned an error object. No raw provider payload was returned.",
      wallet,
      limit,
      cursor,
      configured: true,
      fetchedAt: now,
      providerUnavailable: true,
      providerErrorCode: sanitizeErrorCode(payload.error.code),
      elapsedMs: Date.now() - started,
    });
  }

  const result = payload && typeof payload === "object" ? payload.result : null;
  const providerTransactions = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result)
      ? result
      : [];
  const sanitizedTransactions = providerTransactions.slice(0, limit).map((transaction, index) => sanitizeProviderTransaction(transaction, index));
  const nextCursor = normalizeCursor(result?.paginationToken || result?.nextCursor || result?.next_cursor);
  const cursorExhausted = !nextCursor;

  return {
    status: "ok",
    message: sanitizedTransactions.length
      ? "Sanitized provider page returned."
      : "Provider returned zero transactions for this bounded page.",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    wallet,
    cursor,
    current_cursor: cursor,
    next_cursor: nextCursor,
    more_available: Boolean(nextCursor),
    cursor_exhausted: cursorExhausted,
    transactions: sanitizedTransactions,
    provider_page_count: providerTransactions.length,
    returned_count: sanitizedTransactions.length,
    requested_limit: limit,
    fetched_at: now,
    metadata: {
      ...providerConfig,
      ...request.publicMetadata,
      provider_configured: true,
      provider_unavailable: false,
      rate_limited: false,
      retry_after_seconds: null,
      provider_limited: providerTransactions.length > limit,
      provider_limit_reached: false,
      provider_limit_reason: providerTransactions.length > limit ? "runtime_limit_clamp" : "",
      loaded_pages: loadedPages,
      max_page_cap: maxPageCap,
      requested_limit: limit,
      provider_documented_limit: PROVIDER_LIMIT,
      runtime_max_limit: MAX_LIMIT,
      returned_count: sanitizedTransactions.length,
      provider_page_count: providerTransactions.length,
      next_cursor: nextCursor,
      cursor_exhausted: cursorExhausted,
      more_available: Boolean(nextCursor),
      full_history_loaded: false,
      full_history_claim_allowed: false,
      fetched_at: now,
      provider_elapsed_ms: Date.now() - started,
      browser_provider_calls: false,
      provider_keys_included: false,
      raw_provider_payloads_included: false,
    },
  };
}

function emptyProviderPage(options = {}) {
  const providerConfig = getProviderConfig();
  const status = options.status || "provider_unavailable";
  const rateLimited = Boolean(options.rateLimited);
  const providerLimited = Boolean(options.providerLimited);
  return {
    status,
    message: options.message || "Provider page unavailable.",
    provider: "helius",
    provider_label: "Helius getTransactionsForAddress",
    wallet: options.wallet || "",
    cursor: options.cursor ?? null,
    current_cursor: options.cursor ?? null,
    next_cursor: null,
    more_available: false,
    cursor_exhausted: false,
    transactions: [],
    provider_page_count: 0,
    returned_count: 0,
    requested_limit: options.limit || DEFAULT_LIMIT,
    fetched_at: options.fetchedAt || new Date().toISOString(),
    metadata: {
      ...providerConfig,
      provider_configured: Boolean(options.configured),
      provider_unavailable: Boolean(options.providerUnavailable || !options.configured),
      rate_limited: rateLimited,
      retry_after_seconds: options.retryAfterSeconds ?? null,
      provider_limited: providerLimited,
      provider_limit_reached: providerLimited,
      provider_limit_reason: options.providerLimitReason || "",
      loaded_pages: options.loadedPages || 0,
      max_page_cap: options.maxPageCap || DEFAULT_MAX_PAGE_CAP,
      requested_limit: options.limit || DEFAULT_LIMIT,
      provider_documented_limit: PROVIDER_LIMIT,
      runtime_max_limit: MAX_LIMIT,
      returned_count: 0,
      provider_page_count: 0,
      next_cursor: null,
      cursor_exhausted: false,
      more_available: false,
      full_history_loaded: false,
      full_history_claim_allowed: false,
      fetched_at: options.fetchedAt || new Date().toISOString(),
      provider_http_status: options.httpStatus || null,
      provider_error_class: options.providerErrorClass || "",
      provider_error_code: options.providerErrorCode || null,
      provider_elapsed_ms: options.elapsedMs || 0,
      browser_provider_calls: false,
      provider_keys_included: false,
      raw_provider_payloads_included: false,
    },
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeProviderTransaction(input, index = 0) {
  const transaction = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawTransaction = transaction.transaction && typeof transaction.transaction === "object" ? transaction.transaction : {};
  const message = rawTransaction.message && typeof rawTransaction.message === "object" ? rawTransaction.message : {};
  const meta = transaction.meta && typeof transaction.meta === "object" ? transaction.meta : {};
  const accountKeys = sanitizeAccountKeys(message.accountKeys || transaction.accountKeys);
  return {
    provider_record_index: index,
    provider: "helius",
    adapter_family: "helius_getTransactionsForAddress",
    signature: safeString(transaction.signature || rawTransaction.signatures?.[0]),
    slot: safeInteger(transaction.slot),
    blockTime: safeInteger(transaction.blockTime),
    timestamp: timestampFromBlockTime(transaction.blockTime),
    type: safeString(transaction.type || transaction.transactionType),
    source: safeString(transaction.source),
    fee: safeInteger(transaction.fee ?? meta.fee),
    err: Boolean(transaction.err || meta.err),
    accountKeys,
    nativeTransfers: sanitizeNativeTransfers(transaction.nativeTransfers),
    tokenTransfers: sanitizeTokenTransfers(transaction.tokenTransfers),
    instructions: sanitizeInstructions(message.instructions || transaction.instructions, accountKeys),
    innerInstructions: sanitizeInnerInstructions(meta.innerInstructions, accountKeys),
    preBalances: sanitizeNumberList(meta.preBalances),
    postBalances: sanitizeNumberList(meta.postBalances),
    preTokenBalances: sanitizeTokenBalances(meta.preTokenBalances, accountKeys),
    postTokenBalances: sanitizeTokenBalances(meta.postTokenBalances, accountKeys),
    raw_reference: {
      provider: "helius",
      provider_record_index: index,
      adapter_family: "helius_getTransactionsForAddress",
      raw_payload_stored: false,
      request_url_stored: false,
      request_headers_stored: false,
      provider_key_stored: false,
    },
  };
}

function sanitizeNativeTransfers(value) {
  return asObjectList(value, 80).map((transfer, index) => ({
    provider_transfer_index: index,
    fromUserAccount: safeString(transfer.fromUserAccount || transfer.fromUser || transfer.from),
    toUserAccount: safeString(transfer.toUserAccount || transfer.toUser || transfer.to),
    amount: safeString(transfer.amount),
  })).filter((transfer) => transfer.fromUserAccount || transfer.toUserAccount || transfer.amount);
}

function sanitizeTokenTransfers(value) {
  return asObjectList(value, 120).map((transfer, index) => ({
    provider_transfer_index: index,
    fromUserAccount: safeString(transfer.fromUserAccount || transfer.fromUser || transfer.from),
    toUserAccount: safeString(transfer.toUserAccount || transfer.toUser || transfer.to),
    fromTokenAccount: safeString(transfer.fromTokenAccount || transfer.source),
    toTokenAccount: safeString(transfer.toTokenAccount || transfer.destination),
    mint: safeString(transfer.mint || transfer.tokenMint),
    tokenAmount: safeString(transfer.tokenAmount ?? transfer.amount),
    rawTokenAmount: safeString(transfer.rawTokenAmount || transfer.rawAmount),
    decimals: safeInteger(transfer.decimals),
    tokenStandard: safeString(transfer.tokenStandard),
  })).filter((transfer) => transfer.fromUserAccount || transfer.toUserAccount || transfer.fromTokenAccount || transfer.toTokenAccount || transfer.mint || transfer.tokenAmount);
}

function sanitizeInstructions(value, accountKeys = []) {
  return asObjectList(value, MAX_INSTRUCTIONS).map((instruction, index) => sanitizeInstruction(instruction, index, accountKeys)).filter(Boolean);
}

function sanitizeInnerInstructions(value, accountKeys = []) {
  return asObjectList(value, 80).map((group) => ({
    index: safeInteger(group.index),
    instructions: sanitizeInstructions(group.instructions, accountKeys),
  })).filter((group) => group.instructions.length);
}

function sanitizeInstruction(instruction, index, accountKeys = []) {
  if (!instruction || typeof instruction !== "object" || Array.isArray(instruction)) return null;
  const parsed = instruction.parsed && typeof instruction.parsed === "object" ? instruction.parsed : {};
  const info = parsed.info && typeof parsed.info === "object" ? parsed.info : {};
  const accounts = Array.isArray(instruction.accounts)
    ? instruction.accounts.map((account) => accountKeyValue(account, accountKeys)).filter(Boolean).slice(0, 32)
    : [];
  return {
    provider_instruction_index: index,
    program: safeString(instruction.program),
    programId: safeString(instruction.programId),
    type: safeString(parsed.type || instruction.type),
    accounts,
    info: {
      source: safeString(info.source),
      destination: safeString(info.destination),
      authority: safeString(info.authority),
      mint: safeString(info.mint),
      amount: safeString(info.amount),
      lamports: safeString(info.lamports),
      tokenAmount: sanitizeTokenAmount(info.tokenAmount),
    },
  };
}

function sanitizeAccountKeys(value) {
  return asList(value, MAX_ACCOUNT_KEYS)
    .map((account) => accountKeyValue(account))
    .filter(Boolean);
}

function accountKeyValue(account, accountKeys = []) {
  if (typeof account === "number") return safeString(accountKeys[account]);
  if (typeof account === "string") return safeString(account);
  if (account && typeof account === "object") {
    return safeString(account.pubkey || account.account || account.address);
  }
  return "";
}

function sanitizeNumberList(value) {
  return asList(value, MAX_ACCOUNT_KEYS).map((item) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : null;
  });
}

function sanitizeTokenBalances(value, accountKeys = []) {
  return asObjectList(value, MAX_ACCOUNT_KEYS).map((balance) => ({
    accountIndex: safeInteger(balance.accountIndex),
    account: accountKeyValue(balance.accountIndex, accountKeys),
    mint: safeString(balance.mint),
    owner: safeString(balance.owner),
    programId: safeString(balance.programId),
    uiTokenAmount: sanitizeTokenAmount(balance.uiTokenAmount),
  })).filter((balance) => balance.mint || balance.account || balance.owner);
}

function sanitizeTokenAmount(value) {
  const amount = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    amount: safeString(amount.amount),
    decimals: safeInteger(amount.decimals),
    uiAmountString: safeString(amount.uiAmountString),
    uiAmount: Number.isFinite(Number(amount.uiAmount)) ? Number(amount.uiAmount) : null,
  };
}

function asList(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function asObjectList(value, limit) {
  return asList(value, limit).filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function safeString(value, limit = 256) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.slice(0, limit);
}

function safeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function timestampFromBlockTime(value) {
  const blockTime = Number(value);
  if (!Number.isFinite(blockTime) || blockTime <= 0) return "";
  return new Date(blockTime * 1000).toISOString();
}

function sanitizeErrorCode(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return safeString(value, 64) || null;
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_MAX_PAGE_CAP,
  HELIUS_API_KEY_ENV,
  MAX_LIMIT,
  PROVIDER_LIMIT,
  fetchWalletHistoryPage,
  getProviderCapabilities,
  getProviderConfig,
  isValidWallet,
  normalizeCursor,
  normalizeLimit,
  parseRetryAfterSeconds,
};
