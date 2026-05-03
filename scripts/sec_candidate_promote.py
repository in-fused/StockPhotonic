#!/usr/bin/env python3
"""Promote validated SEC relationship candidates into production graph data.

Default mode is a dry run. The script writes only data/connections.json, and
only when --write is passed explicitly.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CANDIDATE_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_POLICY_PATH = ROOT / "data" / "candidates" / "sec_automation_policy.json"
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"

TARGET_MATCH_CONFIDENCE_THRESHOLD = 0.85
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
PROMOTABLE_PRODUCTION_TYPES = {
    "supply",
    "partnership",
    "investment",
}

PARTNERSHIP_TERMS = (
    "revenue from",
    "licensing",
    "search distribution",
    "payments from",
    "strategic partnership",
    "partnership with",
    "collaboration with",
    "joint venture with",
)
SUPPLY_TERMS = (
    "supplies",
    "supplied by",
    "supply agreement",
    "manufacturing",
    "manufactured by",
    "manufactures for",
    "components sourced from",
    "component supplier",
)
INVESTMENT_TERMS = (
    "investment in",
    "invested in",
    "ownership stake",
    "equity investment",
    "issue and sell",
    "issuance and sale",
    "issued and sold",
    "shares of our common stock",
    "cash purchase price",
    "aggregate cash purchase price",
    "purchased shares",
    "ownership interest",
)

PARTNERSHIP_LABEL = "SEC filing relationship: licensing/search distribution"
SUPPLY_LABEL = "SEC filing relationship: supply dependency"
INVESTMENT_LABEL = "SEC filing relationship: share issuance/ownership"
PROVENANCE = "SEC filing"

CLASSIFICATION_ORDER = (
    "promotable",
    "missing_source_ticker",
    "missing_target_ticker",
    "low_target_match_confidence",
    "source_not_in_production",
    "target_not_in_production",
    "self_edge",
    "unsupported_relationship_type",
    "missing_evidence_snippet",
    "missing_filing_date",
    "invalid_confidence_hint",
    "duplicate_existing_edge",
    "duplicate_candidate_edge",
)
POLICY_CLASSIFICATION_ORDER = (
    "future_auto_promotable_preview",
    "manual_review_required",
    "blocked",
)
DEFAULT_AUTOMATION_POLICY: dict[str, Any] = {
    "metadata": {
        "status": "candidate_only",
        "production_write_allowed": False,
        "app_load_allowed": False,
        "auto_promotion_enabled": False,
    },
    "thresholds": {
        "target_match_confidence_minimum": 0.92,
        "confidence_hint_minimum": 0.85,
        "source_tier_required": 1,
    },
    "source_requirements": {
        "source_type_required": "sec_filing",
        "source_urls_must_include_sec_archive_url": True,
        "sec_archive_url_patterns": [
            "sec.gov/Archives/edgar/data/",
            "sec.gov/archives/edgar/data/",
        ],
    },
    "relationship_rules": {
        "future_auto_promotion_allowed_types": [
            "partnership",
            "supply",
        ],
        "current_production_allowed_types": [
            "supply",
            "partnership",
            "ecosystem",
            "competitor",
            "investment",
        ],
        "ambiguous_types": [
            "supplier_customer",
            "supplier",
            "customer",
            "vendor",
            "dependency",
        ],
        "generic_language_terms": [
            "supplier",
            "suppliers",
            "customer",
            "customers",
            "vendor",
            "vendors",
            "business partner",
            "business partners",
            "depend",
            "depends",
            "dependency",
            "dependencies",
        ],
    },
}


class PromotionError(Exception):
    """Raised for promotion failures that should stop the command."""


@dataclass(frozen=True)
class Company:
    company_id: int
    ticker: str
    name: str


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Safely promote validated SEC relationship candidates into "
            "data/connections.json. Defaults to dry-run mode."
        )
    )
    parser.add_argument(
        "--candidates",
        default=str(DEFAULT_CANDIDATE_PATH),
        help="SEC relationship candidate file. Default: data/candidates/sec_relationship_candidates.json.",
    )
    parser.add_argument(
        "--policy",
        default=str(DEFAULT_POLICY_PATH),
        help=(
            "Candidate-only SEC automation policy gate file. "
            "Default: data/candidates/sec_automation_policy.json. "
            "If the file is absent, built-in safe defaults are used."
        ),
    )
    parser.add_argument(
        "--companies",
        default=str(DEFAULT_COMPANIES_PATH),
        help="Production companies file to read. Default: data/companies.json.",
    )
    parser.add_argument(
        "--connections",
        default=str(DEFAULT_CONNECTIONS_PATH),
        help="Production connections file to read/write. Default: data/connections.json.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview promotable candidates without writing. This is the default.",
    )
    mode.add_argument(
        "--write",
        action="store_true",
        help="Append validated, non-duplicate candidate edges to data/connections.json.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON result payload.",
    )
    return parser.parse_args(argv)


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise PromotionError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PromotionError(f"could not parse {label} file {path}: {exc}") from exc


def write_json(path: Path, payload: Any) -> None:
    try:
        original = path.read_bytes()
        newline = "\r\n" if b"\r\n" in original else "\n"
        text = json.dumps(payload, indent=2) + "\n"
        with path.open("w", encoding="utf-8", newline=newline) as file:
            file.write(text)
    except OSError as exc:
        raise PromotionError(f"could not write connections file {path}: {exc}") from exc


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def normalize_ticker(value: Any) -> str | None:
    ticker = clean_string(value)
    return ticker.upper() if ticker else None


def numeric_score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    if not 0 <= score <= 1:
        return None
    return score


def valid_date(value: Any) -> str | None:
    date_value = clean_string(value)
    if date_value and DATE_PATTERN.match(date_value):
        return date_value
    return None


def validate_automation_policy(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise PromotionError("automation policy metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionError("automation policy metadata.status must be candidate_only.")
    if metadata.get("production_write_allowed") is not False:
        raise PromotionError(
            "automation policy metadata.production_write_allowed must be false."
        )
    if metadata.get("app_load_allowed") is not False:
        raise PromotionError(
            "automation policy metadata.app_load_allowed must be false."
        )
    if metadata.get("auto_promotion_enabled") is not False:
        raise PromotionError(
            "automation policy metadata.auto_promotion_enabled must be false."
        )


def load_automation_policy(path: Path) -> tuple[dict[str, Any], bool]:
    if not path.exists():
        return DEFAULT_AUTOMATION_POLICY, False

    payload = load_json(path, "automation policy")
    if not isinstance(payload, dict):
        raise PromotionError("automation policy file must contain a JSON object.")
    validate_automation_policy(payload)
    return payload, True


def policy_metadata(policy: dict[str, Any]) -> dict[str, Any]:
    metadata = policy.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def policy_threshold(policy: dict[str, Any], key: str, default: float) -> float:
    thresholds = policy.get("thresholds")
    if not isinstance(thresholds, dict):
        return default
    value = thresholds.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


def policy_required_source_tier(policy: dict[str, Any]) -> int:
    thresholds = policy.get("thresholds")
    if not isinstance(thresholds, dict):
        return 1
    value = thresholds.get("source_tier_required")
    if isinstance(value, bool) or not isinstance(value, int):
        return 1
    return value


def policy_source_type(policy: dict[str, Any]) -> str:
    requirements = policy.get("source_requirements")
    if not isinstance(requirements, dict):
        return "sec_filing"
    source_type = clean_string(requirements.get("source_type_required"))
    return source_type.lower() if source_type else "sec_filing"


def policy_string_list(
    policy: dict[str, Any],
    section_name: str,
    key: str,
    default: tuple[str, ...],
) -> tuple[str, ...]:
    section = policy.get(section_name)
    if not isinstance(section, dict):
        return default
    values = section.get(key)
    if not isinstance(values, list):
        return default

    normalized: list[str] = []
    for value in values:
        item = clean_string(value)
        if item:
            normalized.append(item.lower())
    return tuple(normalized) or default


def sec_archive_patterns(policy: dict[str, Any]) -> tuple[str, ...]:
    requirements = policy.get("source_requirements")
    if not isinstance(requirements, dict):
        return (
            "sec.gov/archives/edgar/data/",
        )
    values = requirements.get("sec_archive_url_patterns")
    if not isinstance(values, list):
        return (
            "sec.gov/archives/edgar/data/",
        )

    patterns: list[str] = []
    for value in values:
        pattern = clean_string(value)
        if pattern:
            patterns.append(pattern.lower())
    return tuple(patterns) or (
        "sec.gov/archives/edgar/data/",
    )


def validate_candidate_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise PromotionError("candidate file metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionError("candidate file metadata.status must be candidate_only.")
    if metadata.get("app_load_allowed") is not False:
        raise PromotionError("candidate file metadata.app_load_allowed must be false.")


def load_candidate_payload(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "candidate")
    if not isinstance(payload, dict):
        raise PromotionError("candidate file must contain a JSON object.")

    validate_candidate_metadata(payload)
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise PromotionError("candidate file candidates must be a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise PromotionError(f"candidate {index} must be an object.")
        normalized_candidates.append(candidate)
    return normalized_candidates


def build_company_map(raw_companies: Any) -> dict[str, Company]:
    if not isinstance(raw_companies, list):
        raise PromotionError("production companies data must be a JSON array.")

    ticker_to_company: dict[str, Company] = {}
    for index, company in enumerate(raw_companies):
        if not isinstance(company, dict):
            raise PromotionError(f"company {index} must be an object.")

        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        name = clean_string(company.get("name"))
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise PromotionError(f"company {index} id must be an integer.")
        if ticker is None:
            raise PromotionError(f"company {company_id} ticker must be present.")
        if name is None:
            raise PromotionError(f"company {company_id} name must be present.")
        if ticker in ticker_to_company:
            raise PromotionError(f"duplicate production ticker: {ticker}.")
        ticker_to_company[ticker] = Company(
            company_id=company_id,
            ticker=ticker,
            name=name,
        )
    return ticker_to_company


def edge_key(source: int, target: int, connection_type: str) -> tuple[int, int, str]:
    return (min(source, target), max(source, target), connection_type.lower())


def build_existing_edge_keys(raw_connections: Any) -> set[tuple[int, int, str]]:
    if not isinstance(raw_connections, list):
        raise PromotionError("production connections data must be a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(raw_connections):
        if not isinstance(connection, dict):
            raise PromotionError(f"connection {index} must be an object.")

        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if not (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            continue

        key = edge_key(source, target, connection_type)
        if key in keys:
            raise PromotionError(
                "production connections already contain duplicate edge "
                f"{source}-{target} ({connection_type})."
            )
        keys.add(key)
    return keys


def term_hits(text: str, terms: tuple[str, ...]) -> list[str]:
    text_lower = text.lower()
    hits: list[str] = []
    for term in terms:
        if " " in term:
            if term in text_lower:
                hits.append(term)
            continue

        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, text_lower):
            hits.append(term)
    return hits


def map_relationship_type(candidate: dict[str, Any]) -> tuple[str | None, str | None]:
    raw_type = clean_string(candidate.get("relationship_type"))
    if raw_type is None:
        return None, None

    relationship_type = raw_type.lower()
    evidence = clean_string(candidate.get("evidence_snippet")) or ""
    investment_hits = term_hits(evidence, INVESTMENT_TERMS)
    if investment_hits:
        return "investment", "evidence_investment_terms"

    if relationship_type in PROMOTABLE_PRODUCTION_TYPES:
        return relationship_type, f"direct:{relationship_type}"

    if relationship_type != "supplier_customer":
        return None, None

    partnership_hits = term_hits(evidence, PARTNERSHIP_TERMS)
    if partnership_hits:
        return "partnership", "supplier_customer:evidence_partnership_terms"

    supply_hits = term_hits(evidence, SUPPLY_TERMS)
    if supply_hits:
        return "supply", "supplier_customer:evidence_supply_terms"

    return None, None


def archive_urls_from_candidate(candidate: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    archive_url = candidate.get("archive_url")
    if isinstance(archive_url, str):
        raw_urls.append(archive_url)

    source_urls = candidate.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)

    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in raw_urls:
        if not isinstance(raw_url, str):
            continue
        url = raw_url.strip()
        if not URL_PATTERN.match(url) or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def source_urls_field(candidate: dict[str, Any]) -> list[str]:
    source_urls = candidate.get("source_urls")
    if not isinstance(source_urls, list):
        return []

    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in source_urls:
        if not isinstance(raw_url, str):
            continue
        url = raw_url.strip()
        if not URL_PATTERN.match(url) or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def has_sec_archive_source_url(
    candidate: dict[str, Any],
    policy: dict[str, Any],
) -> bool:
    patterns = sec_archive_patterns(policy)
    for url in source_urls_field(candidate):
        normalized_url = url.lower()
        if any(pattern in normalized_url for pattern in patterns):
            return True
    return False


def candidate_has_multiple_possible_targets(candidate: dict[str, Any]) -> bool:
    boolean_fields = (
        "multiple_possible_target_entities",
        "multiple_possible_targets",
    )
    for field_name in boolean_fields:
        if candidate.get(field_name) is True:
            return True

    list_fields = (
        "possible_target_entities",
        "possible_targets",
        "target_candidates",
        "target_options",
        "target_match_candidates",
    )
    for field_name in list_fields:
        value = candidate.get(field_name)
        if isinstance(value, list) and len(value) > 1:
            return True
    return False


def existing_pair_types(
    existing_edge_keys: set[tuple[int, int, str]],
    source_id: int,
    target_id: int,
) -> set[str]:
    left = min(source_id, target_id)
    right = max(source_id, target_id)
    return {
        connection_type
        for edge_source, edge_target, connection_type in existing_edge_keys
        if edge_source == left and edge_target == right
    }


def relationship_policy_sets(
    policy: dict[str, Any],
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    future_allowed = policy_string_list(
        policy,
        "relationship_rules",
        "future_auto_promotion_allowed_types",
        ("partnership", "supply"),
    )
    current_allowed = policy_string_list(
        policy,
        "relationship_rules",
        "current_production_allowed_types",
        (
            "supply",
            "partnership",
            "ecosystem",
            "competitor",
            "investment",
        ),
    )
    ambiguous_types = policy_string_list(
        policy,
        "relationship_rules",
        "ambiguous_types",
        (
            "supplier_customer",
            "supplier",
            "customer",
            "vendor",
            "dependency",
        ),
    )
    generic_terms = policy_string_list(
        policy,
        "relationship_rules",
        "generic_language_terms",
        (
            "supplier",
            "suppliers",
            "customer",
            "customers",
            "vendor",
            "vendors",
            "business partner",
            "business partners",
            "depend",
            "depends",
            "dependency",
            "dependencies",
        ),
    )
    return future_allowed, current_allowed, ambiguous_types, generic_terms


def evidence_has_specific_relationship_terms(evidence: str) -> bool:
    return bool(
        term_hits(evidence, PARTNERSHIP_TERMS)
        or term_hits(evidence, SUPPLY_TERMS)
        or term_hits(evidence, INVESTMENT_TERMS)
    )


def evidence_has_generic_terms(evidence: str, generic_terms: tuple[str, ...]) -> bool:
    return bool(term_hits(evidence, generic_terms))


def unique_policy_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered.append(reason)
    return ordered


def classify_by_policy(
    candidate: dict[str, Any],
    *,
    source_ticker: str | None,
    target_ticker: str | None,
    source_company: Company | None,
    target_company: Company | None,
    mapped_type: str | None,
    duplicate_existing_edge: bool,
    conflicting_existing_edge: bool,
    duplicate_candidate_edge: bool,
    policy: dict[str, Any],
) -> dict[str, Any]:
    blocked_reasons: list[str] = []
    manual_reasons: list[str] = []

    future_allowed, current_allowed, ambiguous_types, generic_terms = (
        relationship_policy_sets(policy)
    )
    raw_type = clean_string(candidate.get("relationship_type"))
    relationship_type = raw_type.lower() if raw_type else None
    evidence = clean_string(candidate.get("evidence_snippet"))

    if source_ticker is None:
        blocked_reasons.append("source_ticker_missing")
    elif source_company is None:
        blocked_reasons.append("source_company_missing_from_production")

    if target_ticker is None:
        blocked_reasons.append("target_ticker_missing")
    elif target_company is None:
        blocked_reasons.append("target_company_missing_from_production")

    if evidence is None:
        blocked_reasons.append("evidence_missing")

    unsupported_type = False
    if relationship_type is None:
        unsupported_type = True
    elif (
        relationship_type not in future_allowed
        and relationship_type not in current_allowed
        and relationship_type not in ambiguous_types
    ):
        unsupported_type = True
    if unsupported_type:
        blocked_reasons.append("unsupported_relationship_type")

    if evidence and relationship_type in ambiguous_types:
        if (
            evidence_has_generic_terms(evidence, generic_terms)
            and not evidence_has_specific_relationship_terms(evidence)
        ):
            blocked_reasons.append("generic_supplier_customer_dependency_language_only")

    if blocked_reasons:
        return {
            "classification": "blocked",
            "reasons": unique_policy_reasons(blocked_reasons),
        }

    target_threshold = policy_threshold(
        policy,
        "target_match_confidence_minimum",
        0.92,
    )
    target_match_confidence = numeric_score(candidate.get("target_match_confidence"))
    if target_match_confidence is None or target_match_confidence < target_threshold:
        manual_reasons.append("target_match_confidence_below_policy_threshold")

    source_urls = source_urls_field(candidate)
    if not source_urls:
        manual_reasons.append("source_urls_missing")
    elif not has_sec_archive_source_url(candidate, policy):
        manual_reasons.append("sec_archive_source_url_missing")

    if relationship_type in ambiguous_types:
        manual_reasons.append("relationship_type_ambiguous")

    if candidate_has_multiple_possible_targets(candidate):
        manual_reasons.append("multiple_possible_target_entities")

    if duplicate_existing_edge or conflicting_existing_edge:
        manual_reasons.append("candidate_conflicts_with_existing_production_edge")
    if duplicate_candidate_edge:
        manual_reasons.append("duplicate_candidate_edge")

    if relationship_type not in future_allowed:
        manual_reasons.append("relationship_category_not_currently_allowed")
    elif mapped_type not in future_allowed:
        manual_reasons.append("relationship_category_not_currently_allowed")

    required_source_type = policy_source_type(policy)
    source_type = clean_string(candidate.get("source_type"))
    if source_type is None or source_type.lower() != required_source_type:
        manual_reasons.append("source_type_not_sec_filing")

    required_source_tier = policy_required_source_tier(policy)
    source_tier = candidate.get("source_tier")
    if (
        isinstance(source_tier, bool)
        or not isinstance(source_tier, int)
        or source_tier != required_source_tier
    ):
        manual_reasons.append("source_tier_not_1")

    if valid_date(candidate.get("filing_date")) is None:
        manual_reasons.append("filing_date_missing")

    confidence_threshold = policy_threshold(
        policy,
        "confidence_hint_minimum",
        0.85,
    )
    confidence_hint = numeric_score(candidate.get("confidence_hint"))
    if confidence_hint is None or confidence_hint < confidence_threshold:
        manual_reasons.append("confidence_hint_below_policy_threshold")

    if manual_reasons:
        return {
            "classification": "manual_review_required",
            "reasons": unique_policy_reasons(manual_reasons),
        }

    return {
        "classification": "future_auto_promotable_preview",
        "reasons": [],
    }


def edge_label(connection_type: str) -> str:
    if connection_type == "partnership":
        return PARTNERSHIP_LABEL
    if connection_type == "investment":
        return INVESTMENT_LABEL
    return SUPPLY_LABEL


def build_edge(
    *,
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
    confidence_hint: float,
    filing_date: str,
) -> dict[str, Any]:
    source_urls = archive_urls_from_candidate(candidate)
    return {
        "source": source.company_id,
        "target": target.company_id,
        "type": connection_type,
        "strength": confidence_hint,
        "label": edge_label(connection_type),
        "confidence": 5 if source_urls else 4,
        "provenance": PROVENANCE,
        "source_urls": source_urls,
        "verified_date": filing_date,
    }


def unique_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for classification in CLASSIFICATION_ORDER:
        if classification in reasons and classification not in seen:
            seen.add(classification)
            ordered.append(classification)
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered.append(reason)
    return ordered


def inspect_candidate(
    candidate: dict[str, Any],
    *,
    index: int,
    ticker_to_company: dict[str, Company],
    existing_edge_keys: set[tuple[int, int, str]],
    policy: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []

    source_ticker = normalize_ticker(candidate.get("source_ticker"))
    target_ticker = normalize_ticker(candidate.get("target_ticker"))
    target_match_confidence = numeric_score(candidate.get("target_match_confidence"))
    evidence_snippet = clean_string(candidate.get("evidence_snippet"))
    filing_date = valid_date(candidate.get("filing_date"))
    confidence_hint = numeric_score(candidate.get("confidence_hint"))

    source_company: Company | None = None
    target_company: Company | None = None
    duplicate_existing_edge = False
    conflicting_existing_edge = False
    duplicate_candidate_edge = False

    if source_ticker is None:
        reasons.append("missing_source_ticker")
    else:
        source_company = ticker_to_company.get(source_ticker)
        if source_company is None:
            reasons.append("source_not_in_production")

    if target_ticker is None:
        reasons.append("missing_target_ticker")
    else:
        target_company = ticker_to_company.get(target_ticker)
        if target_company is None:
            reasons.append("target_not_in_production")

    if (
        target_match_confidence is None
        or target_match_confidence < TARGET_MATCH_CONFIDENCE_THRESHOLD
    ):
        reasons.append("low_target_match_confidence")

    mapped_type, mapping_rule = map_relationship_type(candidate)
    if mapped_type is None:
        reasons.append("unsupported_relationship_type")

    if evidence_snippet is None:
        reasons.append("missing_evidence_snippet")
    if filing_date is None:
        reasons.append("missing_filing_date")
    if confidence_hint is None:
        reasons.append("invalid_confidence_hint")

    candidate_edge_key: tuple[int, int, str] | None = None
    if source_company and target_company:
        if source_company.company_id == target_company.company_id:
            reasons.append("self_edge")
        elif mapped_type:
            pair_types = existing_pair_types(
                existing_edge_keys,
                source_company.company_id,
                target_company.company_id,
            )
            candidate_edge_key = edge_key(
                source_company.company_id,
                target_company.company_id,
                mapped_type,
            )
            if candidate_edge_key in existing_edge_keys:
                reasons.append("duplicate_existing_edge")
                duplicate_existing_edge = True
            elif pair_types:
                conflicting_existing_edge = True

    classifications = unique_reasons(reasons) if reasons else ["promotable"]
    proposed_edge = None
    if (
        classifications == ["promotable"]
        and source_company
        and target_company
        and mapped_type
        and confidence_hint is not None
        and filing_date is not None
    ):
        proposed_edge = build_edge(
            candidate=candidate,
            source=source_company,
            target=target_company,
            connection_type=mapped_type,
            confidence_hint=confidence_hint,
            filing_date=filing_date,
        )
    policy_result = classify_by_policy(
        candidate,
        source_ticker=source_ticker,
        target_ticker=target_ticker,
        source_company=source_company,
        target_company=target_company,
        mapped_type=mapped_type,
        duplicate_existing_edge=duplicate_existing_edge,
        conflicting_existing_edge=conflicting_existing_edge,
        duplicate_candidate_edge=duplicate_candidate_edge,
        policy=policy,
    )

    return {
        "index": index,
        "source_ticker": source_ticker,
        "target_ticker": target_ticker,
        "source_company_id": source_company.company_id if source_company else None,
        "target_company_id": target_company.company_id if target_company else None,
        "relationship_type": clean_string(candidate.get("relationship_type")),
        "relationship_signal": clean_string(candidate.get("relationship_signal")),
        "mapped_production_type": mapped_type,
        "mapping_rule": mapping_rule,
        "target_match_confidence": target_match_confidence,
        "confidence_hint": confidence_hint,
        "filing_date": filing_date,
        "source_urls": archive_urls_from_candidate(candidate),
        "classifications": classifications,
        "policy_classification": policy_result["classification"],
        "policy_reasons": policy_result["reasons"],
        "edge_key": list(candidate_edge_key) if candidate_edge_key else None,
        "proposed_edge": proposed_edge,
    }


def candidate_dedupe_key(record: dict[str, Any]) -> tuple[Any, ...] | None:
    source_id = record.get("source_company_id")
    target_id = record.get("target_company_id")
    mapped_type = clean_string(record.get("mapped_production_type"))
    if (
        isinstance(source_id, int)
        and not isinstance(source_id, bool)
        and isinstance(target_id, int)
        and not isinstance(target_id, bool)
    ):
        if mapped_type:
            return (
                "company_edge",
                min(source_id, target_id),
                max(source_id, target_id),
                mapped_type.lower(),
            )
        return ("company_ids", min(source_id, target_id), max(source_id, target_id))

    source_ticker = clean_string(record.get("source_ticker"))
    target_ticker = clean_string(record.get("target_ticker"))
    if source_ticker and target_ticker:
        sorted_tickers = sorted((source_ticker.upper(), target_ticker.upper()))
        if mapped_type:
            return ("ticker_edge", *sorted_tickers, mapped_type.lower())
        return ("tickers", *sorted_tickers)
    return None


def policy_rank(classification: str) -> int:
    if classification == "future_auto_promotable_preview":
        return 3
    if classification == "manual_review_required":
        return 2
    if classification == "blocked":
        return 1
    return 0


def dedupe_score(record: dict[str, Any]) -> tuple[int, int, float, float, int, int]:
    classifications = record.get("classifications")
    is_promotable = 1 if classifications == ["promotable"] else 0
    confidence_hint = record.get("confidence_hint")
    target_match_confidence = record.get("target_match_confidence")
    source_urls = record.get("source_urls")
    return (
        is_promotable,
        policy_rank(str(record.get("policy_classification") or "")),
        confidence_hint if isinstance(confidence_hint, (int, float)) else -1.0,
        target_match_confidence
        if isinstance(target_match_confidence, (int, float))
        else -1.0,
        len(source_urls) if isinstance(source_urls, list) else 0,
        -int(record.get("index") or 0),
    )


def unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        item = clean_string(value)
        if item and item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def merge_duplicate_group(
    winner: dict[str, Any],
    group: list[dict[str, Any]],
) -> dict[str, Any]:
    if len(group) == 1:
        return winner

    candidate_indices = [int(record["index"]) for record in group]
    suppressed_indices = [
        int(record["index"]) for record in group if record is not winner
    ]
    merged_source_urls = unique_strings(
        [
            url
            for record in group
            for url in (record.get("source_urls") or [])
        ]
    )
    winner["deduplication"] = {
        "status": "kept_strongest_candidate_edge",
        "candidate_indices": sorted(candidate_indices),
        "suppressed_candidate_indices": sorted(suppressed_indices),
        "duplicate_candidates_suppressed": len(suppressed_indices),
        "merged_relationship_types": unique_strings(
            [record.get("relationship_type") for record in group]
        ),
        "merged_production_types": unique_strings(
            [record.get("mapped_production_type") for record in group]
        ),
        "merged_relationship_signals": unique_strings(
            [record.get("relationship_signal") for record in group]
        ),
    }

    proposed_edge = winner.get("proposed_edge")
    if isinstance(proposed_edge, dict) and merged_source_urls:
        proposed_edge["source_urls"] = merged_source_urls
        proposed_edge["confidence"] = 5
    return winner


def deduplicate_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    ungrouped: list[dict[str, Any]] = []
    for record in records:
        key = candidate_dedupe_key(record)
        if key is None:
            ungrouped.append(record)
        else:
            grouped.setdefault(key, []).append(record)

    unique_records = [*ungrouped]
    suppressed_records: list[dict[str, Any]] = []
    for group in grouped.values():
        winner = max(group, key=dedupe_score)
        unique_records.append(merge_duplicate_group(winner, group))
        for record in group:
            if record is winner:
                continue
            suppressed_records.append(
                {
                    "index": record["index"],
                    "source_ticker": record.get("source_ticker"),
                    "target_ticker": record.get("target_ticker"),
                    "relationship_type": record.get("relationship_type"),
                    "mapped_production_type": record.get("mapped_production_type"),
                    "mapping_rule": record.get("mapping_rule"),
                    "confidence_hint": record.get("confidence_hint"),
                    "classifications": ["duplicate_candidate_edge"],
                    "policy_classification": "manual_review_required",
                    "policy_reasons": ["duplicate_candidate_edge"],
                    "kept_candidate_index": winner["index"],
                    "suppression_reason": "weaker_duplicate_candidate_edge",
                }
            )

    unique_records.sort(key=lambda record: int(record.get("index") or 0))
    suppressed_records.sort(key=lambda record: int(record.get("index") or 0))
    return unique_records, suppressed_records


def build_result(
    *,
    candidate_path: Path,
    policy_path: Path,
    companies_path: Path,
    connections_path: Path,
    write: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    candidates = load_candidate_payload(candidate_path)
    policy, policy_loaded = load_automation_policy(policy_path)
    ticker_to_company = build_company_map(load_json(companies_path, "companies"))
    connections = load_json(connections_path, "connections")
    existing_edge_keys = build_existing_edge_keys(connections)

    inspected_records: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        record = inspect_candidate(
            candidate,
            index=index,
            ticker_to_company=ticker_to_company,
            existing_edge_keys=existing_edge_keys,
            policy=policy,
        )
        inspected_records.append(record)
    records, suppressed_duplicate_records = deduplicate_records(inspected_records)
    new_edges = [
        record["proposed_edge"]
        for record in records
        if isinstance(record.get("proposed_edge"), dict)
    ]

    classification_counts: Counter[str] = Counter()
    policy_classification_counts: Counter[str] = Counter()
    for record in records:
        classification_counts.update(record["classifications"])
        policy_classification_counts.update([record["policy_classification"]])
    classification_counts.update(
        ["duplicate_candidate_edge"] * len(suppressed_duplicate_records)
    )

    duplicate_count = (
        classification_counts["duplicate_existing_edge"]
        + classification_counts["duplicate_candidate_edge"]
    )
    summary = {
        "mode": "write" if write else "dry-run",
        "total_candidates": len(candidates),
        "unique_candidate_edges": len(records),
        "promotable_edges": len(new_edges),
        "blocked_candidates": len(candidates) - len(new_edges),
        "duplicates_suppressed": duplicate_count,
        "candidate_duplicates_suppressed": len(suppressed_duplicate_records),
        "future_auto_promotable_previews": policy_classification_counts[
            "future_auto_promotable_preview"
        ],
        "manual_review_required": policy_classification_counts[
            "manual_review_required"
        ],
        "policy_blocked": policy_classification_counts["blocked"],
        "production_writes": len(new_edges) if write else 0,
    }
    metadata = policy_metadata(policy)
    result = {
        "promotion_type": "sec_candidate_promote",
        "candidate_file": display_path(candidate_path),
        "automation_policy": {
            "policy_file": display_path(policy_path),
            "policy_loaded": policy_loaded,
            "metadata": {
                "status": metadata.get("status"),
                "production_write_allowed": metadata.get("production_write_allowed"),
                "app_load_allowed": metadata.get("app_load_allowed"),
                "auto_promotion_enabled": metadata.get("auto_promotion_enabled"),
            },
        },
        "production_files": {
            "companies": display_path(companies_path),
            "connections": display_path(connections_path),
        },
        "summary": summary,
        "classification_counts": {
            classification: classification_counts[classification]
            for classification in CLASSIFICATION_ORDER
        },
        "policy_classification_counts": {
            classification: policy_classification_counts[classification]
            for classification in POLICY_CLASSIFICATION_ORDER
        },
        "records": records,
        "suppressed_duplicate_candidates": suppressed_duplicate_records,
        "new_edges": new_edges,
        "safety": {
            "network_calls": 0,
            "companies_written": 0,
            "connections_written": 1 if write and new_edges else 0,
            "production_writes": len(new_edges) if write else 0,
        },
    }

    if not isinstance(connections, list):
        raise PromotionError("production connections data must be a JSON array.")
    return result, connections, new_edges


def validate_merged_connections(connections: list[Any]) -> None:
    seen: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            raise PromotionError(f"merged connection {index} must be an object.")
        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if not (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            raise PromotionError(f"merged connection {index} has an invalid edge key.")
        key = edge_key(source, target, connection_type)
        if key in seen:
            raise PromotionError(
                f"merged connections would contain duplicate edge {source}-{target} "
                f"({connection_type})."
            )
        seen.add(key)


def print_human(result: dict[str, Any]) -> None:
    summary = result["summary"]
    print("SEC candidate promotion")
    print("=======================")
    print(f"Mode: {summary['mode']}")
    print(f"Candidate file: {result['candidate_file']}")
    print(f"Automation policy: {result['automation_policy']['policy_file']}")
    print(
        "Automation enabled: "
        f"{result['automation_policy']['metadata']['auto_promotion_enabled']}"
    )
    print(f"Production companies: {result['production_files']['companies']}")
    print(f"Production connections: {result['production_files']['connections']}")
    print(f"Total candidates: {summary['total_candidates']}")
    print(f"Unique candidate edges: {summary['unique_candidate_edges']}")
    print(f"Promotable new edges: {summary['promotable_edges']}")
    print(f"Blocked candidates: {summary['blocked_candidates']}")
    print(f"Duplicates suppressed: {summary['duplicates_suppressed']}")
    print(
        "Candidate duplicates suppressed: "
        f"{summary['candidate_duplicates_suppressed']}"
    )
    print(
        "Future auto-promotable previews: "
        f"{summary['future_auto_promotable_previews']}"
    )
    print(f"Manual review required: {summary['manual_review_required']}")
    print(f"Policy blocked: {summary['policy_blocked']}")
    print(f"Production writes: {summary['production_writes']}")

    print()
    print("Policy gate counts")
    print("------------------")
    for classification, count in result["policy_classification_counts"].items():
        print(f"- {classification}: {count}")

    print()
    print("New edges")
    print("---------")
    if not result["new_edges"]:
        print("none")
    for record in result["records"]:
        if record["classifications"] != ["promotable"]:
            continue
        edge = record["proposed_edge"]
        print(
            f"- candidate {record['index']}: "
            f"{record['source_ticker']}({edge['source']}) -> "
            f"{record['target_ticker']}({edge['target']}) "
            f"{edge['type']} strength={edge['strength']} "
            f"confidence={edge['confidence']} "
            f"verified_date={edge['verified_date']} "
            f"policy={record['policy_classification']}"
            + (
                f" ({', '.join(record['policy_reasons'])})"
                if record["policy_reasons"]
                else ""
            )
        )

    print()
    print("Blocked candidates")
    print("------------------")
    blocked = [
        record for record in result["records"]
        if record["classifications"] != ["promotable"]
    ]
    if not blocked:
        print("none")
    for record in blocked:
        print(
            f"- candidate {record['index']}: "
            f"{', '.join(record['classifications'])}; "
            f"policy={record['policy_classification']}"
            + (
                f" ({', '.join(record['policy_reasons'])})"
                if record["policy_reasons"]
                else ""
            )
        )

    print()
    print("Suppressed duplicate candidates")
    print("-------------------------------")
    suppressed = result["suppressed_duplicate_candidates"]
    if not suppressed:
        print("none")
    for record in suppressed:
        print(
            f"- candidate {record['index']}: "
            f"{record['source_ticker']} -> {record['target_ticker']} "
            f"{record['mapped_production_type']} "
            f"confidence={record['confidence_hint']} "
            f"kept=candidate {record['kept_candidate_index']}"
        )

    print()
    print("Safety")
    print("------")
    for key, value in result["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    candidate_path = resolve_path(args.candidates)
    policy_path = resolve_path(args.policy)
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)

    try:
        result, connections, new_edges = build_result(
            candidate_path=candidate_path,
            policy_path=policy_path,
            companies_path=companies_path,
            connections_path=connections_path,
            write=args.write,
        )
        if args.write and new_edges:
            merged_connections = [*connections, *new_edges]
            validate_merged_connections(merged_connections)
            write_json(connections_path, merged_connections)
            # Re-read immediately so a malformed write cannot go unnoticed.
            reloaded_connections = load_json(connections_path, "connections")
            if not isinstance(reloaded_connections, list):
                raise PromotionError("written connections file is not a JSON array.")
            validate_merged_connections(reloaded_connections)
    except PromotionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
