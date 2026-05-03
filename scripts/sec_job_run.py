#!/usr/bin/env python3
"""Run reviewed local SEC batch jobs from a manifest.

This is a local orchestration wrapper around scripts/sec_bulk_pipeline_run.py.
It does not write production graph data and keeps candidate writes opt-in.
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
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SEC_JOBS_PATH = ROOT / "data" / "candidates" / "sec_jobs.json"
SEC_BULK_PIPELINE_RUN_SCRIPT = ROOT / "scripts" / "sec_bulk_pipeline_run.py"
RUN_LOG_DIR = ROOT / "data" / "candidates" / "run_logs"
PRODUCTION_DATA_PATHS = (
    ROOT / "data" / "companies.json",
    ROOT / "data" / "connections.json",
)

APPROVED_JOB_STATUS = "approved_for_local_run"
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")
JOB_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class SecJobRunError(Exception):
    """Raised for clear local job setup or safety failures."""


@dataclass(frozen=True)
class SecJob:
    id: str
    description: str
    tickers: list[str]
    forms: list[str]
    limit: int
    review_status: str


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run an approved local SEC job manifest entry through the existing "
            "bulk pipeline. Default mode is dry-run/preview and production writes stay at 0."
        )
    )
    parser.add_argument("--job-id", required=True, help="Job id from data/candidates/sec_jobs.json.")
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="Permit the delegated SEC bulk runner to make network calls.",
    )
    parser.add_argument(
        "--user-agent",
        help="Identifying SEC User-Agent. Required with --allow-network.",
    )
    parser.add_argument(
        "--write-candidates",
        action="store_true",
        help="Permit review-only candidate file writes in the delegated bulk runner.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Pass --force to the delegated review-only candidate writer.",
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
        raise SecJobRunError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SecJobRunError(f"could not parse {label} file {path}: {exc}") from exc


def require_manifest_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise SecJobRunError("SEC job manifest must contain a metadata object.")
    if metadata.get("production_write_allowed") is not False:
        raise SecJobRunError("SEC job manifest must set production_write_allowed to false.")
    if metadata.get("app_load_allowed") is not False:
        raise SecJobRunError("SEC job manifest must set app_load_allowed to false.")


def normalize_ticker(value: Any, index: int) -> str:
    if not isinstance(value, str):
        raise SecJobRunError(f"job ticker {index} must be a string.")
    ticker = value.strip().upper()
    if not ticker or not TICKER_PATTERN.match(ticker):
        raise SecJobRunError(f"job ticker {index} is not a supported public ticker symbol.")
    return ticker


def normalize_form(value: Any, index: int) -> str:
    if not isinstance(value, str):
        raise SecJobRunError(f"job form {index} must be a string.")
    form = value.strip().upper()
    if not form or "," in form:
        raise SecJobRunError(f"job form {index} must be a non-empty form type.")
    return form


def normalize_unique_list(raw_values: Any, label: str) -> list[str]:
    if not isinstance(raw_values, list):
        raise SecJobRunError(f"job {label} must be an array.")

    values: list[str] = []
    seen: set[str] = set()
    normalizer = normalize_ticker if label == "tickers" else normalize_form
    for index, raw_value in enumerate(raw_values, start=1):
        value = normalizer(raw_value, index)
        if value in seen:
            continue
        seen.add(value)
        values.append(value)

    if not values:
        raise SecJobRunError(f"job {label} must include at least one value.")
    return values


def normalize_limit(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SecJobRunError("job limit must be an integer.")
    if value < 1:
        raise SecJobRunError("job limit must be at least 1.")
    return value


def normalize_job(raw_job: Any, index: int) -> SecJob:
    if not isinstance(raw_job, dict):
        raise SecJobRunError(f"job {index} must be an object.")

    raw_job_id = raw_job.get("id")
    if not isinstance(raw_job_id, str) or not raw_job_id.strip():
        raise SecJobRunError(f"job {index} is missing id.")
    job_id = raw_job_id.strip()
    if not JOB_ID_PATTERN.match(job_id):
        raise SecJobRunError(f"job id {job_id!r} must use lowercase letters, numbers, hyphens, or underscores.")

    description = raw_job.get("description")
    if not isinstance(description, str):
        description = ""

    review_status = raw_job.get("review_status")
    if not isinstance(review_status, str):
        review_status = ""

    return SecJob(
        id=job_id,
        description=description.strip(),
        tickers=normalize_unique_list(raw_job.get("tickers"), "tickers"),
        forms=normalize_unique_list(raw_job.get("forms"), "forms"),
        limit=normalize_limit(raw_job.get("limit")),
        review_status=review_status.strip(),
    )


def load_jobs() -> dict[str, SecJob]:
    payload = load_json(SEC_JOBS_PATH, "SEC jobs")
    if not isinstance(payload, dict):
        raise SecJobRunError("SEC job manifest must contain a JSON object.")
    require_manifest_metadata(payload)

    raw_jobs = payload.get("jobs")
    if not isinstance(raw_jobs, list):
        raise SecJobRunError("SEC job manifest must contain a jobs array.")

    jobs: dict[str, SecJob] = {}
    for index, raw_job in enumerate(raw_jobs, start=1):
        job = normalize_job(raw_job, index)
        if job.id in jobs:
            raise SecJobRunError(f"duplicate SEC job id: {job.id}.")
        jobs[job.id] = job
    return jobs


def select_approved_job(jobs: dict[str, SecJob], job_id: str) -> SecJob:
    job = jobs.get(job_id)
    if job is None:
        available = ", ".join(sorted(jobs)) or "none"
        raise SecJobRunError(f"unknown SEC job id {job_id!r}. Available jobs: {available}.")
    if job.review_status != APPROVED_JOB_STATUS:
        raise SecJobRunError(
            f"SEC job {job.id!r} is not approved for local run "
            f"(review_status: {job.review_status or 'missing'})."
        )
    return job


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise SecJobRunError(f"could not read production data guard file {path}: {exc}") from exc
    return hashes


def assert_production_data_unchanged(initial_hashes: dict[Path, str]) -> None:
    current_hashes = production_hashes()
    changed = [
        str(path.relative_to(ROOT))
        for path, initial_hash in initial_hashes.items()
        if current_hashes.get(path) != initial_hash
    ]
    if changed:
        raise SecJobRunError(
            "production data changed during SEC job run: "
            f"{', '.join(changed)}"
        )


def subprocess_environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def command_display_part(part: str) -> str:
    if part == sys.executable:
        return "python"
    path = Path(part)
    try:
        relative = path.relative_to(ROOT)
    except ValueError:
        pass
    else:
        part = str(relative).replace("\\", "/")
    if any(char.isspace() for char in part):
        return f'"{part}"'
    return part


def display_command(command: list[str]) -> str:
    return " ".join(command_display_part(part) for part in command)


def delegated_command(args: argparse.Namespace, job: SecJob) -> list[str]:
    command = [
        sys.executable,
        str(SEC_BULK_PIPELINE_RUN_SCRIPT),
        "--tickers",
        ",".join(job.tickers),
        "--forms",
        ",".join(job.forms),
        "--limit",
        str(job.limit),
    ]
    if args.allow_network:
        command.extend(["--allow-network", "--user-agent", args.user_agent.strip()])
    if args.write_candidates:
        command.append("--write-candidates")
    if args.force:
        command.append("--force")
    return command


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


def run_delegated_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    print(f"Delegated command: {display_command(command)}", flush=True)
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
        raise SecJobRunError("could not open delegated command output streams.")

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


def write_run_log(
    *,
    args: argparse.Namespace,
    job: SecJob,
    command: list[str],
    return_code: int,
    timestamp: datetime,
) -> Path:
    timestamp_text = timestamp.isoformat(timespec="seconds").replace("+00:00", "Z")
    filename_timestamp = timestamp.strftime("%Y%m%dT%H%M%S%fZ")
    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)

    run_log_path = RUN_LOG_DIR / f"{filename_timestamp}_{job.id}.json"
    payload = {
        "metadata": {
            "status": "local_run_log",
            "production_write_allowed": False,
            "app_load_allowed": False,
            "audit_scope": "candidate_local_only",
        },
        "timestamp": timestamp_text,
        "job_id": job.id,
        "description": job.description,
        "tickers": job.tickers,
        "forms": job.forms,
        "limit": job.limit,
        "mode": "network-enabled" if args.allow_network else "dry-run/preview",
        "candidate_writing": "yes" if args.write_candidates else "no",
        "delegated_command": display_command(command),
        "return_code": return_code,
        "production_writes": 0,
    }
    with run_log_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
        file.write("\n")
    return run_log_path


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        jobs = load_jobs()
        job = select_approved_job(jobs, args.job_id)
        initial_hashes = production_hashes()
        command = delegated_command(args, job)

        print("StockPhotonic local SEC job runner")
        print(f"Job: {job.id}")
        print(f"Mode: {'network-enabled' if args.allow_network else 'dry-run/preview'}")
        print("Candidate file writing: " + ("enabled" if args.write_candidates else "disabled"))
        print(f"Tickers requested: {len(job.tickers)} ({', '.join(job.tickers)})")
        print(f"Forms: {', '.join(job.forms)}")
        print(f"Limit per ticker: {job.limit}")
        print("Production writes: 0")
        print(f"Job manifest: {SEC_JOBS_PATH.relative_to(ROOT)}")

        result = run_delegated_command(command)
        assert_production_data_unchanged(initial_hashes)
        run_log_path = write_run_log(
            args=args,
            job=job,
            command=command,
            return_code=result.returncode,
            timestamp=datetime.now(timezone.utc),
        )
        print(f"Run log: {run_log_path.relative_to(ROOT)}")
        print("Production writes: 0")
        return result.returncode
    except SecJobRunError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
