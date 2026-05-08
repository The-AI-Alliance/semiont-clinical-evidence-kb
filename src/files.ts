/**
 * Corpus file discovery and ingest input preparation.
 *
 * Walks the repo's top-level subdirectories looking for clinical-evidence
 * documents (markdown and PDF), classifies each by filename heuristic, and
 * produces CorpusFile records ready for `yield.resource`.
 *
 * Generic across any clinical-evidence corpus that follows a flat
 * `<subdirectory>/<file>` layout. Classification rules look at filename
 * substrings common to clinical research (`trial`, `rct`, `cohort`,
 * `meta-analysis`, `guideline`, `safety-report`, etc.). They never reference
 * any specific drug, condition, or study identifier.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export type CorpusFileSource = 'document' | 'curated-context' | 'other';

export interface CorpusFile {
  path: string;
  name: string;
  format: string;
  entityTypes: string[];
  storageUri: string;
  source: CorpusFileSource;
  subdir: string;
}

const FORMAT_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

const SKIP_FILENAMES = new Set([
  'README.md',
  'readme.md',
  'README',
  '.DS_Store',
  'LICENSE',
  'AGENTS.md',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.devcontainer',
  '.semiont',
  '.plans',
  '.cache',
  'src',
  'skills',
  'node_modules',
  'tests',
  'docs',
]);

const CURATED_SUBDIRS = new Set(['context', 'curated', 'generated']);

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/^\d+[_-]/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pick entity types based on filename substrings common to clinical evidence.
 * Conservative: every file gets at least one entity type.
 */
function entityTypesForFilename(filename: string): string[] {
  const lc = filename.toLowerCase();

  if (/\b(rct|randomized|trial)\b/.test(lc)) return ['Trial'];
  if (/cohort|case[-\s]?control|observational|registry/.test(lc)) return ['ObservationalStudy'];
  if (/meta[-\s]?analysis|systematic[-\s]?review|cochrane/.test(lc)) return ['SystematicReview'];
  if (/guideline|recommendation|consensus/.test(lc)) return ['Guideline'];
  if (/safety[-\s]?report|pharmacovigilance|adverse[-\s]?event[-\s]?report|psur/.test(lc)) return ['SafetyReport'];
  if (/protocol/.test(lc)) return ['Trial', 'Protocol'];

  return ['ClinicalDocument'];
}

export function discoverCorpus(repoRoot: string = process.cwd()): CorpusFile[] {
  const out: CorpusFile[] = [];

  for (const subdir of readdirSync(repoRoot)) {
    if (subdir.startsWith('.') && !CURATED_SUBDIRS.has(subdir)) continue;
    if (SKIP_DIRS.has(subdir)) continue;
    const subdirPath = join(repoRoot, subdir);
    if (!existsSync(subdirPath) || !statSync(subdirPath).isDirectory()) continue;

    walkSubdir(subdir, subdirPath, repoRoot, out);
  }

  return out;
}

function walkSubdir(subdir: string, dirPath: string, repoRoot: string, out: CorpusFile[]): void {
  const isCurated = CURATED_SUBDIRS.has(subdir);

  for (const entry of readdirSync(dirPath)) {
    if (SKIP_FILENAMES.has(entry)) continue;
    const entryPath = join(dirPath, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      walkSubdir(subdir, entryPath, repoRoot, out);
      continue;
    }
    if (!stat.isFile()) continue;

    const ext = extname(entry).toLowerCase();
    const format = FORMAT_BY_EXT[ext];
    if (!format) continue;

    const relPath = relative(repoRoot, entryPath);
    const baseTypes = entityTypesForFilename(entry);
    const entityTypes = isCurated ? ['ClinicalContext', 'Curated', ...baseTypes] : baseTypes;

    out.push({
      path: relPath,
      name: nameFromFilename(entry),
      format,
      entityTypes,
      storageUri: `file://${relPath}`,
      source: isCurated ? 'curated-context' : 'document',
      subdir,
    });
  }
}

export function readForUpload(file: CorpusFile, repoRoot: string = process.cwd()): Buffer {
  return readFileSync(join(repoRoot, file.path));
}
