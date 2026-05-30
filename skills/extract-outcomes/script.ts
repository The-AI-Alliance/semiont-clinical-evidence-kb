/**
 * extract-outcomes — turn every Outcome-tagged annotation into a structured
 * Outcome resource via yield.fromAnnotation.
 *
 * Usage: tsx skills/extract-outcomes/script.ts [--interactive]
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
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { parseEffectSizes, summarizeEffect } from '../../src/effect-size.js';

const MIN_OUTCOME_LENGTH = Number(process.env.MIN_OUTCOME_LENGTH ?? 30);
const OUTCOME_INSTRUCTIONS =
  process.env.OUTCOME_INSTRUCTIONS ??
  `From the gathered context, produce a brief structured Outcome description:
- Measure: what was measured (e.g., HbA1c reduction, all-cause mortality, progression-free survival)
- Effect size: HR/RR/OR/MD with 95% CI and p-value if reported
- Sample size and follow-up duration
- Population (if narrower than the trial-level inclusion criteria)
- Direction: which arm benefited (intervention vs. comparator) and by how much
Cite the source paragraph(s) the data came from.`;

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
}

interface OutcomeAnno {
  rId: ResourceId;
  annId: AnnotationId;
  text: string;
}

async function main(): Promise<void> {
  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'clinical-evidence-extract-outcomes',
    label: 'clinical-evidence extract-outcomes',
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

  const outcomes: OutcomeAnno[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'linking') continue;
      const bodies = Array.isArray(ann.body) ? ann.body : ann.body ? [ann.body] : [];
      const tags = bodies
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
        .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
      if (!tags.includes('Outcome')) continue;
      const target = ann.target;
      const selectors =
        typeof target === 'string' || !target.selector
          ? []
          : Array.isArray(target.selector)
            ? target.selector
            : [target.selector];
      let exact = '';
      for (const s of selectors) {
        if (s.type === 'TextQuoteSelector') { exact = s.exact; break; }
      }
      if (exact.length < MIN_OUTCOME_LENGTH) continue;
      outcomes.push({ rId, annId: ann.id, text: exact });
    }
  }

  if (outcomes.length === 0) {
    console.log('No Outcome annotations found. Run skills/mark-medical-entities/script.ts first.');
    await session.dispose();
    closeInteractive();
    return;
  }

  console.log(`Found ${outcomes.length} Outcome annotation(s) to extract.`);
  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    await session.dispose();
    closeInteractive();
    return;
  }

  let synthesized = 0;
  for (const o of outcomes) {
    const gather = await semiont.gather.annotation(o.rId, o.annId, { contextWindow: 1500 });
    if (!('response' in gather)) continue;
    const context = gather.response as GatheredContext;

    // Parse any effect sizes visible in the gathered text — embed as frontmatter.
    const contextText = (context as any).text ?? (context as any).content ?? '';
    const effects = parseEffectSizes(typeof contextText === 'string' ? contextText : '');
    const frontmatter =
      effects.length > 0
        ? `---\nparsed-effects:\n${effects.map((e) => `  - ${summarizeEffect(e)}`).join('\n')}\n---\n\n`
        : '';

    const yieldEvent = await semiont.yield.fromAnnotation(o.rId, o.annId, {
      title: `Outcome: ${o.text.slice(0, 80)}`,
      storageUri: `file://generated/outcome-${slugify(o.text)}.md`,
      context,
      entityTypes: ['Outcome', 'Aggregate'],
      prompt: frontmatter
        ? `${OUTCOME_INSTRUCTIONS}\n\nBegin the body with this preamble verbatim:\n\n${frontmatter}`
        : OUTCOME_INSTRUCTIONS,
    });

    if (yieldEvent.kind !== 'complete') continue;
    const newResourceId = (yieldEvent.data.result as { resourceId?: string } | undefined)?.resourceId;
    if (!newResourceId) continue;

    await semiont.bind.body(o.rId, o.annId, [
      {
        op: 'add',
        item: { type: 'SpecificResource', source: newResourceId, purpose: 'linking' },
      },
    ]);
    synthesized++;
    const eff = effects.length > 0 ? ` (${effects.map(summarizeEffect).join('; ')})` : '';
    console.log(`  + ${newResourceId} from "${o.text.slice(0, 60)}"${eff}`);
  }

  console.log(`\nDone. Synthesized ${synthesized} Outcome resources.`);
  await session.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
