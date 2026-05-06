---
id: bj-run
tab: batch
title: Simple Run
icon: Play
---

Execute a project's docker-compose file with a single click from the Launchpad page.

## Environment variable presets

Mouseketool scans compose files and `.env` files for variables. Fork them into named presets to customize values without modifying source files. Only one preset can be active at a time.

## Port conflict detection

Before starting, Mouseketool checks host ports in use. Conflicts are automatically remapped to the next available port. A badge shows remap count, and you can view the effective docker-compose config.

## Container visualization

The project info panel lists all services with volumes, env vars, image, and port mappings. Volume entries pointing to `.sh` files have a view button for syntax-highlighted content.

## Run Settings

A settings panel below the project info lets you toggle **Rebuild image** (rebuilds the JAR and Docker image from scratch before each run) and **Port remapping** (auto-remaps conflicting host ports). Both are enabled by default.

## Image rebuild flow

When rebuild is enabled, Mouseketool runs the full pipeline: `mvn clean install` -> remove old Docker image -> `docker build` with the project's tagged image name. The effective compose file always uses `image:` instead of `build:` for consistency.

## Log filtering

The log viewer has Build and Run tabs when rebuild is enabled. The Run tab shows only your batch container's logs by default - infrastructure services (redis, localstack, etc.) are filtered out. Toggle "All logs" to see everything.

## Auto-teardown

When the batch container exits, Mouseketool automatically stops all remaining containers and runs `docker compose down`. The Run button resets so you can start again immediately.
