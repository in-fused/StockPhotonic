#!/usr/bin/env python3
"""
Validate StockPhotonic static JSON data.

Run from the repository root:
    python scripts/validate_data.py

The script uses only the Python standard library and does not modify data files.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"
CANDIDATE_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
CANDIDATE_QUEUE_PATH = ROOT / "data" / "candidates" / "candidate_review_queue.json"
CANDIDATE_SUMMARY_PATH = ROOT / "data" / "candidates" / "candidate_review_summary.json"
CANDIDATE_OVERLAP_PATH = ROOT / "data" / "candidates" / "candidate_overlap_report.json"

ALLOWED_TYPES = {
    "supply",
    "partnership",
    "ecosystem",
    "competitor",
    "investment",
}
ALLOWED_CANDIDATE_TYPES = {
    "supplier_customer",
    "partnership",
    "investment",
    "competitor",
    "cloud_hyperscaler_ecosystem",
    "semiconductor_supply_chain",
    "ai_infrastructure",
    "data_center_power",
}
ALLOWED_REVIEW_ACTIONS = {
    "ignore duplicate",
    "enrich existing edge",
    "review for promotion",
    "needs more evidence",
    "reject as weak signal",
}

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
PLACEHOLDER_NAME_PATTERN = re.compile(r"\bCompany\s+\d+\b", re.IGNORECASE)
SYNTHETIC_TICKER_PATTERN = re.compile(r"\d{2,}$")
GENERIC_LABELS = {
    "supply relationship",
    "partnership relationship",
    "ecosystem relationship",
    "competitor relationship",
    "investment relationship",
    "relationship",
}
GENERIC_LABEL_PATTERN = re.compile(
    r"^(supply|partnership|ecosystem|competitor|investment)\s+(relationship|connection|edge)$",
    re.IGNORECASE,
)
TICKER_SUFFIX_ALLOWLIST: set[str] = set()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def valid_url(value: Any) -> bool:
    return isinstance(value, str) and URL_PATTERN.match(value.strip()) is not None


def compute_confidence(edge: dict[str, Any]) -> int:
    source_urls = edge.get("source_urls")
    has_source_urls = isinstance(source_urls, list) and len(source_urls) > 0
    connection_type = edge.get("type")
    strength = edge.get("strength")

    if has_source_urls:
        confidence = 4
        if connection_type in {"supply", "partnership", "investment"}:
            confidence = 5
    elif connection_type == "supply" and is_number(strength) and float(strength) >= 0.75:
        confidence = 4
    else:
        confidence = 3

    signal_score = edge.get("signal_score")
    if is_number(signal_score):
        normalized_signal_score = float(signal_score)
        if normalized_signal_score >= 0.9 and confidence == 4:
            confidence = 5
        elif normalized_signal_score <= 0.65 and confidence >= 4:
            confidence = 3

    return min(5, max(3, confidence))


def validate_candidate_file(errors: list[str], warnings: list[str]) -> None:
    if not CANDIDATE_PATH.exists():
        warnings.append("SEC candidate file is absent; candidate validation skipped.")
        return

    payload = load_json(CANDIDATE_PATH)
    if not isinstance(payload, dict):
        errors.append("data/candidates/sec_relationship_candidates.json must contain an object.")
        return

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        errors.append("SEC candidate file metadata must be an object.")
    else:
        if metadata.get("status") != "candidate_only":
            errors.append("SEC candidate metadata.status must be candidate_only.")
        if metadata.get("production_write_allowed") is not False:
            errors.append("SEC candidate metadata.production_write_allowed must be false.")
        if metadata.get("app_load_allowed") is not False:
            errors.append("SEC candidate metadata.app_load_allowed must be false.")

    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        errors.append("SEC candidate file candidates must be a list.")
        return

    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            errors.append(f"SEC candidate {index}: record must be an object.")
            continue
        source_ticker = clean_string(candidate.get("source_ticker"))
        target_ticker = clean_string(candidate.get("target_ticker"))
        relationship_type = clean_string(candidate.get("relationship_type"))
        if source_ticker is None:
            errors.append(f"SEC candidate {index}: source_ticker is required.")
        if target_ticker is None:
            errors.append(f"SEC candidate {index}: target_ticker is required.")
        if relationship_type not in ALLOWED_CANDIDATE_TYPES:
            errors.append(
                f"SEC candidate {index}: relationship_type {relationship_type!r} is unsupported."
            )
        evidence_snippet = clean_string(candidate.get("evidence_snippet"))
        if evidence_snippet is None:
            errors.append(f"SEC candidate {index}: evidence_snippet is required.")
        elif len(evidence_snippet) > 900:
            errors.append(f"SEC candidate {index}: evidence_snippet is too long.")
        source_urls = candidate.get("source_urls")
        if source_urls is not None:
            if not isinstance(source_urls, list):
                errors.append(f"SEC candidate {index}: source_urls must be a list.")
            else:
                for url_index, source_url in enumerate(source_urls):
                    if not valid_url(source_url):
                        errors.append(
                            f"SEC candidate {index}: source_urls[{url_index}] must be http(s)."
                        )
        archive_url = candidate.get("archive_url")
        if archive_url is not None and not valid_url(archive_url):
            errors.append(f"SEC candidate {index}: archive_url must be http(s).")


def validate_triage_artifact_file(
    path: Path,
    artifact_name: str,
    errors: list[str],
    warnings: list[str],
) -> None:
    if not path.exists():
        warnings.append(f"{artifact_name} triage artifact is absent; skipped.")
        return

    payload = load_json(path)
    if not isinstance(payload, dict):
        errors.append(f"{artifact_name} triage artifact must contain an object.")
        return

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        errors.append(f"{artifact_name} triage metadata must be an object.")
    else:
        if metadata.get("artifact_status") != "review_only":
            errors.append(f"{artifact_name} triage artifact must be review_only.")
        if metadata.get("production_write_allowed") is not False:
            errors.append(f"{artifact_name} triage artifact cannot allow production writes.")

    records = payload.get("records")
    if records is not None:
        if not isinstance(records, list):
            errors.append(f"{artifact_name} triage records must be a list.")
        else:
            for index, record in enumerate(records, start=1):
                if not isinstance(record, dict):
                    errors.append(f"{artifact_name} record {index}: must be an object.")
                    continue
                if clean_string(record.get("source_ticker")) is None:
                    errors.append(f"{artifact_name} record {index}: missing source_ticker.")
                if clean_string(record.get("target_ticker")) is None:
                    errors.append(f"{artifact_name} record {index}: missing target_ticker.")
                action = clean_string(record.get("recommended_reviewer_action"))
                if action is not None and action not in ALLOWED_REVIEW_ACTIONS:
                    errors.append(
                        f"{artifact_name} record {index}: unsupported reviewer action {action!r}."
                    )

    comparisons = payload.get("comparisons")
    if comparisons is not None:
        if not isinstance(comparisons, list):
            errors.append(f"{artifact_name} comparisons must be a list.")
        else:
            for index, comparison in enumerate(comparisons, start=1):
                if not isinstance(comparison, dict):
                    errors.append(f"{artifact_name} comparison {index}: must be an object.")
                    continue
                action = clean_string(comparison.get("recommended_reviewer_action"))
                if action not in ALLOWED_REVIEW_ACTIONS:
                    errors.append(
                        f"{artifact_name} comparison {index}: unsupported reviewer action {action!r}."
                    )


def validate(strict_confidence: bool = False) -> int:
    errors: list[str] = []
    warnings: list[str] = []

    companies = load_json(COMPANIES_PATH)
    connections = load_json(CONNECTIONS_PATH)

    if not isinstance(companies, list):
        errors.append("data/companies.json must contain a JSON array.")
        companies = []

    if not isinstance(connections, list):
        errors.append("data/connections.json must contain a JSON array.")
        connections = []

    company_ids: set[int] = set()
    duplicate_company_ids: list[int] = []
    ticker_counts: Counter[str] = Counter()

    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            errors.append(f"Company {index}: record must be an object.")
            continue

        company_id = company.get("id")
        ticker = company.get("ticker")
        name = company.get("name")
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            errors.append(f"Company {index}: id must be an integer.")
            continue

        if company_id in company_ids:
            duplicate_company_ids.append(company_id)
        company_ids.add(company_id)

        if not isinstance(ticker, str) or not ticker.strip():
            errors.append(f"Company {company_id}: ticker must be present and non-empty.")
        else:
            normalized_ticker = ticker.strip().upper()
            ticker_counts[normalized_ticker] += 1
            if (
                SYNTHETIC_TICKER_PATTERN.search(normalized_ticker)
                and normalized_ticker not in TICKER_SUFFIX_ALLOWLIST
            ):
                errors.append(
                    f"Company {company_id}: ticker {ticker!r} looks synthetic "
                    "because it ends with 2+ digits."
                )

        if not isinstance(name, str) or not name.strip():
            errors.append(f"Company {company_id}: name must be present and non-empty.")
        elif PLACEHOLDER_NAME_PATTERN.search(name):
            errors.append(
                f"Company {company_id}: name {name!r} looks like a placeholder."
            )

    for company_id in sorted(set(duplicate_company_ids)):
        errors.append(f"Duplicate company id: {company_id}.")

    for ticker, count in sorted(ticker_counts.items()):
        if count > 1:
            errors.append(f"Duplicate ticker: {ticker}.")

    edge_keys: Counter[tuple[int, int, str]] = Counter()
    connected_company_ids: set[int] = set()
    type_counts: Counter[str] = Counter()

    for index, connection in enumerate(connections):
        label = f"Connection {index}"
        if not isinstance(connection, dict):
            errors.append(f"{label}: record must be an object.")
            continue

        source = connection.get("source")
        target = connection.get("target")
        connection_type = connection.get("type")
        strength = connection.get("strength")
        confidence = connection.get("confidence")
        signal_score = connection.get("signal_score")
        provenance = connection.get("provenance")
        verified_date = connection.get("verified_date")
        connection_label = connection.get("label")
        source_urls = connection.get("source_urls")

        valid_source = isinstance(source, int) and not isinstance(source, bool)
        valid_target = isinstance(target, int) and not isinstance(target, bool)

        if not valid_source:
            errors.append(f"{label}: source must be an integer company id.")
        elif source not in company_ids:
            errors.append(f"{label}: source id {source} does not exist in companies.")

        if not valid_target:
            errors.append(f"{label}: target must be an integer company id.")
        elif target not in company_ids:
            errors.append(f"{label}: target id {target} does not exist in companies.")

        if valid_source and valid_target:
            if source == target:
                errors.append(f"{label}: source and target must be different companies.")
            edge_key = (min(source, target), max(source, target), str(connection_type))
            edge_keys[edge_key] += 1
            connected_company_ids.update({source, target})

        if connection_type not in ALLOWED_TYPES:
            errors.append(
                f"{label}: type {connection_type!r} is not allowed. "
                f"Allowed: {', '.join(sorted(ALLOWED_TYPES))}."
            )
        else:
            type_counts[connection_type] += 1

        if not is_number(strength) or not 0 <= float(strength) <= 1:
            errors.append(f"{label}: strength must be a number from 0 to 1.")

        if not isinstance(confidence, int) or isinstance(confidence, bool):
            errors.append(f"{label}: confidence must be an integer from 1 to 5.")
        elif not 1 <= confidence <= 5:
            errors.append(f"{label}: confidence {confidence} is outside 1 to 5.")
        elif confidence < 3:
            errors.append(f"{label}: Phase 2 core confidence must be at least 3.")

        if not isinstance(provenance, str) or not provenance.strip():
            errors.append(f"{label}: provenance must be present and non-empty.")

        if not isinstance(verified_date, str) or not DATE_PATTERN.match(verified_date):
            errors.append(f"{label}: verified_date must be present as YYYY-MM-DD.")

        has_source_urls = False
        if "source_urls" in connection:
            if not isinstance(source_urls, list):
                errors.append(f"{label}: source_urls must be a list when present.")
            else:
                has_source_urls = len(source_urls) > 0
                for url_index, source_url in enumerate(source_urls):
                    if not isinstance(source_url, str) or not URL_PATTERN.match(source_url.strip()):
                        errors.append(
                            f"{label}: source_urls[{url_index}] must be a valid URL "
                            "string starting with http:// or https://."
                        )

        if isinstance(confidence, int) and not isinstance(confidence, bool):
            expected_confidence = compute_confidence(connection)
            if confidence != expected_confidence:
                message = (
                    f"{label}: Confidence mismatch: expected {expected_confidence}, "
                    f"found {confidence}."
                )
                if strict_confidence:
                    errors.append(message)
                else:
                    warnings.append(message)

        if (
            is_number(signal_score)
            and float(signal_score) >= 0.9
            and isinstance(confidence, int)
            and not isinstance(confidence, bool)
            and confidence <= 3
        ):
            warnings.append(
                f"{label}: signal_score is high but confidence is low."
            )

        if not isinstance(connection_label, str) or not connection_label.strip():
            errors.append(f"{label}: label must be present and non-empty.")
        else:
            normalized_label = " ".join(connection_label.strip().lower().split())
            if (
                normalized_label in GENERIC_LABELS
                or GENERIC_LABEL_PATTERN.match(connection_label.strip())
            ):
                errors.append(
                    f"{label}: label {connection_label!r} is too generic for curated data."
                )

    duplicate_edges = [
        key for key, count in edge_keys.items()
        if count > 1
    ]
    for source, target, connection_type in duplicate_edges:
        errors.append(
            f"Duplicate edge for unordered source/target/type: "
            f"{source}-{target} ({connection_type})."
        )

    orphan_company_ids = company_ids - connected_company_ids
    if orphan_company_ids:
        warnings.append(
            f"{len(orphan_company_ids)} companies have no connections: "
            f"{', '.join(str(company_id) for company_id in sorted(orphan_company_ids)[:10])}"
            f"{'...' if len(orphan_company_ids) > 10 else ''}"
        )

    validate_candidate_file(errors, warnings)
    validate_triage_artifact_file(
        CANDIDATE_QUEUE_PATH,
        "candidate_review_queue",
        errors,
        warnings,
    )
    validate_triage_artifact_file(
        CANDIDATE_SUMMARY_PATH,
        "candidate_review_summary",
        errors,
        warnings,
    )
    validate_triage_artifact_file(
        CANDIDATE_OVERLAP_PATH,
        "candidate_overlap_report",
        errors,
        warnings,
    )

    print("StockPhotonic data validation")
    print(f"Companies: {len(companies)}")
    print(f"Connections: {len(connections)}")
    print(
        "Connection types: "
        + ", ".join(f"{name}={type_counts[name]}" for name in sorted(type_counts))
    )
    print(f"Errors: {len(errors)}")
    print(f"Warnings: {len(warnings)}")

    if errors:
        print("\nFAIL")
        for error in errors:
            print(f"- {error}")
    else:
        print("\nPASS")
        print("- Required validation checks passed.")

    if warnings:
        print("\nWarnings")
        for warning in warnings:
            print(f"- {warning}")

    return 1 if errors else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate StockPhotonic static JSON data."
    )
    parser.add_argument(
        "--strict-confidence",
        action="store_true",
        help="Treat confidence score mismatches as validation errors.",
    )
    args = parser.parse_args()
    sys.exit(validate(strict_confidence=args.strict_confidence))
