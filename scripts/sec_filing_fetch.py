#!/usr/bin/env python3
"""Fetch reviewed SEC filing documents into local cache.

This script reads a reviewed SEC filing download plan artifact and, only when
explicitly network-enabled, downloads the listed SEC archive documents into
local cache. It never creates candidates and never writes production graph data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PLAN_INPUT_DIR = PROJECT_ROOT / "data" / "candidates" / "plans"
CACHE_FILINGS_DIR = PROJECT_ROOT / "data" / "cache" / "sec" / "filings"
DEFAULT_TIMEOUT_SECONDS = 20.0
ALLOWED_SEC_HOST = "sec.gov"
ALLOWED_SEC_HOST_SUFFIX = ".sec.gov"
PLAN_TYPE = "sec_filing_download_plan"
ACCESSION_PATTERN = re.compile(r"^\d{10}-\d{2}-\d{6}$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PRIMARY_DOCUMENT_FORBIDDEN_CHARS = set('<>:"\\|?*')


class FilingFetchError(Exception):
    """Raised for clear filing-fetch setup and validation failures."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Disable urllib redirect following so only plan-listed URLs are requested."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        return None


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def parse_positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit must be an integer.") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit must be at least 1.")
    return parsed


def parse_positive_timeout(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--timeout must be a number.") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("--timeout must be greater than zero.")
    return parsed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read a reviewed SEC filing download plan artifact and optionally "
            "fetch only the listed SEC archive documents into local cache. "
            "Default behavior is a no-network dry run."
        )
    )
    parser.add_argument(
        "--plan",
        required=True,
        help=(
            "Reviewed plan artifact under data/candidates/plans/, for example "
            "data/candidates/plans/aapl_recent_filings.json."
        ),
    )
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="Permit actual SEC document downloads. Requires --user-agent.",
    )
    parser.add_argument(
        "--user-agent",
        help=(
            'Required with --allow-network. Use an identifying value such as '
            '"Your Name your.email@example.com".'
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Print planned cache targets without network calls. This is also "
            "the default when --allow-network is absent."
        ),
    )
    parser.add_argument(
        "--limit",
        type=parse_positive_int,
        help="Maximum number of validated plan filings to process.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Refetch and overwrite an existing cached document.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only status counts and omit per-filing detail.",
    )
    parser.add_argument(
        "--timeout",
        type=parse_positive_timeout,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Network timeout in seconds. Default: {DEFAULT_TIMEOUT_SECONDS:g}.",
    )
    return parser.parse_args(argv)


def validate_user_agent(raw_user_agent: str | None) -> str:
    if raw_user_agent is None:
        raise FilingFetchError("--user-agent is required with --allow-network.")
    user_agent = raw_user_agent.strip()
    if not user_agent:
        raise FilingFetchError("--user-agent must not be blank.")
    if "@" not in user_agent:
        raise FilingFetchError(
            "--user-agent must include contact information, such as an email address."
        )
    return user_agent


def resolve_plan_path(raw_plan: str) -> Path:
    plan_path = Path(raw_plan)
    if not plan_path.is_absolute():
        plan_path = Path.cwd() / plan_path

    resolved_plan = plan_path.resolve(strict=False)
    resolved_plan_dir = PLAN_INPUT_DIR.resolve(strict=False)
    if resolved_plan == resolved_plan_dir or not is_relative_to(
        resolved_plan,
        resolved_plan_dir,
    ):
        raise FilingFetchError(
            "--plan must be a reviewed artifact under data/candidates/plans/ "
            f"(resolved allowed directory: {resolved_plan_dir})"
        )
    if not resolved_plan.exists():
        raise FilingFetchError(f"plan artifact not found: {resolved_plan}")
    if not resolved_plan.is_file():
        raise FilingFetchError(f"plan path is not a file: {resolved_plan}")
    return resolved_plan


def load_plan_payload(plan_path: Path) -> dict[str, Any]:
    try:
        with plan_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except json.JSONDecodeError as exc:
        raise FilingFetchError(
            f"invalid JSON in plan artifact {plan_path}: {exc.msg} "
            f"at line {exc.lineno} column {exc.colno}"
        ) from exc
    except OSError as exc:
        raise FilingFetchError(f"could not read plan artifact {plan_path}: {exc}") from exc

    if not isinstance(payload, dict):
        raise FilingFetchError("plan artifact top-level value must be an object.")
    return payload


def require_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FilingFetchError(f"{path} must be an object.")
    return value


def require_string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FilingFetchError(f"{path} must be a non-empty string.")
    if value != value.strip():
        raise FilingFetchError(f"{path} must not have leading or trailing whitespace.")
    return value


def normalize_cik(raw_cik: Any, path: str) -> str:
    cik = require_string(raw_cik, path).upper()
    if cik.startswith("CIK"):
        cik = cik[3:]
    if not cik.isdigit():
        raise FilingFetchError(f"{path} must contain digits only, optionally prefixed by CIK.")
    if len(cik) > 10:
        raise FilingFetchError(f"{path} must be 10 digits or fewer before zero-padding.")
    return cik.zfill(10)


def normalize_accession(raw_accession: Any, path: str) -> str:
    accession_number = require_string(raw_accession, path)
    if not ACCESSION_PATTERN.match(accession_number):
        raise FilingFetchError(
            f"{path} must use SEC accession format 0000000000-00-000000."
        )
    return accession_number


def validate_filing_date(raw_filing_date: Any, path: str) -> str:
    filing_date = require_string(raw_filing_date, path)
    if not DATE_PATTERN.match(filing_date):
        raise FilingFetchError(f"{path} must use YYYY-MM-DD format.")
    return filing_date


def validate_primary_document(raw_primary_document: Any, path: str) -> str:
    primary_document = require_string(raw_primary_document, path)
    if primary_document in {".", ".."}:
        raise FilingFetchError(f"{path} must be a file name.")
    if primary_document.lower() == "metadata.json":
        raise FilingFetchError(f"{path} conflicts with the reserved metadata sidecar name.")
    if "/" in primary_document or "\\" in primary_document:
        raise FilingFetchError(f"{path} must be a file name, not a path.")
    if any(char in PRIMARY_DOCUMENT_FORBIDDEN_CHARS for char in primary_document):
        raise FilingFetchError(f"{path} contains characters that are unsafe for cache paths.")
    if any(ord(char) < 32 for char in primary_document):
        raise FilingFetchError(f"{path} contains control characters.")
    return primary_document


def validate_sec_archive_url(
    raw_url: Any,
    *,
    accession_number: str,
    primary_document: str,
    plan_cik: str | None,
    path: str,
) -> tuple[str, str]:
    archive_url = require_string(raw_url, path)
    parsed = urllib.parse.urlparse(archive_url)

    if parsed.scheme != "https":
        raise FilingFetchError(f"{path} must use https.")
    if parsed.username or parsed.password:
        raise FilingFetchError(f"{path} must not include credentials.")

    hostname = (parsed.hostname or "").lower()
    if hostname != ALLOWED_SEC_HOST and not hostname.endswith(ALLOWED_SEC_HOST_SUFFIX):
        raise FilingFetchError(f"{path} host must be sec.gov or a sec.gov subdomain.")

    try:
        port = parsed.port
    except ValueError as exc:
        raise FilingFetchError(f"{path} has an invalid port.") from exc
    if port not in {None, 443}:
        raise FilingFetchError(f"{path} must not use a non-standard port.")

    if parsed.query or parsed.fragment or parsed.params:
        raise FilingFetchError(f"{path} must not include params, query, or fragment.")

    path_segments = [urllib.parse.unquote(segment) for segment in parsed.path.split("/")]
    if len(path_segments) != 7 or path_segments[:4] != ["", "Archives", "edgar", "data"]:
        raise FilingFetchError(
            f"{path} must be an SEC archive document URL under /Archives/edgar/data/."
        )

    url_cik_segment = path_segments[4]
    url_accession = path_segments[5]
    url_document = path_segments[6]
    if not url_cik_segment.isdigit():
        raise FilingFetchError(f"{path} archive CIK segment must contain digits only.")
    url_cik = normalize_cik(url_cik_segment, f"{path} archive CIK segment")
    if plan_cik is not None and url_cik != plan_cik:
        raise FilingFetchError(f"{path} archive CIK does not match plan CIK.")

    accession_without_dashes = accession_number.replace("-", "")
    if url_accession != accession_without_dashes:
        raise FilingFetchError(
            f"{path} archive accession segment does not match accession_number."
        )
    if url_document != primary_document:
        raise FilingFetchError(f"{path} document name does not match primary_document.")

    return archive_url, url_cik


def validate_metadata(metadata: Any) -> dict[str, Any]:
    metadata_object = require_object(metadata, "metadata")
    if metadata_object.get("plan_type") != PLAN_TYPE:
        raise FilingFetchError(f"metadata.plan_type must be {PLAN_TYPE}.")
    if metadata_object.get("plan_artifact_only") is not True:
        raise FilingFetchError("metadata.plan_artifact_only must be true.")
    return metadata_object


def validate_plan_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    metadata = validate_metadata(payload.get("metadata"))
    filings = payload.get("filings")
    if not isinstance(filings, list):
        raise FilingFetchError("filings must be an array.")

    metadata_cik: str | None = None
    if "cik" in metadata and metadata.get("cik") is not None:
        metadata_cik = normalize_cik(metadata["cik"], "metadata.cik")

    validated_filings: list[dict[str, Any]] = []
    for index, raw_filing in enumerate(filings):
        filing_path = f"filings[{index}]"
        filing = require_object(raw_filing, filing_path)
        accession_number = normalize_accession(
            filing.get("accession_number"),
            f"{filing_path}.accession_number",
        )
        primary_document = validate_primary_document(
            filing.get("primary_document"),
            f"{filing_path}.primary_document",
        )
        form = require_string(filing.get("form"), f"{filing_path}.form")
        filing_date = validate_filing_date(filing.get("filing_date"), f"{filing_path}.filing_date")

        if filing.get("source_type") != "sec_filing":
            raise FilingFetchError(f"{filing_path}.source_type must be sec_filing.")
        source_tier = filing.get("source_tier")
        if not isinstance(source_tier, int) or isinstance(source_tier, bool) or source_tier != 1:
            raise FilingFetchError(f"{filing_path}.source_tier must be 1.")
        if filing.get("planned_status") != "pending_fetch":
            raise FilingFetchError(f"{filing_path}.planned_status must be pending_fetch.")

        filing_cik: str | None = None
        if "cik" in filing and filing.get("cik") is not None:
            filing_cik = normalize_cik(filing["cik"], f"{filing_path}.cik")
            if metadata_cik is not None and filing_cik != metadata_cik:
                raise FilingFetchError(f"{filing_path}.cik does not match metadata.cik.")

        archive_url, archive_cik = validate_sec_archive_url(
            filing.get("archive_url"),
            accession_number=accession_number,
            primary_document=primary_document,
            plan_cik=filing_cik or metadata_cik,
            path=f"{filing_path}.archive_url",
        )
        effective_cik = filing_cik or metadata_cik or archive_cik

        validated = dict(filing)
        validated.update(
            {
                "archive_url": archive_url,
                "accession_number": accession_number,
                "primary_document": primary_document,
                "form": form,
                "filing_date": filing_date,
                "cik": effective_cik,
                "accession_number_without_dashes": accession_number.replace("-", ""),
            }
        )
        validated_filings.append(validated)

    validated_metadata = dict(metadata)
    if metadata_cik is not None:
        validated_metadata["cik"] = metadata_cik
    return validated_metadata, validated_filings


def cache_paths_for_filing(filing: dict[str, Any]) -> tuple[Path, Path]:
    filing_dir = (
        CACHE_FILINGS_DIR
        / filing["cik"]
        / filing["accession_number_without_dashes"]
    )
    document_path = filing_dir / filing["primary_document"]
    metadata_path = filing_dir / "metadata.json"

    resolved_cache_root = CACHE_FILINGS_DIR.resolve(strict=False)
    for label, path in (("document cache path", document_path), ("metadata cache path", metadata_path)):
        resolved_path = path.resolve(strict=False)
        if not is_relative_to(resolved_path, resolved_cache_root):
            raise FilingFetchError(f"{label} resolved outside {resolved_cache_root}.")
    return document_path, metadata_path


def selected_filings(
    filings: list[dict[str, Any]],
    limit: int | None,
) -> list[dict[str, Any]]:
    if limit is None:
        return filings
    return filings[:limit]


def build_request(url: str, user_agent: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html, application/xhtml+xml, application/xml, text/plain, */*",
            "Accept-Encoding": "identity",
            "Connection": "close",
        },
    )


def sidecar_payload(
    *,
    plan_path: Path,
    plan_metadata: dict[str, Any],
    filing: dict[str, Any],
    document_path: Path,
    http_status: int,
    content_type: str,
    bytes_written: int,
) -> dict[str, Any]:
    return {
        "cache_artifact_type": "raw_sec_filing_document",
        "candidate_record": False,
        "production_graph_data": False,
        "source_plan": {
            "path": str(plan_path),
            "plan_type": plan_metadata.get("plan_type"),
            "plan_artifact_only": plan_metadata.get("plan_artifact_only"),
            "cache_file": plan_metadata.get("cache_file"),
            "cik": plan_metadata.get("cik"),
            "company_name": plan_metadata.get("company_name"),
            "tickers": plan_metadata.get("tickers"),
        },
        "filing": {
            "ticker": filing.get("ticker"),
            "cik": filing["cik"],
            "company_name": filing.get("company_name"),
            "form": filing["form"],
            "filing_date": filing["filing_date"],
            "report_date": filing.get("report_date"),
            "accession_number": filing["accession_number"],
            "accession_number_without_dashes": filing["accession_number_without_dashes"],
            "primary_document": filing["primary_document"],
            "archive_url": filing["archive_url"],
            "source_type": filing["source_type"],
            "source_tier": filing["source_tier"],
            "planned_status": filing["planned_status"],
        },
        "download": {
            "fetched_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "cached_document": str(document_path),
            "http_status": http_status,
            "content_type": content_type,
            "bytes_written": bytes_written,
        },
        "safety": {
            "candidate_records_created": 0,
            "candidate_writes": 0,
            "production_graph_writes": 0,
            "production_companies_written": 0,
            "production_connections_written": 0,
        },
    }


def atomic_write_bytes(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_bytes(body)
    temp_path.replace(path)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, sort_keys=True)
        file.write("\n")
    temp_path.replace(path)


def fetch_filing(
    *,
    plan_path: Path,
    plan_metadata: dict[str, Any],
    filing: dict[str, Any],
    document_path: Path,
    metadata_path: Path,
    user_agent: str,
    timeout: float,
    force_refresh: bool,
) -> tuple[str, dict[str, Any]]:
    if document_path.exists() and not force_refresh:
        return (
            "cache-hit",
            {
                "network": "skipped",
                "detail": "use --force-refresh to fetch again",
            },
        )

    request = build_request(filing["archive_url"], user_agent)
    opener = urllib.request.build_opener(NoRedirectHandler)
    try:
        with opener.open(request, timeout=timeout) as response:
            final_url = response.geturl()
            if final_url != filing["archive_url"]:
                raise FilingFetchError(
                    f"SEC request redirected unexpectedly to {final_url}; "
                    "only plan-listed URLs may be fetched."
                )
            body = response.read()
            http_status = getattr(response, "status", response.getcode())
            content_type = response.headers.get("Content-Type", "unknown")
    except urllib.error.HTTPError as exc:
        raise FilingFetchError(f"SEC request failed with HTTP {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise FilingFetchError(f"SEC request failed: {exc.reason}") from exc
    except OSError as exc:
        raise FilingFetchError(f"SEC request failed: {exc}") from exc

    try:
        atomic_write_bytes(document_path, body)
        atomic_write_json(
            metadata_path,
            sidecar_payload(
                plan_path=plan_path,
                plan_metadata=plan_metadata,
                filing=filing,
                document_path=document_path,
                http_status=http_status,
                content_type=content_type,
                bytes_written=len(body),
            ),
        )
    except OSError as exc:
        raise FilingFetchError(f"could not write SEC filing cache: {exc}") from exc

    return (
        "fetched",
        {
            "http_status": http_status,
            "content_type": content_type,
            "bytes_written": len(body),
            "metadata_path": str(metadata_path),
        },
    )


def print_plan_header(
    *,
    mode: str,
    plan_path: Path,
    total_filings: int,
    selected_count: int,
    summary_only: bool,
) -> None:
    print(f"status: {mode}")
    print(f"plan: {plan_path}")
    print(f"plan_filings: {total_filings}")
    print(f"selected_filings: {selected_count}")
    print(f"cache_root: {CACHE_FILINGS_DIR}")
    print("production_data: unchanged")
    print("candidate_records_created: 0")
    if not summary_only:
        print()


def print_filing_detail(
    *,
    index: int,
    status: str,
    filing: dict[str, Any],
    document_path: Path,
    metadata_path: Path,
    extra: dict[str, Any] | None = None,
) -> None:
    print(
        f"{index}. status={status} | "
        f"form={filing['form']} | "
        f"filing_date={filing['filing_date']} | "
        f"accession_number={filing['accession_number']} | "
        f"primary_document={filing['primary_document']}"
    )
    print(f"   archive_url={filing['archive_url']}")
    print(f"   cache_path={document_path}")
    print(f"   metadata_path={metadata_path}")
    if extra:
        for key, value in extra.items():
            print(f"   {key}={value}")


def print_summary(counts: dict[str, int]) -> None:
    print("summary:")
    for key in (
        "planned",
        "fetched",
        "cache_hit",
        "failed",
        "network_calls",
        "candidate_records_created",
        "production_graph_writes",
    ):
        print(f"{key}: {counts.get(key, 0)}")


def run(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        if args.allow_network:
            user_agent = validate_user_agent(args.user_agent)
        else:
            user_agent = None
        plan_path = resolve_plan_path(args.plan)
        payload = load_plan_payload(plan_path)
        plan_metadata, filings = validate_plan_payload(payload)
        selected = selected_filings(filings, args.limit)
        cache_targets = [cache_paths_for_filing(filing) for filing in selected]
    except FilingFetchError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    dry_run = args.dry_run or not args.allow_network
    mode = "dry-run" if dry_run else "network-enabled"
    counts = {
        "planned": len(selected),
        "fetched": 0,
        "cache_hit": 0,
        "failed": 0,
        "network_calls": 0,
        "candidate_records_created": 0,
        "production_graph_writes": 0,
    }

    print_plan_header(
        mode=mode,
        plan_path=plan_path,
        total_filings=len(filings),
        selected_count=len(selected),
        summary_only=args.summary_only,
    )

    if dry_run:
        if not args.summary_only:
            print("planned_downloads:")
            if not selected:
                print("- none")
            for index, (filing, paths) in enumerate(zip(selected, cache_targets), start=1):
                document_path, metadata_path = paths
                print_filing_detail(
                    index=index,
                    status="planned",
                    filing=filing,
                    document_path=document_path,
                    metadata_path=metadata_path,
                    extra={"network": "skipped"},
                )
        print_summary(counts)
        return 0

    assert user_agent is not None
    if not args.summary_only:
        print("download_results:")
    for index, (filing, paths) in enumerate(zip(selected, cache_targets), start=1):
        document_path, metadata_path = paths
        will_request_network = not (document_path.exists() and not args.force_refresh)
        if will_request_network:
            counts["network_calls"] += 1
        try:
            status, extra = fetch_filing(
                plan_path=plan_path,
                plan_metadata=plan_metadata,
                filing=filing,
                document_path=document_path,
                metadata_path=metadata_path,
                user_agent=user_agent,
                timeout=args.timeout,
                force_refresh=args.force_refresh,
            )
        except FilingFetchError as exc:
            status = "failed"
            extra = {"error": str(exc)}
            counts["failed"] += 1
            print(
                f"error: {filing['accession_number']} {filing['primary_document']}: {exc}",
                file=sys.stderr,
            )
        else:
            if status == "fetched":
                counts["fetched"] += 1
            elif status == "cache-hit":
                counts["cache_hit"] += 1

        if not args.summary_only:
            print_filing_detail(
                index=index,
                status=status,
                filing=filing,
                document_path=document_path,
                metadata_path=metadata_path,
                extra=extra,
            )

    print_summary(counts)
    return 1 if counts["failed"] else 0


def main(argv: list[str] | None = None) -> int:
    return run(argv if argv is not None else sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
