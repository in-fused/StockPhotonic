# Phase D150 - Bounded Live Data Refresh

## Philosophy

D150 introduces a recurring intelligence-refresh loop without changing the production graph source of truth.

Production graph data remains:

```text
data/companies.json
data/connections.json
```

Live refresh outputs are review-only artifacts under:

```text
data/refresh/
data/candidates/
data/source_registry/
data/cache/
```

The browser displays static artifact JSON only. It does not call SEC, OpenAlex, local scripts, or provider APIs.

## Main Orchestrator

Dry-run plan:

```powershell
python scripts/live_refresh_orchestrator.py
```

Local review-only artifact refresh with network disabled:

```powershell
python scripts/live_refresh_orchestrator.py --write --force
```

Bounded live refresh when local environment variables are configured:

```powershell
python scripts/live_refresh_orchestrator.py --write --force --allow-network --allow-openalex-network --allow-sec-network --max-requests 32 --openalex-max-requests 16 --sec-max-requests 6
```

Confirm production writes stayed zero:

```powershell
python scripts/validate_data.py
```

Then inspect:

```text
data/refresh/latest_refresh_summary.json
data/refresh/rate_limit_status.json
data/refresh/openalex_refresh_status.json
data/refresh/sec_refresh_status.json
```

## Secrets And Configuration

Local shell or untracked `.env`:

```text
OPENALEX_API_KEY=
SEC_USER_AGENT=Infused StockPhotonic infusednft@gmail.com
```

GitHub Actions secrets:

1. Open the repository on GitHub.
2. Go to `Settings` -> `Secrets and variables` -> `Actions`.
3. Add repository secret `OPENALEX_API_KEY` for bounded OpenAlex live mode.
4. Add repository secret `SEC_USER_AGENT` for bounded SEC metadata refresh.

Artifacts record only configured/not-configured state. They never write secret values.

## Rate-Limit Governance

Network calls are disabled by default. Live mode needs:

- `--write`
- `--allow-network`
- provider flag such as `--allow-openalex-network` or `--allow-sec-network`
- provider configuration
- remaining per-run, daily, and global budget

Caps are reported in:

```text
data/refresh/rate_limit_status.json
```

If a cap is exhausted, the orchestrator skips provider calls and reports the skip. It does not retry aggressively.

## OpenAlex Boundary

OpenAlex is context-only:

- ecosystem hints
- topic hints
- institution/entity-resolution hints
- alias/unresolved reports

OpenAlex does not create production relationships, ecosystem memberships, companies, or promotions.

## SEC Boundary

SEC refresh is metadata-only and cache-first. It fetches only approved CIK submission roots from `data/candidates/cik_mappings.json`.

SEC refresh does not scrape broadly, does not promote candidates, and does not write production graph JSON.

## Cache Lifecycle

Cache status is reported in:

```text
data/refresh/cache_status.json
```

The orchestrator reports TTL state, stale entries, cache size, and pruning guidance. It never deletes cache files automatically.

## Source Workbench Visibility

Source Workbench reads static `data/refresh/*.json` artifacts and shows:

- latest refresh timestamp
- OpenAlex and SEC configuration state
- network enabled/disabled state
- request usage and caps
- cache hits/misses
- candidate and stale-source counts
- safety state and next recommended action

## Future Separation

D150 prepares continuous intelligence but keeps promotion separate. A future phase may define reviewed promotion from these artifacts, but automatic production mutation remains out of scope.
