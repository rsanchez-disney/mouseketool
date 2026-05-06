---
id: ai-features
tab: ai
title: Kiro AI Features
icon: Sparkles
---

Mouseketool integrates with Kiro CLI. When detected, a glowing purple badge appears in the header.

## Error Explanation

When a Lambda fails, **Explain with Kiro** sends the error context for a plain-English explanation and fix suggestion.

## Payload Generation

Configure a **Sample Path** pointing to JSON samples and source code. The **Generate** button offers Successful and Failure payload options.

## Pipeline Item Generation

Generate items matching the pipeline's expected input. Options: Successful, Filtered (fails SNS filter), and Failure. Uses learned data, key schema, filter policy, and favorites as context.

## Learning & Evaluation

Learns from successful executions (up to 50 items per pipeline). Use **Evaluate** to rate quality - good samples become favorites, bad samples include feedback for improvement.
