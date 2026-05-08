---
name: extract-outcomes
description: For every reported outcome in the corpus, synthesize an Outcome resource carrying structured fields — measure, effect size (HR / RR / OR / MD), confidence interval, p-value, sample size, follow-up duration.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are turning every reported outcome in the corpus into a queryable Outcome resource with structured fields.

## What it does

1. For every markdown resource in the corpus, browses `Outcome`-tagged annotations from `mark-medical-entities`.
2. For each annotation, calls `gather.annotation` to pull surrounding context (effect-size language often lives outside the span itself — confidence intervals, sample sizes, follow-up).
3. Calls `yield.fromAnnotation` to synthesize an Outcome resource with body fields filled by the LLM from the gathered context, plus a structured frontmatter block carrying the parsed effect size (via `src/effect-size.ts`).
4. Binds the source annotation to the new Outcome resource via `bind.body`.

The Outcome resource is the unit of cross-trial synthesis — `clinical-evidence-summary` and `drug-comparison` walk these.

## SDK verbs used

- `browse.resources`, `browse.annotations`
- `gather.annotation`, `yield.fromAnnotation`, `bind.body`

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `OUTCOME_INSTRUCTIONS` | (built-in default) | Override the per-outcome extraction prompt — useful for narrowing to safety vs. efficacy outcomes. |
| `MIN_OUTCOME_LENGTH` | `30` | Skip Outcome annotations shorter than this many characters (likely too thin to extract structured fields). |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/extract-outcomes/script.ts'
```

## Output

Per-outcome: source resource → new Outcome resource id, parsed effect size summary.

## Guidance for the AI assistant

- The `src/effect-size.ts` parser handles HR / RR / OR / RD / MD / SMD plus 95% CI plus p-value. Effect sizes that don't match those patterns won't be parsed but the Outcome resource is still synthesized; the structured fields just stay empty.
- Adverse events are NOT synthesized as Outcome resources here — `mark-medical-entities` already tags them as `AdverseEvent`, and `assess-risk-of-bias` factors them in.
