#!/usr/bin/env python3
"""Export CryptoPhotonic normalized transaction JSON to review CSV."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "crypto"
DEFAULT_INPUT = DEFAULT_DATA_DIR / "sample_wallet_history.json"
DEFAULT_OUTPUT = DEFAULT_DATA_DIR / "crypto_review_export.sample.csv"

CSV_FIELDS = [
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
    "parser_confidence",
    "parser_confidence_reason",
    "parser_limitations",
    "raw_reference",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export normalized CryptoPhotonic transaction JSON to CSV. Defaults to dry-run and writes nothing.",
    )
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Normalized JSON input path.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="CSV output path. Default is under data/crypto/.")
    parser.add_argument("--write", action="store_true", help="Write CSV. Without this flag the command is dry-run only.")
    parser.add_argument("--xlsx", action="store_true", help="Also write XLSX when openpyxl is installed.")
    return parser.parse_args()


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return path.resolve()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def extract_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = as_list(payload.get("normalized_transactions"))
    if rows:
        return [row for row in rows if isinstance(row, dict)]
    window_rows: list[dict[str, Any]] = []
    for window in as_list(payload.get("replay_windows")):
        if isinstance(window, dict):
            window_rows.extend(row for row in as_list(window.get("events")) if isinstance(row, dict))
    return window_rows


def serialize_cell(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    if value is None:
        return ""
    return str(value)


def clean_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def amount_is_missing(row: dict[str, Any]) -> bool:
    amount = clean_text(row.get("amount")).lower()
    limitations = [str(item).lower() for item in as_list(row.get("parser_limitations"))]
    return amount in {"", "none", "null", "nan"} or any("amount unavailable" in item or "missing amount" in item for item in limitations)


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, int]:
    event_type_counts: dict[str, int] = {}
    signatures = {row.get("signature_group_id") or row.get("signature") for row in rows if row.get("signature_group_id") or row.get("signature")}
    for row in rows:
        event_type = clean_text(row.get("event_type")) or "unknown_unsupported_event"
        event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
    return {
        "signature_group_count": len(signatures),
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
    }


def to_csv_rows(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {field: serialize_cell(row.get(field, "")) for field in CSV_FIELDS}
        for row in rows
    ]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def maybe_write_xlsx(csv_path: Path, rows: list[dict[str, str]]) -> str:
    try:
        from openpyxl import Workbook  # type: ignore
    except ImportError:
        return "openpyxl unavailable; XLSX skipped"

    xlsx_path = csv_path.with_suffix(".xlsx")
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Crypto Review"
    sheet.append(CSV_FIELDS)
    for row in rows:
        sheet.append([row.get(field, "") for field in CSV_FIELDS])
    workbook.save(xlsx_path)
    return f"XLSX written: {xlsx_path}"


def main() -> int:
    args = parse_args()
    input_path = resolve_path(args.input)
    output_path = resolve_path(args.output)
    payload = load_json(input_path)
    rows = extract_rows(payload)
    csv_rows = to_csv_rows(rows)
    summary = summarize_rows(rows)

    xlsx_status = "not requested"
    if args.write:
        write_csv(output_path, csv_rows)
        if args.xlsx:
            xlsx_status = maybe_write_xlsx(output_path, csv_rows)
    elif args.xlsx:
        xlsx_status = "dry-run; XLSX not written"

    print("CryptoPhotonic review export")
    print(f"- Input: {input_path}")
    print(f"- CSV rows: {len(csv_rows)}")
    print(f"- Signatures grouped: {summary['signature_group_count']}")
    print(f"- Direct transfers: {summary['direct_transfer_count']}")
    print(f"- Multi-leg transfers: {summary['multi_leg_transfer_count']}")
    print(f"- Swap-like flows: {summary['swap_like_flow_count']}")
    print(f"- Parser-limited rows: {summary['parser_limited_count']}")
    print(f"- Parser limitation rows: {summary['parser_limitation_row_count']}")
    print(f"- Unknown/unsupported rows: {summary['unknown_unsupported_count']}")
    print(f"- Missing amount/source/destination/mint: {summary['missing_amount_count']}/{summary['missing_source_count']}/{summary['missing_destination_count']}/{summary['missing_mint_count']}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    print(f"- CSV output: {output_path}")
    print(f"- XLSX: {xlsx_status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
