#!/usr/bin/env python3
"""Local-only CryptoPhotonic wallet-history cache fetcher.

This script is intentionally conservative:
- dry-run is the default
- provider/network mode requires --allow-network
- provider keys are read only from an environment variable
- default writes stay under data/crypto/
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from crypto_provider_adapters import ProviderAdapterError, fetch_wallet_history_page


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = REPO_ROOT / "data" / "crypto"
DEFAULT_OUTPUT = DEFAULT_DATA_DIR / "wallet_history_cache.sample.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare a local CryptoPhotonic wallet-history cache request. Defaults to dry-run and sends no provider requests.",
    )
    parser.add_argument("--wallet", default="", help="Public wallet address to fetch or describe.")
    parser.add_argument("--provider", default="helius", choices=["helius"], help="Provider adapter name for local fetches.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum transactions to request.")
    parser.add_argument("--cursor", default="", help="Optional provider pagination cursor. Helius uses a before-signature cursor.")
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


def empty_cache_metadata(args: argparse.Namespace, network_ready: bool) -> dict[str, Any]:
    return {
        "provider": args.provider,
        "chain": "solana",
        "wallet": args.wallet,
        "provider_request_sent": False,
        "provider_status": "network_not_allowed" if not args.allow_network else "ready_not_requested",
        "cursor": args.cursor or None,
        "current_cursor": args.cursor or None,
        "next_cursor": None,
        "cursor_type": "before_signature",
        "cursor_field": "before",
        "pagination_supported": True,
        "deterministic_pagination_support": False,
        "requested_limit": args.limit,
        "returned_count": 0,
        "more_available": False,
        "cursor_exhausted": False,
        "full_history_loaded": False,
        "raw_payload_stored": False,
        "provider_keys_included": False,
        "browser_provider_calls": False,
        "provider_request_url_included": False,
        "provider_headers_included": False,
        "network_ready": network_ready,
    }


def build_cache_payload(args: argparse.Namespace, network_ready: bool, provider_page: Any | None = None) -> dict[str, Any]:
    cache_metadata = provider_page.cache_metadata() if provider_page else empty_cache_metadata(args, network_ready)
    normalized_transactions = provider_page.normalized_transactions if provider_page else []
    return {
        "metadata": {
            "name": "CryptoPhotonic local wallet history cache",
            "version": "d309_wallet_history_cache_v1",
            "sample": not bool(provider_page),
            "production_meaning": False,
            "live_blockchain_fetching": bool(provider_page),
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "provider": args.provider,
            "wallet": args.wallet,
            "generated_at": utc_now(),
            "dry_run": not args.write,
            "network_allowed": bool(args.allow_network),
            "provider_request_sent": bool(provider_page),
            "network_ready": network_ready,
        },
        "normalized_cache_metadata": cache_metadata,
        "cache": {
            "cache_schema": "d309_wallet_history_cache_v1",
            "cache_state": "provider_page" if provider_page else "dry_run" if not args.write else "local_empty_cache",
            "source": "local_cli_provider_adapter" if provider_page else "local_cli_dry_run",
            "normalized_event_count": len(normalized_transactions),
            "cursor": cache_metadata.get("cursor"),
            "current_cursor": cache_metadata.get("current_cursor"),
            "next_cursor": cache_metadata.get("next_cursor"),
            "cursor_type": cache_metadata.get("cursor_type"),
            "cursor_field": cache_metadata.get("cursor_field"),
            "pagination_supported": cache_metadata.get("pagination_supported"),
            "deterministic_pagination_support": cache_metadata.get("deterministic_pagination_support"),
            "requested_limit": cache_metadata.get("requested_limit"),
            "returned_count": cache_metadata.get("returned_count"),
            "more_available": cache_metadata.get("more_available"),
            "cursor_exhausted": cache_metadata.get("cursor_exhausted"),
            "full_history_loaded": cache_metadata.get("full_history_loaded"),
            "limitations": [
                "provider payload is sanitized before cache output",
                "use --allow-network only from a local/server-side environment",
                "full wallet history is not proven unless pagination is exhausted without gaps",
            ],
        },
        "normalized_transactions": normalized_transactions,
    }


def main() -> int:
    args = parse_args()
    args.limit = max(1, min(int(args.limit or 25), 100))
    args.timeout_seconds = max(1, min(int(args.timeout_seconds or 30), 120))
    output_path = resolve_output(args.output)
    explicit_output = "--output" in os.sys.argv
    boundary = output_boundary_message(output_path, explicit_output)

    api_key_present = False
    provider_page = None
    if args.allow_network:
        api_key = os.environ.get(args.api_key_env, "")
        api_key_present = bool(api_key)
        if not api_key_present:
            raise SystemExit(f"--allow-network requires {args.api_key_env} in the local environment.")
        if not args.wallet:
            raise SystemExit("--allow-network requires --wallet so provider scope is explicit.")
        try:
            provider_page = fetch_wallet_history_page(
                provider=args.provider,
                wallet=args.wallet,
                api_key=api_key,
                limit=args.limit,
                cursor=args.cursor or None,
                timeout_seconds=args.timeout_seconds,
            )
        except ProviderAdapterError as error:
            raise SystemExit(f"Provider request failed: {error}") from error
    network_ready = bool(args.allow_network and api_key_present and args.wallet)
    payload = build_cache_payload(args, network_ready, provider_page)

    if args.write:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print("CryptoPhotonic wallet-history cache fetch")
    print(f"- Wallet: {args.wallet or '(none supplied)'}")
    print(f"- Provider: {args.provider}")
    print(f"- Network allowed: {args.allow_network}")
    print(f"- Provider key env checked: {args.api_key_env if args.allow_network else '(not checked; dry network mode)'}")
    print(f"- Provider request sent: {str(bool(provider_page)).lower()}")
    print(f"- Rows returned: {len(provider_page.normalized_transactions) if provider_page else 0}")
    print(f"- Next cursor: {'present' if provider_page and provider_page.next_cursor else 'none'}")
    print(f"- Write mode: {'write' if args.write else 'dry-run'}")
    print(f"- Output: {output_path}")
    print(f"- Output boundary: {boundary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
