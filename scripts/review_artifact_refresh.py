#!/usr/bin/env python3
"""Orchestrate review-only artifact refreshes.

This local/scheduled orchestrator refreshes candidate triage, preflight,
source coverage, and optional OpenAlex intelligence artifacts. It does not
fetch browser data, run promotion, or write production graph JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = ROOT / "data" / "candidates" / "review_pipeline_summary.json"
PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)

SEC_TRIAGE_SCRIPT = ROOT / "scripts" / "sec_candidate_triage.py"
UNIVERSE_EXPANSION_SCRIPT = ROOT / "scripts" / "universe_expansion_batches.py"
PREFLIGHT_SCRIPT = ROOT / "scripts" / "data_expansion_preflight.py"
SOURCE_COVERAGE_SCRIPT = ROOT / "scripts" / "source_coverage_refresh.py"
SOURCE_GOVERNANCE_SCRIPT = ROOT / "scripts" / "source_registry_governance.py"
PROMOTION_PLANNER_SCRIPT = ROOT / "scripts" / "promotion_planner_report.py"
OPENALEX_SCRIPT = ROOT / "scripts" / "openalex_enrichment.py"
VALIDATE_SCRIPT = ROOT / "scripts" / "validate_data.py"


class ReviewArtifactRefreshError(Exception):
    """Raised for clear review artifact orchestration failures."""


@dataclass
class StepResult:
    name: str
    command: list[str]
    return_code: int
    status: str
    stdout_tail: list[str]
    stderr_tail: list[str]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Refresh review-only StockPhotonic artifacts. Default mode is a "
            "dry plan; pass --write to generate artifacts."
        )
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--write", action="store_true", help="Write review-only artifacts.")
    parser.add_argument("--force", action="store_true", help="Overwrite review artifacts when --write is used.")
    parser.add_argument("--skip-triage", action="store_true")
    parser.add_argument("--skip-universe-expansion", action="store_true")
    parser.add_argument("--skip-preflight", action="store_true")
    parser.add_argument("--skip-source-coverage", action="store_true")
    parser.add_argument("--skip-source-governance", action="store_true")
    parser.add_argument("--skip-promotion-planner", action="store_true")
    parser.add_argument("--skip-openalex", action="store_true")
    parser.add_argument("--skip-validation", action="store_true")
    parser.add_argument(
        "--allow-openalex-network",
        action="store_true",
        help="Permit bounded OpenAlex network lookups in the delegated enrichment step.",
    )
    parser.add_argument("--openalex-max-requests", type=parse_nonnegative_int, default=24)
    parser.add_argument("--openalex-max-entities", type=parse_positive_int, default=20)
    parser.add_argument("--json", action="store_true", help="Print summary JSON.")
    args = parser.parse_args(argv)
    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
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


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def display_path(path: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise ReviewArtifactRefreshError(f"{display_path(path)} already exists; pass --force.")
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
            raise ReviewArtifactRefreshError(
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
        raise ReviewArtifactRefreshError(
            "production data changed during review artifact refresh: "
            f"{', '.join(changed)}"
        )


def subprocess_environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def command_display(command: list[str]) -> str:
    parts: list[str] = []
    for part in command:
        if part == sys.executable:
            parts.append("python")
            continue
        try:
            path = Path(part)
            if path.is_absolute():
                part = display_path(path)
        except OSError:
            pass
        part = part.replace("\\", "/")
        if any(char.isspace() for char in part):
            parts.append(f'"{part}"')
        else:
            parts.append(part)
    return " ".join(parts)


def run_step(name: str, command: list[str], initial_hashes: dict[Path, str]) -> StepResult:
    print()
    print(f"Review artifact step: {name}")
    print("-" * (len(name) + len("Review artifact step: ")))
    print(f"Command: {command_display(command)}")
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=subprocess_environment(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    assert_production_unchanged(initial_hashes)
    status = "passed" if result.returncode == 0 else "failed"
    return StepResult(
        name=name,
        command=command,
        return_code=result.returncode,
        status=status,
        stdout_tail=result.stdout.splitlines()[-12:],
        stderr_tail=result.stderr.splitlines()[-12:],
    )


def step_command(script: Path, *, write: bool, force: bool, extra: list[str] | None = None) -> list[str]:
    command = [sys.executable, str(script)]
    if write:
        command.append("--write")
    if force:
        command.append("--force")
    if extra:
        command.extend(extra)
    return command


def planned_steps(args: argparse.Namespace) -> list[tuple[str, list[str]]]:
    steps: list[tuple[str, list[str]]] = []
    if not args.skip_triage:
        steps.append(
            (
                "sec_candidate_triage",
                step_command(SEC_TRIAGE_SCRIPT, write=args.write, force=args.force),
            )
        )
    if not args.skip_universe_expansion:
        steps.append(
            (
                "universe_expansion_batches",
                step_command(UNIVERSE_EXPANSION_SCRIPT, write=args.write, force=args.force),
            )
        )
    if not args.skip_preflight:
        steps.append(
            (
                "data_expansion_preflight",
                step_command(PREFLIGHT_SCRIPT, write=args.write, force=args.force),
            )
        )
    if not args.skip_source_coverage:
        steps.append(
            (
                "source_coverage_refresh",
                step_command(SOURCE_COVERAGE_SCRIPT, write=args.write, force=args.force),
            )
        )
    if not args.skip_source_governance:
        steps.append(
            (
                "source_registry_governance",
                step_command(
                    SOURCE_GOVERNANCE_SCRIPT,
                    write=args.write,
                    force=args.force,
                    extra=["--sync-registry"] if args.write else None,
                ),
            )
        )
    if not args.skip_promotion_planner:
        steps.append(
            (
                "promotion_planner_report",
                step_command(PROMOTION_PLANNER_SCRIPT, write=args.write, force=args.force),
            )
        )
    if not args.skip_openalex:
        extra = [
            "--max-requests",
            str(args.openalex_max_requests),
            "--max-entities",
            str(args.openalex_max_entities),
        ]
        if args.allow_openalex_network:
            extra.append("--allow-network")
        steps.append(
            (
                "openalex_enrichment",
                step_command(OPENALEX_SCRIPT, write=args.write, force=args.force, extra=extra),
            )
        )
    if not args.skip_validation:
        steps.append(("validation", [sys.executable, str(VALIDATE_SCRIPT)]))
    return steps


def build_summary(args: argparse.Namespace, results: list[StepResult], started_at: datetime) -> dict[str, Any]:
    completed_at = datetime.now(timezone.utc).replace(microsecond=0)
    failed = [result for result in results if result.return_code != 0]
    return {
        "metadata": {
            "artifact_status": "review_only",
            "generated_by": "scripts/review_artifact_refresh.py",
            "generated_at_utc": completed_at.isoformat(),
            "pipeline_started_at_utc": started_at.isoformat(),
            "production_write_allowed": False,
            "network_calls": "openalex_bounded_only" if args.allow_openalex_network else 0,
            "output_path": display_path(resolve_path(args.output)),
        },
        "summary": {
            "status": "failed" if failed else "passed",
            "step_count": len(results),
            "failed_step_count": len(failed),
            "write_enabled": bool(args.write),
            "openalex_network_enabled": bool(args.allow_openalex_network),
            "latest_review_pipeline_timestamp": completed_at.isoformat(),
            "review_only": True,
        },
        "steps": [
            {
                "name": result.name,
                "command": command_display(result.command),
                "return_code": result.return_code,
                "status": result.status,
                "stdout_tail": result.stdout_tail,
                "stderr_tail": result.stderr_tail,
            }
            for result in results
        ],
        "artifact_paths": {
            "candidate_review_queue": "data/candidates/candidate_review_queue.json",
            "candidate_review_summary": "data/candidates/candidate_review_summary.json",
            "candidate_overlap_report": "data/candidates/candidate_overlap_report.json",
            "candidate_companies": "data/candidates/candidate_companies.json",
            "universe_expansion_batches": "data/candidates/universe_expansion_batches.json",
            "data_expansion_preflight": "data/candidates/data_expansion_preflight_report.json",
            "source_coverage_refresh": "data/candidates/source_coverage_refresh_report.json",
            "source_governance_report": "data/source_registry/source_governance_report.json",
            "promotion_planner_report": "data/candidates/promotion_planner_report.json",
            "official_company_sources": "data/source_registry/official_company_sources.json",
            "trusted_source_hosts": "data/source_registry/trusted_source_hosts.json",
            "corridor_source_registry": "data/source_registry/corridor_source_registry.json",
            "openalex_ecosystem_candidates": "data/candidates/openalex_ecosystem_candidates.json",
            "openalex_topic_overlap": "data/candidates/openalex_topic_overlap.json",
            "openalex_institution_overlap": "data/candidates/openalex_institution_overlap.json",
            "openalex_cluster_hints": "data/candidates/openalex_cluster_hints.json",
        },
        "safety": {
            "review_only": True,
            "production_writes": 0,
            "companies_written": 0,
            "connections_written": 0,
            "auto_promotion_executed": False,
            "browser_ingestion": False,
        },
    }


def print_plan(steps: list[tuple[str, list[str]]]) -> None:
    print("Review artifact refresh plan")
    print("============================")
    print("Mode: plan only")
    print("Production writes: 0")
    for name, command in steps:
        print(f"- {name}: {command_display(command)}")


def print_human(summary: dict[str, Any]) -> None:
    print()
    print("Review artifact refresh summary")
    print("===============================")
    print(f"Status: {summary['summary']['status']}")
    print(f"Steps: {summary['summary']['step_count']}")
    print(f"Failed steps: {summary['summary']['failed_step_count']}")
    print(f"Write enabled: {'yes' if summary['summary']['write_enabled'] else 'no'}")
    print(f"OpenAlex network enabled: {'yes' if summary['summary']['openalex_network_enabled'] else 'no'}")
    print(f"Latest timestamp: {summary['summary']['latest_review_pipeline_timestamp']}")
    print("Production writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    output_path = resolve_path(args.output)
    steps = planned_steps(args)

    if not args.write:
        print_plan(steps)
        return 0

    started_at = datetime.now(timezone.utc).replace(microsecond=0)
    initial_hashes = production_hashes()
    results: list[StepResult] = []
    try:
        for name, command in steps:
            result = run_step(name, command, initial_hashes)
            results.append(result)
            if result.return_code != 0:
                break
        summary = build_summary(args, results, started_at)
        write_json(output_path, summary, force=args.force)
        assert_production_unchanged(initial_hashes)
    except ReviewArtifactRefreshError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(summary, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(summary)
    return 1 if summary["summary"]["failed_step_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
