#!/usr/bin/env python3
"""Local/server-side wallet-history provider adapters for CryptoPhotonic.

Adapters in this module are intentionally not browser code. They read no
credentials themselves; callers pass provider keys from environment variables
only after enforcing an explicit network opt-in such as --allow-network.
Returned data is sanitized cache/review material and never includes request
headers, bearer tokens, API keys, private URLs, or raw provider payloads.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 30
SUPPORTED_PROVIDERS = ("helius",)


@dataclass(frozen=True)
class ProviderPage:
    provider: str
    chain: str
    wallet: str
    current_cursor: str | None
    next_cursor: str | None
    cursor_type: str
    requested_limit: int
    returned_count: int
    more_available: bool
    cursor_exhausted: bool
    pagination_supported: bool
    deterministic_pagination_support: bool
    provider_request_sent: bool
    normalized_transactions: list[dict[str, Any]]
    provider_status: str
    provider_error: str | None = None

    def cache_metadata(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "chain": self.chain,
            "wallet": self.wallet,
            "provider_request_sent": self.provider_request_sent,
            "provider_status": self.provider_status,
            "cursor": self.current_cursor,
            "current_cursor": self.current_cursor,
            "next_cursor": self.next_cursor,
            "cursor_type": self.cursor_type,
            "cursor_field": "before",
            "pagination_supported": self.pagination_supported,
            "deterministic_pagination_support": self.deterministic_pagination_support,
            "requested_limit": self.requested_limit,
            "returned_count": self.returned_count,
            "more_available": self.more_available,
            "cursor_exhausted": self.cursor_exhausted,
            "full_history_loaded": self.cursor_exhausted and not self.more_available and self.returned_count > 0,
            "raw_payload_stored": False,
            "provider_keys_included": False,
            "browser_provider_calls": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
            "provider_error": self.provider_error,
        }


class ProviderAdapterError(RuntimeError):
    """Raised when a provider adapter cannot produce a sanitized history page."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def coerce_limit(value: Any, *, default: int = 25, maximum: int = 100) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))


def clean_string(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return ""


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_unix_timestamp(value: Any) -> str:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return ""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def infer_event_type(transaction: dict[str, Any]) -> str:
    raw_type = clean_string(transaction.get("type")).lower().replace("-", "_").replace(" ", "_")
    if transaction.get("tokenTransfers") or transaction.get("nativeTransfers"):
        if raw_type in {"swap", "token_swap"}:
            return "swap_like_flow"
        return "direct_transfer"
    if raw_type in {"swap", "token_swap"}:
        return "swap_like_flow"
    return "unknown_unsupported_event"


def transfer_rows(transaction: dict[str, Any]) -> list[tuple[dict[str, Any], str]]:
    rows: list[tuple[dict[str, Any], str]] = []
    for transfer in as_list(transaction.get("tokenTransfers")):
        if isinstance(transfer, dict):
            rows.append((transfer, "token"))
    for transfer in as_list(transaction.get("nativeTransfers")):
        if isinstance(transfer, dict):
            rows.append((transfer, "native"))
    return rows or [({}, "unknown")]


def sanitize_helius_transfer(transaction: dict[str, Any], transfer: dict[str, Any], transfer_kind: str, index: int, leg_index: int, wallet: str) -> dict[str, Any]:
    source_wallet = clean_string(first_present(transfer.get("fromUserAccount"), transfer.get("fromUser"), transfer.get("from")))
    destination_wallet = clean_string(first_present(transfer.get("toUserAccount"), transfer.get("toUser"), transfer.get("to")))
    token_mint = clean_string(first_present(transfer.get("mint"), "native:sol" if transfer_kind == "native" else ""))
    amount = first_present(transfer.get("tokenAmount"), transfer.get("amount"))
    event_type = infer_event_type(transaction)
    limitations = ["provider_payload_sanitized"]
    if event_type == "unknown_unsupported_event":
        limitations.append("unsupported provider transaction type")
    if event_type == "swap_like_flow":
        limitations.append("provider swap label requires visible leg review")
    if not source_wallet:
        limitations.append("source wallet unavailable")
    if not destination_wallet:
        limitations.append("destination wallet unavailable")
    if not token_mint:
        limitations.append("token mint unavailable")
    if amount in (None, ""):
        limitations.append("amount unavailable")
    confidence = 0.58 if event_type == "unknown_unsupported_event" else 0.72
    missing_count = sum(1 for value in (source_wallet, destination_wallet, token_mint, clean_string(amount)) if not value)
    if missing_count:
        confidence = min(confidence, max(0.24, 0.76 - (missing_count * 0.11)))
    return {
        "signature": clean_string(transaction.get("signature")),
        "signature_group_id": None,
        "signature_group_index": None,
        "signature_group_size": None,
        "transfer_leg_index": leg_index,
        "transfer_leg_count": None,
        "slot": transaction.get("slot"),
        "timestamp": parse_unix_timestamp(transaction.get("timestamp")),
        "source_wallet": source_wallet,
        "destination_wallet": destination_wallet,
        "token_mint": token_mint,
        "amount": clean_string(amount),
        "transfer_direction": "outbound" if wallet and source_wallet == wallet else "inbound" if wallet and destination_wallet == wallet else "unknown",
        "outer_instruction_index": None,
        "inner_instruction_index": None,
        "program_id": clean_string(first_present(transfer.get("programId"), transaction.get("source"))),
        "event_type": event_type,
        "multi_leg_signature": False,
        "swap_leg_group": None,
        "balance_delta_summary": {},
        "parser_confidence": confidence,
        "parser_confidence_reason": "provider-normalized transfer leg; review signature grouping",
        "parser_limitations": limitations,
        "raw_reference": {
            "provider": "helius",
            "provider_record_type": clean_string(transaction.get("type")),
            "provider_transfer_kind": transfer_kind,
            "raw_payload_stored": False,
            "record_index": index,
            "transfer_leg_index": leg_index,
            "request_url_stored": False,
            "request_headers_stored": False,
            "provider_key_stored": False,
        },
    }


def sanitize_helius_transaction(transaction: dict[str, Any], index: int, wallet: str) -> list[dict[str, Any]]:
    return [
        sanitize_helius_transfer(transaction, transfer, transfer_kind, index, leg_index, wallet)
        for leg_index, (transfer, transfer_kind) in enumerate(transfer_rows(transaction), start=1)
    ]


class HeliusProviderAdapter:
    name = "helius"
    chain = "solana"
    cursor_type = "before_signature"
    pagination_supported = True
    deterministic_pagination_support = False
    base_url = "https://api.helius.xyz/v0/addresses/{wallet}/transactions"

    def fetch_wallet_history(
        self,
        *,
        wallet: str,
        api_key: str,
        limit: int,
        cursor: str | None = None,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> ProviderPage:
        wallet = clean_string(wallet)
        api_key = clean_string(api_key)
        if not wallet:
            raise ProviderAdapterError("wallet is required for provider fetch")
        if not api_key:
            raise ProviderAdapterError("provider API key is required")

        bounded_limit = coerce_limit(limit)
        query: dict[str, str] = {"api-key": api_key, "limit": str(bounded_limit)}
        current_cursor = clean_string(cursor) or None
        if current_cursor:
            query["before"] = current_cursor
        encoded_wallet = urllib.parse.quote(wallet, safe="")
        request_url = f"{self.base_url.format(wallet=encoded_wallet)}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(
            request_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "CryptoPhotonic-local-cache-builder/1.0",
            },
            method="GET",
        )

        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                decoded = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise ProviderAdapterError(f"provider_http_error_{error.code}") from error
        except urllib.error.URLError as error:
            raise ProviderAdapterError("provider_network_error") from error

        try:
            parsed = json.loads(decoded)
        except json.JSONDecodeError as error:
            raise ProviderAdapterError("provider_invalid_json") from error
        if not isinstance(parsed, list):
            raise ProviderAdapterError("provider_unexpected_response_shape")

        transactions = [item for item in parsed if isinstance(item, dict)]
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(transactions):
            normalized.extend(sanitize_helius_transaction(item, index, wallet))
        next_cursor = clean_string(transactions[-1].get("signature")) if len(transactions) >= bounded_limit and transactions else None
        more_available = bool(next_cursor and len(transactions) >= bounded_limit)
        return ProviderPage(
            provider=self.name,
            chain=self.chain,
            wallet=wallet,
            current_cursor=current_cursor,
            next_cursor=next_cursor,
            cursor_type=self.cursor_type,
            requested_limit=bounded_limit,
            returned_count=len(normalized),
            more_available=more_available,
            cursor_exhausted=not more_available,
            pagination_supported=self.pagination_supported,
            deterministic_pagination_support=self.deterministic_pagination_support,
            provider_request_sent=True,
            normalized_transactions=normalized,
            provider_status="ok",
        )


def get_provider_adapter(provider: str) -> HeliusProviderAdapter:
    normalized = clean_string(provider).lower()
    if normalized == "helius":
        return HeliusProviderAdapter()
    raise ProviderAdapterError(f"unsupported provider: {provider}")


def fetch_wallet_history_page(
    *,
    provider: str,
    wallet: str,
    api_key: str,
    limit: int,
    cursor: str | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> ProviderPage:
    adapter = get_provider_adapter(provider)
    return adapter.fetch_wallet_history(
        wallet=wallet,
        api_key=api_key,
        limit=limit,
        cursor=cursor,
        timeout_seconds=timeout_seconds,
    )
