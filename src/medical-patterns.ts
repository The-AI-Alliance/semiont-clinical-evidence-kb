/**
 * Pattern-based pre-filters for medical entity candidates.
 *
 * These regexes are deliberately permissive — meant to surface candidate
 * spans for `mark.assist` to confirm or reject, not to be authoritative
 * detectors on their own. They're domain-generic: no specific drug names,
 * conditions, or study identifiers are referenced.
 */

/** Drug-like tokens: capitalized words ending in common drug-name suffixes. */
const DRUG_SUFFIX_RE = /\b[A-Z][a-z]+(?:cillin|mycin|oxin|pril|sartan|statin|olol|azole|tinib|mab|nib|stat|prazole|caine|profen|olone|asone|cycline|idine|formin|oxetine)\b/g;

/** Dose patterns: number + unit. Common units in clinical text. */
const DOSE_RE = /\b\d+(?:\.\d+)?\s?(?:mg|g|mcg|μg|ug|kg|mL|L|IU|U|mmol|mEq|%|mg\/kg|mg\/m2|mg\/m²|mL\/min|min|hr|hours|days|weeks|months|years)\b/gi;

/** Effect-size patterns: HR, RR, OR, RD, MD, SMD with confidence interval. */
const EFFECT_SIZE_RE = /\b(?:HR|RR|OR|RD|MD|SMD|aHR|aRR|aOR)\s?[=:]?\s?\d+(?:\.\d+)?(?:\s?\(95%\s?CI[:\s]*\d+(?:\.\d+)?(?:\s?[-,]\s?\d+(?:\.\d+)?)?\))?/g;

/** P-value patterns. */
const P_VALUE_RE = /\bp\s?[=<>]\s?\d?\.\d+/gi;

/** Sample size patterns: n=N or N participants/patients. */
const SAMPLE_SIZE_RE = /\bn\s?=\s?\d+|\b\d+\s+(?:participants|patients|subjects|enrolled|randomized)\b/gi;

/** ClinicalTrials.gov NCT identifiers. */
const NCT_RE = /\bNCT\d{8}\b/g;

/** ICD-10 code pattern. */
const ICD10_RE = /\b[A-Z]\d{2}(?:\.\d{1,3})?\b/g;

export interface PatternHit {
  kind: 'drug' | 'dose' | 'effect-size' | 'p-value' | 'sample-size' | 'nct' | 'icd10';
  text: string;
  start: number;
  end: number;
}

export function findPatterns(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  const push = (kind: PatternHit['kind'], re: RegExp): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ kind, text: m[0], start: m.index, end: m.index + m[0].length });
    }
  };
  push('drug', DRUG_SUFFIX_RE);
  push('dose', DOSE_RE);
  push('effect-size', EFFECT_SIZE_RE);
  push('p-value', P_VALUE_RE);
  push('sample-size', SAMPLE_SIZE_RE);
  push('nct', NCT_RE);
  push('icd10', ICD10_RE);
  return hits.sort((a, b) => a.start - b.start);
}

/** Summarize pattern hits by kind. Useful for tier-3 preview output. */
export function summarizeHits(hits: PatternHit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of hits) counts[h.kind] = (counts[h.kind] ?? 0) + 1;
  return counts;
}
