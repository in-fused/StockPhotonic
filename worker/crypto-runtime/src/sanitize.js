const UNSAFE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /^authorization$/i,
  /^headers$/i,
  /request[_-]?headers/i,
  /^cookie$/i,
  /^cookies$/i,
  /bearer[_-]?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /secret/i,
  /private[_-]?key/i,
  /signing[_-]?key/i,
  /seed[_-]?phrase/i,
  /^mnemonic$/i,
  /^raw$/i,
  /raw[_-]?payload/i,
  /provider[_-]?payload/i,
  /^helius$/i,
  /^jupiter$/i,
  /rpc[_-]?url/i,
  /provider[_-]?url/i,
];

const UNSAFE_VALUE_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/i,
  /[?&](api-key|api_key|apikey|key|token)=/i,
  /x-api-key/i,
  /helius.*[?&](api-key|api_key|apikey|key|token)=/i,
  /jupiter.*[?&](api-key|api_key|apikey|key|token)=/i,
  /https?:\/\/[^/\s]*(helius|quicknode|alchemy|triton|rpcpool)[^\s]*/i,
];

const MAX_LIST_ITEMS = 32;

export class UnsafeEventInputError extends Error {
  constructor(issues) {
    super("Event input contains unsafe provider, secret, header, or raw payload fields.");
    this.name = "UnsafeEventInputError";
    this.issues = issues;
  }
}

export class InvalidEventInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEventInputError";
  }
}

export function findUnsafeFields(value, path = "$", issues = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUnsafeFields(item, `${path}[${index}]`, issues));
    return issues;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      const childPath = `${path}.${key}`;
      if (UNSAFE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        issues.push({
          path: childPath,
          reason: "unsafe_key",
        });
      }
      findUnsafeFields(child, childPath, issues);
    });
    return issues;
  }

  if (typeof value === "string" && UNSAFE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    issues.push({
      path,
      reason: "unsafe_value",
    });
  }

  return issues;
}

export function sanitizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidEventInputError("Event payload must be a JSON object.");
  }

  const unsafeFields = findUnsafeFields(input);
  if (unsafeFields.length > 0) {
    throw new UnsafeEventInputError(unsafeFields);
  }

  const event = {
    id: sanitizeString(input.id) || deriveEventId(input),
    chain: sanitizeString(input.chain) || "unknown",
    signature: sanitizeString(input.signature) || null,
    timestamp: sanitizeTimestamp(input.timestamp),
    transaction_type: sanitizeString(input.transaction_type) || "unknown",
    source: sanitizeString(input.source) || "local-test-event",
    wallets: sanitizeWallets(input.wallets),
    tokens: sanitizeTokens(input.tokens),
    transfers: sanitizeTransfers(input.transfers),
    metadata: {
      sanitized: true,
      production_meaning: false,
      live_blockchain_fetching: false,
    },
  };

  if (input.metadata && typeof input.metadata === "object" && input.metadata.fixture === true) {
    event.metadata.fixture = true;
  }

  return event;
}

export function sanitizeEvents(input) {
  if (!Array.isArray(input)) {
    throw new InvalidEventInputError("Events payload must be an array.");
  }

  return input.map((event) => sanitizeEvent(event));
}

function sanitizeWallets(wallets) {
  return sanitizeObjectList(wallets).map((wallet) => ({
    address: sanitizeString(wallet.address),
    role: sanitizeString(wallet.role) || "unknown",
  })).filter((wallet) => wallet.address);
}

function sanitizeTokens(tokens) {
  return sanitizeObjectList(tokens).map((token) => ({
    symbol: sanitizeString(token.symbol),
    mint: sanitizeString(token.mint),
    decimals: sanitizeInteger(token.decimals),
  })).filter((token) => token.symbol || token.mint);
}

function sanitizeTransfers(transfers) {
  return sanitizeObjectList(transfers).map((transfer) => ({
    token_symbol: sanitizeString(transfer.token_symbol || transfer.symbol),
    amount: sanitizeString(transfer.amount),
    from: sanitizeString(transfer.from),
    to: sanitizeString(transfer.to),
  })).filter((transfer) => transfer.amount || transfer.from || transfer.to || transfer.token_symbol);
}

function sanitizeObjectList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, MAX_LIST_ITEMS);
}

function sanitizeString(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 256);
}

function sanitizeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 18) {
    return null;
  }

  return parsed;
}

function sanitizeTimestamp(value) {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function deriveEventId(input) {
  const signature = sanitizeString(input.signature);
  if (signature) {
    return `event-${signature.slice(0, 64)}`;
  }

  const timestamp = sanitizeTimestamp(input.timestamp);
  const transactionType = sanitizeString(input.transaction_type) || "unknown";
  return `local-${transactionType}-${timestamp}`;
}
