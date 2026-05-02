#!/usr/bin/env python3
"""Preview local SEC scheduled-run plans without executing production writes.

The planner reads the local schedule, job manifest, and automation policy,
then prints the exact commands a human could run for each stage. It executes
only the existing read-only promotion preview logic to classify current
candidate records. It does not run scheduled jobs, write candidate files,
promote production graph data, create commits, or perform network calls.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_PATH = ROOT / "data" / "candidates" / "sec_schedule.json"
SEC_JOBS_PATH = ROOT / "data" / "candidates" / "sec_jobs.json"
SEC_POLICY_PATH = ROOT / "data" / "candidates" / "sec_automation_policy.json"
SEC_CANDIDATES_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"

SEC_JOB_RUN_SCRIPT = ROOT / "scripts" / "sec_job_run.py"
SEC_PROMOTION_PREVIEW_SCRIPT = ROOT / "scripts" / "sec_candidate_promotion_preview.py"
SEC_PROMOTE_SCRIPT = ROOT / "scripts" / "sec_candidate_promote.py"
VALIDATE_DATA_SCRIPT = ROOT / "scripts" / "validate_data.py"

PRODUCTION_DATA_PATHS = (
    COMPANIES_PATH,
    CONNECTIONS_PATH,
)

APPROVED_JOB_STATUS = "approved_for_local_run"
APPROVED_SCHEDULE_STATUS = "approved_for_local_preview"
DECISION_BUCKETS = (
    "ready_for_manual_promotion",
    "future_auto_promotable_preview",
    "manual_review_required",
    "blocked",
)
JOB_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,4}([.-][A-Z])?$")
COMMAND_USER_AGENT_PLACEHOLDER = "Your Name your.email@example.com"


class ScheduledRunPreviewError(Exception):
    """Raised for clear local scheduled preview setup failures."""


@dataclass(frozen=True)
class SecJob:
    id: str
    description: str
    tickers: list[str]
    forms: list[str]
    limit: int
    review_status: str


@dataclass(frozen=True)
class SecSchedule:
    id: str
    description: str
    job_id: str
    cadence: str
    timezone: str
    local_time: str
    review_status: str
    enabled: bool
    validation_commands: list[str]
    include_commit_plan_by_default: bool
    commit_plan_paths: list[str]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview a local SEC scheduled-run plan from job command through "
            "candidate generation, policy gate, validation, and optional commit "
            "planning. Default mode prints dry-run/preview commands only."
        )
    )
    parser.add_argument(
        "--schedule-id",
        help=(
            "Schedule id from data/candidates/sec_schedule.json. "
            "If omitted, all enabled schedules are previewed."
        ),
    )
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help=(
            "Include --allow-network in the printed job command. The preview "
            "script itself still performs no network calls."
        ),
    )
    parser.add_argument(
        "--user-agent",
        help="Identifying SEC User-Agent to include with --allow-network.",
    )
    parser.add_argument(
        "--write-candidates",
        action="store_true",
        help=(
            "Include --write-candidates in the printed job command. The preview "
            "script itself still writes no candidate files."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Include --force in printed candidate-writing commands.",
    )
    parser.add_argument(
        "--include-commit-plan",
        action="store_true",
        help="Print candidate-only git commands after validation. They are not run.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON scheduled-run preview.",
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
        raise ScheduledRunPreviewError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ScheduledRunPreviewError(f"could not parse {label} file {path}: {exc}") from exc


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise ScheduledRunPreviewError(
                f"could not read production data guard file {path}: {exc}"
            ) from exc
    return hashes


def assert_production_data_unchanged(initial_hashes: dict[Path, str]) -> None:
    current_hashes = production_hashes()
    changed = [
        display_path(path)
        for path, initial_hash in initial_hashes.items()
        if current_hashes.get(path) != initial_hash
    ]
    if changed:
        raise ScheduledRunPreviewError(
            "production data changed during scheduled preview: "
            f"{', '.join(changed)}"
        )


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def command_part(part: str) -> str:
    if part == sys.executable:
        return "python"

    try:
        path = Path(part)
        if path.is_absolute():
            part = display_path(path)
    except OSError:
        pass

    part = part.replace("\\", "/")
    if any(char.isspace() for char in part):
        escaped = part.replace('"', '\\"')
        return f'"{escaped}"'
    return part


def display_command(command: list[str]) -> str:
    return " ".join(command_part(part) for part in command)


def print_command_list(commands: list[str]) -> None:
    for command in commands:
        print(f"- {command}")


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def clean_string_list(value: Any, label: str) -> list[str]:
    if not isinstance(value, list):
        raise ScheduledRunPreviewError(f"{label} must be an array.")

    cleaned: list[str] = []
    for index, item in enumerate(value, start=1):
        text = clean_string(item)
        if text is None:
            raise ScheduledRunPreviewError(f"{label} item {index} must be a string.")
        cleaned.append(text)
    return cleaned


def require_metadata_false(metadata: dict[str, Any], key: str, label: str) -> None:
    if metadata.get(key) is not False:
        raise ScheduledRunPreviewError(f"{label} metadata.{key} must be false.")


def validate_schedule_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ScheduledRunPreviewError("SEC schedule file must contain metadata.")
    if metadata.get("status") != "candidate_only":
        raise ScheduledRunPreviewError("SEC schedule metadata.status must be candidate_only.")
    if metadata.get("schedule_scope") != "local_schedule_only":
        raise ScheduledRunPreviewError(
            "SEC schedule metadata.schedule_scope must be local_schedule_only."
        )
    require_metadata_false(metadata, "production_write_allowed", "SEC schedule")
    require_metadata_false(metadata, "app_load_allowed", "SEC schedule")
    require_metadata_false(metadata, "auto_execution_enabled", "SEC schedule")
    require_metadata_false(metadata, "auto_promotion_enabled", "SEC schedule")


def validate_job_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ScheduledRunPreviewError("SEC jobs file must contain metadata.")
    require_metadata_false(metadata, "production_write_allowed", "SEC jobs")
    require_metadata_false(metadata, "app_load_allowed", "SEC jobs")


def validate_policy_metadata(payload: dict[str, Any]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ScheduledRunPreviewError("SEC automation policy must contain metadata.")
    if metadata.get("status") != "candidate_only":
        raise ScheduledRunPreviewError(
            "SEC automation policy metadata.status must be candidate_only."
        )
    require_metadata_false(metadata, "production_write_allowed", "SEC automation policy")
    require_metadata_false(metadata, "app_load_allowed", "SEC automation policy")
    require_metadata_false(metadata, "auto_promotion_enabled", "SEC automation policy")


def normalize_job_id(value: Any, label: str) -> str:
    job_id = clean_string(value)
    if job_id is None or not JOB_ID_PATTERN.match(job_id):
        raise ScheduledRunPreviewError(
            f"{label} must use lowercase letters, numbers, hyphens, or underscores."
        )
    return job_id


def normalize_ticker(value: Any, index: int) -> str:
    ticker = clean_string(value)
    if ticker is None:
        raise ScheduledRunPreviewError(f"job ticker {index} must be a string.")
    ticker = ticker.upper()
    if not TICKER_PATTERN.match(ticker):
        raise ScheduledRunPreviewError(f"job ticker {index} is not supported.")
    return ticker


def normalize_form(value: Any, index: int) -> str:
    form = clean_string(value)
    if form is None or "," in form:
        raise ScheduledRunPreviewError(f"job form {index} must be a form string.")
    return form.upper()


def normalize_unique_list(raw_values: Any, label: str) -> list[str]:
    if not isinstance(raw_values, list):
        raise ScheduledRunPreviewError(f"job {label} must be an array.")

    values: list[str] = []
    seen: set[str] = set()
    for index, raw_value in enumerate(raw_values, start=1):
        value = normalize_ticker(raw_value, index) if label == "tickers" else normalize_form(raw_value, index)
        if value in seen:
            continue
        seen.add(value)
        values.append(value)

    if not values:
        raise ScheduledRunPreviewError(f"job {label} must include at least one value.")
    return values


def normalize_limit(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScheduledRunPreviewError("job limit must be an integer.")
    if value < 1:
        raise ScheduledRunPreviewError("job limit must be at least 1.")
    return value


def normalize_job(raw_job: Any, index: int) -> SecJob:
    if not isinstance(raw_job, dict):
        raise ScheduledRunPreviewError(f"job {index} must be an object.")

    return SecJob(
        id=normalize_job_id(raw_job.get("id"), f"job {index} id"),
        description=clean_string(raw_job.get("description")) or "",
        tickers=normalize_unique_list(raw_job.get("tickers"), "tickers"),
        forms=normalize_unique_list(raw_job.get("forms"), "forms"),
        limit=normalize_limit(raw_job.get("limit")),
        review_status=clean_string(raw_job.get("review_status")) or "",
    )


def load_jobs() -> dict[str, SecJob]:
    payload = load_json(SEC_JOBS_PATH, "SEC jobs")
    if not isinstance(payload, dict):
        raise ScheduledRunPreviewError("SEC jobs file must contain a JSON object.")
    validate_job_metadata(payload)

    raw_jobs = payload.get("jobs")
    if not isinstance(raw_jobs, list):
        raise ScheduledRunPreviewError("SEC jobs file must contain a jobs array.")

    jobs: dict[str, SecJob] = {}
    for index, raw_job in enumerate(raw_jobs, start=1):
        job = normalize_job(raw_job, index)
        if job.id in jobs:
            raise ScheduledRunPreviewError(f"duplicate SEC job id: {job.id}.")
        jobs[job.id] = job
    return jobs


def validate_commit_plan_paths(paths: list[str]) -> None:
    forbidden = {
        "data/companies.json",
        "data/connections.json",
    }
    for path in paths:
        normalized = path.replace("\\", "/").strip("/")
        if normalized in forbidden:
            raise ScheduledRunPreviewError(
                f"commit plan must not include production graph path {normalized}."
            )


def normalize_schedule(raw_schedule: Any, index: int) -> SecSchedule:
    if not isinstance(raw_schedule, dict):
        raise ScheduledRunPreviewError(f"schedule {index} must be an object.")

    schedule_id = normalize_job_id(raw_schedule.get("id"), f"schedule {index} id")
    job_id = normalize_job_id(raw_schedule.get("job_id"), f"schedule {schedule_id} job_id")
    review_status = clean_string(raw_schedule.get("review_status")) or ""
    enabled = raw_schedule.get("enabled")
    if not isinstance(enabled, bool):
        raise ScheduledRunPreviewError(f"schedule {schedule_id} enabled must be boolean.")

    if raw_schedule.get("production_write_allowed") is not False:
        raise ScheduledRunPreviewError(
            f"schedule {schedule_id} production_write_allowed must be false."
        )
    if raw_schedule.get("auto_promotion_enabled") is not False:
        raise ScheduledRunPreviewError(
            f"schedule {schedule_id} auto_promotion_enabled must be false."
        )
    if raw_schedule.get("allow_network_default") is not False:
        raise ScheduledRunPreviewError(
            f"schedule {schedule_id} allow_network_default must be false."
        )
    if raw_schedule.get("write_candidates_default") is not False:
        raise ScheduledRunPreviewError(
            f"schedule {schedule_id} write_candidates_default must be false."
        )

    validation_commands = clean_string_list(
        raw_schedule.get("validation_commands", ["python scripts/validate_data.py"]),
        f"schedule {schedule_id} validation_commands",
    )

    raw_commit_plan = raw_schedule.get("commit_plan", {})
    if not isinstance(raw_commit_plan, dict):
        raise ScheduledRunPreviewError(f"schedule {schedule_id} commit_plan must be an object.")
    commit_enabled = raw_commit_plan.get("enabled", False)
    if not isinstance(commit_enabled, bool):
        raise ScheduledRunPreviewError(
            f"schedule {schedule_id} commit_plan.enabled must be boolean."
        )
    commit_paths = clean_string_list(
        raw_commit_plan.get("candidate_only_paths", []),
        f"schedule {schedule_id} commit_plan.candidate_only_paths",
    )
    validate_commit_plan_paths(commit_paths)

    return SecSchedule(
        id=schedule_id,
        description=clean_string(raw_schedule.get("description")) or "",
        job_id=job_id,
        cadence=clean_string(raw_schedule.get("cadence")) or "unspecified",
        timezone=clean_string(raw_schedule.get("timezone")) or "local",
        local_time=clean_string(raw_schedule.get("local_time")) or "unspecified",
        review_status=review_status,
        enabled=enabled,
        validation_commands=validation_commands,
        include_commit_plan_by_default=commit_enabled,
        commit_plan_paths=commit_paths,
    )


def load_schedules() -> dict[str, SecSchedule]:
    payload = load_json(SCHEDULE_PATH, "SEC schedule")
    if not isinstance(payload, dict):
        raise ScheduledRunPreviewError("SEC schedule file must contain a JSON object.")
    validate_schedule_metadata(payload)

    raw_schedules = payload.get("schedules")
    if not isinstance(raw_schedules, list):
        raise ScheduledRunPreviewError("SEC schedule file must contain a schedules array.")

    schedules: dict[str, SecSchedule] = {}
    for index, raw_schedule in enumerate(raw_schedules, start=1):
        schedule = normalize_schedule(raw_schedule, index)
        if schedule.id in schedules:
            raise ScheduledRunPreviewError(f"duplicate SEC schedule id: {schedule.id}.")
        schedules[schedule.id] = schedule
    return schedules


def select_schedules(
    schedules: dict[str, SecSchedule],
    schedule_id: str | None,
) -> list[SecSchedule]:
    if schedule_id:
        schedule = schedules.get(schedule_id)
        if schedule is None:
            available = ", ".join(sorted(schedules)) or "none"
            raise ScheduledRunPreviewError(
                f"unknown SEC schedule id {schedule_id!r}. Available schedules: {available}."
            )
        return [schedule]

    enabled = [schedule for schedule in schedules.values() if schedule.enabled]
    if not enabled:
        raise ScheduledRunPreviewError("no enabled SEC schedules are available.")
    return sorted(enabled, key=lambda schedule: schedule.id)


def load_policy() -> dict[str, Any]:
    payload = load_json(SEC_POLICY_PATH, "SEC automation policy")
    if not isinstance(payload, dict):
        raise ScheduledRunPreviewError("SEC automation policy must contain a JSON object.")
    validate_policy_metadata(payload)
    return payload


def policy_thresholds(policy: dict[str, Any]) -> dict[str, Any]:
    thresholds = policy.get("thresholds")
    if not isinstance(thresholds, dict):
        return {}
    return {
        "target_match_confidence_minimum": thresholds.get("target_match_confidence_minimum"),
        "confidence_hint_minimum": thresholds.get("confidence_hint_minimum"),
        "source_tier_required": thresholds.get("source_tier_required"),
    }


def job_command(
    *,
    job: SecJob,
    allow_network: bool,
    user_agent: str | None,
    write_candidates: bool,
    force: bool,
) -> list[str]:
    command = [
        sys.executable,
        str(SEC_JOB_RUN_SCRIPT),
        "--job-id",
        job.id,
    ]
    if allow_network:
        command.extend(["--allow-network", "--user-agent", user_agent or COMMAND_USER_AGENT_PLACEHOLDER])
    if write_candidates:
        command.append("--write-candidates")
    if force:
        command.append("--force")
    return command


def scheduled_preview_command(schedule: SecSchedule) -> list[str]:
    return [
        sys.executable,
        str(Path("scripts") / "sec_scheduled_run_preview.py"),
        "--schedule-id",
        schedule.id,
    ]


def promotion_preview_command(json_output: bool = False) -> list[str]:
    command = [sys.executable, str(SEC_PROMOTION_PREVIEW_SCRIPT)]
    if json_output:
        command.append("--json")
    return command


def promote_dry_run_command(json_output: bool = False) -> list[str]:
    command = [sys.executable, str(SEC_PROMOTE_SCRIPT), "--dry-run"]
    if json_output:
        command.append("--json")
    return command


def validate_command_from_schedule(command_text: str) -> str:
    # Validation commands are schedule-plan text only; normalize the default
    # command to the repository-relative path used elsewhere in the project.
    if command_text == "python scripts/validate_data.py":
        return display_command([sys.executable, str(VALIDATE_DATA_SCRIPT)])
    if command_text == "python scripts/validate_data.py --strict-confidence":
        return display_command([sys.executable, str(VALIDATE_DATA_SCRIPT), "--strict-confidence"])
    return command_text


def optional_commit_commands(schedule: SecSchedule) -> list[str]:
    paths = schedule.commit_plan_paths or [
        "data/candidates/sec_schedule.json",
        "data/candidates/sec_relationship_candidates.json",
        "data/candidates/run_logs/",
    ]
    validate_commit_plan_paths(paths)
    add_command = "git add " + " ".join(paths)
    return [
        "git status --short",
        add_command,
        f'git commit -m "Preview SEC scheduled run {schedule.id}"',
    ]


def load_current_candidate_preview() -> tuple[dict[str, Any] | None, str | None]:
    try:
        from sec_candidate_promotion_preview import (  # type: ignore
            PromotionPreviewError,
            build_preview,
        )
    except ImportError as exc:
        return None, f"could not import read-only promotion preview module: {exc}"

    try:
        return (
            build_preview(
                candidate_path=SEC_CANDIDATES_PATH,
                policy_path=SEC_POLICY_PATH,
                companies_path=COMPANIES_PATH,
                connections_path=CONNECTIONS_PATH,
            ),
            None,
        )
    except PromotionPreviewError as exc:
        return None, str(exc)


def classify_candidate_record(record: dict[str, Any]) -> str:
    policy_classification = record.get("policy_classification")
    basic_classifications = record.get("classifications")
    basic_promotable = basic_classifications == ["promotable_preview"]

    if policy_classification == "future_auto_promotable_preview" and basic_promotable:
        return "future_auto_promotable_preview"
    if basic_promotable:
        return "ready_for_manual_promotion"
    if policy_classification == "manual_review_required":
        return "manual_review_required"
    return "blocked"


def candidate_reason_summary(record: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    classifications = record.get("classifications")
    if isinstance(classifications, list):
        reasons.extend(str(item) for item in classifications if item != "promotable_preview")
    policy_reasons = record.get("policy_reasons")
    if isinstance(policy_reasons, list):
        reasons.extend(str(item) for item in policy_reasons)

    seen: set[str] = set()
    ordered: list[str] = []
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered.append(reason)
    return ordered


def candidate_decisions(
    current_preview: dict[str, Any] | None,
    preview_error: str | None,
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    counts: Counter[str] = Counter()
    for bucket in DECISION_BUCKETS:
        counts[bucket] = 0

    if preview_error:
        counts["blocked"] += 1
        return dict(counts), [
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "blocked",
                "policy_classification": None,
                "reasons": [preview_error],
            }
        ]

    if current_preview is None:
        counts["manual_review_required"] += 1
        return dict(counts), [
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "manual_review_required",
                "policy_classification": None,
                "reasons": ["current candidate preview unavailable"],
            }
        ]

    records = current_preview.get("records")
    if not isinstance(records, list) or not records:
        counts["manual_review_required"] += 1
        return dict(counts), [
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "manual_review_required",
                "policy_classification": None,
                "reasons": ["no current SEC relationship candidates to classify"],
            }
        ]

    decisions: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        classification = classify_candidate_record(record)
        counts[classification] += 1
        decisions.append(
            {
                "index": record.get("index"),
                "source_ticker": record.get("source_ticker"),
                "target_ticker": record.get("target_ticker"),
                "relationship_type": record.get("relationship_type"),
                "mapped_production_type": record.get("mapped_production_type"),
                "classification": classification,
                "policy_classification": record.get("policy_classification"),
                "reasons": candidate_reason_summary(record),
            }
        )
    return dict(counts), decisions


def schedule_status_from_counts(counts: dict[str, int]) -> str:
    if counts.get("future_auto_promotable_preview", 0) > 0:
        return "future_auto_promotable_preview"
    if counts.get("ready_for_manual_promotion", 0) > 0:
        return "ready_for_manual_promotion"
    if counts.get("manual_review_required", 0) > 0:
        return "manual_review_required"
    return "blocked"


def recommended_next_command(
    schedule: SecSchedule,
    job: SecJob,
    status: str,
) -> str:
    if status in {"future_auto_promotable_preview", "ready_for_manual_promotion"}:
        return display_command(promote_dry_run_command())
    if status == "manual_review_required":
        return display_command(promotion_preview_command())
    return display_command(
        job_command(
            job=job,
            allow_network=False,
            user_agent=None,
            write_candidates=False,
            force=False,
        )
    )


def build_schedule_preview(
    *,
    schedule: SecSchedule,
    job: SecJob,
    policy: dict[str, Any],
    args: argparse.Namespace,
    current_preview: dict[str, Any] | None,
    preview_error: str | None,
) -> dict[str, Any]:
    validation_commands = [
        validate_command_from_schedule(command)
        for command in schedule.validation_commands
    ]
    decision_counts, decisions = candidate_decisions(current_preview, preview_error)
    status = schedule_status_from_counts(decision_counts)

    if schedule.review_status != APPROVED_SCHEDULE_STATUS:
        status = "blocked"
        decisions.append(
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "blocked",
                "policy_classification": None,
                "reasons": [
                    f"schedule review_status is {schedule.review_status or 'missing'}"
                ],
            }
        )
        decision_counts["blocked"] = decision_counts.get("blocked", 0) + 1
    if not schedule.enabled:
        status = "blocked"
        decisions.append(
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "blocked",
                "policy_classification": None,
                "reasons": ["schedule is disabled"],
            }
        )
        decision_counts["blocked"] = decision_counts.get("blocked", 0) + 1
    if job.review_status != APPROVED_JOB_STATUS:
        status = "blocked"
        decisions.append(
            {
                "index": None,
                "source_ticker": None,
                "target_ticker": None,
                "classification": "blocked",
                "policy_classification": None,
                "reasons": [f"job review_status is {job.review_status or 'missing'}"],
            }
        )
        decision_counts["blocked"] = decision_counts.get("blocked", 0) + 1

    job_run = display_command(
        job_command(
            job=job,
            allow_network=args.allow_network,
            user_agent=args.user_agent.strip() if args.user_agent else None,
            write_candidates=args.write_candidates,
            force=args.force,
        )
    )
    candidate_generation = display_command(
        job_command(
            job=job,
            allow_network=args.allow_network,
            user_agent=args.user_agent.strip() if args.user_agent else None,
            write_candidates=True,
            force=True,
        )
    )
    commands = {
        "scheduled_run_preview": display_command(scheduled_preview_command(schedule)),
        "job_runner": job_run,
        "candidate_generation": candidate_generation,
        "promotion_preview": display_command(promotion_preview_command()),
        "policy_gate_json": display_command(promotion_preview_command(json_output=True)),
        "safe_promotion_dry_run": display_command(promote_dry_run_command()),
        "validation": validation_commands,
        "optional_commit_plan": optional_commit_commands(schedule),
    }
    include_commit_plan = (
        bool(args.include_commit_plan)
        or schedule.include_commit_plan_by_default
    )

    return {
        "schedule_id": schedule.id,
        "description": schedule.description,
        "cadence": schedule.cadence,
        "timezone": schedule.timezone,
        "local_time": schedule.local_time,
        "enabled": schedule.enabled,
        "review_status": schedule.review_status,
        "job": {
            "id": job.id,
            "description": job.description,
            "tickers": job.tickers,
            "forms": job.forms,
            "limit": job.limit,
            "review_status": job.review_status,
        },
        "mode": "network-delegated-plan" if args.allow_network else "dry-run/preview",
        "candidate_writing_in_printed_job_command": bool(args.write_candidates),
        "auto_promotion_enabled": False,
        "status": status,
        "decision_counts": {
            bucket: decision_counts.get(bucket, 0)
            for bucket in DECISION_BUCKETS
        },
        "candidate_decisions": decisions,
        "policy_thresholds": policy_thresholds(policy),
        "commands": commands,
        "commit_plan_included": include_commit_plan,
        "recommended_next_command": recommended_next_command(schedule, job, status),
        "safety": {
            "preview_only": True,
            "network_calls": 0,
            "candidate_files_written": 0,
            "companies_written": 0,
            "connections_written": 0,
            "production_writes": 0,
        },
    }


def build_preview(args: argparse.Namespace) -> dict[str, Any]:
    schedules = load_schedules()
    jobs = load_jobs()
    policy = load_policy()
    selected_schedules = select_schedules(schedules, args.schedule_id)

    current_preview, preview_error = load_current_candidate_preview()
    schedule_previews: list[dict[str, Any]] = []
    aggregate_counts: Counter[str] = Counter()
    for bucket in DECISION_BUCKETS:
        aggregate_counts[bucket] = 0

    for schedule in selected_schedules:
        job = jobs.get(schedule.job_id)
        if job is None:
            raise ScheduledRunPreviewError(
                f"schedule {schedule.id} references unknown job {schedule.job_id}."
            )
        schedule_preview = build_schedule_preview(
            schedule=schedule,
            job=job,
            policy=policy,
            args=args,
            current_preview=current_preview,
            preview_error=preview_error,
        )
        schedule_previews.append(schedule_preview)
        aggregate_counts.update(schedule_preview["decision_counts"])

    return {
        "preview_type": "sec_scheduled_run_preview",
        "mode": "network-delegated-plan" if args.allow_network else "dry-run/preview",
        "schedule_file": display_path(SCHEDULE_PATH),
        "job_file": display_path(SEC_JOBS_PATH),
        "policy_file": display_path(SEC_POLICY_PATH),
        "candidate_file": display_path(SEC_CANDIDATES_PATH),
        "selected_schedule_count": len(schedule_previews),
        "decision_counts": {
            bucket: aggregate_counts[bucket]
            for bucket in DECISION_BUCKETS
        },
        "current_candidate_preview_error": preview_error,
        "schedules": schedule_previews,
        "safety": {
            "preview_only": True,
            "network_calls": 0,
            "candidate_files_written": 0,
            "companies_written": 0,
            "connections_written": 0,
            "production_writes": 0,
            "auto_promotion_executed": False,
            "git_commands_executed": False,
        },
    }


def print_human(preview: dict[str, Any]) -> None:
    print("SEC scheduled run preview")
    print("=========================")
    print(f"Mode: {preview['mode']}")
    print(f"Schedule file: {preview['schedule_file']}")
    print(f"Job manifest: {preview['job_file']}")
    print(f"Automation policy: {preview['policy_file']}")
    print(f"Candidate file: {preview['candidate_file']}")
    print("Network calls: 0")
    print("Production writes: 0")
    print("Auto-promotion executed: false")

    print()
    print("Decision classifications")
    print("------------------------")
    for bucket in DECISION_BUCKETS:
        print(f"- {bucket}: {preview['decision_counts'][bucket]}")

    for schedule in preview["schedules"]:
        print()
        print(f"Schedule: {schedule['schedule_id']}")
        print("-" * (10 + len(schedule["schedule_id"])))
        print(f"Status: {schedule['status']}")
        print(
            "Cadence: "
            f"{schedule['cadence']} at {schedule['local_time']} "
            f"({schedule['timezone']})"
        )
        print(
            "Job: "
            f"{schedule['job']['id']} "
            f"tickers={','.join(schedule['job']['tickers'])} "
            f"forms={','.join(schedule['job']['forms'])} "
            f"limit={schedule['job']['limit']}"
        )
        print("Auto-promotion enabled: false")
        print("Production writes: 0")

        print()
        print("Workflow commands")
        print("-----------------")
        print(f"scheduled run -> {schedule['commands']['scheduled_run_preview']}")
        print(f"job runner command -> {schedule['commands']['job_runner']}")
        print(
            "candidate generation -> "
            f"{schedule['commands']['candidate_generation']}"
        )
        print(f"promotion preview -> {schedule['commands']['promotion_preview']}")
        print(f"policy gate -> {schedule['commands']['policy_gate_json']}")
        print(f"safe promotion dry run -> {schedule['commands']['safe_promotion_dry_run']}")
        print("validation command ->")
        print_command_list(schedule["commands"]["validation"])

        print()
        print("Candidate decisions")
        print("-------------------")
        decisions = schedule["candidate_decisions"]
        if not decisions:
            print("- none")
        for decision in decisions:
            index = decision.get("index")
            source = decision.get("source_ticker") or "unknown"
            target = decision.get("target_ticker") or "unknown"
            classification = decision.get("classification")
            policy_classification = decision.get("policy_classification") or "n/a"
            reasons = decision.get("reasons") or []
            prefix = f"candidate {index}" if index is not None else "schedule"
            reason_text = f" reasons={', '.join(reasons)}" if reasons else ""
            print(
                f"- {prefix}: {source}->{target} "
                f"classification={classification} "
                f"policy={policy_classification}{reason_text}"
            )

        print()
        print("Recommended next command")
        print("------------------------")
        print(schedule["recommended_next_command"])

        print()
        print("Optional commit plan")
        print("--------------------")
        if schedule["commit_plan_included"]:
            print_command_list(schedule["commands"]["optional_commit_plan"])
        else:
            print("Not enabled by default. To print it, rerun with --include-commit-plan.")
            print("No production graph paths are included in the commit plan.")

    print()
    print("Safety")
    print("------")
    print("- scheduled jobs executed: 0")
    print("- candidate files written: 0")
    print("- companies written: 0")
    print("- connections written: 0")
    print("- production writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    initial_hashes = production_hashes()
    try:
        preview = build_preview(args)
        assert_production_data_unchanged(initial_hashes)
    except ScheduledRunPreviewError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(preview, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
