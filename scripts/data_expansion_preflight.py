#!/usr/bin/env python3
"""Build a review-only data expansion preflight report.

The report reads production companies/connections plus optional candidate and
triage artifacts. It performs no network calls and never writes production
graph data. Use --write to emit a static review artifact under data/candidates.
"""

from __future__ import annotations

import argparse
import json
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
DEFAULT_CANDIDATES_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
DEFAULT_REVIEW_SUMMARY_PATH = ROOT / "data" / "candidates" / "candidate_review_summary.json"
DEFAULT_REVIEW_QUEUE_PATH = ROOT / "data" / "candidates" / "candidate_review_queue.json"
DEFAULT_OUTPUT_PATH = ROOT / "data" / "candidates" / "data_expansion_preflight_report.json"


class PreflightError(Exception):
    """Raised for clear preflight failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a review-only source coverage and data expansion "
            "preflight report. The command performs no network calls and "
            "does not write production graph data."
        )
    )
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--candidates", default=str(DEFAULT_CANDIDATES_PATH))
    parser.add_argument("--review-summary", default=str(DEFAULT_REVIEW_SUMMARY_PATH))
    parser.add_argument("--review-queue", default=str(DEFAULT_REVIEW_QUEUE_PATH))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--write", action="store_true", help="Write the review-only report artifact.")
    parser.add_argument("--force", action="store_true", help="Overwrite the report artifact when --write is used.")
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
        return str(path.resolve(strict=False).relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path, label: str, *, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise PreflightError(f"{label} file is missing: {display_path(path)}")
        return None
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise PreflightError(f"could not read {label} file {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PreflightError(f"could not parse {label} file {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise PreflightError(f"{display_path(path)} already exists; pass --force.")
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
    text = clean_string(value)
    return text.upper() if text else None


def source_urls(record: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    raw_urls = record.get("source_urls")
    if isinstance(raw_urls, list):
        urls.extend(str(url).strip() for url in raw_urls if isinstance(url, str))
    for key in ("archive_url", "source_url", "filing_url", "sec_url", "url"):
        raw_url = clean_string(record.get(key))
        if raw_url:
            urls.append(raw_url)
    return sorted({url for url in urls if url.lower().startswith(("http://", "https://"))})


def source_host(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname.lower().removeprefix("www.") if parsed.hostname else ""


def is_sec_backed(edge: dict[str, Any]) -> bool:
    text = " ".join(
        str(edge.get(key) or "").lower()
        for key in ("provenance", "source_label", "label", "type", "relationship_type")
    )
    return "sec filing" in text or any("sec.gov" in source_host(url) for url in source_urls(edge))


def verified_age_state(edge: dict[str, Any], now: datetime) -> str:
    value = clean_string(edge.get("verified_date"))
    if not value:
        return "no_verified_date"
    try:
        parsed = datetime.fromisoformat(f"{value}T00:00:00+00:00")
    except ValueError:
        return "no_verified_date"
    age_days = max(0, (now - parsed).days)
    if age_days > 365:
        return "stale_review_recommended"
    if age_days > 180:
        return "aging_evidence"
    return "verified_recently"


def load_companies(path: Path) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]], set[str]]:
    payload = load_json(path, "companies")
    if not isinstance(payload, list):
        raise PreflightError("companies file must contain a JSON array.")
    by_id: dict[int, dict[str, Any]] = {}
    tickers: set[str] = set()
    for company in payload:
        if not isinstance(company, dict):
            continue
        company_id = company.get("id")
        ticker = normalize_ticker(company.get("ticker"))
        if isinstance(company_id, int) and not isinstance(company_id, bool):
            by_id[company_id] = company
        if ticker:
            tickers.add(ticker)
    return payload, by_id, tickers


def load_connections(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "connections")
    if not isinstance(payload, list):
        raise PreflightError("connections file must contain a JSON array.")
    return [edge for edge in payload if isinstance(edge, dict)]


def load_candidates(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, "candidates", required=False)
    if payload is None:
        return []
    if isinstance(payload, dict) and isinstance(payload.get("candidates"), list):
        return [item for item in payload["candidates"] if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def edge_ticker(edge: dict[str, Any], company_by_id: dict[int, dict[str, Any]], key: str) -> str | None:
    company = company_by_id.get(edge.get(key))
    return normalize_ticker(company.get("ticker")) if company else None


def edge_priority(edge: dict[str, Any], company_by_id: dict[int, dict[str, Any]]) -> tuple[str, float]:
    strength = float(edge.get("strength") or 0)
    confidence = float(edge.get("confidence") or 0)
    source = company_by_id.get(edge.get("source")) or {}
    target = company_by_id.get(edge.get("target")) or {}
    market_cap = float(source.get("market_cap") or 0) + float(target.get("market_cap") or 0)
    score = strength * 50 + confidence * 8 + min(30, market_cap)
    if score >= 78:
        return "high", round(score, 2)
    if score >= 55:
        return "medium", round(score, 2)
    return "low", round(score, 2)


def build_high_value_unsourced_edges(
    connections: list[dict[str, Any]],
    company_by_id: dict[int, dict[str, Any]],
    *,
    limit: int = 30,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, edge in enumerate(connections):
        if source_urls(edge):
            continue
        priority, score = edge_priority(edge, company_by_id)
        rows.append(
            {
                "connection_index": index,
                "source_ticker": edge_ticker(edge, company_by_id, "source"),
                "target_ticker": edge_ticker(edge, company_by_id, "target"),
                "relationship_type": clean_string(edge.get("type")) or "unknown",
                "label": clean_string(edge.get("label")),
                "strength": edge.get("strength"),
                "confidence": edge.get("confidence"),
                "verified_date": clean_string(edge.get("verified_date")),
                "priority": priority,
                "priority_score": score,
                "review_only": True,
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            {"high": 3, "medium": 2, "low": 1}.get(str(row["priority"]), 0),
            float(row["priority_score"]),
            str(row["source_ticker"] or ""),
        ),
        reverse=True,
    )[:limit]


def build_relationship_type_gaps(connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: Counter[str] = Counter()
    sourced: Counter[str] = Counter()
    for edge in connections:
        relationship_type = clean_string(edge.get("type")) or "unknown"
        totals[relationship_type] += 1
        if source_urls(edge):
            sourced[relationship_type] += 1
    rows: list[dict[str, Any]] = []
    for relationship_type, total in sorted(totals.items()):
        sourced_count = sourced[relationship_type]
        unsourced = total - sourced_count
        rows.append(
            {
                "relationship_type": relationship_type,
                "total_edges": total,
                "sourced_edges": sourced_count,
                "unsourced_edges": unsourced,
                "sourced_ratio": round(sourced_count / total, 4) if total else 0,
            }
        )
    return sorted(rows, key=lambda row: (-row["unsourced_edges"], row["relationship_type"]))


def candidate_blockers(
    candidates: list[dict[str, Any]],
    production_tickers: set[str],
) -> tuple[dict[str, Any], list[str]]:
    blocker_counts: Counter[str] = Counter()
    missing_tickers: set[str] = set()
    samples: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        source = normalize_ticker(candidate.get("source_ticker"))
        target = normalize_ticker(candidate.get("target_ticker"))
        missing = [ticker for ticker in (source, target) if ticker and ticker not in production_tickers]
        if missing:
            blocker_counts["candidate_ticker_missing_from_production"] += 1
            missing_tickers.update(missing)
        if not source_urls(candidate):
            blocker_counts["candidate_missing_source_url"] += 1
        confidence = candidate.get("confidence_hint")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or float(confidence) < 0.75:
            blocker_counts["candidate_low_confidence"] += 1
        if not clean_string(candidate.get("evidence_snippet")):
            blocker_counts["candidate_missing_evidence_snippet"] += 1
        if str(candidate.get("review_status") or "").lower() not in {"reviewed", "approved"}:
            blocker_counts["candidate_pending_manual_review"] += 1
        if len(samples) < 10 and (
            missing
            or not source_urls(candidate)
            or str(candidate.get("review_status") or "").lower() not in {"reviewed", "approved"}
        ):
            samples.append(
                {
                    "candidate_index": index,
                    "source_ticker": source,
                    "target_ticker": target,
                    "relationship_type": clean_string(candidate.get("relationship_type")),
                    "review_status": clean_string(candidate.get("review_status")),
                    "blockers": sorted(
                        {
                            *(["missing_production_ticker"] if missing else []),
                            *(["missing_source_url"] if not source_urls(candidate) else []),
                            *(["pending_manual_review"] if str(candidate.get("review_status") or "").lower() not in {"reviewed", "approved"} else []),
                        }
                    ),
                }
            )
    return (
        {
            "total_blocker_count": sum(blocker_counts.values()),
            "counts": dict(sorted(blocker_counts.items())),
            "sample_blockers": samples,
        },
        sorted(missing_tickers),
    )


def build_priorities(
    coverage: dict[str, Any],
    type_gaps: list[dict[str, Any]],
    blockers: dict[str, Any],
    missing_tickers: list[str],
) -> list[dict[str, Any]]:
    priorities: list[dict[str, Any]] = []
    if coverage["unsourced_edges"]:
        top_type = next((row for row in type_gaps if row["unsourced_edges"] > 0), None)
        priorities.append(
            {
                "priority": "high",
                "area": "production_source_coverage",
                "title": "Source high-value production edges",
                "reason": (
                    f"{coverage['unsourced_edges']} production edges lack source URLs"
                    + (f"; {top_type['relationship_type']} has the largest gap." if top_type else ".")
                ),
                "next_step": "Use the preflight gap rows to choose source-backed review targets.",
            }
        )
    if coverage["stale_review_edges"]:
        priorities.append(
            {
                "priority": "medium",
                "area": "source_freshness",
                "title": "Refresh stale relationship evidence",
                "reason": f"{coverage['stale_review_edges']} production edges have stale review dates.",
                "next_step": "Review dated evidence before expanding the production graph.",
            }
        )
    if blockers.get("total_blocker_count", 0):
        priorities.append(
            {
                "priority": "high" if missing_tickers else "medium",
                "area": "candidate_readiness",
                "title": "Resolve candidate promotion blockers",
                "reason": f"{blockers['total_blocker_count']} candidate blocker flags are present.",
                "next_step": "Resolve missing tickers, source URLs, confidence, snippets, and manual review status before promotion.",
            }
        )
    if missing_tickers:
        priorities.append(
            {
                "priority": "medium",
                "area": "production_universe",
                "title": "Review candidate tickers outside production universe",
                "reason": f"{len(missing_tickers)} candidate ticker(s) are not in production companies.",
                "next_step": "Do not create production nodes without an explicit reviewed expansion decision.",
            }
        )
    priorities.append(
        {
            "priority": "review",
            "area": "workflow",
            "title": "Keep candidate preview before manual promotion",
            "reason": "The report is review-only and does not authorize production writes.",
            "next_step": "Run promotion preview and validation only after human review.",
        }
    )
    return priorities


def build_report(
    *,
    companies_path: Path,
    connections_path: Path,
    candidates_path: Path,
    review_summary_path: Path,
    review_queue_path: Path,
) -> dict[str, Any]:
    companies, company_by_id, production_tickers = load_companies(companies_path)
    connections = load_connections(connections_path)
    candidates = load_candidates(candidates_path)
    review_summary = load_json(review_summary_path, "review summary", required=False) or {}
    review_queue = load_json(review_queue_path, "review queue", required=False) or {}
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)

    sourced_edges = [edge for edge in connections if source_urls(edge)]
    sec_backed_edges = [edge for edge in connections if is_sec_backed(edge)]
    stale_edges = [
        edge for edge in connections
        if verified_age_state(edge, generated_at) == "stale_review_recommended"
    ]
    coverage = {
        "total_edges": len(connections),
        "sourced_edges": len(sourced_edges),
        "unsourced_edges": len(connections) - len(sourced_edges),
        "sourced_ratio": round(len(sourced_edges) / len(connections), 4) if connections else 0,
        "sec_backed_edges": len(sec_backed_edges),
        "stale_review_edges": len(stale_edges),
    }
    type_gaps = build_relationship_type_gaps(connections)
    blockers, missing_tickers = candidate_blockers(candidates, production_tickers)
    priorities = build_priorities(coverage, type_gaps, blockers, missing_tickers)
    high_value_unsourced = build_high_value_unsourced_edges(connections, company_by_id)

    report = {
        "metadata": {
            "artifact_status": "review_only",
            "generated_by": "scripts/data_expansion_preflight.py",
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
        },
        "production_company_count": len(companies),
        "production_edge_source_coverage": coverage,
        "relationship_type_source_gaps": type_gaps,
        "high_value_unsourced_edges": high_value_unsourced,
        "candidate_preview_count": len(candidates),
        "candidate_tickers_missing_from_production_universe": missing_tickers,
        "candidate_promotion_blockers": blockers,
        "review_artifact_snapshot": {
            "review_summary_present": bool(review_summary),
            "review_queue_present": bool(review_queue),
            "review_queue_count": review_queue.get("queue_count", 0) if isinstance(review_queue, dict) else 0,
            "summary_queue_count": review_summary.get("summary", {}).get("queue_count", 0)
            if isinstance(review_summary.get("summary"), dict)
            else 0,
        },
        "data_expansion_priorities": priorities,
        "safety": {
            "review_only": True,
            "network_calls": 0,
            "production_writes": 0,
            "browser_ingestion": False,
        },
    }
    validate_report(report)
    return report


def validate_report(report: dict[str, Any]) -> None:
    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        raise PreflightError("report metadata is required.")
    if metadata.get("artifact_status") != "review_only":
        raise PreflightError("report must be review_only.")
    if metadata.get("production_write_allowed") is not False:
        raise PreflightError("report cannot allow production writes.")
    if report.get("safety", {}).get("production_writes") != 0:
        raise PreflightError("report safety must show zero production writes.")
    if not isinstance(report.get("high_value_unsourced_edges"), list):
        raise PreflightError("high_value_unsourced_edges must be a list.")


def print_human(report: dict[str, Any], output_path: Path) -> None:
    coverage = report["production_edge_source_coverage"]
    blockers = report["candidate_promotion_blockers"]
    print("Data expansion preflight")
    print("========================")
    print(f"Production companies: {report['production_company_count']}")
    print(f"Production edges: {coverage['total_edges']}")
    print(f"Sourced ratio: {coverage['sourced_ratio']:.0%}")
    print(f"Unsourced edges: {coverage['unsourced_edges']}")
    print(f"SEC-backed edges: {coverage['sec_backed_edges']}")
    print(f"Stale review edges: {coverage['stale_review_edges']}")
    print(f"Candidate previews: {report['candidate_preview_count']}")
    print(f"Candidate blocker flags: {blockers['total_blocker_count']}")
    print("Production writes: 0")
    print(f"Report path: {display_path(output_path)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    companies_path = resolve_path(args.companies)
    connections_path = resolve_path(args.connections)
    candidates_path = resolve_path(args.candidates)
    review_summary_path = resolve_path(args.review_summary)
    review_queue_path = resolve_path(args.review_queue)
    output_path = resolve_path(args.output)

    try:
        report = build_report(
            companies_path=companies_path,
            connections_path=connections_path,
            candidates_path=candidates_path,
            review_summary_path=review_summary_path,
            review_queue_path=review_queue_path,
        )
        if args.write:
            write_json(output_path, report, force=args.force)
    except PreflightError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(report, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(report, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
