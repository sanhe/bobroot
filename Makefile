PNPM ?= pnpm
CARGO ?= cargo
RM ?= rm -rf

.PHONY: help install install-ci dev preview build tauri-dev tauri-build cargo-check test check ci clean

help:
	@printf "Bobroot commands:\n"
	@printf "  make install      Install frontend dependencies\n"
	@printf "  make install-ci   Install frontend dependencies from lockfile\n"
	@printf "  make dev          Start the Vite dev server\n"
	@printf "  make tauri-dev    Start the Tauri desktop app in dev mode\n"
	@printf "  make build        Build the frontend\n"
	@printf "  make cargo-check  Check the Tauri Rust crate\n"
	@printf "  make test         Run Rust tests\n"
	@printf "  make ci           Run the CI-equivalent local checks\n"
	@printf "  make clean        Remove generated build output\n"

install:
	$(PNPM) install

install-ci:
	$(PNPM) install --frozen-lockfile

dev:
	$(PNPM) dev

preview:
	$(PNPM) preview

build:
	$(PNPM) build

tauri-dev:
	$(PNPM) tauri:dev

tauri-build:
	$(PNPM) tauri:build

cargo-check:
	cd src-tauri && $(CARGO) check

test:
	cd src-tauri && $(CARGO) test

check: build cargo-check test

ci: install-ci check

clean:
	$(RM) dist src-tauri/gen src-tauri/target
