# AGENTS.md — semiont-clinical-evidence-kb (and any clinical-evidence KB)

This is a clinical-evidence Semiont knowledge base. The corpus is randomized trials, observational studies, treatment guidelines, drug-safety reports, and systematic reviews. The skills detect drugs, conditions, doses, outcomes, adverse events, populations, and interventions; classify clinical-question paragraphs by PICO; canonicalize medical vocabulary against external authorities (RxNorm, ICD-10, SNOMED-CT); score studies for risk of bias; build a Trial × Drug × Population × Outcome graph; and synthesize clinical-evidence summaries that ground every claim back to a source study.

If you're an AI assistant working in this repo, this file is your orientation. The skills are **corpus-generic** — drop a different clinical-evidence corpus into the same directory layout and they work without modification.

## What's here

- **Top-level subdirectories** (e.g., `<therapeutic-area>/`, `<drug-class>/`, `<systematic-review-name>/`) — each holds the documents for one evidence base. Each file becomes one resource via skill 1.
- **`context/`, `curated/`, or `generated/`** (optional) — pre-curated context articles (treatment-guideline summaries, condition primers). Skill 1 ingests them as `ClinicalContext` resources on day 1; downstream skills *match* against them rather than overwriting.
- **`src/`** — small helper modules:
  - `src/files.ts` — corpus discovery and classification by filename heuristic
  - `src/medical-patterns.ts` — fast pattern-detection for drug-name, dose, and condition-mention candidates (used as a pre-filter)
  - `src/external-authorities.ts` — adapters for RxNorm, ICD-10 / SNOMED-CT, and ClinicalTrials.gov stubs
  - `src/effect-size.ts` — parsing helpers for effect sizes and confidence intervals
  - `src/interactive.ts` — `confirm` / `pick` / `preview` helpers for tier-3 interactive checkpoints
- **`skills/`** — eleven skills, each shipping a `SKILL.md` plus a `script.ts` that uses `@semiont/sdk` against the running backend.

| Skill | What it does | New SDK verbs |
|---|---|---|
| [`ingest-corpus`](skills/ingest-corpus/) | Walk the repo, declare the KB's entity-type vocabulary, create one resource per file | `frame.addEntityTypes`, `yield.resource` |
| [`mark-medical-entities`](skills/mark-medical-entities/) | Detect Drug, Condition, Dose, Outcome, AdverseEvent, Population, Intervention spans | `mark.assist` (linking) |
| [`tag-pico`](skills/tag-pico/) | Classify clinical-question paragraphs by PICO category | `mark.assist` (linking + tagging via entityTypes) |
| [`canonicalize-drugs`](skills/canonicalize-drugs/) | Promote Drug mentions to canonical Drug resources via RxNorm grounding | `+ match.search`, `+ yield.resource`, `+ bind.body` |
| [`canonicalize-conditions`](skills/canonicalize-conditions/) | Promote Condition mentions to canonical Condition resources via ICD-10 / SNOMED-CT | same shape as canonicalize-drugs |
| [`extract-outcomes`](skills/extract-outcomes/) | Tag each reported outcome; synthesize Outcome resources with structured fields | `+ yield.fromAnnotation` |
| [`assess-risk-of-bias`](skills/assess-risk-of-bias/) | Score each study against Cochrane RoB domains | `mark.assist` (assessing) |
| [`build-trial-graph`](skills/build-trial-graph/) | Promote Trial mentions to Trial resources; encode Trial × Drug × Population × Outcome edges | `+ bind.body` |
| [`comment-action-items`](skills/comment-action-items/) | Surface follow-up questions, missing data, methodological concerns | `mark.assist` (commenting) |
| [`clinical-evidence-summary`](skills/clinical-evidence-summary/) | Synthesize an evidence aggregate per treatment-decision query | `+ gather.annotation`, full pipeline composition |
| [`drug-comparison`](skills/drug-comparison/) | Multi-trial synthesis comparing two interventions | full pipeline composition |

## What does clinical-evidence review involve?

Working clinical-evidence synthesis usually involves several braided activities:

1. **Cataloging** — what trials, observational studies, guidelines, and safety reports exist; what evidence base each belongs to.
2. **Entity identification** — drugs (by generic name, brand name, salt, ingredient class), conditions (by formal name and synonyms), populations, interventions, comparators, outcomes, adverse events.
3. **PICO framing** — every clinical question and every reported finding can be parsed into Patient/Population, Intervention, Comparison, Outcome. Once a corpus is PICO-tagged, it becomes searchable on those four axes.
4. **Canonical-vocabulary grounding** — RxNorm for drugs, ICD-10 / SNOMED-CT for conditions, MeSH for indexing. Without it, "metformin" / "Glucophage" / "metformin HCl" are three strings; with it, they're one canonical Drug resource.
5. **Outcome extraction** — effect size, confidence interval, p-value, sample size, follow-up duration. Structured outcome data is what enables across-trial synthesis.
6. **Risk-of-bias assessment** — every conclusion in clinical evidence is qualified by *how the study was designed*. Selection bias, performance bias, detection bias, attrition bias, reporting bias.
7. **Trial-graph construction** — which trials studied which drugs in which populations measuring which outcomes. The graph is what powers "every trial of intervention X in population Y reporting outcome Z" queries.
8. **Evidence synthesis** — for a given treatment decision, walk the trial graph, gather effect sizes, weight by RoB, surface inconsistencies, produce a memo that grounds every claim back to its source.

The Semiont SDK is well-suited for all eight. The skills are organized to demonstrate that — turning a raw set of clinical documents into a navigable network of Drug, Condition, Trial, Population, Outcome, AdverseEvent, and ClinicalEvidenceSummary resources, all anchored back to the source paragraphs.

## Pre-curated context articles are preserved

Drop a markdown file into `context/`, `curated/`, or `generated/` and skill 1 ingests it as a `ClinicalContext` resource on day 1. Skills that synthesize new context articles `match.search` against existing ones first, so any hand-curated content survives subsequent runs.

## Entity types used in this KB

- **Medical entities**: `Drug`, `Condition`, `Dose`, `Outcome`, `AdverseEvent`, `Population`, `Intervention`, `Comparator`
- **Document types**: `Trial`, `ObservationalStudy`, `SystematicReview`, `Guideline`, `SafetyReport`, `ClinicalDocument`
- **Inside-document references**: `PICO_Patient`, `PICO_Intervention`, `PICO_Comparison`, `PICO_Outcome` (used as entity types until a registered tag schema lands)
- **Synthesized aggregates**: `Drug` (canonical), `Condition` (canonical), `Trial` (canonical), `ClinicalEvidenceSummary`, `DrugComparison`, `RiskOfBiasAssessment`, `Aggregate`
- **External-authority shadows**: `RxNormConcept`, `ICD10Code`, `SNOMEDConcept`, `ClinicalTrialsGovEntry`
- **Curated content marker**: `ClinicalContext`, `Curated`

## Worked example: synthesizing a treatment-decision evidence summary

The seeded corpus contains synthetic trial reports for a fictional drug class against a fictional condition. After running:

1. `ingest-corpus` → resources for each trial / study / guideline.
2. `mark-medical-entities` → annotations on drug, condition, dose, outcome, adverse-event, population, intervention spans.
3. `tag-pico` → annotations classifying clinical-question paragraphs.
4. `canonicalize-drugs` → Drug resources with RxNorm grounding.
5. `canonicalize-conditions` → Condition resources with ICD-10 / SNOMED-CT grounding.
6. `extract-outcomes` → Outcome resources with structured effect sizes.
7. `assess-risk-of-bias` → per-study RoB annotations.
8. `build-trial-graph` → Trial resources with edges to Drug, Population, Outcome.
9. `clinical-evidence-summary` → walks the trial graph for a given (Drug, Condition, Population) query, gathers effect sizes weighted by RoB, surfaces inconsistencies, produces a memo with every claim linked to its source trial.

The summary is the demonstration — a queryable artifact that shows *what the trial corpus says about a treatment decision*, citing the exact source studies. This pattern works on any clinical corpus: drop in your own evidence base, run the skills, get a summary. Specific drug names, conditions, and populations from the seeded corpus appear *only in the summary that the run produces*; the skills themselves never hard-code any drug, condition, or trial identifier.

## Why PICO is implemented as entity-type vocabulary, not a registered tag schema

Tag schemas registered in `packages/ontology/src/tag-schemas.ts` (legal-irac, scientific-imrad, argument-toulmin) are the right fit for PICO conceptually — Patient/Population, Intervention, Comparison, Outcome are exactly the structured-tagging shape IRAC and IMRAD are. But until a clinical-evidence schema is registered upstream, this KB uses entity-type vocabulary (`PICO_Patient`, `PICO_Intervention`, etc.) plus `mark.assist` linking. The query shape is identical; the only difference is registration. When the upstream schema lands, `tag-pico` migrates to use `schemaId: 'clinical-pico'` and the entity-type variants retire.

## Working in containers — do not install npm packages on the host

This template assumes a containerized workflow. The backend stack runs in containers (`semiont start` brings it up); the skills run in containers too. There is **no need** to install Node, the SDK, or any other tooling on the host machine.

Each skill's `SKILL.md` shows a `container run` invocation that mounts the repo, installs `@semiont/sdk` and `tsx` *inside* a throwaway container, then runs the skill's `script.ts`. See [`skills/ingest-corpus/SKILL.md`](skills/ingest-corpus/SKILL.md) for the full networking discussion (the `HOST_ADDR` discovery probe).

## Backend setup

Before running any skill, the Semiont backend stack must be up. Two paths:

### Local: `semiont start`

```bash
brew install the-ai-alliance/semiont/semiont   # once
semiont start
```

Then create the admin user you'll sign in with:

```bash
semiont useradd --email admin@example.com --password password --admin
```

Flags: `--config anthropic` for cloud inference (requires `ANTHROPIC_API_KEY`), `--no-observe` to skip the Jaeger sidecar (on by default; traces at http://localhost:16686), `--runtime` to force a container runtime. `--config`/`--runtime` are sticky — a bare `semiont start` repeats the last explicitly-passed values. `--help` lists all options.

### Codespaces

Open the repo in a Codespace — `post-create.sh` pulls the stack's images, `post-start.sh` brings it up, admin credentials are auto-generated into `.devcontainer/admin.json`. Print them: `cat .devcontainer/admin.json`. Forward the port: `gh codespace ports forward 4000:4000`.

## Parameterization and interactivity

Skills are parameterized in three tiers — environment configuration (`SEMIONT_API_URL` / `SEMIONT_USER_EMAIL` / `SEMIONT_USER_PASSWORD`), skill-invocation parameters (per-skill env vars and CLI args; most accept `MATCH_THRESHOLD` for cluster-merge / candidate binding), and tier-3 interactive checkpoints (off by default; enable with `--interactive` or `SEMIONT_INTERACTIVE=1`). See each skill's `SKILL.md` for specifics.

## A note on PDFs

`mark.assist` operates on `text/markdown` and `text/plain`. PDFs are ingested by skill 1 as `application/pdf` resources — they're cataloged and visible in the KB but downstream `mark-*` skills skip them. The markdown subset of the corpus carries the analytical workload.

## Background reading

| Where | What |
|---|---|
| [`@semiont/sdk` README](https://github.com/The-AI-Alliance/semiont/tree/main/packages/sdk) | The TypeScript surface — eight verbs (frame, yield, mark, match, bind, gather, browse, beckon) plus admin/auth/job. |
| [SDK Usage docs](https://github.com/The-AI-Alliance/semiont/tree/main/packages/sdk/docs) | Cache semantics, reactive model, state units, error handling. |
| [Semiont protocol docs](https://github.com/The-AI-Alliance/semiont/tree/main/docs/protocol) | The eight-flow framing. |
| [Semiont protocol skills](https://github.com/The-AI-Alliance/semiont/tree/main/docs/protocol/skills) | Reference skill packs — `semiont-wiki`, `semiont-comment`, `semiont-highlight`, etc. |
| [RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/) | NIH drug-name normalization; the canonical authority `canonicalize-drugs` grounds against. |
| [ICD-10](https://www.who.int/standards/classifications/classification-of-diseases) / [SNOMED-CT](https://www.snomed.org/) | Condition vocabularies. |
| [ClinicalTrials.gov](https://clinicaltrials.gov/) | Trial registry, used as a stub for canonical Trial resources. |
| [Cochrane RoB 2](https://www.bmj.com/content/366/bmj.l4898) | Risk-of-bias domains used by `assess-risk-of-bias`. |
