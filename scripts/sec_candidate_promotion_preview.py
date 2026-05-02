#!/usr/bin/env python3
"""Preview SEC relationship candidates that could later become graph edges.

This tool is intentionally read-only. It inspects review-only SEC candidate
records against the current production graph files and prints a promotion
preview without modifying any data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATE_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"

ALLOWED_PRODUCTION_TYPES = {
    "supply",
    "partnership",
    "ecosystem",
    "competitor",
    "investment",
}
LOW_CONFIDENCE_THRESHOLD = 0.70
TARGET_MATCH_CONFIDENCE_THRESHOLD = 0.85
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)

SUPPLY_TERMS = (
    "supplies",
    "manufactures for",
    "component supplier",
)
PARTNERSHIP_TERMS = (
    "revenue from",
    "licensing",
    "search distribution",
    "payments from",
)
CLASSIFICATION_ORDER = (
    "promotable_preview",
    "missing_source_ticker",
    "missing_target_ticker",
    "missing_target_name",
    "low_target_match_confidence",
    "source_not_in_production",
    "target_not_in_production",
    "duplicate_existing_edge",
    "unsupported_relationship_type",
    "missing_evidence",
    "low_confidence",
)


class PromotionPreviewError(Exception):
    """Raised for clear promotion preview failures."""


@dataclass(frozen=True)
class Company:
    company_id: int
    ticker: str
    name: str


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview which review-only SEC relationship candidates could later "
            "become production graph edges. The command reads candidate and "
            "production graph JSON files only and never writes data."
        )
    )
    parser.add_argument(
        "--candidates",
        default=str(DEFAULT_CANDIDATE_PATH),
        help=(
            "Review-only SEC relationship candidate file. "
            "Default: data/candidates/sec_relationship_candidates.json."
        ),
    )
    parser.add_argument(
        "--companies",
        default=str(DEFAULT_COMPANIES_PATH),
        help="Production companies file to read. Default: data/companies.json.",
    )
    parser.add_argument(
        "--connections",
        default=str(DEFAULT_CONNECTIONS_PATH),
        help="Production connections file to read. Default: data/connections.json.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON preview payload.",
    )
    return parser.parse_args(argv)


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise PromotionPreviewError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PromotionPreviewError(
            f"could not parse {label} file {path}: {exc}"
        ) from exc


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def normalize_ticker(value: Any) -> str | None:
    ticker = clean_string(value)
    return ticker.upper() if ticker else None


def numeric_score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    if not 0 <= score <= 1:
        return None
    return score


def valid_date(value: Any) -> str | None:
    date_value = clean_string(value)
    if date_value and DATE_PATTERN.match(date_value):
        return date_value
    return None


def validate_candidate_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise PromotionPreviewError("candidate file metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionPreviewError("candidate file metadata.status must be candidate_only.")
    if metadata.get("production_write_allowed") is not False:
        raise PromotionPreviewError(
            "candidate file metadata.production_write_allowed must be false."
        )
    if metadata.get("app_load_allowed") is not False:
        raise PromotionPreviewError(
            "candidate file metadata.app_load_allowed must be false."
        )


def load_candidate_payload(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = load_json(path, "candidate")
    if not isinstance(payload, dict):
        raise PromotionPreviewError("candidate file must contain a JSON object.")

    validate_candidate_metadata(payload)
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise PromotionPreviewError("candidate file candidates must be a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise PromotionPreviewError(f"candidate {index} must be an object.")
        normalized_candidates.append(candidate)
    return payload, normalized_candidates


def build_company_map(raw_companies: Any) -> dict[str, Company]:
    if not isinstance(raw_companies, list):
        raise PromotionPreviewError("production companies data must be a JSON array.")

    companies: dict[str, Company] = {}
    for index, company in enumerate(raw_companies):
        if not isinstance(company, dict):
            raise PromotionPreviewError(f"company {index} must be an object.")

        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        name = clean_string(company.get("name"))
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise PromotionPreviewError(f"company {index} id must be an integer.")
        if ticker is None:
            raise PromotionPreviewError(f"company {company_id} ticker must be present.")
        if name is None:
            raise PromotionPreviewError(f"company {company_id} name must be present.")
        if ticker in companies:
            raise PromotionPreviewError(f"duplicate production ticker: {ticker}.")
        companies[ticker] = Company(company_id=company_id, ticker=ticker, name=name)
    return companies


def build_existing_edge_keys(raw_connections: Any) -> set[tuple[int, int, str]]:
    if not isinstance(raw_connections, list):
        raise PromotionPreviewError("production connections data must be a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(raw_connections):
        if not isinstance(connection, dict):
            raise PromotionPreviewError(f"connection {index} must be an object.")

        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            keys.add((min(source, target), max(source, target), connection_type.lower()))
    return keys


def term_hits(text: str, terms: tuple[str, ...]) -> list[str]:
    text_lower = text.lower()
    hits: list[str] = []
    for term in terms:
        if " " in term:
            if term in text_lower:
                hits.append(term)
            continue
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, text_lower):
            hits.append(term)
    return hits


def map_relationship_type(candidate: dict[str, Any]) -> tuple[str | None, str | None]:
    raw_type = clean_string(candidate.get("relationship_type"))
    if raw_type is None:
        return None, None

    relationship_type = raw_type.lower()
    if relationship_type in ALLOWED_PRODUCTION_TYPES:
        return relationship_type, f"direct:{relationship_type}"

    if relationship_type != "supplier_customer":
        return None, None

    evidence = clean_string(candidate.get("evidence_snippet")) or ""
    supply_hits = term_hits(evidence, SUPPLY_TERMS)
    partnership_hits = term_hits(evidence, PARTNERSHIP_TERMS)

    if partnership_hits:
        return "partnership", "supplier_customer:evidence_partnership_terms"
    if supply_hits:
        return "supply", "supplier_customer:evidence_supply_terms"
    return None, None


def source_urls_from_candidate(candidate: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    source_urls = candidate.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)
    for field_name in ("source_url", "filing_url", "sec_url", "url"):
        value = candidate.get(field_name)
        if isinstance(value, str):
            raw_urls.append(value)

    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in raw_urls:
        if not isinstance(raw_url, str):
            continue
        url = raw_url.strip()
        if not URL_PATTERN.match(url) or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def missing_evidence_fields(candidate: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if clean_string(candidate.get("evidence_snippet")) is None:
        missing.append("evidence_snippet")
    if valid_date(candidate.get("filing_date")) is None:
        missing.append("filing_date")
    if (
        clean_string(candidate.get("accession_number")) is None
        and not source_urls_from_candidate(candidate)
    ):
        missing.append("accession_number_or_source_url")
    return missing


def proposed_strength(candidate: dict[str, Any], confidence_hint: float) -> float:
    explicit_strength = numeric_score(candidate.get("strength"))
    if explicit_strength is not None:
        return round(explicit_strength, 2)
    return round(confidence_hint, 2)


def proposed_label(
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
) -> str:
    explicit_label = clean_string(candidate.get("label"))
    if explicit_label:
        return explicit_label
    return (
        f"SEC filing {connection_type} signal between "
        f"{source.ticker} and {target.ticker}"
    )


def proposed_provenance(candidate: dict[str, Any], source: Company) -> str:
    explicit_provenance = clean_string(candidate.get("provenance"))
    if explicit_provenance:
        return explicit_provenance

    parts = [f"SEC filing candidate preview from {source.ticker}"]
    accession_number = clean_string(candidate.get("accession_number"))
    filing_date = clean_string(candidate.get("filing_date"))
    if accession_number:
        parts.append(f"accession {accession_number}")
    if filing_date:
        parts.append(f"filed {filing_date}")
    return "; ".join(parts)


def proposed_confidence(edge: dict[str, Any]) -> int:
    has_source_urls = bool(edge.get("source_urls"))
    connection_type = edge.get("type")
    strength = edge.get("strength")

    if has_source_urls:
        return 5 if connection_type in {"supply", "partnership", "investment"} else 4
    if connection_type == "supply" and isinstance(strength, float) and strength >= 0.75:
        return 4
    return 3


def build_proposed_edge(
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
    confidence_hint: float,
) -> dict[str, Any]:
    verified_date = valid_date(candidate.get("verified_date")) or valid_date(
        candidate.get("filing_date")
    )
    edge = {
        "source": source.company_id,
        "target": target.company_id,
        "type": connection_type,
        "strength": proposed_strength(candidate, confidence_hint),
        "label": proposed_label(candidate, source, target, connection_type),
        "confidence": 3,
        "provenance": proposed_provenance(candidate, source),
        "source_urls": source_urls_from_candidate(candidate),
        "verified_date": verified_date,
    }
    edge["confidence"] = proposed_confidence(edge)
    return edge


def unique_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for classification in CLASSIFICATION_ORDER:
        if classification == "promotable_preview":
            continue
        if classification in reasons and classification not in seen:
            seen.add(classification)
            ordered.append(classification)
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered.append(reason)
    return ordered


def inspect_candidate(
    candidate: dict[str, Any],
    *,
    index: int,
    ticker_to_company: dict[str, Company],
    existing_edge_keys: set[tuple[int, int, str]],
) -> dict[str, Any]:
    reasons: list[str] = []
    source_ticker = normalize_ticker(candidate.get("source_ticker"))
    target_ticker = normalize_ticker(candidate.get("target_ticker"))
    target_name = clean_string(candidate.get("target_name"))
    target_match_confidence = numeric_score(candidate.get("target_match_confidence"))

    source_company: Company | None = None
    target_company: Company | None = None

    if source_ticker is None:
        reasons.append("missing_source_ticker")
    else:
        source_company = ticker_to_company.get(source_ticker)
        if source_company is None:
            reasons.append("source_not_in_production")

    if target_ticker is None:
        reasons.append("missing_target_ticker")
    else:
        if target_name is None:
            reasons.append("missing_target_name")
        if (
            target_match_confidence is None
            or target_match_confidence < TARGET_MATCH_CONFIDENCE_THRESHOLD
        ):
            reasons.append("low_target_match_confidence")
        target_company = ticker_to_company.get(target_ticker)
        if target_company is None:
            reasons.append("target_not_in_production")

    mapped_type, mapping_rule = map_relationship_type(candidate)
    if mapped_type is None:
        reasons.append("unsupported_relationship_type")

    evidence_missing = missing_evidence_fields(candidate)
    if evidence_missing:
        reasons.append("missing_evidence")

    confidence_hint = numeric_score(candidate.get("confidence_hint"))
    if confidence_hint is None or confidence_hint < LOW_CONFIDENCE_THRESHOLD:
        reasons.append("low_confidence")

    if source_company and target_company and mapped_type:
        edge_key = (
            min(source_company.company_id, target_company.company_id),
            max(source_company.company_id, target_company.company_id),
            mapped_type,
        )
        if edge_key in existing_edge_keys:
            reasons.append("duplicate_existing_edge")

    blocked_reasons = unique_reasons(reasons)
    classifications = blocked_reasons if blocked_reasons else ["promotable_preview"]
    proposed_edge = None
    if not blocked_reasons and source_company and target_company and mapped_type and confidence_hint is not None:
        proposed_edge = build_proposed_edge(
            candidate,
            source_company,
            target_company,
            mapped_type,
            confidence_hint,
        )

    return {
        "index": index,
        "source_ticker": source_ticker,
        "target_ticker": target_ticker,
        "relationship_type": clean_string(candidate.get("relationship_type")),
        "mapped_production_type": mapped_type,
        "mapping_rule": mapping_rule,
        "classifications": classifications,
        "evidence_missing_fields": evidence_missing,
        "confidence_hint": confidence_hint,
        "proposed_edge": proposed_edge,
    }


def build_preview(
    *,
    candidate_path: Path,
    companies_path: Path,
    connections_path: Path,
) -> dict[str, Any]:
    _, candidates = load_candidate_payload(candidate_path)
    ticker_to_company = build_company_map(load_json(companies_path, "companies"))
    existing_edge_keys = build_existing_edge_keys(
        load_json(connections_path, "connections")
    )

    records = [
        inspect_candidate(
            candidate,
            index=index,
            ticker_to_company=ticker_to_company,
            existing_edge_keys=existing_edge_keys,
        )
        for index, candidate in enumerate(candidates, start=1)
    ]

    classification_counts: Counter[str] = Counter()
    for record in records:
        classification_counts.update(record["classifications"])

    promotable_count = classification_counts["promotable_preview"]
    duplicate_count = classification_counts["duplicate_existing_edge"]
    summary = {
        "total_candidates": len(candidates),
        "promotable_previews": promotable_count,
        "blocked_count": len(candidates) - promotable_count,
        "duplicate_count": duplicate_count,
        "production_writes": 0,
    }

    return {
        "preview_type": "sec_candidate_promotion_preview",
        "candidate_file": display_path(candidate_path),
        "production_files_read": {
            "companies": display_path(companies_path),
            "connections": display_path(connections_path),
        },
        "summary": summary,
        "classification_counts": {
            classification: classification_counts[classification]
            for classification in CLASSIFICATION_ORDER
        },
        "records": records,
        "safety": {
            "network_calls": 0,
            "production_writes": 0,
        },
    }


def print_human(preview: dict[str, Any]) -> None:
    summary = preview["summary"]
    print("SEC candidate promotion preview")
    print("===============================")
    print(f"Candidate file: {preview['candidate_file']}")
    print(f"Production companies read: {preview['production_files_read']['companies']}")
    print(f"Production connections read: {preview['production_files_read']['connections']}")
    print(f"Total candidates: {summary['total_candidates']}")
    print(f"Promotable previews: {summary['promotable_previews']}")
    print(f"Blocked count: {summary['blocked_count']}")
    print(f"Duplicate count: {summary['duplicate_count']}")
    print(f"Production writes: {summary['production_writes']}")

    print()
    print("Classification counts")
    print("---------------------")
    for classification, count in preview["classification_counts"].items():
        print(f"- {classification}: {count}")

    print()
    print("Promotable preview edges")
    print("------------------------")
    promotable_records = [
        record for record in preview["records"]
        if record["classifications"] == ["promotable_preview"]
    ]
    if not promotable_records:
        print("none")
    for record in promotable_records:
        print(f"candidate {record['index']}:")
        print(json.dumps(record["proposed_edge"], indent=2, sort_keys=True))

    blocked_records = [
        record for record in preview["records"]
        if record["classifications"] != ["promotable_preview"]
    ]
    print()
    print("Blocked candidates")
    print("------------------")
    if not blocked_records:
        print("none")
    for record in blocked_records:
        print(
            f"- candidate {record['index']}: "
            f"{', '.join(record['classifications'])}"
        )

    print()
    print("Safety")
    print("------")
    print("- network_calls: 0")
    print("- production_writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    candidate_path = resolve_path(args.candidates)
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)

    try:
        preview = build_preview(
            candidate_path=candidate_path,
            companies_path=companies_path,
            connections_path=connections_path,
        )
    except PromotionPreviewError as exc:
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
