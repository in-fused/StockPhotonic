#!/usr/bin/env python3
"""Generate a local SEC filing download plan from cached submissions JSON.

This script reads one already-cached SEC submissions JSON file and prints a
deterministic plan. It never fetches filing documents, creates relationship
candidates, or writes production graph data.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any


DEFAULT_FORMS = ("10-K", "10-Q", "8-K")
DEFAULT_LIMIT = 10
RECENT_FIELDS = (
    "form",
    "filingDate",
    "accessionNumber",
    "primaryDocument",
    "reportDate",
)
REQUIRED_RECENT_FIELDS = (
    "form",
    "filingDate",
    "accessionNumber",
    "primaryDocument",
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PLAN_OUTPUT_DIR = PROJECT_ROOT / "data" / "candidates" / "plans"


class FilingPlanError(Exception):
    """Raised for clear filing-plan generation failures."""


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def parse_form_filter(value: str) -> tuple[str, ...]:
    forms: list[str] = []
    seen: set[str] = set()
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
            "Generate a read-only filing download plan from one local SEC "
            "submissions cache file. No network calls, no candidate creation, "
            "and no production graph writes."
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
        "--forms",
        type=parse_form_filter,
        default=DEFAULT_FORMS,
        help="Comma-separated form filter. Default: 10-K,10-Q,8-K.",
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        default=DEFAULT_LIMIT,
        help=f"Maximum planned filings to print. Default: {DEFAULT_LIMIT}.",
    )
    parser.add_argument(
        "--ticker",
        help="Optional display label only. This does not perform lookup or network access.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the plan as JSON to stdout.",
    )
    parser.add_argument(
        "--output",
        help=(
            "Optional explicit JSON plan artifact path. Must be under "
            "data/candidates/plans/ and is never written by default."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow --output to overwrite an existing plan artifact.",
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
        raise FilingPlanError(f"cache file not found: {cache_file}")
    if not cache_file.is_file():
        raise FilingPlanError(f"cache path is not a file: {cache_file}")

    try:
        with cache_file.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except json.JSONDecodeError as exc:
        raise FilingPlanError(
            f"invalid JSON in cache file {cache_file}: {exc.msg} "
            f"at line {exc.lineno} column {exc.colno}"
        ) from exc
    except OSError as exc:
        raise FilingPlanError(f"could not read cache file {cache_file}: {exc}") from exc

    if not isinstance(payload, dict):
        raise FilingPlanError(
            "input does not look like SEC submissions JSON: top-level value is not an object"
        )
    return payload


def get_recent_payload(payload: dict[str, Any]) -> dict[str, Any]:
    filings = payload.get("filings")
    if not isinstance(filings, dict):
        raise FilingPlanError(
            "input does not look like SEC submissions JSON: missing filings object"
        )

    recent = filings.get("recent")
    if not isinstance(recent, dict):
        raise FilingPlanError(
            "input does not look like SEC submissions JSON: missing filings.recent object"
        )
    return recent


def normalize_cik(raw_cik: Any) -> str:
    cik = scalar_to_string(raw_cik)
    if cik is None:
        raise FilingPlanError("input does not look like SEC submissions JSON: missing cik")
    if cik.upper().startswith("CIK"):
        cik = cik[3:]
    if not cik.isdigit():
        raise FilingPlanError("input SEC submissions cik must contain digits only")
    if len(cik) > 10:
        raise FilingPlanError("input SEC submissions cik must be 10 digits or fewer")
    return cik.zfill(10)


def normalize_tickers(raw_tickers: Any) -> list[str]:
    if not isinstance(raw_tickers, list):
        raise FilingPlanError(
            "input does not look like SEC submissions JSON: missing tickers array"
        )
    tickers = []
    for item in raw_tickers:
        ticker = scalar_to_string(item)
        if ticker:
            tickers.append(ticker.upper())
    return tickers


def collect_identity(payload: dict[str, Any]) -> tuple[str, str, list[str]]:
    cik = normalize_cik(payload.get("cik"))
    name = scalar_to_string(payload.get("name"))
    if name is None:
        raise FilingPlanError("input does not look like SEC submissions JSON: missing name")
    tickers = normalize_tickers(payload.get("tickers"))
    return cik, name, tickers


def list_value(recent: dict[str, Any], field: str) -> list[Any]:
    field_path = f"filings.recent.{field}"
    if field not in recent:
        if field in REQUIRED_RECENT_FIELDS:
            raise FilingPlanError(
                f"input does not look like SEC submissions JSON: missing {field_path}"
            )
        return []

    value = recent[field]
    if not isinstance(value, list):
        raise FilingPlanError(
            f"input does not look like SEC submissions JSON: {field_path} is not an array"
        )
    return value


def collect_recent_records(
    recent: dict[str, Any],
) -> tuple[list[dict[str, str | None]], list[str], dict[str, int]]:
    values_by_field = {field: list_value(recent, field) for field in RECENT_FIELDS}
    lengths_by_field = {field: len(values) for field, values in values_by_field.items()}
    warnings: list[str] = []
    nonzero_lengths = {
        field: length for field, length in lengths_by_field.items() if length > 0
    }
    if len(set(nonzero_lengths.values())) > 1:
        detail = ", ".join(
            f"{field}={length}" for field, length in sorted(nonzero_lengths.items())
        )
        warnings.append(f"filings.recent arrays have different lengths: {detail}")

    record_count = max(lengths_by_field.values(), default=0)
    records: list[dict[str, str | None]] = []
    for index in range(record_count):
        record: dict[str, str | None] = {}
        for field in RECENT_FIELDS:
            values = values_by_field[field]
            value = values[index] if index < len(values) else None
            record[field] = scalar_to_string(value)
        records.append(record)
    return records, warnings, lengths_by_field


def cik_without_leading_zeroes(cik: str) -> str:
    return cik.lstrip("0") or "0"


def build_archive_url(cik: str, accession_number: str, primary_document: str) -> str:
    accession_without_dashes = accession_number.replace("-", "")
    encoded_document = urllib.parse.quote(primary_document, safe="/-._~")
    return (
        "https://www.sec.gov/Archives/edgar/data/"
        f"{cik_without_leading_zeroes(cik)}/"
        f"{accession_without_dashes}/"
        f"{encoded_document}"
    )


def record_matches_forms(record: dict[str, str | None], forms: tuple[str, ...]) -> bool:
    form = record.get("form")
    return form is not None and form.upper() in forms


def ticker_label_from(args_ticker: str | None, tickers: list[str]) -> str | None:
    if args_ticker and args_ticker.strip():
        return args_ticker.strip().upper()
    return tickers[0] if tickers else None


def build_plan_item(
    *,
    record: dict[str, str | None],
    ticker_label: str | None,
    cik: str,
    company_name: str,
) -> dict[str, Any]:
    accession_number = record["accessionNumber"]
    primary_document = record["primaryDocument"]
    assert accession_number is not None
    assert primary_document is not None
    return {
        "ticker": ticker_label,
        "cik": cik,
        "company_name": company_name,
        "form": record.get("form"),
        "filing_date": record.get("filingDate"),
        "report_date": record.get("reportDate"),
        "accession_number": accession_number,
        "primary_document": primary_document,
        "archive_url": build_archive_url(cik, accession_number, primary_document),
        "source_type": "sec_filing",
        "source_tier": 1,
        "planned_status": "pending_fetch",
    }


def build_plan(
    *,
    cache_file: Path,
    forms: tuple[str, ...],
    limit: int,
    ticker_label: str | None,
    output_requested: bool,
) -> dict[str, Any]:
    payload = load_cache_payload(cache_file)
    recent = get_recent_payload(payload)
    cik, company_name, tickers = collect_identity(payload)
    effective_ticker = ticker_label_from(ticker_label, tickers)
    records, warnings, recent_field_lengths = collect_recent_records(recent)

    matching_records = [
        (index, record)
        for index, record in enumerate(records, start=1)
        if record_matches_forms(record, forms)
    ]

    planned_filings: list[dict[str, Any]] = []
    for index, record in matching_records:
        missing_required_fields = [
            field
            for field in ("accessionNumber", "primaryDocument")
            if not record.get(field)
        ]
        if missing_required_fields:
            warnings.append(
                "skipped filing "
                f"{index} ({record.get('form') or 'missing form'}, "
                f"{record.get('filingDate') or 'missing filing date'}): "
                f"missing {', '.join(missing_required_fields)}"
            )
            continue
        planned_filings.append(
            build_plan_item(
                record=record,
                ticker_label=effective_ticker,
                cik=cik,
                company_name=company_name,
            )
        )
        if len(planned_filings) >= limit:
            break

    return {
        "metadata": {
            "plan_type": "sec_filing_download_plan",
            "plan_artifact_only": True,
            "cache_file": str(cache_file),
            "forms": list(forms),
            "limit": limit,
            "cik": cik,
            "company_name": company_name,
            "tickers": tickers,
            "ticker_label": effective_ticker,
            "recent_filing_count": len(records),
            "matching_recent_filing_count": len(matching_records),
            "planned_filing_count": len(planned_filings),
            "recent_field_lengths": recent_field_lengths,
            "output_requested": output_requested,
            "safety": {
                "network_calls": 0,
                "filing_downloads": 0,
                "candidate_records_created": 0,
                "candidate_writes": 0,
                "production_graph_writes": 0,
                "production_companies_written": 0,
                "production_connections_written": 0,
            },
        },
        "warnings": warnings,
        "filings": planned_filings,
    }


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def resolve_output_path(raw_output: str) -> Path:
    output_path = Path(raw_output)
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path

    resolved_output = output_path.resolve(strict=False)
    resolved_plan_dir = PLAN_OUTPUT_DIR.resolve(strict=False)
    if resolved_output == resolved_plan_dir or not is_relative_to(
        resolved_output,
        resolved_plan_dir,
    ):
        raise FilingPlanError(
            "--output must be under data/candidates/plans/ "
            f"(resolved allowed directory: {resolved_plan_dir})"
        )
    if resolved_output.exists() and resolved_output.is_dir():
        raise FilingPlanError(f"--output points to a directory: {resolved_output}")
    return resolved_output


def write_plan_file(plan: dict[str, Any], output_path: Path, force: bool) -> None:
    if output_path.exists() and not force:
        raise FilingPlanError(
            f"output file already exists: {output_path}; pass --force to overwrite"
        )

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        mode = "w" if force else "x"
        with output_path.open(mode, encoding="utf-8") as file:
            json.dump(plan, file, indent=2, sort_keys=True)
            file.write("\n")
    except OSError as exc:
        raise FilingPlanError(f"could not write plan artifact {output_path}: {exc}") from exc


def display_value(value: Any) -> str:
    if value is None:
        return "missing"
    return str(value)


def print_warnings(warnings: list[str]) -> None:
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)


def print_human(plan: dict[str, Any], output_path: Path | None) -> None:
    metadata = plan["metadata"]
    print("SEC filing download plan")
    print("========================")
    print(f"Cache file: {metadata['cache_file']}")
    print(f"Company: {metadata['company_name']}")
    print(f"CIK: {metadata['cik']}")
    print(f"Ticker label: {display_value(metadata.get('ticker_label'))}")
    print(f"Forms: {', '.join(metadata['forms'])}")
    print(f"Limit: {metadata['limit']}")
    print(f"Recent filing count: {metadata['recent_filing_count']}")
    print(f"Matching recent filing count: {metadata['matching_recent_filing_count']}")
    print(f"Planned filing count: {metadata['planned_filing_count']}")
    if output_path is not None:
        print(f"Output artifact: {output_path}")

    print()
    print("Planned filings")
    print("---------------")
    if not plan["filings"]:
        print("- none")
    for index, item in enumerate(plan["filings"], start=1):
        print(
            f"{index}. "
            f"form={display_value(item.get('form'))} | "
            f"filing_date={display_value(item.get('filing_date'))} | "
            f"report_date={display_value(item.get('report_date'))} | "
            f"accession_number={item['accession_number']} | "
            f"primary_document={item['primary_document']}"
        )
        print(f"   archive_url={item['archive_url']}")

    print()
    print("Safety")
    print("------")
    safety = metadata["safety"]
    print(f"- network calls: {safety['network_calls']}")
    print(f"- filing downloads: {safety['filing_downloads']}")
    print(f"- candidate records created: {safety['candidate_records_created']}")
    print(f"- candidate writes: {safety['candidate_writes']}")
    print(f"- production graph writes: {safety['production_graph_writes']}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    output_path: Path | None = None

    try:
        if args.output:
            output_path = resolve_output_path(args.output)
        plan = build_plan(
            cache_file=Path(args.cache_file),
            forms=args.forms,
            limit=args.limit,
            ticker_label=args.ticker,
            output_requested=output_path is not None,
        )
        print_warnings(plan["warnings"])
        if output_path is not None:
            write_plan_file(plan, output_path, args.force)
    except FilingPlanError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(plan, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(plan, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
