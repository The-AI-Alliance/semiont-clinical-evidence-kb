---
name: tag-pico
description: Classify each clinical-question paragraph by PICO category — Patient/Population, Intervention, Comparison, Outcome.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are tagging clinical text by PICO category — the canonical structured-question framing used in evidence-based medicine.

## What it does

For every markdown / text resource, calls `mark.assist(resourceId, 'linking', { entityTypes: PICO_TYPES })`. The model identifies sentences or paragraphs that describe each PICO component and tags them.

| PICO category | Entity type | Example surface form |
|---|---|---|
| Patient / Population | `PICO_Patient` | "Adults aged 50–75 with type 2 diabetes and HbA1c > 7.5%" |
| Intervention | `PICO_Intervention` | "Drug X 500 mg twice daily for 24 weeks" |
| Comparison | `PICO_Comparison` | "Placebo" / "Standard of care" / "Drug Y at equivalent dose" |
| Outcome | `PICO_Outcome` | "Mean change in HbA1c from baseline" / "All-cause mortality at 1 year" |

PICO classification is the clinical-evidence equivalent of IRAC tagging in legal practice or IMRAD tagging in scholarly papers — a structural classification that, once applied, makes a corpus searchable along well-known axes.

## Why entity-type vocabulary instead of a registered tag schema?

Tag schemas registered upstream (`legal-irac`, `scientific-imrad`, `argument-toulmin`) are the architecturally correct fit for PICO; PICO would be a fourth registered schema, `clinical-pico`. Until that schema lands in `packages/ontology/src/tag-schemas.ts`, this skill uses entity-type vocabulary (`PICO_Patient`, `PICO_Intervention`, etc.) plus `mark.assist` linking to achieve the same query shape. When the upstream schema lands, this skill migrates to `mark.assist(rId, 'tagging', { schemaId: 'clinical-pico', categories: [...] })` and the entity-type variants retire.

See the AGENTS.md note "Why PICO is implemented as entity-type vocabulary" for the longer discussion.

## SDK verbs

- `browse.resources` — discover the markdown subset
- `mark.assist` — one call per resource, motivation `linking`

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/tag-pico/script.ts'
```

## Output

Per-resource PICO-tag counts. After this skill runs, queries like *"every Outcome paragraph in trials of Drug X in adult populations"* become straightforward `browse.annotations` filters.

## Guidance for the AI assistant

- A single resource may have many `PICO_Outcome` annotations (one per outcome reported); a single `PICO_Patient` annotation per study is typical (the inclusion-criteria paragraph).
- This skill is paragraph- or sentence-level; if a span is too fine-grained the resulting annotations may not capture the full PICO context.
- `clinical-evidence-summary` uses these tags to narrow its `gather.annotation` neighborhood — running tag-pico before clinical-evidence-summary makes the synthesis sharper.
