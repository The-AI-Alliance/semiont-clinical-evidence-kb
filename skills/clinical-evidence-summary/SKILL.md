---
name: clinical-evidence-summary
description: Synthesize a per-treatment-decision evidence aggregate citing every supporting trial, with effect sizes weighted by risk-of-bias.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are producing the headline aggregate of this KB — the clinical-evidence summary for a specific treatment decision, synthesizing trial outcomes weighted by risk of bias and grounding every claim back to a source trial.

## What it does

Given a query — a (Drug, Condition, Population) tuple — the skill:

1. Walks the canonical Trial graph for trials that studied the Drug in the Population (or related populations).
2. Browses Outcome resources bound to those trials.
3. Browses RoB annotations on those trials.
4. Browses commenting annotations from `comment-action-items` for outstanding concerns.
5. `gather.annotation` over the most material outcome annotations to assemble a context window.
6. `yield.fromAnnotation` synthesizes a `ClinicalEvidenceSummary` aggregate resource: ranked outcomes, weighted effect sizes, RoB context, outstanding concerns, citation list. Every claim links to its source.

The result is a memo-shaped artifact — the clinical-evidence equivalent of a DoctrinalTrace. It's the kind of document a formulary committee, an FDA reviewer, or an evidence-based guideline panel asks for.

## SDK verbs

- `browse.resources`, `browse.annotations`
- `gather.annotation`
- `yield.fromAnnotation`

## CLI args

```
--drug <name>             # Required. Drug name to look up (matched against canonical Drug resources).
--condition <name>        # Required. Condition name.
--population <descriptor> # Optional. Narrows the trial set; default = all populations.
```

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `MAX_GATHER_ANNOTATIONS` | `12` | Maximum number of source outcomes to gather context from (caps cost). |
| `SUMMARY_INSTRUCTIONS` | (built-in default) | Override the synthesis prompt. |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/clinical-evidence-summary/script.ts --drug metformin --condition "type 2 diabetes"'
```

## Output

A new `ClinicalEvidenceSummary` resource. Print its resourceId; browse the body in the Semiont UI.

## Guidance for the AI assistant

- Run the full upstream pipeline first: ingest-corpus → mark-medical-entities → tag-pico → canonicalize-drugs → canonicalize-conditions → extract-outcomes → assess-risk-of-bias → build-trial-graph → comment-action-items.
- The synthesis is LLM judgment grounded in source spans. The substrate makes inputs auditable; it does not make the recommendation objective. The summary should clearly mark its reasoning as such.
