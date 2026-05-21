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
    "swap_leg_group",
    "balance_delta_summary",
    "parser_confidence",
    "parser_limitations",
    "raw_reference",
]


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
    if event_type == "unknown_unsupported_event" and "unsupported event type" not in limitations:
        limitations.append("unsupported event type")
    if event_type == "parser_limited_event" and "parser-limited event" not in limitations:
        limitations.append("parser-limited event")
    source_wallet = str(first_present(row.get("source_wallet"), row.get("sourceWallet"), row.get("from"), row.get("source"))).strip()
    destination_wallet = str(first_present(row.get("destination_wallet"), row.get("destinationWallet"), row.get("to"), row.get("destination"), row.get("target"))).strip()
    confidence = row.get("parser_confidence", row.get("confidence", 0.5))
    try:
        confidence_value = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence_value = 0.5
    return {
        "signature": str(first_present(row.get("signature"), row.get("transaction_hash"), row.get("hash"), row.get("id"))).strip(),
        "slot": row.get("slot"),
        "timestamp": str(first_present(row.get("timestamp"), row.get("block_time"), row.get("time"))).strip(),
        "source_wallet": source_wallet,
        "destination_wallet": destination_wallet,
        "token_mint": str(first_present(row.get("token_mint"), row.get("tokenMint"), row.get("mint"), row.get("token"))).strip(),
        "amount": str(first_present(row.get("amount"), row.get("amount_display"), row.get("amountDisplay"), "0")).strip(),
        "transfer_direction": infer_direction(row, wallet),
        "outer_instruction_index": row.get("outer_instruction_index", row.get("outerInstructionIndex")),
        "inner_instruction_index": row.get("inner_instruction_index", row.get("innerInstructionIndex")),
        "program_id": str(first_present(row.get("program_id"), row.get("programId"), row.get("source_program"))).strip(),
        "event_type": event_type,
        "swap_leg_group": first_present(row.get("swap_leg_group"), row.get("swapLegGroup"), None),
        "balance_delta_summary": row.get("balance_delta_summary") if isinstance(row.get("balance_delta_summary"), dict) else {},
        "parser_confidence": confidence_value,
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


def build_normalized_cache_metadata(payload: dict[str, Any], wallet: str, row_count: int, parser_limited_count: int) -> dict[str, Any]:
    return {
        "provider": pick_cache_value(payload, "provider", default="none"),
        "chain": pick_cache_value(payload, "chain", default="solana"),
        "wallet": wallet,
        "cache_schema": "d309_normalized_cache_metadata_v1",
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
        "parser_limited_count": parser_limited_count,
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
    normalized = [normalize_row(row, index, wallet, str(input_path)) for index, row in enumerate(rows)]
    parser_limited_count = sum(1 for row in normalized if is_parser_limited(row))
    normalized_cache_metadata = build_normalized_cache_metadata(payload, wallet, len(normalized), parser_limited_count)
    return {
        "metadata": {
            "name": "CryptoPhotonic normalized transaction review file",
            "version": "d309_normalized_transactions_v1",
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
        "timestamp": row.get("timestamp", ""),
        "source_wallet": row.get("source_wallet", ""),
        "destination_wallet": row.get("destination_wallet", ""),
        "token_mint": row.get("token_mint", ""),
        "amount": row.get("amount", "0"),
        "transfer_direction": row.get("transfer_direction", "unknown"),
        "event_type": row.get("event_type", "unknown_unsupported_event"),
        "swap_leg_group": row.get("swap_leg_group"),
        "parser_confidence": row.get("parser_confidence", 0.5),
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
    if cache_metadata.get("full_history_loaded"):
        score = 84
    if cache_metadata.get("more_available"):
        limitations.append("provider reported an additional pagination cursor")
        score = min(score, 58)
    if not cache_metadata.get("cursor_exhausted"):
        limitations.append("cursor exhaustion not proven")
    if parser_limited_count:
        limitations.append("parser-limited events included")
        score = max(25, score - min(18, parser_limited_count * 4))
    if not limitations:
        limitations.append("bounded normalized cache only; not proof of wallet identity or intent")
    level = "bounded" if score >= 80 else "partial" if score >= 50 else "limited"
    return {"score": score, "level": level, "limitations": limitations}


def build_replay_cache(normalized: dict[str, Any], source_file: Path) -> dict[str, Any]:
    metadata = as_dict(normalized.get("metadata"))
    cache_metadata = as_dict(normalized.get("normalized_cache_metadata"))
    rows = [row for row in as_list(normalized.get("normalized_transactions")) if isinstance(row, dict)]
    wallet = str(first_present(metadata.get("wallet"), cache_metadata.get("wallet"))).strip()
    parser_limited_count = sum(1 for row in rows if is_parser_limited(row))
    confidence = continuity_confidence(cache_metadata, parser_limited_count)
    events = [replay_event(row, index + 1) for index, row in enumerate(rows)]
    return {
        "metadata": {
            "name": "CryptoPhotonic replay cache",
            "version": "d309_replay_cache_v1",
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
            "cache_schema": "d309_replay_cache_v1",
            "cache_state": "generated_replay_cache",
            "source_rows": len(rows),
            "normalized_event_count": len(rows),
            "parser_limited_count": parser_limited_count,
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
    parser_limited = sum(1 for row in normalized["normalized_transactions"] if row["event_type"] == "parser_limited_event" or row["parser_limitations"])
    replay_cache = build_replay_cache(normalized, input_path)

    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
    if args.write_replay_cache:
        replay_cache_output_path.parent.mkdir(parents=True, exist_ok=True)
        replay_cache_output_path.write_text(json.dumps(replay_cache, indent=2) + "\n", encoding="utf-8")

    print("CryptoPhotonic transaction normalizer")
    print(f"- Input: {input_path}")
    print(f"- Rows read: {len(rows)}")
    print(f"- Rows normalized: {len(normalized['normalized_transactions'])}")
    print(f"- Parser-limited/limited rows: {parser_limited}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    print(f"- Output: {output_path}")
    print(f"- Replay cache write: {'write' if args.write_replay_cache else 'dry-run'}")
    print(f"- Replay cache output: {replay_cache_output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
