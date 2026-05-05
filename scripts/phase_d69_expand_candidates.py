#!/usr/bin/env python3
"""Expand candidate-only SEC coverage for Phase D69 stress testing.

The script uses the SEC company tickers exchange dataset as the source of
record for ticker, name, exchange, and CIK values. It updates only candidate
files and the local SEC job manifest; production graph files are never read for
write.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_TICKER_UNIVERSE_PATH = ROOT / "data" / "candidates" / "official_ticker_universe.json"
CIK_MAPPINGS_PATH = ROOT / "data" / "candidates" / "cik_mappings.json"
SEC_JOBS_PATH = ROOT / "data" / "candidates" / "sec_jobs.json"
PRODUCTION_COMPANIES_PATH = ROOT / "data" / "companies.json"
PRODUCTION_CONNECTIONS_PATH = ROOT / "data" / "connections.json"

SEC_COMPANY_TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"

SECTOR_TICKERS: dict[str, list[str]] = {
    "broader_tech": [
        "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AMD", "INTC", "AVGO",
        "ORCL", "CRM", "ADBE", "CSCO", "QCOM", "TXN", "MU", "AMAT", "LRCX",
        "KLAC", "ADI", "NXPI", "MCHP", "MRVL", "CDNS", "SNPS", "ANSS", "ROP",
        "ADSK", "INTU", "NOW", "PANW", "FTNT", "CRWD", "DDOG", "NET", "SNOW",
        "PLTR", "MDB", "ZS", "OKTA", "TEAM", "WDAY", "SHOP", "UBER", "ABNB",
        "DASH", "PYPL", "SQ", "FIS", "FI", "GPN", "AKAM", "GEN", "KEYS",
        "TEL", "APH", "GLW", "ON", "MPWR", "TER", "SWKS", "QRVO", "WDC",
        "STX", "HPQ", "DELL", "IBM", "HPE", "NTAP", "TYL", "PTC", "VRSN",
        "CDW", "IT", "GDDY", "DOCU", "PATH", "SMCI",
    ],
    "healthcare": [
        "UNH", "LLY", "JNJ", "ABBV", "MRK", "PFE", "TMO", "ABT", "DHR", "AMGN",
        "GILD", "BMY", "CVS", "CI", "HUM", "ELV", "ISRG", "SYK", "MDT", "BSX",
        "ZBH", "EW", "BDX", "IDXX", "REGN", "VRTX", "BIIB", "ILMN", "ALGN",
        "DXCM", "MRNA", "IQV", "A", "RMD", "STE", "WST", "MTD", "HOLX", "TECH",
        "WAT", "COO", "BAX", "VTRS", "ZTS", "CAH", "MCK", "COR", "CNC", "MOH",
        "LH", "DGX", "UHS", "HCA", "TFX", "PODD", "RVTY", "GEHC", "BMRN",
        "INCY", "EXAS", "ALNY",
    ],
    "industrials": [
        "GE", "CAT", "HON", "RTX", "LMT", "BA", "DE", "UNP", "UPS", "FDX",
        "WM", "ETN", "EMR", "ITW", "PH", "CMI", "ROK", "OTIS", "CARR", "JCI",
        "TT", "IR", "XYL", "AME", "DOV", "FTV", "IEX", "PNR", "NDSN", "SWK",
        "MAS", "ALLE", "GNRC", "URI", "PCAR", "WAB", "CSX", "NSC", "ODFL",
        "JBHT", "CHRW", "EXPD", "DAL", "UAL", "LUV", "AAL", "TDG", "TXT",
        "NOC", "GD", "HII", "HWM", "AXON", "PAYX", "ADP", "CTAS", "FAST",
        "GWW", "RSG", "VRSK", "EFX",
    ],
    "energy": [
        "XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "OXY", "KMI",
        "OKE", "WMB", "BKR", "HAL", "FANG", "DVN", "HES", "APA", "CTRA",
        "EQT", "TRGP", "MRO", "PR", "TPL", "LNG", "CHX", "NOV", "FTI",
        "RRC", "MTDR", "VNOM", "AR", "CHRD", "SUN", "PAA", "ET", "EPD",
        "MPLX", "ENB", "TRP", "SU", "CNQ", "IMO", "TTE", "SHEL", "BP",
    ],
    "financials": [
        "JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "AXP", "SCHW", "PNC",
        "USB", "TFC", "COF", "BK", "STT", "NTRS", "RF", "CFG", "FITB", "HBAN",
        "KEY", "MTB", "CMA", "ZION", "SYF", "DFS", "V", "MA", "ICE", "CME",
        "NDAQ", "SPGI", "MCO", "MSCI", "CBOE", "AON", "MMC", "AJG", "BRO",
        "AIG", "CB", "TRV", "ALL", "PGR", "HIG", "CINF", "WRB", "RJF",
        "AMP", "TROW", "BEN", "IVZ", "BX", "KKR", "APO", "ARES", "OWL",
    ],
    "additional_sp500_like": [
        "WMT", "COST", "HD", "LOW", "TGT", "TJX", "ROST", "SBUX", "MCD", "YUM",
        "CMG", "DPZ", "NKE", "LULU", "F", "GM", "TSLA", "RIVN", "LCID",
        "PEP", "KO", "KDP", "MNST", "MDLZ", "GIS", "K", "KHC", "CPB", "HSY",
        "CL", "PG", "EL", "CLX", "KMB", "CHD", "PM", "MO", "TAP", "STZ",
        "DIS", "NFLX", "CMCSA", "CHTR", "PARA", "WBD", "TMUS", "VZ", "T",
        "EA", "TTWO", "LYV", "OMC", "IPG", "BKNG", "EXPE", "MAR", "HLT",
        "RCL", "CCL", "NCLH", "AAL", "DAL", "UAL",
    ],
}

JOB_DEFINITIONS = (
    (
        "phase_d69_broader_tech_healthcare",
        "Phase D69 broader technology plus healthcare SEC relationship scan.",
        ["broader_tech", "healthcare"],
        3,
    ),
    (
        "phase_d69_industrials_energy_financials",
        "Phase D69 industrials, energy, and financials SEC relationship scan.",
        ["industrials", "energy", "financials"],
        3,
    ),
    (
        "phase_d69_large_scale_mix",
        "Phase D69 large-scale mixed-sector SEC relationship scan for visualization stress testing.",
        ["broader_tech", "healthcare", "industrials", "energy", "financials", "additional_sp500_like"],
        2,
    ),
)


class PhaseD69ExpansionError(Exception):
    """Raised for clear candidate expansion failures."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--user-agent",
        required=True,
        help="Identifying SEC User-Agent for the official company tickers fetch.",
    )
    parser.add_argument(
        "--capture-date",
        default=date.today().isoformat(),
        help="Capture date for generated candidate records. Default: today.",
    )
    parser.add_argument(
        "--max-candidate-companies",
        type=int,
        default=320,
        help="Maximum non-production ticker candidates to stage. Default: 320.",
    )
    return parser.parse_args(argv)


def load_json(path: Path, label: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except OSError as exc:
        raise PhaseD69ExpansionError(f"could not read {label} file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PhaseD69ExpansionError(f"could not parse {label} file {path}: {exc}") from exc


def write_json(path: Path, payload: Any) -> None:
    try:
        with path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
            file.write("\n")
    except OSError as exc:
        raise PhaseD69ExpansionError(f"could not write {path}: {exc}") from exc


def production_hashes() -> dict[Path, bytes]:
    return {
        PRODUCTION_COMPANIES_PATH: PRODUCTION_COMPANIES_PATH.read_bytes(),
        PRODUCTION_CONNECTIONS_PATH: PRODUCTION_CONNECTIONS_PATH.read_bytes(),
    }


def assert_production_unchanged(initial: dict[Path, bytes]) -> None:
    changed = [
        str(path.relative_to(ROOT))
        for path, content in initial.items()
        if path.read_bytes() != content
    ]
    if changed:
        raise PhaseD69ExpansionError(
            "production data changed unexpectedly: " + ", ".join(changed)
        )


def fetch_sec_company_tickers_exchange(user_agent: str) -> dict[str, dict[str, Any]]:
    request = urllib.request.Request(
        SEC_COMPANY_TICKERS_EXCHANGE_URL,
        headers={"User-Agent": user_agent, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    fields = payload.get("fields")
    rows = payload.get("data")
    if not isinstance(fields, list) or not isinstance(rows, list):
        raise PhaseD69ExpansionError("SEC company tickers exchange payload has unexpected shape.")

    field_index = {str(field): index for index, field in enumerate(fields)}
    required = {"cik", "name", "ticker", "exchange"}
    missing = sorted(required - set(field_index))
    if missing:
        raise PhaseD69ExpansionError(
            "SEC company tickers exchange payload missing fields: " + ", ".join(missing)
        )

    by_ticker: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, list):
            continue
        try:
            ticker = str(row[field_index["ticker"]]).strip().upper()
            name = str(row[field_index["name"]]).strip()
            exchange = str(row[field_index["exchange"]]).strip()
            cik = int(row[field_index["cik"]])
        except (IndexError, TypeError, ValueError):
            continue
        if ticker and name and exchange and cik > 0:
            by_ticker[ticker] = {
                "ticker": ticker,
                "name": name,
                "exchange": exchange,
                "cik": str(cik).zfill(10),
            }
    return by_ticker


def ordered_target_tickers() -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for tickers in SECTOR_TICKERS.values():
        for ticker in tickers:
            normalized = ticker.strip().upper()
            if normalized and normalized not in seen:
                seen.add(normalized)
                ordered.append(normalized)
    return ordered


def load_production_tickers() -> set[str]:
    companies = load_json(PRODUCTION_COMPANIES_PATH, "production companies")
    if not isinstance(companies, list):
        raise PhaseD69ExpansionError("production companies file must contain an array.")
    return {
        str(company.get("ticker")).strip().upper()
        for company in companies
        if isinstance(company, dict) and str(company.get("ticker") or "").strip()
    }


def update_official_ticker_universe(
    *,
    sec_by_ticker: dict[str, dict[str, Any]],
    production_tickers: set[str],
    capture_date: str,
    max_candidate_companies: int,
) -> int:
    payload = load_json(OFFICIAL_TICKER_UNIVERSE_PATH, "official ticker universe")
    if not isinstance(payload, dict) or not isinstance(payload.get("candidates"), list):
        raise PhaseD69ExpansionError("official ticker universe file has unexpected shape.")

    existing_by_ticker = {
        str(candidate.get("ticker")).strip().upper(): candidate
        for candidate in payload["candidates"]
        if isinstance(candidate, dict) and str(candidate.get("ticker") or "").strip()
    }

    selected: list[dict[str, Any]] = []
    for ticker in ordered_target_tickers():
        if ticker in production_tickers:
            continue
        source = sec_by_ticker.get(ticker)
        if source is None:
            continue
        selected.append(
            {
                "ticker": source["ticker"],
                "name": source["name"],
                "exchange": source["exchange"],
                "asset_type": "public_company",
                "source_type": "official_exchange_listing",
                "source_tier": 1,
                "source_url": SEC_COMPANY_TICKERS_EXCHANGE_URL,
                "capture_date": capture_date,
                "review_status": "pending",
            }
        )
        if len(selected) >= max_candidate_companies:
            break

    for candidate in selected:
        existing_by_ticker[candidate["ticker"]] = candidate

    payload["candidates"] = sorted(existing_by_ticker.values(), key=lambda item: item["ticker"])
    write_json(OFFICIAL_TICKER_UNIVERSE_PATH, payload)
    return len(selected)


def update_cik_mappings(
    *,
    sec_by_ticker: dict[str, dict[str, Any]],
    capture_date: str,
) -> int:
    payload = load_json(CIK_MAPPINGS_PATH, "CIK mappings")
    if not isinstance(payload, dict) or not isinstance(payload.get("mappings"), list):
        raise PhaseD69ExpansionError("CIK mappings file has unexpected shape.")

    by_ticker = {
        str(mapping.get("ticker")).strip().upper(): mapping
        for mapping in payload["mappings"]
        if isinstance(mapping, dict) and str(mapping.get("ticker") or "").strip()
    }
    used_ciks = {
        str(mapping.get("cik")).strip().zfill(10)
        for mapping in payload["mappings"]
        if isinstance(mapping, dict) and str(mapping.get("cik") or "").strip()
    }

    added = 0
    for ticker in ordered_target_tickers():
        source = sec_by_ticker.get(ticker)
        if source is None or ticker in by_ticker:
            continue
        cik = source["cik"]
        if cik in used_ciks:
            continue
        mapping = {
            "ticker": source["ticker"],
            "cik": cik,
            "source_type": "sec_filing",
            "source_tier": 1,
            "source_url": SEC_SUBMISSIONS_URL.format(cik=cik),
            "capture_date": capture_date,
            "review_status": "approved_for_fetch",
        }
        by_ticker[ticker] = mapping
        used_ciks.add(cik)
        added += 1

    payload["mappings"] = sorted(by_ticker.values(), key=lambda item: item["ticker"])
    write_json(CIK_MAPPINGS_PATH, payload)
    return added


def tickers_for_job(groups: list[str], sec_by_ticker: dict[str, dict[str, Any]]) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()
    used_ciks: set[str] = set()
    for group in groups:
        for ticker in SECTOR_TICKERS[group]:
            ticker = ticker.strip().upper()
            source = sec_by_ticker.get(ticker)
            if source is None or ticker in seen or source["cik"] in used_ciks:
                continue
            seen.add(ticker)
            used_ciks.add(source["cik"])
            selected.append(ticker)
    return selected


def update_sec_jobs(sec_by_ticker: dict[str, dict[str, Any]]) -> int:
    payload = load_json(SEC_JOBS_PATH, "SEC jobs")
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise PhaseD69ExpansionError("SEC jobs file has unexpected shape.")

    jobs_by_id = {
        str(job.get("id")).strip(): job
        for job in payload["jobs"]
        if isinstance(job, dict) and str(job.get("id") or "").strip()
    }
    added_or_updated = 0
    for job_id, description, groups, limit in JOB_DEFINITIONS:
        tickers = tickers_for_job(groups, sec_by_ticker)
        job = {
            "id": job_id,
            "description": description,
            "job_scope": "phase_d69_large_scale_data_expansion_visualization_stress_test",
            "tickers": tickers,
            "forms": ["10-K", "10-Q", "8-K"],
            "limit": limit,
            "review_status": "approved_for_local_run",
        }
        if jobs_by_id.get(job_id) != job:
            jobs_by_id[job_id] = job
            added_or_updated += 1

    original_order = [
        str(job.get("id")).strip()
        for job in payload["jobs"]
        if isinstance(job, dict) and str(job.get("id") or "").strip()
    ]
    d69_order = [job_id for job_id, *_ in JOB_DEFINITIONS]
    ordered_ids = []
    for job_id in [*original_order, *d69_order]:
        if job_id in jobs_by_id and job_id not in ordered_ids:
            ordered_ids.append(job_id)
    payload["jobs"] = [jobs_by_id[job_id] for job_id in ordered_ids]
    write_json(SEC_JOBS_PATH, payload)
    return added_or_updated


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.max_candidate_companies < 1:
        print("error: --max-candidate-companies must be at least 1.", file=sys.stderr)
        return 2

    try:
        initial_hashes = production_hashes()
        sec_by_ticker = fetch_sec_company_tickers_exchange(args.user_agent.strip())
        production_tickers = load_production_tickers()
        staged_companies = update_official_ticker_universe(
            sec_by_ticker=sec_by_ticker,
            production_tickers=production_tickers,
            capture_date=args.capture_date,
            max_candidate_companies=args.max_candidate_companies,
        )
        added_mappings = update_cik_mappings(
            sec_by_ticker=sec_by_ticker,
            capture_date=args.capture_date,
        )
        jobs_updated = update_sec_jobs(sec_by_ticker)
        assert_production_unchanged(initial_hashes)
    except (OSError, PhaseD69ExpansionError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print("Phase D69 candidate expansion complete")
    print(f"SEC tickers available: {len(sec_by_ticker)}")
    print(f"Ticker candidates staged/updated: {staged_companies}")
    print(f"CIK mappings added: {added_mappings}")
    print(f"SEC jobs added/updated: {jobs_updated}")
    print("Production writes: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
