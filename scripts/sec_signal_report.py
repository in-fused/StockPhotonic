#!/usr/bin/env python3
"""Aggregate read-only relationship signals from cached SEC filing documents."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sec_filing_inspect import (  # noqa: E402
    EXPECTED_FILINGS_ROOT,
    FilingInspectError,
    build_metadata_summary,
    decode_document,
    read_document,
    sanitize_text,
)
from sec_filing_signals import (  # noqa: E402
    DEFAULT_TOP_SNIPPETS,
    SIGNAL_TYPES,
    SignalExtractionError,
    extract_signals,
    parse_nonnegative_int,
    resolve_cached_filing,
)


DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SAFETY_COUNTERS = {
    "network_calls": 0,
    "candidate_records_created": 0,
    "production_writes": 0,
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Aggregate deterministic signal snippets from one or more local cached SEC "
            "filing documents. This script prints to stdout only; it does not fetch, "
            "create candidates, or write production graph data."
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
        help="Print a machine-readable JSON signal report to stdout only.",
    )
    return parser.parse_args(argv)


def date_to_rank(value: str | None) -> int:
    if value is None or not DATE_PATTERN.match(value):
        return 0
    year, month, day = (int(part) for part in value.split("-"))
    return year * 10_000 + month * 100 + day


def nonempty_fields(fields: dict[str, Any]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for key, value in fields.items():
        if isinstance(value, str) and value.strip():
            cleaned[key] = value.strip()
    return cleaned


def load_file_signals(
    raw_path: str,
    *,
    file_index: int,
    limit_chars: int | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    filing_path = resolve_cached_filing(raw_path)
    body = read_document(filing_path)
    text, decode_warnings, decode_info = decode_document(body)
    sanitized_text = sanitize_text(text)
    scan_text = sanitized_text[:limit_chars] if limit_chars is not None else sanitized_text
    signals = extract_signals(scan_text)
    metadata_summary = build_metadata_summary(filing_path, None)
    metadata_fields = nonempty_fields(metadata_summary["fields"])
    filing_date = metadata_fields.get("filing_date")
    recency_rank = date_to_rank(filing_date)

    enriched_signals: list[dict[str, Any]] = []
    for signal in signals:
        enriched = dict(signal)
        enriched["file"] = str(filing_path)
        enriched["file_index"] = file_index
        enriched["filing_date"] = filing_date
        enriched["recency_rank"] = recency_rank
        enriched["metadata"] = metadata_fields
        enriched_signals.append(enriched)

    signals_by_type = Counter(signal["type"] for signal in signals)
    file_summary = {
        "file": str(filing_path),
        "metadata_sidecar": metadata_summary,
        "limit_chars": limit_chars,
        "scanned_characters": len(scan_text),
        "truncated": limit_chars is not None and len(sanitized_text) > limit_chars,
        "decode": decode_info,
        "warnings": decode_warnings + metadata_summary["warnings"],
        "total_signals": len(signals),
        "signals_by_type": {
            signal_type: signals_by_type.get(signal_type, 0)
            for signal_type in SIGNAL_TYPES
        },
    }
    return file_summary, enriched_signals


def keyword_frequency_rows(
    keyword_frequency: Counter[tuple[str, str]],
) -> list[dict[str, Any]]:
    return [
        {
            "type": signal_type,
            "keyword": keyword,
            "count": count,
        }
        for (signal_type, keyword), count in sorted(
            keyword_frequency.items(),
            key=lambda item: (-item[1], item[0][0], item[0][1]),
        )
    ]


def ranked_snippets(
    signals: list[dict[str, Any]],
    keyword_frequency: Counter[tuple[str, str]],
) -> list[dict[str, Any]]:
    ranked = sorted(
        signals,
        key=lambda signal: (
            -signal["confidence_hint"],
            -keyword_frequency[(signal["type"], signal["keyword"])],
            -signal["recency_rank"],
            signal["file_index"],
            signal["offset"],
            signal["type"],
            signal["keyword"],
        ),
    )

    snippets: list[dict[str, Any]] = []
    for rank, signal in enumerate(ranked[:DEFAULT_TOP_SNIPPETS], start=1):
        snippets.append(
            {
                "rank": rank,
                "type": signal["type"],
                "keyword": signal["keyword"],
                "confidence_hint": signal["confidence_hint"],
                "frequency": keyword_frequency[(signal["type"], signal["keyword"])],
                "filing_date": signal["filing_date"],
                "file": signal["file"],
                "offset": signal["offset"],
                "metadata": signal["metadata"],
                "text_snippet": signal["text_snippet"],
            }
        )
    return snippets


def build_report(raw_files: list[str], limit_chars: int | None) -> dict[str, Any]:
    file_summaries: list[dict[str, Any]] = []
    all_signals: list[dict[str, Any]] = []

    for file_index, raw_file in enumerate(raw_files):
        file_summary, file_signals = load_file_signals(
            raw_file,
            file_index=file_index,
            limit_chars=limit_chars,
        )
        file_summaries.append(file_summary)
        all_signals.extend(file_signals)

    signals_by_type = Counter(signal["type"] for signal in all_signals)
    keyword_frequency = Counter(
        (signal["type"], signal["keyword"]) for signal in all_signals
    )

    return {
        "report_type": "sec_filing_signal_report",
        "input_files": len(file_summaries),
        "expected_cache_root": str(EXPECTED_FILINGS_ROOT.resolve(strict=False)),
        "limit_chars_per_file": limit_chars,
        "scanned_characters": sum(
            summary["scanned_characters"] for summary in file_summaries
        ),
        "truncated_files": sum(1 for summary in file_summaries if summary["truncated"]),
        "total_signals": len(all_signals),
        "signals_by_type": {
            signal_type: signals_by_type.get(signal_type, 0)
            for signal_type in SIGNAL_TYPES
        },
        "keyword_frequency": keyword_frequency_rows(keyword_frequency),
        "top_snippets": ranked_snippets(all_signals, keyword_frequency),
        "files": file_summaries,
        "safety": dict(SAFETY_COUNTERS),
    }


def print_human(report: dict[str, Any]) -> None:
    print("SEC filing signal report")
    print("========================")
    print(f"Files: {report['input_files']}")
    print(f"Expected cache root: {report['expected_cache_root']}")
    limit_chars = report["limit_chars_per_file"]
    print(f"Limit chars per file: {limit_chars if limit_chars is not None else 'none'}")
    print(f"Scanned characters: {report['scanned_characters']}")
    print(f"Truncated files: {report['truncated_files']}")
    print(f"Total signals: {report['total_signals']}")

    print()
    print("Signals by type")
    print("---------------")
    for signal_type in SIGNAL_TYPES:
        print(f"- {signal_type}: {report['signals_by_type'][signal_type]}")

    print()
    print("Keyword frequency")
    print("-----------------")
    if not report["keyword_frequency"]:
        print("none")
    for row in report["keyword_frequency"]:
        print(f"- {row['type']} {row['keyword']!r}: {row['count']}")

    print()
    print(f"Strongest snippets (top {DEFAULT_TOP_SNIPPETS})")
    print("--------------------------------")
    if not report["top_snippets"]:
        print("none")
    for snippet in report["top_snippets"]:
        filing_date = snippet["filing_date"] or "unknown-date"
        print(
            f"{snippet['rank']}. {snippet['type']} "
            f"{snippet['confidence_hint']:.2f} "
            f"freq={snippet['frequency']} date={filing_date} "
            f"keyword={snippet['keyword']!r}"
        )
        print(f"   file={snippet['file']}")
        print(f"   offset={snippet['offset']}: {snippet['text_snippet']}")

    print()
    print("Files")
    print("-----")
    for file_summary in report["files"]:
        print(
            f"- {file_summary['file']} | signals={file_summary['total_signals']} | "
            f"scanned={file_summary['scanned_characters']} | "
            f"truncated={str(file_summary['truncated']).lower()}"
        )
        metadata = file_summary["metadata_sidecar"]
        if metadata["path"]:
            status = "read" if metadata["present"] else "not-read"
            print(f"  metadata={metadata['path']} ({status})")
        for warning in file_summary["warnings"]:
            print(f"  warning={warning}")

    print()
    print("Safety")
    print("------")
    for key, value in report["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        report = build_report(args.files, args.limit_chars)
    except (FilingInspectError, SignalExtractionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(report, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
