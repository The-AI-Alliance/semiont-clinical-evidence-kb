/**
 * build-trial-graph — promote each Trial mention to a canonical Trial
 * resource (NCT-grounded where present), then wire Trial → Drug,
 * Trial → Population, Trial → Outcome edges.
 *
 * Usage: tsx skills/build-trial-graph/script.ts [--interactive]
 */

import { SemiontClient, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { lookupTrialStub, formatReferenceSection } from '../../src/external-authorities.js';

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

const NCT_RE = /\bNCT\d{8}\b/;

interface CanonicalTarget {
  resourceId: string;
  entityTypes: string[];
}

async function main(): Promise<void> {
  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  const all = await semiont.browse.resources({ limit: 1000 });

  const studies = all.filter((r) => {
    const mt = getMediaType(r);
    const isText = mt === 'text/markdown' || mt === 'text/plain';
    const types: string[] = (r as any).entityTypes ?? [];
    return isText && (types.includes('Trial') || types.includes('ObservationalStudy'));
  });

  if (studies.length === 0) {
    console.log('No Trial / ObservationalStudy resources found. Run skills/ingest-corpus/script.ts first.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  console.log(`Will canonicalize ${studies.length} study resource(s) and wire Trial graph edges.`);
  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    semiont.dispose();
    closeInteractive();
    return;
  }

  let trialsCreated = 0;
  let totalEdges = 0;

  for (const study of studies) {
    const studyId = ridBrand(study['@id']);
    const studyName = (study as any).name ?? 'untitled';

    // Find an NCT in any annotation on this study
    const annotations = await semiont.browse.annotations(studyId);
    const nctMatch = annotations
      .map((ann) => (ann.target?.selector?.exact ?? '') as string)
      .find((t) => NCT_RE.test(t));
    const nctId = nctMatch ? (nctMatch.match(NCT_RE)?.[0] ?? null) : null;

    // Synthesize canonical Trial resource
    const externalRefs = nctId
      ? formatReferenceSection([lookupTrialStub(nctId)])
      : '';
    const trialBody = `# ${studyName}\n\nCanonical Trial resource for the source study at \`${studyId}\`.\n\n${externalRefs}`;

    const yieldEvent = await semiont.yield.resource({
      name: studyName,
      file: Buffer.from(trialBody, 'utf-8'),
      format: 'text/markdown',
      entityTypes: nctId ? ['Trial', 'ClinicalTrialsGovEntry'] : ['Trial'],
      storageUri: `file://generated/trial-${slugify(studyName)}.md`,
    });
    const trialId = yieldEvent.resourceId;
    trialsCreated++;

    // Walk annotations on the source study; collect bound canonical resources
    // (Drug, Condition, Outcome) and add edges from the Trial.
    const seen = new Set<string>();
    let edges = 0;
    for (const ann of annotations) {
      const bodies = (ann.body ?? []).filter(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      for (const b of bodies) {
        const target = (b as any).source as string | undefined;
        if (!target || seen.has(target)) continue;
        seen.add(target);

        // Look up the target's entity types — only edge to canonical Drug/Condition/Outcome/Population
        const targetRes = all.find((r) => r['@id'] === target);
        const targetTypes: string[] = (targetRes as any)?.entityTypes ?? [];
        const isCanonical =
          targetTypes.includes('Drug') ||
          targetTypes.includes('Condition') ||
          targetTypes.includes('Outcome') ||
          targetTypes.includes('Population');
        if (!isCanonical) continue;

        // Add an edge by binding the Trial body to a description of the
        // relationship (we use a marker annotation on the Trial resource).
        // For a graph edge, we create a `bind.body` annotation on the Trial
        // pointing at the target.
        await semiont.mark.annotation({
          target: { source: trialId },
          motivation: 'linking',
          body: [
            {
              type: 'SpecificResource',
              source: target,
              purpose: 'linking',
            },
            {
              type: 'TextualBody',
              purpose: 'tagging',
              value: ['has-' + (targetTypes.find((t) =>
                ['Drug', 'Condition', 'Outcome', 'Population'].includes(t)
              ) ?? 'related').toLowerCase()],
            },
          ],
        });
        edges++;
      }
    }

    totalEdges += edges;
    console.log(`  + Trial ${trialId} ("${studyName}"${nctId ? `, ${nctId}` : ''}): ${edges} edges`);
  }

  console.log(
    `\nDone. ${trialsCreated} canonical Trial resources; ${totalEdges} edges wired across the graph.`,
  );
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
