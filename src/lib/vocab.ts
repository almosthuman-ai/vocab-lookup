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

// Bumped v1 → v2 when aliases were added so cached clients re-fetch vocab.json.
const STORE_KEY = "vocab-data-v2";
const VOCAB_URL = `${import.meta.env.BASE_URL}vocab.json`;

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
}

function buildFuse(data: VocabEntry[]): Fuse<VocabEntry> {
  const index = Fuse.createIndex(["word", "aliases"], data);
  return new Fuse(data, fuseOptions, index);
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
      return { data: cached, fuse: buildFuse(cached) };
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

  return { data, fuse: buildFuse(data) };
}

export function searchVocab(
  fuse: Fuse<VocabEntry>,
  query: string,
  limit = 20,
): VocabEntry[] {
  const q = query.trim();
  if (q.length < 2) return [];
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
  return scored.slice(0, limit).map((s) => s.item);
}
