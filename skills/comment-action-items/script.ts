/**
 * comment-action-items — flag passages requiring follow-up across the corpus.
 *
 * mark.delegate with motivation 'commenting'.
 *
 * Usage: tsx skills/comment-action-items/script.ts [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

const COMMENT_INSTRUCTIONS =
  process.env.COMMENT_INSTRUCTIONS ??
  `Identify passages in this clinical document that warrant follow-up — incomplete reporting,
methodological concerns, missing comparator data, unresolved adverse-event signals, statistical
anomalies, or unmet protocol commitments. For each, tag the span and write a brief comment
explaining the concern (1–2 sentences). Don't flag passages that are simply describing standard
study procedures.`;


async function main(): Promise<void> {
  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const session = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-comment-action-items',
      label: 'clinical-evidence comment-action-items',
      host: gateway.hostname,
      port: Number(gateway.port) || 4000,
      protocol: gateway.protocol === 'https:' ? 'https' : 'http',
    }),
    storage: new InMemorySessionStorage(),
    onCode: ({ verificationUri, verificationUriComplete, userCode }) => {
      console.error(`Approve this script at ${verificationUriComplete ?? verificationUri}`);
      if (!verificationUriComplete) console.error(`Code: ${userCode}`);
    },
  });
  const semiont = session.client;

  try {
    const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
    const targets: ResourceId[] = all
      .filter((r) => {
        const mt = getMediaType(r);
        return mt === 'text/markdown' || mt === 'text/plain';
      })
      .map((r) => r['@id']);

    if (targets.length === 0) {
      console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    console.log(`Will comment ${targets.length} resource(s) for follow-up.`);
    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      closeInteractive();
      return;
    }

    let total = 0;
    for (const rId of targets) {
      const done = await semiont.mark.delegate(rId, {
        motivation: 'commenting',
        instructions: COMMENT_INSTRUCTIONS,
      });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
      total += n;
      console.log(`  ${rId}: ${n} commenting annotations`);
    }

    console.log(`\nDone. Created ${total} commenting annotations.`);
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
