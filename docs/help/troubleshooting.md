---
id: troubleshooting
tab: troubleshooting
title: Troubleshooting
icon: AlertTriangle
---

Common errors and how to fix them:

## ECONNREFUSED

LocalStack isn't running, or the host/port in Settings is wrong. Start your LocalStack container and verify connection settings.

## ECONNRESET

Wrong protocol. If using `https` but LocalStack runs HTTP (or vice versa), switch the protocol in Settings.

## getaddrinfo EAI_AGAIN

Host field contains a protocol prefix. Remove `http://` and use just the hostname.

## ExceptionInInitializerError

Class crashed during static initialization - a dependency is unreachable from inside the Lambda container. Use `host.docker.internal` instead of `localhost`. The Local Class Diagnostic shows the full stack trace.

## Vault URL mismatch

Lambda may be reading from an internal config file rather than the env var. Check `application.properties` for where the Vault URL is sourced.

## Pipeline step times out

LocalStack's ESM pollers can be slow on the free tier. Try again, restart LocalStack, or check History - the invocation may have happened after the timeout.

## Stale logs from previous invocations

LocalStack reuses warm containers. Mouseketool mitigates by killing warm containers before invoke and skipping stale log sources. If still seeing stale logs, restart LocalStack.
