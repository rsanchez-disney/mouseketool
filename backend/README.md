# Mouseketool — Backend

Node.js + Express 5 + TypeScript API server that acts as the bridge between the frontend and LocalStack (plus Vault
and Docker).

## Running

```bash
npm install
npm run dev      # Development with hot reload (tsx watch)
npm run build    # Compile TypeScript
npm start        # Run compiled output
```

The server starts on `http://localhost:3001`.

## Data Directory

Runtime data is stored in `.data/` (gitignored):

- `settings.json` — LocalStack connection config
- `deployments.json` — Deployed function metadata, last invocation results
- `pipelines.json` — Pipeline definitions and persisted run history
- `builds/` — Cached build artifacts, env vars, diagnostic classes

## Key API Routes

### Builds
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/builds` | List cached builds |
| `POST` | `/api/builds` | Start a build (SSE log stream) |
| `DELETE` | `/api/builds/:id` | Delete a cached build |

### Deployments
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/deployments` | List deployments with Lambda status check |
| `POST` | `/api/deploy` | Deploy artifact to LocalStack |
| `POST` | `/api/deployments/invoke` | Invoke Lambda with env vars, memory, diagnostics |
| `GET` | `/api/deployments/env/:buildId` | Get env vars for a build |
| `DELETE` | `/api/deployments/:name` | Delete deployment and Lambda function |

### Triggers (Pipelines)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/triggers/pipelines` | List all pipelines |
| `POST` | `/api/triggers/wire` | Create pipeline (wire all resources) |
| `DELETE` | `/api/triggers/pipelines/:id` | Delete pipeline and clean up resources |
| `POST` | `/api/triggers/pipelines/:id/execute` | Execute pipeline (SSE step-by-step) |
| `GET` | `/api/triggers/pipelines/:id/history` | Get run history |
| `GET` | `/api/triggers/pipelines/:id/history/live` | Live watch (SSE) |

### Resources
| Method | Path | Description |
|---|---|---|
| `GET/POST` | `/api/dynamodb/*` | DynamoDB table operations |
| `GET/POST` | `/api/sns/*` | SNS topic operations |
| `GET/POST` | `/api/sqs/*` | SQS queue operations |

## Dependencies

- **@aws-sdk/client-*** — AWS SDK v3 clients for Lambda, DynamoDB, SNS, SQS, CloudWatch Logs, S3
- **express** 5 — HTTP framework
- **archiver** — Cross-platform zip creation (avoids WSL dependency)
- **rxjs** — Reactive streams for the pipeline watcher and SSE event coordination
- **uuid** — Pipeline and build ID generation
- **tsx** — TypeScript execution with hot reload for development

[← Back to README](../README.md)
