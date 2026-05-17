#!/usr/bin/env python3
"""Generate review-only candidate-company expansion batches.

This batch engine stages company candidates for graph preview only. It reads
the official ticker universe and CIK mappings, writes candidate artifacts under
data/candidates, and guards production graph files from accidental writes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_OFFICIAL_UNIVERSE_PATH = ROOT / "data" / "candidates" / "official_ticker_universe.json"
DEFAULT_CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
DEFAULT_CANDIDATE_COMPANIES_PATH = ROOT / "data" / "candidates" / "candidate_companies.json"
DEFAULT_EXPANSION_BATCHES_PATH = ROOT / "data" / "candidates" / "universe_expansion_batches.json"

PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)

URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)


EXPANSION_BATCHES: list[dict[str, Any]] = [
    {
        "batch_id": "ai_infrastructure_expansion",
        "label": "AI Infrastructure Expansion",
        "theme": "data-center compute, systems, power, cooling, and interconnect suppliers",
        "priority": "high",
        "ecosystem_keys": ["ai_infrastructure", "cloud_hyperscaler", "energy_infrastructure"],
        "corridor_keys": ["ai_compute_foundry_cloud", "energy_infrastructure"],
        "anchor_tickers": ["NVDA", "MSFT", "AMZN", "AVGO"],
        "tickers": ["DELL", "HPE", "SMCI", "ETN", "TT", "APH", "GLW", "JCI"],
    },
    {
        "batch_id": "semiconductor_supplier_batch",
        "label": "Semiconductor Supplier Batch",
        "theme": "analog, embedded, test, RF, and equipment-adjacent semiconductor suppliers",
        "priority": "high",
        "ecosystem_keys": ["semiconductor_supply_chain", "ai_infrastructure"],
        "corridor_keys": ["ai_compute_foundry_cloud"],
        "anchor_tickers": ["NVDA", "TSM", "ASML", "AMAT"],
        "tickers": ["ON", "ADI", "MCHP", "TXN", "TER", "NXPI", "SWKS", "QRVO", "KEYS"],
    },
    {
        "batch_id": "aerospace_supplier_batch",
        "label": "Aerospace Supplier Batch",
        "theme": "defense primes, aircraft systems, propulsion, and aerospace manufacturing",
        "priority": "medium",
        "ecosystem_keys": ["aerospace_oem", "energy_infrastructure"],
        "corridor_keys": ["aerospace_oem", "energy_infrastructure"],
        "anchor_tickers": ["BA", "RTX", "GE", "HON"],
        "tickers": ["LMT", "NOC", "GD", "TXT", "TDG", "HWM", "HII"],
    },
    {
        "batch_id": "financial_infrastructure_batch",
        "label": "Financial Infrastructure Batch",
        "theme": "exchanges, market data, ratings, asset management, and investment banking",
        "priority": "high",
        "ecosystem_keys": ["financial_payments"],
        "corridor_keys": ["payment_networks_banks"],
        "anchor_tickers": ["JPM", "V", "MA", "AXP"],
        "tickers": ["ICE", "CME", "NDAQ", "SPGI", "MCO", "BLK", "GS", "MS", "CBOE"],
    },
    {
        "batch_id": "healthcare_adjacency_batch",
        "label": "Healthcare Adjacency Batch",
        "theme": "medtech, hospitals, life-sciences tools, biopharma, and distribution adjacencies",
        "priority": "medium",
        "ecosystem_keys": ["healthcare_biotech"],
        "corridor_keys": ["pbm_pharma_insurance"],
        "anchor_tickers": ["LLY", "UNH", "CVS", "JNJ", "TMO"],
        "tickers": ["DHR", "SYK", "MDT", "HCA", "ELV", "AMGN", "GILD", "REGN", "VRTX", "BSX", "ABT", "MCK"],
    },
    {
        "batch_id": "energy_infrastructure_batch",
        "label": "Energy Infrastructure Batch",
        "theme": "midstream, refining, upstream, and oilfield service expansion candidates",
        "priority": "high",
        "ecosystem_keys": ["energy_infrastructure"],
        "corridor_keys": ["energy_infrastructure"],
        "anchor_tickers": ["XOM", "CVX", "COP", "SLB"],
        "tickers": ["MPC", "PSX", "OKE", "KMI", "ENB", "PAA", "WMB", "EOG", "OXY", "HAL", "BKR", "VLO", "ET"],
    },
    {
        "batch_id": "retail_logistics_distribution_batch",
        "label": "Retail Logistics Distribution Batch",
        "theme": "transport, distribution, retail operations, and delivery platform breadth",
        "priority": "medium",
        "ecosystem_keys": ["retail_consumer", "enterprise_saas_workflow"],
        "corridor_keys": ["retail_consumer"],
        "anchor_tickers": ["WMT", "COST", "HD", "AMZN"],
        "tickers": ["UPS", "FDX", "UNP", "CSX", "ODFL", "URI", "LOW", "TGT", "SBUX", "CMG", "DASH", "UBER"],
    },
    {
        "batch_id": "cloud_security_workflow_batch",
        "label": "Cloud Security Workflow Batch",
        "theme": "security, observability, data, collaboration, and developer workflow expansion",
        "priority": "medium",
        "ecosystem_keys": ["enterprise_saas_workflow", "cloud_hyperscaler"],
        "corridor_keys": ["enterprise_saas_cloud"],
        "anchor_tickers": ["MSFT", "GOOGL", "ORCL", "CRM", "PANW"],
        "tickers": ["FTNT", "CRWD", "DDOG", "MDB", "NET", "ZS", "TEAM", "ADSK"],
    },
]


ECOSYSTEM_LABELS = {
    "ai_infrastructure": "AI Infrastructure",
    "semiconductor_supply_chain": "Semiconductor Supply Chain",
    "cloud_hyperscaler": "Cloud / Hyperscaler",
    "financial_payments": "Financial / Payments",
    "energy_infrastructure": "Energy Infrastructure",
    "healthcare_biotech": "Healthcare / Biotech",
    "enterprise_saas_workflow": "Enterprise SaaS / Workflow",
    "retail_consumer": "Retail / Consumer",
    "aerospace_oem": "Aerospace / Defense",
}

CORRIDOR_LABELS = {
    "ai_compute_foundry_cloud": "AI compute/foundry/cloud",
    "payment_networks_banks": "Payment networks/banks",
    "pbm_pharma_insurance": "PBM/pharma/insurance",
    "aerospace_oem": "Aerospace/OEM",
    "energy_infrastructure": "Energy infrastructure",
    "enterprise_saas_cloud": "Enterprise SaaS/cloud",
    "retail_consumer": "Retail/consumer",
}

SECTOR_BY_BATCH = {
    "ai_infrastructure_expansion": "AI Infrastructure / Data Center Suppliers",
    "semiconductor_supplier_batch": "Semiconductor Suppliers",
    "aerospace_supplier_batch": "Defense / Aerospace Suppliers",
    "financial_infrastructure_batch": "Financial Market Infrastructure",
    "healthcare_adjacency_batch": "Healthcare / MedTech / Distribution",
    "energy_infrastructure_batch": "Energy Infrastructure",
    "retail_logistics_distribution_batch": "Retail Logistics / Distribution",
    "cloud_security_workflow_batch": "Enterprise Software / Cloud Security",
}

INDUSTRY_BY_TICKER = {
    "ABT": "Medical Devices and Diagnostics",
    "ADI": "Analog and Mixed-Signal Semiconductors",
    "ADSK": "Design and Engineering Software",
    "AMGN": "Biotechnology",
    "APH": "Electronic Interconnects",
    "BKR": "Oilfield Equipment and Services",
    "BLK": "Asset Management and Market Infrastructure",
    "BSX": "Medical Devices",
    "CBOE": "Options Exchange and Market Infrastructure",
    "CME": "Derivatives Exchange Infrastructure",
    "CMG": "Restaurants and Consumer Food Service",
    "CRWD": "Cloud Security",
    "CSX": "Rail Freight",
    "DASH": "Local Commerce and Delivery Platform",
    "DDOG": "Cloud Observability and Monitoring",
    "DELL": "Data Center Systems and Enterprise Infrastructure",
    "DHR": "Life Sciences Tools and Diagnostics",
    "ELV": "Health Insurance and Managed Care",
    "ENB": "Energy Midstream Infrastructure",
    "EOG": "Oil and Gas Exploration and Production",
    "ET": "Energy Midstream Infrastructure",
    "ETN": "Electrical Power Management",
    "FDX": "Parcel and Freight Logistics",
    "FTNT": "Network Security",
    "GD": "Defense Platforms and Mission Systems",
    "GILD": "Biopharmaceuticals",
    "GLW": "Optical and Specialty Materials",
    "GS": "Investment Banking and Markets",
    "HAL": "Oilfield Services",
    "HCA": "Hospital Operations",
    "HII": "Defense Shipbuilding",
    "HPE": "Enterprise Servers and Networking",
    "HWM": "Aerospace Components",
    "ICE": "Exchange and Data Infrastructure",
    "JCI": "Building Systems and Cooling Controls",
    "KEYS": "Electronic Test and Measurement",
    "KMI": "Energy Midstream Infrastructure",
    "LMT": "Defense Prime Contractor",
    "LOW": "Home Improvement Retail",
    "MCHP": "Embedded Control Semiconductors",
    "MCK": "Healthcare Distribution",
    "MCO": "Credit Ratings and Analytics",
    "MDB": "Cloud Database Software",
    "MDT": "Medical Devices",
    "MPC": "Refining and Energy Logistics",
    "MS": "Investment Banking and Wealth Management",
    "NDAQ": "Exchange and Market Technology",
    "NET": "Edge Cloud and Security",
    "NOC": "Defense Prime Contractor",
    "NXPI": "Automotive and Edge Semiconductors",
    "ODFL": "Less-than-Truckload Freight",
    "OKE": "Energy Midstream Infrastructure",
    "ON": "Power and Sensor Semiconductors",
    "OXY": "Oil and Gas Exploration and Production",
    "PAA": "Energy Midstream Infrastructure",
    "PSX": "Refining and Midstream",
    "QRVO": "RF Semiconductors",
    "REGN": "Biopharmaceuticals",
    "SMCI": "AI Server Systems",
    "SPGI": "Market Data, Index, and Ratings Infrastructure",
    "SBUX": "Restaurants and Consumer Retail",
    "SWKS": "RF and Connectivity Semiconductors",
    "SYK": "Medical Devices",
    "TEAM": "Collaboration and Developer Workflow Software",
    "TDG": "Aerospace Components",
    "TER": "Semiconductor Test Equipment",
    "TGT": "General Merchandise Retail",
    "TT": "HVAC and Thermal Management",
    "TXT": "Aerospace and Defense Platforms",
    "TXN": "Analog and Embedded Semiconductors",
    "UBER": "Mobility, Delivery, and Logistics Platform",
    "UNP": "Rail Freight",
    "UPS": "Parcel Logistics",
    "URI": "Industrial Equipment Rental and Distribution",
    "VLO": "Refining and Energy Logistics",
    "VRTX": "Biopharmaceuticals",
    "WMB": "Energy Midstream Infrastructure",
    "ZS": "Cloud Security",
}


class ExpansionBatchError(Exception):
    """Raised for clear expansion-batch failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate review-only candidate-company expansion batches. "
            "The command does not write production companies or connections."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--official-universe", default=str(DEFAULT_OFFICIAL_UNIVERSE_PATH))
    parser.add_argument("--cik-mappings", default=str(DEFAULT_CIK_MAPPINGS_PATH))
    parser.add_argument("--candidate-output", default=str(DEFAULT_CANDIDATE_COMPANIES_PATH))
    parser.add_argument("--batch-output", default=str(DEFAULT_EXPANSION_BATCHES_PATH))
    parser.add_argument("--write", action="store_true", help="Write review-only candidate artifacts.")
    parser.add_argument("--force", action="store_true", help="Overwrite candidate artifacts when --write is used.")
    parser.add_argument("--json", action="store_true", help="Print candidate company artifact JSON.")
    args = parser.parse_args(argv)
    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
    return args


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def load_json(path: Path, label: str) -> Any:
    if not path.exists():
        raise ExpansionBatchError(f"{label} file is missing: {display_path(path)}")
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise ExpansionBatchError(f"could not read {label} file {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ExpansionBatchError(f"could not parse {label} file {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise ExpansionBatchError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise ExpansionBatchError(f"could not read production guard file {display_path(path)}: {exc}") from exc
    return hashes


def assert_production_unchanged(initial_hashes: dict[Path, str]) -> None:
    current = production_hashes()
    changed = [
        display_path(path)
        for path, initial_hash in initial_hashes.items()
        if current.get(path) != initial_hash
    ]
    if changed:
        raise ExpansionBatchError(
            "production data changed during candidate-company batch generation: "
            f"{', '.join(changed)}"
        )


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def normalize_ticker(value: Any) -> str | None:
    text = clean_string(value)
    return text.upper() if text else None


def valid_url(value: Any) -> bool:
    return isinstance(value, str) and URL_PATTERN.match(value.strip()) is not None


def load_array_payload(path: Path, label: str, key: str) -> list[dict[str, Any]]:
    payload = load_json(path, label)
    if not isinstance(payload, dict) or not isinstance(payload.get(key), list):
        raise ExpansionBatchError(f"{label} must contain a {key} array.")
    return [item for item in payload[key] if isinstance(item, dict)]


def load_companies(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "companies")
    if not isinstance(payload, list):
        raise ExpansionBatchError("companies file must contain a JSON array.")
    return [company for company in payload if isinstance(company, dict)]


def company_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(str(value).replace("/DE/", "").replace("/NY", "").split())


def infer_industry_group(record: dict[str, Any]) -> str:
    industry = str(record.get("industry_proposal") or "").lower()
    if any(token in industry for token in ("semiconductor", "analog", "rf", "test")):
        return "Semiconductor Suppliers"
    if any(token in industry for token in ("security", "software", "cloud", "database", "workflow", "observability")):
        return "Cloud Software / Security"
    if any(token in industry for token in ("defense", "aerospace", "aircraft")):
        return "Aerospace / Defense"
    if any(token in industry for token in ("exchange", "ratings", "asset", "banking", "markets")):
        return "Financial Market Infrastructure"
    if any(token in industry for token in ("medical", "health", "biopharma", "hospital")):
        return "Healthcare Adjacencies"
    if any(token in industry for token in ("energy", "oil", "gas", "midstream", "refining")):
        return "Energy Infrastructure"
    if any(token in industry for token in ("retail", "freight", "logistics", "delivery", "restaurant")):
        return "Retail / Logistics"
    if any(token in industry for token in ("data center", "power", "cooling", "interconnect", "server")):
        return "AI Infrastructure Suppliers"
    return "Expansion Candidate"


def build_candidate_record(
    ticker: str,
    batch: dict[str, Any],
    universe_row: dict[str, Any],
    cik_row: dict[str, Any] | None,
    batch_membership: list[str],
) -> dict[str, Any]:
    listing_url = clean_string(universe_row.get("source_url"))
    cik_url = clean_string(cik_row.get("source_url")) if isinstance(cik_row, dict) else None
    source_urls = [url for url in (listing_url, cik_url) if url and valid_url(url)]
    ecosystem_keys = [str(key) for key in batch.get("ecosystem_keys", [])]
    corridor_keys = [str(key) for key in batch.get("corridor_keys", [])]
    blockers: list[str] = []
    if not listing_url or not valid_url(listing_url):
        blockers.append("missing_valid_listing_source")
    if not cik_url or not valid_url(cik_url):
        blockers.append("missing_valid_cik_source")
    if not clean_string(universe_row.get("name")):
        blockers.append("missing_official_name")
    readiness_score = 35 + (25 if cik_url and valid_url(cik_url) else 0) + (15 if source_urls else 0) + 10
    if blockers:
        readiness_score = min(readiness_score, 68)
    readiness_state = "ready_for_preview" if readiness_score >= 75 and not blockers else "needs_source_review"
    industry = INDUSTRY_BY_TICKER.get(ticker) or str(batch.get("theme") or "Expansion candidate")
    staged_hub_score = round(
        len(ecosystem_keys) * 1.8
        + len(corridor_keys) * 2.1
        + min(4, len(batch.get("anchor_tickers", []))) * 1.15
        + (3 if readiness_state == "ready_for_preview" else 0),
        2,
    )
    record = {
        "ticker": ticker,
        "name": company_name(clean_string(universe_row.get("name"))),
        "exchange": clean_string(universe_row.get("exchange")),
        "asset_type": clean_string(universe_row.get("asset_type")) or "public_company",
        "source_type": clean_string(universe_row.get("source_type")) or "official_exchange_listing",
        "source_tier": universe_row.get("source_tier", 1),
        "source_urls": source_urls,
        "official_listing_source_url": listing_url,
        "sec_submission_source_url": cik_url,
        "cik": clean_string(cik_row.get("cik")) if isinstance(cik_row, dict) else None,
        "capture_date": clean_string(universe_row.get("capture_date")),
        "review_status": "pending_reviewer_preview",
        "readiness_state": readiness_state,
        "readiness_score": readiness_score,
        "expansion_readiness_label": "Ready for preview" if readiness_state == "ready_for_preview" else "Needs source review",
        "blockers": blockers,
        "duplicate_ticker_warning": False,
        "alias_conflict_warnings": [],
        "sector_proposal": SECTOR_BY_BATCH.get(str(batch.get("batch_id")), "Expansion Candidates"),
        "industry_proposal": industry,
        "industry_group_proposal": infer_industry_group({"industry_proposal": industry}),
        "ecosystem_assignments": [
            {
                "ecosystem_key": key,
                "label": ECOSYSTEM_LABELS.get(key, key.replace("_", " ").title()),
                "assignment_status": "reviewer_proposed",
                "assignment_authority": False,
                "relationship_authority": False,
                "review_only": True,
            }
            for key in ecosystem_keys
        ],
        "corridor_assignments": [
            {
                "corridor_key": key,
                "label": CORRIDOR_LABELS.get(key, key.replace("_", " ").title()),
                "assignment_status": "reviewer_proposed",
                "assignment_authority": False,
                "relationship_authority": False,
                "review_only": True,
            }
            for key in corridor_keys
        ],
        "expansion_batch_ids": batch_membership,
        "primary_batch_id": clean_string(batch.get("batch_id")),
        "expansion_rationale": clean_string(batch.get("theme")),
        "trust_tier_label": "Tier 1 identity source, review-only context assignment",
        "source_readiness_summary": {
            "official_identity_source_count": len(source_urls),
            "has_official_listing_source": bool(listing_url and valid_url(listing_url)),
            "has_sec_submission_source": bool(cik_url and valid_url(cik_url)),
            "source_lifecycle_state": "fresh_review_source" if readiness_state == "ready_for_preview" else "source_review_required",
            "auto_trust_escalation_allowed": False,
            "relationship_authority": False,
            "review_only": True,
        },
        "strategic_hub_preview": {
            "corridor_centrality_score": round(len(corridor_keys) * 2.1, 2),
            "ecosystem_breadth_score": round(len(ecosystem_keys) * 1.8, 2),
            "source_backed_context_score": len(source_urls),
            "bridge_significance_score": staged_hub_score,
            "staged_hub_score": staged_hub_score,
            "strategic_hub_candidate": staged_hub_score >= 8,
            "review_only": True,
        },
        "preview": {
            "graph_preview_allowed": True,
            "preview_anchor_tickers": list(batch.get("anchor_tickers", [])),
            "preview_edge_semantics": "corridor_assignment_not_relationship",
            "preview_node_label": "Candidate company",
            "production_write_allowed": False,
            "relationship_claim_created": False,
            "review_only": True,
        },
        "manual_promotion_required": True,
        "manual_promotion_allowed": False,
        "auto_promotion_allowed": False,
        "production_write_allowed": False,
        "relationship_authority": False,
        "ecosystem_membership_authority": False,
        "review_only": True,
    }
    return record


def build_artifacts(
    *,
    companies_path: Path,
    universe_path: Path,
    cik_path: Path,
    candidate_output_path: Path,
    batch_output_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)
    companies = load_companies(companies_path)
    universe = load_array_payload(universe_path, "official ticker universe", "candidates")
    cik_mappings = load_array_payload(cik_path, "CIK mappings", "mappings")

    production_tickers = {
        ticker for company in companies if (ticker := normalize_ticker(company.get("ticker")))
    }
    universe_by_ticker = {
        ticker: row for row in universe if (ticker := normalize_ticker(row.get("ticker")))
    }
    cik_by_ticker = {
        ticker: row for row in cik_mappings if (ticker := normalize_ticker(row.get("ticker")))
    }
    batch_membership: dict[str, list[str]] = defaultdict(list)
    for batch in EXPANSION_BATCHES:
        for raw_ticker in batch.get("tickers", []):
            ticker = normalize_ticker(raw_ticker)
            if ticker:
                batch_membership[ticker].append(str(batch["batch_id"]))

    records: list[dict[str, Any]] = []
    skipped_missing_source: list[str] = []
    skipped_existing_production: list[str] = []
    seen: set[str] = set()
    for batch in EXPANSION_BATCHES:
        for raw_ticker in batch.get("tickers", []):
            ticker = normalize_ticker(raw_ticker)
            if not ticker or ticker in seen:
                continue
            seen.add(ticker)
            if ticker in production_tickers:
                skipped_existing_production.append(ticker)
                continue
            universe_row = universe_by_ticker.get(ticker)
            if not universe_row:
                skipped_missing_source.append(ticker)
                continue
            record = build_candidate_record(
                ticker=ticker,
                batch=batch,
                universe_row=universe_row,
                cik_row=cik_by_ticker.get(ticker),
                batch_membership=sorted(batch_membership[ticker]),
            )
            records.append(record)

    duplicate_candidates = sorted(
        ticker for ticker, count in Counter(record["ticker"] for record in records).items() if count > 1
    )
    readiness_counts = Counter(record["readiness_state"] for record in records)
    blocker_counts = Counter(blocker for record in records for blocker in record.get("blockers", []))
    ecosystem_counts = Counter(
        assignment["ecosystem_key"]
        for record in records
        for assignment in record.get("ecosystem_assignments", [])
    )
    corridor_counts = Counter(
        assignment["corridor_key"]
        for record in records
        for assignment in record.get("corridor_assignments", [])
    )

    batch_records = []
    for batch in EXPANSION_BATCHES:
        tickers = [
            ticker
            for ticker in (normalize_ticker(item) for item in batch.get("tickers", []))
            if ticker and any(record["ticker"] == ticker for record in records)
        ]
        batch_records.append(
            {
                "batch_id": batch["batch_id"],
                "label": batch["label"],
                "theme": batch["theme"],
                "priority": batch["priority"],
                "review_status": "pending_reviewer_preview",
                "candidate_count": len(tickers),
                "tickers": tickers,
                "ecosystem_keys": batch["ecosystem_keys"],
                "ecosystem_labels": [ECOSYSTEM_LABELS.get(key, key) for key in batch["ecosystem_keys"]],
                "corridor_keys": batch["corridor_keys"],
                "corridor_labels": [CORRIDOR_LABELS.get(key, key) for key in batch["corridor_keys"]],
                "preview_anchor_tickers": batch["anchor_tickers"],
                "expansion_rationale": batch["theme"],
                "trust_tier_label": "Official listing/SEC identity sources; assignments remain reviewer-proposed",
                "production_write_allowed": False,
                "auto_promotion_allowed": False,
                "relationship_authority": False,
                "review_only": True,
            }
        )

    metadata = {
        "artifact_status": "review_only",
        "schema_version": 1,
        "generated_by": "scripts/universe_expansion_batches.py",
        "generated_at_utc": generated_at.isoformat(),
        "candidate_output_path": display_path(candidate_output_path),
        "batch_output_path": display_path(batch_output_path),
        "production_write_allowed": False,
        "auto_promotion_allowed": False,
        "manual_promotion_required": True,
        "browser_ingestion": False,
        "network_calls": 0,
        "app_load_allowed": "preview_only",
        "relationship_claim_authority": False,
        "notes": [
            "Candidate companies are preview-only staging records.",
            "Corridor and ecosystem assignments are reviewer-proposed planning context, not production memberships.",
            "Preview anchor lines are corridor-planning guides and do not assert relationships.",
        ],
    }
    safety = {
        "review_only": True,
        "production_writes": 0,
        "companies_written": 0,
        "connections_written": 0,
        "auto_promotion_executed": False,
        "unsafe_auto_promotion": False,
        "browser_ingestion": False,
        "relationship_claims_created": 0,
    }

    candidate_payload = {
        "metadata": metadata,
        "summary": {
            "candidate_company_count": len(records),
            "expansion_batch_count": len(batch_records),
            "ready_for_preview_count": readiness_counts.get("ready_for_preview", 0),
            "needs_source_review_count": readiness_counts.get("needs_source_review", 0),
            "duplicate_candidate_ticker_count": len(duplicate_candidates),
            "skipped_existing_production_count": len(skipped_existing_production),
            "skipped_missing_source_count": len(skipped_missing_source),
            "ecosystem_count": len(ecosystem_counts),
            "corridor_count": len(corridor_counts),
            "review_only": True,
        },
        "governance": {
            "readiness_state_counts": dict(sorted(readiness_counts.items())),
            "blocker_counts": dict(sorted(blocker_counts.items())),
            "duplicate_ticker_warnings": duplicate_candidates,
            "skipped_existing_production_tickers": sorted(skipped_existing_production),
            "skipped_missing_official_source_tickers": sorted(skipped_missing_source),
            "alias_conflict_warnings": [],
            "ecosystem_assignment_status": "reviewer_proposed",
            "corridor_assignment_status": "reviewer_proposed",
            "production_write_allowed": False,
            "auto_promotion_allowed": False,
            "review_only": True,
        },
        "graph_growth_metrics": {
            "production_company_count": len(companies),
            "candidate_company_count": len(records),
            "preview_total_company_count": len(companies) + len(records),
            "density_default_mode": "balanced",
            "candidate_visibility_index_cached": True,
            "route_summary_cache_required": True,
            "label_throttle_required": len(companies) + len(records) > 110,
            "review_only": True,
        },
        "expansion_batches": batch_records,
        "records": sorted(records, key=lambda item: (item["primary_batch_id"], item["ticker"])),
        "safety": safety,
    }

    batch_payload = {
        "metadata": {
            **metadata,
            "candidate_output_path": display_path(candidate_output_path),
            "batch_output_path": display_path(batch_output_path),
        },
        "summary": candidate_payload["summary"],
        "graph_growth_metrics": candidate_payload["graph_growth_metrics"],
        "batches": batch_records,
        "safety": safety,
    }
    validate_payload(candidate_payload, batch_payload)
    return candidate_payload, batch_payload


def validate_payload(candidate_payload: dict[str, Any], batch_payload: dict[str, Any]) -> None:
    if candidate_payload.get("metadata", {}).get("artifact_status") != "review_only":
        raise ExpansionBatchError("candidate company payload must be review_only.")
    if candidate_payload.get("metadata", {}).get("production_write_allowed") is not False:
        raise ExpansionBatchError("candidate company payload cannot allow production writes.")
    if candidate_payload.get("safety", {}).get("production_writes") != 0:
        raise ExpansionBatchError("candidate company payload safety must show zero production writes.")
    records = candidate_payload.get("records")
    if not isinstance(records, list):
        raise ExpansionBatchError("candidate company records must be a list.")
    for index, record in enumerate(records, start=1):
        if record.get("review_only") is not True:
            raise ExpansionBatchError(f"candidate company {index} must be review_only.")
        if record.get("production_write_allowed") is not False:
            raise ExpansionBatchError(f"candidate company {index} cannot allow production writes.")
        if record.get("relationship_authority") is not False:
            raise ExpansionBatchError(f"candidate company {index} cannot have relationship authority.")
        source_urls = record.get("source_urls")
        if not isinstance(source_urls, list) or not source_urls:
            raise ExpansionBatchError(f"candidate company {index} must include at least one official source URL.")
        for source_url in source_urls:
            if not valid_url(source_url):
                raise ExpansionBatchError(f"candidate company {index} has an invalid source URL.")
    if batch_payload.get("safety", {}).get("production_writes") != 0:
        raise ExpansionBatchError("batch payload safety must show zero production writes.")


def print_human(candidate_payload: dict[str, Any], candidate_output_path: Path, batch_output_path: Path) -> None:
    summary = candidate_payload["summary"]
    print("Candidate company expansion batches")
    print("===================================")
    print(f"Candidate companies: {summary['candidate_company_count']}")
    print(f"Expansion batches: {summary['expansion_batch_count']}")
    print(f"Ready for preview: {summary['ready_for_preview_count']}")
    print(f"Needs source review: {summary['needs_source_review_count']}")
    print(f"Skipped production duplicates: {summary['skipped_existing_production_count']}")
    print("Production writes: 0")
    print(f"Candidate path: {display_path(candidate_output_path)}")
    print(f"Batch path: {display_path(batch_output_path)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    companies_path = resolve_path(args.companies)
    universe_path = resolve_path(args.official_universe)
    cik_path = resolve_path(args.cik_mappings)
    candidate_output_path = resolve_path(args.candidate_output)
    batch_output_path = resolve_path(args.batch_output)
    initial_hashes = production_hashes()
    try:
        candidate_payload, batch_payload = build_artifacts(
            companies_path=companies_path,
            universe_path=universe_path,
            cik_path=cik_path,
            candidate_output_path=candidate_output_path,
            batch_output_path=batch_output_path,
        )
        if args.write:
            write_json(candidate_output_path, candidate_payload, force=args.force)
            write_json(batch_output_path, batch_payload, force=args.force)
        assert_production_unchanged(initial_hashes)
    except ExpansionBatchError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(candidate_payload, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(candidate_payload, candidate_output_path, batch_output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
