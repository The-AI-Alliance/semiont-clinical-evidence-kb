# Clinical Evidence Knowledge Base (Synthetic Documents)

[![Lint](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb/actions/workflows/lint.yml?query=branch%3Amain)
[![License](https://img.shields.io/github/license/The-AI-Alliance/semiont-clinical-evidence-kb)](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb/blob/main/LICENSE)

A collection of **synthetic but realistic clinical-evidence documents** — randomized controlled trials, observational studies, drug-safety reports, treatment guidelines — formatted for demonstration of medical-research annotation, evidence synthesis, and clinical-decision-support workflows with [Semiont](https://github.com/The-AI-Alliance/semiont).

## About This Dataset

This repository contains synthetic clinical materials. **All drugs, conditions, study identifiers, patient cohorts, outcomes, and adverse-event reports are entirely fictional.** Wherever the documents resemble real-world drug names or conditions, the resemblance is coincidental and the underlying numbers are invented. Nothing in this corpus reports a real clinical study, real patient data, or real safety signal.

The materials incorporate standard clinical-research conventions and formatting — IMRAD section structure, PICO question framing (Patient/Population, Intervention, Comparison, Outcome), Cochrane risk-of-bias classification, MeSH-style indexing — and realistic study-design patterns.

This corpus is well-suited for testing extraction of medical entities (drugs, conditions, doses, outcomes, adverse events, populations); structural classification by PICO; canonicalization to medical-vocabulary external authorities (RxNorm, ICD-10, SNOMED-CT); construction of trial graphs that connect interventions to outcomes; risk-of-bias assessment; and synthesis of clinical-evidence summaries that ground every claim back to a source study.

> **Disclaimer:** These documents are synthetic training materials. They should NOT be used as clinical references, do NOT constitute medical advice, have NOT been reviewed by clinicians for accuracy, and are NOT suitable for any actual patient-care decision. They are purely educational tools designed to demonstrate natural language processing and information extraction techniques on clinical-evidence content.

## Skills

This repo ships eleven skills that build a layered clinical-evidence KB on top of the Semiont SDK. See [AGENTS.md](AGENTS.md) for the full design discussion.

| Skill | What it does |
|---|---|
| [`ingest-corpus`](skills/ingest-corpus/SKILL.md) | Walk the repo's clinical-document corpus (markdown and PDF); create one resource per file. |
| [`mark-medical-entities`](skills/mark-medical-entities/SKILL.md) | Detect Drug, Condition, Dose, Outcome, AdverseEvent, Population, Intervention spans across study text. |
| [`tag-pico`](skills/tag-pico/SKILL.md) | Classify each clinical-question paragraph by PICO category — Patient/Population, Intervention, Comparison, Outcome. |
| [`canonicalize-drugs`](skills/canonicalize-drugs/SKILL.md) | Promote Drug mentions to canonical Drug resources grounded against an RxNorm-style external authority. |
| [`canonicalize-conditions`](skills/canonicalize-conditions/SKILL.md) | Promote Condition mentions to canonical Condition resources grounded against ICD-10 / SNOMED-CT. |
| [`extract-outcomes`](skills/extract-outcomes/SKILL.md) | Extract every reported outcome with structured fields — measure, effect size, confidence interval, p-value, sample size. |
| [`assess-risk-of-bias`](skills/assess-risk-of-bias/SKILL.md) | Score each study against Cochrane RoB domains (selection, performance, detection, attrition, reporting). |
| [`build-trial-graph`](skills/build-trial-graph/SKILL.md) | Wire Trial × Drug × Population × Outcome edges; promote each Trial mention to a canonical Trial resource. |
| [`comment-action-items`](skills/comment-action-items/SKILL.md) | Surface follow-up questions, missing data, and methodological concerns across the corpus. |
| [`clinical-evidence-summary`](skills/clinical-evidence-summary/SKILL.md) | Synthesize a per-treatment-decision evidence aggregate citing every supporting trial, with effect sizes and RoB context. |
| [`drug-comparison`](skills/drug-comparison/SKILL.md) | Compare two interventions across the trial corpus — outcomes per population, effect sizes, certainty. |

## Quick Start

Explore this dataset using [Semiont](https://github.com/The-AI-Alliance/semiont), an open-source knowledge base platform for annotation and knowledge extraction.

This repo follows the same layout and startup flow as [`semiont-template-kb`](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb). See its README for full setup instructions:

- [Quick Start: Local](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb#quick-start-local) — run the Semiont stack on your machine via `semiont start`
- [Quick Start: Codespaces](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb#quick-start-codespaces) — launch a preconfigured stack in the cloud
- [Inference Configuration](https://github.com/The-AI-Alliance/semiont-clinical-evidence-kb#inference-configuration) — Ollama (local) vs. Anthropic (cloud) configs

### Open in Codespaces

**Prerequisites:** the [Semiont launcher](https://github.com/The-AI-Alliance/semiont/tree/main/apps/launcher) (`brew install the-ai-alliance/semiont/semiont`) and the [GitHub CLI (`gh`)](https://cli.github.com/), signed in with `gh auth login`.

> **Before creating:** add `ANTHROPIC_API_KEY` as a [user secret](https://github.com/settings/codespaces) with this repo selected. Otherwise the backend comes up but inference is non-functional until you add the secret and rebuild the container.

One command creates the codespace (or resumes the one you already have), waits for the stack to answer, and forwards the KB to your machine:

```bash
semiont start --runtime codespace --repo The-AI-Alliance/semiont-clinical-evidence-kb
```

No account exists until you make one — the same as a local stack (it prompts for the password):

```bash
semiont useradd --repo The-AI-Alliance/semiont-clinical-evidence-kb --email you@example.com --admin
```

The browser runs **locally** and connects to any number of knowledge bases — cloud or local:

```bash
semiont start --service frontend
```

Open **http://localhost:3000** and add the KB in the **Knowledge Bases** panel, using the port the launcher printed and the credentials you just created. `semiont stop --repo The-AI-Alliance/semiont-clinical-evidence-kb` halts billing and keeps your state; add `--delete` to destroy the codespace.

<details>
<summary>Without the launcher: the raw <code>gh</code> recipe</summary>

```bash
gh codespace create --repo The-AI-Alliance/semiont-clinical-evidence-kb --machine premiumLinux
gh codespace ports forward 3000:3000 4000:4000   # leave running

# In another terminal, create the first admin (nothing creates one for you).
# --generate-password prints a random password once; there is no --password flag:
gh codespace ssh -- 'cd /workspaces/* && docker compose -f .semiont/compose/backend.yml \
  exec -T backend semiont-useradd --email you@example.com --generate-password --admin'
```

This forwards the codespace's own browser as well, so you open **http://localhost:3000** and sign in as the admin you just created. If `gh` rejects the forward with `must have admin rights to Repository`, grant the scope once: `gh auth refresh -h github.com -s codespace`.

</details>

## License

Apache 2.0 — See [LICENSE](LICENSE) for details.
