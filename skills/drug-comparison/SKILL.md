---
name: drug-comparison
description: Compare two interventions across the trial corpus — head-to-head trials where available, indirect comparisons via shared comparator otherwise.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are producing a head-to-head clinical comparison between two drugs across the corpus.

## What it does

Given two Drug names:

1. Looks up canonical Drug resources for both.
2. Finds Trials with edges to either drug.
3. Categorizes:
   - **Head-to-head**: Trials with edges to both drugs.
   - **Indirect (shared comparator)**: Trials of A vs. C and B vs. C, where C is a common comparator (placebo, standard of care, third drug).
   - **Single-arm only**: Trials of only one of the drugs, with no shared comparator.
4. `gather.annotation` over the most material outcomes from each category.
5. `yield.fromContext` synthesizes a `DrugComparison` aggregate: outcomes by category, effect-size differences, certainty assessment.

## SDK verbs

- `browse.resources`, `browse.annotations`
- `gather.annotation`, `yield.fromContext`

## CLI args

```
--drug-a <name>
--drug-b <name>
--condition <name>      # Optional. Restrict to trials in a specific condition.
```

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/drug-comparison/script.ts --drug-a metformin --drug-b sitagliptin --condition "type 2 diabetes"'
```

## Output

A `DrugComparison` resource. Print its resourceId.

## Guidance for the AI assistant

- Indirect comparisons via shared comparator are weaker than direct head-to-head — the synthesis should mark this clearly.
- Run `build-trial-graph` first; this skill walks the Trial → Drug edges that skill creates.
