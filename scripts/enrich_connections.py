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

NEW_CONNECTIONS: list[dict[str, Any]] = [
    {
        "source_ticker": "NVDA",
        "target_ticker": "ARM",
        "type": "supply",
        "label": "Arm Neoverse CPU IP in NVIDIA Grace platforms",
        "strength": 0.74,
        "provenance": "NVIDIA Grace CPU materials describe Arm-based data center cores.",
        "source_urls": [
            "https://www.nvidia.com/en-us/data-center/grace-cpu/",
        ],
    },
    {
        "source_ticker": "AMZN",
        "target_ticker": "ARM",
        "type": "ecosystem",
        "label": "AWS Graviton Arm-based cloud compute ecosystem",
        "strength": 0.82,
        "provenance": "AWS documents Graviton processors for EC2 cloud workloads.",
        "source_urls": [
            "https://aws.amazon.com/ec2/graviton/",
        ],
    },
    {
        "source_ticker": "GOOGL",
        "target_ticker": "ARM",
        "type": "ecosystem",
        "label": "Google Axion Arm CPU cloud infrastructure stack",
        "strength": 0.78,
        "provenance": "Google Cloud announced Axion as its Arm-based data center CPU.",
        "source_urls": [
            "https://cloud.google.com/blog/products/compute/introducing-googles-new-arm-based-cpu",
        ],
    },
    {
        "source_ticker": "MSFT",
        "target_ticker": "ARM",
        "type": "ecosystem",
        "label": "Azure Cobalt Arm-based VM infrastructure platform",
        "strength": 0.76,
        "provenance": "Microsoft Azure announced Cobalt 100 Arm-based virtual machines.",
        "source_urls": [
            "https://azure.microsoft.com/en-us/blog/azure-cobalt-100-based-virtual-machines-are-now-generally-available/",
        ],
    },
    {
        "source_ticker": "MSFT",
        "target_ticker": "SNOW",
        "type": "partnership",
        "label": "Snowflake data cloud integrations with Microsoft Azure",
        "strength": 0.68,
        "provenance": "Snowflake partner materials describe Microsoft Azure and Copilot integrations.",
        "source_urls": [
            "https://www.snowflake.com/en/why-snowflake/partners/all-partners/microsoft/",
        ],
    },
    {
        "source_ticker": "AMZN",
        "target_ticker": "CRM",
        "type": "partnership",
        "label": "AWS services embedded across Salesforce Customer 360",
        "strength": 0.72,
        "provenance": "Salesforce and AWS announced expanded native product integrations.",
        "source_urls": [
            "https://www.salesforce.com/news/press-releases/2021/06/23/salesforce-aws-partnership-expansion/",
        ],
    },
    {
        "source_ticker": "GOOGL",
        "target_ticker": "NOW",
        "type": "partnership",
        "label": "ServiceNow workflows integrated with Google Cloud AI",
        "strength": 0.69,
        "provenance": "ServiceNow and Google Cloud announced expanded enterprise AI integrations.",
        "source_urls": [
            "https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-and-Google-Cloud-Expand-Partnership-to-Deliver-AI-powered-Tools-to-Millions-of-Users-01-29-2025-traffic/default.aspx",
        ],
    },
    {
        "source_ticker": "GOOGL",
        "target_ticker": "SNOW",
        "type": "partnership",
        "label": "Snowflake analytics and AI workloads on Google Cloud",
        "strength": 0.67,
        "provenance": "Snowflake partner materials describe Google Cloud data and AI deployment support.",
        "source_urls": [
            "https://www.snowflake.com/en/why-snowflake/partners/all-partners/gcp/",
        ],
    },
]

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


def parse_non_negative_int(value: str) -> int:
    try:
        limit = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from error

    if limit < 0:
        raise argparse.ArgumentTypeError("--limit must be 0 or greater.")
    return limit


def parse_strength_filter(value: str) -> float:
    try:
        strength = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("--min-strength must be a number.") from error

    if not 0 <= strength <= 1:
        raise argparse.ArgumentTypeError("--min-strength must be from 0 to 1.")
    return strength


def parse_type_filter(value: str) -> set[str]:
    connection_types = {
        connection_type.strip().lower()
        for connection_type in value.split(",")
        if connection_type.strip()
    }
    if not connection_types:
        raise argparse.ArgumentTypeError("--types must include at least one type.")

    unknown_types = sorted(connection_types - validate_data.ALLOWED_TYPES)
    if unknown_types:
        allowed_types = ", ".join(sorted(validate_data.ALLOWED_TYPES))
        raise argparse.ArgumentTypeError(
            f"Unknown type(s): {', '.join(unknown_types)}. Allowed: {allowed_types}."
        )

    return connection_types


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


def generate_signal_inputs() -> tuple[list[dict[str, Any]], list[str]]:
    import generate_signals

    try:
        return generate_signals.generate_signals(generate_signals.RAW_INPUTS), []
    except Exception:
        signals: list[dict[str, Any]] = []
        skipped: list[str] = []
        for index, raw_input in enumerate(generate_signals.RAW_INPUTS):
            try:
                signals.extend(generate_signals.generate_signals([raw_input]))
            except Exception as error:
                skipped.append(f"Signal input {index}: parsing failed: {error}")

        return signals, skipped


def signal_label(signal: Any, index: int) -> str:
    if not isinstance(signal, dict):
        return f"Signal {index}"

    source_ticker = signal.get("source_ticker", "?")
    target_ticker = signal.get("target_ticker", "?")
    connection_type = signal.get("type", "?")
    return f"Signal {index} ({source_ticker} -> {target_ticker}, {connection_type})"


def apply_signal_controls(
    signals: list[dict[str, Any]],
    *,
    limit: int | None,
    min_strength: float | None,
    allowed_types: set[str] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    limited_signals = signals[:limit] if limit is not None else signals
    processed: list[dict[str, Any]] = []
    skipped: list[str] = []

    for index, signal in enumerate(limited_signals):
        label = signal_label(signal, index)
        if min_strength is not None:
            strength = signal.get("strength") if isinstance(signal, dict) else None
            if not is_number(strength):
                skipped.append(f"{label}: skipped by --min-strength; strength is invalid.")
                continue
            if float(strength) < min_strength:
                skipped.append(
                    f"{label}: skipped by --min-strength {min_strength} "
                    f"(strength {float(strength)})."
                )
                continue

        if allowed_types is not None:
            connection_type = signal.get("type") if isinstance(signal, dict) else None
            if not isinstance(connection_type, str):
                skipped.append(f"{label}: skipped by --types; type is invalid.")
                continue
            normalized_type = connection_type.strip().lower()
            if normalized_type not in allowed_types:
                skipped.append(
                    f"{label}: skipped by --types "
                    f"({normalized_type or 'blank'} not allowed)."
                )
                continue

        processed.append(signal)

    return processed, skipped


def prepare_connections(
    raw_connections: list[dict[str, Any]],
    *,
    skip_invalid: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str], list[str]]:
    companies = load_json(COMPANIES_PATH)
    connections = load_json(CONNECTIONS_PATH)
    ticker_to_id = build_ticker_map(companies)
    known_keys = existing_connection_keys(connections)

    additions: list[dict[str, Any]] = []
    duplicate_skips: list[str] = []
    invalid_skips: list[str] = []
    today = date.today().isoformat()

    for index, raw_connection in enumerate(raw_connections):
        try:
            connection = normalize_connection(raw_connection, ticker_to_id, today)
        except ValueError as error:
            if skip_invalid:
                invalid_skips.append(f"Signal {index}: skipped during ingestion: {error}")
                continue
            raise ValueError(f"New connection {index}: {error}") from error

        key = connection_key(connection)
        if key in known_keys:
            duplicate_skips.append(
                f"{raw_connection['source_ticker']} -> {raw_connection['target_ticker']} "
                f"({connection['type']}): duplicate"
            )
            continue

        known_keys.add(key)
        additions.append(connection)

    return connections, additions, duplicate_skips, invalid_skips


def print_summary(
    additions: list[dict[str, Any]],
    duplicate_skips: list[str],
    other_skips: list[str],
    dry_run: bool,
    *,
    validation_result: str,
    total_signals_generated: int | None,
    signals_processed: int | None,
) -> None:
    if total_signals_generated is not None:
        print(f"Total signals generated: {total_signals_generated}")
    if signals_processed is not None:
        print(f"Signals processed: {signals_processed}")

    if dry_run:
        print(f"Connections added: 0 (dry run would add {len(additions)})")
    else:
        print(f"Connections added: {len(additions)}")
    print(f"Duplicates skipped: {len(duplicate_skips)}")
    print(f"Validation result: {validation_result}")

    for connection in additions:
        print(
            "- "
            f"{connection['source']} -> {connection['target']} "
            f"({connection['type']}, confidence {connection['confidence']}): "
            f"{connection['label']}"
        )

    if duplicate_skips:
        print(f"Skipped duplicate connection(s):")
        for skipped_connection in duplicate_skips:
            print(f"- {skipped_connection}")

    if other_skips:
        print(f"Skipped other signal(s):")
        for skipped_connection in other_skips:
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
    parser.add_argument(
        "--from-signals",
        action="store_true",
        help="Generate connection candidates from simulated external signal inputs.",
    )
    parser.add_argument(
        "--limit",
        type=parse_non_negative_int,
        help="Only process the first N generated signals.",
    )
    parser.add_argument(
        "--min-strength",
        type=parse_strength_filter,
        help="Only process signals with strength greater than or equal to X.",
    )
    parser.add_argument(
        "--types",
        type=parse_type_filter,
        help="Comma-separated allowed connection types, such as supply,partnership.",
    )
    args = parser.parse_args()

    try:
        raw_connections = NEW_CONNECTIONS
        total_signals_generated: int | None = None
        signals_processed: int | None = None
        skipped: list[str] = []

        if args.from_signals:
            raw_connections, skipped = generate_signal_inputs()
            total_signals_generated = len(raw_connections)

        if args.from_signals:
            raw_connections, control_skips = apply_signal_controls(
                raw_connections,
                limit=args.limit,
                min_strength=args.min_strength,
                allowed_types=args.types,
            )
            skipped.extend(control_skips)
            signals_processed = len(raw_connections)

        connections, additions, duplicate_skips, invalid_skips = prepare_connections(
            raw_connections,
            skip_invalid=args.from_signals,
        )
        skipped.extend(invalid_skips)

        validation_result = "not run (no new connections)"
        if additions:
            validate_merged_connections([*connections, *additions])
            validation_result = "passed"
            if not args.dry_run:
                save_json(CONNECTIONS_PATH, [*connections, *additions])
        print_summary(
            additions,
            duplicate_skips,
            skipped,
            args.dry_run,
            validation_result=validation_result,
            total_signals_generated=total_signals_generated,
            signals_processed=signals_processed,
        )
        return 0
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
