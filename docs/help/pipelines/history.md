---
id: pl-history
tab: pipelines
title: Pipeline History
icon: Clock
group: Usage
order: 3
---

Records every pipeline run, including external DynamoDB inserts. Runs are identified by the Stream Handler's `RequestId` and correlated with Target Lambda invocations within a 2-minute window.

## DLQ detection

When a run times out, Mouseketool checks the DLQ. If messages are found, a diagnostic invoke captures the full error details.

## Live watch

Click **Watch Live** for automatic SSE updates. New runs appear silently without loading spinners.

## Filtering

Filter by state (Success, Error, Filtered, Diagnosing), time range (5m, 15m, 1h, 6h), and source (Manual, External). Click any run to expand logs with color-coded output.
