/**
 * drug-comparison — compare two interventions across the trial corpus.
 *
 * Categorizes trials by head-to-head / indirect-via-shared-comparator /
 * single-arm-only and synthesizes a DrugComparison aggregate.
 *
 * Usage:
 *   tsx skills/drug-comparison/script.ts --drug-a <name> --drug-b <name> [--condition <name>]
 */

import {
  SemiontClient,
  resourceId as ridBrand,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { close as closeReadline } from '../../src/interactive.js';

const COMPARISON_INSTRUCTIONS =
  process.env.COMPARISON_INSTRUCTIONS ??
  `Synthesize a DrugComparison from the gathered context:
- Direct (head-to-head) evidence: list trials and their outcomes.
- Indirect evidence (shared comparator): trial pairs and what each shows vs. the common comparator.
- Effect-size differences: where computable, surface the difference and its uncertainty.
- Certainty: rate the comparison certainty (high/moderate/low/very-low) explaining the rationale.
Cite every claim. Mark the synthesis as LLM judgment grounded in the source trials.`;

function parseArgs(): { drugA?: string; drugB?: string; condition?: string } {
  const out: { drugA?: string; drugB?: string; condition?: string } = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--drug-a') { out.drugA = argv[++i]; }
    else if (argv[i] === '--drug-b') { out.drugB = argv[++i]; }
    else if (argv[i] === '--condition') { out.condition = argv[++i]; }
  }
  return out;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function main(): Promise<void> {
  const { drugA, drugB, condition } = parseArgs();
  if (!drugA || !drugB) {
    console.error('Usage: --drug-a <name> --drug-b <name> [--condition <name>]');
    process.exit(1);
  }

  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  const all = await semiont.browse.resources({ limit: 2000 });
  const drugAResource = all.find((r) => {
    const types: string[] = (r as any).entityTypes ?? [];
    return types.includes('Drug') && (((r as any).name ?? '') as string).toLowerCase().includes(drugA.toLowerCase());
  });
  const drugBResource = all.find((r) => {
    const types: string[] = (r as any).entityTypes ?? [];
    return types.includes('Drug') && (((r as any).name ?? '') as string).toLowerCase().includes(drugB.toLowerCase());
  });
  if (!drugAResource || !drugBResource) {
    console.error('Both drugs must be present as canonical Drug resources. Run canonicalize-drugs first.');
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }

  const trials = all.filter((r) => {
    const types: string[] = (r as any).entityTypes ?? [];
    return types.includes('Trial');
  });

  const trialEdges = new Map<ResourceId, Set<string>>();
  for (const t of trials) {
    const tId = ridBrand(t['@id']);
    const annos = await semiont.browse.annotations(tId);
    const linked = new Set(
      annos.flatMap((a: any) =>
        (a.body ?? [])
          .filter((b: any) => b.type === 'SpecificResource' && b.purpose === 'linking')
          .map((b: any) => b.source as string),
      ),
    );
    trialEdges.set(tId, linked);
  }

  const aId = drugAResource['@id'];
  const bId = drugBResource['@id'];

  const headToHead: ResourceId[] = [];
  const onlyA: ResourceId[] = [];
  const onlyB: ResourceId[] = [];
  for (const [tId, linked] of trialEdges) {
    const hasA = linked.has(aId);
    const hasB = linked.has(bId);
    if (hasA && hasB) headToHead.push(tId);
    else if (hasA) onlyA.push(tId);
    else if (hasB) onlyB.push(tId);
  }

  // Find shared comparators by intersecting non-A, non-B linked sources between onlyA and onlyB
  const onlyALinks = new Set<string>();
  const onlyBLinks = new Set<string>();
  for (const tId of onlyA) for (const x of trialEdges.get(tId)!) if (x !== aId) onlyALinks.add(x);
  for (const tId of onlyB) for (const x of trialEdges.get(tId)!) if (x !== bId) onlyBLinks.add(x);
  const sharedComparators = [...onlyALinks].filter((x) => onlyBLinks.has(x));

  const indirectAtrials = onlyA.filter((tId) => {
    const linked = trialEdges.get(tId)!;
    return sharedComparators.some((c) => linked.has(c));
  });
  const indirectBtrials = onlyB.filter((tId) => {
    const linked = trialEdges.get(tId)!;
    return sharedComparators.some((c) => linked.has(c));
  });

  console.log(`${headToHead.length} head-to-head, ${indirectAtrials.length} + ${indirectBtrials.length} indirect (${sharedComparators.length} shared comparators).`);

  // Pick a seed: prefer head-to-head, else first onlyA trial
  const seedTrialId = headToHead[0] ?? indirectAtrials[0] ?? onlyA[0];
  if (!seedTrialId) {
    console.error('No relevant trials found.');
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }
  const seedAnnos = await semiont.browse.annotations(seedTrialId);
  const seedAnno = seedAnnos[0];
  if (!seedAnno) {
    console.error('Seed trial has no annotations to gather from.');
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }

  const gather = await semiont.gather.annotation(seedAnno.id, seedTrialId, { contextWindow: 2000 });
  const context = gather.response as GatheredContext;

  const trialList = (label: string, ids: ResourceId[]): string => {
    if (ids.length === 0) return `### ${label}\n\n(none)\n`;
    const names = ids.map((id) => {
      const r = all.find((x) => x['@id'] === id);
      return `- ${(r as any)?.name ?? id} (\`${id}\`)`;
    });
    return `### ${label}\n\n${names.join('\n')}\n`;
  };

  const prepend =
    `# Drug Comparison: ${drugA} vs. ${drugB}${condition ? ` in ${condition}` : ''}\n\n` +
    trialList('Head-to-head trials', headToHead) +
    trialList(`Indirect — ${drugA} arm (vs. shared comparator)`, indirectAtrials) +
    trialList(`Indirect — ${drugB} arm (vs. shared comparator)`, indirectBtrials) +
    `### Shared comparators\n\n${sharedComparators.length > 0
      ? sharedComparators.map((c) => `- ${(all.find((r) => r['@id'] === c) as any)?.name ?? c}`).join('\n')
      : '(none)'}\n\n---\n\n`;

  const yieldEvent = await semiont.yield.fromAnnotation(seedTrialId, seedAnno.id, {
    title: `Drug Comparison: ${drugA} vs. ${drugB}`,
    storageUri: `file://generated/comparison-${slugify(drugA)}-vs-${slugify(drugB)}.md`,
    context,
    entityTypes: ['DrugComparison', 'Aggregate'],
    instructions: COMPARISON_INSTRUCTIONS,
    prependBody: prepend,
  });

  if (yieldEvent.kind !== 'complete') {
    console.error(`yield.fromAnnotation did not complete: ${yieldEvent.kind}`);
    semiont.dispose();
    closeReadline();
    process.exit(1);
  }
  const resourceId = (yieldEvent.data.result as { resourceId?: string } | undefined)?.resourceId;
  console.log(`\n✓ DrugComparison synthesized: ${resourceId}`);

  semiont.dispose();
  closeReadline();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
