/**
 * canonicalize-drugs — promote Drug mentions to canonical Drug resources
 * with RxNorm-grounded External References.
 *
 * Mirrors the legal-kb build-party-graph pattern (cluster → match → yield
 * or bind) but the synthesized resource carries an External References
 * section pointing at RxNorm for the drug name.
 *
 * Usage: tsx skills/canonicalize-drugs/script.ts [--interactive]
 */

import {
  SemiontSession,
  InMemorySessionStorage,
  httpKb,
  getAnnotationExactText,
  getEntityTypes,
  type AnnotationId,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';
import { lookupRxNormStub, formatReferenceSection } from '../../src/external-authorities.js';
import { getMediaType } from '../../src/media-type.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);


function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

interface DrugAnno {
  rId: ResourceId;
  annId: AnnotationId;
  text: string;
  alreadyBound: boolean;
}

async function main(): Promise<void> {
  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const session = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-canonicalize-drugs',
      label: 'clinical-evidence canonicalize-drugs',
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
    const markdownResources = all.filter((r) => {
      const mt = getMediaType(r);
      return mt === 'text/markdown' || mt === 'text/plain';
    });

    if (markdownResources.length === 0) {
      console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    // Collect Drug-tagged annotations across the corpus
    const drugAnnotations: DrugAnno[] = [];
    for (const r of markdownResources) {
      const rId = r['@id'];
      const annotations = await semiont.browse.annotations(rId).fresh();
      for (const ann of annotations) {
        if (ann.motivation !== 'linking') continue;
        const tags = getEntityTypes(ann);
        if (!tags.includes('Drug')) continue;
        const alreadyBound = bodies.some(
          (b) => b.type === 'SpecificResource' && b.purpose === 'linking',
        );
        const text = getAnnotationExactText(ann);
        drugAnnotations.push({
          rId,
          annId: ann.id,
          text,
          alreadyBound,
        });
      }
    }

    if (drugAnnotations.length === 0) {
      console.log('No Drug annotations found. Run skills/mark-medical-entities/script.ts first.');
      closeInteractive();
      return;
    }

    const clusters = new Map<string, DrugAnno[]>();
    let alreadyBound = 0;
    for (const a of drugAnnotations) {
      if (a.alreadyBound) {
        alreadyBound++;
        continue;
      }
      // Normalize: lowercase, strip trailing dose/unit fragments
      const key = a.text.toLowerCase().replace(/\s+\d+\s?(mg|g|mcg|mL|IU|U)\b.*$/i, '').trim();
      if (!key) continue;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(a);
    }

    console.log(
      `Found ${drugAnnotations.length} Drug annotation(s). ` +
        `${alreadyBound} already bound; ${clusters.size} unbound clusters to process.`,
    );

    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      console.log('Aborted.');
      closeInteractive();
      return;
    }

    let bound = 0;
    let synthesized = 0;
    let skipped = 0;

    for (const [key, anns] of clusters) {
      const sample = anns[0];
      if (!sample) continue;

      const { response: context } = await semiont.gather.annotation(sample.rId, sample.annId, {
        contextWindow: 1200,
      });

      const matchResult = await semiont.match.search(sample.rId, sample.annId, context, {
        limit: 5,
        useSemanticScoring: true,
      });
      const top = matchResult.response[0];

      let targetResourceId: ResourceId;
      if (top && (top.score ?? 0) >= MATCH_THRESHOLD && top.entityTypes?.includes('Drug')) {
        targetResourceId = top['@id'];
        console.log(`  ↪ "${sample.text}" → ${top.name} (existing, score ${top.score})`);
      } else {
        const proceedYield = isInteractive()
          ? await confirm(
              `No confident match for "${sample.text}". Synthesize a new Drug resource?`,
              true,
            )
          : true;
        if (!proceedYield) {
          skipped++;
          continue;
        }

        // Synthesize a new Drug resource. The model produces the body from
        // the gathered context; we append an External References section
        // pointing at RxNorm for the drug name.
        const ref = lookupRxNormStub(key);
        const externalRefs = formatReferenceSection([ref]);

        const yieldEvent = await semiont.yield.delegate({
          context,
          title: key,
          storageUri: `file://generated/drug-${slugify(key)}.md`,
          entityTypes: ['Drug'],
          prompt: externalRefs
            ? `Include this references section at the end of the body verbatim:\n\n${externalRefs}`
            : undefined,
          });

        if (!yieldEvent.result || !('resourceId' in yieldEvent.result)) {
          console.warn(`  the generation made no resource for "${sample.text}"`);
          continue;
        }
        const newResourceId = yieldEvent.result && 'resourceId' in yieldEvent.result ? yieldEvent.result.resourceId : undefined;
        if (!newResourceId) {
          console.warn(`  yield.delegate gave no resourceId for "${sample.text}"`);
          continue;
        }

        targetResourceId = newResourceId;
        synthesized++;
        console.log(`  + "${sample.text}" → ${newResourceId} (synthesized; RxNorm grounded)`);
      }

      for (const a of anns) {
        await semiont.bind.body(a.rId, a.annId, [
          {
            op: 'add',
            item: { type: 'SpecificResource', source: targetResourceId, purpose: 'linking' },
          },
        ]);
        bound++;
      }
    }

    console.log(
      `\nDone. Bound ${bound} annotations across ${clusters.size} drug clusters; ` +
        `${synthesized} new Drug resources synthesized; ${skipped} skipped.`,
    );
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
