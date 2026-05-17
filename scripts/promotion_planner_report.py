#!/usr/bin/env python3
"""Generate review-only promotion planner artifacts.

The planner reads production data and candidate-company staging artifacts,
then writes only a simulation/report artifact under data/candidates when
--write is supplied. It never creates production companies, production edges,
relationships, ecosystem memberships, or promotion decisions.
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
DEFAULT_CANDIDATE_COMPANIES_PATH = ROOT / "data" / "candidates" / "candidate_companies.json"
DEFAULT_EXPANSION_BATCHES_PATH = ROOT / "data" / "candidates" / "universe_expansion_batches.json"
DEFAULT_SOURCE_GOVERNANCE_PATH = ROOT / "data" / "source_registry" / "source_governance_report.json"
DEFAULT_OUTPUT_PATH = ROOT / "data" / "candidates" / "promotion_planner_report.json"

PRODUCTION_DATA_PATHS = (
    DEFAULT_COMPANIES_PATH,
    DEFAULT_CONNECTIONS_PATH,
)

URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

REVIEWER_DECISION_STATES = {
    "pending_preview",
    "approved_for_preview",
    "approved_for_promotion_review",
    "blocked",
    "enrichment_only",
    "production_candidate",
    "deferred",
}

REVIEWER_DECISION_ALIASES = {
    "accepted_for_review": "pending_preview",
    "pending_reviewer_preview": "pending_preview",
    "pending_review": "pending_preview",
    "ready_for_preview": "pending_preview",
    "accepted_for_visibility": "approved_for_preview",
    "ready_for_promotion_review": "approved_for_promotion_review",
    "promotion_review": "approved_for_promotion_review",
    "weak_signal": "enrichment_only",
    "enrich_only": "enrichment_only",
}


class PromotionPlannerError(Exception):
    """Raised for clear promotion planner failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a review-only promotion planner report. Default mode "
            "prints a plan; pass --write to write data/candidates/"
            "promotion_planner_report.json."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--candidate-companies", default=str(DEFAULT_CANDIDATE_COMPANIES_PATH))
    parser.add_argument("--expansion-batches", default=str(DEFAULT_EXPANSION_BATCHES_PATH))
    parser.add_argument("--source-governance", default=str(DEFAULT_SOURCE_GOVERNANCE_PATH))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--write", action="store_true", help="Write the review-only planner artifact.")
    parser.add_argument("--force", action="store_true", help="Overwrite the output artifact when --write is used.")
    parser.add_argument("--json", action="store_true", help="Print report JSON to stdout.")
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


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise PromotionPlannerError(f"{display_path(path)} already exists; pass --force.")
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
            raise PromotionPlannerError(f"could not read production guard file {display_path(path)}: {exc}") from exc
    return hashes


def assert_production_unchanged(initial_hashes: dict[Path, str]) -> None:
    changed = [
        display_path(path)
        for path, initial_hash in initial_hashes.items()
        if hashlib.sha256(path.read_bytes()).hexdigest() != initial_hash
    ]
    if changed:
        raise PromotionPlannerError(f"production data changed unexpectedly: {', '.join(changed)}")


def safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def normalize_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def normalize_ticker(value: Any) -> str:
    return str(value or "").strip().upper()


def valid_urls(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if URL_PATTERN.match(text) and text not in seen:
            seen.add(text)
            urls.append(text)
    return urls


def host_for_url(url: str) -> str:
    try:
        return urlparse(url).hostname.replace("www.", "").lower()  # type: ignore[union-attr]
    except AttributeError:
        return ""


def source_urls(record: dict[str, Any]) -> list[str]:
    return valid_urls(
        [
            *safe_list(record.get("source_urls")),
            record.get("official_listing_source_url"),
            record.get("sec_submission_source_url"),
        ]
    )


def is_official_source(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").replace("www.", "").lower()
    path = f"{host}{parsed.path}".lower()
    return (
        host.endswith("sec.gov")
        or "data.sec.gov" in host
        or any(token in path for token in ("investor", "investors", "/ir/", "ir.", "sec-filings", "annual-report", "company_tickers_exchange", "submissions"))
    )


def assignment_keys(record: dict[str, Any], field: str, key: str) -> list[str]:
    values: list[str] = []
    for row in safe_list(record.get(field)):
        if isinstance(row, dict):
            value = str(row.get(key) or "").strip()
            if value:
                values.append(value)
    return sorted(set(values))


def batch_ids(record: dict[str, Any]) -> list[str]:
    return [str(value).strip() for value in safe_list(record.get("expansion_batch_ids")) if str(value).strip()]


def anchor_tickers(record: dict[str, Any]) -> list[str]:
    preview = record.get("preview") if isinstance(record.get("preview"), dict) else {}
    return sorted({normalize_ticker(value) for value in safe_list(preview.get("preview_anchor_tickers")) if normalize_ticker(value)})


def source_readiness(record: dict[str, Any]) -> dict[str, Any]:
    urls = source_urls(record)
    hosts = sorted({host_for_url(url) for url in urls if host_for_url(url)})
    official_urls = [url for url in urls if is_official_source(url)]
    sec_urls = [url for url in urls if host_for_url(url).endswith("sec.gov") or "data.sec.gov" in host_for_url(url)]
    summary = record.get("source_readiness_summary") if isinstance(record.get("source_readiness_summary"), dict) else {}
    has_official = bool(summary.get("has_official_listing_source") or official_urls)
    has_sec = bool(record.get("cik") or summary.get("has_sec_submission_source") or sec_urls)
    return {
        "source_urls": urls,
        "host_count": len(hosts),
        "hosts": hosts,
        "official_source_count": len(official_urls),
        "sec_source_count": len(sec_urls),
        "has_official_source": has_official,
        "has_sec_identity": has_sec,
        "has_cik": bool(record.get("cik")),
        "source_lifecycle_state": summary.get("source_lifecycle_state", "review_source_pending"),
        "weak_source": not has_official or not has_sec or len(urls) < 2,
    }


def duplicate_status(record: dict[str, Any], production_tickers: set[str]) -> dict[str, Any]:
    ticker = normalize_ticker(record.get("ticker"))
    alias_warnings = safe_list(record.get("alias_conflict_warnings"))
    duplicate_with_production = bool(record.get("duplicate_ticker_warning") or ticker in production_tickers)
    return {
        "duplicate_with_production": duplicate_with_production,
        "alias_conflict_count": len(alias_warnings),
        "duplicate_clear": not duplicate_with_production and not alias_warnings,
    }


def safety_blockers(record: dict[str, Any], source: dict[str, Any], duplicate: dict[str, Any]) -> list[str]:
    blockers = {normalize_key(value) for value in safe_list(record.get("blockers")) if normalize_key(value)}
    if not source["has_official_source"]:
        blockers.add("missing_official_source")
    if not source["has_sec_identity"]:
        blockers.add("missing_sec_identity")
    if duplicate["duplicate_with_production"]:
        blockers.add("duplicate_ticker_conflict")
    if duplicate["alias_conflict_count"]:
        blockers.add("alias_conflict_review")
    if not assignment_keys(record, "ecosystem_assignments", "ecosystem_key"):
        blockers.add("ecosystem_assignment_missing")
    if not assignment_keys(record, "corridor_assignments", "corridor_key"):
        blockers.add("corridor_assignment_missing")
    if not anchor_tickers(record):
        blockers.add("preview_anchor_missing")
    if record.get("production_write_allowed") is True:
        blockers.add("unsafe_production_write_flag")
    if record.get("auto_promotion_allowed") is True:
        blockers.add("unsafe_auto_promotion_flag")
    if record.get("relationship_authority") is True or record.get("ecosystem_membership_authority") is True:
        blockers.add("unsafe_authority_flag")
    return sorted(blockers)


def reviewer_state(record: dict[str, Any], blockers: list[str]) -> str:
    unsafe = {"duplicate_ticker_conflict", "alias_conflict_review", "unsafe_production_write_flag", "unsafe_auto_promotion_flag", "unsafe_authority_flag"}
    if unsafe.intersection(blockers):
        return "blocked"
    for field in ("reviewer_decision_state", "reviewer_state", "promotion_reviewer_state", "promotion_decision_state", "review_status", "readiness_state"):
        key = normalize_key(record.get(field))
        if key in REVIEWER_DECISION_STATES:
            return key
        if key in REVIEWER_DECISION_ALIASES:
            return REVIEWER_DECISION_ALIASES[key]
    return "pending_preview"


def normalize_score(value: Any, expected_max: float) -> int:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0
    if numeric <= 0:
        return 0
    if numeric <= 1:
        return max(0, min(100, round(numeric * 100)))
    return max(0, min(100, round((numeric / expected_max) * 100)))


def hub_score(record: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    hub = record.get("strategic_hub_preview") if isinstance(record.get("strategic_hub_preview"), dict) else {}
    corridor = normalize_score(hub.get("corridor_centrality_score"), 20)
    breadth = normalize_score(hub.get("ecosystem_breadth_score"), 20)
    bridge = normalize_score(hub.get("bridge_significance_score"), 20)
    source_backed = normalize_score(hub.get("source_backed_context_score", 0), 5)
    if not (source["has_official_source"] and source["has_sec_identity"]):
        source_backed = round(source_backed * 0.5)
    score = round(corridor * 0.28 + breadth * 0.22 + bridge * 0.32 + source_backed * 0.18)
    return {
        "score": max(0, min(100, score)),
        "strategic_hub_candidate": bool(hub.get("strategic_hub_candidate")),
        "corridor_centrality": corridor,
        "ecosystem_breadth": breadth,
        "bridge_significance": bridge,
        "source_backed_confidence": source_backed,
        "staged_hub_score": hub.get("staged_hub_score", 0),
    }


def review_completeness(record: dict[str, Any], state: str) -> int:
    score = 0
    if record.get("expansion_rationale"):
        score += 2
    if record.get("sector_proposal") and record.get("industry_group_proposal"):
        score += 2
    if assignment_keys(record, "ecosystem_assignments", "ecosystem_key"):
        score += 2
    if assignment_keys(record, "corridor_assignments", "corridor_key"):
        score += 2
    if record.get("readiness_state") == "ready_for_preview":
        score += 1
    if state != "pending_preview":
        score += 2
    return min(11, score)


def readiness_score(record: dict[str, Any], source: dict[str, Any], duplicate: dict[str, Any], hub: dict[str, Any], state: str, blockers: list[str]) -> dict[str, Any]:
    ecosystems = assignment_keys(record, "ecosystem_assignments", "ecosystem_key")
    corridors = assignment_keys(record, "corridor_assignments", "corridor_key")
    anchors = anchor_tickers(record)
    source_diversity = min(10, source["host_count"] * 4 + max(0, len(source["source_urls"]) - source["host_count"]))
    factors = [
        ("official_source_availability", 15 if source["has_official_source"] else 0, 15),
        ("sec_identity_support", 14 if source["has_sec_identity"] else 0, 14),
        ("duplicate_conflict_status", 14 if duplicate["duplicate_clear"] else 0, 14),
        ("corridor_usefulness", min(12, len(corridors) * 5 + min(2, len(anchors))), 12),
        ("ecosystem_usefulness", min(10, len(ecosystems) * 5), 10),
        ("strategic_hub_score", min(14, round(hub["score"] * 0.14)), 14),
        ("source_diversity", round(source_diversity), 10),
        ("review_completeness", review_completeness(record, state), 11),
    ]
    score = sum(points for _, points, _ in factors)
    if blockers:
        score = min(score, 58 if "missing_official_source" in blockers else 72)
    if not duplicate["duplicate_clear"]:
        score = min(score, 52)
    input_ready = score >= 80 and not blockers
    production_candidate_ready = input_ready and state in {"approved_for_promotion_review", "production_candidate"}
    return {
        "score": max(0, min(100, round(score))),
        "input_ready": input_ready,
        "production_candidate_ready": production_candidate_ready,
        "score_is_confidence": False,
        "automatic_promotion_allowed": False,
        "factors": [
            {"key": key, "points": points, "max": max_points}
            for key, points, max_points in factors
        ],
    }


def review_gates(readiness: dict[str, Any], state: str) -> list[str]:
    gates = []
    if state == "pending_preview":
        gates.append("reviewer_preview_decision_pending")
    if state == "approved_for_preview":
        gates.append("promotion_review_approval_pending")
    if readiness["input_ready"] and not readiness["production_candidate_ready"]:
        gates.append("manual_promotion_review_not_approved")
    gates.extend(["manual_promotion_required", "production_validation_required"])
    return sorted(set(gates))


def build_record(record: dict[str, Any], production_tickers: set[str]) -> dict[str, Any]:
    source = source_readiness(record)
    duplicate = duplicate_status(record, production_tickers)
    blockers = safety_blockers(record, source, duplicate)
    state = reviewer_state(record, blockers)
    hub = hub_score(record, source)
    readiness = readiness_score(record, source, duplicate, hub, state, blockers)
    return {
        "ticker": normalize_ticker(record.get("ticker")),
        "name": record.get("name", ""),
        "primary_batch_id": record.get("primary_batch_id") or (batch_ids(record)[0] if batch_ids(record) else "review"),
        "batch_ids": batch_ids(record),
        "ecosystem_keys": assignment_keys(record, "ecosystem_assignments", "ecosystem_key"),
        "corridor_keys": assignment_keys(record, "corridor_assignments", "corridor_key"),
        "preview_anchor_tickers": anchor_tickers(record),
        "preview_anchor_count": len(anchor_tickers(record)),
        "reviewer_decision_state": state,
        "readiness": readiness,
        "source_readiness": source,
        "duplicate_status": duplicate,
        "strategic_hub": hub,
        "blockers": blockers,
        "review_gates": review_gates(readiness, state),
        "review_only": True,
        "simulation_only": True,
        "production_write_allowed": False,
        "relationship_authority": False,
    }


def density_bucket(node_count: int, edge_count: int) -> dict[str, Any]:
    ratio = edge_count / max(1, node_count)
    if node_count > 160 or edge_count > 360 or ratio > 3.15:
        key = "very_dense"
    elif node_count > 100 or edge_count > 210 or ratio > 2.25:
        key = "dense"
    elif node_count > 70 or edge_count > 125 or ratio > 1.7:
        key = "growth"
    else:
        key = "core"
    return {"key": key, "node_count": node_count, "edge_count": edge_count, "ratio": round(ratio, 3)}


def simulation(records: list[dict[str, Any]], companies: list[dict[str, Any]], connections: list[dict[str, Any]]) -> dict[str, Any]:
    staged = [record for record in records if record["readiness"]["input_ready"]]
    projected_node_count = len(companies) + len(staged)
    preview_anchor_edge_count = sum(record["preview_anchor_count"] for record in staged)
    preview_edge_count = len(connections) + preview_anchor_edge_count
    density = density_bucket(projected_node_count, preview_edge_count)
    label_limit = 18 if density["key"] == "very_dense" else 24 if density["key"] == "dense" else 30 if density["key"] == "growth" else 42
    return {
        "production_node_count": len(companies),
        "production_edge_count": len(connections),
        "staged_node_count": len(staged),
        "projected_node_count": projected_node_count,
        "projected_edge_count": len(connections),
        "preview_anchor_edge_count": preview_anchor_edge_count,
        "preview_edge_count": preview_edge_count,
        "projected_edge_density": round(len(connections) / max(1, projected_node_count), 3),
        "density": density,
        "label_pressure": "high" if projected_node_count / max(1, label_limit) > 4.5 else "moderate" if projected_node_count / max(1, label_limit) > 2.8 else "low",
        "mobile_safety": "tight" if density["key"] == "very_dense" else "watch" if density["key"] == "dense" else "safe",
        "route_complexity": "very high" if density["key"] == "very_dense" else "high" if density["key"] == "dense" else "moderate" if density["key"] == "growth" else "normal",
        "hub_inflation_risk": "high" if sum(1 for record in staged if record["strategic_hub"]["strategic_hub_candidate"]) > 18 else "moderate" if sum(1 for record in staged if record["strategic_hub"]["strategic_hub_candidate"]) > 10 else "low",
        "top_ecosystem_impacts": Counter(key for record in staged for key in record["ecosystem_keys"]).most_common(8),
        "top_corridor_impacts": Counter(key for record in staged for key in record["corridor_keys"]).most_common(8),
        "simulation_only": True,
        "production_mutation": False,
        "relationship_creation": False,
    }


def batch_rows(records: list[dict[str, Any]], batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels = {str(batch.get("batch_id", "")): batch.get("label", batch.get("batch_id", "batch")) for batch in batches if isinstance(batch, dict)}
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["primary_batch_id"]].append(record)
    rows = []
    for batch_id, rows_for_batch in grouped.items():
        rows.append(
            {
                "batch_id": batch_id,
                "label": labels.get(batch_id, batch_id),
                "candidate_count": len(rows_for_batch),
                "input_ready_count": sum(1 for record in rows_for_batch if record["readiness"]["input_ready"]),
                "production_candidate_ready_count": sum(1 for record in rows_for_batch if record["readiness"]["production_candidate_ready"]),
                "blocked_count": sum(1 for record in rows_for_batch if record["blockers"]),
                "average_readiness_score": round(sum(record["readiness"]["score"] for record in rows_for_batch) / max(1, len(rows_for_batch))),
                "top_blockers": Counter(blocker for record in rows_for_batch for blocker in record["blockers"]).most_common(5),
                "review_only": True,
            }
        )
    return sorted(rows, key=lambda row: (-row["input_ready_count"], -row["average_readiness_score"], row["label"]))


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    companies = load_json(resolve_path(args.companies), [])
    connections = load_json(resolve_path(args.connections), [])
    candidate_payload = load_json(resolve_path(args.candidate_companies), {})
    batches_payload = load_json(resolve_path(args.expansion_batches), {})
    source_governance = load_json(resolve_path(args.source_governance), {})

    if not isinstance(companies, list) or not isinstance(connections, list):
        raise PromotionPlannerError("production companies and connections must be JSON arrays.")
    records_raw = safe_list(candidate_payload.get("records")) if isinstance(candidate_payload, dict) else []
    batches = []
    if isinstance(candidate_payload, dict):
        batches.extend(safe_list(candidate_payload.get("expansion_batches")))
    if isinstance(batches_payload, dict):
        batches.extend(safe_list(batches_payload.get("batches")))
    production_tickers = {normalize_ticker(company.get("ticker")) for company in companies if isinstance(company, dict)}
    records = [build_record(record, production_tickers) for record in records_raw if isinstance(record, dict)]
    input_ready = [record for record in records if record["readiness"]["input_ready"]]
    production_candidate_ready = [record for record in records if record["readiness"]["production_candidate_ready"]]
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    return {
        "metadata": {
            "artifact_status": "review_only",
            "generated_by": "scripts/promotion_planner_report.py",
            "generated_at_utc": generated_at,
            "production_write_allowed": False,
            "network_calls": 0,
            "output_path": display_path(resolve_path(args.output)),
        },
        "summary": {
            "candidate_count": len(records),
            "input_ready_count": len(input_ready),
            "production_candidate_ready_count": len(production_candidate_ready),
            "blocked_count": sum(1 for record in records if record["blockers"]),
            "average_readiness_score": round(sum(record["readiness"]["score"] for record in records) / max(1, len(records))),
            "source_governance_present": bool(source_governance),
            "review_only": True,
            "automatic_promotion_allowed": False,
        },
        "records": records,
        "batch_planning": batch_rows(records, batches),
        "graph_impact_simulation": simulation(records, companies, connections),
        "approved_state_simulation": simulation(production_candidate_ready, companies, connections),
        "source_readiness_summary": {
            "official_source_count": sum(1 for record in records if record["source_readiness"]["has_official_source"]),
            "sec_identity_count": sum(1 for record in records if record["source_readiness"]["has_sec_identity"]),
            "weak_source_count": sum(1 for record in records if record["source_readiness"]["weak_source"]),
            "strongest_official_source_candidates": [
                record["ticker"]
                for record in sorted(
                    [record for record in records if record["source_readiness"]["has_official_source"] and record["source_readiness"]["has_sec_identity"]],
                    key=lambda item: (-item["readiness"]["score"], item["ticker"]),
                )[:16]
            ],
        },
        "reviewer_lifecycle_summary": {
            "decision_counts": Counter(record["reviewer_decision_state"] for record in records).most_common(),
            "review_gate_counts": Counter(gate for record in records for gate in record["review_gates"]).most_common(),
            "blocker_counts": Counter(blocker for record in records for blocker in record["blockers"]).most_common(),
        },
        "safety": {
            "review_only": True,
            "simulation_only": True,
            "production_writes": 0,
            "companies_written": 0,
            "connections_written": 0,
            "auto_promotion_executed": False,
            "browser_ingestion": False,
            "relationship_creation": False,
            "ecosystem_assignment_authority": False,
        },
    }


def print_human(report: dict[str, Any], output_path: Path, write: bool) -> None:
    summary = report["summary"]
    simulation_row = report["graph_impact_simulation"]
    print("Promotion planner report")
    print("========================")
    print(f"Mode: {'write' if write else 'plan only'}")
    print(f"Output: {display_path(output_path)}")
    print(f"Candidates: {summary['candidate_count']}")
    print(f"Input-ready: {summary['input_ready_count']}")
    print(f"Production-candidate ready: {summary['production_candidate_ready_count']}")
    print(f"Projected nodes: {simulation_row['projected_node_count']}")
    print(f"Density forecast: {simulation_row['density']['key']}")
    print("Production writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    output_path = resolve_path(args.output)
    initial_hashes = production_hashes()
    try:
        report = build_report(args)
        assert_production_unchanged(initial_hashes)
        if args.write:
            write_json(output_path, report, force=args.force)
            assert_production_unchanged(initial_hashes)
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True))
        else:
            print_human(report, output_path, args.write)
    except PromotionPlannerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
