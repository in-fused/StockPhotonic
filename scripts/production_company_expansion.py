#!/usr/bin/env python3
"""Apply reviewer-approved production company expansion batches.

The command defaults to dry-run mode. It writes production data only when
--write is supplied and only from an explicit reviewer approval manifest.
Relationship edges are appended only when individually listed in the manifest.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"
DEFAULT_CANDIDATE_COMPANIES_PATH = ROOT / "data" / "candidates" / "candidate_companies.json"
DEFAULT_CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
DEFAULT_APPROVALS_PATH = ROOT / "data" / "candidates" / "production_expansion_approvals.json"
DEFAULT_REPORT_PATH = ROOT / "data" / "candidates" / "production_expansion_report.json"

URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CIK_PATTERN = re.compile(r"^\d{10}$")
ALLOWED_TYPES = {"supply", "partnership", "ecosystem", "competitor", "investment"}
COMPANY_SUFFIX_PATTERN = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|plc|ltd|limited|lp|llc|holdings|holding|group|sa|ag|nv|n\.v)\b\.?",
    re.IGNORECASE,
)

COLOR_BY_BATCH = {
    "ai_infrastructure_expansion": "#38bdf8",
    "semiconductor_supplier_batch": "#34d399",
    "aerospace_supplier_batch": "#f59e0b",
    "financial_infrastructure_batch": "#c084fc",
    "retail_logistics_distribution_batch": "#fb7185",
    "cloud_security_workflow_batch": "#60a5fa",
}

OFFICIAL_RELATIONSHIP_HOSTS = {
    "cloudflare.com",
    "data.sec.gov",
    "ir.supermicro.com",
    "nvidianews.nvidia.com",
    "sec.gov",
    "www.cloudflare.com",
    "www.sec.gov",
}


class ProductionExpansionError(Exception):
    """Raised for expansion failures that must stop writes."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Promote reviewer-approved candidate-company batches into "
            "production companies, with optional explicitly approved "
            "source-backed production edges."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--candidate-companies", default=str(DEFAULT_CANDIDATE_COMPANIES_PATH))
    parser.add_argument("--cik-mappings", default=str(DEFAULT_CIK_MAPPINGS_PATH))
    parser.add_argument("--approvals", default=str(DEFAULT_APPROVALS_PATH))
    parser.add_argument("--report", default=str(DEFAULT_REPORT_PATH))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Preview writes without changing production data. Default.")
    mode.add_argument("--write", action="store_true", help="Write approved company and edge additions.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable report JSON.")
    return parser.parse_args(argv)


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
        raise ProductionExpansionError(f"{label} file is missing: {display_path(path)}")
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise ProductionExpansionError(f"could not read {label} file {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionExpansionError(f"could not parse {label} file {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def normalize_ticker(value: Any) -> str:
    return str(value or "").strip().upper()


def normalize_name(value: Any) -> str:
    text = clean_string(value) or ""
    text = COMPANY_SUFFIX_PATTERN.sub("", text)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return " ".join(text.split())


def valid_url(value: Any) -> bool:
    return isinstance(value, str) and URL_PATTERN.match(value.strip()) is not None


def url_host(value: str) -> str:
    try:
        parsed = urlparse(value)
    except ValueError:
        return ""
    return (parsed.hostname or "").lower()


def is_official_relationship_url(value: str) -> bool:
    host = url_host(value)
    return host in OFFICIAL_RELATIONSHIP_HOSTS or host.endswith(".sec.gov")


def valid_date(value: Any) -> bool:
    return isinstance(value, str) and DATE_PATTERN.match(value) is not None


def load_records(payload: Any, key: str) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get(key), list):
        return [item for item in payload[key] if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def company_by_ticker(companies: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        ticker: company
        for company in companies
        if (ticker := normalize_ticker(company.get("ticker")))
    }


def validate_approval_manifest(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ProductionExpansionError("approval manifest metadata must be an object.")
    if metadata.get("approval_status") != "reviewer_approved_production_expansion":
        raise ProductionExpansionError("approval manifest must be reviewer-approved for production expansion.")
    if metadata.get("production_write_allowed") is not True:
        raise ProductionExpansionError("approval manifest must explicitly allow this reviewed production write.")
    if metadata.get("automatic_promotion_allowed") is not False:
        raise ProductionExpansionError("approval manifest cannot allow automatic promotion.")
    if metadata.get("browser_ingestion") is not False:
        raise ProductionExpansionError("approval manifest cannot enable browser ingestion.")
    if metadata.get("relationship_generation_allowed") is not False:
        raise ProductionExpansionError("approval manifest cannot allow automatic relationship generation.")
    if not isinstance(payload.get("approved_company_batches"), list):
        raise ProductionExpansionError("approved_company_batches must be a list.")
    if not isinstance(payload.get("approved_relationships"), list):
        raise ProductionExpansionError("approved_relationships must be a list.")


def approval_batch_tickers(payload: dict[str, Any]) -> tuple[list[str], dict[str, str]]:
    tickers: list[str] = []
    batch_by_ticker: dict[str, str] = {}
    for batch in payload.get("approved_company_batches", []):
        if not isinstance(batch, dict):
            raise ProductionExpansionError("approved company batch records must be objects.")
        batch_id = clean_string(batch.get("batch_id"))
        if not batch_id:
            raise ProductionExpansionError("approved company batch is missing batch_id.")
        raw_tickers = batch.get("tickers")
        if not isinstance(raw_tickers, list) or not raw_tickers:
            raise ProductionExpansionError(f"approved company batch {batch_id} must list tickers.")
        for raw_ticker in raw_tickers:
            ticker = normalize_ticker(raw_ticker)
            if not ticker:
                raise ProductionExpansionError(f"approved company batch {batch_id} has a blank ticker.")
            tickers.append(ticker)
            batch_by_ticker[ticker] = batch_id
    duplicates = sorted(ticker for ticker, count in Counter(tickers).items() if count > 1)
    if duplicates:
        raise ProductionExpansionError(f"approval manifest has duplicate tickers: {', '.join(duplicates)}")
    return tickers, batch_by_ticker


def source_urls(record: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    raw_urls = record.get("source_urls")
    if isinstance(raw_urls, list):
        urls.extend(str(url).strip() for url in raw_urls if valid_url(url))
    for key in ("official_listing_source_url", "sec_submission_source_url", "source_url", "url"):
        url = clean_string(record.get(key))
        if url and valid_url(url):
            urls.append(url)
    return sorted(set(urls))


def validate_company_record(
    ticker: str,
    record: dict[str, Any],
    production_tickers: set[str],
    production_aliases: set[str],
) -> None:
    if ticker in production_tickers:
        raise ProductionExpansionError(f"{ticker} already exists in production companies.")
    if record.get("production_write_allowed") is True:
        raise ProductionExpansionError(f"{ticker} candidate has unsafe production_write_allowed=true.")
    if record.get("auto_promotion_allowed") is not False:
        raise ProductionExpansionError(f"{ticker} candidate must have auto_promotion_allowed=false.")
    if record.get("relationship_authority") is not False:
        raise ProductionExpansionError(f"{ticker} candidate must not have relationship authority.")
    if record.get("ecosystem_membership_authority") is not False:
        raise ProductionExpansionError(f"{ticker} candidate must not have ecosystem membership authority.")
    if record.get("duplicate_ticker_warning") is True:
        raise ProductionExpansionError(f"{ticker} candidate has duplicate_ticker_warning.")
    alias_warnings = record.get("alias_conflict_warnings")
    if isinstance(alias_warnings, list) and alias_warnings:
        raise ProductionExpansionError(f"{ticker} candidate has alias conflict warnings.")
    blockers = record.get("blockers")
    if isinstance(blockers, list) and blockers:
        raise ProductionExpansionError(f"{ticker} candidate has unresolved blockers: {', '.join(map(str, blockers))}")
    official_listing = clean_string(record.get("official_listing_source_url"))
    sec_submission = clean_string(record.get("sec_submission_source_url"))
    if not official_listing or not valid_url(official_listing):
        raise ProductionExpansionError(f"{ticker} is missing an official listing source URL.")
    if not sec_submission or not valid_url(sec_submission):
        raise ProductionExpansionError(f"{ticker} is missing an SEC submissions source URL.")
    cik = clean_string(record.get("cik"))
    if cik and not CIK_PATTERN.match(cik):
        raise ProductionExpansionError(f"{ticker} has invalid CIK format: {cik}.")
    alias = normalize_name(record.get("name"))
    if alias and alias in production_aliases:
        raise ProductionExpansionError(f"{ticker} normalized company name conflicts with production alias: {alias}.")


def build_company(
    *,
    company_id: int,
    ticker: str,
    record: dict[str, Any],
    batch_id: str,
    approval_date: str,
) -> dict[str, Any]:
    return {
        "id": company_id,
        "ticker": ticker,
        "name": clean_string(record.get("name")) or ticker,
        "sector": clean_string(record.get("sector_proposal")) or "Production Expansion",
        "industry": clean_string(record.get("industry_proposal")) or "Reviewer-approved production expansion",
        "color": COLOR_BY_BATCH.get(batch_id, "#7dd3fc"),
        "cik": clean_string(record.get("cik")),
        "source_urls": source_urls(record),
        "official_listing_source_url": clean_string(record.get("official_listing_source_url")),
        "sec_submission_source_url": clean_string(record.get("sec_submission_source_url")),
        "production_approval": {
            "approval_status": "reviewer_approved",
            "approval_date": approval_date,
            "batch_id": batch_id,
            "automatic_promotion_allowed": False,
            "relationship_authority": False,
            "source_identity_approved": True,
        },
    }


def endpoint_sec_url(ticker: str, by_ticker: dict[str, dict[str, Any]], cik_by_ticker: dict[str, dict[str, Any]]) -> str | None:
    company = by_ticker.get(ticker, {})
    for key in ("sec_submission_source_url", "source_url"):
        url = clean_string(company.get(key))
        if url and valid_url(url):
            return url
    mapping = cik_by_ticker.get(ticker, {})
    url = clean_string(mapping.get("source_url"))
    return url if url and valid_url(url) else None


def is_existing_approved_company(company: dict[str, Any], batch_id: str) -> bool:
    approval = company.get("production_approval")
    if not isinstance(approval, dict):
        return False
    return (
        approval.get("approval_status") == "reviewer_approved"
        and approval.get("automatic_promotion_allowed") is False
        and approval.get("batch_id") == batch_id
        and approval.get("source_identity_approved") is True
    )


def relationship_key_from_manifest(
    relationship: dict[str, Any],
    by_ticker: dict[str, dict[str, Any]],
) -> tuple[int, int, str] | None:
    source_ticker = normalize_ticker(relationship.get("source_ticker"))
    target_ticker = normalize_ticker(relationship.get("target_ticker"))
    source = by_ticker.get(source_ticker)
    target = by_ticker.get(target_ticker)
    edge_type = clean_string(relationship.get("type"))
    if not source or not target or edge_type not in ALLOWED_TYPES:
        return None
    source_id = source.get("id")
    target_id = target.get("id")
    if not isinstance(source_id, int) or not isinstance(target_id, int) or source_id == target_id:
        return None
    return (min(source_id, target_id), max(source_id, target_id), edge_type)


def relationship_source_urls(
    relationship: dict[str, Any],
    by_ticker: dict[str, dict[str, Any]],
    cik_by_ticker: dict[str, dict[str, Any]],
) -> list[str]:
    urls = [str(url).strip() for url in relationship.get("source_urls", []) if valid_url(url)]
    strategy = clean_string(relationship.get("source_url_strategy")) or ""
    if strategy in {"sec_submissions_for_endpoints", "append_endpoint_sec_sources"}:
        for ticker in (normalize_ticker(relationship.get("source_ticker")), normalize_ticker(relationship.get("target_ticker"))):
            url = endpoint_sec_url(ticker, by_ticker, cik_by_ticker)
            if url:
                urls.append(url)
    return sorted(set(urls))


def compute_confidence(edge_type: str, urls: list[str]) -> int:
    if urls and edge_type in {"supply", "partnership", "investment"}:
        return 5
    if urls:
        return 4
    return 3


def build_edge(
    relationship: dict[str, Any],
    by_ticker: dict[str, dict[str, Any]],
    cik_by_ticker: dict[str, dict[str, Any]],
    existing_keys: set[tuple[int, int, str]],
    approval_date: str,
) -> dict[str, Any]:
    source_ticker = normalize_ticker(relationship.get("source_ticker"))
    target_ticker = normalize_ticker(relationship.get("target_ticker"))
    source = by_ticker.get(source_ticker)
    target = by_ticker.get(target_ticker)
    if not source or not target:
        raise ProductionExpansionError(f"relationship endpoint missing from production: {source_ticker}-{target_ticker}.")
    if source.get("id") == target.get("id"):
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} creates a self-edge.")
    edge_type = clean_string(relationship.get("type"))
    if edge_type not in ALLOWED_TYPES:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} has unsupported type {edge_type!r}.")
    key = (min(int(source["id"]), int(target["id"])), max(int(source["id"]), int(target["id"])), edge_type)
    if key in existing_keys:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} duplicates an existing {edge_type} edge.")
    label = clean_string(relationship.get("label"))
    if not label or label.lower() in {"relationship", f"{edge_type} relationship"}:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} needs a specific label.")
    try:
        strength = float(relationship.get("strength"))
    except (TypeError, ValueError) as exc:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} has invalid strength.") from exc
    if not 0 <= strength <= 1:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} strength must be 0..1.")
    urls = relationship_source_urls(relationship, by_ticker, cik_by_ticker)
    if not urls:
        raise ProductionExpansionError(f"relationship {source_ticker}-{target_ticker} must have source URLs.")
    invalid_urls = [url for url in urls if not is_official_relationship_url(url)]
    if invalid_urls:
        raise ProductionExpansionError(
            f"relationship {source_ticker}-{target_ticker} has non-official source URLs: {', '.join(invalid_urls)}"
        )
    return {
        "source": int(source["id"]),
        "target": int(target["id"]),
        "type": edge_type,
        "strength": round(strength, 2),
        "label": label,
        "confidence": compute_confidence(edge_type, urls),
        "provenance": clean_string(relationship.get("provenance")) or "Reviewer-approved D149 production expansion",
        "source_urls": urls,
        "verified_date": approval_date,
        "production_approval": {
            "approval_status": "reviewer_approved",
            "approval_date": approval_date,
            "automatic_promotion_allowed": False,
            "source_backed": True,
        },
    }


def validate_report(report: dict[str, Any]) -> None:
    safety = report.get("safety")
    if not isinstance(safety, dict):
        raise ProductionExpansionError("report safety must be an object.")
    if safety.get("automatic_promotion_executed") is not False:
        raise ProductionExpansionError("report cannot record automatic promotion.")
    if safety.get("browser_ingestion") is not False:
        raise ProductionExpansionError("report cannot record browser ingestion.")


def apply_expansion(args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)
    candidate_path = resolve_path(args.candidate_companies)
    cik_path = resolve_path(args.cik_mappings)
    approvals_path = resolve_path(args.approvals)

    companies = load_json(companies_path, "companies")
    connections = load_json(connections_path, "connections")
    candidate_payload = load_json(candidate_path, "candidate companies")
    cik_payload = load_json(cik_path, "CIK mappings")
    approvals = load_json(approvals_path, "approval manifest")
    if not isinstance(companies, list) or not isinstance(connections, list):
        raise ProductionExpansionError("companies and connections must be JSON arrays.")
    if not isinstance(approvals, dict):
        raise ProductionExpansionError("approval manifest must contain an object.")
    validate_approval_manifest(approvals)

    approval_date = str(approvals.get("metadata", {}).get("approved_at_utc", ""))[:10]
    if not valid_date(approval_date):
        approval_date = datetime.now(timezone.utc).date().isoformat()

    approved_tickers, batch_by_ticker = approval_batch_tickers(approvals)
    production_by_ticker = company_by_ticker(companies)
    production_tickers = set(production_by_ticker)
    production_aliases = {normalize_name(company.get("name")) for company in companies if normalize_name(company.get("name"))}
    candidate_by_ticker = {
        normalize_ticker(record.get("ticker")): record
        for record in load_records(candidate_payload, "records")
        if normalize_ticker(record.get("ticker"))
    }
    cik_by_ticker = {
        normalize_ticker(record.get("ticker")): record
        for record in load_records(cik_payload, "mappings")
        if normalize_ticker(record.get("ticker"))
    }

    already_promoted = [
        ticker
        for ticker in approved_tickers
        if ticker in production_by_ticker and is_existing_approved_company(production_by_ticker[ticker], batch_by_ticker[ticker])
    ]
    unsafe_existing = [
        ticker
        for ticker in approved_tickers
        if ticker in production_by_ticker and ticker not in already_promoted
    ]
    if unsafe_existing:
        raise ProductionExpansionError(
            "approved tickers already exist in production without matching D149 approval metadata: "
            f"{', '.join(unsafe_existing)}"
        )
    missing_candidates = [
        ticker
        for ticker in approved_tickers
        if ticker not in candidate_by_ticker and ticker not in already_promoted
    ]
    if missing_candidates:
        raise ProductionExpansionError(f"approved tickers missing from candidate file: {', '.join(missing_candidates)}")

    max_id = max((company.get("id") for company in companies if isinstance(company.get("id"), int)), default=0)
    additions: list[dict[str, Any]] = []
    next_company_id = max_id
    skipped_existing_companies: list[str] = []
    for ticker in approved_tickers:
        if ticker in already_promoted:
            skipped_existing_companies.append(ticker)
            continue
        record = candidate_by_ticker[ticker]
        validate_company_record(ticker, record, production_tickers, production_aliases)
        next_company_id += 1
        company = build_company(
            company_id=next_company_id,
            ticker=ticker,
            record=record,
            batch_id=batch_by_ticker[ticker],
            approval_date=approval_date,
        )
        additions.append(company)
        production_tickers.add(ticker)
        production_aliases.add(normalize_name(company["name"]))

    next_companies = [*companies, *additions]
    next_by_ticker = company_by_ticker(next_companies)
    existing_edge_keys = {
        (min(edge["source"], edge["target"]), max(edge["source"], edge["target"]), edge.get("type"))
        for edge in connections
        if isinstance(edge, dict) and isinstance(edge.get("source"), int) and isinstance(edge.get("target"), int)
    }
    edge_additions: list[dict[str, Any]] = []
    skipped_existing_relationships: list[dict[str, Any]] = []
    for relationship in approvals.get("approved_relationships", []):
        if not isinstance(relationship, dict):
            raise ProductionExpansionError("approved relationship rows must be objects.")
        existing_key = relationship_key_from_manifest(relationship, next_by_ticker)
        if existing_key in existing_edge_keys:
            skipped_existing_relationships.append(
                {
                    "source_ticker": normalize_ticker(relationship.get("source_ticker")),
                    "target_ticker": normalize_ticker(relationship.get("target_ticker")),
                    "type": clean_string(relationship.get("type")),
                }
            )
            continue
        edge = build_edge(relationship, next_by_ticker, cik_by_ticker, existing_edge_keys, approval_date)
        key = (min(edge["source"], edge["target"]), max(edge["source"], edge["target"]), edge.get("type"))
        existing_edge_keys.add(key)
        edge_additions.append(edge)

    next_connections = [*connections, *edge_additions]
    report = build_report(
        approvals=approvals,
        company_additions=additions,
        edge_additions=edge_additions,
        before_companies=len(companies),
        before_connections=len(connections),
        after_companies=len(next_companies),
        after_connections=len(next_connections),
        approvals_path=approvals_path,
        companies_path=companies_path,
        connections_path=connections_path,
        approval_date=approval_date,
        skipped_existing_companies=skipped_existing_companies,
        skipped_existing_relationships=skipped_existing_relationships,
    )
    validate_report(report)
    return next_companies, next_connections, report


def build_report(
    *,
    approvals: dict[str, Any],
    company_additions: list[dict[str, Any]],
    edge_additions: list[dict[str, Any]],
    before_companies: int,
    before_connections: int,
    after_companies: int,
    after_connections: int,
    approvals_path: Path,
    companies_path: Path,
    connections_path: Path,
    approval_date: str,
    skipped_existing_companies: list[str],
    skipped_existing_relationships: list[dict[str, Any]],
) -> dict[str, Any]:
    batch_counts = Counter(company["production_approval"]["batch_id"] for company in company_additions)
    relationship_counts = Counter(edge["type"] for edge in edge_additions)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "metadata": {
            "artifact_status": "production_expansion_report",
            "generated_by": "scripts/production_company_expansion.py",
            "generated_at_utc": generated_at,
            "approval_date": approval_date,
            "approval_manifest": display_path(approvals_path),
            "companies_path": display_path(companies_path),
            "connections_path": display_path(connections_path),
            "automatic_promotion_allowed": False,
            "browser_ingestion": False,
            "relationship_generation_allowed": False,
        },
        "summary": {
            "before_company_count": before_companies,
            "after_company_count": after_companies,
            "companies_added": len(company_additions),
            "before_connection_count": before_connections,
            "after_connection_count": after_connections,
            "connections_added": len(edge_additions),
            "approved_existing_company_count": len(skipped_existing_companies),
            "approved_existing_connection_count": len(skipped_existing_relationships),
            "batch_count": len(batch_counts),
            "relationship_type_counts": dict(sorted(relationship_counts.items())),
            "production_write_allowed_by_manifest": approvals.get("metadata", {}).get("production_write_allowed") is True,
            "idempotent_recheck": not company_additions and not edge_additions and (
                bool(skipped_existing_companies) or bool(skipped_existing_relationships)
            ),
        },
        "batch_results": [
            {
                "batch_id": batch_id,
                "companies_added": count,
                "tickers": sorted(company["ticker"] for company in company_additions if company["production_approval"]["batch_id"] == batch_id),
            }
            for batch_id, count in sorted(batch_counts.items())
        ],
        "company_additions": [
            {
                "id": company["id"],
                "ticker": company["ticker"],
                "name": company["name"],
                "sector": company["sector"],
                "industry": company["industry"],
                "cik": company.get("cik"),
                "source_url_count": len(company.get("source_urls", [])),
                "batch_id": company["production_approval"]["batch_id"],
            }
            for company in company_additions
        ],
        "connection_additions": [
            {
                "source": edge["source"],
                "target": edge["target"],
                "type": edge["type"],
                "label": edge["label"],
                "confidence": edge["confidence"],
                "source_url_count": len(edge.get("source_urls", [])),
            }
            for edge in edge_additions
        ],
        "skipped_existing_companies": sorted(skipped_existing_companies),
        "skipped_existing_relationships": skipped_existing_relationships,
        "safety": {
            "reviewer_approved_manifest_required": True,
            "automatic_promotion_executed": False,
            "browser_ingestion": False,
            "source_identity_required": True,
            "duplicate_ticker_check": "passed",
            "alias_check": "passed",
            "duplicate_edge_check": "passed",
            "relationship_generation": "manifest_only",
            "production_validation_required": True,
        },
    }


def print_human(report: dict[str, Any], write: bool) -> None:
    summary = report["summary"]
    print("Production company expansion")
    print("============================")
    print(f"Mode: {'write' if write else 'dry-run'}")
    print(f"Companies: {summary['before_company_count']} -> {summary['after_company_count']} (+{summary['companies_added']})")
    print(f"Connections: {summary['before_connection_count']} -> {summary['after_connection_count']} (+{summary['connections_added']})")
    print(f"Batches: {summary['batch_count']}")
    if summary.get("approved_existing_company_count") or summary.get("approved_existing_connection_count"):
        print(
            "Already applied: "
            f"{summary.get('approved_existing_company_count', 0)} companies, "
            f"{summary.get('approved_existing_connection_count', 0)} connections"
        )
    print("Automatic promotion: false")
    print("Browser ingestion: false")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        next_companies, next_connections, report = apply_expansion(args)
        if args.write:
            if not report["summary"].get("idempotent_recheck"):
                write_json(resolve_path(args.companies), next_companies)
                write_json(resolve_path(args.connections), next_connections)
                write_json(resolve_path(args.report), report)
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True))
        else:
            print_human(report, args.write)
    except ProductionExpansionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
