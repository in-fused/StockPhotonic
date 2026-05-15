#!/usr/bin/env python3
"""Aggregate read-only relationship signals from cached SEC filing documents."""

from __future__ import annotations

import argparse
import html
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
    SIGNAL_TYPES as BASE_SIGNAL_TYPES,
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
SIGNAL_TYPES: tuple[str, ...] = tuple(dict.fromkeys((*BASE_SIGNAL_TYPES, "investment")))
DEFAULT_CANDIDATE_SNIPPETS = 120
STRONG_RELATIONSHIP_CONTEXT_CHARS = 260
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
ENTITY_NAME_FRAGMENT = (
    r"(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})"
    r"(?:\s+(?:&|and|of|the|[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})){0,8}"
    r"(?:\s*,?\s+(?:"
    r"Corporation|Corp\.?|Incorporated|Inc\.?|LLC|L\.L\.C\.|"
    r"Limited|Ltd\.?|PLC|plc|N\.V\.|S\.A\.|AG|SE|Company|Co\.?"
    r"))?"
)
GENERIC_TARGET_KEYS = {
    "a company",
    "a customer",
    "a single customer",
    "a supplier",
    "a third party",
    "companies",
    "company",
    "contract",
    "contracts",
    "customer",
    "customer a",
    "customer b",
    "customer c",
    "customers",
    "our company",
    "our customers",
    "our suppliers",
    "our vendors",
    "products",
    "services",
    "supplier",
    "suppliers",
    "the company",
    "third party",
    "vendor",
    "vendors",
}
STRONG_RELATIONSHIP_RULES: tuple[dict[str, Any], ...] = (
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "agreement with",
        "confidence_hint": 0.93,
        "pattern": re.compile(
            rf"\bagreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "partnership with",
        "confidence_hint": 0.94,
        "pattern": re.compile(
            rf"\bpartnerships?\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "collaboration with",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bcollaboration\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "joint venture with",
        "confidence_hint": 0.94,
        "pattern": re.compile(
            rf"\bjoint\s+venture\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "strategic partnership with",
        "confidence_hint": 0.93,
        "pattern": re.compile(
            rf"\bstrategic\s+partnership\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "partnership",
        "relationship_type": "partnership",
        "keyword": "joint development agreement with",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bjoint\s+development\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "cloud_hyperscaler",
        "relationship_type": "cloud_hyperscaler_ecosystem",
        "keyword": "cloud services agreement with",
        "confidence_hint": 0.9,
        "pattern": re.compile(
            rf"\bcloud\s+services\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "cloud_hyperscaler",
        "relationship_type": "cloud_hyperscaler_ecosystem",
        "keyword": "cloud infrastructure partnership with",
        "confidence_hint": 0.91,
        "pattern": re.compile(
            rf"\bcloud\s+infrastructure\s+partnership\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "supply",
        "keyword": "supplies",
        "confidence_hint": 0.91,
        "pattern": re.compile(
            rf"\b(?P<target>{ENTITY_NAME_FRAGMENT})\s+supplies\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "supply",
        "keyword": "manufactured by",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bmanufactured\s+by\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "supply",
        "keyword": "components sourced from",
        "confidence_hint": 0.93,
        "pattern": re.compile(
            rf"\bcomponents\s+sourced\s+from\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "supplier_customer",
        "keyword": "supply agreement with",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bsupply\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "semiconductor_supply_chain",
        "keyword": "foundry agreement with",
        "confidence_hint": 0.91,
        "pattern": re.compile(
            rf"\bfoundry\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "supplier",
        "relationship_type": "semiconductor_supply_chain",
        "keyword": "wafer supply agreement with",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bwafer\s+supply\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "ai_infrastructure",
        "relationship_type": "ai_infrastructure",
        "keyword": "AI infrastructure partnership with",
        "confidence_hint": 0.91,
        "pattern": re.compile(
            rf"\bAI\s+infrastructure\s+partnership\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "data_center_power",
        "relationship_type": "data_center_power",
        "keyword": "power purchase agreement with",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\bpower\s+purchase\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "data_center_power",
        "relationship_type": "data_center_power",
        "keyword": "electricity supply agreement with",
        "confidence_hint": 0.9,
        "pattern": re.compile(
            rf"\belectricity\s+supply\s+agreement\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "competitor",
        "relationship_type": "competitor",
        "keyword": "competes with",
        "confidence_hint": 0.88,
        "pattern": re.compile(
            rf"\bcompetes?\s+with\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "competitor",
        "relationship_type": "competitor",
        "keyword": "competitors include",
        "confidence_hint": 0.84,
        "pattern": re.compile(
            rf"\bcompetitors\s+include\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "customer",
        "relationship_type": "supplier_customer",
        "keyword": "revenue from",
        "confidence_hint": 0.92,
        "pattern": re.compile(
            rf"\brevenue\s+from\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "customer",
        "relationship_type": "supplier_customer",
        "keyword": "accounted for revenue",
        "confidence_hint": 0.93,
        "pattern": re.compile(
            rf"\b(?P<target>{ENTITY_NAME_FRAGMENT})\s+accounted\s+for\s+"
            r"(?:approximately\s+|about\s+)?(?:\d+(?:\.\d+)?%|[A-Za-z-]+\s+percent)"
            r"\s+of\s+(?:net\s+)?revenue\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "investment",
        "relationship_type": "investment",
        "keyword": "investment in",
        "confidence_hint": 0.91,
        "pattern": re.compile(
            rf"\binvestment\s+in\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
    {
        "signal_type": "investment",
        "relationship_type": "investment",
        "keyword": "ownership stake in",
        "confidence_hint": 0.93,
        "pattern": re.compile(
            rf"\bownership\s+stake\s+in\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
            re.IGNORECASE,
        ),
    },
)
ENTITY_AT_START_PATTERN = re.compile(
    rf"^\s*(?:an?\s+|the\s+)?(?P<target>{ENTITY_NAME_FRAGMENT})\b",
)
ENTITY_BEFORE_PATTERN = re.compile(
    rf"(?P<target>{ENTITY_NAME_FRAGMENT})\s*$",
)
ENTITY_AFTER_WITH_PATTERN = re.compile(
    rf"\bwith\s+(?P<target>{ENTITY_NAME_FRAGMENT})\b",
)
ACCOUNTED_FOR_REVENUE_PATTERN = re.compile(
    r"^\s+(?:approximately\s+|about\s+)?(?:\d+(?:\.\d+)?%|[A-Za-z-]+\s+percent)"
    r"\s+of\s+(?:net\s+)?revenue\b",
    re.IGNORECASE,
)
AFTER_TARGET_RULES: tuple[dict[str, Any], ...] = tuple(
    {
        "signal_type": rule["signal_type"],
        "relationship_type": rule["relationship_type"],
        "keyword": rule["keyword"],
        "confidence_hint": rule["confidence_hint"],
        "trigger": re.compile(r"\b" + r"\s+".join(map(re.escape, str(rule["keyword"]).split())) + r"\s+", re.IGNORECASE),
    }
    for rule in STRONG_RELATIONSHIP_RULES
    if rule["keyword"]
    in {
        "agreement with",
        "partnership with",
        "collaboration with",
        "joint venture with",
        "strategic partnership with",
        "joint development agreement with",
        "cloud services agreement with",
        "cloud infrastructure partnership with",
        "supply agreement with",
        "foundry agreement with",
        "wafer supply agreement with",
        "AI infrastructure partnership with",
        "power purchase agreement with",
        "electricity supply agreement with",
        "competes with",
        "competitors include",
        "manufactured by",
        "components sourced from",
        "revenue from",
        "investment in",
        "ownership stake in",
    }
)
BEFORE_TARGET_RULES: tuple[dict[str, Any], ...] = (
    {
        "signal_type": "supplier",
        "relationship_type": "supply",
        "keyword": "supplies",
        "confidence_hint": 0.91,
        "trigger": re.compile(r"\bsupplies\b", re.IGNORECASE),
    },
    {
        "signal_type": "customer",
        "relationship_type": "supplier_customer",
        "keyword": "accounted for revenue",
        "confidence_hint": 0.93,
        "trigger": re.compile(r"\baccounted\s+for\b", re.IGNORECASE),
    },
)


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


def visible_text(value: str) -> str:
    visible = TAG_PATTERN.sub(" ", html.unescape(value))
    visible = HTML_ATTRIBUTE_FRAGMENT_PATTERN.sub(" ", visible)
    visible = CSS_FRAGMENT_PATTERN.sub(" ", visible)
    visible = UNTERMINATED_ATTRIBUTE_FRAGMENT_PATTERN.sub(" ", visible)
    visible = visible.replace("<", " ").replace(">", " ")
    visible = re.sub(
        r"\b(?:td|tr|div|span|table|tbody|ix|xbrli)\b",
        " ",
        visible,
        flags=re.IGNORECASE,
    )
    return " ".join(visible.split())


def normalized_target_key(value: str) -> str:
    normalized = html.unescape(value).lower().replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def target_looks_generic(value: str) -> bool:
    key = normalized_target_key(value)
    if not key or key in GENERIC_TARGET_KEYS:
        return True
    words = key.split()
    if words[:1] in (["customer"], ["supplier"], ["vendor"]):
        return True
    if words[-1:] in (["customer"], ["supplier"], ["vendor"]):
        return len(words) <= 2
    return False


def build_plain_snippet(text: str, match_start: int, match_end: int) -> str:
    snippet_start = max(0, match_start - STRONG_RELATIONSHIP_CONTEXT_CHARS)
    snippet_end = min(len(text), match_end + STRONG_RELATIONSHIP_CONTEXT_CHARS)
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""
    return f"{prefix}{' '.join(text[snippet_start:snippet_end].split())}{suffix}"


def clean_target(value: str) -> str | None:
    target = " ".join(value.strip(" ,.;:()[]").split())
    return None if target_looks_generic(target) else target


def target_after(text: str, start: int, *, allow_indirect_with: bool = False) -> str | None:
    window = text[start : min(len(text), start + 180)]
    match = ENTITY_AT_START_PATTERN.search(window)
    if match is not None:
        return clean_target(match.group("target"))
    if not allow_indirect_with:
        return None
    indirect_match = ENTITY_AFTER_WITH_PATTERN.search(window)
    if indirect_match is None:
        return None
    return clean_target(indirect_match.group("target"))


def target_before(text: str, end: int) -> str | None:
    window = text[max(0, end - 180) : end]
    match = ENTITY_BEFORE_PATTERN.search(window)
    if match is None:
        return None
    return clean_target(match.group("target"))


def accounted_for_revenue_context(text: str, match_end: int) -> bool:
    window = text[match_end : min(len(text), match_end + 80)]
    return ACCOUNTED_FOR_REVENUE_PATTERN.search(window) is not None


def relationship_signal(
    *,
    rule: dict[str, Any],
    text: str,
    match_start: int,
    match_end: int,
    target: str,
) -> dict[str, Any]:
    return {
        "type": rule["signal_type"],
        "text_snippet": build_plain_snippet(text, match_start, match_end),
        "confidence_hint": rule["confidence_hint"],
        "keyword": rule["keyword"],
        "offset": match_start,
        "length": match_end - match_start,
        "relationship_signal": rule["keyword"],
        "relationship_type_hint": rule["relationship_type"],
        "target_entity_mention_hint": target,
        "extraction_method": "strong_relationship_pattern",
    }


def extract_strong_relationship_signals(text: str) -> list[dict[str, Any]]:
    plain_text = visible_text(text)
    signals: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, int]] = set()

    for rule in AFTER_TARGET_RULES:
        for match in rule["trigger"].finditer(plain_text):
            target = target_after(
                plain_text,
                match.end(),
                allow_indirect_with=rule["keyword"] == "revenue from",
            )
            if target is None:
                continue
            key = (
                str(rule["signal_type"]),
                str(rule["keyword"]),
                normalized_target_key(target),
                match.start(),
            )
            if key in seen:
                continue
            seen.add(key)
            signals.append(
                relationship_signal(
                    rule=rule,
                    text=plain_text,
                    match_start=match.start(),
                    match_end=min(len(plain_text), match.end() + len(target)),
                    target=target,
                )
            )

    for rule in BEFORE_TARGET_RULES:
        for match in rule["trigger"].finditer(plain_text):
            if (
                rule["keyword"] == "accounted for revenue"
                and not accounted_for_revenue_context(plain_text, match.end())
            ):
                continue
            target = target_before(plain_text, match.start())
            if target is None:
                continue
            key = (
                str(rule["signal_type"]),
                str(rule["keyword"]),
                normalized_target_key(target),
                match.start(),
            )
            if key in seen:
                continue
            seen.add(key)
            signals.append(
                relationship_signal(
                    rule=rule,
                    text=plain_text,
                    match_start=max(0, match.start() - len(target)),
                    match_end=match.end(),
                    target=target,
                )
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


def merge_signals(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int, str]] = set()
    for signal in sorted(
        signals,
        key=lambda item: (
            -item["confidence_hint"],
            item["offset"],
            item["type"],
            item["keyword"],
        ),
    ):
        key = (
            str(signal["type"]),
            str(signal["keyword"]),
            int(signal["offset"]),
            normalized_target_key(str(signal.get("target_entity_mention_hint") or "")),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(signal)
    return merged


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
    signals = merge_signals(
        [
            *extract_strong_relationship_signals(scan_text),
            *extract_signals(scan_text),
        ]
    )
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


def snippet_row(
    signal: dict[str, Any],
    *,
    rank: int,
    keyword_frequency: Counter[tuple[str, str]],
) -> dict[str, Any]:
    row = {
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
    for optional_field in (
        "relationship_signal",
        "relationship_type_hint",
        "target_entity_mention_hint",
        "extraction_method",
    ):
        if optional_field in signal:
            row[optional_field] = signal[optional_field]
    return row


def ranked_snippets(
    signals: list[dict[str, Any]],
    keyword_frequency: Counter[tuple[str, str]],
) -> list[dict[str, Any]]:
    ranked = sorted(
        signals,
        key=lambda signal: (
            0 if signal.get("extraction_method") == "strong_relationship_pattern" else 1,
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
        snippets.append(snippet_row(signal, rank=rank, keyword_frequency=keyword_frequency))
    return snippets


def candidate_snippets(
    signals: list[dict[str, Any]],
    keyword_frequency: Counter[tuple[str, str]],
) -> list[dict[str, Any]]:
    ranked = sorted(
        (
            signal
            for signal in signals
            if signal["type"] != "dependency"
        ),
        key=lambda signal: (
            0 if signal.get("extraction_method") == "strong_relationship_pattern" else 1,
            -signal["confidence_hint"],
            -signal["recency_rank"],
            -keyword_frequency[(signal["type"], signal["keyword"])],
            signal["file_index"],
            signal["offset"],
            signal["type"],
            signal["keyword"],
        ),
    )

    snippets: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str, str]] = set()
    for signal in ranked:
        key = (
            str(signal["file"]),
            str(signal["type"]),
            str(signal["keyword"]),
            normalized_target_key(str(signal.get("target_entity_mention_hint") or "")),
            normalized_target_key(str(signal["text_snippet"]))[:140],
        )
        if key in seen:
            continue
        seen.add(key)
        snippets.append(
            snippet_row(
                signal,
                rank=len(snippets) + 1,
                keyword_frequency=keyword_frequency,
            )
        )
        if len(snippets) >= DEFAULT_CANDIDATE_SNIPPETS:
            break
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
        "candidate_snippets": candidate_snippets(all_signals, keyword_frequency),
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
    print(f"Candidate snippets: {len(report['candidate_snippets'])}")

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
        target_hint = snippet.get("target_entity_mention_hint")
        if target_hint:
            print(f"   target_hint={target_hint}")
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
