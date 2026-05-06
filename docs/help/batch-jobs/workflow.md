---
id: bj-workflow
tab: batch
title: Workflow Editor
icon: Workflow
---

A visual canvas (VueFlow) for building job dependency graphs. Each node represents a Docker container job with image, command, timeout, and env var overrides.

## Creating workflows

Click "New" then "Add Job" to place nodes. Connect by dragging handles. Import from existing compose files - `depends_on` relationships become edges.

## Compose Studio

AI-powered compose builder with Monaco editor. Actions: Generate (from prompt), Add Batch Project, Add Service, Add Healthchecks, Evaluate (review for issues).

## Execution

Clicking "Run" starts `docker compose up` in foreground. Each node shows live status (pending, running, healthy, exited, error). Logs stream in real-time.

## Infrastructure services

Supporting containers (databases, brokers, caches) are displayed in a separate panel to keep the dependency graph focused on batch jobs.

## Log isolation

Each workflow run gets a unique ID. Switching between workflows never leaks logs from another run. Streams are cancelled and reconnected cleanly.

## Container watchdog

A background process polls every 10 seconds for orphaned containers (labeled `MK_CREATED_BY`). When no workflow is running, orphans are automatically killed to prevent resource leaks.
