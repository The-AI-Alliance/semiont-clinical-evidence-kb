---
name: build-trial-graph
description: Promote each Trial mention to a canonical Trial resource (with ClinicalTrials.gov NCT grounding where present), then wire Trial → Drug, Trial → Population, Trial → Outcome edges via bind.body.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are wiring the Trial × Drug × Population × Outcome graph.

## What it does

Two passes:

1. **Trial canonicalization.** For each Trial / ObservationalStudy resource, create or match a canonical Trial resource. NCT identifiers detected by `src/medical-patterns.ts` get a ClinicalTrials.gov External Reference; otherwise the Trial is named by document title.

2. **Edge wiring.** For each canonical Trial resource, find all Drug, Population, and Outcome resources whose annotations live within the source study and add `bind.body` edges connecting them. After this pass:
   - "every Trial that studied Drug X" → query `browse.resources({ entityType: 'Trial' })` and filter on the Drug edge
   - "every Outcome reported in trials of Population Y" → traverse Population → Trial → Outcome
   - "every Trial of Drug X in Population Y reporting Outcome Z" → the canonical evidence-base query

## SDK verbs

- `browse.resources`, `browse.annotations`
- `match.search`, `yield.fromContext` (Trial canonicalization)
- `bind.body` (edge wiring)

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/build-trial-graph/script.ts'
```

## Output

Per-trial: number of edges created (Drug, Population, Outcome). End summary: total Trial canonicals plus edge counts.

## Guidance for the AI assistant

- Run `canonicalize-drugs`, `canonicalize-conditions`, and `extract-outcomes` *before* this skill — they create the Drug, Condition, and Outcome resources whose ids the edges point at.
- ObservationalStudy resources get canonicalized as Trial too — the canonical type is the umbrella; the edge to the source study preserves the original document type.
- ClinicalTrials.gov NCT lookups here are URL-construction only (no live API call). Production deployments would replace the stub with an actual ClinicalTrials.gov API call.
