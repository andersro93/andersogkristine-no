import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui/Icon";

/** How long a freshly-added chip keeps its "pop" animation. */
const JUST_ADDED_MS = 450;

interface Props {
  inputId: string;
  value: string[];
  onChange: (items: string[]) => void;
  suggestions: string[];
}

/**
 * Chip input for allergies: one item at a time, each stored as its own Notion
 * multi-select option. Typed text that matches a known suggestion is stored
 * with the suggestion's exact spelling so the option list stays consolidated.
 */
export default function AllergyInput({
  inputId,
  value,
  onChange,
  suggestions,
}: Props) {
  const [draft, setDraft] = useState("");
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Clear any pending "pop" timers on unmount so they don't fire setState
  // after the component is gone.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const chosen = new Set(value.map((item) => item.toLocaleLowerCase("nb")));

  function addItems(raw: string) {
    // A comma can never be part of a Notion option name, so treat it as a
    // separator — this also handles guests pasting a comma-separated list.
    const parts = raw.split(",");
    const next = [...value];
    const seen = new Set(chosen);
    const added: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const key = trimmed.toLocaleLowerCase("nb");
      if (seen.has(key)) continue;

      // Prefer the canonical Notion spelling when one exists.
      const canonical =
        suggestions.find((s) => s.toLocaleLowerCase("nb") === key) ?? trimmed;

      seen.add(key);
      next.push(canonical);
      added.push(canonical);
    }

    if (next.length !== value.length) {
      onChange(next);
      setJustAdded((prev) => {
        const merged = new Set(prev);
        for (const item of added) merged.add(item);
        return merged;
      });
      for (const item of added) {
        const timer = setTimeout(() => {
          setJustAdded((prev) => {
            if (!prev.has(item)) return prev;
            const nextSet = new Set(prev);
            nextSet.delete(item);
            return nextSet;
          });
          timersRef.current.delete(timer);
        }, JUST_ADDED_MS);
        timersRef.current.add(timer);
      }
    }
    setDraft("");
  }

  function removeItem(item: string) {
    onChange(value.filter((existing) => existing !== item));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      // Without this, Enter submits the whole RSVP form.
      e.preventDefault();
      addItems(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      removeItem(value[value.length - 1]);
    }
  }

  const unusedSuggestions = suggestions.filter(
    (s) => !chosen.has(s.toLocaleLowerCase("nb")),
  );

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
          {value.map((item) => (
            <li
              key={item}
              className={justAdded.has(item) ? "motion-safe:animate-pop" : ""}
            >
              <span className="inline-flex items-center gap-1.5 text-xs tracking-wider uppercase pl-2.5 pr-1.5 py-1 rounded bg-brand-title/10 text-brand-title font-medium">
                {item}
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  aria-label={`Fjern ${item}`}
                  className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-brand-title/20 transition"
                >
                  <Icon
                    name="x"
                    className="w-2.5 h-2.5"
                    strokeWidth={3}
                    title="Fjern"
                  />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          id={inputId}
          placeholder="F.eks. gluten"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addItems(draft)}
          className="flex-1 min-w-0 px-4 py-2.5 rounded-lg border border-brand-title/15 bg-white text-brand-title focus:outline-none focus:ring-2 focus:ring-brand-title/50 text-sm"
        />
        <button
          type="button"
          onClick={() => addItems(draft)}
          disabled={!draft.trim()}
          className="shrink-0 px-4 py-2.5 rounded-lg border border-brand-title/20 text-brand-title text-sm font-medium hover:bg-brand-title/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Legg til
        </button>
      </div>

      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-brand-title/60">Vanlige:</span>
          {unusedSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addItems(suggestion)}
              className="text-xs px-2.5 py-1 rounded-full border border-brand-title/15 text-brand-title/80 hover:bg-brand-title/5 hover:text-brand-title transition"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
