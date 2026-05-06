---
id: bj-registry
tab: batch
title: Project Registry
icon: Container
---

<!-- diagram:batch-flow -->

Register Docker-based projects that use docker-compose. Mouseketool scans for Dockerfiles and compose files with common naming patterns.

Each project card shows the detected Dockerfile, image tag, compose services, and registration time. Edit paths if auto-detection picked wrong files. A file watcher monitors registered directories for changes and auto-refreshes via SSE.
