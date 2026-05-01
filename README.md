# Mouseketool

A developer workbench for building, deploying, and testing Java Lambda functions on LocalStack — all from a single
web UI. It also lets you create and observe full event-driven pipelines (DynamoDB → SNS → SQS → Lambda) with
step-by-step execution tracking and invocation history.

## Why Mouseketool?

If you work on Java Lambda microservices and test locally against LocalStack, you've probably experienced the pain of
jumping between 4-5 different tools just to build, deploy, configure, and invoke a single function. Mouseketool
consolidates that entire workflow into one place.

| Capability | Serverless/SAM | LocalStack UI | Mouseketool |
|---|---|---|---|
| Build Java project with live console | ✗ | ✗ | ✓ |
| Deploy to LocalStack | ✓ | ✗ | ✓ |
| Invoke Lambda with payload editor | CLI only | ✓ | ✓ |
| Env var management per build | ✗ | ✗ | ✓ |
| Auto-carry env vars on rebuild | ✗ | ✗ | ✓ |
| Exclude env vars without deleting them | ✗ | ✗ | ✓ |
| Configurable Lambda memory per invocation | ✗ | ✗ | ✓ |
| Vault secret setup in invoke flow | ✗ | ✗ | ✓ |
| Debug mode (JVM flags on the fly) | ✗ | ✗ | ✓ |
| Root cause extraction from error logs | ✗ | ✗ | ✓ |
| SNS filter policies on subscriptions | YAML config | ✗ | Visual wizard |
| Create DynamoDB → SNS → SQS → Lambda pipelines | YAML config | ✗ | Visual wizard |
| Shadow infrastructure for diagnostic replay | ✗ | ✗ | ✓ |
| AI error explanation from stack traces | ✗ | ✗ | ✓ (Kiro) |
| AI payload generation from samples | ✗ | ✗ | ✓ (Kiro) |
| Pipeline self-healing after LocalStack restart | ✗ | ✗ | ✓ |
| Docker-compose batch execution | ✗ | ✗ | ✓ |
| Port conflict auto-detection and remapping | ✗ | ✗ | ✓ |
| Env var presets for batch runs | ✗ | ✗ | ✓ |
| Visual workflow editor for batch jobs | ✗ | ✗ | ✓ |
| Full build → deploy → configure → wire → test loop | Across 4-5 tools | Partial | Single UI |

## Prerequisites

Before running Mouseketool, make sure you have the following installed:

- **Node.js** 20.19+ or 22.12+ — required for both the frontend and backend
- **Docker** — required for LocalStack and any supporting containers (Vault, Mockoon, etc.)
- **LocalStack** — the free Community Edition works. Mouseketool has been tested with LocalStack 3.x running in Docker.
- **JDK 21** — required on the host machine for building Java Lambda projects and for the local class diagnostic feature
- **Maven or Gradle** — whichever your Java project uses, it must be available on your `PATH`

## Getting Started

### Step 1: Clone and install dependencies

```bash
git clone <repository-url>
cd mouseketool

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Step 2: Start the backend

```bash
cd backend
npm run dev
```

The backend starts on `http://localhost:3001` by default. It connects to LocalStack using the settings you configure
in the app (default: `http://localhost:4566`).

### Step 3: Start the frontend

```bash
cd frontend
npm run dev
```

The frontend starts on `http://localhost:5173` and proxies API requests to the backend.

### Step 4: Configure LocalStack connection

Open the app in your browser and go to **Settings**. Verify the protocol, host, and port match your LocalStack
instance. The default credentials (`test/test`) work fine — LocalStack accepts any value.

## Features

Mouseketool is organized into several pages, each focused on a specific part of the development workflow:

### [Builder](docs/builder.md)
Build Java Lambda projects with a live streaming console. Supports Maven and Gradle with auto-detection. Manage
cached builds, rebuild, or deploy directly to LocalStack. Each cached build shows a TTL indicator based on the
cleanup interval configured in Settings.

### [Deployments](docs/deployments.md)
Deploy artifacts to LocalStack, manage environment variables, configure Vault secrets, invoke functions with a
payload editor, and inspect results with root cause extraction and local class diagnostics. AI-powered payload
generation creates test payloads from sample files and handler source code. Vault configuration syncs automatically
to pipelines using the same Lambda. A deploy override modal
lets you confirm or skip redeployment, with a preference to remember your choice.

### Triggers (Pipelines)
Create event-driven pipelines through a visual wizard. Three pipeline types are supported:
- **APP Pipeline** (DynamoDB -> SNS -> SQS -> Lambda): Full event-driven chain with stream handler, SNS filter policies, and SQS delivery.
- **Direct Stream Processor** (DynamoDB -> Lambda): DynamoDB stream triggers a Lambda directly.
- **Queue Consumer** (SQS -> Lambda): SQS queue triggers a Lambda function.

Each pipeline type has per-pipeline shadow infrastructure that captures events to a shared S3 bucket for
observation, diagnostic replay, and filter detection. Shadow Lambdas are deployed automatically at wire time
and reconciled on LocalStack restart. A dedicated pipeline edit page lets you modify filter policies, toggle
heavy load mode, configure vault add-ons, manage env vars, and inspect each resource metadata. Table schemas
can be saved and restored after LocalStack restarts.

### Execution
Run a pipeline and watch each step execute in real-time via Server-Sent Events. The execute page validates
payloads (must be non-empty JSON), blocks execution when heavy load mode is active, and shows step-by-step
progress. Diagnostic invoke runs automatically when the target Lambda fails to produce CloudWatch logs,
providing the same detailed error output as the Deployments page.

### History
Track every pipeline invocation with real-time WebSocket updates. Runs are detected via S3 shadow captures
(for Direct Stream and Queue Consumer) or CloudWatch logs (for APP Pipeline stream handler). Each run shows
step-by-step status with expandable logs. Filter runs by status (success/error/filtered/diagnosing), time
range, or source (manual/external). History retention is configurable by age or amount in Settings.
Diagnostic invoke with container kill provides full error details when Lambdas fail during initialization.

### Settings
Configure the LocalStack connection (protocol, host, port, credentials), build cleanup TTL,
Lambda memory, heavy load batch settings (batch size and window), and history retention (by age or
amount). Changes to heavy load settings are applied retroactively to all pipelines with heavy load
runs on startup and is accessible from the Settings page. AI learned data storage (local or S3) is configurable.
Pipeline self-healing automatically recreates resources after LocalStack restarts.

### Batch Projects
Register Docker-based projects with auto-detection of Dockerfiles and compose files. Manage multiple
compose file variants per project, edit detected paths, and receive live file change notifications
via a background watcher. Environment variables are scanned from compose files and .env files.

### Launchpad
Run docker-compose projects directly from the UI with automatic port conflict detection and remapping.
Create and manage environment variable presets to customize runs without modifying source files. The
Workflow tab provides a visual canvas for building job dependency graphs with per-node configuration,
common env vars, and import from existing compose services. Compose Studio offers an AI-powered
compose builder with a Monaco editor and structured actions (Generate, Add Batch Project, Add Service,
Add Healthchecks). Workflows can be executed in foreground docker compose mode with per-node status
tracking. Imported workflows auto-register batch projects from their compose files. The canvas includes
an infrastructure services panel for managing supporting containers. Workflows support search, filters,
and completion state tracking.

### Help & Guides
In-app documentation covering every feature with detailed explanations, code examples, and troubleshooting tips.

## Keyboard Shortcuts

| Shortcut | Action | Where |
|---|---|---|
| `Ctrl+Enter` | Invoke the selected Lambda | Deployments page |
| `Escape` | Close expanded log modal | All pages |

## Tech Stack

- **Frontend**: Vue 3 + TypeScript, Tailwind CSS 4, shadcn-vue (Reka UI), Lucide icons
- **Backend**: Node.js + Express 5 + TypeScript, AWS SDK v3
- **Infrastructure**: LocalStack (Lambda, DynamoDB, DynamoDB Streams, SNS, SQS, CloudWatch Logs, S3), HashiCorp Vault
- **Target**: Java Lambda functions (Maven/Gradle, JDK 21)

## Known Limitations

These are LocalStack-specific behaviors that don't affect real AWS deployments:

- **DynamoDB Stream batch window** — `MaximumBatchingWindowInSeconds` is accepted but not reliably honored. Records
  may arrive individually instead of batched.
- **Event source mapping polling delays** — ESM pollers can be slow (30s–2min+) or stop polling after the initial
  invocation. Restarting LocalStack resets them.
- **Diagnostic invoke for target Lambda** — The observer uses a diagnostic invoke (direct Lambda invocation with
  the captured SQS/DynamoDB event) instead of waiting for LocalStack ESM polling. This provides faster and more
  reliable results. A warm container warning appears when INIT logs are not available.
- **Warm container stale logs** — LocalStack reuses Lambda containers. Mouseketool mitigates this by killing warm
  containers before invoke and skipping stale log sources on errors.
- **Java cold start timeouts** — Under CPU contention, Java Lambdas may timeout during initialization. The 2048 MB
  default memory helps, but it can still happen.

## License

Internal tool — not for public distribution.
