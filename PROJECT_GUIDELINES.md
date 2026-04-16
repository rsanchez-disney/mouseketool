# Mouseketool — Project Guidelines

## Git Workflow

### Branching
- `main` is the stable branch. All work happens on **feature branches**.
- Feature branches are merged to `main` only after manual verification by the developer.

### Commits
- **Single commit per feature branch** — squash all changes into one commit regardless of the number of files modified.
- This rule applies while the project is in POC stage. Once the project graduates from POC, we will adopt conventional commits with granular history.
- Commit messages should be descriptive: `feat: add vault add-on with secret management` not `update files`.

### Commit Authorization
- The AI assistant (Kiro) is **not allowed to commit** unless explicitly told to by the developer.
- The developer must manually verify the app before authorizing a commit.
- Before committing, Kiro must update the version in both `frontend/package.json` and `backend/package.json` using semver.

### Versioning (Semver)
- Both `frontend` and `backend` follow semver independently.
- Current stage: `0.x.y` (pre-stable).
- **Patch** (`0.1.x`): bug fixes, UI tweaks, minor adjustments.
- **Minor** (`0.x.0`): new features, new pages, new add-ons, significant changes.
- `1.0.0` will be set when the project is considered stable and ready for broad team adoption.

### Merge Flow
1. Developer requests changes → Kiro implements on a feature branch.
2. Developer manually tests the app.
3. Developer tells Kiro to commit → Kiro bumps versions + commits.
4. Developer merges feature branch to `main`.

### Documentation on Commit
When a feature is complete and the developer confirms it's ready:
1. **Before committing code**, update the Help page (`HelpPage.vue`) and any relevant `.md` files (README, docs/, project-highlights, proposed-changes) to document the new feature. **Do not use emojis** in any documentation files.
2. **Commit the code changes first** (without the documentation updates).
3. **Present a summary** of what was added/changed in the Help page and `.md` files.
4. **Wait for the developer to review** the documentation changes personally.
5. **Only after approval**, commit the documentation changes as a separate commit on the same branch.

### Branch Completion (Merge to Main)
After all commits (code + docs) are on the feature branch:
1. Scan all new/modified files for sensitive information (tokens, secrets, credentials, API keys). Verify `.gitignore` covers any new generated or data files.
2. `git checkout main && git merge <branch> --no-ff` with a merge commit message.
3. Switch back to the feature branch after merging — do NOT delete it.

## Dependency & Code Quality Standards

### Always Verify Before Using
- Before adding or recommending any dependency, SDK, API pattern, or configuration, **check for the latest version, deprecation notices, and best practices** using web search or documentation tools.
- This applies to: npm packages, AWS SDK clients, LocalStack APIs, Vue/Vite plugins, Tailwind utilities, and any third-party integration.

### Template Lambdas
- Template Lambda source files (in `backend/src/templates/`) must use current, non-deprecated SDK patterns.
- The hash-based versioning system will flag deployed templates as outdated when source changes — but the source itself must be kept current by the developer or AI assistant.
- When updating template code, verify the AWS SDK v3 client constructors, import paths, and configuration patterns are still valid.

### Proactive Checks
- When implementing features that depend on external services (LocalStack, Vault, AWS SDK), verify tier availability and API compatibility.
- If a dependency or pattern is found to be deprecated during implementation, flag it immediately and suggest the replacement.
- Prefer `@aws-sdk/client-*` v3 modular imports over v2 monolithic imports.
