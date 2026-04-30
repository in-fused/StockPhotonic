#!/usr/bin/env python3
"""
Safely add vetted connection records to data/connections.json.

Add new records to NEW_CONNECTIONS, then run:
    python scripts/enrich_connections.py --dry-run
    python scripts/enrich_connections.py
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

import validate_data
from validate_data import compute_confidence


ROOT = Path(__file__).resolve().parents[1]
COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"

NEW_CONNECTIONS: list[dict[str, Any]] = []

REQUIRED_INPUT_FIELDS = {
    "source_ticker",
    "target_ticker",
    "type",
    "label",
    "strength",
    "provenance",
    "source_urls",
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)
        file.write("\n")


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def normalize_ticker(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip().upper()


def build_ticker_map(companies: Any) -> dict[str, int]:
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

        normalized_ticker = normalize_ticker(ticker, f"Company {company_id} ticker")
        if normalized_ticker in ticker_to_id:
            raise ValueError(f"Duplicate ticker in companies dataset: {normalized_ticker}.")
        ticker_to_id[normalized_ticker] = company_id

    return ticker_to_id


def connection_key(connection: dict[str, Any]) -> tuple[int, int, str]:
    source = connection["source"]
    target = connection["target"]
    return (min(source, target), max(source, target), connection["type"])


def existing_connection_keys(connections: Any) -> set[tuple[int, int, str]]:
    if not isinstance(connections, list):
        raise ValueError("data/connections.json must contain a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            raise ValueError(f"Connection {index}: record must be an object.")
        source = connection.get("source")
        target = connection.get("target")
        connection_type = connection.get("type")
        if (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and isinstance(connection_type, str)
        ):
            keys.add((min(source, target), max(source, target), connection_type))
    return keys


def normalize_label(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("label must be a non-empty string.")

    label = value.strip()
    normalized = " ".join(label.lower().split())
    if (
        normalized in validate_data.GENERIC_LABELS
        or validate_data.GENERIC_LABEL_PATTERN.match(label)
    ):
        raise ValueError(f"label {label!r} is too generic for curated data.")
    return label


def normalize_source_urls(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("source_urls must be a list.")

    urls: list[str] = []
    for index, source_url in enumerate(value):
        if not isinstance(source_url, str):
            raise ValueError(f"source_urls[{index}] must be a URL string.")
        normalized_url = source_url.strip()
        if not validate_data.URL_PATTERN.match(normalized_url):
            raise ValueError(
                f"source_urls[{index}] must start with http:// or https://."
            )
        urls.append(normalized_url)
    return urls


def normalize_connection(
    raw_connection: Any,
    ticker_to_id: dict[str, int],
    verified_date: str,
) -> dict[str, Any]:
    if not isinstance(raw_connection, dict):
        raise ValueError("New connection records must be objects.")

    missing_fields = sorted(REQUIRED_INPUT_FIELDS - raw_connection.keys())
    if missing_fields:
        raise ValueError(f"Missing required field(s): {', '.join(missing_fields)}.")

    source_ticker = normalize_ticker(raw_connection["source_ticker"], "source_ticker")
    target_ticker = normalize_ticker(raw_connection["target_ticker"], "target_ticker")
    if source_ticker not in ticker_to_id:
        raise ValueError(f"source_ticker {source_ticker!r} was not found.")
    if target_ticker not in ticker_to_id:
        raise ValueError(f"target_ticker {target_ticker!r} was not found.")

    source = ticker_to_id[source_ticker]
    target = ticker_to_id[target_ticker]
    if source == target:
        raise ValueError("source_ticker and target_ticker must resolve to different companies.")

    connection_type = raw_connection["type"]
    if not isinstance(connection_type, str):
        raise ValueError("type must be a string.")
    connection_type = connection_type.strip().lower()
    if connection_type not in validate_data.ALLOWED_TYPES:
        allowed_types = ", ".join(sorted(validate_data.ALLOWED_TYPES))
        raise ValueError(f"type {connection_type!r} is not allowed. Allowed: {allowed_types}.")

    strength = raw_connection["strength"]
    if not is_number(strength) or not 0 <= float(strength) <= 1:
        raise ValueError("strength must be a number from 0 to 1.")

    provenance = raw_connection["provenance"]
    if not isinstance(provenance, str) or not provenance.strip():
        raise ValueError("provenance must be a non-empty string.")

    connection = {
        "source": source,
        "target": target,
        "type": connection_type,
        "strength": float(strength),
        "label": normalize_label(raw_connection["label"]),
        "provenance": provenance.strip(),
        "source_urls": normalize_source_urls(raw_connection["source_urls"]),
        "verified_date": verified_date,
    }
    connection["confidence"] = compute_confidence(connection)

    return {
        "source": connection["source"],
        "target": connection["target"],
        "type": connection["type"],
        "strength": connection["strength"],
        "label": connection["label"],
        "confidence": connection["confidence"],
        "provenance": connection["provenance"],
        "source_urls": connection["source_urls"],
        "verified_date": connection["verified_date"],
    }


def validate_merged_connections(connections: list[dict[str, Any]]) -> None:
    temp_path: Path | None = None
    original_connections_path = validate_data.CONNECTIONS_PATH

    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            suffix=".json",
            delete=False,
        ) as temp_file:
            json.dump(connections, temp_file, indent=2)
            temp_file.write("\n")
            temp_path = Path(temp_file.name)

        validate_data.CONNECTIONS_PATH = temp_path
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = validate_data.validate(strict_confidence=False)

        if result != 0:
            raise ValueError(
                "Merged connections failed validation before save:\n"
                + output.getvalue().strip()
            )
    finally:
        validate_data.CONNECTIONS_PATH = original_connections_path
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def prepare_connections() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    companies = load_json(COMPANIES_PATH)
    connections = load_json(CONNECTIONS_PATH)
    ticker_to_id = build_ticker_map(companies)
    known_keys = existing_connection_keys(connections)

    additions: list[dict[str, Any]] = []
    skipped: list[str] = []
    today = date.today().isoformat()

    for index, raw_connection in enumerate(NEW_CONNECTIONS):
        try:
            connection = normalize_connection(raw_connection, ticker_to_id, today)
        except ValueError as error:
            raise ValueError(f"New connection {index}: {error}") from error

        key = connection_key(connection)
        if key in known_keys:
            skipped.append(
                f"{raw_connection['source_ticker']} -> {raw_connection['target_ticker']} "
                f"({connection['type']}): duplicate"
            )
            continue

        known_keys.add(key)
        additions.append(connection)

    return connections, additions, skipped


def print_summary(additions: list[dict[str, Any]], skipped: list[str], dry_run: bool) -> None:
    action = "Would add" if dry_run else "Added"
    print(f"{action} {len(additions)} connection(s).")

    for connection in additions:
        print(
            "- "
            f"{connection['source']} -> {connection['target']} "
            f"({connection['type']}, confidence {connection['confidence']}): "
            f"{connection['label']}"
        )

    if skipped:
        print(f"Skipped {len(skipped)} duplicate connection(s).")
        for skipped_connection in skipped:
            print(f"- {skipped_connection}")

    if dry_run:
        print("Dry run only; data/connections.json was not changed.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Safely enrich StockPhotonic connection data."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print additions without saving data/connections.json.",
    )
    args = parser.parse_args()

    try:
        connections, additions, skipped = prepare_connections()
        if additions:
            validate_merged_connections([*connections, *additions])
            if not args.dry_run:
                save_json(CONNECTIONS_PATH, [*connections, *additions])
        print_summary(additions, skipped, args.dry_run)
        return 0
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
