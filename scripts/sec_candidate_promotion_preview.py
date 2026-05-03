#!/usr/bin/env python3
"""Preview SEC relationship candidates that could later become graph edges.

This tool is intentionally read-only. It inspects review-only SEC candidate
records against the current production graph files and prints a promotion
preview without modifying any data.
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

ALLOWED_PRODUCTION_TYPES = {
    "supply",
    "partnership",
    "ecosystem",
    "competitor",
    "investment",
}
LOW_CONFIDENCE_THRESHOLD = 0.70
TARGET_MATCH_CONFIDENCE_THRESHOLD = 0.85
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)

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
CLASSIFICATION_ORDER = (
    "promotable_preview",
    "missing_source_ticker",
    "missing_target_ticker",
    "missing_target_name",
    "low_target_match_confidence",
    "source_not_in_production",
    "target_not_in_production",
    "duplicate_existing_edge",
    "duplicate_candidate_edge",
    "unsupported_relationship_type",
    "missing_evidence",
    "low_confidence",
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


class PromotionPreviewError(Exception):
    """Raised for clear promotion preview failures."""


@dataclass(frozen=True)
class Company:
    company_id: int
    ticker: str
    name: str


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview which review-only SEC relationship candidates could later "
            "become production graph edges. The command reads candidate and "
            "production graph JSON files only and never writes data."
        )
    )
    parser.add_argument(
        "--candidates",
        default=str(DEFAULT_CANDIDATE_PATH),
        help=(
            "Review-only SEC relationship candidate file. "
            "Default: data/candidates/sec_relationship_candidates.json."
        ),
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
        help="Production connections file to read. Default: data/connections.json.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON preview payload.",
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
        raise PromotionPreviewError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PromotionPreviewError(
            f"could not parse {label} file {path}: {exc}"
        ) from exc


def validate_automation_policy(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise PromotionPreviewError("automation policy metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionPreviewError(
            "automation policy metadata.status must be candidate_only."
        )
    if metadata.get("production_write_allowed") is not False:
        raise PromotionPreviewError(
            "automation policy metadata.production_write_allowed must be false."
        )
    if metadata.get("app_load_allowed") is not False:
        raise PromotionPreviewError(
            "automation policy metadata.app_load_allowed must be false."
        )
    if metadata.get("auto_promotion_enabled") is not False:
        raise PromotionPreviewError(
            "automation policy metadata.auto_promotion_enabled must be false."
        )


def load_automation_policy(path: Path) -> tuple[dict[str, Any], bool]:
    if not path.exists():
        return DEFAULT_AUTOMATION_POLICY, False

    payload = load_json(path, "automation policy")
    if not isinstance(payload, dict):
        raise PromotionPreviewError("automation policy file must contain a JSON object.")
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


def validate_candidate_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise PromotionPreviewError("candidate file metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise PromotionPreviewError("candidate file metadata.status must be candidate_only.")
    if metadata.get("production_write_allowed") is not False:
        raise PromotionPreviewError(
            "candidate file metadata.production_write_allowed must be false."
        )
    if metadata.get("app_load_allowed") is not False:
        raise PromotionPreviewError(
            "candidate file metadata.app_load_allowed must be false."
        )


def load_candidate_payload(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = load_json(path, "candidate")
    if not isinstance(payload, dict):
        raise PromotionPreviewError("candidate file must contain a JSON object.")

    validate_candidate_metadata(payload)
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise PromotionPreviewError("candidate file candidates must be a JSON array.")

    normalized_candidates: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise PromotionPreviewError(f"candidate {index} must be an object.")
        normalized_candidates.append(candidate)
    return payload, normalized_candidates


def build_company_map(raw_companies: Any) -> dict[str, Company]:
    if not isinstance(raw_companies, list):
        raise PromotionPreviewError("production companies data must be a JSON array.")

    companies: dict[str, Company] = {}
    for index, company in enumerate(raw_companies):
        if not isinstance(company, dict):
            raise PromotionPreviewError(f"company {index} must be an object.")

        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        name = clean_string(company.get("name"))
        if not isinstance(company_id, int) or isinstance(company_id, bool):
            raise PromotionPreviewError(f"company {index} id must be an integer.")
        if ticker is None:
            raise PromotionPreviewError(f"company {company_id} ticker must be present.")
        if name is None:
            raise PromotionPreviewError(f"company {company_id} name must be present.")
        if ticker in companies:
            raise PromotionPreviewError(f"duplicate production ticker: {ticker}.")
        companies[ticker] = Company(company_id=company_id, ticker=ticker, name=name)
    return companies


def build_existing_edge_keys(raw_connections: Any) -> set[tuple[int, int, str]]:
    if not isinstance(raw_connections, list):
        raise PromotionPreviewError("production connections data must be a JSON array.")

    keys: set[tuple[int, int, str]] = set()
    for index, connection in enumerate(raw_connections):
        if not isinstance(connection, dict):
            raise PromotionPreviewError(f"connection {index} must be an object.")

        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if (
            isinstance(source, int)
            and not isinstance(source, bool)
            and isinstance(target, int)
            and not isinstance(target, bool)
            and connection_type
        ):
            keys.add((min(source, target), max(source, target), connection_type.lower()))
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

    if relationship_type in ALLOWED_PRODUCTION_TYPES:
        return relationship_type, f"direct:{relationship_type}"

    if relationship_type != "supplier_customer":
        return None, None

    supply_hits = term_hits(evidence, SUPPLY_TERMS)
    partnership_hits = term_hits(evidence, PARTNERSHIP_TERMS)

    if partnership_hits:
        return "partnership", "supplier_customer:evidence_partnership_terms"
    if supply_hits:
        return "supply", "supplier_customer:evidence_supply_terms"
    return None, None


def source_urls_from_candidate(candidate: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    source_urls = candidate.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)
    for field_name in ("source_url", "filing_url", "sec_url", "url"):
        value = candidate.get(field_name)
        if isinstance(value, str):
            raw_urls.append(value)

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


def unique_policy_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered.append(reason)
    return ordered


def missing_evidence_fields(candidate: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    if clean_string(candidate.get("evidence_snippet")) is None:
        missing.append("evidence_snippet")
    if valid_date(candidate.get("filing_date")) is None:
        missing.append("filing_date")
    if (
        clean_string(candidate.get("accession_number")) is None
        and not source_urls_from_candidate(candidate)
    ):
        missing.append("accession_number_or_source_url")
    return missing


def proposed_strength(candidate: dict[str, Any], confidence_hint: float) -> float:
    explicit_strength = numeric_score(candidate.get("strength"))
    if explicit_strength is not None:
        return round(explicit_strength, 2)
    return round(confidence_hint, 2)


def proposed_label(
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
) -> str:
    explicit_label = clean_string(candidate.get("label"))
    if explicit_label:
        return explicit_label
    return (
        f"SEC filing {connection_type} signal between "
        f"{source.ticker} and {target.ticker}"
    )


def proposed_provenance(candidate: dict[str, Any], source: Company) -> str:
    explicit_provenance = clean_string(candidate.get("provenance"))
    if explicit_provenance:
        return explicit_provenance

    parts = [f"SEC filing candidate preview from {source.ticker}"]
    accession_number = clean_string(candidate.get("accession_number"))
    filing_date = clean_string(candidate.get("filing_date"))
    if accession_number:
        parts.append(f"accession {accession_number}")
    if filing_date:
        parts.append(f"filed {filing_date}")
    return "; ".join(parts)


def proposed_confidence(edge: dict[str, Any]) -> int:
    has_source_urls = bool(edge.get("source_urls"))
    connection_type = edge.get("type")
    strength = edge.get("strength")

    if has_source_urls:
        return 5 if connection_type in {"supply", "partnership", "investment"} else 4
    if connection_type == "supply" and isinstance(strength, float) and strength >= 0.75:
        return 4
    return 3


def build_proposed_edge(
    candidate: dict[str, Any],
    source: Company,
    target: Company,
    connection_type: str,
    confidence_hint: float,
) -> dict[str, Any]:
    verified_date = valid_date(candidate.get("verified_date")) or valid_date(
        candidate.get("filing_date")
    )
    edge = {
        "source": source.company_id,
        "target": target.company_id,
        "type": connection_type,
        "strength": proposed_strength(candidate, confidence_hint),
        "label": proposed_label(candidate, source, target, connection_type),
        "confidence": 3,
        "provenance": proposed_provenance(candidate, source),
        "source_urls": source_urls_from_candidate(candidate),
        "verified_date": verified_date,
    }
    edge["confidence"] = proposed_confidence(edge)
    return edge


def unique_reasons(reasons: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for classification in CLASSIFICATION_ORDER:
        if classification == "promotable_preview":
            continue
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
    target_name = clean_string(candidate.get("target_name"))
    target_match_confidence = numeric_score(candidate.get("target_match_confidence"))

    source_company: Company | None = None
    target_company: Company | None = None
    duplicate_existing_edge = False
    conflicting_existing_edge = False

    if source_ticker is None:
        reasons.append("missing_source_ticker")
    else:
        source_company = ticker_to_company.get(source_ticker)
        if source_company is None:
            reasons.append("source_not_in_production")

    if target_ticker is None:
        reasons.append("missing_target_ticker")
    else:
        if target_name is None:
            reasons.append("missing_target_name")
        if (
            target_match_confidence is None
            or target_match_confidence < TARGET_MATCH_CONFIDENCE_THRESHOLD
        ):
            reasons.append("low_target_match_confidence")
        target_company = ticker_to_company.get(target_ticker)
        if target_company is None:
            reasons.append("target_not_in_production")

    mapped_type, mapping_rule = map_relationship_type(candidate)
    if mapped_type is None:
        reasons.append("unsupported_relationship_type")

    evidence_missing = missing_evidence_fields(candidate)
    if evidence_missing:
        reasons.append("missing_evidence")

    confidence_hint = numeric_score(candidate.get("confidence_hint"))
    if confidence_hint is None or confidence_hint < LOW_CONFIDENCE_THRESHOLD:
        reasons.append("low_confidence")

    if source_company and target_company and mapped_type:
        pair_types = existing_pair_types(
            existing_edge_keys,
            source_company.company_id,
            target_company.company_id,
        )
        edge_key = (
            min(source_company.company_id, target_company.company_id),
            max(source_company.company_id, target_company.company_id),
            mapped_type,
        )
        if edge_key in existing_edge_keys:
            reasons.append("duplicate_existing_edge")
            duplicate_existing_edge = True
        elif pair_types:
            conflicting_existing_edge = True

    blocked_reasons = unique_reasons(reasons)
    classifications = blocked_reasons if blocked_reasons else ["promotable_preview"]
    proposed_edge = None
    if not blocked_reasons and source_company and target_company and mapped_type and confidence_hint is not None:
        proposed_edge = build_proposed_edge(
            candidate,
            source_company,
            target_company,
            mapped_type,
            confidence_hint,
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
        "classifications": classifications,
        "evidence_missing_fields": evidence_missing,
        "confidence_hint": confidence_hint,
        "source_urls": source_urls_from_candidate(candidate),
        "policy_classification": policy_result["classification"],
        "policy_reasons": policy_result["reasons"],
        "proposed_edge": proposed_edge,
    }


def candidate_pair_key(record: dict[str, Any]) -> tuple[Any, ...] | None:
    source_id = record.get("source_company_id")
    target_id = record.get("target_company_id")
    if (
        isinstance(source_id, int)
        and not isinstance(source_id, bool)
        and isinstance(target_id, int)
        and not isinstance(target_id, bool)
    ):
        return ("company_ids", min(source_id, target_id), max(source_id, target_id))

    source_ticker = clean_string(record.get("source_ticker"))
    target_ticker = clean_string(record.get("target_ticker"))
    if source_ticker and target_ticker:
        return ("tickers", *sorted((source_ticker.upper(), target_ticker.upper())))
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
    is_promotable = 1 if classifications == ["promotable_preview"] else 0
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
        "status": "kept_strongest_candidate_pair",
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
        proposed_edge["confidence"] = proposed_confidence(proposed_edge)
    return winner


def deduplicate_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    ungrouped: list[dict[str, Any]] = []
    for record in records:
        key = candidate_pair_key(record)
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
                    "suppression_reason": "weaker_duplicate_candidate_pair",
                }
            )

    unique_records.sort(key=lambda record: int(record.get("index") or 0))
    suppressed_records.sort(key=lambda record: int(record.get("index") or 0))
    return unique_records, suppressed_records


def build_preview(
    *,
    candidate_path: Path,
    policy_path: Path,
    companies_path: Path,
    connections_path: Path,
) -> dict[str, Any]:
    _, candidates = load_candidate_payload(candidate_path)
    policy, policy_loaded = load_automation_policy(policy_path)
    ticker_to_company = build_company_map(load_json(companies_path, "companies"))
    existing_edge_keys = build_existing_edge_keys(
        load_json(connections_path, "connections")
    )

    inspected_records = [
        inspect_candidate(
            candidate,
            index=index,
            ticker_to_company=ticker_to_company,
            existing_edge_keys=existing_edge_keys,
            policy=policy,
        )
        for index, candidate in enumerate(candidates, start=1)
    ]
    records, suppressed_duplicate_records = deduplicate_records(inspected_records)

    classification_counts: Counter[str] = Counter()
    policy_classification_counts: Counter[str] = Counter()
    for record in records:
        classification_counts.update(record["classifications"])
        policy_classification_counts.update([record["policy_classification"]])
    classification_counts.update(
        ["duplicate_candidate_edge"] * len(suppressed_duplicate_records)
    )

    promotable_count = classification_counts["promotable_preview"]
    duplicate_count = (
        classification_counts["duplicate_existing_edge"]
        + classification_counts["duplicate_candidate_edge"]
    )
    summary = {
        "total_candidates": len(candidates),
        "unique_candidate_pairs": len(records),
        "promotable_previews": promotable_count,
        "blocked_count": len(candidates) - promotable_count,
        "duplicate_count": duplicate_count,
        "candidate_duplicates_suppressed": len(suppressed_duplicate_records),
        "future_auto_promotable_previews": policy_classification_counts[
            "future_auto_promotable_preview"
        ],
        "manual_review_required": policy_classification_counts[
            "manual_review_required"
        ],
        "policy_blocked": policy_classification_counts["blocked"],
        "production_writes": 0,
    }
    metadata = policy_metadata(policy)

    return {
        "preview_type": "sec_candidate_promotion_preview",
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
        "production_files_read": {
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
        "safety": {
            "network_calls": 0,
            "production_writes": 0,
        },
    }


def print_human(preview: dict[str, Any]) -> None:
    summary = preview["summary"]
    print("SEC candidate promotion preview")
    print("===============================")
    print(f"Candidate file: {preview['candidate_file']}")
    print(f"Automation policy: {preview['automation_policy']['policy_file']}")
    print(
        "Automation enabled: "
        f"{preview['automation_policy']['metadata']['auto_promotion_enabled']}"
    )
    print(f"Production companies read: {preview['production_files_read']['companies']}")
    print(f"Production connections read: {preview['production_files_read']['connections']}")
    print(f"Total candidates: {summary['total_candidates']}")
    print(f"Unique candidate pairs: {summary['unique_candidate_pairs']}")
    print(f"Promotable previews: {summary['promotable_previews']}")
    print(f"Blocked count: {summary['blocked_count']}")
    print(f"Duplicate count: {summary['duplicate_count']}")
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
    print("Classification counts")
    print("---------------------")
    for classification, count in preview["classification_counts"].items():
        print(f"- {classification}: {count}")

    print()
    print("Policy gate counts")
    print("------------------")
    for classification, count in preview["policy_classification_counts"].items():
        print(f"- {classification}: {count}")

    print()
    print("Promotable preview edges")
    print("------------------------")
    promotable_records = [
        record for record in preview["records"]
        if record["classifications"] == ["promotable_preview"]
    ]
    if not promotable_records:
        print("none")
    for record in promotable_records:
        print(f"candidate {record['index']}:")
        print(
            "policy: "
            f"{record['policy_classification']}"
            + (
                f" ({', '.join(record['policy_reasons'])})"
                if record["policy_reasons"]
                else ""
            )
        )
        print(json.dumps(record["proposed_edge"], indent=2, sort_keys=True))

    blocked_records = [
        record for record in preview["records"]
        if record["classifications"] != ["promotable_preview"]
    ]
    print()
    print("Blocked candidates")
    print("------------------")
    if not blocked_records:
        print("none")
    for record in blocked_records:
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
    suppressed_records = preview["suppressed_duplicate_candidates"]
    if not suppressed_records:
        print("none")
    for record in suppressed_records:
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
    print("- network_calls: 0")
    print("- production_writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    candidate_path = resolve_path(args.candidates)
    policy_path = resolve_path(args.policy)
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)

    try:
        preview = build_preview(
            candidate_path=candidate_path,
            policy_path=policy_path,
            companies_path=companies_path,
            connections_path=connections_path,
        )
    except PromotionPreviewError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(preview, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
