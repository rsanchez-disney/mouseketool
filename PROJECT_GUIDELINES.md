# Mouseketool — Project Guidelines

## Git Workflow

### Branching
- `main` is the stable branch. All work happens on **feature branches**.
- Feature branches are merged to `main` only after manual verification by the developer.

### Commits
- **Single commit per feature branch** — squash all changes into one commit regardless of the number of files modified.
- This rule applies while the project is in POC stage. Once the project graduates from POC, we will adopt conventional commits with granular history.
- Commit messages should be descriptive: `feat: add vault add-on with secret management` not `update files`.

- The AI assistant (Kiro) must **never** commit or merge unless the developer explicitly says to do so.
- Never assume the developer wants to commit based on phrases like "leave it", "we're done", or "that's it" — wait for an explicit "commit" or "merge" instruction.
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
When a feature is complete:
1. **Wait for the developer to review and approve the feature** before any commits.
2. After feature approval, **commit the code changes** (do not merge yet).
3. **Write documentation updates** to the Help page (`HelpPage.vue`) and any relevant `.md` files (README, docs/, project-highlights, proposed-changes). **Do not use emojis** in any documentation files. **Do not add project structure trees** or "What's new" / changelog sections to README files.
4. **Present a summary** of what was added/changed in the Help page and `.md` files.
5. **Wait for the developer to review and approve the documentation** before committing.
6. **Only after docs approval**, commit the documentation changes as a separate commit.
7. **Only after both commits are on the branch**, merge to main.

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

## Platform Notes (Windows)
## Resource Reconciliation

### Rule
Every AWS resource created by Mouseketool on LocalStack must be recoverable after a LocalStack restart. This applies to all current and future resources: DynamoDB tables, SNS topics, SQS queues, Lambda functions, event source mappings, SNS subscriptions, and any new resource types added later.

### How it works
- On backend startup and whenever LocalStack recovers from being unreachable, `reconcilePipelines()` runs automatically.
- For each pipeline, it verifies every resource exists and recreates any that are missing.
- Connections between resources (ESMs, subscriptions) are re-established with the same configuration.
- Target Lambdas are redeployed from cached builds when available. If the build is deleted, the pipeline is flagged with `targetMissing` and the user must select a new deployment from the edit page.
- DynamoDB tables are restored from saved schemas (`.data/table-schemas/`). Always save the table schema when creating a pipeline.

### When adding new resource types
1. Store enough metadata in the pipeline (or deployment) to fully recreate the resource.
2. Add a check-and-recreate block in `reconcile.ts` for the new resource.
3. If the resource connects to other resources, recreate the connection too.
4. Test by restarting LocalStack and verifying the pipeline still works.



### Shell
- The development environment runs on **Windows with PowerShell** as the default shell.
- Use semicolons (`;`) instead of `&&` to chain commands in PowerShell.
- Docker is installed in WSL, so Docker commands must use `wsl docker`.
- LocalStack and other services on `localhost` are directly reachable from Windows.

### File Editing
- **Never use PowerShell `Set-Content` or `Get-Content | Set-Content` to edit source files.** These commands can corrupt UTF-8 encoding by writing UTF-16 BOM or mangling multi-byte characters (em dashes, arrows, etc.) into mojibake.
- Always use the `write` tool (strReplace, insert, create) for all file modifications.
- PowerShell is acceptable for reading files, running git commands, and executing build tools — just not for writing source files.
