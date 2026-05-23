"use strict";

const crypto = require("crypto");

const MAX_TTL_SECONDS = 120;
const DEFAULT_TTL_SECONDS = 30;
const cacheStore = new Map();

const UNSAFE_CACHE_KEY_PATTERNS = [
  /^authorization$/i,
  /^headers$/i,
  /^request_headers$/i,
  /^request_url$/i,
  /^provider_url$/i,
  /^keyed_url$/i,
  /api[_-]?key/i,
  /bearer[_-]?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /^secret$/i,
  /^raw$/i,
  /^raw_payload$/i,
  /^provider_payload$/i,
];

function normalizeTtlSeconds(value, fallback = DEFAULT_TTL_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_TTL_SECONDS, Math.floor(parsed)));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function getCacheKey(namespace, parts = {}) {
  return `${String(namespace || "crypto").trim()}:${stableStringify(parts || {})}`;
}

function getCacheId(namespace, parts = {}) {
  const digest = crypto.createHash("sha256").update(getCacheKey(namespace, parts)).digest("hex").slice(0, 16);
  return `cp_cache_${digest}`;
}

function cloneCacheValue(value) {
  return JSON.parse(JSON.stringify(value, (key, child) => {
    if (UNSAFE_CACHE_KEY_PATTERNS.some((pattern) => pattern.test(key))) return undefined;
    return child;
  }));
}

function metadataFor(namespace, parts, status, ttlSeconds, extra = {}) {
  const expiresAt = extra.expiresAt || 0;
  const now = Date.now();
  return {
    cache_id: getCacheId(namespace, parts),
    cache_namespace: String(namespace || "crypto"),
    cache_status: status,
    cache_hit: status === "hit",
    cache_ttl_seconds: ttlSeconds,
    cache_storage: "memory_best_effort",
    cache_persisted: false,
    cache_raw_provider_payloads_stored: false,
    cache_provider_keys_stored: false,
    cache_request_headers_stored: false,
    cache_request_urls_stored: false,
    cache_expires_in_seconds: expiresAt > now ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null,
  };
}

function getCache(namespace, parts = {}, options = {}) {
  const ttlSeconds = normalizeTtlSeconds(options.ttlSeconds);
  const key = getCacheKey(namespace, parts);
  const cached = cacheStore.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) cacheStore.delete(key);
    return {
      hit: false,
      value: null,
      metadata: metadataFor(namespace, parts, "miss", ttlSeconds),
    };
  }
  return {
    hit: true,
    value: cloneCacheValue(cached.value),
    metadata: metadataFor(namespace, parts, "hit", cached.ttlSeconds, { expiresAt: cached.expiresAt }),
  };
}

function setCache(namespace, parts = {}, value, options = {}) {
  const ttlSeconds = normalizeTtlSeconds(options.ttlSeconds);
  const key = getCacheKey(namespace, parts);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  cacheStore.set(key, {
    value: cloneCacheValue(value),
    expiresAt,
    ttlSeconds,
  });
  pruneExpiredCache();
  return metadataFor(namespace, parts, "stored", ttlSeconds, { expiresAt });
}

function getOrSetCache(namespace, parts = {}, options = {}, loader) {
  const cached = getCache(namespace, parts, options);
  if (cached.hit || typeof loader !== "function") return Promise.resolve(cached);
  return Promise.resolve(loader(cached.metadata)).then((value) => {
    const stored = setCache(namespace, parts, value, options);
    return {
      hit: false,
      value: cloneCacheValue(value),
      metadata: {
        ...stored,
        cache_status: "miss",
        cache_hit: false,
      },
    };
  });
}

function pruneExpiredCache() {
  const now = Date.now();
  for (const [key, value] of cacheStore.entries()) {
    if (!value || value.expiresAt <= now) cacheStore.delete(key);
  }
}

function getCacheDiagnostics() {
  pruneExpiredCache();
  return {
    cache_storage: "memory_best_effort",
    cache_persisted: false,
    cache_entries: cacheStore.size,
    cache_max_ttl_seconds: MAX_TTL_SECONDS,
    cache_raw_provider_payloads_stored: false,
    cache_provider_keys_stored: false,
    cache_request_headers_stored: false,
    cache_request_urls_stored: false,
  };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  getCache,
  getCacheDiagnostics,
  getCacheId,
  getOrSetCache,
  normalizeTtlSeconds,
  setCache,
};
