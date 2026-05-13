APP          := mouseketool
PUB_REPO     := rsanchez-disney/mouseketool
VERSION      ?= $(shell node -p "require('./desktop/package.json').version")
RELEASE_KEY  ?= $(STEER_RELEASE_KEY)
RELEASE_DIR  := desktop/release
BIN_DIR      := bin

.PHONY: build package encrypt release publish clean help

build: ## Build frontend + backend + electron
	cd backend && npm ci && npx tsc
	cd frontend && npm ci && npx vite build
	cd desktop && npm ci
	cd desktop/electron && npm install && npx tsc

package-mac: build ## Package macOS app (dir target for portable install)
	cd desktop && npx electron-builder --mac --dir --config electron-builder.yml
	@echo "✅ macOS app built at $(RELEASE_DIR)/mac-arm64/"

package-win: build ## Package Windows app (portable exe)
	cd desktop && npx electron-builder --win --dir --config electron-builder.yml
	@echo "✅ Windows app built at $(RELEASE_DIR)/win-unpacked/"

encrypt: ## Encrypt release artifacts into .tar.gz.enc
	@test -n "$(RELEASE_KEY)" || { echo "Usage: make encrypt RELEASE_KEY=..."; exit 1; }
	@mkdir -p $(BIN_DIR)
	@# macOS arm64
	@if [ -d "$(RELEASE_DIR)/mac-arm64" ]; then \
		echo "Encrypting macOS arm64..."; \
		tar czf $(BIN_DIR)/$(APP)-darwin-arm64.tar.gz -C "$(RELEASE_DIR)/mac-arm64" .; \
		openssl enc -aes-256-cbc -pbkdf2 -salt \
			-in $(BIN_DIR)/$(APP)-darwin-arm64.tar.gz \
			-out $(BIN_DIR)/$(APP)-darwin-arm64.tar.gz.enc \
			-pass pass:$(RELEASE_KEY); \
		rm $(BIN_DIR)/$(APP)-darwin-arm64.tar.gz; \
		echo "  ✅ $(APP)-darwin-arm64.tar.gz.enc"; \
	fi
	@# macOS x64
	@if [ -d "$(RELEASE_DIR)/mac-x64" ]; then \
		echo "Encrypting macOS x64..."; \
		tar czf $(BIN_DIR)/$(APP)-darwin-amd64.tar.gz -C "$(RELEASE_DIR)/mac-x64" .; \
		openssl enc -aes-256-cbc -pbkdf2 -salt \
			-in $(BIN_DIR)/$(APP)-darwin-amd64.tar.gz \
			-out $(BIN_DIR)/$(APP)-darwin-amd64.tar.gz.enc \
			-pass pass:$(RELEASE_KEY); \
		rm $(BIN_DIR)/$(APP)-darwin-amd64.tar.gz; \
		echo "  ✅ $(APP)-darwin-amd64.tar.gz.enc"; \
	fi
	@# Windows
	@if [ -d "$(RELEASE_DIR)/win-unpacked" ]; then \
		echo "Encrypting Windows..."; \
		tar czf $(BIN_DIR)/$(APP)-windows-amd64.tar.gz -C "$(RELEASE_DIR)/win-unpacked" .; \
		openssl enc -aes-256-cbc -pbkdf2 -salt \
			-in $(BIN_DIR)/$(APP)-windows-amd64.tar.gz \
			-out $(BIN_DIR)/$(APP)-windows-amd64.tar.gz.enc \
			-pass pass:$(RELEASE_KEY); \
		rm $(BIN_DIR)/$(APP)-windows-amd64.tar.gz; \
		echo "  ✅ $(APP)-windows-amd64.tar.gz.enc"; \
	fi

release: package-mac encrypt ## Build + encrypt macOS (local)
	@echo "✅ Release artifacts ready in $(BIN_DIR)/"

publish: ## Tag + publish encrypted artifacts to public repo (make publish TAG=v1.0.1)
	@test -n "$(TAG)" || { echo "Usage: make publish TAG=v1.0.1"; exit 1; }
	@test -n "$(RELEASE_KEY)" || { echo "STEER_RELEASE_KEY required"; exit 1; }
	@which gh > /dev/null 2>&1 || { echo "Install GitHub CLI: brew install gh"; exit 1; }
	@test -d "$(BIN_DIR)" || { echo "Run 'make release' first"; exit 1; }
	git tag -a $(TAG) -m "Release $(TAG)" 2>/dev/null || true
	git push origin $(TAG) 2>/dev/null || true
	git push public $(TAG)
	GH_HOST=github.com gh release create $(TAG) \
		$$(ls $(BIN_DIR)/*.enc 2>/dev/null) \
		--latest --repo $(PUB_REPO) \
		--title "Mouseketool $(TAG)" \
		--generate-notes
	@echo "✅ Published $(TAG) to github.com/$(PUB_REPO)"

publish-all: ## Auto-detect changes, version bump, build + publish
	@LAST=$$(git tag --sort=-v:refname | head -1); \
	COMMITS=$$(git log $${LAST:-HEAD~999}..HEAD --oneline 2>/dev/null | wc -l | tr -d ' '); \
	if [ "$$COMMITS" -gt 0 ]; then \
		NEXT="v$(VERSION)"; \
		echo "$(APP): $$COMMITS commits since $${LAST:-none} → $$NEXT"; \
		$(MAKE) release RELEASE_KEY=$(RELEASE_KEY); \
		$(MAKE) publish TAG=$$NEXT RELEASE_KEY=$(RELEASE_KEY); \
	else \
		echo "$(APP): up to date ($${LAST})"; \
	fi

clean: ## Remove build artifacts
	rm -rf $(BIN_DIR) $(RELEASE_DIR)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
