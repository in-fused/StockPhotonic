#!/usr/bin/env python3
"""Preview relationship candidate objects from cached SEC filing signal reports."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sec_filing_inspect import FilingInspectError  # noqa: E402
from sec_filing_signals import SignalExtractionError, parse_nonnegative_int  # noqa: E402
from sec_signal_report import build_report  # noqa: E402


SAFETY_COUNTERS = {
    "network_calls": 0,
    "candidate_files_written": 0,
    "production_writes": 0,
}
SIGNAL_RELATIONSHIP_TYPES = {
    "supplier": "supplier_customer",
    "customer": "supplier_customer",
    "dependency": "supplier_customer",
    "partnership": "partnership",
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert read-only SEC filing signal report snippets into preview-only "
            "relationship candidate objects. This script reads cached filing "
            "documents and optional metadata sidecars only, prints to stdout only, "
            "and never writes candidate files or production graph data."
        )
    )
    parser.add_argument(
        "--files",
        nargs="+",
        required=True,
        help="One or more local filing cache documents under data/cache/sec/filings.",
    )
    parser.add_argument(
        "--limit-chars",
        type=parse_nonnegative_int,
        help="Optional maximum number of decoded characters to scan per filing.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON preview payload to stdout only.",
    )
    return parser.parse_args(argv)


def clean_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def source_ticker_from_metadata(metadata: dict[str, Any]) -> str | None:
    ticker = clean_optional_string(metadata.get("ticker"))
    return ticker.upper() if ticker else None


def relationship_type_for(signal_type: str) -> str:
    return SIGNAL_RELATIONSHIP_TYPES.get(signal_type, "ecosystem")


def candidate_from_snippet(snippet: dict[str, Any]) -> dict[str, Any]:
    metadata = snippet.get("metadata")
    metadata_fields = metadata if isinstance(metadata, dict) else {}

    return {
        "source_ticker": source_ticker_from_metadata(metadata_fields),
        "target_ticker": None,
        "relationship_type": relationship_type_for(str(snippet.get("type", ""))),
        "source_type": "sec_filing",
        "source_tier": 1,
        "confidence_hint": snippet.get("confidence_hint"),
        "evidence_snippet": snippet.get("text_snippet"),
        "filing_date": clean_optional_string(snippet.get("filing_date")),
        "accession_number": clean_optional_string(metadata_fields.get("accession_number")),
        "review_status": "preview_only",
    }


def build_preview(raw_files: list[str], limit_chars: int | None) -> dict[str, Any]:
    report = build_report(raw_files, limit_chars)
    candidates = [
        candidate_from_snippet(snippet)
        for snippet in report["top_snippets"]
    ]

    return {
        "preview_type": "sec_signal_candidate_preview",
        "input_files": report["input_files"],
        "expected_cache_root": report["expected_cache_root"],
        "limit_chars_per_file": report["limit_chars_per_file"],
        "scanned_characters": report["scanned_characters"],
        "total_signals": report["total_signals"],
        "preview_candidate_count": len(candidates),
        "preview_candidates": candidates,
        "safety": dict(SAFETY_COUNTERS),
    }


def print_human(preview: dict[str, Any]) -> None:
    print("SEC signal candidate preview")
    print("============================")
    print(f"Files: {preview['input_files']}")
    print(f"Expected cache root: {preview['expected_cache_root']}")
    limit_chars = preview["limit_chars_per_file"]
    print(f"Limit chars per file: {limit_chars if limit_chars is not None else 'none'}")
    print(f"Scanned characters: {preview['scanned_characters']}")
    print(f"Total source signals: {preview['total_signals']}")
    print(f"Preview candidates: {preview['preview_candidate_count']}")

    print()
    print("Preview objects")
    print("---------------")
    if not preview["preview_candidates"]:
        print("none")
    for candidate in preview["preview_candidates"]:
        print(json.dumps(candidate, sort_keys=True))

    print()
    print("Safety")
    print("------")
    for key, value in preview["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        preview = build_preview(args.files, args.limit_chars)
    except (FilingInspectError, SignalExtractionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(preview, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
