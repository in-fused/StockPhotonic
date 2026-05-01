#!/usr/bin/env python3
"""Manual dry-run-first data foundation provisioner.

This orchestrator coordinates existing candidate validation and SEC cache
planning helpers. It never writes StockPhotonic production graph data and does
not perform network calls unless --allow-network is explicitly passed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_TICKER_UNIVERSE_PATH = Path("data/candidates/official_ticker_universe.json")
CIK_MAPPINGS_PATH = Path("data/candidates/cik_mappings.json")
INGEST_CANDIDATES_SCRIPT = Path("scripts/ingest_candidates.py")
SEC_FETCH_CACHE_SCRIPT = Path("scripts/sec_fetch_cache.py")
APPROVED_FOR_FETCH = "approved_for_fetch"
DRY_RUN_USER_AGENT = "StockPhotonic local dry-run dry-run@example.com"
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")


class ProvisionerError(Exception):
    """Raised for clear provisioner failures."""


@dataclass(frozen=True)
class ValidationRun:
    label: str
    command: list[str]
    returncode: int


@dataclass(frozen=True)
class MappingPlan:
    index: int
    ticker: str
    cik: str


@dataclass(frozen=True)
class SkippedMapping:
    label: str
    reason: str


@dataclass
class SecRunSummary:
    planned: int = 0
    helper_dry_runs: int = 0
    helper_network_runs: int = 0
    fetched: int = 0
    cache_hits: int = 0


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run safe local data-foundation checks without writing production graph data."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicitly request the default dry-run mode.",
    )
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="Allow delegated SEC cache fetches for approved mappings.",
    )
    parser.add_argument(
        "--user-agent",
        help=(
            "Identifying SEC User-Agent. Required only with --allow-network; "
            "optional for delegated dry-run previews."
        ),
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Pass summary-only mode to candidate validation and shorten mapping detail.",
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        help="Maximum number of approved CIK mappings to process.",
    )
    parser.add_argument(
        "--ticker",
        help="Optional ticker filter. Lowercase input is normalized to uppercase.",
    )
    args = parser.parse_args(argv)

    if args.allow_network and args.dry_run:
        parser.error("--dry-run cannot be combined with --allow-network.")
    if args.allow_network and not (args.user_agent and args.user_agent.strip()):
        parser.error("--allow-network requires --user-agent.")
    return args


def normalize_ticker_filter(raw_ticker: str | None) -> str | None:
    if raw_ticker is None:
        return None
    ticker = raw_ticker.strip().upper()
    if not ticker or not TICKER_PATTERN.match(ticker):
        raise ProvisionerError("--ticker must use a supported public ticker format.")
    return ticker


def display_command(command: list[str]) -> str:
    display_parts = []
    for part in command:
        if part == sys.executable:
            display_parts.append("python")
            continue
        if " " in part:
            display_parts.append(f'"{part}"')
        else:
            display_parts.append(part)
    return " ".join(display_parts)


def print_section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def subprocess_environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def run_subprocess(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        env=subprocess_environment(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def print_completed_process(result: subprocess.CompletedProcess[str]) -> None:
    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    if stdout:
        print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)


def validate_candidate_file(
    *,
    label: str,
    path: Path,
    summary_only: bool,
) -> ValidationRun:
    command = [
        sys.executable,
        str(INGEST_CANDIDATES_SCRIPT),
        "--candidates",
        str(path),
    ]
    if summary_only:
        command.append("--summary-only")

    print_section(f"Candidate validation: {label}")
    print(f"Command: {display_command(command)}")
    result = run_subprocess(command)
    print_completed_process(result)
    if result.returncode != 0:
        raise ProvisionerError(
            f"candidate validation failed for {label}; production writes remain 0."
        )
    return ValidationRun(label=label, command=command, returncode=result.returncode)


def load_cik_mappings(path: Path) -> list[dict[str, Any]]:
    absolute_path = ROOT / path
    if not absolute_path.exists():
        raise ProvisionerError(f"CIK mapping file is missing: {path}")

    with absolute_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    if not isinstance(payload, dict):
        raise ProvisionerError(f"{path} must contain a JSON object.")

    mappings = payload.get("mappings")
    if not isinstance(mappings, list):
        raise ProvisionerError(f"{path}: mappings must be a JSON array.")

    normalized_mappings: list[dict[str, Any]] = []
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict):
            raise ProvisionerError(f"CIK mapping {index}: record must be an object.")
        normalized_mappings.append(mapping)
    return normalized_mappings


def mapping_label(mapping: dict[str, Any], index: int) -> str:
    ticker = mapping.get("ticker")
    cik = mapping.get("cik")
    if isinstance(ticker, str) and isinstance(cik, str):
        return f"{ticker} / {cik}"
    if isinstance(ticker, str):
        return ticker
    return f"mapping {index}"


def build_sec_plan(
    mappings: list[dict[str, Any]],
    *,
    ticker_filter: str | None,
    limit: int | None,
) -> tuple[list[MappingPlan], list[SkippedMapping]]:
    plan: list[MappingPlan] = []
    skipped: list[SkippedMapping] = []

    for index, mapping in enumerate(mappings):
        label = mapping_label(mapping, index)
        ticker = mapping.get("ticker")
        cik = mapping.get("cik")
        review_status = mapping.get("review_status")

        if ticker_filter and ticker != ticker_filter:
            skipped.append(SkippedMapping(label=label, reason="excluded by ticker filter"))
            continue

        if review_status != APPROVED_FOR_FETCH:
            skipped.append(
                SkippedMapping(
                    label=label,
                    reason=f"review_status is {review_status!r}, not {APPROVED_FOR_FETCH}",
                )
            )
            continue

        if not isinstance(ticker, str) or not isinstance(cik, str):
            skipped.append(
                SkippedMapping(label=label, reason="missing ticker or CIK string")
            )
            continue

        if limit is not None and len(plan) >= limit:
            skipped.append(SkippedMapping(label=label, reason="excluded by --limit"))
            continue

        plan.append(MappingPlan(index=index, ticker=ticker, cik=cik))

    if ticker_filter and not plan:
        raise ProvisionerError(
            f"--ticker {ticker_filter} has no approved_for_fetch CIK mapping in {CIK_MAPPINGS_PATH}."
        )

    return plan, skipped


def sec_fetch_command(
    *,
    ticker: str,
    user_agent: str,
    dry_run: bool,
) -> list[str]:
    command = [
        sys.executable,
        str(SEC_FETCH_CACHE_SCRIPT),
        "--ticker",
        ticker,
        "--user-agent",
        user_agent,
    ]
    if dry_run:
        command.append("--dry-run")
    return command


def run_sec_fetches(
    plan: list[MappingPlan],
    *,
    allow_network: bool,
    user_agent: str | None,
) -> tuple[SecRunSummary, list[SkippedMapping]]:
    summary = SecRunSummary(planned=len(plan))
    skipped: list[SkippedMapping] = []
    dry_run = not allow_network
    helper_user_agent = (
        user_agent.strip()
        if user_agent and user_agent.strip()
        else DRY_RUN_USER_AGENT
    )

    for item in plan:
        command = sec_fetch_command(
            ticker=item.ticker,
            user_agent=helper_user_agent,
            dry_run=dry_run,
        )
        print_section(f"SEC cache {'dry-run' if dry_run else 'fetch'}: {item.ticker}")
        print(f"Command: {display_command(command)}")
        if dry_run and helper_user_agent == DRY_RUN_USER_AGENT:
            print("Dry-run helper user-agent: local placeholder; network is disabled.")

        result = run_subprocess(command)
        print_completed_process(result)
        if result.returncode != 0:
            raise ProvisionerError(
                f"SEC cache helper failed for {item.ticker}; production writes remain 0."
            )

        output = result.stdout
        if dry_run:
            summary.helper_dry_runs += 1
        else:
            summary.helper_network_runs += 1
            if "status: fetched" in output:
                summary.fetched += 1
            elif "status: cache-hit" in output:
                summary.cache_hits += 1
                skipped.append(
                    SkippedMapping(
                        label=item.ticker,
                        reason="cache hit; network fetch skipped by sec_fetch_cache.py",
                    )
                )

    return summary, skipped


def print_skipped_mappings(
    skipped: list[SkippedMapping],
    *,
    summary_only: bool,
) -> None:
    print("Skipped mappings:")
    if not skipped:
        print("- none")
        return

    reason_counts = Counter(item.reason for item in skipped)
    for reason, count in sorted(reason_counts.items()):
        print(f"- {reason}: {count}")

    if not summary_only:
        print("Skipped mapping detail:")
        for item in skipped:
            print(f"- {item.label}: {item.reason}")


def print_report(
    *,
    mode: str,
    validations: list[ValidationRun],
    sec_summary: SecRunSummary,
    skipped: list[SkippedMapping],
    summary_only: bool,
) -> None:
    print_section("Provisioner report")
    print(f"Mode: {mode}")
    print("Production writes: 0")
    print("Production graph data changed: no")
    print("Candidate files changed: no")
    print("Network calls without --allow-network: disabled")
    print(f"Candidate validations run: {len(validations)}")
    for validation in validations:
        print(f"- {validation.label}: passed")
    print(f"SEC fetches planned: {sec_summary.planned}")
    print(f"SEC dry-run previews executed: {sec_summary.helper_dry_runs}")
    print(f"SEC fetch helper network runs: {sec_summary.helper_network_runs}")
    print(f"SEC fetches executed: {sec_summary.fetched}")
    print(f"SEC cache hits: {sec_summary.cache_hits}")
    print_skipped_mappings(skipped, summary_only=summary_only)
    print(
        "Next manual review step: review validation output and SEC cache targets; "
        "use --allow-network with an identifying --user-agent only for approved_for_fetch mappings."
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        ticker_filter = normalize_ticker_filter(args.ticker)
        if not (ROOT / CIK_MAPPINGS_PATH).exists():
            raise ProvisionerError(f"CIK mapping file is missing: {CIK_MAPPINGS_PATH}")

        mode = "network-enabled" if args.allow_network else "dry-run"
        print("StockPhotonic local data provisioner")
        print(f"Mode: {mode}")
        print("Production writes: 0")

        validations = [
            validate_candidate_file(
                label="official ticker universe",
                path=OFFICIAL_TICKER_UNIVERSE_PATH,
                summary_only=args.summary_only,
            ),
            validate_candidate_file(
                label="CIK mappings",
                path=CIK_MAPPINGS_PATH,
                summary_only=args.summary_only,
            ),
        ]

        mappings = load_cik_mappings(CIK_MAPPINGS_PATH)
        plan, skipped = build_sec_plan(
            mappings,
            ticker_filter=ticker_filter,
            limit=args.limit,
        )
        sec_summary, sec_skipped = run_sec_fetches(
            plan,
            allow_network=args.allow_network,
            user_agent=args.user_agent,
        )
        skipped.extend(sec_skipped)

        print_report(
            mode=mode,
            validations=validations,
            sec_summary=sec_summary,
            skipped=skipped,
            summary_only=args.summary_only,
        )
        return 0
    except json.JSONDecodeError as exc:
        print(
            f"error: invalid JSON while loading candidate mappings: {exc}",
            file=sys.stderr,
        )
        print("production writes remain 0", file=sys.stderr)
        return 2
    except ProvisionerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
