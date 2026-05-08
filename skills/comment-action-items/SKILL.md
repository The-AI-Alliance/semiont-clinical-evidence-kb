---
name: comment-action-items
description: Surface follow-up questions, missing data, and methodological concerns across the corpus.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash, Read
---

You are flagging passages that need follow-up — incomplete reporting, methodological concerns, missing comparator arms, unresolved adverse-event signals, statistical anomalies.

## What it does

For every markdown / text resource, calls `mark.assist(rId, 'commenting', { instructions })`. The model identifies passages that warrant follow-up and tags each with a comment-purpose body explaining the concern.

## SDK verbs

- `browse.resources`
- `mark.assist` — motivation `commenting`

## Tier-2 parameters

| Var | Default | Purpose |
|---|---|---|
| `COMMENT_INSTRUCTIONS` | (built-in default) | Override the prompt — useful for narrowing to a specific concern (e.g., "only flag adverse-event reporting concerns"). |

## Run it

```bash
HOST_ADDR=$(container run --rm node:24-alpine sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null | tr -d '[:space:]')

container run --rm -v "$(pwd):/work" -w /work \
  -e SEMIONT_API_URL=http://${HOST_ADDR}:4000 \
  -e SEMIONT_USER_EMAIL=admin@example.com \
  -e SEMIONT_USER_PASSWORD=<your-password> \
  node:24-alpine \
  sh -c 'npm install --silent --no-fund @semiont/sdk tsx && npx tsx skills/comment-action-items/script.ts'
```

## Output

Per-resource: count of new commenting annotations.

## Guidance for the AI assistant

- These commenting annotations feed into `clinical-evidence-summary` — the synthesis includes a "outstanding concerns" section pulled from these comments, so the reviewer sees what's flagged before forming a recommendation.
