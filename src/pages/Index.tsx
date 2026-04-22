import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type Fuse from "fuse.js";
import { Search, X } from "lucide-react";
import { entryForms, loadVocab, searchVocab, type VocabEntry } from "@/lib/vocab";
import { InstallPrompt } from "@/components/InstallPrompt";

type LoadState = "idle" | "loading" | "ready" | "offline-empty" | "error";

const Index = () => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<VocabEntry | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const fuseRef = useRef<Fuse<VocabEntry> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    loadVocab()
      .then(({ fuse }) => {
        if (cancelled) return;
        fuseRef.current = fuse;
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
    if (!fuseRef.current || loadState !== "ready") return [];
    return searchVocab(fuseRef.current, query, 20);
  }, [query, loadState]);

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
            placeholder="Type a word…"
            aria-label="Search English words"
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
        {loadState === "ready" && query.trim().length >= 2 && (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                No matches.
              </li>
            ) : (
              results.map((r, i) => {
                const isActive =
                  selected?.word === r.word && selected?.pos === r.pos;
                return (
                  <li key={`${r.word}-${r.pos}-${i}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(r)}
                      aria-expanded={isActive}
                      className={`flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left transition active:bg-accent ${
                        isActive ? "bg-accent" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="text-base font-medium text-foreground">
                        {entryForms(r).join(" / ")}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.pos}
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
