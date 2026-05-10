# Repository Guidelines

## Project Structure & Module Organization

Bobroot is a Tauri 2 desktop file manager with a React/TypeScript frontend and Rust backend.

- `src/` contains the frontend app.
- `src/components/` contains React UI components.
- `src/hooks/` contains shared React hooks.
- `src/lib/` contains state, formatting, platform, session, layout, and Tauri API helpers.
- `src/styles/app.css` contains application styling.
- `src-tauri/src/lib.rs` contains Rust filesystem, session, terminal, watcher, and command logic.
- `src-tauri/src/main.rs` is the Tauri entry point.
- `src-tauri/capabilities/` defines Tauri permissions; `src-tauri/icons/` and `public/` hold assets.

Do not edit generated output in `dist/`, `src-tauri/target/`, or `src-tauri/gen/`.

## Build, Test, and Development Commands

Use `pnpm` through Corepack and prefer the Makefile for repeatable checks.

- `corepack enable`: prepares the pinned package manager.
- `make install`: installs frontend dependencies.
- `make dev`: starts Vite at `127.0.0.1:1420`.
- `make tauri-dev`: runs the desktop app locally.
- `make build`: runs TypeScript checking and builds the frontend.
- `make cargo-check`: runs `cargo check` in `src-tauri/`.
- `make test`: runs Rust tests.
- `make ci`: matches GitHub Actions locally: install, build, check, and test.

## Coding Style & Naming Conventions

TypeScript uses ES modules, React function components, two-space indentation, double quotes, and semicolons. Name components in `PascalCase`, hooks as `useSomething`, and utility functions in `camelCase`.

Rust uses standard `rustfmt` style, `snake_case` functions, and `PascalCase` types. Keep Tauri command payloads serializable with `serde` and reuse `CommandResult`/`CommandError`.

No ESLint, Prettier, Clippy, or formatting script is configured; match nearby code.

## Testing Guidelines

Automated tests are Rust unit tests in `src-tauri/src/lib.rs`, covering file operation safety, conflict handling, symlinks, and name validation. Add focused tests near related helpers when changing filesystem behavior. Use `tempfile`; do not test against real user folders.

Run `make test` for backend tests and `make ci` before opening a pull request. Frontend changes should pass `make build`; manually exercise impacted Tauri flows.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, sometimes with Conventional Commit prefixes such as `fix(security): ...`, `fix(qa): ...`, and `chore: ...`. Keep commits focused.

Pull requests should include a summary, test results, linked issues when applicable, and screenshots or short recordings for visible UI changes. Call out filesystem safety implications for copy, move, delete, trash, terminal, and path-handling changes.

## Security & Configuration Tips

Treat filesystem operations as high risk. Preserve confirmation flows for destructive actions, avoid logging sensitive file contents, and keep `src-tauri/capabilities/default.json` as narrow as practical.
