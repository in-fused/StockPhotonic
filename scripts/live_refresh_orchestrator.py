#!/usr/bin/env python3
"""Bounded review-only live refresh orchestrator for StockPhotonic.

The orchestrator coordinates cache-first SEC metadata refresh, optional
OpenAlex enrichment, source aging checks, review artifact refresh, cache
governance, and consolidated refresh status artifacts. It never writes
production graph JSON and defaults to a dry plan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
REFRESH_DIR = ROOT / "data" / "refresh"
LATEST_REFRESH_SUMMARY_PATH = REFRESH_DIR / "latest_refresh_summary.json"
REFRESH_CHANGELOG_PATH = REFRESH_DIR / "refresh_changelog.json"
OPENALEX_REFRESH_STATUS_PATH = REFRESH_DIR / "openalex_refresh_status.json"
SEC_REFRESH_STATUS_PATH = REFRESH_DIR / "sec_refresh_status.json"
RATE_LIMIT_STATUS_PATH = REFRESH_DIR / "rate_limit_status.json"
CACHE_STATUS_PATH = REFRESH_DIR / "cache_status.json"
SOURCE_AGING_STATUS_PATH = REFRESH_DIR / "source_aging_status.json"
RATE_LIMIT_LEDGER_PATH = REFRESH_DIR / "rate_limit_ledger.json"

COMPANIES_PATH = ROOT / "data" / "companies.json"
CONNECTIONS_PATH = ROOT / "data" / "connections.json"
CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
SEC_CANDIDATES_PATH = ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
REVIEW_PIPELINE_SUMMARY_PATH = ROOT / "data" / "candidates" / "review_pipeline_summary.json"
SOURCE_COVERAGE_REFRESH_PATH = ROOT / "data" / "candidates" / "source_coverage_refresh_report.json"
SOURCE_GOVERNANCE_REPORT_PATH = ROOT / "data" / "source_registry" / "source_governance_report.json"
OPENALEX_CACHE_PATH = ROOT / "data" / "cache" / "openalex" / "entity_resolution_cache.json"
SEC_CACHE_DIR = ROOT / "data" / "cache" / "sec"

OPENALEX_SCRIPT = ROOT / "scripts" / "openalex_enrichment.py"
REVIEW_REFRESH_SCRIPT = ROOT / "scripts" / "review_artifact_refresh.py"
VALIDATE_SCRIPT = ROOT / "scripts" / "validate_data.py"

PRODUCTION_DATA_PATHS = (COMPANIES_PATH, CONNECTIONS_PATH)
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
APPROVED_CIK_REVIEW_STATUSES = {"approved_for_fetch"}
STALE_SOURCE_DAYS = 365
AGING_SOURCE_DAYS = 180
RECENT_FILING_FORMS = {"10-K", "10-Q", "8-K"}

DEFAULT_MAX_REQUESTS = 32
DEFAULT_OPENALEX_MAX_REQUESTS = 16
DEFAULT_OPENALEX_DAILY_CAP = 80
DEFAULT_OPENALEX_MAX_ENTITIES = 20
DEFAULT_OPENALEX_CACHE_TTL_DAYS = 45
DEFAULT_OPENALEX_RATE_LIMIT_SECONDS = 0.35
DEFAULT_SEC_MAX_REQUESTS = 6
DEFAULT_SEC_DAILY_CAP = 30
DEFAULT_SEC_MAX_TICKERS = 12
DEFAULT_SEC_CACHE_TTL_DAYS = 14
DEFAULT_SEC_RATE_LIMIT_SECONDS = 0.25
DEFAULT_SEC_TIMEOUT_SECONDS = 20.0
CHANGELOG_LIMIT = 50


class LiveRefreshError(Exception):
    """Raised for clear live-refresh setup or safety failures."""


@dataclass
class StepResult:
    name: str
    command: list[str]
    return_code: int
    status: str
    stdout_tail: list[str]
    stderr_tail: list[str]
    parsed_json: dict[str, Any] | None = None


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be an integer.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be at least 0.")
    return parsed


def parse_positive_int(value: str) -> int:
    parsed = parse_nonnegative_int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be at least 1.")
    return parsed


def parse_nonnegative_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be a number.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be at least 0.")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run a bounded StockPhotonic intelligence refresh. Default mode is "
            "a dry plan with no network calls and no file writes."
        )
    )
    parser.add_argument("--write", action="store_true", help="Write review-only refresh artifacts.")
    parser.add_argument("--force", action="store_true", help="Overwrite refresh artifacts when --write is used.")
    parser.add_argument("--allow-network", action="store_true", help="Permit explicitly enabled provider network calls.")
    parser.add_argument("--allow-openalex-network", action="store_true", help="Permit OpenAlex network calls when configured.")
    parser.add_argument("--allow-sec-network", action="store_true", help="Permit SEC metadata network calls when configured.")
    parser.add_argument("--skip-openalex", action="store_true")
    parser.add_argument("--skip-sec", action="store_true")
    parser.add_argument("--skip-review-refresh", action="store_true")
    parser.add_argument("--max-requests", type=parse_nonnegative_int, default=DEFAULT_MAX_REQUESTS)
    parser.add_argument("--openalex-max-requests", type=parse_nonnegative_int, default=DEFAULT_OPENALEX_MAX_REQUESTS)
    parser.add_argument("--openalex-daily-cap", type=parse_nonnegative_int, default=DEFAULT_OPENALEX_DAILY_CAP)
    parser.add_argument("--openalex-max-entities", type=parse_positive_int, default=DEFAULT_OPENALEX_MAX_ENTITIES)
    parser.add_argument("--openalex-cache-ttl-days", type=parse_nonnegative_int, default=DEFAULT_OPENALEX_CACHE_TTL_DAYS)
    parser.add_argument("--openalex-rate-limit-seconds", type=parse_nonnegative_float, default=DEFAULT_OPENALEX_RATE_LIMIT_SECONDS)
    parser.add_argument("--sec-max-requests", type=parse_nonnegative_int, default=DEFAULT_SEC_MAX_REQUESTS)
    parser.add_argument("--sec-daily-cap", type=parse_nonnegative_int, default=DEFAULT_SEC_DAILY_CAP)
    parser.add_argument("--sec-max-tickers", type=parse_positive_int, default=DEFAULT_SEC_MAX_TICKERS)
    parser.add_argument("--sec-cache-ttl-days", type=parse_nonnegative_int, default=DEFAULT_SEC_CACHE_TTL_DAYS)
    parser.add_argument("--sec-rate-limit-seconds", type=parse_nonnegative_float, default=DEFAULT_SEC_RATE_LIMIT_SECONDS)
    parser.add_argument("--sec-timeout", type=parse_nonnegative_float, default=DEFAULT_SEC_TIMEOUT_SECONDS)
    parser.add_argument("--json", action="store_true", help="Print consolidated summary JSON.")
    args = parser.parse_args(argv)
    if args.force and not args.write:
        parser.error("--force can only be used with --write.")
    if args.sec_timeout <= 0:
        parser.error("--sec-timeout must be greater than zero.")
    return args


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def today_key(now: datetime) -> str:
    return now.date().isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.resolve(strict=False).relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def safe_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_json(path: Path, *, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise LiveRefreshError(f"required JSON file is missing: {display_path(path)}")
        return None
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise LiveRefreshError(f"could not read {display_path(path)}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise LiveRefreshError(f"could not parse {display_path(path)}: {exc}") from exc


def write_json(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    if path.exists() and not force:
        raise LiveRefreshError(f"{display_path(path)} already exists; pass --force.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")
    temp_path.replace(path)


def production_hashes() -> dict[Path, str]:
    hashes: dict[Path, str] = {}
    for path in PRODUCTION_DATA_PATHS:
        try:
            hashes[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError as exc:
            raise LiveRefreshError(f"could not read production guard file {display_path(path)}: {exc}") from exc
    return hashes


def assert_production_unchanged(initial_hashes: dict[Path, str]) -> None:
    current = production_hashes()
    changed = [
        display_path(path)
        for path, initial_hash in initial_hashes.items()
        if current.get(path) != initial_hash
    ]
    if changed:
        raise LiveRefreshError(f"production data changed during live refresh: {', '.join(changed)}")


def safety_block(network_requests_used: int = 0) -> dict[str, Any]:
    return {
        "review_only": True,
        "production_writes": 0,
        "companies_written": 0,
        "connections_written": 0,
        "auto_promotion_executed": False,
        "browser_ingestion": False,
        "network_requests_used": network_requests_used,
    }


def review_metadata(name: str, generated_at: datetime, *, mode: str) -> dict[str, Any]:
    return {
        "artifact_status": "review_only",
        "schema_version": 1,
        "generated_by": "scripts/live_refresh_orchestrator.py",
        "generated_at_utc": generated_at.isoformat(),
        "artifact_name": name,
        "refresh_mode": mode,
        "production_write_allowed": False,
        "app_load_allowed": True,
    }


def subprocess_environment() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    return env


def command_display(command: list[str]) -> str:
    parts: list[str] = []
    for part in command:
        display = "python" if part == sys.executable else part
        try:
            path = Path(display)
            if path.is_absolute():
                display = display_path(path)
        except OSError:
            pass
        display = display.replace("\\", "/")
        if any(char.isspace() for char in display):
            parts.append(f'"{display}"')
        else:
            parts.append(display)
    return " ".join(parts)


def parse_stdout_json(stdout: str) -> dict[str, Any] | None:
    text = stdout.strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def run_subprocess(name: str, command: list[str], initial_hashes: dict[Path, str]) -> StepResult:
    print()
    print(f"Live refresh step: {name}")
    print("-" * (len(name) + len("Live refresh step: ")))
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
    return StepResult(
        name=name,
        command=command,
        return_code=result.returncode,
        status="passed" if result.returncode == 0 else "failed",
        stdout_tail=result.stdout.splitlines()[-16:],
        stderr_tail=result.stderr.splitlines()[-16:],
        parsed_json=parse_stdout_json(result.stdout),
    )


def load_rate_ledger() -> dict[str, Any]:
    payload = load_json(RATE_LIMIT_LEDGER_PATH, required=False)
    if isinstance(payload, dict) and isinstance(payload.get("daily"), dict):
        return payload
    return {
        "metadata": {
            "artifact_status": "review_only",
            "schema_version": 1,
            "generated_by": "scripts/live_refresh_orchestrator.py",
            "production_write_allowed": False,
            "app_load_allowed": False,
        },
        "daily": {},
        "safety": safety_block(),
    }


def daily_used(ledger: dict[str, Any], date_key: str, provider: str) -> int:
    day = ledger.get("daily", {}).get(date_key, {})
    if not isinstance(day, dict):
        return 0
    return safe_int(day.get(provider), 0)


def update_rate_ledger(
    ledger: dict[str, Any],
    *,
    generated_at: datetime,
    openalex_used: int,
    sec_used: int,
) -> dict[str, Any]:
    date_key = today_key(generated_at)
    daily = ledger.setdefault("daily", {})
    day = daily.setdefault(date_key, {})
    if not isinstance(day, dict):
        day = {}
        daily[date_key] = day
    day["openalex"] = safe_int(day.get("openalex"), 0) + openalex_used
    day["sec"] = safe_int(day.get("sec"), 0) + sec_used
    day["global"] = safe_int(day.get("global"), 0) + openalex_used + sec_used
    metadata = ledger.setdefault("metadata", {})
    metadata.update(
        {
            "artifact_status": "review_only",
            "schema_version": 1,
            "generated_by": "scripts/live_refresh_orchestrator.py",
            "generated_at_utc": generated_at.isoformat(),
            "production_write_allowed": False,
            "app_load_allowed": False,
        }
    )
    ledger["safety"] = safety_block(openalex_used + sec_used)
    return ledger


def remaining_daily(ledger: dict[str, Any], generated_at: datetime, provider: str, cap: int) -> int:
    return max(0, cap - daily_used(ledger, today_key(generated_at), provider))


def provider_disabled_reason(
    *,
    skipped: bool,
    write_enabled: bool,
    network_requested: bool,
    configured: bool,
    request_cap: int,
    daily_remaining: int,
    global_remaining: int,
    provider_name: str,
) -> str | None:
    if skipped:
        return f"{provider_name}_refresh_skipped"
    if not write_enabled:
        return "dry_run"
    if not network_requested:
        return "network_not_requested"
    if not configured:
        return f"missing_{provider_name}_configuration"
    if request_cap <= 0:
        return "provider_request_cap_zero"
    if daily_remaining <= 0:
        return "daily_budget_exhausted"
    if global_remaining <= 0:
        return "global_budget_exhausted"
    return None


def normalize_cik(raw_cik: Any) -> str:
    cik = str(raw_cik or "").strip().upper()
    if cik.startswith("CIK"):
        cik = cik[3:]
    if not cik.isdigit() or len(cik) > 10:
        raise LiveRefreshError(f"invalid CIK value in approved mapping: {raw_cik!r}")
    return cik.zfill(10)


def load_approved_cik_mappings() -> list[dict[str, Any]]:
    payload = load_json(CIK_MAPPINGS_PATH, required=False)
    if not isinstance(payload, dict):
        return []
    mappings = payload.get("mappings")
    if not isinstance(mappings, list):
        return []
    approved: list[dict[str, Any]] = []
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        if mapping.get("review_status") not in APPROVED_CIK_REVIEW_STATUSES:
            continue
        ticker = clean_string(mapping.get("ticker"))
        if not ticker:
            continue
        cik = normalize_cik(mapping.get("cik"))
        source_url = clean_string(mapping.get("source_url")) or SEC_SUBMISSIONS_URL.format(cik=cik)
        if not is_sec_submissions_url(source_url, cik):
            continue
        approved.append(
            {
                "ticker": ticker.upper(),
                "cik": cik,
                "source_url": source_url,
                "capture_date": clean_string(mapping.get("capture_date")),
                "review_status": mapping.get("review_status"),
                "review_only": True,
            }
        )
    return sorted(approved, key=lambda row: (row["ticker"], row["cik"]))


def is_sec_submissions_url(url: str, cik: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and host == "data.sec.gov"
        and parsed.path == f"/submissions/CIK{cik}.json"
    )


def sec_cache_path(cik: str) -> Path:
    return SEC_CACHE_DIR / f"submissions_CIK{cik}.json"


def file_age_days(path: Path, now: datetime) -> int | None:
    if not path.exists():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    return max(0, (now - modified).days)


def parse_date(value: Any) -> datetime | None:
    text = clean_string(value)
    if not text:
        return None
    try:
        if DATE_PATTERN.match(text):
            return datetime.fromisoformat(f"{text}T00:00:00+00:00")
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def inspect_sec_cache(path: Path, ticker: str, now: datetime) -> dict[str, Any]:
    if not path.exists():
        return {
            "ticker": ticker,
            "cache_path": display_path(path),
            "cache_available": False,
            "latest_filing_date": None,
            "latest_form": None,
            "latest_filing_age_days": None,
            "recent_filing_count": 0,
            "form_counts": {},
            "review_only": True,
        }
    payload = load_json(path, required=False)
    if not isinstance(payload, dict):
        return {
            "ticker": ticker,
            "cache_path": display_path(path),
            "cache_available": True,
            "cache_parse_status": "invalid_json",
            "latest_filing_date": None,
            "latest_form": None,
            "latest_filing_age_days": None,
            "recent_filing_count": 0,
            "form_counts": {},
            "review_only": True,
        }
    recent = payload.get("filings", {}).get("recent", {}) if isinstance(payload.get("filings"), dict) else {}
    if not isinstance(recent, dict):
        recent = {}
    forms = recent.get("form") if isinstance(recent.get("form"), list) else []
    dates = recent.get("filingDate") if isinstance(recent.get("filingDate"), list) else []
    accessions = recent.get("accessionNumber") if isinstance(recent.get("accessionNumber"), list) else []
    docs = recent.get("primaryDocument") if isinstance(recent.get("primaryDocument"), list) else []
    records: list[dict[str, str | None]] = []
    for index in range(max(len(forms), len(dates), len(accessions), len(docs))):
        form = clean_string(forms[index] if index < len(forms) else None)
        filing_date = clean_string(dates[index] if index < len(dates) else None)
        if form is None or filing_date is None:
            continue
        records.append(
            {
                "form": form,
                "filing_date": filing_date,
                "accession_number": clean_string(accessions[index] if index < len(accessions) else None),
                "primary_document": clean_string(docs[index] if index < len(docs) else None),
            }
        )
    recent_records = [
        record for record in records if str(record.get("form") or "").upper() in RECENT_FILING_FORMS
    ]
    latest = max(recent_records or records, key=lambda row: str(row.get("filing_date") or ""), default=None)
    latest_date = parse_date(latest.get("filing_date") if latest else None)
    form_counts: dict[str, int] = {}
    for record in records:
        form = str(record.get("form") or "[missing]").upper()
        form_counts[form] = form_counts.get(form, 0) + 1
    return {
        "ticker": ticker,
        "cache_path": display_path(path),
        "cache_available": True,
        "cache_parse_status": "ok",
        "latest_filing_date": latest.get("filing_date") if latest else None,
        "latest_form": latest.get("form") if latest else None,
        "latest_accession_number": latest.get("accession_number") if latest else None,
        "latest_primary_document": latest.get("primary_document") if latest else None,
        "latest_filing_age_days": (now - latest_date).days if latest_date else None,
        "recent_filing_count": len(records),
        "tracked_recent_filing_count": len(recent_records),
        "form_counts": dict(sorted(form_counts.items())),
        "review_only": True,
    }


def fetch_sec_submissions(cik: str, user_agent: str, timeout: float) -> bytes:
    url = SEC_SUBMISSIONS_URL.format(cik=cik)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "identity",
            "Connection": "close",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        final_url = response.geturl()
        parsed_final = urllib.parse.urlparse(final_url)
        if parsed_final.scheme != "https" or parsed_final.hostname != "data.sec.gov":
            raise LiveRefreshError(f"SEC request redirected outside approved host: {final_url}")
        if parsed_final.path != f"/submissions/CIK{cik}.json":
            raise LiveRefreshError(f"SEC request redirected outside approved CIK root: {final_url}")
        return response.read()


def build_sec_refresh_status(
    args: argparse.Namespace,
    *,
    generated_at: datetime,
    ledger: dict[str, Any],
    global_remaining: int,
) -> tuple[dict[str, Any], int]:
    approved = load_approved_cik_mappings()
    selected = approved[: args.sec_max_tickers]
    user_agent = clean_string(os.environ.get("SEC_USER_AGENT"))
    configured = bool(user_agent)
    network_requested = bool(args.write and args.allow_network and args.allow_sec_network)
    daily_remaining = remaining_daily(ledger, generated_at, "sec", args.sec_daily_cap)
    effective_cap = min(args.sec_max_requests, daily_remaining, global_remaining)
    disabled_reason = provider_disabled_reason(
        skipped=args.skip_sec,
        write_enabled=bool(args.write),
        network_requested=network_requested,
        configured=configured,
        request_cap=args.sec_max_requests,
        daily_remaining=daily_remaining,
        global_remaining=global_remaining,
        provider_name="sec",
    )
    network_enabled = not args.skip_sec and disabled_reason is None and effective_cap > 0

    records: list[dict[str, Any]] = []
    requests_used = 0
    cache_hits = 0
    cache_misses = 0
    stale_cache_count = 0
    skipped_for_budget = 0
    skipped_for_configuration = 0
    errors: list[dict[str, Any]] = []

    if not args.skip_sec:
        for mapping in selected:
            cik = mapping["cik"]
            cache_path = sec_cache_path(cik)
            age_days = file_age_days(cache_path, generated_at)
            cache_exists = cache_path.exists()
            cache_fresh = cache_exists and (age_days is not None and age_days <= args.sec_cache_ttl_days)
            cache_state = "hit" if cache_fresh else "stale" if cache_exists else "missing"
            if cache_fresh:
                cache_hits += 1
            else:
                cache_misses += 1
                if cache_exists:
                    stale_cache_count += 1

            network_action = "cache_reused" if cache_fresh else "skipped"
            network_error = None
            if not cache_fresh:
                if network_enabled and requests_used < effective_cap:
                    try:
                        if args.sec_rate_limit_seconds and requests_used:
                            time.sleep(args.sec_rate_limit_seconds)
                        body = fetch_sec_submissions(cik, user_agent or "", args.sec_timeout)
                        if args.write:
                            cache_path.parent.mkdir(parents=True, exist_ok=True)
                            temp_path = cache_path.with_name(f"{cache_path.name}.tmp")
                            temp_path.write_bytes(body)
                            temp_path.replace(cache_path)
                        requests_used += 1
                        network_action = "fetched"
                        cache_state = "refreshed"
                    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, LiveRefreshError) as exc:
                        requests_used += 1
                        network_action = "network_error"
                        network_error = str(exc)
                        errors.append(
                            {
                                "ticker": mapping["ticker"],
                                "cik": cik,
                                "error": network_error,
                                "review_only": True,
                            }
                        )
                elif network_requested and not configured:
                    skipped_for_configuration += 1
                    network_action = "missing_configuration"
                elif network_requested and requests_used >= effective_cap:
                    skipped_for_budget += 1
                    network_action = "budget_exhausted"
                else:
                    network_action = disabled_reason or "network_not_requested"

            inspection = inspect_sec_cache(cache_path, mapping["ticker"], generated_at)
            records.append(
                {
                    **mapping,
                    **inspection,
                    "cache_state": cache_state,
                    "cache_age_days": age_days,
                    "cache_ttl_days": args.sec_cache_ttl_days,
                    "network_action": network_action,
                    "network_error": network_error,
                    "source_role": "sec_metadata_refresh_only",
                    "relationship_authority": False,
                    "promotion_authority": False,
                    "review_only": True,
                }
            )

    stale_filings = [
        {
            "ticker": row["ticker"],
            "cik": row["cik"],
            "latest_filing_date": row.get("latest_filing_date"),
            "latest_filing_age_days": row.get("latest_filing_age_days"),
            "review_only": True,
        }
        for row in records
        if isinstance(row.get("latest_filing_age_days"), int) and row["latest_filing_age_days"] > STALE_SOURCE_DAYS
    ]
    candidate_updates = summarize_sec_candidates()
    status = "skipped" if args.skip_sec else "passed_with_errors" if errors else "passed"
    payload = {
        "metadata": review_metadata("sec_refresh_status", generated_at, mode="write" if args.write else "dry_run"),
        "summary": {
            "status": status,
            "configured": configured,
            "network_requested": network_requested,
            "network_enabled": network_enabled,
            "network_disabled_reason": None if network_enabled else disabled_reason,
            "request_cap": effective_cap,
            "configured_request_cap": args.sec_max_requests,
            "daily_cap": args.sec_daily_cap,
            "daily_remaining_before_run": daily_remaining,
            "approved_cik_root_count": len(approved),
            "selected_cik_root_count": len(selected),
            "cache_hits": cache_hits,
            "cache_misses": cache_misses,
            "stale_cache_count": stale_cache_count,
            "requests_used": requests_used,
            "requests_skipped_for_budget": skipped_for_budget,
            "requests_skipped_for_configuration": skipped_for_configuration,
            "stale_filing_count": len(stale_filings),
            "candidate_evidence_count": candidate_updates["candidate_evidence_count"],
            "review_only": True,
        },
        "records": records,
        "stale_filing_detection": stale_filings,
        "candidate_evidence_updates": candidate_updates,
        "errors": errors,
        "safety": safety_block(requests_used),
    }
    return payload, requests_used


def summarize_sec_candidates() -> dict[str, Any]:
    payload = load_json(SEC_CANDIDATES_PATH, required=False)
    candidates = payload.get("candidates") if isinstance(payload, dict) else []
    if not isinstance(candidates, list):
        candidates = []
    latest_filing = ""
    source_url_count = 0
    relationship_types: dict[str, int] = {}
    tickers: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        latest_filing = max(latest_filing, clean_string(candidate.get("filing_date")) or "")
        urls = candidate.get("source_urls")
        if isinstance(urls, list):
            source_url_count += len([url for url in urls if isinstance(url, str) and URL_PATTERN.match(url)])
        relationship_type = clean_string(candidate.get("relationship_type")) or "unknown"
        relationship_types[relationship_type] = relationship_types.get(relationship_type, 0) + 1
        for key in ("source_ticker", "target_ticker"):
            ticker = clean_string(candidate.get(key))
            if ticker:
                tickers.add(ticker.upper())
    return {
        "candidate_evidence_count": len(candidates),
        "candidate_source_url_count": source_url_count,
        "latest_candidate_filing_date": latest_filing or None,
        "candidate_ticker_count": len(tickers),
        "relationship_type_counts": dict(sorted(relationship_types.items())),
        "review_only": True,
    }


def build_openalex_refresh_status(
    args: argparse.Namespace,
    *,
    generated_at: datetime,
    ledger: dict[str, Any],
    global_remaining: int,
    initial_hashes: dict[Path, str],
) -> tuple[dict[str, Any], int, StepResult | None]:
    configured = bool(clean_string(os.environ.get("OPENALEX_API_KEY")))
    network_requested = bool(args.write and args.allow_network and args.allow_openalex_network)
    daily_remaining = remaining_daily(ledger, generated_at, "openalex", args.openalex_daily_cap)
    effective_cap = min(args.openalex_max_requests, daily_remaining, global_remaining)
    disabled_reason = provider_disabled_reason(
        skipped=args.skip_openalex,
        write_enabled=bool(args.write),
        network_requested=network_requested,
        configured=configured,
        request_cap=args.openalex_max_requests,
        daily_remaining=daily_remaining,
        global_remaining=global_remaining,
        provider_name="openalex",
    )
    network_enabled = not args.skip_openalex and disabled_reason is None and effective_cap > 0

    step: StepResult | None = None
    requests_used = 0
    metadata: dict[str, Any] = {}
    summaries: dict[str, Any] = {}
    if not args.skip_openalex:
        command = [
            sys.executable,
            str(OPENALEX_SCRIPT),
            "--max-requests",
            str(effective_cap),
            "--max-entities",
            str(args.openalex_max_entities),
            "--cache-ttl-days",
            str(args.openalex_cache_ttl_days),
            "--rate-limit-seconds",
            str(args.openalex_rate_limit_seconds),
            "--json",
        ]
        if args.write:
            command.extend(["--write", "--force"])
        if network_enabled:
            command.append("--allow-network")
        step = run_subprocess("openalex_enrichment", command, initial_hashes)
        parsed = step.parsed_json or {}
        metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
        requests_used = safe_int(metadata.get("network_requests_used"), 0)
        summaries = {
            "ecosystem": parsed.get("ecosystem_summary") if isinstance(parsed.get("ecosystem_summary"), dict) else {},
            "topic": parsed.get("topic_summary") if isinstance(parsed.get("topic_summary"), dict) else {},
            "institution": parsed.get("institution_summary") if isinstance(parsed.get("institution_summary"), dict) else {},
            "cluster": parsed.get("cluster_summary") if isinstance(parsed.get("cluster_summary"), dict) else {},
        }
        if requests_used > effective_cap:
            raise LiveRefreshError("OpenAlex subprocess exceeded delegated request cap.")

    cache_snapshot = openalex_cache_snapshot(args.openalex_cache_ttl_days, generated_at)
    alias_conflicts = openalex_alias_conflicts()
    unresolved = openalex_unresolved_entities()
    status = "skipped" if args.skip_openalex else "failed" if step and step.return_code else "passed"
    payload = {
        "metadata": review_metadata("openalex_refresh_status", generated_at, mode="write" if args.write else "dry_run"),
        "summary": {
            "status": status,
            "configured": configured,
            "network_requested": network_requested,
            "network_enabled": network_enabled,
            "network_disabled_reason": None if network_enabled else disabled_reason,
            "request_cap": effective_cap,
            "configured_request_cap": args.openalex_max_requests,
            "daily_cap": args.openalex_daily_cap,
            "daily_remaining_before_run": daily_remaining,
            "requests_used": requests_used,
            "cache_ttl_days": args.openalex_cache_ttl_days,
            "cache_hits": safe_int(metadata.get("cache_hit_count"), 0),
            "cache_misses": safe_int(metadata.get("cache_miss_count"), 0),
            "network_fetches": safe_int(metadata.get("network_fetch_count"), 0),
            "network_errors": safe_int(metadata.get("network_error_count"), 0),
            "unresolved_entity_count": len(unresolved),
            "alias_conflict_count": len(alias_conflicts),
            "relationship_authority": False,
            "promotion_authority": False,
            "review_only": True,
        },
        "artifact_summaries": summaries,
        "cache_lifecycle": cache_snapshot,
        "unresolved_entity_report": unresolved[:80],
        "alias_conflict_report": alias_conflicts[:80],
        "subprocess": step_to_dict(step) if step else None,
        "safety": safety_block(requests_used),
    }
    return payload, requests_used, step


def openalex_cache_snapshot(ttl_days: int, now: datetime) -> dict[str, Any]:
    payload = load_json(OPENALEX_CACHE_PATH, required=False)
    entries = payload.get("entries") if isinstance(payload, dict) else {}
    if not isinstance(entries, dict):
        entries = {}
    stale_count = 0
    error_count = 0
    for entry in entries.values():
        if not isinstance(entry, dict):
            continue
        if entry.get("status") == "error":
            error_count += 1
        fetched_at = parse_date(entry.get("fetched_at_utc"))
        if fetched_at is None or (ttl_days and now - fetched_at > timedelta(days=ttl_days)):
            stale_count += 1
    return {
        "cache_path": display_path(OPENALEX_CACHE_PATH),
        "cache_available": OPENALEX_CACHE_PATH.exists(),
        "cache_entry_count": len(entries),
        "stale_cache_entry_count": stale_count,
        "error_cache_entry_count": error_count,
        "cache_size_bytes": OPENALEX_CACHE_PATH.stat().st_size if OPENALEX_CACHE_PATH.exists() else 0,
        "cache_ttl_days": ttl_days,
        "deletion_performed": False,
        "pruning_guidance": "Review stale/error entries before pruning; the orchestrator does not delete cache files.",
        "review_only": True,
    }


def openalex_alias_conflicts() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in (
        ROOT / "data" / "candidates" / "openalex_ecosystem_candidates.json",
        ROOT / "data" / "candidates" / "openalex_institution_overlap.json",
    ):
        payload = load_json(path, required=False)
        records = payload.get("records") if isinstance(payload, dict) else []
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            state = record.get("entity_resolution")
            if not isinstance(state, dict):
                continue
            if safe_int(state.get("alias_conflict_count"), 0) <= 0:
                continue
            rows.append(
                {
                    "ticker": state.get("ticker") or record.get("ticker"),
                    "company_name": state.get("company_name") or record.get("company_name"),
                    "review_state": state.get("review_state"),
                    "alias_conflict_count": safe_int(state.get("alias_conflict_count"), 0),
                    "relationship_authority": False,
                    "review_only": True,
                }
            )
    return rows


def openalex_unresolved_entities() -> list[dict[str, Any]]:
    payload = load_json(ROOT / "data" / "candidates" / "openalex_ecosystem_candidates.json", required=False)
    records = payload.get("records") if isinstance(payload, dict) else []
    if not isinstance(records, list):
        return []
    rows: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        state = record.get("entity_resolution")
        if isinstance(state, dict) and state.get("review_state") == "unresolved_context":
            rows.append(
                {
                    "ticker": state.get("ticker") or record.get("ticker"),
                    "company_name": state.get("company_name") or record.get("company_name"),
                    "query_status": state.get("query_status"),
                    "relationship_authority": False,
                    "review_only": True,
                }
            )
    return rows


def step_to_dict(step: StepResult | None) -> dict[str, Any] | None:
    if step is None:
        return None
    return {
        "name": step.name,
        "command": command_display(step.command),
        "return_code": step.return_code,
        "status": step.status,
        "stdout_tail": step.stdout_tail,
        "stderr_tail": step.stderr_tail,
    }


def build_source_aging_status(generated_at: datetime, *, mode: str) -> dict[str, Any]:
    connections = load_json(CONNECTIONS_PATH)
    if not isinstance(connections, list):
        connections = []
    companies = load_json(COMPANIES_PATH)
    if not isinstance(companies, list):
        companies = []
    company_by_id = {
        company.get("id"): company
        for company in companies
        if isinstance(company, dict)
    }
    stale_rows: list[dict[str, Any]] = []
    aging_rows: list[dict[str, Any]] = []
    missing_date_rows: list[dict[str, Any]] = []
    invalid_url_rows: list[dict[str, Any]] = []
    for index, connection in enumerate(connections):
        if not isinstance(connection, dict):
            continue
        source = company_by_id.get(connection.get("source"), {})
        target = company_by_id.get(connection.get("target"), {})
        source_ticker = clean_string(source.get("ticker")) or str(connection.get("source") or "")
        target_ticker = clean_string(target.get("ticker")) or str(connection.get("target") or "")
        verified_date = clean_string(connection.get("verified_date"))
        parsed_date = parse_date(verified_date)
        urls = connection.get("source_urls")
        valid_urls = [url for url in urls if isinstance(url, str) and URL_PATTERN.match(url)] if isinstance(urls, list) else []
        invalid_urls = [url for url in urls if not (isinstance(url, str) and URL_PATTERN.match(url))] if isinstance(urls, list) else []
        base_row = {
            "connection_index": index,
            "source_ticker": source_ticker,
            "target_ticker": target_ticker,
            "relationship_type": connection.get("type"),
            "verified_date": verified_date,
            "source_url_count": len(valid_urls),
            "review_only": True,
        }
        if invalid_urls:
            invalid_url_rows.append({**base_row, "invalid_source_url_count": len(invalid_urls)})
        if parsed_date is None:
            missing_date_rows.append({**base_row, "reason": "verified_date missing or invalid"})
            continue
        age_days = max(0, (generated_at - parsed_date).days)
        if age_days > STALE_SOURCE_DAYS:
            stale_rows.append({**base_row, "age_days": age_days, "reason": "verified date exceeds stale source window"})
        elif age_days > AGING_SOURCE_DAYS:
            aging_rows.append({**base_row, "age_days": age_days, "reason": "verified date is aging"})
    registry_gaps = registry_field_gaps()
    payload = {
        "metadata": review_metadata("source_aging_status", generated_at, mode=mode),
        "summary": {
            "stale_source_count": len(stale_rows),
            "aging_source_count": len(aging_rows),
            "missing_verified_date_count": len(missing_date_rows),
            "invalid_source_url_count": len(invalid_url_rows),
            "missing_registry_field_count": len(registry_gaps),
            "stale_source_window_days": STALE_SOURCE_DAYS,
            "aging_source_window_days": AGING_SOURCE_DAYS,
            "review_only": True,
        },
        "reviewer_queue": [
            *stale_rows[:40],
            *aging_rows[:30],
            *missing_date_rows[:20],
            *invalid_url_rows[:20],
        ],
        "registry_field_gaps": registry_gaps[:80],
        "safety": safety_block(),
    }
    return payload


def registry_field_gaps() -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    registry_files = [
        ROOT / "data" / "source_registry" / "official_company_sources.json",
        ROOT / "data" / "source_registry" / "trusted_source_hosts.json",
        ROOT / "data" / "source_registry" / "reviewer_source_roots.json",
    ]
    for path in registry_files:
        payload = load_json(path, required=False)
        if not isinstance(payload, dict):
            gaps.append({"path": display_path(path), "field": "metadata", "reason": "registry file missing or invalid", "review_only": True})
            continue
        records = payload.get("records")
        if not isinstance(records, list):
            gaps.append({"path": display_path(path), "field": "records", "reason": "records list missing", "review_only": True})
            continue
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                gaps.append({"path": display_path(path), "record_index": index, "field": "record", "reason": "record is not an object", "review_only": True})
                continue
            for field in ("review_only",):
                if record.get(field) is not True:
                    gaps.append({"path": display_path(path), "record_index": index, "field": field, "reason": "review-only marker missing", "review_only": True})
    return gaps


def build_cache_status(args: argparse.Namespace, generated_at: datetime, *, mode: str) -> dict[str, Any]:
    sec_files = list(SEC_CACHE_DIR.glob("submissions_CIK*.json")) if SEC_CACHE_DIR.exists() else []
    stale_sec = [
        path for path in sec_files
        if (file_age_days(path, generated_at) or 0) > args.sec_cache_ttl_days
    ]
    openalex = openalex_cache_snapshot(args.openalex_cache_ttl_days, generated_at)
    total_sec_bytes = sum(path.stat().st_size for path in sec_files if path.is_file())
    payload = {
        "metadata": review_metadata("cache_status", generated_at, mode=mode),
        "summary": {
            "openalex_cache_entries": openalex["cache_entry_count"],
            "openalex_stale_entries": openalex["stale_cache_entry_count"],
            "sec_cache_files": len(sec_files),
            "sec_stale_cache_files": len(stale_sec),
            "total_cache_size_bytes": openalex["cache_size_bytes"] + total_sec_bytes,
            "deletion_performed": False,
            "review_only": True,
        },
        "openalex": openalex,
        "sec": {
            "cache_dir": display_path(SEC_CACHE_DIR),
            "cache_file_count": len(sec_files),
            "stale_cache_file_count": len(stale_sec),
            "cache_size_bytes": total_sec_bytes,
            "cache_ttl_days": args.sec_cache_ttl_days,
            "sample_stale_cache_files": [
                {
                    "path": display_path(path),
                    "age_days": file_age_days(path, generated_at),
                    "review_only": True,
                }
                for path in stale_sec[:20]
            ],
            "deletion_performed": False,
            "pruning_guidance": "Review stale SEC cache files before pruning; the orchestrator does not delete cache files.",
            "review_only": True,
        },
        "safety": safety_block(),
    }
    return payload


def build_rate_limit_status(
    args: argparse.Namespace,
    generated_at: datetime,
    *,
    mode: str,
    ledger: dict[str, Any],
    openalex_used: int,
    sec_used: int,
) -> dict[str, Any]:
    date_key = today_key(generated_at)
    global_used = openalex_used + sec_used
    providers = {
        "global": {
            "request_cap": args.max_requests,
            "requests_used": global_used,
            "requests_remaining": max(0, args.max_requests - global_used),
            "cap_exceeded": global_used > args.max_requests,
        },
        "openalex": {
            "per_run_cap": args.openalex_max_requests,
            "daily_cap": args.openalex_daily_cap,
            "requests_used": openalex_used,
            "daily_used_after_run": daily_used(ledger, date_key, "openalex"),
            "requests_remaining": max(0, args.openalex_max_requests - openalex_used),
            "cap_exceeded": openalex_used > args.openalex_max_requests,
        },
        "sec": {
            "per_run_cap": args.sec_max_requests,
            "daily_cap": args.sec_daily_cap,
            "requests_used": sec_used,
            "daily_used_after_run": daily_used(ledger, date_key, "sec"),
            "requests_remaining": max(0, args.sec_max_requests - sec_used),
            "cap_exceeded": sec_used > args.sec_max_requests,
        },
    }
    return {
        "metadata": review_metadata("rate_limit_status", generated_at, mode=mode),
        "summary": {
            "network_disabled_default": True,
            "manual_override_required": True,
            "network_enabled_this_run": bool(args.write and args.allow_network),
            "requests_used": global_used,
            "request_cap": args.max_requests,
            "cap_exceeded": any(item["cap_exceeded"] for item in providers.values()),
            "daily_budget_date": date_key,
            "review_only": True,
        },
        "providers": providers,
        "governance": {
            "openalex_per_run_cap": args.openalex_max_requests,
            "sec_per_run_cap": args.sec_max_requests,
            "global_refresh_cap": args.max_requests,
            "safe_failure_policy": "Provider requests are skipped when per-run, daily, or global caps are exhausted.",
            "production_write_policy": "Refresh artifacts are review-only and production writes remain zero.",
            "review_only": True,
        },
        "safety": safety_block(global_used),
    }


def build_candidate_refresh_status(generated_at: datetime, *, mode: str) -> dict[str, Any]:
    review_summary = load_json(REVIEW_PIPELINE_SUMMARY_PATH, required=False)
    source_coverage = load_json(SOURCE_COVERAGE_REFRESH_PATH, required=False)
    source_governance = load_json(SOURCE_GOVERNANCE_REPORT_PATH, required=False)
    sec_candidates = summarize_sec_candidates()
    review_summary_summary = review_summary.get("summary") if isinstance(review_summary, dict) else {}
    coverage_summary = source_coverage.get("summary") if isinstance(source_coverage, dict) else {}
    governance_summary = source_governance.get("summary") if isinstance(source_governance, dict) else {}
    return {
        "metadata": review_metadata("candidate_refresh_status", generated_at, mode=mode),
        "summary": {
            "review_pipeline_status": review_summary_summary.get("status") if isinstance(review_summary_summary, dict) else None,
            "review_pipeline_step_count": review_summary_summary.get("step_count") if isinstance(review_summary_summary, dict) else 0,
            "candidate_evidence_count": sec_candidates["candidate_evidence_count"],
            "reviewer_priority_count": coverage_summary.get("reviewer_priority_count") if isinstance(coverage_summary, dict) else 0,
            "candidate_company_preview_count": governance_summary.get("candidate_company_preview_count") if isinstance(governance_summary, dict) else 0,
            "expansion_batch_count": governance_summary.get("expansion_batch_count") if isinstance(governance_summary, dict) else 0,
            "corridor_source_lane_count": coverage_summary.get("corridor_source_lane_count") if isinstance(coverage_summary, dict) else 0,
            "review_only": True,
        },
        "sec_candidate_updates": sec_candidates,
        "artifact_inputs": {
            "review_pipeline_summary": display_path(REVIEW_PIPELINE_SUMMARY_PATH),
            "source_coverage_refresh": display_path(SOURCE_COVERAGE_REFRESH_PATH),
            "source_governance_report": display_path(SOURCE_GOVERNANCE_REPORT_PATH),
            "review_only": True,
        },
        "safety": safety_block(),
    }


def build_graph_planning_status(generated_at: datetime, *, mode: str) -> dict[str, Any]:
    governance = load_json(SOURCE_GOVERNANCE_REPORT_PATH, required=False)
    coverage = load_json(SOURCE_COVERAGE_REFRESH_PATH, required=False)
    scaling = governance.get("large_graph_scaling_readiness") if isinstance(governance, dict) else {}
    corridors = governance.get("corridor_maintenance") if isinstance(governance, dict) else {}
    coverage_summary = coverage.get("summary") if isinstance(coverage, dict) else {}
    return {
        "metadata": review_metadata("large_graph_refresh_forecast", generated_at, mode=mode),
        "summary": {
            "density_bucket": scaling.get("density_bucket") if isinstance(scaling, dict) else None,
            "node_count": scaling.get("node_count") if isinstance(scaling, dict) else 0,
            "edge_count": scaling.get("edge_count") if isinstance(scaling, dict) else 0,
            "recommended_label_limit": scaling.get("recommended_label_limit") if isinstance(scaling, dict) else 0,
            "corridor_rows": len(corridors.get("corridor_rows", [])) if isinstance(corridors, dict) and isinstance(corridors.get("corridor_rows"), list) else 0,
            "corridor_source_lane_count": coverage_summary.get("corridor_source_lane_count") if isinstance(coverage_summary, dict) else 0,
            "direct_graph_mutation": False,
            "review_only": True,
        },
        "navigation_recommendations": {
            "preserve_d149_navigation": True,
            "direct_graph_mutation": False,
            "use_preview_overlays_only": True,
            "review_only": True,
        },
        "safety": safety_block(),
    }


def refresh_artifacts(args: argparse.Namespace, initial_hashes: dict[Path, str]) -> StepResult | None:
    if args.skip_review_refresh:
        return None
    command = [
        sys.executable,
        str(REVIEW_REFRESH_SCRIPT),
        "--skip-openalex",
        "--skip-validation",
        "--json",
    ]
    if args.write:
        command.extend(["--write", "--force"])
    return run_subprocess("review_artifact_refresh", command, initial_hashes)


def build_refresh_summary(
    args: argparse.Namespace,
    *,
    generated_at: datetime,
    started_at: datetime,
    sec_status: dict[str, Any],
    openalex_status: dict[str, Any],
    rate_limit_status: dict[str, Any],
    cache_status: dict[str, Any],
    source_aging_status: dict[str, Any],
    candidate_status: dict[str, Any],
    graph_status: dict[str, Any],
    steps: list[StepResult],
) -> dict[str, Any]:
    failed_steps = [step for step in steps if step.return_code != 0]
    request_used = safe_int(rate_limit_status.get("summary", {}).get("requests_used"), 0)
    source_summary = source_aging_status.get("summary", {})
    candidate_summary = candidate_status.get("summary", {})
    status = "failed" if failed_steps else "passed"
    next_action = next_recommended_action(sec_status, openalex_status, source_aging_status, candidate_status)
    return {
        "metadata": review_metadata("latest_refresh_summary", generated_at, mode="write" if args.write else "dry_run"),
        "summary": {
            "status": status,
            "pipeline_started_at_utc": started_at.isoformat(),
            "latest_refresh_timestamp": generated_at.isoformat(),
            "dry_run": not args.write,
            "network_enabled": bool(args.write and args.allow_network),
            "requests_used": request_used,
            "request_cap": args.max_requests,
            "openalex_configured": bool(openalex_status.get("summary", {}).get("configured")),
            "sec_configured": bool(sec_status.get("summary", {}).get("configured")),
            "cache_hits": safe_int(openalex_status.get("summary", {}).get("cache_hits"), 0) + safe_int(sec_status.get("summary", {}).get("cache_hits"), 0),
            "cache_misses": safe_int(openalex_status.get("summary", {}).get("cache_misses"), 0) + safe_int(sec_status.get("summary", {}).get("cache_misses"), 0),
            "new_candidates_found": safe_int(candidate_summary.get("candidate_evidence_count"), 0),
            "stale_sources_found": safe_int(source_summary.get("stale_source_count"), 0),
            "production_writes": 0,
            "next_recommended_action": next_action,
            "review_only": True,
        },
        "openalex": openalex_status.get("summary", {}),
        "sec": sec_status.get("summary", {}),
        "source_aging": source_summary,
        "candidate_refresh": candidate_summary,
        "cache": cache_status.get("summary", {}),
        "rate_limits": rate_limit_status.get("summary", {}),
        "graph_planning": graph_status.get("summary", {}),
        "steps": [step_to_dict(step) for step in steps],
        "artifact_paths": {
            "latest_refresh_summary": display_path(LATEST_REFRESH_SUMMARY_PATH),
            "refresh_changelog": display_path(REFRESH_CHANGELOG_PATH),
            "openalex_refresh_status": display_path(OPENALEX_REFRESH_STATUS_PATH),
            "sec_refresh_status": display_path(SEC_REFRESH_STATUS_PATH),
            "rate_limit_status": display_path(RATE_LIMIT_STATUS_PATH),
            "cache_status": display_path(CACHE_STATUS_PATH),
            "source_aging_status": display_path(SOURCE_AGING_STATUS_PATH),
            "candidate_refresh_status": "data/refresh/candidate_refresh_status.json",
            "large_graph_refresh_forecast": "data/refresh/large_graph_refresh_forecast.json",
        },
        "safety": safety_block(request_used),
    }


def next_recommended_action(
    sec_status: dict[str, Any],
    openalex_status: dict[str, Any],
    source_aging_status: dict[str, Any],
    candidate_status: dict[str, Any],
) -> str:
    if not openalex_status.get("summary", {}).get("configured"):
        return "Add the OpenAlex configuration only if bounded live enrichment is desired; cache-only refresh is already safe."
    if not sec_status.get("summary", {}).get("configured"):
        return "Add a SEC user-agent configuration before enabling SEC network refresh."
    if safe_int(source_aging_status.get("summary", {}).get("stale_source_count"), 0):
        return "Review stale source queue before any future promotion planning."
    if safe_int(candidate_status.get("summary", {}).get("reviewer_priority_count"), 0):
        return "Inspect reviewer priority queues in Source Workbench; keep promotion manual."
    return "Refresh completed with review-only artifacts; inspect Source Workbench before any future reviewed promotion phase."


def build_changelog(
    generated_at: datetime,
    *,
    mode: str,
    latest_summary: dict[str, Any],
    previous_summary: dict[str, Any] | None,
) -> dict[str, Any]:
    existing = load_json(REFRESH_CHANGELOG_PATH, required=False)
    entries = existing.get("entries") if isinstance(existing, dict) else []
    if not isinstance(entries, list):
        entries = []
    summary = latest_summary.get("summary", {})
    previous = previous_summary.get("summary", {}) if isinstance(previous_summary, dict) else {}
    changes = {
        "requests_used_delta": safe_int(summary.get("requests_used"), 0) - safe_int(previous.get("requests_used"), 0),
        "candidate_count_delta": safe_int(summary.get("new_candidates_found"), 0) - safe_int(previous.get("new_candidates_found"), 0),
        "stale_source_count_delta": safe_int(summary.get("stale_sources_found"), 0) - safe_int(previous.get("stale_sources_found"), 0),
        "cache_hit_delta": safe_int(summary.get("cache_hits"), 0) - safe_int(previous.get("cache_hits"), 0),
        "review_only": True,
    }
    entry = {
        "run_id": generated_at.strftime("live-refresh-%Y%m%dT%H%M%SZ"),
        "generated_at_utc": generated_at.isoformat(),
        "status": summary.get("status"),
        "requests_used": summary.get("requests_used"),
        "request_cap": summary.get("request_cap"),
        "production_writes": 0,
        "changes": changes,
        "review_only": True,
    }
    return {
        "metadata": review_metadata("refresh_changelog", generated_at, mode=mode),
        "summary": {
            "latest_refresh_timestamp": generated_at.isoformat(),
            "latest_status": summary.get("status"),
            "entry_count": min(CHANGELOG_LIMIT, len(entries) + 1),
            "review_only": True,
        },
        "entries": [entry, *entries][:CHANGELOG_LIMIT],
        "safety": safety_block(safe_int(summary.get("requests_used"), 0)),
    }


def write_refresh_artifacts(
    *,
    args: argparse.Namespace,
    latest_summary: dict[str, Any],
    changelog: dict[str, Any],
    openalex_status: dict[str, Any],
    sec_status: dict[str, Any],
    rate_limit_status: dict[str, Any],
    cache_status: dict[str, Any],
    source_aging_status: dict[str, Any],
    candidate_status: dict[str, Any],
    graph_status: dict[str, Any],
    ledger: dict[str, Any],
) -> None:
    write_json(LATEST_REFRESH_SUMMARY_PATH, latest_summary, force=args.force)
    write_json(REFRESH_CHANGELOG_PATH, changelog, force=True)
    write_json(OPENALEX_REFRESH_STATUS_PATH, openalex_status, force=args.force)
    write_json(SEC_REFRESH_STATUS_PATH, sec_status, force=args.force)
    write_json(RATE_LIMIT_STATUS_PATH, rate_limit_status, force=args.force)
    write_json(CACHE_STATUS_PATH, cache_status, force=args.force)
    write_json(SOURCE_AGING_STATUS_PATH, source_aging_status, force=args.force)
    write_json(REFRESH_DIR / "candidate_refresh_status.json", candidate_status, force=args.force)
    write_json(REFRESH_DIR / "large_graph_refresh_forecast.json", graph_status, force=args.force)
    write_json(RATE_LIMIT_LEDGER_PATH, ledger, force=True)


def print_plan(args: argparse.Namespace, ledger: dict[str, Any], generated_at: datetime) -> None:
    print("Bounded live refresh plan")
    print("=========================")
    print("Mode: dry-run")
    print("Network enabled: no")
    print(f"Global request cap: {args.max_requests}")
    print(f"OpenAlex configured: {'yes' if clean_string(os.environ.get('OPENALEX_API_KEY')) else 'no'}")
    print(f"SEC configured: {'yes' if clean_string(os.environ.get('SEC_USER_AGENT')) else 'no'}")
    print(f"OpenAlex daily remaining: {remaining_daily(ledger, generated_at, 'openalex', args.openalex_daily_cap)}")
    print(f"SEC daily remaining: {remaining_daily(ledger, generated_at, 'sec', args.sec_daily_cap)}")
    print("Production writes: 0")
    print("Use --write with explicit provider network flags for bounded live refresh.")


def print_human(summary: dict[str, Any]) -> None:
    status = summary.get("summary", {})
    print()
    print("Bounded live refresh summary")
    print("============================")
    print(f"Status: {status.get('status')}")
    print(f"Latest UTC: {status.get('latest_refresh_timestamp')}")
    print(f"Network enabled: {'yes' if status.get('network_enabled') else 'no'}")
    print(f"Requests used: {status.get('requests_used')} / {status.get('request_cap')}")
    print(f"OpenAlex configured: {'yes' if status.get('openalex_configured') else 'no'}")
    print(f"SEC configured: {'yes' if status.get('sec_configured') else 'no'}")
    print(f"Stale sources: {status.get('stale_sources_found')}")
    print(f"Candidate evidence records: {status.get('new_candidates_found')}")
    print("Production writes: 0")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    started_at = utc_now()
    generated_at = started_at
    ledger = load_rate_ledger()
    initial_hashes = production_hashes()

    if not args.write:
        print_plan(args, ledger, generated_at)
        if args.json:
            dry_source_aging = build_source_aging_status(generated_at, mode="dry_run")
            json.dump(
                {
                    "metadata": review_metadata("live_refresh_plan", generated_at, mode="dry_run"),
                    "summary": {
                        "status": "planned",
                        "dry_run": True,
                        "production_writes": 0,
                        "request_cap": args.max_requests,
                        "review_only": True,
                    },
                    "source_aging": dry_source_aging.get("summary", {}),
                    "safety": safety_block(),
                },
                sys.stdout,
                indent=2,
                sort_keys=True,
            )
            print()
        return 0

    steps: list[StepResult] = []
    openalex_used = 0
    sec_used = 0
    try:
        previous_summary = load_json(LATEST_REFRESH_SUMMARY_PATH, required=False)
        sec_status, sec_used = build_sec_refresh_status(
            args,
            generated_at=generated_at,
            ledger=ledger,
            global_remaining=args.max_requests,
        )
        assert_production_unchanged(initial_hashes)
        openalex_status, openalex_used, openalex_step = build_openalex_refresh_status(
            args,
            generated_at=generated_at,
            ledger=ledger,
            global_remaining=max(0, args.max_requests - sec_used),
            initial_hashes=initial_hashes,
        )
        if openalex_step:
            steps.append(openalex_step)
        review_step = refresh_artifacts(args, initial_hashes)
        if review_step:
            steps.append(review_step)
        ledger = update_rate_ledger(
            ledger,
            generated_at=generated_at,
            openalex_used=openalex_used,
            sec_used=sec_used,
        )
        source_aging_status = build_source_aging_status(generated_at, mode="write")
        cache_status = build_cache_status(args, generated_at, mode="write")
        candidate_status = build_candidate_refresh_status(generated_at, mode="write")
        graph_status = build_graph_planning_status(generated_at, mode="write")
        rate_limit_status = build_rate_limit_status(
            args,
            generated_at=generated_at,
            mode="write",
            ledger=ledger,
            openalex_used=openalex_used,
            sec_used=sec_used,
        )
        latest_summary = build_refresh_summary(
            args,
            generated_at=generated_at,
            started_at=started_at,
            sec_status=sec_status,
            openalex_status=openalex_status,
            rate_limit_status=rate_limit_status,
            cache_status=cache_status,
            source_aging_status=source_aging_status,
            candidate_status=candidate_status,
            graph_status=graph_status,
            steps=steps,
        )
        changelog = build_changelog(
            generated_at,
            mode="write",
            latest_summary=latest_summary,
            previous_summary=previous_summary if isinstance(previous_summary, dict) else None,
        )
        write_refresh_artifacts(
            args=args,
            latest_summary=latest_summary,
            changelog=changelog,
            openalex_status=openalex_status,
            sec_status=sec_status,
            rate_limit_status=rate_limit_status,
            cache_status=cache_status,
            source_aging_status=source_aging_status,
            candidate_status=candidate_status,
            graph_status=graph_status,
            ledger=ledger,
        )
        assert_production_unchanged(initial_hashes)
    except LiveRefreshError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("production writes: 0", file=sys.stderr)
        return 2

    if args.json:
        json.dump(latest_summary, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(latest_summary)
    return 1 if latest_summary["summary"]["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
