---
id: ai-healing
tab: ai
title: Pipeline Self-Healing
icon: RefreshCw
---

When LocalStack restarts, all resources are deleted. Mouseketool detects this and recreates everything from locally persisted metadata.

## How it works

A health monitor polls every 5 seconds. On recovery, a blocking overlay ("Restoring AWS Resources") appears while full reconciliation runs.

## What gets recreated

- **DynamoDB tables** - From saved schemas (or generic pk/sk if none saved).
- **SNS topics & SQS queues** - Same names, DLQ and redrive policies re-established.
- **Stream handler** - Redeployed from template with same env vars.
- **Target Lambda** - Redeployed from cached build. Warning icon if build was deleted.
- **Event source mappings** - DynamoDB->handler and SQS->Lambda with same batch settings.
- **SNS subscriptions** - Same filter policy and scope.

## Vault secrets

Secret values are never stored. After reconciliation, an amber "Secrets need recreation" badge appears - recreate manually via the Vault add-on.
