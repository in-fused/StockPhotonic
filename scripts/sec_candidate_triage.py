#!/usr/bin/env python3
"""Build review-only SEC candidate triage artifacts.

This script reads candidate and production JSON files, derives clustering,
source quality, overlap, and reviewer action labels, and writes only review
artifacts when --write is passed. It never mutates production graph data.
"""

from __future__ import annotations

import argparse
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
DEFAULT_CANDIDATE_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"
DEFAULT_QUEUE_PATH = ROOT / "data" / "candidates" / "candidate_review_queue.json"
DEFAULT_SUMMARY_PATH = ROOT / "data" / "candidates" / "candidate_review_summary.json"
DEFAULT_OVERLAP_PATH = ROOT / "data" / "candidates" / "candidate_overlap_report.json"
DEFAULT_CHECKLIST_PATH = ROOT / "docs" / "candidate_reviewer_checklist.md"

URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SUPPORTED_CANDIDATE_RELATIONSHIP_TYPES = {
    "supplier_customer",
    "partnership",
    "investment",
    "competitor",
    "cloud_hyperscaler_ecosystem",
    "semiconductor_supply_chain",
    "ai_infrastructure",
    "data_center_power",
}
SUPPORTED_REVIEW_ACTIONS = {
    "ignore duplicate",
    "enrich existing edge",
    "review for promotion",
    "needs more evidence",
    "reject as weak signal",
}
SECONDARY_SOURCE_HOST_PATTERNS = (
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
    "cnbc.com",
    "marketwatch.com",
    "seekingalpha.com",
    "finance.yahoo.com",
    "nasdaq.com",
    "morningstar.com",
    "spglobal.com",
    "marketscreener.com",
    "annualreports.com",
)
IR_PATH_PATTERN = re.compile(
    r"(investor|investors|ir\.|/ir/|shareholder|sec-filings|financial-information|annual-report|quarterly-results|news-releases)",
    re.IGNORECASE,
)
PARTNER_PATH_PATTERN = re.compile(
    r"(partner|partners|customer|customers|case-study|case-studies|news|press|blog|project|solution|solutions|ecosystem|collaboration|alliance)",
    re.IGNORECASE,
)
PARTNERSHIP_TERMS = (
    "partnership",
    "strategic partnership",
    "collaboration",
    "joint venture",
    "joint development",
    "licensing",
    "search distribution",
)
SUPPLY_TERMS = (
    "supply agreement",
    "supplier",
    "supplies",
    "manufactured by",
    "manufactures for",
    "components sourced from",
    "component supplier",
    "foundry",
    "wafer supply",
)
INVESTMENT_TERMS = (
    "investment in",
    "equity investment",
    "ownership stake",
    "shares purchased",
    "beneficial ownership",
)
FINANCING_NOISE_TERMS = (
    "credit agreement",
    "credit facility",
    "loan agreement",
    "lending facility",
    "administrative agent",
    "certain banks",
)
CHECKLIST_ITEMS = (
    "Confirm source and target tickers resolve to the intended public companies.",
    "Read the filing snippet and SEC source before treating the candidate as evidence.",
    "Check whether the same pair already exists in production.",
    "Use enrich existing edge only when the candidate adds source URLs or clearer evidence.",
    "Reject credit-facility, exhibit-list, XBRL, and generic supplier/customer noise.",
    "Run promotion preview before any manual promotion.",
    "Run production validation after manual promotion.",
)


class CandidateTriageError(Exception):
    """Raised for clear triage failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate review-only SEC candidate queue, summary, overlap, and "
            "reviewer checklist artifacts. The command performs no network calls "
            "and never writes production graph data."
        )
    )
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATE_PATH))
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--queue", default=str(DEFAULT_QUEUE_PATH))
    parser.add_argument("--summary", default=str(DEFAULT_SUMMARY_PATH))
    parser.add_argument("--overlap", default=str(DEFAULT_OVERLAP_PATH))
    parser.add_argument("--checklist", default=str(DEFAULT_CHECKLIST_PATH))
    parser.add_argument("--write", action="store_true", help="Write review-only artifacts.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing artifact files.")
    parser.add_argument("--json", action="store_true", help="Print JSON summary.")
    args = parser.parse_args(argv)
    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
    return args


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise CandidateTriageError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise CandidateTriageError(f"could not parse {label} file {path}: {exc}") from exc


def write_json(path: Path, payload: Any, *, force: bool) -> None:
    if path.exists() and not force:
        raise CandidateTriageError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")


def write_text(path: Path, text: str, *, force: bool) -> None:
    if path.exists() and not force:
        raise CandidateTriageError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


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


def term_hits(text: str, terms: tuple[str, ...]) -> list[str]:
    text_lower = text.lower()
    hits: list[str] = []
    for term in terms:
        if " " in term:
            if term in text_lower:
                hits.append(term)
            continue
        if re.search(r"\b" + re.escape(term) + r"\b", text_lower):
            hits.append(term)
    return hits


def source_urls_from_candidate(candidate: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    for field_name in ("archive_url", "source_url", "filing_url", "sec_url", "url"):
        raw_url = candidate.get(field_name)
        if raw_url is not None:
            raw_urls.append(raw_url)
    source_urls = candidate.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)

    source_reference = candidate.get("source_reference")
    if isinstance(source_reference, dict):
        raw_urls.append(source_reference.get("archive_url"))

    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in raw_urls:
        url = clean_string(raw_url)
        if url is None or URL_PATTERN.match(url) is None:
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def source_host(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""


def classify_url(url: str) -> str:
    host = source_host(url)
    path = f"{host}{urlparse(url).path}".lower()
    if host == "sec.gov" or host.endswith(".sec.gov"):
        return "sec_filing"
    if any(host == pattern or host.endswith(f".{pattern}") for pattern in SECONDARY_SOURCE_HOST_PATTERNS):
        return "secondary_research"
    if IR_PATH_PATTERN.search(path):
        return "official_company"
    if PARTNER_PATH_PATTERN.search(path):
        return "official_partner_customer_page"
    return "other_url"


def source_quality(candidate: dict[str, Any]) -> dict[str, Any]:
    urls = source_urls_from_candidate(candidate)
    hosts = sorted({source_host(url) for url in urls if source_host(url)})
    categories = sorted({classify_url(url) for url in urls})
    if not categories and clean_string(candidate.get("source_type")) == "sec_filing":
        categories = ["sec_filing_pending_url"]
    if not categories:
        categories = ["candidate_only"]
    return {
        "source_urls": urls,
        "source_hosts": hosts,
        "source_host_categories": categories,
        "source_host_count": len(hosts),
        "source_url_count": len(urls),
        "source_diversity_count": len(categories),
        "sec_filing_source": clean_string(candidate.get("source_type")) == "sec_filing"
        or "sec_filing" in categories
        or "sec_filing_pending_url" in categories,
        "primary_source_category": categories[0],
    }


def freshness(candidate: dict[str, Any], today: datetime) -> dict[str, Any]:
    date_value = valid_date(candidate.get("filing_date")) or valid_date(
        candidate.get("verified_date")
    )
    if date_value is None:
        return {
            "date": None,
            "age_days": None,
            "state": "no_date",
        }
    parsed = datetime.fromisoformat(f"{date_value}T00:00:00+00:00")
    age_days = max(0, (today - parsed).days)
    if age_days > 365:
        state = "stale_review_recommended"
    elif age_days > 180:
        state = "aging_evidence"
    else:
        state = "recent_filing"
    return {
        "date": date_value,
        "age_days": age_days,
        "state": state,
    }


def snippet_text(candidate: dict[str, Any]) -> str:
    snippet = clean_string(candidate.get("evidence_snippet"))
    return snippet or ""


def evidence_phrase(candidate: dict[str, Any]) -> str:
    signal = clean_string(candidate.get("relationship_signal"))
    if signal:
        return signal.lower()
    snippet = snippet_text(candidate)
    for terms in (
        PARTNERSHIP_TERMS,
        SUPPLY_TERMS,
        INVESTMENT_TERMS,
        FINANCING_NOISE_TERMS,
    ):
        hits = term_hits(snippet, terms)
        if hits:
            return hits[0]
    return "unclassified evidence phrase"


def mapped_production_type(candidate: dict[str, Any]) -> str | None:
    relationship_type = clean_string(candidate.get("relationship_type"))
    if relationship_type is None:
        return None
    relationship_type = relationship_type.lower()
    snippet = snippet_text(candidate)
    if relationship_type == "supplier_customer":
        if term_hits(snippet, PARTNERSHIP_TERMS):
            return "partnership"
        if term_hits(snippet, SUPPLY_TERMS):
            return "supply"
        return None
    if relationship_type == "investment" or term_hits(snippet, INVESTMENT_TERMS):
        return "investment"
    if relationship_type == "competitor":
        return "competitor"
    if relationship_type in {
        "cloud_hyperscaler_ecosystem",
        "ai_infrastructure",
        "data_center_power",
    }:
        return "ecosystem"
    if relationship_type == "semiconductor_supply_chain":
        return "supply" if term_hits(snippet, SUPPLY_TERMS) else "ecosystem"
    if relationship_type == "partnership":
        return "partnership"
    return None


def candidate_is_financing_noise(candidate: dict[str, Any]) -> bool:
    snippet = snippet_text(candidate)
    return bool(term_hits(snippet, FINANCING_NOISE_TERMS)) and not bool(
        term_hits(snippet, INVESTMENT_TERMS)
    )


def validate_candidate_payload(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise CandidateTriageError("candidate file must contain a JSON object.")
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise CandidateTriageError("candidate file metadata must be an object.")
    if metadata.get("status") != "candidate_only":
        raise CandidateTriageError("candidate file metadata.status must be candidate_only.")
    if metadata.get("production_write_allowed") is not False:
        raise CandidateTriageError("candidate metadata.production_write_allowed must be false.")
    if metadata.get("app_load_allowed") is not False:
        raise CandidateTriageError("candidate metadata.app_load_allowed must be false.")

    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise CandidateTriageError("candidate file candidates must be a JSON array.")

    normalized: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise CandidateTriageError(f"candidate {index} must be an object.")
        source_ticker = normalize_ticker(candidate.get("source_ticker"))
        target_ticker = normalize_ticker(candidate.get("target_ticker"))
        relationship_type = clean_string(candidate.get("relationship_type"))
        if source_ticker is None:
            raise CandidateTriageError(f"candidate {index} source_ticker is required.")
        if target_ticker is None:
            raise CandidateTriageError(f"candidate {index} target_ticker is required.")
        if relationship_type not in SUPPORTED_CANDIDATE_RELATIONSHIP_TYPES:
            raise CandidateTriageError(
                f"candidate {index} relationship_type {relationship_type!r} is not supported."
            )
        for url in source_urls_from_candidate(candidate):
            if URL_PATTERN.match(url) is None:
                raise CandidateTriageError(f"candidate {index} has malformed source URL.")
        normalized.append(candidate)
    return normalized


def load_companies(path: Path) -> tuple[dict[str, int], dict[int, str]]:
    payload = load_json(path, "companies")
    if not isinstance(payload, list):
        raise CandidateTriageError("companies file must contain a JSON array.")
    ticker_to_id: dict[str, int] = {}
    id_to_ticker: dict[int, str] = {}
    for index, company in enumerate(payload):
        if not isinstance(company, dict):
            raise CandidateTriageError(f"company {index} must be an object.")
        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        if not isinstance(company_id, int) or isinstance(company_id, bool) or ticker is None:
            raise CandidateTriageError(f"company {index} has invalid id or ticker.")
        ticker_to_id[ticker] = company_id
        id_to_ticker[company_id] = ticker
    return ticker_to_id, id_to_ticker


def load_connections(path: Path, id_to_ticker: dict[int, str]) -> list[dict[str, Any]]:
    payload = load_json(path, "connections")
    if not isinstance(payload, list):
        raise CandidateTriageError("connections file must contain a JSON array.")
    rows: list[dict[str, Any]] = []
    for index, connection in enumerate(payload):
        if not isinstance(connection, dict):
            raise CandidateTriageError(f"connection {index} must be an object.")
        source = connection.get("source")
        target = connection.get("target")
        connection_type = clean_string(connection.get("type"))
        if not isinstance(source, int) or isinstance(source, bool):
            continue
        if not isinstance(target, int) or isinstance(target, bool):
            continue
        if connection_type is None:
            continue
        rows.append(
            {
                "index": index,
                "source_id": source,
                "target_id": target,
                "source_ticker": id_to_ticker.get(source),
                "target_ticker": id_to_ticker.get(target),
                "type": connection_type,
                "source_urls": connection.get("source_urls") if isinstance(connection.get("source_urls"), list) else [],
                "label": clean_string(connection.get("label")),
                "verified_date": clean_string(connection.get("verified_date")),
            }
        )
    return rows


def pair_key(source_ticker: str | None, target_ticker: str | None) -> tuple[str, str] | None:
    if source_ticker is None or target_ticker is None:
        return None
    return tuple(sorted((source_ticker, target_ticker)))


def production_pair_index(connections: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    index: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for connection in connections:
        key = pair_key(connection.get("source_ticker"), connection.get("target_ticker"))
        if key is not None:
            index[key].append(connection)
    return index


def build_cluster_maps(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[int, list[str]]]:
    cluster_inputs: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, candidate in enumerate(candidates, start=1):
        source_ticker = normalize_ticker(candidate.get("source_ticker")) or ""
        target_ticker = normalize_ticker(candidate.get("target_ticker")) or ""
        relationship_type = clean_string(candidate.get("relationship_type")) or "unknown"
        filing_form = clean_string(candidate.get("filing_form")) or clean_string(candidate.get("form")) or "unknown_form"
        quality = source_quality(candidate)
        phrase = evidence_phrase(candidate)

        cluster_inputs[("source_ticker", source_ticker)].append(index)
        cluster_inputs[("target_ticker", target_ticker)].append(index)
        cluster_inputs[("relationship_type", relationship_type)].append(index)
        cluster_inputs[("filing_form", filing_form)].append(index)
        cluster_inputs[("pair", f"{source_ticker}|{target_ticker}")].append(index)
        cluster_inputs[("pair_type", f"{source_ticker}|{target_ticker}|{relationship_type}")].append(index)
        cluster_inputs[("evidence_phrase", phrase)].append(index)
        for host in quality["source_hosts"]:
            cluster_inputs[("source_host", host)].append(index)
        for category in quality["source_host_categories"]:
            cluster_inputs[("source_host_category", category)].append(index)

    clusters: list[dict[str, Any]] = []
    memberships: dict[int, list[str]] = defaultdict(list)
    for cluster_number, ((cluster_type, key), indices) in enumerate(
        sorted(cluster_inputs.items(), key=lambda item: (item[0][0], item[0][1])),
        start=1,
    ):
        unique_indices = sorted(set(indices))
        if not unique_indices:
            continue
        cluster_id = f"{cluster_type}:{key}"
        repeated = len(unique_indices) > 1
        for candidate_index in unique_indices:
            memberships[candidate_index].append(cluster_id)
        clusters.append(
            {
                "cluster_id": cluster_id,
                "cluster_number": cluster_number,
                "cluster_type": cluster_type,
                "key": key,
                "candidate_indices": unique_indices,
                "candidate_count": len(unique_indices),
                "repeated_signal": repeated,
                "review_value": "repeated signal" if repeated else "one-off signal",
            }
        )
    return clusters, memberships


def overlap_state(
    candidate: dict[str, Any],
    existing_edges: list[dict[str, Any]],
    mapped_type: str | None,
) -> dict[str, Any]:
    existing_types = sorted({str(edge["type"]) for edge in existing_edges})
    missing_source_edges = [
        edge for edge in existing_edges
        if not edge.get("source_urls")
    ]
    if not existing_edges:
        state = "new_pair"
    elif mapped_type and mapped_type in existing_types:
        state = "exact_duplicate"
    else:
        state = "same_pair_different_type"

    can_enrich = bool(existing_edges and source_urls_from_candidate(candidate))
    return {
        "state": state,
        "existing_production_relationship_types": existing_types,
        "production_edges_missing_source_urls": len(missing_source_edges),
        "can_enrich_existing_edge": can_enrich,
    }


def evidence_count(candidate: dict[str, Any]) -> int:
    return len(source_urls_from_candidate(candidate)) + (1 if snippet_text(candidate) else 0)


def source_state(candidate: dict[str, Any], quality: dict[str, Any]) -> str:
    if "sec_filing" in quality["source_host_categories"]:
        return "sec_filing_url"
    if quality["sec_filing_source"]:
        return "sec_filing_pending_url"
    if quality["source_url_count"] > 0:
        return "source_url_attached"
    return "missing_source_url"


def recommended_action(
    *,
    candidate: dict[str, Any],
    overlap: dict[str, Any],
    confidence_hint: float | None,
    evidence_total: int,
    repeated_pair: bool,
) -> str:
    if candidate_is_financing_noise(candidate):
        return "reject as weak signal"
    if overlap["state"] == "exact_duplicate":
        return "enrich existing edge" if overlap["can_enrich_existing_edge"] else "ignore duplicate"
    if overlap["state"] == "same_pair_different_type":
        return "enrich existing edge" if overlap["can_enrich_existing_edge"] else "needs more evidence"
    if confidence_hint is None or confidence_hint < 0.75 or evidence_total == 0:
        return "needs more evidence"
    if repeated_pair or confidence_hint >= 0.88:
        return "review for promotion"
    return "needs more evidence"


def priority_for(action: str, confidence_hint: float | None, repeated_pair: bool) -> str:
    if action == "reject as weak signal":
        return "reject"
    if action in {"enrich existing edge", "review for promotion"}:
        return "high" if repeated_pair or (confidence_hint or 0) >= 0.88 else "medium"
    if action == "needs more evidence":
        return "medium" if repeated_pair else "low"
    return "low"


def build_artifacts(
    *,
    candidate_path: Path,
    companies_path: Path,
    connections_path: Path,
    queue_path: Path,
    summary_path: Path,
    overlap_path: Path,
    checklist_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], str]:
    candidate_payload = load_json(candidate_path, "candidates")
    candidates = validate_candidate_payload(candidate_payload)
    ticker_to_id, id_to_ticker = load_companies(companies_path)
    connections = load_connections(connections_path, id_to_ticker)
    pair_index = production_pair_index(connections)
    clusters, memberships = build_cluster_maps(candidates)
    repeated_pair_indices = {
        index
        for cluster in clusters
        if cluster["cluster_type"] in {"pair", "pair_type"} and cluster["candidate_count"] > 1
        for index in cluster["candidate_indices"]
    }
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)

    queue_records: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    enrichment_opportunities: list[dict[str, Any]] = []

    for index, candidate in enumerate(candidates, start=1):
        source_ticker = normalize_ticker(candidate.get("source_ticker"))
        target_ticker = normalize_ticker(candidate.get("target_ticker"))
        key = pair_key(source_ticker, target_ticker)
        existing_edges = pair_index.get(key, []) if key else []
        quality = source_quality(candidate)
        fresh = freshness(candidate, generated_at)
        mapped_type = mapped_production_type(candidate)
        overlap = overlap_state(candidate, existing_edges, mapped_type)
        confidence_hint = numeric_score(candidate.get("confidence_hint"))
        evidence_total = evidence_count(candidate)
        repeated_pair = index in repeated_pair_indices
        in_production_pair = bool(
            source_ticker in ticker_to_id
            and target_ticker in ticker_to_id
        )
        action = recommended_action(
            candidate=candidate,
            overlap=overlap,
            confidence_hint=confidence_hint,
            evidence_total=evidence_total,
            repeated_pair=repeated_pair,
        )
        if not in_production_pair and action == "review for promotion":
            action = "needs more evidence"
        priority = priority_for(action, confidence_hint, repeated_pair)
        state = source_state(candidate, quality)
        queue_id = f"sec-candidate-{index:04d}"
        source_reference = candidate.get("source_reference")
        if not isinstance(source_reference, dict):
            source_reference = {
                "source_type": clean_string(candidate.get("source_type")),
                "form": clean_string(candidate.get("filing_form")) or clean_string(candidate.get("form")),
                "filing_date": clean_string(candidate.get("filing_date")),
                "accession_number": clean_string(candidate.get("accession_number")),
                "archive_url": clean_string(candidate.get("archive_url")),
            }
            source_reference = {k: v for k, v in source_reference.items() if v}

        record = {
            "queue_id": queue_id,
            "candidate_index": index,
            "review_status": clean_string(candidate.get("review_status")) or "pending_review",
            "source_ticker": source_ticker,
            "target_ticker": target_ticker,
            "source_company_in_production": source_ticker in ticker_to_id if source_ticker else False,
            "target_company_in_production": target_ticker in ticker_to_id if target_ticker else False,
            "candidate_relationship_type": clean_string(candidate.get("relationship_type")),
            "mapped_production_type": mapped_type,
            "relationship_signal": clean_string(candidate.get("relationship_signal")),
            "confidence_hint": confidence_hint,
            "target_match_confidence": numeric_score(candidate.get("target_match_confidence")),
            "evidence_count": evidence_total,
            "evidence": {
                "snippet": snippet_text(candidate),
                "phrase": evidence_phrase(candidate),
                "source_reference": source_reference,
            },
            "source_quality": quality,
            "source_state": state,
            "freshness": fresh,
            "cluster_memberships": memberships.get(index, []),
            "overlap": overlap,
            "review_priority": priority,
            "recommended_reviewer_action": action,
            "review_only": True,
        }
        queue_records.append(record)
        comparison = {
            "source_ticker": source_ticker,
            "target_ticker": target_ticker,
            "candidate_relationship_type": record["candidate_relationship_type"],
            "existing_production_relationship_type": ", ".join(
                overlap["existing_production_relationship_types"]
            ) or None,
            "evidence_count": evidence_total,
            "source_state": state,
            "recommended_reviewer_action": action,
            "overlap_state": overlap["state"],
            "candidate_index": index,
        }
        comparisons.append(comparison)
        if overlap["can_enrich_existing_edge"]:
            enrichment_opportunities.append(comparison)

    production_missing_source = [
        {
            "connection_index": edge["index"],
            "source_ticker": edge["source_ticker"],
            "target_ticker": edge["target_ticker"],
            "relationship_type": edge["type"],
            "label": edge["label"],
        }
        for edge in connections
        if not edge.get("source_urls")
    ]
    action_counts = Counter(record["recommended_reviewer_action"] for record in queue_records)
    priority_counts = Counter(record["review_priority"] for record in queue_records)
    overlap_counts = Counter(record["overlap"]["state"] for record in queue_records)
    category_counts = Counter(
        category
        for record in queue_records
        for category in record["source_quality"]["source_host_categories"]
    )
    repeated_clusters = [cluster for cluster in clusters if cluster["candidate_count"] > 1]

    metadata = {
        "artifact_status": "review_only",
        "generated_by": "scripts/sec_candidate_triage.py",
        "generated_at_utc": generated_at.isoformat(),
        "candidate_file": display_path(candidate_path),
        "production_files_read": {
            "companies": display_path(companies_path),
            "connections": display_path(connections_path),
        },
        "production_write_allowed": False,
        "network_calls": 0,
    }
    queue_payload = {
        "metadata": metadata,
        "queue_count": len(queue_records),
        "records": queue_records,
        "safety": {
            "network_calls": 0,
            "production_writes": 0,
        },
    }
    summary_payload = {
        "metadata": metadata,
        "summary": {
            "total_candidates": len(candidates),
            "queue_count": len(queue_records),
            "high_priority_count": priority_counts["high"],
            "medium_priority_count": priority_counts["medium"],
            "low_priority_count": priority_counts["low"],
            "reject_priority_count": priority_counts["reject"],
            "exact_duplicate_candidates": overlap_counts["exact_duplicate"],
            "same_pair_different_type_candidates": overlap_counts["same_pair_different_type"],
            "new_pair_candidates": overlap_counts["new_pair"],
            "enrichment_opportunities": len(enrichment_opportunities),
            "production_edges_missing_source_urls": len(production_missing_source),
            "source_diversity_count": len(category_counts),
            "review_only": True,
        },
        "review_action_counts": dict(sorted(action_counts.items())),
        "review_priority_counts": dict(sorted(priority_counts.items())),
        "source_host_category_counts": dict(sorted(category_counts.items())),
        "clusters": clusters,
        "repeated_signal_clusters": repeated_clusters,
        "checklist_status": {
            "path": display_path(checklist_path),
            "total_items": len(CHECKLIST_ITEMS),
            "open_items": len(CHECKLIST_ITEMS),
            "complete_items": 0,
        },
        "safety": {
            "network_calls": 0,
            "production_writes": 0,
        },
    }
    overlap_payload = {
        "metadata": metadata,
        "summary": {
            "candidate_comparisons": len(comparisons),
            "exact_duplicates": overlap_counts["exact_duplicate"],
            "same_pair_different_type": overlap_counts["same_pair_different_type"],
            "new_pairs": overlap_counts["new_pair"],
            "enrichment_opportunities": len(enrichment_opportunities),
            "production_edges_missing_source_urls": len(production_missing_source),
        },
        "comparisons": comparisons,
        "candidate_enrichment_opportunities": enrichment_opportunities,
        "production_edges_missing_source_urls": production_missing_source,
        "safety": {
            "network_calls": 0,
            "production_writes": 0,
        },
    }
    checklist_text = build_checklist_markdown(
        queue_records=queue_records,
        summary=summary_payload,
        overlap=overlap_payload,
        generated_at=generated_at,
    )
    validate_artifacts(queue_payload, summary_payload, overlap_payload)
    return queue_payload, summary_payload, overlap_payload, checklist_text


def validate_artifacts(
    queue_payload: dict[str, Any],
    summary_payload: dict[str, Any],
    overlap_payload: dict[str, Any],
) -> None:
    for payload_name, payload in (
        ("queue", queue_payload),
        ("summary", summary_payload),
        ("overlap", overlap_payload),
    ):
        metadata = payload.get("metadata")
        if not isinstance(metadata, dict):
            raise CandidateTriageError(f"{payload_name} artifact metadata is required.")
        if metadata.get("artifact_status") != "review_only":
            raise CandidateTriageError(f"{payload_name} artifact must be review_only.")
        if metadata.get("production_write_allowed") is not False:
            raise CandidateTriageError(f"{payload_name} artifact cannot allow production writes.")

    records = queue_payload.get("records")
    if not isinstance(records, list):
        raise CandidateTriageError("queue records must be a list.")
    for record in records:
        if record.get("recommended_reviewer_action") not in SUPPORTED_REVIEW_ACTIONS:
            raise CandidateTriageError("queue record has unsupported reviewer action.")
        if normalize_ticker(record.get("source_ticker")) is None:
            raise CandidateTriageError("queue record missing source ticker.")
        if normalize_ticker(record.get("target_ticker")) is None:
            raise CandidateTriageError("queue record missing target ticker.")
        quality = record.get("source_quality")
        if not isinstance(quality, dict):
            raise CandidateTriageError("queue record missing source quality.")
        for url in quality.get("source_urls") or []:
            if not isinstance(url, str) or URL_PATTERN.match(url) is None:
                raise CandidateTriageError("queue record contains malformed source URL.")

    comparisons = overlap_payload.get("comparisons")
    if not isinstance(comparisons, list):
        raise CandidateTriageError("overlap comparisons must be a list.")
    for comparison in comparisons:
        if comparison.get("recommended_reviewer_action") not in SUPPORTED_REVIEW_ACTIONS:
            raise CandidateTriageError("overlap comparison has unsupported action.")


def build_checklist_markdown(
    *,
    queue_records: list[dict[str, Any]],
    summary: dict[str, Any],
    overlap: dict[str, Any],
    generated_at: datetime,
) -> str:
    high_priority = [
        record for record in queue_records
        if record["review_priority"] == "high"
    ]
    lines = [
        "# Candidate Reviewer Checklist",
        "",
        "Review-only artifact generated by `scripts/sec_candidate_triage.py`.",
        "",
        f"- Generated UTC: {generated_at.isoformat()}",
        f"- Candidates queued: {summary['summary']['queue_count']}",
        f"- High priority: {summary['summary']['high_priority_count']}",
        f"- Enrichment opportunities: {overlap['summary']['enrichment_opportunities']}",
        f"- Production edges missing source URLs: {overlap['summary']['production_edges_missing_source_urls']}",
        "",
        "## Required Checks",
        "",
    ]
    lines.extend(f"- [ ] {item}" for item in CHECKLIST_ITEMS)
    lines.extend(
        [
            "",
            "## High-Priority Candidates",
            "",
        ]
    )
    if not high_priority:
        lines.append("No high-priority candidates in the current queue.")
    for record in high_priority[:25]:
        lines.append(
            "- [ ] "
            f"{record['queue_id']}: {record['source_ticker']} -> {record['target_ticker']} "
            f"{record['candidate_relationship_type']} | action: {record['recommended_reviewer_action']}"
        )
    lines.extend(
        [
            "",
            "## Boundaries",
            "",
            "- Candidate artifacts are not production graph data.",
            "- Do not promote from this checklist directly.",
            "- Use promotion preview and validation before any manual production write.",
            "",
        ]
    )
    return "\n".join(lines)


def print_human(summary_payload: dict[str, Any], artifact_paths: dict[str, Path]) -> None:
    summary = summary_payload["summary"]
    print("SEC candidate triage artifacts")
    print("==============================")
    print(f"Candidates queued: {summary['queue_count']}")
    print(f"High priority: {summary['high_priority_count']}")
    print(f"Enrichment opportunities: {summary['enrichment_opportunities']}")
    print(f"Exact duplicates: {summary['exact_duplicate_candidates']}")
    print(f"Same-pair different-type: {summary['same_pair_different_type_candidates']}")
    print(f"Production edges missing source URLs: {summary['production_edges_missing_source_urls']}")
    print("Production writes: 0")
    print()
    print("Artifacts")
    print("---------")
    for label, path in artifact_paths.items():
        print(f"- {label}: {display_path(path)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    candidate_path = resolve_path(args.candidates)
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)
    queue_path = resolve_path(args.queue)
    summary_path = resolve_path(args.summary)
    overlap_path = resolve_path(args.overlap)
    checklist_path = resolve_path(args.checklist)

    artifact_paths = {
        "queue": queue_path,
        "summary": summary_path,
        "overlap": overlap_path,
        "checklist": checklist_path,
    }

    try:
        queue_payload, summary_payload, overlap_payload, checklist_text = build_artifacts(
            candidate_path=candidate_path,
            companies_path=companies_path,
            connections_path=connections_path,
            queue_path=queue_path,
            summary_path=summary_path,
            overlap_path=overlap_path,
            checklist_path=checklist_path,
        )
        if args.write:
            write_json(queue_path, queue_payload, force=args.force)
            write_json(summary_path, summary_payload, force=args.force)
            write_json(overlap_path, overlap_payload, force=args.force)
            write_text(checklist_path, checklist_text, force=args.force)
    except CandidateTriageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(
            {
                "summary": summary_payload["summary"],
                "artifact_paths": {key: display_path(path) for key, path in artifact_paths.items()},
                "safety": {"network_calls": 0, "production_writes": 0},
            },
            sys.stdout,
            indent=2,
            sort_keys=True,
        )
        print()
    else:
        print_human(summary_payload, artifact_paths)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
