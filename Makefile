# Omnigent IDE Extensions — common tasks.
#
# Layout:
#   vscode/                VS Code extension (TypeScript, pnpm)
#   intellij/              IntelliJ/PyCharm plugin (Kotlin, Gradle)
#   third_party/omnigent   omnigent submodule (source of the web app bundled for
#                          Databricks workspaces, and of vscode/src/vendor/omnigent)
#   docs/                  normative discovery/auth contract + conformance vectors
#
# Quick start:  make install && make check
# Release build: make submodule && make web-deps && make package-vscode

VSCODE      := vscode
INTELLIJ    := intellij
OMNIGENT    := third_party/omnigent
WEB         := $(OMNIGENT)/web
GRADLEW     := ./gradlew --console=plain --no-daemon

# Editor CLI used to install and launch the extension, e.g. `cursor`.
OMNIGENT_VSCODE_CLI ?= code
# Folder `make dev-vscode` opens in the Extension Development Host.
FOLDER ?= .

# Read from vscode/package.json when used, so the publisher is named in one place.
VSCODE_VERSION = $(shell node -p "require('./$(VSCODE)/package.json').version")
VSCODE_EXT_ID  = $(shell node -p "const p = require('./$(VSCODE)/package.json'); p.publisher + '.' + p.name")
VSCODE_VSIX    = $(VSCODE)/omnigent-vscode-$(VSCODE_VERSION).vsix

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── setup ─────────────────────────────────────────────────────────────────────
.PHONY: submodule
submodule: ## Init/update the omnigent submodule (needed for build-web-ui and vendor-check)
	git submodule update --init --depth 1 $(OMNIGENT)

.PHONY: install
install: ## Install the VS Code extension's dependencies (pnpm)
	cd $(VSCODE) && pnpm install --frozen-lockfile

.PHONY: web-deps
web-deps: ## Install the submodule web app's dependencies (for build-web-ui)
	@test -f $(WEB)/package.json || { echo "$(WEB) is missing; run 'make submodule' first." >&2; exit 1; }
	cd $(OMNIGENT) && pnpm install --frozen-lockfile --filter web

.PHONY: _ensure-vscode
_ensure-vscode:
	@test -d $(VSCODE)/node_modules || $(MAKE) --no-print-directory install

.PHONY: _ensure-web
_ensure-web:
	@test -d $(WEB)/node_modules || $(MAKE) --no-print-directory web-deps

.PHONY: _ensure-editor-cli
_ensure-editor-cli:
	@command -v "$(OMNIGENT_VSCODE_CLI)" >/dev/null 2>&1 || { \
		echo "'$(OMNIGENT_VSCODE_CLI)' is not on PATH. Install it from the Command Palette" >&2; \
		echo "(Shell Command: Install 'code' command in PATH), or set OMNIGENT_VSCODE_CLI," >&2; \
		echo "e.g. make install-vscode OMNIGENT_VSCODE_CLI=cursor" >&2; \
		exit 1; }

# ── build ─────────────────────────────────────────────────────────────────────
.PHONY: build
build: build-vscode build-intellij ## Build both extensions

.PHONY: build-vscode
build-vscode: _ensure-vscode ## Bundle the VS Code extension into vscode/dist/extension.js
	cd $(VSCODE) && pnpm run build

.PHONY: watch-vscode
watch-vscode: _ensure-vscode ## Rebuild vscode/dist/extension.js on every change
	cd $(VSCODE) && node esbuild.js --watch

.PHONY: build-web-ui
build-web-ui: _ensure-vscode _ensure-web ## Build the submodule's web app into vscode/dist/web-ui (served for Databricks workspaces)
	cd $(VSCODE) && pnpm run build:web-ui

.PHONY: build-intellij
build-intellij: ## Build the IntelliJ/PyCharm plugin zip
	cd $(INTELLIJ) && $(GRADLEW) buildPlugin

# ── test ──────────────────────────────────────────────────────────────────────
.PHONY: test
test: test-vscode test-intellij ## Run all tests

.PHONY: test-vscode
test-vscode: _ensure-vscode ## Run the VS Code unit + conformance tests (vitest)
	cd $(VSCODE) && pnpm run test

.PHONY: test-intellij
test-intellij: ## Run IntelliJ unit + conformance tests (Gradle)
	cd $(INTELLIJ) && $(GRADLEW) test

.PHONY: typecheck
typecheck: _ensure-vscode ## Type-check the VS Code extension
	cd $(VSCODE) && pnpm run type-check

.PHONY: format-vscode
format-vscode: _ensure-vscode ## Format the VS Code extension's sources (Prettier)
	cd $(VSCODE) && pnpm run format

.PHONY: check
check: _ensure-vscode ## What CI runs for the VS Code extension: format, type-check, tests, bundle
	cd $(VSCODE) && pnpm run format:check && pnpm run type-check && pnpm run test && pnpm run build

.PHONY: vendor-check
vendor-check: ## Verify vscode/src/vendor/omnigent matches the submodule's copies
	@test -f $(WEB)/package.json || { echo "$(WEB) is missing; run 'make submodule' first." >&2; exit 1; }
	@for f in url.js loopback-oauth.js; do \
		diff -u $(WEB)/electron/src/$$f $(VSCODE)/src/vendor/omnigent/$$f \
			|| { echo "$(VSCODE)/src/vendor/omnigent/$$f differs from $(WEB)/electron/src/$$f (see vscode/PROVENANCE.md)" >&2; exit 1; }; \
	done
	@echo "vendored omnigent helpers match $(OMNIGENT) @ $$(git -C $(OMNIGENT) rev-parse --short HEAD)"

# ── package ───────────────────────────────────────────────────────────────────
.PHONY: package
package: package-vscode package-intellij ## Produce both installable artifacts

.PHONY: package-vscode
package-vscode: _ensure-vscode _ensure-web ## Build the web app and package vscode/omnigent-vscode-<version>.vsix
	cd $(VSCODE) && pnpm run package

.PHONY: package-intellij
package-intellij: ## Package the IntelliJ plugin (.zip -> intellij/build/distributions/)
	cd $(INTELLIJ) && $(GRADLEW) buildPlugin

# ── run ───────────────────────────────────────────────────────────────────────
.PHONY: dev-vscode
dev-vscode: build-vscode _ensure-editor-cli ## Open an Extension Development Host on FOLDER (default: .)
	"$(OMNIGENT_VSCODE_CLI)" --extensionDevelopmentPath="$(abspath $(VSCODE))" "$(FOLDER)"

.PHONY: install-vscode
install-vscode: package-vscode _ensure-editor-cli ## Package the .vsix and install it into the editor
	"$(OMNIGENT_VSCODE_CLI)" --install-extension "$(VSCODE_VSIX)" --force

.PHONY: uninstall-vscode
uninstall-vscode: _ensure-editor-cli ## Uninstall the extension from the editor
	"$(OMNIGENT_VSCODE_CLI)" --uninstall-extension "$(VSCODE_EXT_ID)"

# ── housekeeping ──────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove build outputs (keeps node_modules)
	rm -rf $(VSCODE)/dist $(VSCODE)/*.vsix
	cd $(INTELLIJ) && $(GRADLEW) clean || true

.PHONY: clean-all
clean-all: clean ## Also remove the VS Code extension's node_modules
	rm -rf $(VSCODE)/node_modules
