import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  FolderSync,
  Plus,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  writeTerminalData,
} from "../lib/api";
import { basename, displayPath } from "../lib/format";
import { IconButton } from "./IconButton";

export type TerminalCloseScope = "panel" | "tab";

interface TerminalPanelProps {
  cwd: string;
  activeDirectory: string;
  onCwdChange: (cwd: string) => void;
  onClose: () => void;
  onBeforeClose: (scope: TerminalCloseScope, runningCount: number) => Promise<boolean>;
  onLiveSessionCountChange: (count: number) => void;
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

type TerminalStatus = "starting" | "running" | "exited" | "failed";

interface TerminalTab {
  id: string;
  cwd: string;
  restartToken: number;
  status: TerminalStatus;
}

let nextTerminalTabId = 1;

export function TerminalPanel({
  cwd,
  activeDirectory,
  onCwdChange,
  onClose,
  onBeforeClose,
  onLiveSessionCountChange,
}: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTerminalTab(cwd)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const [clearToken, setClearToken] = useState(0);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeCwd = activeTab?.cwd ?? cwd;

  useEffect(() => {
    if (!activeTab) {
      onClose();
      return;
    }

    onCwdChange(activeCwd);
  }, [activeCwd, activeTabId, onClose, onCwdChange]);

  useEffect(() => {
    onLiveSessionCountChange(tabs.filter((tab) => isLiveTerminalStatus(tab.status)).length);
  }, [onLiveSessionCountChange, tabs]);

  useEffect(
    () => () => {
      onLiveSessionCountChange(0);
    },
    [onLiveSessionCountChange],
  );

  const updateTab = useCallback(
    (tabId: string, updater: (tab: TerminalTab) => TerminalTab) => {
      setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
    },
    [],
  );

  const createTab = useCallback(
    (path = activeDirectory) => {
      const tab = createTerminalTab(path);
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      onCwdChange(path);
    },
    [activeDirectory, onCwdChange],
  );

  const closePanel = useCallback(() => {
    const runningCount = tabs.filter((tab) => isLiveTerminalStatus(tab.status)).length;
    if (runningCount === 0) {
      onClose();
      return;
    }

    void onBeforeClose("panel", runningCount).then((confirmed) => {
      if (confirmed) {
        onClose();
      }
    });
  }, [onBeforeClose, onClose, tabs]);

  const closeTabNow = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) {
        onClose();
        return;
      }

      const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      setTabs(nextTabs);

      if (tabId === activeTabId) {
        const nextActiveTab =
          nextTabs[Math.max(0, Math.min(closingIndex, nextTabs.length - 1))];
        if (nextActiveTab) {
          setActiveTabId(nextActiveTab.id);
          onCwdChange(nextActiveTab.cwd);
        }
      }
    },
    [activeTabId, onClose, onCwdChange, tabs],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((tab) => tab.id === tabId);
      const runningCount = tab && isLiveTerminalStatus(tab.status) ? 1 : 0;

      if (runningCount === 0) {
        closeTabNow(tabId);
        return;
      }

      void onBeforeClose("tab", runningCount).then((confirmed) => {
        if (confirmed) {
          closeTabNow(tabId);
        }
      });
    },
    [closeTabNow, onBeforeClose, tabs],
  );

  const restartInActiveDirectory = useCallback(() => {
    if (!activeTab) {
      return;
    }

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      cwd: activeDirectory,
      restartToken: tab.restartToken + 1,
      status: "starting",
    }));
    onCwdChange(activeDirectory);
  }, [activeDirectory, activeTab, onCwdChange, updateTab]);

  const clearTerminal = useCallback(() => {
    setClearToken((current) => current + 1);
  }, []);

  const activeStatusLabel = activeTab?.status === "running" ? null : activeTab?.status;

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <TerminalIcon size={16} />
          <span>Terminal</span>
        </div>
        <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
          {tabs.map((tab) => (
            <button
              className={`terminal-tab-button ${tab.id === activeTabId ? "selected" : ""}`}
              key={tab.id}
              onClick={() => {
                setActiveTabId(tab.id);
                onCwdChange(tab.cwd);
              }}
              role="tab"
              title={tab.cwd}
              type="button"
            >
              <span className={`terminal-tab-status ${tab.status}`} />
              <span>{basename(tab.cwd) || displayPath(tab.cwd)}</span>
              {tabs.length > 1 ? (
                <span
                  className="terminal-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} />
                </span>
              ) : null}
            </button>
          ))}
          <IconButton label="New terminal tab" onClick={() => createTab()}>
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="terminal-cwd" title={activeCwd}>
          {displayPath(activeCwd)}
          {activeStatusLabel ? ` (${activeStatusLabel})` : ""}
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
          <IconButton label="Close terminal" onClick={closePanel}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="terminal-tab-views">
        {tabs.map((tab) => (
          <TerminalTabView
            active={tab.id === activeTabId}
            clearToken={tab.id === activeTabId ? clearToken : 0}
            cwd={tab.cwd}
            key={tab.id}
            restartToken={tab.restartToken}
            onStatusChange={(status) =>
              updateTab(tab.id, (current) => ({ ...current, status }))
            }
          />
        ))}
      </div>
    </section>
  );
}

interface TerminalTabViewProps {
  active: boolean;
  clearToken: number;
  cwd: string;
  restartToken: number;
  onStatusChange: (status: TerminalStatus) => void;
}

function TerminalTabView({
  active,
  clearToken,
  cwd,
  restartToken,
  onStatusChange,
}: TerminalTabViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

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
      if (container.offsetParent !== null) {
        fitAddon.fit();
      }
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
        onStatusChangeRef.current("exited");

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
    onStatusChangeRef.current("starting");
    fitAddon.fit();

    void startTerminalSession(cwd, terminal.cols, terminal.rows)
      .then((sessionId) => {
        if (cancelled) {
          void stopTerminalSession(sessionId);
          return;
        }

        sessionIdRef.current = sessionId;
        terminal.options.disableStdin = false;
        onStatusChangeRef.current("running");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        onStatusChangeRef.current("failed");
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

  useEffect(() => {
    if (!active) {
      return;
    }

    fitAddonRef.current?.fit();
    terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (clearToken > 0) {
      terminalRef.current?.clear();
      terminalRef.current?.focus();
    }
  }, [clearToken]);

  return (
    <div
      className={`terminal-emulator ${active ? "active" : ""}`}
      ref={containerRef}
    />
  );
}

function createTerminalTab(cwd: string): TerminalTab {
  return {
    id: `terminal-tab-${Date.now()}-${nextTerminalTabId++}`,
    cwd,
    restartToken: 0,
    status: "starting",
  };
}

function isLiveTerminalStatus(status: TerminalStatus) {
  return status === "starting" || status === "running";
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
