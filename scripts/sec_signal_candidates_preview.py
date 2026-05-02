#!/usr/bin/env python3
"""Preview relationship candidate objects from cached SEC filing signal reports."""

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
PROJECT_ROOT = SCRIPT_DIR.parent
PRODUCTION_COMPANIES_PATH = PROJECT_ROOT / "data" / "companies.json"
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
ALIAS_FIELD_NAMES = (
    "aliases",
    "alias",
    "common_aliases",
    "alternate_names",
    "alternative_names",
    "former_names",
    "aka",
)
COMMON_PUBLIC_ALIASES_BY_TICKER = {
    "GOOGL": ("Google", "Google LLC", "Google Inc.", "Google, Inc."),
    "GOOG": ("Google", "Google LLC", "Google Inc.", "Google, Inc."),
    "META": ("Facebook", "Facebook Inc.", "Facebook, Inc."),
}
LEGAL_SUFFIXES = (
    "Corporation",
    "Corp.",
    "Corp",
    "Incorporated",
    "Inc.",
    "Inc",
    "LLC",
    "L.L.C.",
    "Limited",
    "Ltd.",
    "Ltd",
    "PLC",
    "plc",
    "N.V.",
    "S.A.",
    "AG",
    "SE",
)
LEGAL_SUFFIX_WORDS = {
    "ag",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "ltd",
    "nv",
    "plc",
    "sa",
    "se",
}
ENTITY_NAME_PATTERN = re.compile(
    r"\b("
    r"(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})"
    r"(?:\s+(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})){0,7}"
    r"\s*,?\s+"
    rf"(?:{'|'.join(re.escape(suffix) for suffix in LEGAL_SUFFIXES)})"
    r")\b"
)
TICKER_REFERENCE_PATTERN = re.compile(
    r"\b(?:NASDAQ|Nasdaq|NYSE|NYSEARCA|NYSE American|NasdaqGS)\s*[:\-]\s*"
    r"([A-Z][A-Z.]{0,5})\b"
)
TAG_PATTERN = re.compile(r"<[^>]+>")
XBRL_NOISE_MARKERS = (
    "xbrli:",
    "ix:",
    "unitref",
    "contextref",
    "nonfraction",
    "nonnumeric",
)
XBRL_PROSE_STOP_WORDS = {
    "aapl",
    "contextref",
    "decimals",
    "format",
    "gaap",
    "identifier",
    "measure",
    "nonfraction",
    "nonnumeric",
    "pure",
    "scale",
    "shares",
    "unitdenominator",
    "unitnumerator",
    "unitref",
    "xbrli",
}


class CandidatePreviewError(Exception):
    """Raised for clear candidate preview failures."""


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


def visible_snippet_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(TAG_PATTERN.sub(" ", html.unescape(value)).split())


def normalize_match_key(value: str) -> str:
    normalized = html.unescape(value).lower().replace("&", " and ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def base_match_key(value: str) -> str:
    parts = normalize_match_key(value).split()
    while parts and parts[-1] in LEGAL_SUFFIX_WORDS:
        parts.pop()
    return " ".join(parts)


def company_alias_values(company: dict[str, Any]) -> list[str]:
    aliases: list[str] = []
    for field_name in ALIAS_FIELD_NAMES:
        value = company.get(field_name)
        if isinstance(value, str):
            aliases.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    aliases.append(item)
                elif isinstance(item, dict):
                    for key in ("name", "value", "alias"):
                        item_value = item.get(key)
                        if isinstance(item_value, str):
                            aliases.append(item_value)
                            break
    return aliases


def load_production_companies() -> list[dict[str, str]]:
    try:
        with PRODUCTION_COMPANIES_PATH.open("r", encoding="utf-8") as file:
            raw_companies = json.load(file)
    except OSError as exc:
        raise CandidatePreviewError(
            f"could not read production companies file {PRODUCTION_COMPANIES_PATH}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise CandidatePreviewError(
            f"could not parse production companies file {PRODUCTION_COMPANIES_PATH}: {exc}"
        ) from exc

    if not isinstance(raw_companies, list):
        raise CandidatePreviewError("production companies data must be a JSON array.")

    companies: list[dict[str, str]] = []
    for index, raw_company in enumerate(raw_companies, start=1):
        if not isinstance(raw_company, dict):
            continue
        ticker = clean_optional_string(raw_company.get("ticker"))
        name = clean_optional_string(raw_company.get("name"))
        if ticker is None or name is None:
            continue
        companies.append(
            {
                "ticker": ticker.upper(),
                "name": name,
                "_index": str(index),
                "_aliases": json.dumps(company_alias_values(raw_company)),
            }
        )
    return companies


def add_matcher_entry(
    matcher: dict[str, list[dict[str, Any]]],
    key: str,
    company: dict[str, str],
    *,
    method: str,
    confidence: float,
) -> None:
    if not key:
        return
    matcher.setdefault(key, []).append(
        {
            "ticker": company["ticker"],
            "name": company["name"],
            "method": method,
            "confidence": confidence,
        }
    )


def build_company_matcher() -> dict[str, list[dict[str, Any]]]:
    companies = load_production_companies()
    matcher: dict[str, list[dict[str, Any]]] = {}
    companies_by_ticker = {company["ticker"]: company for company in companies}

    for company in companies:
        name = company["name"]
        add_matcher_entry(
            matcher,
            normalize_match_key(name),
            company,
            method="company_name_exact",
            confidence=0.98,
        )
        add_matcher_entry(
            matcher,
            base_match_key(name),
            company,
            method="company_name_base",
            confidence=0.9,
        )
        add_matcher_entry(
            matcher,
            normalize_match_key(company["ticker"]),
            company,
            method="ticker_exact",
            confidence=0.98,
        )

        aliases = json.loads(company["_aliases"])
        for alias in aliases:
            add_matcher_entry(
                matcher,
                normalize_match_key(alias),
                company,
                method="company_alias_exact",
                confidence=0.95,
            )
            add_matcher_entry(
                matcher,
                base_match_key(alias),
                company,
                method="company_alias_base",
                confidence=0.9,
            )

    for ticker, aliases in COMMON_PUBLIC_ALIASES_BY_TICKER.items():
        company = companies_by_ticker.get(ticker)
        if company is None:
            continue
        for alias in aliases:
            add_matcher_entry(
                matcher,
                normalize_match_key(alias),
                company,
                method="common_public_alias_exact",
                confidence=0.92,
            )
            add_matcher_entry(
                matcher,
                base_match_key(alias),
                company,
                method="common_public_alias_base",
                confidence=0.88,
            )

    return matcher


def resolve_matcher_key(
    matcher: dict[str, list[dict[str, Any]]],
    key: str,
) -> dict[str, Any] | None:
    entries = matcher.get(key, [])
    if not entries:
        return None

    by_ticker: dict[str, dict[str, Any]] = {}
    for entry in entries:
        current = by_ticker.get(entry["ticker"])
        if current is None or entry["confidence"] > current["confidence"]:
            by_ticker[entry["ticker"]] = entry

    if len(by_ticker) != 1:
        return None
    return next(iter(by_ticker.values()))


def resolve_entity_mention(
    matcher: dict[str, list[dict[str, Any]]],
    mention: str,
) -> dict[str, Any] | None:
    return (
        resolve_matcher_key(matcher, normalize_match_key(mention))
        or resolve_matcher_key(matcher, base_match_key(mention))
    )


def unique_ordered(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = normalize_match_key(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(value.strip())
    return ordered


def extract_entity_mentions(snippet_text: Any) -> list[str]:
    text = visible_snippet_text(snippet_text)
    mentions = [match.group(1).strip(" ,.;:") for match in ENTITY_NAME_PATTERN.finditer(text)]
    mentions.extend(match.group(1).strip() for match in TICKER_REFERENCE_PATTERN.finditer(text))
    return unique_ordered([mention for mention in mentions if mention])


def resolve_snippet_target(
    snippet_text: Any,
    source_ticker: str | None,
    matcher: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    mentions = extract_entity_mentions(snippet_text)
    matches: list[tuple[int, str, dict[str, Any]]] = []
    unresolved: list[str] = []

    for index, mention in enumerate(mentions):
        match = resolve_entity_mention(matcher, mention)
        if match is None:
            unresolved.append(mention)
            continue
        if source_ticker is not None and match["ticker"] == source_ticker:
            continue
        matches.append((index, mention, match))

    if matches:
        _, mention, match = sorted(
            matches,
            key=lambda item: (-item[2]["confidence"], item[0]),
        )[0]
        return {
            "target_ticker": match["ticker"],
            "target_name": match["name"],
            "target_match_method": match["method"],
            "target_match_confidence": match["confidence"],
            "target_entity_mention": mention,
        }

    return {
        "target_ticker": None,
        "target_name": None,
        "target_match_method": None,
        "target_match_confidence": None,
        "target_entity_mention": None,
        "unresolved_entity_mentions": unresolved,
    }


def xbrl_noise_metrics(snippet: dict[str, Any]) -> dict[str, Any]:
    text = str(snippet.get("text_snippet") or "")
    lower_text = text.lower()
    marker_count = sum(lower_text.count(marker) for marker in XBRL_NOISE_MARKERS)
    visible_text = visible_snippet_text(text)
    prose_words = [
        word.lower()
        for word in re.findall(r"\b[A-Za-z][A-Za-z-]{2,}\b", visible_text)
        if word.lower() not in XBRL_PROSE_STOP_WORDS
    ]
    starts_with_xbrl = bool(
        re.match(
            r"^\.*\s*(?:"
            r"<?/?(?:xbrli|ix):|"
            r"[a-z]*>xbrli:|"
            r"\"[^\"]+\"\s+(?:unitref|contextref|decimals|name|format|scale|id)=|"
            r"(?:unitref|contextref|decimals|name|format|scale|id)="
            r")",
            lower_text,
        )
    )
    dominated = (marker_count >= 3 and len(prose_words) < 14) or (
        marker_count >= 2 and starts_with_xbrl and len(prose_words) < 24
    ) or (
        marker_count >= 6 and starts_with_xbrl
    )
    return {
        "marker_count": marker_count,
        "has_marker": marker_count > 0,
        "is_dominated": dominated,
    }


def preview_ranked_snippets(snippets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scored = [
        (xbrl_noise_metrics(snippet), index, snippet)
        for index, snippet in enumerate(snippets)
    ]
    non_dominated = [
        (metrics, index, snippet)
        for metrics, index, snippet in scored
        if not metrics["is_dominated"]
    ]
    selected = non_dominated if non_dominated else scored
    selected.sort(
        key=lambda item: (
            item[0]["has_marker"],
            item[0]["marker_count"],
            item[2].get("rank", item[1]),
            item[1],
        )
    )
    return [snippet for _, _, snippet in selected]


def candidate_from_snippet(
    snippet: dict[str, Any],
    matcher: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    metadata = snippet.get("metadata")
    metadata_fields = metadata if isinstance(metadata, dict) else {}
    source_ticker = source_ticker_from_metadata(metadata_fields)
    target_resolution = resolve_snippet_target(
        snippet.get("text_snippet"),
        source_ticker,
        matcher,
    )

    candidate = {
        "source_ticker": source_ticker,
        "target_ticker": target_resolution["target_ticker"],
        "target_name": target_resolution["target_name"],
        "target_match_method": target_resolution["target_match_method"],
        "target_match_confidence": target_resolution["target_match_confidence"],
        "target_entity_mention": target_resolution["target_entity_mention"],
        "relationship_type": relationship_type_for(str(snippet.get("type", ""))),
        "source_type": "sec_filing",
        "source_tier": 1,
        "confidence_hint": snippet.get("confidence_hint"),
        "evidence_snippet": snippet.get("text_snippet"),
        "filing_date": clean_optional_string(snippet.get("filing_date")),
        "accession_number": clean_optional_string(metadata_fields.get("accession_number")),
        "review_status": "preview_only",
    }
    unresolved = target_resolution.get("unresolved_entity_mentions")
    if unresolved:
        candidate["unresolved_entity_mentions"] = unresolved
    return candidate


def build_preview(raw_files: list[str], limit_chars: int | None) -> dict[str, Any]:
    report = build_report(raw_files, limit_chars)
    matcher = build_company_matcher()
    ranked_snippets = preview_ranked_snippets(report["top_snippets"])
    candidates = [
        candidate_from_snippet(snippet, matcher)
        for snippet in ranked_snippets
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
    except (CandidatePreviewError, FilingInspectError, SignalExtractionError) as exc:
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
