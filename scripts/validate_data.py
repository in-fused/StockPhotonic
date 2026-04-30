#!/usr/bin/env python3
"""
Validate StockPhotonic static JSON data.

Run from the repository root:
    python scripts/validate_data.py

The script uses only the Python standard library and does not modify data files.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"

ALLOWED_TYPES = {
    "supply",
    "partnership",
    "ecosystem",
    "competitor",
    "investment",
}

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate() -> int:
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

    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            errors.append(f"Company {index}: record must be an object.")
            continue

        company_id = company.get("id")
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            errors.append(f"Company {index}: id must be an integer.")
            continue

        if company_id in company_ids:
            duplicate_company_ids.append(company_id)
        company_ids.add(company_id)

    for company_id in sorted(set(duplicate_company_ids)):
        errors.append(f"Duplicate company id: {company_id}.")

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
        provenance = connection.get("provenance")
        verified_date = connection.get("verified_date")

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
            errors.append(f"{label}: Phase 1 core confidence must be at least 3.")

        if not isinstance(provenance, str) or not provenance.strip():
            errors.append(f"{label}: provenance must be present and non-empty.")

        if not isinstance(verified_date, str) or not DATE_PATTERN.match(verified_date):
            errors.append(f"{label}: verified_date must be present as YYYY-MM-DD.")

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
    sys.exit(validate())
