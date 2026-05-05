import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FolderSync, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  writeTerminalData,
} from "../lib/api";
import { displayPath } from "../lib/format";
import { IconButton } from "./IconButton";

interface TerminalPanelProps {
  cwd: string;
  activeDirectory: string;
  onCwdChange: (cwd: string) => void;
  onClose: () => void;
}

interface TerminalOutputPayload {
  sessionId: string;
  data: string;
}

interface TerminalExitPayload {
  sessionId: string;
  status: number | null;
  message: string | null;
}

export function TerminalPanel({
  cwd,
  activeDirectory,
  onCwdChange,
  onClose,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const [status, setStatus] = useState<string | null>("Starting");
  const [restartToken, setRestartToken] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      macOptionIsMeta: true,
      scrollback: 5000,
      theme: {
        background: "#0f1720",
        cursor: "#edf5ff",
        foreground: "#d8e0ea",
        selectionBackground: "#2f7dd166",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void writeTerminalData(sessionId, data);
      }
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void resizeTerminalSession(sessionId, cols, rows);
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    let disposed = false;
    void Promise.all([
      listen<TerminalOutputPayload>("terminal-output", (event) => {
        if (event.payload.sessionId === sessionIdRef.current) {
          terminal.write(event.payload.data);
        }
      }),
      listen<TerminalExitPayload>("terminal-exit", (event) => {
        if (event.payload.sessionId !== sessionIdRef.current) {
          return;
        }

        sessionIdRef.current = null;
        terminal.options.disableStdin = true;
        setStatus("Exited");

        if (event.payload.message) {
          terminal.writeln(`\r\n${event.payload.message}`);
        } else if (event.payload.status !== 0) {
          terminal.writeln(`\r\nExited with ${event.payload.status ?? "unknown status"}`);
        }
      }),
    ]).then((unlisteners) => {
      if (disposed) {
        unlisteners.forEach((unlisten) => unlisten());
      } else {
        unlistenRef.current = unlisteners;
      }
    });

    terminal.focus();

    return () => {
      disposed = true;
      unlistenRef.current.forEach((unlisten) => unlisten());
      unlistenRef.current = [];
      dataDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();

      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void stopTerminalSession(sessionId);
      }

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    let cancelled = false;
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (previousSessionId) {
      void stopTerminalSession(previousSessionId);
    }

    terminal.reset();
    terminal.options.disableStdin = true;
    setStatus("Starting");
    fitAddon.fit();

    void startTerminalSession(cwd, terminal.cols, terminal.rows)
      .then((sessionId) => {
        if (cancelled) {
          void stopTerminalSession(sessionId);
          return;
        }

        sessionIdRef.current = sessionId;
        terminal.options.disableStdin = false;
        setStatus(null);
        terminal.focus();
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setStatus("Failed");
        terminal.writeln(`Error: ${errorToMessage(error)}`);
      });

    return () => {
      cancelled = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void stopTerminalSession(sessionId);
      }
    };
  }, [cwd, restartToken]);

  const restartInActiveDirectory = () => {
    if (activeDirectory === cwd) {
      setRestartToken((current) => current + 1);
    } else {
      onCwdChange(activeDirectory);
    }
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  };

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <TerminalIcon size={16} />
          <span>Terminal</span>
        </div>
        <div className="terminal-cwd" title={cwd}>
          {displayPath(cwd)}
          {status ? ` (${status})` : ""}
        </div>
        <div className="terminal-actions">
          <IconButton
            label={`Use active folder: ${displayPath(activeDirectory)}`}
            onClick={restartInActiveDirectory}
          >
            <FolderSync size={16} />
          </IconButton>
          <IconButton label="Clear terminal" onClick={clearTerminal}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Close terminal" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="terminal-emulator" ref={containerRef} />
    </section>
  );
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    const message = error.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(error);
}
