# Builder

The Builder page is where you compile your Java Lambda project into a deployable artifact. It supports both Maven and
Gradle projects and will auto-detect which one you're using based on the presence of a `pom.xml` or `build.gradle`
file in the project root.

## Building a Lambda

### Step 1: Select your project

Use the file browser to navigate to the root of your Java project — the directory where your build file lives. Once
you select a valid project, Mouseketool scans it for Lambda handler classes and lists them in a dropdown. If you don't
see your handler, make sure the class implements `RequestHandler` or `RequestStreamHandler`.

### Step 2: Build

Select a handler from the dropdown and click **Build**. The build console streams logs in real-time so you can see
exactly what Maven or Gradle is doing. The first build will be slower than usual because it needs to download all the
project dependencies — make sure you're connected to the VPN if your project uses internal repositories.

You can use the **Stop** button at any time to cancel a running build. A toast notification will confirm the
cancellation. The **Auto-scroll** toggle keeps the console pinned to the bottom as new logs come in.

### Step 3: Deploy or rebuild

After a successful build, the artifact appears in the **Cached Builds** section below the console. From there you can
either **Deploy** it directly to LocalStack or **Rebuild** it if you've made changes to the source code. You can also
delete old builds you no longer need.

## Environment Variables

During the initial project analysis, Mouseketool tries to detect environment variables from your SAM template or
`.env` file. These are saved as defaults but they are **not applied during deploy**. Instead, env vars are configured
and applied on the Deployments page right before each invocation. This means you can tweak values on the fly without
having to redeploy every time.

When you rebuild a project, env vars from the previous build are **automatically carried over** to the new build so
you don't have to re-enter them.

## Build Console

The build console has two views:

- **Inline console** — A compact scrollable panel on the page with Copy and Expand buttons.
- **Expanded console** — A near full-screen modal (97% viewport width) with a search bar, scroll-to-bottom, copy,
  and minimize buttons. Error lines are highlighted in red.

[← Back to README](../README.md)
