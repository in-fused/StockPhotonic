#!/usr/bin/env python3
"""Promote validated SEC relationship candidates into production graph data.

Default mode is a dry run. The script writes only data/connections.json, and
only when --write is passed explicitly.
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

TARGET_MATCH_CONFIDENCE_THRESHOLD = 0.85
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)

PARTNERSHIP_TERMS = (
    "revenue from",
    "licensing",
    "search distribution",
    "payments from",
)
SUPPLY_TERMS = (
    "supplies",
    "manufactures for",
    "component supplier",
)

PARTNERSHIP_LABEL = "SEC filing relationship: licensing/search distribution"
SUPPLY_LABEL = "SEC filing relationship: supply dependency"
PROVENANCE = "SEC filing"

CLASSIFICATION_ORDER = (
    "promotable",
    "missing_source_ticker",
    "missing_target_ticker",
    "low_target_match_confidence",
    "source_not_in_production",
    "target_not_in_production",
    "self_edge",
    "unsupported_relationship_type",
    "missing_evidence_snippet",
    "missing_filing_date",
    "invalid_confidence_hint",
    "duplicate_existing_edge",
    "duplicate_candidate_edge",
)


class PromotionError(Exception):
    """Raised for promotion failures that should stop the command."""


@dataclass(frozen=True)
class Company:
    company_id: int
    ticker: str
    name: str


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Safely promote validated SEC relationship candidates into "
            "data/connections.json. Defaults to dry-run mode."
        )
    )
    parser.add_argument(
        "--candidates",
        default=str(DEFAULT_CANDIDATE_PATH),
        help="SEC relationship candidate file. Default: data/candidates/sec_relationship_candidates.json.",
    )
    parser.add_argument(
        "--companies",
        default=str(DEFAULT_COMPANIES_PATH),
        help="Production companies file to read. Default: data/companies.json.",
    )
    parser.add_argument(
        "--connections",
        default=str(DEFAULT_CONNECTIONS_PATH),
        help="Production connections file to read/write. Default: data/connections.json.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview promotable candidates without writing. This is the default.",
    )
    mode.add_argument(
        "--write",
        action="store_true",
        help="Append validated, non-duplicate candidate edges to data/connections.json.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON result payload.",
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
        raise PromotionError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PromotionError(f"could not parse {label} file {path}: {exc}") from exc


def write_json(path: Path, payload: Any) -> None:
    try:
        original = path.read_bytes()
        newline = "\r\n" if b"\r\n" in original else "\n"
        text = json.dumps(payload, indent=2) + "\n"
        with path.open("w", encoding="utf-8", newline=newline) as file:
            file.write(text)
    except OSError as exc:
        raise PromotionError(f"could not write connections file {path}: {exc}") from exc


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
        raise PromotionError("candidate file metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionError("candidate file metadata.status must be candidate_only.")
    if metadata.get("app_load_allowed") is not False:
        raise PromotionError("candidate file metadata.app_load_allowed must be false.")


def load_candidate_payload(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "candidate")
    if not isinstance(payload, dict):
        raise PromotionError("candidate file must contain a JSON object.")

    validate_candidate_metadata(payload)
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise PromotionError("candidate file candidates must be a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise PromotionError(f"candidate {index} must be an object.")
        normalized_candidates.append(candidate)
    return normalized_candidates


def build_company_map(raw_companies: Any) -> dict[str, Company]:
    if not isinstance(raw_companies, list):
        raise PromotionError("production companies data must be a JSON array.")

    ticker_to_company: dict[str, Company] = {}
    for index, company in enumerate(raw_companies):
        if not isinstance(company, dict):
            raise PromotionError(f"company {index} must be an object.")

        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        name = clean_string(company.get("name"))
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise PromotionError(f"company {index} id must be an integer.")
        if ticker is None:
            raise PromotionError(f"company {company_id} ticker must be present.")
        if name is None:
            raise PromotionError(f"company {company_id} name must be present.")
        if ticker in ticker_to_company:
            raise PromotionError(f"duplicate production ticker: {ticker}.")
        ticker_to_company[ticker] = Company(
            company_id=company_id,
            ticker=ticker,
            name=name,
        )
    return ticker_to_company


def edge_key(source: int, target: int, connection_type: str) -> tuple[int, int, str]:
    return (min(source, target), max(source, target), connection_type.lower())


def build_existing_edge_keys(raw_connections: Any) -> set[tuple[int, int, str]]:
    if not isinstance(raw_connections, list):
        raise PromotionError("production connections data must be a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(raw_connections):
        if not isinstance(connection, dict):
            raise PromotionError(f"connection {index} must be an object.")

        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if not (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            continue

        key = edge_key(source, target, connection_type)
        if key in keys:
            raise PromotionError(
                "production connections already contain duplicate edge "
                f"{source}-{target} ({connection_type})."
            )
        keys.add(key)
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
    if relationship_type in {"partnership", "supply"}:
        return relationship_type, f"direct:{relationship_type}"

    if relationship_type != "supplier_customer":
        return None, None

    evidence = clean_string(candidate.get("evidence_snippet")) or ""
    partnership_hits = term_hits(evidence, PARTNERSHIP_TERMS)
    if partnership_hits:
        return "partnership", "supplier_customer:evidence_partnership_terms"

    supply_hits = term_hits(evidence, SUPPLY_TERMS)
    if supply_hits:
        return "supply", "supplier_customer:evidence_supply_terms"

    return None, None


def archive_urls_from_candidate(candidate: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    archive_url = candidate.get("archive_url")
    if isinstance(archive_url, str):
        raw_urls.append(archive_url)

    source_urls = candidate.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)

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


def edge_label(connection_type: str) -> str:
    if connection_type == "partnership":
        return PARTNERSHIP_LABEL
    return SUPPLY_LABEL


def build_edge(
    *,
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
    confidence_hint: float,
    filing_date: str,
) -> dict[str, Any]:
    source_urls = archive_urls_from_candidate(candidate)
    return {
        "source": source.company_id,
        "target": target.company_id,
        "type": connection_type,
        "strength": confidence_hint,
        "label": edge_label(connection_type),
        "confidence": 5 if source_urls else 4,
        "provenance": PROVENANCE,
        "source_urls": source_urls,
        "verified_date": filing_date,
    }


def unique_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for classification in CLASSIFICATION_ORDER:
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
    pending_edge_keys: set[tuple[int, int, str]],
) -> dict[str, Any]:
    reasons: list[str] = []

    source_ticker = normalize_ticker(candidate.get("source_ticker"))
    target_ticker = normalize_ticker(candidate.get("target_ticker"))
    target_match_confidence = numeric_score(candidate.get("target_match_confidence"))
    evidence_snippet = clean_string(candidate.get("evidence_snippet"))
    filing_date = valid_date(candidate.get("filing_date"))
    confidence_hint = numeric_score(candidate.get("confidence_hint"))

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
        target_company = ticker_to_company.get(target_ticker)
        if target_company is None:
            reasons.append("target_not_in_production")

    if (
        target_match_confidence is None
        or target_match_confidence < TARGET_MATCH_CONFIDENCE_THRESHOLD
    ):
        reasons.append("low_target_match_confidence")

    mapped_type, mapping_rule = map_relationship_type(candidate)
    if mapped_type is None:
        reasons.append("unsupported_relationship_type")

    if evidence_snippet is None:
        reasons.append("missing_evidence_snippet")
    if filing_date is None:
        reasons.append("missing_filing_date")
    if confidence_hint is None:
        reasons.append("invalid_confidence_hint")

    candidate_edge_key: tuple[int, int, str] | None = None
    if source_company and target_company:
        if source_company.company_id == target_company.company_id:
            reasons.append("self_edge")
        elif mapped_type:
            candidate_edge_key = edge_key(
                source_company.company_id,
                target_company.company_id,
                mapped_type,
            )
            if candidate_edge_key in existing_edge_keys:
                reasons.append("duplicate_existing_edge")
            elif candidate_edge_key in pending_edge_keys:
                reasons.append("duplicate_candidate_edge")

    classifications = unique_reasons(reasons) if reasons else ["promotable"]
    proposed_edge = None
    if (
        classifications == ["promotable"]
        and source_company
        and target_company
        and mapped_type
        and confidence_hint is not None
        and filing_date is not None
    ):
        proposed_edge = build_edge(
            candidate=candidate,
            source=source_company,
            target=target_company,
            connection_type=mapped_type,
            confidence_hint=confidence_hint,
            filing_date=filing_date,
        )

    return {
        "index": index,
        "source_ticker": source_ticker,
        "target_ticker": target_ticker,
        "source_company_id": source_company.company_id if source_company else None,
        "target_company_id": target_company.company_id if target_company else None,
        "relationship_type": clean_string(candidate.get("relationship_type")),
        "mapped_production_type": mapped_type,
        "mapping_rule": mapping_rule,
        "target_match_confidence": target_match_confidence,
        "confidence_hint": confidence_hint,
        "filing_date": filing_date,
        "classifications": classifications,
        "edge_key": list(candidate_edge_key) if candidate_edge_key else None,
        "proposed_edge": proposed_edge,
    }


def build_result(
    *,
    candidate_path: Path,
    companies_path: Path,
    connections_path: Path,
    write: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    candidates = load_candidate_payload(candidate_path)
    ticker_to_company = build_company_map(load_json(companies_path, "companies"))
    connections = load_json(connections_path, "connections")
    existing_edge_keys = build_existing_edge_keys(connections)
    pending_edge_keys: set[tuple[int, int, str]] = set()

    records: list[dict[str, Any]] = []
    new_edges: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        record = inspect_candidate(
            candidate,
            index=index,
            ticker_to_company=ticker_to_company,
            existing_edge_keys=existing_edge_keys,
            pending_edge_keys=pending_edge_keys,
        )
        records.append(record)
        proposed_edge = record.get("proposed_edge")
        if isinstance(proposed_edge, dict):
            new_edges.append(proposed_edge)
            pending_edge_keys.add(
                edge_key(
                    proposed_edge["source"],
                    proposed_edge["target"],
                    proposed_edge["type"],
                )
            )

    classification_counts: Counter[str] = Counter()
    for record in records:
        classification_counts.update(record["classifications"])

    duplicate_count = (
        classification_counts["duplicate_existing_edge"]
        + classification_counts["duplicate_candidate_edge"]
    )
    summary = {
        "mode": "write" if write else "dry-run",
        "total_candidates": len(candidates),
        "promotable_edges": len(new_edges),
        "blocked_candidates": len(candidates) - len(new_edges),
        "duplicates_suppressed": duplicate_count,
        "production_writes": len(new_edges) if write else 0,
    }
    result = {
        "promotion_type": "sec_candidate_promote",
        "candidate_file": display_path(candidate_path),
        "production_files": {
            "companies": display_path(companies_path),
            "connections": display_path(connections_path),
        },
        "summary": summary,
        "classification_counts": {
            classification: classification_counts[classification]
            for classification in CLASSIFICATION_ORDER
        },
        "records": records,
        "new_edges": new_edges,
        "safety": {
            "network_calls": 0,
            "companies_written": 0,
            "connections_written": 1 if write and new_edges else 0,
            "production_writes": len(new_edges) if write else 0,
        },
    }

    if not isinstance(connections, list):
        raise PromotionError("production connections data must be a JSON array.")
    return result, connections, new_edges


def validate_merged_connections(connections: list[Any]) -> None:
    seen: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            raise PromotionError(f"merged connection {index} must be an object.")
        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if not (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            raise PromotionError(f"merged connection {index} has an invalid edge key.")
        key = edge_key(source, target, connection_type)
        if key in seen:
            raise PromotionError(
                f"merged connections would contain duplicate edge {source}-{target} "
                f"({connection_type})."
            )
        seen.add(key)


def print_human(result: dict[str, Any]) -> None:
    summary = result["summary"]
    print("SEC candidate promotion")
    print("=======================")
    print(f"Mode: {summary['mode']}")
    print(f"Candidate file: {result['candidate_file']}")
    print(f"Production companies: {result['production_files']['companies']}")
    print(f"Production connections: {result['production_files']['connections']}")
    print(f"Total candidates: {summary['total_candidates']}")
    print(f"Promotable new edges: {summary['promotable_edges']}")
    print(f"Blocked candidates: {summary['blocked_candidates']}")
    print(f"Duplicates suppressed: {summary['duplicates_suppressed']}")
    print(f"Production writes: {summary['production_writes']}")

    print()
    print("New edges")
    print("---------")
    if not result["new_edges"]:
        print("none")
    for record in result["records"]:
        if record["classifications"] != ["promotable"]:
            continue
        edge = record["proposed_edge"]
        print(
            f"- candidate {record['index']}: "
            f"{record['source_ticker']}({edge['source']}) -> "
            f"{record['target_ticker']}({edge['target']}) "
            f"{edge['type']} strength={edge['strength']} "
            f"confidence={edge['confidence']} "
            f"verified_date={edge['verified_date']}"
        )

    print()
    print("Blocked candidates")
    print("------------------")
    blocked = [
        record for record in result["records"]
        if record["classifications"] != ["promotable"]
    ]
    if not blocked:
        print("none")
    for record in blocked:
        print(
            f"- candidate {record['index']}: "
            f"{', '.join(record['classifications'])}"
        )

    print()
    print("Safety")
    print("------")
    for key, value in result["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    candidate_path = resolve_path(args.candidates)
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)

    try:
        result, connections, new_edges = build_result(
            candidate_path=candidate_path,
            companies_path=companies_path,
            connections_path=connections_path,
            write=args.write,
        )
        if args.write and new_edges:
            merged_connections = [*connections, *new_edges]
            validate_merged_connections(merged_connections)
            write_json(connections_path, merged_connections)
            # Re-read immediately so a malformed write cannot go unnoticed.
            reloaded_connections = load_json(connections_path, "connections")
            if not isinstance(reloaded_connections, list):
                raise PromotionError("written connections file is not a JSON array.")
            validate_merged_connections(reloaded_connections)
    except PromotionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
