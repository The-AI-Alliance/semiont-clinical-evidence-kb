---
name: mark-medical-entities
description: Detect formally-named medical entity spans across the markdown corpus — Drug, Condition, Dose, Outcome, AdverseEvent, Population, Intervention, Comparator.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are detecting named medical entities in the corpus. The output is one annotation per detected span, with `motivation: linking` and an `entityTypes` array carrying the inferred type(s).

## What it does

For every markdown / text resource, calls `mark.delegate(resourceId, 'linking', { entityTypes })`. The model proposes spans and assigns each to one of the requested types.

| Entity type | What it tags |
|---|---|
| `Drug` | Drug names — generic (`metformin`), brand (`Glucophage`), salt forms, ingredient classes |
| `Condition` | Disease names, syndromes, formal medical conditions |
| `Dose` | Dosage strings — `500 mg`, `10 mg/kg/day`, `2 g IV q6h` |
| `Outcome` | Reported outcome measures — `mortality`, `HbA1c reduction`, `progression-free survival` |
| `AdverseEvent` | Reported adverse events / side effects |
| `Population` | Study populations / inclusion criteria — `adults with type 2 diabetes`, `women aged 50–75` |
| `Intervention` | Therapeutic interventions, including non-drug interventions (procedures, behavioral, devices) |
| `Comparator` | Control / comparison interventions (placebo, standard of care, alternative drug) |

Override the type list per run with `ENTITY_TYPES` (comma-separated string).

PDFs are skipped — `mark.delegate` requires `text/markdown` or `text/plain`.

## SDK verbs

- `browse.resources` — discover the markdown subset
- `mark.delegate` — one call per resource, motivation `linking`

## Tier-3 interactive checkpoint

`confirm` after the per-resource summary, before running the assist passes.

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund && npx tsx skills/mark-medical-entities/script.ts'
```

The script prints an address: open it in a browser and approve the sign-in. [Signing in](https://github.com/The-AI-Alliance/semiont/blob/main/docs/builder/SIGN-IN.md) has the other ways a script can sign in.

Add `-e ENTITY_TYPES=Drug,Condition,Dose` to narrow the type list, or `-e SEMIONT_INTERACTIVE=1 -it` for the confirm prompt.

## Output

Per-resource count of new annotations. The annotations are queryable downstream via `browse.annotations(resourceId)`. `canonicalize-drugs` and `canonicalize-conditions` will pick them up by entity type.

## Guidance for the AI assistant

- Re-running creates duplicates. Prior annotations from a previous run are not deduplicated.
- Boundary errors are common — the model may include trailing commas, units, or surrounding adjectives. `canonicalize-drugs` does its own normalization step before grounding to RxNorm, so minor boundary noise is tolerable.
- This skill does *not* canonicalize the mentions — it just tags them. Promotion to Drug / Condition resources happens in `canonicalize-drugs` / `canonicalize-conditions`.
