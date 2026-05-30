/**
 * tag-pico — classify clinical text by PICO category.
 *
 * mark.assist with motivation 'linking' and four entity types
 * (PICO_Patient / PICO_Intervention / PICO_Comparison / PICO_Outcome).
 *
 * NOTE: This is the interim shape until a registered `clinical-pico` tag
 * schema lands in `@semiont/ontology`. Once it does, this skill migrates to
 * mark.assist(..., 'tagging', { schemaId: 'clinical-pico', categories: [...] })
 * and the entity-type variants retire. The query shape is the same; only
 * registration differs.
 *
 * Usage: tsx skills/tag-pico/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, type KnowledgeBase, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

const PICO_ENTITY_TYPES = [
  entityType('PICO_Patient'),
  entityType('PICO_Intervention'),
  entityType('PICO_Comparison'),
  entityType('PICO_Outcome'),
];

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'clinical-evidence-tag-pico',
    label: 'clinical-evidence tag-pico',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  let targets: ResourceId[];
  if (explicitResourceId) {
    targets = [ridBrand(explicitResourceId)];
  } else {
    const all = await semiont.browse.resources({ limit: 1000 });
    targets = all
      .filter((r) => {
        const mt = getMediaType(r);
        return mt === 'text/markdown' || mt === 'text/plain';
      })
      .map((r) => ridBrand(r['@id']));
  }

  if (targets.length === 0) {
    console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
    await session.dispose();
    closeInteractive();
    return;
  }

  console.log(`Will run mark.assist (motivation: linking, PICO entity types) against ${targets.length} resource(s).`);

  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    console.log('Aborted.');
    await session.dispose();
    closeInteractive();
    return;
  }

  let totalCreated = 0;
  for (const rId of targets) {
    const progress = await semiont.mark.assist(rId, 'linking', {
      entityTypes: PICO_ENTITY_TYPES,
    });
    const n = createdCount(progress);
    totalCreated += n;
    console.log(`  ${rId}: ${n} new PICO annotations`);
  }

  console.log(`\nDone. Created ${totalCreated} PICO annotations.`);
  await session.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
