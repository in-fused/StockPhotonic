import { FIXTURE_EVENTS } from "./fixtures.js";
import { sanitizeEvent, sanitizeEvents } from "./sanitize.js";

const memoryEvents = [];

export function createRuntimeStorage() {
  // Production persistence belongs behind Cloudflare KV, D1, Queue, or Durable Object bindings.
  // This MVP intentionally keeps only in-memory demo events plus fixture fallback.
  return {
    async listEvents() {
      if (memoryEvents.length > 0) {
        return memoryEvents.map((event) => ({ ...event }));
      }

      return sanitizeEvents(FIXTURE_EVENTS);
    },

    async addEvent(event) {
      const sanitized = sanitizeEvent(event);
      const existing = dedupeEvent(sanitized);

      if (existing) {
        return {
          event: existing,
          stored: false,
          duplicate: true,
        };
      }

      memoryEvents.unshift(sanitized);
      return {
        event: sanitized,
        stored: true,
        duplicate: false,
      };
    },

    async dedupeEvent(event) {
      return dedupeEvent(event);
    },

    async getRuntimeStatus() {
      return {
        status: "ok",
        runtime: "cryptophotonic-cloudflare-worker",
        mode: "secure-runtime-mvp",
        storage: "in-memory-fixture-fallback",
        persistence: "not_configured",
        planned_bindings: ["KV", "D1", "Queue", "Durable Object"],
        live_provider_fetching: false,
      };
    },
  };
}

function dedupeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return memoryEvents.find((stored) => {
    if (event.id && stored.id === event.id) {
      return true;
    }

    return Boolean(event.signature && stored.signature === event.signature);
  }) || null;
}
