#!/usr/bin/env python3
"""Safe local bulk runner for approved SEC ticker mappings.

The batch runner delegates per-ticker processing to scripts/sec_pipeline_run.py
and keeps production graph writes out of scope. Network access and review-only
candidate output are both explicit opt-ins.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
SEC_PIPELINE_RUN_SCRIPT = ROOT / "scripts" / "sec_pipeline_run.py"
SEC_SIGNAL_CANDIDATES_WRITE_SCRIPT = ROOT / "scripts" / "sec_signal_candidates_write.py"
PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)

DEFAULT_FORMS = "10-K,10-Q,8-K"
DEFAULT_LIMIT = 10
APPROVED_STATUS = "approved_for_fetch"
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")
NO_USABLE_FILINGS_PATTERNS = (
    "no cached filing documents are available",
    "submissions cache is not available",
    "planned_filing_count\": 0",
    "Planned filing count: 0",
)


class SecBulkPipelineError(Exception):
    """Raised for clear batch setup or safety failures."""


@dataclass
class TickerResult:
    ticker: str
    status: str
    reason: str | None = None
    cached_files: list[Path] = field(default_factory=list)
    returncode: int = 0


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def normalize_ticker(raw_ticker: str) -> str:
    ticker = raw_ticker.strip().upper()
    if not ticker or not TICKER_PATTERN.match(ticker):
        raise argparse.ArgumentTypeError(
            "--tickers must contain supported public ticker symbols."
        )
    return ticker


def parse_ticker_list(value: str) -> list[str]:
    tickers: list[str] = []
    seen: set[str] = set()
    for raw_ticker in value.split(","):
        ticker = normalize_ticker(raw_ticker)
        if ticker in seen:
            continue
        seen.add(ticker)
        tickers.append(ticker)
    if not tickers:
        raise argparse.ArgumentTypeError("--tickers must include at least one ticker.")
    return tickers


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
            "Run the local SEC pipeline for multiple approved ticker/CIK mappings. "
            "Default mode is dry-run/preview only and production graph writes stay at 0."
        )
    )
    parser.add_argument(
        "--tickers",
        required=True,
        type=parse_ticker_list,
        help="Comma-separated ticker list, for example AAPL,MSFT,NVDA.",
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        default=DEFAULT_LIMIT,
        help=f"Maximum filings per ticker to plan and process. Default: {DEFAULT_LIMIT}.",
    )
    parser.add_argument(
        "--forms",
        type=normalize_forms,
        default=DEFAULT_FORMS,
        help=f"Comma-separated form filter. Default: {DEFAULT_FORMS}.",
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
            "After successful ticker previews, write one combined review-only "
            "SEC relationship candidate file."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Pass --force to the review-only candidate writer.",
    )
    args = parser.parse_args(argv)

    if args.allow_network and not (args.user_agent and args.user_agent.strip()):
        parser.error("--allow-network requires --user-agent.")
    if args.force and not args.write_candidates:
        parser.error("--force can only be used with --write-candidates.")
    return args


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise SecBulkPipelineError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SecBulkPipelineError(f"could not parse {label} file {path}: {exc}") from exc


def load_mapping_statuses() -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    payload = load_json(CIK_MAPPINGS_PATH, "CIK mappings")
    if not isinstance(payload, dict):
        raise SecBulkPipelineError("CIK mappings file must contain a JSON object.")

    mappings = payload.get("mappings")
    if not isinstance(mappings, list):
        raise SecBulkPipelineError("CIK mappings file must contain a mappings array.")

    approved: dict[str, dict[str, Any]] = {}
    statuses: dict[str, str] = {}
    for index, mapping in enumerate(mappings, start=1):
        if not isinstance(mapping, dict):
            raise SecBulkPipelineError(f"CIK mapping {index} must be an object.")
        raw_ticker = mapping.get("ticker")
        if not isinstance(raw_ticker, str) or not raw_ticker.strip():
            raise SecBulkPipelineError(f"CIK mapping {index} is missing ticker.")
        ticker = raw_ticker.strip().upper()
        review_status = str(mapping.get("review_status") or "").strip()
        if ticker in statuses:
            raise SecBulkPipelineError(f"duplicate ticker in CIK mappings: {ticker}.")
        statuses[ticker] = review_status
        if review_status == APPROVED_STATUS:
            approved[ticker] = mapping
    return approved, statuses


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise SecBulkPipelineError(
                f"could not read production data guard file {path}: {exc}"
            ) from exc
    return hashes


def assert_production_data_unchanged(initial_hashes: dict[Path, str]) -> None:
    current_hashes = production_hashes()
    changed = [
        str(path.relative_to(ROOT))
        for path, initial_hash in initial_hashes.items()
        if current_hashes.get(path) != initial_hash
    ]
    if changed:
        raise SecBulkPipelineError(
            "production data changed during bulk SEC pipeline run: "
            f"{', '.join(changed)}"
        )


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


def print_completed_process(result: subprocess.CompletedProcess[str]) -> None:
    stdout = result.stdout.rstrip()
    stderr = result.stderr.rstrip()
    if stdout:
        print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)


def run_subprocess(command: list[str]) -> subprocess.CompletedProcess[str]:
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
    return result


def pipeline_command(args: argparse.Namespace, ticker: str) -> list[str]:
    command = [
        sys.executable,
        str(SEC_PIPELINE_RUN_SCRIPT),
        "--ticker",
        ticker,
        "--forms",
        args.forms,
        "--limit",
        str(args.limit),
    ]
    if args.allow_network:
        command.extend(["--allow-network", "--user-agent", args.user_agent.strip()])
    return command


def parse_existing_cache_paths(output: str) -> list[Path]:
    paths: list[Path] = []
    seen: set[Path] = set()
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped.startswith("cache_path="):
            continue
        raw_path = stripped.split("=", 1)[1].strip()
        path = Path(raw_path)
        if not path.is_absolute():
            path = ROOT / path
        resolved = path.resolve(strict=False)
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        paths.append(path)
    return paths


def is_no_usable_filings_output(output: str) -> bool:
    return any(pattern in output for pattern in NO_USABLE_FILINGS_PATTERNS)


def run_ticker_pipeline(
    *,
    args: argparse.Namespace,
    ticker: str,
    initial_hashes: dict[Path, str],
) -> TickerResult:
    print()
    print(f"SEC bulk pipeline ticker: {ticker}")
    print("=" * (len(ticker) + len("SEC bulk pipeline ticker: ")))
    result = run_subprocess(pipeline_command(args, ticker))
    assert_production_data_unchanged(initial_hashes)

    combined_output = f"{result.stdout}\n{result.stderr}"
    if result.returncode == 0:
        return TickerResult(
            ticker=ticker,
            status="processed",
            cached_files=parse_existing_cache_paths(combined_output),
            returncode=result.returncode,
        )
    if is_no_usable_filings_output(combined_output):
        return TickerResult(
            ticker=ticker,
            status="skipped",
            reason="no usable filings or local SEC cache",
            returncode=result.returncode,
        )
    return TickerResult(
        ticker=ticker,
        status="failed",
        reason=f"single-ticker pipeline exited {result.returncode}",
        returncode=result.returncode,
    )


def write_combined_candidates(
    *,
    args: argparse.Namespace,
    files: list[Path],
    initial_hashes: dict[Path, str],
) -> bool:
    if not args.write_candidates:
        print()
        print("Candidate file writing skipped: pass --write-candidates to write review-only candidates.")
        return False
    if not files:
        print()
        print("Candidate file writing skipped: no cached filing documents were available.")
        return False

    print()
    print("SEC bulk candidate writer")
    print("=========================")
    command = [
        sys.executable,
        str(SEC_SIGNAL_CANDIDATES_WRITE_SCRIPT),
        "--files",
        *[str(path) for path in files],
        "--write",
    ]
    if args.force:
        command.append("--force")

    result = run_subprocess(command)
    assert_production_data_unchanged(initial_hashes)
    if result.returncode != 0:
        raise SecBulkPipelineError(
            "combined review-only SEC candidate writer failed; production writes remain 0."
        )
    return True


def result_list(results: list[TickerResult], status: str) -> list[TickerResult]:
    return [result for result in results if result.status == status]


def format_result_items(results: list[TickerResult]) -> str:
    if not results:
        return "none"
    items: list[str] = []
    for result in results:
        if result.reason:
            items.append(f"{result.ticker} ({result.reason})")
        else:
            items.append(result.ticker)
    return ", ".join(items)


def print_batch_summary(
    *,
    requested_tickers: list[str],
    results: list[TickerResult],
    candidate_file_written: bool,
) -> None:
    processed = result_list(results, "processed")
    skipped = result_list(results, "skipped")
    failed = result_list(results, "failed")

    print()
    print("SEC bulk pipeline batch summary")
    print("===============================")
    print(f"tickers requested: {len(requested_tickers)} ({', '.join(requested_tickers)})")
    print(f"tickers processed: {len(processed)} ({format_result_items(processed)})")
    print(f"tickers skipped: {len(skipped)} ({format_result_items(skipped)})")
    print(f"candidate files written: {'yes' if candidate_file_written else 'no'}")
    print(f"failed tickers: {len(failed)} ({format_result_items(failed)})")
    print("production writes: 0")


def candidate_input_files(results: list[TickerResult]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for result in results:
        if result.status != "processed":
            continue
        for path in result.cached_files:
            resolved = path.resolve(strict=False)
            if resolved in seen:
                continue
            seen.add(resolved)
            files.append(path)
    return files


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    results: list[TickerResult] = []
    candidate_file_written = False

    try:
        approved_mappings, mapping_statuses = load_mapping_statuses()
        initial_hashes = production_hashes()

        print("StockPhotonic bulk SEC pipeline runner")
        print(f"Mode: {'network-enabled' if args.allow_network else 'dry-run/preview'}")
        print("Candidate file writing: " + ("enabled" if args.write_candidates else "disabled"))
        print("Production writes: 0")
        print(f"Approved mapping source: {CIK_MAPPINGS_PATH.relative_to(ROOT)}")

        for ticker in args.tickers:
            if ticker not in mapping_statuses:
                results.append(
                    TickerResult(ticker=ticker, status="skipped", reason="no CIK mapping")
                )
                continue
            if ticker not in approved_mappings:
                results.append(
                    TickerResult(
                        ticker=ticker,
                        status="skipped",
                        reason=f"mapping review_status is {mapping_statuses[ticker] or 'missing'}",
                    )
                )
                continue
            results.append(
                run_ticker_pipeline(
                    args=args,
                    ticker=ticker,
                    initial_hashes=initial_hashes,
                )
            )

        failed = result_list(results, "failed")
        if failed:
            print()
            print(
                "Candidate file writing skipped because one or more ticker pipelines failed.",
                file=sys.stderr,
            )
        else:
            candidate_file_written = write_combined_candidates(
                args=args,
                files=candidate_input_files(results),
                initial_hashes=initial_hashes,
            )

        assert_production_data_unchanged(initial_hashes)
    except SecBulkPipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print_batch_summary(
            requested_tickers=args.tickers,
            results=results,
            candidate_file_written=candidate_file_written,
        )
        return 2

    print_batch_summary(
        requested_tickers=args.tickers,
        results=results,
        candidate_file_written=candidate_file_written,
    )
    return 1 if result_list(results, "failed") else 0


if __name__ == "__main__":
    raise SystemExit(main())
