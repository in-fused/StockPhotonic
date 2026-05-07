import { FIXTURE_EVENTS } from "./fixtures.js";
import { normalizeEvent, normalizeEvents } from "./sanitize.js";

const memoryEvents = [];
const KV_INDEX_KEY = "crypto-events:index";
const KV_EVENT_PREFIX = "crypto-events:event:";
const MAX_KV_INDEX_EVENTS = 500;

export function createRuntimeStorage(env = {}) {
  if (env.CRYPTO_EVENTS_KV) {
    return createKvStorage(env.CRYPTO_EVENTS_KV);
  }

  if (env.CRYPTO_EVENTS_D1) {
    return createD1StubStorage();
  }

  return createMemoryStorage("in-memory-fixture-fallback");
}

function createMemoryStorage(storageMode) {
  return {
    async listEvents() {
      if (memoryEvents.length > 0) {
        return cloneEvents(memoryEvents);
      }

      return normalizeEvents(FIXTURE_EVENTS, {
        ingestionSource: "fixture_fallback",
      });
    },

    async addEvent(event) {
      const normalized = normalizeEvent(event, {
        ingestionSource: event.ingestion_source || "local_test_event",
        receivedAt: event.received_at,
      });
      const existing = dedupeMemoryEvent(normalized);

      if (existing) {
        return {
          event: cloneEvent(existing),
          stored: false,
          duplicate: true,
        };
      }

      memoryEvents.unshift(normalized);
      return {
        event: cloneEvent(normalized),
        stored: true,
        duplicate: false,
      };
    },

    async dedupeEvent(event) {
      const normalized = normalizeEvent(event, {
        ingestionSource: event.ingestion_source || "local_test_event",
        receivedAt: event.received_at,
      });
      const existing = dedupeMemoryEvent(normalized);
      return existing ? cloneEvent(existing) : null;
    },

    async clearEvents() {
      const cleared = memoryEvents.length;
      memoryEvents.length = 0;
      return {
        cleared,
      };
    },

    async getRuntimeStatus() {
      return {
        status: "ok",
        runtime: "cryptophotonic-cloudflare-worker",
        mode: "secure-runtime-feed-contract",
        storage: storageMode,
        persistence: "memory_only",
        configured_bindings: [],
        planned_bindings: ["CRYPTO_EVENTS_KV", "CRYPTO_EVENTS_D1", "Queue", "Durable Object"],
        live_provider_fetching: false,
      };
    },
  };
}

function createKvStorage(kv) {
  return {
    async listEvents() {
      const index = await readKvIndex(kv);
      if (index.length === 0) {
        return [];
      }

      const events = await Promise.all(index.map(async (dedupeKey) => {
        const stored = await kv.get(kvEventKey(dedupeKey), "json");
        if (!stored) {
          return null;
        }

        return normalizeEvent(stored, {
          ingestionSource: stored.ingestion_source || "local_test_event",
          receivedAt: stored.received_at,
        });
      }));

      return events.filter(Boolean);
    },

    async addEvent(event) {
      const normalized = normalizeEvent(event, {
        ingestionSource: event.ingestion_source || "local_test_event",
        receivedAt: event.received_at,
      });
      const existing = await kv.get(kvEventKey(normalized.dedupe_key), "json");

      if (existing) {
        return {
          event: normalizeEvent(existing, {
            ingestionSource: existing.ingestion_source || "local_test_event",
            receivedAt: existing.received_at,
          }),
          stored: false,
          duplicate: true,
        };
      }

      await kv.put(kvEventKey(normalized.dedupe_key), JSON.stringify(normalized));
      await prependKvIndex(kv, normalized.dedupe_key);

      return {
        event: normalized,
        stored: true,
        duplicate: false,
      };
    },

    async dedupeEvent(event) {
      const normalized = normalizeEvent(event, {
        ingestionSource: event.ingestion_source || "local_test_event",
        receivedAt: event.received_at,
      });
      const existing = await kv.get(kvEventKey(normalized.dedupe_key), "json");

      return existing ? normalizeEvent(existing, {
        ingestionSource: existing.ingestion_source || "local_test_event",
        receivedAt: existing.received_at,
      }) : null;
    },

    async clearEvents() {
      const index = await readKvIndex(kv);
      await Promise.all(index.map((dedupeKey) => kv.delete(kvEventKey(dedupeKey))));
      await kv.delete(KV_INDEX_KEY);

      return {
        cleared: index.length,
      };
    },

    async getRuntimeStatus() {
      return {
        status: "ok",
        runtime: "cryptophotonic-cloudflare-worker",
        mode: "secure-runtime-feed-contract",
        storage: "cloudflare-kv",
        persistence: "kv_configured",
        configured_bindings: ["CRYPTO_EVENTS_KV"],
        planned_bindings: ["CRYPTO_EVENTS_D1", "Queue", "Durable Object"],
        live_provider_fetching: false,
      };
    },
  };
}

function createD1StubStorage() {
  const fallback = createMemoryStorage("cloudflare-d1-stub-memory-fallback");

  return {
    ...fallback,
    async getRuntimeStatus() {
      return {
        status: "ok",
        runtime: "cryptophotonic-cloudflare-worker",
        mode: "secure-runtime-feed-contract",
        storage: "cloudflare-d1-stub-memory-fallback",
        persistence: "d1_binding_present_table_not_implemented",
        configured_bindings: ["CRYPTO_EVENTS_D1"],
        planned_bindings: ["CRYPTO_EVENTS_KV", "D1 events table", "Queue", "Durable Object"],
        live_provider_fetching: false,
      };
    },
  };
}

async function readKvIndex(kv) {
  const index = await kv.get(KV_INDEX_KEY, "json");
  if (!Array.isArray(index)) {
    return [];
  }

  return index.filter((key) => typeof key === "string" && key.length > 0).slice(0, MAX_KV_INDEX_EVENTS);
}

async function prependKvIndex(kv, dedupeKey) {
  const index = await readKvIndex(kv);
  const nextIndex = [dedupeKey, ...index.filter((key) => key !== dedupeKey)].slice(0, MAX_KV_INDEX_EVENTS);
  await kv.put(KV_INDEX_KEY, JSON.stringify(nextIndex));
}

function kvEventKey(dedupeKey) {
  return `${KV_EVENT_PREFIX}${dedupeKey}`;
}

function dedupeMemoryEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return memoryEvents.find((stored) => {
    if (event.dedupe_key && stored.dedupe_key === event.dedupe_key) {
      return true;
    }

    if (event.id && stored.id === event.id) {
      return true;
    }

    return Boolean(event.signature && stored.signature === event.signature);
  }) || null;
}

function cloneEvent(event) {
  return JSON.parse(JSON.stringify(event));
}

function cloneEvents(events) {
  return events.map((event) => cloneEvent(event));
}
