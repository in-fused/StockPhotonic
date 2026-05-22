#!/usr/bin/env python3
"""CryptoPhotonic Worker response contract documentation and validator.

This helper documents the browser-facing Worker boundary for CryptoPhotonic.
It does not deploy, call, or implement a Worker. It validates local JSON files
against the expected response shape and keeps provider access requirements
server-side.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


CONTRACT_VERSION = "d349_worker_contract_v1"
ENDPOINTS = (
    "/api/crypto/wallet-activity",
    "/api/crypto/wallet-history",
    "/api/crypto/events",
    "/api/crypto/provider-diagnostics",
)
BOUNDARY_FIELDS = {
    "browser_provider_calls": False,
    "provider_keys_included": False,
    "raw_provider_payloads_included": False,
}
COMMON_RATE_LIMIT_FIELDS = {
    "rate_limited": False,
    "retry_after_seconds": None,
    "stop_polling": False,
    "poll_after_seconds": None,
}
COMMON_CACHE_FIELDS = {
    "cache_id": None,
    "cache_status": "miss",
    "cache_hit": False,
    "cache_ttl_seconds": None,
}
COMMON_CURSOR_FIELDS = {
    "cursor": None,
    "current_cursor": None,
    "next_cursor": None,
    "more_available": False,
    "cursor_exhausted": False,
}
ERROR_EXAMPLE = {
    "status": "provider_unavailable",
    "message": "Worker could not load provider data. No browser provider call was made.",
    "events": [],
    "transactions": [],
    "metadata": {
        **BOUNDARY_FIELDS,
        "provider_configured": False,
        "provider_unavailable": True,
        "provider_limited": False,
        "rate_limited": False,
        "retry_after_seconds": None,
        "no_data_merged": True,
    },
}


CONTRACTS: dict[str, dict[str, Any]] = {
    "/api/crypto/events": {
        "purpose": "Bounded live event polling for sanitized Worker events only.",
        "required_fields": ["status", "events", "metadata"],
        "optional_fields": ["message", "cursor", "next_cursor", "more_available"],
        "pagination_fields": ["cursor", "next_cursor", "more_available", "cursor_exhausted"],
        "rate_limit_fields": ["rate_limited", "retry_after_seconds", "stop_polling", "poll_after_seconds"],
        "cache_fields": ["cache_id", "cache_status", "cache_hit", "cache_ttl_seconds"],
        "error_state_fields": ["status", "message", "metadata.provider_unavailable", "metadata.no_data_merged"],
        "provider_boundary_fields": list(BOUNDARY_FIELDS),
        "no_browser_provider_call_guarantees": [
            "Browser calls this Worker endpoint only.",
            "Provider keys stay in Worker/server environment variables.",
            "Response must not include provider request headers, bearer tokens, API keys, or raw provider payloads.",
            "Sample, mock, fixture, placeholder, local_test, and dev_test events must not be sent as active graph data.",
        ],
        "example": {
            "status": "ok",
            "message": "Sanitized Worker events returned.",
            "events": [
                {
                    "id": "evt_001",
                    "chain": "solana",
                    "signature": "public_signature",
                    "timestamp": "2026-05-22T12:00:00Z",
                    "ingestion_source": "worker_provider_feed",
                    "wallets": [
                        {"address": "source_wallet", "role": "sender"},
                        {"address": "destination_wallet", "role": "receiver"},
                    ],
                    "tokens": [{"mint": "token_mint", "symbol": "TOKEN", "decimals": 6}],
                    "transfers": [
                        {
                            "from": "source_wallet",
                            "to": "destination_wallet",
                            "token_symbol": "TOKEN",
                            "amount": "1.23",
                        }
                    ],
                    "metadata": {"sample": False, "fixture": False, "mock": False},
                }
            ],
            "metadata": {
                **BOUNDARY_FIELDS,
                **COMMON_RATE_LIMIT_FIELDS,
                **COMMON_CACHE_FIELDS,
                **COMMON_CURSOR_FIELDS,
                "provider_limited": False,
                "provider_unavailable": False,
                "poll_interval_seconds": 15,
                "events_returned": 1,
            },
        },
    },
    "/api/crypto/wallet-activity": {
        "purpose": "One wallet lookup response that replaces the active graph without merging samples or staged history.",
        "required_fields": ["status", "wallet", "events", "metadata"],
        "optional_fields": ["message", "next_cursor", "more_available", "cache_id"],
        "pagination_fields": ["cursor", "current_cursor", "next_cursor", "more_available", "cursor_exhausted"],
        "rate_limit_fields": ["rate_limited", "retry_after_seconds", "provider_limited"],
        "cache_fields": ["cache_id", "cache_status", "cache_hit", "cache_ttl_seconds"],
        "error_state_fields": ["status", "message", "metadata.no_data_merged"],
        "provider_boundary_fields": list(BOUNDARY_FIELDS),
        "no_browser_provider_call_guarantees": [
            "Browser submits only a public wallet address to the Worker.",
            "Worker returns sanitized graph events; browser does not call Solana providers.",
            "Returned wallet addresses are observations only and do not imply identity or ownership.",
            "Zero events must leave the active graph empty.",
        ],
        "example": {
            "status": "ok",
            "wallet": "public_wallet_address",
            "events": [],
            "next_cursor": None,
            "more_available": False,
            "metadata": {
                **BOUNDARY_FIELDS,
                **COMMON_RATE_LIMIT_FIELDS,
                **COMMON_CACHE_FIELDS,
                **COMMON_CURSOR_FIELDS,
                "provider": "helius",
                "provider_label": "Helius Enhanced Transactions",
                "provider_configured": True,
                "provider_limited": False,
                "full_history_loaded": False,
                "full_history_claim_allowed": False,
                "wallet_identity_claimed": False,
            },
        },
    },
    "/api/crypto/wallet-history": {
        "purpose": "Staged wallet-history pagination for review/replay preview only; never merges into active graph.",
        "required_fields": ["status", "wallet", "transactions", "metadata"],
        "optional_fields": ["message", "cursor", "nextCursor", "next_cursor", "moreAvailable", "more_available"],
        "pagination_fields": ["cursor", "current_cursor", "next_cursor", "more_available", "cursor_exhausted", "pages_loaded", "requested_limit", "returned_count"],
        "rate_limit_fields": ["rate_limited", "retry_after_seconds", "provider_limited", "provider_limit_reached"],
        "cache_fields": ["cache_id", "cache_version", "cache_status", "cache_hit", "scan_cache"],
        "error_state_fields": ["status", "message", "metadata.provider_unavailable", "metadata.no_data_merged"],
        "provider_boundary_fields": list(BOUNDARY_FIELDS),
        "no_browser_provider_call_guarantees": [
            "Browser loads staged pages only from the Worker.",
            "Worker controls provider keys, cursors, rate limits, and cache policy.",
            "Staged history is preview/review-only and must not be merged into active Wallet Lookup graph data.",
            "Full-history claims are allowed only when cursor exhaustion occurs without rate or provider limits.",
        ],
        "example": {
            "status": "ok",
            "wallet": "public_wallet_address",
            "provider": "helius",
            "transactions": [
                {
                    "signature": "public_signature",
                    "timestamp": "2026-05-22T12:00:00Z",
                    "source_wallet": "source_wallet",
                    "destination_wallet": "destination_wallet",
                    "token_mint": "token_mint",
                    "amount": "1.23",
                    "event_type": "direct_transfer",
                    "parser_confidence": 0.72,
                    "parser_confidence_reason": "provider-normalized transfer leg; review signature grouping",
                    "parser_limitations": ["provider_payload_sanitized"],
                    "raw_reference": {
                        "provider": "helius",
                        "page_number": 1,
                        "raw_payload_stored": False,
                        "provider_key_stored": False,
                        "request_url_stored": False,
                        "request_headers_stored": False,
                    },
                }
            ],
            "next_cursor": "public_signature_cursor",
            "more_available": True,
            "metadata": {
                **BOUNDARY_FIELDS,
                **COMMON_RATE_LIMIT_FIELDS,
                **COMMON_CACHE_FIELDS,
                "provider": "helius",
                "provider_label": "Helius Enhanced Transactions",
                "cache_version": "d349_provider_cache_v1",
                "pages_loaded": 1,
                "requested_limit": 25,
                "returned_count": 1,
                "cursor_exhausted": False,
                "more_available": True,
                "provider_limited": False,
                "full_history_loaded": False,
                "full_history_claim_allowed": False,
                "no_data_merged": True,
                "replay_preview_only": True,
            },
        },
    },
    "/api/crypto/provider-diagnostics": {
        "purpose": "Worker provider readiness, rate-limit, cache, and capability diagnostics without fetching history pages.",
        "required_fields": ["status", "providerDiagnostics", "metadata"],
        "optional_fields": ["message", "wallet", "provider"],
        "pagination_fields": ["cursor_supported", "page_limit", "max_pages"],
        "rate_limit_fields": ["rate_limited", "retry_after_seconds", "provider_cooldown_seconds", "rate_limit_status"],
        "cache_fields": ["cache_status", "cache_ttl_seconds", "cache_namespace"],
        "error_state_fields": ["status", "message", "providerDiagnostics.configured", "metadata.provider_unavailable"],
        "provider_boundary_fields": list(BOUNDARY_FIELDS),
        "no_browser_provider_call_guarantees": [
            "Diagnostics report configuration state only; browser still does not call providers.",
            "Missing env vars may be named but secret values must never be returned.",
            "No provider headers, bearer tokens, request URLs with keys, or raw payloads are included.",
        ],
        "example": {
            "status": "diagnostics_ok",
            "provider": "helius",
            "providerDiagnostics": {
                "configured": True,
                "active_provider": "helius",
                "provider_family": "solana_indexer",
                "provider_grade": "partial",
                "archive_readiness": "bounded_cursor",
                "replay_suitability": "medium",
                "missing_env_vars": [],
                "capabilities": {
                    "label": "Helius Enhanced Transactions",
                    "supportsPagination": True,
                    "backendOnly": False,
                    "browserProviderCalls": False,
                    "apiKeyExposure": False,
                },
            },
            "metadata": {
                **BOUNDARY_FIELDS,
                **COMMON_RATE_LIMIT_FIELDS,
                "provider_configured": True,
                "no_history_page_loaded": True,
            },
        },
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Document or validate CryptoPhotonic Worker response contracts.")
    parser.add_argument("--endpoint", choices=ENDPOINTS, default="", help="Endpoint contract to print or validate.")
    parser.add_argument("--json", action="store_true", help="Print the selected contract, or all contracts, as JSON.")
    parser.add_argument("--summary", action="store_true", help="Print a short human-readable summary.")
    parser.add_argument("--validate", default="", help="Validate a local JSON response file against --endpoint.")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Response JSON must be an object.")
    return payload


def nested_value(payload: dict[str, Any], path: str) -> Any:
    value: Any = payload
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def validate_payload(endpoint: str, payload: dict[str, Any]) -> list[str]:
    contract = CONTRACTS[endpoint]
    errors: list[str] = []
    for field in contract["required_fields"]:
        if nested_value(payload, field) is None:
            errors.append(f"missing required field: {field}")
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        errors.append("metadata must be an object")
        metadata = {}
    for field, expected in BOUNDARY_FIELDS.items():
        if metadata.get(field) is not expected:
            errors.append(f"metadata.{field} must be {str(expected).lower()}")
    if metadata.get("provider_keys_included") is not False:
        errors.append("provider keys must not be included")
    if metadata.get("browser_provider_calls") is not False:
        errors.append("browser provider calls must be false")
    if metadata.get("raw_provider_payloads_included") is not False:
        errors.append("raw provider payloads must not be included")
    if endpoint in {"/api/crypto/events", "/api/crypto/wallet-activity"}:
        events = payload.get("events")
        if not isinstance(events, list):
            errors.append("events must be a list")
        else:
            for index, event in enumerate(events):
                if not isinstance(event, dict):
                    errors.append(f"events[{index}] must be an object")
                    continue
                event_text = " ".join(
                    str(event.get(key, ""))
                    for key in ("ingestion_source", "source", "source_kind", "cache_origin")
                ).lower()
                flags = [event.get("sample"), event.get("fixture"), event.get("mock"), event.get("placeholder")]
                if any(flag is True for flag in flags) or any(marker in event_text for marker in ("sample", "fixture", "mock", "placeholder", "local_test", "dev_test")):
                    errors.append(f"events[{index}] is marked as sample/mock/dev and must not be active graph data")
    if endpoint == "/api/crypto/wallet-history" and not isinstance(payload.get("transactions"), list):
        errors.append("transactions must be a list")
    if endpoint == "/api/crypto/provider-diagnostics" and not isinstance(payload.get("providerDiagnostics"), dict):
        errors.append("providerDiagnostics must be an object")
    return errors


def print_summary(endpoint: str = "") -> None:
    selected = [endpoint] if endpoint else list(ENDPOINTS)
    print(f"CryptoPhotonic Worker contract {CONTRACT_VERSION}")
    for item in selected:
        contract = CONTRACTS[item]
        print(f"- {item}: {contract['purpose']}")
        print(f"  required: {', '.join(contract['required_fields'])}")
        print("  boundary: browser_provider_calls=false, provider_keys_included=false, raw_provider_payloads_included=false")


def main() -> int:
    args = parse_args()
    if args.validate:
        if not args.endpoint:
            raise SystemExit("--validate requires --endpoint.")
        payload = load_json(Path(args.validate).resolve())
        errors = validate_payload(args.endpoint, payload)
        if errors:
            print("Worker contract validation failed")
            for error in errors:
                print(f"- {error}")
            return 1
        print("Worker contract validation passed")
        return 0

    if args.json:
        selected: Any = CONTRACTS[args.endpoint] if args.endpoint else CONTRACTS
        print(json.dumps({"version": CONTRACT_VERSION, "contracts": selected}, indent=2))
        return 0

    print_summary(args.endpoint)
    if not args.summary and args.endpoint:
        print(json.dumps(CONTRACTS[args.endpoint]["example"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
