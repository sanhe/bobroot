export type AppPlatform = "macos" | "windows" | "linux";

export function currentPlatform(): AppPlatform {
  const userAgentDataPlatform =
    "userAgentData" in navigator
      ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform
      : undefined;
  const platform = [
    userAgentDataPlatform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter(Boolean)
    .join(" ");
  const normalized = platform.toLowerCase();

  if (normalized.includes("mac")) {
    return "macos";
  }

  if (normalized.includes("win")) {
    return "windows";
  }

  return "linux";
}

export function hiddenFilesShortcut(platform = currentPlatform()): string {
  return platform === "macos" ? "Cmd+Shift+." : "Ctrl+H";
}

export function permanentDeleteShortcut(platform = currentPlatform()): string {
  if (platform === "macos") {
    return "Option+Cmd+Delete";
  }

  if (platform === "windows") {
    return "Shift+Delete";
  }

  return "Ctrl+Delete";
}

export function trashShortcut(platform = currentPlatform()): string {
  return platform === "macos" ? "Cmd+Delete" : "Delete";
}

export function syncPanelShortcut(platform = currentPlatform()): string {
  return platform === "macos" ? "Cmd+Option+S" : "Ctrl+Alt+S";
}

export function copyPathShortcut(platform = currentPlatform()): string {
  return platform === "macos" ? "Cmd+Option+C" : "Ctrl+Shift+C";
}

export function newFolderShortcut(platform = currentPlatform()): string {
  return platform === "macos" ? "Cmd+Shift+N" : "Ctrl+Shift+N";
}

export function trashTargetName(platform = currentPlatform()): string {
  if (platform === "windows") {
    return "Recycle Bin";
  }

  return "Trash/Bin";
}

export function revealActionLabel(platform = currentPlatform()): string {
  if (platform === "macos") {
    return "Reveal in Finder";
  }

  if (platform === "windows") {
    return "Show in Explorer";
  }

  return "Reveal in Files";
}
