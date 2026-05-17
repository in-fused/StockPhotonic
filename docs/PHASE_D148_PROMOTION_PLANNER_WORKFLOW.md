# Phase D148 Promotion Planner Workflow

D148 adds a review-owned promotion planning layer for expanding beyond the current production company universe. It is a simulation and governance layer only.

## Promotion Boundary

- Candidate companies remain staged under `data/candidates/`.
- The browser can display planner rows, readiness scoring, reviewer states, batch comparisons, and graph-impact simulations.
- No planner path writes `data/companies.json` or `data/connections.json`.
- No planner path creates relationships, ecosystem memberships, or source trust escalation.
- Manual promotion and validation remain separate explicit steps.

## Reviewer States

Candidate-company rows now normalize into these planner states:

- `pending_preview`
- `approved_for_preview`
- `approved_for_promotion_review`
- `blocked`
- `enrichment_only`
- `production_candidate`
- `deferred`

The Workbench displays the current state, next gate, blockers, and review gates. Existing artifacts that do not carry a reviewer state default to `pending_preview`; the planner does not infer approval from high scores.

## Readiness Scoring

`js/stock/promotionPlanner.js` and `scripts/promotion_planner_report.py` compute deterministic readiness from:

- official source availability
- SEC identity support
- duplicate and alias conflict status
- corridor usefulness
- ecosystem usefulness
- strategic hub score
- source diversity
- review completeness

The score is a readiness score, not confidence and not promotion authority.

## Graph Impact Simulation

Promotion simulation reports:

- projected node count
- projected edge density
- preview anchor density
- corridor and ecosystem impact
- staged hub inflation risk
- overlay readability
- route complexity
- label pressure
- mobile safety

Production edge count stays unchanged in the simulation because candidate-company promotion does not create relationships.

## Local Report

Run:

```powershell
python scripts/promotion_planner_report.py --write --force
```

The command writes only `data/candidates/promotion_planner_report.json`, guards production hashes, performs no network calls, and reports zero production writes.

## Scaling Direction

Future expansion should add reviewer-authored approval state to candidate artifacts, then use the planner to compare batches before any manual promotion tool is run. The next phase should focus on reviewer decision persistence and promotion-diff export while preserving the candidate -> preview -> manual promotion -> validation workflow.
