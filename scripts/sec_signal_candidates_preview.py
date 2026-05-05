#!/usr/bin/env python3
"""Preview relationship candidate objects from cached SEC filing signal reports."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
PRODUCTION_COMPANIES_PATH = PROJECT_ROOT / "data" / "companies.json"
OFFICIAL_TICKER_UNIVERSE_PATH = PROJECT_ROOT / "data" / "candidates" / "official_ticker_universe.json"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sec_filing_inspect import FilingInspectError  # noqa: E402
from sec_filing_inspect import (  # noqa: E402
    build_metadata_summary,
    decode_document,
    read_document,
    sanitize_text,
)
from sec_filing_signals import (  # noqa: E402
    SignalExtractionError,
    parse_nonnegative_int,
    resolve_cached_filing,
)
from sec_signal_report import build_report  # noqa: E402


SAFETY_COUNTERS = {
    "network_calls": 0,
    "candidate_files_written": 0,
    "production_writes": 0,
}
SIGNAL_RELATIONSHIP_TYPES = {
    "supplier": "supplier_customer",
    "customer": "supplier_customer",
    "dependency": "supplier_customer",
    "partnership": "partnership",
    "investment": "investment",
}
CORE_RELATIONSHIP_TYPES = {
    "partnership",
    "supplier_customer",
    "investment",
    "competitive",
}
MIN_TARGET_MATCH_CONFIDENCE = 0.75
MIN_CONFIDENCE_HINT = 0.85
MAX_PREVIEW_CANDIDATES_TOTAL = 500
MAX_PREVIEW_CANDIDATES_PER_SOURCE_TICKER = 8
MAX_SECTOR_AWARE_SNIPPETS_TOTAL = 600
SECTOR_RELATIONSHIP_CONTEXT_CHARS = 360
SUPPLIER_CUSTOMER_PARTNERSHIP_TERMS = (
    "revenue from",
    "licensing",
    "search distribution",
    "payments from",
)
SUPPLIER_CUSTOMER_SUPPLY_TERMS = (
    "supplies",
    "manufactures for",
    "component supplier",
    "supply agreement",
    "manufacturing agreement",
    "manufacturing services",
    "manufacturing services agreement",
)
GENERIC_RELATIONSHIP_NOISE_TERMS = (
    "depends on",
    "depending on",
    "our customers",
    "our suppliers",
    "our vendors",
    "suppliers",
    "customers",
    "vendors",
)
ACCOUNTING_RELATIONSHIP_NOISE_TERMS = (
    "revenue from contracts",
    "revenues from contracts",
    "revenue recognized",
    "contract assets",
    "contract liabilities",
    "remaining performance obligations",
)
INTERNAL_OPERATIONS_NOISE_TERMS = (
    "internal operations",
    "business operations",
    "operating results",
    "results of operations",
)
LEGAL_ONLY_RELATIONSHIP_NOISE_TERMS = (
    "exhibit no.",
    "incorporated by reference",
    "judgment sharing agreement",
    "settlement sharing agreement",
    "omnibus judgment",
)
GENERIC_AGREEMENT_SIGNALS = (
    "agreement with",
)
GRAPH_WORTHY_SIGNAL_TERMS = (
    *SUPPLIER_CUSTOMER_PARTNERSHIP_TERMS,
    *SUPPLIER_CUSTOMER_SUPPLY_TERMS,
    "partnership",
    "partnership with",
    "collaboration",
    "collaboration with",
    "agreement with",
    "joint venture with",
    "strategic agreement",
    "manufactured by",
    "components sourced from",
    "accounted for",
    "investment in",
    "ownership stake in",
)
SECTOR_AWARE_RELATIONSHIP_RULES: tuple[dict[str, Any], ...] = (
    {
        "sector": "energy_midstream",
        "relationship_type": "partnership",
        "signal_type": "partnership",
        "confidence_hint": 0.94,
        "terms": (
            "joint venture",
            "offtake agreement",
        ),
    },
    {
        "sector": "energy_midstream",
        "relationship_type": "supplier_customer",
        "signal_type": "customer",
        "confidence_hint": 0.91,
        "terms": (
            "pipeline system",
            "transportation services agreement",
            "gathering agreement",
            "processing agreement",
            "fractionation agreement",
            "terminal services",
            "terminal services agreement",
            "throughput agreement",
            "take-or-pay",
            "long-term supply",
            "long-term supply agreement",
        ),
    },
    {
        "sector": "industrials_defense",
        "relationship_type": "partnership",
        "signal_type": "partnership",
        "confidence_hint": 0.91,
        "terms": (
            "program partner",
            "production agreement",
            "aerospace program",
            "defense contract",
            "government contractor relationship",
        ),
    },
    {
        "sector": "industrials_defense",
        "relationship_type": "supplier_customer",
        "signal_type": "supplier",
        "confidence_hint": 0.91,
        "terms": (
            "prime contractor",
            "subcontractor",
            "manufacturing agreement",
            "supply agreement",
        ),
    },
    {
        "sector": "healthcare",
        "relationship_type": "partnership",
        "signal_type": "partnership",
        "confidence_hint": 0.92,
        "terms": (
            "collaboration agreement",
            "commercialization agreement",
            "licensing agreement",
            "license agreement",
            "distribution agreement",
            "clinical collaboration",
            "co-development",
            "co-development agreement",
            "royalty agreement",
        ),
    },
    {
        "sector": "healthcare",
        "relationship_type": "supplier_customer",
        "signal_type": "supplier",
        "confidence_hint": 0.9,
        "terms": (
            "manufacturing services",
            "manufacturing services agreement",
        ),
    },
    {
        "sector": "consumer_media_travel",
        "relationship_type": "partnership",
        "signal_type": "partnership",
        "confidence_hint": 0.9,
        "terms": (
            "franchise agreement",
            "licensing agreement",
            "license agreement",
            "distribution agreement",
            "advertising partnership",
            "content licensing",
            "merchant agreement",
            "platform partnership",
            "co-branded agreement",
        ),
    },
    {
        "sector": "financials",
        "relationship_type": "partnership",
        "signal_type": "partnership",
        "confidence_hint": 0.9,
        "terms": (
            "custody agreement",
            "asset management agreement",
            "clearing agreement",
            "card network relationship",
            "merchant acquiring",
            "investment management",
        ),
    },
    {
        "sector": "financials",
        "relationship_type": "investment",
        "signal_type": "investment",
        "confidence_hint": 0.91,
        "terms": (
            "lending facility",
            "credit agreement",
            "credit facility",
            "loan agreement",
            "revolving loan agreement",
        ),
    },
)
SECTOR_AWARE_RELATIONSHIP_TERMS = tuple(
    dict.fromkeys(
        term
        for rule in SECTOR_AWARE_RELATIONSHIP_RULES
        for term in rule["terms"]
    )
)
GRAPH_WORTHY_SIGNAL_TERMS = (
    *GRAPH_WORTHY_SIGNAL_TERMS,
    *SECTOR_AWARE_RELATIONSHIP_TERMS,
)
SECTOR_TERM_RULE_BY_TERM = {
    term: rule
    for rule in SECTOR_AWARE_RELATIONSHIP_RULES
    for term in rule["terms"]
}
RELATIONSHIP_CONNECTOR_PATTERN = (
    r"(?:with|to|from|by|for|between|among|under|pursuant\s+to|involving)"
)
SECTOR_TARGET_FRAGMENT = (
    r"(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{1,6})"
    r"(?:\s+(?:&|and|of|the|[A-Z][A-Za-z0-9&.'-]*|[A-Z]{1,6})){0,8}"
    r"(?:\s*,?\s+(?:"
    r"Corporation|Corp\.?|Incorporated|Inc\.?|LLC|L\.L\.C\.|"
    r"Limited|Ltd\.?|LP|L\.P\.|Ltd|PLC|plc|N\.V\.|S\.A\.|AG|SE|Company|Co\.?"
    r"))?"
)
UPPERCASE_TICKER_TOKEN_PATTERN = re.compile(r"\b[A-Z][A-Z.]{1,5}\b")
TICKER_TOKEN_STOP_WORDS = {
    "A",
    "AM",
    "AS",
    "ASC",
    "CEO",
    "CFO",
    "EPS",
    "ESG",
    "FASB",
    "FDA",
    "GAAP",
    "IRS",
    "NYSE",
    "SEC",
    "US",
    "U.S",
}
EXACT_TICKER_CONTEXT_ALLOWLIST = {
    "BKR",
    "EPD",
    "KMI",
    "MPC",
    "MPLX",
    "MRNA",
    "OKE",
    "PAA",
    "PNC",
    "RTX",
    "SLB",
    "WMB",
}
TERMS_REQUIRING_DIRECTIONAL_TARGET_AFTER = {
    "credit facility",
    "lending facility",
}
ALIAS_FIELD_NAMES = (
    "aliases",
    "alias",
    "common_aliases",
    "alternate_names",
    "alternative_names",
    "former_names",
    "aka",
)
COMMON_PUBLIC_ALIASES_BY_TICKER = {
    "NVDA": ("NVIDIA", "Nvidia", "NVIDIA Corp.", "NVIDIA Corporation"),
    "AMD": ("AMD", "Advanced Micro Devices"),
    "INTC": ("Intel", "Intel Corp.", "Intel Corporation"),
    "AVGO": ("Broadcom", "Broadcom Inc.", "VMware"),
    "QCOM": ("Qualcomm", "QUALCOMM"),
    "MU": ("Micron", "Micron Technology"),
    "TSM": (
        "TSMC",
        "Taiwan Semiconductor",
        "Taiwan Semiconductor Manufacturing",
        "Taiwan Semiconductor Manufacturing Company",
    ),
    "ASML": ("ASML", "ASML Holding"),
    "ARM": ("Arm", "Arm Holdings"),
    "AMAT": ("Applied Materials",),
    "LRCX": ("Lam Research",),
    "KLAC": ("KLA", "KLA Corporation"),
    "MRVL": ("Marvell", "Marvell Technology"),
    "MSFT": ("Microsoft", "Microsoft Corp.", "Microsoft Corporation"),
    "GOOGL": ("Google", "Google LLC", "Google Inc.", "Google, Inc."),
    "GOOG": ("Google", "Google LLC", "Google Inc.", "Google, Inc."),
    "AMZN": ("Amazon", "Amazon.com", "Amazon.com, Inc.", "Amazon Web Services", "AWS"),
    "META": ("Meta", "Facebook", "Facebook Inc.", "Facebook, Inc.", "Meta Platforms"),
    "AAPL": ("Apple", "Apple Inc."),
    "ORCL": ("Oracle", "Oracle Corporation"),
    "CRM": ("Salesforce", "Salesforce.com"),
    "SNOW": ("Snowflake",),
    "NOW": ("ServiceNow",),
    "PANW": ("Palo Alto Networks",),
    "V": ("Visa", "Visa Inc."),
    "MA": ("Mastercard",),
    "JPM": ("JPMorgan", "JPMorgan Chase"),
    "GS": ("Goldman Sachs",),
    "BLK": ("BlackRock",),
    "XOM": ("ExxonMobil", "Exxon Mobil"),
    "CVX": ("Chevron",),
    "COP": ("ConocoPhillips",),
    "OXY": ("Occidental", "Occidental Petroleum"),
    "SLB": ("SLB", "Schlumberger"),
    "HAL": ("Halliburton",),
    "BKR": ("Baker Hughes",),
    "KMI": ("Kinder Morgan",),
    "OKE": ("ONEOK", "Oneok"),
    "WMB": ("Williams", "The Williams Companies", "Williams Companies"),
    "MPC": ("Marathon Petroleum", "Marathon Petroleum Corporation"),
    "MPLX": ("MPLX", "MPLX LP"),
    "PAA": ("Plains All American", "Plains All American Pipeline"),
    "ET": ("Energy Transfer", "Energy Transfer LP"),
    "EPD": ("Enterprise Products", "Enterprise Products Partners"),
    "LNG": ("Cheniere", "Cheniere Energy"),
    "UNH": ("UnitedHealth", "UnitedHealth Group", "UnitedHealthcare", "Optum"),
    "LLY": ("Eli Lilly", "Lilly"),
    "MRK": ("Merck", "Merck & Co."),
    "PFE": ("Pfizer",),
    "JNJ": ("Johnson & Johnson",),
    "ABT": ("Abbott", "Abbott Laboratories"),
    "ABBV": ("AbbVie",),
    "BMY": ("Bristol Myers Squibb", "Bristol-Myers Squibb"),
    "AMGN": ("Amgen",),
    "MRNA": ("Moderna",),
    "REGN": ("Regeneron",),
    "GILD": ("Gilead", "Gilead Sciences"),
    "TMO": ("Thermo Fisher", "Thermo Fisher Scientific"),
    "MDT": ("Medtronic",),
    "BSX": ("Boston Scientific",),
    "GE": ("GE Aerospace", "General Electric"),
    "CAT": ("Caterpillar",),
    "HON": ("Honeywell",),
    "RTX": ("RTX", "Raytheon", "Raytheon Technologies", "Pratt & Whitney", "Collins Aerospace"),
    "LMT": ("Lockheed Martin",),
    "BA": ("Boeing", "The Boeing Company"),
    "NOC": ("Northrop Grumman",),
    "GD": ("General Dynamics",),
    "HII": ("Huntington Ingalls", "Huntington Ingalls Industries"),
    "DE": ("Deere", "John Deere", "Deere & Company"),
    "WMT": ("Walmart", "Wal-Mart"),
    "COST": ("Costco", "Costco Wholesale"),
    "HD": ("Home Depot", "The Home Depot"),
    "LOW": ("Lowe's", "Lowes"),
    "MCD": ("McDonald's", "McDonalds"),
    "YUM": ("Yum!", "Yum Brands", "Yum! Brands"),
    "SBUX": ("Starbucks",),
    "DIS": ("Disney", "The Walt Disney Company"),
    "CMCSA": ("Comcast", "NBCUniversal", "NBC Universal"),
    "NFLX": ("Netflix",),
    "BKNG": ("Booking Holdings", "Booking.com"),
    "MAR": ("Marriott", "Marriott International"),
    "HLT": ("Hilton", "Hilton Worldwide"),
    "UBER": ("Uber", "Uber Technologies"),
    "BAC": ("Bank of America", "BofA"),
    "WFC": ("Wells Fargo",),
    "C": ("Citigroup", "Citi"),
    "MS": ("Morgan Stanley",),
    "PNC": ("PNC", "PNC Bank", "PNC Bank, National Association"),
    "AXP": ("American Express", "Amex"),
    "SCHW": ("Charles Schwab", "Schwab"),
    "BK": ("BNY Mellon", "Bank of New York Mellon", "The Bank of New York Mellon"),
    "STT": ("State Street", "State Street Corporation"),
    "ICE": ("Intercontinental Exchange",),
    "CME": ("CME Group",),
    "NDAQ": ("Nasdaq", "Nasdaq Inc."),
}
LEGAL_SUFFIXES = (
    "Corporation",
    "Corp.",
    "Corp",
    "Incorporated",
    "Inc.",
    "Inc",
    "LLC",
    "L.L.C.",
    "LP",
    "L.P.",
    "Limited",
    "Ltd.",
    "Ltd",
    "PLC",
    "plc",
    "N.V.",
    "S.A.",
    "AG",
    "SE",
)
LEGAL_SUFFIX_WORDS = {
    "ag",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "lp",
    "ltd",
    "nv",
    "plc",
    "sa",
    "se",
}
ENTITY_NAME_PATTERN = re.compile(
    r"\b("
    r"(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})"
    r"(?:\s+(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})){0,7}"
    r"\s*,?\s+"
    rf"(?:{'|'.join(re.escape(suffix) for suffix in LEGAL_SUFFIXES)})"
    r")\b"
)
TICKER_REFERENCE_PATTERN = re.compile(
    r"\b(?:NASDAQ|Nasdaq|NYSE|NYSEARCA|NYSE American|NasdaqGS)\s*[:\-]\s*"
    r"([A-Z][A-Z.]{0,5})\b"
)
CAPITALIZED_ENTITY_PATTERN = re.compile(
    r"\b("
    r"(?:[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})"
    r"(?:\s+(?:&|and|of|the|[A-Z][A-Za-z0-9&.'-]*|[A-Z]{2,})){1,7}"
    r")\b"
)
URL_PATTERN = re.compile(r"^https?://\S+$", re.IGNORECASE)
TAG_PATTERN = re.compile(r"<[^>]+>")
XBRL_NOISE_MARKERS = (
    "xbrli:",
    "ix:",
    "unitref",
    "contextref",
    "nonfraction",
    "nonnumeric",
)
XBRL_PROSE_STOP_WORDS = {
    "aapl",
    "contextref",
    "decimals",
    "format",
    "gaap",
    "identifier",
    "measure",
    "nonfraction",
    "nonnumeric",
    "pure",
    "scale",
    "shares",
    "unitdenominator",
    "unitnumerator",
    "unitref",
    "xbrli",
}
GENERIC_ENTITY_MENTION_KEYS = {
    "a company",
    "a customer",
    "a single customer",
    "a supplier",
    "a third party",
    "business",
    "companies",
    "company",
    "contract",
    "contracts",
    "customer",
    "customer a",
    "customer b",
    "customer c",
    "customers",
    "our customers",
    "our suppliers",
    "our vendors",
    "products",
    "services",
    "supplier",
    "suppliers",
    "the company",
    "third party",
    "vendor",
    "vendors",
}


class CandidatePreviewError(Exception):
    """Raised for clear candidate preview failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert read-only SEC filing signal report snippets into preview-only "
            "relationship candidate objects. This script reads cached filing "
            "documents and optional metadata sidecars only, prints to stdout only, "
            "and never writes candidate files or production graph data."
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
        "--json",
        action="store_true",
        help="Print a machine-readable JSON preview payload to stdout only.",
    )
    return parser.parse_args(argv)


def clean_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def clean_source_url(value: Any) -> str | None:
    url = clean_optional_string(value)
    if url is None or URL_PATTERN.match(url) is None:
        return None
    return url


def source_urls_from_metadata(metadata: dict[str, Any]) -> list[str]:
    raw_urls: list[Any] = []
    for field_name in ("archive_url", "source_url"):
        raw_url = metadata.get(field_name)
        if raw_url is not None:
            raw_urls.append(raw_url)

    source_urls = metadata.get("source_urls")
    if isinstance(source_urls, list):
        raw_urls.extend(source_urls)
    elif source_urls is not None:
        raw_urls.append(source_urls)

    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in raw_urls:
        url = clean_source_url(raw_url)
        if url is None or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def source_ticker_from_metadata(metadata: dict[str, Any]) -> str | None:
    ticker = clean_optional_string(metadata.get("ticker"))
    return ticker.upper() if ticker else None


def relationship_term_hits(text: str, terms: tuple[str, ...]) -> list[str]:
    text_lower = text.lower()
    hits: list[str] = []
    for term in terms:
        if " " in term:
            if term in text_lower:
                hits.append(term)
            continue
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, text_lower):
            hits.append(term)
    return hits


def normalize_relationship_type(value: str | None) -> str | None:
    if value == "supply":
        return "supplier_customer"
    if value in CORE_RELATIONSHIP_TYPES:
        return value
    return None


def relationship_type_for(signal_type: str, snippet_text: Any) -> str | None:
    relationship_type = normalize_relationship_type(
        SIGNAL_RELATIONSHIP_TYPES.get(signal_type, "ecosystem")
    )
    if relationship_type != "supplier_customer":
        return relationship_type

    visible_text = visible_snippet_text(snippet_text)
    if relationship_term_hits(visible_text, SUPPLIER_CUSTOMER_PARTNERSHIP_TERMS):
        return "partnership"
    if relationship_term_hits(visible_text, SUPPLIER_CUSTOMER_SUPPLY_TERMS):
        return "supplier_customer"
    return None


def visible_snippet_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(TAG_PATTERN.sub(" ", html.unescape(value)).split())


def normalize_match_key(value: str) -> str:
    normalized = html.unescape(value).lower().replace("&", " and ")
    normalized = normalized.replace("'", "")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def base_match_key(value: str) -> str:
    parts = normalize_match_key(value).split()
    while parts and parts[-1] in LEGAL_SUFFIX_WORDS:
        parts.pop()
    return " ".join(parts)


def base_display_name(value: str) -> str:
    display = html.unescape(value).strip(" ,.;:")
    display = re.sub(
        r"\s*,\s*(?:"
        r"Corporation|Corp\.?|Incorporated|Inc\.?|LLC|L\.L\.C\.|"
        r"Limited|Ltd\.?|LP|L\.P\.|PLC|plc|N\.V\.|S\.A\.|AG|SE|Company|Co\.?"
        r")$",
        "",
        display,
        flags=re.IGNORECASE,
    )
    display = re.sub(
        r"\s+(?:"
        r"Corporation|Corp\.?|Incorporated|Inc\.?|LLC|L\.L\.C\.|"
        r"Limited|Ltd\.?|LP|L\.P\.|PLC|plc|N\.V\.|S\.A\.|AG|SE|Company|Co\.?"
        r")$",
        "",
        display,
        flags=re.IGNORECASE,
    )
    return display.strip(" ,.;:&")


def entity_mention_looks_generic(value: str) -> bool:
    key = normalize_match_key(value)
    if not key or key in GENERIC_ENTITY_MENTION_KEYS:
        return True
    words = key.split()
    if words[:1] in (["customer"], ["supplier"], ["vendor"]):
        return True
    if words[-1:] in (["customer"], ["supplier"], ["vendor"]):
        return len(words) <= 2
    return False


def company_alias_values(company: dict[str, Any]) -> list[str]:
    aliases: list[str] = []
    for field_name in ALIAS_FIELD_NAMES:
        value = company.get(field_name)
        if isinstance(value, str):
            aliases.append(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    aliases.append(item)
                elif isinstance(item, dict):
                    for key in ("name", "value", "alias"):
                        item_value = item.get(key)
                        if isinstance(item_value, str):
                            aliases.append(item_value)
                            break
    return aliases


def load_candidate_ticker_universe_companies() -> list[dict[str, str]]:
    if not OFFICIAL_TICKER_UNIVERSE_PATH.exists():
        return []
    try:
        with OFFICIAL_TICKER_UNIVERSE_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return []

    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list):
        return []

    companies: list[dict[str, str]] = []
    for raw_company in candidates:
        if not isinstance(raw_company, dict):
            continue
        ticker = clean_optional_string(raw_company.get("ticker"))
        name = clean_optional_string(raw_company.get("name"))
        if ticker is None or name is None:
            continue
        companies.append(
            {
                "ticker": ticker.upper(),
                "name": name,
                "_index": "candidate",
                "_aliases": "[]",
            }
        )
    return companies


def load_match_companies() -> list[dict[str, str]]:
    try:
        with PRODUCTION_COMPANIES_PATH.open("r", encoding="utf-8") as file:
            raw_companies = json.load(file)
    except OSError as exc:
        raise CandidatePreviewError(
            f"could not read production companies file {PRODUCTION_COMPANIES_PATH}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise CandidatePreviewError(
            f"could not parse production companies file {PRODUCTION_COMPANIES_PATH}: {exc}"
        ) from exc

    if not isinstance(raw_companies, list):
        raise CandidatePreviewError("production companies data must be a JSON array.")

    companies: list[dict[str, str]] = []
    for index, raw_company in enumerate(raw_companies, start=1):
        if not isinstance(raw_company, dict):
            continue
        ticker = clean_optional_string(raw_company.get("ticker"))
        name = clean_optional_string(raw_company.get("name"))
        if ticker is None or name is None:
            continue
        companies.append(
            {
                "ticker": ticker.upper(),
                "name": name,
                "_index": str(index),
                "_aliases": json.dumps(company_alias_values(raw_company)),
            }
        )
    production_tickers = {company["ticker"] for company in companies}
    for candidate_company in load_candidate_ticker_universe_companies():
        if candidate_company["ticker"] in production_tickers:
            continue
        companies.append(candidate_company)
    return companies


def add_matcher_entry(
    matcher: dict[str, list[dict[str, Any]]],
    key: str,
    company: dict[str, str],
    *,
    method: str,
    confidence: float,
    surface: str | None = None,
    surface_kind: str = "name",
) -> None:
    if not key:
        return
    matcher.setdefault(key, []).append(
        {
            "ticker": company["ticker"],
            "name": company["name"],
            "method": method,
            "confidence": confidence,
            "surface": surface or company["name"],
            "surface_kind": surface_kind,
        }
    )


def build_company_matcher() -> dict[str, list[dict[str, Any]]]:
    companies = load_match_companies()
    matcher: dict[str, list[dict[str, Any]]] = {}
    companies_by_ticker = {company["ticker"]: company for company in companies}

    for company in companies:
        name = company["name"]
        add_matcher_entry(
            matcher,
            normalize_match_key(name),
            company,
            method="company_name_exact",
            confidence=0.98,
            surface=name,
        )
        base_name = base_display_name(name)
        add_matcher_entry(
            matcher,
            base_match_key(name),
            company,
            method="company_name_base",
            confidence=0.9,
            surface=base_name,
        )
        add_matcher_entry(
            matcher,
            normalize_match_key(company["ticker"]),
            company,
            method="ticker_exact",
            confidence=0.98,
            surface=company["ticker"],
            surface_kind="ticker",
        )

        aliases = json.loads(company["_aliases"])
        for alias in aliases:
            add_matcher_entry(
                matcher,
                normalize_match_key(alias),
                company,
                method="company_alias_exact",
                confidence=0.95,
                surface=alias,
            )
            base_alias = base_display_name(alias)
            add_matcher_entry(
                matcher,
                base_match_key(alias),
                company,
                method="company_alias_base",
                confidence=0.9,
                surface=base_alias,
            )

    for ticker, aliases in COMMON_PUBLIC_ALIASES_BY_TICKER.items():
        company = companies_by_ticker.get(ticker)
        if company is None:
            continue
        for alias in aliases:
            add_matcher_entry(
                matcher,
                normalize_match_key(alias),
                company,
                method="common_public_alias_exact",
                confidence=0.92,
                surface=alias,
                surface_kind="common_alias",
            )
            base_alias = base_display_name(alias)
            add_matcher_entry(
                matcher,
                base_match_key(alias),
                company,
                method="common_public_alias_base",
                confidence=0.88,
                surface=base_alias,
                surface_kind="common_alias",
            )

    return matcher


def resolve_matcher_key(
    matcher: dict[str, list[dict[str, Any]]],
    key: str,
) -> dict[str, Any] | None:
    entries = matcher.get(key, [])
    if not entries:
        return None

    by_ticker: dict[str, dict[str, Any]] = {}
    for entry in entries:
        current = by_ticker.get(entry["ticker"])
        if current is None or entry["confidence"] > current["confidence"]:
            by_ticker[entry["ticker"]] = entry

    if len(by_ticker) != 1:
        return None
    return next(iter(by_ticker.values()))


def resolve_entity_mention(
    matcher: dict[str, list[dict[str, Any]]],
    mention: str,
) -> dict[str, Any] | None:
    return (
        resolve_matcher_key(matcher, normalize_match_key(mention))
        or resolve_matcher_key(matcher, base_match_key(mention))
    )


def unique_ordered(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = normalize_match_key(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(value.strip())
    return ordered


def matcher_surface_mentions(
    text: str,
    matcher: dict[str, list[dict[str, Any]]],
) -> list[str]:
    mentions: list[str] = []
    seen_surfaces: set[str] = set()
    for entries in matcher.values():
        for entry in entries:
            surface = clean_optional_string(entry.get("surface"))
            if surface is None:
                continue
            if entry.get("surface_kind") == "ticker":
                continue
            key = normalize_match_key(surface)
            if len(key) < 4 or key in seen_surfaces:
                continue
            if entity_mention_looks_generic(surface):
                continue
            seen_surfaces.add(key)
            escaped = re.escape(surface).replace(r"\ ", r"\s+")
            pattern = re.compile(
                rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])",
                re.IGNORECASE,
            )
            if pattern.search(text):
                mentions.append(surface)
    return mentions


def extract_entity_mentions(
    snippet_text: Any,
    matcher: dict[str, list[dict[str, Any]]] | None = None,
) -> list[str]:
    text = visible_snippet_text(snippet_text)
    mentions = [match.group(1).strip(" ,.;:") for match in ENTITY_NAME_PATTERN.finditer(text)]
    mentions.extend(match.group(1).strip() for match in TICKER_REFERENCE_PATTERN.finditer(text))
    mentions.extend(
        match.group(1).strip(" ,.;:")
        for match in CAPITALIZED_ENTITY_PATTERN.finditer(text)
    )
    if matcher is not None:
        mentions.extend(matcher_surface_mentions(text, matcher))
    return unique_ordered(
        [
            mention
            for mention in mentions
            if mention and not entity_mention_looks_generic(mention)
        ]
    )


def numeric_score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    if not 0 <= score <= 1:
        return None
    return score


def resolve_snippet_target(
    snippet_text: Any,
    source_ticker: str | None,
    matcher: dict[str, list[dict[str, Any]]],
    *,
    preferred_mention: str | None = None,
    preferred_only: bool = False,
) -> dict[str, Any]:
    mentions: list[str] = []
    if preferred_mention and not entity_mention_looks_generic(preferred_mention):
        mentions.append(preferred_mention)
    if not preferred_only:
        mentions.extend(extract_entity_mentions(snippet_text, matcher))
    mentions = unique_ordered(mentions)
    matches: list[tuple[int, str, dict[str, Any]]] = []
    unresolved: list[str] = []

    for index, mention in enumerate(mentions):
        match = resolve_entity_mention(matcher, mention)
        if match is None:
            unresolved.append(mention)
            continue
        if source_ticker is not None and match["ticker"] == source_ticker:
            continue
        matches.append((index, mention, match))

    if matches:
        _, mention, match = sorted(
            matches,
            key=lambda item: (-item[2]["confidence"], item[0]),
        )[0]
        return {
            "target_ticker": match["ticker"],
            "target_name": match["name"],
            "target_match_method": match["method"],
            "target_match_confidence": match["confidence"],
            "target_entity_mention": mention,
        }

    return {
        "target_ticker": None,
        "target_name": None,
        "target_match_method": None,
        "target_match_confidence": None,
        "target_entity_mention": None,
        "unresolved_entity_mentions": unresolved,
    }


def mention_regex(mention: str) -> str:
    return re.escape(mention).replace(r"\ ", r"\s+")


def sector_term_pattern(term: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in term.split()]
    phrase = r"\s+".join(parts)
    return re.compile(rf"(?<![a-z0-9]){phrase}(?![a-z0-9])", re.IGNORECASE)


def clean_sector_target(value: str) -> str | None:
    target = " ".join(value.strip(" ,.;:()[]{}\"'").split())
    if len(target) == 1 or normalize_match_key(target) in {"a", "an", "the"}:
        return None
    if entity_mention_looks_generic(target):
        return None
    return target or None


def add_sector_target(
    targets: list[tuple[int, int, str]],
    *,
    quality: int,
    position: int,
    mention: str | None,
) -> None:
    if mention is None:
        return
    clean = clean_sector_target(mention)
    if clean is None:
        return
    targets.append((quality, position, clean))


def sector_targets_after(text: str, match_end: int) -> list[tuple[int, int, str]]:
    window = text[match_end : min(len(text), match_end + 240)]
    targets: list[tuple[int, int, str]] = []
    connector_pattern = re.compile(
        rf"^\W*(?:{RELATIONSHIP_CONNECTOR_PATTERN})\s+"
        rf"(?:an?\s+|the\s+)?(?P<target>{SECTOR_TARGET_FRAGMENT})\b",
        re.IGNORECASE,
    )
    match = connector_pattern.search(window)
    if match is not None:
        add_sector_target(
            targets,
            quality=0,
            position=match_end + match.start("target"),
            mention=match.group("target"),
        )

    indirect_pattern = re.compile(
        rf"\b(?:{RELATIONSHIP_CONNECTOR_PATTERN})\s+"
        rf"(?:an?\s+|the\s+)?(?P<target>{SECTOR_TARGET_FRAGMENT})\b",
        re.IGNORECASE,
    )
    for match in indirect_pattern.finditer(window[:160]):
        add_sector_target(
            targets,
            quality=1,
            position=match_end + match.start("target"),
            mention=match.group("target"),
        )
    return targets


def sector_targets_before(text: str, match_start: int) -> list[tuple[int, int, str]]:
    window_start = max(0, match_start - 220)
    window = text[window_start:match_start]
    targets: list[tuple[int, int, str]] = []
    fragment_pattern = re.compile(SECTOR_TARGET_FRAGMENT)
    allowed_gap_pattern = re.compile(
        r"^(?:'s|is|was|are|were|as|the|a|an|under|under\s+a|under\s+an|"
        r"pursuant\s+to|pursuant\s+to\s+an?|with|to|from|by|for|"
        r",|and|\(|\)|\s)*$",
        re.IGNORECASE,
    )
    for match in fragment_pattern.finditer(window):
        gap = window[match.end() :].strip()
        if len(gap) > 48 or allowed_gap_pattern.match(gap) is None:
            continue
        add_sector_target(
            targets,
            quality=0 if len(gap) <= 12 else 1,
            position=window_start + match.start("target")
            if "target" in match.groupdict()
            else window_start + match.start(),
            mention=match.group(0),
        )
    return targets[-3:]


def ticker_token_targets_near(
    text: str,
    match_start: int,
    match_end: int,
) -> list[tuple[int, int, str]]:
    window_start = max(0, match_start - 100)
    window = text[window_start : min(len(text), match_end + 100)]
    targets: list[tuple[int, int, str]] = []
    for match in UPPERCASE_TICKER_TOKEN_PATTERN.finditer(window):
        token = match.group(0).rstrip(".")
        if token in TICKER_TOKEN_STOP_WORDS:
            continue
        add_sector_target(
            targets,
            quality=2,
            position=window_start + match.start(),
            mention=token,
        )
    return targets


def sector_target_mentions_for_match(
    text: str,
    match_start: int,
    match_end: int,
    term: str,
    matcher: dict[str, list[dict[str, Any]]],
    source_ticker: str | None,
) -> list[str]:
    raw_targets = [
        *sector_targets_after(text, match_end),
    ]
    if term not in TERMS_REQUIRING_DIRECTIONAL_TARGET_AFTER:
        raw_targets.extend(sector_targets_before(text, match_start))
    ranked: list[tuple[int, int, float, str]] = []
    seen_mentions: set[str] = set()
    for quality, position, mention in raw_targets:
        key = normalize_match_key(mention)
        if not key or key in seen_mentions:
            continue
        seen_mentions.add(key)
        match = resolve_entity_mention(matcher, mention)
        if match is None:
            continue
        if (
            match.get("method") == "ticker_exact"
            and mention.upper() not in EXACT_TICKER_CONTEXT_ALLOWLIST
        ):
            continue
        if source_ticker is not None and match["ticker"] == source_ticker:
            continue
        distance = min(abs(position - match_start), abs(position - match_end))
        ranked.append((quality, distance, -float(match["confidence"]), mention))

    ranked.sort()
    return [mention for _, _, _, mention in ranked[:3]]


def sector_snippet_text(text: str, match_start: int, match_end: int) -> str:
    snippet_start = max(0, match_start - SECTOR_RELATIONSHIP_CONTEXT_CHARS)
    snippet_end = min(len(text), match_end + SECTOR_RELATIONSHIP_CONTEXT_CHARS)
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""
    return f"{prefix}{' '.join(text[snippet_start:snippet_end].split())}{suffix}"


def metadata_fields_for_cached_filing(filing_path: Path) -> dict[str, str]:
    metadata_summary = build_metadata_summary(filing_path, None)
    fields = metadata_summary.get("fields")
    if not isinstance(fields, dict):
        return {}
    return {
        key: value.strip()
        for key, value in fields.items()
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }


def sector_aware_snippets_for_file(
    raw_file: str,
    *,
    file_index: int,
    limit_chars: int | None,
    matcher: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    filing_path = resolve_cached_filing(raw_file)
    body = read_document(filing_path)
    decoded_text, _, _ = decode_document(body)
    sanitized_text = sanitize_text(decoded_text)
    scan_text = sanitized_text[:limit_chars] if limit_chars is not None else sanitized_text
    text = visible_snippet_text(scan_text)
    metadata_fields = metadata_fields_for_cached_filing(filing_path)
    source_ticker = source_ticker_from_metadata(metadata_fields)
    snippets: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, int]] = set()

    for term in SECTOR_AWARE_RELATIONSHIP_TERMS:
        rule = SECTOR_TERM_RULE_BY_TERM[term]
        for match in sector_term_pattern(term).finditer(text):
            context = sector_snippet_text(text, match.start(), match.end())
            if generic_relationship_noise_dominates(context):
                continue
            target_mentions = sector_target_mentions_for_match(
                text,
                match.start(),
                match.end(),
                term,
                matcher,
                source_ticker,
            )
            for target_mention in target_mentions:
                key = (
                    str(rule["relationship_type"]),
                    term,
                    normalize_match_key(target_mention),
                    match.start(),
                )
                if key in seen:
                    continue
                seen.add(key)
                snippets.append(
                    {
                        "rank": 0,
                        "type": rule["signal_type"],
                        "keyword": term,
                        "confidence_hint": rule["confidence_hint"],
                        "frequency": 1,
                        "filing_date": clean_optional_string(
                            metadata_fields.get("filing_date")
                        ),
                        "file": str(filing_path),
                        "file_index": file_index,
                        "offset": match.start(),
                        "metadata": metadata_fields,
                        "text_snippet": context,
                        "relationship_signal": term,
                        "relationship_type_hint": rule["relationship_type"],
                        "target_entity_mention_hint": target_mention,
                        "sector_hint": rule["sector"],
                        "extraction_method": "sector_aware_relationship_pattern",
                    }
                )
    return snippets


def sector_aware_snippets(
    raw_files: list[str],
    limit_chars: int | None,
    matcher: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    snippets: list[dict[str, Any]] = []
    for file_index, raw_file in enumerate(raw_files):
        snippets.extend(
            sector_aware_snippets_for_file(
                raw_file,
                file_index=file_index,
                limit_chars=limit_chars,
                matcher=matcher,
            )
        )
        if len(snippets) >= MAX_SECTOR_AWARE_SNIPPETS_TOTAL:
            break

    snippets.sort(
        key=lambda snippet: (
            -float(snippet.get("confidence_hint") or 0),
            str(snippet.get("filing_date") or ""),
            int(snippet.get("file_index") or 0),
            int(snippet.get("offset") or 0),
            str(snippet.get("keyword") or ""),
        )
    )
    for rank, snippet in enumerate(snippets[:MAX_SECTOR_AWARE_SNIPPETS_TOTAL], start=1):
        snippet["rank"] = rank
    return snippets[:MAX_SECTOR_AWARE_SNIPPETS_TOTAL]


def relationship_evidence_for_mention(text: str, mention: str) -> dict[str, str] | None:
    mention_pattern = mention_regex(mention)
    checks: tuple[tuple[str, str, str], ...] = (
        (
            "partnership",
            "agreement with",
            rf"\bagreement\s+with\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "partnership",
            "partnership with",
            rf"\bpartnerships?\s+with\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "partnership",
            "collaboration with",
            rf"\bcollaboration\s+with\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "partnership",
            "joint venture with",
            rf"\bjoint\s+venture\s+with\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "supplier_customer",
            "supplies",
            rf"(?<![A-Za-z0-9]){mention_pattern}\s+supplies\b",
        ),
        (
            "supplier_customer",
            "manufactured by",
            rf"\bmanufactured\s+by\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "supplier_customer",
            "components sourced from",
            rf"\bcomponents\s+sourced\s+from\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "supplier_customer",
            "revenue from",
            rf"\brevenue\s+from\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "supplier_customer",
            "accounted for revenue",
            rf"(?<![A-Za-z0-9]){mention_pattern}\s+accounted\s+for\s+"
            r"(?:approximately\s+|about\s+)?(?:\d+(?:\.\d+)?%|[A-Za-z-]+\s+percent)"
            r"\s+of\s+(?:net\s+)?revenue\b",
        ),
        (
            "investment",
            "investment in",
            rf"\binvestment\s+in\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
        (
            "investment",
            "ownership stake in",
            rf"\bownership\s+stake\s+in\s+(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])",
        ),
    )

    for relationship_type, signal, pattern in checks:
        if re.search(pattern, text, re.IGNORECASE):
            return {
                "relationship_type": normalize_relationship_type(relationship_type)
                or relationship_type,
                "relationship_signal": signal,
                "target_entity_mention_hint": mention,
            }

    for term in SECTOR_AWARE_RELATIONSHIP_TERMS:
        rule = SECTOR_TERM_RULE_BY_TERM[term]
        term_pattern = r"\s+".join(re.escape(part) for part in term.split())
        after_pattern = (
            rf"\b{term_pattern}\b.{{0,80}}\b(?:{RELATIONSHIP_CONNECTOR_PATTERN})\s+"
            rf"(?:an?\s+|the\s+)?{mention_pattern}(?![A-Za-z0-9])"
        )
        before_pattern = (
            rf"(?<![A-Za-z0-9]){mention_pattern}.{{0,80}}\b{term_pattern}\b"
        )
        if re.search(after_pattern, text, re.IGNORECASE) or re.search(
            before_pattern,
            text,
            re.IGNORECASE,
        ):
            return {
                "relationship_type": str(rule["relationship_type"]),
                "relationship_signal": term,
                "target_entity_mention_hint": mention,
            }
    return None


def relationship_evidence_for(
    snippet: dict[str, Any],
    matcher: dict[str, list[dict[str, Any]]],
) -> dict[str, str] | None:
    hint_type = clean_optional_string(snippet.get("relationship_type_hint"))
    hint_target = clean_optional_string(snippet.get("target_entity_mention_hint"))
    hint_signal = clean_optional_string(snippet.get("relationship_signal"))
    if hint_type and hint_target and not entity_mention_looks_generic(hint_target):
        normalized_hint_type = normalize_relationship_type(hint_type)
        if normalized_hint_type is None:
            return None
        return {
            "relationship_type": normalized_hint_type,
            "relationship_signal": hint_signal or str(snippet.get("keyword") or ""),
            "target_entity_mention_hint": hint_target,
        }

    text = visible_snippet_text(snippet.get("text_snippet"))
    for mention in extract_entity_mentions(text, matcher):
        evidence = relationship_evidence_for_mention(text, mention)
        if evidence is not None:
            return evidence
    return None


def xbrl_noise_metrics(snippet: dict[str, Any]) -> dict[str, Any]:
    text = str(snippet.get("text_snippet") or "")
    lower_text = text.lower()
    marker_count = sum(lower_text.count(marker) for marker in XBRL_NOISE_MARKERS)
    visible_text = visible_snippet_text(text)
    prose_words = [
        word.lower()
        for word in re.findall(r"\b[A-Za-z][A-Za-z-]{2,}\b", visible_text)
        if word.lower() not in XBRL_PROSE_STOP_WORDS
    ]
    starts_with_xbrl = bool(
        re.match(
            r"^\.*\s*(?:"
            r"<?/?(?:xbrli|ix):|"
            r"[a-z]*>xbrli:|"
            r"\"[^\"]+\"\s+(?:unitref|contextref|decimals|name|format|scale|id)=|"
            r"(?:unitref|contextref|decimals|name|format|scale|id)="
            r")",
            lower_text,
        )
    )
    dominated = (marker_count >= 3 and len(prose_words) < 14) or (
        marker_count >= 2 and starts_with_xbrl and len(prose_words) < 24
    ) or (
        marker_count >= 6 and starts_with_xbrl
    )
    return {
        "marker_count": marker_count,
        "has_marker": marker_count > 0,
        "is_dominated": dominated,
    }


def preview_ranked_snippets(snippets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scored = [
        (xbrl_noise_metrics(snippet), index, snippet)
        for index, snippet in enumerate(snippets)
    ]
    non_dominated = [
        (metrics, index, snippet)
        for metrics, index, snippet in scored
        if not metrics["is_dominated"]
    ]
    selected = non_dominated if non_dominated else scored
    selected.sort(
        key=lambda item: (
            item[0]["has_marker"],
            item[0]["marker_count"],
            item[2].get("rank", item[1]),
            item[1],
        )
    )
    return [snippet for _, _, snippet in selected]


def generic_relationship_noise_dominates(snippet_text: Any) -> bool:
    visible_text = visible_snippet_text(snippet_text)
    if relationship_term_hits(visible_text, ACCOUNTING_RELATIONSHIP_NOISE_TERMS):
        return True
    if not relationship_term_hits(visible_text, GENERIC_RELATIONSHIP_NOISE_TERMS):
        return bool(
            relationship_term_hits(visible_text, INTERNAL_OPERATIONS_NOISE_TERMS)
            and not relationship_term_hits(visible_text, GRAPH_WORTHY_SIGNAL_TERMS)
        )
    return not relationship_term_hits(visible_text, GRAPH_WORTHY_SIGNAL_TERMS)


def legal_only_relationship_noise_dominates(
    snippet_text: Any,
    relationship_signal: Any,
) -> bool:
    signal = clean_optional_string(relationship_signal)
    if signal not in GENERIC_AGREEMENT_SIGNALS:
        return False
    visible_text = visible_snippet_text(snippet_text)
    return bool(relationship_term_hits(visible_text, LEGAL_ONLY_RELATIONSHIP_NOISE_TERMS))


def candidate_has_required_resolution(candidate: dict[str, Any]) -> bool:
    if clean_optional_string(candidate.get("target_ticker")) is None:
        return False
    if clean_optional_string(candidate.get("target_name")) is None:
        return False
    if clean_optional_string(candidate.get("target_match_method")) is None:
        return False
    if clean_optional_string(candidate.get("target_entity_mention")) is None:
        return False

    confidence = numeric_score(candidate.get("target_match_confidence"))
    return (
        confidence is not None
        and confidence >= MIN_TARGET_MATCH_CONFIDENCE
    )


def candidate_is_graph_worthy(
    candidate: dict[str, Any],
    snippet: dict[str, Any],
) -> bool:
    confidence_hint = numeric_score(candidate.get("confidence_hint"))
    if confidence_hint is None or confidence_hint < MIN_CONFIDENCE_HINT:
        return False
    if xbrl_noise_metrics(snippet)["is_dominated"]:
        return False
    if generic_relationship_noise_dominates(candidate.get("evidence_snippet")):
        return False
    if legal_only_relationship_noise_dominates(
        candidate.get("evidence_snippet"),
        candidate.get("relationship_signal"),
    ):
        return False
    return candidate_has_required_resolution(candidate)


def candidate_from_snippet(
    snippet: dict[str, Any],
    matcher: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    metadata = snippet.get("metadata")
    metadata_fields = metadata if isinstance(metadata, dict) else {}
    source_ticker = source_ticker_from_metadata(metadata_fields)
    archive_url = clean_source_url(metadata_fields.get("archive_url"))
    source_urls = source_urls_from_metadata(metadata_fields)
    relationship_evidence = relationship_evidence_for(snippet, matcher)
    if relationship_evidence is None:
        return None

    target_resolution = resolve_snippet_target(
        snippet.get("text_snippet"),
        source_ticker,
        matcher,
        preferred_mention=relationship_evidence.get("target_entity_mention_hint"),
        preferred_only=clean_optional_string(snippet.get("target_entity_mention_hint")) is not None,
    )

    candidate = {
        "source_ticker": source_ticker,
        "target_ticker": target_resolution["target_ticker"],
        "target_name": target_resolution["target_name"],
        "target_match_method": target_resolution["target_match_method"],
        "target_match_confidence": target_resolution["target_match_confidence"],
        "target_entity_mention": target_resolution["target_entity_mention"],
        "relationship_type": relationship_evidence["relationship_type"],
        "relationship_signal": relationship_evidence["relationship_signal"],
        "source_type": "sec_filing",
        "source_tier": 1,
        "confidence_hint": snippet.get("confidence_hint"),
        "evidence_snippet": snippet.get("text_snippet"),
        "filing_date": clean_optional_string(snippet.get("filing_date")),
        "accession_number": clean_optional_string(metadata_fields.get("accession_number")),
        "review_status": "preview_only",
    }
    if archive_url is not None:
        candidate["archive_url"] = archive_url
    if source_urls:
        candidate["source_urls"] = source_urls
    unresolved = target_resolution.get("unresolved_entity_mentions")
    if unresolved:
        candidate["unresolved_entity_mentions"] = unresolved
    if not candidate_is_graph_worthy(candidate, snippet):
        return None
    return candidate


def build_preview(raw_files: list[str], limit_chars: int | None) -> dict[str, Any]:
    matcher = build_company_matcher()
    report = build_report(raw_files, limit_chars)
    source_snippets = report.get("candidate_snippets")
    if not isinstance(source_snippets, list) or not source_snippets:
        source_snippets = report["top_snippets"]
    expanded_snippets = [
        *source_snippets,
        *sector_aware_snippets(raw_files, limit_chars, matcher),
    ]
    ranked_snippets = preview_ranked_snippets(expanded_snippets)
    candidates: list[dict[str, Any]] = []
    candidates_by_source: Counter[str] = Counter()
    seen_candidate_keys: set[tuple[str, str, str]] = set()
    for snippet in ranked_snippets:
        candidate = candidate_from_snippet(snippet, matcher)
        if candidate is not None:
            source_ticker = str(candidate.get("source_ticker") or "")
            target_ticker = str(candidate.get("target_ticker") or "")
            relationship_type = str(candidate.get("relationship_type") or "")
            key = (
                source_ticker,
                target_ticker,
                relationship_type,
            )
            if key in seen_candidate_keys:
                continue
            if (
                source_ticker
                and candidates_by_source[source_ticker]
                >= MAX_PREVIEW_CANDIDATES_PER_SOURCE_TICKER
            ):
                continue
            seen_candidate_keys.add(key)
            candidates_by_source[source_ticker] += 1
            candidates.append(candidate)
            if len(candidates) >= MAX_PREVIEW_CANDIDATES_TOTAL:
                break

    return {
        "preview_type": "sec_signal_candidate_preview",
        "input_files": report["input_files"],
        "expected_cache_root": report["expected_cache_root"],
        "limit_chars_per_file": report["limit_chars_per_file"],
        "scanned_characters": report["scanned_characters"],
        "total_signals": report["total_signals"],
        "candidate_snippets_reviewed": len(ranked_snippets),
        "preview_candidate_count": len(candidates),
        "preview_candidates": candidates,
        "safety": dict(SAFETY_COUNTERS),
    }


def print_human(preview: dict[str, Any]) -> None:
    print("SEC signal candidate preview")
    print("============================")
    print(f"Files: {preview['input_files']}")
    print(f"Expected cache root: {preview['expected_cache_root']}")
    limit_chars = preview["limit_chars_per_file"]
    print(f"Limit chars per file: {limit_chars if limit_chars is not None else 'none'}")
    print(f"Scanned characters: {preview['scanned_characters']}")
    print(f"Total source signals: {preview['total_signals']}")
    print(f"Candidate snippets reviewed: {preview['candidate_snippets_reviewed']}")
    print(f"Preview candidates: {preview['preview_candidate_count']}")

    print()
    print("Preview objects")
    print("---------------")
    if not preview["preview_candidates"]:
        print("none")
    for candidate in preview["preview_candidates"]:
        print(json.dumps(candidate, sort_keys=True))

    print()
    print("Safety")
    print("------")
    for key, value in preview["safety"].items():
        print(f"- {key}: {value}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        preview = build_preview(args.files, args.limit_chars)
    except (CandidatePreviewError, FilingInspectError, SignalExtractionError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(preview, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
