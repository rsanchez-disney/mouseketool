---
id: pl-exec
tab: pipelines
title: Running Pipelines
icon: Bell
group: Usage
order: 2
---

Click **Execute** on a pipeline card to watch each step run in real-time via SSE.

## Execution steps

- **DynamoDB Insert** - Inserts test item, purges queues, deletes log groups for clean slate.
- **Stream Handler** - Polls CloudWatch for stream handler logs.
- **SNS Publish** - Inferred from SQS evidence (SNS doesn't produce logs).
- **SQS Deliver** - Checks queue attributes and DLQ.
- **Target Lambda** - Polls CloudWatch. If no logs appear, performs a diagnostic invoke.

Use **Stop** to abort at any time. If a step times out, it may be LocalStack's ESM pollers being slow - try again or check History.
