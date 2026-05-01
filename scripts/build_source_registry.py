#!/usr/bin/env python3
"""
Print the StockPhotonic source registry used by candidate ingestion.

Run from the repository root:
    python scripts/build_source_registry.py
    python scripts/build_source_registry.py --json

The script is read-only and does not modify data files.
"""

from __future__ import annotations

import argparse
import json
from typing import Any


RELATIONSHIP_CATEGORIES: set[str] = {
    "subsidiary",
    "ownership",
    "institutional_ownership",
    "shared_holder",
    "supplier_customer",
    "supply",
    "partnership",
    "investment",
    "competitor",
    "peer",
    "government_contract",
    "public_funding",
    "ipo_underwriting",
    "capital_markets",
    "crypto_exposure",
    "mining_exposure",
    "blockchain_exposure",
    "etf_holding",
    "holdings_exposure",
    "ecosystem",
}

PRODUCTION_RELATIONSHIP_TYPES: set[str] = {
    "supply",
    "partnership",
    "ecosystem",
    "competitor",
    "investment",
}

REQUIRED_CANDIDATE_FIELDS: tuple[str, ...] = (
    "source_ticker",
    "target_ticker",
    "relationship_type",
    "source_type",
    "source_tier",
    "source_url",
    "filing_type",
    "filing_date",
    "capture_date",
    "extraction_text",
    "confidence_candidate",
    "signal_score",
    "review_status",
)

SOURCE_REGISTRY: dict[str, dict[str, Any]] = {
    "sec_filing": {
        "source_type": "sec_filing",
        "tier": 1,
        "description": "Official SEC EDGAR filing or structured SEC filing data.",
        "allowed_relationship_types": [
            "subsidiary",
            "ownership",
            "supplier_customer",
            "supply",
            "partnership",
            "investment",
            "competitor",
            "peer",
            "ipo_underwriting",
            "capital_markets",
            "crypto_exposure",
            "mining_exposure",
            "blockchain_exposure",
            "ecosystem",
        ],
        "required_metadata": [
            "source_url",
            "filing_type",
            "filing_date",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
    "company_release": {
        "source_type": "company_release",
        "tier": 1,
        "description": (
            "Official company investor relations release, press release, earnings "
            "material, or company disclosure page."
        ),
        "allowed_relationship_types": [
            "supplier_customer",
            "supply",
            "partnership",
            "investment",
            "competitor",
            "peer",
            "government_contract",
            "public_funding",
            "crypto_exposure",
            "mining_exposure",
            "blockchain_exposure",
            "ecosystem",
        ],
        "required_metadata": [
            "source_url",
            "filing_date",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
    "news": {
        "source_type": "news",
        "tier": 2,
        "description": (
            "Reputable financial, business, or industry news source with clear "
            "sourcing."
        ),
        "allowed_relationship_types": [
            "supplier_customer",
            "supply",
            "partnership",
            "investment",
            "competitor",
            "peer",
            "government_contract",
            "public_funding",
            "ipo_underwriting",
            "capital_markets",
            "crypto_exposure",
            "mining_exposure",
            "blockchain_exposure",
            "ecosystem",
        ],
        "required_metadata": [
            "source_url",
            "filing_date",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
    "partner_page": {
        "source_type": "partner_page",
        "tier": 2,
        "description": (
            "Official partner, customer, marketplace, supplier, or ecosystem page "
            "from a company or platform."
        ),
        "allowed_relationship_types": [
            "supplier_customer",
            "supply",
            "partnership",
            "investment",
            "ecosystem",
            "crypto_exposure",
            "blockchain_exposure",
        ],
        "required_metadata": [
            "source_url",
            "filing_date",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
    "13f_dataset": {
        "source_type": "13f_dataset",
        "tier": 1,
        "description": (
            "SEC 13F data used for institutional ownership and shared-holder "
            "candidate layers."
        ),
        "allowed_relationship_types": [
            "institutional_ownership",
            "shared_holder",
            "ownership",
            "investment",
            "holdings_exposure",
        ],
        "required_metadata": [
            "source_url",
            "filing_type",
            "filing_date",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
    "official_exchange_listing": {
        "source_type": "official_exchange_listing",
        "tier": 1,
        "description": (
            "Official exchange or listing-venue data used only to stage "
            "public-company ticker universe candidates."
        ),
        "allowed_relationship_types": [],
        "required_metadata": [
            "ticker",
            "name",
            "exchange",
            "asset_type",
            "source_url",
            "capture_date",
            "review_status",
        ],
    },
    "unknown": {
        "source_type": "unknown",
        "tier": 3,
        "description": (
            "Any source whose provenance, original source, or durability is unclear."
        ),
        "allowed_relationship_types": [],
        "required_metadata": [
            "source_url",
            "capture_date",
            "extraction_text",
            "confidence_candidate",
            "signal_score",
            "review_status",
        ],
    },
}


def registry_payload() -> dict[str, Any]:
    return {
        "source_registry": SOURCE_REGISTRY,
        "relationship_categories": sorted(RELATIONSHIP_CATEGORIES),
        "production_relationship_types": sorted(PRODUCTION_RELATIONSHIP_TYPES),
        "required_candidate_fields": list(REQUIRED_CANDIDATE_FIELDS),
    }


def print_summary() -> None:
    print("StockPhotonic source registry")
    print(f"Source types: {len(SOURCE_REGISTRY)}")
    for source_type, entry in SOURCE_REGISTRY.items():
        relationship_count = len(entry["allowed_relationship_types"])
        print(
            "- "
            f"{source_type}: tier {entry['tier']}, "
            f"{relationship_count} allowed relationship type(s)"
        )
    print(f"Candidate fields: {', '.join(REQUIRED_CANDIDATE_FIELDS)}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print the StockPhotonic source registry."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the source registry as JSON.",
    )
    args = parser.parse_args()

    if args.json:
        print(json.dumps(registry_payload(), indent=2))
    else:
        print_summary()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
