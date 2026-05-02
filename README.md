# Bobroot

Bobroot is a small cross-platform desktop file manager for macOS, Ubuntu, and Windows. It uses a classic dual-pane layout with a minimal Apple-like interface, independent tabs per panel, session restore, basic filesystem operations, and system-native file preview where available.

## Stack

- Tauri 2
- React
- TypeScript
- Rust filesystem backend

## Current Features

- Left and right file panels
- Right panel can be shown or hidden for single-panel work
- Independent tabs in each panel
- Per-tab path, selection, and navigation history state
- Session restore for tabs, active panel, active tabs, paths, hidden-file visibility, and window size/position where the platform allows it
- Navigate into folders, go up, refresh
- Keyboard navigation inside the active panel
- Global hidden-files toggle
- Select one or multiple items
- Copy and move selected items to the opposite panel
- Conflict handling: replace, skip, or rename with a suffix
- Open files and folders with the default system application
- Rename, create folder, move to Trash/Bin/Recycle Bin, and permanent delete with confirmation
- System-native preview from the selected item, including Quick Look on macOS
- Context menu reveal command: Finder, Files, or Explorer depending on platform
- Local JSONL action log at the app config path, including file-manager actions and paths

## Development Setup

Install Rust and Node.js first. This project uses `pnpm`.

```bash
corepack enable
pnpm install
```

## Run on macOS

Install Xcode Command Line Tools if needed:

```bash
xcode-select --install
```

Run the app:

```bash
pnpm tauri:dev
```

## Run on Ubuntu

Install Tauri's Linux system dependencies:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then run:

```bash
corepack enable
pnpm install
pnpm tauri:dev
```

## Run on Windows

Install Rust, Node.js, and Microsoft C++ Build Tools. Then run:

```powershell
corepack enable
pnpm install
pnpm tauri:dev
```

## Build Release Packages

macOS:

```bash
pnpm tauri:build
```

Ubuntu:

```bash
pnpm tauri:build
```

Windows:

```powershell
pnpm tauri:build
```

Tauri writes release artifacts under `src-tauri/target/release/bundle`.

## Project Structure

- `src/components` - React UI components
- `src/hooks` - keyboard shortcut handling
- `src/lib/api.ts` - frontend bridge to Rust commands
- `src/lib/tabState.ts` - tab and panel state helpers
- `src-tauri/src/lib.rs` - Rust filesystem and session commands
- `src-tauri/capabilities` - Tauri window permissions

## Shortcuts

- Show hidden files: `Cmd+Shift+.` on macOS, `Ctrl+H` on Linux and Windows
- Navigate rows: arrow keys, `Page Up`, `Page Down`, `Home`, `End`
- Preview selected item: `Space`
- Open selected item: `Cmd+Down` on macOS, `Enter` on Linux and Windows
- Rename selected item: `Enter` on macOS, `F2` on Linux and Windows
- Go to parent folder: `Cmd+Up` on macOS, `Alt+Up` or `Backspace` on Linux and Windows
- Open selected folder in a new tab: `Cmd+Enter` on macOS, `Ctrl+Enter` on Linux and Windows
- Create folder: `Cmd+Shift+N` on macOS, `Ctrl+Shift+N` on Linux and Windows
- Switch active panel: `Tab`
- Match active panel to the opposite panel folder: `Cmd+Option+S` on macOS, `Ctrl+Alt+S` on Linux and Windows
- Move to Trash/Bin/Recycle Bin: `Cmd+Delete` on macOS, `Delete` on Linux and Windows
- Permanent delete: `Option+Cmd+Delete` on macOS, `Ctrl+Delete` on Linux, `Shift+Delete` on Windows

## Safety Notes

Regular delete moves items to Trash/Bin/Recycle Bin after confirmation. Permanent deletion is only exposed through the explicit permanent-delete command path and always asks for confirmation with an irreversible-action warning.
