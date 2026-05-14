import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createLoadedVocab,
  extractTranslationTerms,
  searchVocab,
  type VocabEntry,
} from "./vocab";

const entries: VocabEntry[] = [
  {
    word: "abandon",
    pos: "verb",
    aliases: ["abandons", "abandoned", "abandoning"],
    entry: `## abandon (verb)

**Mandarin:**
- **遺棄** — 用在人、動物或物品被丟下不管。
- **拋棄** — 也可以用在人、物，甚至感情關係。
- **放棄** — 用在計畫、希望、搜尋、嘗試、任務等。

**Also means:**
- 如果是停止努力、停止計畫，多半是 **放棄**

**Note:**
- **leave** = 離開、留下
`,
  },
  {
    word: "quit",
    pos: "verb",
    aliases: ["quits", "quitting"],
    entry: `## quit (verb)

**Mandarin:**
- **放棄** — 不再繼續，強調不做了。
- **辭職** — 離開工作。
`,
  },
  {
    word: "say",
    pos: "verb",
    aliases: ["said", "says", "saying"],
    entry: `## say (verb)

**Mandarin:**
- **說** — 講出話。
`,
  },
];

describe("extractTranslationTerms", () => {
  it("extracts Chinese lead terms from structured Mandarin bullets", () => {
    expect(extractTranslationTerms(entries[0].entry)).toEqual(
      expect.arrayContaining([
        { term: "遺棄", section: "Mandarin" },
        { term: "拋棄", section: "Mandarin" },
        { term: "放棄", section: "Mandarin" },
      ]),
    );
  });

  it("does not treat explanatory note translations as primary search terms", () => {
    const terms = extractTranslationTerms(entries[0].entry);

    expect(terms).not.toContainEqual({ term: "離開、留下", section: "Note" });
  });
});

describe("searchVocab", () => {
  it("searches English headwords and aliases as before", () => {
    const loaded = createLoadedVocab(entries);
    const results = searchVocab(loaded, "said");

    expect(results[0].entry.word).toBe("say");
    expect(results[0].matchedTranslations).toEqual(["說"]);
    expect(results[0].exactTranslationMatch).toBe(false);
  });

  it("shows Mandarin previews for English alias searches", () => {
    const loaded = createLoadedVocab(entries);
    const results = searchVocab(loaded, "abandoned");

    expect(results[0].entry.word).toBe("abandon");
    expect(results[0].matchedTranslations).toEqual(["遺棄", "拋棄", "放棄"]);
  });

  it("searches Traditional Chinese translation terms and keeps English entries primary", () => {
    const loaded = createLoadedVocab(entries);
    const results = searchVocab(loaded, "放棄");

    expect(results.map((result) => result.entry.word)).toEqual([
      "abandon",
      "quit",
    ]);
    expect(results[0].matchedTranslations).toEqual(["放棄"]);
    expect(results[0].exactTranslationMatch).toBe(true);
  });

  it("supports partial Traditional Chinese translation queries", () => {
    const loaded = createLoadedVocab(entries);
    const results = searchVocab(loaded, "拋");

    expect(results[0].entry.word).toBe("abandon");
    expect(results[0].matchedTranslations).toEqual(["拋棄"]);
  });
});

describe("searchVocab with real vocab data", () => {
  const realEntries = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "public", "vocab.json"), "utf8"),
  ) as VocabEntry[];

  it("finds do from its first Mandarin translation", () => {
    const loaded = createLoadedVocab(realEntries);
    const results = searchVocab(loaded, "做", 5);

    expect(results[0].entry.word).toBe("do");
    expect(results[0].matchedTranslations).toContain("做");
  });

  it("finds do from its second Mandarin translation", () => {
    const loaded = createLoadedVocab(realEntries);
    const results = searchVocab(loaded, "辦", 5);

    expect(results[0].entry.word).toBe("do");
    expect(results[0].matchedTranslations).toContain("辦");
  });
});
