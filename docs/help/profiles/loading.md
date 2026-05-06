---
id: pf-loading
tab: profiles
title: Loading & Unloading
icon: RefreshCw
order: 2
---

**Loading** a profile is a destructive action. All existing LocalStack resources (Lambdas, DynamoDB tables, SNS topics, SQS queues), pipelines, batch registrations, workflows, and cached builds are deleted before provisioning begins.

If "Auto-download" is checked and Kiro + GitHub MCP is configured, missing projects are cloned automatically from GitHub.

Builds run 3 at a time in parallel. A collapsible panel shows real-time progress for each project.

**Unloading** performs the same cleanup and reloads the app. LocalStack must be running for both operations.
