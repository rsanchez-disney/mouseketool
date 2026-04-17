# Deployments

The Deployments page is where you manage your deployed Lambda functions on LocalStack. From here you can deploy new
artifacts, configure environment variables, set up Vault secrets, invoke functions, and inspect results — all in one
flow.

## Deploying to LocalStack

After a successful build, click **Deploy to LocalStack** from the cached build card on the Builder page, or navigate
to the Deployments page directly. Make sure LocalStack is running and the connection settings are correct (check the
Settings page).

If the function already exists on LocalStack, the deploy updates it with the new code — no need to delete and
recreate. A toast notification confirms whether the deploy succeeded or failed.

### Deploy override modal

When redeploying a function that already exists, a confirmation modal appears. You can choose to proceed with the
deploy or skip it. The **Remember my choice** option saves your preference so the modal does not appear on future
deploys. Reset this preference from the Settings page.

### WSL Docker container cleanup

On deploy, Mouseketool automatically kills any warm Lambda Docker containers associated with the function. This
prevents stale containers from serving outdated code, which is especially relevant in WSL environments where
container lifecycle is less predictable.

### Memory configuration

Java Lambdas on LocalStack need more memory than you might expect due to cold start overhead. Mouseketool defaults to
**2048 MB** which works well for most Java projects. You can change this per-function using the **Memory** dropdown in
the invoke panel — it lets you pick a value (128 MB – 3008 MB) before each invocation.

## Deployment Status

Every time you open the page, Mouseketool checks each function against LocalStack. The result is shown as a colored
badge on each card:

| Badge | Meaning |
|---|---|
| **active** (green) | Function exists and is ready to be invoked |
| **failed** (red) | Function exists but is in a failed state |
| **unknown** (yellow) | Couldn't reach LocalStack within 3 seconds |
| **deleted** (gray) | Function was removed from LocalStack |

Click the **Refresh** button in the top-right corner to re-check at any time.

## Search

If you have many deployments, use the search bar at the top of the list to filter them. It matches against both the
function name (the card title) and the handler class (shown below the title).

## Invoking Functions

Click the **Invoke** button on any deployment card. This opens the Add-on Settings screen where you can configure
optional tools like Vault, then continue to the invoke panel.

### Environment variables

Env vars are configured directly in the invoke panel. Before each invocation, Mouseketool calls
`UpdateFunctionConfiguration` to apply your current env vars to the Lambda function. This means you can change a Vault
path, toggle a feature flag, or point to a different service URL and invoke again immediately.

To temporarily remove an env var without deleting it, check the **Exclude** checkbox next to it. Excluded vars are
kept in the UI but not sent to the Lambda configuration. The value is preserved — uncheck it anytime to bring it back.

### Payload

The payload editor accepts any valid JSON. For SQS-triggered Lambdas, use the standard SQS event format:

```json
{
  "Records": [
    {
      "body": "{\"key\": \"value\"}"
    }
  ]
}
```

You can also click the **Upload** button to load a JSON file from disk, or press `Ctrl+Enter` to invoke directly from
the editor.

### Understanding the results

After invoking, the response panel shows the status code, function output, and any errors. If the Lambda failed,
Mouseketool does several things automatically:

- **Root Cause panel** — Extracts all `Caused by` lines from the logs and surfaces them at the top of the results
  view. The panel is collapsible and highlighted in red so root causes are immediately visible without scrolling
  through the full log output.
- **Diagnostics** — Lists env vars pointing to potentially unreachable services and checks if the handler class exists
  in the jar.
- **Local Class Diagnostic** — When the error is an `ExceptionInInitializerError` (class crashed during static
  initialization, often produces no CloudWatch logs), Mouseketool runs the class locally on the backend to capture the
  full stack trace. This usually shows you exactly which dependency failed to initialize and why.

### Debug mode

The **Debug Invoke** button runs the Lambda with extra JVM flags (`-verbose:class -Xlog:exceptions=info`) that produce
detailed class-loading and exception traces. These flags are automatically cleaned up after the invoke.

### Re-invoke

After invoking once, the **Re-invoke** button becomes available on the deployment card. It re-runs the function
with the last payload without opening the invoke panel.

## Add-ons

### Vault

The Vault add-on creates secrets in a HashiCorp Vault instance before invocation. To set it up:

1. Enter the **Vault URL** and **Root Token**, then click **Test Connection** to verify.
2. Add secret paths with key-value entries.
3. Secrets that already exist in Vault are **skipped** (not overwritten).
4. When **auto-cleanup** is enabled, created secrets are deleted after invocation. Pre-existing secrets are never
   deleted.

### Docker networking

Lambda functions run inside Docker containers managed by LocalStack. Services on your host machine are **not reachable
via `localhost`** from inside the container:

- Use `host.docker.internal` to reach host services (e.g. `http://host.docker.internal:8200` for Vault).
- If services run in Docker on the same network, use their container hostname (e.g. `http://vault:8200`).
- Set `LAMBDA_DOCKER_NETWORK` in your LocalStack docker-compose to put Lambda containers on the same network.

## Log Console

The Deployments page log console follows the same pattern as all other pages:

- **Inline** — Compact scrollable panel with Copy and Expand buttons.
- **Expanded** — Full-screen modal with search bar, scroll-to-bottom, copy, and minimize.
- **Color coding** — Red for errors/exceptions, yellow for warnings, blue for section headers.
- **Search** — Click the magnifying glass icon to filter logs. Non-matching lines dim to 20% opacity.

[← Back to README](../README.md)
