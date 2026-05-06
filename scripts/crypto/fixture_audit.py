#!/usr/bin/env python3
"""Audit generated CryptoPhotonic fixtures for secrets and unsafe fields."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SUSPICIOUS_STRINGS = [
    "api-key",
    "HELIUS_API_KEY",
    "Authorization",
    "Bearer",
    "https://api.helius.xyz",
    "secret",
    "private_key",
    "privateKey",
    "signing",
    "x-api-key",
]

RAW_HEADER_KEYS = {
    "headers",
    "request_headers",
    "requestheaders",
    "authorization",
    "x-api-key",
    "x_api_key",
}

PROVIDER_URL_PATTERN = re.compile(r"https?://api\.helius\.xyz\b|api-key=", re.IGNORECASE)


def main() -> int:
    args = parse_args()
    target = Path(args.path).expanduser()
    files = collect_files(target)
    if not files:
        print(f"FAIL: no readable files found at {target}")
        return 1

    warnings: list[str] = []
    failures: list[str] = []

    for file_path in files:
        audit_file(file_path, warnings, failures)

    if failures:
        print("FAIL: generated fixture audit found unsafe content")
        for item in failures:
            print(f"FAIL: {item}")
    elif warnings:
        status = "FAIL" if args.fail_on_warning else "WARN"
        print(f"{status}: generated fixture audit found warnings")
        for item in warnings:
            print(f"WARN: {item}")
    else:
        print(f"PASS: audited {len(files)} generated fixture file(s); no secrets or unsafe fields found")

    if failures or (warnings and args.fail_on_warning):
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan generated CryptoPhotonic fixtures for accidental secrets.")
    parser.add_argument("--path", required=True, help="Generated fixture file or directory to audit.")
    parser.add_argument("--fail-on-warning", action="store_true", help="Return a failing exit code when warnings are present.")
    return parser.parse_args()


def collect_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(path for path in target.rglob("*.json") if path.is_file())
    return []


def audit_file(file_path: Path, warnings: list[str], failures: list[str]) -> None:
    try:
        text = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        failures.append(f"{file_path}: file is not valid UTF-8 text")
        return
    except OSError as error:
        failures.append(f"{file_path}: could not read file: {error}")
        return

    scan_suspicious_text(file_path, text, warnings, failures)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        failures.append(f"{file_path}: invalid JSON at line {error.lineno}, column {error.colno}")
        return

    if not isinstance(payload, dict):
        failures.append(f"{file_path}: top-level JSON must be an object")
        return

    audit_metadata(file_path, payload, warnings, failures)
    audit_json_tree(file_path, payload, warnings, failures)


def scan_suspicious_text(file_path: Path, text: str, warnings: list[str], failures: list[str]) -> None:
    lower_text = text.lower()
    for needle in SUSPICIOUS_STRINGS:
        if needle.lower() in lower_text:
            message = f"{file_path}: suspicious string found: {needle}"
            if needle.lower() == "https://api.helius.xyz":
                failures.append(message)
            else:
                warnings.append(message)


def audit_metadata(file_path: Path, payload: dict[str, Any], warnings: list[str], failures: list[str]) -> None:
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        failures.append(f"{file_path}: metadata object is missing")
        return

    if metadata.get("sanitized") is not True:
        failures.append(f"{file_path}: metadata.sanitized must be true")
    if metadata.get("production_meaning") is not False:
        failures.append(f"{file_path}: metadata.production_meaning must be false")
    if metadata.get("live_blockchain_fetching") is not False:
        failures.append(f"{file_path}: metadata.live_blockchain_fetching must be false")


def audit_json_tree(file_path: Path, value: Any, warnings: list[str], failures: list[str], path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            key_lower = key_text.lower().replace("-", "_")
            child_path = f"{path}.{key_text}"
            if key_lower in RAW_HEADER_KEYS:
                failures.append(f"{file_path}: raw request/header field is not allowed at {child_path}")
            if "provider" in key_lower and "url" in key_lower:
                failures.append(f"{file_path}: provider URL field is not allowed at {child_path}")
            audit_json_tree(file_path, child, warnings, failures, child_path)
        return

    if isinstance(value, list):
        for index, child in enumerate(value):
            audit_json_tree(file_path, child, warnings, failures, f"{path}[{index}]")
        return

    if isinstance(value, str) and PROVIDER_URL_PATTERN.search(value):
        failures.append(f"{file_path}: provider private URL or API-key query found at {path}")


if __name__ == "__main__":
    raise SystemExit(main())
