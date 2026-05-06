#!/usr/bin/env python3
"""Local-only Helius Enhanced Transactions runner for CryptoPhotonic.

The Helius API key is read only from HELIUS_API_KEY and is only attached to the
provider request URL at runtime. Generated fixtures, cache files, and terminal
messages never include the key, request headers, or private provider URLs.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_GENERATED_DIR = REPO_ROOT / "data" / "crypto" / "generated"
DEFAULT_CACHE_DIR = REPO_ROOT / "data" / "crypto" / "cache"
DEFAULT_LIMIT = 25
MAX_LIMIT = 100
DEFAULT_MIN_REQUEST_INTERVAL_MS = 1200
MAX_RATE_LIMIT_RETRIES = 3
HELIUS_ADDRESS_TRANSACTIONS_BASE = "https://api.helius.xyz/v0/addresses"


class RunnerError(Exception):
    """Expected local runner failure with a user-facing message."""


def main() -> int:
    args = parse_args()
    wallet = normalize_wallet(args.wallet)
    limit = clamp_limit(args.limit)
    output_path = resolve_output_path(args.output, wallet)
    ensure_path_under(output_path, DEFAULT_GENERATED_DIR, "Generated fixture output")
    cache_dir = resolve_repo_path(args.cache_dir) if args.cache_dir else DEFAULT_CACHE_DIR
    cache_path = cache_dir / f"solana-wallet-flow.{safe_filename(wallet)}.cache.json"
    manifest_path = DEFAULT_GENERATED_DIR / "manifest.json"

    if args.dry_run:
        print("Dry run only. No Helius request, cache write, or fixture write was performed.")
        print(f"Wallet: {wallet}")
        print(f"Limit: {limit}")
        print(f"Output fixture: {repo_relative(output_path)}")
        print(f"Cache state: {repo_relative(cache_path)}")
        print(f"Manifest: {repo_relative(manifest_path)}")
        print("HELIUS_API_KEY would be read from the local environment at request time.")
        return 0

    api_key = os.environ.get("HELIUS_API_KEY")
    if not api_key:
        raise RunnerError("HELIUS_API_KEY is not set. Set it locally before running the fetch command.")

    cache = load_json_object(cache_path)
    existing_fixture = load_json_object(output_path)
    existing_transactions = collect_existing_transactions(existing_fixture, cache)
    existing_signatures = {tx["signature"] for tx in existing_transactions if tx.get("signature")}

    enforce_min_request_interval(cache, args.min_request_interval_ms)
    fetched = fetch_helius_transactions(
        wallet=wallet,
        limit=limit,
        api_key=api_key,
        max_retries=MAX_RATE_LIMIT_RETRIES,
    )
    fetched_transactions = sanitize_transactions(fetched)

    if args.force_refresh:
        merged_transactions = dedupe_transactions([*fetched_transactions, *existing_transactions])
        new_count = count_signatures(fetched_transactions)
    else:
        new_transactions = [
            tx for tx in fetched_transactions
            if tx.get("signature") and tx["signature"] not in existing_signatures
        ]
        merged_transactions = dedupe_transactions([*existing_transactions, *new_transactions])
        new_count = count_signatures(new_transactions)

    generated_at = now_iso()
    fixture = build_fixture(wallet, generated_at, merged_transactions)

    DEFAULT_GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, fixture)

    cache_dir.mkdir(parents=True, exist_ok=True)
    write_json(cache_path, build_cache_state(wallet, generated_at, merged_transactions, cache))
    update_manifest(manifest_path, output_path, wallet, generated_at, len(merged_transactions))

    print(f"Fetched {len(fetched_transactions)} sanitized transaction(s); added {new_count} new signature(s).")
    print(f"Wrote generated fixture: {repo_relative(output_path)}")
    print(f"Updated generated manifest: {repo_relative(manifest_path)}")
    print("No API key, request header, or private provider URL was written to disk.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch one Solana wallet's recent Helius Enhanced Transactions into a sanitized CryptoPhotonic fixture."
    )
    parser.add_argument("--wallet", required=True, help="Public Solana wallet address to fetch.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"Transaction limit, 1-{MAX_LIMIT}. Default: {DEFAULT_LIMIT}.")
    parser.add_argument("--output", help="Optional generated fixture output path.")
    parser.add_argument("--cache-dir", help="Optional local cache directory. Defaults to data/crypto/cache.")
    parser.add_argument(
        "--min-request-interval-ms",
        type=int,
        default=DEFAULT_MIN_REQUEST_INTERVAL_MS,
        help=f"Minimum time between provider requests for this cache. Default: {DEFAULT_MIN_REQUEST_INTERVAL_MS}.",
    )
    parser.add_argument("--force-refresh", action="store_true", help="Refresh fetched signatures even if seen before.")
    parser.add_argument("--dry-run", action="store_true", help="Validate options and print paths without making a provider request.")
    return parser.parse_args()


def normalize_wallet(value: str) -> str:
    wallet = str(value or "").strip()
    if not wallet:
        raise RunnerError("--wallet is required.")
    if not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", wallet):
        raise RunnerError("Wallet must look like a public Solana base58 address.")
    return wallet


def clamp_limit(value: int) -> int:
    if value < 1:
        raise RunnerError("--limit must be at least 1.")
    if value > MAX_LIMIT:
        print(f"Requested limit {value} exceeds the local safety cap; using {MAX_LIMIT}.")
        return MAX_LIMIT
    return value


def resolve_output_path(output: str | None, wallet: str) -> Path:
    if output:
        return resolve_repo_path(output)
    return DEFAULT_GENERATED_DIR / f"solana-wallet-flow.{safe_filename(wallet)}.json"


def resolve_repo_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path.resolve()


def ensure_path_under(path: Path, parent: Path, label: str) -> None:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError as error:
        raise RunnerError(f"{label} must be under {repo_relative(parent)}.") from error


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)[:96]


def repo_relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2, sort_keys=False)
        handle.write("\n")


def collect_existing_transactions(fixture: dict[str, Any], cache: dict[str, Any]) -> list[dict[str, Any]]:
    transactions: list[dict[str, Any]] = []
    if isinstance(fixture.get("solana_transactions"), list):
        transactions.extend(tx for tx in fixture["solana_transactions"] if isinstance(tx, dict))
    if isinstance(cache.get("transactions"), list):
        transactions.extend(tx for tx in cache["transactions"] if isinstance(tx, dict))
    return dedupe_transactions(transactions)


def enforce_min_request_interval(cache: dict[str, Any], min_interval_ms: int) -> None:
    if min_interval_ms <= 0:
        return
    last_request_at = cache.get("last_request_at_epoch_ms")
    if not isinstance(last_request_at, (int, float)):
        return
    elapsed_ms = int(time.time() * 1000) - int(last_request_at)
    remaining_ms = min_interval_ms - elapsed_ms
    if remaining_ms > 0:
        print(f"Waiting {remaining_ms}ms to respect the local request interval.")
        time.sleep(remaining_ms / 1000)


def fetch_helius_transactions(wallet: str, limit: int, api_key: str, max_retries: int) -> list[Any]:
    params = urlencode({"api-key": api_key, "limit": str(limit)})
    url = f"{HELIUS_ADDRESS_TRANSACTIONS_BASE}/{wallet}/transactions?{params}"
    attempt = 0

    while True:
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "StockPhotonic-CryptoPhotonic-LocalRunner/1.0",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=30) as response:
                status = getattr(response, "status", 200)
                body = response.read()
            if status < 200 or status >= 300:
                raise RunnerError(f"Helius request failed with HTTP {status}.")
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, list):
                raise RunnerError("Helius returned an unexpected response shape.")
            return payload
        except HTTPError as error:
            if error.code == 429 and attempt < max_retries:
                wait_seconds = retry_wait_seconds(error, attempt)
                print(f"Helius rate-limited the request (HTTP 429). Retrying in {wait_seconds:.1f}s.")
                time.sleep(wait_seconds)
                attempt += 1
                continue
            if error.code == 429:
                raise RunnerError("Helius rate-limited the request (HTTP 429). Try again later or increase --min-request-interval-ms.")
            raise RunnerError(f"Helius request failed with HTTP {error.code}.")
        except URLError as error:
            reason = redact_sensitive(error.reason, api_key)
            raise RunnerError(f"Helius request failed before a response was received: {reason}.")
        except json.JSONDecodeError as error:
            raise RunnerError(f"Helius returned invalid JSON: {error.msg}.")


def redact_sensitive(value: Any, api_key: str = "") -> str:
    text = str(value)
    if api_key:
        text = text.replace(api_key, "[REDACTED_API_KEY]")
    text = re.sub(r"https://api\.helius\.xyz/\S+", "[REDACTED_PROVIDER_URL]", text, flags=re.IGNORECASE)
    text = re.sub(r"api-key=[^&\s]+", "api-key=[REDACTED]", text, flags=re.IGNORECASE)
    return text


def retry_wait_seconds(error: HTTPError, attempt: int) -> float:
    retry_after = error.headers.get("Retry-After") if error.headers else None
    if retry_after:
        try:
            return max(1.0, min(float(retry_after), 60.0))
        except ValueError:
            pass
    return min(60.0, (2 ** attempt) + random.uniform(0.25, 1.25))


def sanitize_transactions(transactions: list[Any]) -> list[dict[str, Any]]:
    sanitized = [sanitize_transaction(tx) for tx in transactions if isinstance(tx, dict)]
    return dedupe_transactions(tx for tx in sanitized if tx.get("signature"))


def sanitize_transaction(tx: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {
        "signature": string_value(tx.get("signature") or tx.get("transactionSignature")),
        "type": string_value(tx.get("type")),
        "source": string_value(tx.get("source")),
        "timestamp": normalize_timestamp(tx.get("timestamp") or tx.get("blockTime")),
    }

    native_transfers = sanitize_transfer_list(tx.get("nativeTransfers"), native=True)
    token_transfers = sanitize_transfer_list(tx.get("tokenTransfers"), native=False)
    if native_transfers:
        sanitized["nativeTransfers"] = native_transfers
    if token_transfers:
        sanitized["tokenTransfers"] = token_transfers

    events = tx.get("events")
    swap_event = sanitize_swap_event(events.get("swap") if isinstance(events, dict) else None)
    if swap_event:
        sanitized["events"] = {"swap": swap_event}

    fee = number_or_none(tx.get("fee"))
    if fee is not None:
        sanitized["fee"] = fee
    fee_payer = string_value(tx.get("feePayer"))
    if fee_payer:
        sanitized["feePayer"] = fee_payer

    return {key: value for key, value in sanitized.items() if value not in ("", None, [], {})}


def sanitize_transfer_list(value: Any, native: bool) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    sanitized = [sanitize_transfer(item, native=native) for item in value if isinstance(item, dict)]
    return dedupe_transfer_records(sanitized)


def sanitize_transfer(transfer: dict[str, Any], native: bool) -> dict[str, Any]:
    allowed: dict[str, Any] = {
        "fromUserAccount": string_value(transfer.get("fromUserAccount") or transfer.get("fromOwner")),
        "toUserAccount": string_value(transfer.get("toUserAccount") or transfer.get("toOwner")),
        "fromTokenAccount": string_value(transfer.get("fromTokenAccount")),
        "toTokenAccount": string_value(transfer.get("toTokenAccount")),
        "mint": string_value(transfer.get("mint")),
        "symbol": string_value(transfer.get("symbol") or transfer.get("tokenSymbol")),
        "tokenAmount": number_or_none(transfer.get("tokenAmount")),
        "decimals": number_or_none(transfer.get("decimals")),
        "amount": number_or_none(transfer.get("amount")),
    }
    if native and allowed["amount"] is None:
        allowed["amount"] = number_or_none(transfer.get("lamports"))
    raw_token_amount = transfer.get("rawTokenAmount")
    safe_raw_token_amount: dict[str, Any] = {}
    if isinstance(raw_token_amount, dict):
        decimals = number_or_none(raw_token_amount.get("decimals"))
        token_amount = number_or_none(raw_token_amount.get("tokenAmount"))
        if allowed["decimals"] is None:
            allowed["decimals"] = decimals
        if token_amount is not None:
            safe_raw_token_amount["tokenAmount"] = token_amount
        if decimals is not None:
            safe_raw_token_amount["decimals"] = decimals
    sanitized = {key: value for key, value in allowed.items() if value not in ("", None)}
    if safe_raw_token_amount:
        sanitized["rawTokenAmount"] = safe_raw_token_amount
    return sanitized


def sanitize_swap_event(swap: Any) -> dict[str, Any]:
    if not isinstance(swap, dict):
        return {}
    safe: dict[str, Any] = {}
    for key in ("nativeInput", "nativeOutput"):
        value = swap.get(key)
        if isinstance(value, dict):
            sanitized = sanitize_transfer(value, native=True)
            if sanitized:
                safe[key] = sanitized
    for key in ("tokenInputs", "tokenOutputs"):
        value = swap.get(key)
        if isinstance(value, list):
            sanitized = [sanitize_transfer(item, native=False) for item in value if isinstance(item, dict)]
            sanitized = dedupe_transfer_records(sanitized)
            if sanitized:
                safe[key] = sanitized
    return safe


def dedupe_transactions(transactions: Any) -> list[dict[str, Any]]:
    by_signature: dict[str, dict[str, Any]] = {}
    for tx in transactions:
        if not isinstance(tx, dict):
            continue
        signature = string_value(tx.get("signature"))
        if not signature or signature in by_signature:
            continue
        deduped = dict(tx)
        if isinstance(deduped.get("nativeTransfers"), list):
            deduped["nativeTransfers"] = dedupe_transfer_records(deduped["nativeTransfers"])
        if isinstance(deduped.get("tokenTransfers"), list):
            deduped["tokenTransfers"] = dedupe_transfer_records(deduped["tokenTransfers"])
        by_signature[signature] = deduped
    return list(by_signature.values())


def dedupe_transfer_records(transfers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for index, transfer in enumerate(transfers):
        key = json.dumps(transfer, sort_keys=True, separators=(",", ":")) or str(index)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(transfer)
    return deduped


def normalize_timestamp(value: Any) -> str | None:
    if value in ("", None):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return string_value(value)


def string_value(value: Any) -> str:
    if value in (None, ""):
        return ""
    return str(value).strip()


def number_or_none(value: Any) -> int | float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


def count_signatures(transactions: list[dict[str, Any]]) -> int:
    return len({tx.get("signature") for tx in transactions if tx.get("signature")})


def build_fixture(wallet: str, generated_at: str, transactions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "metadata": {
            "name": "Solana wallet flow",
            "environment": "local_secure_runner_generated",
            "chain": "solana",
            "adapter": "solana",
            "source": "helius_enhanced_transactions_sanitized",
            "wallet": wallet,
            "generated_at": generated_at,
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "sanitized": True,
        },
        "solana_transactions": transactions,
    }


def build_cache_state(
    wallet: str,
    generated_at: str,
    transactions: list[dict[str, Any]],
    existing_cache: dict[str, Any],
) -> dict[str, Any]:
    return {
        "metadata": {
            "environment": "local_secure_runner_cache",
            "wallet": wallet,
            "sanitized": True,
            "production_meaning": False,
            "live_blockchain_fetching": False,
            "local_only": True,
            "contains_raw_provider_payload": False,
            "contains_api_key": False,
            "contains_provider_url": False,
            "updated_at": generated_at,
        },
        "wallet": wallet,
        "seen_signatures": [tx["signature"] for tx in transactions if tx.get("signature")],
        "transactions": transactions,
        "last_request_at_epoch_ms": int(time.time() * 1000),
        "request_count": int(existing_cache.get("request_count") or 0) + 1,
    }


def update_manifest(manifest_path: Path, fixture_path: Path, wallet: str, generated_at: str, transaction_count: int) -> None:
    existing = load_json_object(manifest_path)
    fixture_ref = repo_relative(fixture_path)
    fixtures = existing.get("fixtures") if isinstance(existing.get("fixtures"), list) else []
    fixture_entry = {
        "path": fixture_ref,
        "wallet": wallet,
        "generated_at": generated_at,
        "transaction_count": transaction_count,
        "source": "helius_enhanced_transactions_sanitized",
        "sanitized": True,
    }

    next_fixtures = [item for item in fixtures if not (isinstance(item, dict) and item.get("path") == fixture_ref)]
    next_fixtures.insert(0, fixture_entry)
    manifest = {
        "metadata": {
            "environment": "local_secure_runner_manifest",
            "sanitized": True,
            "production_meaning": False,
            "live_blockchain_fetching": False,
        },
        "active_fixture": fixture_ref,
        "fixtures": next_fixtures,
    }
    write_json(manifest_path, manifest)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RunnerError as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
