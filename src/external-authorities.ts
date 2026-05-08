/**
 * Adapter stubs for medical external-authority lookups.
 *
 * Per the layered-data-model framing: external authorities (RxNorm, ICD-10,
 * SNOMED-CT, ClinicalTrials.gov) live as a peer layer to the in-corpus
 * canonical nodes. This module provides URL-construction helpers and a
 * deliberately-light-touch lookup interface that returns *stub* records —
 * just enough to seed a canonical resource with an External References
 * section pointing at the authoritative source.
 *
 * For demonstration purposes the lookups are URL-construction only (no live
 * API calls). A production deployment would replace `lookupRxNormStub` with
 * an actual RxNorm REST API call (https://rxnav.nlm.nih.gov/RxNormAPIs.html),
 * etc.
 *
 * All lookups are domain-generic: they accept any drug / condition / NCT
 * string and return a stub that points to the relevant authority.
 */

export interface ExternalReference {
  authority: 'RxNorm' | 'ICD-10' | 'SNOMED-CT' | 'ClinicalTrials.gov' | 'PubMed';
  identifier: string;
  url: string;
  label: string;
}

/** RxNorm RxNav search URL for a drug name. */
export function rxnormSearchUrl(drugName: string): string {
  return `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(drugName)}`;
}

/** RxNorm display URL for an RxCUI. */
export function rxnormDisplayUrl(rxcui: string): string {
  return `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(rxcui)}`;
}

/** Return a stub External Reference for a drug name (no live API call). */
export function lookupRxNormStub(drugName: string): ExternalReference {
  return {
    authority: 'RxNorm',
    identifier: drugName,
    url: rxnormSearchUrl(drugName),
    label: `RxNorm: ${drugName}`,
  };
}

/** ICD-10 search URL via WHO classifications. */
export function icd10SearchUrl(condition: string): string {
  return `https://icd.who.int/browse10/2019/en#/search/${encodeURIComponent(condition)}`;
}

/** SNOMED-CT browser URL. */
export function snomedSearchUrl(condition: string): string {
  return `https://browser.ihtsdotools.org/?perspective=full&conceptId1=&edition=MAIN&release=&languages=en&search=${encodeURIComponent(condition)}`;
}

/** Return a stub External Reference for a condition name. Picks ICD-10 by default. */
export function lookupConditionStub(
  condition: string,
  authority: 'ICD-10' | 'SNOMED-CT' = 'ICD-10',
): ExternalReference {
  const url = authority === 'ICD-10' ? icd10SearchUrl(condition) : snomedSearchUrl(condition);
  return {
    authority,
    identifier: condition,
    url,
    label: `${authority}: ${condition}`,
  };
}

/** ClinicalTrials.gov entry URL for an NCT identifier. */
export function clinicalTrialsUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`;
}

export function lookupTrialStub(nctId: string): ExternalReference {
  return {
    authority: 'ClinicalTrials.gov',
    identifier: nctId,
    url: clinicalTrialsUrl(nctId),
    label: `ClinicalTrials.gov: ${nctId}`,
  };
}

/** PubMed search URL. */
export function pubmedSearchUrl(query: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}

export function lookupPubMedStub(query: string): ExternalReference {
  return {
    authority: 'PubMed',
    identifier: query,
    url: pubmedSearchUrl(query),
    label: `PubMed: ${query}`,
  };
}

/** Format an ExternalReference as a markdown bullet for embedding in canonical-resource bodies. */
export function formatReference(ref: ExternalReference): string {
  return `- [${ref.label}](${ref.url})`;
}

/** Format a list of ExternalReferences as a complete External References section. */
export function formatReferenceSection(refs: ExternalReference[]): string {
  if (refs.length === 0) return '';
  return `## External References\n\n${refs.map(formatReference).join('\n')}\n`;
}
