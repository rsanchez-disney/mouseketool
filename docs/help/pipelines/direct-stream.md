---
id: pt-direct
tab: pipelines
title: Direct Stream Processor
icon: Zap
group: Types
order: 5
---

<!-- diagram:direct-stream -->

The simplest pipeline type. A DynamoDB Stream triggers your Lambda function directly via an event source mapping - no intermediary services. Best for cases where you don't need fan-out, filtering, or retry queues.

## When to use

Use Direct Stream when your Lambda is the only consumer of the table's change events and you want the lowest latency path from write to invocation.
