import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Search, X } from "lucide-react";
import {
  entryForms,
  isChineseQuery,
  loadVocab,
  searchVocab,
  type LoadedVocab,
  type VocabEntry,
} from "@/lib/vocab";
import { InstallPrompt } from "@/components/InstallPrompt";

type LoadState = "idle" | "loading" | "ready" | "offline-empty" | "error";

const Index = () => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<VocabEntry | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const vocabRef = useRef<LoadedVocab | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    loadVocab()
      .then((loaded) => {
        if (cancelled) return;
        vocabRef.current = loaded;
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState(navigator.onLine ? "error" : "offline-empty");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!vocabRef.current || loadState !== "ready") return [];
    return searchVocab(vocabRef.current, query, 20);
  }, [query, loadState]);
  const trimmedQuery = query.trim();
  const shouldShowResults =
    trimmedQuery.length >= 2 || isChineseQuery(trimmedQuery);

  // Clear selected entry when query is cleared
  useEffect(() => {
    if (query.trim() === "") setSelected(null);
  }, [query]);

  const handleSelect = (entry: VocabEntry) => {
    setSelected(entry);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setQuery("");
    setSelected(null);
    inputRef.current?.focus();
  };

  /**
   * Rewrite the entry's top-of-file `## word (pos)` heading to include every
   * form ("do / does / did / doing / done") so the student sees one idea with
   * all its forms — not a redirect from the form they searched to the lemma.
   */
  const entryWithFormsHeader = (e: VocabEntry): string => {
    const joined = entryForms(e).join(" / ");
    return e.entry.replace(/^## [^\n]+/, `## ${joined} (${e.pos})`);
  };

  // Did the student type exactly this entry's headword or one of its forms?
  // Case-insensitive, trimmed. We light these rows up so the student sees
  // their target at a glance even when fuzzy matches sit right below.
  const isExactMatch = (e: VocabEntry, q: string): boolean => {
    const needle = q.trim().toLowerCase();
    if (!needle) return false;
    return entryForms(e).some((f) => f.toLowerCase() === needle);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-10">
        <header className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Vocab Lookup
          </h1>
        </header>

        {/* Search bar — largest visual element */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type an English or Chinese word…"
            aria-label="Search English or Chinese words"
            className="w-full rounded-2xl border-2 border-border bg-card py-4 pl-12 pr-12 text-lg text-foreground shadow-sm outline-none ring-0 transition placeholder:text-muted-foreground focus:border-primary focus:shadow-md sm:text-xl"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Status line */}
        <div className="mt-2 min-h-[1.25rem] px-1 text-xs text-muted-foreground">
          {loadState === "loading" && <span>loading vocabulary…</span>}
          {loadState === "offline-empty" && (
            <span>connect once to load the vocabulary.</span>
          )}
          {loadState === "error" && (
            <span className="text-destructive">
              couldn't load vocabulary. try again.
            </span>
          )}
        </div>

        {/* Install prompt */}
        <div className="mt-3">
          <InstallPrompt />
        </div>

        {/* Results list (entry expands inline under the tapped word) */}
        {loadState === "ready" && shouldShowResults && (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                No matches.
              </li>
            ) : (
              results.map((r, i) => {
                const isActive =
                  selected?.word === r.entry.word &&
                  selected?.pos === r.entry.pos;
                const isExact =
                  isExactMatch(r.entry, query) || r.exactTranslationMatch;
                const stateClass = isActive
                  ? "bg-accent"
                  : isExact
                    ? "bg-primary/5 hover:bg-primary/10"
                    : "hover:bg-muted/50";
                const ringClass = isExact
                  ? "ring-2 ring-inset ring-primary"
                  : "";
                return (
                  <li key={`${r.entry.word}-${r.entry.pos}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(r.entry)}
                      aria-expanded={isActive}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition active:bg-accent ${stateClass} ${ringClass}`}
                    >
                      <span className="min-w-0 flex-1 text-base text-foreground">
                        <span className="block">
                          {entryForms(r.entry).map((f, idx, arr) => {
                            const isMatch =
                              f.toLowerCase() === query.trim().toLowerCase();
                            return (
                              <span key={`${f}-${idx}`}>
                                <span
                                  className={
                                    isMatch
                                      ? "font-semibold text-primary"
                                      : "font-medium"
                                  }
                                >
                                  {f}
                                </span>
                                {idx < arr.length - 1 && (
                                  <span className="text-muted-foreground">
                                    {" / "}
                                  </span>
                                )}
                              </span>
                            );
                          })}
                        </span>
                        {r.matchedTranslations.length > 0 && (
                          <span className="mt-1 block text-sm font-semibold text-primary">
                            {r.matchedTranslations.join(" / ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.entry.pos}
                      </span>
                    </button>
                    {isActive && selected && (
                      <article className="border-t border-border bg-background px-4 py-4 sm:px-5 sm:py-5">
                        <div className="entry-prose">
                          <ReactMarkdown>
                            {entryWithFormsHeader(selected)}
                          </ReactMarkdown>
                        </div>
                      </article>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    </main>
  );
};

export default Index;
