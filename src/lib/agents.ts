import type { PanelId, SessionData } from "./types";
import { activeTab, oppositePanel } from "./tabState";

export type AgentProviderKind = "mock" | "terminal" | "api";

export type AgentProviderCapability =
  | "chat"
  | "streaming"
  | "workspaceContext"
  | "attachments"
  | "screenshots"
  | "shell"
  | "fileEdits"
  | "codeExecution"
  | "diffs"
  | "approvals"
  | "eventLog";

export interface TerminalAgentAdapter {
  command: string;
  args: string[];
  execution: "persistent" | "perPrompt";
  promptDelivery: "stdin" | "argument";
  outputFormat: "plain" | "ansi" | "codexJsonl";
}

export interface AgentProviderCommand {
  command: string;
  args: string[];
}

export interface AgentProviderAuth {
  status: AgentProviderCommand;
  login?: AgentProviderCommand;
  logout?: AgentProviderCommand;
  statusParser: "codexLoginStatus";
}

export interface AgentProvider {
  id: string;
  name: string;
  description: string;
  kind: AgentProviderKind;
  capabilities: AgentProviderCapability[];
  adapter?: TerminalAgentAdapter;
  auth?: AgentProviderAuth;
}

export interface AgentAttachment {
  id: string;
  kind: "path" | "image" | "text";
  name: string;
  createdAt: number;
  path?: string;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
  text?: string;
}

export interface AgentPanelTabContext {
  id: string;
  path: string;
  selectedPaths: string[];
  isActive: boolean;
}

export interface AgentWorkspaceContext {
  activeFolder: string;
  activePanel: PanelId;
  oppositePanel: PanelId;
  oppositeFolder: string;
  showHiddenFiles: boolean;
  selectedFiles: string[];
  panels: Record<PanelId, AgentPanelTabContext[]>;
  attachments: AgentAttachment[];
}

export interface HarnessPreset {
  id: string;
  name: string;
  prompt: string;
}

export const CAPABILITY_LABELS: Record<AgentProviderCapability, string> = {
  chat: "Chat",
  streaming: "Streaming",
  workspaceContext: "Workspace context",
  attachments: "Attachments",
  screenshots: "Screenshots",
  shell: "Shell",
  fileEdits: "File edits",
  codeExecution: "Code execution",
  diffs: "Diffs",
  approvals: "Approvals",
  eventLog: "Event log",
};

export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    id: "default",
    name: "Workspace harness",
    prompt:
      "You are running inside Bobroot, a GUI file-manager harness. Use the injected workspace context as orientation, but do not limit yourself to file-manager operations. If your provider supports shell commands, edits, screenshots, diffs, or approval modes, use those capabilities according to its normal rules.",
  },
  {
    id: "plan",
    name: "Plan first",
    prompt:
      "Start with a concise plan and call out any risky actions before making changes. Prefer reversible steps and keep the user informed when using provider capabilities outside simple chat.",
  },
  {
    id: "review",
    name: "Review",
    prompt:
      "Prioritize bugs, regressions, missing tests, security issues, and unclear behavior. Lead with findings and include file or command references when available.",
  },
  {
    id: "none",
    name: "No preset",
    prompt: "",
  },
];

export const AGENT_PROVIDERS: AgentProvider[] = [
  {
    id: "mock",
    name: "Mock Provider",
    description: "Local streaming provider for UI testing.",
    kind: "mock",
    capabilities: [
      "chat",
      "streaming",
      "workspaceContext",
      "attachments",
      "screenshots",
      "eventLog",
    ],
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "Terminal-agent adapter that runs the Codex CLI in the active workspace.",
    kind: "terminal",
    capabilities: [
      "chat",
      "streaming",
      "workspaceContext",
      "attachments",
      "screenshots",
      "shell",
      "fileEdits",
      "codeExecution",
      "diffs",
      "approvals",
      "eventLog",
    ],
    adapter: {
      command: "codex",
      args: ["exec", "--json", "--color", "never", "--skip-git-repo-check"],
      execution: "perPrompt",
      promptDelivery: "argument",
      outputFormat: "codexJsonl",
    },
    auth: {
      status: {
        command: "codex",
        args: ["login", "status"],
      },
      login: {
        command: "codex",
        args: ["login", "--device-auth"],
      },
      logout: {
        command: "codex",
        args: ["logout"],
      },
      statusParser: "codexLoginStatus",
    },
  },
];

export function getAgentProvider(providerId: string): AgentProvider {
  return AGENT_PROVIDERS.find((provider) => provider.id === providerId) ?? AGENT_PROVIDERS[0];
}

export function buildAgentWorkspaceContext(
  session: SessionData,
  attachments: AgentAttachment[],
): AgentWorkspaceContext {
  const activePanelId = session.activePanel;
  const oppositePanelId = oppositePanel(activePanelId);
  const activePanelTab = activeTab(session[activePanelId]);
  const oppositePanelTab = activeTab(session[oppositePanelId]);

  return {
    activeFolder: activePanelTab.path,
    activePanel: activePanelId,
    oppositePanel: oppositePanelId,
    oppositeFolder: oppositePanelTab.path,
    showHiddenFiles: session.showHiddenFiles,
    selectedFiles: activePanelTab.selectedPaths,
    panels: {
      left: session.left.tabs.map((tab) => ({
        id: tab.id,
        path: tab.path,
        selectedPaths: tab.selectedPaths,
        isActive: tab.id === session.left.activeTabId,
      })),
      right: session.right.tabs.map((tab) => ({
        id: tab.id,
        path: tab.path,
        selectedPaths: tab.selectedPaths,
        isActive: tab.id === session.right.activeTabId,
      })),
    },
    attachments,
  };
}

export function composeAgentPrompt(
  userMessage: string,
  context: AgentWorkspaceContext,
  preset: HarnessPreset,
  systemPrompt: string,
): string {
  const promptSections = [
    preset.prompt,
    systemPrompt.trim(),
  ].filter(Boolean);
  const attachmentSummary = context.attachments.map(describeAttachment);
  const contextPayload = {
    activeFolder: context.activeFolder,
    activePanel: context.activePanel,
    oppositePanel: context.oppositePanel,
    oppositeFolder: context.oppositeFolder,
    showHiddenFiles: context.showHiddenFiles,
    selectedFiles: context.selectedFiles,
    panels: context.panels,
    attachments: attachmentSummary,
  };

  return [
    promptSections.length
      ? `System / harness instructions:\n${promptSections.join("\n\n")}`
      : null,
    `Workspace context:\n${JSON.stringify(contextPayload, null, 2)}`,
    `User request:\n${userMessage.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function describeAttachment(attachment: AgentAttachment): string {
  if (attachment.kind === "path") {
    return `path: ${attachment.path ?? attachment.name}`;
  }

  if (attachment.kind === "image") {
    return `image: ${attachment.name}${attachment.mimeType ? ` (${attachment.mimeType})` : ""}`;
  }

  return `text: ${attachment.name}`;
}
