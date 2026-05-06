---
id: lw-invoke
tab: lambda
title: Invoking Functions
icon: Zap
---

Click **Invoke** on a deployment card to open the Add-on Settings screen, then continue to the invoke panel.

## Environment variables

Env vars are applied before each invocation via `UpdateFunctionConfiguration`. Use the **Exclude** checkbox to temporarily remove a var without deleting it.

## Payload

The editor accepts any valid JSON. Upload from disk or press `Ctrl+Enter` to invoke directly. For SQS-triggered Lambdas:

```json
{
  "Records": [
    {
      "body": "{\"key\": \"value\"}"
    }
  ]
}
```

## Understanding results

- **Root Cause panel** - Extracts all `Caused by` lines from logs.
- **Diagnostics** - Lists env vars pointing to unreachable services, checks handler class in jar.
- **Local Class Diagnostic** - Runs the class locally to capture the full stack trace when `ExceptionInInitializerError` occurs.

## Debug mode & Re-invoke

**Debug Invoke** runs with extra JVM flags for detailed traces. The **Re-invoke** button re-runs with the last payload without opening the invoke panel.
