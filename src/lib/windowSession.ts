import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowSession } from "./types";

const DEFAULT_WINDOW: WindowSession = {
  width: 1220,
  height: 760,
  x: null,
  y: null,
};

const MIN_WIDTH = 880;
const MIN_HEIGHT = 540;
const MAX_WIDTH = 2600;
const MAX_HEIGHT = 1800;
const MAX_POSITION = 12000;

export async function readWindowSession(): Promise<WindowSession | null> {
  const browserWindow = globalThis.window;

  return sanitizeWindowSession({
    width: browserWindow?.outerWidth ?? DEFAULT_WINDOW.width,
    height: browserWindow?.outerHeight ?? DEFAULT_WINDOW.height,
    x: Number.isFinite(browserWindow?.screenX) ? browserWindow.screenX : null,
    y: Number.isFinite(browserWindow?.screenY) ? browserWindow.screenY : null,
  });
}

export async function restoreWindowSession(session: WindowSession | null): Promise<void> {
  const restored = sanitizeWindowSession(session);
  if (!restored) {
    return;
  }

  try {
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(restored.width, restored.height));
    if (restored.x !== null && restored.y !== null) {
      await window.setPosition(new LogicalPosition(restored.x, restored.y));
    }
  } catch {
    // Browser-only development keeps the UI usable without Tauri window APIs.
  }
}

function sanitizeWindowSession(session: WindowSession | null): WindowSession | null {
  if (!session) {
    return null;
  }

  const hasInvalidSize =
    !isValidSize(session.width, MIN_WIDTH, MAX_WIDTH) ||
    !isValidSize(session.height, MIN_HEIGHT, MAX_HEIGHT);
  const width = hasInvalidSize ? DEFAULT_WINDOW.width : Math.round(session.width);
  const height = hasInvalidSize ? DEFAULT_WINDOW.height : Math.round(session.height);
  const x = hasInvalidSize ? null : sanitizePosition(session.x);
  const y = hasInvalidSize ? null : sanitizePosition(session.y);

  return { width, height, x, y };
}

function isValidSize(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function sanitizePosition(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || Math.abs(value) > MAX_POSITION) {
    return null;
  }

  return Math.round(value);
}
