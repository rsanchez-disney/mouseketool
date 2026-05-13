# Mouseketool v1.0 — Slide Deck Content

---

## Slide 1 — Title

Mouseketool
Developer Workbench v1.0

"The local AWS companion every Disney backend developer deserves."

---

## Slide 2 — What is it

One desktop app that replaces your terminal tabs.

Three core capabilities:
- Lambda lifecycle
- Event pipelines
- Batch orchestration

AI-assisted where it matters. Visual where it helps. Keyboard-first when you're in the zone.

---

## Slide 3 — Getting Started

Download the .exe, double-click, done. No Node.js setup.

Point it at your LocalStack instance (Settings > Connection).

Managed mode: Mouseketool starts/stops LocalStack for you via Docker.

---

## Slide 4 — Build & Deploy

Browse to your Java project. Mouseketool finds the handler.

Live streaming console — Maven/Gradle output in real-time.

Build completes → cached with TTL → deploy to LocalStack in one click.

Env vars auto-detected from SAM templates and .env files. Carried across rebuilds.

---

## Slide 5 — Invoke & Debug

JSON payload editor with Ctrl+Enter invoke.

Env vars applied per-invocation. Exclude without deleting.

Root cause panel extracts Caused-by chains automatically.

Local class diagnostic runs your handler on your machine when ExceptionInInitializerError hits.

Debug mode injects JVM flags on demand.

---

## Slide 6 — Create Pipelines

Visual wizard: DynamoDB → SNS → SQS → Lambda (APP Pipeline)

Also: Direct Stream (DynamoDB → Lambda) and Queue Consumer (SQS → Lambda)

SNS filter policies: 9 operators, visual editor, AND logic.

Resources validated — "In use" badges prevent conflicts.

---

## Slide 7 — Execute & Observe

Click Execute. Watch each step complete via real-time SSE.

Full invocation history — every run tracked with step-by-step logs.

DLQ detection: if messages land in the dead letter queue, diagnostic invoke captures the error.

Self-healing: restart LocalStack and everything recreates itself. Zero manual setup.

---

## Slide 8 — Batch: Simple Run

Register a Docker project. Mouseketool detects compose files and Dockerfiles.

One click to run. Port conflicts? Auto-remapped.

Rebuild image toggle: Maven → Docker build → Compose up in sequence.

Batch container exits → everything tears down automatically.

---

## Slide 9 — Batch: Workflows

Visual canvas — drag nodes, connect dependencies, configure per-job.

Import from existing compose files — depends_on becomes edges.

Compose Studio: describe what you want in English, AI generates the compose file.

Stop at any phase — Maven, Docker build, or compose. Immediate kill.

Log isolation: switching workflows never leaks logs from another run.

---

## Slide 10 — Profiles

Define a team profile: which Lambda projects, which batch projects.

Load it: scans workspace, clones missing repos, builds 3 in parallel, deploys all.

Clean slate every time — wipes existing resources before provisioning.

New team member onboarding: minutes instead of hours.

---

## Slide 11 — AI & Extras

Kiro AI: error explanation, payload generation, pipeline item generation, learning from success.

Command palette (Ctrl + .): fuzzy search to any page or action.

Dark/light theme with animation toggle.

About tab: version display, update check from GitHub Releases.

In-app help: markdown-driven, searchable, always up to date.

---

## Slide 12 — Outro

github.disney.com/manjm010/mouseketool

Coming soon: S3 add-on, pipeline from diagram, PR-triggered rebuild, branch switching.

Questions?
