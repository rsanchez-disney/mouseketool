---
id: pt-queue
tab: pipelines
title: Queue Consumer
icon: Inbox
group: Types
order: 6
---

<!-- diagram:queue-consumer -->

An SQS queue triggers your Lambda function. Best for testing Lambdas that consume messages from a queue - common in decoupled microservice architectures where upstream services publish to SQS.

## When to use

Use Queue Consumer when your Lambda already expects SQS event payloads and you want to test it by sending messages directly to a queue.
