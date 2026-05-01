#!/usr/bin/env python3
"""Inspect cached SEC submissions JSON without fetching or writing data."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_LIMIT = 10
RECENT_FIELDS = (
    "form",
    "filingDate",
    "accessionNumber",
    "primaryDocument",
    "reportDate",
)


class InspectError(Exception):
    """Raised for clear inspector failures."""


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def parse_form_filter(value: str) -> tuple[str, ...]:
    forms = []
    seen = set()
    for raw_form in value.split(","):
        form = raw_form.strip().upper()
        if not form:
            continue
        if form not in seen:
            forms.append(form)
            seen.add(form)
    if not forms:
        raise argparse.ArgumentTypeError("--forms must include at least one form type.")
    return tuple(forms)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect one local cached SEC submissions JSON file. "
            "No network calls, no candidate creation, and no production graph writes."
        )
    )
    parser.add_argument(
        "--cache-file",
        required=True,
        help=(
            "Path to a local SEC submissions cache file, for example "
            "data/cache/sec/submissions_CIK0000320193.json."
        ),
    )
    parser.add_argument(
        "--ticker",
        help="Optional display label only. This does not perform lookup or network access.",
    )
    parser.add_argument(
        "--forms",
        type=parse_form_filter,
        help="Optional comma-separated form filter, for example 10-K,10-Q,8-K,S-1.",
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        default=DEFAULT_LIMIT,
        help=f"Maximum recent filings to print. Default: {DEFAULT_LIMIT}.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print summary fields without the recent filings detail list.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON summary to stdout only.",
    )
    return parser.parse_args(argv)


def scalar_to_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return str(value)


def load_cache_payload(cache_file: Path) -> dict[str, Any]:
    if not cache_file.exists():
        raise InspectError(f"cache file not found: {cache_file}")
    if not cache_file.is_file():
        raise InspectError(f"cache path is not a file: {cache_file}")

    try:
        with cache_file.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except json.JSONDecodeError as exc:
        raise InspectError(
            f"invalid JSON in cache file {cache_file}: {exc.msg} "
            f"at line {exc.lineno} column {exc.colno}"
        ) from exc
    except OSError as exc:
        raise InspectError(f"could not read cache file {cache_file}: {exc}") from exc

    if not isinstance(payload, dict):
        raise InspectError(
            "input does not look like SEC submissions JSON: top-level value is not an object"
        )
    return payload


def get_recent_payload(payload: dict[str, Any]) -> dict[str, Any]:
    filings = payload.get("filings")
    if not isinstance(filings, dict):
        raise InspectError(
            "input does not look like SEC submissions JSON: missing filings object"
        )

    recent = filings.get("recent")
    if not isinstance(recent, dict):
        raise InspectError(
            "input does not look like SEC submissions JSON: missing filings.recent object"
        )
    return recent


def list_value(
    recent: dict[str, Any],
    field: str,
    missing_fields: list[str],
    structure_warnings: list[str],
) -> list[Any]:
    field_path = f"filings.recent.{field}"
    if field not in recent:
        missing_fields.append(field_path)
        return []

    value = recent[field]
    if isinstance(value, list):
        return value

    structure_warnings.append(f"{field_path} is not a JSON array; field ignored")
    return []


def normalize_tickers(
    payload: dict[str, Any],
    missing_fields: list[str],
    structure_warnings: list[str],
) -> list[str]:
    if "tickers" not in payload:
        missing_fields.append("tickers")
        return []

    tickers = payload.get("tickers")
    if isinstance(tickers, list):
        return [
            ticker
            for ticker in (scalar_to_string(item) for item in tickers)
            if ticker is not None
        ]

    structure_warnings.append("tickers is not a JSON array; value coerced for display")
    ticker = scalar_to_string(tickers)
    return [ticker] if ticker else []


def collect_identity(
    payload: dict[str, Any],
    missing_fields: list[str],
    structure_warnings: list[str],
) -> tuple[str | None, str | None, list[str]]:
    cik = scalar_to_string(payload.get("cik"))
    name = scalar_to_string(payload.get("name"))

    for field in ("cik", "name"):
        if field not in payload or scalar_to_string(payload.get(field)) is None:
            missing_fields.append(field)

    tickers = normalize_tickers(payload, missing_fields, structure_warnings)
    if "tickers" in payload and not tickers:
        missing_fields.append("tickers")

    return cik, name, tickers


def collect_recent_records(
    recent: dict[str, Any],
    missing_fields: list[str],
    structure_warnings: list[str],
) -> tuple[list[dict[str, str | None]], dict[str, int]]:
    values_by_field = {
        field: list_value(recent, field, missing_fields, structure_warnings)
        for field in RECENT_FIELDS
    }
    lengths_by_field = {
        field: len(values)
        for field, values in values_by_field.items()
    }
    nonzero_lengths = {
        field: length
        for field, length in lengths_by_field.items()
        if length > 0
    }
    if len(set(nonzero_lengths.values())) > 1:
        detail = ", ".join(
            f"{field}={length}" for field, length in sorted(nonzero_lengths.items())
        )
        structure_warnings.append(f"filings.recent arrays have different lengths: {detail}")

    record_count = max(lengths_by_field.values(), default=0)
    records: list[dict[str, str | None]] = []
    for index in range(record_count):
        record = {}
        for field in RECENT_FIELDS:
            field_values = values_by_field[field]
            value = field_values[index] if index < len(field_values) else None
            record[field] = scalar_to_string(value)
        records.append(record)

    return records, lengths_by_field


def form_for_count(record: dict[str, str | None]) -> str:
    form = record.get("form")
    return form.upper() if form else "[missing]"


def record_matches_forms(
    record: dict[str, str | None],
    forms_filter: tuple[str, ...] | None,
) -> bool:
    if forms_filter is None:
        return True
    form = record.get("form")
    return form is not None and form.upper() in forms_filter


def latest_filing_date(records: list[dict[str, str | None]]) -> str | None:
    dates = [
        filing_date
        for filing_date in (record.get("filingDate") for record in records)
        if filing_date
    ]
    if not dates:
        return None
    return max(dates)


def build_summary(
    *,
    cache_file: Path,
    ticker_label: str | None,
    forms_filter: tuple[str, ...] | None,
    limit: int,
    summary_only: bool,
) -> dict[str, Any]:
    payload = load_cache_payload(cache_file)
    recent = get_recent_payload(payload)

    missing_fields: list[str] = []
    structure_warnings: list[str] = []
    cik, name, tickers = collect_identity(payload, missing_fields, structure_warnings)
    records, recent_field_lengths = collect_recent_records(
        recent,
        missing_fields,
        structure_warnings,
    )
    matching_records = [
        record for record in records if record_matches_forms(record, forms_filter)
    ]
    breakdown = Counter(form_for_count(record) for record in matching_records)
    sorted_breakdown = {
        form: count
        for form, count in sorted(
            breakdown.items(),
            key=lambda item: (-item[1], item[0]),
        )
    }

    return {
        "cache_file": str(cache_file),
        "ticker_label": ticker_label,
        "looks_like_sec_submissions_json": True,
        "cik": cik,
        "name": name,
        "tickers": tickers,
        "forms_filter": list(forms_filter) if forms_filter else None,
        "recent_filing_count": len(records),
        "matching_recent_filing_count": len(matching_records),
        "recent_field_lengths": recent_field_lengths,
        "form_breakdown": sorted_breakdown,
        "latest_filing_date": latest_filing_date(matching_records),
        "latest_filing_date_all_recent": latest_filing_date(records),
        "missing_fields": missing_fields,
        "structure_warnings": structure_warnings,
        "recent_filings": [] if summary_only else matching_records[:limit],
        "summary_only": summary_only,
        "limit": limit,
        "safety": {
            "network_calls": 0,
            "output_files_created": 0,
            "candidate_writes": 0,
            "production_writes": 0,
        },
    }


def display_value(value: str | None) -> str:
    return value if value else "missing"


def print_human(summary: dict[str, Any]) -> None:
    print("SEC submissions cache inspector")
    print("================================")
    print(f"Cache file: {summary['cache_file']}")
    if summary.get("ticker_label"):
        print(f"Ticker label: {summary['ticker_label']}")
    print("Input shape: SEC submissions JSON")
    print(f"CIK: {display_value(summary.get('cik'))}")
    print(f"Name: {display_value(summary.get('name'))}")
    tickers = summary.get("tickers") or []
    print(f"Tickers: {', '.join(tickers) if tickers else 'missing'}")
    print(f"Recent filing count: {summary['recent_filing_count']}")
    if summary.get("forms_filter"):
        print(f"Forms filter: {', '.join(summary['forms_filter'])}")
        print(f"Matching recent filing count: {summary['matching_recent_filing_count']}")
    else:
        print("Forms filter: none")
    print(f"Latest filing date: {display_value(summary.get('latest_filing_date'))}")

    print()
    print("Form breakdown")
    print("--------------")
    if summary["form_breakdown"]:
        for form, count in summary["form_breakdown"].items():
            print(f"- {form}: {count}")
    else:
        print("- none")

    print()
    print("Missing fields")
    print("--------------")
    if summary["missing_fields"]:
        for field in summary["missing_fields"]:
            print(f"- {field}")
    else:
        print("- none")

    if summary["structure_warnings"]:
        print()
        print("Structure warnings")
        print("------------------")
        for warning in summary["structure_warnings"]:
            print(f"- {warning}")

    print()
    print("Recent filings")
    print("--------------")
    if summary["summary_only"]:
        print("- omitted by --summary-only")
    elif summary["recent_filings"]:
        for record in summary["recent_filings"]:
            print(
                "- "
                f"form={display_value(record.get('form'))} | "
                f"filingDate={display_value(record.get('filingDate'))} | "
                f"accessionNumber={display_value(record.get('accessionNumber'))} | "
                f"primaryDocument={display_value(record.get('primaryDocument'))} | "
                f"reportDate={display_value(record.get('reportDate'))}"
            )
    else:
        print("- none")

    print()
    print("Safety")
    print("------")
    safety = summary["safety"]
    print(f"- network calls: {safety['network_calls']}")
    print(f"- output files created: {safety['output_files_created']}")
    print(f"- candidate writes: {safety['candidate_writes']}")
    print(f"- production writes: {safety['production_writes']}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        summary = build_summary(
            cache_file=Path(args.cache_file),
            ticker_label=args.ticker.strip() if args.ticker else None,
            forms_filter=args.forms,
            limit=args.limit,
            summary_only=args.summary_only,
        )
    except InspectError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(summary, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
