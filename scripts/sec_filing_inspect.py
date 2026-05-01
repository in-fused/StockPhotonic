#!/usr/bin/env python3
"""Inspect one cached SEC filing document without fetching or writing data."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FILINGS_ROOT = PROJECT_ROOT / "data" / "cache" / "sec" / "filings"
DEFAULT_LIMIT_CHARS = 2000
SEARCH_SNIPPET_LIMIT = 5
SEARCH_SNIPPET_CONTEXT = 80
METADATA_FIELDS = (
    "ticker",
    "cik",
    "company_name",
    "form",
    "filing_date",
    "accession_number",
    "primary_document",
    "archive_url",
)
HTML_EXTENSIONS = {".htm", ".html", ".xhtml"}
XML_EXTENSIONS = {".xml", ".xsd", ".xsl"}
TEXT_EXTENSIONS = {".txt", ".text", ".sgml", ".idx", ".json"}
CONTROL_WHITESPACE = {"\n", "\r", "\t", "\f"}


class FilingInspectError(Exception):
    """Raised for clear filing-inspector failures."""


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--limit-chars must be an integer.") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("--limit-chars must be zero or greater.")
    return parsed


def parse_nonempty_search(value: str) -> str:
    search = value.strip()
    if not search:
        raise argparse.ArgumentTypeError("--search must not be blank.")
    return search


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect one local downloaded SEC filing cache document. "
            "No network calls, no candidate creation, and no production graph writes."
        )
    )
    parser.add_argument(
        "--file",
        required=True,
        help=(
            "Path to a local filing cache document, for example "
            "data/cache/sec/filings/0000320193/000032019323000106/aapl-20230930.htm."
        ),
    )
    parser.add_argument(
        "--metadata",
        help=(
            "Optional metadata sidecar path. If omitted, a sibling metadata.json "
            "is read when present."
        ),
    )
    parser.add_argument(
        "--limit-chars",
        type=parse_nonnegative_int,
        default=DEFAULT_LIMIT_CHARS,
        help=f"Maximum preview characters to print. Default: {DEFAULT_LIMIT_CHARS}.",
    )
    parser.add_argument(
        "--search",
        type=parse_nonempty_search,
        help="Optional case-insensitive text search with match count and snippets.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable JSON summary to stdout only.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print metadata and safety summary without content preview.",
    )
    return parser.parse_args(argv)


def resolve_input_file(raw_path: str, label: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = Path.cwd() / path
    resolved = path.resolve(strict=False)

    if not resolved.exists():
        raise FilingInspectError(f"{label} not found: {resolved}")
    if resolved.is_dir():
        raise FilingInspectError(f"{label} path is a directory: {resolved}")
    if not resolved.is_file():
        raise FilingInspectError(f"{label} path is not a regular file: {resolved}")
    return resolved


def cache_location_for(path: Path) -> dict[str, Any]:
    resolved_root = EXPECTED_FILINGS_ROOT.resolve(strict=False)
    inside_expected_root = is_relative_to(path, resolved_root)
    return {
        "expected_cache_root": str(resolved_root),
        "inside_expected_cache_root": inside_expected_root,
        "cache_location": "expected" if inside_expected_root else "nonstandard",
    }


def read_document(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise FilingInspectError(f"could not read filing cache document {path}: {exc}") from exc


def decode_document(body: bytes) -> tuple[str, list[str], dict[str, Any]]:
    warnings: list[str] = []
    sample = body[:8192]
    sample_length = len(sample)
    null_byte_count = sample.count(b"\x00")
    control_byte_count = sum(
        1
        for byte in sample
        if byte < 32 and byte not in {9, 10, 12, 13}
    )
    control_ratio = control_byte_count / sample_length if sample_length else 0.0
    binary_like = null_byte_count > 0 or control_ratio > 0.05

    if binary_like:
        warnings.append(
            "content looks binary or unreadable; preview is decoded with replacement "
            "and control characters are sanitized"
        )

    try:
        text = body.decode("utf-8")
        replacement_count = 0
    except UnicodeDecodeError:
        text = body.decode("utf-8", errors="replace")
        replacement_count = text.count("\ufffd")
        warnings.append(
            "content is not clean UTF-8; undecodable bytes were replaced for preview"
        )

    decode_info = {
        "encoding": "utf-8",
        "replacement_characters": replacement_count,
        "sample_null_bytes": null_byte_count,
        "sample_control_bytes": control_byte_count,
        "sample_control_ratio": round(control_ratio, 4),
        "binary_like": binary_like,
    }
    return text, warnings, decode_info


def sanitize_text(text: str) -> str:
    return "".join(
        char
        if (char in CONTROL_WHITESPACE or ord(char) >= 32)
        else " "
        for char in text
    )


def detect_content_type(path: Path, text: str, decode_info: dict[str, Any]) -> tuple[str, list[str]]:
    evidence: list[str] = []
    suffix = path.suffix.lower()
    sniff = text[:4096].lstrip().lower()

    if decode_info["binary_like"]:
        evidence.append("binary-like byte sample")
        return "binary_or_unreadable", evidence

    if suffix in HTML_EXTENSIONS:
        evidence.append(f"filename extension {suffix}")
        return "html", evidence
    if "<!doctype html" in sniff or "<html" in sniff or "<body" in sniff:
        evidence.append("HTML marker in content")
        return "html", evidence

    if suffix in XML_EXTENSIONS:
        evidence.append(f"filename extension {suffix}")
        return "xml-ish", evidence
    if (
        sniff.startswith("<?xml")
        or "<xbrl" in sniff
        or "<xsd:" in sniff
        or "<sec-document" in sniff
        or "<sec-header" in sniff
    ):
        evidence.append("XML/SGML-ish marker in content")
        return "xml-ish", evidence

    if suffix in TEXT_EXTENSIONS:
        evidence.append(f"filename extension {suffix}")
    else:
        evidence.append("text fallback after content sniffing")
    return "text", evidence


def scalar_to_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, (bool, int, float)):
        return str(value)
    return None


def load_metadata_payload(
    metadata_path: Path,
    *,
    explicit: bool,
) -> tuple[dict[str, Any] | None, list[str]]:
    warnings: list[str] = []
    try:
        with metadata_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except json.JSONDecodeError as exc:
        message = (
            f"invalid JSON in metadata sidecar {metadata_path}: {exc.msg} "
            f"at line {exc.lineno} column {exc.colno}"
        )
        if explicit:
            raise FilingInspectError(message) from exc
        warnings.append(message)
        return None, warnings
    except OSError as exc:
        message = f"could not read metadata sidecar {metadata_path}: {exc}"
        if explicit:
            raise FilingInspectError(message) from exc
        warnings.append(message)
        return None, warnings

    if not isinstance(payload, dict):
        message = f"metadata sidecar top-level value is not an object: {metadata_path}"
        if explicit:
            raise FilingInspectError(message)
        warnings.append(message)
        return None, warnings
    return payload, warnings


def discover_metadata_path(
    filing_path: Path,
    raw_metadata: str | None,
) -> tuple[Path | None, bool, list[str]]:
    warnings: list[str] = []
    if raw_metadata:
        return resolve_input_file(raw_metadata, "metadata sidecar"), True, warnings

    candidate = filing_path.parent / "metadata.json"
    if not candidate.exists():
        return None, False, warnings
    if candidate.is_dir():
        warnings.append(f"sibling metadata.json is a directory and was ignored: {candidate}")
        return None, False, warnings
    if not candidate.is_file():
        warnings.append(f"sibling metadata.json is not a regular file and was ignored: {candidate}")
        return None, False, warnings
    return candidate.resolve(strict=False), False, warnings


def extract_metadata_fields(payload: dict[str, Any] | None) -> dict[str, str | None]:
    fields = {field: None for field in METADATA_FIELDS}
    if payload is None:
        return fields

    filing = payload.get("filing")
    filing_payload = filing if isinstance(filing, dict) else {}
    for field in METADATA_FIELDS:
        fields[field] = scalar_to_string(filing_payload.get(field))
        if fields[field] is None:
            fields[field] = scalar_to_string(payload.get(field))
    return fields


def build_metadata_summary(
    filing_path: Path,
    raw_metadata: str | None,
) -> dict[str, Any]:
    metadata_path, explicit, warnings = discover_metadata_path(filing_path, raw_metadata)
    payload: dict[str, Any] | None = None
    if metadata_path is not None:
        payload, load_warnings = load_metadata_payload(metadata_path, explicit=explicit)
        warnings.extend(load_warnings)

    return {
        "path": str(metadata_path) if metadata_path else None,
        "present": metadata_path is not None and payload is not None,
        "auto_discovered": metadata_path is not None and not explicit,
        "fields": extract_metadata_fields(payload),
        "warnings": warnings,
    }


def build_preview(
    sanitized_text: str,
    *,
    limit_chars: int,
    summary_only: bool,
) -> dict[str, Any]:
    if summary_only:
        return {
            "omitted": True,
            "reason": "summary-only",
            "limit_chars": limit_chars,
            "text": None,
            "truncated": False,
        }
    if limit_chars == 0:
        return {
            "omitted": True,
            "reason": "limit-chars=0",
            "limit_chars": limit_chars,
            "text": None,
            "truncated": False,
        }
    preview_text = sanitized_text[:limit_chars]
    return {
        "omitted": False,
        "reason": None,
        "limit_chars": limit_chars,
        "text": preview_text,
        "truncated": len(sanitized_text) > len(preview_text),
    }


def one_line_snippet(text: str) -> str:
    return " ".join(text.split())


def find_search_matches(
    sanitized_text: str,
    search: str | None,
) -> dict[str, Any] | None:
    if search is None:
        return None

    haystack = sanitized_text.casefold()
    needle = search.casefold()
    matches: list[int] = []
    start = 0
    while True:
        index = haystack.find(needle, start)
        if index == -1:
            break
        matches.append(index)
        start = index + max(len(needle), 1)

    snippets: list[dict[str, Any]] = []
    for index in matches[:SEARCH_SNIPPET_LIMIT]:
        snippet_start = max(0, index - SEARCH_SNIPPET_CONTEXT)
        snippet_end = min(len(sanitized_text), index + len(search) + SEARCH_SNIPPET_CONTEXT)
        snippets.append(
            {
                "offset": index,
                "snippet": one_line_snippet(sanitized_text[snippet_start:snippet_end]),
            }
        )

    return {
        "query": search,
        "case_sensitive": False,
        "match_count": len(matches),
        "snippets": snippets,
    }


def build_summary(
    *,
    filing_path: Path,
    raw_metadata: str | None,
    limit_chars: int,
    search: str | None,
    summary_only: bool,
) -> dict[str, Any]:
    body = read_document(filing_path)
    text, content_warnings, decode_info = decode_document(body)
    sanitized_text = sanitize_text(text)
    content_type, content_type_evidence = detect_content_type(
        filing_path,
        sanitized_text,
        decode_info,
    )

    try:
        file_size = filing_path.stat().st_size
    except OSError as exc:
        raise FilingInspectError(f"could not stat filing cache document {filing_path}: {exc}") from exc

    location = cache_location_for(filing_path)
    return {
        "file": str(filing_path),
        "file_size_bytes": file_size,
        **location,
        "content_type": content_type,
        "content_type_evidence": content_type_evidence,
        "decode": decode_info,
        "warnings": content_warnings,
        "metadata_sidecar": build_metadata_summary(filing_path, raw_metadata),
        "preview": build_preview(
            sanitized_text,
            limit_chars=limit_chars,
            summary_only=summary_only,
        ),
        "search": find_search_matches(sanitized_text, search),
        "summary_only": summary_only,
        "safety": {
            "network_calls": 0,
            "output_files_created": 0,
            "candidate_records_created": 0,
            "candidate_writes": 0,
            "production_writes": 0,
            "production_graph_writes": 0,
        },
    }


def display_value(value: Any) -> str:
    if value is None:
        return "missing"
    return str(value)


def print_metadata(summary: dict[str, Any]) -> None:
    metadata = summary["metadata_sidecar"]
    print("Metadata sidecar")
    print("----------------")
    if not metadata["path"]:
        print("- none found")
    else:
        print(f"Path: {metadata['path']}")
        print(f"Mode: {'auto-discovered' if metadata['auto_discovered'] else 'explicit'}")
        print(f"Status: {'read' if metadata['present'] else 'not read'}")
        for field in METADATA_FIELDS:
            print(f"- {field}: {display_value(metadata['fields'].get(field))}")
    if metadata["warnings"]:
        print("Warnings:")
        for warning in metadata["warnings"]:
            print(f"- {warning}")


def print_search(summary: dict[str, Any]) -> None:
    search = summary.get("search")
    if search is None:
        return

    print()
    print("Search")
    print("------")
    print(f"Query: {search['query']}")
    print(f"Case sensitive: {str(search['case_sensitive']).lower()}")
    print(f"Match count: {search['match_count']}")
    if search["snippets"]:
        print("Snippets:")
        for snippet in search["snippets"]:
            print(f"- offset {snippet['offset']}: {snippet['snippet']}")
    else:
        print("Snippets: none")


def print_preview(summary: dict[str, Any]) -> None:
    preview = summary["preview"]
    print()
    print("Content preview")
    print("---------------")
    if preview["omitted"]:
        print(f"- omitted by --{preview['reason']}")
        return
    print(f"Limit chars: {preview['limit_chars']}")
    print(f"Truncated: {str(preview['truncated']).lower()}")
    print()
    print(preview["text"])


def print_human(summary: dict[str, Any]) -> None:
    print("SEC filing cache inspector")
    print("==========================")
    print(f"File: {summary['file']}")
    print(f"File size: {summary['file_size_bytes']} bytes")
    print(f"Expected cache root: {summary['expected_cache_root']}")
    print(f"Cache location: {summary['cache_location']}")
    if summary["cache_location"] == "nonstandard":
        print("Cache note: nonstandard path outside data/cache/sec/filings/")
    print(f"Detected content type: {summary['content_type']}")
    print(f"Content type evidence: {', '.join(summary['content_type_evidence'])}")
    if summary["warnings"]:
        print("Warnings:")
        for warning in summary["warnings"]:
            print(f"- {warning}")

    print()
    print_metadata(summary)
    print_search(summary)
    print_preview(summary)

    print()
    print("Safety")
    print("------")
    safety = summary["safety"]
    print(f"- network calls: {safety['network_calls']}")
    print(f"- output files created: {safety['output_files_created']}")
    print(f"- candidate records created: {safety['candidate_records_created']}")
    print(f"- candidate writes: {safety['candidate_writes']}")
    print(f"- production writes: {safety['production_writes']}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        filing_path = resolve_input_file(args.file, "filing cache document")
        summary = build_summary(
            filing_path=filing_path,
            raw_metadata=args.metadata,
            limit_chars=args.limit_chars,
            search=args.search,
            summary_only=args.summary_only,
        )
    except FilingInspectError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(summary, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
