# CryptoPhotonic Local Secure Runner Plan

This directory is reserved for a future local-only CryptoPhotonic runner. No runner implementation, live Helius calls, Solana calls, Jupiter calls, backend service, browser integration, or API key is added in this phase.

## Purpose

The future runner should:

- Run from the user's machine as a local command-line process.
- Read the Helius API key only from a local environment variable such as `HELIUS_API_KEY`.
- Never expose the key to browser JavaScript, HTML, public assets, generated fixtures, logs intended for sharing, or source maps.
- Accept constrained public inputs such as one Solana wallet address, approved transaction signatures, and an optional time window.
- Output sanitized JSON fixtures under `data/crypto/generated/`.
- Preserve raw provider payloads only outside public data if local diagnostics are needed later.

The runner must not start a backend server, proxy, browser listener, signing workflow, swap workflow, or public live-fetching path.

## Recommended Paths

- `data/crypto/generated/`: sanitized graph-ready fixtures safe for browser consumption after review.
- `data/crypto/generated/solana-wallet-flow.<wallet>.json`: generated wallet-flow fixture path pattern.
- `data/crypto/cache/`: optional future local cache for raw or semi-raw provider payloads, ignored before any real payloads are written.

## Cache Strategy

The future runner should reduce Helius free-tier pressure by caching and deduplicating before provider requests:

- Cache by normalized wallet address.
- Cache transaction details by transaction signature.
- Cache list results by wallet address plus time window.
- Track already-seen signatures and skip them on later runs.
- Batch unknown signature lookups when supported.
- Append only new sanitized transfers to generated fixtures.
- Deduplicate by transaction signature plus transfer index or another stable transfer identifier.
- Keep raw provider payloads out of `data/crypto/generated/`.

## Rate Limit Strategy

Helius free-tier limits should be treated as constrained and changeable. A future implementation should check current provider documentation at implementation time and keep defaults below the relevant free-tier allowance.

Safe defaults:

- Use a configurable max requests-per-second value below the free-tier limit.
- Retry 429 responses with exponential backoff and jitter.
- Respect provider retry headers when present.
- Batch signature lookups where supported.
- Avoid fast polling loops.
- Prefer incremental wallet updates over full re-pulls.
- Slow down or stop after repeated rate-limit responses.

## Sanitized Output Contract

The generated fixture should use this top-level shape:

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
  "wallets": [],
  "tokens": [],
  "entities": [],
  "transactions": []
}
```

Generated files must include `metadata`, `wallets`, `tokens`, `entities`, and `transactions`.

Generated files must not include API keys, bearer tokens, signing material, private keys, raw request headers, private URLs, raw provider payloads, local private filesystem paths, or diagnostics containing secrets.

## Flow Queue Terminology

The user-facing concept is Live Flow Queue. It describes realtime ordered flow intake from sanitized transactions, not press-play historical playback.

The existing internal `flowReplay` state can remain for now. A later refactor can rename it to `flowQueue` after the local secure runner, generated fixtures, merge behavior, and dedupe rules are stable.
