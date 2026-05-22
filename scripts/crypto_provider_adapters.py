#!/usr/bin/env python3
"""Local/server-side wallet-history provider adapters for CryptoPhotonic.

Adapters in this module are intentionally not browser code. They read no
credentials themselves; callers pass provider keys from environment variables
only after enforcing an explicit network opt-in such as --allow-network.
Returned data is sanitized cache/review material and never includes request
headers, bearer tokens, API keys, private URLs, raw request URLs, or raw
provider payloads.
"""

from __future__ import annotations

import email.utils
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_BACKOFF_SECONDS = 1.0
DEFAULT_BACKOFF_CAP_SECONDS = 30.0
DEFAULT_MAX_RETRIES = 2
DEFAULT_MAX_PAGES = 1
DEFAULT_PROVIDER_LABELS = {
    "helius": "Helius Enhanced Transactions",
}
SUPPORTED_PROVIDERS = ("helius",)


@dataclass(frozen=True)
class ProviderPage:
    provider: str
    chain: str
    wallet: str
    page_number: int
    current_cursor: str | None
    next_cursor: str | None
    cursor_type: str
    requested_limit: int
    returned_count: int
    raw_transaction_count: int
    more_available: bool
    cursor_exhausted: bool
    pagination_supported: bool
    deterministic_pagination_support: bool
    provider_request_sent: bool
    normalized_transactions: list[dict[str, Any]]
    provider_status: str
    provider_error: str | None = None
    http_status: int | None = None
    rate_limited: bool = False
    retry_after_seconds: float | None = None
    cooldown_applied_seconds: float = 0.0
    backoff_applied_seconds: float = 0.0
    provider_limited: bool = False
    provider_unavailable: bool = False
    request_attempts: int = 0
    max_retries: int = DEFAULT_MAX_RETRIES
    stop_reason: str = ""
    page_summary: dict[str, Any] = field(default_factory=dict)

    def cache_metadata(self) -> dict[str, Any]:
        full_history_loaded = (
            self.cursor_exhausted
            and not self.more_available
            and not self.rate_limited
            and not self.provider_limited
            and not self.provider_unavailable
            and self.provider_status == "ok"
        )
        return {
            "provider": self.provider,
            "provider_label": DEFAULT_PROVIDER_LABELS.get(self.provider, self.provider),
            "chain": self.chain,
            "wallet": self.wallet,
            "provider_request_sent": self.provider_request_sent,
            "provider_status": self.provider_status,
            "page_number": self.page_number,
            "cursor": self.current_cursor,
            "current_cursor": self.current_cursor,
            "next_cursor": self.next_cursor,
            "cursor_type": self.cursor_type,
            "cursor_field": "before",
            "pagination_supported": self.pagination_supported,
            "deterministic_pagination_support": self.deterministic_pagination_support,
            "requested_limit": self.requested_limit,
            "returned_count": self.returned_count,
            "raw_transaction_count": self.raw_transaction_count,
            "more_available": self.more_available,
            "cursor_exhausted": self.cursor_exhausted,
            "rate_limited": self.rate_limited,
            "retry_after_seconds": self.retry_after_seconds,
            "cooldown_applied_seconds": self.cooldown_applied_seconds,
            "backoff_applied_seconds": self.backoff_applied_seconds,
            "provider_limited": self.provider_limited,
            "provider_limit_reached": self.provider_limited,
            "limited_by_provider": self.provider_limited,
            "provider_unavailable": self.provider_unavailable,
            "full_history_loaded": full_history_loaded,
            "full_history_claim_allowed": full_history_loaded,
            "request_attempts": self.request_attempts,
            "max_retries": self.max_retries,
            "stop_reason": self.stop_reason,
            "raw_payload_stored": False,
            "raw_provider_payloads_included": False,
            "provider_keys_included": False,
            "browser_provider_calls": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
            "provider_error": self.provider_error,
            "http_status": self.http_status,
            "page_summary": sanitize_page_summary(self.page_summary or {}),
        }


@dataclass(frozen=True)
class ProviderFetchResult:
    provider: str
    chain: str
    wallet: str
    pages_requested: int
    request_limit: int
    pages: list[ProviderPage]
    requested_limit: int
    started_cursor: str | None
    next_cursor: str | None
    stop_reason: str

    @property
    def normalized_transactions(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for page in self.pages:
            rows.extend(page.normalized_transactions)
        return rows

    @property
    def pages_returned(self) -> int:
        return len(self.pages)

    @property
    def returned_count(self) -> int:
        return len(self.normalized_transactions)

    @property
    def raw_transaction_count(self) -> int:
        return sum(page.raw_transaction_count for page in self.pages)

    @property
    def rate_limited(self) -> bool:
        return any(page.rate_limited for page in self.pages)

    @property
    def retry_after_seconds(self) -> float | None:
        values = [
            page.retry_after_seconds
            for page in self.pages
            if isinstance(page.retry_after_seconds, (int, float))
        ]
        return max(values) if values else None

    @property
    def cooldown_applied_seconds(self) -> float:
        return round(sum(max(0.0, page.cooldown_applied_seconds) for page in self.pages), 3)

    @property
    def backoff_applied_seconds(self) -> float:
        return round(sum(max(0.0, page.backoff_applied_seconds) for page in self.pages), 3)

    @property
    def provider_limited(self) -> bool:
        return any(page.provider_limited for page in self.pages)

    @property
    def provider_unavailable(self) -> bool:
        return any(page.provider_unavailable for page in self.pages)

    @property
    def more_available(self) -> bool:
        return bool(self.next_cursor and not self.rate_limited and not self.provider_limited and not self.provider_unavailable)

    @property
    def cursor_exhausted(self) -> bool:
        if not self.pages:
            return False
        if self.rate_limited or self.provider_limited or self.provider_unavailable:
            return False
        return not self.next_cursor and self.pages[-1].cursor_exhausted

    @property
    def full_history_loaded(self) -> bool:
        return self.cursor_exhausted and not self.more_available and not self.rate_limited and not self.provider_limited and not self.provider_unavailable

    @property
    def full_history_claim_allowed(self) -> bool:
        return self.full_history_loaded

    def sanitized_page_summaries(self) -> list[dict[str, Any]]:
        return [sanitize_page_summary(page.page_summary) for page in self.pages]

    def cache_metadata(
        self,
        *,
        cache_id: str,
        fetched_at: str,
        cache_version: str = "d349_provider_cache_v1",
    ) -> dict[str, Any]:
        return {
            "wallet": self.wallet,
            "provider": self.provider,
            "provider_label": DEFAULT_PROVIDER_LABELS.get(self.provider, self.provider),
            "chain": self.chain,
            "fetched_at": fetched_at,
            "cache_id": cache_id,
            "cache_version": cache_version,
            "cache_schema": cache_version,
            "cache_state": "provider_fetched",
            "cache_origin": "provider_fetched",
            "cache_class": "provider_cache",
            "cache_artifact_class": "provider_cache",
            "provider_cache": True,
            "provider_cache_derived": True,
            "provider_fetched": True,
            "pages_loaded": self.pages_returned,
            "pages_requested": self.pages_requested,
            "request_limit": self.request_limit,
            "requested_limit": self.requested_limit,
            "returned_count": self.returned_count,
            "raw_transaction_count": self.raw_transaction_count,
            "started_cursor": self.started_cursor,
            "cursor": self.started_cursor,
            "current_cursor": self.pages[-1].current_cursor if self.pages else self.started_cursor,
            "next_cursor": self.next_cursor,
            "cursor_type": self.pages[-1].cursor_type if self.pages else "before_signature",
            "cursor_field": "before",
            "pagination_supported": True,
            "deterministic_pagination_support": False,
            "cursor_exhausted": self.cursor_exhausted,
            "more_available": self.more_available,
            "rate_limited": self.rate_limited,
            "retry_after_seconds": self.retry_after_seconds,
            "cooldown_applied_seconds": self.cooldown_applied_seconds,
            "backoff_applied_seconds": self.backoff_applied_seconds,
            "provider_limited": self.provider_limited,
            "provider_limit_reached": self.provider_limited,
            "limited_by_provider": self.provider_limited,
            "provider_unavailable": self.provider_unavailable,
            "full_history_loaded": self.full_history_loaded,
            "full_history_claim_allowed": self.full_history_claim_allowed,
            "stop_reason": self.stop_reason,
            "page_summaries": self.sanitized_page_summaries(),
            "browser_provider_calls": False,
            "provider_keys_included": False,
            "raw_provider_payloads_included": False,
            "raw_payload_stored": False,
            "provider_request_url_included": False,
            "provider_headers_included": False,
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


def coerce_page_limit(value: Any, *, default: int = DEFAULT_MAX_PAGES, maximum: int = 50) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))


def coerce_seconds(value: Any, *, default: float = 0.0, maximum: float = 120.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, min(parsed, maximum))


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


def parse_retry_after(value: Any) -> float | None:
    text = clean_string(value)
    if not text:
        return None
    try:
        seconds = float(text)
        return max(0.0, seconds)
    except ValueError:
        pass
    try:
        retry_at = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


def retry_after_from_headers(headers: Any) -> float | None:
    if not headers:
        return None
    getter = getattr(headers, "get", None)
    if not getter:
        return None
    return parse_retry_after(getter("Retry-After") or getter("retry-after"))


def safe_sleep(seconds: float) -> float:
    bounded = coerce_seconds(seconds, maximum=120.0)
    if bounded > 0:
        time.sleep(bounded)
    return bounded


def sanitize_page_summary(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": clean_string(summary.get("provider")),
        "page_number": int(summary.get("page_number") or 0),
        "requested_limit": int(summary.get("requested_limit") or 0),
        "raw_transaction_count": int(summary.get("raw_transaction_count") or 0),
        "normalized_event_count": int(summary.get("normalized_event_count") or 0),
        "cursor_present": bool(summary.get("cursor_present")),
        "current_cursor_present": bool(summary.get("current_cursor_present", summary.get("cursor_present"))),
        "next_cursor_present": bool(summary.get("next_cursor_present")),
        "cursor_type": clean_string(summary.get("cursor_type")) or "before_signature",
        "cursor_field": clean_string(summary.get("cursor_field")) or "before",
        "more_available": bool(summary.get("more_available")),
        "cursor_exhausted": bool(summary.get("cursor_exhausted")),
        "rate_limited": bool(summary.get("rate_limited")),
        "retry_after_seconds": summary.get("retry_after_seconds"),
        "cooldown_applied_seconds": summary.get("cooldown_applied_seconds"),
        "backoff_applied_seconds": summary.get("backoff_applied_seconds"),
        "provider_limited": bool(summary.get("provider_limited")),
        "provider_limit_reached": bool(summary.get("provider_limit_reached", summary.get("provider_limited"))),
        "limited_by_provider": bool(summary.get("limited_by_provider", summary.get("provider_limited"))),
        "provider_unavailable": bool(summary.get("provider_unavailable")),
        "provider_status": clean_string(summary.get("provider_status")),
        "http_status": summary.get("http_status"),
        "request_attempts": int(summary.get("request_attempts") or 0),
        "raw_payload_stored": False,
        "raw_provider_payloads_included": False,
        "browser_provider_calls": False,
        "provider_keys_included": False,
        "provider_request_url_included": False,
        "provider_headers_included": False,
    }


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


def sanitize_helius_transfer(
    transaction: dict[str, Any],
    transfer: dict[str, Any],
    transfer_kind: str,
    index: int,
    leg_index: int,
    wallet: str,
    *,
    page_number: int,
    cursor_present: bool,
    next_cursor_present: bool,
) -> dict[str, Any]:
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
            "provider_page_number": page_number,
            "page_number": page_number,
            "cursor_present": cursor_present,
            "next_cursor_present": next_cursor_present,
            "request_url_stored": False,
            "request_headers_stored": False,
            "provider_key_stored": False,
        },
    }


def sanitize_helius_transaction(
    transaction: dict[str, Any],
    index: int,
    wallet: str,
    *,
    page_number: int,
    cursor_present: bool,
    next_cursor_present: bool,
) -> list[dict[str, Any]]:
    return [
        sanitize_helius_transfer(
            transaction,
            transfer,
            transfer_kind,
            index,
            leg_index,
            wallet,
            page_number=page_number,
            cursor_present=cursor_present,
            next_cursor_present=next_cursor_present,
        )
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
        page_number: int = 1,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_cap_seconds: float = DEFAULT_BACKOFF_CAP_SECONDS,
        cooldown_applied_seconds: float = 0.0,
        stop_on_rate_limit: bool = False,
    ) -> ProviderPage:
        wallet = clean_string(wallet)
        api_key = clean_string(api_key)
        if not wallet:
            raise ProviderAdapterError("wallet is required for provider fetch")
        if not api_key:
            raise ProviderAdapterError("provider API key is required")

        bounded_limit = coerce_limit(limit)
        bounded_retries = max(0, min(int(max_retries or 0), 8))
        bounded_backoff_cap = coerce_seconds(backoff_cap_seconds, default=DEFAULT_BACKOFF_CAP_SECONDS, maximum=120.0)
        current_cursor = clean_string(cursor) or None
        query: dict[str, str] = {"api-key": api_key, "limit": str(bounded_limit)}
        if current_cursor:
            query["before"] = current_cursor
        encoded_wallet = urllib.parse.quote(wallet, safe="")
        request_url = f"{self.base_url.format(wallet=encoded_wallet)}?{urllib.parse.urlencode(query)}"

        attempts = 0
        total_backoff = 0.0
        while attempts <= bounded_retries:
            attempts += 1
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
                    http_status = getattr(response, "status", 200)
                return self._page_from_success(
                    decoded,
                    wallet=wallet,
                    current_cursor=current_cursor,
                    bounded_limit=bounded_limit,
                    page_number=page_number,
                    attempts=attempts,
                    max_retries=bounded_retries,
                    cooldown_applied_seconds=cooldown_applied_seconds,
                    backoff_applied_seconds=total_backoff,
                    http_status=http_status,
                )
            except urllib.error.HTTPError as error:
                retry_after = retry_after_from_headers(error.headers)
                page = self._page_from_http_error(
                    error,
                    wallet=wallet,
                    current_cursor=current_cursor,
                    bounded_limit=bounded_limit,
                    page_number=page_number,
                    attempts=attempts,
                    max_retries=bounded_retries,
                    cooldown_applied_seconds=cooldown_applied_seconds,
                    backoff_applied_seconds=total_backoff,
                    retry_after_seconds=retry_after,
                )
                if attempts > bounded_retries or page.provider_limited or (page.rate_limited and stop_on_rate_limit):
                    return page
                delay = retry_after if retry_after is not None else DEFAULT_BACKOFF_SECONDS * (2 ** (attempts - 1))
                slept = safe_sleep(min(delay, bounded_backoff_cap))
                total_backoff += slept
            except urllib.error.URLError:
                if attempts > bounded_retries:
                    return self._empty_page(
                        wallet=wallet,
                        current_cursor=current_cursor,
                        bounded_limit=bounded_limit,
                        page_number=page_number,
                        provider_status="provider_unavailable",
                        provider_error="provider_network_error",
                        provider_unavailable=True,
                        attempts=attempts,
                        max_retries=bounded_retries,
                        cooldown_applied_seconds=cooldown_applied_seconds,
                        backoff_applied_seconds=total_backoff,
                        stop_reason="provider_unavailable",
                    )
                slept = safe_sleep(min(DEFAULT_BACKOFF_SECONDS * (2 ** (attempts - 1)), bounded_backoff_cap))
                total_backoff += slept

        return self._empty_page(
            wallet=wallet,
            current_cursor=current_cursor,
            bounded_limit=bounded_limit,
            page_number=page_number,
            provider_status="provider_unavailable",
            provider_error="provider_retry_exhausted",
            provider_unavailable=True,
            attempts=attempts,
            max_retries=bounded_retries,
            cooldown_applied_seconds=cooldown_applied_seconds,
            backoff_applied_seconds=total_backoff,
            stop_reason="provider_unavailable",
        )

    def _page_from_success(
        self,
        decoded: str,
        *,
        wallet: str,
        current_cursor: str | None,
        bounded_limit: int,
        page_number: int,
        attempts: int,
        max_retries: int,
        cooldown_applied_seconds: float,
        backoff_applied_seconds: float,
        http_status: int | None,
    ) -> ProviderPage:
        try:
            parsed = json.loads(decoded)
        except json.JSONDecodeError:
            return self._empty_page(
                wallet=wallet,
                current_cursor=current_cursor,
                bounded_limit=bounded_limit,
                page_number=page_number,
                provider_status="provider_invalid_json",
                provider_error="provider_invalid_json",
                provider_unavailable=True,
                attempts=attempts,
                max_retries=max_retries,
                cooldown_applied_seconds=cooldown_applied_seconds,
                backoff_applied_seconds=backoff_applied_seconds,
                http_status=http_status,
                stop_reason="provider_unavailable",
            )
        if not isinstance(parsed, list):
            return self._empty_page(
                wallet=wallet,
                current_cursor=current_cursor,
                bounded_limit=bounded_limit,
                page_number=page_number,
                provider_status="provider_unexpected_response_shape",
                provider_error="provider_unexpected_response_shape",
                provider_unavailable=True,
                attempts=attempts,
                max_retries=max_retries,
                cooldown_applied_seconds=cooldown_applied_seconds,
                backoff_applied_seconds=backoff_applied_seconds,
                http_status=http_status,
                stop_reason="provider_unavailable",
            )

        transactions = [item for item in parsed if isinstance(item, dict)]
        next_cursor = clean_string(transactions[-1].get("signature")) if len(transactions) >= bounded_limit and transactions else None
        more_available = bool(next_cursor and len(transactions) >= bounded_limit)
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(transactions):
            normalized.extend(
                sanitize_helius_transaction(
                    item,
                    index,
                    wallet,
                    page_number=page_number,
                    cursor_present=bool(current_cursor),
                    next_cursor_present=bool(next_cursor),
                )
            )
        summary = {
            "provider": self.name,
            "page_number": page_number,
            "requested_limit": bounded_limit,
            "raw_transaction_count": len(transactions),
            "normalized_event_count": len(normalized),
            "cursor_present": bool(current_cursor),
            "current_cursor_present": bool(current_cursor),
            "next_cursor_present": bool(next_cursor),
            "cursor_type": self.cursor_type,
            "cursor_field": "before",
            "more_available": more_available,
            "cursor_exhausted": not more_available,
            "rate_limited": False,
            "retry_after_seconds": None,
            "cooldown_applied_seconds": cooldown_applied_seconds,
            "backoff_applied_seconds": backoff_applied_seconds,
            "provider_limited": False,
            "provider_limit_reached": False,
            "limited_by_provider": False,
            "provider_unavailable": False,
            "provider_status": "ok",
            "http_status": http_status,
            "request_attempts": attempts,
        }
        return ProviderPage(
            provider=self.name,
            chain=self.chain,
            wallet=wallet,
            page_number=page_number,
            current_cursor=current_cursor,
            next_cursor=next_cursor,
            cursor_type=self.cursor_type,
            requested_limit=bounded_limit,
            returned_count=len(normalized),
            raw_transaction_count=len(transactions),
            more_available=more_available,
            cursor_exhausted=not more_available,
            pagination_supported=self.pagination_supported,
            deterministic_pagination_support=self.deterministic_pagination_support,
            provider_request_sent=True,
            normalized_transactions=normalized,
            provider_status="ok",
            http_status=http_status,
            request_attempts=attempts,
            max_retries=max_retries,
            cooldown_applied_seconds=cooldown_applied_seconds,
            backoff_applied_seconds=backoff_applied_seconds,
            stop_reason="cursor_exhausted" if not more_available else "",
            page_summary=summary,
        )

    def _page_from_http_error(
        self,
        error: urllib.error.HTTPError,
        *,
        wallet: str,
        current_cursor: str | None,
        bounded_limit: int,
        page_number: int,
        attempts: int,
        max_retries: int,
        cooldown_applied_seconds: float,
        backoff_applied_seconds: float,
        retry_after_seconds: float | None,
    ) -> ProviderPage:
        status_code = int(error.code or 0)
        rate_limited = status_code == 429
        provider_limited = status_code in {401, 402, 403}
        provider_unavailable = status_code >= 500 or status_code in {408, 425}
        provider_status = (
            "provider_rate_limited"
            if rate_limited
            else "provider_limited"
            if provider_limited
            else "provider_unavailable"
            if provider_unavailable
            else f"provider_http_error_{status_code}"
        )
        stop_reason = (
            "rate_limited"
            if rate_limited
            else "provider_limited"
            if provider_limited
            else "provider_unavailable"
            if provider_unavailable
            else "provider_http_error"
        )
        return self._empty_page(
            wallet=wallet,
            current_cursor=current_cursor,
            bounded_limit=bounded_limit,
            page_number=page_number,
            provider_status=provider_status,
            provider_error=provider_status,
            http_status=status_code,
            rate_limited=rate_limited,
            retry_after_seconds=retry_after_seconds,
            provider_limited=provider_limited,
            provider_unavailable=provider_unavailable,
            attempts=attempts,
            max_retries=max_retries,
            cooldown_applied_seconds=cooldown_applied_seconds,
            backoff_applied_seconds=backoff_applied_seconds,
            stop_reason=stop_reason,
        )

    def _empty_page(
        self,
        *,
        wallet: str,
        current_cursor: str | None,
        bounded_limit: int,
        page_number: int,
        provider_status: str,
        provider_error: str | None = None,
        http_status: int | None = None,
        rate_limited: bool = False,
        retry_after_seconds: float | None = None,
        provider_limited: bool = False,
        provider_unavailable: bool = False,
        attempts: int = 0,
        max_retries: int = DEFAULT_MAX_RETRIES,
        cooldown_applied_seconds: float = 0.0,
        backoff_applied_seconds: float = 0.0,
        stop_reason: str = "",
    ) -> ProviderPage:
        summary = {
            "provider": self.name,
            "page_number": page_number,
            "requested_limit": bounded_limit,
            "raw_transaction_count": 0,
            "normalized_event_count": 0,
            "cursor_present": bool(current_cursor),
            "current_cursor_present": bool(current_cursor),
            "next_cursor_present": False,
            "cursor_type": self.cursor_type,
            "cursor_field": "before",
            "more_available": False,
            "cursor_exhausted": False,
            "rate_limited": rate_limited,
            "retry_after_seconds": retry_after_seconds,
            "cooldown_applied_seconds": cooldown_applied_seconds,
            "backoff_applied_seconds": backoff_applied_seconds,
            "provider_limited": provider_limited,
            "provider_limit_reached": provider_limited,
            "limited_by_provider": provider_limited,
            "provider_unavailable": provider_unavailable,
            "provider_status": provider_status,
            "http_status": http_status,
            "request_attempts": attempts,
        }
        return ProviderPage(
            provider=self.name,
            chain=self.chain,
            wallet=wallet,
            page_number=page_number,
            current_cursor=current_cursor,
            next_cursor=None,
            cursor_type=self.cursor_type,
            requested_limit=bounded_limit,
            returned_count=0,
            raw_transaction_count=0,
            more_available=False,
            cursor_exhausted=False,
            pagination_supported=self.pagination_supported,
            deterministic_pagination_support=self.deterministic_pagination_support,
            provider_request_sent=True,
            normalized_transactions=[],
            provider_status=provider_status,
            provider_error=provider_error,
            http_status=http_status,
            rate_limited=rate_limited,
            retry_after_seconds=retry_after_seconds,
            cooldown_applied_seconds=cooldown_applied_seconds,
            backoff_applied_seconds=backoff_applied_seconds,
            provider_limited=provider_limited,
            provider_unavailable=provider_unavailable,
            request_attempts=attempts,
            max_retries=max_retries,
            stop_reason=stop_reason,
            page_summary=summary,
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
    page_number: int = 1,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_cap_seconds: float = DEFAULT_BACKOFF_CAP_SECONDS,
    cooldown_applied_seconds: float = 0.0,
    stop_on_rate_limit: bool = False,
) -> ProviderPage:
    adapter = get_provider_adapter(provider)
    return adapter.fetch_wallet_history(
        wallet=wallet,
        api_key=api_key,
        limit=limit,
        cursor=cursor,
        timeout_seconds=timeout_seconds,
        page_number=page_number,
        max_retries=max_retries,
        backoff_cap_seconds=backoff_cap_seconds,
        cooldown_applied_seconds=cooldown_applied_seconds,
        stop_on_rate_limit=stop_on_rate_limit,
    )


def fetch_wallet_history_pages(
    *,
    provider: str,
    wallet: str,
    api_key: str,
    limit_per_page: int,
    max_pages: int = DEFAULT_MAX_PAGES,
    request_limit: int | None = None,
    resume_cursor: str | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    cooldown_seconds: float = 0.0,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_cap_seconds: float = DEFAULT_BACKOFF_CAP_SECONDS,
    stop_on_rate_limit: bool = False,
    page_fetcher: Any | None = None,
) -> ProviderFetchResult:
    bounded_limit = coerce_limit(limit_per_page)
    bounded_pages = coerce_page_limit(max_pages)
    bounded_request_limit = coerce_page_limit(request_limit if request_limit is not None else bounded_pages, default=bounded_pages)
    page_cap = min(bounded_pages, bounded_request_limit)
    cursor = clean_string(resume_cursor) or None
    started_cursor = cursor
    pages: list[ProviderPage] = []
    stop_reason = "max_page_cap"
    fetch_page = page_fetcher or fetch_wallet_history_page

    for page_index in range(page_cap):
        cooldown_applied = 0.0
        if page_index > 0:
            cooldown_applied = safe_sleep(cooldown_seconds)
        page = fetch_page(
            provider=provider,
            wallet=wallet,
            api_key=api_key,
            limit=bounded_limit,
            cursor=cursor,
            timeout_seconds=timeout_seconds,
            page_number=page_index + 1,
            max_retries=max_retries,
            backoff_cap_seconds=backoff_cap_seconds,
            cooldown_applied_seconds=cooldown_applied,
            stop_on_rate_limit=stop_on_rate_limit,
        )
        pages.append(page)
        stop_reason = page.stop_reason or ""
        if page.rate_limited:
            stop_reason = "rate_limited"
            if stop_on_rate_limit:
                break
            break
        if page.provider_limited:
            stop_reason = "provider_limited"
            break
        if page.provider_unavailable or page.provider_status != "ok":
            stop_reason = page.stop_reason or "provider_unavailable"
            break
        if not page.next_cursor:
            stop_reason = "cursor_exhausted"
            break
        if page.next_cursor == cursor:
            stop_reason = "cursor_stalled"
            break
        cursor = page.next_cursor
    else:
        stop_reason = "max_page_cap" if page_cap else "request_limit"

    next_cursor = pages[-1].next_cursor if pages else started_cursor
    if stop_reason == "max_page_cap" and pages and not pages[-1].next_cursor:
        stop_reason = "cursor_exhausted"

    return ProviderFetchResult(
        provider=provider,
        chain="solana",
        wallet=clean_string(wallet),
        pages_requested=bounded_pages,
        request_limit=bounded_request_limit,
        pages=pages,
        requested_limit=bounded_limit,
        started_cursor=started_cursor,
        next_cursor=next_cursor,
        stop_reason=stop_reason,
    )
