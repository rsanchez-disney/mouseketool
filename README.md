<p align="center">
  <img src="docs/banner.svg" alt="Mouseketool" width="600" />
</p>

<p align="center">
  <strong>The developer workbench that makes LocalStack feel like home.</strong><br/>
  Build, deploy, and invoke Lambdas. Create event pipelines. Orchestrate batch workflows. AI-assisted — all from one UI.
</p>

<p align="center">
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-features">Features</a> •
  <a href="#-how-it-compares">Comparison</a> •
  <a href="#-ai-powered">AI</a> •
  <a href="#-coming-soon">Coming Soon</a>
</p>

---

## Why Mouseketool?

If you work on Java Lambda microservices and test locally against LocalStack, you know the pain. Build the JAR. Deploy it. Configure env vars. Set up DynamoDB tables. Wire SNS topics. Create SQS queues. Map event sources. Invoke. Read logs. Fix. Repeat.

That's 4-5 different tools, a dozen terminal tabs, and a lot of context switching — just to test one function.

**Mouseketool was built to fix that.** It's a single desktop application that consolidates the entire local development loop into a visual, interactive experience. The goal: become the complementary tool for every backend developer working at Disney, offering capabilities that aid them run projects and visualize resources much more efficiently than a CLI ever could.

---

## 🚀 Getting Started

### Desktop App (Recommended)

Download the latest installer from [GitHub Releases](https://github.disney.com/manjm010/mouseketool/releases):

| Platform | File | Notes |
|---|---|---|
| Windows | `mouseketool_v<version>.exe` | NSIS installer |
| macOS | `mouseketool_v<version>.dmg` | Universal binary (Intel + Apple Silicon) |

The app bundles everything — just install and run. No Node.js setup required.

### From Source

```bash
git clone https://github.disney.com/manjm010/mouseketool.git
cd mouseketool

# Backend
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`, configure your LocalStack connection in Settings, and you're ready.

### Prerequisites

- **Docker** — for LocalStack and supporting containers
- **LocalStack 3.x** — Community Edition works perfectly
- **JDK 21** — for building Java Lambda projects
- **Maven or Gradle** — whichever your project uses

---

## ✨ Features

### Lambda Workflow

The full build-deploy-configure-invoke loop in one flow:

- **Live build console** — Stream Maven/Gradle output in real-time with auto-scroll, search, and copy
- **One-click deploy** — Push artifacts to LocalStack with automatic memory configuration
- **Unified env vars** — Detected from SAM templates, `.env` files, and README sections. Carried across rebuilds automatically
- **Payload editor** — JSON editor with file upload, `Ctrl+Enter` invoke, and AI-generated test payloads
- **Root cause extraction** — Automatically pulls `Caused by` chains from stack traces
- **Local class diagnostic** — Runs your handler class locally when `ExceptionInInitializerError` occurs to capture the full trace
- **Debug mode** — Injects JVM flags for verbose class-loading and exception traces on demand

### Event-Driven Pipelines

Create and observe full AWS event pipelines through a visual wizard:

- **APP Pipeline** — DynamoDB → Stream Handler → SNS → SQS → Lambda (with filter policies)
- **Direct Stream** — DynamoDB → Lambda (minimal, lowest latency)
- **Queue Consumer** — SQS → Lambda (decoupled microservices)

Each pipeline includes:
- **Self-healing** — Automatically recreates all resources after LocalStack restarts. No manual setup, ever.
- **Real-time execution** — Watch each step complete via Server-Sent Events
- **Invocation history** — Every run tracked with step-by-step logs, DLQ detection, and diagnostic invoke
- **SNS filter policies** — 9 operator types with visual configuration

### Batch Jobs & Workflows

Run Docker Compose projects with superpowers:

- **Visual workflow editor** — Drag-and-drop canvas for building job dependency graphs
- **Compose Studio** — AI-powered compose file builder with Generate, Add Service, and Evaluate actions
- **Port conflict detection** — Automatically remaps conflicting ports before starting
- **Image rebuild pipeline** — Maven build → Docker image → Compose up, all in one click
- **Log isolation** — Each workflow run gets a unique ID. Switching workflows never leaks logs.
- **Container watchdog** — Orphaned containers are automatically killed when no workflow is running
- **Auto-teardown** — When your batch container exits, everything else stops cleanly

### Profiles

Load entire team environments with one click:

- **Workspace scanning** — Detects Lambda and batch projects in a directory
- **Auto-provisioning** — Clones missing repos, builds in parallel (3 concurrent), deploys, and registers
- **Clean slate** — Loading a profile wipes all existing resources for a fresh start
- **Handler detection** — Finds `RequestHandler` implementations in Java source automatically

### Command Palette

Press `Ctrl + .` anywhere to open a fuzzy-search command palette. Navigate to any page, trigger any action — keyboard-first workflow for power users.

---

## 📊 How It Compares

Mouseketool isn't trying to replace SAM or Serverless — those are deployment frameworks. Mouseketool is the **development companion** that sits alongside them, focused on the local iteration loop.

| Capability | SAM CLI | Serverless | LocalStack UI | Mouseketool |
|---|---|---|---|---|
| Build with live streaming console | ✗ | ✗ | ✗ | ✓ |
| Deploy to LocalStack | ✓ (via sam local) | ✓ (via plugin) | ✗ | ✓ |
| Invoke with payload editor | CLI only | CLI only | Basic | Full editor + history |
| Env var management per function | YAML config | YAML config | ✗ | Visual UI + auto-detect |
| Carry env vars across rebuilds | ✗ | ✗ | ✗ | ✓ (automatic) |
| Exclude env vars without deleting | ✗ | ✗ | ✗ | ✓ |
| Root cause extraction from logs | ✗ | ✗ | ✗ | ✓ (automatic) |
| Create event pipelines visually | ✗ | ✗ | ✗ | ✓ (3 types) |
| Pipeline execution tracking | ✗ | ✗ | ✗ | ✓ (real-time SSE) |
| Invocation history with replay | ✗ | ✗ | ✗ | ✓ |
| Self-healing after restart | ✗ | ✗ | ✗ | ✓ (automatic) |
| SNS filter policy editor | YAML | YAML | ✗ | Visual (9 operators) |
| Docker Compose orchestration | ✗ | ✗ | ✗ | ✓ |
| Visual workflow editor | ✗ | ✗ | ✗ | ✓ |
| AI-powered error explanation | ✗ | ✗ | ✗ | ✓ |
| AI payload generation | ✗ | ✗ | ✗ | ✓ |
| Profile-based team environments | ✗ | ✗ | ✗ | ✓ |

The key difference: SAM and Serverless require you to define everything in YAML and work through the terminal. Mouseketool gives you the same capabilities through a visual interface with real-time feedback, plus features that simply don't exist in CLI tools — like pipeline observation, invocation history, and self-healing infrastructure.

---

## 🤖 AI-Powered

Mouseketool integrates with [Kiro CLI](https://kiro.dev) to bring AI assistance directly into your development workflow:

- **Error Explanation** — When a Lambda fails, send the stack trace to Kiro for a plain-English explanation and fix suggestion
- **Payload Generation** — Generate realistic test payloads from your handler source code and sample files. Supports Successful, Filtered, and Failure variants
- **Pipeline Item Generation** — Create DynamoDB items that match your pipeline's expected input, respecting key schemas and filter policies
- **Learning** — Kiro learns from successful executions (up to 50 items per pipeline) and improves payload quality over time
- **Compose Studio** — Generate entire docker-compose files from natural language prompts, add services, inject healthchecks, and evaluate configurations for issues

AI features are optional and gated behind Kiro CLI availability. When detected, a purple badge appears in the navigation bar.

---

## 🔮 Coming Soon

Features actively planned for upcoming releases:

| Feature | Description |
|---|---|
| **S3 Buckets Add-on** | Declare bucket dependencies per Lambda. Auto-create and seed with files before invocation |
| **Pipeline from Diagram** | Paste an architecture diagram and let AI create the pipeline configuration |
| **PR-Triggered Rebuild** | Detect merged PRs in profile repos and prompt to pull & rebuild |
| **Branch Switching** | Switch git branches and rebuild directly from the Projects page |
| **Env Var Diff from PRs** | Detect new env vars added in merged PRs and offer to add them |
| **Build Progress Estimation** | Show estimated time remaining based on historical build durations |
| **Export Pipeline as Diagram** | Generate shareable PNG/SVG with official AWS architecture icons |

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + .` | Open command palette |
| `Ctrl + Enter` | Invoke Lambda (Deployments page) |
| `Escape` | Close expanded log viewer or modal |

---

## 🐛 Known Limitations

These are LocalStack-specific behaviors that don't affect real AWS deployments:

- **DynamoDB Stream batch window** — `MaximumBatchingWindowInSeconds` is accepted but not reliably honored
- **Event source mapping delays** — ESM pollers can be slow (30s-2min+). Mouseketool uses diagnostic invoke as a workaround
- **Warm container stale logs** — Mitigated by killing warm containers before invoke
- **Java cold start timeouts** — Under CPU contention, Java Lambdas may timeout. The 2048 MB default helps

---

## 🧪 Testing

```bash
cd playwright-tests

# Fast tests (mocked backend, runs in seconds)
npx playwright test

# Integration tests (spins up isolated LocalStack + backend)
npx playwright test --config=playwright.integration.config.ts
```

Integration tests are fully isolated — they start their own LocalStack (port 4577) and backend (port 3099) with a temporary data directory. They never interfere with a running Mouseketool instance.

---

## 📄 License

Internal tool — not for public distribution.
