import Fuse, { type IFuseOptions } from "fuse.js";
import { get, set } from "idb-keyval";

export interface VocabEntry {
  word: string;
  pos: string;
  entry: string;
  // Inflected surface forms that map to this entry (e.g. say → said, says).
  // Indexed by Fuse so a student searching "said" lands on the "say" entry,
  // and displayed in the result list + entry header as "say / said / says"
  // so the student sees all forms of one idea at once.
  aliases?: string[];
}

export interface TranslationTerm {
  term: string;
  section: string;
}

export interface TranslationSearchEntry {
  entry: VocabEntry;
  terms: TranslationTerm[];
  index: number;
}

export interface VocabSearchResult {
  entry: VocabEntry;
  matchedTranslations: string[];
  exactTranslationMatch: boolean;
}

// One version, two uses: we bump this whenever vocab.json changes shape
// or content. STORE_KEY invalidates IndexedDB; the ?v=N query string
// invalidates the service worker's stale-while-revalidate cache on
// vocab.json so installed PWAs actually fetch the new file instead of
// reading last month's copy back out of runtime cache.
const VOCAB_VERSION = 4;
const STORE_KEY = `vocab-data-v${VOCAB_VERSION}`;
const VOCAB_URL = `${import.meta.env.BASE_URL}vocab.json?v=${VOCAB_VERSION}`;

const fuseOptions: IFuseOptions<VocabEntry> = {
  keys: [
    { name: "word", weight: 1.0 },
    { name: "aliases", weight: 0.7 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
};

export interface LoadedVocab {
  data: VocabEntry[];
  fuse: Fuse<VocabEntry>;
  translationIndex: TranslationSearchEntry[];
  translationTermsByEntry: Map<VocabEntry, TranslationTerm[]>;
}

function buildFuse(data: VocabEntry[]): Fuse<VocabEntry> {
  const index = Fuse.createIndex(["word", "aliases"], data);
  return new Fuse(data, fuseOptions, index);
}

const HAN_RE = /[\u3400-\u9fff]/u;
const SECTION_RE = /^\*\*(.+?):\*\*\s*$/;
const BULLET_LEAD_RE = /^-\s+(.+?)(?:\s+[—-]\s+|$)/u;
const BOLD_RE = /\*\*([^*]+)\*\*/gu;

function hasHan(text: string): boolean {
  return HAN_RE.test(text);
}

export function isChineseQuery(text: string): boolean {
  return hasHan(text.trim());
}

function normalizeTranslationTerm(term: string): string {
  return term.replace(/\s+/g, " ").trim();
}

export function extractTranslationTerms(entryText: string): TranslationTerm[] {
  const seen = new Set<string>();
  const terms: TranslationTerm[] = [];
  let section = "";

  for (const line of entryText.split("\n")) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (!line.startsWith("- ")) continue;

    const lead = line.match(BULLET_LEAD_RE)?.[1];
    if (!lead) continue;

    const boldTerms = [...lead.matchAll(BOLD_RE)].map((m) => m[1]);
    const candidates = boldTerms.length ? boldTerms : [lead.replace(/\*\*/g, "")];

    for (const candidate of candidates) {
      const term = normalizeTranslationTerm(candidate);
      if (!term || !hasHan(term)) continue;

      const key = `${section}:${term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push({ term, section });
    }
  }

  return terms;
}

function buildTranslationIndex(data: VocabEntry[]): TranslationSearchEntry[] {
  return data
    .map((entry, index) => ({
      entry,
      terms: extractTranslationTerms(entry.entry),
      index,
    }))
    .filter((item) => item.terms.length > 0);
}

export function createLoadedVocab(data: VocabEntry[]): LoadedVocab {
  const translationIndex = buildTranslationIndex(data);
  const translationTermsByEntry = new Map(
    translationIndex.map((item) => [item.entry, item.terms]),
  );

  return {
    data,
    fuse: buildFuse(data),
    translationIndex,
    translationTermsByEntry,
  };
}

/**
 * All surface forms for an entry with the headword first. Used both for
 * ranking (match query against any form) and display
 * ("do / does / did / doing / done") so students see one idea with all
 * its forms rather than separate entries.
 */
export function entryForms(entry: VocabEntry): string[] {
  const aliases = entry.aliases ?? [];
  return [entry.word, ...aliases];
}

export async function loadVocab(opts?: {
  onSource?: (source: "cache" | "network") => void;
}): Promise<LoadedVocab> {
  // Try IndexedDB first
  try {
    const cached = (await get(STORE_KEY)) as VocabEntry[] | undefined;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      opts?.onSource?.("cache");
      return createLoadedVocab(cached);
    }
  } catch {
    // ignore, fallback to network
  }

  opts?.onSource?.("network");
  const res = await fetch(VOCAB_URL);
  if (!res.ok) throw new Error(`Failed to fetch vocab.json: ${res.status}`);
  const data = (await res.json()) as VocabEntry[];

  // Persist for next time (don't block return on failure)
  set(STORE_KEY, data).catch(() => {
    /* ignore quota errors */
  });

  return createLoadedVocab(data);
}

function previewTranslationTerms(terms: TranslationTerm[] = []): string[] {
  const preferred = terms.filter((term) => term.section === "Mandarin");
  const candidates = preferred.length ? preferred : terms;
  return [...new Set(candidates.map((term) => term.term))].slice(0, 3);
}

function emptySearchResult(
  entry: VocabEntry,
  translationTermsByEntry?: Map<VocabEntry, TranslationTerm[]>,
): VocabSearchResult {
  return {
    entry,
    matchedTranslations: previewTranslationTerms(
      translationTermsByEntry?.get(entry),
    ),
    exactTranslationMatch: false,
  };
}

function searchEnglishVocab(
  fuse: Fuse<VocabEntry>,
  translationTermsByEntry: Map<VocabEntry, TranslationTerm[]>,
  query: string,
  limit = 20,
): VocabSearchResult[] {
  const q = query.trim();
  const results = fuse.search(q, { limit: limit * 2 });

  const lowerQ = q.toLowerCase();

  // Re-rank: prefer exact match (on word OR any alias), then prefix, then
  // shorter headwords at equal score. Checking aliases means typing "said"
  // gives the "say" entry a strong exact-match bonus via its "said" alias.
  const scored = results.map((r) => {
    const forms = entryForms(r.item).map((f) => f.toLowerCase());
    let bonus = 0;
    if (forms.some((f) => f === lowerQ)) bonus -= 1.0;
    else if (forms.some((f) => f.startsWith(lowerQ))) bonus -= 0.5;
    return {
      item: r.item,
      // Length penalty still uses headword — keeps "cat" above "catastrophe"
      // when both exact-match (neither will, but in close ranking cases).
      score: (r.score ?? 0) + bonus + r.item.word.length * 0.001,
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored
    .slice(0, limit)
    .map((s) => emptySearchResult(s.item, translationTermsByEntry));
}

function sectionWeight(section: string): number {
  if (section === "Mandarin") return 0;
  if (section === "Also means") return 0.35;
  if (section === "Note") return 0.75;
  return 0.5;
}

function translationMatchScore(term: TranslationTerm, query: string): number | null {
  if (term.term === query) return sectionWeight(term.section);
  if (term.term.startsWith(query)) return 0.2 + sectionWeight(term.section);
  if (query.startsWith(term.term) && term.term.length >= 2) {
    return 0.35 + sectionWeight(term.section);
  }
  if (term.term.includes(query)) return 0.45 + sectionWeight(term.section);
  if (query.includes(term.term) && term.term.length >= 2) {
    return 0.55 + sectionWeight(term.section);
  }
  return null;
}

function searchTranslationVocab(
  translationIndex: TranslationSearchEntry[],
  query: string,
  limit = 20,
): VocabSearchResult[] {
  const scored = translationIndex
    .map((item) => {
      const matches = item.terms
        .map((term) => ({
          term,
          score: translationMatchScore(term, query),
        }))
        .filter((match): match is { term: TranslationTerm; score: number } => {
          return match.score !== null;
        })
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.term.term.length - b.term.term.length;
        });

      if (matches.length === 0) return null;

      const matchedTranslations = [
        ...new Set(matches.slice(0, 3).map((match) => match.term.term)),
      ];

      return {
        entry: item.entry,
        matchedTranslations,
        exactTranslationMatch: matches.some((match) => match.term.term === query),
        score: matches[0].score + item.index * 0.000001,
      };
    })
    .filter((result): result is VocabSearchResult & { score: number } => {
      return result !== null;
    });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(({ score: _score, ...result }) => result);
}

export function searchVocab(
  loaded: LoadedVocab,
  query: string,
  limit = 20,
): VocabSearchResult[] {
  const q = query.trim();
  const isTranslationQuery = isChineseQuery(q);
  if (!isTranslationQuery && q.length < 2) return [];
  if (isTranslationQuery && q.length < 1) return [];

  if (isTranslationQuery) {
    return searchTranslationVocab(loaded.translationIndex, q, limit);
  }

  return searchEnglishVocab(loaded.fuse, loaded.translationTermsByEntry, q, limit);
}
