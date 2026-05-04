import { FolderSync, Terminal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { resolveTerminalDirectory, runTerminalCommand } from "../lib/api";
import { displayPath } from "../lib/format";
import type { TerminalCommandResult } from "../lib/types";
import { IconButton } from "./IconButton";

interface TerminalPanelProps {
  cwd: string;
  activeDirectory: string;
  onCwdChange: (cwd: string) => void;
  onClose: () => void;
}

interface TerminalEntry extends TerminalCommandResult {
  id: string;
}

export function TerminalPanel({
  cwd,
  activeDirectory,
  onCwdChange,
  onClose,
}: TerminalPanelProps) {
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const nextEntryId = useRef(1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const output = outputRef.current;
    if (output) {
      output.scrollTop = output.scrollHeight;
    }
  }, [entries, running]);

  const appendEntry = (entry: TerminalCommandResult) => {
    setEntries((current) => [
      ...current,
      {
        ...entry,
        id: `terminal-entry-${Date.now()}-${nextEntryId.current++}`,
      },
    ]);
  };

  const runCommand = async (rawCommand: string) => {
    const command = rawCommand.trim();
    if (!command || running) {
      return;
    }

    setInput("");
    setHistoryIndex(null);
    setCommandHistory((current) =>
      current[current.length - 1] === command ? current : [...current, command],
    );

    if (command === "clear") {
      setEntries([]);
      return;
    }

    const cdTarget = parseCdTarget(command);
    if (cdTarget !== null) {
      try {
        const nextCwd = await resolveTerminalDirectory(cwd, cdTarget);
        appendEntry({
          cwd,
          command,
          stdout: "",
          stderr: "",
          status: 0,
          durationMs: 0,
        });
        onCwdChange(nextCwd);
      } catch (error) {
        appendEntry({
          cwd,
          command,
          stdout: "",
          stderr: errorToMessage(error),
          status: 1,
          durationMs: 0,
        });
      }
      return;
    }

    setRunning(true);
    try {
      const result = await runTerminalCommand(command, cwd);
      appendEntry(result);
    } catch (error) {
      appendEntry({
        cwd,
        command,
        stdout: "",
        stderr: errorToMessage(error),
        status: 1,
        durationMs: 0,
      });
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runCommand(input);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (commandHistory.length === 0) {
        return;
      }

      const nextIndex =
        historyIndex === null
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(commandHistory[nextIndex] ?? "");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (commandHistory.length === 0 || historyIndex === null) {
        return;
      }

      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandHistory.length) {
        setHistoryIndex(null);
        setInput("");
        return;
      }

      setHistoryIndex(nextIndex);
      setInput(commandHistory[nextIndex] ?? "");
    }
  };

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <Terminal size={16} />
          <span>Terminal</span>
        </div>
        <div className="terminal-cwd" title={cwd}>
          {displayPath(cwd)}
        </div>
        <div className="terminal-actions">
          <IconButton
            label={`Use active folder: ${displayPath(activeDirectory)}`}
            onClick={() => {
              onCwdChange(activeDirectory);
              inputRef.current?.focus();
            }}
          >
            <FolderSync size={16} />
          </IconButton>
          <IconButton label="Clear terminal" onClick={() => setEntries([])}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Close terminal" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="terminal-output" ref={outputRef} role="log" aria-live="polite">
        {entries.length === 0 ? (
          <div className="terminal-empty">No output</div>
        ) : null}
        {entries.map((entry) => (
          <div
            className={`terminal-entry ${
              entry.status !== null && entry.status !== 0 ? "failed" : ""
            }`}
            key={entry.id}
          >
            <div className="terminal-command-line">
              <span className="terminal-prompt">{displayPath(entry.cwd)} $</span>
              <span className="terminal-command">{entry.command}</span>
            </div>
            {entry.stdout ? <pre className="terminal-stream">{entry.stdout}</pre> : null}
            {entry.stderr ? (
              <pre className="terminal-stream terminal-stderr">{entry.stderr}</pre>
            ) : null}
            {entry.status !== null && entry.status !== 0 ? (
              <div className="terminal-status">Exited with {entry.status}</div>
            ) : null}
          </div>
        ))}
        {running ? (
          <div className="terminal-running" aria-label="Command running">
            Running...
          </div>
        ) : null}
      </div>

      <form className="terminal-input-row" onSubmit={handleSubmit}>
        <span className="terminal-input-prompt">$</span>
        <input
          aria-label="Terminal command"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={running}
          onChange={(event) => {
            setInput(event.target.value);
            setHistoryIndex(null);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={running ? "Command running..." : "Command"}
          ref={inputRef}
          spellCheck={false}
          value={input}
        />
      </form>
    </section>
  );
}

function parseCdTarget(command: string): string | null {
  if (command === "cd") {
    return "";
  }

  if (!command.startsWith("cd ")) {
    return null;
  }

  return unquotePath(command.slice(3).trim());
}

function unquotePath(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }

  return value.replace(/\\([ "'\\])/g, "$1");
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(error);
}
