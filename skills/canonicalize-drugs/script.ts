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
  type KnowledgeBase,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';
import { lookupRxNormStub, formatReferenceSection } from '../../src/external-authorities.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);

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

interface DrugAnno {
  rId: ResourceId;
  annId: AnnotationId;
  text: string;
  alreadyBound: boolean;
}

async function main(): Promise<void> {
  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'clinical-evidence-canonicalize-drugs',
    label: 'clinical-evidence canonicalize-drugs',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  const all = await semiont.browse.resources({ limit: 1000 });
  const markdownResources = all.filter((r) => {
    const mt = getMediaType(r);
    return mt === 'text/markdown' || mt === 'text/plain';
  });

  if (markdownResources.length === 0) {
    console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
    await session.dispose();
    closeInteractive();
    return;
  }

  // Collect Drug-tagged annotations across the corpus
  const drugAnnotations: DrugAnno[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'linking') continue;
      const bodies = Array.isArray(ann.body) ? ann.body : ann.body ? [ann.body] : [];
      const tags = bodies
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
        .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
      if (!tags.includes('Drug')) continue;
      const alreadyBound = bodies.some(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      const target = ann.target;
      const selectors =
        typeof target === 'string' || !target.selector
          ? []
          : Array.isArray(target.selector)
            ? target.selector
            : [target.selector];
      let text = '';
      for (const s of selectors) {
        if (s.type === 'TextQuoteSelector') { text = s.exact; break; }
      }
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
    await session.dispose();
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
    await session.dispose();
    closeInteractive();
    return;
  }

  let bound = 0;
  let synthesized = 0;
  let skipped = 0;

  for (const [key, anns] of clusters) {
    const sample = anns[0];
    if (!sample) continue;

    const gather = await semiont.gather.annotation(sample.rId, sample.annId, {
      contextWindow: 1200,
    });
    if (!('response' in gather)) continue;
    const context = gather.response as GatheredContext;

    const matchResult = await semiont.match.search(sample.rId, sample.annId, context, {
      limit: 5,
      useSemanticScoring: true,
    });
    const top = matchResult.response[0];

    let targetResourceId: string;
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

      const yieldEvent = await semiont.yield.fromAnnotation(sample.rId, sample.annId, {
        title: key,
        storageUri: `file://generated/drug-${slugify(key)}.md`,
        context,
        entityTypes: ['Drug'],
        prompt: externalRefs
          ? `Include this references section at the end of the body verbatim:\n\n${externalRefs}`
          : undefined,
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
  await session.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
