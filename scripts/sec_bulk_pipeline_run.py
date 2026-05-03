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
import threading
from dataclasses import dataclass, field
from pathlib import Path
from queue import Queue
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
FILINGS_PLANNED_PATTERN = re.compile(r"^filings planned:\s*(\d+)\s*$")
FILINGS_FETCHED_CACHE_HIT_PATTERN = re.compile(
    r"^filings fetched/cache-hit:\s*(\d+)/(\d+)\s*$"
)
RAW_SIGNALS_PATTERN = re.compile(r"^raw signals:\s*(\d+)\s*$")
CANDIDATE_PREVIEWS_PATTERN = re.compile(
    r"^candidate previews generated:\s*(\d+)\s*$"
)
CANDIDATE_FILE_WRITTEN_PATTERN = re.compile(
    r"^candidate file written:\s*(yes|no)\s*$",
    re.IGNORECASE,
)
WRITTEN_CANDIDATES_PATTERN = re.compile(
    r"^wrote\s+(\d+)\s+review-only SEC relationship candidates\b"
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
    filings_planned: int | None = None
    filings_fetched: int | None = None
    filings_cache_hit: int | None = None
    raw_signals: int | None = None
    candidate_previews: int | None = None
    candidate_file_written: bool | None = None
    candidate_file_count: int | None = None


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
    env["PYTHONUNBUFFERED"] = "1"
    return env


def mode_label(args: argparse.Namespace) -> str:
    return "network-enabled" if args.allow_network else "dry-run/preview"


def candidate_writing_label(args: argparse.Namespace) -> str:
    return "enabled" if args.write_candidates else "disabled"


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


def read_process_stream(
    stream_name: str,
    stream: Any,
    output_queue: Queue[tuple[str, str | None]],
) -> None:
    try:
        for line in stream:
            output_queue.put((stream_name, line))
    finally:
        output_queue.put((stream_name, None))


def run_subprocess(command: list[str]) -> subprocess.CompletedProcess[str]:
    print(f"Command: {display_command(command)}", flush=True)
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env=subprocess_environment(),
        text=True,
        bufsize=1,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.stdout is None or process.stderr is None:
        raise SecBulkPipelineError("could not open subprocess output streams.")

    output_queue: Queue[tuple[str, str | None]] = Queue()
    threads = [
        threading.Thread(
            target=read_process_stream,
            args=("stdout", process.stdout, output_queue),
            daemon=True,
        ),
        threading.Thread(
            target=read_process_stream,
            args=("stderr", process.stderr, output_queue),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    open_streams = len(threads)
    while open_streams:
        stream_name, line = output_queue.get()
        if line is None:
            open_streams -= 1
            continue
        if stream_name == "stdout":
            stdout_lines.append(line)
            print(line, end="", flush=True)
        else:
            stderr_lines.append(line)
            print(line, end="", file=sys.stderr, flush=True)

    returncode = process.wait()
    for thread in threads:
        thread.join()

    return subprocess.CompletedProcess(
        command,
        returncode,
        "".join(stdout_lines),
        "".join(stderr_lines),
    )


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
    if args.write_candidates:
        command.append("--write-candidates")
    if args.force:
        command.append("--force")
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


def parse_pipeline_metrics(output: str) -> dict[str, int | bool]:
    metrics: dict[str, int | bool] = {}
    for line in output.splitlines():
        stripped = line.strip()
        if match := FILINGS_PLANNED_PATTERN.match(stripped):
            metrics["filings_planned"] = int(match.group(1))
        elif match := FILINGS_FETCHED_CACHE_HIT_PATTERN.match(stripped):
            metrics["filings_fetched"] = int(match.group(1))
            metrics["filings_cache_hit"] = int(match.group(2))
        elif match := RAW_SIGNALS_PATTERN.match(stripped):
            metrics["raw_signals"] = int(match.group(1))
        elif match := CANDIDATE_PREVIEWS_PATTERN.match(stripped):
            metrics["candidate_previews"] = int(match.group(1))
        elif match := CANDIDATE_FILE_WRITTEN_PATTERN.match(stripped):
            metrics["candidate_file_written"] = match.group(1).lower() == "yes"
        elif match := WRITTEN_CANDIDATES_PATTERN.match(stripped):
            metrics["candidate_file_count"] = int(match.group(1))
    return metrics


def metric_int(metrics: dict[str, int | bool], name: str) -> int | None:
    value = metrics.get(name)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def metric_bool(metrics: dict[str, int | bool], name: str) -> bool | None:
    value = metrics.get(name)
    if isinstance(value, bool):
        return value
    return None


def result_with_metrics(result: TickerResult, metrics: dict[str, int | bool]) -> TickerResult:
    result.filings_planned = metric_int(metrics, "filings_planned")
    result.filings_fetched = metric_int(metrics, "filings_fetched")
    result.filings_cache_hit = metric_int(metrics, "filings_cache_hit")
    result.raw_signals = metric_int(metrics, "raw_signals")
    result.candidate_previews = metric_int(metrics, "candidate_previews")
    result.candidate_file_written = metric_bool(metrics, "candidate_file_written")
    result.candidate_file_count = metric_int(metrics, "candidate_file_count")
    return result


def is_no_usable_filings_output(output: str) -> bool:
    return any(pattern in output for pattern in NO_USABLE_FILINGS_PATTERNS)


def format_optional_count(value: int | None) -> str:
    return "not available" if value is None else str(value)


def format_optional_bool(value: bool | None) -> str:
    if value is None:
        return "not available"
    return "yes" if value else "no"


def print_ticker_progress_start(
    *,
    args: argparse.Namespace,
    ticker: str,
    index: int,
    total: int,
) -> None:
    print()
    print(
        "SEC bulk ticker progress: "
        f"{index}/{total} ticker={ticker} "
        f"mode={mode_label(args)} "
        f"limit={args.limit} "
        f"candidate_writing={candidate_writing_label(args)}",
        flush=True,
    )


def print_ticker_progress_result(
    *,
    result: TickerResult,
    index: int,
    total: int,
) -> None:
    detail = (
        "SEC bulk ticker result: "
        f"{index}/{total} ticker={result.ticker} "
        f"status={result.status} "
        f"return_code={result.returncode} "
        f"candidate_previews={format_optional_count(result.candidate_previews)} "
        f"candidate_file_written={format_optional_bool(result.candidate_file_written)}"
    )
    if result.candidate_file_count is not None:
        detail += f" candidate_file_count={result.candidate_file_count}"
    if result.reason:
        detail += f" reason={result.reason}"
    print(detail, flush=True)


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
    metrics = parse_pipeline_metrics(combined_output)
    if result.returncode == 0:
        return result_with_metrics(
            TickerResult(
                ticker=ticker,
                status="processed",
                cached_files=parse_existing_cache_paths(combined_output),
                returncode=result.returncode,
            ),
            metrics,
        )
    if is_no_usable_filings_output(combined_output):
        return result_with_metrics(
            TickerResult(
                ticker=ticker,
                status="skipped",
                reason="no usable filings or local SEC cache",
                returncode=result.returncode,
            ),
            metrics,
        )
    return result_with_metrics(
        TickerResult(
            ticker=ticker,
            status="failed",
            reason=f"single-ticker pipeline exited {result.returncode}",
            returncode=result.returncode,
        ),
        metrics,
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
    metrics = parse_pipeline_metrics(f"{result.stdout}\n{result.stderr}")
    candidate_count = metrics.get("candidate_file_count")
    if isinstance(candidate_count, int):
        print(f"SEC bulk combined candidate count: {candidate_count}", flush=True)
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


def sum_available(results: list[TickerResult], field_name: str) -> int | None:
    values: list[int] = []
    for result in results:
        value = getattr(result, field_name)
        if isinstance(value, int) and not isinstance(value, bool):
            values.append(value)
    if not values:
        return None
    return sum(values)


def format_summary_count(value: int | None) -> str:
    return "not available" if value is None else str(value)


def format_fetch_summary(fetched: int | None, cache_hit: int | None) -> str:
    if fetched is None and cache_hit is None:
        return "not available"
    return f"{fetched or 0}/{cache_hit or 0}"


def print_batch_summary(
    *,
    requested_tickers: list[str],
    results: list[TickerResult],
    candidate_file_written: bool,
) -> None:
    processed = result_list(results, "processed")
    skipped = result_list(results, "skipped")
    failed = result_list(results, "failed")
    total_filings_planned = sum_available(results, "filings_planned")
    total_filings_fetched = sum_available(results, "filings_fetched")
    total_filings_cache_hit = sum_available(results, "filings_cache_hit")
    total_raw_signals = sum_available(results, "raw_signals")
    total_candidate_previews = sum_available(results, "candidate_previews")

    print()
    print("SEC bulk pipeline batch summary")
    print("===============================")
    print(f"tickers requested: {len(requested_tickers)} ({', '.join(requested_tickers)})")
    print(f"tickers processed: {len(processed)} ({format_result_items(processed)})")
    print(f"tickers skipped: {len(skipped)} ({format_result_items(skipped)})")
    print(f"tickers failed: {len(failed)} ({format_result_items(failed)})")
    print(f"total filings planned: {format_summary_count(total_filings_planned)}")
    print(
        "total filings fetched/cache-hit: "
        f"{format_fetch_summary(total_filings_fetched, total_filings_cache_hit)}"
    )
    print(f"total raw signals: {format_summary_count(total_raw_signals)}")
    print(f"total candidate previews: {format_summary_count(total_candidate_previews)}")
    print(f"candidate file written: {'yes' if candidate_file_written else 'no'}")
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
        print(f"Mode: {mode_label(args)}")
        print("Candidate file writing: " + candidate_writing_label(args))
        print(f"Tickers requested: {len(args.tickers)} ({', '.join(args.tickers)})")
        print(f"Forms: {args.forms}")
        print(f"Limit per ticker: {args.limit}")
        print("Production writes: 0")
        print(f"Approved mapping source: {CIK_MAPPINGS_PATH.relative_to(ROOT)}")

        total_tickers = len(args.tickers)
        for index, ticker in enumerate(args.tickers, start=1):
            print_ticker_progress_start(
                args=args,
                ticker=ticker,
                index=index,
                total=total_tickers,
            )
            if ticker not in mapping_statuses:
                result = TickerResult(
                    ticker=ticker,
                    status="skipped",
                    reason="no CIK mapping",
                )
                results.append(result)
                print_ticker_progress_result(result=result, index=index, total=total_tickers)
                continue
            if ticker not in approved_mappings:
                result = TickerResult(
                    ticker=ticker,
                    status="skipped",
                    reason=f"mapping review_status is {mapping_statuses[ticker] or 'missing'}",
                )
                results.append(result)
                print_ticker_progress_result(result=result, index=index, total=total_tickers)
                continue
            result = run_ticker_pipeline(
                args=args,
                ticker=ticker,
                initial_hashes=initial_hashes,
            )
            results.append(result)
            if result.candidate_file_written:
                candidate_file_written = True
            print_ticker_progress_result(result=result, index=index, total=total_tickers)

        failed = result_list(results, "failed")
        if failed:
            print()
            print(
                "Candidate file writing skipped because one or more ticker pipelines failed.",
                file=sys.stderr,
            )
        else:
            candidate_file_written = (
                write_combined_candidates(
                    args=args,
                    files=candidate_input_files(results),
                    initial_hashes=initial_hashes,
                )
                or candidate_file_written
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
