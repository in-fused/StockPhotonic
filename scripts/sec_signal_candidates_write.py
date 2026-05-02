#!/usr/bin/env python3
"""Write review-only SEC relationship candidates from preview objects."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CANDIDATE_OUTPUT_PATH = (
    PROJECT_ROOT / "data" / "candidates" / "sec_relationship_candidates.json"
)
EXPECTED_CACHE_ROOT_LABEL = "data/cache/sec/filings"
SAFETY_COUNTERS = {
    "network_calls": 0,
    "production_writes": 0,
}
REQUIRED_CANDIDATE_FIELDS = (
    "source_ticker",
    "target_ticker",
    "relationship_type",
    "source_type",
    "source_tier",
    "confidence_hint",
    "evidence_snippet",
    "filing_date",
    "accession_number",
    "review_status",
)
OPTIONAL_CANDIDATE_FIELDS = (
    "target_name",
    "target_match_method",
    "target_match_confidence",
    "target_entity_mention",
    "unresolved_entity_mentions",
)

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sec_filing_inspect import FilingInspectError  # noqa: E402
from sec_filing_signals import SignalExtractionError, parse_nonnegative_int  # noqa: E402
from sec_signal_candidates_preview import build_preview  # noqa: E402


class CandidateWriteError(Exception):
    """Raised for clear candidate writer failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert cached SEC filing signal preview objects into review-only "
            "relationship candidate records. Default mode prints would-be "
            "candidate records to stdout only. Use --write to save the fixed "
            "candidate file, and --force to overwrite an existing file."
        )
    )
    parser.add_argument(
        "--files",
        nargs="+",
        required=True,
        help="One or more local filing cache documents under data/cache/sec/filings.",
    )
    parser.add_argument(
        "--limit-chars",
        type=parse_nonnegative_int,
        help="Optional maximum number of decoded characters to scan per filing.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help=(
            "Write data/candidates/sec_relationship_candidates.json. "
            "Without this flag the script is a dry run and writes nothing."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow --write to overwrite an existing candidate file.",
    )
    return parser.parse_args(argv)


def metadata() -> dict[str, Any]:
    return {
        "description": (
            "Review-only SEC relationship candidate staging file. Records are "
            "generated from cached filing signal previews and must not be loaded "
            "by the app or promoted directly into production graph data."
        ),
        "status": "candidate_only",
        "production_write_allowed": False,
        "app_load_allowed": False,
        "source_policy_notes": [
            "Read cached SEC filing documents only; do not perform network calls.",
            "Keep records pending review until a human confirms source and target tickers, relationship type, and evidence.",
            "Do not create production nodes, production edges, or writes to data/companies.json or data/connections.json from this file.",
        ],
        "source_requirements": list(REQUIRED_CANDIDATE_FIELDS),
        "candidate_schema_example": {
            "source_ticker": "SOURCE_PUBLIC_TICKER",
            "target_ticker": None,
            "target_name": None,
            "target_match_method": None,
            "target_match_confidence": None,
            "target_entity_mention": None,
            "relationship_type": "supplier_customer",
            "source_type": "sec_filing",
            "source_tier": 1,
            "confidence_hint": 0.88,
            "evidence_snippet": "Concise filing text snippet supporting manual review.",
            "filing_date": "YYYY-MM-DD",
            "accession_number": "0000000000-00-000000",
            "review_status": "pending_review",
        },
    }


def candidate_from_preview(preview_candidate: dict[str, Any]) -> dict[str, Any]:
    candidate = {
        "source_ticker": preview_candidate.get("source_ticker"),
        "target_ticker": preview_candidate.get("target_ticker"),
        "relationship_type": preview_candidate.get("relationship_type"),
        "source_type": preview_candidate.get("source_type"),
        "source_tier": preview_candidate.get("source_tier"),
        "confidence_hint": preview_candidate.get("confidence_hint"),
        "evidence_snippet": preview_candidate.get("evidence_snippet"),
        "filing_date": preview_candidate.get("filing_date"),
        "accession_number": preview_candidate.get("accession_number"),
        "review_status": "pending_review",
    }
    for field in OPTIONAL_CANDIDATE_FIELDS:
        if field in preview_candidate:
            candidate[field] = preview_candidate.get(field)
    return candidate


def build_candidate_payload(raw_files: list[str], limit_chars: int | None) -> dict[str, Any]:
    preview = build_preview(raw_files, limit_chars)
    candidates = [
        candidate_from_preview(candidate)
        for candidate in preview["preview_candidates"]
    ]

    return {
        "metadata": metadata(),
        "source_preview": {
            "preview_type": preview["preview_type"],
            "expected_cache_root": EXPECTED_CACHE_ROOT_LABEL,
            "input_files": preview["input_files"],
            "limit_chars_per_file": preview["limit_chars_per_file"],
            "scanned_characters": preview["scanned_characters"],
            "total_signals": preview["total_signals"],
        },
        "candidate_count": len(candidates),
        "candidates": candidates,
        "safety": dict(SAFETY_COUNTERS),
    }


def validate_payload(payload: dict[str, Any]) -> None:
    metadata_fields = payload.get("metadata")
    if not isinstance(metadata_fields, dict):
        raise CandidateWriteError("candidate payload metadata must be an object.")
    if metadata_fields.get("status") != "candidate_only":
        raise CandidateWriteError("candidate payload metadata.status must be candidate_only.")
    if metadata_fields.get("production_write_allowed") is not False:
        raise CandidateWriteError(
            "candidate payload must set production_write_allowed to false."
        )
    if metadata_fields.get("app_load_allowed") is not False:
        raise CandidateWriteError("candidate payload must set app_load_allowed to false.")

    safety = payload.get("safety")
    if not isinstance(safety, dict):
        raise CandidateWriteError("candidate payload safety must be an object.")
    if safety.get("network_calls") != 0 or safety.get("production_writes") != 0:
        raise CandidateWriteError(
            "candidate payload safety counters must keep network_calls and production_writes at 0."
        )

    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise CandidateWriteError("candidate payload candidates must be a list.")
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise CandidateWriteError(f"candidate {index} must be an object.")
        missing = [
            field
            for field in REQUIRED_CANDIDATE_FIELDS
            if field not in candidate
        ]
        if missing:
            raise CandidateWriteError(
                f"candidate {index} is missing required fields: {', '.join(missing)}"
            )
        if candidate["review_status"] != "pending_review":
            raise CandidateWriteError(
                f"candidate {index} review_status must be pending_review."
            )


def print_dry_run(candidates: list[dict[str, Any]]) -> None:
    json.dump(candidates, sys.stdout, indent=2)
    print()


def write_candidate_file(payload: dict[str, Any], *, force: bool) -> None:
    if CANDIDATE_OUTPUT_PATH.exists() and not force:
        raise CandidateWriteError(
            f"{CANDIDATE_OUTPUT_PATH} already exists; pass --force to overwrite."
        )

    try:
        with CANDIDATE_OUTPUT_PATH.open("w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
            file.write("\n")
    except OSError as exc:
        raise CandidateWriteError(
            f"could not write candidate file {CANDIDATE_OUTPUT_PATH}: {exc}"
        ) from exc


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.force and not args.write:
        print("error: --force can only be used with --write.", file=sys.stderr)
        return 2
    if args.write and CANDIDATE_OUTPUT_PATH.exists() and not args.force:
        print(
            f"error: {CANDIDATE_OUTPUT_PATH} already exists; pass --force to overwrite.",
            file=sys.stderr,
        )
        return 2

    try:
        payload = build_candidate_payload(args.files, args.limit_chars)
        validate_payload(payload)
        if not args.write:
            print_dry_run(payload["candidates"])
            return 0

        write_candidate_file(payload, force=args.force)
    except (CandidateWriteError, FilingInspectError, SignalExtractionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(
        "wrote "
        f"{payload['candidate_count']} review-only SEC relationship candidates "
        f"to {CANDIDATE_OUTPUT_PATH.relative_to(PROJECT_ROOT)}"
    )
    print("safety: network_calls=0 production_writes=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
