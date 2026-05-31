/**
 * assess-risk-of-bias — Cochrane RoB-style assessment of each trial /
 * observational study / systematic review in the corpus.
 *
 * mark.assist with motivation 'assessing'.
 *
 * Usage: tsx skills/assess-risk-of-bias/script.ts [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, type KnowledgeBase, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

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

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

async function main(): Promise<void> {
  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'clinical-evidence-assess-risk-of-bias',
    label: 'clinical-evidence assess-risk-of-bias',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  try {
    const all = await semiont.browse.resources({ limit: 1000 });
    const studyTypeSet = new Set(STUDY_TYPES);
    const targets: ResourceId[] = all
      .filter((r) => {
        const mt = getMediaType(r);
        const isText = mt === 'text/markdown' || mt === 'text/plain';
        const types: string[] = (r as any).entityTypes ?? [];
        return isText && types.some((t) => studyTypeSet.has(t));
      })
      .map((r) => ridBrand(r['@id']));

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
      const progress = await semiont.mark.assist(rId, 'assessing', {
        instructions: ROB_INSTRUCTIONS,
      });
      const n = createdCount(progress);
      total += n;
      console.log(`  ${rId}: ${n} RoB annotations`);
    }

    console.log(`\nDone. Created ${total} risk-of-bias annotations.`);
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
