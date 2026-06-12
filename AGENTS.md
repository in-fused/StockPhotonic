# StockPhotonic Agent Instructions

These rules apply to automation and agent work in this repository.

- Treat GitHub `main` and the committed static files as the source of truth before editing.
- Preserve the static browser app constraints. Browser code must not require a backend to render the committed production graph.
- Do not introduce mock, fake, placeholder, or synthetic production data.
- Do not add browser secrets, API keys, bearer tokens, private keys, private RPC URLs, private service URLs, or local machine paths.
- Preserve the existing CryptoPhotonic topology, overlay, replay, and timeline systems unless the task explicitly targets them.
- Preserve StockPhotonic production graph behavior, source governance, candidate review, and validation gates.
- Inspect `docs/risk-marker-classification.md` before broad marker cleanup or risk-scan remediation.
- Keep fixtures and generated artifacts only when they are explicitly marked as test, sample, fixture, generated, or non-production cache data.
- Require validation evidence before commit. Record exact commands run and whether they passed, failed, or were intentionally skipped.
