#!/usr/bin/env python3
"""Normalize local CryptoPhotonic transaction JSON and build replay caches."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "crypto"
DEFAULT_INPUT = DEFAULT_DATA_DIR / "sample_wallet_history.json"
DEFAULT_OUTPUT = DEFAULT_DATA_DIR / "normalized_wallet_history.sample.json"
DEFAULT_REPLAY_CACHE_OUTPUT = DEFAULT_DATA_DIR / "replay_cache.generated.json"

SCHEMA_FIELDS = [
    "signature",
    "signature_group_id",
    "signature_group_index",
    "signature_group_size",
    "transfer_leg_index",
    "transfer_leg_count",
    "slot",
    "timestamp",
    "source_wallet",
    "destination_wallet",
    "token_mint",
    "amount",
    "transfer_direction",
    "outer_instruction_index",
    "inner_instruction_index",
    "program_id",
    "event_type",
    "multi_leg_signature",
    "swap_leg_group",
    "balance_delta_summary",
    "parser_confidence",
    "parser_confidence_reason",
    "parser_limitations",
    "raw_reference",
]

TRANSFER_EVENT_TYPES = {"direct_transfer", "multi_leg_transfer", "swap_like_flow"}
MISSING_AMOUNT_MARKERS = {"", "none", "null", "nan"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize local wallet history JSON. Defaults to dry-run and writes nothing.",
    )
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Input JSON path.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path. Default is under data/crypto/.")
    parser.add_argument("--replay-cache-output", default=str(DEFAULT_REPLAY_CACHE_OUTPUT), help="Replay cache JSON path used with --write-replay-cache.")
    parser.add_argument("--write", action="store_true", help="Write normalized JSON. Without this flag the command is dry-run only.")
    parser.add_argument("--write-replay-cache", action="store_true", help="Write a replay cache generated from normalized rows.")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return path.resolve()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return ""


def append_unique(values: list[Any], item: str) -> None:
    if item and item not in values:
        values.append(item)


def clean_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def amount_is_missing(value: Any, limitations: list[Any] | None = None) -> bool:
    text = clean_text(value).lower()
    if text in MISSING_AMOUNT_MARKERS:
        return True
    lowered_limitations = [str(item).lower() for item in limitations or []]
    return any("amount unavailable" in item or "missing amount" in item for item in lowered_limitations)


def row_has_transfer_leg(row: dict[str, Any]) -> bool:
    return any(
        row.get(field) not in (None, "")
        for field in ("source_wallet", "destination_wallet", "token_mint", "amount")
    )


def normalize_event_type(row: dict[str, Any]) -> str:
    raw = str(first_present(row.get("event_type"), row.get("transaction_type"), row.get("type"), "unknown_unsupported_event")).strip().lower()
    raw = raw.replace("-", "_").replace(" ", "_")
    if raw in {"transfer", "token_transfer", "native_transfer", "direct"}:
        return "direct_transfer"
    if raw in {"multi_leg", "multi_leg_transfer", "routed_transfer"}:
        return "multi_leg_transfer"
    if raw in {"swap", "swap_like", "swap_like_flow"}:
        return "swap_like_flow"
    if raw in {"parser_limited", "parser_limited_event", "limited"}:
        return "parser_limited_event"
    if raw in {"direct_transfer", "multi_leg_transfer", "unknown_unsupported_event"}:
        return raw
    return "unknown_unsupported_event"


def infer_direction(row: dict[str, Any], wallet: str) -> str:
    explicit = str(first_present(row.get("transfer_direction"), row.get("direction"))).strip().lower()
    if explicit:
        return explicit
    source = str(first_present(row.get("source_wallet"), row.get("sourceWallet"), row.get("from"))).strip()
    destination = str(first_present(row.get("destination_wallet"), row.get("destinationWallet"), row.get("to"))).strip()
    if wallet and source == wallet and destination == wallet:
        return "self"
    if wallet and source == wallet:
        return "outbound"
    if wallet and destination == wallet:
        return "inbound"
    return "unknown"


def normalize_row(row: dict[str, Any], index: int, wallet: str, source_file: str) -> dict[str, Any]:
    event_type = normalize_event_type(row)
    limitations = as_list(row.get("parser_limitations"))
    confidence_reasons: list[str] = []
    if event_type == "unknown_unsupported_event":
        append_unique(limitations, "unsupported event type")
        confidence_reasons.append("unsupported event shape")
    elif event_type == "parser_limited_event":
        append_unique(limitations, "parser-limited event")
        confidence_reasons.append("parser-limited event")
    else:
        confidence_reasons.append(f"recognized {event_type}")
    source_wallet = clean_text(first_present(row.get("source_wallet"), row.get("sourceWallet"), row.get("from"), row.get("source")))
    destination_wallet = clean_text(first_present(row.get("destination_wallet"), row.get("destinationWallet"), row.get("to"), row.get("destination"), row.get("target")))
    token_mint = clean_text(first_present(row.get("token_mint"), row.get("tokenMint"), row.get("mint"), row.get("token")))
    amount = clean_text(first_present(row.get("amount"), row.get("amount_display"), row.get("amountDisplay")))
    if not source_wallet:
        append_unique(limitations, "source wallet unavailable")
        confidence_reasons.append("missing source wallet")
    if not destination_wallet:
        append_unique(limitations, "destination wallet unavailable")
        confidence_reasons.append("missing destination wallet")
    if not token_mint:
        append_unique(limitations, "token mint unavailable")
        confidence_reasons.append("missing token mint")
    if amount_is_missing(amount, limitations):
        append_unique(limitations, "amount unavailable")
        confidence_reasons.append("missing amount")
    explicit_reason = clean_text(first_present(row.get("parser_confidence_reason"), row.get("confidence_reason")))
    if explicit_reason:
        confidence_reasons.insert(0, explicit_reason)
    confidence = row.get("parser_confidence", row.get("confidence", 0.78 if event_type == "direct_transfer" else 0.62))
    try:
        confidence_value = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence_value = 0.5
        confidence_reasons.append("invalid confidence value supplied")
    if event_type == "unknown_unsupported_event":
        confidence_value = min(confidence_value, 0.45)
    if event_type == "parser_limited_event":
        confidence_value = min(confidence_value, 0.35)
    missing_count = sum(
        1
        for missing in (
            not source_wallet,
            not destination_wallet,
            not token_mint,
            amount_is_missing(amount, limitations),
        )
        if missing
    )
    if missing_count:
        confidence_value = min(confidence_value, max(0.2, 0.76 - (missing_count * 0.11)))
    return {
        "signature": clean_text(first_present(row.get("signature"), row.get("transaction_hash"), row.get("hash"), row.get("id"))),
        "signature_group_id": None,
        "signature_group_index": None,
        "signature_group_size": 1,
        "transfer_leg_index": None,
        "transfer_leg_count": 1 if row_has_transfer_leg(row) else 0,
        "slot": row.get("slot"),
        "timestamp": clean_text(first_present(row.get("timestamp"), row.get("block_time"), row.get("time"))),
        "source_wallet": source_wallet,
        "destination_wallet": destination_wallet,
        "token_mint": token_mint,
        "amount": amount,
        "transfer_direction": infer_direction(row, wallet),
        "outer_instruction_index": row.get("outer_instruction_index", row.get("outerInstructionIndex")),
        "inner_instruction_index": row.get("inner_instruction_index", row.get("innerInstructionIndex")),
        "program_id": clean_text(first_present(row.get("program_id"), row.get("programId"), row.get("source_program"))),
        "event_type": event_type,
        "multi_leg_signature": False,
        "swap_leg_group": first_present(row.get("swap_leg_group"), row.get("swapLegGroup"), None),
        "balance_delta_summary": row.get("balance_delta_summary") if isinstance(row.get("balance_delta_summary"), dict) else {},
        "parser_confidence": confidence_value,
        "parser_confidence_reason": "; ".join(dict.fromkeys(confidence_reasons)),
        "parser_limitations": limitations,
        "raw_reference": {
            **as_dict(row.get("raw_reference")),
            "source_file": source_file,
            "raw_payload_stored": False,
            "record_index": index,
            "provider_key_stored": False,
            "request_url_stored": False,
            "request_headers_stored": False,
        },
    }


def is_parser_limited(row: dict[str, Any]) -> bool:
    limitations = [str(item).lower() for item in as_list(row.get("parser_limitations"))]
    return row.get("event_type") == "parser_limited_event" or any("parser-limited" in item for item in limitations)


def signature_group_key(row: dict[str, Any], index: int) -> str:
    signature = clean_text(row.get("signature"))
    return f"signature:{signature}" if signature else f"unsigned-row:{index}"


def append_reason(row: dict[str, Any], reason: str) -> None:
    existing = clean_text(row.get("parser_confidence_reason"))
    parts = [part.strip() for part in existing.split(";") if part.strip()]
    if reason not in parts:
        parts.append(reason)
    row["parser_confidence_reason"] = "; ".join(parts)


def cap_confidence(row: dict[str, Any], cap: float, reason: str) -> None:
    try:
        current = float(row.get("parser_confidence", 0.5))
    except (TypeError, ValueError):
        current = 0.5
    row["parser_confidence"] = max(0.0, min(1.0, min(current, cap)))
    append_reason(row, reason)


def add_limitation(row: dict[str, Any], limitation: str) -> None:
    limitations = as_list(row.get("parser_limitations"))
    append_unique(limitations, limitation)
    row["parser_limitations"] = limitations


def visible_swap_candidates(legs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    outbound: list[dict[str, Any]] = []
    inbound: list[dict[str, Any]] = []
    for leg in legs:
        if not leg.get("source_wallet") or not leg.get("destination_wallet") or not leg.get("token_mint") or amount_is_missing(leg.get("amount"), as_list(leg.get("parser_limitations"))):
            continue
        direction = clean_text(leg.get("transfer_direction")).lower()
        if direction == "outbound":
            outbound.append(leg)
        elif direction == "inbound":
            inbound.append(leg)
    return outbound, inbound


def assign_swap_like_groups(group_rows: list[dict[str, Any]], signature: str) -> bool:
    legs = [row for row in group_rows if row_has_transfer_leg(row)]
    outbound, inbound = visible_swap_candidates(legs)
    has_swap_hint = any(row.get("event_type") == "swap_like_flow" for row in group_rows)
    if not outbound or not inbound:
        for row in group_rows:
            if row.get("event_type") == "swap_like_flow":
                row["event_type"] = "multi_leg_transfer" if len(legs) > 1 else "direct_transfer"
                add_limitation(row, "swap-like provider label lacked visible inbound/outbound leg evidence")
                add_limitation(row, "route or liquidity path not proven")
                cap_confidence(row, 0.52, "swap-like label downgraded because paired legs were not visible")
        return False
    visible_mints = {clean_text(leg.get("token_mint")) for leg in outbound + inbound if leg.get("token_mint")}
    if not has_swap_hint and len(visible_mints) < 2:
        return False

    grouped = sorted(outbound + inbound, key=lambda item: (item.get("outer_instruction_index") is None, item.get("outer_instruction_index") or -1, item.get("inner_instruction_index") is None, item.get("inner_instruction_index") or -1, item.get("raw_reference", {}).get("record_index", 0)))
    group_id = f"{signature}:swap:0" if signature else "unsigned:swap:0"
    for leg in grouped:
        leg["event_type"] = "swap_like_flow"
        leg["swap_leg_group"] = group_id
        add_limitation(leg, "swap-like flow inferred from visible inbound/outbound legs")
        add_limitation(leg, "route or liquidity path not proven")
        append_reason(leg, "paired inbound/outbound legs visible under same signature")
        cap_confidence(leg, 0.72, "swap route inferred, not provider-proven")
    return True


def annotate_signature_groups(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        grouped.setdefault(signature_group_key(row, index), []).append(row)

    for group_key, group_rows in grouped.items():
        signature = clean_text(group_rows[0].get("signature"))
        group_size = len(group_rows)
        transfer_legs = [row for row in group_rows if row_has_transfer_leg(row)]
        transfer_leg_count = len(transfer_legs)
        swap_evidence = assign_swap_like_groups(group_rows, signature)
        for group_index, row in enumerate(group_rows, start=1):
            row["signature_group_id"] = group_key
            row["signature_group_index"] = group_index
            row["signature_group_size"] = group_size
            row["transfer_leg_count"] = transfer_leg_count
            row["multi_leg_signature"] = transfer_leg_count > 1
        for leg_index, row in enumerate(transfer_legs, start=1):
            row["transfer_leg_index"] = leg_index
            if transfer_leg_count > 1:
                add_limitation(row, "multiple transfer legs share this signature")
                append_reason(row, "multi-leg signature grouping")
                if row.get("event_type") == "direct_transfer" and not swap_evidence:
                    row["event_type"] = "multi_leg_transfer"
                    cap_confidence(row, 0.82, "multi-leg transfer, route not synthesized")
        for row in group_rows:
            if row.get("event_type") == "multi_leg_transfer" and not swap_evidence:
                add_limitation(row, "related legs grouped by signature only; route not synthesized")
    return rows


def extract_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = as_list(payload.get("normalized_transactions"))
    if rows:
        return [row for row in rows if isinstance(row, dict)]
    rows = as_list(payload.get("transactions"))
    if rows:
        return [row for row in rows if isinstance(row, dict)]
    window_rows: list[dict[str, Any]] = []
    for window in as_list(payload.get("replay_windows")):
        if isinstance(window, dict):
            window_rows.extend(row for row in as_list(window.get("events")) if isinstance(row, dict))
    return window_rows


def pick_cache_value(payload: dict[str, Any], *keys: str, default: Any = None) -> Any:
    normalized_cache = as_dict(payload.get("normalized_cache_metadata"))
    cache = as_dict(payload.get("cache"))
    metadata = as_dict(payload.get("metadata"))
    for key in keys:
        for source in (normalized_cache, cache, metadata):
            value = source.get(key)
            if value not in (None, ""):
                return value
    return default


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_type_counts: dict[str, int] = {}
    signatures = {row.get("signature_group_id") for row in rows if row.get("signature_group_id")}
    missing_amount = 0
    missing_source = 0
    missing_destination = 0
    missing_mint = 0
    for row in rows:
        event_type = clean_text(row.get("event_type")) or "unknown_unsupported_event"
        event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
        if amount_is_missing(row.get("amount"), as_list(row.get("parser_limitations"))):
            missing_amount += 1
        if not row.get("source_wallet"):
            missing_source += 1
        if not row.get("destination_wallet"):
            missing_destination += 1
        if not row.get("token_mint"):
            missing_mint += 1
    parser_limited = sum(1 for row in rows if is_parser_limited(row))
    return {
        "rows_read": len(rows),
        "signature_group_count": len(signatures),
        "direct_transfer_count": event_type_counts.get("direct_transfer", 0),
        "multi_leg_transfer_count": event_type_counts.get("multi_leg_transfer", 0),
        "swap_like_flow_count": event_type_counts.get("swap_like_flow", 0),
        "parser_limited_count": parser_limited,
        "parser_limitation_row_count": sum(1 for row in rows if row.get("parser_limitations")),
        "unknown_unsupported_count": event_type_counts.get("unknown_unsupported_event", 0),
        "missing_amount_count": missing_amount,
        "missing_source_count": missing_source,
        "missing_destination_count": missing_destination,
        "missing_mint_count": missing_mint,
        "event_type_counts": event_type_counts,
    }


def build_normalized_cache_metadata(payload: dict[str, Any], wallet: str, row_count: int, summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": pick_cache_value(payload, "provider", default="none"),
        "chain": pick_cache_value(payload, "chain", default="solana"),
        "wallet": wallet,
        "cache_schema": "d319_normalized_cache_metadata_v1",
        "cache_state": pick_cache_value(payload, "cache_state", default="normalized"),
        "source": pick_cache_value(payload, "source", default="local_normalizer"),
        "cursor": pick_cache_value(payload, "cursor", "current_cursor"),
        "current_cursor": pick_cache_value(payload, "current_cursor", "cursor"),
        "next_cursor": pick_cache_value(payload, "next_cursor"),
        "cursor_type": pick_cache_value(payload, "cursor_type", default="unknown"),
        "cursor_field": pick_cache_value(payload, "cursor_field", default="unknown"),
        "pagination_supported": bool(pick_cache_value(payload, "pagination_supported", default=False)),
        "deterministic_pagination_support": bool(pick_cache_value(payload, "deterministic_pagination_support", default=False)),
        "requested_limit": pick_cache_value(payload, "requested_limit"),
        "returned_count": pick_cache_value(payload, "returned_count", default=row_count),
        "source_rows": row_count,
        "normalized_event_count": row_count,
        "signature_group_count": summary.get("signature_group_count", 0),
        "parser_limited_count": summary.get("parser_limited_count", 0),
        "parser_limitation_row_count": summary.get("parser_limitation_row_count", 0),
        "event_type_counts": summary.get("event_type_counts", {}),
        "missing_field_counts": {
            "amount": summary.get("missing_amount_count", 0),
            "source_wallet": summary.get("missing_source_count", 0),
            "destination_wallet": summary.get("missing_destination_count", 0),
            "token_mint": summary.get("missing_mint_count", 0),
        },
        "more_available": bool(pick_cache_value(payload, "more_available", default=False)),
        "cursor_exhausted": bool(pick_cache_value(payload, "cursor_exhausted", default=False)),
        "full_history_loaded": bool(pick_cache_value(payload, "full_history_loaded", default=False)),
        "raw_payload_stored": False,
        "provider_keys_included": False,
        "browser_provider_calls": False,
        "provider_request_url_included": False,
        "provider_headers_included": False,
    }


def build_output(payload: dict[str, Any], rows: list[dict[str, Any]], input_path: Path) -> dict[str, Any]:
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    wallet = str(first_present(metadata.get("wallet"), metadata.get("tracked_wallet"))).strip()
    normalized = annotate_signature_groups([normalize_row(row, index, wallet, str(input_path)) for index, row in enumerate(rows)])
    summary = summarize_rows(normalized)
    normalized_cache_metadata = build_normalized_cache_metadata(payload, wallet, len(normalized), summary)
    return {
        "metadata": {
            "name": "CryptoPhotonic normalized transaction review file",
            "version": "d319_normalized_transactions_v1",
            "sample": metadata.get("sample", False),
            "fixture": metadata.get("fixture", False),
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "wallet": wallet,
            "source_file": str(input_path),
            "generated_at": utc_now(),
            "schema_fields": SCHEMA_FIELDS,
        },
        "normalized_cache_metadata": normalized_cache_metadata,
        "parser_quality_summary": summary,
        "normalized_transactions": normalized,
    }


def replay_cache_id(wallet: str, source_file: str, rows: list[dict[str, Any]]) -> str:
    seed = json.dumps(
        {
            "wallet": wallet,
            "source_file": source_file,
            "signatures": [row.get("signature") for row in rows],
            "count": len(rows),
        },
        sort_keys=True,
    )
    return f"replay-cache-d309-{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:16]}"


def replay_event(row: dict[str, Any], step: int) -> dict[str, Any]:
    return {
        "step": step,
        "signature": row.get("signature", ""),
        "signature_group_id": row.get("signature_group_id"),
        "signature_group_index": row.get("signature_group_index"),
        "signature_group_size": row.get("signature_group_size"),
        "transfer_leg_index": row.get("transfer_leg_index"),
        "transfer_leg_count": row.get("transfer_leg_count"),
        "timestamp": row.get("timestamp", ""),
        "source_wallet": row.get("source_wallet", ""),
        "destination_wallet": row.get("destination_wallet", ""),
        "token_mint": row.get("token_mint", ""),
        "amount": row.get("amount", ""),
        "transfer_direction": row.get("transfer_direction", "unknown"),
        "event_type": row.get("event_type", "unknown_unsupported_event"),
        "multi_leg_signature": row.get("multi_leg_signature", False),
        "swap_leg_group": row.get("swap_leg_group"),
        "parser_confidence": row.get("parser_confidence", 0.5),
        "parser_confidence_reason": row.get("parser_confidence_reason", ""),
        "parser_limitations": as_list(row.get("parser_limitations")),
        "raw_reference": {
            **as_dict(row.get("raw_reference")),
            "raw_payload_stored": False,
            "provider_key_stored": False,
            "request_url_stored": False,
            "request_headers_stored": False,
        },
    }


def continuity_confidence(cache_metadata: dict[str, Any], parser_limited_count: int) -> dict[str, Any]:
    limitations: list[str] = []
    score = 72 if cache_metadata.get("cursor_exhausted") else 54
    reasons: list[str] = []
    if cache_metadata.get("full_history_loaded"):
        score = 84
        reasons.append("cache metadata reports full history loaded")
    if cache_metadata.get("more_available"):
        limitations.append("provider reported an additional pagination cursor")
        reasons.append("additional cursor remains available")
        score = min(score, 58)
    if not cache_metadata.get("cursor_exhausted"):
        limitations.append("cursor exhaustion not proven")
        reasons.append("cursor exhaustion not proven")
    if parser_limited_count:
        limitations.append("parser-limited events included")
        reasons.append("parser limitations present in replay window")
        score = max(25, score - min(18, parser_limited_count * 4))
    if not limitations:
        limitations.append("bounded normalized cache only; not proof of wallet identity or intent")
    if not reasons:
        reasons.append("bounded normalized cache with no parser-limited rows")
    level = "bounded" if score >= 80 else "partial" if score >= 50 else "limited"
    return {"score": score, "level": level, "reason": "; ".join(reasons), "limitations": limitations}


def build_replay_cache(normalized: dict[str, Any], source_file: Path) -> dict[str, Any]:
    metadata = as_dict(normalized.get("metadata"))
    cache_metadata = as_dict(normalized.get("normalized_cache_metadata"))
    rows = [row for row in as_list(normalized.get("normalized_transactions")) if isinstance(row, dict)]
    wallet = str(first_present(metadata.get("wallet"), cache_metadata.get("wallet"))).strip()
    summary = summarize_rows(rows)
    parser_limited_count = int(summary.get("parser_limited_count", 0))
    confidence = continuity_confidence(cache_metadata, parser_limited_count)
    events = [replay_event(row, index + 1) for index, row in enumerate(rows)]
    return {
        "metadata": {
            "name": "CryptoPhotonic replay cache",
            "version": "d319_replay_cache_v1",
            "sample": metadata.get("sample", False),
            "fixture": metadata.get("fixture", False),
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "source": "local_normalizer_replay_cache_builder",
            "chain": cache_metadata.get("chain", "solana"),
            "wallet": wallet,
            "source_file": str(source_file),
            "generated_at": utc_now(),
        },
        "cache": {
            "cache_id": replay_cache_id(wallet, str(source_file), rows),
            "cache_schema": "d319_replay_cache_v1",
            "cache_state": "generated_replay_cache",
            "source_rows": len(rows),
            "normalized_event_count": len(rows),
            "signature_group_count": summary.get("signature_group_count", 0),
            "parser_limited_count": parser_limited_count,
            "parser_limitation_row_count": summary.get("parser_limitation_row_count", 0),
            "event_type_counts": summary.get("event_type_counts", {}),
            "missing_field_counts": {
                "amount": summary.get("missing_amount_count", 0),
                "source_wallet": summary.get("missing_source_count", 0),
                "destination_wallet": summary.get("missing_destination_count", 0),
                "token_mint": summary.get("missing_mint_count", 0),
            },
            "cursor": cache_metadata.get("cursor"),
            "current_cursor": cache_metadata.get("current_cursor"),
            "next_cursor": cache_metadata.get("next_cursor"),
            "cursor_type": cache_metadata.get("cursor_type", "unknown"),
            "cursor_field": cache_metadata.get("cursor_field", "unknown"),
            "pagination_supported": cache_metadata.get("pagination_supported", False),
            "deterministic_pagination_support": cache_metadata.get("deterministic_pagination_support", False),
            "more_available": cache_metadata.get("more_available", False),
            "cursor_exhausted": cache_metadata.get("cursor_exhausted", False),
            "full_history_loaded": cache_metadata.get("full_history_loaded", False),
            "raw_payload_stored": False,
            "no_browser_provider_calls": True,
            "provider_keys_included": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
        },
        "parser_quality_summary": summary,
        "replay_windows": [
            {
                "window_id": f"{replay_cache_id(wallet, str(source_file), rows)}-window-001",
                "window_label": "Replay window 1/1",
                "current_window_index": 1,
                "total_windows": 1,
                "ordinal_start": 1 if events else 0,
                "ordinal_end": len(events),
                "partial": not bool(cache_metadata.get("full_history_loaded")),
                "continuity_confidence": confidence,
                "events": events,
            }
        ],
    }


def main() -> int:
    args = parse_args()
    input_path = resolve_path(args.input)
    output_path = resolve_path(args.output)
    replay_cache_output_path = resolve_path(args.replay_cache_output)
    payload = load_json(input_path)
    rows = extract_rows(payload)
    normalized = build_output(payload, rows, input_path)
    summary = summarize_rows(normalized["normalized_transactions"])
    replay_cache = build_replay_cache(normalized, input_path)

    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
    if args.write_replay_cache:
        replay_cache_output_path.parent.mkdir(parents=True, exist_ok=True)
        replay_cache_output_path.write_text(json.dumps(replay_cache, indent=2) + "\n", encoding="utf-8")

    print("CryptoPhotonic transaction normalizer")
    print(f"- Input: {input_path}")
    print(f"- Rows read: {summary['rows_read']}")
    print(f"- Rows normalized: {len(normalized['normalized_transactions'])}")
    print(f"- Signatures grouped: {summary['signature_group_count']}")
    print(f"- Direct transfers: {summary['direct_transfer_count']}")
    print(f"- Multi-leg transfers: {summary['multi_leg_transfer_count']}")
    print(f"- Swap-like flows: {summary['swap_like_flow_count']}")
    print(f"- Parser-limited rows: {summary['parser_limited_count']}")
    print(f"- Parser limitation rows: {summary['parser_limitation_row_count']}")
    print(f"- Unknown/unsupported rows: {summary['unknown_unsupported_count']}")
    print(f"- Missing amount/source/destination/mint: {summary['missing_amount_count']}/{summary['missing_source_count']}/{summary['missing_destination_count']}/{summary['missing_mint_count']}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    print(f"- Output: {output_path}")
    print(f"- Replay cache write: {'write' if args.write_replay_cache else 'dry-run'}")
    print(f"- Replay cache output: {replay_cache_output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
