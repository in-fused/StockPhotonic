import {
  normalizeEvent,
  UnsafeEventInputError,
  InvalidEventInputError,
} from "./sanitize.js";
import { createRuntimeStorage } from "./storage.js";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 100;
const MAX_TEST_EVENT_BATCH = 10;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
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

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new InvalidEventInputError("Content-Type must be application/json.");
  }

  try {
    return await request.json();
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
