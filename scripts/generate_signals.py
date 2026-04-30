#!/usr/bin/env python3
"""
Generate structured connection signals from simulated external inputs.

This module prints candidate records in the raw format expected by
scripts/enrich_connections.py. It does not write dataset files and does not
invoke the enrichment script.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COMPANIES_PATH = ROOT / "data" / "companies.json"

RAW_INPUTS: list[dict[str, str]] = [
    {
        "text": "Microsoft expands Azure AI infrastructure using NVIDIA GPUs",
        "source_url": "https://nvidianews.nvidia.com/news/microsoft-nvidia-generative-ai-enterprises",
        "source_type": "news",
    },
    {
        "text": "Google Cloud and ServiceNow expand integration for enterprise AI workflows",
        "source_url": "https://newsroom.servicenow.com/press-releases/details/2025/ServiceNow-and-Google-Cloud-Expand-Partnership-to-Deliver-AI-powered-Tools-to-Millions-of-Users-01-29-2025-traffic/default.aspx",
        "source_type": "announcement",
    },
    {
        "text": "TSMC manufactures advanced AI chips for NVIDIA Blackwell systems",
        "source_url": "https://nvidianews.nvidia.com/news/nvidia-blackwell-platform-arrives-to-power-a-new-era-of-computing",
        "source_type": "announcement",
    },
    {
        "text": "Snowflake partners with Microsoft to integrate Cortex agents with Teams and Copilot",
        "source_url": "https://www.snowflake.com/en/why-snowflake/partners/all-partners/microsoft/",
        "source_type": "partner_page",
    },
    {
        "text": "Salesforce runs on AWS services for Customer 360 applications",
        "source_url": "https://www.salesforce.com/news/press-releases/2021/06/23/salesforce-aws-partnership-expansion/",
        "source_type": "news",
    },
    {
        "text": "Micron supplies HBM memory for NVIDIA AI accelerator platforms",
        "source_url": "https://investors.micron.com/news-releases/news-release-details/micron-high-volume-production-hbm4-designed-nvidia-vera-rubin",
        "source_type": "company_release",
    },
]

COMPANY_ALIASES: dict[str, str] = {
    "advanced micro devices": "AMD",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "amazon web services": "AMZN",
    "applied materials": "AMAT",
    "arm": "ARM",
    "asml": "ASML",
    "aws": "AMZN",
    "azure": "MSFT",
    "broadcom": "AVGO",
    "cadence": "CDNS",
    "google": "GOOGL",
    "google cloud": "GOOGL",
    "intel": "INTC",
    "lam research": "LRCX",
    "marvell": "MRVL",
    "microsoft": "MSFT",
    "micron": "MU",
    "nvidia": "NVDA",
    "oracle": "ORCL",
    "palo alto networks": "PANW",
    "salesforce": "CRM",
    "servicenow": "NOW",
    "snowflake": "SNOW",
    "synopsys": "SNPS",
    "taiwan semiconductor": "TSM",
    "tsmc": "TSM",
}

TYPE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("partnership", ("partners", "partnership", "integration", "integrates", "integrated")),
    ("ecosystem", ("uses", "using", "runs on", "powered by", "deploys", "builds on")),
    ("supply", ("supplies", "manufactures", "fabricates")),
)

STRONG_STRENGTH_KEYWORDS: tuple[str, ...] = (
    "accelerates",
    "advanced",
    "expand",
    "deepens",
    "expands",
    "manufactures",
    "powers",
    "strategic",
    "supplies",
)

MODERATE_STRENGTH_KEYWORDS: tuple[str, ...] = (
    "available",
    "integrates",
    "integration",
    "partners",
    "runs on",
    "supports",
    "uses",
    "using",
)

SOURCE_TIERS: dict[str, int] = {
    "sec_filing": 1,
    "company_release": 1,
    "announcement": 1,
    "news": 2,
    "partner_page": 2,
    "unknown": 3,
}

SIGNAL_BASE_SCORES: dict[int, float] = {
    1: 0.9,
    2: 0.75,
    3: 0.6,
}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def normalize_text(value: str) -> str:
    return " ".join(value.strip().lower().split())


def simplify_company_name(name: str) -> str:
    normalized = normalize_text(name)
    normalized = re.sub(r"[.,]", "", normalized)
    normalized = re.sub(
        r"\b(corporation|incorporated|inc|company|limited|plc|nv|co)\b",
        "",
        normalized,
    )
    return " ".join(normalized.split())


def build_company_aliases(companies: Any) -> dict[str, str]:
    if not isinstance(companies, list):
        raise ValueError("data/companies.json must contain a JSON array.")

    aliases = dict(COMPANY_ALIASES)
    for index, company in enumerate(companies):
        if not isinstance(company, dict):
            raise ValueError(f"Company {index}: record must be an object.")

        ticker = company.get("ticker")
        name = company.get("name")
        if not isinstance(ticker, str) or not ticker.strip():
            raise ValueError(f"Company {index}: ticker must be a non-empty string.")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Company {index}: name must be a non-empty string.")

        normalized_ticker = ticker.strip().upper()
        if len(normalized_ticker) > 1:
            aliases[normalized_ticker.lower()] = normalized_ticker

        aliases[normalize_text(name)] = normalized_ticker
        simplified_name = simplify_company_name(name)
        if simplified_name:
            aliases[simplified_name] = normalized_ticker

    return aliases


def phrase_pattern(phrase: str) -> re.Pattern[str]:
    escaped = re.escape(phrase)
    return re.compile(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", re.IGNORECASE)


def detect_tickers(text: str, aliases: dict[str, str]) -> list[str]:
    mentions: list[tuple[int, str]] = []

    for phrase, ticker in aliases.items():
        for match in phrase_pattern(phrase).finditer(text):
            mentions.append((match.start(), ticker))

    ordered_tickers: list[str] = []
    seen: set[str] = set()
    for _, ticker in sorted(mentions, key=lambda item: item[0]):
        if ticker not in seen:
            ordered_tickers.append(ticker)
            seen.add(ticker)

    return ordered_tickers


def infer_connection_type(text: str) -> str:
    normalized = normalize_text(text)
    for connection_type, keywords in TYPE_KEYWORDS:
        if any(contains_keyword(normalized, keyword) for keyword in keywords):
            return connection_type
    return "ecosystem"


def assign_strength(text: str) -> float:
    normalized = normalize_text(text)
    if any(contains_keyword(normalized, keyword) for keyword in STRONG_STRENGTH_KEYWORDS):
        return 0.82
    if any(contains_keyword(normalized, keyword) for keyword in MODERATE_STRENGTH_KEYWORDS):
        return 0.68
    return 0.6


def normalize_source_type(source_type: str) -> str:
    normalized = normalize_text(source_type).replace(" ", "_")
    if normalized in SOURCE_TIERS:
        return normalized
    return "unknown"


def source_tier(source_type: str) -> int:
    return SOURCE_TIERS[normalize_source_type(source_type)]


def assign_signal_score(text: str, source_type: str) -> float:
    normalized = normalize_text(text)
    tier = source_tier(source_type)
    score = SIGNAL_BASE_SCORES[tier]
    if any(contains_keyword(normalized, keyword) for keyword in STRONG_STRENGTH_KEYWORDS):
        score += 0.05
    return round(min(max(score, 0.6), 0.95), 2)


def contains_keyword(text: str, keyword: str) -> bool:
    escaped = re.escape(keyword)
    return bool(re.search(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", text))


def clean_label(text: str) -> str:
    label = re.sub(r"\s+", " ", text.strip())
    label = label.strip(" .")
    if len(label) > 96:
        label = label[:93].rstrip() + "..."
    if not label:
        return "Parsed external source signal"
    return label[0].upper() + label[1:]


def validate_raw_input(raw_input: dict[str, str], index: int) -> None:
    for field_name in ("text", "source_url", "source_type"):
        value = raw_input.get(field_name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Raw input {index}: {field_name} must be a non-empty string.")
    if not raw_input["source_url"].startswith(("http://", "https://")):
        raise ValueError(f"Raw input {index}: source_url must start with http:// or https://.")


def build_signal(raw_input: dict[str, str], aliases: dict[str, str], index: int) -> dict[str, Any]:
    validate_raw_input(raw_input, index)

    tickers = detect_tickers(raw_input["text"], aliases)
    if len(tickers) < 2:
        raise ValueError(
            f"Raw input {index}: expected at least two known companies, found {tickers}."
        )

    source_ticker, target_ticker = tickers[:2]
    source_type = normalize_source_type(raw_input["source_type"])
    tier = source_tier(source_type)

    return {
        "source_ticker": source_ticker,
        "target_ticker": target_ticker,
        "type": infer_connection_type(raw_input["text"]),
        "label": clean_label(raw_input["text"]),
        "strength": assign_strength(raw_input["text"]),
        "signal_score": assign_signal_score(raw_input["text"], source_type),
        "source_meta": {
            "tier": tier,
            "type": source_type,
        },
        "provenance": (
            f"Generated from simulated {source_type.replace('_', ' ')} input before ingestion."
        ),
        "source_urls": [raw_input["source_url"].strip()],
    }


def generate_signals(raw_inputs: list[dict[str, str]]) -> list[dict[str, Any]]:
    aliases = build_company_aliases(load_json(COMPANIES_PATH))
    return [
        build_signal(raw_input, aliases, index)
        for index, raw_input in enumerate(raw_inputs)
    ]


def print_preview(signals: list[dict[str, Any]]) -> None:
    print(f"Generated {len(signals)} signal(s).")
    for signal in signals:
        print(
            "- "
            f"{signal['source_ticker']} -> {signal['target_ticker']} "
            f"({signal['type']}, strength {signal['strength']}, "
            f"score {signal['signal_score']}): "
            f"{signal['label']}"
        )
    print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate structured StockPhotonic connection signals."
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Print a short summary before the generated signal JSON.",
    )
    args = parser.parse_args()

    signals = generate_signals(RAW_INPUTS)
    if args.preview:
        print_preview(signals)

    print(json.dumps(signals, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
