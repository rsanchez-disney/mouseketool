---
id: lw-build
tab: lambda
title: Building a Lambda
icon: Hammer
---

<!-- diagram:lambda-flow -->

The Builder page compiles your Java Lambda project into a deployable artifact. Supports Maven and Gradle with auto-detection based on `pom.xml` or `build.gradle`.

## Step 1: Select your project

Use the file browser to navigate to your Java project root. Mouseketool scans for Lambda handler classes implementing `RequestHandler` or `RequestStreamHandler`.

## Step 2: Build

Select a handler and click **Build**. The console streams logs in real-time. Use **Stop** to cancel, and **Auto-scroll** to pin to the bottom.

## Step 3: Deploy or rebuild

Successful builds appear in **Cached Builds**. Deploy directly to LocalStack or rebuild after source changes. Each build shows a TTL indicator based on the cleanup interval.

## Environment variables

Mouseketool detects env vars from SAM templates or `.env` files. These are unified across Deployments and pipeline cards. Rebuilding automatically carries over env vars from the previous build.
