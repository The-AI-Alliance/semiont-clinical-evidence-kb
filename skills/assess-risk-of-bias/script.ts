/**
 * assess-risk-of-bias — Cochrane RoB-style assessment of each trial /
 * observational study / systematic review in the corpus.
 *
 * mark.delegate with motivation 'assessing'.
 *
 * Usage: tsx skills/assess-risk-of-bias/script.ts [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

const STUDY_TYPES = (process.env.STUDY_TYPES ?? 'Trial,ObservationalStudy,SystematicReview')
  .split(',')
  .map((t) => t.trim());

const ROB_INSTRUCTIONS =
  process.env.ROB_INSTRUCTIONS ??
  `Assess this study on five Cochrane risk-of-bias domains. For each, identify the passage(s)
that bear on the domain and tag the span with a rating drawn from {low, moderate, high, unclear},
prefixed by the domain code:
  - selection: random sequence generation, allocation concealment, baseline balance
  - performance: blinding of participants and personnel
  - detection: blinding of outcome assessors
  - attrition: incomplete outcome data, loss to follow-up, ITT vs. per-protocol
  - reporting: selective outcome reporting, protocol pre-registration
Use a single tag value formatted "selection-low", "performance-high", etc. Only flag spans where
the text actually addresses the domain — do not infer ratings without textual support.`;


async function main(): Promise<void> {
  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const opened = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-assess-risk-of-bias',
      label: 'clinical-evidence assess-risk-of-bias',
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
  const semiont = opened.session.client;

  try {
    const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
    const studyTypeSet = new Set(STUDY_TYPES);
    const targets: ResourceId[] = all
      .filter((r) => {
        const mt = getMediaType(r);
        const isText = mt === 'text/markdown' || mt === 'text/plain';
        const types: string[] = r.entityTypes ?? [];
        return isText && types.some((t) => studyTypeSet.has(t));
      })
      .map((r) => r['@id']);

    if (targets.length === 0) {
      console.log(
        `No studies of types ${STUDY_TYPES.join(', ')} found. Run skills/ingest-corpus/script.ts first.`,
      );
      closeInteractive();
      return;
    }

    console.log(`Will assess ${targets.length} study resource(s) for RoB.`);
    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      closeInteractive();
      return;
    }

    let total = 0;
    for (const rId of targets) {
      const done = await semiont.mark.delegate(rId, {
        motivation: 'assessing',
        instructions: ROB_INSTRUCTIONS,
      });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
      total += n;
      console.log(`  ${rId}: ${n} RoB annotations`);
    }

    console.log(`\nDone. Created ${total} risk-of-bias annotations.`);
    closeInteractive();
  } finally {
    opened.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
