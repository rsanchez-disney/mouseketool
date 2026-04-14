<script setup lang="ts">
import { ref } from "vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Rocket, Hammer, CloudCog, Settings, Zap, CircleHelp, AlertTriangle, Terminal, Shield } from "lucide-vue-next";

const tabs = [
  { id: "building", label: "Building", icon: Hammer },
  { id: "deploying", label: "Deploying", icon: Rocket },
  { id: "status", label: "Status", icon: CloudCog },
  { id: "invoking", label: "Invoking", icon: Zap },
  { id: "console", label: "Console", icon: Terminal },
  { id: "addons", label: "Add-ons", icon: Shield },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "troubleshooting", label: "Troubleshooting", icon: AlertTriangle },
];

const active = ref("building");

const sqsExample = JSON.stringify({ Records: [{ body: '{"key": "value"}' }] }, null, 2);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Help & Guides</h1>
      <p class="text-muted-foreground">Quick tips to get the most out of Mouseketool.</p>
    </div>

    <div class="flex gap-1 border-b">
      <Button
        v-for="tab in tabs" :key="tab.id"
        variant="ghost" size="sm"
        class="gap-1.5 rounded-b-none relative cursor-pointer"
        :class="active === tab.id ? 'text-primary after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground'"
        @click="active = tab.id"
      >
        <component :is="tab.icon" class="size-3.5" />
        {{ tab.label }}
      </Button>
    </div>

    <!-- Building -->
    <Card v-if="active === 'building'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Hammer class="size-4" /> Building a Lambda</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <p>1. Use the file browser to select your project root (where <code class="text-xs bg-muted px-1 rounded">pom.xml</code> or <code class="text-xs bg-muted px-1 rounded">build.gradle</code> lives).</p>
        <p>2. The build tool and Lambda handlers are auto-detected once you select a project.</p>
        <p>3. Select a handler and click <strong>Build</strong>. Logs stream in real-time.</p>
        <p>4. First builds may be slow while Maven/Gradle downloads dependencies.</p>
        <p>5. Use the <strong>Stop</strong> button to cancel a running build (a loading toast confirms the cancellation), and <strong>Auto-scroll</strong> to follow log output.</p>
        <p>6. Cached builds appear below the console — you can <strong>Rebuild</strong> or <strong>Deploy</strong> directly from there.</p>
        <p class="pt-2 font-medium text-foreground">Environment Variables</p>
        <p>Environment variables are auto-detected from your project's SAM template or <code class="text-xs bg-muted px-1 rounded">.env</code> file during analysis. They are saved as defaults but <strong>not applied during deploy</strong>.</p>
        <p>Instead, env vars are configured and applied in the <strong>Deployments → Invoke</strong> step, right before each invocation. This lets you make quick changes without redeploying.</p>
        <p>When you rebuild a project, env vars from the previous build are <strong>automatically carried over</strong> to the new build — no need to re-enter them.</p>
      </CardContent>
    </Card>

    <!-- Deploying -->
    <Card v-if="active === 'deploying'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Rocket class="size-4" /> Deploying to LocalStack</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <ul class="list-disc list-inside space-y-1">
          <li>After a successful build, click <strong>Deploy to LocalStack</strong>.</li>
          <li>Make sure LocalStack is running and the host/port/protocol are correct in <strong>Settings</strong>.</li>
          <li>If the function already exists, it will be updated with the new code.</li>
          <li>You can also deploy from <strong>Cached Builds</strong> without rebuilding.</li>
          <li>A toast notification will confirm whether the deploy succeeded or failed.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- Status -->
    <Card v-if="active === 'status'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><CloudCog class="size-4" /> Deployment Status</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <p>The Deployments page checks each function against LocalStack in real-time. Status is shown as a badge on each deployment card:</p>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px]">active</Badge>
            <span>Function exists and is invocable on LocalStack.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-red-500/20 text-red-500 border-red-500/40 text-[10px]">failed</Badge>
            <span>Function exists but is in a failed state.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-yellow-500/20 text-yellow-500 border-yellow-500/40 text-[10px]">unknown</Badge>
            <span>Could not reach LocalStack to verify status. Check your connection and settings.</span>
          </div>
          <div class="flex items-center gap-2">
            <Badge class="bg-zinc-500/20 text-zinc-400 border-zinc-500/40 text-[10px]">deleted</Badge>
            <span>Function was removed from LocalStack.</span>
          </div>
        </div>
        <p>Status checks have a 3-second timeout — if LocalStack is unreachable, the page still loads with <Badge class="bg-yellow-500/20 text-yellow-500 border-yellow-500/40 text-[10px] inline">unknown</Badge> badges.</p>
      </CardContent>
    </Card>

    <!-- Invoking -->
    <Card v-if="active === 'invoking'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Zap class="size-4" /> Invoking Functions</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <p>Go to <strong>Deployments</strong> and click the <strong>Invoke</strong> button on any function card. This opens the <strong>Add-on Settings</strong> screen where you can configure optional add-ons, then continue to the invoke panel.</p>
        <p class="pt-2 font-medium text-foreground">Environment Variables</p>
        <p>Env vars are configured directly in the invoke step — no need to redeploy when changing them. They are applied to the Lambda function <strong>before each invocation</strong> via <code class="text-xs bg-muted px-1 rounded">UpdateFunctionConfiguration</code>.</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Defaults are auto-detected from your SAM template on first deploy.</li>
          <li>Add, edit, or remove vars at any time. Changes are auto-saved before invoke.</li>
          <li>Persisted in the build folder (<code class="text-xs bg-muted px-1 rounded">envvars.json</code>) — deleted when the build is cleaned up.</li>
        </ul>
        <p class="pt-2 font-medium text-foreground">Payload</p>
        <p>For SQS handlers, use the standard SQS event format:</p>
        <pre class="bg-muted rounded p-2 text-xs overflow-auto">{{ sqsExample }}</pre>
        <p>You can also <strong>upload a JSON file</strong> using the Upload button next to the payload editor — the file contents will be loaded into the editor automatically.</p>
        <p>The response panel shows the status code, function output, and any errors. Use the copy button to grab the response payload.</p>
        <p>After invoking once, the <strong>Re-invoke</strong> button (⚡) becomes enabled — it re-runs the function with the last payload without opening the invoke panel.</p>
        <p class="pt-2 font-medium text-foreground">Debug Mode</p>
        <p>The <strong>Debug Invoke</strong> button runs the Lambda with extra JVM flags (<code class="text-xs bg-muted px-1 rounded">-verbose:class -Xlog:exceptions=info</code>) that produce detailed class-loading and exception traces. Debug flags are automatically cleaned up after the invoke so they don't leak into normal runs.</p>
        <p class="pt-2 font-medium text-foreground">Deployment card details</p>
        <ul class="list-disc list-inside space-y-1">
          <li><strong>Build tool</strong> — Maven or Gradle icon showing which tool built the artifact.</li>
          <li><strong>Lambda config</strong> — Memory (MB), timeout (s), and package size pulled from LocalStack.</li>
          <li><strong>Last invocation</strong> — Status code badge (green/red) and time since last invoke.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- Console -->
    <Card v-if="active === 'console'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Terminal class="size-4" /> Log Console</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <p>Both the Build and Deployments pages have log consoles with an <strong>expanded full-screen view</strong>.</p>
        <p class="pt-2 font-medium text-foreground">Mini Console</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Shows a compact view of logs inline on the page.</li>
          <li><strong>Copy</strong> button copies all log content to clipboard.</li>
          <li><strong>Expand</strong> button opens the full-screen console.</li>
        </ul>
        <p class="pt-2 font-medium text-foreground">Expanded Console</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Near full-screen dialog with always-visible scrollbars.</li>
          <li>Toolbar with <strong>Scroll to bottom</strong> (↓), <strong>Copy</strong>, and <strong>Minimize</strong> buttons.</li>
          <li>Logs are color-coded: <span class="text-red-400">red</span> for errors/exceptions, <span class="text-yellow-400">yellow</span> for warnings, <span class="text-blue-400">blue</span> for diagnostics sections.</li>
        </ul>
        <p class="pt-2 font-medium text-foreground">Root Cause Panel (Deployments only)</p>
        <p>When a Lambda invocation fails, the expanded console shows a <strong>Root Cause</strong> box at the top that extracts all <code class="text-xs bg-muted px-1 rounded">Caused by</code> lines from the logs — no need to scroll through the full stack trace to find the actual error.</p>
        <p class="pt-2 font-medium text-foreground">Diagnostics</p>
        <p>When a Lambda error is detected, the console automatically appends diagnostic hints:</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Environment variables pointing to potentially unreachable services.</li>
          <li>Class loading diagnostics (checks if the handler class exists in the jar).</li>
          <li>Vault connectivity hints when relevant.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- Add-ons -->
    <Card v-if="active === 'addons'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Shield class="size-4" /> Add-ons</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <p>Add-ons are optional tools that run before/after Lambda invocation. Configure them in the <strong>Add-on Settings</strong> screen that appears when you click Invoke on a deployment card.</p>
        <p class="pt-2 font-medium text-foreground">Vault Add-on</p>
        <p>Creates secrets in a HashiCorp Vault instance before invocation.</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Configure the <strong>Vault URL</strong> and <strong>Root Token</strong>, then use <strong>Test Connection</strong> to verify.</li>
          <li>Add secret paths with key-value entries. Secrets are written to Vault's KV engine (v1 or v2 auto-detected).</li>
          <li><strong>Existence guard</strong> — Secrets that already exist in Vault are <strong>skipped</strong> (not overwritten). Skipped secrets appear as warnings in the invoke logs under "── Vault Secrets ──".</li>
          <li><strong>Auto-cleanup</strong> — When enabled, created secrets are deleted from Vault after invocation. Pre-existing secrets that were skipped are never deleted.</li>
        </ul>
        <p class="pt-2 font-medium text-foreground">Docker Networking Tips</p>
        <p>Lambda functions run inside Docker containers managed by LocalStack. Services running on your host machine (Windows) are <strong>not reachable via <code class="text-xs bg-muted px-1 rounded">localhost</code></strong> from inside the container.</p>
        <ul class="list-disc list-inside space-y-1">
          <li>Use <code class="text-xs bg-muted px-1 rounded">host.docker.internal</code> to reach services on your host (e.g. <code class="text-xs bg-muted px-1 rounded">http://host.docker.internal:8200</code> for Vault).</li>
          <li>If services run in Docker on the same network, use their container hostname (e.g. <code class="text-xs bg-muted px-1 rounded">http://vault:8200</code>).</li>
          <li>Set <code class="text-xs bg-muted px-1 rounded">LAMBDA_DOCKER_NETWORK</code> in your LocalStack docker-compose to put Lambda containers on the same network as other services.</li>
        </ul>
      </CardContent>
    </Card>

    <!-- Settings -->
    <Card v-if="active === 'settings'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Settings class="size-4" /> Configuration Tips</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-2">
        <p><strong>Protocol</strong> — Use <code class="text-xs bg-muted px-1 rounded">http</code> for local LocalStack, <code class="text-xs bg-muted px-1 rounded">https</code> for remote instances.</p>
        <p><strong>Host</strong> — Just the hostname, no protocol prefix (e.g. <code class="text-xs bg-muted px-1 rounded">localhost</code>, not <code class="text-xs bg-muted px-1 rounded">http://localhost</code>).</p>
        <p><strong>Credentials</strong> — LocalStack accepts any value. Default <code class="text-xs bg-muted px-1 rounded">test/test</code> works fine.</p>
        <p><strong>Cleanup TTL</strong> — Cached builds are auto-deleted after this period (default: 24 hours).</p>
      </CardContent>
    </Card>

    <!-- Troubleshooting -->
    <Card v-if="active === 'troubleshooting'">
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><AlertTriangle class="size-4" /> Troubleshooting</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground space-y-3">
        <div class="space-y-2">
          <p><strong>ECONNREFUSED</strong> — LocalStack isn't running or the host/port in Settings is wrong.</p>
          <p><strong>ECONNRESET</strong> — Wrong protocol. Try switching between <code class="text-xs bg-muted px-1 rounded">http</code> and <code class="text-xs bg-muted px-1 rounded">https</code> in Settings.</p>
          <p><strong>getaddrinfo EAI_AGAIN</strong> — The Host field contains a protocol prefix. Remove <code class="text-xs bg-muted px-1 rounded">http://</code> or <code class="text-xs bg-muted px-1 rounded">https://</code> and use just the hostname.</p>
          <p><strong>Socket hang up</strong> — LocalStack is unreachable. The deployments page will show <Badge class="bg-yellow-500/20 text-yellow-500 border-yellow-500/40 text-[10px] inline">unknown</Badge> status after a 3-second timeout.</p>
          <p><strong>ExceptionInInitializerError</strong> — The Lambda class was found but crashed during static initialization. Usually means a dependency (Vault, DB, external service) is unreachable from inside the Lambda container. Check your env vars — use <code class="text-xs bg-muted px-1 rounded">host.docker.internal</code> instead of <code class="text-xs bg-muted px-1 rounded">localhost</code>.</p>
          <p><strong>S3 / API call timeout</strong> — The Lambda can't reach LocalStack's S3 or other AWS services. Set <code class="text-xs bg-muted px-1 rounded">LOCALSTACK_ENDPOINT_URL</code> to <code class="text-xs bg-muted px-1 rounded">http://host.docker.internal:4566</code> in your env vars.</p>
          <p><strong>Vault URL mismatch</strong> — If the jar logs show a different Vault URL than what you configured, the Java code may be reading from an internal config file rather than the env var. Check the project's <code class="text-xs bg-muted px-1 rounded">application.properties</code> or equivalent.</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
