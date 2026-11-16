---
name: canonicalize-conditions
description: Promote Condition mentions to canonical Condition resources, grounded against ICD-10 and SNOMED-CT via External References. Idempotent — re-runs match new mentions against existing canonicals before synthesizing new ones.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are turning every Condition mention in the corpus into a canonical Condition resource that carries ICD-10 and SNOMED-CT-grounded External References.

## What it does

1. Walks every `Condition`-tagged annotation in the corpus.
2. Clusters annotations by surface text.
3. For each cluster: gathers context, matches against existing Condition resources; if no confident match, synthesizes a new Condition resource via `yield.fromContext` with body content plus an External References section pointing at ICD-10 and SNOMED-CT.
4. Binds every annotation in the cluster to the canonical Condition resource via `bind.body`.

Same shape as `canonicalize-drugs` — only the entity type and external authorities differ.

## SDK verbs used

- `browse.resources`, `browse.annotations`
- `gather.annotation`, `match.search`
- `yield.fromContext`, `bind.body`

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `MATCH_THRESHOLD` | `30` | Minimum match score to accept an existing Condition. |
| `CONDITION_AUTHORITY` | `ICD-10` | Which authority to feature in the External References block. `ICD-10` or `SNOMED-CT`. The other is included as a secondary reference. |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/canonicalize-conditions/script.ts'
```

## Output

Per-cluster outcome (matched or synthesized) plus an end summary.

## Guidance for the AI assistant

- ICD-10 and SNOMED-CT cover overlapping but not identical territory. The current implementation links both for every Condition; downstream skills can use either.
- If the corpus contains both formal condition names and common-language paraphrases ("cardiovascular disease" vs. "heart disease"), the matcher tends to merge them; check the cluster summary in interactive mode.
