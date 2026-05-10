import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  Bot,
  GripVertical,
  KeyRound,
  LogIn,
  LogOut,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  MutableRefObject,
} from "react";
import {
  openExternalUrl,
  runAgentCommand,
  startAgentProcess,
  stopAgentProcess,
  writeAgentProcessData,
  type AgentCommandResult,
} from "../lib/api";
import {
  AGENT_PROVIDERS,
  CAPABILITY_LABELS,
  HARNESS_PRESETS,
  buildAgentWorkspaceContext,
  composeAgentPrompt,
  describeAttachment,
  getAgentProvider,
  type AgentAttachment,
  type AgentProvider,
} from "../lib/agents";
import { activeTab } from "../lib/tabState";
import type { SessionData } from "../lib/types";
import { displayPath } from "../lib/format";
import { IconButton } from "./IconButton";
import type { LayoutDragHandlers } from "./Layout";

interface AgentPanelProps {
  session: SessionData;
  dragHandlers: LayoutDragHandlers;
  onClose: () => void;
  onLogAction: (action: string, details?: Record<string, unknown>) => void;
  onNotice: (message: string | null) => void;
}

interface AgentOutputPayload {
  sessionId: string;
  providerId: string;
  data: string;
}

interface AgentExitPayload {
  sessionId: string;
  providerId: string;
  status: number | null;
  message: string | null;
}

interface AgentEventPayload {
  sessionId: string;
  providerId: string;
  level: string;
  message: string;
  timestamp: number;
}

type AgentStatus = "idle" | "starting" | "running" | "exited" | "failed";
type ProviderAuthStatus =
  | "unknown"
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "authorizing"
  | "error";

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  streaming?: boolean;
}

interface AgentLogEntry {
  id: string;
  timestamp: number;
  level: string;
  message: string;
}

interface ProviderAuthState {
  status: ProviderAuthStatus;
  message: string;
  detail: string;
  authSessionId: string | null;
  deviceUrl: string | null;
  deviceCode: string | null;
}

interface ProviderSessionState {
  providerId: string;
  runtimeSessionId: string | null;
  status: AgentStatus;
  auth: ProviderAuthState;
  messages: AgentMessage[];
  attachments: AgentAttachment[];
  logs: AgentLogEntry[];
  draft: string;
  presetId: string;
  systemPrompt: string;
  pendingResponseId: string | null;
}

let nextAgentId = 1;

export function AgentPanel({
  session,
  dragHandlers,
  onClose,
  onLogAction,
  onNotice,
}: AgentPanelProps) {
  const [providerId, setProviderId] = useState(AGENT_PROVIDERS[0].id);
  const [providerSessions, setProviderSessions] = useState<Record<string, ProviderSessionState>>(
    () =>
      Object.fromEntries(
        AGENT_PROVIDERS.map((candidate) => [candidate.id, createProviderSession(candidate.id)]),
      ) as Record<string, ProviderSessionState>,
  );
  const timersRef = useRef<number[]>([]);
  const outputBuffersRef = useRef<Record<string, string>>({});
  const providerSessionsRef = useRef(providerSessions);
  const provider = getAgentProvider(providerId);
  const providerSession = providerSessions[providerId] ?? createProviderSession(providerId);
  const activeFolder = activeTab(session[session.activePanel]).path;
  const selectedPaths = activeTab(session[session.activePanel]).selectedPaths;
  const providerAdapter = provider.adapter;
  const authBlocksSend = Boolean(
    provider.auth &&
      ["checking", "unauthenticated", "authorizing"].includes(providerSession.auth.status),
  );
  const sendDisabled =
    !providerSession.draft.trim() ||
    authBlocksSend ||
    (providerAdapter?.execution === "perPrompt" && isLiveAgentStatus(providerSession.status));
  const workspaceContext = useMemo(
    () => buildAgentWorkspaceContext(session, providerSession.attachments),
    [providerSession.attachments, session],
  );
  const selectedPreset =
    HARNESS_PRESETS.find((preset) => preset.id === providerSession.presetId) ?? HARNESS_PRESETS[0];

  useEffect(() => {
    providerSessionsRef.current = providerSessions;
  }, [providerSessions]);

  const updateProviderSession = useCallback(
    (targetProviderId: string, updater: (current: ProviderSessionState) => ProviderSessionState) => {
      setProviderSessions((current) => {
        const existing = current[targetProviderId] ?? createProviderSession(targetProviderId);
        return { ...current, [targetProviderId]: updater(existing) };
      });
    },
    [],
  );

  const appendLog = useCallback(
    (targetProviderId: string, level: string, message: string, timestamp = Date.now()) => {
      updateProviderSession(targetProviderId, (current) => ({
        ...current,
        logs: [
          {
            id: createId("agent-log"),
            timestamp,
            level,
            message,
          },
          ...current.logs,
        ].slice(0, 100),
      }));
    },
    [updateProviderSession],
  );

  const refreshAuthStatus = useCallback(
    async (targetProviderId = provider.id) => {
      const targetProvider = getAgentProvider(targetProviderId);
      if (!targetProvider.auth) {
        updateProviderSession(targetProviderId, (current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: "authenticated",
            message: "No provider authorization required.",
            detail: "",
            authSessionId: null,
            deviceUrl: null,
            deviceCode: null,
          },
        }));
        return;
      }

      updateProviderSession(targetProviderId, (current) => ({
        ...current,
        auth: { ...current.auth, status: "checking", message: "Checking provider login..." },
      }));

      try {
        const result = await runAgentCommand({
          providerId: targetProvider.id,
          label: `${targetProvider.name} login status`,
          command: targetProvider.auth.status.command,
          args: targetProvider.auth.status.args,
          cwd: activeFolder,
        });
        updateProviderSession(targetProviderId, (current) => ({
          ...current,
          auth: parseProviderAuthStatus(targetProvider, result, current.auth),
        }));
      } catch (error) {
        const message = errorToMessage(error);
        appendLog(targetProviderId, "error", message);
        updateProviderSession(targetProviderId, (current) => ({
          ...current,
          auth: {
            ...current.auth,
            status: "error",
            message,
            detail: "",
            authSessionId: null,
          },
        }));
      }
    },
    [activeFolder, appendLog, provider.id, updateProviderSession],
  );

  useEffect(() => {
    void refreshAuthStatus(provider.id);
  }, [provider.id, refreshAuthStatus]);

  useEffect(() => {
    let disposed = false;
    let unlisteners: UnlistenFn[] = [];

    void Promise.all([
      listen<AgentOutputPayload>("agent-output", (event) => {
        const currentForOutput = providerSessionsRef.current[event.payload.providerId];
        if (currentForOutput?.auth.authSessionId === event.payload.sessionId) {
          const chunk = stripAnsi(event.payload.data);
          updateProviderSession(event.payload.providerId, (current) => {
            if (current.auth.authSessionId !== event.payload.sessionId) {
              return current;
            }
            const detail = trimAuthDetail(`${current.auth.detail}${chunk}`);
            const parsed = parseDeviceAuthDetail(detail);
            return {
              ...current,
              auth: {
                ...current.auth,
                status: "authorizing",
                message: parsed.deviceCode
                  ? "Enter the device code in your browser to authorize this provider."
                  : "Waiting for provider authorization...",
                detail,
                deviceUrl: parsed.deviceUrl ?? current.auth.deviceUrl,
                deviceCode: parsed.deviceCode ?? current.auth.deviceCode,
              },
            };
          });
          return;
        }

        const eventProvider = getAgentProvider(event.payload.providerId);
        if (eventProvider.adapter?.outputFormat === "codexJsonl") {
          processCodexJsonlOutput(
            event.payload,
            outputBuffersRef,
            updateProviderSession,
            appendLog,
          );
          return;
        }

        const chunk =
          eventProvider.adapter?.outputFormat === "ansi"
            ? stripAnsi(event.payload.data)
            : event.payload.data;
        updateProviderSession(event.payload.providerId, (current) => {
          if (current.runtimeSessionId !== event.payload.sessionId) {
            return current;
          }
          return {
            ...current,
            status: "running",
            messages: appendAssistantChunk(
              current.messages,
              current.pendingResponseId,
              chunk,
              true,
            ),
          };
        });
      }),
      listen<AgentExitPayload>("agent-exit", (event) => {
        const currentForExit = providerSessionsRef.current[event.payload.providerId];
        if (currentForExit?.auth.authSessionId === event.payload.sessionId) {
          delete outputBuffersRef.current[event.payload.sessionId];
          updateProviderSession(event.payload.providerId, (current) => {
            if (current.auth.authSessionId !== event.payload.sessionId) {
              return current;
            }
            const success = event.payload.status === 0;
            return {
              ...current,
              auth: {
                ...current.auth,
                status: success ? "authenticated" : "error",
                message: success
                  ? "Provider is authenticated."
                  : event.payload.message ?? "Provider authorization did not complete.",
                authSessionId: null,
              },
            };
          });
          return;
        }

        delete outputBuffersRef.current[event.payload.sessionId];
        updateProviderSession(event.payload.providerId, (current) => {
          if (current.runtimeSessionId !== event.payload.sessionId) {
            return current;
          }
          return {
            ...current,
            runtimeSessionId: null,
            status: event.payload.status === 0 ? "exited" : "failed",
            pendingResponseId: null,
            messages: current.messages.map((message) =>
              message.id === current.pendingResponseId ? { ...message, streaming: false } : message,
            ),
          };
        });
      }),
      listen<AgentEventPayload>("agent-event", (event) => {
        appendLog(
          event.payload.providerId,
          event.payload.level,
          event.payload.message,
          event.payload.timestamp,
        );
      }),
    ]).then((nextUnlisteners) => {
      if (disposed) {
        nextUnlisteners.forEach((unlisten) => unlisten());
      } else {
        unlisteners = nextUnlisteners;
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [appendLog, updateProviderSession]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      Object.values(providerSessionsRef.current).forEach((current) => {
        if (current.runtimeSessionId) {
          void stopAgentProcess(current.runtimeSessionId).catch(() => undefined);
        }
      });
      outputBuffersRef.current = {};
    },
    [],
  );

  const setDraft = useCallback(
    (draft: string) => {
      updateProviderSession(providerId, (current) => ({ ...current, draft }));
    },
    [providerId, updateProviderSession],
  );

  const startProvider = useCallback(
    async (
      targetProvider: AgentProvider,
      current: ProviderSessionState,
      prompt?: string,
    ) => {
      if (current.runtimeSessionId) {
        return current.runtimeSessionId;
      }
      if (targetProvider.kind !== "terminal" || !targetProvider.adapter) {
        return null;
      }

      updateProviderSession(targetProvider.id, (existing) => ({ ...existing, status: "starting" }));
      appendLog(targetProvider.id, "info", `Starting ${targetProvider.name}`);
      try {
        const args =
          targetProvider.adapter.promptDelivery === "argument" && prompt
            ? [...targetProvider.adapter.args, prompt]
            : targetProvider.adapter.args;
        const runtimeSessionId = await startAgentProcess({
          providerId: targetProvider.id,
          label: targetProvider.name,
          command: targetProvider.adapter.command,
          args,
          cwd: activeFolder,
          cols: 100,
          rows: 30,
        });
        updateProviderSession(targetProvider.id, (existing) => ({
          ...existing,
          runtimeSessionId,
          status: "running",
        }));
        return runtimeSessionId;
      } catch (error) {
        updateProviderSession(targetProvider.id, (existing) => ({
          ...existing,
          runtimeSessionId: null,
          status: "failed",
        }));
        throw error;
      }
    },
    [activeFolder, appendLog, updateProviderSession],
  );

  const sendMessage = useCallback(async () => {
    const messageText = providerSession.draft.trim();
    if (!messageText) {
      return;
    }
    if (provider.adapter?.execution === "perPrompt" && isLiveAgentStatus(providerSession.status)) {
      return;
    }

    const responseId = createId("agent-message");
    const userMessage = createMessage("user", messageText);
    const assistantMessage: AgentMessage = {
      id: responseId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true,
    };

    updateProviderSession(provider.id, (current) => ({
      ...current,
      draft: "",
      pendingResponseId: responseId,
      messages: [...current.messages, userMessage, assistantMessage],
    }));
    onLogAction("agent_message_sent", { providerId: provider.id, providerKind: provider.kind });

    if (provider.kind === "mock") {
      streamMockResponse(provider.id, responseId, messageText, workspaceContext, updateProviderSession, timersRef);
      return;
    }

    if (provider.kind === "terminal") {
      try {
        const prompt = composeAgentPrompt(
          messageText,
          workspaceContext,
          selectedPreset,
          providerSession.systemPrompt,
        );
        const latestSession = providerSessions[provider.id] ?? providerSession;
        if (provider.adapter?.execution === "perPrompt" && latestSession.runtimeSessionId) {
          throw new Error(`${provider.name} is already running a request.`);
        }

        const runtimeSessionId = await startProvider(provider, latestSession, prompt);
        if (!runtimeSessionId) {
          throw new Error("Provider did not return a running session.");
        }

        if (provider.adapter?.promptDelivery !== "argument") {
          await writeAgentProcessData(runtimeSessionId, `${prompt}\n`);
        }
        appendLog(provider.id, "info", "Sent prompt to provider");
        onNotice(null);
        return;
      } catch (error) {
        const message = errorToMessage(error);
        appendLog(provider.id, "error", message);
        onNotice(message);
        updateProviderSession(provider.id, (current) => ({
          ...current,
          status: "failed",
          pendingResponseId: null,
          messages: current.messages.map((chatMessage) =>
            chatMessage.id === responseId
              ? { ...chatMessage, content: message, streaming: false }
              : chatMessage,
          ),
        }));
        return;
      }
    }

    updateProviderSession(provider.id, (current) => ({
      ...current,
      pendingResponseId: null,
      messages: current.messages.map((chatMessage) =>
        chatMessage.id === responseId
          ? { ...chatMessage, content: "API providers are not configured yet.", streaming: false }
          : chatMessage,
      ),
    }));
  }, [
    appendLog,
    onLogAction,
    onNotice,
    provider,
    providerSession,
    providerSessions,
    selectedPreset,
    startProvider,
    updateProviderSession,
    workspaceContext,
  ]);

  const stopProvider = useCallback(() => {
    const runtimeSessionId = providerSession.runtimeSessionId;
    if (!runtimeSessionId) {
      return;
    }
    void stopAgentProcess(runtimeSessionId).catch((error) => {
      appendLog(provider.id, "error", errorToMessage(error));
    });
    updateProviderSession(provider.id, (current) => ({
      ...current,
      runtimeSessionId: null,
      status: "exited",
      pendingResponseId: null,
      messages: current.messages.map((message) =>
        message.id === current.pendingResponseId ? { ...message, streaming: false } : message,
      ),
    }));
  }, [appendLog, provider.id, providerSession.runtimeSessionId, updateProviderSession]);

  const startProviderAuth = useCallback(async () => {
    if (!provider.auth?.login) {
      return;
    }

    updateProviderSession(provider.id, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: "authorizing",
        message: "Starting provider authorization...",
        detail: "",
        authSessionId: null,
        deviceUrl: null,
        deviceCode: null,
      },
    }));
    appendLog(provider.id, "info", `Starting ${provider.name} authorization`);
    onLogAction("agent_provider_auth_started", { providerId: provider.id });

    try {
      const authSessionId = await startAgentProcess({
        providerId: provider.id,
        label: `${provider.name} authorization`,
        command: provider.auth.login.command,
        args: provider.auth.login.args,
        cwd: activeFolder,
        cols: 100,
        rows: 24,
      });
      updateProviderSession(provider.id, (current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: "authorizing",
          message: "Waiting for provider authorization...",
          authSessionId,
        },
      }));
    } catch (error) {
      const message = errorToMessage(error);
      appendLog(provider.id, "error", message);
      onNotice(message);
      updateProviderSession(provider.id, (current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: "error",
          message,
          authSessionId: null,
        },
      }));
    }
  }, [activeFolder, appendLog, onLogAction, onNotice, provider, updateProviderSession]);

  const stopProviderAuth = useCallback(() => {
    const authSessionId = providerSession.auth.authSessionId;
    if (!authSessionId) {
      return;
    }

    void stopAgentProcess(authSessionId).catch((error) => {
      appendLog(provider.id, "error", errorToMessage(error));
    });
    updateProviderSession(provider.id, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: "unauthenticated",
        message: "Provider authorization was cancelled.",
        authSessionId: null,
      },
    }));
  }, [appendLog, provider.id, providerSession.auth.authSessionId, updateProviderSession]);

  const logoutProviderAuth = useCallback(async () => {
    if (!provider.auth?.logout) {
      return;
    }

    if (providerSession.auth.authSessionId) {
      await stopAgentProcess(providerSession.auth.authSessionId).catch((error) => {
        appendLog(provider.id, "error", errorToMessage(error));
      });
    }

    updateProviderSession(provider.id, (current) => ({
      ...current,
      auth: {
        ...current.auth,
        status: "checking",
        message: "Logging out provider...",
        authSessionId: null,
      },
    }));
    onLogAction("agent_provider_logout_requested", { providerId: provider.id });

    try {
      await runAgentCommand({
        providerId: provider.id,
        label: `${provider.name} logout`,
        command: provider.auth.logout.command,
        args: provider.auth.logout.args,
        cwd: activeFolder,
      });
      updateProviderSession(provider.id, (current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: "unauthenticated",
          message: "Provider is not authenticated.",
          detail: "",
          authSessionId: null,
          deviceUrl: null,
          deviceCode: null,
        },
      }));
    } catch (error) {
      const message = errorToMessage(error);
      appendLog(provider.id, "error", message);
      onNotice(message);
      updateProviderSession(provider.id, (current) => ({
        ...current,
        auth: {
          ...current.auth,
          status: "error",
          message,
          authSessionId: null,
        },
      }));
    }
  }, [
    activeFolder,
    appendLog,
    onLogAction,
    onNotice,
    provider,
    providerSession.auth.authSessionId,
    updateProviderSession,
  ]);

  const restartProvider = useCallback(async () => {
    if (providerSession.runtimeSessionId) {
      await stopAgentProcess(providerSession.runtimeSessionId).catch((error) => {
        appendLog(provider.id, "error", errorToMessage(error));
      });
    }
    updateProviderSession(provider.id, (current) => ({
      ...current,
      runtimeSessionId: null,
      status: "idle",
      pendingResponseId: null,
    }));
    if (provider.kind === "terminal") {
      void startProvider(provider, createProviderSession(provider.id)).catch((error) => {
        const message = errorToMessage(error);
        appendLog(provider.id, "error", message);
        onNotice(message);
      });
    }
  }, [
    appendLog,
    onNotice,
    provider,
    providerSession.runtimeSessionId,
    startProvider,
    updateProviderSession,
  ]);

  const clearConversation = useCallback(() => {
    updateProviderSession(provider.id, (current) => ({
      ...current,
      messages: [],
      pendingResponseId: null,
    }));
  }, [provider.id, updateProviderSession]);

  const addSelectedAttachments = useCallback(() => {
    if (selectedPaths.length === 0) {
      return;
    }
    const createdAt = Date.now();
    updateProviderSession(provider.id, (current) => {
      const existing = new Set(current.attachments.map((attachment) => attachment.path));
      const nextAttachments = selectedPaths
        .filter((path) => !existing.has(path))
        .map((path) => ({
          id: createId("agent-attachment"),
          kind: "path" as const,
          name: displayPath(path),
          path,
          createdAt,
        }));
      return { ...current, attachments: [...current.attachments, ...nextAttachments] };
    });
  }, [provider.id, selectedPaths, updateProviderSession]);

  const removeAttachment = useCallback(
    (attachmentId: string) => {
      updateProviderSession(provider.id, (current) => ({
        ...current,
        attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
      }));
    },
    [provider.id, updateProviderSession],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);
      const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
      if (imageItems.length === 0) {
        return;
      }

      imageItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) {
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) {
            return;
          }
          updateProviderSession(provider.id, (current) => ({
            ...current,
            attachments: [
              ...current.attachments,
              {
                id: createId("agent-attachment"),
                kind: "image",
                name: file.name || `pasted-screenshot-${current.attachments.length + 1}.png`,
                dataUrl,
                mimeType: file.type,
                size: file.size,
                createdAt: Date.now(),
              },
            ],
          }));
        };
        reader.readAsDataURL(file);
      });
    },
    [provider.id, updateProviderSession],
  );

  const changePreset = useCallback(
    (presetId: string) => {
      updateProviderSession(provider.id, (current) => ({ ...current, presetId }));
    },
    [provider.id, updateProviderSession],
  );

  const changeSystemPrompt = useCallback(
    (systemPrompt: string) => {
      updateProviderSession(provider.id, (current) => ({ ...current, systemPrompt }));
    },
    [provider.id, updateProviderSession],
  );

  return (
    <section className="agent-panel" aria-label="Agent">
      <header className="agent-header">
        <button
          aria-label="Move panel"
          className="layout-drag-handle"
          onPointerDown={dragHandlers.onPointerDown}
          title="Drag to move this panel"
          type="button"
        >
          <GripVertical size={14} />
        </button>
        <div className="agent-title">
          <Bot size={16} />
          <span>Agent</span>
          <span className={`agent-status ${providerSession.status}`}>{providerSession.status}</span>
        </div>
        <select
          aria-label="Agent provider"
          className="agent-provider-select"
          value={provider.id}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {AGENT_PROVIDERS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <div className="agent-header-actions">
          <IconButton
            label="Start provider"
            disabled={
              provider.kind !== "terminal" ||
              provider.adapter?.execution !== "persistent" ||
              isLiveAgentStatus(providerSession.status)
            }
            onClick={() => {
              void startProvider(provider, providerSession).catch((error) => {
                const message = errorToMessage(error);
                appendLog(provider.id, "error", message);
                onNotice(message);
              });
            }}
          >
            <Play size={16} />
          </IconButton>
          <IconButton
            label="Restart provider"
            disabled={provider.kind !== "terminal" || provider.adapter?.execution !== "persistent"}
            onClick={() => void restartProvider()}
          >
            <RotateCcw size={16} />
          </IconButton>
          <IconButton
            label="Stop provider"
            disabled={!providerSession.runtimeSessionId}
            onClick={stopProvider}
          >
            <Square size={16} />
          </IconButton>
          <IconButton label="Close agent" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </header>

      <div className="agent-content">
        <aside className="agent-sidebar">
          <section className="agent-sidebar-section">
            <div className="agent-section-title">Capabilities</div>
            <div className="agent-capabilities">
              {provider.capabilities.map((capability) => (
                <span key={capability}>{CAPABILITY_LABELS[capability]}</span>
              ))}
            </div>
          </section>

          <section className="agent-sidebar-section">
            <div className="agent-section-heading">
              <div className="agent-section-title">
                <KeyRound size={14} />
                <span>Authorization</span>
              </div>
              {provider.auth ? (
                <IconButton
                  label="Refresh authorization"
                  disabled={providerSession.auth.status === "checking"}
                  onClick={() => void refreshAuthStatus(provider.id)}
                >
                  <RotateCcw size={15} />
                </IconButton>
              ) : null}
            </div>
            <div className={`agent-auth-card ${providerSession.auth.status}`}>
              <div className="agent-auth-status">
                <span>{authStatusLabel(providerSession.auth.status)}</span>
              </div>
              <p>{providerSession.auth.message}</p>
              {providerSession.auth.deviceUrl ? (
                <button
                  className="agent-auth-link"
                  type="button"
                  onClick={() => {
                    const url = providerSession.auth.deviceUrl;
                    if (!url) {
                      return;
                    }
                    void openExternalUrl(url).catch((error) => {
                      const message = errorToMessage(error);
                      appendLog(provider.id, "error", message);
                      onNotice(message);
                    });
                  }}
                >
                  Open authorization URL
                </button>
              ) : null}
              {providerSession.auth.deviceCode ? (
                <code>{providerSession.auth.deviceCode}</code>
              ) : null}
              {providerSession.auth.detail ? (
                <pre>{providerSession.auth.detail}</pre>
              ) : null}
              {provider.auth ? (
                <div className="agent-auth-actions">
                  {providerSession.auth.status === "authorizing" ? (
                    <IconButton label="Cancel" showLabel onClick={stopProviderAuth}>
                      <Square size={15} />
                    </IconButton>
                  ) : provider.auth.login && providerSession.auth.status !== "authenticated" ? (
                    <IconButton
                      label="Authorize"
                      showLabel
                      disabled={providerSession.auth.status === "checking"}
                      onClick={() => void startProviderAuth()}
                    >
                      <LogIn size={15} />
                    </IconButton>
                  ) : null}
                  {provider.auth.logout ? (
                    <IconButton
                      label="Logout"
                      showLabel
                      disabled={
                        providerSession.auth.status !== "authenticated" ||
                        Boolean(providerSession.auth.authSessionId)
                      }
                      onClick={() => void logoutProviderAuth()}
                    >
                      <LogOut size={15} />
                    </IconButton>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section className="agent-sidebar-section">
            <label className="agent-field">
              <span>Preset</span>
              <select value={providerSession.presetId} onChange={(event) => changePreset(event.target.value)}>
                {HARNESS_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="agent-field">
              <span>System prompt</span>
              <textarea
                value={providerSession.systemPrompt}
                onChange={(event) => changeSystemPrompt(event.target.value)}
                rows={4}
              />
            </label>
          </section>

          <section className="agent-sidebar-section">
            <div className="agent-section-title">Workspace</div>
            <dl className="agent-context-list">
              <div>
                <dt>Active</dt>
                <dd title={workspaceContext.activeFolder}>{displayPath(workspaceContext.activeFolder)}</dd>
              </div>
              <div>
                <dt>Opposite</dt>
                <dd title={workspaceContext.oppositeFolder}>{displayPath(workspaceContext.oppositeFolder)}</dd>
              </div>
              <div>
                <dt>Selected</dt>
                <dd>{selectedPaths.length}</dd>
              </div>
            </dl>
          </section>

          <section className="agent-sidebar-section">
            <div className="agent-section-heading">
              <div className="agent-section-title">Attachments</div>
              <IconButton
                label="Attach selected files"
                disabled={selectedPaths.length === 0}
                onClick={addSelectedAttachments}
              >
                <Paperclip size={15} />
              </IconButton>
            </div>
            <div className="agent-attachments">
              {providerSession.attachments.length === 0 ? (
                <div className="agent-empty">None</div>
              ) : (
                providerSession.attachments.map((attachment) => (
                  <div className="agent-attachment" key={attachment.id}>
                    {attachment.kind === "image" && attachment.dataUrl ? (
                      <img alt="" src={attachment.dataUrl} />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    <span title={describeAttachment(attachment)}>{attachment.name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)}>
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="agent-sidebar-section agent-log-section">
            <div className="agent-section-title">
              <Activity size={14} />
              <span>Events</span>
            </div>
            <div className="agent-event-log">
              {providerSession.logs.length === 0 ? (
                <div className="agent-empty">No events</div>
              ) : (
                providerSession.logs.map((entry) => (
                  <div className={`agent-log-entry ${entry.level}`} key={entry.id}>
                    <time>{formatLogTime(entry.timestamp)}</time>
                    <span>{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="agent-chat">
          <div className="agent-messages" role="log">
            {providerSession.messages.length === 0 ? (
              <div className="agent-welcome">
                <Bot size={22} />
                <strong>{provider.name}</strong>
                <span>{provider.description}</span>
              </div>
            ) : (
              providerSession.messages.map((message) => (
                <article className={`agent-message ${message.role}`} key={message.id}>
                  <div className="agent-message-role">{message.role}</div>
                  <pre>{message.content || (message.streaming ? "..." : "")}</pre>
                </article>
              ))
            )}
          </div>

          <footer className="agent-composer">
            <textarea
              value={providerSession.draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              onPaste={handlePaste}
              placeholder="Ask the selected provider..."
              rows={3}
            />
            <div className="agent-composer-actions">
              <IconButton label="Clear chat" onClick={clearConversation}>
                <Trash2 size={16} />
              </IconButton>
              <IconButton
                label="Send"
                className="primary-icon-button"
                disabled={sendDisabled}
                onClick={() => void sendMessage()}
              >
                <Send size={16} />
              </IconButton>
            </div>
          </footer>
        </section>
      </div>
    </section>
  );
}

function createProviderSession(providerId: string): ProviderSessionState {
  return {
    providerId,
    runtimeSessionId: null,
    status: "idle",
    auth: createProviderAuthState(),
    messages: [],
    attachments: [],
    logs: [],
    draft: "",
    presetId: "default",
    systemPrompt: "",
    pendingResponseId: null,
  };
}

function createProviderAuthState(): ProviderAuthState {
  return {
    status: "unknown",
    message: "Authorization status has not been checked.",
    detail: "",
    authSessionId: null,
    deviceUrl: null,
    deviceCode: null,
  };
}

function createMessage(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: createId("agent-message"),
    role,
    content,
    createdAt: Date.now(),
  };
}

function appendAssistantChunk(
  messages: AgentMessage[],
  pendingResponseId: string | null,
  chunk: string,
  streaming: boolean,
): AgentMessage[] {
  const targetId =
    pendingResponseId ??
    [...messages].reverse().find((message) => message.role === "assistant")?.id ??
    null;
  if (!targetId) {
    return [...messages, { ...createMessage("assistant", chunk), streaming }];
  }

  return messages.map((message) =>
    message.id === targetId
      ? { ...message, content: message.content + chunk, streaming }
      : message,
  );
}

function streamMockResponse(
  providerId: string,
  responseId: string,
  userMessage: string,
  context: ReturnType<typeof buildAgentWorkspaceContext>,
  updateProviderSession: (
    providerId: string,
    updater: (current: ProviderSessionState) => ProviderSessionState,
  ) => void,
  timersRef: MutableRefObject<number[]>,
) {
  const chunks = [
    `Mock provider received: ${userMessage}\n\n`,
    `Active folder: ${context.activeFolder}\n`,
    `Selected files: ${context.selectedFiles.length}\n`,
    `Attachments: ${context.attachments.length}\n\n`,
    "Provider adapters can stream shell, edit, diff, approval, or API events through this panel.",
  ];

  updateProviderSession(providerId, (current) => ({ ...current, status: "running" }));
  chunks.forEach((chunk, index) => {
    const timer = window.setTimeout(() => {
      updateProviderSession(providerId, (current) => ({
        ...current,
        messages: appendAssistantChunk(current.messages, responseId, chunk, index < chunks.length - 1),
        pendingResponseId: index === chunks.length - 1 ? null : current.pendingResponseId,
        status: index === chunks.length - 1 ? "idle" : current.status,
      }));
    }, 180 * (index + 1));
    timersRef.current.push(timer);
  });
}

function processCodexJsonlOutput(
  payload: AgentOutputPayload,
  outputBuffersRef: MutableRefObject<Record<string, string>>,
  updateProviderSession: (
    providerId: string,
    updater: (current: ProviderSessionState) => ProviderSessionState,
  ) => void,
  appendLog: (providerId: string, level: string, message: string, timestamp?: number) => void,
) {
  const buffered = `${outputBuffersRef.current[payload.sessionId] ?? ""}${payload.data}`;
  const lines = buffered.replace(/\r\n/g, "\n").split("\n");
  outputBuffersRef.current[payload.sessionId] = lines.pop() ?? "";

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      appendProviderText(payload.providerId, trimmed, updateProviderSession);
      return;
    }

    const eventType = typeof event.type === "string" ? event.type : "event";
    if (eventType === "item.completed") {
      const item = event.item;
      if (isRecord(item) && item.type === "agent_message" && typeof item.text === "string") {
        appendProviderText(payload.providerId, item.text, updateProviderSession);
        return;
      }

      if (isRecord(item) && typeof item.type === "string") {
        appendLog(payload.providerId, "info", `Completed ${item.type}`);
      }
      return;
    }

    if (eventType === "thread.started") {
      appendLog(payload.providerId, "info", "Thread started");
      return;
    }

    if (eventType === "turn.started") {
      appendLog(payload.providerId, "info", "Turn started");
      return;
    }

    if (eventType === "turn.completed") {
      appendLog(payload.providerId, "info", formatCodexUsage(event.usage));
      return;
    }

    if (eventType.includes("error") || eventType.includes("failed")) {
      appendLog(payload.providerId, "error", eventType);
    }
  });
}

function appendProviderText(
  providerId: string,
  text: string,
  updateProviderSession: (
    providerId: string,
    updater: (current: ProviderSessionState) => ProviderSessionState,
  ) => void,
) {
  updateProviderSession(providerId, (current) => ({
    ...current,
    messages: appendAssistantChunk(
      current.messages,
      current.pendingResponseId,
      text,
      true,
    ),
  }));
}

function formatCodexUsage(usage: unknown): string {
  if (!isRecord(usage)) {
    return "Turn completed";
  }

  const inputTokens =
    typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens =
    typeof usage.output_tokens === "number" ? usage.output_tokens : null;

  if (inputTokens === null && outputTokens === null) {
    return "Turn completed";
  }

  return `Turn completed (${inputTokens ?? 0} in, ${outputTokens ?? 0} out tokens)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLiveAgentStatus(status: AgentStatus): boolean {
  return status === "starting" || status === "running";
}

function parseProviderAuthStatus(
  provider: AgentProvider,
  result: AgentCommandResult,
  previous: ProviderAuthState,
): ProviderAuthState {
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();

  if (provider.auth?.statusParser === "codexLoginStatus") {
    if (/logged in/i.test(output)) {
      return {
        ...previous,
        status: "authenticated",
        message: output || "Provider is authenticated.",
        detail: "",
        authSessionId: null,
        deviceUrl: null,
        deviceCode: null,
      };
    }

    if (/not logged in/i.test(output)) {
      return {
        ...previous,
        status: "unauthenticated",
        message: "Provider is not authenticated.",
        detail: output,
        authSessionId: null,
        deviceUrl: null,
        deviceCode: null,
      };
    }
  }

  return {
    ...previous,
    status: result.success ? "unknown" : "error",
    message: output || (result.success ? "Provider status is unknown." : "Provider status check failed."),
    detail: output,
    authSessionId: null,
  };
}

function parseDeviceAuthDetail(detail: string): {
  deviceUrl: string | null;
  deviceCode: string | null;
} {
  const deviceUrl = detail.match(/https:\/\/\S+/)?.[0] ?? null;
  const deviceCode = detail.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0] ?? null;
  return { deviceUrl, deviceCode };
}

function trimAuthDetail(detail: string): string {
  const maxLength = 1600;
  return detail.length > maxLength ? detail.slice(detail.length - maxLength) : detail;
}

function authStatusLabel(status: ProviderAuthStatus): string {
  switch (status) {
    case "checking":
      return "Checking";
    case "authenticated":
      return "Authenticated";
    case "unauthenticated":
      return "Not authenticated";
    case "authorizing":
      return "Authorizing";
    case "error":
      return "Auth error";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${nextAgentId++}`;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "\n");
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
