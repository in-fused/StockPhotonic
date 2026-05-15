#!/usr/bin/env python3
"""Extract read-only relationship signals from a cached SEC filing document."""

from __future__ import annotations

import argparse
import html
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


SIGNAL_RULES: tuple[dict[str, Any], ...] = (
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "supply agreement",
        "confidence_hint": 0.9,
    },
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "supplier agreement",
        "confidence_hint": 0.88,
    },
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "component supplier",
        "confidence_hint": 0.88,
    },
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "manufactured by",
        "confidence_hint": 0.9,
    },
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "manufactures for",
        "confidence_hint": 0.88,
    },
    {
        "type": "supplier",
        "relationship_type_hint": "supplier_customer",
        "keyword": "components sourced from",
        "confidence_hint": 0.91,
    },
    {
        "type": "customer",
        "relationship_type_hint": "supplier_customer",
        "keyword": "customer agreement",
        "confidence_hint": 0.87,
    },
    {
        "type": "customer",
        "relationship_type_hint": "supplier_customer",
        "keyword": "revenue from",
        "confidence_hint": 0.86,
    },
    {
        "type": "customer",
        "relationship_type_hint": "supplier_customer",
        "keyword": "sales to",
        "confidence_hint": 0.84,
    },
    {
        "type": "customer",
        "relationship_type_hint": "supplier_customer",
        "keyword": "accounted for",
        "confidence_hint": 0.82,
        "requires_context": ("revenue", "net revenue", "% of revenue", "percent of revenue"),
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "strategic partnership",
        "confidence_hint": 0.92,
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "partnership with",
        "confidence_hint": 0.9,
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "collaboration agreement",
        "confidence_hint": 0.9,
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "collaboration with",
        "confidence_hint": 0.88,
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "joint venture",
        "confidence_hint": 0.92,
    },
    {
        "type": "partnership",
        "relationship_type_hint": "partnership",
        "keyword": "joint development agreement",
        "confidence_hint": 0.91,
    },
    {
        "type": "cloud_hyperscaler",
        "relationship_type_hint": "cloud_hyperscaler_ecosystem",
        "keyword": "cloud services agreement",
        "confidence_hint": 0.88,
    },
    {
        "type": "cloud_hyperscaler",
        "relationship_type_hint": "cloud_hyperscaler_ecosystem",
        "keyword": "cloud infrastructure partnership",
        "confidence_hint": 0.9,
    },
    {
        "type": "cloud_hyperscaler",
        "relationship_type_hint": "cloud_hyperscaler_ecosystem",
        "keyword": "hyperscaler",
        "confidence_hint": 0.74,
        "requires_context": ("agreement", "partnership", "customer", "supply", "infrastructure"),
    },
    {
        "type": "semiconductor_supply_chain",
        "relationship_type_hint": "semiconductor_supply_chain",
        "keyword": "foundry services",
        "confidence_hint": 0.88,
    },
    {
        "type": "semiconductor_supply_chain",
        "relationship_type_hint": "semiconductor_supply_chain",
        "keyword": "wafer supply agreement",
        "confidence_hint": 0.91,
    },
    {
        "type": "semiconductor_supply_chain",
        "relationship_type_hint": "semiconductor_supply_chain",
        "keyword": "advanced packaging",
        "confidence_hint": 0.78,
        "requires_context": ("supplier", "customer", "agreement", "manufacturing", "foundry"),
    },
    {
        "type": "semiconductor_supply_chain",
        "relationship_type_hint": "semiconductor_supply_chain",
        "keyword": "outsourced semiconductor assembly",
        "confidence_hint": 0.86,
    },
    {
        "type": "ai_infrastructure",
        "relationship_type_hint": "ai_infrastructure",
        "keyword": "AI infrastructure partnership",
        "confidence_hint": 0.9,
    },
    {
        "type": "ai_infrastructure",
        "relationship_type_hint": "ai_infrastructure",
        "keyword": "GPU cloud",
        "confidence_hint": 0.84,
    },
    {
        "type": "ai_infrastructure",
        "relationship_type_hint": "ai_infrastructure",
        "keyword": "training cluster",
        "confidence_hint": 0.78,
        "requires_context": ("customer", "partnership", "agreement", "cloud", "data center"),
    },
    {
        "type": "data_center_power",
        "relationship_type_hint": "data_center_power",
        "keyword": "power purchase agreement",
        "confidence_hint": 0.91,
    },
    {
        "type": "data_center_power",
        "relationship_type_hint": "data_center_power",
        "keyword": "electricity supply agreement",
        "confidence_hint": 0.89,
    },
    {
        "type": "data_center_power",
        "relationship_type_hint": "data_center_power",
        "keyword": "data center power",
        "confidence_hint": 0.78,
        "requires_context": ("agreement", "supply", "utility", "customer", "provider"),
    },
    {
        "type": "competitor",
        "relationship_type_hint": "competitor",
        "keyword": "competes with",
        "confidence_hint": 0.86,
    },
    {
        "type": "competitor",
        "relationship_type_hint": "competitor",
        "keyword": "competitors include",
        "confidence_hint": 0.82,
    },
    {
        "type": "ownership",
        "relationship_type_hint": "investment",
        "keyword": "ownership stake in",
        "confidence_hint": 0.93,
    },
    {
        "type": "ownership",
        "relationship_type_hint": "investment",
        "keyword": "equity investment in",
        "confidence_hint": 0.91,
    },
    {
        "type": "ownership",
        "relationship_type_hint": "investment",
        "keyword": "investment in",
        "confidence_hint": 0.88,
        "requires_context": ("equity", "stake", "shares", "ownership", "strategic"),
    },
    {
        "type": "dependency",
        "relationship_type_hint": "supplier_customer",
        "keyword": "critical supplier",
        "confidence_hint": 0.9,
    },
    {
        "type": "dependency",
        "relationship_type_hint": "supplier_customer",
        "keyword": "depends on",
        "confidence_hint": 0.72,
        "requires_context": ("supplier", "customer", "manufacturer", "provider", "source"),
    },
    {
        "type": "dependency",
        "relationship_type_hint": "supplier_customer",
        "keyword": "reliant on",
        "confidence_hint": 0.72,
        "requires_context": ("supplier", "customer", "manufacturer", "provider", "source"),
    },
)
SIGNAL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = tuple(
    (
        signal_type,
        tuple(
            rule["keyword"]
            for rule in SIGNAL_RULES
            if rule["type"] == signal_type
        ),
    )
    for signal_type in dict.fromkeys(str(rule["type"]) for rule in SIGNAL_RULES)
)
SIGNAL_TYPES: tuple[str, ...] = tuple(signal_type for signal_type, _ in SIGNAL_KEYWORDS)
DEFAULT_TOP_SNIPPETS = 10
SNIPPET_CONTEXT_CHARS = 260
MAX_SNIPPET_CHARS = 760
SAFETY_SUMMARY = {
    "network_calls": 0,
    "candidate_records_created": 0,
    "production_writes": 0,
}
CONFIDENCE_HINTS: dict[str, float] = {
    str(rule["keyword"]): float(rule["confidence_hint"])
    for rule in SIGNAL_RULES
}
ACCOUNTING_NOISE_TERMS = (
    "revenue from contracts",
    "revenues from contracts",
    "revenue recognized",
    "contract assets",
    "contract liabilities",
    "remaining performance obligations",
)
LEGAL_EXHIBIT_NOISE_TERMS = (
    "exhibit no.",
    "incorporated by reference",
    "form 10-k filed",
    "form 8-k filed",
    "credit agreement dated",
    "administrative agent",
    "certain banks",
)
XBRL_NOISE_MARKERS = (
    "xbrli:",
    "contextref",
    "unitref",
    "nonfraction",
    "nonnumeric",
)
TAG_PATTERN = re.compile(r"<[^>]+>")
HTML_ATTRIBUTE_FRAGMENT_PATTERN = re.compile(
    r"\b(?:style|class|colspan|rowspan|href|id|width|height|contextref|unitref)="
    r"\"[^\"]*\"",
    re.IGNORECASE,
)
CSS_FRAGMENT_PATTERN = re.compile(
    r"\s*=?\"[^\"]*(?:background-color|padding|font-family|line-height|text-align|vertical-align)[^\"]*\"",
    re.IGNORECASE,
)
UNTERMINATED_ATTRIBUTE_FRAGMENT_PATTERN = re.compile(
    r"\b(?:style|class|colspan|rowspan|href|id|width|height)=\"[^<>]{0,220}",
    re.IGNORECASE,
)
NEGATION_TERMS = (
    "no relationship with",
    "not a supplier",
    "not a customer",
    "not affiliated with",
    "not dependent on",
)


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
    visible = TAG_PATTERN.sub(" ", html.unescape(text))
    visible = HTML_ATTRIBUTE_FRAGMENT_PATTERN.sub(" ", visible)
    visible = CSS_FRAGMENT_PATTERN.sub(" ", visible)
    visible = UNTERMINATED_ATTRIBUTE_FRAGMENT_PATTERN.sub(" ", visible)
    visible = visible.replace("<", " ").replace(">", " ")
    visible = re.sub(r"\b(?:td|tr|div|span|table|tbody|ix|xbrli)\b", " ", visible, flags=re.IGNORECASE)
    return " ".join(visible.split())


def trim_snippet(snippet: str) -> str:
    compact = compact_snippet(snippet)
    if len(compact) <= MAX_SNIPPET_CHARS:
        return compact
    return compact[: MAX_SNIPPET_CHARS - 3].rstrip(" ,.;:") + "..."


def build_snippet(text: str, match_start: int, match_end: int) -> str:
    snippet_start = max(0, match_start - SNIPPET_CONTEXT_CHARS)
    snippet_end = min(len(text), match_end + SNIPPET_CONTEXT_CHARS)
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""
    return f"{prefix}{trim_snippet(text[snippet_start:snippet_end])}{suffix}"


def relationship_term_hits(text: str, terms: tuple[str, ...]) -> list[str]:
    text_lower = text.lower()
    hits: list[str] = []
    for term in terms:
        if " " in term:
            if term in text_lower:
                hits.append(term)
            continue
        if re.search(r"\b" + re.escape(term) + r"\b", text_lower):
            hits.append(term)
    return hits


def xbrl_noise_dominates(snippet: str) -> bool:
    lower = snippet.lower()
    marker_count = sum(lower.count(marker) for marker in XBRL_NOISE_MARKERS)
    prose_words = re.findall(r"\b[A-Za-z][A-Za-z-]{2,}\b", snippet)
    return marker_count >= 4 and len(prose_words) < 30


def signal_guard_notes(rule: dict[str, Any], snippet: str) -> list[str]:
    notes: list[str] = []
    keyword = str(rule["keyword"]).lower()
    if relationship_term_hits(snippet, NEGATION_TERMS):
        notes.append("negated_relationship_language")
    if xbrl_noise_dominates(snippet):
        notes.append("xbrl_noise_dominates")
    if relationship_term_hits(snippet, ACCOUNTING_NOISE_TERMS):
        notes.append("accounting_context_noise")
    if keyword in {"agreement with", "credit agreement", "loan agreement"} and relationship_term_hits(
        snippet,
        LEGAL_EXHIBIT_NOISE_TERMS,
    ):
        notes.append("legal_exhibit_or_credit_agreement_noise")

    required_context = rule.get("requires_context")
    if isinstance(required_context, tuple) and required_context:
        if not relationship_term_hits(snippet, tuple(str(term) for term in required_context)):
            notes.append("missing_required_relationship_context")
    return notes


def should_keep_signal(rule: dict[str, Any], snippet: str) -> bool:
    guard_notes = signal_guard_notes(rule, snippet)
    hard_guards = {
        "negated_relationship_language",
        "xbrl_noise_dominates",
        "accounting_context_noise",
        "legal_exhibit_or_credit_agreement_noise",
        "missing_required_relationship_context",
    }
    return not any(note in hard_guards for note in guard_notes)


def extract_signals(text: str) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()

    for rule in SIGNAL_RULES:
        signal_type = str(rule["type"])
        keyword = str(rule["keyword"])
        pattern = keyword_pattern(keyword)
        for match in pattern.finditer(text):
            key = (signal_type, keyword, match.start())
            if key in seen:
                continue
            snippet = build_snippet(text, match.start(), match.end())
            if not should_keep_signal(rule, snippet):
                continue
            seen.add(key)
            guard_notes = signal_guard_notes(rule, snippet)
            signals.append(
                {
                    "type": signal_type,
                    "text_snippet": snippet,
                    "confidence_hint": float(rule["confidence_hint"]),
                    "keyword": keyword,
                    "offset": match.start(),
                    "length": match.end() - match.start(),
                    "relationship_type_hint": rule.get("relationship_type_hint"),
                    "extraction_method": "relationship_phrase_rule",
                    "guard_notes": guard_notes,
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
                "relationship_type_hint": signal.get("relationship_type_hint"),
                "extraction_method": signal.get("extraction_method"),
                "guard_notes": signal.get("guard_notes", []),
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
