/**
 * mark-medical-entities — detect Drug, Condition, Dose, Outcome,
 * AdverseEvent, Population, Intervention, Comparator spans across the
 * markdown corpus.
 *
 * mark.delegate with motivation 'linking'. Targets markdown resources only;
 * PDFs are silently skipped because mark.delegate requires text input.
 *
 * Usage: tsx skills/mark-medical-entities/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

const ENTITY_TYPES = (
  process.env.ENTITY_TYPES ??
  'Drug,Condition,Dose,Outcome,AdverseEvent,Population,Intervention,Comparator'
)
  .split(',')
  .map((t) => entityType(t.trim()));


async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const opened = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-mark-medical-entities',
      label: 'clinical-evidence mark-medical-entities',
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

    console.log(
      `Will run mark.delegate (motivation: linking, ${ENTITY_TYPES.length} entity types) ` +
        `against ${targets.length} markdown resource(s).`,
    );
    console.log(`  Entity types: ${ENTITY_TYPES.join(', ')}`);

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
        entityTypes: ENTITY_TYPES,
      });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
      totalCreated += n;
      console.log(`  ${rId}: ${n} new annotations`);
    }

    console.log(`\nDone. Created ${totalCreated} medical-entity annotations.`);
    closeInteractive();
  } finally {
    opened.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
