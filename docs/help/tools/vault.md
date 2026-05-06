---
id: tl-vault
tab: tools
title: Vault Add-on
icon: Shield
---

Creates secrets in HashiCorp Vault before invocation. Configure Vault URL, root token, and secret paths with key-value entries.

- **Existence guard** - Existing secrets are skipped (not overwritten).
- **Auto-cleanup** - Mouseketool-created secrets are deleted after invocation.
- **KV engine** - Auto-detects KV v1 or v2.

## Docker networking

Lambda containers can't reach `localhost`. Use `host.docker.internal` for host services, or container hostnames for same-network services.
