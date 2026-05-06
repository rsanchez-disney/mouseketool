# Contributing to Mouseketool

Thanks for wanting to make Mouseketool better. Here's how to get your changes in.

---

## Before You Start

1. Read `docs/PROJECT_GUIDELINES.md` for git workflow, versioning, and commit rules.
2. If touching frontend code, read `docs/DESIGN_GUIDELINES.md` and `docs/UI_DESIGN_PATTERNS.md`.
3. Make sure you can run the app locally (backend + frontend) and that existing tests pass.

---

## Workflow

### 1. Create a feature branch

```bash
git checkout main
git pull
git checkout -b feature/your-feature-name
```

### 2. Make your changes

- Keep commits focused. One feature or fix per branch.
- Follow existing code style and patterns — don't introduce new libraries or conventions without discussion.
- If you add a user-facing feature, add a corresponding `.md` file in `docs/help/` with proper frontmatter.

### 3. Verify

- Run the backend: `cd backend && npm run dev`
- Run the frontend: `cd frontend && npm run dev`
- Run tests: `cd playwright-tests && npx playwright test`
- Build both to catch type errors: `cd backend && npx tsc --noEmit` and `cd frontend && npx vite build`

### 4. Bump the version

All four `package.json` files (backend, frontend, desktop, playwright-tests) must share the same version. Bump according to semver:
- Patch for bug fixes and tweaks
- Minor for new features

### 5. Open a PR

- Target branch: `main`
- Title: concise, under 70 characters (e.g., "Add S3 bucket add-on for Lambda invocations")
- Description should include:
  - **What** — brief summary of the change
  - **Why** — motivation or issue being solved
  - **How to test** — steps to verify the feature works
  - **Screenshots** — if the change is visual

### 6. Review

- The maintainer will review and may request changes.
- Address feedback with additional commits (no need to squash during review).
- Once approved, the maintainer merges with `--no-ff`.

---

## What Makes a Good PR

- Solves one thing well
- Doesn't break existing features (tests pass)
- Follows the UI patterns and project guidelines
- Includes documentation for user-facing changes
- No secrets, no hardcoded paths, no platform-specific assumptions

---

## Questions?

Open an issue or reach out to the maintainer directly. We'd rather answer a question upfront than review a PR that went in the wrong direction.
