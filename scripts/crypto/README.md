# CryptoPhotonic Local Secure Runner

This directory contains the local-only CryptoPhotonic Solana wallet runner. It fetches one public wallet's recent Helius Enhanced Transactions from a terminal command, sanitizes the response, writes a browser-loadable fixture under `data/crypto/generated/`, and keeps API keys out of browser JavaScript and generated JSON.

## Purpose

The runner:

- Runs from the user's machine as a local command-line process.
- Reads the Helius API key only from the local `HELIUS_API_KEY` environment variable.
- Never exposes the key to browser JavaScript, HTML, public assets, generated fixtures, logs intended for sharing, or source maps.
- Accepts one public Solana wallet address and a bounded transaction limit.
- Outputs sanitized JSON fixtures under `data/crypto/generated/`.
- Caches only sanitized transaction state and known signatures by wallet.

The runner must not start a backend server, proxy, browser listener, signing workflow, swap workflow, or public live-fetching path.

## Local Usage

PowerShell:

```powershell
$env:HELIUS_API_KEY="paste-your-key-locally-only"
python scripts/crypto/solana_wallet_flow_fetch.py --wallet <PUBLIC_WALLET> --limit 25
```

Dry run without calling Helius or writing files:

```powershell
python scripts/crypto/solana_wallet_flow_fetch.py --wallet <PUBLIC_WALLET> --limit 25 --dry-run
```

Optional output and cache paths:

```powershell
python scripts/crypto/solana_wallet_flow_fetch.py --wallet <PUBLIC_WALLET> --limit 25 --output data/crypto/generated/solana-wallet-flow.<PUBLIC_WALLET>.json --cache-dir data/crypto/cache
```

The API key is read from `HELIUS_API_KEY` only at request time. Do not put a key in this README, command history intended for sharing, generated fixtures, source files, browser code, or committed JSON.

## Recommended Paths

- `data/crypto/generated/`: sanitized graph-ready fixtures safe for browser consumption after review.
- `data/crypto/generated/solana-wallet-flow.<wallet>.json`: generated wallet-flow fixture path pattern.
- `data/crypto/generated/manifest.json`: browser-visible sanitized manifest. The runner updates `active_fixture` after a successful write.
- `data/crypto/cache/`: local sanitized cache for known wallet signatures and sanitized transactions. Treat it as local runtime state and do not commit raw or diagnostic cache files.

## Cache Strategy

The runner reduces Helius free-tier pressure with conservative local behavior:

- Cache by normalized wallet address.
- Cache known transaction signatures.
- Skip already-seen signatures on later runs unless `--force-refresh` is used.
- Append only new sanitized transactions to generated fixtures.
- Deduplicate transactions by signature.
- Deduplicate transfer records within transactions.
- Keep raw provider payloads out of `data/crypto/generated/`.
- Do not write request headers, API keys, or private provider URLs.

## Rate Limit Strategy

Helius free-tier limits should be treated as constrained and changeable. The runner keeps defaults conservative and configurable without hardcoding provider plan claims.

Safe defaults:

- One user-triggered request per command; no polling loop.
- Default `--limit 25`, capped at 100.
- Default `--min-request-interval-ms 1200`.
- Retry HTTP 429 responses only a few times with backoff and jitter.
- Respect provider `Retry-After` headers when present.
- Avoid fast polling loops.
- Slow down or stop after repeated rate-limit responses.
- Increase `--min-request-interval-ms` if you hit rate limits.

## Sanitized Output Contract

The generated fixture uses this top-level shape:

```json
{
  "metadata": {
    "name": "Solana wallet flow",
    "environment": "local_secure_runner_generated",
    "chain": "solana",
    "adapter": "solana",
    "source": "helius_enhanced_transactions_sanitized",
    "wallet": "public wallet address",
    "generated_at": "ISO-8601 timestamp",
    "production_meaning": false,
    "live_blockchain_fetching": false,
    "sanitized": true
  },
  "solana_transactions": []
}
```

Generated files include `metadata` and `solana_transactions`. Browser code loads them through the existing Solana adapter, which normalizes them into CryptoPhotonic `wallets`, `tokens`, `entities`, and `transactions`.

Generated files must not include API keys, bearer tokens, signing material, private keys, raw request headers, private URLs, raw provider payloads, local private filesystem paths, or diagnostics containing secrets.

Each sanitized Solana transaction keeps only graph-needed safe fields:

- `signature`
- `type`
- `source`
- `timestamp`
- `nativeTransfers`
- `tokenTransfers`
- `events.swap` when present and reduced to safe transfer records
- `fee` and `feePayer` when present

## Generated Fixture Review Checklist

Before committing or sharing generated output:

- Confirm `metadata.sanitized` is `true`.
- Confirm `metadata.production_meaning` is `false`.
- Confirm `metadata.live_blockchain_fetching` is `false`.
- Search the generated fixture for `api-key`, `HELIUS_API_KEY`, `Authorization`, `Bearer`, and `https://api.helius.xyz`.
- Confirm the fixture contains no request headers, private URLs, private keys, signing material, or local private filesystem paths.
- Confirm the wallet address is public and intended for local visualization.

## Loading Generated Output In The UI

After a successful runner command, `data/crypto/generated/manifest.json` points `active_fixture` at the generated file. CryptoPhotonic loads data in this order:

1. `data/crypto/generated/manifest.json`
2. The manifest `active_fixture`, when present and under `data/crypto/generated/`
3. `data/crypto/solana-sample-flow.json`
4. `data/crypto/sample-flow.json`
5. The built-in sample

If a generated fixture is missing or malformed, the browser falls back to sample data. The browser does not call Helius and does not load `HELIUS_API_KEY`.

## Flow Queue Terminology

The user-facing concept is Live Flow Queue. It describes realtime ordered flow intake from sanitized transactions, not press-play historical playback.

The existing internal `flowReplay` state can remain for now. A later refactor can rename it to `flowQueue` after the local secure runner, generated fixtures, merge behavior, and dedupe rules are stable.
