#!/usr/bin/env python3
"""Local-only CryptoPhotonic wallet-history cache fetcher.

This script is intentionally conservative:
- dry-run is the default
- provider/network mode requires --allow-network
- writes require --write
- provider keys are read only from an environment variable
- default writes stay under data/crypto/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from crypto_provider_adapters import (
    DEFAULT_BACKOFF_CAP_SECONDS,
    DEFAULT_MAX_RETRIES,
    ProviderAdapterError,
    ProviderFetchResult,
    fetch_wallet_history_pages,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "crypto"
DEFAULT_OUTPUT = DEFAULT_DATA_DIR / "wallet_history_cache.sample.json"
CACHE_VERSION = "d349_provider_cache_v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a local CryptoPhotonic wallet-history cache request. Defaults to dry-run and sends no provider requests.",
    )
    parser.add_argument("--wallet", default="", help="Public Solana wallet address to fetch or describe.")
    parser.add_argument("--provider", default="helius", choices=["helius"], help="Provider adapter name for local fetches.")
    parser.add_argument("--limit", type=int, default=None, help="Deprecated alias for --limit-per-page.")
    parser.add_argument("--limit-per-page", type=int, default=25, help="Maximum provider transactions to request per page.")
    parser.add_argument("--max-pages", type=int, default=1, help="Maximum cursor pages to request in one run.")
    parser.add_argument("--request-limit", type=int, default=None, help="Optional stricter cap on provider page requests.")
    parser.add_argument("--cursor", default="", help="Deprecated alias for --resume-cursor.")
    parser.add_argument("--resume-cursor", default="", help="Optional provider pagination cursor. Helius uses a before-signature cursor.")
    parser.add_argument("--cooldown-seconds", type=float, default=0.0, help="Cooldown between provider pages when --allow-network is set.")
    parser.add_argument("--max-retries", type=int, default=DEFAULT_MAX_RETRIES, help="Maximum retry attempts for transient provider/network failures.")
    parser.add_argument("--backoff-cap-seconds", type=float, default=DEFAULT_BACKOFF_CAP_SECONDS, help="Maximum exponential backoff delay.")
    parser.add_argument("--stop-on-rate-limit", action="store_true", help="Stop the run immediately when rate-limit metadata is returned.")
    parser.add_argument("--cache-id", default="", help="Optional stable cache id to include in sanitized metadata.")
    parser.add_argument("--allow-network", action="store_true", help="Allow local/server-side provider network access. Without this flag, no provider request is attempted.")
    parser.add_argument("--api-key-env", default="HELIUS_API_KEY", help="Environment variable that contains the provider API key.")
    parser.add_argument("--timeout-seconds", type=int, default=30, help="Provider request timeout when --allow-network is set.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path. Default is under data/crypto/.")
    parser.add_argument("--write", action="store_true", help="Write the sanitized cache output. Without this flag the command is dry-run only.")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_output(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    else:
        path = path.resolve()
    return path


def output_boundary_message(path: Path, explicit_output: bool) -> str:
    try:
        path.relative_to(DEFAULT_DATA_DIR.resolve())
        return "default data/crypto boundary"
    except ValueError:
        if explicit_output:
            return "explicit output path supplied"
        raise SystemExit("Refusing to write outside data/crypto/ without an explicit --output path.")


def clean_text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def bounded_int(value: Any, *, default: int, minimum: int = 1, maximum: int = 100) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def bounded_seconds(value: Any, *, default: float, maximum: float = 120.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, min(parsed, maximum))


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def stable_cache_id(provider: str, wallet: str, requested_at: str, explicit_cache_id: str = "") -> str:
    cleaned = clean_text(explicit_cache_id)
    if cleaned:
        return cleaned
    seed = json.dumps(
        {
            "provider": provider,
            "wallet": wallet,
            "requested_at": requested_at,
        },
        sort_keys=True,
    )
    short_wallet = clean_text(wallet)[:8] or "no-wallet"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
    return f"provider-cache-{provider}-{short_wallet}-{digest}"


def empty_cache_metadata(args: argparse.Namespace, requested_at: str, cache_id: str, network_ready: bool) -> dict[str, Any]:
    resume_cursor = clean_text(args.resume_cursor or args.cursor) or None
    requested_limit = bounded_int(args.limit if args.limit is not None else args.limit_per_page, default=25, maximum=100)
    max_pages = bounded_int(args.max_pages, default=1, maximum=50)
    return {
        "wallet": clean_text(args.wallet),
        "provider": args.provider,
        "provider_label": "Helius Enhanced Transactions" if args.provider == "helius" else args.provider,
        "chain": "solana",
        "fetched_at": requested_at,
        "cache_id": cache_id,
        "cache_version": CACHE_VERSION,
        "cache_schema": CACHE_VERSION,
        "cache_state": "dry_run" if not args.allow_network else "ready_not_requested",
        "cache_origin": "local_dry_run",
        "cache_class": "dry_run",
        "cache_artifact_class": "dry_run",
        "provider_cache": False,
        "provider_cache_derived": False,
        "provider_fetched": False,
        "provider_request_sent": False,
        "provider_status": "network_not_allowed" if not args.allow_network else "ready_not_requested",
        "pages_loaded": 0,
        "pages_requested": max_pages,
        "request_limit": args.request_limit or max_pages,
        "requested_limit": requested_limit,
        "returned_count": 0,
        "raw_transaction_count": 0,
        "started_cursor": resume_cursor,
        "cursor": resume_cursor,
        "current_cursor": resume_cursor,
        "next_cursor": None,
        "cursor_type": "before_signature",
        "cursor_field": "before",
        "pagination_supported": True,
        "deterministic_pagination_support": False,
        "cursor_exhausted": False,
        "more_available": False,
        "rate_limited": False,
        "retry_after_seconds": None,
        "cooldown_applied_seconds": 0,
        "backoff_applied_seconds": 0,
        "provider_limited": False,
        "provider_limit_reached": False,
        "limited_by_provider": False,
        "provider_unavailable": False,
        "full_history_loaded": False,
        "full_history_claim_allowed": False,
        "stop_reason": "network_not_allowed" if not args.allow_network else "ready_not_requested",
        "network_ready": network_ready,
        "browser_provider_calls": False,
        "provider_keys_included": False,
        "raw_provider_payloads_included": False,
        "raw_payload_stored": False,
        "provider_request_url_included": False,
        "provider_headers_included": False,
        "page_summaries": [],
    }


def amount_is_missing(row: dict[str, Any]) -> bool:
    amount = clean_text(row.get("amount")).lower()
    limitations = [str(item).lower() for item in as_list(row.get("parser_limitations"))]
    return amount in {"", "none", "null", "nan"} or any("amount unavailable" in item or "missing amount" in item for item in limitations)


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    event_type_counts: dict[str, int] = {}
    signatures = {row.get("signature_group_id") or row.get("signature") for row in rows if row.get("signature_group_id") or row.get("signature")}
    for row in rows:
        event_type = clean_text(row.get("event_type")) or "unknown_unsupported_event"
        event_type_counts[event_type] = event_type_counts.get(event_type, 0) + 1
    return {
        "rows_read": len(rows),
        "signature_group_count": len(signatures),
        "direct_transfer_count": event_type_counts.get("direct_transfer", 0),
        "multi_leg_transfer_count": event_type_counts.get("multi_leg_transfer", 0),
        "swap_like_flow_count": event_type_counts.get("swap_like_flow", 0),
        "parser_limited_count": sum(1 for row in rows if row.get("event_type") == "parser_limited_event" or any("parser-limited" in str(item).lower() for item in as_list(row.get("parser_limitations")))),
        "parser_limitation_row_count": sum(1 for row in rows if row.get("parser_limitations")),
        "unknown_unsupported_count": event_type_counts.get("unknown_unsupported_event", 0),
        "missing_amount_count": sum(1 for row in rows if amount_is_missing(row)),
        "missing_source_count": sum(1 for row in rows if not row.get("source_wallet")),
        "missing_destination_count": sum(1 for row in rows if not row.get("destination_wallet")),
        "missing_mint_count": sum(1 for row in rows if not row.get("token_mint")),
        "event_type_counts": event_type_counts,
    }


def build_cache_payload(
    args: argparse.Namespace,
    *,
    requested_at: str,
    cache_id: str,
    network_ready: bool,
    provider_result: ProviderFetchResult | None = None,
) -> dict[str, Any]:
    cache_metadata = (
        provider_result.cache_metadata(cache_id=cache_id, fetched_at=requested_at, cache_version=CACHE_VERSION)
        if provider_result
        else empty_cache_metadata(args, requested_at, cache_id, network_ready)
    )
    normalized_transactions = provider_result.normalized_transactions if provider_result else []
    parser_quality_summary = summarize_rows(normalized_transactions)
    provider_fetched = bool(provider_result and provider_result.pages_returned)
    return {
        "metadata": {
            "name": "CryptoPhotonic local wallet history cache",
            "version": CACHE_VERSION,
            "sample": not provider_fetched,
            "fixture": False,
            "production_meaning": False,
            "live_blockchain_fetching": provider_fetched,
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "raw_provider_payloads_included": False,
            "provider": args.provider,
            "provider_label": cache_metadata.get("provider_label"),
            "wallet": clean_text(args.wallet),
            "generated_at": requested_at,
            "fetched_at": requested_at,
            "cache_id": cache_id,
            "cache_version": CACHE_VERSION,
            "dry_run": not args.write,
            "write_enabled": bool(args.write),
            "network_allowed": bool(args.allow_network),
            "provider_request_sent": provider_fetched,
            "network_ready": network_ready,
            "provider_cache": provider_fetched,
            "provider_cache_derived": provider_fetched,
            "provider_fetched": provider_fetched,
            "cache_origin": "provider_fetched" if provider_fetched else "local_dry_run",
            "cache_class": "provider_cache" if provider_fetched else "dry_run",
            "cache_artifact_class": "provider_cache" if provider_fetched else "dry_run",
            "sanitized": True,
        },
        "normalized_cache_metadata": cache_metadata,
        "parser_quality_summary": parser_quality_summary,
        "cache": {
            "cache_id": cache_id,
            "cache_schema": CACHE_VERSION,
            "cache_version": CACHE_VERSION,
            "cache_state": cache_metadata.get("cache_state", "provider_fetched" if provider_fetched else "dry_run"),
            "cache_origin": cache_metadata.get("cache_origin", "provider_fetched" if provider_fetched else "local_dry_run"),
            "cache_class": cache_metadata.get("cache_class", "provider_cache" if provider_fetched else "dry_run"),
            "cache_artifact_class": cache_metadata.get("cache_artifact_class", "provider_cache" if provider_fetched else "dry_run"),
            "source": "local_cli_provider_adapter" if provider_fetched else "local_cli_dry_run",
            "provider_cache": provider_fetched,
            "provider_cache_derived": provider_fetched,
            "provider_fetched": provider_fetched,
            "normalized_event_count": len(normalized_transactions),
            "signature_group_count": parser_quality_summary.get("signature_group_count", 0),
            "parser_limited_count": parser_quality_summary.get("parser_limited_count", 0),
            "parser_limitation_row_count": parser_quality_summary.get("parser_limitation_row_count", 0),
            "event_type_counts": parser_quality_summary.get("event_type_counts", {}),
            "missing_field_counts": {
                "amount": parser_quality_summary.get("missing_amount_count", 0),
                "source_wallet": parser_quality_summary.get("missing_source_count", 0),
                "destination_wallet": parser_quality_summary.get("missing_destination_count", 0),
                "token_mint": parser_quality_summary.get("missing_mint_count", 0),
            },
            "wallet": cache_metadata.get("wallet"),
            "provider": cache_metadata.get("provider"),
            "provider_label": cache_metadata.get("provider_label"),
            "fetched_at": requested_at,
            "pages_loaded": cache_metadata.get("pages_loaded", 0),
            "pages_requested": cache_metadata.get("pages_requested", args.max_pages),
            "request_limit": cache_metadata.get("request_limit", args.request_limit or args.max_pages),
            "requested_limit": cache_metadata.get("requested_limit"),
            "returned_count": cache_metadata.get("returned_count"),
            "cursor": cache_metadata.get("cursor"),
            "current_cursor": cache_metadata.get("current_cursor"),
            "next_cursor": cache_metadata.get("next_cursor"),
            "cursor_type": cache_metadata.get("cursor_type"),
            "cursor_field": cache_metadata.get("cursor_field"),
            "pagination_supported": cache_metadata.get("pagination_supported"),
            "deterministic_pagination_support": cache_metadata.get("deterministic_pagination_support"),
            "more_available": cache_metadata.get("more_available"),
            "cursor_exhausted": cache_metadata.get("cursor_exhausted"),
            "rate_limited": cache_metadata.get("rate_limited"),
            "retry_after_seconds": cache_metadata.get("retry_after_seconds"),
            "cooldown_applied_seconds": cache_metadata.get("cooldown_applied_seconds"),
            "provider_limited": cache_metadata.get("provider_limited"),
            "provider_limit_reached": cache_metadata.get("provider_limit_reached", cache_metadata.get("provider_limited")),
            "limited_by_provider": cache_metadata.get("limited_by_provider", cache_metadata.get("provider_limited")),
            "provider_unavailable": cache_metadata.get("provider_unavailable"),
            "backoff_applied_seconds": cache_metadata.get("backoff_applied_seconds"),
            "full_history_loaded": cache_metadata.get("full_history_loaded"),
            "full_history_claim_allowed": cache_metadata.get("full_history_claim_allowed"),
            "stop_reason": cache_metadata.get("stop_reason"),
            "limitations": [
                "provider payload is sanitized before cache output",
                "use --allow-network only from a local/server-side environment",
                "full wallet history is not claimed unless cursor exhaustion occurs without rate or provider limits",
            ],
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "raw_provider_payloads_included": False,
            "raw_payload_stored": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
        },
        "normalized_transactions": normalized_transactions,
    }


def print_summary(args: argparse.Namespace, output_path: Path, boundary: str, payload: dict[str, Any]) -> None:
    metadata = payload.get("normalized_cache_metadata", {})
    summary = payload.get("parser_quality_summary", {})
    print("CryptoPhotonic wallet-history cache fetch")
    print(f"- Wallet: {args.wallet or '(none supplied)'}")
    print(f"- Provider: {args.provider}")
    print(f"- Network mode: {'allowed' if args.allow_network else 'disabled'}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    print(f"- Dry-run: {not args.write}")
    print(f"- Provider key env checked: {args.api_key_env if args.allow_network else '(not checked; network disabled)'}")
    print(f"- Provider request sent: {str(bool(metadata.get('provider_request_sent') or payload.get('metadata', {}).get('provider_request_sent'))).lower()}")
    print(f"- Pages requested: {metadata.get('pages_requested', 0)}")
    print(f"- Pages returned: {metadata.get('pages_loaded', 0)}")
    print(f"- Events/transactions returned: {summary.get('rows_read', 0)} / {metadata.get('raw_transaction_count', 0)}")
    print(f"- Cursor next: {'present' if metadata.get('next_cursor') else 'none'}")
    print(f"- Cursor exhausted: {str(bool(metadata.get('cursor_exhausted'))).lower()}")
    print(f"- Rate limited: {str(bool(metadata.get('rate_limited'))).lower()}")
    print(f"- Retry after seconds: {metadata.get('retry_after_seconds') if metadata.get('retry_after_seconds') is not None else '-'}")
    print(f"- Cooldown/backoff seconds: {metadata.get('cooldown_applied_seconds', 0)} / {metadata.get('backoff_applied_seconds', 0)}")
    print(f"- Provider limited: {str(bool(metadata.get('provider_limited'))).lower()}")
    print(f"- Full history loaded: {str(bool(metadata.get('full_history_loaded'))).lower()}")
    print(f"- Full-history claim allowed: {str(bool(metadata.get('full_history_claim_allowed'))).lower()}")
    print(f"- Stop reason: {metadata.get('stop_reason') or '-'}")
    print(f"- Direct transfers: {summary.get('direct_transfer_count', 0)}")
    print(f"- Multi-leg transfers: {summary.get('multi_leg_transfer_count', 0)}")
    print(f"- Swap-like flows: {summary.get('swap_like_flow_count', 0)}")
    print(f"- Parser-limited rows: {summary.get('parser_limited_count', 0)}")
    print(f"- Parser limitation rows: {summary.get('parser_limitation_row_count', 0)}")
    print(f"- Unknown/unsupported rows: {summary.get('unknown_unsupported_count', 0)}")
    print(f"- Missing amount/source/destination/mint: {summary.get('missing_amount_count', 0)}/{summary.get('missing_source_count', 0)}/{summary.get('missing_destination_count', 0)}/{summary.get('missing_mint_count', 0)}")
    print(f"- Output path: {output_path}")
    print(f"- Output boundary: {boundary}")


def main() -> int:
    args = parse_args()
    if args.limit is not None:
        args.limit_per_page = args.limit
    if args.cursor and not args.resume_cursor:
        args.resume_cursor = args.cursor
    args.limit_per_page = bounded_int(args.limit_per_page, default=25, maximum=100)
    args.max_pages = bounded_int(args.max_pages, default=1, maximum=50)
    if args.request_limit is not None:
        args.request_limit = bounded_int(args.request_limit, default=args.max_pages, maximum=50)
    args.timeout_seconds = bounded_int(args.timeout_seconds, default=30, maximum=120)
    args.cooldown_seconds = bounded_seconds(args.cooldown_seconds, default=0.0, maximum=120.0)
    args.max_retries = bounded_int(args.max_retries, default=DEFAULT_MAX_RETRIES, minimum=0, maximum=8)
    args.backoff_cap_seconds = bounded_seconds(args.backoff_cap_seconds, default=DEFAULT_BACKOFF_CAP_SECONDS, maximum=120.0)

    output_path = resolve_output(args.output)
    explicit_output = "--output" in os.sys.argv
    boundary = output_boundary_message(output_path, explicit_output)
    requested_at = utc_now()
    cache_id = stable_cache_id(args.provider, args.wallet, requested_at, args.cache_id)

    api_key_present = False
    provider_result: ProviderFetchResult | None = None
    if args.allow_network:
        api_key = os.environ.get(args.api_key_env, "")
        api_key_present = bool(api_key)
        if not api_key_present:
            raise SystemExit(f"--allow-network requires {args.api_key_env} in the local environment.")
        if not clean_text(args.wallet):
            raise SystemExit("--allow-network requires --wallet so provider scope is explicit.")
        try:
            provider_result = fetch_wallet_history_pages(
                provider=args.provider,
                wallet=args.wallet,
                api_key=api_key,
                limit_per_page=args.limit_per_page,
                max_pages=args.max_pages,
                request_limit=args.request_limit,
                resume_cursor=args.resume_cursor or None,
                timeout_seconds=args.timeout_seconds,
                cooldown_seconds=args.cooldown_seconds,
                max_retries=args.max_retries,
                backoff_cap_seconds=args.backoff_cap_seconds,
                stop_on_rate_limit=args.stop_on_rate_limit,
            )
        except ProviderAdapterError as error:
            raise SystemExit(f"Provider request failed: {error}") from error

    network_ready = bool(args.allow_network and api_key_present and args.wallet)
    payload = build_cache_payload(
        args,
        requested_at=requested_at,
        cache_id=cache_id,
        network_ready=network_ready,
        provider_result=provider_result,
    )

    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print_summary(args, output_path, boundary, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
