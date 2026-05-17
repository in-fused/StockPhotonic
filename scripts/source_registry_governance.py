#!/usr/bin/env python3
"""Refresh StockPhotonic source-registry governance artifacts.

The source registry is reviewer-owned infrastructure. This script is
deliberately read-only with respect to production graph files: it can write
registry and review-report artifacts under data/source_registry, but it never
creates production companies, connections, or promotion decisions.
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
from urllib.parse import urlparse


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"
DEFAULT_CANDIDATES_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_OFFICIAL_UNIVERSE_PATH = ROOT / "data" / "candidates" / "official_ticker_universe.json"
DEFAULT_CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
DEFAULT_OPENALEX_CACHE_PATH = ROOT / "data" / "cache" / "openalex" / "entity_resolution_cache.json"
DEFAULT_OPENALEX_ECOSYSTEM_PATH = ROOT / "data" / "candidates" / "openalex_ecosystem_candidates.json"
DEFAULT_OPENALEX_TOPIC_PATH = ROOT / "data" / "candidates" / "openalex_topic_overlap.json"
DEFAULT_OPENALEX_INSTITUTION_PATH = ROOT / "data" / "candidates" / "openalex_institution_overlap.json"
DEFAULT_OPENALEX_CLUSTER_PATH = ROOT / "data" / "candidates" / "openalex_cluster_hints.json"
DEFAULT_REGISTRY_DIR = ROOT / "data" / "source_registry"
DEFAULT_OUTPUT_PATH = DEFAULT_REGISTRY_DIR / "source_governance_report.json"

OFFICIAL_COMPANY_SOURCES_PATH = DEFAULT_REGISTRY_DIR / "official_company_sources.json"
TRUSTED_SOURCE_HOSTS_PATH = DEFAULT_REGISTRY_DIR / "trusted_source_hosts.json"
CORRIDOR_SOURCE_REGISTRY_PATH = DEFAULT_REGISTRY_DIR / "corridor_source_registry.json"

PRODUCTION_DATA_PATHS = (
    DEFAULT_COMPANIES_PATH,
    DEFAULT_CONNECTIONS_PATH,
)

URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
COMPANY_SUFFIX_PATTERN = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|plc|ltd|limited|lp|llc|holdings|holding|group|sa|ag|nv|n\.v)\b\.?",
    re.IGNORECASE,
)

SOURCE_CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("official_sec_filing", ("sec.gov",)),
    (
        "official_company_ir",
        (
            "investor",
            "investors",
            "/ir/",
            "ir.",
            "sec-filings",
            "financial-information",
            "annual-report",
            "quarterly-results",
        ),
    ),
    (
        "official_company_newsroom",
        (
            "newsroom",
            "news-releases",
            "press-releases",
            "press-room",
            "media/press",
            "/news/",
        ),
    ),
    (
        "official_partner_customer_page",
        (
            "partner",
            "partners",
            "customer",
            "customers",
            "case-study",
            "case-studies",
            "collaboration",
            "alliance",
            "ecosystem",
        ),
    ),
    (
        "trusted_industry_report",
        (
            "annualreports.com",
            "spglobal.com",
            "nasdaq.com",
            "morningstar.com",
            "marketscreener.com",
        ),
    ),
)

SOURCE_CATEGORY_META: dict[str, dict[str, Any]] = {
    "official_sec_filing": {
        "label": "Official SEC filing root",
        "source_tier": 1,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "classification_only",
    },
    "official_company_ir": {
        "label": "Official company IR source",
        "source_tier": 1,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "review_priority_only",
    },
    "official_company_newsroom": {
        "label": "Official company newsroom",
        "source_tier": 1,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "review_priority_only",
    },
    "official_partner_customer_page": {
        "label": "Official partner/customer page",
        "source_tier": 2,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "review_priority_only",
    },
    "trusted_industry_report": {
        "label": "Trusted industry/report source",
        "source_tier": 2,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "context_and_review_priority",
    },
    "observed_source_host": {
        "label": "Observed source host",
        "source_tier": 3,
        "relationship_authority": False,
        "promotion_authority": False,
        "trust_effect": "inventory_only",
    },
}

CORRIDOR_DEFINITIONS: dict[str, dict[str, Any]] = {
    "ai_compute_foundry_cloud": {
        "label": "AI compute/foundry/cloud",
        "maintenance_cadence_days": 120,
        "keywords": (
            "ai",
            "gpu",
            "accelerator",
            "hbm",
            "foundry",
            "cloud",
            "data center",
            "semiconductor",
            "custom silicon",
            "memory",
            "lithography",
        ),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom", "official_partner_customer_page"),
    },
    "payment_networks_banks": {
        "label": "Payment networks/banks",
        "maintenance_cadence_days": 180,
        "keywords": ("payment", "payments", "card", "issuer", "bank", "banking", "credit", "network", "merchant"),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom"),
    },
    "pbm_pharma_insurance": {
        "label": "PBM/pharma/insurance",
        "maintenance_cadence_days": 180,
        "keywords": (
            "pbm",
            "pharma",
            "pharmaceutical",
            "drug",
            "formulary",
            "reimbursement",
            "managed care",
            "insurance",
            "biotech",
            "life sciences",
        ),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom"),
    },
    "aerospace_oem": {
        "label": "Aerospace/OEM",
        "maintenance_cadence_days": 180,
        "keywords": ("aerospace", "aircraft", "engine", "avionics", "defense", "boeing", "oem", "propulsion"),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom", "official_partner_customer_page"),
    },
    "energy_infrastructure": {
        "label": "Energy infrastructure",
        "maintenance_cadence_days": 180,
        "keywords": ("energy", "oil", "gas", "power", "grid", "oilfield", "pipeline", "utility", "data center power"),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom"),
    },
    "enterprise_saas_cloud": {
        "label": "Enterprise SaaS/cloud",
        "maintenance_cadence_days": 180,
        "keywords": (
            "saas",
            "workflow",
            "crm",
            "productivity",
            "data platform",
            "cloud security",
            "enterprise software",
            "cloud",
        ),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom", "official_partner_customer_page"),
    },
    "retail_consumer": {
        "label": "Retail/consumer",
        "maintenance_cadence_days": 240,
        "keywords": (
            "retail",
            "consumer",
            "e-commerce",
            "ecommerce",
            "warehouse",
            "grocery",
            "restaurant",
            "beverage",
            "distribution",
        ),
        "source_categories": ("official_sec_filing", "official_company_ir", "official_company_newsroom", "official_partner_customer_page"),
    },
}


class SourceGovernanceError(Exception):
    """Raised for clear source-governance failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate reviewer-owned source registry and governance reports. "
            "The command performs no network calls and never writes production "
            "companies or connections."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATES_PATH))
    parser.add_argument("--official-universe", default=str(DEFAULT_OFFICIAL_UNIVERSE_PATH))
    parser.add_argument("--cik-mappings", default=str(DEFAULT_CIK_MAPPINGS_PATH))
    parser.add_argument("--openalex-cache", default=str(DEFAULT_OPENALEX_CACHE_PATH))
    parser.add_argument("--openalex-ecosystem", default=str(DEFAULT_OPENALEX_ECOSYSTEM_PATH))
    parser.add_argument("--openalex-topic", default=str(DEFAULT_OPENALEX_TOPIC_PATH))
    parser.add_argument("--openalex-institution", default=str(DEFAULT_OPENALEX_INSTITUTION_PATH))
    parser.add_argument("--openalex-cluster", default=str(DEFAULT_OPENALEX_CLUSTER_PATH))
    parser.add_argument("--registry-dir", default=str(DEFAULT_REGISTRY_DIR))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--write", action="store_true", help="Write the review-only governance report.")
    parser.add_argument(
        "--sync-registry",
        action="store_true",
        help="Write reviewer-owned registry JSON files under data/source_registry.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite registry/report artifacts when writing.")
    parser.add_argument("--json", action="store_true", help="Print report JSON to stdout.")
    args = parser.parse_args(argv)
    if args.force and not (args.write or args.sync_registry):
        parser.error("--force can only be used with --write or --sync-registry.")
    if args.sync_registry and not args.write:
        parser.error("--sync-registry requires --write.")
    return args


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def load_json(path: Path, label: str, *, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise SourceGovernanceError(f"{label} file is missing: {display_path(path)}")
        return None
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise SourceGovernanceError(f"could not read {label} file {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SourceGovernanceError(f"could not parse {label} file {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise SourceGovernanceError(f"{display_path(path)} already exists; pass --force.")
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
            raise SourceGovernanceError(
                f"could not read production guard file {display_path(path)}: {exc}"
            ) from exc
    return hashes


def assert_production_unchanged(initial_hashes: dict[Path, str]) -> None:
    current = production_hashes()
    changed = [
        display_path(path)
        for path, initial_hash in initial_hashes.items()
        if current.get(path) != initial_hash
    ]
    if changed:
        raise SourceGovernanceError(
            "production data changed during source governance refresh: "
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


def url_host(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    return parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""


def url_search_text(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return str(url or "").lower()
    return f"{parsed.hostname or ''}{parsed.path or ''}".lower()


def source_urls(record: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    raw_urls = record.get("source_urls")
    if isinstance(raw_urls, list):
        urls.extend(str(url).strip() for url in raw_urls if isinstance(url, str))
    candidate = record.get("candidate")
    if isinstance(candidate, dict):
        urls.extend(source_urls(candidate))
    for key in ("archive_url", "source_url", "filing_url", "sec_url", "url"):
        url = clean_string(record.get(key))
        if url:
            urls.append(url)
    return sorted({url for url in urls if valid_url(url)})


def classify_source_url(url: str) -> str:
    host = url_host(url)
    text = url_search_text(url)
    if host == "sec.gov" or host.endswith(".sec.gov"):
        return "official_sec_filing"
    for category, patterns in SOURCE_CATEGORY_RULES[1:]:
        if any(pattern in host or pattern in text for pattern in patterns):
            return category
    return "observed_source_host"


def parse_date(value: Any) -> datetime | None:
    text = clean_string(value)
    if not text or not DATE_PATTERN.match(text):
        return None
    try:
        return datetime.fromisoformat(f"{text}T00:00:00+00:00")
    except ValueError:
        return None


def source_age_state(value: Any, now: datetime) -> dict[str, Any]:
    parsed = parse_date(value)
    if parsed is None:
        return {
            "key": "no_verified_date",
            "age_days": None,
            "review_recommended": True,
        }
    age_days = max(0, (now - parsed).days)
    if age_days > 365:
        key = "stale_review_recommended"
    elif age_days > 180:
        key = "aging_evidence"
    else:
        key = "verified_recently"
    return {
        "key": key,
        "age_days": age_days,
        "review_recommended": key == "stale_review_recommended",
    }


def load_array_payload(path: Path, label: str, key: str | None = None) -> list[dict[str, Any]]:
    payload = load_json(path, label, required=False)
    if payload is None:
        return []
    if key and isinstance(payload, dict) and isinstance(payload.get(key), list):
        return [item for item in payload[key] if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("records"), list):
        return [item for item in payload["records"] if isinstance(item, dict)]
    return []


def load_companies(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "companies")
    if not isinstance(payload, list):
        raise SourceGovernanceError("companies file must contain a JSON array.")
    return [company for company in payload if isinstance(company, dict)]


def load_connections(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "connections")
    if not isinstance(payload, list):
        raise SourceGovernanceError("connections file must contain a JSON array.")
    return [connection for connection in payload if isinstance(connection, dict)]


def company_index(companies: list[dict[str, Any]]) -> tuple[dict[int, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[int, dict[str, Any]] = {}
    by_ticker: dict[str, dict[str, Any]] = {}
    for company in companies:
        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        if isinstance(company_id, int) and not isinstance(company_id, bool):
            by_id[company_id] = company
        if ticker:
            by_ticker[ticker] = company
    return by_id, by_ticker


def normalize_name(value: Any) -> str:
    text = clean_string(value) or ""
    text = COMPANY_SUFFIX_PATTERN.sub("", text)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return " ".join(text.split())


def edge_text(edge: dict[str, Any], source: dict[str, Any] | None, target: dict[str, Any] | None) -> str:
    return " ".join(
        str(value or "").lower()
        for value in (
            edge.get("type"),
            edge.get("relationship_type"),
            edge.get("label"),
            edge.get("provenance"),
            source.get("sector") if source else "",
            target.get("sector") if target else "",
            source.get("industry") if source else "",
            target.get("industry") if target else "",
            source.get("ticker") if source else "",
            target.get("ticker") if target else "",
        )
    )


def infer_corridor_key(edge: dict[str, Any], source: dict[str, Any] | None, target: dict[str, Any] | None) -> str | None:
    text = edge_text(edge, source, target)
    matches: list[tuple[str, int]] = []
    for key, definition in CORRIDOR_DEFINITIONS.items():
        count = sum(1 for keyword in definition["keywords"] if keyword in text)
        if count:
            matches.append((key, count))
    if not matches:
        return None
    matches.sort(key=lambda item: (-item[1], item[0]))
    return matches[0][0]


def build_corridor_registry(generated_at: datetime) -> dict[str, Any]:
    return {
        "metadata": {
            "artifact_status": "review_owned_registry",
            "schema_version": 1,
            "generated_by": "scripts/source_registry_governance.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "auto_promotion_allowed": False,
            "relationship_authority": False,
            "notes": [
                "Corridor definitions organize source maintenance only.",
                "Corridor membership is derived from current graph metadata during report generation.",
                "This file does not create or promote relationships.",
            ],
        },
        "corridors": [
            {
                "corridor_key": key,
                "label": definition["label"],
                "maintenance_cadence_days": definition["maintenance_cadence_days"],
                "source_categories": list(definition["source_categories"]),
                "review_keywords": list(definition["keywords"]),
                "manual_promotion_allowed": False,
                "review_only": True,
            }
            for key, definition in CORRIDOR_DEFINITIONS.items()
        ],
    }


def build_official_company_sources(
    *,
    companies: list[dict[str, Any]],
    cik_mappings: list[dict[str, Any]],
    generated_at: datetime,
) -> dict[str, Any]:
    cik_by_ticker = {
        ticker: mapping
        for mapping in cik_mappings
        if (ticker := normalize_ticker(mapping.get("ticker")))
    }
    records: list[dict[str, Any]] = []
    for company in sorted(companies, key=lambda item: normalize_ticker(item.get("ticker")) or ""):
        ticker = normalize_ticker(company.get("ticker"))
        if not ticker:
            continue
        mapping = cik_by_ticker.get(ticker)
        sec_url = clean_string(mapping.get("source_url")) if isinstance(mapping, dict) else None
        sec_root = None
        if sec_url and valid_url(sec_url):
            sec_root = {
                "category": "official_sec_filing",
                "url": sec_url,
                "cik": clean_string(mapping.get("cik")),
                "source_type": clean_string(mapping.get("source_type")) or "sec_filing",
                "source_tier": mapping.get("source_tier", 1),
                "review_status": clean_string(mapping.get("review_status")) or "pending",
                "relationship_authority": False,
                "promotion_authority": False,
            }
        missing = []
        if not sec_root:
            missing.append("official_sec_filing_root")
        missing.extend(
            [
                "official_company_ir_url",
                "official_newsroom_root",
                "trusted_partner_customer_root",
            ]
        )
        records.append(
            {
                "ticker": ticker,
                "name": clean_string(company.get("name")),
                "sector": clean_string(company.get("sector")),
                "industry": clean_string(company.get("industry")),
                "registry_status": "registered_sec_root" if sec_root else "metadata_shell_missing_official_root",
                "source_roots": [sec_root] if sec_root else [],
                "official_company_ir_urls": [],
                "official_newsroom_roots": [],
                "trusted_partner_customer_roots": [],
                "missing_registry_fields": missing,
                "manual_review_required": True,
                "auto_trust_escalation_allowed": False,
                "production_write_allowed": False,
                "review_only": True,
            }
        )
    return {
        "metadata": {
            "artifact_status": "review_owned_registry",
            "schema_version": 1,
            "generated_by": "scripts/source_registry_governance.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "auto_promotion_allowed": False,
            "auto_trust_escalation_allowed": False,
            "notes": [
                "Only observed SEC CIK mapping source URLs are registered automatically.",
                "Company IR/newsroom/partner roots remain empty until a reviewer adds real URLs.",
                "A registered official source root improves review visibility only.",
            ],
        },
        "records": records,
    }


def build_trusted_source_hosts(
    *,
    connections: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    official_universe: list[dict[str, Any]],
    cik_mappings: list[dict[str, Any]],
    generated_at: datetime,
) -> dict[str, Any]:
    url_records: list[tuple[str, str]] = []
    for source_name, rows in (
        ("production_connection", connections),
        ("candidate_relationship", candidates),
        ("candidate_universe", official_universe),
        ("cik_mapping", cik_mappings),
    ):
        for row in rows:
            for url in source_urls(row):
                url_records.append((url, source_name))

    host_map: dict[str, dict[str, Any]] = {}
    for url, source_name in url_records:
        host = url_host(url)
        if not host:
            continue
        category = classify_source_url(url)
        entry = host_map.setdefault(
            host,
            {
                "host": host,
                "category": category,
                "category_label": SOURCE_CATEGORY_META[category]["label"],
                "source_tier": SOURCE_CATEGORY_META[category]["source_tier"],
                "observed_url_count": 0,
                "observed_sources": Counter(),
                "sample_urls": [],
                "trust_effect": SOURCE_CATEGORY_META[category]["trust_effect"],
                "relationship_authority": False,
                "promotion_authority": False,
                "auto_trust_escalation_allowed": False,
                "review_status": "registered_observed_host",
                "review_only": True,
            },
        )
        if SOURCE_CATEGORY_META[category]["source_tier"] < int(entry["source_tier"]):
            entry["category"] = category
            entry["category_label"] = SOURCE_CATEGORY_META[category]["label"]
            entry["source_tier"] = SOURCE_CATEGORY_META[category]["source_tier"]
            entry["trust_effect"] = SOURCE_CATEGORY_META[category]["trust_effect"]
        entry["observed_url_count"] += 1
        entry["observed_sources"][source_name] += 1
        if len(entry["sample_urls"]) < 5 and url not in entry["sample_urls"]:
            entry["sample_urls"].append(url)

    if "sec.gov" not in host_map:
        category = "official_sec_filing"
        host_map["sec.gov"] = {
            "host": "sec.gov",
            "category": category,
            "category_label": SOURCE_CATEGORY_META[category]["label"],
            "source_tier": 1,
            "observed_url_count": 0,
            "observed_sources": Counter(),
            "sample_urls": ["https://www.sec.gov/"],
            "trust_effect": "classification_only",
            "relationship_authority": False,
            "promotion_authority": False,
            "auto_trust_escalation_allowed": False,
            "review_status": "seeded_official_regulator",
            "review_only": True,
        }

    records = []
    for entry in sorted(host_map.values(), key=lambda item: (int(item["source_tier"]), item["host"])):
        observed_sources = entry.get("observed_sources")
        if isinstance(observed_sources, Counter):
            entry = {
                **entry,
                "observed_sources": dict(sorted(observed_sources.items())),
            }
        records.append(entry)

    return {
        "metadata": {
            "artifact_status": "review_owned_registry",
            "schema_version": 1,
            "generated_by": "scripts/source_registry_governance.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "auto_promotion_allowed": False,
            "auto_trust_escalation_allowed": False,
            "notes": [
                "Hosts are inventory and classification aids.",
                "Host registration never proves a relationship by itself.",
                "Reviewers may tighten or remove hosts before promotion workflows use them.",
            ],
        },
        "source_categories": SOURCE_CATEGORY_META,
        "records": records,
    }


def source_quality_rows(
    connections: list[dict[str, Any]],
    company_by_id: dict[int, dict[str, Any]],
    now: datetime,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    category_counts: Counter[str] = Counter()
    age_counts: Counter[str] = Counter()
    duplicate_urls: Counter[str] = Counter()
    invalid_urls: list[dict[str, Any]] = []
    stale_queue: list[dict[str, Any]] = []
    edge_rows: list[dict[str, Any]] = []

    for index, edge in enumerate(connections):
        urls = source_urls(edge)
        raw_urls = edge.get("source_urls") if isinstance(edge.get("source_urls"), list) else []
        for raw_url in raw_urls:
            if not valid_url(raw_url):
                invalid_urls.append({"connection_index": index, "url": str(raw_url), "review_only": True})
        for url in urls:
            duplicate_urls[url] += 1
            category_counts[classify_source_url(url)] += 1
        if not urls:
            category_counts["missing_source_url"] += 1

        source = company_by_id.get(edge.get("source"))
        target = company_by_id.get(edge.get("target"))
        age = source_age_state(edge.get("verified_date"), now)
        age_counts[age["key"]] += 1
        corridor_key = infer_corridor_key(edge, source, target)
        row = {
            "connection_index": index,
            "source_ticker": clean_string(source.get("ticker")) if source else None,
            "target_ticker": clean_string(target.get("ticker")) if target else None,
            "relationship_type": clean_string(edge.get("type")) or "unknown",
            "label": clean_string(edge.get("label")),
            "verified_date": clean_string(edge.get("verified_date")),
            "age_state": age["key"],
            "age_days": age["age_days"],
            "source_url_count": len(urls),
            "source_categories": sorted({classify_source_url(url) for url in urls}),
            "corridor_key": corridor_key,
            "review_only": True,
        }
        edge_rows.append(row)
        if age["key"] in {"stale_review_recommended", "no_verified_date"}:
            stale_queue.append(
                {
                    **row,
                    "reason": "Source date is stale or missing; reviewer should refresh evidence before expansion.",
                    "manual_promotion_allowed": False,
                }
            )

    duplicate_rows = [
        {
            "url": url,
            "usage_count": count,
            "duplicate_reduction_allowed": True,
            "production_write_allowed": False,
            "review_only": True,
        }
        for url, count in duplicate_urls.items()
        if count > 1
    ]
    duplicate_rows.sort(key=lambda row: (-int(row["usage_count"]), row["url"]))
    stale_queue.sort(
        key=lambda row: (
            row["age_state"] != "stale_review_recommended",
            -(int(row["age_days"]) if row["age_days"] is not None else 9999),
            str(row["source_ticker"] or ""),
        )
    )
    summary = {
        "source_category_counts": dict(sorted(category_counts.items())),
        "source_age_counts": dict(sorted(age_counts.items())),
        "invalid_source_url_count": len(invalid_urls),
        "duplicate_source_url_count": len(duplicate_rows),
        "stale_or_missing_date_count": len(stale_queue),
    }
    return summary, stale_queue, duplicate_rows, invalid_urls


def corridor_maintenance_rows(
    connections: list[dict[str, Any]],
    company_by_id: dict[int, dict[str, Any]],
    now: datetime,
) -> list[dict[str, Any]]:
    lane_map: dict[str, dict[str, Any]] = {
        key: {
            "corridor_key": key,
            "label": definition["label"],
            "edge_count": 0,
            "source_backed_count": 0,
            "stale_edge_count": 0,
            "aging_edge_count": 0,
            "missing_source_count": 0,
            "strong_edge_count": 0,
            "sample_edges": [],
            "maintenance_cadence_days": definition["maintenance_cadence_days"],
            "review_only": True,
            "manual_promotion_allowed": False,
        }
        for key, definition in CORRIDOR_DEFINITIONS.items()
    }
    for edge in connections:
        source = company_by_id.get(edge.get("source"))
        target = company_by_id.get(edge.get("target"))
        corridor_key = infer_corridor_key(edge, source, target)
        if not corridor_key:
            continue
        lane = lane_map[corridor_key]
        urls = source_urls(edge)
        age = source_age_state(edge.get("verified_date"), now)
        lane["edge_count"] += 1
        if urls:
            lane["source_backed_count"] += 1
        else:
            lane["missing_source_count"] += 1
        if age["key"] == "stale_review_recommended":
            lane["stale_edge_count"] += 1
        elif age["key"] == "aging_evidence":
            lane["aging_edge_count"] += 1
        if float(edge.get("strength") or 0) >= 0.75:
            lane["strong_edge_count"] += 1
        samples = lane["sample_edges"]
        if len(samples) < 6:
            samples.append(
                {
                    "source_ticker": clean_string(source.get("ticker")) if source else None,
                    "target_ticker": clean_string(target.get("ticker")) if target else None,
                    "relationship_type": clean_string(edge.get("type")) or "unknown",
                    "source_backed": bool(urls),
                    "age_state": age["key"],
                }
            )
    rows = []
    for lane in lane_map.values():
        edge_count = int(lane["edge_count"])
        if not edge_count:
            lane["density_score"] = 0
            lane["coverage_ratio"] = 0
            lane["maintenance_priority"] = "planning"
            lane["reason"] = "No current production edges matched this corridor; use for future reviewer planning only."
        else:
            source_backed = int(lane["source_backed_count"])
            stale = int(lane["stale_edge_count"])
            missing = int(lane["missing_source_count"])
            lane["coverage_ratio"] = round(source_backed / edge_count, 4)
            lane["density_score"] = round(edge_count + int(lane["strong_edge_count"]) * 0.6 + source_backed * 0.35, 2)
            if missing or stale:
                lane["maintenance_priority"] = "high" if missing + stale >= 3 else "medium"
                lane["reason"] = "Corridor has stale or missing-source coverage that should be reviewed before expansion."
            else:
                lane["maintenance_priority"] = "growth"
                lane["reason"] = "Corridor is source-backed enough for adjacent reviewer-led scouting."
        rows.append(lane)
    return sorted(
        rows,
        key=lambda row: (
            {"high": 3, "medium": 2, "growth": 1, "planning": 0}.get(str(row["maintenance_priority"]), 0),
            float(row["density_score"]),
            str(row["label"]),
        ),
        reverse=True,
    )


def candidate_universe_readiness(
    official_universe: list[dict[str, Any]],
    cik_mappings: list[dict[str, Any]],
    production_by_ticker: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    cik_by_ticker = {normalize_ticker(row.get("ticker")): row for row in cik_mappings if normalize_ticker(row.get("ticker"))}
    production_tickers = set(production_by_ticker)
    candidate_tickers = [normalize_ticker(row.get("ticker")) or "" for row in official_universe]
    duplicate_with_production = sorted({ticker for ticker in candidate_tickers if ticker and ticker in production_tickers})
    duplicate_in_candidate_file = sorted(
        ticker for ticker, count in Counter(ticker for ticker in candidate_tickers if ticker).items() if count > 1
    )

    readiness_rows: list[dict[str, Any]] = []
    missing_metadata_rows: list[dict[str, Any]] = []
    required_fields = ("ticker", "name", "exchange", "asset_type", "source_type", "source_tier", "source_url", "capture_date", "review_status")
    for row in official_universe:
        ticker = normalize_ticker(row.get("ticker"))
        if not ticker:
            continue
        missing = [field for field in required_fields if clean_string(row.get(field)) is None and field != "source_tier"]
        if row.get("source_tier") is None:
            missing.append("source_tier")
        source_ok = valid_url(row.get("source_url"))
        cik = cik_by_ticker.get(ticker)
        cik_ok = isinstance(cik, dict) and valid_url(cik.get("source_url"))
        blocker_keys = []
        if ticker in production_tickers:
            blocker_keys.append("already_in_production_universe")
        if missing:
            blocker_keys.append("missing_candidate_metadata")
        if not source_ok:
            blocker_keys.append("invalid_listing_source_url")
        if not cik_ok:
            blocker_keys.append("missing_or_invalid_cik_mapping")
        if clean_string(row.get("review_status")) not in {"pending", "reviewed", "approved"}:
            blocker_keys.append("unsupported_review_status")
        score = 0
        score += 35 if source_ok else 0
        score += 25 if cik_ok else 0
        score += 15 if not missing else max(0, 15 - len(missing) * 4)
        score += 15 if ticker not in production_tickers else 0
        score += 10 if clean_string(row.get("review_status")) in {"pending", "reviewed", "approved"} else 0
        readiness = "blocked_existing_production" if ticker in production_tickers else "ready_for_review" if score >= 75 and not blocker_keys else "needs_metadata_review"
        readiness_rows.append(
            {
                "ticker": ticker,
                "name": clean_string(row.get("name")),
                "exchange": clean_string(row.get("exchange")),
                "source_url": clean_string(row.get("source_url")),
                "has_valid_listing_source": source_ok,
                "has_cik_mapping": cik_ok,
                "source_readiness_score": score,
                "readiness_state": readiness,
                "blockers": blocker_keys,
                "ecosystem_fit_state": "requires_reviewer_sector_and_corridor_assignment",
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )
        if missing:
            missing_metadata_rows.append({"ticker": ticker, "missing_fields": missing, "review_only": True})

    alias_conflicts = alias_conflict_rows(official_universe, production_by_ticker)
    score_counts = Counter(row["readiness_state"] for row in readiness_rows)
    readiness_rows.sort(key=lambda row: (row["source_readiness_score"], row["ticker"]), reverse=True)
    return {
        "candidate_universe_count": len(official_universe),
        "cik_mapping_count": len(cik_mappings),
        "duplicate_ticker_prevention": {
            "duplicate_with_production_count": len(duplicate_with_production),
            "duplicate_with_production_tickers": duplicate_with_production[:80],
            "duplicate_in_candidate_file_count": len(duplicate_in_candidate_file),
            "duplicate_in_candidate_file_tickers": duplicate_in_candidate_file[:80],
            "production_write_allowed": False,
            "review_only": True,
        },
        "alias_conflict_detection": {
            "alias_conflict_count": len(alias_conflicts),
            "sample_conflicts": alias_conflicts[:30],
            "review_only": True,
        },
        "missing_metadata_detection": {
            "missing_metadata_count": len(missing_metadata_rows),
            "sample_rows": missing_metadata_rows[:30],
            "review_only": True,
        },
        "source_readiness_scoring": {
            "state_counts": dict(sorted(score_counts.items())),
            "ready_for_review_count": score_counts.get("ready_for_review", 0),
            "blocked_existing_production_count": score_counts.get("blocked_existing_production", 0),
            "review_only": True,
        },
        "readiness_rows": readiness_rows[:120],
        "safety": {
            "review_only": True,
            "production_writes": 0,
            "auto_promotion_allowed": False,
        },
    }


def alias_conflict_rows(
    official_universe: list[dict[str, Any]],
    production_by_ticker: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    production_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ticker, company in production_by_ticker.items():
        key = normalize_name(company.get("name"))
        if key:
            production_names[key].append({"ticker": ticker, "name": clean_string(company.get("name"))})

    conflicts: list[dict[str, Any]] = []
    for row in official_universe:
        ticker = normalize_ticker(row.get("ticker"))
        key = normalize_name(row.get("name"))
        if not ticker or not key:
            continue
        matches = [
            match for match in production_names.get(key, [])
            if match.get("ticker") != ticker
        ]
        if matches:
            conflicts.append(
                {
                    "candidate_ticker": ticker,
                    "candidate_name": clean_string(row.get("name")),
                    "production_matches": matches,
                    "conflict_type": "same_normalized_name_different_ticker",
                    "review_only": True,
                }
            )
    return sorted(conflicts, key=lambda item: item["candidate_ticker"])


def strategic_hub_profiles(
    connections: list[dict[str, Any]],
    company_by_id: dict[int, dict[str, Any]],
    now: datetime,
) -> list[dict[str, Any]]:
    adjacency: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for edge in connections:
        source_id = edge.get("source")
        target_id = edge.get("target")
        if not isinstance(source_id, int) or not isinstance(target_id, int):
            continue
        adjacency[source_id].append({"edge": edge, "other_id": target_id})
        adjacency[target_id].append({"edge": edge, "other_id": source_id})

    rows: list[dict[str, Any]] = []
    for company_id, items in adjacency.items():
        company = company_by_id.get(company_id)
        if not company:
            continue
        corridors = Counter()
        sectors = set()
        source_backed = 0
        stale = 0
        repeated_counterparties = Counter()
        for item in items:
            edge = item["edge"]
            other = company_by_id.get(item["other_id"])
            sectors.add(clean_string(other.get("sector")) if other else None)
            corridor_key = infer_corridor_key(edge, company, other)
            if corridor_key:
                corridors[corridor_key] += 1
            if source_urls(edge):
                source_backed += 1
            if source_age_state(edge.get("verified_date"), now)["key"] == "stale_review_recommended":
                stale += 1
            if other:
                repeated_counterparties[clean_string(other.get("ticker")) or str(item["other_id"])] += 1
        sectors.discard(None)
        degree = len(items)
        corridor_count = len(corridors)
        source_ratio = source_backed / degree if degree else 0
        repeated_exposure_score = sum(count for count in repeated_counterparties.values() if count > 1)
        bridge_score = corridor_count * 1.8 + len(sectors) * 1.2
        score = round(degree * 1.25 + corridor_count * 2.4 + source_ratio * 5 + repeated_exposure_score + bridge_score - stale * 0.4, 2)
        rows.append(
            {
                "ticker": clean_string(company.get("ticker")),
                "name": clean_string(company.get("name")),
                "degree": degree,
                "multi_corridor_count": corridor_count,
                "corridor_exposures": dict(sorted(corridors.items())),
                "repeated_exposure_score": repeated_exposure_score,
                "source_backed_edge_count": source_backed,
                "source_backed_ratio": round(source_ratio, 4),
                "ecosystem_breadth_score": round(bridge_score, 2),
                "bridge_significance_score": round(bridge_score + corridor_count + source_ratio * 2, 2),
                "strategic_hub_score": score,
                "source_backed_hub_quality": "strong" if source_ratio >= 0.75 else "mixed" if source_ratio >= 0.45 else "needs_source_review",
                "review_only": True,
            }
        )
    return sorted(rows, key=lambda row: (-float(row["strategic_hub_score"]), str(row["ticker"])))[:30]


def large_graph_scaling_readiness(
    companies: list[dict[str, Any]],
    connections: list[dict[str, Any]],
    hub_profiles: list[dict[str, Any]],
    corridor_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    node_count = len(companies)
    edge_count = len(connections)
    density = edge_count / max(1, node_count)
    if edge_count > 500 or node_count > 220 or density > 3.2:
        bucket = "very_dense_large_graph"
    elif edge_count > 220 or node_count > 110 or density > 2.2:
        bucket = "dense_growth_graph"
    elif edge_count > 115 or node_count > 70 or density > 1.7:
        bucket = "expansion_ready_graph"
    else:
        bucket = "current_core_graph"
    label_limit = 22 if bucket == "very_dense_large_graph" else 28 if bucket == "dense_growth_graph" else 42 if bucket == "expansion_ready_graph" else 54
    hub_tickers = [row.get("ticker") for row in hub_profiles[:20] if row.get("ticker")]
    corridor_keys = [row.get("corridor_key") for row in corridor_rows if int(row.get("edge_count") or 0) > 0]
    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "edge_to_node_density": round(density, 4),
        "density_bucket": bucket,
        "route_cache_precompute_keys": ["strongest", "sec_backed", "source_backed", *corridor_keys[:10]],
        "overlay_cache_keys": corridor_keys[:10],
        "hub_cache_size": len(hub_tickers),
        "hub_cache_tickers": hub_tickers,
        "label_priority_seed_count": len(hub_tickers),
        "label_priority_seed_tickers": hub_tickers[:16],
        "recommended_label_limit": label_limit,
        "render_heuristics": {
            "weak_edge_threshold_lift": bucket in {"dense_growth_graph", "very_dense_large_graph"},
            "prefer_route_and_overlay_labels": True,
            "throttle_unfocused_labels": True,
            "preserve_selected_hover_route_labels": True,
            "mobile_compact_legend_required": edge_count > 150 or node_count > 80,
        },
        "review_only": True,
    }


def ecosystem_expansion_planning(
    corridor_rows: list[dict[str, Any]],
    hub_profiles: list[dict[str, Any]],
) -> dict[str, Any]:
    weak_corridors = [
        row for row in corridor_rows
        if int(row.get("edge_count") or 0) == 0 or row.get("maintenance_priority") in {"high", "planning"}
    ]
    growth_corridors = [
        row for row in corridor_rows
        if row.get("maintenance_priority") == "growth"
    ]
    isolated_hub_opportunities = [
        {
            "ticker": row.get("ticker"),
            "reason": "High hub score with low multi-corridor breadth; reviewer may scout adjacent source-backed context.",
            "strategic_hub_score": row.get("strategic_hub_score"),
            "multi_corridor_count": row.get("multi_corridor_count"),
            "review_only": True,
        }
        for row in hub_profiles
        if int(row.get("multi_corridor_count") or 0) <= 1 and float(row.get("strategic_hub_score") or 0) >= 8
    ][:8]
    return {
        "missing_corridor_companies": [
            {
                "corridor_key": row.get("corridor_key"),
                "label": row.get("label"),
                "reason": "Corridor has no current production edges; reviewer-owned universe expansion metadata is required before company staging.",
                "review_only": True,
            }
            for row in weak_corridors
            if int(row.get("edge_count") or 0) == 0
        ],
        "weak_ecosystem_density": [
            {
                "corridor_key": row.get("corridor_key"),
                "label": row.get("label"),
                "edge_count": row.get("edge_count"),
                "coverage_ratio": row.get("coverage_ratio"),
                "maintenance_priority": row.get("maintenance_priority"),
                "review_only": True,
            }
            for row in weak_corridors[:10]
        ],
        "isolated_hub_opportunities": isolated_hub_opportunities,
        "adjacency_opportunities": [
            {
                "corridor_key": row.get("corridor_key"),
                "label": row.get("label"),
                "source_backed_count": row.get("source_backed_count"),
                "density_score": row.get("density_score"),
                "reason": "Dense source-backed corridor can guide reviewer-led adjacent sourcing; it does not imply missing relationships.",
                "review_only": True,
            }
            for row in growth_corridors[:10]
        ],
        "underrepresented_sectors": [
            {
                "corridor_key": row.get("corridor_key"),
                "label": row.get("label"),
                "reason": row.get("reason"),
                "review_only": True,
            }
            for row in weak_corridors[:8]
        ],
        "missing_supplier_chains": [
            {
                "corridor_key": row.get("corridor_key"),
                "label": row.get("label"),
                "missing_source_count": row.get("missing_source_count"),
                "stale_edge_count": row.get("stale_edge_count"),
                "review_only": True,
            }
            for row in corridor_rows
            if int(row.get("missing_source_count") or 0) or int(row.get("stale_edge_count") or 0)
        ][:10],
        "manual_promotion_allowed": False,
        "review_only": True,
    }


def openalex_safety_summary(
    cache_path: Path,
    ecosystem_path: Path,
    topic_path: Path,
    institution_path: Path,
    cluster_path: Path,
    production_by_ticker: dict[str, dict[str, Any]],
    now: datetime,
) -> dict[str, Any]:
    cache = load_json(cache_path, "OpenAlex cache", required=False) or {}
    entries = cache.get("entries") if isinstance(cache, dict) else {}
    if not isinstance(entries, dict):
        entries = {}
    stale_entries = 0
    for entry in entries.values():
        if not isinstance(entry, dict):
            continue
        fetched = clean_string(entry.get("fetched_at_utc"))
        if not fetched:
            stale_entries += 1
            continue
        try:
            parsed = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
        except ValueError:
            stale_entries += 1
            continue
        if (now - parsed).days > 45:
            stale_entries += 1

    artifact_rows = {
        "ecosystem": load_array_payload(ecosystem_path, "OpenAlex ecosystem", "records"),
        "topic": load_array_payload(topic_path, "OpenAlex topic", "records"),
        "institution": load_array_payload(institution_path, "OpenAlex institution", "records"),
        "cluster": load_array_payload(cluster_path, "OpenAlex cluster", "records"),
    }
    alias_conflicts = []
    for row in artifact_rows["ecosystem"]:
        ticker = normalize_ticker(row.get("ticker"))
        if not ticker or ticker not in production_by_ticker:
            continue
        company_name = normalize_name(production_by_ticker[ticker].get("name"))
        candidates = row.get("openalex_institution_candidates")
        if not isinstance(candidates, list):
            continue
        weak_names = []
        for candidate in candidates[:5]:
            if not isinstance(candidate, dict):
                continue
            display_name = clean_string(candidate.get("display_name"))
            if display_name and company_name and company_name not in normalize_name(display_name):
                weak_names.append(display_name)
        if weak_names:
            alias_conflicts.append(
                {
                    "ticker": ticker,
                    "company_name": clean_string(production_by_ticker[ticker].get("name")),
                    "openalex_display_names": weak_names[:5],
                    "conflict_type": "institution_display_name_requires_review",
                    "review_only": True,
                }
            )
    return {
        "source_system": "OpenAlex",
        "source_role": "context_only_reinforcement",
        "relationship_authority": False,
        "promotion_authority": False,
        "cache_lifecycle": {
            "cache_path": display_path(cache_path),
            "cache_entry_count": len(entries),
            "stale_cache_entry_count": stale_entries,
            "ttl_days": 45,
            "review_only": True,
        },
        "artifact_record_counts": {
            key: len(rows) for key, rows in artifact_rows.items()
        },
        "entity_resolution_tracking": {
            "entity_resolution_rows": len(artifact_rows["ecosystem"]),
            "alias_conflict_count": len(alias_conflicts),
            "alias_conflict_samples": alias_conflicts[:16],
            "review_only": True,
        },
        "source_role_visibility": [
            "OpenAlex may reinforce context only.",
            "OpenAlex does not prove a relationship.",
            "OpenAlex records cannot promote companies or connections.",
        ],
        "review_only": True,
    }


def build_report(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)
    candidates_path = resolve_path(args.candidates)
    official_universe_path = resolve_path(args.official_universe)
    cik_mappings_path = resolve_path(args.cik_mappings)
    openalex_cache_path = resolve_path(args.openalex_cache)
    openalex_ecosystem_path = resolve_path(args.openalex_ecosystem)
    openalex_topic_path = resolve_path(args.openalex_topic)
    openalex_institution_path = resolve_path(args.openalex_institution)
    openalex_cluster_path = resolve_path(args.openalex_cluster)
    registry_dir = resolve_path(args.registry_dir)
    output_path = resolve_path(args.output)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)

    companies = load_companies(companies_path)
    connections = load_connections(connections_path)
    candidates = load_array_payload(candidates_path, "candidate relationships", "candidates")
    official_universe = load_array_payload(official_universe_path, "official ticker universe", "candidates")
    cik_mappings = load_array_payload(cik_mappings_path, "CIK mappings", "mappings")
    company_by_id, production_by_ticker = company_index(companies)

    official_sources = build_official_company_sources(
        companies=companies,
        cik_mappings=cik_mappings,
        generated_at=generated_at,
    )
    trusted_hosts = build_trusted_source_hosts(
        connections=connections,
        candidates=candidates,
        official_universe=official_universe,
        cik_mappings=cik_mappings,
        generated_at=generated_at,
    )
    corridor_registry = build_corridor_registry(generated_at)
    source_quality, stale_queue, duplicate_urls, invalid_urls = source_quality_rows(connections, company_by_id, generated_at)
    corridor_rows = corridor_maintenance_rows(connections, company_by_id, generated_at)
    universe = candidate_universe_readiness(official_universe, cik_mappings, production_by_ticker)
    hubs = strategic_hub_profiles(connections, company_by_id, generated_at)
    graph_scaling = large_graph_scaling_readiness(companies, connections, hubs, corridor_rows)
    ecosystem_planning = ecosystem_expansion_planning(corridor_rows, hubs)
    openalex_safety = openalex_safety_summary(
        openalex_cache_path,
        openalex_ecosystem_path,
        openalex_topic_path,
        openalex_institution_path,
        openalex_cluster_path,
        production_by_ticker,
        generated_at,
    )

    host_records = trusted_hosts.get("records", [])
    official_company_records = official_sources.get("records", [])
    report = {
        "metadata": {
            "artifact_status": "review_only",
            "generated_by": "scripts/source_registry_governance.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "auto_promotion_allowed": False,
            "auto_trust_escalation_allowed": False,
            "network_calls": 0,
            "registry_dir": display_path(registry_dir),
            "output_path": display_path(output_path),
            "production_files_read": {
                "companies": display_path(companies_path),
                "connections": display_path(connections_path),
            },
            "candidate_files_read": {
                "candidate_relationships": display_path(candidates_path),
                "official_universe": display_path(official_universe_path),
                "cik_mappings": display_path(cik_mappings_path),
            },
        },
        "summary": {
            "production_company_count": len(companies),
            "production_edge_count": len(connections),
            "official_company_registry_count": len(official_company_records),
            "registered_sec_root_count": sum(1 for row in official_company_records if row.get("source_roots")),
            "trusted_source_host_count": len(host_records),
            "source_category_count": len(SOURCE_CATEGORY_META),
            "stale_source_review_count": len(stale_queue),
            "corridor_count": len(corridor_rows),
            "universe_candidate_count": universe["candidate_universe_count"],
            "universe_ready_for_review_count": universe["source_readiness_scoring"]["ready_for_review_count"],
            "universe_blocked_existing_count": universe["source_readiness_scoring"]["blocked_existing_production_count"],
            "openalex_alias_conflict_count": openalex_safety["entity_resolution_tracking"]["alias_conflict_count"],
            "density_bucket": graph_scaling["density_bucket"],
            "review_only": True,
        },
        "source_registry_visibility": {
            "official_company_sources_path": display_path(registry_dir / "official_company_sources.json"),
            "trusted_source_hosts_path": display_path(registry_dir / "trusted_source_hosts.json"),
            "corridor_source_registry_path": display_path(registry_dir / "corridor_source_registry.json"),
            "official_company_samples": official_company_records[:12],
            "trusted_host_samples": host_records[:24],
            "review_only": True,
        },
        "source_governance": {
            "quality_summary": source_quality,
            "source_quality_classification": source_quality["source_category_counts"],
            "source_aging": source_quality["source_age_counts"],
            "stale_source_review_queue": stale_queue[:80],
            "invalid_source_detection": invalid_urls[:80],
            "duplicate_source_reduction": duplicate_urls[:80],
            "review_only": True,
        },
        "universe_expansion": universe,
        "ecosystem_expansion_planning": ecosystem_planning,
        "corridor_maintenance": {
            "corridor_rows": corridor_rows,
            "weakest_corridor_coverage": sorted(
                corridor_rows,
                key=lambda row: (float(row.get("coverage_ratio") or 0), -int(row.get("edge_count") or 0), str(row.get("label"))),
            )[:8],
            "strongest_corridor_growth_opportunities": [
                row for row in corridor_rows if row.get("maintenance_priority") == "growth"
            ][:8],
            "maintenance_queue": [
                row for row in corridor_rows if row.get("maintenance_priority") in {"high", "medium"}
            ][:12],
            "review_only": True,
        },
        "large_graph_scaling_readiness": graph_scaling,
        "strategic_hub_evolution": {
            "hub_profiles": hubs,
            "review_only": True,
        },
        "openalex_expansion_safety": openalex_safety,
        "safety": {
            "review_only": True,
            "network_calls": 0,
            "production_writes": 0,
            "companies_written": 0,
            "connections_written": 0,
            "browser_ingestion": False,
            "auto_promotion_executed": False,
            "unsafe_auto_promotion": False,
        },
    }
    validate_report(report)
    return report, official_sources, trusted_hosts, corridor_registry


def validate_report(report: dict[str, Any]) -> None:
    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        raise SourceGovernanceError("report metadata is required.")
    if metadata.get("artifact_status") != "review_only":
        raise SourceGovernanceError("source governance report must be review_only.")
    if metadata.get("production_write_allowed") is not False:
        raise SourceGovernanceError("source governance report cannot allow production writes.")
    safety = report.get("safety")
    if not isinstance(safety, dict):
        raise SourceGovernanceError("source governance report safety is required.")
    if safety.get("production_writes") != 0:
        raise SourceGovernanceError("source governance report safety must show zero production writes.")
    if safety.get("browser_ingestion") is True:
        raise SourceGovernanceError("source governance report must not use browser ingestion.")


def print_human(report: dict[str, Any], output_path: Path) -> None:
    summary = report["summary"]
    print("Source registry governance")
    print("==========================")
    print(f"Official company records: {summary['official_company_registry_count']}")
    print(f"Registered SEC roots: {summary['registered_sec_root_count']}")
    print(f"Trusted source hosts: {summary['trusted_source_host_count']}")
    print(f"Stale source queue: {summary['stale_source_review_count']}")
    print(f"Universe candidates: {summary['universe_candidate_count']}")
    print(f"Ready for review: {summary['universe_ready_for_review_count']}")
    print(f"Density bucket: {summary['density_bucket']}")
    print("Production writes: 0")
    print(f"Report path: {display_path(output_path)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    output_path = resolve_path(args.output)
    registry_dir = resolve_path(args.registry_dir)
    initial_hashes = production_hashes()
    try:
        report, official_sources, trusted_hosts, corridor_registry = build_report(args)
        if args.write:
            if args.sync_registry:
                write_json(registry_dir / "official_company_sources.json", official_sources, force=args.force)
                write_json(registry_dir / "trusted_source_hosts.json", trusted_hosts, force=args.force)
                write_json(registry_dir / "corridor_source_registry.json", corridor_registry, force=args.force)
            write_json(output_path, report, force=args.force)
        assert_production_unchanged(initial_hashes)
    except SourceGovernanceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(report, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(report, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
