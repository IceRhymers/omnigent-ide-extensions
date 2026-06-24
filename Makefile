# Omnigent IDE Extensions — common tasks.
#
# Layout:
#   vscode/            VS Code extension (TypeScript)
#   intellij/          IntelliJ/PyCharm plugin (Kotlin, Gradle)
#   third_party/omnigent   omnigent submodule (source of the ap-web embed bundle)
#   docs/              normative discovery/auth contract + conformance vectors
#
# Quick start:  make submodule && make install && make build && make test

VSCODE      := vscode
INTELLIJ    := intellij
APWEB       := third_party/omnigent/ap-web
GRADLEW     := ./gradlew --console=plain --no-daemon

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── setup ─────────────────────────────────────────────────────────────────────
.PHONY: submodule
submodule: ## Init/update the omnigent submodule (source of the ap-web embed)
	git submodule update --init --recursive

.PHONY: install
install: ## Install VS Code extension dependencies
	cd $(VSCODE) && bun install

# ── build ─────────────────────────────────────────────────────────────────────
.PHONY: build
build: build-vscode build-intellij ## Build both extensions

.PHONY: build-vscode
build-vscode: ## Build the VS Code extension (+ webview bootstrap)
	cd $(VSCODE) && bun run build && bun run build:bootstrap

.PHONY: build-apweb
build-apweb: ## Build the ap-web embed bundle from the submodule and vendor it into vscode/media/apweb
	cd $(APWEB) && npm install && npm run build:embed
	mkdir -p $(VSCODE)/media/apweb
	cp -R $(APWEB)/dist-embed/. $(VSCODE)/media/apweb/
	@echo "Vendored ap-web embed -> $(VSCODE)/media/apweb/ (entry: omnigent-embed.js)."
	@echo "Remember to record the submodule SHA in $(VSCODE)/apweb-pin.json."

.PHONY: build-intellij
build-intellij: ## Build the IntelliJ/PyCharm plugin zip
	cd $(INTELLIJ) && $(GRADLEW) buildPlugin

# ── test ──────────────────────────────────────────────────────────────────────
.PHONY: test
test: test-vscode test-intellij ## Run all tests

.PHONY: test-vscode
test-vscode: ## Run VS Code unit + integration tests (vitest)
	cd $(VSCODE) && bun run test

.PHONY: test-intellij
test-intellij: ## Run IntelliJ unit + conformance tests (Gradle)
	cd $(INTELLIJ) && $(GRADLEW) test

.PHONY: typecheck
typecheck: ## Type-check the VS Code extension
	cd $(VSCODE) && bun run type-check

# ── package ─────────────────────────────────────────────────────────────────
.PHONY: package
package: package-vscode package-intellij ## Produce both installable artifacts

.PHONY: package-vscode
package-vscode: build-vscode ## Package the VS Code extension (.vsix)
	cd $(VSCODE) && bunx --bun @vscode/vsce package

.PHONY: package-intellij
package-intellij: ## Package the IntelliJ plugin (.zip -> intellij/build/distributions/)
	cd $(INTELLIJ) && $(GRADLEW) buildPlugin

# ── housekeeping ──────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove build outputs + bun lock file (keeps node_modules and the vendored ap-web bundle)
	rm -rf $(VSCODE)/dist $(VSCODE)/*.vsix
	rm -f  $(VSCODE)/bun.lock $(VSCODE)/bun.lockb
	rm -f  $(VSCODE)/media/bootstrap/bootstrap.js $(VSCODE)/media/bootstrap/bootstrap.js.map
	cd $(INTELLIJ) && $(GRADLEW) clean || true

.PHONY: clean-all
clean-all: clean ## Also remove node_modules and the vendored ap-web bundle
	rm -rf $(VSCODE)/node_modules $(VSCODE)/media/apweb
