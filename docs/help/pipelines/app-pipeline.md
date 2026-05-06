---
id: pt-app
tab: pipelines
title: APP Pipeline
icon: Database
group: Types
order: 4
---

<!-- diagram:app-pipeline -->

The full event-driven chain that mirrors real AWS architecture. A DynamoDB Stream event triggers a lightweight Node.js Stream Handler (auto-generated) that unmarshalls the record and publishes to SNS. SNS fans out to SQS with optional filter policies, and SQS triggers your target Lambda.

## The wizard

A 6-step process: Source -> DynamoDB -> SNS -> SQS -> Lambdas -> Add-ons. Resources already in use show an "In use" badge. DLQ is optional with configurable `maxReceiveCount`.

## SNS Filter Policies

9 operator types: string exact, prefix, anything-but, suffix, wildcard, number exact, number range, key exists/not exists. Filter scope: Message body or Message attributes. Rules combine with AND logic.

## Heavy Load Mode

Increases DynamoDB Stream batch size and window for high-throughput scenarios. Configurable from Settings, applies retroactively to all heavy load pipelines.
