# Risk Marker Classification

## Purpose

This document classifies marker hits found by automated project-review scans so future cleanup can separate real risks from expected documentation, fixtures, generated cache artifacts, and intentional safety references.

This pass was documentation-focused. It did not change production graph data, browser runtime behavior, fixtures, generated cache artifacts, Worker code, API code, or UI code.

## Instruction And Document Inspection

Inspected before classification:

- Root instruction files: no `AGENTS.md` existed before this pass; this pass added one. No `CLAUDE.md`, `README.md`, `package.json`, or `.github/copilot-instructions.md` were present in the committed file list.
- Root docs: `ARCHITECTURE.md`, `DATA_SOURCES.md`, `DATA_EXPANSION_PLAN.md`, `ROADMAP.md`, `HANDOFF_STOCKPHOTONIC.md`.
- Project docs: `docs/SOURCE_REGISTRY.md`, `docs/PHASE_D124_PRODUCTION_READINESS_QA.md`, `docs/PHASE_D129_ARCHIVE_GRADE_HISTORY_PROVIDER_CONTRACT.md`, `docs/PHASE_D130_ARCHIVE_INGESTION_FOUNDATION.md`, and related phase docs.
- Crypto/runtime docs: `data/crypto/README.md`, `scripts/crypto/README.md`, `worker/crypto-runtime/README.md`.
- Environment and workflow files: `.env.example`, `.github/workflows/*.yml`, `worker/crypto-runtime/wrangler.toml`.

Key project rules confirmed from those files:

- StockPhotonic is a static browser app.
- `data/companies.json` and `data/connections.json` are production graph source of truth.
- Candidate and review artifacts are not production graph data.
- Sample, mock, synthetic, generated sample, and fixture data must not become default active graph data.
- Provider keys, bearer tokens, private RPC URLs, request headers, and raw provider payloads must stay local/server-side and out of browser-readable files.

GitHub source-of-truth check:

- `git fetch origin main --prune` completed.
- Local `HEAD` and `origin/main` both resolved to `12b2de9c22ce9b0897f04606bf6f8014934afe4d` before edits.

## Search Terms Used

The audit searched for these marker terms, case-insensitively:

- `mock`
- `synthetic`
- `fake`
- `placeholder`
- `token`
- `secret`
- `apiKey`
- `localhost`
- `stub`
- `hardcoded`

## Baseline Summary By Marker

Baseline counts were collected before adding this document and root `AGENTS.md`.

| Marker | Matching lines | Matching files | Classification summary |
|---|---:|---:|---|
| `mock` | 41 | 8 | Expected fixture/test labels, active-data guards, and docs warning against mock fallback. |
| `synthetic` | 48 | 15 | Expected sample fixtures, Worker test payloads, fixture validation, and docs prohibiting synthetic production data. |
| `fake` | 46 | 14 | Expected docs and explicit fake/test fixture markers; no production graph hits. |
| `placeholder` | 62 | 20 | Mostly docs, UI placeholders, disabled provider placeholders, candidate guardrails, and validation patterns. |
| `token` | 1685 | 64 | Mostly crypto token data fields, token transfer parsing, token mint fields, and secret-safety references. |
| `secret` | 147 | 30 | Mostly docs, environment variable names, GitHub Secrets references, and sanitizer/validator code. |
| `apiKey` | 27 | 6 | Server/Worker env handling and diagnostics that explicitly report no browser API key exposure. |
| `localhost` | 4 | 4 | Local URL parsing fallback in API handlers and local Worker README commands. |
| `stub` | 16 | 5 | Disabled backend-only provider stubs and D1 storage fallback naming. |
| `hardcoded` | 1 | 1 | Documentation warning to avoid hardcoded provider-plan assumptions. |

Direct production graph search result:

- `git grep -n -i -E "mock|synthetic|fake|placeholder|token|secret|apiKey|localhost|stub|hardcoded" -- data\companies.json data\connections.json` returned no matches.

## Classification Buckets

### Safe Documentation References

These hits document constraints, warnings, and future implementation boundaries. They should remain searchable because they explain why risky behavior is not allowed.

Examples:

- `ARCHITECTURE.md`: core rules include no fake data, static production JSON source of truth, no backend in the current app, and reviewer-gated production changes.
- `DATA_SOURCES.md`: prohibits fake data, guessed URLs, placeholder records, unsupported claims, and automatic production writes.
- `DATA_EXPANSION_PLAN.md`: describes candidate-only expansion and prohibits placeholder source records.
- `docs/PHASE_D124_PRODUCTION_READINESS_QA.md`: warns not to place provider secrets, API keys, bearer tokens, private RPC URLs, or signing material in browser files.
- `data/crypto/README.md`: states sample/mock/dev events cannot become active graph data and provider keys must remain local/server-side.
- `worker/crypto-runtime/README.md`: documents Worker-side secret handling, Wrangler secrets, local curl commands, and disabled placeholder providers.

### Expected Test Fixtures Or Sample Fixtures

These files intentionally contain markers such as sample, synthetic, mock, or fake. They are expected only because they are committed as test, sample, or fixture material and are marked non-production.

Examples:

- `data/crypto/sample-flow.json`
- `data/crypto/solana-sample-flow.json`
- `data/crypto/sample_wallet_history.json`
- `data/crypto/sample_replay_cache.json`
- `data/crypto/generated/sample-wallet-history.generated.sample.json`
- `data/crypto/test-fixtures/wallet-activity-response-d97.json`
- `worker/crypto-runtime/test-payloads/test-event.sample.json`
- `worker/crypto-runtime/test-payloads/helius-webhook.sample.json`
- `worker/crypto-runtime/src/fixtures.js`

Evidence:

- Sample fixture metadata includes fields such as `sample: true`, `fixture: true`, `sanitized: true`, and `production_meaning: false`.
- `data/crypto/generated/manifest.json` has `sample_fixtures_active_graph_allowed: false`, `provider_cache_required_for_active_graph: true`, `active_provider_cache_candidate: null`, and `active_fixture: null`.
- Worker and API response contracts include `browser_provider_calls: false`, `provider_keys_included: false`, and raw provider payload exclusion flags.

### Generated Or Static Cache Artifacts

These hits are expected when they occur in committed static/generated artifacts that are explicitly marked as static cache, generated sample, sanitized provider-derived data, or non-production data.

Examples:

- `data/crypto/generated/manifest.json`
- `data/crypto/generated/sample-wallet-history.generated.sample.json`
- `data/crypto/generated/solana-wallet-flow.9yhpCwGYTWycAAd41X3rKpH328iHSrU7TrQWeVsoGcX5.json`

Evidence:

- The generated manifest does not select an active provider cache by default.
- The generated sample fixture is marked sample/fixture and non-production.
- The committed Solana wallet flow artifact inspected in this pass has metadata `source: "helius_enhanced_transactions_sanitized"`, `production_meaning: false`, `live_blockchain_fetching: false`, and `sanitized: true`.

Follow-up needed:

- The committed Solana wallet flow artifact appears older than the latest provider-cache metadata contract because the inspected metadata does not include the full D339-D348 gating fields such as `provider_keys_included: false`, `browser_provider_calls: false`, `provider_cache: true`, and `provider_cache_derived: true`.
- It is also not listed as an active provider cache in `data/crypto/generated/manifest.json`.
- Do not remove it without a separate artifact review, but future work should either regenerate it with current metadata, move it to an explicit fixture/sample class, or document why its current shape remains intentionally committed.

### Code Paths Safe Because They Do Not Ship Production Data

These hits are expected in validation, sanitization, provider-boundary, UI-gating, or disabled-provider code.

Examples:

- `scripts/validate_data.py`: contains placeholder/synthetic/secret detection patterns and validates production data.
- `scripts/crypto/fixture_audit.py`: scans generated fixtures for secret-like fields and provider URLs.
- `scripts/crypto_worker_contract.py`: rejects active graph responses containing sample/mock/dev markers.
- `api/crypto/_shared/provider.js`: reads `HELIUS_API_KEY` only from server environment and marks `apiKeyExposure: false`.
- `api/crypto/_shared/cache.js`: strips secret-shaped fields from cache.
- `worker/crypto-runtime/src/sanitize.js`: rejects unsafe key/value patterns such as API keys, bearer tokens, provider URLs, and private keys.
- `js/crypto/ui.js`: gates sample/mock/placeholder/dev data from active graph use.
- `js/crypto/historyProvider.js`: uses backend-only stubs and placeholder providers to avoid browser provider calls.
- `api/crypto/events.js`, `api/crypto/wallet-activity.js`, and `api/crypto/wallet-history.js`: use `http://localhost` only as a local fallback base for `new URL(req.url || "", ...)`, not as a browser-visible endpoint.

### Ambiguous Findings Needing Follow-up

These are not confirmed secret leaks or production mock-data paths, but they should be reviewed before future broad cleanup.

| Finding | Why it needs follow-up | Current classification |
|---|---|---|
| `python scripts\crypto\fixture_audit.py --path data\crypto\generated` fails on `provider_request_url_included` fields in `data/crypto/generated/sample-wallet-history.generated.sample.json`. | The field values are false flags, not URLs, but the audit tool currently treats the field name as disallowed. | Validation/tooling follow-up, not evidence of a leaked provider URL. |
| `data/crypto/generated/solana-wallet-flow.9yhpCwGYTWycAAd41X3rKpH328iHSrU7TrQWeVsoGcX5.json` contains real-looking public Solana transaction fields and token-transfer fields. | It is sanitized and non-production by metadata, but lacks the newer full provider-cache gating fields inspected in the current docs. | Generated/static cache artifact with metadata follow-up. |
| `worker/crypto-runtime/wrangler.toml` contains `CRYPTO_HELIUS_ALLOWED_WALLETS` with one public Solana address. | This is not a secret, token, private key, private URL, or local path, but it should stay intentionally controlled and small. | Intentional Worker allowlist config if the address is approved for committed config. |
| `lana` and generic wallet-history providers are marked as placeholders. | They are disabled/Worker-side placeholders and do not call providers from the browser, but marker scans will continue to flag them. | Intentional disabled-provider reference. |
| D1 storage `stub` naming appears in Worker storage code. | It is a named fallback path for an unimplemented binding, not production data. | Intentional disabled storage fallback. |

### Actual Risks Requiring Fixes

No committed secret value, browser API key, bearer token value, private key, private RPC URL, local machine path, or production graph mock/fake/synthetic data path was confirmed by the inspected marker hits.

The only failing check found during this audit was the generated fixture audit described above. That failure points to field-name handling around false metadata flags in a sample fixture, not to an observed secret value or raw provider URL.

## Known Intentional Exceptions

- `token` is usually a domain term in CryptoPhotonic, not a credential. Examples include token transfers, token mints, token accounts, token symbols, and token balance parsing.
- `secret` and `apiKey` are expected in docs, environment variable names, GitHub Actions secret references, Worker runtime code, and validation/sanitization patterns.
- `mock`, `fake`, and `synthetic` are expected in explicitly marked sample/test fixtures and in docs warning against production use.
- `placeholder` is expected in HTML input placeholders, candidate guardrails, disabled provider records, and placeholder-only Cloudflare binding examples.
- `localhost` and `127.0.0.1` are expected in local Worker README commands and local URL parser fallbacks.
- `stub` is expected only for backend-only disabled provider or storage fallback paths.
- `hardcoded` appears in documentation warning against hardcoded provider-plan assumptions.

## Follow-up Recommendations

1. Review `scripts/crypto/fixture_audit.py` versus generated sample metadata fields such as `provider_request_url_included: false`; either allow boolean exclusion flags or rename generated metadata fields so the audit passes without weakening secret detection.
2. Decide the intended class for `data/crypto/generated/solana-wallet-flow.9yhpCwGYTWycAAd41X3rKpH328iHSrU7TrQWeVsoGcX5.json`: regenerate it with current provider-cache metadata, classify it as an explicit fixture, or remove it only after human review confirms it is not needed.
3. Confirm the committed `CRYPTO_HELIUS_ALLOWED_WALLETS` public address in `worker/crypto-runtime/wrangler.toml` is intentionally public and controlled.
4. Keep future marker cleanup targeted. Do not remove docs, validators, sanitizer patterns, or fixtures solely because they contain marker words.
5. Rerun the required marker grep after future artifact or fixture changes and update this file when classifications change.

## Validation Commands Run

Commands and outcomes from this audit:

| Command | Outcome |
|---|---|
| `git status --short` | Passed before edits; clean output. |
| `git fetch origin main --prune` | Passed; fetched `origin/main`. |
| `git rev-parse HEAD` | Passed; returned `12b2de9c22ce9b0897f04606bf6f8014934afe4d`. |
| `git rev-parse origin/main` | Passed; returned `12b2de9c22ce9b0897f04606bf6f8014934afe4d`. |
| `git ls-files AGENTS.md CLAUDE.md README.md package.json .github/copilot-instructions.md docs data/crypto/README.md worker/crypto-runtime/README.md scripts/crypto/README.md` | Passed; confirmed no pre-existing `AGENTS.md`, `README.md`, or `package.json`, and listed docs/readmes inspected. |
| `git grep -n -i -E "mock\|synthetic\|fake\|placeholder\|token\|secret\|apiKey\|localhost\|stub\|hardcoded" -- data\companies.json data\connections.json` | Passed with no matches; production graph JSON had no marker hits. |
| Per-term `git grep -n -i -F <term> -- . ":(exclude)node_modules" ":(exclude).git"` count loop | Passed; produced the baseline summary table above. |
| `git grep -l -i -E "mock\|synthetic\|fake\|placeholder\|token\|secret\|apiKey\|localhost\|stub\|hardcoded" -- . ":(exclude)node_modules" ":(exclude).git"` | Passed; listed marker-bearing files for inspection. |
| `git grep -n -i -E "api-key\|apikey\|api_key\|bearer\|authorization\|HELIUS_API_KEY\|OPENALEX_API_KEY\|SEC_USER_AGENT\|CRYPTO_WALLET_HISTORY_URL\|CRYPTO_WALLET_HISTORY_BEARER_TOKEN\|private\|secret" -- api worker scripts .github .env.example data\crypto\generated data\candidates worker\crypto-runtime\wrangler.toml` | Passed; hits were env names, docs, sanitizer/validator patterns, or Worker/API env handling. |
| Local path/private URL marker grep across committed files | Passed; no committed local machine paths found. Exact machine-path patterns are not repeated here to avoid committing local path text. |
| `python scripts\crypto\fixture_audit.py --path data\crypto\generated` | Failed; reported `provider_request_url_included` metadata field names in `data/crypto/generated/sample-wallet-history.generated.sample.json`. Field values inspected are false flags, not leaked URLs. |
| `python scripts\validate_data.py` | Passed; 113 companies, 162 connections, 0 errors, 15 warnings. |

Post-edit validation:

| Command | Outcome |
|---|---|
| `git status --short` | Passed; showed only `AGENTS.md` and `docs/risk-marker-classification.md` as untracked changes. |
| `git grep -n -i -E "mock\|synthetic\|fake\|placeholder\|token\|secret\|apiKey\|localhost\|stub\|hardcoded" -- . ":(exclude)node_modules" ":(exclude).git"` | Passed; marker hits remain present and are classified above. |
| `git diff --check` | Passed; no whitespace errors reported. |
| `git status` | Passed; branch was up to date with `origin/main`, with only the two new documentation files untracked. |
