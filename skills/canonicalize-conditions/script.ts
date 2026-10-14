/**
 * canonicalize-conditions — promote Condition mentions to canonical
 * Condition resources with ICD-10 + SNOMED-CT External References.
 *
 * Usage: tsx skills/canonicalize-conditions/script.ts [--interactive]
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
import { lookupConditionStub, formatReferenceSection } from '../../src/external-authorities.js';
import { getMediaType } from '../../src/media-type.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);
const PRIMARY_AUTHORITY = (process.env.CONDITION_AUTHORITY === 'SNOMED-CT' ? 'SNOMED-CT' : 'ICD-10') as
  | 'ICD-10'
  | 'SNOMED-CT';
const SECONDARY_AUTHORITY: 'ICD-10' | 'SNOMED-CT' =
  PRIMARY_AUTHORITY === 'ICD-10' ? 'SNOMED-CT' : 'ICD-10';


function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

interface CondAnno {
  rId: ResourceId;
  annId: AnnotationId;
  text: string;
  alreadyBound: boolean;
}

async function main(): Promise<void> {
  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const session = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'clinical-evidence-canonicalize-conditions',
      label: 'clinical-evidence canonicalize-conditions',
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

    const condAnnotations: CondAnno[] = [];
    for (const r of markdownResources) {
      const rId = r['@id'];
      const annotations = await semiont.browse.annotations(rId).fresh();
      for (const ann of annotations) {
        if (ann.motivation !== 'linking') continue;
        const tags = getEntityTypes(ann);
        if (!tags.includes('Condition')) continue;
        const alreadyBound = bodies.some(
          (b) => b.type === 'SpecificResource' && b.purpose === 'linking',
        );
        const text = getAnnotationExactText(ann);
        condAnnotations.push({
          rId,
          annId: ann.id,
          text,
          alreadyBound,
        });
      }
    }

    if (condAnnotations.length === 0) {
      console.log('No Condition annotations found. Run skills/mark-medical-entities/script.ts first.');
      closeInteractive();
      return;
    }

    const clusters = new Map<string, CondAnno[]>();
    let alreadyBoundCount = 0;
    for (const a of condAnnotations) {
      if (a.alreadyBound) {
        alreadyBoundCount++;
        continue;
      }
      const key = a.text.toLowerCase().trim();
      if (!key) continue;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(a);
    }

    console.log(
      `Found ${condAnnotations.length} Condition annotation(s). ` +
        `${alreadyBoundCount} already bound; ${clusters.size} unbound clusters to process.`,
    );

    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
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
      if (top && (top.score ?? 0) >= MATCH_THRESHOLD && top.entityTypes?.includes('Condition')) {
        targetResourceId = top['@id'];
        console.log(`  ↪ "${sample.text}" → ${top.name} (existing, score ${top.score})`);
      } else {
        const proceedYield = isInteractive()
          ? await confirm(
              `No confident match for "${sample.text}". Synthesize a new Condition resource?`,
              true,
            )
          : true;
        if (!proceedYield) {
          skipped++;
          continue;
        }

        const refs = [
          lookupConditionStub(key, PRIMARY_AUTHORITY),
          lookupConditionStub(key, SECONDARY_AUTHORITY),
        ];
        const externalRefs = formatReferenceSection(refs);

        const yieldEvent = await semiont.yield.delegate({
          context,
          title: key,
          storageUri: `file://generated/condition-${slugify(key)}.md`,
          entityTypes: ['Condition'],
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
        console.log(
          `  + "${sample.text}" → ${newResourceId} (synthesized; ${PRIMARY_AUTHORITY}+${SECONDARY_AUTHORITY} grounded)`,
        );
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
      `\nDone. Bound ${bound} annotations across ${clusters.size} condition clusters; ` +
        `${synthesized} new Condition resources synthesized; ${skipped} skipped.`,
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
