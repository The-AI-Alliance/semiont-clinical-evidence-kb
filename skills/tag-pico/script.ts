/**
 * tag-pico — classify clinical text by PICO category.
 *
 * mark.delegate with motivation 'linking' and four entity types
 * (PICO_Patient / PICO_Intervention / PICO_Comparison / PICO_Outcome).
 *
 * NOTE: This is the interim shape until a registered `clinical-pico` tag
 * schema lands in `@semiont/ontology`. Once it does, this skill migrates to
 * mark.delegate(..., { motivation: 'tagging', schemaId: 'clinical-pico', categories: [...] })
 * and the entity-type variants retire. The query shape is the same; only
 * registration differs.
 *
 * Usage: tsx skills/tag-pico/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

const PICO_ENTITY_TYPES = [
  entityType('PICO_Patient'),
  entityType('PICO_Intervention'),
  entityType('PICO_Comparison'),
  entityType('PICO_Outcome'),
];


async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const opened = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-tag-pico',
      label: 'clinical-evidence tag-pico',
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
    let targets: ResourceId[];
    if (explicitResourceId) {
      targets = [ridBrand(explicitResourceId)];
    } else {
      const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
      targets = all
        .filter((r) => {
          const mt = getMediaType(r);
          return mt === 'text/markdown' || mt === 'text/plain';
        })
        .map((r) => r['@id']);
    }

    if (targets.length === 0) {
      console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    console.log(`Will run mark.delegate (motivation: linking, PICO entity types) against ${targets.length} resource(s).`);

    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      console.log('Aborted.');
      closeInteractive();
      return;
    }

    let totalCreated = 0;
    for (const rId of targets) {
      const done = await semiont.mark.delegate(rId, {
        motivation: 'linking',
        entityTypes: PICO_ENTITY_TYPES,
      });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
      totalCreated += n;
      console.log(`  ${rId}: ${n} new PICO annotations`);
    }

    console.log(`\nDone. Created ${totalCreated} PICO annotations.`);
    closeInteractive();
  } finally {
    opened.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
