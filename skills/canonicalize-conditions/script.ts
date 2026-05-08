/**
 * canonicalize-conditions — promote Condition mentions to canonical
 * Condition resources with ICD-10 + SNOMED-CT External References.
 *
 * Usage: tsx skills/canonicalize-conditions/script.ts [--interactive]
 */

import {
  SemiontClient,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';
import { lookupConditionStub, formatReferenceSection } from '../../src/external-authorities.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);
const PRIMARY_AUTHORITY = (process.env.CONDITION_AUTHORITY === 'SNOMED-CT' ? 'SNOMED-CT' : 'ICD-10') as
  | 'ICD-10'
  | 'SNOMED-CT';
const SECONDARY_AUTHORITY: 'ICD-10' | 'SNOMED-CT' =
  PRIMARY_AUTHORITY === 'ICD-10' ? 'SNOMED-CT' : 'ICD-10';

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

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
  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  const all = await semiont.browse.resources({ limit: 1000 });
  const markdownResources = all.filter((r) => {
    const mt = getMediaType(r);
    return mt === 'text/markdown' || mt === 'text/plain';
  });

  if (markdownResources.length === 0) {
    console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  const condAnnotations: CondAnno[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'linking') continue;
      const tags = (ann.body ?? [])
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
        .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
      if (!tags.includes('Condition')) continue;
      const alreadyBound = (ann.body ?? []).some(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      condAnnotations.push({
        rId,
        annId: ann.id,
        text: ann.target?.selector?.exact ?? '',
        alreadyBound,
      });
    }
  }

  if (condAnnotations.length === 0) {
    console.log('No Condition annotations found. Run skills/mark-medical-entities/script.ts first.');
    semiont.dispose();
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
    semiont.dispose();
    closeInteractive();
    return;
  }

  let bound = 0;
  let synthesized = 0;
  let skipped = 0;

  for (const [key, anns] of clusters) {
    const sample = anns[0];
    const gather = await semiont.gather.annotation(sample.annId, sample.rId, {
      contextWindow: 1200,
    });
    const context = gather.response as GatheredContext;

    const matchResult = await semiont.match.search(sample.rId, sample.annId, context, {
      limit: 5,
      useSemanticScoring: true,
    });
    const top = matchResult.response[0];

    let targetResourceId: string;
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

      const yieldEvent = await semiont.yield.fromAnnotation(sample.rId, sample.annId, {
        title: key,
        storageUri: `file://generated/condition-${slugify(key)}.md`,
        context,
        entityTypes: ['Condition'],
        appendBody: externalRefs,
      });

      if (yieldEvent.kind !== 'complete') {
        console.warn(`  unexpected yield event for "${sample.text}": ${yieldEvent.kind}`);
        continue;
      }
      const newResourceId = (
        yieldEvent.data.result as { resourceId?: string } | undefined
      )?.resourceId;
      if (!newResourceId) {
        console.warn(`  yield.fromAnnotation gave no resourceId for "${sample.text}"`);
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
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
