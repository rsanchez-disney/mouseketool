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
- `batch-projects.json` — Registered batch project metadata
- `batch-presets.json` — Environment variable presets per project
- `batch-runs.json` — Batch run history
- `batch-workflows.json` — Workflow definitions (nodes, edges, env vars)
- `batch-compose/` — Generated effective compose files with port remaps
- `batch-runs/` — Per-run log files

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
| `DELETE` | `/api/triggers/pipelines/:id/history` | Clear completed runs |
| `GET` | `/api/triggers/pipelines/:id/history/live` | Live watch (SSE) |
| `GET` | `/api/triggers/pipelines/:id/learned-items` | Get AI learned items |

### AI
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ai/status` | Check Kiro CLI availability |
| `POST` | `/api/ai/explain` | Explain Lambda error with Kiro |
| `POST` | `/api/ai/generate-payload` | Generate test payload from samples |
| `POST` | `/api/ai/generate-item` | Generate pipeline test item |
| `POST` | `/api/ai/save-generation` | Save a good AI generation as favorite |
| `POST` | `/api/ai/save-feedback` | Save negative feedback on AI generation |

### Batch Builds (Project Registry)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/batch-builds` | List registered batch projects |
| `POST` | `/api/batch-builds` | Register project (auto-scans for Dockerfile and compose files) |
| `PUT` | `/api/batch-builds/:id` | Update project settings (Dockerfile, compose file paths) |
| `DELETE` | `/api/batch-builds/:id` | Remove project from registry |
| `POST` | `/api/batch-builds/:id/rescan` | Re-scan project for Dockerfile and compose files |
| `GET` | `/api/batch-builds/:id/services` | List parsed docker-compose services |
| `GET` | `/api/batch-builds/:id/env-scan` | Scan env vars from compose, .env files |
| `GET` | `/api/batch-builds/:id/file` | Read a file from the project directory |
| `GET` | `/api/batch-builds/:id/presets` | List env var presets for a project |
| `POST` | `/api/batch-builds/:id/presets` | Create env var preset |
| `PUT` | `/api/batch-builds/:id/presets/:presetId` | Update preset (sections, active state) |
| `DELETE` | `/api/batch-builds/:id/presets/:presetId` | Delete preset |
| `GET` | `/api/batch-builds/watch` | SSE stream for file change notifications |

### Batch Runs
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/batch-runs/simple` | Execute docker-compose run (SSE log stream) |
| `POST` | `/api/batch-runs/simple/stop` | Stop running containers |
| `POST` | `/api/batch-runs/simple/teardown` | Tear down containers and clean up |
| `GET` | `/api/batch-runs/effective-config` | Get generated compose file with port remaps |
| `GET` | `/api/batch-runs` | List run history |
| `GET` | `/api/batch-runs/:id/logs` | Get logs for a specific run |
| `DELETE` | `/api/batch-runs` | Clear run history |

### Batch Workflows
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/batch-workflows` | List all workflows |
| `POST` | `/api/batch-workflows` | Create a new workflow |
| `PUT` | `/api/batch-workflows/:id` | Update workflow (nodes, edges, env vars) |
| `DELETE` | `/api/batch-workflows/:id` | Delete a workflow |
| `POST` | `/api/batch-workflows/:id/import` | Import nodes and edges from a compose project |

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
