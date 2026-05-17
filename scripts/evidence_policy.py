#!/usr/bin/env python3
"""Shared review-only evidence policy helpers for StockPhotonic scripts."""

from __future__ import annotations

from collections import Counter
from typing import Any
from urllib.parse import urlparse


TIERS: dict[str, dict[str, Any]] = {
    "verified": {
        "key": "verified",
        "label": "Verified",
        "short_label": "VERIFIED",
        "rank": 4,
    },
    "strong_inferred": {
        "key": "strong_inferred",
        "label": "Strong inferred",
        "short_label": "STRONG",
        "rank": 3,
    },
    "context_only": {
        "key": "context_only",
        "label": "Context only",
        "short_label": "CONTEXT",
        "rank": 2,
    },
    "needs_review": {
        "key": "needs_review",
        "label": "Needs review",
        "short_label": "REVIEW",
        "rank": 1,
    },
}

REVIEWER_DECISION_STATES: dict[str, dict[str, Any]] = {
    "accepted_for_visibility": {
        "key": "accepted_for_visibility",
        "label": "Accepted for visibility",
        "short_label": "VISIBLE",
    },
    "accepted_for_review": {
        "key": "accepted_for_review",
        "label": "Accepted for review",
        "short_label": "REVIEW",
    },
    "blocked": {
        "key": "blocked",
        "label": "Blocked",
        "short_label": "BLOCKED",
    },
    "weak_signal": {
        "key": "weak_signal",
        "label": "Weak signal",
        "short_label": "WEAK",
    },
    "enrichment_only": {
        "key": "enrichment_only",
        "label": "Enrichment only",
        "short_label": "ENRICH",
    },
    "ready_for_promotion_review": {
        "key": "ready_for_promotion_review",
        "label": "Ready for promotion review",
        "short_label": "PROMO REVIEW",
    },
}

TRUSTED_CLASSES: dict[str, dict[str, Any]] = {
    "competitor": {
        "key": "competitor",
        "label": "Competitor",
        "short_label": "COMP",
        "safe_fast_track": True,
        "minimum_confidence": 3,
        "minimum_strength": 0.62,
        "keywords": ("competitor", "competition", "competes", "peer", "rival", "market structure"),
    },
    "ecosystem_overlap": {
        "key": "ecosystem_overlap",
        "label": "Ecosystem overlap",
        "short_label": "ECO",
        "safe_fast_track": True,
        "minimum_confidence": 4,
        "minimum_strength": 0.72,
        "keywords": ("ecosystem", "overlap", "same market", "shared market", "platform exposure"),
    },
    "supplier_ecosystem": {
        "key": "supplier_ecosystem",
        "label": "Supplier ecosystem",
        "short_label": "SUP ECO",
        "safe_fast_track": False,
        "minimum_confidence": 4,
        "minimum_strength": 0.78,
        "keywords": ("supplier", "supply", "customer", "vendor", "dependency", "supply chain"),
    },
    "cloud_hyperscaler_exposure": {
        "key": "cloud_hyperscaler_exposure",
        "label": "Cloud / hyperscaler exposure",
        "short_label": "CLOUD",
        "safe_fast_track": True,
        "minimum_confidence": 4,
        "minimum_strength": 0.70,
        "keywords": ("aws", "azure", "google cloud", "gcp", "oci", "cloud", "hyperscaler", "data center"),
    },
    "semiconductor_supply_chain": {
        "key": "semiconductor_supply_chain",
        "label": "Semiconductor supply chain",
        "short_label": "SEMI",
        "safe_fast_track": True,
        "minimum_confidence": 4,
        "minimum_strength": 0.70,
        "keywords": ("semiconductor", "foundry", "hbm", "memory", "lithography", "wafer", "fab", "gpu", "chip"),
    },
    "financial_infrastructure_overlap": {
        "key": "financial_infrastructure_overlap",
        "label": "Financial infrastructure overlap",
        "short_label": "FIN",
        "safe_fast_track": True,
        "minimum_confidence": 4,
        "minimum_strength": 0.68,
        "keywords": ("payment", "payments", "card", "issuer", "acquirer", "bank", "exchange", "asset manager", "financial infrastructure"),
    },
}


def clean_string(value: Any) -> str:
    return str(value or "").strip()


def normalize_text(value: Any) -> str:
    return clean_string(value).lower()


def normalize_key(value: Any) -> str:
    return normalize_text(value).replace("-", "_").replace(" ", "_")


def source_urls(record: dict[str, Any]) -> list[str]:
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    raw_values: list[Any] = []
    for source in (record, candidate):
        urls = source.get("source_urls")
        if isinstance(urls, list):
            raw_values.extend(urls)
        for key in ("archive_url", "source_url", "filing_url", "sec_url", "url"):
            raw_values.append(source.get(key))
    return sorted(
        {
            clean_string(value)
            for value in raw_values
            if clean_string(value).lower().startswith(("http://", "https://"))
        }
    )


def source_host(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""


def source_path(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.hostname or ''}{parsed.path or ''}".lower()


def confidence_score(record: dict[str, Any]) -> int | None:
    for key in ("confidence_score", "confidence", "confidence_hint"):
        value = record.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and value > 0:
            return round(value * 5) if value <= 1 else max(1, min(5, round(value)))
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    value = candidate.get("confidence_hint")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return round(value * 5) if value <= 1 else max(1, min(5, round(value)))
    return None


def strength_score(record: dict[str, Any]) -> float:
    value = record.get("strength")
    return max(0.0, min(1.0, float(value))) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def endpoint_text(company: dict[str, Any] | None) -> str:
    if not isinstance(company, dict):
        return ""
    return " ".join(
        normalize_text(company.get(key))
        for key in ("ticker", "name", "sector", "industry", "industryGroup", "industry_group")
    )


def relationship_text(
    record: dict[str, Any],
    source_company: dict[str, Any] | None = None,
    target_company: dict[str, Any] | None = None,
) -> str:
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    values = [
        record.get("relationship_type"),
        record.get("type"),
        record.get("raw_type"),
        record.get("label"),
        record.get("relationship_summary"),
        record.get("provenance"),
        record.get("source_label"),
        record.get("evidence_snippet"),
        record.get("source_type"),
        candidate.get("relationship_type"),
        candidate.get("evidence_snippet"),
        candidate.get("source"),
        candidate.get("review_status"),
        endpoint_text(source_company),
        endpoint_text(target_company),
    ]
    return " ".join(normalize_text(value) for value in values if normalize_text(value))


def is_candidate_record(record: dict[str, Any]) -> bool:
    status = normalize_text(record.get("source_status") or record.get("review_status"))
    candidate = record.get("candidate")
    return bool(
        record.get("isSecPreviewLink")
        or record.get("is_candidate_preview")
        or isinstance(candidate, dict)
        or status.startswith("pending")
        or "candidate" in status
    )


def is_openalex_context(record: dict[str, Any]) -> bool:
    values = [
        record.get("source"),
        record.get("source_type"),
        record.get("provider"),
        record.get("origin"),
        record.get("provenance"),
        record.get("relationship_type"),
        record.get("type"),
    ]
    tags = record.get("evidence_tags")
    if isinstance(tags, list):
        values.extend(tags)
    return "openalex" in " ".join(normalize_text(value) for value in values)


def is_sec_backed(record: dict[str, Any]) -> bool:
    text = relationship_text(record)
    return "sec filing" in text or any("sec.gov" in source_host(url) for url in source_urls(record))


def has_official_source(record: dict[str, Any]) -> bool:
    for url in source_urls(record):
        host = source_host(url)
        path = source_path(url)
        if host.endswith("sec.gov"):
            return True
        if any(
            token in path
            for token in (
                "investor",
                "investors",
                "/ir/",
                "shareholder",
                "sec-filings",
                "annual-report",
                "quarterly-results",
                "news-releases",
                "partner",
                "customer",
                "case-study",
                "press",
                "collaboration",
                "alliance",
            )
        ):
            return True
    return False


def evidence_count(record: dict[str, Any]) -> int:
    candidate = record.get("candidate") if isinstance(record.get("candidate"), dict) else {}
    return (
        len(source_urls(record))
        + int(bool(clean_string(record.get("evidence_snippet")) or clean_string(candidate.get("evidence_snippet"))))
        + int(bool(clean_string(record.get("source_label")) or clean_string(record.get("provenance"))))
    )


def trusted_relationship_class(
    record: dict[str, Any],
    source_company: dict[str, Any] | None = None,
    target_company: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    text = relationship_text(record, source_company, target_company)
    raw_type = normalize_key(record.get("relationship_type") or record.get("type"))
    endpoint_context = f"{endpoint_text(source_company)} {endpoint_text(target_company)}"

    ordered = [
        ("competitor", ("competitor", "competition", "peer")),
        ("cloud_hyperscaler_exposure", ("hyperscaler", "cloud")),
        ("semiconductor_supply_chain", ("semiconductor",)),
        ("financial_infrastructure_overlap", ("ownership", "capital", "financial")),
        ("supplier_ecosystem", ("supplier", "customer", "supply")),
        ("ecosystem_overlap", ("ecosystem",)),
    ]
    for key, raw_tokens in ordered:
        definition = TRUSTED_CLASSES[key]
        if (
            any(token in raw_type for token in raw_tokens)
            or any(keyword in text for keyword in definition["keywords"])
            or (key == "semiconductor_supply_chain" and "ai / semiconductors" in endpoint_context)
            or (key == "cloud_hyperscaler_exposure" and "cloud / big tech" in endpoint_context)
            or (key == "financial_infrastructure_overlap" and "payments / financial infrastructure" in endpoint_context)
        ):
            return {
                **definition,
                "reason": f"metadata fits {definition['label'].lower()}",
            }
    return None


def strong_inferred_eligible(
    record: dict[str, Any],
    trusted_class: dict[str, Any] | None,
) -> bool:
    if not trusted_class or not trusted_class.get("safe_fast_track"):
        return False
    if is_candidate_record(record) or is_openalex_context(record) or has_official_source(record):
        return False
    score = confidence_score(record) or 0
    strength = strength_score(record)
    return score >= int(trusted_class["minimum_confidence"]) or strength >= float(trusted_class["minimum_strength"])


def build_edge_policy(
    record: dict[str, Any],
    source_company: dict[str, Any] | None = None,
    target_company: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trusted_class = trusted_relationship_class(record, source_company, target_company)
    score = confidence_score(record)
    count = evidence_count(record)
    urls = source_urls(record)
    candidate = is_candidate_record(record)
    openalex = is_openalex_context(record)
    official = has_official_source(record)
    sec = is_sec_backed(record)
    strong = strong_inferred_eligible(record, trusted_class)

    tier = TIERS["needs_review"]
    decision = REVIEWER_DECISION_STATES["accepted_for_review"]
    explanation = "Review required before this relationship can be treated as production-quality evidence."

    if openalex:
        tier = TIERS["context_only"]
        decision = REVIEWER_DECISION_STATES["enrichment_only"]
        explanation = "Context-only OpenAlex enrichment; not relationship proof."
    elif candidate:
        tier = TIERS["needs_review"]
        ready = sec and bool(urls) and count > 0 and (score or 0) >= 4
        decision = REVIEWER_DECISION_STATES["ready_for_promotion_review" if ready else "accepted_for_review"]
        explanation = (
            "SEC-backed candidate evidence is ready for manual promotion review; promotion is still manual."
            if ready
            else "Candidate or preview evidence requires manual review before any production promotion."
        )
    elif official or sec or (urls and count > 0 and (score or 0) >= 4):
        tier = TIERS["verified"]
        decision = REVIEWER_DECISION_STATES["accepted_for_visibility"]
        explanation = "Verified SEC-backed production relationship." if sec else "Verified source-backed production relationship."
    elif strong:
        tier = TIERS["strong_inferred"]
        decision = REVIEWER_DECISION_STATES["accepted_for_visibility"]
        explanation = (
            f"Strong inferred {trusted_class['label'].lower()} relationship. "
            "Safe for graph visibility, not official partnership proof."
        )
    elif trusted_class or urls or count > 0:
        tier = TIERS["context_only"]
        decision = REVIEWER_DECISION_STATES["weak_signal" if trusted_class and trusted_class.get("safe_fast_track") else "accepted_for_review"]
        explanation = (
            f"Context-only {trusted_class['label'].lower()} signal; attach stronger sources before promotion claims."
            if trusted_class
            else "Context-only evidence signal; not enough for verified relationship status."
        )

    return {
        "evidence_tier": tier["key"],
        "evidence_tier_label": tier["label"],
        "evidence_tier_short_label": tier["short_label"],
        "evidence_tier_rank": tier["rank"],
        "trusted_relationship_class": trusted_class["key"] if trusted_class else None,
        "trusted_relationship_class_label": trusted_class["label"] if trusted_class else None,
        "trusted_relationship_class_reason": trusted_class.get("reason") if trusted_class else None,
        "trusted_relationship_fast_track": bool(trusted_class and trusted_class.get("safe_fast_track")),
        "reviewer_decision_state": decision["key"],
        "reviewer_decision_label": decision["label"],
        "fast_track_visibility": tier["key"] == "strong_inferred",
        "manual_promotion_allowed": False,
        "confidence_score": score,
        "source_count": len(urls),
        "evidence_count": count,
        "official_source": official,
        "sec_backed": sec,
        "explanation": explanation,
        "review_only": True,
    }


def source_search_query(
    row: dict[str, Any],
    policy: dict[str, Any],
    source_company: dict[str, Any] | None = None,
    target_company: dict[str, Any] | None = None,
) -> str:
    source = clean_string(source_company.get("ticker") if source_company else row.get("source_ticker"))
    target = clean_string(target_company.get("ticker") if target_company else row.get("target_ticker"))
    trusted = clean_string(policy.get("trusted_relationship_class_label"))
    return " ".join(part for part in (source, target, trusted, "company source relationship") if part)


def summarize_policies(policies: list[dict[str, Any]]) -> dict[str, Any]:
    tier_counts = Counter(policy.get("evidence_tier") or "needs_review" for policy in policies)
    class_counts = Counter(
        policy.get("trusted_relationship_class")
        for policy in policies
        if policy.get("trusted_relationship_class")
    )
    return {
        "tier_counts": dict(sorted(tier_counts.items())),
        "trusted_relationship_class_counts": dict(sorted(class_counts.items())),
        "fast_track_visibility_count": sum(1 for policy in policies if policy.get("fast_track_visibility")),
        "needs_review_count": tier_counts.get("needs_review", 0),
        "context_only_count": tier_counts.get("context_only", 0),
        "verified_count": tier_counts.get("verified", 0),
        "strong_inferred_count": tier_counts.get("strong_inferred", 0),
        "review_only": True,
    }
