---
id: start-settings
tab: start
title: Settings
icon: Settings
---

Settings are organized into tabbed categories: **Connection**, **Lambda**, **Builds**, **Pipelines**, **AI**, **Workflows**, **UI**, and **About**.

## Connection

Configure the LocalStack endpoint (protocol, host, port) and AWS credentials. The **Managed LocalStack Instance** feature lets Mouseketool start and stop a LocalStack container via Docker. When enabled, connection fields are auto-managed.

## Lambda

Set the default memory allocation applied to every Lambda deployed from the Builder page.

## Builds

Configure auto-cleanup TTL for cached builds and optionally delete all builds on backend startup.

## Pipelines

Control history retention (by age or amount) and heavy load batch settings (batch size and window). Heavy load changes apply immediately to all pipelines with heavy load enabled.

## AI

Choose where Kiro stores learned data - locally in `.data/learned/` or in LocalStack S3.

## Workflows

Toggle auto-bump healthchecks for imported docker-compose files.

## UI

Toggle confetti celebrations on success events (deploy, invoke, pipeline, batch, workflow) with granular per-action control.

## Unsaved Changes & Restore

An amber indicator appears when you have unsaved modifications. A **Restore Defaults** button resets all settings to their original values.

## About

Displays the current app version and checks for updates from GitHub Releases. When a newer version is available, a green badge appears in the navigation bar with a link to download.
