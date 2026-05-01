#!/usr/bin/env python3
"""
Validate and dry-run candidate connection and ticker-universe inputs.

Run from the repository root:
    python scripts/ingest_candidates.py

This script never writes production data. It validates candidate records under
data/candidates/ and prints a promotion preview for connection records that are
eligible for future manual review. Ticker-universe inputs are validation-only
and cannot be promoted by this script.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from build_source_registry import (
    PRODUCTION_RELATIONSHIP_TYPES,
    REQUIRED_CANDIDATE_FIELDS,
    SOURCE_REGISTRY,
)


ROOT = Path(__file__).resolve().parents[1]
COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"
CANDIDATE_CONNECTIONS_PATH = ROOT / "data" / "candidates" / "candidate_connections.json"
OFFICIAL_TICKER_UNIVERSE_PATH = (
    ROOT / "data" / "candidates" / "official_ticker_universe.json"
)

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
REQUIRED_TICKER_UNIVERSE_FIELDS: tuple[str, ...] = (
    "ticker",
    "name",
    "exchange",
    "asset_type",
    "source_type",
    "source_tier",
    "source_url",
    "capture_date",
    "review_status",
)
SUPPORTED_TICKER_ASSET_TYPES = {"public_company"}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_candidates(path: Path = CANDIDATE_CONNECTIONS_PATH) -> list[dict[str, Any]]:
    candidates = load_json(path)
    if not isinstance(candidates, list):
        raise ValueError(f"{path} must contain a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise ValueError(f"Candidate {index}: record must be an object.")
        normalized_candidates.append(candidate)
    return normalized_candidates


def load_official_ticker_universe(
    path: Path = OFFICIAL_TICKER_UNIVERSE_PATH,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object.")

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError(f"{path}: metadata must be an object.")

    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError(f"{path}: candidates must be a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise ValueError(f"Ticker candidate {index}: record must be an object.")
        normalized_candidates.append(candidate)

    return metadata, normalized_candidates


def detect_candidate_kind(path: Path) -> str:
    if path.name == OFFICIAL_TICKER_UNIVERSE_PATH.name:
        return "official-ticker-universe"

    payload = load_json(path)
    if isinstance(payload, dict) and "candidates" in payload:
        return "official-ticker-universe"
    return "connections"


def build_company_ticker_map() -> dict[str, int]:
    companies = load_json(COMPANIES_PATH)
    if not isinstance(companies, list):
        raise ValueError("data/companies.json must contain a JSON array.")

    ticker_to_id: dict[str, int] = {}
    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            raise ValueError(f"Company {index}: record must be an object.")

        company_id = company.get("id")
        ticker = company.get("ticker")
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise ValueError(f"Company {index}: id must be an integer.")
        if not isinstance(ticker, str) or not ticker.strip():
            raise ValueError(f"Company {company_id}: ticker must be non-empty.")

        ticker_to_id[ticker.strip().upper()] = company_id

    return ticker_to_id


def existing_relationship_keys(ticker_to_id: dict[str, int]) -> set[tuple[int, int, str]]:
    connections = load_json(CONNECTIONS_PATH)
    if not isinstance(connections, list):
        raise ValueError("data/connections.json must contain a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            raise ValueError(f"Connection {index}: record must be an object.")

        source = connection.get("source")
        target = connection.get("target")
        relationship_type = connection.get("type")
        if (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and isinstance(relationship_type, str)
        ):
            keys.add((min(source, target), max(source, target), relationship_type))

    return keys


def normalize_ticker(value: Any, field_name: str, errors: list[str]) -> str:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{field_name} must be a non-empty string.")
        return ""

    ticker = value.strip().upper()
    if not TICKER_PATTERN.match(ticker):
        errors.append(f"{field_name} {ticker!r} has an invalid ticker format.")
    return ticker


def validate_date_or_empty(
    value: Any,
    field_name: str,
    errors: list[str],
    *,
    required: bool,
) -> None:
    if value == "" and not required:
        return
    if not isinstance(value, str) or not DATE_PATTERN.match(value):
        errors.append(f"{field_name} must use YYYY-MM-DD format.")


def validate_number_range(
    value: Any,
    field_name: str,
    errors: list[str],
    *,
    minimum: float,
    maximum: float,
) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        errors.append(f"{field_name} must be a number.")
        return
    if not minimum <= float(value) <= maximum:
        errors.append(f"{field_name} must be from {minimum:g} to {maximum:g}.")


def candidate_label(candidate: dict[str, Any], index: int) -> str:
    source = candidate.get("source_ticker", "?")
    target = candidate.get("target_ticker", "?")
    relationship_type = candidate.get("relationship_type", "?")
    return f"Candidate {index} ({source} -> {target}, {relationship_type})"


def relationship_key_from_candidate(
    candidate: dict[str, Any],
    ticker_to_id: dict[str, int],
) -> tuple[int, int, str] | None:
    source_ticker = str(candidate.get("source_ticker", "")).strip().upper()
    target_ticker = str(candidate.get("target_ticker", "")).strip().upper()
    relationship_type = str(candidate.get("relationship_type", "")).strip().lower()

    source_id = ticker_to_id.get(source_ticker)
    target_id = ticker_to_id.get(target_ticker)
    if source_id is None or target_id is None:
        return None
    return (min(source_id, target_id), max(source_id, target_id), relationship_type)


def validate_candidate(
    candidate: dict[str, Any],
    *,
    index: int,
    ticker_to_id: dict[str, int],
    seen_candidate_keys: Counter[tuple[str, str, str]],
    existing_keys: set[tuple[int, int, str]],
) -> list[str]:
    errors: list[str] = []

    missing_fields = [
        field for field in REQUIRED_CANDIDATE_FIELDS
        if field not in candidate
    ]
    if missing_fields:
        errors.append(f"Missing required field(s): {', '.join(missing_fields)}.")

    source_ticker = normalize_ticker(candidate.get("source_ticker"), "source_ticker", errors)
    target_ticker = normalize_ticker(candidate.get("target_ticker"), "target_ticker", errors)
    if source_ticker and source_ticker not in ticker_to_id:
        errors.append(f"source_ticker {source_ticker!r} does not exist in companies.json.")
    if target_ticker and target_ticker not in ticker_to_id:
        errors.append(f"target_ticker {target_ticker!r} does not exist in companies.json.")
    if source_ticker and target_ticker and source_ticker == target_ticker:
        errors.append("source_ticker and target_ticker must be different.")

    source_type = candidate.get("source_type")
    if not isinstance(source_type, str) or not source_type.strip():
        errors.append("source_type must be a non-empty string.")
        source_type_key = ""
    else:
        source_type_key = source_type.strip().lower()
        if source_type_key not in SOURCE_REGISTRY:
            errors.append(f"source_type {source_type_key!r} is not allowed.")

    source_tier = candidate.get("source_tier")
    if not isinstance(source_tier, int) or isinstance(source_tier, bool):
        errors.append("source_tier must be an integer.")
    elif source_tier not in {1, 2, 3}:
        errors.append("source_tier must be 1, 2, or 3.")
    elif source_type_key in SOURCE_REGISTRY and source_tier != SOURCE_REGISTRY[source_type_key]["tier"]:
        expected_tier = SOURCE_REGISTRY[source_type_key]["tier"]
        errors.append(
            f"source_tier {source_tier} does not match {source_type_key!r} tier {expected_tier}."
        )

    relationship_type = candidate.get("relationship_type")
    if not isinstance(relationship_type, str) or not relationship_type.strip():
        errors.append("relationship_type must be a non-empty string.")
        relationship_type_key = ""
    else:
        relationship_type_key = relationship_type.strip().lower()
        allowed_relationships = (
            SOURCE_REGISTRY.get(source_type_key, {}).get("allowed_relationship_types", [])
        )
        if relationship_type_key not in allowed_relationships:
            errors.append(
                f"relationship_type {relationship_type_key!r} is not allowed for "
                f"source_type {source_type_key!r}."
            )
        if relationship_type_key not in PRODUCTION_RELATIONSHIP_TYPES:
            errors.append(
                f"relationship_type {relationship_type_key!r} is not currently "
                "supported for production promotion."
            )

    source_url = candidate.get("source_url")
    if not isinstance(source_url, str) or not source_url.strip():
        errors.append("source_url is required.")
    elif not URL_PATTERN.match(source_url.strip()):
        errors.append("source_url must start with http:// or https://.")

    filing_type = candidate.get("filing_type")
    if source_type_key in {"sec_filing", "13f_dataset"}:
        if not isinstance(filing_type, str) or not filing_type.strip():
            errors.append("filing_type is required for SEC-derived candidates.")
    elif not isinstance(filing_type, str):
        errors.append("filing_type must be a string; use an empty string when not applicable.")

    validate_date_or_empty(
        candidate.get("filing_date"),
        "filing_date",
        errors,
        required=source_type_key in {"sec_filing", "13f_dataset"},
    )
    validate_date_or_empty(
        candidate.get("capture_date"),
        "capture_date",
        errors,
        required=True,
    )

    extraction_text = candidate.get("extraction_text")
    if not isinstance(extraction_text, str) or not extraction_text.strip():
        errors.append("extraction_text must be a non-empty string.")

    validate_number_range(
        candidate.get("confidence_candidate"),
        "confidence_candidate",
        errors,
        minimum=1,
        maximum=5,
    )
    validate_number_range(
        candidate.get("signal_score"),
        "signal_score",
        errors,
        minimum=0,
        maximum=1,
    )

    review_status = candidate.get("review_status")
    if review_status != "pending":
        errors.append("review_status must be pending.")

    if source_ticker and target_ticker and relationship_type_key:
        candidate_key = tuple(sorted((source_ticker, target_ticker))) + (relationship_type_key,)
        seen_candidate_keys[candidate_key] += 1
        if seen_candidate_keys[candidate_key] > 1:
            errors.append("duplicate relationship found in candidate file.")

        production_key = relationship_key_from_candidate(candidate, ticker_to_id)
        if production_key in existing_keys:
            errors.append("duplicate relationship already exists in production connections.")

    return [
        f"{candidate_label(candidate, index)}: {error}"
        for error in errors
    ]


def ticker_candidate_label(candidate: dict[str, Any], index: int) -> str:
    ticker = candidate.get("ticker", "?")
    name = candidate.get("name", "?")
    return f"Ticker candidate {index} ({ticker}, {name})"


def validate_official_ticker_universe_metadata(
    metadata: dict[str, Any],
) -> list[str]:
    errors: list[str] = []

    if metadata.get("status") != "candidate_only":
        errors.append("metadata.status must be candidate_only.")
    if metadata.get("production_write_allowed") is not False:
        errors.append("metadata.production_write_allowed must be false.")
    if metadata.get("app_load_allowed") is not False:
        errors.append("metadata.app_load_allowed must be false.")

    source_requirements = metadata.get("source_requirements")
    if not isinstance(source_requirements, list) or not source_requirements:
        errors.append("metadata.source_requirements must list required source fields.")
    else:
        missing_source_requirements = [
            field for field in REQUIRED_TICKER_UNIVERSE_FIELDS
            if field not in source_requirements
        ]
        if missing_source_requirements:
            errors.append(
                "metadata.source_requirements must include: "
                + ", ".join(missing_source_requirements)
                + "."
            )

    return errors


def validate_official_ticker_candidate(
    candidate: dict[str, Any],
    *,
    index: int,
    production_tickers: set[str],
    seen_tickers: Counter[str],
) -> list[str]:
    errors: list[str] = []

    missing_fields = [
        field for field in REQUIRED_TICKER_UNIVERSE_FIELDS
        if field not in candidate
    ]
    if missing_fields:
        errors.append(f"Missing required field(s): {', '.join(missing_fields)}.")

    ticker = normalize_ticker(candidate.get("ticker"), "ticker", errors)
    if ticker:
        if isinstance(candidate.get("ticker"), str) and candidate["ticker"].strip() != ticker:
            errors.append("ticker must be uppercase.")
        seen_tickers[ticker] += 1
        if seen_tickers[ticker] > 1:
            errors.append("duplicate ticker found in official ticker universe candidate file.")
        if ticker in production_tickers:
            errors.append("ticker already exists in production companies.json.")

    name = candidate.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name must be a non-empty string.")

    exchange = candidate.get("exchange")
    if not isinstance(exchange, str) or not exchange.strip():
        errors.append("exchange must be a non-empty string.")

    asset_type = candidate.get("asset_type")
    if asset_type not in SUPPORTED_TICKER_ASSET_TYPES:
        supported = ", ".join(sorted(SUPPORTED_TICKER_ASSET_TYPES))
        errors.append(f"asset_type must be one of: {supported}.")

    source_type = candidate.get("source_type")
    if not isinstance(source_type, str) or not source_type.strip():
        errors.append("source_type must be a non-empty string.")
        source_type_key = ""
    else:
        source_type_key = source_type.strip().lower()
        if source_type_key not in SOURCE_REGISTRY:
            errors.append(f"source_type {source_type_key!r} is not allowed.")

    source_tier = candidate.get("source_tier")
    if not isinstance(source_tier, int) or isinstance(source_tier, bool):
        errors.append("source_tier must be an integer.")
    elif source_tier not in {1, 2, 3}:
        errors.append("source_tier must be 1, 2, or 3.")
    elif source_type_key in SOURCE_REGISTRY and source_tier != SOURCE_REGISTRY[source_type_key]["tier"]:
        expected_tier = SOURCE_REGISTRY[source_type_key]["tier"]
        errors.append(
            f"source_tier {source_tier} does not match {source_type_key!r} tier {expected_tier}."
        )

    source_url = candidate.get("source_url")
    if not isinstance(source_url, str) or not source_url.strip():
        errors.append("source_url is required.")
    elif not URL_PATTERN.match(source_url.strip()):
        errors.append("source_url must start with http:// or https://.")

    validate_date_or_empty(
        candidate.get("capture_date"),
        "capture_date",
        errors,
        required=True,
    )

    review_status = candidate.get("review_status")
    if review_status != "pending":
        errors.append("review_status must be pending.")

    return [
        f"{ticker_candidate_label(candidate, index)}: {error}"
        for error in errors
    ]


def promote_candidate_to_connection(
    candidate: dict[str, Any],
    ticker_to_id: dict[str, int],
) -> dict[str, Any]:
    source_ticker = candidate["source_ticker"].strip().upper()
    target_ticker = candidate["target_ticker"].strip().upper()
    relationship_type = candidate["relationship_type"].strip().lower()

    return {
        "source": ticker_to_id[source_ticker],
        "target": ticker_to_id[target_ticker],
        "type": relationship_type,
        "confidence": candidate["confidence_candidate"],
        "provenance": candidate["source_type"],
        "source_urls": [candidate["source_url"].strip()],
        "verified_date": candidate["capture_date"],
        "review_status": "promotion_preview_only",
    }


def validate_candidates(
    candidates: list[dict[str, Any]],
    ticker_to_id: dict[str, int],
    existing_keys: set[tuple[int, int, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    valid_candidates: list[dict[str, Any]] = []
    errors: list[str] = []
    seen_candidate_keys: Counter[tuple[str, str, str]] = Counter()

    for index, candidate in enumerate(candidates):
        candidate_errors = validate_candidate(
            candidate,
            index=index,
            ticker_to_id=ticker_to_id,
            seen_candidate_keys=seen_candidate_keys,
            existing_keys=existing_keys,
        )
        if candidate_errors:
            errors.extend(candidate_errors)
        else:
            valid_candidates.append(candidate)

    return valid_candidates, errors


def validate_official_ticker_universe(
    metadata: dict[str, Any],
    candidates: list[dict[str, Any]],
    production_tickers: set[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    valid_candidates: list[dict[str, Any]] = []
    errors = validate_official_ticker_universe_metadata(metadata)
    seen_tickers: Counter[str] = Counter()

    for index, candidate in enumerate(candidates):
        candidate_errors = validate_official_ticker_candidate(
            candidate,
            index=index,
            production_tickers=production_tickers,
            seen_tickers=seen_tickers,
        )
        if candidate_errors:
            errors.extend(candidate_errors)
        else:
            valid_candidates.append(candidate)

    return valid_candidates, errors


def print_summary(
    *,
    candidate_count: int,
    valid_candidates: list[dict[str, Any]],
    validation_errors: list[str],
    ticker_to_id: dict[str, int],
    show_previews: bool,
) -> None:
    print("StockPhotonic candidate ingestion dry run")
    print(f"Candidates loaded: {candidate_count}")
    print(f"Valid candidates: {len(valid_candidates)}")
    print(f"Rejected candidates: {len(validation_errors)}")
    print("Production writes: 0")

    if validation_errors:
        print("\nRejected")
        for error in validation_errors:
            print(f"- {error}")

    if show_previews and valid_candidates:
        print("\nPromotion previews")
        for candidate in valid_candidates:
            preview = promote_candidate_to_connection(candidate, ticker_to_id)
            print(
                "- "
                f"{candidate['source_ticker']} -> {candidate['target_ticker']} "
                f"({preview['type']}, confidence {preview['confidence']}): "
                f"{preview['source_urls'][0]}"
            )

    print("\nDry run only; production data files were not changed.")


def print_ticker_universe_summary(
    *,
    candidate_count: int,
    valid_candidates: list[dict[str, Any]],
    validation_errors: list[str],
) -> None:
    print("StockPhotonic official ticker universe candidate validation")
    print(f"Candidates loaded: {candidate_count}")
    print(f"Valid ticker candidates: {len(valid_candidates)}")
    print(f"Validation errors: {len(validation_errors)}")
    print("Production writes: 0")
    print("Promotion previews: disabled")

    if validation_errors:
        print("\nRejected")
        for error in validation_errors:
            print(f"- {error}")

    print("\nCandidate-only validation; production data files were not changed.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and dry-run StockPhotonic candidate ingestion."
    )
    parser.add_argument(
        "--candidates",
        type=Path,
        default=CANDIDATE_CONNECTIONS_PATH,
        help="Path to candidate connection JSON file.",
    )
    parser.add_argument(
        "--show-previews",
        action="store_true",
        help="Print promotion previews for valid candidates.",
    )
    parser.add_argument(
        "--candidate-kind",
        choices=("auto", "connections", "official-ticker-universe"),
        default="auto",
        help="Candidate input kind. Auto-detects official_ticker_universe.json.",
    )
    args = parser.parse_args()

    try:
        candidate_kind = args.candidate_kind
        if candidate_kind == "auto":
            candidate_kind = detect_candidate_kind(args.candidates)

        if candidate_kind == "official-ticker-universe":
            metadata, candidates = load_official_ticker_universe(args.candidates)
            production_tickers = set(build_company_ticker_map())
            valid_candidates, validation_errors = validate_official_ticker_universe(
                metadata,
                candidates,
                production_tickers,
            )
            print_ticker_universe_summary(
                candidate_count=len(candidates),
                valid_candidates=valid_candidates,
                validation_errors=validation_errors,
            )
            return 1 if validation_errors else 0

        candidates = load_candidates(args.candidates)
        ticker_to_id = build_company_ticker_map()
        existing_keys = existing_relationship_keys(ticker_to_id)
        valid_candidates, validation_errors = validate_candidates(
            candidates,
            ticker_to_id,
            existing_keys,
        )
        print_summary(
            candidate_count=len(candidates),
            valid_candidates=valid_candidates,
            validation_errors=validation_errors,
            ticker_to_id=ticker_to_id,
            show_previews=args.show_previews,
        )
        return 1 if validation_errors else 0
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
