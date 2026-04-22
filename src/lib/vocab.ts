import Fuse, { type IFuseOptions } from "fuse.js";
import { get, set } from "idb-keyval";

export interface VocabEntry {
  word: string;
  pos: string;
  entry: string;
}

const STORE_KEY = "vocab-data-v1";
const VOCAB_URL = `${import.meta.env.BASE_URL}vocab.json`;

const fuseOptions: IFuseOptions<VocabEntry> = {
  keys: ["word"],
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
  const index = Fuse.createIndex(["word"], data);
  return new Fuse(data, fuseOptions, index);
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

  // Re-rank: prefer exact, then prefix, then shorter words at equal score
  const scored = results.map((r) => {
    const word = r.item.word.toLowerCase();
    let bonus = 0;
    if (word === lowerQ) bonus -= 1.0;
    else if (word.startsWith(lowerQ)) bonus -= 0.5;
    return {
      item: r.item,
      score: (r.score ?? 0) + bonus + word.length * 0.001,
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.item);
}
