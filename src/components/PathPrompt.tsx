import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { listDirectory } from "../lib/api";
import type { FileEntry } from "../lib/types";

interface PathPromptProps {
  initialValue: string;
  onNavigate: (path: string) => void;
  onCancel: () => void;
}

export function PathPrompt({ initialValue, onNavigate, onCancel }: PathPromptProps) {
  const [value, setValue] = useState(initialValue);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parentCached, setParentCached] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const { parentDir, partial, separator } = useMemo(() => splitPath(value), [value]);

  useEffect(() => {
    if (!parentDir) {
      setEntries([]);
      setParentCached(null);
      setError(null);
      return;
    }

    let cancelled = false;
    void listDirectory(parentDir, true)
      .then((listing) => {
        if (cancelled) {
          return;
        }
        setEntries(listing.entries.filter((entry) => entry.isDir));
        setParentCached(parentDir);
        setError(null);
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setEntries([]);
        setParentCached(null);
        setError(messageOf(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [parentDir]);

  const suggestions = useMemo(() => {
    if (parentDir !== parentCached) {
      return [];
    }
    if (!partial) {
      return entries.slice(0, 50);
    }
    const lowered = partial.toLowerCase();
    return entries
      .filter((entry) => entry.name.toLowerCase().startsWith(lowered))
      .slice(0, 50);
  }, [entries, parentCached, parentDir, partial]);

  useEffect(() => {
    setHighlight(-1);
  }, [parentDir, partial]);

  useEffect(() => {
    if (highlight < 0) {
      return;
    }
    const entry = suggestions[highlight];
    if (!entry) {
      return;
    }
    suggestionRefs.current.get(entry.path)?.scrollIntoView({
      block: "nearest",
    });
  }, [highlight, suggestions]);

  const completeWith = (entry: FileEntry) => {
    setValue(parentDir + entry.name + separator);
  };

  const acceptHighlightOrNavigate = () => {
    if (highlight >= 0 && suggestions[highlight]) {
      onNavigate(suggestions[highlight].path);
      return;
    }
    const target = value.trim();
    if (!target) {
      onCancel();
      return;
    }
    onNavigate(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      if (suggestions.length === 0) {
        return;
      }
      if (suggestions.length === 1) {
        completeWith(suggestions[0]);
        return;
      }
      const lcp = longestCommonPrefix(suggestions.map((entry) => entry.name));
      if (lcp.length > partial.length) {
        setValue(parentDir + lcp);
      } else {
        setHighlight((current) => (current + 1) % suggestions.length);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length === 0) {
        return;
      }
      setHighlight((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, -1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      acceptHighlightOrNavigate();
    }
  };

  return (
    <div
      className="confirmation-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby="path-prompt-title"
        aria-modal="true"
        className="path-prompt-dialog"
        role="dialog"
      >
        <h2 id="path-prompt-title">Go to folder</h2>
        <input
          aria-label="Path"
          className="path-prompt-input"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          ref={inputRef}
          spellCheck={false}
          value={value}
        />
        {suggestions.length > 0 ? (
          <ul className="path-prompt-suggestions" role="listbox">
            {suggestions.map((entry, index) => (
              <li
                aria-selected={index === highlight}
                className={`path-prompt-suggestion ${index === highlight ? "highlighted" : ""}`}
                key={entry.path}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onNavigate(entry.path);
                }}
                onMouseEnter={() => setHighlight(index)}
                ref={(element) => {
                  if (element) {
                    suggestionRefs.current.set(entry.path, element);
                  } else {
                    suggestionRefs.current.delete(entry.path);
                  }
                }}
                role="option"
              >
                {entry.name}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="path-prompt-error">{error}</p> : null}
        <p className="path-prompt-hint">
          Tab to complete · ↑ ↓ to choose · Enter to open · Esc to cancel
        </p>
      </div>
    </div>
  );
}

function splitPath(value: string): {
  parentDir: string;
  partial: string;
  separator: string;
} {
  const idxSlash = value.lastIndexOf("/");
  const idxBackslash = value.lastIndexOf("\\");
  const idx = Math.max(idxSlash, idxBackslash);
  if (idx < 0) {
    return { parentDir: "", partial: value, separator: "/" };
  }
  return {
    parentDir: value.slice(0, idx + 1),
    partial: value.slice(idx + 1),
    separator: value[idx],
  };
}

function longestCommonPrefix(names: string[]): string {
  if (names.length === 0) {
    return "";
  }
  let prefix = names[0];
  for (let i = 1; i < names.length; i += 1) {
    while (
      prefix.length > 0 &&
      names[i].slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()
    ) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix;
}

function messageOf(reason: unknown): string | null {
  if (reason && typeof reason === "object" && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  if (typeof reason === "string") {
    return reason;
  }
  return null;
}
