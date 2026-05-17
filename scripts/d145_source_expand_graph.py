#!/usr/bin/env python3
"""D145 source-backed production graph expansion.

This script performs an additive, controlled enrichment pass over the static
production graph. It adds only real public source URLs, keeps candidate and
OpenAlex workflows review-only, and refuses duplicate production edges.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPANIES_PATH = ROOT / "data" / "companies.json"
DEFAULT_CONNECTIONS_PATH = ROOT / "data" / "connections.json"
URL_RE = re.compile(r"^https?://\S+$", re.IGNORECASE)
VERIFIED_DATE = date(2026, 5, 17).isoformat()


class D145ExpansionError(Exception):
    """Raised for clear D145 source expansion failures."""


SEC_ANNUAL_URLS: dict[str, str] = {
    "AAPL": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    "ABBV": "https://www.sec.gov/Archives/edgar/data/1551152/000155115226000008/abbv-20251231.htm",
    "AMAT": "https://www.sec.gov/Archives/edgar/data/6951/000162828025056742/amat-20251026.htm",
    "AMD": "https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm",
    "AMZN": "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm",
    "AVGO": "https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm",
    "AXP": "https://www.sec.gov/Archives/edgar/data/4962/000000496226000080/axp-20251231.htm",
    "BA": "https://www.sec.gov/Archives/edgar/data/12927/000162828026004357/ba-20251231.htm",
    "BAC": "https://www.sec.gov/Archives/edgar/data/70858/000007085826000157/bac-20251231.htm",
    "BRK-B": "https://www.berkshirehathaway.com/2025ar/202510-k.pdf",
    "CAT": "https://www.sec.gov/Archives/edgar/data/18230/000001823026000008/cat-20251231.htm",
    "CDNS": "https://www.sec.gov/Archives/edgar/data/813672/000081367226000016/cdns-20251231.htm",
    "CI": "https://www.sec.gov/Archives/edgar/data/1739940/000173994026000006/ci-20251231.htm",
    "COF": "https://www.sec.gov/Archives/edgar/data/927628/000092762826000024/cof-20251231.htm",
    "COP": "https://www.sec.gov/Archives/edgar/data/1163165/000116316526000009/cop-20251231.htm",
    "COST": "https://www.sec.gov/Archives/edgar/data/909832/000090983225000101/cost-20250831.htm",
    "CRM": "https://www.sec.gov/Archives/edgar/data/1108524/000110852426000060/crm-20260131.htm",
    "CVS": "https://www.sec.gov/Archives/edgar/data/64803/000006480326000010/cvs-20251231.htm",
    "CVX": "https://www.sec.gov/Archives/edgar/data/93410/000009341026000078/cvx-20251231.htm",
    "DE": "https://www.sec.gov/Archives/edgar/data/315189/000110465925122321/de-20251102x10k.htm",
    "GE": "https://www.sec.gov/Archives/edgar/data/40545/000004054526000008/ge-20251231.htm",
    "GOOGL": "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm",
    "HD": "https://www.sec.gov/Archives/edgar/data/354950/000162828026019436/hd-20260201.htm",
    "HON": "https://www.sec.gov/Archives/edgar/data/773840/000077384026000013/hon-20251231.htm",
    "INTC": "https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm",
    "ISRG": "https://www.sec.gov/Archives/edgar/data/1035267/000103526726000010/isrg-20251231.htm",
    "JNJ": "https://www.sec.gov/Archives/edgar/data/200406/000020040626000016/jnj-20251228.htm",
    "JPM": "https://www.sec.gov/Archives/edgar/data/19617/000162828026008131/jpm-20251231.htm",
    "KLAC": "https://www.sec.gov/Archives/edgar/data/319201/000031920125000024/klac-20250630.htm",
    "KO": "https://www.sec.gov/Archives/edgar/data/21344/000162828026010047/ko-20251231.htm",
    "LLY": "https://www.sec.gov/Archives/edgar/data/59478/000005947826000013/lly-20251231.htm",
    "LRCX": "https://www.sec.gov/Archives/edgar/data/707549/000070754925000075/lrcx-20250629.htm",
    "MA": "https://www.sec.gov/Archives/edgar/data/1141391/000114139126000013/ma-20251231.htm",
    "MCD": "https://www.sec.gov/Archives/edgar/data/63908/000006390826000035/mcd-20251231.htm",
    "META": "https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm",
    "MPWR": "https://www.sec.gov/Archives/edgar/data/1280452/000143774926006113/mpwr20251231_10k.htm",
    "MRK": "https://www.sec.gov/Archives/edgar/data/310158/000031015826000063/mrk-20251231.htm",
    "MRVL": "https://www.sec.gov/Archives/edgar/data/1835632/000183563226000011/mrvl-20260131.htm",
    "MSFT": "https://www.sec.gov/Archives/edgar/data/789019/000095017025100235/msft-20250630.htm",
    "MU": "https://www.sec.gov/Archives/edgar/data/723125/000072312525000028/mu-20250828.htm",
    "NOW": "https://www.sec.gov/Archives/edgar/data/1373715/000137371526000007/now-20251231.htm",
    "NVDA": "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm",
    "ORCL": "https://www.sec.gov/Archives/edgar/data/1341439/000095017025087926/orcl-20250531.htm",
    "PANW": "https://www.sec.gov/Archives/edgar/data/1327567/000132756725000027/panw-20250731.htm",
    "PFE": "https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm",
    "PYPL": "https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm",
    "QCOM": "https://www.sec.gov/Archives/edgar/data/804328/000080432825000085/qcom-20250928.htm",
    "RTX": "https://www.sec.gov/Archives/edgar/data/101829/000010182926000006/rtx-20251231.htm",
    "SLB": "https://www.sec.gov/Archives/edgar/data/87347/000119312526021017/slb-20251231.htm",
    "SNOW": "https://www.sec.gov/Archives/edgar/data/1640147/000164014726000008/snow-20260131.htm",
    "SNPS": "https://www.sec.gov/Archives/edgar/data/883241/000088324125000028/snps-20251031.htm",
    "TMO": "https://www.sec.gov/Archives/edgar/data/97745/000009774526000018/tmo-20251231.htm",
    "TSLA": "https://www.sec.gov/Archives/edgar/data/1318605/000162828026003952/tsla-20251231.htm",
    "UNH": "https://www.sec.gov/Archives/edgar/data/731766/000073176626000062/unh-20251231.htm",
    "V": "https://www.sec.gov/Archives/edgar/data/1403161/000140316125000089/v-20250930.htm",
    "WMT": "https://www.sec.gov/Archives/edgar/data/104169/000010416926000055/wmt-20260131.htm",
    "XOM": "https://www.sec.gov/Archives/edgar/data/34088/000003408826000045/xom-20251231.htm",
}

OFFICIAL_REPORT_URLS: dict[str, str] = {
    "ARM": "https://investors.arm.com/node/7681/html",
    "ASML": "https://www.asml.com/en/investors/annual-report",
    "TSM": "https://investor.tsmc.com/static/annualReports/2025/english/index.html",
}

DIRECT_PAIR_SOURCES: dict[tuple[str, str, str], list[str]] = {
    ("AMZN", "MRVL", "ecosystem"): [
        "https://www.marvell.com/company/newsroom/marvell-expands-strategic-collaboration-aws-enable-accelerated-infrastructure-ai-cloud.html",
    ],
    ("CRM", "SNOW", "ecosystem"): [
        "https://www.salesforce.com/partners/snowflake/",
        "https://www.salesforce.com/news/stories/salesforce-cdp-snowflake-partnership/",
    ],
    ("BA", "GE", "supply"): [
        "https://www.geaerospace.com/GE9X",
    ],
    ("BA", "HON", "supply"): [
        "https://aerospace.honeywell.com/us/en/products-and-services/aircraft/boeing",
    ],
    ("KO", "MCD", "supply"): [
        "https://www.mcdonalds.com/us/en-us/product/coca-cola-small.html",
    ],
    ("MSFT", "NOW", "ecosystem"): [
        "https://www.servicenow.com/company/media/press-room/microsoft-and-servicenow-announce-strategic-partnership.html",
    ],
    ("AMZN", "PANW", "partnership"): [
        "https://www.paloaltonetworks.com/partners/nextwave-for-csp/aws-and-palo-alto-networks",
    ],
    ("MSFT", "PANW", "partnership"): [
        "https://www.paloaltonetworks.com/partners/nextwave-for-csp/microsoft-azure-and-palo-alto-networks",
    ],
    ("COP", "SLB", "supply"): [
        "https://www.slb.com/newsroom/press-release/2022/pr-2022-03-07-conocophillips-delfi",
    ],
    ("CVX", "SLB", "supply"): [
        "https://www.slb.com/news-and-insights/newsroom/press-release/2019/pr-2019-0917-slb-sis-microsoft-chevron",
    ],
    ("JPM", "V", "ecosystem"): [
        "https://partners.jpmorgan.com/visa.html",
        "https://www.jpmorgan.com/solutions/commercial-card",
    ],
    ("BAC", "V", "ecosystem"): [
        "https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.9416.html",
        "https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/12/bofa-offers-exclusive-fifa-world-cup-2026--custom-card-design-an.html",
    ],
}

NEW_EDGES: list[dict[str, Any]] = [
    {
        "source_ticker": "MRVL",
        "target_ticker": "TSM",
        "type": "supply",
        "strength": 0.74,
        "label": "Advanced-node data infrastructure silicon manufacturing ecosystem",
        "confidence": 5,
        "provenance": "Company announcements, TSMC annual report, and SEC/company disclosures",
        "source_urls": [
            "https://investor.marvell.com/news-events/press-releases/detail/263/marvell-extends-data-infrastructure-leadership-with-tsmc-3nm-platform",
            "https://investor.tsmc.com/static/annualReports/2025/english/index.html",
        ],
    },
    {
        "source_ticker": "MRVL",
        "target_ticker": "NVDA",
        "type": "partnership",
        "strength": 0.7,
        "label": "NVLink Fusion custom silicon and AI networking ecosystem",
        "confidence": 5,
        "provenance": "Company announcements and AI infrastructure ecosystem disclosures",
        "source_urls": [
            "https://www.marvell.com/company/newsroom/nvidia-ai-ecosystem-expands-marvell-joins-forces-through-nvlink-fusion.html",
            "https://www.nvidia.com/en-us/data-center/nvlink-fusion/",
        ],
    },
    {
        "source_ticker": "SNPS",
        "target_ticker": "NVDA",
        "type": "partnership",
        "strength": 0.72,
        "label": "AI-accelerated EDA and engineering design collaboration",
        "confidence": 5,
        "provenance": "Company-announced strategic partnership",
        "source_urls": [
            "https://investor.synopsys.com/news/news-details/2025/NVIDIA-and-Synopsys-Announce-Strategic-Partnership-to-Revolutionize-Engineering-and-Design/default.aspx",
        ],
    },
    {
        "source_ticker": "MSFT",
        "target_ticker": "SNOW",
        "type": "partnership",
        "strength": 0.66,
        "label": "Azure AI and Snowflake Data Cloud partnership",
        "confidence": 5,
        "provenance": "Company-announced cloud and AI partnership",
        "source_urls": [
            "https://www.snowflake.com/en/news/press-releases/snowflake-expands-partnership-with-microsoft-to-bring-large-scale-generative-ai-models-and-increased-machine-learning-capabilities-to-the-data-cloud-2/",
        ],
    },
    {
        "source_ticker": "MSFT",
        "target_ticker": "CRM",
        "type": "ecosystem",
        "strength": 0.62,
        "label": "Enterprise customer data and productivity workflow ecosystem",
        "confidence": 4,
        "provenance": "SEC filings and enterprise software ecosystem disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "AMZN",
        "target_ticker": "META",
        "type": "competitor",
        "strength": 0.7,
        "label": "Digital advertising, AI infrastructure, and platform competition",
        "confidence": 4,
        "provenance": "SEC annual reports and market structure disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "GOOGL",
        "target_ticker": "ORCL",
        "type": "competitor",
        "strength": 0.66,
        "label": "Enterprise cloud infrastructure competition",
        "confidence": 4,
        "provenance": "SEC annual reports and cloud infrastructure competition disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "MSFT",
        "target_ticker": "AAPL",
        "type": "competitor",
        "strength": 0.64,
        "label": "Operating system, productivity, device, and services competition",
        "confidence": 4,
        "provenance": "SEC annual reports and platform competition disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "LLY",
        "target_ticker": "JNJ",
        "type": "competitor",
        "strength": 0.54,
        "label": "Large-cap pharmaceutical and medtech portfolio competition",
        "confidence": 4,
        "provenance": "SEC annual reports and healthcare market competition disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "MRK",
        "target_ticker": "ABBV",
        "type": "competitor",
        "strength": 0.56,
        "label": "Large-cap pharmaceutical portfolio and immunology competition",
        "confidence": 4,
        "provenance": "SEC annual reports and pharmaceutical portfolio competition disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "JNJ",
        "target_ticker": "PFE",
        "type": "competitor",
        "strength": 0.54,
        "label": "Large-cap pharmaceutical and healthcare portfolio competition",
        "confidence": 4,
        "provenance": "SEC annual reports and healthcare market competition disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "AXP",
        "target_ticker": "JPM",
        "type": "ecosystem",
        "strength": 0.6,
        "label": "Issuer, card spend, and commercial payments ecosystem",
        "confidence": 4,
        "provenance": "SEC annual reports and payments infrastructure disclosures",
        "source_urls": [],
    },
    {
        "source_ticker": "MA",
        "target_ticker": "COF",
        "type": "ecosystem",
        "strength": 0.62,
        "label": "Card issuing and global payment network ecosystem",
        "confidence": 4,
        "provenance": "SEC annual reports and payments infrastructure disclosures",
        "source_urls": [],
    },
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run D145 source-backed graph expansion.")
    parser.add_argument("--companies", default=str(DEFAULT_COMPANIES_PATH))
    parser.add_argument("--connections", default=str(DEFAULT_CONNECTIONS_PATH))
    parser.add_argument("--write", action="store_true", help="Write updated production connections.")
    parser.add_argument("--json", action="store_true", help="Print JSON summary.")
    return parser.parse_args(argv)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, indent=2)
        file.write("\n")


def normalize_pair(left: str, right: str, edge_type: str) -> tuple[str, str, str]:
    first, second = sorted([left.upper(), right.upper()])
    return first, second, edge_type


def unique_urls(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw_url in urls:
        url = str(raw_url).strip()
        if not url or url in seen:
            continue
        if not URL_RE.match(url):
            raise D145ExpansionError(f"invalid source URL: {url!r}")
        seen.add(url)
        cleaned.append(url)
    return cleaned


def ticker_source_urls(ticker: str) -> list[str]:
    urls = []
    if ticker in SEC_ANNUAL_URLS:
        urls.append(SEC_ANNUAL_URLS[ticker])
    if ticker in OFFICIAL_REPORT_URLS:
        urls.append(OFFICIAL_REPORT_URLS[ticker])
    return urls


def source_urls_for_edge(source_ticker: str, target_ticker: str, edge_type: str) -> list[str]:
    key = normalize_pair(source_ticker, target_ticker, edge_type)
    urls = list(DIRECT_PAIR_SOURCES.get(key, []))
    urls.extend(ticker_source_urls(source_ticker))
    urls.extend(ticker_source_urls(target_ticker))
    return unique_urls(urls)


def edge_confidence(edge_type: str, source_urls: list[str]) -> int:
    if not source_urls:
        return 3
    if edge_type in {"supply", "partnership", "investment"}:
        return 5
    return 4


def build_existing_key(edge: dict[str, Any], id_to_ticker: dict[int, str]) -> tuple[str, str, str]:
    source_ticker = id_to_ticker[int(edge["source"])]
    target_ticker = id_to_ticker[int(edge["target"])]
    return normalize_pair(source_ticker, target_ticker, str(edge.get("type") or ""))


def validate_no_duplicates(connections: list[dict[str, Any]], id_to_ticker: dict[int, str]) -> None:
    seen: set[tuple[str, str, str]] = set()
    for index, edge in enumerate(connections, start=1):
        key = build_existing_key(edge, id_to_ticker)
        if key in seen:
            raise D145ExpansionError(f"duplicate edge {key} at connection {index}")
        seen.add(key)


def validate_sources(connections: list[dict[str, Any]]) -> None:
    for index, edge in enumerate(connections, start=1):
        urls = edge.get("source_urls")
        if urls is None:
            continue
        if not isinstance(urls, list):
            raise D145ExpansionError(f"connection {index} source_urls must be a list")
        for url in urls:
            if not isinstance(url, str) or not URL_RE.match(url.strip()):
                raise D145ExpansionError(f"connection {index} has invalid URL {url!r}")


def run_expansion(companies_path: Path, connections_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    companies = load_json(companies_path)
    connections = load_json(connections_path)
    if not isinstance(companies, list) or not isinstance(connections, list):
        raise D145ExpansionError("companies and connections must be JSON arrays")

    id_to_ticker = {int(company["id"]): str(company["ticker"]).upper() for company in companies}
    ticker_to_id = {ticker: company_id for company_id, ticker in id_to_ticker.items()}
    validate_no_duplicates(connections, id_to_ticker)

    enriched_edges = 0
    source_urls_added = 0
    updated_pair_keys: list[str] = []

    for edge in connections:
        source_ticker = id_to_ticker[int(edge["source"])]
        target_ticker = id_to_ticker[int(edge["target"])]
        existing_urls = edge.get("source_urls")
        if isinstance(existing_urls, list) and existing_urls:
            direct_urls = DIRECT_PAIR_SOURCES.get(normalize_pair(source_ticker, target_ticker, str(edge.get("type") or "")), [])
            if direct_urls:
                merged_urls = unique_urls([*direct_urls, *existing_urls])
                if len(merged_urls) > len(existing_urls):
                    edge["source_urls"] = merged_urls
                    edge["verified_date"] = VERIFIED_DATE
                    enriched_edges += 1
                    source_urls_added += len(merged_urls) - len(existing_urls)
                    updated_pair_keys.append("-".join(normalize_pair(source_ticker, target_ticker, str(edge.get("type") or ""))))
            continue

        urls = source_urls_for_edge(source_ticker, target_ticker, str(edge.get("type") or ""))
        if not urls:
            continue
        edge["source_urls"] = urls
        edge["confidence"] = max(int(edge.get("confidence") or 3), edge_confidence(str(edge.get("type") or ""), urls))
        edge["verified_date"] = VERIFIED_DATE
        if "provenance" not in edge or "source" not in str(edge.get("provenance", "")).lower():
            edge["provenance"] = f"{edge.get('provenance') or 'Curated relationship'}; source coverage refreshed in D145"
        enriched_edges += 1
        source_urls_added += len(urls)
        updated_pair_keys.append("-".join(normalize_pair(source_ticker, target_ticker, str(edge.get("type") or ""))))

    existing_keys = {build_existing_key(edge, id_to_ticker) for edge in connections}
    added_edges = 0
    skipped_edges: list[str] = []

    for new_edge in NEW_EDGES:
        source_ticker = str(new_edge["source_ticker"]).upper()
        target_ticker = str(new_edge["target_ticker"]).upper()
        edge_type = str(new_edge["type"])
        if source_ticker not in ticker_to_id or target_ticker not in ticker_to_id:
            raise D145ExpansionError(f"new edge endpoint missing from production universe: {source_ticker}-{target_ticker}")

        key = normalize_pair(source_ticker, target_ticker, edge_type)
        if key in existing_keys:
            skipped_edges.append("-".join(key))
            continue

        urls = unique_urls(list(new_edge.get("source_urls") or []) + ticker_source_urls(source_ticker) + ticker_source_urls(target_ticker))
        if not urls:
            raise D145ExpansionError(f"new edge {key} requires source URLs")
        edge = {
            "source": ticker_to_id[source_ticker],
            "target": ticker_to_id[target_ticker],
            "type": edge_type,
            "strength": float(new_edge["strength"]),
            "label": str(new_edge["label"]),
            "confidence": int(new_edge.get("confidence") or edge_confidence(edge_type, urls)),
            "provenance": str(new_edge["provenance"]),
            "source_urls": urls,
            "verified_date": VERIFIED_DATE,
        }
        connections.append(edge)
        existing_keys.add(key)
        added_edges += 1

    validate_no_duplicates(connections, id_to_ticker)
    validate_sources(connections)

    summary = {
        "phase": "D145",
        "verified_date": VERIFIED_DATE,
        "production_edges_after": len(connections),
        "source_refreshed_edges": enriched_edges,
        "source_urls_added_to_existing_edges": source_urls_added,
        "production_edges_added": added_edges,
        "new_edge_duplicates_skipped": skipped_edges,
        "source_backed_edge_count_after": sum(1 for edge in connections if edge.get("source_urls")),
        "unsourced_edge_count_after": sum(1 for edge in connections if not edge.get("source_urls")),
        "updated_existing_pair_keys": updated_pair_keys,
        "candidate_auto_promotion": False,
        "browser_ingestion": False,
    }
    return connections, summary


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    companies_path = Path(args.companies).resolve()
    connections_path = Path(args.connections).resolve()
    try:
        connections, summary = run_expansion(companies_path, connections_path)
        if args.write:
            write_json(connections_path, connections)
    except D145ExpansionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        json.dump(summary, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print("D145 source graph expansion")
        print("===========================")
        print(f"Existing edges enriched: {summary['source_refreshed_edges']}")
        print(f"Production edges added: {summary['production_edges_added']}")
        print(f"Source-backed edges after: {summary['source_backed_edge_count_after']}")
        print(f"Unsourced edges after: {summary['unsourced_edge_count_after']}")
        print(f"Candidate auto-promotion: {summary['candidate_auto_promotion']}")
        print(f"Browser ingestion: {summary['browser_ingestion']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
