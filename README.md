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
| Create DynamoDB → SNS → SQS → Lambda pipelines | YAML config | ✗ | Visual wizard |
| Template Lambda with hash-based versioning | ✗ | ✗ | ✓ |
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
cached builds, rebuild, or deploy directly to LocalStack.

### [Deployments](docs/deployments.md)
Deploy artifacts to LocalStack, manage environment variables, configure Vault secrets, invoke functions with a
payload editor, and inspect results with root cause extraction and local class diagnostics.

### Triggers (Pipelines)
Create end-to-end event-driven pipelines through a 6-step visual wizard. Wire up DynamoDB tables, SNS topics, SQS
queues (with optional DLQ), and Lambda functions — all without touching the CLI.

### Execution
Run a pipeline and watch each step execute in real-time via Server-Sent Events. See DynamoDB inserts, stream handler
logs, SNS delivery evidence, SQS message arrival, and target Lambda output — all in one view.

### History
Track every pipeline invocation with CloudWatch-based history. Runs are persisted, correlated by RequestId, and
include DLQ detection with diagnostic invoke for failed runs. Live watch mode refreshes silently in the background.

### Settings
Configure the LocalStack connection (protocol, host, port, credentials) and build cleanup TTL.

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
- **Warm container stale logs** — LocalStack reuses Lambda containers. Mouseketool mitigates this by killing warm
  containers before invoke and skipping stale log sources on errors.
- **Java cold start timeouts** — Under CPU contention, Java Lambdas may timeout during initialization. The 2048 MB
  default memory helps, but it can still happen.

## License

Internal tool — not for public distribution.
