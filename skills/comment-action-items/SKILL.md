---
name: comment-action-items
description: Surface follow-up questions, missing data, and methodological concerns across the corpus.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are flagging passages that need follow-up — incomplete reporting, methodological concerns, missing comparator arms, unresolved adverse-event signals, statistical anomalies.

## What it does

For every markdown / text resource, calls `mark.delegate(rId, 'commenting', { instructions })`. The model identifies passages that warrant follow-up and tags each with a comment-purpose body explaining the concern.

## SDK verbs

- `browse.resources`
- `mark.delegate` — motivation `commenting`

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `COMMENT_INSTRUCTIONS` | (built-in default) | Override the prompt — useful for narrowing to a specific concern (e.g., "only flag adverse-event reporting concerns"). |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  node:24-alpine \
  sh -c 'npm ci --no-audit --no-fund && npx tsx skills/comment-action-items/script.ts'
```

The script prints an address: open it in a browser and approve the sign-in. [Signing in](https://github.com/The-AI-Alliance/semiont/blob/main/docs/builder/SIGN-IN.md) has the other ways a script can sign in.

## Output

Per-resource: count of new commenting annotations.

## Guidance for the AI assistant

- These commenting annotations feed into `clinical-evidence-summary` — the synthesis includes a "outstanding concerns" section pulled from these comments, so the reviewer sees what's flagged before forming a recommendation.
