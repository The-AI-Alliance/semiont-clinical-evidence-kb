---
name: assess-risk-of-bias
description: Score each study against Cochrane risk-of-bias domains — selection, performance, detection, attrition, reporting bias.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are scoring each trial / observational study in the corpus on Cochrane risk-of-bias (RoB) domains.

## What it does

For each Trial / ObservationalStudy / SystematicReview resource in the corpus, calls `mark.assist(rId, 'assessing', { instructions })` with a Cochrane-style prompt. The model identifies passages relevant to each RoB domain and tags them with a per-domain risk rating (low / moderate / high / unclear).

The five domains:

| Domain | What it asks |
|---|---|
| Selection bias | Was randomization adequately concealed? Were baseline characteristics balanced? |
| Performance bias | Were participants and personnel blinded? |
| Detection bias | Were outcome assessors blinded? |
| Attrition bias | Was loss to follow-up reported and balanced across arms? |
| Reporting bias | Were outcomes pre-registered? Selective reporting present? |

## SDK verbs

- `browse.resources` — discover Trial / ObservationalStudy / SystematicReview resources
- `mark.assist` — one call per resource, motivation `assessing`

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `ROB_INSTRUCTIONS` | (built-in default) | Override the assessment prompt — useful for non-Cochrane frameworks (ROBINS-I for observational studies, GRADE for guidelines). |
| `STUDY_TYPES` | `Trial,ObservationalStudy,SystematicReview` | Comma-separated list of entity types to assess. |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/assess-risk-of-bias/script.ts'
```

## Output

Per-resource: count of RoB-domain assessments. Browseable via `browse.annotations` filtered by motivation `assessing`.

## Guidance for the AI assistant

- The default prompt assumes Cochrane RoB 2.0 framing (RCTs). For observational studies the ROBINS-I framework is more appropriate; override `ROB_INSTRUCTIONS` accordingly.
- `clinical-evidence-summary` weights effect sizes by RoB rating — low-RoB trials carry more weight in the synthesis.
