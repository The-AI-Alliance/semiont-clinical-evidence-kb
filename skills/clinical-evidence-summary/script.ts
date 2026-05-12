/**
 * clinical-evidence-summary — synthesize a per-treatment-decision evidence
 * aggregate, citing every supporting trial with effect sizes and RoB context.
 *
 * Usage:
 *   tsx skills/clinical-evidence-summary/script.ts \
 *     --drug <name> --condition <name> [--population <descriptor>]
 */

import {
  SemiontClient,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { close as closeReadline } from '../../src/interactive.js';

const MAX_GATHER = Number(process.env.MAX_GATHER_ANNOTATIONS ?? 12);
const SUMMARY_INSTRUCTIONS =
  process.env.SUMMARY_INSTRUCTIONS ??
  `Synthesize a clinical-evidence summary for the treatment decision in the gathered context.
Structure:
- Question: the (Drug, Condition, Population) framing.
- Trials reviewed: bullet list of source Trial resources with NCT identifier where present.
- Effect-size summary: aggregate the reported outcomes; surface direction, magnitude, and uncertainty.
  Weight each outcome by the source trial's risk-of-bias rating (low > moderate > high; unclear excluded).
- Outstanding concerns: pull from commenting annotations on the source trials.
- Recommendation: a one-paragraph synthesis. Mark explicitly as LLM judgment, not a substitute for clinical decision-making.
- Citations: every numbered claim links to a source trial / outcome.`;

function parseArgs(): { drug?: string; condition?: string; population?: string } {
  const out: { drug?: string; condition?: string; population?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--drug') { out.drug = next; i++; }
    else if (flag === '--condition') { out.condition = next; i++; }
    else if (flag === '--population') { out.population = next; i++; }
  }
  return out;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function main(): Promise<void> {
  const { drug, condition, population } = parseArgs();
  if (!drug || !condition) {
    console.error('Usage: --drug <name> --condition <name> [--population <descriptor>]');
    process.exit(1);
  }

  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  const all = await semiont.browse.resources({ limit: 2000 });

  // Find the canonical Drug resource matching the requested name
  const drugResources = all.filter((r) => {
    const types: string[] = (r as any).entityTypes ?? [];
    const name = ((r as any).name ?? '').toString().toLowerCase();
    return types.includes('Drug') && name.includes(drug.toLowerCase());
  });
  if (drugResources.length === 0) {
    console.error(`No canonical Drug resource matches "${drug}". Run canonicalize-drugs first.`);
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }
  const drugRes = drugResources[0];
  console.log(`Using canonical Drug: ${(drugRes as any).name} (${drugRes['@id']})`);

  // Find Trials whose graph edges include this Drug
  const trials = all.filter((r) => {
    const types: string[] = (r as any).entityTypes ?? [];
    return types.includes('Trial');
  });

  const matchingTrials: typeof trials = [];
  for (const t of trials) {
    const tId = ridBrand(t['@id']);
    const annos = await semiont.browse.annotations(tId);
    const linkedSources = new Set(
      annos.flatMap((a: any) =>
        (a.body ?? [])
          .filter((b: any) => b.type === 'SpecificResource' && b.purpose === 'linking')
          .map((b: any) => b.source as string),
      ),
    );
    if (linkedSources.has(drugRes['@id'])) matchingTrials.push(t);
  }

  if (matchingTrials.length === 0) {
    console.error(`No Trials with edges to "${(drugRes as any).name}". Run build-trial-graph first.`);
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }
  console.log(`Found ${matchingTrials.length} matching Trial resource(s).`);

  // Collect Outcome annotations on the source studies underlying those trials
  const outcomeRefs: { rId: ResourceId; annId: AnnotationId; text: string }[] = [];
  // The Trial canonical's edges point to Outcomes too — gather those
  for (const t of matchingTrials) {
    const tId = ridBrand(t['@id']);
    const annos = await semiont.browse.annotations(tId);
    for (const a of annos) {
      const targets = (a.body ?? []).filter(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      for (const tgt of targets) {
        const targetRes = all.find((r) => r['@id'] === (tgt as any).source);
        const targetTypes: string[] = (targetRes as any)?.entityTypes ?? [];
        if (!targetTypes.includes('Outcome')) continue;
        // gather.annotation on the Outcome resource — pull its source-anchoring annotation
        // We approximate: gather on this annotation (the edge), which carries the Trial's context.
        outcomeRefs.push({
          rId: tId,
          annId: a.id,
          text: ((targetRes as any)?.name ?? '') as string,
        });
      }
    }
  }

  if (outcomeRefs.length === 0) {
    console.error('No Outcome edges found on matching Trials. Run extract-outcomes + build-trial-graph first.');
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }

  console.log(`${outcomeRefs.length} outcome edge(s) discoverable; gathering up to ${MAX_GATHER}.`);

  const gathered: GatheredContext[] = [];
  for (const ref of outcomeRefs.slice(0, MAX_GATHER)) {
    const g = await semiont.gather.annotation(ref.rId, ref.annId, { contextWindow: 1500 });
    gathered.push(g.response as GatheredContext);
  }

  // Use the first gathered context as the anchor for yield.fromAnnotation;
  // the others are referenced in the body via prepend.
  const seedRef = outcomeRefs[0];
  const seedGather = gathered[0];

  const supplementaryContext = gathered
    .slice(1)
    .map((g) => (g as any).text ?? (g as any).content ?? '')
    .filter((t) => typeof t === 'string')
    .join('\n\n---\n\n');

  const prepend =
    `# Clinical Evidence Summary\n\n` +
    `**Question:** ${drug} for ${condition}${population ? ` in ${population}` : ''}.\n\n` +
    `## Trials reviewed\n\n` +
    matchingTrials.map((t) => `- ${(t as any).name} (\`${t['@id']}\`)`).join('\n') +
    `\n\n## Supplementary context\n\n${supplementaryContext}\n\n---\n\n`;

  const yieldEvent = await semiont.yield.fromAnnotation(seedRef.rId, seedRef.annId, {
    title: `Clinical Evidence Summary: ${drug} for ${condition}`,
    storageUri: `file://generated/evidence-summary-${slugify(drug)}-${slugify(condition)}.md`,
    context: seedGather,
    entityTypes: ['ClinicalEvidenceSummary', 'Aggregate'],
    instructions: SUMMARY_INSTRUCTIONS,
    prependBody: prepend,
  });

  if (yieldEvent.kind !== 'complete') {
    console.error(`yield.fromAnnotation did not complete: ${yieldEvent.kind}`);
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }
  const resourceId = (yieldEvent.data.result as { resourceId?: string } | undefined)?.resourceId;
  console.log(`\n✓ ClinicalEvidenceSummary synthesized: ${resourceId}`);
  console.log(`  Drug: ${(drugRes as any).name}`);
  console.log(`  Condition: ${condition}`);
  console.log(`  Trials reviewed: ${matchingTrials.length}`);
  console.log(`  Outcome edges considered: ${outcomeRefs.length}`);

  semiont.dispose();
  closeReadline();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
