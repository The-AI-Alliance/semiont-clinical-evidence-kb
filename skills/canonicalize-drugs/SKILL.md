---
name: canonicalize-drugs
description: Promote Drug mentions to canonical Drug resources, grounded against RxNorm via External References. Idempotent — re-runs match new mentions against existing canonicals before synthesizing new ones.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are turning every Drug mention in the corpus into a canonical Drug resource that carries an RxNorm-grounded External Reference.

## What it does

1. Walks every `Drug`-tagged annotation in the corpus.
2. Clusters annotations by surface text.
3. For each cluster: gathers context, matches against existing Drug resources (`match.search`); if no confident match, synthesizes a new Drug resource via `yield.fromAnnotation` with body content from the gathered context plus an External References section pointing at RxNorm.
4. Binds every annotation in the cluster to the canonical Drug resource via `bind.body`.

After this skill runs, "metformin" / "Glucophage" / "metformin HCl" all collapse to one canonical Drug resource. `clinical-evidence-summary` and `drug-comparison` walk these canonical Drugs rather than re-matching strings.

## SDK verbs used

- `browse.resources`, `browse.annotations` — discover Drug-tagged annotations
- `gather.annotation` — pull the annotation's neighborhood (graph traversal + content + view + vector lookup)
- `match.search` — find candidate existing Drug resources via vector similarity + entity-type filter
- `yield.fromAnnotation` — synthesize a new Drug resource grounded in the source paragraph
- `bind.body` — attach the canonical Drug as a `SpecificResource` body part on every cluster annotation

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `MATCH_THRESHOLD` | `30` | Minimum match score to accept an existing Drug as the canonical target. Below threshold → synthesize a new one. |

## Tier-3 interactive checkpoints

`confirm` after the cluster summary; per-cluster `confirm` before synthesizing a new Drug when `--interactive`.

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/canonicalize-drugs/script.ts'
```

## Output

Per-cluster: either a match (existing Drug, score) or a synthesis (new Drug resourceId). End summary: number bound, number synthesized.

## Guidance for the AI assistant

- The RxNorm grounding here is URL-construction only (no live API call). Every synthesized Drug carries an External References section pointing at the RxNorm REST search URL for that drug name. A production deployment would replace the stub with an actual RxNorm lookup; the skill shape is the same.
- Boundary noise on Drug annotations (trailing dose, surrounding adjective) is normalized before matching — see `src/medical-patterns.ts` for the helpers.
- If you re-run, prior canonicals are preferred (matched at threshold) before any new ones are synthesized. Idempotent in practice for stable corpora.
