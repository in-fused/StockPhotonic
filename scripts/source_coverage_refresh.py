#!/usr/bin/env python3
"""Build a review-only source coverage refresh report.

This helper expands the D142 preflight output into a reviewer priority queue.
It reads production data and candidate/preflight artifacts, but never mutates
production companies or connections.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_expansion_preflight import (  # type: ignore
    DEFAULT_CANDIDATES_PATH,
    DEFAULT_COMPANIES_PATH,
    DEFAULT_CONNECTIONS_PATH,
    DEFAULT_REVIEW_QUEUE_PATH,
    DEFAULT_REVIEW_SUMMARY_PATH,
    PreflightError,
    build_report,
    display_path,
    resolve_path,
)
from evidence_policy import source_search_query  # type: ignore


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = ROOT / "data" / "candidates" / "source_coverage_refresh_report.json"
PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)
FAST_TRACK_TARGET_LIMIT = 48
REVIEW_QUEUE_SOURCE_GAP_LIMIT = 40

CORRIDOR_LANE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "ai_compute_foundry_cloud": {
        "label": "AI compute -> foundry -> cloud",
        "keywords": ("ai", "gpu", "accelerator", "hbm", "foundry", "cloud", "data center", "custom silicon"),
    },
    "payment_network_bank": {
        "label": "Payment network -> banks",
        "keywords": ("payment", "card", "issuer", "bank", "credit", "network"),
    },
    "pbm_pharma_insurance": {
        "label": "PBM -> pharma -> insurance",
        "keywords": ("pbm", "pharma", "pharmaceutical", "reimbursement", "formulary", "managed care", "insurance"),
    },
    "oilfield_energy_majors": {
        "label": "Oilfield services -> energy majors",
        "keywords": ("oilfield", "oil", "gas", "upstream", "energy", "pipeline"),
    },
    "aerospace_supplier_oem": {
        "label": "Aerospace suppliers -> OEMs",
        "keywords": ("aerospace", "aircraft", "engine", "avionics", "defense", "boeing", "oem"),
    },
    "enterprise_saas_cloud": {
        "label": "Enterprise SaaS -> cloud platforms",
        "keywords": ("saas", "workflow", "crm", "data platform", "cloud security", "enterprise software"),
    },
    "consumer_retail_distribution": {
        "label": "Retail -> consumer distribution",
        "keywords": ("retail", "warehouse", "grocery", "restaurant", "beverage", "e-commerce", "consumer"),
    },
}
CORRIDOR_LANE_PRIORITY = (
    "payment_network_bank",
    "pbm_pharma_insurance",
    "oilfield_energy_majors",
    "aerospace_supplier_oem",
    "enterprise_saas_cloud",
    "consumer_retail_distribution",
    "ai_compute_foundry_cloud",
)


class SourceCoverageRefreshError(Exception):
    """Raised for clear source coverage refresh failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a review-only source coverage refresh report with "
            "reviewer priority queues. Performs no network calls and no "
            "production writes."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATES_PATH))
    parser.add_argument("--review-summary", default=str(DEFAULT_REVIEW_SUMMARY_PATH))
    parser.add_argument("--review-queue", default=str(DEFAULT_REVIEW_QUEUE_PATH))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--write", action="store_true", help="Write the review-only report.")
    parser.add_argument("--force", action="store_true", help="Overwrite the report when --write is used.")
    parser.add_argument("--json", action="store_true", help="Print report JSON.")
    args = parser.parse_args(argv)
    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
    return args


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise SourceCoverageRefreshError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise SourceCoverageRefreshError(
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
        raise SourceCoverageRefreshError(
            "production data changed during source coverage refresh: "
            f"{', '.join(changed)}"
        )


def weak_relationship_categories(preflight: dict[str, Any]) -> list[dict[str, Any]]:
    rows = preflight.get("relationship_type_source_gaps")
    if not isinstance(rows, list):
        return []
    weak_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        total = int(row.get("total_edges") or 0)
        unsourced = int(row.get("unsourced_edges") or 0)
        sourced_ratio = float(row.get("sourced_ratio") or 0)
        if unsourced <= 0:
            continue
        weak_rows.append(
            {
                "relationship_type": row.get("relationship_type"),
                "total_edges": total,
                "unsourced_edges": unsourced,
                "sourced_ratio": round(sourced_ratio, 4),
                "priority": "high" if unsourced >= 10 or sourced_ratio < 0.5 else "medium",
                "review_only": True,
            }
        )
    return sorted(
        weak_rows,
        key=lambda row: (
            {"high": 2, "medium": 1}.get(str(row["priority"]), 0),
            int(row["unsourced_edges"]),
            str(row["relationship_type"]),
        ),
        reverse=True,
    )


def ecosystem_gap_rows(preflight: dict[str, Any]) -> list[dict[str, Any]]:
    rows = preflight.get("high_value_unsourced_edges")
    if not isinstance(rows, list):
        return []
    keyword_groups = {
        "ai_infrastructure": ("ai", "gpu", "data center", "accelerator", "cloud"),
        "semiconductor_supply_chain": ("semiconductor", "chip", "wafer", "foundry", "memory"),
        "healthcare_biotech": ("pharma", "biotech", "clinical", "drug", "therapy"),
        "energy_infrastructure": ("energy", "power", "grid", "pipeline", "oil", "gas"),
        "financial_market_infrastructure": ("bank", "payment", "exchange", "asset", "financial"),
    }
    gaps: Counter[str] = Counter()
    samples: dict[str, list[dict[str, Any]]] = {key: [] for key in keyword_groups}
    for row in rows:
        if not isinstance(row, dict):
            continue
        text = " ".join(
            str(row.get(field) or "").lower()
            for field in ("relationship_type", "label", "source_ticker", "target_ticker")
        )
        for ecosystem, keywords in keyword_groups.items():
            if any(keyword in text for keyword in keywords):
                gaps[ecosystem] += 1
                if len(samples[ecosystem]) < 5:
                    samples[ecosystem].append(
                        {
                            "connection_index": row.get("connection_index"),
                            "source_ticker": row.get("source_ticker"),
                            "target_ticker": row.get("target_ticker"),
                            "relationship_type": row.get("relationship_type"),
                            "priority": row.get("priority"),
                        }
                    )
    return [
        {
            "ecosystem_key": ecosystem,
            "unsourced_high_value_count": count,
            "sample_edges": samples.get(ecosystem, []),
            "review_only": True,
        }
        for ecosystem, count in sorted(gaps.items(), key=lambda item: (-item[1], item[0]))
    ]


def build_reviewer_priority_queue(preflight: dict[str, Any]) -> list[dict[str, Any]]:
    queue: list[dict[str, Any]] = []
    for row in (preflight.get("high_value_unsourced_edges") or [])[:REVIEW_QUEUE_SOURCE_GAP_LIMIT]:
        if not isinstance(row, dict):
            continue
        fast_track = bool(row.get("fast_track_visibility"))
        queue.append(
            {
                "queue_id": f"source-gap-{row.get('connection_index')}",
                "queue_type": "fast_track_source_coverage_target" if fast_track else "production_edge_missing_source_url",
                "priority": "source" if fast_track else row.get("priority") or "review",
                "source_ticker": row.get("source_ticker"),
                "target_ticker": row.get("target_ticker"),
                "relationship_type": row.get("relationship_type"),
                "reason": "Strong inferred relationship remains visibility-safe; enrich sources without manual-promotion pressure."
                if fast_track
                else "High-value production edge lacks source URLs.",
                "evidence_tier": row.get("evidence_tier"),
                "trusted_relationship_class": row.get("trusted_relationship_class"),
                "reviewer_decision_state": row.get("reviewer_decision_state"),
                "fast_track_visibility": fast_track,
                "source_search_query": row.get("source_search_query"),
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )

    blockers = preflight.get("candidate_promotion_blockers")
    samples = blockers.get("sample_blockers") if isinstance(blockers, dict) else []
    if isinstance(samples, list):
        for sample in samples[:12]:
            if not isinstance(sample, dict):
                continue
            queue.append(
                {
                    "queue_id": f"candidate-blocker-{sample.get('candidate_index')}",
                    "queue_type": "candidate_promotion_blocker",
                    "priority": "high" if "missing_production_ticker" in (sample.get("blockers") or []) else "medium",
                    "source_ticker": sample.get("source_ticker"),
                    "target_ticker": sample.get("target_ticker"),
                    "relationship_type": sample.get("relationship_type"),
                    "reason": ", ".join(sample.get("blockers") or []) or "Candidate blocker requires review.",
                    "review_only": True,
                }
            )
    return queue


def fast_track_source_targets(preflight: dict[str, Any]) -> list[dict[str, Any]]:
    rows = preflight.get("fast_track_source_targets")
    if not isinstance(rows, list):
        rows = [
            row for row in (preflight.get("high_value_unsourced_edges") or [])
            if isinstance(row, dict) and row.get("fast_track_visibility")
        ]
    targets: list[dict[str, Any]] = []
    for row in rows[:FAST_TRACK_TARGET_LIMIT]:
        if not isinstance(row, dict):
            continue
        targets.append(
            {
                "queue_id": f"fast-track-source-{row.get('connection_index')}",
                "source_ticker": row.get("source_ticker"),
                "target_ticker": row.get("target_ticker"),
                "relationship_type": row.get("relationship_type"),
                "evidence_tier": row.get("evidence_tier") or "strong_inferred",
                "trusted_relationship_class": row.get("trusted_relationship_class"),
                "trusted_relationship_class_label": row.get("trusted_relationship_class_label"),
                "priority": "source",
                "reason": "Fast-track source coverage target; graph visibility remains strong-inferred until source-backed.",
                "source_search_query": row.get("source_search_query")
                or source_search_query(row, {"trusted_relationship_class_label": row.get("trusted_relationship_class_label")}),
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )
    return targets


def source_expansion_batches(preflight: dict[str, Any], targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for target in targets:
        key = str(target.get("trusted_relationship_class") or "unclassified")
        grouped.setdefault(key, []).append(target)

    batches: list[dict[str, Any]] = []
    for key, rows in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        label = str(rows[0].get("trusted_relationship_class_label") or key.replace("_", " ").title())
        batches.append(
            {
                "batch_key": key,
                "label": label,
                "priority": "source",
                "edge_count": len(rows),
                "fast_track_count": sum(1 for row in rows if row.get("evidence_tier") == "strong_inferred"),
                "sample_edges": [
                    {
                        "source_ticker": row.get("source_ticker"),
                        "target_ticker": row.get("target_ticker"),
                        "source_search_query": row.get("source_search_query"),
                    }
                    for row in rows[:5]
                ],
                "reason": "Clustered review-only source enrichment batch. No URLs are fabricated and no production writes are authorized.",
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )
    return batches


def hub_source_gaps(preflight: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [
        row for row in (preflight.get("high_value_unsourced_edges") or [])
        if isinstance(row, dict)
    ]
    hub_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        for ticker in (row.get("source_ticker"), row.get("target_ticker")):
            if not ticker:
                continue
            entry = hub_map.setdefault(
                str(ticker),
                {
                    "ticker": ticker,
                    "unsourced_edge_count": 0,
                    "fast_track_edge_count": 0,
                    "sample_edges": [],
                    "review_only": True,
                },
            )
            entry["unsourced_edge_count"] += 1
            if row.get("fast_track_visibility"):
                entry["fast_track_edge_count"] += 1
            if len(entry["sample_edges"]) < 5:
                entry["sample_edges"].append(
                    {
                        "source_ticker": row.get("source_ticker"),
                        "target_ticker": row.get("target_ticker"),
                        "evidence_tier": row.get("evidence_tier"),
                    }
                )
    hubs = sorted(
        hub_map.values(),
        key=lambda row: (
            int(row["unsourced_edge_count"]),
            int(row["fast_track_edge_count"]),
            str(row["ticker"]),
        ),
        reverse=True,
    )
    for row in hubs:
        row["reason"] = "Strong graph hub with source coverage gaps; review-only source enrichment target."
    return hubs[:10]


def infer_corridor_lane(row: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    text = " ".join(
        str(row.get(field) or "").lower()
        for field in (
            "relationship_type",
            "label",
            "source_industry",
            "target_industry",
            "source_ticker",
            "target_ticker",
            "trusted_relationship_class",
            "trusted_relationship_class_label",
            "source_search_query",
        )
    )
    for lane_key in CORRIDOR_LANE_PRIORITY:
        definition = CORRIDOR_LANE_DEFINITIONS[lane_key]
        if any(keyword in text for keyword in definition["keywords"]):
            return lane_key, definition
    return None


def corridor_source_lanes(preflight: dict[str, Any], targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [
        row for row in (preflight.get("high_value_unsourced_edges") or [])
        if isinstance(row, dict)
    ]
    target_keys = {
        (
            str(target.get("source_ticker") or ""),
            str(target.get("target_ticker") or ""),
            str(target.get("relationship_type") or ""),
        )
        for target in targets
    }
    lane_map: dict[str, dict[str, Any]] = {
        key: {
            "lane_key": key,
            "label": definition["label"],
            "edge_count": 0,
            "fast_track_count": 0,
            "source_search_queries": [],
            "sample_edges": [],
            "manual_promotion_allowed": False,
            "review_only": True,
        }
        for key, definition in CORRIDOR_LANE_DEFINITIONS.items()
    }

    for row in rows:
        inferred = infer_corridor_lane(row)
        if inferred is None:
            continue
        lane_key, _definition = inferred
        lane = lane_map[lane_key]
        lane["edge_count"] += 1
        row_key = (
            str(row.get("source_ticker") or ""),
            str(row.get("target_ticker") or ""),
            str(row.get("relationship_type") or ""),
        )
        if row.get("fast_track_visibility") or row_key in target_keys:
            lane["fast_track_count"] += 1
        query = row.get("source_search_query")
        if query and len(lane["source_search_queries"]) < 5 and query not in lane["source_search_queries"]:
            lane["source_search_queries"].append(query)
        if len(lane["sample_edges"]) < 5:
            lane["sample_edges"].append(
                {
                    "source_ticker": row.get("source_ticker"),
                    "target_ticker": row.get("target_ticker"),
                    "relationship_type": row.get("relationship_type"),
                    "evidence_tier": row.get("evidence_tier"),
                }
            )

    lanes = [lane for lane in lane_map.values() if lane["edge_count"] > 0]
    for lane in lanes:
        lane["priority"] = "source" if lane["fast_track_count"] else "review"
        lane["reason"] = "Corridor source lane groups related enrichment targets so reviewers can source clusters without auto-promotion."
    return sorted(lanes, key=lambda row: (-int(row["edge_count"]), -int(row["fast_track_count"]), str(row["label"])))


def production_corridor_lanes(companies_path: Path, connections_path: Path) -> list[dict[str, Any]]:
    companies = load_json(companies_path)
    connections = load_json(connections_path)
    if not isinstance(companies, list) or not isinstance(connections, list):
        return []
    company_by_id = {
        int(company.get("id")): company
        for company in companies
        if isinstance(company, dict) and company.get("id") is not None
    }
    lane_map: dict[str, dict[str, Any]] = {}
    for edge in connections:
        if not isinstance(edge, dict):
            continue
        source = company_by_id.get(int(edge.get("source") or -1), {})
        target = company_by_id.get(int(edge.get("target") or -1), {})
        row = {
            "source_ticker": source.get("ticker"),
            "target_ticker": target.get("ticker"),
            "source_sector": source.get("sector"),
            "target_sector": target.get("sector"),
            "source_industry": source.get("industry"),
            "target_industry": target.get("industry"),
            "relationship_type": edge.get("type"),
            "label": edge.get("label"),
        }
        inferred = infer_corridor_lane(row)
        if inferred is None:
            continue
        lane_key, definition = inferred
        lane = lane_map.setdefault(
            lane_key,
            {
                "lane_key": lane_key,
                "label": definition["label"],
                "edge_count": 0,
                "source_backed_count": 0,
                "sample_edges": [],
                "priority": "source",
                "manual_promotion_allowed": False,
                "review_only": True,
            },
        )
        lane["edge_count"] += 1
        if edge.get("source_urls"):
            lane["source_backed_count"] += 1
        if len(lane["sample_edges"]) < 5:
            lane["sample_edges"].append(
                {
                    "source_ticker": source.get("ticker"),
                    "target_ticker": target.get("ticker"),
                    "relationship_type": edge.get("type"),
                    "source_backed": bool(edge.get("source_urls")),
                }
            )
    lanes = list(lane_map.values())
    for lane in lanes:
        lane["fast_track_count"] = 0
        lane["coverage_ratio"] = (
            round(float(lane["source_backed_count"]) / float(lane["edge_count"]), 4)
            if lane["edge_count"]
            else 0
        )
        lane["reason"] = "Source-backed production corridor lane; use for maintenance sourcing and adjacent ecosystem planning without auto-promotion."
    return sorted(lanes, key=lambda row: (-int(row["edge_count"]), str(row["label"])))


def merge_corridor_lanes(*lane_sets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for lanes in lane_sets:
        for lane in lanes:
            key = str(lane.get("lane_key") or lane.get("label") or "unknown")
            existing = merged.setdefault(key, {**lane})
            if existing is lane:
                continue
            existing["edge_count"] = max(int(existing.get("edge_count") or 0), int(lane.get("edge_count") or 0))
            existing["fast_track_count"] = max(int(existing.get("fast_track_count") or 0), int(lane.get("fast_track_count") or 0))
            existing["source_backed_count"] = max(int(existing.get("source_backed_count") or 0), int(lane.get("source_backed_count") or 0))
            if not existing.get("source_search_queries") and lane.get("source_search_queries"):
                existing["source_search_queries"] = lane.get("source_search_queries")
            samples = existing.setdefault("sample_edges", [])
            for sample in lane.get("sample_edges", []):
                if len(samples) >= 5:
                    break
                if sample not in samples:
                    samples.append(sample)
            if "coverage_ratio" in lane:
                existing["coverage_ratio"] = lane["coverage_ratio"]
            if "reason" in lane:
                existing["reason"] = lane["reason"]
    return sorted(merged.values(), key=lambda row: (-int(row.get("edge_count") or 0), str(row.get("label") or "")))


def ecosystem_expansion_opportunities(
    preflight: dict[str, Any],
    targets: list[dict[str, Any]],
    corridor_lanes: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    gaps = ecosystem_gap_rows(preflight)
    target_counts = Counter(
        str(target.get("trusted_relationship_class_label") or target.get("trusted_relationship_class") or "Unclassified")
        for target in targets
    )
    rows: list[dict[str, Any]] = []
    for gap in gaps:
        rows.append(
            {
                "opportunity_key": gap["ecosystem_key"],
                "label": str(gap["ecosystem_key"]).replace("_", " ").title(),
                "priority": "source",
                "unresolved_edge_count": gap["unsourced_high_value_count"],
                "fast_track_count": 0,
                "sample_edges": gap.get("sample_edges", []),
                "reason": "Ecosystem has unresolved high-value source gaps in production edges.",
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )
    for label, count in target_counts.most_common(10):
        rows.append(
            {
                "opportunity_key": label.lower().replace(" ", "_").replace("/", "_"),
                "label": label,
                "priority": "source",
                "unresolved_edge_count": count,
                "fast_track_count": count,
                "sample_edges": [],
                "reason": "Trusted strong-inferred class has clustered source-enrichment targets.",
                "manual_promotion_allowed": False,
                "review_only": True,
            }
        )
    deduped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row["opportunity_key"])
        existing = deduped.get(key)
        if not existing or int(row["unresolved_edge_count"]) > int(existing["unresolved_edge_count"]):
            deduped[key] = row
    if not deduped and corridor_lanes:
        for lane in corridor_lanes[:8]:
            key = str(lane.get("lane_key") or lane.get("label") or "corridor")
            deduped[key] = {
                "opportunity_key": key,
                "label": lane.get("label"),
                "priority": "planning",
                "unresolved_edge_count": 0,
                "fast_track_count": lane.get("fast_track_count", 0),
                "source_backed_edge_count": lane.get("source_backed_count", lane.get("edge_count", 0)),
                "sample_edges": lane.get("sample_edges", []),
                "reason": "Source-backed corridor is dense enough for adjacent ecosystem scouting; still review-only and not promotion authority.",
                "manual_promotion_allowed": False,
                "review_only": True,
            }
    return sorted(deduped.values(), key=lambda row: (-int(row["unresolved_edge_count"]), str(row["label"])))[:12]


def source_backlog_visibility(preflight: dict[str, Any], hub_gaps: list[dict[str, Any]]) -> dict[str, Any]:
    coverage = preflight.get("production_edge_source_coverage") or {}
    type_rows = [
        row for row in (preflight.get("relationship_type_source_gaps") or [])
        if isinstance(row, dict)
    ]
    unsourced_edges = int(coverage.get("unsourced_edges") or 0)
    return {
        "status": "clear" if unsourced_edges == 0 else "pending",
        "total_edges": int(coverage.get("total_edges") or 0),
        "sourced_edges": int(coverage.get("sourced_edges") or 0),
        "unsourced_edges": unsourced_edges,
        "sourced_ratio": round(float(coverage.get("sourced_ratio") or 0), 4),
        "type_backlog": [
            {
                "relationship_type": row.get("relationship_type"),
                "unsourced_edges": int(row.get("unsourced_edges") or 0),
                "sourced_ratio": round(float(row.get("sourced_ratio") or 0), 4),
                "review_only": True,
            }
            for row in type_rows
        ],
        "hub_backlog": hub_gaps[:8],
        "reason": "Source backlog is grouped by relationship type and hub so source work can scale without flooding manual promotion queues.",
        "review_only": True,
    }


def graph_growth_metrics(preflight: dict[str, Any], fast_track_targets: list[dict[str, Any]], lanes: list[dict[str, Any]]) -> dict[str, Any]:
    coverage = preflight.get("production_edge_source_coverage") or {}
    policy_summary = preflight.get("tiered_evidence_policy_summary") or {}
    trusted_classes = policy_summary.get("trusted_relationship_class_counts")
    trusted_class_count = len(trusted_classes) if isinstance(trusted_classes, dict) else 0
    return {
        "total_edges": int(coverage.get("total_edges") or 0),
        "sourced_edges": int(coverage.get("sourced_edges") or 0),
        "unsourced_edges": int(coverage.get("unsourced_edges") or 0),
        "sec_backed_edges": int(coverage.get("sec_backed_edges") or 0),
        "sourced_ratio": round(float(coverage.get("sourced_ratio") or 0), 4),
        "fast_track_source_target_count": len(fast_track_targets),
        "corridor_lane_count": len(lanes),
        "trusted_relationship_class_count": trusted_class_count,
        "coverage_state": "all_source_backed" if int(coverage.get("unsourced_edges") or 0) == 0 else "source_expansion_pending",
        "manual_promotion_allowed": False,
        "review_only": True,
    }


def build_refresh_report(args: argparse.Namespace) -> dict[str, Any]:
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)
    candidates_path = resolve_path(args.candidates)
    review_summary_path = resolve_path(args.review_summary)
    review_queue_path = resolve_path(args.review_queue)
    output_path = resolve_path(args.output)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)

    try:
        preflight = build_report(
            companies_path=companies_path,
            connections_path=connections_path,
            candidates_path=candidates_path,
            review_summary_path=review_summary_path,
            review_queue_path=review_queue_path,
        )
    except PreflightError as exc:
        raise SourceCoverageRefreshError(str(exc)) from exc

    weak_categories = weak_relationship_categories(preflight)
    ecosystem_gaps = ecosystem_gap_rows(preflight)
    queue = build_reviewer_priority_queue(preflight)
    fast_track_targets = fast_track_source_targets(preflight)
    expansion_batches = source_expansion_batches(preflight, fast_track_targets)
    hub_gaps = hub_source_gaps(preflight)
    gap_corridor_lanes = corridor_source_lanes(preflight, fast_track_targets)
    production_lanes = production_corridor_lanes(companies_path, connections_path)
    corridor_lanes = merge_corridor_lanes(gap_corridor_lanes, production_lanes)
    ecosystem_opportunities = ecosystem_expansion_opportunities(preflight, fast_track_targets, corridor_lanes)
    backlog = source_backlog_visibility(preflight, hub_gaps)
    growth_metrics = graph_growth_metrics(preflight, fast_track_targets, corridor_lanes)
    coverage = preflight.get("production_edge_source_coverage") or {}
    policy_summary = preflight.get("tiered_evidence_policy_summary") or {}

    report = {
        "metadata": {
            "artifact_status": "review_only",
            "generated_by": "scripts/source_coverage_refresh.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "network_calls": 0,
            "production_files_read": {
                "companies": display_path(companies_path),
                "connections": display_path(connections_path),
            },
            "optional_files_read": {
                "candidates": display_path(candidates_path),
                "review_summary": display_path(review_summary_path),
                "review_queue": display_path(review_queue_path),
            },
            "output_path": display_path(output_path),
        },
        "summary": {
            "total_edges": coverage.get("total_edges", 0),
            "unsourced_edges": coverage.get("unsourced_edges", 0),
            "stale_review_edges": coverage.get("stale_review_edges", 0),
            "weak_relationship_category_count": len(weak_categories),
            "ecosystem_gap_count": len(ecosystem_gaps),
            "reviewer_priority_count": len(queue),
            "fast_track_visibility_count": policy_summary.get("fast_track_visibility_count", 0),
            "fast_track_source_target_count": len(fast_track_targets),
            "source_expansion_batch_count": len(expansion_batches),
            "corridor_source_lane_count": len(corridor_lanes),
            "ecosystem_expansion_opportunity_count": len(ecosystem_opportunities),
            "needs_review_count": policy_summary.get("needs_review_count", 0),
            "context_only_count": policy_summary.get("context_only_count", 0),
            "missing_production_ticker_count": len(
                preflight.get("candidate_tickers_missing_from_production_universe") or []
            ),
            "review_only": True,
        },
        "source_coverage_refresh_state": {
            "latest_refresh_at_utc": generated_at.isoformat(),
            "source_coverage_ratio": coverage.get("sourced_ratio", 0),
            "preflight_present": True,
            "production_writes": 0,
            "review_only": True,
        },
        "weak_relationship_categories": weak_categories,
        "ecosystem_gaps": ecosystem_gaps,
        "tiered_evidence_policy_summary": policy_summary,
        "fast_track_source_targets": fast_track_targets,
        "source_expansion_batches": expansion_batches,
        "hub_source_gaps": hub_gaps,
        "corridor_source_lanes": corridor_lanes,
        "ecosystem_expansion_opportunities": ecosystem_opportunities,
        "source_backlog_visibility": backlog,
        "graph_growth_metrics": growth_metrics,
        "missing_production_tickers": preflight.get("candidate_tickers_missing_from_production_universe") or [],
        "reviewer_priority_queue": queue,
        "safety": {
            "review_only": True,
            "network_calls": 0,
            "production_writes": 0,
            "companies_written": 0,
            "connections_written": 0,
            "browser_ingestion": False,
        },
    }
    validate_report(report)
    return report


def validate_report(report: dict[str, Any]) -> None:
    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        raise SourceCoverageRefreshError("report metadata is required.")
    if metadata.get("artifact_status") != "review_only":
        raise SourceCoverageRefreshError("source coverage report must be review_only.")
    if metadata.get("production_write_allowed") is not False:
        raise SourceCoverageRefreshError("source coverage report cannot allow production writes.")
    if report.get("safety", {}).get("production_writes") != 0:
        raise SourceCoverageRefreshError("source coverage report safety must show zero production writes.")
    queue = report.get("reviewer_priority_queue")
    if not isinstance(queue, list):
        raise SourceCoverageRefreshError("reviewer_priority_queue must be a list.")
    for item in queue:
        if not isinstance(item, dict) or item.get("review_only") is not True:
            raise SourceCoverageRefreshError("reviewer priority rows must be review_only objects.")


def print_human(report: dict[str, Any], output_path: Path) -> None:
    summary = report["summary"]
    print("Source coverage refresh")
    print("=======================")
    print(f"Unsourced edges: {summary['unsourced_edges']}")
    print(f"Stale review edges: {summary['stale_review_edges']}")
    print(f"Weak relationship categories: {summary['weak_relationship_category_count']}")
    print(f"Ecosystem gaps: {summary['ecosystem_gap_count']}")
    print(f"Reviewer priorities: {summary['reviewer_priority_count']}")
    print("Production writes: 0")
    print(f"Report path: {display_path(output_path)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    output_path = resolve_path(args.output)
    initial_hashes = production_hashes()
    try:
        report = build_refresh_report(args)
        if args.write:
            write_json(output_path, report, force=args.force)
        assert_production_unchanged(initial_hashes)
    except SourceCoverageRefreshError as exc:
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
