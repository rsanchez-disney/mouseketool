<script setup lang="ts">
import { ref } from "vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Rocket, Hammer, CloudCog, Zap, AlertTriangle, Terminal, Shield,
  Database, Bell, Inbox, Clock, Keyboard, Sparkles, RefreshCw,
  Container, Play, MonitorPlay,
} from "lucide-vue-next";

const tabs = [
  { id: "building", label: "Building", icon: Hammer },
  { id: "deploying", label: "Deploying", icon: Rocket },
  { id: "status", label: "Status", icon: CloudCog },
  { id: "invoking", label: "Invoking", icon: Zap },
  { id: "triggers", label: "Triggers", icon: Database },
  { id: "execution", label: "Execution", icon: Bell },
  { id: "history", label: "History", icon: Clock },
  { id: "console", label: "Console", icon: Terminal },
  { id: "addons", label: "Add-ons", icon: Shield },
  { id: "ai", label: "AI Features", icon: Sparkles },
  { id: "selfhealing", label: "Self-Healing", icon: RefreshCw },
  { id: "batch", label: "Batch Projects", icon: Container },
  { id: "launchpad", label: "Launchpad", icon: Play },
  { id: "logviewer", label: "Log Viewer", icon: MonitorPlay },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "troubleshooting", label: "Troubleshooting", icon: AlertTriangle },
];

const active = ref("building");

const sqsExample = JSON.stringify({ Records: [{ body: '{"key": "value"}' }] }, null, 2);
const dynamoExample = JSON.stringify({ tt: { S: "my-key" }, message: { S: "hello world" } }, null, 2);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Help & Guides</h1>
      <p class="text-muted-foreground">Everything you need to know to get the most out of Mouseketool.</p>
    </div>

    <div class="flex gap-6 min-h-[70vh]">
      <!-- Sidebar -->
      <nav class="w-48 shrink-0 space-y-0.5">
        <Button
          v-for="tab in tabs" :key="tab.id"
          variant="ghost" size="sm"
          class="w-full justify-start gap-2 cursor-pointer"
          :class="active === tab.id ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          @click="active = tab.id"
        >
          <component :is="tab.icon" class="size-3.5" />
          {{ tab.label }}
        </Button>
      </nav>

      <!-- Content -->
      <div class="flex-1 min-w-0">

    <!-- BUILDING -->
    <Card v-if="active === 'building'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Hammer class="size-4" /> Building a Lambda</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The Builder page is where you compile your Java Lambda project into a deployable artifact. It supports both
        Maven and Gradle projects and will auto-detect which one you're using based on the presence of a
        <code class="text-xs bg-muted px-1 rounded">pom.xml</code> or <code class="text-xs bg-muted px-1 rounded">build.gradle</code> file in the project root.</p>

        <p class="font-medium text-foreground">Step 1: Select your project</p>
        <p>Use the file browser to navigate to the root of your Java project. This is the directory where your build file lives.
        Once you select a valid project, Mouseketool will scan it for Lambda handler classes and list them in a dropdown.
        If you don't see your handler, make sure the class implements
        <code class="text-xs bg-muted px-1 rounded">RequestHandler</code> or <code class="text-xs bg-muted px-1 rounded">RequestStreamHandler</code>.</p>

        <p class="font-medium text-foreground">Step 2: Build</p>
        <p>Select a handler from the dropdown and click <strong>Build</strong>. The build console will stream logs in real-time
        so you can see exactly what Maven or Gradle is doing. The first build will be slower than usual because it needs to
        download all the project dependencies — make sure you're connected to the VPN if your project uses internal repositories.</p>

        <p>You can use the <strong>Stop</strong> button at any time to cancel a running build. A toast notification will confirm
        the cancellation. The <strong>Auto-scroll</strong> toggle keeps the console pinned to the bottom as new logs come in.</p>

        <p class="font-medium text-foreground">Step 3: Deploy or rebuild</p>
        <p>After a successful build, the artifact appears in the <strong>Cached Builds</strong> section below the console.
        From there you can either <strong>Deploy</strong> it directly to LocalStack or <strong>Rebuild</strong> it if you've
        made changes to the source code. You can also delete old builds you no longer need.</p>

        <p class="font-medium text-foreground">About environment variables</p>
        <p>During the initial project analysis, Mouseketool will try to detect environment variables from your SAM template
        or <code class="text-xs bg-muted px-1 rounded">.env</code> file. These are saved as defaults and applied to the
        Lambda when you configure them on the Deployments page or the pipeline card's env var editor.</p>

        <p>Environment variables are unified across both pages. The Lambda's own configuration is the source of truth
        for active values. Editing env vars on either the Deployments page or the pipeline card updates the same Lambda.
        Excluded (grayed-out) env vars are preserved locally so you can re-enable them later without re-entering values.</p>

        <p>When you rebuild a project, env vars from the previous build are <strong>automatically carried over</strong>
        to the new build so you don't have to re-enter them.</p>
      </CardContent>
    </Card>
    <!-- DEPLOYING -->
    <Card v-if="active === 'deploying'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Rocket class="size-4" /> Deploying to LocalStack</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Once you have a successful build, the next step is to deploy it to LocalStack so you can invoke it. You can
        deploy from two places: the <strong>Deploy</strong> button on a cached build card (Builder page), or by navigating
        to the Deployments page directly.</p>

        <p>Before deploying, make sure LocalStack is running and that the connection settings (host, port, protocol) are
        correct. You can verify this on the <strong>Settings</strong> page. LocalStack accepts any credentials so the
        default <code class="text-xs bg-muted px-1 rounded">test/test</code> works fine.</p>

        <p>If the function already exists on LocalStack, the deploy will update it with the new code. You don't need to
        delete and recreate it. The Deployments page will show the updated artifact size and timestamp.</p>

        <p class="font-medium text-foreground">Memory configuration</p>
        <p>Java Lambdas on LocalStack need more memory than you might expect due to cold start overhead. Mouseketool
        defaults to <strong>2048 MB</strong> which works well for most Java projects. You can change this per-function
        on the Deployments page — there's a <strong>Memory</strong> dropdown in the invoke panel that lets you pick a
        value before each invocation. If you're seeing
        <code class="text-xs bg-muted px-1 rounded">OutOfMemoryError</code> or the Lambda times out during initialization,
        try bumping it up.</p>

        <p>A toast notification will confirm whether the deploy succeeded or failed. If it fails, check the
        <strong>Troubleshooting</strong> tab for common errors.</p>
      </CardContent>
    </Card>

    <!-- STATUS -->
    <Card v-if="active === 'status'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><CloudCog class="size-4" /> Deployment Status</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Every time you open the Deployments page, Mouseketool checks each function against LocalStack to verify it's
        still there and in a healthy state. The result is shown as a colored badge on each deployment card. You can also
        click the <strong>Refresh</strong> button in the top-right corner to re-check at any time.</p>

        <p>Here's what each status means:</p>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px]">active</Badge>
            <span>The function exists on LocalStack and is ready to be invoked.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-red-500/20 text-red-500 border-red-500/40 text-[10px]">failed</Badge>
            <span>The function exists but is in a failed state. This usually means the last deploy or configuration update had an issue.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-yellow-500/20 text-yellow-500 border-yellow-500/40 text-[10px]">unknown</Badge>
            <span>Mouseketool couldn't reach LocalStack within 3 seconds. The page still loads normally — check your connection and settings.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-zinc-500/20 text-zinc-400 border-zinc-500/40 text-[10px]">deleted</Badge>
            <span>The function was removed from LocalStack (maybe by a container restart). You'll need to redeploy.</span>
          </div>
        </div>

        <p class="font-medium text-foreground">Search</p>
        <p>If you have many deployments, use the search bar at the top of the list to filter them. It matches against
        both the function name and the handler class, so you can search for either one.</p>
      </CardContent>
    </Card>

    <!-- INVOKING -->
    <Card v-if="active === 'invoking'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Zap class="size-4" /> Invoking Functions</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>To invoke a Lambda, go to the Deployments page and click the <strong>Invoke</strong> button on any deployment
        card. This opens the Add-on Settings screen where you can configure optional tools like Vault (more on that in the
        <strong>Add-ons</strong> tab). Once you're ready, continue to the invoke panel.</p>

        <p class="font-medium text-foreground">Environment variables</p>
        <p>Env vars are configured directly in the invoke panel — you don't need to redeploy when changing them. Before
        each invocation, Mouseketool calls <code class="text-xs bg-muted px-1 rounded">UpdateFunctionConfiguration</code>
        to apply your current env vars to the Lambda function. This means you can change a Vault path, toggle a feature
        flag, or point to a different service URL and invoke again immediately.</p>

        <p>If you want to temporarily remove an env var without deleting it (so you can re-enable it later), check the
        <strong>Exclude</strong> checkbox next to it. Excluded vars are kept in the UI but are not sent to the Lambda
        configuration. The value is preserved — uncheck it anytime to bring it back.</p>

        <p class="font-medium text-foreground">Payload</p>
        <p>The payload editor accepts any valid JSON. For SQS-triggered Lambdas, you'll want to use the standard SQS
        event format:</p>
        <pre class="bg-muted rounded p-3 text-xs overflow-auto font-mono">{{ sqsExample }}</pre>
        <p>You can also click the <strong>Upload</strong> button next to the editor to load a JSON file from disk. This
        is handy if you have pre-built test events saved somewhere.</p>

        <p>You can also press <code class="text-xs bg-muted px-1 rounded">Ctrl+Enter</code> to invoke directly from the
        payload editor without clicking the button.</p>

        <p class="font-medium text-foreground">Understanding the results</p>
        <p>After invoking, the response panel shows the status code, function output, and any errors. If the Lambda
        failed, Mouseketool does a few things automatically to help you understand what went wrong:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Root Cause panel</strong> — Extracts all <code class="text-xs bg-muted px-1 rounded">Caused by</code>
          lines from the logs and surfaces them at the top so you don't have to scroll through the full stack trace.</li>
          <li><strong>Diagnostics</strong> — Lists env vars pointing to potentially unreachable services and checks if
          the handler class exists in the jar.</li>
          <li><strong>Local Class Diagnostic</strong> — When the error is an
          <code class="text-xs bg-muted px-1 rounded">ExceptionInInitializerError</code> (which means the class crashed
          during static initialization and often produces no CloudWatch logs), Mouseketool runs the class locally on the
          backend to capture the full stack trace. This is usually the most useful piece of information because it shows
          you exactly which dependency failed to initialize and why.</li>
        </ul>

        <p class="font-medium text-foreground">Memory configuration</p>
        <p>Above the env vars section you'll find a <strong>Memory</strong> dropdown that lets you change the Lambda's
        allocated memory before invoking. Java Lambdas on LocalStack typically need at least <strong>2048 MB</strong>
        for cold starts. If you're seeing <code class="text-xs bg-muted px-1 rounded">OutOfMemoryError</code> or the
        Lambda times out during initialization, try bumping it up.</p>

        <p class="font-medium text-foreground">Debug mode</p>
        <p>The <strong>Debug Invoke</strong> button runs the Lambda with extra JVM flags
        (<code class="text-xs bg-muted px-1 rounded">-verbose:class -Xlog:exceptions=info</code>) that produce detailed
        class-loading and exception traces. These flags are automatically cleaned up after the invoke so they don't leak
        into normal runs.</p>

        <p class="font-medium text-foreground">Re-invoke</p>
        <p>After invoking once, the <strong>Re-invoke</strong> button (⚡) becomes available on the deployment card. It
        re-runs the function with the last payload without opening the invoke panel — useful for quick iteration.</p>
      </CardContent>
    </Card>
    <!-- TRIGGERS -->
    <Card v-if="active === 'triggers'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Database class="size-4" /> Triggers (Pipeline Builder)</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The Triggers page lets you create end-to-end event-driven pipelines that emulate the team's real AWS
        architecture: <strong>DynamoDB → Stream Handler Lambda → SNS → SQS → Target Lambda</strong>. Instead of
        manually wiring up each resource through the AWS CLI or a YAML config, you walk through a visual wizard that
        sets everything up for you.</p>

        <p class="font-medium text-foreground">How the pipeline works</p>
        <p>When you insert an item into the DynamoDB table, a DynamoDB Stream event fires and triggers the Stream Handler
        Lambda. This is a lightweight Node.js function (auto-generated by Mouseketool) that reads the stream record,
        extracts the item, and publishes it to an SNS topic. SNS then fans out the message to an SQS queue, which in
        turn triggers your Target Lambda — the actual Java function you want to test.</p>

        <p>This mirrors how the real infrastructure works in AWS, so you can test your Lambda's behavior in a realistic
        event-driven context without deploying to the cloud.</p>

        <p class="font-medium text-foreground">The wizard</p>
        <p>Creating a pipeline is a 6-step process. The wizard guides you through each step:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Step 1 — Source</strong>: Choose the event source type. Currently only DynamoDB is supported.</li>
          <li><strong>Step 2 — DynamoDB</strong>: Select an existing table or create a new one. Tables already used by
          another pipeline are disabled and show an "In use" badge so you don't accidentally share resources.</li>
          <li><strong>Step 3 — SNS</strong>: Select or create an SNS topic. Same resource locking applies.</li>
          <li><strong>Step 4 — SQS</strong>: Select or create an SQS queue. You can optionally enable a
          <strong>Dead Letter Queue (DLQ)</strong> with a configurable <code class="text-xs bg-muted px-1 rounded">maxReceiveCount</code>.
          The DLQ catches messages that your Lambda fails to process after the specified number of retries.</li>
          <li><strong>Step 5 — Lambdas</strong>: Select the target Lambda function (the one you deployed from the Builder).
          The Stream Handler is auto-generated — you don't need to build or deploy it yourself.</li>
          <li><strong>Step 6 — Add-ons</strong>: Optionally configure Vault secrets that should be created before the
          pipeline is wired up. The secret values are applied as env vars on the target Lambda.</li>
        </ul>

        <p class="font-medium text-foreground" id="template-lambda">Template Lambdas</p>
        <p>The Stream Handler Lambda is a template function that Mouseketool manages for you. It's a Node.js function
        that reads DynamoDB Stream records, unmarshalls them into plain JSON objects, and publishes them to SNS.
        For example, if your DynamoDB item is <code class="text-xs bg-muted px-1 py-0.5 rounded">{"pk": {"S": "order-123"}, "count": {"N": "5"}}</code>,
        the message published to SNS will be <code class="text-xs bg-muted px-1 py-0.5 rounded">{"pk": "order-123", "count": 5}</code>.
        This means SNS filter policies can match directly on your item's field names and values without dealing with
        DynamoDB's marshalled format.</p>
        <p>Mouseketool tracks the template version using a
        hash — if the template code changes (e.g. after an app update), the pipeline card will show an "outdated" badge
        and you can redeploy the stream handler with one click.</p>

        <p class="font-medium text-foreground">SNS Filter Policies</p>
        <p>When selecting an SNS topic in Step 3, you can optionally enable a filter policy. This controls which messages
        SNS delivers to the SQS queue. The filter policy builder supports 9 operator types: string exact match, prefix,
        anything-but, anything-but prefix, suffix, wildcard, number exact match, number range, and key exists/not exists.
        Values are entered as chips (type and press Enter). All rules are combined with AND logic. The filter is applied
        on the SNS subscription, not the topic itself.</p>
        <p>You can choose between <strong>Message body</strong> (default) and <strong>Message attributes</strong> as the
        filter scope. Since the stream handler publishes unmarshalled items as the message body, Message body filtering
        lets you match directly on your DynamoDB item fields.</p>

        <p class="font-medium text-foreground">Background Pipeline Watcher</p>
        <p>Mouseketool runs a continuous background worker that monitors CloudWatch logs for all pipeline stream handlers.
        When a new invocation is detected (whether from a manual execution or an external DynamoDB insert), the watcher
        spawns an observer that tracks the run through SNS, SQS, and the target Lambda in real-time. This means the
        History page updates automatically without manual refresh. The observer polling interval is configurable in Settings.</p>

        <p class="font-medium text-foreground">Shadow Infrastructure</p>
        <p>Behind the scenes, Mouseketool creates a shadow SQS queue, a shadow Lambda, and an S3 bucket on startup.
        The shadow queue subscribes to every pipeline's SNS topic with the same filter policy as the main subscription,
        ensuring it only receives items that pass the filter. The shadow Lambda captures each message body to S3 for
        two purposes: (1) showing which items passed the filter in the SQS step logs, and (2) providing the exact
        payload for diagnostic replay if the target Lambda fails. Shadow resources are cleaned up and recreated on
        every backend restart. Captured items are cleaned up after each observer run completes.</p>

        <p class="font-medium text-foreground">Managing pipelines</p>
        <p>After creating a pipeline, it appears as a card on the Triggers page. You can select one or more pipelines
        using the checkboxes and use the <strong>Actions</strong> dropdown to:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>See Steps</strong> — Opens a modal showing all the resources in the pipeline (table, topic, queue,
          Lambdas) so you can verify the wiring.</li>
          <li><strong>Delete Selected</strong> — Removes the pipeline and cleans up all associated resources: event source
          mappings, the stream handler Lambda, SNS topic, SQS queues (including DLQ), and CloudWatch log groups. The
          DynamoDB table and your target Lambda are <strong>not deleted</strong> since they may be used elsewhere.</li>
        </ul>

        <p class="font-medium text-foreground">Environment variables</p>
        <p>You can configure env vars for the target Lambda from the pipeline edit page. These work the same way as
        on the Deployments page — they're applied to the Lambda configuration and support the <strong>Exclude</strong>
        checkbox to temporarily remove a var without deleting it.</p>

        <p class="font-medium text-foreground">Pipeline Edit Page</p>
        <p>Click the <strong>Edit</strong> button on a pipeline card to open the edit page. The left sidebar shows
        clickable step bubbles for each resource in the pipeline (DynamoDB, Stream Handler, SNS, SQS, Target Lambda).
        Clicking a step shows its read-only metadata on the right panel (ARN, status, item count, connected resources, etc.).
        The SNS step also includes an editable filter policy builder. Below the step bubbles you'll find buttons for
        Add-ons and Env Vars configuration.</p>
        <p>The <strong>Heavy Load</strong> toggle in the top-right header increases the DynamoDB Stream batch size and
        window for high-throughput scenarios. The <strong>Save</strong> button persists all changes atomically — filter
        policies are updated on the SNS subscription, heavy load settings update the event source mapping, and vault
        secrets are created in Vault. Changes are not applied until you click Save.</p>

        <p class="font-medium text-foreground">Heavy Load Mode</p>
        <p>When enabled (via the wizard Step 6 or the edit page), heavy load mode configures the DynamoDB Stream event
        source mapping with a larger batch size and batch window. This causes the stream handler to wait longer and
        collect more records before firing, which is useful when a backend service inserts many items rapidly. The batch
        size and window are configurable from the Settings page and apply retroactively to all heavy load pipelines when
        saved. A flickering flame icon appears next to the pipeline name when heavy load is active.</p>
        <p><strong>Known limitation:</strong> LocalStack does not reliably honor <code class="text-xs bg-muted px-1 rounded">MaximumBatchingWindowInSeconds</code>.
        Records may arrive split across multiple stream handler invocations regardless of the configured window. This
        is a LocalStack Community Edition limitation and does not affect real AWS deployments.</p>

        <p class="font-medium text-foreground">Inserts Only</p>
        <p>By default, the template stream handler processes all DynamoDB Stream event types (INSERT, MODIFY, REMOVE).
        If you only want to process new insertions, enable the <strong>Inserts only</strong> toggle on the Stream Handler
        step of the edit page. This sets the <code class="text-xs bg-muted px-1 rounded">STREAM_INSERTS_ONLY</code> env
        var on the stream handler Lambda, which skips MODIFY and REMOVE events.</p>

        <p class="font-medium text-foreground">Batch Indicator</p>
        <p>On the History page, a pulsating orange banner appears when items are actively being inserted into the
        DynamoDB table for a heavy load pipeline. The count shows how many new items have landed since the last pipeline
        run. The indicator persists across page navigations (it's tracked by the backend watcher) and disappears when
        the stream handler fires and a new run appears in the history.</p>

        <p class="font-medium text-foreground">Table Schema Save/Restore</p>
        <p>You can save a DynamoDB table's schema (key schema, GSIs, LSIs, stream settings) for later restoration after
        a LocalStack restart. Click <strong>Save Schema</strong> on the edit page's DynamoDB step or in the wizard's
        table selection toolbar. Optionally include a seed item in DynamoDB JSON format that will be inserted when the
        table is restored. Use <strong>Restore Table</strong> in the wizard to recreate a saved table.</p>
      </CardContent>
    </Card>

    <!-- EXECUTION -->
    <Card v-if="active === 'execution'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Bell class="size-4" /> Pipeline Execution</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Once you've created a pipeline, you can execute it by clicking the <strong>Execute</strong> button on the
        pipeline card. This takes you to the Execution page where you can watch each step of the pipeline run in
        real-time.</p>

        <p class="font-medium text-foreground">What happens during execution</p>
        <p>The execution follows 5 sequential steps. Each step waits for the previous one to complete before starting,
        and if any step fails, the remaining steps are marked as "Skipped — previous step failed".</p>

        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Step 1 — DynamoDB Insert</strong>: Mouseketool inserts a test item into the DynamoDB table. Before
          doing this, it cleans the slate by purging the SQS queues and deleting CloudWatch log groups so that the logs
          you see are guaranteed to be from this execution only.</li>
          <li><strong>Step 2 — Stream Handler</strong>: Polls CloudWatch logs for the stream handler Lambda, filtering
          by the execution start time. When logs appear, it means the DynamoDB Stream event was picked up and the handler
          ran. The logs show both the raw DynamoDB record and the unmarshalled item.</li>
          <li><strong>Step 3 — SNS Publish</strong>: Since SNS doesn't produce CloudWatch logs, this step is inferred
          from evidence — if the SQS queue receives a message, it means SNS successfully delivered it.</li>
          <li><strong>Step 4 — SQS Deliver</strong>: Checks SQS queue attributes and the DLQ to confirm the message
          arrived. The message is often consumed very quickly by the target Lambda, so Mouseketool checks multiple
          evidence sources rather than trying to catch the message in-flight.</li>
          <li><strong>Step 5 — Target Lambda</strong>: Polls CloudWatch logs for your target Lambda. If no logs appear
          within the timeout (which can happen with Java cold starts under CPU contention), Mouseketool performs a
          <strong>diagnostic invoke</strong> — it calls the Lambda directly with an SQS-shaped payload to capture the
          actual error.</li>
        </ul>

        <p class="font-medium text-foreground">Stop button</p>
        <p>You can click <strong>Stop</strong> at any time to abort the execution. This cancels all pending polling and
        marks the current step as stopped.</p>

        <p class="font-medium text-foreground">A note about LocalStack</p>
        <p>LocalStack's event source mapping pollers (the mechanism that triggers Lambdas from DynamoDB Streams and SQS)
        can be slow or inconsistent on the free tier. If a step times out, it doesn't necessarily mean your wiring is
        wrong — it may just be LocalStack being slow. Try running the execution again, or check the
        <strong>History</strong> tab to see if the invocation eventually happened.</p>
      </CardContent>
    </Card>

    <!-- HISTORY -->
    <Card v-if="active === 'history'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Clock class="size-4" /> Pipeline History</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The History page shows a record of every pipeline run, including ones that happened outside of the Execution
        page (for example, if you insert an item into DynamoDB manually via the CLI). It works by querying CloudWatch
        logs for both the Stream Handler and Target Lambda and correlating them by timestamp.</p>

        <p class="font-medium text-foreground">How runs are tracked</p>
        <p>Each run is identified by the Stream Handler's <code class="text-xs bg-muted px-1 rounded">RequestId</code>.
        Mouseketool then looks for a Target Lambda invocation that happened within a 2-minute window after the handler
        ran. If it finds one, the two are linked together as a single pipeline run.</p>

        <p>Runs are persisted in <code class="text-xs bg-muted px-1 rounded">pipelines.json</code> so they survive
        page refreshes and app restarts. Once a run is marked as "success" or "error", it's locked and won't change.
        Pending runs that haven't resolved within 2 minutes are automatically marked as errors.</p>

        <p class="font-medium text-foreground">DLQ detection</p>
        <p>When a pending run times out, Mouseketool checks the Dead Letter Queue before giving up. If there are
        messages in the DLQ, it means the target Lambda failed and SQS moved the message there after exhausting retries.
        In this case, Mouseketool performs a <strong>diagnostic invoke</strong> — it calls the target Lambda directly to
        capture the full error details (error message, type, stack trace, and local class diagnostic). This gives you
        the same level of detail you'd see on the Deployments page.</p>

        <p class="font-medium text-foreground">Live watch</p>
        <p>Click the <strong>Watch Live</strong> button to enable automatic refresh via Server-Sent Events (SSE). When
        a new run is detected or a pending run changes status, the page updates silently in the background — no loading
        spinner, no blink. This is useful when you're inserting items into DynamoDB from another terminal and want to
        see the results appear in real-time.</p>

        <p class="font-medium text-foreground">Filtering runs</p>
        <p>The toolbar at the top of the runs list lets you filter by state (Success, Error, Filtered, Diagnosing),
        time range (5 min, 15 min, 1 hour, 6 hours), and source (All, Manual, External). All filters work together.
        The run count on the right shows how many runs match the current filters out of the total.</p>

        <p class="font-medium text-foreground">Clearing history</p>
        <p>The <strong>Clear</strong> button removes all completed invocation records. Runs that are still pending or
        being diagnosed are preserved. A confirmation dialog appears before clearing.</p>


        <p class="font-medium text-foreground">Expanding a run</p>
        <p>Click on any run to expand it and see the full logs for both the Stream Handler and Target Lambda. The logs
        are color-coded the same way as on the Deployments page: <span class="text-red-400">red</span> for errors and
        exceptions, <span class="text-yellow-400">yellow</span> for warnings, and
        <span class="text-blue-400">blue</span> for section headers. Each run also shows the DynamoDB item that
        triggered it (unmarshalled from the stream handler logs).</p>
      </CardContent>
    </Card>
    <!-- CONSOLE -->
    <Card v-if="active === 'console'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Terminal class="size-4" /> Log Console</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Every page that displays logs (Builder, Deployments, Execution, History) follows the same console pattern.
        There's a compact inline view and an expanded full-screen view, both with the same set of features.</p>

        <p class="font-medium text-foreground">Inline console</p>
        <p>The inline console shows a scrollable log panel directly on the page. It has a fixed max height so it doesn't
        push the rest of the page down. Logs never wrap — they scroll horizontally if a line is too long, which keeps
        structured log output (like JSON) readable. Each panel has a <strong>Copy</strong> button that copies all log
        content to your clipboard (with a toast confirmation) and an <strong>Expand</strong> button that opens the
        full-screen view.</p>

        <p class="font-medium text-foreground">Expanded console</p>
        <p>The expanded console is a near full-screen modal (97% viewport width) with always-visible scrollbars. The
        toolbar at the top includes:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Search</strong> — Click the magnifying glass icon to open the search bar. Type to filter: matching
          lines stay fully visible while non-matching lines are dimmed to 20% opacity, so you keep the surrounding
          context. Click the <strong>X</strong> button to close the search and clear the filter.</li>
          <li><strong>Scroll to bottom</strong> (↓) — Jumps to the end of the log output. Available on Builder and
          Deployments pages.</li>
          <li><strong>Copy</strong> — Copies all log content to clipboard.</li>
          <li><strong>Minimize</strong> — Closes the expanded view and returns to the inline console.</li>
        </ul>

        <p class="font-medium text-foreground">Color coding</p>
        <p>Log lines are color-coded across all pages to help you spot important information at a glance:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><span class="text-red-400">Red</span> — Lines containing <code class="text-xs bg-muted px-1 rounded">ERROR</code>,
          <code class="text-xs bg-muted px-1 rounded">Exception</code>,
          <code class="text-xs bg-muted px-1 rounded">Caused by</code>, or
          <code class="text-xs bg-muted px-1 rounded">FunctionError</code>.</li>
          <li><span class="text-yellow-400">Yellow</span> — Warning lines (starting with ⚠).</li>
          <li><span class="text-blue-400">Blue</span> — Section headers like
          <code class="text-xs bg-muted px-1 rounded">── Diagnostics ──</code> or
          <code class="text-xs bg-muted px-1 rounded">── Local Class Diagnostic ──</code>.</li>
        </ul>

        <p class="font-medium text-foreground">Root Cause panel</p>
        <p>On the Deployments page, when a Lambda invocation fails, the expanded console shows a <strong>Root Cause</strong>
        box at the top that extracts all <code class="text-xs bg-muted px-1 rounded">Caused by</code> lines from the
        logs. This saves you from scrolling through a 200-line stack trace to find the one line that actually matters.</p>
      </CardContent>
    </Card>

    <!-- ADD-ONS -->
    <Card v-if="active === 'addons'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Shield class="size-4" /> Add-ons</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Add-ons are optional tools that run as part of the invoke or pipeline creation flow. They're configured in the
        Add-on Settings screen that appears when you click Invoke on a deployment card, or in Step 6 of the pipeline
        wizard.</p>

        <p class="font-medium text-foreground">Vault</p>
        <p>The Vault add-on creates secrets in a HashiCorp Vault instance. This is useful when your Lambda reads
        configuration from Vault during initialization (like a <code class="text-xs bg-muted px-1 rounded">clientSecret</code>
        for authentication).</p>

        <p>To set it up:</p>
        <ol class="list-decimal list-inside space-y-1.5 ml-1">
          <li>Enter the <strong>Vault URL</strong> (e.g. <code class="text-xs bg-muted px-1 rounded">http://localhost:8200</code>)
          and the <strong>Root Token</strong> (shown in the Vault container logs on startup).</li>
          <li>Click <strong>Test Connection</strong> to verify Mouseketool can reach Vault.</li>
          <li>Add one or more secret paths with key-value entries. For example, path
          <code class="text-xs bg-muted px-1 rounded">dummy/secret</code> with key
          <code class="text-xs bg-muted px-1 rounded">AUTH_CLIENT_SECRET</code>.</li>
        </ol>

        <p>A few things to know about how Vault secrets are handled:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Existence guard</strong> — If a secret already exists at the specified path, it's skipped (not
          overwritten). Skipped secrets appear as warnings in the invoke logs.</li>
          <li><strong>Auto-cleanup</strong> — When enabled, secrets that were created by Mouseketool are deleted from
          Vault after invocation. Secrets that were skipped (because they already existed) are never deleted.</li>
          <li><strong>KV engine</strong> — Mouseketool auto-detects whether your Vault instance uses KV v1 or v2.</li>
        </ul>

        <p class="font-medium text-foreground">Docker networking</p>
        <p>This is a common gotcha. Lambda functions run inside Docker containers managed by LocalStack. Services running
        on your host machine (like Vault on <code class="text-xs bg-muted px-1 rounded">localhost:8200</code>) are
        <strong>not reachable via localhost</strong> from inside the Lambda container.</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li>If Vault runs on your host, use <code class="text-xs bg-muted px-1 rounded">http://host.docker.internal:8200</code>
          in your Lambda's env vars.</li>
          <li>If Vault runs in Docker on the same network as LocalStack, use the container hostname (e.g.
          <code class="text-xs bg-muted px-1 rounded">http://vault:8200</code>).</li>
          <li>Set <code class="text-xs bg-muted px-1 rounded">LAMBDA_DOCKER_NETWORK</code> in your LocalStack
          docker-compose to put Lambda containers on the same network as your other services.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- AI FEATURES -->
    <Card v-if="active === 'ai'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Sparkles class="size-4" /> AI Features</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Mouseketool integrates with Kiro CLI to provide AI-powered features across the app. When Kiro is detected
        on your system, a glowing purple badge appears in the header. If Kiro is not installed, AI features are hidden
        and a gray badge with an install prompt is shown instead.</p>

        <p class="font-medium text-foreground">Error Explanation</p>
        <p>When a Lambda invocation fails and the Root Cause panel appears (in the Deployments page, History page, or
        Execution page), an <strong>Explain with Kiro</strong> button lets you send the error context to Kiro for a
        plain-English explanation and fix suggestion. In the minimized log view, a hint label says "Expand to use Kiro
        Assistance" — the full button is available in the expanded log modal.</p>

        <p class="font-medium text-foreground">Payload Generation</p>
        <p>On the Deployments page, you can configure a <strong>Sample Path</strong> in the Invoke Settings view
        (step 2). Point it to a folder containing JSON sample files and your project source code using the file
        browser. Once configured, the payload editor toolbar shows a <strong>Generate</strong> button with two
        options: Successful payload and Failure payload. Kiro reads the sample files and handler source code to
        generate a realistic payload matching your intent.</p>

        <p class="font-medium text-foreground">Pipeline Item Generation</p>
        <p>On the Execution page, a <strong>Generate</strong> button next to the test item editor offers three
        options: Successful item, Filtered item (intentionally fails the SNS filter), and Failure item. Kiro uses
        learned data from previous pipeline runs, the table's key schema, the active filter policy, and any saved
        favorites to generate items that match the pipeline's expected input.</p>

        <p class="font-medium text-foreground">Pipeline Learning</p>
        <p>Mouseketool automatically learns from every successful pipeline execution. Items that pass the SNS filter
        are captured and stored locally (up to 50 per pipeline). These learned items are included as context when
        generating new items, so generation quality improves over time. The storage location (local or S3) is
        configurable in Settings.</p>

        <p class="font-medium text-foreground">Evaluation and Feedback</p>
        <p>After generating a payload or item, an <strong>Evaluate</strong> button appears. Clicking it opens a modal
        where you rate the generation as good (thumbs up) or bad (thumbs down). Good samples are saved as favorites
        for future generation context. Bad samples prompt you to explain what was wrong — Kiro uses this feedback to
        avoid the same mistakes in future generations. Favorites and feedback are stored per deployment or pipeline.</p>
      </CardContent>
    </Card>

    <!-- SELF-HEALING -->
    <Card v-if="active === 'selfhealing'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><RefreshCw class="size-4" /> Pipeline Self-Healing</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>When LocalStack restarts, all AWS resources (tables, topics, queues, Lambdas, event source mappings) are
        deleted. Mouseketool detects this automatically and recreates everything from locally persisted metadata.</p>

        <p class="font-medium text-foreground">How it works</p>
        <p>A health monitor polls LocalStack every 5 seconds. When it detects that LocalStack has recovered from being
        unreachable, it runs a full reconciliation for every saved pipeline. During reconciliation, a blocking overlay
        appears on the UI with "Restoring Pipeline Resources" to prevent interaction until the process completes.</p>

        <p class="font-medium text-foreground">What gets recreated</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>DynamoDB tables</strong> — Restored from saved schemas. If no schema was saved, a generic table
          with <code class="text-xs bg-muted px-1 rounded">pk</code> and <code class="text-xs bg-muted px-1 rounded">sk</code>
          string keys is created. Always save your table schema from the pipeline edit page.</li>
          <li><strong>SNS topics and SQS queues</strong> — Recreated with the same names. DLQ and redrive policies
          are re-established.</li>
          <li><strong>Stream handler Lambda</strong> — Redeployed from the template source code with the same
          environment variables.</li>
          <li><strong>Target Lambda</strong> — Redeployed from the cached build artifact. If the build was deleted,
          the pipeline is flagged with a warning icon and you must select a new deployment from the edit page.</li>
          <li><strong>Event source mappings</strong> — DynamoDB Stream to stream handler and SQS to target Lambda
          connections are re-established with the same batch settings.</li>
          <li><strong>SNS subscriptions</strong> — Recreated with the same filter policy and scope.</li>
        </ul>

        <p class="font-medium text-foreground">Vault secrets</p>
        <p>Vault secret values are never stored by Mouseketool. After reconciliation, if a pipeline had Vault
        configured, an amber "Secrets need recreation" badge appears on the pipeline card and edit page. You must
        recreate the secrets manually through the Vault add-on configuration.</p>

        <p class="font-medium text-foreground">Target Lambda missing</p>
        <p>If the cached build for a target Lambda was deleted, an amber warning icon appears on the pipeline card.
        On the edit page's Target Lambda step, a deployment selector lets you pick an available deployment to
        reconnect the pipeline. Selecting a new target clears all previous execution logs.</p>
      </CardContent>
    </Card>

        <!-- BATCH PROJECTS -->
    <Card v-if="active === 'batch'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Container class="size-4" /> Batch Projects</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The Batch Projects page is where you register Docker-based projects that use docker-compose for local
        execution. Unlike the Builder page (which targets individual Java Lambda functions), Batch Projects manages
        multi-container applications that run as a group.</p>

        <p class="font-medium text-foreground">Registering a project</p>
        <p>Use the file browser or paste a path to point Mouseketool at your project root. On registration,
        Mouseketool scans the directory for Dockerfiles and docker-compose files. It detects common naming patterns
        like <code class="text-xs bg-muted px-1 rounded">Dockerfile</code>,
        <code class="text-xs bg-muted px-1 rounded">Dockerfile.local</code>,
        <code class="text-xs bg-muted px-1 rounded">docker-compose.yml</code>, and
        <code class="text-xs bg-muted px-1 rounded">compose.yaml</code> (including variants). If multiple compose
        files are found, all of them are listed and you can choose which one to use at run time.</p>

        <p class="font-medium text-foreground">Editing and deleting</p>
        <p>Each registered project card shows the detected Dockerfile, image tag, compose services, and registration
        time. Click the pencil icon to edit the Dockerfile and compose file paths if auto-detection picked the wrong
        files. Click the trash icon to remove the project from the registry. This does not delete any files on disk.</p>

        <p class="font-medium text-foreground">File watcher</p>
        <p>Mouseketool watches registered project directories for changes to compose files and
        <code class="text-xs bg-muted px-1 rounded">.env</code> files. When a change is detected, the Launchpad page
        receives a notification via Server-Sent Events and automatically refreshes the scanned environment variables
        and service list. A toast notification confirms the update.</p>
      </CardContent>
    </Card>

    <!-- LAUNCHPAD -->
    <Card v-if="active === 'launchpad'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Layers class="size-4" /> Launchpad</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The Launchpad page is the control center for running and orchestrating batch projects. It has two tabs:
        <strong>Simple Run</strong> for direct docker-compose execution, and <strong>Workflow</strong> for building
        visual job graphs.</p>

        <p class="font-medium text-foreground">Simple Run</p>
        <p>Simple Run lets you execute a registered project's docker-compose file with a single click. The flow is:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Project selection</strong> -- Pick a registered batch project from the dropdown.</li>
          <li><strong>Compose file selection</strong> -- If the project has multiple compose files, a second dropdown
          lets you choose which one to run. Changing the selection re-scans environment variables and services.</li>
          <li><strong>Environment variable presets</strong> -- Mouseketool scans the compose file and referenced
          <code class="text-xs bg-muted px-1 rounded">.env</code> files for environment variables, grouped by source.
          You can view these via the "Scanned Env Vars" button. To customize values without modifying the original
          files, click "Fork Env Vars" to create a named preset. Presets are editable, sortable, and can be activated
          or deactivated. Only one preset can be active at a time. When no preset is active, the scanned defaults are
          used.</li>
          <li><strong>Port conflict detection</strong> -- Before starting containers, Mouseketool checks which host
          ports are already in use. Conflicting ports are automatically remapped to the next available port. A badge
          in the output header shows how many ports were remapped, and you can click the file icon to view the
          effective docker-compose config with the applied changes.</li>
          <li><strong>Effective config viewer</strong> -- After a run with port remaps, you can view the generated
          docker-compose file that Mouseketool actually used. Port changes are shown in a summary panel with
          before/after values, and the full YAML is syntax-highlighted.</li>
          <li><strong>Container visualization</strong> -- The project info panel lists all services parsed from the
          compose file. Expanding a service shows its volumes, environment variables, image, and port mappings. Volume
          entries pointing to <code class="text-xs bg-muted px-1 rounded">.sh</code> files have a view button that
          opens the file contents with syntax highlighting.</li>
        </ul>

        <p class="font-medium text-foreground">Workflow tab</p>
        <p>The Workflow tab provides a visual canvas (powered by VueFlow) for building job dependency graphs. Each
        node on the canvas represents a Docker container job with its own image, command, timeout, and environment
        variable overrides. Nodes are connected by edges that define execution order.</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Creating workflows</strong> -- Click "New" to create a workflow, then "Add Job" to place nodes
          on the canvas. Connect nodes by dragging from one handle to another.</li>
          <li><strong>Importing from compose</strong> -- If a registered project has docker-compose services, you can
          import them into a workflow. Services become nodes, <code class="text-xs bg-muted px-1 rounded">depends_on</code>
          relationships become edges, and shared environment variables are extracted into the common env vars pool.</li>
          <li><strong>Common env vars</strong> -- Variables shared across all jobs in the workflow. Node-specific
          overrides take precedence on key conflicts.</li>
          <li><strong>Node editing</strong> -- Click a node to open the edit sheet where you can configure the job
          name, Docker image, command override, timeout, and node-specific environment variables.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- LOG VIEWER -->
    <Card v-if="active === 'logviewer'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><MonitorPlay class="size-4" /> Log Viewer</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>All log viewers across the application (Builder, Deployments, Execution, History, and Launchpad) use a
        shared LogViewer component with consistent behavior and controls:</p>
        <ul class="list-disc list-inside space-y-1.5 ml-1">
          <li><strong>Auto-scroll and follow mode</strong> -- New log lines automatically scroll into view while
          follow mode is active. Scrolling up disables follow; clicking the arrow button re-enables it.</li>
          <li><strong>Search</strong> -- The expanded view includes a search bar that dims non-matching lines to 20%
          opacity while keeping matching lines fully visible, preserving surrounding context.</li>
          <li><strong>Copy</strong> -- A copy button on both the inline and expanded views copies all log content to
          the clipboard.</li>
          <li><strong>Root cause panel</strong> -- When error lines are detected, a root cause panel appears at the
          top of the log output, extracting <code class="text-xs bg-muted px-1 rounded">Caused by</code>,
          <code class="text-xs bg-muted px-1 rounded">Exception</code>, and daemon error lines for quick
          identification.</li>
          <li><strong>Kiro explain</strong> -- When Kiro is available and errors are present, an "Explain with Kiro"
          button in the expanded view sends the error context to Kiro for a plain-English explanation and fix
          suggestion.</li>
        </ul>
      </CardContent>
    </Card>
    <!-- SHORTCUTS -->
    <Card v-if="active === 'shortcuts'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Keyboard class="size-4" /> Keyboard Shortcuts</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Mouseketool supports a few keyboard shortcuts to speed up common actions:</p>
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <code class="text-xs bg-muted px-2 py-0.5 rounded font-mono shrink-0">Ctrl + Enter</code>
            <span>Invoke the selected Lambda from the payload editor (Deployments page).</span>
          </div>
          <div class="flex items-center gap-3">
            <code class="text-xs bg-muted px-2 py-0.5 rounded font-mono shrink-0">Escape</code>
            <span>Close the expanded log console or any open modal/dialog.</span>
          </div>
        </div>
        <p>These shortcuts work on all pages where the corresponding action is available.</p>
      </CardContent>
    </Card>


    <!-- TROUBLESHOOTING -->
    <Card v-if="active === 'troubleshooting'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><AlertTriangle class="size-4" /> Troubleshooting</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>Here are the most common errors you might run into and how to fix them:</p>

        <p class="font-medium text-foreground">ECONNREFUSED</p>
        <p>LocalStack isn't running, or the host/port in Settings is wrong. Start your LocalStack container and verify
        the connection settings.</p>

        <p class="font-medium text-foreground">ECONNRESET</p>
        <p>You're using the wrong protocol. If you're connecting over
        <code class="text-xs bg-muted px-1 rounded">https</code> but LocalStack is running plain HTTP (or vice versa),
        you'll get this error. Try switching the protocol in Settings.</p>

        <p class="font-medium text-foreground">getaddrinfo EAI_AGAIN</p>
        <p>The Host field in Settings contains a protocol prefix. Remove
        <code class="text-xs bg-muted px-1 rounded">http://</code> or
        <code class="text-xs bg-muted px-1 rounded">https://</code> and use just the hostname (e.g.
        <code class="text-xs bg-muted px-1 rounded">localhost</code>).</p>

        <p class="font-medium text-foreground">ExceptionInInitializerError</p>
        <p>The Lambda class was found in the jar but crashed during static initialization. This almost always means a
        dependency (Vault, a database, an external service) is unreachable from inside the Lambda container. Check your
        env vars and make sure you're using <code class="text-xs bg-muted px-1 rounded">host.docker.internal</code>
        instead of <code class="text-xs bg-muted px-1 rounded">localhost</code> for services running on your host
        machine. The <strong>Local Class Diagnostic</strong> section in the invoke results will show you the full stack
        trace.</p>

        <p class="font-medium text-foreground">Vault URL mismatch</p>
        <p>If the Lambda logs show a different Vault URL than what you configured in the env vars, the Java code may be
        reading from an internal config file (like <code class="text-xs bg-muted px-1 rounded">application.properties</code>)
        rather than the env var. Check the project's configuration files to see where the Vault URL is sourced from.</p>

        <p class="font-medium text-foreground">Pipeline step times out</p>
        <p>LocalStack's event source mapping pollers can be slow or inconsistent on the free tier. If a pipeline step
        times out, it doesn't mean your wiring is wrong. Try running the execution again, restart the LocalStack
        container to reset the pollers, or check the History page — the invocation may have happened after the timeout
        window.</p>

        <p class="font-medium text-foreground">Stale logs from previous invocations</p>
        <p>LocalStack reuses warm Lambda containers. When you update env vars and invoke again, the logs might include
        output from the previous container. Mouseketool mitigates this by killing warm containers before invoke (via
        Docker) and skipping stale log sources when errors are detected. If you still see stale logs, try restarting
        the LocalStack container.</p>
      </CardContent>
    </Card>
    </div>
    </div>
  </div>
</template>
