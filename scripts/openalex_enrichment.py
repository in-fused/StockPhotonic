#!/usr/bin/env python3
"""Generate review-only OpenAlex intelligence artifacts.

OpenAlex is used here as a source of ecosystem and research-context hints.
The script never writes production graph data, never promotes relationships,
and defaults to cache-only operation. Network access requires --allow-network
and is bounded by a hard per-run request cap.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CANDIDATES_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_CACHE_PATH = ROOT / "data" / "cache" / "openalex" / "entity_resolution_cache.json"
DEFAULT_ECOSYSTEM_OUTPUT_PATH = ROOT / "data" / "candidates" / "openalex_ecosystem_candidates.json"
DEFAULT_TOPIC_OUTPUT_PATH = ROOT / "data" / "candidates" / "openalex_topic_overlap.json"
DEFAULT_INSTITUTION_OUTPUT_PATH = ROOT / "data" / "candidates" / "openalex_institution_overlap.json"
DEFAULT_CLUSTER_OUTPUT_PATH = ROOT / "data" / "candidates" / "openalex_cluster_hints.json"

PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)

OPENALEX_BASE_URL = "https://api.openalex.org"
DEFAULT_MAX_REQUESTS = 24
DEFAULT_MAX_ENTITIES = 20
DEFAULT_PER_PAGE = 5
DEFAULT_CACHE_TTL_DAYS = 45
DEFAULT_RATE_LIMIT_SECONDS = 0.35
MAX_PER_PAGE = 10
MAX_ENTITY_LIMIT = 80
MAX_ARTIFACT_RECORDS = 250

COMPANY_SUFFIX_PATTERN = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|plc|ltd|limited|lp|llc|holdings|holding|group|sa|ag|nv)\b\.?",
    re.IGNORECASE,
)

ECOSYSTEM_DEFINITIONS: dict[str, dict[str, Any]] = {
    "ai_infrastructure": {
        "label": "AI Infrastructure",
        "queries": [
            "artificial intelligence infrastructure",
            "machine learning accelerators",
            "data center GPU computing",
        ],
        "keywords": [
            "artificial intelligence",
            "ai",
            "accelerator",
            "gpu",
            "machine learning",
            "data center",
            "cloud ai",
            "generative ai",
        ],
    },
    "semiconductor_supply_chain": {
        "label": "Semiconductor Supply Chain",
        "queries": [
            "semiconductor manufacturing",
            "advanced semiconductor packaging",
            "chip design automation",
        ],
        "keywords": [
            "semiconductor",
            "chip",
            "foundry",
            "wafer",
            "lithography",
            "eda",
            "memory",
            "hbm",
        ],
    },
    "cloud_hyperscaler": {
        "label": "Cloud / Hyperscaler",
        "queries": [
            "cloud computing infrastructure",
            "distributed systems cloud",
            "data center networking",
        ],
        "keywords": [
            "cloud",
            "hyperscale",
            "hyperscaler",
            "distributed systems",
            "data platform",
            "networking",
        ],
    },
    "healthcare_biotech": {
        "label": "Healthcare / Biotech",
        "queries": [
            "biotechnology drug development",
            "clinical trials oncology",
            "pharmaceutical collaboration",
        ],
        "keywords": [
            "biotech",
            "biotechnology",
            "pharma",
            "pharmaceutical",
            "clinical trial",
            "oncology",
            "drug",
            "therapy",
            "life sciences",
        ],
    },
    "energy_infrastructure": {
        "label": "Energy Infrastructure",
        "queries": [
            "energy infrastructure",
            "electric grid reliability",
            "natural gas pipeline systems",
        ],
        "keywords": [
            "energy",
            "power",
            "grid",
            "pipeline",
            "natural gas",
            "oil",
            "utility",
            "electricity",
        ],
    },
    "financial_market_infrastructure": {
        "label": "Financial Market Infrastructure",
        "queries": [
            "financial market infrastructure",
            "payment networks",
            "risk management banking",
        ],
        "keywords": [
            "bank",
            "banking",
            "payment",
            "payments",
            "exchange",
            "financial",
            "asset management",
            "risk management",
        ],
    },
    "enterprise_saas_workflow": {
        "label": "Enterprise SaaS / Workflow",
        "queries": [
            "enterprise SaaS workflow automation",
            "customer data platform cloud",
            "enterprise productivity software integration",
        ],
        "keywords": [
            "enterprise",
            "saas",
            "workflow",
            "crm",
            "productivity",
            "data cloud",
            "service management",
            "customer data",
            "enterprise software",
        ],
    },
    "aerospace_defense_supply_chain": {
        "label": "Aerospace / Defense Supply Chain",
        "queries": [
            "aerospace supply chain",
            "aircraft engines defense systems",
            "commercial aerospace suppliers",
        ],
        "keywords": [
            "aerospace",
            "aircraft",
            "avionics",
            "jet engine",
            "defense",
            "oem",
            "commercial aerospace",
            "propulsion",
        ],
    },
    "consumer_retail_platforms": {
        "label": "Consumer / Retail Platforms",
        "queries": [
            "retail supply chain ecommerce",
            "consumer platforms warehouse retail",
            "quick service restaurant beverage supply chain",
        ],
        "keywords": [
            "retail",
            "ecommerce",
            "e-commerce",
            "warehouse club",
            "quick service restaurant",
            "beverage",
            "consumer spending",
            "grocery",
        ],
    },
}


class OpenAlexEnrichmentError(Exception):
    """Raised for clear enrichment setup or safety failures."""


class RequestBudget:
    """Hard request budget shared by all OpenAlex lookups in one run."""

    def __init__(self, max_requests: int) -> None:
        self.max_requests = max_requests
        self.used = 0
        self.skipped_for_budget = 0

    def reserve(self) -> bool:
        if self.used >= self.max_requests:
            self.skipped_for_budget += 1
            return False
        self.used += 1
        return True


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build review-only OpenAlex ecosystem, topic, institution, and "
            "cluster hint artifacts. Defaults to cache-only mode."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATES_PATH))
    parser.add_argument("--cache", default=str(DEFAULT_CACHE_PATH))
    parser.add_argument("--ecosystem-output", default=str(DEFAULT_ECOSYSTEM_OUTPUT_PATH))
    parser.add_argument("--topic-output", default=str(DEFAULT_TOPIC_OUTPUT_PATH))
    parser.add_argument("--institution-output", default=str(DEFAULT_INSTITUTION_OUTPUT_PATH))
    parser.add_argument("--cluster-output", default=str(DEFAULT_CLUSTER_OUTPUT_PATH))
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="Permit bounded OpenAlex API requests. Default is cache-only.",
    )
    parser.add_argument(
        "--max-requests",
        type=parse_nonnegative_int,
        default=DEFAULT_MAX_REQUESTS,
        help=f"Hard OpenAlex request cap for this run. Default: {DEFAULT_MAX_REQUESTS}.",
    )
    parser.add_argument(
        "--max-entities",
        type=parse_positive_int,
        default=DEFAULT_MAX_ENTITIES,
        help=f"Maximum production companies to resolve. Default: {DEFAULT_MAX_ENTITIES}.",
    )
    parser.add_argument(
        "--per-page",
        type=parse_positive_int,
        default=DEFAULT_PER_PAGE,
        help=f"OpenAlex search page size, capped at {MAX_PER_PAGE}.",
    )
    parser.add_argument(
        "--cache-ttl-days",
        type=parse_nonnegative_int,
        default=DEFAULT_CACHE_TTL_DAYS,
        help=f"Cache reuse window. Default: {DEFAULT_CACHE_TTL_DAYS} days.",
    )
    parser.add_argument(
        "--rate-limit-seconds",
        type=parse_nonnegative_float,
        default=DEFAULT_RATE_LIMIT_SECONDS,
        help=f"Sleep between OpenAlex requests. Default: {DEFAULT_RATE_LIMIT_SECONDS}s.",
    )
    parser.add_argument("--write", action="store_true", help="Write review-only artifacts.")
    parser.add_argument("--force", action="store_true", help="Overwrite artifacts when --write is used.")
    parser.add_argument("--json", action="store_true", help="Print a JSON summary.")
    args = parser.parse_args(argv)

    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
    args.per_page = min(MAX_PER_PAGE, args.per_page)
    args.max_entities = min(MAX_ENTITY_LIMIT, args.max_entities)
    return args


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be at least 1.")
    return parsed


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be an integer.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be at least 0.")
    return parsed


def parse_nonnegative_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be a number.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be at least 0.")
    return parsed


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
            raise OpenAlexEnrichmentError(f"{label} file is missing: {display_path(path)}")
        return None
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise OpenAlexEnrichmentError(f"could not read {label} file {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise OpenAlexEnrichmentError(f"could not parse {label} file {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise OpenAlexEnrichmentError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def normalize_ticker(value: Any) -> str | None:
    ticker = clean_string(value)
    return ticker.upper() if ticker else None


def load_companies(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "companies")
    if not isinstance(payload, list):
        raise OpenAlexEnrichmentError("companies file must contain a JSON array.")
    return [company for company in payload if isinstance(company, dict)]


def load_candidates(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "candidates", required=False)
    if payload is None:
        return []
    if isinstance(payload, dict) and isinstance(payload.get("candidates"), list):
        return [candidate for candidate in payload["candidates"] if isinstance(candidate, dict)]
    if isinstance(payload, list):
        return [candidate for candidate in payload if isinstance(candidate, dict)]
    return []


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise OpenAlexEnrichmentError(
                f"could not read production data guard file {display_path(path)}: {exc}"
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
        raise OpenAlexEnrichmentError(
            "production data changed during OpenAlex enrichment: "
            f"{', '.join(changed)}"
        )


def empty_cache() -> dict[str, Any]:
    return {
        "metadata": {
            "cache_status": "review_only_cache",
            "schema_version": 1,
            "production_write_allowed": False,
            "generated_by": "scripts/openalex_enrichment.py",
        },
        "entries": {},
    }


def load_cache(path: Path) -> dict[str, Any]:
    payload = load_json(path, "OpenAlex cache", required=False)
    if payload is None:
        return empty_cache()
    if not isinstance(payload, dict):
        raise OpenAlexEnrichmentError("OpenAlex cache must contain a JSON object.")
    metadata = payload.get("metadata")
    entries = payload.get("entries")
    if not isinstance(metadata, dict) or not isinstance(entries, dict):
        raise OpenAlexEnrichmentError("OpenAlex cache must contain metadata and entries objects.")
    if metadata.get("production_write_allowed") is not False:
        raise OpenAlexEnrichmentError("OpenAlex cache must not allow production writes.")
    if metadata.get("cache_status") != "review_only_cache":
        raise OpenAlexEnrichmentError("OpenAlex cache metadata.cache_status must be review_only_cache.")
    return payload


def cache_key(endpoint: str, params: dict[str, Any]) -> str:
    clean_params = {
        key: str(value)
        for key, value in params.items()
        if value is not None and key not in {"api_key"}
    }
    encoded = urlencode(sorted(clean_params.items()))
    return f"{endpoint}?{encoded}"


def cache_entry_is_fresh(entry: dict[str, Any], ttl_days: int) -> bool:
    fetched_at = clean_string(entry.get("fetched_at_utc"))
    if fetched_at is None:
        return False
    if ttl_days == 0:
        return True
    try:
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - fetched <= timedelta(days=ttl_days)


def openalex_user_agent() -> str:
    user_agent = clean_string(os.environ.get("SEC_USER_AGENT"))
    return user_agent or "StockPhotonic OpenAlex review pipeline"


def openalex_params(params: dict[str, Any]) -> dict[str, Any]:
    normalized = {key: value for key, value in params.items() if value is not None}
    api_key = clean_string(os.environ.get("OPENALEX_API_KEY"))
    if api_key:
        normalized["api_key"] = api_key
    return normalized


def fetch_openalex(
    *,
    endpoint: str,
    params: dict[str, Any],
    cache: dict[str, Any],
    budget: RequestBudget,
    allow_network: bool,
    cache_ttl_days: int,
    rate_limit_seconds: float,
) -> tuple[list[dict[str, Any]], str]:
    entries = cache.setdefault("entries", {})
    key = cache_key(endpoint, params)
    entry = entries.get(key)
    if isinstance(entry, dict) and cache_entry_is_fresh(entry, cache_ttl_days):
        cached_results = entry.get("results")
        if isinstance(cached_results, list):
            return [item for item in cached_results if isinstance(item, dict)], "cache_hit"

    if not allow_network:
        return [], "cache_miss_dry_run"
    if not budget.reserve():
        return [], "budget_exhausted"

    if rate_limit_seconds:
        time.sleep(rate_limit_seconds)

    safe_params = {key: value for key, value in params.items() if key != "api_key"}
    request_params = openalex_params(params)
    url = f"{OPENALEX_BASE_URL}{endpoint}?{urlencode(request_params)}"
    request = Request(url, headers={"User-Agent": openalex_user_agent()})
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # network failures are non-fatal review state
        entries[key] = {
            "fetched_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "endpoint": endpoint,
            "params": safe_params,
            "status": "error",
            "error": str(exc),
            "results": [],
        }
        return [], "network_error"

    raw_results = payload.get("results") if isinstance(payload, dict) else []
    results = [summarize_openalex_result(item) for item in raw_results if isinstance(item, dict)]
    entries[key] = {
        "fetched_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "endpoint": endpoint,
        "params": safe_params,
        "status": "ok",
        "result_count": len(results),
        "results": results,
    }
    return results, "network_fetch"


def summarize_openalex_result(item: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "id": clean_string(item.get("id")),
        "display_name": clean_string(item.get("display_name")),
        "works_count": safe_int(item.get("works_count")),
        "cited_by_count": safe_int(item.get("cited_by_count")),
    }

    for field in ("type", "country_code", "homepage_url", "ror"):
        value = clean_string(item.get(field))
        if value:
            summary[field] = value

    for nested_name in ("domain", "field", "subfield"):
        nested = item.get(nested_name)
        if isinstance(nested, dict):
            nested_summary = summarize_nested_entity(nested)
            if nested_summary:
                summary[nested_name] = nested_summary

    topics = item.get("topics")
    if isinstance(topics, list):
        topic_summaries = [
            summarize_nested_entity(topic)
            for topic in topics[:8]
            if isinstance(topic, dict)
        ]
        summary["topics"] = [topic for topic in topic_summaries if topic]

    ids = item.get("ids")
    if isinstance(ids, dict):
        openalex_id = clean_string(ids.get("openalex"))
        if openalex_id and not summary.get("id"):
            summary["id"] = openalex_id

    return {key: value for key, value in summary.items() if value not in (None, "", [])}


def summarize_nested_entity(item: dict[str, Any]) -> dict[str, Any]:
    nested = {
        "id": clean_string(item.get("id")),
        "display_name": clean_string(item.get("display_name")),
    }
    return {key: value for key, value in nested.items() if value}


def safe_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def normalized_company_query(company: dict[str, Any]) -> str:
    name = clean_string(company.get("name")) or clean_string(company.get("ticker")) or ""
    name = COMPANY_SUFFIX_PATTERN.sub("", name)
    name = re.sub(r"\s+", " ", name).strip(" ,.-")
    return name or clean_string(company.get("name")) or ""


def company_descriptor_text(company: dict[str, Any]) -> str:
    return " ".join(
        clean_string(company.get(field)) or ""
        for field in ("ticker", "name", "sector", "industry", "industryGroup")
    ).lower()


def candidate_descriptor_text(
    ticker: str,
    candidates_by_ticker: dict[str, list[dict[str, Any]]],
) -> str:
    snippets: list[str] = []
    for candidate in candidates_by_ticker.get(ticker, [])[:8]:
        snippets.extend(
            clean_string(candidate.get(field)) or ""
            for field in ("relationship_type", "relationship_signal", "evidence_snippet", "target_name")
        )
    return " ".join(snippets).lower()


def ecosystem_matches_for_company(
    company: dict[str, Any],
    candidates_by_ticker: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    ticker = normalize_ticker(company.get("ticker")) or ""
    text = f"{company_descriptor_text(company)} {candidate_descriptor_text(ticker, candidates_by_ticker)}"
    matches: list[dict[str, Any]] = []
    for key, definition in ECOSYSTEM_DEFINITIONS.items():
        hits = sorted({keyword for keyword in definition["keywords"] if keyword in text})
        if hits:
            matches.append(
                {
                    "ecosystem_key": key,
                    "ecosystem_label": definition["label"],
                    "match_reasons": hits[:8],
                }
            )
    return matches


def candidates_by_ticker(candidates: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        for field in ("source_ticker", "target_ticker"):
            ticker = normalize_ticker(candidate.get(field))
            if ticker:
                index[ticker].append(candidate)
    return index


def sort_companies_for_resolution(companies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        companies,
        key=lambda company: (
            -(float(company.get("market_cap") or 0) if not isinstance(company.get("market_cap"), bool) else 0),
            clean_string(company.get("ticker")) or "",
        ),
    )


def resolve_company_institutions(
    *,
    company: dict[str, Any],
    args: argparse.Namespace,
    cache: dict[str, Any],
    budget: RequestBudget,
) -> dict[str, Any]:
    ticker = normalize_ticker(company.get("ticker")) or ""
    query = normalized_company_query(company)
    if not query:
        return {
            "ticker": ticker,
            "company_name": clean_string(company.get("name")),
            "query": "",
            "status": "missing_query",
            "institution_candidates": [],
        }

    results, status = fetch_openalex(
        endpoint="/institutions",
        params={"search": query, "per-page": args.per_page},
        cache=cache,
        budget=budget,
        allow_network=args.allow_network,
        cache_ttl_days=args.cache_ttl_days,
        rate_limit_seconds=args.rate_limit_seconds,
    )
    return {
        "ticker": ticker,
        "company_name": clean_string(company.get("name")),
        "query": query,
        "status": status,
        "institution_candidates": results[: args.per_page],
    }


def resolve_ecosystem_topics(
    *,
    args: argparse.Namespace,
    cache: dict[str, Any],
    budget: RequestBudget,
) -> dict[str, list[dict[str, Any]]]:
    topic_map: dict[str, list[dict[str, Any]]] = {}
    for ecosystem_key, definition in ECOSYSTEM_DEFINITIONS.items():
        topic_map[ecosystem_key] = []
        seen_ids: set[str] = set()
        for query in definition["queries"]:
            results, status = fetch_openalex(
                endpoint="/topics",
                params={"search": query, "per-page": args.per_page},
                cache=cache,
                budget=budget,
                allow_network=args.allow_network,
                cache_ttl_days=args.cache_ttl_days,
                rate_limit_seconds=args.rate_limit_seconds,
            )
            for result in results:
                topic_id = clean_string(result.get("id")) or clean_string(result.get("display_name")) or ""
                if not topic_id or topic_id in seen_ids:
                    continue
                seen_ids.add(topic_id)
                topic_map[ecosystem_key].append(
                    {
                        **result,
                        "query": query,
                        "lookup_status": status,
                    }
                )
    return topic_map


def source_attribution(
    *,
    source: str,
    source_type: str,
    status: str,
    openalex_id: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    attribution = {
        "source": source,
        "source_type": source_type,
        "lookup_status": status,
        "review_only": True,
    }
    if openalex_id:
        attribution["openalex_id"] = openalex_id
    if display_name:
        attribution["display_name"] = display_name
    return attribution


def confidence_label(*, match_count: int, openalex_count: int) -> str:
    if openalex_count >= 2 and match_count >= 2:
        return "medium_context_hint"
    if openalex_count or match_count:
        return "low_context_hint"
    return "unresolved_context_hint"


def build_ecosystem_artifact(
    *,
    companies: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    institution_resolutions: dict[str, dict[str, Any]],
    ecosystem_topics: dict[str, list[dict[str, Any]]],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    by_ticker = candidates_by_ticker(candidates)
    records: list[dict[str, Any]] = []
    for company in companies:
        ticker = normalize_ticker(company.get("ticker"))
        if not ticker:
            continue
        matches = ecosystem_matches_for_company(company, by_ticker)
        if not matches:
            continue

        resolution = institution_resolutions.get(ticker, {})
        institution_candidates = resolution.get("institution_candidates")
        if not isinstance(institution_candidates, list):
            institution_candidates = []
        for match in matches:
            topics = ecosystem_topics.get(match["ecosystem_key"], [])[:5]
            attributions = [
                source_attribution(
                    source="StockPhotonic static metadata",
                    source_type="company_or_candidate_text",
                    status="static_match",
                )
            ]
            for topic in topics[:3]:
                attributions.append(
                    source_attribution(
                        source="OpenAlex",
                        source_type="topic",
                        status=clean_string(topic.get("lookup_status")) or "unknown",
                        openalex_id=clean_string(topic.get("id")),
                        display_name=clean_string(topic.get("display_name")),
                    )
                )
            for institution in institution_candidates[:2]:
                attributions.append(
                    source_attribution(
                        source="OpenAlex",
                        source_type="institution",
                        status=clean_string(resolution.get("status")) or "unknown",
                        openalex_id=clean_string(institution.get("id")),
                        display_name=clean_string(institution.get("display_name")),
                    )
                )
            records.append(
                {
                    "ticker": ticker,
                    "company_name": clean_string(company.get("name")),
                    "company_sector": clean_string(company.get("sector")),
                    "company_industry": clean_string(company.get("industry")),
                    "ecosystem_key": match["ecosystem_key"],
                    "ecosystem_label": match["ecosystem_label"],
                    "match_reasons": match["match_reasons"],
                    "openalex_topic_candidates": topics,
                    "openalex_institution_candidates": institution_candidates[:3],
                    "confidence_label": confidence_label(
                        match_count=len(match["match_reasons"]),
                        openalex_count=len(topics) + len(institution_candidates),
                    ),
                    "institution_adjacency_hint": {
                        "candidate_count": len(institution_candidates[:3]),
                        "status": clean_string(resolution.get("status")) or "unknown",
                    },
                    "source_attribution": attributions,
                    "relationship_claim_created": False,
                    "review_only": True,
                }
            )

    records = records[:MAX_ARTIFACT_RECORDS]
    ecosystem_counts = Counter(record["ecosystem_key"] for record in records)
    sector_counts_by_ecosystem: dict[str, Counter[str]] = defaultdict(Counter)
    for record in records:
        sector = clean_string(record.get("company_sector")) or "Unknown"
        sector_counts_by_ecosystem[record["ecosystem_key"]][sector] += 1
    for record in records:
        ecosystem_count = ecosystem_counts[record["ecosystem_key"]]
        sector_counts = sector_counts_by_ecosystem.get(record["ecosystem_key"], Counter())
        sector = clean_string(record.get("company_sector")) or "Unknown"
        record["ecosystem_density_hint"] = {
            "ecosystem_company_count": ecosystem_count,
            "density_label": "dense_context_cluster"
            if ecosystem_count >= 8
            else "emerging_context_cluster"
            if ecosystem_count >= 3
            else "sparse_context_cluster",
        }
        record["sector_overlap_hint"] = {
            "matched_sector": sector,
            "same_sector_count": sector_counts.get(sector, 0),
            "sector_count": len(sector_counts),
            "cross_sector_context": len(sector_counts) > 1,
        }
    return {
        "metadata": metadata,
        "summary": {
            "ecosystem_hint_count": len(records),
            "ecosystem_count": len(ecosystem_counts),
            "openalex_topic_candidate_count": sum(
                len(record["openalex_topic_candidates"]) for record in records
            ),
            "openalex_institution_candidate_count": sum(
                len(record["openalex_institution_candidates"]) for record in records
            ),
            "review_only": True,
        },
        "ecosystem_counts": dict(sorted(ecosystem_counts.items())),
        "records": records,
        "safety": review_safety(metadata),
    }


def build_topic_overlap_artifact(
    *,
    ecosystem_topics: dict[str, list[dict[str, Any]]],
    ecosystem_artifact: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    tickers_by_ecosystem: dict[str, list[str]] = defaultdict(list)
    for record in ecosystem_artifact.get("records", []):
        if isinstance(record, dict):
            ticker = clean_string(record.get("ticker"))
            ecosystem_key = clean_string(record.get("ecosystem_key"))
            if ticker and ecosystem_key:
                tickers_by_ecosystem[ecosystem_key].append(ticker)

    records: list[dict[str, Any]] = []
    for ecosystem_key, topics in ecosystem_topics.items():
        for topic in topics[:12]:
            records.append(
                {
                    "ecosystem_key": ecosystem_key,
                    "ecosystem_label": ECOSYSTEM_DEFINITIONS[ecosystem_key]["label"],
                    "topic_id": clean_string(topic.get("id")),
                    "topic_display_name": clean_string(topic.get("display_name")),
                    "topic_query": clean_string(topic.get("query")),
                    "works_count": topic.get("works_count"),
                    "cited_by_count": topic.get("cited_by_count"),
                    "matched_tickers": sorted(set(tickers_by_ecosystem.get(ecosystem_key, [])))[:30],
                    "ecosystem_density_hint": {
                        "matched_ticker_count": len(set(tickers_by_ecosystem.get(ecosystem_key, []))),
                        "topic_rank_role": "broad_context_topic",
                    },
                    "confidence_label": "topic_context_hint",
                    "source_attribution": [
                        source_attribution(
                            source="OpenAlex",
                            source_type="topic",
                            status=clean_string(topic.get("lookup_status")) or "unknown",
                            openalex_id=clean_string(topic.get("id")),
                            display_name=clean_string(topic.get("display_name")),
                        )
                    ],
                    "relationship_claim_created": False,
                    "review_only": True,
                }
            )
    return {
        "metadata": metadata,
        "summary": {
            "topic_candidate_count": len(records),
            "ecosystems_with_topics": len(
                {record["ecosystem_key"] for record in records if record.get("topic_id")}
            ),
            "review_only": True,
        },
        "records": records[:MAX_ARTIFACT_RECORDS],
        "safety": review_safety(metadata),
    }


def institution_topic_ids(institution: dict[str, Any]) -> set[str]:
    topics = institution.get("topics")
    if not isinstance(topics, list):
        return set()
    return {
        clean_string(topic.get("id")) or clean_string(topic.get("display_name")) or ""
        for topic in topics
        if isinstance(topic, dict)
    } - {""}


def build_institution_overlap_artifact(
    *,
    institution_resolutions: dict[str, dict[str, Any]],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    ticker_topics: dict[str, set[str]] = {}
    ticker_institutions: dict[str, list[dict[str, Any]]] = {}
    for ticker, resolution in institution_resolutions.items():
        institutions = resolution.get("institution_candidates")
        if not isinstance(institutions, list):
            institutions = []
        ticker_institutions[ticker] = institutions[:3]
        topic_ids: set[str] = set()
        for institution in institutions[:3]:
            topic_ids.update(institution_topic_ids(institution))
        if topic_ids:
            ticker_topics[ticker] = topic_ids

    records: list[dict[str, Any]] = []
    tickers = sorted(ticker_topics)
    for left_index, left in enumerate(tickers):
        for right in tickers[left_index + 1 :]:
            overlap = sorted(ticker_topics[left] & ticker_topics[right])
            if not overlap:
                continue
            records.append(
                {
                    "source_ticker": left,
                    "target_ticker": right,
                    "shared_openalex_topic_ids": overlap[:12],
                    "shared_topic_count": len(overlap),
                    "source_institution_candidates": ticker_institutions.get(left, [])[:2],
                    "target_institution_candidates": ticker_institutions.get(right, [])[:2],
                    "institution_adjacency_hint": {
                        "shared_topic_count": len(overlap),
                        "relationship_authority": False,
                    },
                    "confidence_label": "institution_topic_overlap_hint",
                    "source_attribution": [
                        source_attribution(
                            source="OpenAlex",
                            source_type="institution_topics",
                            status="cache_or_bounded_lookup",
                        )
                    ],
                    "relationship_claim_created": False,
                    "review_only": True,
                }
            )
    records.sort(key=lambda row: (-int(row["shared_topic_count"]), row["source_ticker"], row["target_ticker"]))
    return {
        "metadata": metadata,
        "summary": {
            "institution_overlap_count": len(records),
            "tickers_with_openalex_topic_context": len(ticker_topics),
            "review_only": True,
        },
        "records": records[:MAX_ARTIFACT_RECORDS],
        "safety": review_safety(metadata),
    }


def build_cluster_hints_artifact(
    *,
    ecosystem_artifact: dict[str, Any],
    topic_artifact: dict[str, Any],
    institution_artifact: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    ecosystem_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in ecosystem_artifact.get("records", []):
        if isinstance(record, dict):
            ecosystem_groups[str(record.get("ecosystem_key") or "unknown")].append(record)

    for ecosystem_key, rows in sorted(ecosystem_groups.items()):
        tickers = sorted({str(row.get("ticker")) for row in rows if row.get("ticker")})
        if not tickers:
            continue
        records.append(
            {
                "cluster_id": f"openalex-ecosystem-{ecosystem_key}",
                "cluster_type": "ecosystem_context",
                "ecosystem_key": ecosystem_key,
                "ecosystem_label": ECOSYSTEM_DEFINITIONS.get(ecosystem_key, {}).get("label", ecosystem_key),
                "tickers": tickers[:50],
                "ticker_count": len(tickers),
                "ecosystem_density_hint": {
                    "ticker_count": len(tickers),
                    "density_label": "dense_context_cluster"
                    if len(tickers) >= 8
                    else "emerging_context_cluster"
                    if len(tickers) >= 3
                    else "sparse_context_cluster",
                },
                "sector_overlap_hint": {
                    "source": "OpenAlex ecosystem context and static company metadata",
                    "relationship_authority": False,
                },
                "confidence_label": "ecosystem_cluster_hint",
                "source_attribution": [
                    source_attribution(
                        source="OpenAlex",
                        source_type="topic_or_institution_context",
                        status="cache_or_bounded_lookup",
                    )
                ],
                "relationship_claim_created": False,
                "review_only": True,
            }
        )

    for topic in topic_artifact.get("records", []):
        if not isinstance(topic, dict):
            continue
        tickers = topic.get("matched_tickers")
        if not isinstance(tickers, list) or len(tickers) < 2:
            continue
        topic_id = clean_string(topic.get("topic_id")) or clean_string(topic.get("topic_display_name")) or "topic"
        records.append(
            {
                "cluster_id": f"openalex-topic-{stable_slug(topic_id)}",
                "cluster_type": "topic_overlap_context",
                "topic_id": clean_string(topic.get("topic_id")),
                "topic_display_name": clean_string(topic.get("topic_display_name")),
                "tickers": sorted({str(ticker) for ticker in tickers})[:50],
                "ticker_count": len(set(tickers)),
                "ecosystem_density_hint": {
                    "ticker_count": len(set(tickers)),
                    "density_label": "topic_overlap_context",
                },
                "confidence_label": "topic_cluster_hint",
                "source_attribution": topic.get("source_attribution") or [],
                "relationship_claim_created": False,
                "review_only": True,
            }
        )

    institution_overlap_count = institution_artifact.get("summary", {}).get("institution_overlap_count", 0)
    if institution_overlap_count:
        records.append(
            {
                "cluster_id": "openalex-institution-topic-overlap",
                "cluster_type": "institution_overlap_context",
                "overlap_record_count": institution_overlap_count,
                "institution_adjacency_hint": {
                    "overlap_record_count": institution_overlap_count,
                    "relationship_authority": False,
                },
                "confidence_label": "institution_overlap_cluster_hint",
                "source_attribution": [
                    source_attribution(
                        source="OpenAlex",
                        source_type="institution_topics",
                        status="cache_or_bounded_lookup",
                    )
                ],
                "relationship_claim_created": False,
                "review_only": True,
            }
        )

    return {
        "metadata": metadata,
        "summary": {
            "cluster_hint_count": len(records),
            "review_only": True,
        },
        "records": records[:MAX_ARTIFACT_RECORDS],
        "safety": review_safety(metadata),
    }


def stable_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if slug:
        return slug[:80]
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def review_safety(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "review_only": True,
        "production_writes": 0,
        "companies_written": 0,
        "connections_written": 0,
        "auto_promotion_executed": False,
        "browser_ingestion": False,
        "relationship_claims_created": 0,
        "network_requests_used": metadata.get("network_requests_used", 0),
    }


def validate_artifact(payload: dict[str, Any], name: str) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise OpenAlexEnrichmentError(f"{name} metadata is required.")
    if metadata.get("artifact_status") != "review_only":
        raise OpenAlexEnrichmentError(f"{name} must be review_only.")
    if metadata.get("production_write_allowed") is not False:
        raise OpenAlexEnrichmentError(f"{name} cannot allow production writes.")
    if payload.get("safety", {}).get("production_writes") != 0:
        raise OpenAlexEnrichmentError(f"{name} safety must show zero production writes.")
    records = payload.get("records")
    if not isinstance(records, list):
        raise OpenAlexEnrichmentError(f"{name} records must be a list.")
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise OpenAlexEnrichmentError(f"{name} record {index} must be an object.")
        if record.get("review_only") is not True:
            raise OpenAlexEnrichmentError(f"{name} record {index} must be review_only.")
        if record.get("relationship_claim_created") is not False:
            raise OpenAlexEnrichmentError(
                f"{name} record {index} must not create relationship claims."
            )
        source_refs = record.get("source_attribution")
        if not isinstance(source_refs, list) or not source_refs:
            raise OpenAlexEnrichmentError(f"{name} record {index} requires source_attribution.")
        if clean_string(record.get("confidence_label")) is None:
            raise OpenAlexEnrichmentError(f"{name} record {index} requires confidence_label.")


def save_cache(path: Path, cache: dict[str, Any], *, force: bool) -> None:
    metadata = cache.setdefault("metadata", {})
    metadata["cache_status"] = "review_only_cache"
    metadata["production_write_allowed"] = False
    metadata["updated_at_utc"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    write_json(path, cache, force=force)


def build_artifacts(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    companies_path = resolve_path(args.companies)
    candidates_path = resolve_path(args.candidates)
    cache_path = resolve_path(args.cache)
    companies = load_companies(companies_path)
    candidates = load_candidates(candidates_path)
    cache = load_cache(cache_path)
    budget = RequestBudget(args.max_requests)
    selected_companies = sort_companies_for_resolution(companies)[: args.max_entities]

    ecosystem_topics = resolve_ecosystem_topics(args=args, cache=cache, budget=budget)
    institution_resolutions: dict[str, dict[str, Any]] = {}
    for company in selected_companies:
        ticker = normalize_ticker(company.get("ticker"))
        if not ticker:
            continue
        institution_resolutions[ticker] = resolve_company_institutions(
            company=company,
            args=args,
            cache=cache,
            budget=budget,
        )

    generated_at = datetime.now(timezone.utc).replace(microsecond=0)
    metadata = {
        "artifact_status": "review_only",
        "generated_by": "scripts/openalex_enrichment.py",
        "generated_at_utc": generated_at.isoformat(),
        "source_system": "OpenAlex",
        "source_role": "enrichment_context_only",
        "production_write_allowed": False,
        "auto_promotion_allowed": False,
        "relationship_claim_authority": False,
        "companies_read": display_path(companies_path),
        "candidates_read": display_path(candidates_path),
        "cache_path": display_path(cache_path),
        "input_company_count": len(companies),
        "processed_company_count": len(selected_companies),
        "candidate_count": len(candidates),
        "network_enabled": bool(args.allow_network),
        "dry_run": not bool(args.allow_network),
        "network_requests_used": budget.used,
        "network_requests_skipped_for_budget": budget.skipped_for_budget,
        "max_requests": args.max_requests,
        "max_entities": args.max_entities,
        "per_page": args.per_page,
        "cache_ttl_days": args.cache_ttl_days,
        "notes": [
            "OpenAlex records are review-only enrichment hints.",
            "OpenAlex does not prove production relationships.",
            "No candidate is promoted by this artifact.",
        ],
    }

    ecosystem_artifact = build_ecosystem_artifact(
        companies=selected_companies,
        candidates=candidates,
        institution_resolutions=institution_resolutions,
        ecosystem_topics=ecosystem_topics,
        metadata=metadata,
    )
    topic_artifact = build_topic_overlap_artifact(
        ecosystem_topics=ecosystem_topics,
        ecosystem_artifact=ecosystem_artifact,
        metadata=metadata,
    )
    institution_artifact = build_institution_overlap_artifact(
        institution_resolutions=institution_resolutions,
        metadata=metadata,
    )
    cluster_artifact = build_cluster_hints_artifact(
        ecosystem_artifact=ecosystem_artifact,
        topic_artifact=topic_artifact,
        institution_artifact=institution_artifact,
        metadata=metadata,
    )

    for name, payload in (
        ("openalex_ecosystem_candidates", ecosystem_artifact),
        ("openalex_topic_overlap", topic_artifact),
        ("openalex_institution_overlap", institution_artifact),
        ("openalex_cluster_hints", cluster_artifact),
    ):
        validate_artifact(payload, name)

    return ecosystem_artifact, topic_artifact, institution_artifact, cluster_artifact, cache


def print_human(
    *,
    ecosystem_artifact: dict[str, Any],
    topic_artifact: dict[str, Any],
    institution_artifact: dict[str, Any],
    cluster_artifact: dict[str, Any],
    args: argparse.Namespace,
) -> None:
    metadata = ecosystem_artifact["metadata"]
    print("OpenAlex review-only enrichment")
    print("===============================")
    print(f"Mode: {'network-enabled' if args.allow_network else 'cache-only/dry-run'}")
    print(f"Companies processed: {metadata['processed_company_count']}")
    print(f"Network requests used: {metadata['network_requests_used']} / {metadata['max_requests']}")
    print(f"Budget skips: {metadata['network_requests_skipped_for_budget']}")
    print(f"Ecosystem hints: {ecosystem_artifact['summary']['ecosystem_hint_count']}")
    print(f"Topic candidates: {topic_artifact['summary']['topic_candidate_count']}")
    print(f"Institution overlaps: {institution_artifact['summary']['institution_overlap_count']}")
    print(f"Cluster hints: {cluster_artifact['summary']['cluster_hint_count']}")
    print("Production writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    initial_hashes = production_hashes()
    try:
        ecosystem_artifact, topic_artifact, institution_artifact, cluster_artifact, cache = build_artifacts(args)
        if args.write:
            write_json(resolve_path(args.ecosystem_output), ecosystem_artifact, force=args.force)
            write_json(resolve_path(args.topic_output), topic_artifact, force=args.force)
            write_json(resolve_path(args.institution_output), institution_artifact, force=args.force)
            write_json(resolve_path(args.cluster_output), cluster_artifact, force=args.force)
            save_cache(resolve_path(args.cache), cache, force=True)
        assert_production_unchanged(initial_hashes)
    except OpenAlexEnrichmentError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(
            {
                "ecosystem_summary": ecosystem_artifact["summary"],
                "topic_summary": topic_artifact["summary"],
                "institution_summary": institution_artifact["summary"],
                "cluster_summary": cluster_artifact["summary"],
                "metadata": ecosystem_artifact["metadata"],
                "safety": review_safety(ecosystem_artifact["metadata"]),
            },
            sys.stdout,
            indent=2,
            sort_keys=True,
        )
        print()
    else:
        print_human(
            ecosystem_artifact=ecosystem_artifact,
            topic_artifact=topic_artifact,
            institution_artifact=institution_artifact,
            cluster_artifact=cluster_artifact,
            args=args,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
