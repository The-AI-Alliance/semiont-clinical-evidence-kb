/**
 * Helpers for parsing and summarizing effect-size language found in
 * clinical-trial reports.
 *
 * Generic across any clinical corpus — no specific drug, condition, or
 * trial is referenced. The parsers handle the most common reporting
 * conventions (HR, RR, OR, RD, MD, SMD, with optional 95% CI and p-value).
 */

export type EffectMetric = 'HR' | 'RR' | 'OR' | 'RD' | 'MD' | 'SMD' | 'aHR' | 'aRR' | 'aOR';

export interface EffectSize {
  metric: EffectMetric;
  point: number;
  ci?: { lower: number; upper: number };
  pValue?: number;
  raw: string;
}

const METRIC_RE =
  /\b(HR|RR|OR|RD|MD|SMD|aHR|aRR|aOR)\s?[=:]?\s?(-?\d+(?:\.\d+)?)\s?(?:\(\s?95%\s?CI[:\s]*(-?\d+(?:\.\d+)?)\s?[-,]\s?(-?\d+(?:\.\d+)?)\s?\))?/g;

const P_RE = /\bp\s?([=<>])\s?(\d?\.\d+)/i;

export function parseEffectSizes(text: string): EffectSize[] {
  const out: EffectSize[] = [];
  METRIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METRIC_RE.exec(text)) !== null) {
    if (!m[1] || !m[2]) continue;
    const metric = m[1] as EffectMetric;
    const point = parseFloat(m[2]);
    const lowerStr = m[3];
    const upperStr = m[4];
    const ci = lowerStr && upperStr
      ? { lower: parseFloat(lowerStr), upper: parseFloat(upperStr) }
      : undefined;

    // Look for a p-value in the next ~80 chars.
    const tail = text.slice(m.index, m.index + 200);
    const pMatch = tail.match(P_RE);
    const pValue = pMatch && pMatch[2] ? parseFloat(pMatch[2]) : undefined;

    out.push({ metric, point, ci, pValue, raw: m[0] });
  }
  return out;
}

export function summarizeEffect(es: EffectSize): string {
  let s = `${es.metric} = ${es.point}`;
  if (es.ci) s += ` (95% CI ${es.ci.lower}–${es.ci.upper})`;
  if (es.pValue !== undefined) s += `, p = ${es.pValue}`;
  return s;
}

/** Rough significance check: CI doesn't cross 1 for ratio metrics, or 0 for difference metrics, OR p < 0.05. */
export function isLikelySignificant(es: EffectSize): boolean {
  if (es.pValue !== undefined && es.pValue < 0.05) return true;
  if (!es.ci) return false;
  const ratioMetric = es.metric === 'HR' || es.metric === 'RR' || es.metric === 'OR' ||
    es.metric === 'aHR' || es.metric === 'aRR' || es.metric === 'aOR';
  if (ratioMetric) return es.ci.upper < 1 || es.ci.lower > 1;
  return es.ci.upper < 0 || es.ci.lower > 0;
}
