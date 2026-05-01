#!/usr/bin/env python3
"""Read-only SEC fetch/cache helper for future source-backed ingestion work.

This script never writes production graph data. It only fetches an explicitly
requested SEC resource and stores the response in a deterministic cache file.
"""

import argparse
import hashlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_CACHE_DIR = Path("data/cache/sec")
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
DEFAULT_TIMEOUT_SECONDS = 20
ALLOWED_SEC_HOST_SUFFIX = ".sec.gov"
ALLOWED_SEC_HOST = "sec.gov"


def normalize_cik(raw_cik):
    """Return a zero-padded 10-digit CIK string."""
    cik = raw_cik.strip().upper()
    if cik.startswith("CIK"):
        cik = cik[3:]
    if not cik.isdigit():
        raise ValueError("CIK must contain digits only, optionally prefixed by CIK.")
    if len(cik) > 10:
        raise ValueError("CIK must be 10 digits or fewer before zero-padding.")
    return cik.zfill(10)


def normalize_sec_url(raw_url):
    """Validate and normalize an explicit SEC URL."""
    parsed = urllib.parse.urlparse(raw_url.strip())
    if parsed.scheme != "https":
        raise ValueError("SEC URL must use https.")
    hostname = (parsed.hostname or "").lower()
    if hostname != ALLOWED_SEC_HOST and not hostname.endswith(ALLOWED_SEC_HOST_SUFFIX):
        raise ValueError("URL host must be sec.gov or a sec.gov subdomain.")
    if not parsed.path:
        raise ValueError("SEC URL must include a path.")
    return urllib.parse.urlunparse(parsed._replace(fragment=""))


def cache_path_for_cik(cache_dir, cik):
    return cache_dir / f"submissions_CIK{cik}.json"


def cache_path_for_url(cache_dir, url):
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return cache_dir / f"fetched_{digest}.json"


def build_request(url, user_agent):
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "identity",
            "Connection": "close",
        },
    )


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Fetch and cache one explicitly requested SEC resource. "
            "This helper is read-only with respect to StockPhotonic production data."
        )
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument(
        "--cik",
        help="Company CIK for the SEC submissions endpoint, for example 0000320193.",
    )
    source_group.add_argument(
        "--url",
        help="Explicit https://sec.gov or https://*.sec.gov URL to fetch.",
    )
    source_group.add_argument(
        "--ticker",
        help=(
            "Reserved for a future ticker-to-CIK lookup. No mappings are invented; "
            "use --cik or --url in this phase."
        ),
    )
    parser.add_argument(
        "--user-agent",
        required=True,
        help='Required SEC User-Agent, for example "Your Name your.email@example.com".',
    )
    parser.add_argument(
        "--cache-dir",
        default=str(DEFAULT_CACHE_DIR),
        help=f"Directory for cached SEC responses. Default: {DEFAULT_CACHE_DIR}",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Fetch again and overwrite the cache file if it already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the target URL and cache path without making a network request.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Network timeout in seconds. Default: {DEFAULT_TIMEOUT_SECONDS}",
    )
    return parser.parse_args(argv)


def resolve_target(args):
    cache_dir = Path(args.cache_dir)
    if args.ticker:
        raise ValueError(
            "--ticker lookup is not implemented in this phase. "
            "Use --cik or --url so the requested SEC resource is explicit."
        )
    if args.cik:
        cik = normalize_cik(args.cik)
        url = SEC_SUBMISSIONS_URL.format(cik=cik)
        return url, cache_path_for_cik(cache_dir, cik)
    url = normalize_sec_url(args.url)
    return url, cache_path_for_url(cache_dir, url)


def validate_user_agent(user_agent):
    normalized = user_agent.strip()
    if not normalized:
        raise ValueError("--user-agent must not be blank.")
    if "@" not in normalized:
        raise ValueError("--user-agent must include contact information, such as an email address.")
    return normalized


def validate_timeout(timeout):
    if timeout <= 0:
        raise ValueError("--timeout must be greater than zero.")
    return timeout


def print_status(status, url, cache_path, extra=None):
    print(f"status: {status}")
    print(f"url: {url}")
    print(f"cache_path: {cache_path}")
    if extra:
        for key, value in extra.items():
            print(f"{key}: {value}")


def fetch_and_cache(url, cache_path, user_agent, timeout, force_refresh):
    if cache_path.exists() and not force_refresh:
        print_status(
            "cache-hit",
            url,
            cache_path,
            {"network": "skipped", "detail": "use --force-refresh to fetch again"},
        )
        return 0

    request = build_request(url, user_agent)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            final_url = normalize_sec_url(response.geturl())
            body = response.read()
            status_code = getattr(response, "status", response.getcode())
            content_type = response.headers.get("Content-Type", "unknown")
    except urllib.error.HTTPError as exc:
        print(f"error: SEC request failed with HTTP {exc.code}: {exc.reason}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"error: SEC request failed: {exc.reason}", file=sys.stderr)
        return 1

    if final_url != url:
        print(f"error: SEC request redirected unexpectedly to {final_url}", file=sys.stderr)
        return 1

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = cache_path.with_name(f"{cache_path.name}.tmp")
    temp_path.write_bytes(body)
    temp_path.replace(cache_path)

    print_status(
        "fetched",
        url,
        cache_path,
        {
            "http_status": status_code,
            "content_type": content_type,
            "bytes_written": len(body),
        },
    )
    return 0


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        user_agent = validate_user_agent(args.user_agent)
        timeout = validate_timeout(args.timeout)
        url, cache_path = resolve_target(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        print_status("dry-run", url, cache_path, {"network": "skipped"})
        return 0

    return fetch_and_cache(url, cache_path, user_agent, timeout, args.force_refresh)


if __name__ == "__main__":
    raise SystemExit(main())
