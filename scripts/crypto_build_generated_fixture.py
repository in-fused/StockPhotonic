#!/usr/bin/env python3
"""Build browser-readable CryptoPhotonic graph fixtures from local cache JSON.

This script is intentionally local-only:
- dry-run is the default
- no network/provider requests are made
- provider keys, request URLs, request headers, and raw provider payloads are
  never copied into generated fixtures
- default writes stay under data/crypto/generated/
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "crypto"
DEFAULT_GENERATED_DIR = DEFAULT_DATA_DIR / "generated"
DEFAULT_INPUT = DEFAULT_DATA_DIR / "sample_wallet_history.json"
DEFAULT_MANIFEST = DEFAULT_GENERATED_DIR / "manifest.json"
DEFAULT_OUTPUT_NAME = "sample-wallet-history.generated.sample.json"
CHAIN = "solana"
NATIVE_SOL_MINT = "solana:native-sol"

SENSITIVE_KEY_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"api[_-]?key",
        r"authorization",
        r"bearer",
        r"secret",
        r"token_secret",
        r"private[_-]?key",
        r"request[_-]?headers?",
        r"headers?",
        r"request[_-]?url",
        r"raw[_-]?(provider|payload|response|body|json)",
        r"provider[_-]?payload",
    )
]

RAW_REFERENCE_SAFE_KEYS = {
    "source_file",
    "provider",
    "provider_record_type",
    "provider_transfer_kind",
    "record_index",
    "transfer_leg_index",
    "signature",
    "slot",
    "outer_instruction_index",
    "inner_instruction_index",
    "source_format",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a static CryptoPhotonic graph fixture from normalized wallet history or replay cache JSON. Defaults to dry-run.",
    )
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Input normalized wallet history or replay cache JSON path.")
    parser.add_argument("--output", default="", help="Output JSON path. Defaults under data/crypto/generated/.")
    parser.add_argument("--write", action="store_true", help="Write generated fixture JSON. Without this flag the command is dry-run only.")
    parser.add_argument(
        "--manifest",
        nargs="?",
        const=str(DEFAULT_MANIFEST),
        default="",
        help="Update/create generated manifest. With no value, uses data/crypto/generated/manifest.json. Requires --write to persist.",
    )
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return path.resolve()


def relative_repo_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Input JSON must be an object.")
    return payload


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def clean_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return ""


def normalize_address(value: Any) -> str:
    return clean_text(value)


def safe_id(value: Any) -> str:
    text = clean_text(value).lower()
    return re.sub(r"[^a-z0-9:_-]+", "-", text).strip("-") or "unknown"


def is_sensitive_key(key: str) -> bool:
    return any(pattern.search(key) for pattern in SENSITIVE_KEY_PATTERNS)


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if is_sensitive_key(key_text):
                continue
            sanitized[key_text] = sanitize_value(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    return value


def sanitize_raw_reference(row: dict[str, Any], input_path: Path, index: int) -> dict[str, Any]:
    raw = as_dict(row.get("raw_reference"))
    sanitized = {
        key: sanitize_value(raw[key])
        for key in RAW_REFERENCE_SAFE_KEYS
        if key in raw and raw[key] not in (None, "")
    }
    sanitized["source_file"] = clean_text(sanitized.get("source_file")) or relative_repo_path(input_path)
    sanitized["record_index"] = sanitized.get("record_index", index)
    sanitized["raw_payload_stored"] = False
    sanitized["provider_key_stored"] = False
    sanitized["request_url_stored"] = False
    sanitized["request_headers_stored"] = False
    sanitized["sanitized"] = True
    return sanitized


def extract_rows(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    normalized = [row for row in as_list(payload.get("normalized_transactions")) if isinstance(row, dict)]
    if normalized:
        return normalized, "normalized_wallet_history"

    replay_rows: list[dict[str, Any]] = []
    for window in as_list(payload.get("replay_windows")):
        if isinstance(window, dict):
            replay_rows.extend(row for row in as_list(window.get("events")) if isinstance(row, dict))
    if replay_rows:
        return replay_rows, "replay_cache"

    graph_rows = [row for row in as_list(payload.get("transactions")) if isinstance(row, dict)]
    if graph_rows:
        return graph_rows, "graph_fixture"

    return [], "unknown"


def extract_wallet(payload: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    metadata = as_dict(payload.get("metadata"))
    cache = as_dict(payload.get("cache"))
    normalized_cache = as_dict(payload.get("normalized_cache_metadata"))
    wallet = clean_text(first_present(metadata.get("wallet"), metadata.get("generated_wallet"), metadata.get("tracked_wallet"), normalized_cache.get("wallet"), cache.get("wallet")))
    if wallet:
        return wallet
    for row in rows:
        for field in ("source_wallet", "destination_wallet"):
            candidate = clean_text(row.get(field))
            if candidate:
                return candidate
    return ""


def amount_is_missing(row: dict[str, Any]) -> bool:
    amount = clean_text(row.get("amount")).lower()
    limitations = [str(item).lower() for item in as_list(row.get("parser_limitations"))]
    return amount in {"", "none", "null", "nan"} or any("amount unavailable" in item or "missing amount" in item for item in limitations)


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_type_counts: dict[str, int] = {}
    signature_groups = {row.get("signature_group_id") or row.get("signature") or row.get("transaction_hash") for row in rows if row.get("signature_group_id") or row.get("signature") or row.get("transaction_hash")}
    for row in rows:
        event_type = clean_text(row.get("event_type") or row.get("transaction_type")) or "unknown_unsupported_event"
        event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
    return {
        "rows_read": len(rows),
        "signature_group_count": len(signature_groups),
        "direct_transfer_count": event_type_counts.get("direct_transfer", 0),
        "multi_leg_transfer_count": event_type_counts.get("multi_leg_transfer", 0),
        "swap_like_flow_count": event_type_counts.get("swap_like_flow", 0),
        "parser_limited_count": sum(1 for row in rows if row.get("event_type") == "parser_limited_event" or any("parser-limited" in str(item).lower() for item in as_list(row.get("parser_limitations")))),
        "parser_limitation_row_count": sum(1 for row in rows if row.get("parser_limitations")),
        "unknown_unsupported_count": event_type_counts.get("unknown_unsupported_event", 0),
        "missing_amount_count": sum(1 for row in rows if amount_is_missing(row)),
        "missing_source_count": sum(1 for row in rows if not row.get("source_wallet")),
        "missing_destination_count": sum(1 for row in rows if not row.get("destination_wallet")),
        "missing_mint_count": sum(1 for row in rows if not row.get("token_mint")),
        "event_type_counts": event_type_counts,
    }


def token_symbol(row: dict[str, Any], mint: str) -> str:
    symbol = clean_text(row.get("symbol"))
    if symbol:
        return symbol
    if mint in {"native:sol", NATIVE_SOL_MINT}:
        return "SOL"
    if not mint:
        return "SPL"
    return f"SPL {mint[:6]}...{mint[-4:]}" if len(mint) > 14 else mint


def amount_number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def transaction_type_from_event(event_type: str) -> str:
    mapping = {
        "direct_transfer": "TRANSFER",
        "multi_leg_transfer": "MULTI_LEG_TRANSFER",
        "swap_like_flow": "SWAP_LIKE_FLOW",
        "parser_limited_event": "PARSER_LIMITED_EVENT",
        "unknown_unsupported_event": "UNKNOWN_UNSUPPORTED_EVENT",
    }
    return mapping.get(event_type, event_type.upper() if event_type else "UNKNOWN")


def transaction_label_from_event(event_type: str) -> str:
    return clean_text(event_type).replace("_", " ").title() or "Unknown"


def build_transaction(row: dict[str, Any], index: int, input_path: Path, wallet: str) -> dict[str, Any]:
    signature = clean_text(first_present(row.get("signature"), row.get("transaction_hash"), f"unsigned-row-{index}"))
    source_wallet = normalize_address(first_present(row.get("source_wallet"), row.get("from"), row.get("source")))
    destination_wallet = normalize_address(first_present(row.get("destination_wallet"), row.get("to"), row.get("target")))
    token_mint = normalize_address(first_present(row.get("token_mint"), row.get("contract_address"), row.get("token"), NATIVE_SOL_MINT))
    event_type = clean_text(row.get("event_type")) or clean_text(row.get("transaction_type")) or "unknown_unsupported_event"
    signature_group_id = clean_text(row.get("signature_group_id")) or f"signature:{signature}"
    leg_index = row.get("transfer_leg_index", row.get("leg_index"))
    leg_count = row.get("transfer_leg_count", row.get("leg_count", 1))
    symbol = token_symbol(row, token_mint)
    confidence = row.get("parser_confidence", row.get("confidence", 0))
    try:
        confidence_value = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence_value = 0.0

    metadata = sanitize_value(as_dict(row.get("metadata")))
    metadata.update(
        {
            "fixture_only": True,
            "generated_static_cache": True,
            "source_format": "generated_normalized_transaction",
            "signature": signature,
            "signature_group_id": signature_group_id,
            "signature_group_index": row.get("signature_group_index"),
            "signature_group_size": row.get("signature_group_size"),
            "transfer_leg_index": leg_index,
            "transfer_leg_count": leg_count,
            "event_type": event_type,
            "swap_leg_group": row.get("swap_leg_group"),
            "parser_confidence": confidence_value,
            "parser_confidence_reason": clean_text(row.get("parser_confidence_reason")),
            "parser_limitations": as_list(row.get("parser_limitations")),
            "raw_reference": sanitize_raw_reference(row, input_path, index),
            "balance_delta_summary": sanitize_value(as_dict(row.get("balance_delta_summary"))),
            "production_meaning": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "raw_payload_stored": False,
        }
    )

    direction = clean_text(row.get("transfer_direction") or row.get("direction"))
    tracked_role = direction if direction in {"inbound", "outbound", "self"} else ""
    return {
        "id": f"tx:{CHAIN}:{safe_id(signature)}:{leg_index or index + 1}",
        "type": "transaction",
        "transaction_type": transaction_type_from_event(event_type),
        "transaction_type_key": transaction_type_from_event(event_type),
        "transaction_type_label": transaction_label_from_event(event_type),
        "transaction_hash": signature,
        "signature": signature,
        "signature_group_id": signature_group_id,
        "signature_group_index": row.get("signature_group_index"),
        "signature_group_size": row.get("signature_group_size"),
        "transfer_leg_index": leg_index,
        "transfer_leg_count": leg_count,
        "chain": CHAIN,
        "source_wallet": source_wallet,
        "destination_wallet": destination_wallet,
        "token_mint": token_mint,
        "contract_address": token_mint,
        "symbol": symbol,
        "amount": amount_number(row.get("amount")),
        "amount_display": clean_text(row.get("amount")),
        "usd_value": 0,
        "timestamp": first_present(row.get("timestamp"), row.get("block_time"), None),
        "confidence": confidence_value,
        "label_source": "generated_static_cache",
        "hub_ids": [],
        "flow_role": "swap_route" if event_type == "swap_like_flow" else "",
        "route_id": clean_text(row.get("swap_leg_group")),
        "transaction_group_id": f"txgroup:{CHAIN}:{safe_id(signature_group_id)}",
        "leg_index": leg_index,
        "leg_count": leg_count,
        "source_program": clean_text(first_present(row.get("program_id"), row.get("source_program"))),
        "source_label": "Generated Static Cache",
        "direction": direction,
        "tracked_wallet_role": tracked_role,
        "event_type": event_type,
        "swap_leg_group": row.get("swap_leg_group"),
        "parser_confidence": confidence_value,
        "parser_confidence_reason": clean_text(row.get("parser_confidence_reason")),
        "parser_limitations": as_list(row.get("parser_limitations")),
        "raw_reference": metadata["raw_reference"],
        "metadata": metadata,
    }


def build_wallets(transactions: list[dict[str, Any]], wallet: str) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for transaction in transactions:
        for field in ("source_wallet", "destination_wallet"):
            address = normalize_address(transaction.get(field))
            if not address or address in seen:
                continue
            seen[address] = {
                "id": f"wallet:{CHAIN}:{safe_id(address)}",
                "type": "wallet",
                "address": address,
                "chain": CHAIN,
                "label": "Wallet Input" if wallet and address == wallet else "Observed Wallet",
                "label_source": "generated_static_cache_observation",
                "confidence": 0,
                "metadata": {
                    "fixture_only": True,
                    "generated_static_cache": True,
                    "address_observation_only": True,
                    "identity_or_ownership_not_asserted": True,
                    "provider_keys_included": False,
                    "browser_provider_calls": False,
                },
            }
    if wallet and wallet not in seen:
        seen[wallet] = {
            "id": f"wallet:{CHAIN}:{safe_id(wallet)}",
            "type": "wallet",
            "address": wallet,
            "chain": CHAIN,
            "label": "Wallet Input",
            "label_source": "generated_static_cache_metadata",
            "confidence": 0,
            "metadata": {
                "fixture_only": True,
                "generated_static_cache": True,
                "address_observation_only": True,
                "identity_or_ownership_not_asserted": True,
                "provider_keys_included": False,
                "browser_provider_calls": False,
            },
        }
    return list(seen.values())


def build_tokens(transactions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for transaction in transactions:
        mint = normalize_address(transaction.get("token_mint"))
        if not mint or mint in seen:
            continue
        symbol = clean_text(transaction.get("symbol")) or token_symbol(transaction, mint)
        seen[mint] = {
            "id": f"token:{CHAIN}:{safe_id(mint)}",
            "type": "token",
            "symbol": symbol,
            "name": "Observed Token" if symbol == "SPL" else symbol,
            "token_mint": mint,
            "contract_address": mint,
            "chain": CHAIN,
            "decimals": transaction.get("metadata", {}).get("decimals", 0) if isinstance(transaction.get("metadata"), dict) else 0,
            "label_source": "generated_static_cache_observation",
            "confidence": 0,
            "metadata": {
                "fixture_only": True,
                "generated_static_cache": True,
                "token_observation_only": True,
                "provider_keys_included": False,
                "browser_provider_calls": False,
            },
        }
    return list(seen.values())


def build_transaction_groups(transactions: list[dict[str, Any]], wallet: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for transaction in transactions:
        group_key = clean_text(transaction.get("signature_group_id") or transaction.get("signature") or transaction.get("transaction_hash"))
        if not group_key:
            continue
        groups.setdefault(group_key, []).append(transaction)

    output: list[dict[str, Any]] = []
    for group_key, group_transactions in groups.items():
        first = group_transactions[0]
        tokens = sorted({clean_text(tx.get("symbol")) for tx in group_transactions if tx.get("symbol")})
        token_mints = sorted({clean_text(tx.get("token_mint")) for tx in group_transactions if tx.get("token_mint")})
        directions = {clean_text(tx.get("direction")) for tx in group_transactions if tx.get("direction")}
        direction = "mixed" if len(directions) > 1 else next(iter(directions), "")
        output.append(
            {
                "id": f"txgroup:{CHAIN}:{safe_id(group_key)}",
                "chain": CHAIN,
                "signature": clean_text(first.get("signature") or first.get("transaction_hash")),
                "signature_group_id": group_key,
                "transaction_type": clean_text(first.get("transaction_type")),
                "transaction_type_key": clean_text(first.get("transaction_type_key")),
                "transaction_type_label": clean_text(first.get("transaction_type_label")),
                "source_program": clean_text(first.get("source_program")),
                "source_label": "Generated Static Cache",
                "leg_count": len(group_transactions),
                "primary_wallet": wallet,
                "primary_wallet_role": direction,
                "direction": direction,
                "tokens_involved": tokens,
                "token_mints": token_mints,
                "timestamp": first.get("timestamp"),
                "fee_payer": "",
                "metadata": {
                    "fixture_only": True,
                    "generated_static_cache": True,
                    "sanitized": True,
                    "event_type_counts": summarize_rows(group_transactions).get("event_type_counts", {}),
                    "parser_limitation_row_count": sum(1 for tx in group_transactions if tx.get("parser_limitations")),
                    "browser_provider_calls": False,
                    "provider_keys_included": False,
                    "production_meaning": False,
                },
            }
        )
    return output


def cache_summary(payload: dict[str, Any], row_count: int, summary: dict[str, Any]) -> dict[str, Any]:
    cache = {**as_dict(payload.get("normalized_cache_metadata")), **as_dict(payload.get("cache"))}
    return {
        "cache_schema": clean_text(cache.get("cache_schema")) or "generated_fixture_cache_summary_v1",
        "cache_version": clean_text(cache.get("cache_version")) or clean_text(cache.get("cache_schema")) or "generated_fixture_cache_summary_v1",
        "cache_id": clean_text(cache.get("cache_id")),
        "cache_state": clean_text(cache.get("cache_state")) or "generated_static_fixture",
        "cache_origin": cache.get("cache_origin"),
        "cache_class": cache.get("cache_class"),
        "cache_artifact_class": cache.get("cache_artifact_class"),
        "provider_cache": bool(cache.get("provider_cache", False)),
        "provider_cache_derived": bool(cache.get("provider_cache_derived", False)),
        "provider_fetched": bool(cache.get("provider_fetched", False)),
        "provider": cache.get("provider"),
        "provider_label": cache.get("provider_label"),
        "wallet": cache.get("wallet"),
        "fetched_at": cache.get("fetched_at"),
        "pages_loaded": cache.get("pages_loaded", 0),
        "pages_requested": cache.get("pages_requested", 0),
        "request_limit": cache.get("request_limit", 0),
        "source_rows": cache.get("source_rows", row_count),
        "normalized_event_count": cache.get("normalized_event_count", row_count),
        "signature_group_count": cache.get("signature_group_count", summary.get("signature_group_count", 0)),
        "parser_limited_count": cache.get("parser_limited_count", summary.get("parser_limited_count", 0)),
        "parser_limitation_row_count": cache.get("parser_limitation_row_count", summary.get("parser_limitation_row_count", 0)),
        "event_type_counts": sanitize_value(cache.get("event_type_counts", summary.get("event_type_counts", {}))),
        "missing_field_counts": sanitize_value(
            cache.get(
                "missing_field_counts",
                {
                    "amount": summary.get("missing_amount_count", 0),
                    "source_wallet": summary.get("missing_source_count", 0),
                    "destination_wallet": summary.get("missing_destination_count", 0),
                    "token_mint": summary.get("missing_mint_count", 0),
                },
            )
        ),
        "cursor": cache.get("cursor"),
        "current_cursor": cache.get("current_cursor"),
        "next_cursor": cache.get("next_cursor"),
        "cursor_type": cache.get("cursor_type", "unknown"),
        "cursor_field": cache.get("cursor_field", "unknown"),
        "pagination_supported": bool(cache.get("pagination_supported", False)),
        "deterministic_pagination_support": bool(cache.get("deterministic_pagination_support", False)),
        "requested_limit": cache.get("requested_limit"),
        "returned_count": cache.get("returned_count", row_count),
        "more_available": bool(cache.get("more_available", False)),
        "cursor_exhausted": bool(cache.get("cursor_exhausted", False)),
        "full_history_loaded": bool(cache.get("full_history_loaded", False)),
        "full_history_claim_allowed": bool(cache.get("full_history_claim_allowed", False)),
        "rate_limited": bool(cache.get("rate_limited", False)),
        "retry_after_seconds": cache.get("retry_after_seconds"),
        "cooldown_applied_seconds": cache.get("cooldown_applied_seconds", 0),
        "provider_limited": bool(cache.get("provider_limited", False)),
        "provider_unavailable": bool(cache.get("provider_unavailable", False)),
        "stop_reason": cache.get("stop_reason"),
        "page_summaries": sanitize_value(cache.get("page_summaries", [])),
        "raw_payload_stored": False,
        "raw_provider_payloads_included": False,
        "provider_keys_included": False,
        "provider_request_url_included": False,
        "provider_headers_included": False,
        "browser_provider_calls": False,
        "production_meaning": False,
    }


def is_provider_cache_candidate(payload: dict[str, Any], source_metadata: dict[str, Any], cache: dict[str, Any], sample: bool, fixture: bool) -> bool:
    if sample or fixture:
        return False
    values = {
        "provider_cache": source_metadata.get("provider_cache"),
        "provider_cache_derived": source_metadata.get("provider_cache_derived"),
        "provider_fetched": source_metadata.get("provider_fetched") or cache.get("provider_fetched"),
        "cache_origin": source_metadata.get("cache_origin") or cache.get("cache_origin"),
        "cache_class": source_metadata.get("cache_class") or cache.get("cache_class"),
        "cache_artifact_class": source_metadata.get("cache_artifact_class") or cache.get("cache_artifact_class"),
    }
    return values["provider_cache"] is True or values["provider_cache_derived"] is True or values["provider_fetched"] is True or values["cache_origin"] == "provider_fetched" or values["cache_class"] == "provider_cache" or values["cache_artifact_class"] == "provider_cache" or cache.get("provider_cache") is True or cache.get("provider_cache_derived") is True


def replay_reference(payload: dict[str, Any]) -> dict[str, Any] | None:
    windows = [window for window in as_list(payload.get("replay_windows")) if isinstance(window, dict)]
    cache = as_dict(payload.get("cache"))
    if not windows and not cache:
        return None
    return {
        "cache_id": cache.get("cache_id"),
        "cache_schema": cache.get("cache_schema"),
        "cache_state": cache.get("cache_state"),
        "window_count": len(windows),
        "event_count": sum(len(as_list(window.get("events"))) for window in windows),
        "continuity_confidence": sanitize_value(windows[0].get("continuity_confidence")) if windows else None,
        "raw_payload_stored": False,
        "provider_keys_included": False,
        "browser_provider_calls": False,
        "production_meaning": False,
    }


def build_fixture(payload: dict[str, Any], input_path: Path, generated_at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    source_metadata = as_dict(payload.get("metadata"))
    rows, source_kind = extract_rows(payload)
    wallet = extract_wallet(payload, rows)
    transactions = [build_transaction(row, index, input_path, wallet) for index, row in enumerate(rows)]
    summary = {**summarize_rows(rows), **as_dict(payload.get("parser_quality_summary"))}
    if "rows_read" not in summary:
        summary["rows_read"] = len(rows)
    cache = cache_summary(payload, len(rows), summary)
    sample = source_metadata.get("sample", False) is True or "sample" in input_path.name.lower()
    fixture = source_metadata.get("fixture", False) is True or sample
    source = clean_text(first_present(source_metadata.get("source"), cache.get("source"), source_kind))
    provider_cache_candidate = is_provider_cache_candidate(payload, source_metadata, cache, sample, fixture)
    cache_artifact_class = "sample_fixture" if sample or fixture else "provider_cache" if provider_cache_candidate else "local_generated_untrusted"

    output = {
        "metadata": {
            "name": "CryptoPhotonic generated static graph fixture",
            "version": "d329_generated_static_graph_fixture_v1",
            "environment": "local_static_cache_generated",
            "chain": source_metadata.get("chain", CHAIN),
            "adapter": "generated_static_graph",
            "source": source,
            "source_kind": source_kind,
            "source_file": relative_repo_path(input_path),
            "wallet": wallet,
            "generated_wallet": wallet,
            "generated_at": generated_at,
            "transaction_count": len(transactions),
            "signature_group_count": len({tx.get("signature_group_id") for tx in transactions if tx.get("signature_group_id")}),
            "cache_id": cache.get("cache_id"),
            "cache_version": cache.get("cache_version"),
            "provider": cache.get("provider") or source_metadata.get("provider"),
            "provider_label": cache.get("provider_label") or source_metadata.get("provider_label"),
            "fetched_at": cache.get("fetched_at") or source_metadata.get("fetched_at"),
            "pages_loaded": cache.get("pages_loaded", 0),
            "requested_limit": cache.get("requested_limit"),
            "returned_count": cache.get("returned_count", len(transactions)),
            "next_cursor": cache.get("next_cursor"),
            "cursor_exhausted": cache.get("cursor_exhausted", False),
            "more_available": cache.get("more_available", False),
            "rate_limited": cache.get("rate_limited", False),
            "retry_after_seconds": cache.get("retry_after_seconds"),
            "provider_limited": cache.get("provider_limited", False),
            "full_history_loaded": cache.get("full_history_loaded", False),
            "full_history_claim_allowed": cache.get("full_history_claim_allowed", False),
            "sample": sample,
            "fixture": fixture,
            "sample_fixture_only": sample or fixture,
            "provider_cache": provider_cache_candidate,
            "provider_cache_derived": provider_cache_candidate,
            "cache_origin": "provider_fetched" if provider_cache_candidate else "sample_fixture" if sample or fixture else "unverified_local_cache",
            "cache_class": cache_artifact_class,
            "cache_artifact_class": cache_artifact_class,
            "production_safe_cache_candidate": provider_cache_candidate,
            "local_cache_selectable": provider_cache_candidate,
            "sanitized": True,
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
            "raw_provider_payloads_included": False,
            "disclaimer": "Static generated cache artifact for browser rendering. It is not proof of wallet identity, ownership, source-of-funds, risk, intent, or complete history.",
        },
        "wallets": build_wallets(transactions, wallet),
        "tokens": build_tokens(transactions),
        "entities": [],
        "transactions": transactions,
        "transaction_groups": build_transaction_groups(transactions, wallet),
        "replay_cache_reference": replay_reference(payload),
        "parser_quality_summary": sanitize_value(summary),
        "cache_summary": cache,
        "boundary_flags": {
            "sample": sample,
            "fixture": fixture,
            "sample_fixture_only": sample or fixture,
            "provider_cache": provider_cache_candidate,
            "provider_cache_derived": provider_cache_candidate,
            "cache_origin": "provider_fetched" if provider_cache_candidate else "sample_fixture" if sample or fixture else "unverified_local_cache",
            "cache_class": cache_artifact_class,
            "cache_artifact_class": cache_artifact_class,
            "production_safe_cache_candidate": provider_cache_candidate,
            "local_cache_selectable": provider_cache_candidate,
            "sanitized": True,
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
            "raw_provider_payloads_included": False,
        },
    }
    manifest_entry = {
        "path": "",
        "wallet": wallet,
        "generated_at": generated_at,
        "transaction_count": len(transactions),
        "signature_group_count": output["metadata"]["signature_group_count"],
        "cache_id": cache.get("cache_id"),
        "cache_version": cache.get("cache_version"),
        "provider": cache.get("provider") or source_metadata.get("provider"),
        "provider_label": cache.get("provider_label") or source_metadata.get("provider_label"),
        "pages_loaded": cache.get("pages_loaded", 0),
        "requested_limit": cache.get("requested_limit"),
        "returned_count": cache.get("returned_count", len(transactions)),
        "next_cursor": cache.get("next_cursor"),
        "cursor_exhausted": cache.get("cursor_exhausted", False),
        "more_available": cache.get("more_available", False),
        "rate_limited": cache.get("rate_limited", False),
        "retry_after_seconds": cache.get("retry_after_seconds"),
        "provider_limited": cache.get("provider_limited", False),
        "full_history_loaded": cache.get("full_history_loaded", False),
        "full_history_claim_allowed": cache.get("full_history_claim_allowed", False),
        "source": source,
        "sanitized": True,
        "production_meaning": False,
        "browser_provider_calls": False,
        "provider_keys_included": False,
        "raw_provider_payloads_included": False,
        "sample": sample,
        "fixture": fixture,
        "sample_fixture_only": sample or fixture,
        "provider_cache": provider_cache_candidate,
        "provider_cache_derived": provider_cache_candidate,
        "cache_origin": "provider_fetched" if provider_cache_candidate else "sample_fixture" if sample or fixture else "unverified_local_cache",
        "cache_class": cache_artifact_class,
        "cache_artifact_class": cache_artifact_class,
        "production_safe_cache_candidate": provider_cache_candidate,
        "local_cache_selectable": provider_cache_candidate,
    }
    return output, manifest_entry


def safe_filename(value: Any, fallback: str = "provider-cache") -> str:
    text = clean_text(value).lower()
    text = re.sub(r"[^a-z0-9._-]+", "-", text).strip("-")
    return text[:96] or fallback


def default_output_path(manifest_entry: dict[str, Any] | None = None) -> Path:
    entry = manifest_entry or {}
    if is_manifest_provider_cache_candidate(entry):
        stem = safe_filename(entry.get("cache_id") or entry.get("wallet") or "provider-cache")
        return (DEFAULT_GENERATED_DIR / "provider-cache" / f"{stem}.generated.json").resolve()
    return (DEFAULT_GENERATED_DIR / DEFAULT_OUTPUT_NAME).resolve()


def output_boundary_message(path: Path, explicit_output: bool) -> str:
    try:
        path.relative_to(DEFAULT_GENERATED_DIR.resolve())
        return "default data/crypto/generated boundary"
    except ValueError:
        if explicit_output:
            return "explicit output path supplied"
        raise SystemExit("Refusing to write outside data/crypto/generated/ without an explicit --output path.")


def resolve_output(args: argparse.Namespace, manifest_entry: dict[str, Any] | None = None) -> tuple[Path, bool]:
    explicit_output = "--output" in os.sys.argv
    output_path = resolve_path(args.output) if args.output else default_output_path(manifest_entry)
    output_boundary_message(output_path, explicit_output)
    return output_path, explicit_output


def resolve_manifest(raw_path: str) -> Path:
    manifest_path = resolve_path(raw_path)
    if manifest_path != DEFAULT_MANIFEST.resolve():
        raise SystemExit("Manifest writes are limited to data/crypto/generated/manifest.json.")
    return manifest_path


def is_manifest_provider_cache_candidate(item: dict[str, Any]) -> bool:
    return (
        item.get("provider_cache") is True
        and item.get("provider_cache_derived") is True
        and item.get("sample") is False
        and item.get("fixture") is False
        and item.get("sample_fixture_only") is False
        and item.get("sanitized") is True
        and item.get("browser_provider_calls") is False
        and item.get("provider_keys_included") is False
        and item.get("raw_provider_payloads_included") is False
        and item.get("cache_origin") == "provider_fetched"
        and item.get("cache_class") == "provider_cache"
    )


def update_manifest(manifest_path: Path, entry: dict[str, Any], output_path: Path) -> dict[str, Any]:
    if manifest_path.exists():
        manifest = load_json(manifest_path)
    else:
        manifest = {}
    rel_output = relative_repo_path(output_path)
    entry = {**entry, "path": rel_output}

    sample_fixtures = [
        item
        for item in [*as_list(manifest.get("sample_fixtures")), *as_list(manifest.get("fixtures"))]
        if isinstance(item, dict)
        and item.get("sample") is True
        and item.get("fixture") is True
        and item.get("sanitized") is True
        and item.get("production_meaning") is False
        and item.get("browser_provider_calls") is False
    ]
    provider_cache_fixtures = [
        item
        for item in as_list(manifest.get("provider_cache_fixtures"))
        if isinstance(item, dict) and is_manifest_provider_cache_candidate(item)
    ]

    sample_fixtures = [item for item in sample_fixtures if item.get("path") != rel_output]
    provider_cache_fixtures = [item for item in provider_cache_fixtures if item.get("path") != rel_output]
    if is_manifest_provider_cache_candidate(entry):
        provider_cache_fixtures.append(entry)
    else:
        sample_fixtures.append(entry)
    sample_fixtures.sort(key=lambda item: str(item.get("path", "")))
    provider_cache_fixtures.sort(key=lambda item: str(item.get("path", "")))
    active_provider_cache_candidate = rel_output if is_manifest_provider_cache_candidate(entry) else manifest.get("active_provider_cache_candidate")
    if active_provider_cache_candidate and not any(item.get("path") == active_provider_cache_candidate for item in provider_cache_fixtures):
        active_provider_cache_candidate = None
    return {
        "metadata": {
            "environment": "local_static_cache_generated_manifest",
            "sanitized": True,
            "sample": False,
            "fixture": False,
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "sample_fixtures_active_graph_allowed": False,
            "provider_cache_required_for_active_graph": True,
            "updated_at": entry["generated_at"],
        },
        "active_provider_cache_candidate": active_provider_cache_candidate,
        "active_fixture": None,
        "provider_cache_fixtures": provider_cache_fixtures,
        "sample_fixtures": sample_fixtures,
        "fixtures": [*provider_cache_fixtures, *sample_fixtures],
    }


def main() -> int:
    args = parse_args()
    input_path = resolve_path(args.input)
    payload = load_json(input_path)
    generated_at = utc_now()
    fixture, manifest_entry = build_fixture(payload, input_path, generated_at)
    output_path, explicit_output = resolve_output(args, manifest_entry)
    manifest_path = resolve_manifest(args.manifest) if args.manifest else None
    manifest_payload = update_manifest(manifest_path, manifest_entry, output_path) if manifest_path else None
    boundary = output_boundary_message(output_path, explicit_output)

    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
        if manifest_path and manifest_payload:
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(manifest_payload, indent=2) + "\n", encoding="utf-8")

    summary = fixture["parser_quality_summary"]
    print("CryptoPhotonic generated fixture builder")
    print(f"- Input: {input_path}")
    print(f"- Output: {output_path}")
    print(f"- Output boundary: {boundary}")
    print(f"- Rows converted: {len(fixture['transactions'])}")
    print(f"- Wallets: {len(fixture['wallets'])}")
    print(f"- Tokens: {len(fixture['tokens'])}")
    print(f"- Signature groups: {fixture['metadata']['signature_group_count']}")
    print(f"- Parser-limited rows: {summary.get('parser_limited_count', 0)}")
    print(f"- Parser limitation rows: {summary.get('parser_limitation_row_count', 0)}")
    print(f"- Browser provider calls: {fixture['metadata']['browser_provider_calls']}")
    print(f"- Provider keys included: {fixture['metadata']['provider_keys_included']}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    if manifest_path:
        print(f"- Manifest: {manifest_path}")
        print(f"- Manifest write: {'write' if args.write else 'dry-run'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
