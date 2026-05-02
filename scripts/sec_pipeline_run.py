#!/usr/bin/env python3
"""One-command local SEC pipeline runner.

This runner delegates to the existing dry-run-first SEC scripts. It never
writes production graph data and only writes the review-only SEC relationship
candidate file when --write-candidates is explicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_TICKER_UNIVERSE_PATH = Path("data/candidates/official_ticker_universe.json")
CIK_MAPPINGS_PATH = Path("data/candidates/cik_mappings.json")
PLAN_DIR = ROOT / "data" / "candidates" / "plans"
PRODUCTION_DATA_PATHS = (
    Path("data/companies.json"),
    Path("data/connections.json"),
)

INGEST_CANDIDATES_SCRIPT = Path("scripts/ingest_candidates.py")
SEC_FETCH_CACHE_SCRIPT = Path("scripts/sec_fetch_cache.py")
SEC_SUBMISSIONS_INSPECT_SCRIPT = Path("scripts/sec_submissions_inspect.py")
SEC_FILING_PLAN_SCRIPT = Path("scripts/sec_filing_plan.py")
SEC_FILING_FETCH_SCRIPT = Path("scripts/sec_filing_fetch.py")
SEC_SIGNAL_REPORT_SCRIPT = Path("scripts/sec_signal_report.py")
SEC_SIGNAL_CANDIDATES_PREVIEW_SCRIPT = Path("scripts/sec_signal_candidates_preview.py")
SEC_SIGNAL_CANDIDATES_WRITE_SCRIPT = Path("scripts/sec_signal_candidates_write.py")

DEFAULT_FORMS = "10-K,10-Q,8-K"
DEFAULT_LIMIT = 10
DEFAULT_TIMEOUT_SECONDS = 20.0
DRY_RUN_USER_AGENT = "StockPhotonic SEC pipeline dry-run dry-run@example.com"
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")
SUMMARY_VALUE_PATTERN = re.compile(r"^([a-z_]+):\s*(\d+)\s*$")


class SecPipelineError(Exception):
    """Raised for clear pipeline failures."""


@dataclass
class PipelineSummary:
    ticker: str
    filings_planned: int = 0
    filings_fetched: int = 0
    filings_cache_hit: int = 0
    cached_filings_available: int = 0
    candidate_previews_generated: int = 0
    candidate_file_written: bool = False
    production_writes: int = 0


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit-chars must be an integer.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("--limit-chars must be at least 0.")
    return parsed


def parse_positive_timeout(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--timeout must be a number.") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("--timeout must be greater than zero.")
    return parsed


def normalize_ticker(raw_ticker: str) -> str:
    ticker = raw_ticker.strip().upper()
    if not ticker or not TICKER_PATTERN.match(ticker):
        raise argparse.ArgumentTypeError(
            "--ticker must use a supported public ticker format."
        )
    return ticker


def normalize_forms(raw_forms: str) -> str:
    forms: list[str] = []
    seen: set[str] = set()
    for raw_form in raw_forms.split(","):
        form = raw_form.strip().upper()
        if not form:
            continue
        if form not in seen:
            forms.append(form)
            seen.add(form)
    if not forms:
        raise argparse.ArgumentTypeError("--forms must include at least one form type.")
    return ",".join(forms)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the local SEC pipeline for one ticker through signal candidate "
            "preview and optional review-only candidate-file writing. Default "
            "mode is dry-run/preview only."
        )
    )
    parser.add_argument("--ticker", required=True, type=normalize_ticker)
    parser.add_argument(
        "--forms",
        type=normalize_forms,
        default=DEFAULT_FORMS,
        help=f"Comma-separated form filter. Default: {DEFAULT_FORMS}.",
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        default=DEFAULT_LIMIT,
        help=f"Maximum filings to plan and process. Default: {DEFAULT_LIMIT}.",
    )
    parser.add_argument(
        "--limit-chars",
        type=parse_nonnegative_int,
        help="Optional maximum decoded characters to scan per cached filing.",
    )
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="Permit SEC submissions and filing document fetches.",
    )
    parser.add_argument(
        "--user-agent",
        help=(
            "Identifying SEC User-Agent. Required with --allow-network. "
            "Optional in dry-run mode."
        ),
    )
    parser.add_argument(
        "--write-candidates",
        action="store_true",
        help=(
            "Write data/candidates/sec_relationship_candidates.json through "
            "the existing review-only writer."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Pass --force to the review-only candidate writer.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Refetch SEC cache artifacts when network is enabled.",
    )
    parser.add_argument(
        "--timeout",
        type=parse_positive_timeout,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Network timeout in seconds. Default: {DEFAULT_TIMEOUT_SECONDS:g}.",
    )
    args = parser.parse_args(argv)

    if args.allow_network and not (args.user_agent and args.user_agent.strip()):
        parser.error("--allow-network requires --user-agent.")
    if args.force and not args.write_candidates:
        parser.error("--force can only be used with --write-candidates.")
    return args


def subprocess_environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def display_command(command: list[str]) -> str:
    display_parts: list[str] = []
    for part in command:
        if part == sys.executable:
            display_parts.append("python")
        elif any(char.isspace() for char in part):
            display_parts.append(f'"{part}"')
        else:
            display_parts.append(part)
    return " ".join(display_parts)


def print_step(number: int, title: str) -> None:
    print()
    print(f"Step {number}: {title}")
    print("-" * (len(title) + len(f"Step {number}: ")))


def print_completed_process(result: subprocess.CompletedProcess[str]) -> None:
    stdout = result.stdout.rstrip()
    stderr = result.stderr.rstrip()
    if stdout:
        print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)


def run_subprocess(
    *,
    command: list[str],
    failure_message: str,
) -> subprocess.CompletedProcess[str]:
    print(f"Command: {display_command(command)}")
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=subprocess_environment(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    print_completed_process(result)
    if result.returncode != 0:
        raise SecPipelineError(f"{failure_message}; production writes remain 0.")
    return result


def parse_json_stdout(
    result: subprocess.CompletedProcess[str],
    *,
    label: str,
) -> dict[str, Any]:
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SecPipelineError(
            f"{label} did not return parseable JSON: {exc.msg}"
        ) from exc
    if not isinstance(payload, dict):
        raise SecPipelineError(f"{label} JSON output must be an object.")
    return payload


def parse_cache_path(output: str) -> Path:
    for line in output.splitlines():
        if line.startswith("cache_path: "):
            raw_path = line.split(": ", 1)[1].strip()
            path = Path(raw_path)
            return path if path.is_absolute() else ROOT / path
    raise SecPipelineError("SEC submissions cache helper did not print cache_path.")


def parse_fetch_summary(output: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in output.splitlines():
        match = SUMMARY_VALUE_PATTERN.match(line.strip())
        if match:
            counts[match.group(1)] = int(match.group(2))
    return counts


def parse_fetch_cache_paths(output: str) -> list[Path]:
    paths: list[Path] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped.startswith("cache_path="):
            continue
        raw_path = stripped.split("=", 1)[1].strip()
        path = Path(raw_path)
        paths.append(path if path.is_absolute() else ROOT / path)
    return paths


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        absolute_path = ROOT / path
        try:
            hashes[path] = hashlib.sha256(absolute_path.read_bytes()).hexdigest()
        except OSError as exc:
            raise SecPipelineError(f"could not read production data guard file {path}: {exc}") from exc
    return hashes


def assert_production_data_unchanged(initial_hashes: dict[Path, str]) -> None:
    current_hashes = production_hashes()
    changed = [
        str(path)
        for path, initial_hash in initial_hashes.items()
        if current_hashes.get(path) != initial_hash
    ]
    if changed:
        raise SecPipelineError(
            "production data changed during SEC pipeline run: "
            f"{', '.join(changed)}"
        )


def helper_user_agent(args: argparse.Namespace) -> str:
    if args.user_agent and args.user_agent.strip():
        return args.user_agent.strip()
    return DRY_RUN_USER_AGENT


def run_candidate_validation() -> None:
    validations = (
        (
            "official ticker universe",
            OFFICIAL_TICKER_UNIVERSE_PATH,
            "official-ticker-universe",
        ),
        ("CIK mappings", CIK_MAPPINGS_PATH, "cik-mappings"),
    )
    for label, path, candidate_kind in validations:
        command = [
            sys.executable,
            str(INGEST_CANDIDATES_SCRIPT),
            "--candidates",
            str(path),
            "--candidate-kind",
            candidate_kind,
            "--summary-only",
        ]
        run_subprocess(
            command=command,
            failure_message=f"candidate validation failed for {label}",
        )


def run_submissions_fetch(args: argparse.Namespace) -> Path:
    dry_run = not args.allow_network
    command = [
        sys.executable,
        str(SEC_FETCH_CACHE_SCRIPT),
        "--ticker",
        args.ticker,
        "--user-agent",
        helper_user_agent(args),
    ]
    if dry_run:
        command.append("--dry-run")
    if args.force_refresh:
        command.append("--force-refresh")
    command.extend(["--timeout", f"{args.timeout:g}"])

    if dry_run and not args.user_agent:
        print("Dry-run helper user-agent: local placeholder; network is disabled.")

    result = run_subprocess(
        command=command,
        failure_message=f"SEC submissions {'dry-run' if dry_run else 'fetch'} failed",
    )
    cache_path = parse_cache_path(result.stdout)
    if not cache_path.exists():
        mode_hint = (
            'rerun with --allow-network --user-agent "Your Name email@example.com"'
            if dry_run
            else "inspect the SEC fetch output above"
        )
        raise SecPipelineError(
            f"submissions cache is not available at {cache_path}; {mode_hint}"
        )
    return cache_path


def run_submissions_inspect(args: argparse.Namespace, cache_path: Path) -> None:
    command = [
        sys.executable,
        str(SEC_SUBMISSIONS_INSPECT_SCRIPT),
        "--cache-file",
        str(cache_path),
        "--ticker",
        args.ticker,
        "--forms",
        args.forms,
        "--limit",
        str(args.limit),
    ]
    run_subprocess(
        command=command,
        failure_message="SEC submissions inspection failed",
    )


def run_filing_plan(args: argparse.Namespace, cache_path: Path) -> dict[str, Any]:
    command = [
        sys.executable,
        str(SEC_FILING_PLAN_SCRIPT),
        "--cache-file",
        str(cache_path),
        "--ticker",
        args.ticker,
        "--forms",
        args.forms,
        "--limit",
        str(args.limit),
        "--json",
    ]
    result = run_subprocess(
        command=command,
        failure_message="SEC filing plan generation failed",
    )
    return parse_json_stdout(result, label="SEC filing plan")


def write_temporary_plan(plan: dict[str, Any], ticker: str) -> Path:
    PLAN_DIR.mkdir(parents=True, exist_ok=True)
    handle, raw_path = tempfile.mkstemp(
        prefix=f".sec_pipeline_{ticker.lower()}_",
        suffix=".json",
        dir=PLAN_DIR,
        text=True,
    )
    temp_path = Path(raw_path)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(plan, file, indent=2, sort_keys=True)
            file.write("\n")
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise
    return temp_path


def run_filing_fetch(
    args: argparse.Namespace,
    temp_plan_path: Path,
) -> tuple[dict[str, int], list[Path]]:
    command = [
        sys.executable,
        str(SEC_FILING_FETCH_SCRIPT),
        "--plan",
        str(temp_plan_path),
        "--limit",
        str(args.limit),
        "--timeout",
        f"{args.timeout:g}",
    ]
    if args.allow_network:
        command.extend(["--allow-network", "--user-agent", helper_user_agent(args)])
    else:
        command.append("--dry-run")
    if args.force_refresh:
        command.append("--force-refresh")

    result = run_subprocess(
        command=command,
        failure_message=f"SEC filing {'fetch' if args.allow_network else 'dry-run'} failed",
    )
    return parse_fetch_summary(result.stdout), parse_fetch_cache_paths(result.stdout)


def existing_cached_filings(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    existing: list[Path] = []
    for path in paths:
        resolved = path.resolve(strict=False)
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        existing.append(path)
    return existing


def add_limit_chars(command: list[str], limit_chars: int | None) -> None:
    if limit_chars is not None:
        command.extend(["--limit-chars", str(limit_chars)])


def run_signal_report(args: argparse.Namespace, files: list[Path]) -> dict[str, Any]:
    command = [
        sys.executable,
        str(SEC_SIGNAL_REPORT_SCRIPT),
        "--files",
        *[str(path) for path in files],
        "--json",
    ]
    add_limit_chars(command, args.limit_chars)
    result = run_subprocess(
        command=command,
        failure_message="SEC signal report failed",
    )
    return parse_json_stdout(result, label="SEC signal report")


def run_candidate_preview(args: argparse.Namespace, files: list[Path]) -> dict[str, Any]:
    command = [
        sys.executable,
        str(SEC_SIGNAL_CANDIDATES_PREVIEW_SCRIPT),
        "--files",
        *[str(path) for path in files],
        "--json",
    ]
    add_limit_chars(command, args.limit_chars)
    result = run_subprocess(
        command=command,
        failure_message="SEC candidate preview failed",
    )
    return parse_json_stdout(result, label="SEC candidate preview")


def run_candidate_writer(args: argparse.Namespace, files: list[Path]) -> None:
    command = [
        sys.executable,
        str(SEC_SIGNAL_CANDIDATES_WRITE_SCRIPT),
        "--files",
        *[str(path) for path in files],
        "--write",
    ]
    add_limit_chars(command, args.limit_chars)
    if args.force:
        command.append("--force")
    run_subprocess(
        command=command,
        failure_message="SEC review-only candidate writer failed",
    )


def print_final_summary(summary: PipelineSummary) -> None:
    print()
    print("SEC pipeline final summary")
    print("==========================")
    print(f"ticker: {summary.ticker}")
    print(f"filings planned: {summary.filings_planned}")
    print(
        "filings fetched/cache-hit: "
        f"{summary.filings_fetched}/{summary.filings_cache_hit}"
    )
    print(f"cached filings available for preview: {summary.cached_filings_available}")
    print(f"candidate previews generated: {summary.candidate_previews_generated}")
    print(
        "candidate file written: "
        f"{'yes' if summary.candidate_file_written else 'no'}"
    )
    print(f"production writes: {summary.production_writes}")


def run_pipeline(args: argparse.Namespace, summary: PipelineSummary) -> PipelineSummary:
    initial_hashes = production_hashes()
    temp_plan_path: Path | None = None

    print("StockPhotonic local SEC pipeline runner")
    print(f"Mode: {'network-enabled' if args.allow_network else 'dry-run/preview'}")
    print("Production writes: 0")
    print("Candidate file writing: " + ("enabled" if args.write_candidates else "disabled"))

    try:
        print_step(1, "validate candidates")
        run_candidate_validation()

        print_step(2, "dry-run or fetch SEC submissions")
        submissions_cache_path = run_submissions_fetch(args)

        print_step(3, "inspect submissions")
        run_submissions_inspect(args, submissions_cache_path)

        print_step(4, "create filing plan")
        plan = run_filing_plan(args, submissions_cache_path)
        metadata = plan.get("metadata", {})
        if isinstance(metadata, dict):
            summary.filings_planned = int(metadata.get("planned_filing_count") or 0)
        temp_plan_path = write_temporary_plan(plan, args.ticker)
        print(f"Temporary plan artifact: {temp_plan_path}")

        print_step(5, "dry-run or fetch filing documents")
        fetch_counts, planned_cache_paths = run_filing_fetch(args, temp_plan_path)
        summary.filings_fetched = fetch_counts.get("fetched", 0)
        summary.filings_cache_hit = fetch_counts.get("cache_hit", 0)

        cached_files = existing_cached_filings(planned_cache_paths)
        summary.cached_filings_available = len(cached_files)
        missing_count = len(planned_cache_paths) - len(cached_files)
        if missing_count:
            print(
                "warning: "
                f"{missing_count} planned filing cache document(s) are not available locally.",
                file=sys.stderr,
            )
        if not cached_files:
            raise SecPipelineError(
                "no cached filing documents are available for signal reporting; "
                "rerun with --allow-network and --user-agent, or fetch filings manually first"
            )

        print_step(6, "run signal report")
        run_signal_report(args, cached_files)

        print_step(7, "run candidate preview")
        preview = run_candidate_preview(args, cached_files)
        summary.candidate_previews_generated = int(
            preview.get("preview_candidate_count") or 0
        )

        if args.write_candidates:
            print_step(8, "write review-only candidate file")
            run_candidate_writer(args, cached_files)
            summary.candidate_file_written = True
        else:
            print_step(8, "write review-only candidate file")
            print("Skipped: pass --write-candidates to write the review-only candidate file.")

        assert_production_data_unchanged(initial_hashes)
        return summary
    finally:
        if temp_plan_path is not None:
            try:
                temp_plan_path.unlink(missing_ok=True)
                print(f"Temporary plan artifact removed: {temp_plan_path}")
            except OSError as exc:
                print(
                    f"warning: could not remove temporary plan artifact {temp_plan_path}: {exc}",
                    file=sys.stderr,
                )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    summary = PipelineSummary(ticker=args.ticker)
    try:
        summary = run_pipeline(args, summary)
    except SecPipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print_final_summary(summary)
        return 2

    print_final_summary(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
