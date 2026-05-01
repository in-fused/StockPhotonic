#!/usr/bin/env python3
"""Extract read-only relationship signals from a cached SEC filing document."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sec_filing_inspect import (  # noqa: E402
    EXPECTED_FILINGS_ROOT,
    FilingInspectError,
    decode_document,
    is_relative_to,
    read_document,
    resolve_input_file,
    sanitize_text,
)


SIGNAL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("supplier", ("supplier", "supply agreement", "vendor", "procurement")),
    ("customer", ("customer", "client", "revenue from", "sales to")),
    ("partnership", ("partnership", "collaboration", "strategic agreement")),
    ("dependency", ("depends on", "reliant on", "critical supplier")),
)
SIGNAL_TYPES: tuple[str, ...] = tuple(signal_type for signal_type, _ in SIGNAL_KEYWORDS)
DEFAULT_TOP_SNIPPETS = 10
SNIPPET_CONTEXT_CHARS = 180
SAFETY_SUMMARY = {
    "network_calls": 0,
    "candidate_records_created": 0,
    "production_writes": 0,
}
CONFIDENCE_HINTS: dict[str, float] = {
    "supplier": 0.74,
    "supply agreement": 0.88,
    "vendor": 0.68,
    "procurement": 0.66,
    "customer": 0.72,
    "client": 0.66,
    "revenue from": 0.86,
    "sales to": 0.84,
    "partnership": 0.76,
    "collaboration": 0.74,
    "strategic agreement": 0.86,
    "depends on": 0.88,
    "reliant on": 0.86,
    "critical supplier": 0.9,
}


class SignalExtractionError(Exception):
    """Raised for clear signal extraction failures."""


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit-chars must be an integer.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("--limit-chars must be zero or greater.")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract deterministic relationship signal snippets from one cached SEC "
            "filing document. This script prints to stdout only; it does not fetch, "
            "create candidates, or write production graph data."
        )
    )
    parser.add_argument(
        "--file",
        required=True,
        help="Path to a local cached SEC filing document under data/cache/sec/filings.",
    )
    parser.add_argument(
        "--limit-chars",
        type=parse_nonnegative_int,
        help="Optional maximum number of decoded characters to scan.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON signal summary to stdout only.",
    )
    return parser.parse_args(argv)


def resolve_cached_filing(raw_path: str) -> Path:
    filing_path = resolve_input_file(raw_path, "filing cache document")
    expected_root = EXPECTED_FILINGS_ROOT.resolve(strict=False)
    if not is_relative_to(filing_path, expected_root):
        raise SignalExtractionError(
            f"filing cache document must be under {expected_root}: {filing_path}"
        )
    return filing_path


def keyword_pattern(keyword: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in keyword.split()]
    phrase = r"\s+".join(parts)
    return re.compile(rf"(?<![a-z0-9]){phrase}(?![a-z0-9])", re.IGNORECASE)


def compact_snippet(text: str) -> str:
    return " ".join(text.split())


def build_snippet(text: str, match_start: int, match_end: int) -> str:
    snippet_start = max(0, match_start - SNIPPET_CONTEXT_CHARS)
    snippet_end = min(len(text), match_end + SNIPPET_CONTEXT_CHARS)
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""
    return f"{prefix}{compact_snippet(text[snippet_start:snippet_end])}{suffix}"


def extract_signals(text: str) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()

    for signal_type, keywords in SIGNAL_KEYWORDS:
        for keyword in keywords:
            pattern = keyword_pattern(keyword)
            for match in pattern.finditer(text):
                key = (signal_type, keyword, match.start())
                if key in seen:
                    continue
                seen.add(key)
                signals.append(
                    {
                        "type": signal_type,
                        "text_snippet": build_snippet(text, match.start(), match.end()),
                        "confidence_hint": CONFIDENCE_HINTS[keyword],
                        "keyword": keyword,
                        "offset": match.start(),
                        "length": match.end() - match.start(),
                    }
                )

    return sorted(
        signals,
        key=lambda signal: (
            -signal["confidence_hint"],
            signal["offset"],
            signal["type"],
            signal["keyword"],
        ),
    )


def group_signals(signals: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {signal_type: [] for signal_type in SIGNAL_TYPES}
    for signal in signals:
        grouped[signal["type"]].append(signal)
    return grouped


def build_summary(filing_path: Path, limit_chars: int | None) -> dict[str, Any]:
    body = read_document(filing_path)
    text, warnings, decode_info = decode_document(body)
    sanitized_text = sanitize_text(text)
    scan_text = sanitized_text[:limit_chars] if limit_chars is not None else sanitized_text
    signals = extract_signals(scan_text)

    return {
        "file": str(filing_path),
        "expected_cache_root": str(EXPECTED_FILINGS_ROOT.resolve(strict=False)),
        "limit_chars": limit_chars,
        "scanned_characters": len(scan_text),
        "truncated": limit_chars is not None and len(sanitized_text) > limit_chars,
        "decode": decode_info,
        "warnings": warnings,
        "total_signals": len(signals),
        "signals_by_type": group_signals(signals),
        "top_snippets": [
            {
                "type": signal["type"],
                "confidence_hint": signal["confidence_hint"],
                "keyword": signal["keyword"],
                "offset": signal["offset"],
                "text_snippet": signal["text_snippet"],
            }
            for signal in signals[:DEFAULT_TOP_SNIPPETS]
        ],
        "safety": dict(SAFETY_SUMMARY),
    }


def print_human(summary: dict[str, Any]) -> None:
    print("SEC filing signal extractor")
    print("===========================")
    print(f"File: {summary['file']}")
    print(f"Expected cache root: {summary['expected_cache_root']}")
    print(f"Scanned characters: {summary['scanned_characters']}")
    print(f"Truncated by limit: {str(summary['truncated']).lower()}")
    if summary["warnings"]:
        print("Warnings:")
        for warning in summary["warnings"]:
            print(f"- {warning}")

    print()
    print(f"Total signals: {summary['total_signals']}")
    print()
    print("Signals by type")
    print("---------------")
    for signal_type in SIGNAL_TYPES:
        signals = summary["signals_by_type"][signal_type]
        print(f"{signal_type}: {len(signals)}")
        for signal in signals[:DEFAULT_TOP_SNIPPETS]:
            print(
                f"- {signal['confidence_hint']:.2f} "
                f"{signal['keyword']!r} offset {signal['offset']}: "
                f"{signal['text_snippet']}"
            )

    print()
    print("Top snippets")
    print("------------")
    if not summary["top_snippets"]:
        print("none")
    for snippet in summary["top_snippets"]:
        print(
            f"- {snippet['type']} {snippet['confidence_hint']:.2f} "
            f"{snippet['keyword']!r} offset {snippet['offset']}: "
            f"{snippet['text_snippet']}"
        )

    print()
    print("Safety")
    print("------")
    for key, value in summary["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        filing_path = resolve_cached_filing(args.file)
        summary = build_summary(filing_path, args.limit_chars)
    except (FilingInspectError, SignalExtractionError) as exc:
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
