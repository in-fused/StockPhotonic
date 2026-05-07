import { sanitizeEvent, UnsafeEventInputError, InvalidEventInputError } from "./sanitize.js";
import { createRuntimeStorage } from "./storage.js";

const storage = createRuntimeStorage();

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

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
        const events = await storage.listEvents();
        return json({
          events,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/api/crypto/test-event") {
        const payload = await readJson(request);
        const sanitized = sanitizeEvent(payload);
        const result = await storage.addEvent(sanitized);

        return json({
          event: result.event,
          stored: result.stored,
          duplicate: result.duplicate,
          metadata: {
            sanitized: true,
            production_meaning: false,
            live_blockchain_fetching: false,
          },
        }, result.duplicate ? 200 : 201);
      }

      return json({
        error: "not_found",
      }, 404);
    } catch (error) {
      return handleError(error);
    }
  },
};

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
