<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Rocket, Hammer, CloudCog, Zap, AlertTriangle, Terminal, Shield,
  Database, Bell, Clock, Keyboard, Sparkles, RefreshCw,
  Container, Play, Home, Settings, ChevronDown, ChevronRight, Search,
  Layers, MonitorPlay, Workflow, Inbox, Radio, ChevronsDownUp, ChevronsUpDown
} from "lucide-vue-next";

const tabs = [
  { id: "start", label: "Getting Started", icon: Home, accent: "emerald" },
  { id: "lambda", label: "Lambda Workflow", icon: Hammer, accent: "blue" },
  { id: "pipelines", label: "Pipelines", icon: Database, accent: "purple" },
  { id: "batch", label: "Batch Jobs", icon: Container, accent: "amber" },
  { id: "tools", label: "Tools & Add-ons", icon: Terminal, accent: "zinc" },
  { id: "ai", label: "AI & Automation", icon: Sparkles, accent: "violet" },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard, accent: "zinc" },
  { id: "troubleshooting", label: "Troubleshooting", icon: AlertTriangle, accent: "red" },
];

const active = ref("start");
const searchQuery = ref("");
const openSections = ref<Set<string>>(new Set());
const loaded = ref(false);
const tabTransition = ref(false);

onMounted(() => { setTimeout(() => { loaded.value = true; }, 50); });

watch(active, () => {
  tabTransition.value = false;
  nextTick(() => { tabTransition.value = true; });
});
onMounted(() => { tabTransition.value = true; });

function toggle(id: string) {
  if (openSections.value.has(id)) { openSections.value.delete(id); return; }
  // Close siblings (same prefix group)
  const prefix = id.split('-')[0];
  for (const key of [...openSections.value]) { if (key.startsWith(prefix + '-')) openSections.value.delete(key); }
  openSections.value.add(id);
}
function isOpen(id: string) { return openSections.value.has(id); }
function openAll(ids: string[]) { ids.forEach(id => openSections.value.add(id)); }
function closeAll(ids: string[]) { ids.forEach(id => openSections.value.delete(id)); }

const activeTab = computed(() => tabs.find(t => t.id === active.value));

const sqsExample = JSON.stringify({ Records: [{ body: '{"key": "value"}' }] }, null, 2);

// Search: map section IDs to their tab and text content
const sectionContent: Record<string, { tab: string; text: string }> = {
  "start-home": { tab: "start", text: "home dashboard quick stats pipelines batch projects workflows pulse indicator quick actions" },
  "start-settings": { tab: "start", text: "settings connection lambda builds pipelines ai workflows managed localstack restore defaults unsaved" },
  "lw-build": { tab: "lambda", text: "building build maven gradle handler artifact cached builds environment variables" },
  "lw-deploy": { tab: "lambda", text: "deploying deploy localstack memory configuration override" },
  "lw-status": { tab: "lambda", text: "status active failed unknown deleted refresh search runtime" },
  "lw-invoke": { tab: "lambda", text: "invoking invoke payload environment variables debug re-invoke root cause diagnostics local class" },
  "pt-app": { tab: "pipelines", text: "app pipeline dynamodb stream handler sns sqs lambda filter policies heavy load wizard" },
  "pt-direct": { tab: "pipelines", text: "direct stream processor dynamodb lambda minimal event source mapping" },
  "pt-queue": { tab: "pipelines", text: "queue consumer sqs lambda decoupled microservice" },
  "pt-general": { tab: "pipelines", text: "general search filter edit page table schema save restore" },
  "pl-exec": { tab: "pipelines", text: "running execution steps dynamodb insert stream handler sns sqs target lambda stop" },
  "pl-history": { tab: "pipelines", text: "history runs dlq detection live watch filtering state time range source" },
  "bj-registry": { tab: "batch", text: "project registry docker compose dockerfile file watcher" },
  "bj-run": { tab: "batch", text: "simple run environment variable presets port conflict detection container visualization" },
  "bj-workflow": { tab: "batch", text: "workflow editor canvas vueflow compose studio ai generate execution infrastructure" },
  "tl-log": { tab: "tools", text: "log viewer auto-scroll search copy root cause kiro explain color coding" },
  "tl-vault": { tab: "tools", text: "vault add-on secrets hashicorp docker networking host.docker.internal" },
  "tl-heavy": { tab: "tools", text: "heavy load debug mode batch size window jvm flags verbose class" },
  "ai-features": { tab: "ai", text: "kiro ai error explanation payload generation pipeline item generation learning evaluation" },
  "ai-healing": { tab: "ai", text: "self-healing localstack restart reconciliation recreate dynamodb sns sqs lambda event source" },
};

const searchResults = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return null;
  const matches: Record<string, string[]> = {};
  for (const [id, { tab, text }] of Object.entries(sectionContent)) {
    if (text.includes(q) || id.includes(q)) {
      if (!matches[tab]) matches[tab] = [];
      matches[tab].push(id);
    }
  }
  return matches;
});

function tabMatchCount(tabId: string) {
  if (!searchResults.value) return 0;
  return searchResults.value[tabId]?.length || 0;
}

watch(searchQuery, (q) => {
  if (!q.trim()) return;
  const results = searchResults.value;
  if (!results) return;
  // Switch to first tab with matches
  const firstTab = Object.keys(results)[0];
  if (firstTab && !results[active.value]?.length) active.value = firstTab;
  // Open matching sections
  for (const ids of Object.values(results)) { ids.forEach(id => openSections.value.add(id)); }
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header with entrance animation -->
    <div :class="['flex items-center justify-between transition-[opacity,transform] duration-700', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4']">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Help & Guides</h1>
        <p class="text-muted-foreground text-sm">Everything you need to know to get the most out of Mouseketool.</p>
      </div>
      <div class="relative w-64">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input v-model="searchQuery" placeholder="Search help..." class="pl-8 h-8 text-xs" />
      </div>
    </div>

    <!-- Breadcrumb with fade -->
    <div :class="['text-xs text-muted-foreground flex items-center gap-1 transition-[opacity,transform] duration-700 delay-100', loaded ? 'opacity-100' : 'opacity-0']">
      <span>Help</span>
      <ChevronRight class="size-3" />
      <span class="text-foreground font-medium transition-all duration-300">{{ activeTab?.label }}</span>
    </div>

    <!-- Horizontal tabs -->
    <div :class="['transition-[opacity,transform] duration-700 delay-200', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6']">
    <div class="flex gap-1 border-b mb-6">
      <button
        v-for="t in tabs" :key="t.id"
        :class="['flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer -mb-px', active === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground']"
        @click="active = t.id"
      >
        <component :is="t.icon" class="size-3.5" />
        {{ t.label }}
        <span v-if="searchQuery && tabMatchCount(t.id)" class="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-primary/15 text-primary">{{ tabMatchCount(t.id) }}</span>
      </button>
    </div>

      <div class="min-w-0">
        <Transition name="tab-fade" mode="out-in">
          <div :key="active">


    <!-- GETTING STARTED -->
    <div v-if="active === 'start'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Home class="size-4 text-muted-foreground" /> Getting Started</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['start-home','start-settings'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['start-home','start-settings'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">
        <!-- Home -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('start-home')">
            <component :is="isOpen('start-home') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Home class="size-3.5 text-muted-foreground" /> Home Dashboard
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('start-home') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>The Home page is your dashboard. It displays quick stats (deployed Lambdas, cached builds, pipelines, batch projects, workflows), pipeline activity with status count badges, a recent invocation feed, quick action shortcuts, and feature highlights.</p>
                <p>Click any stat card to navigate directly to that section. Pipelines with recent activity (last 5 minutes) display a live pulse indicator.</p>
                <p class="font-medium text-foreground">Quick Actions</p>
                <p>Shortcuts to common tasks: Build & Deploy Lambda, Create Pipeline, and Launch Workflow. Each opens the relevant page with the appropriate flow pre-selected.</p>
              </div>
            </div>
          </div>
        </div>
        <!-- Settings -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('start-settings')">
            <component :is="isOpen('start-settings') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Settings class="size-3.5 text-muted-foreground" /> Settings
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('start-settings') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Settings are organized into six tabbed categories: <strong>Connection</strong>, <strong>Lambda</strong>, <strong>Builds</strong>, <strong>Pipelines</strong>, <strong>AI</strong>, and <strong>Workflows</strong>.</p>
                <p class="font-medium text-foreground">Connection</p>
                <p>Configure the LocalStack endpoint (protocol, host, port) and AWS credentials. The <strong>Managed LocalStack Instance</strong> feature lets Mouseketool start and stop a LocalStack container via Docker. When enabled, connection fields are auto-managed.</p>
                <p class="font-medium text-foreground">Lambda</p>
                <p>Set the default memory allocation applied to every Lambda deployed from the Builder page.</p>
                <p class="font-medium text-foreground">Builds</p>
                <p>Configure auto-cleanup TTL for cached builds and optionally delete all builds on backend startup.</p>
                <p class="font-medium text-foreground">Pipelines</p>
                <p>Control history retention (by age or amount) and heavy load batch settings (batch size and window). Heavy load changes apply immediately to all pipelines with heavy load enabled.</p>
                <p class="font-medium text-foreground">AI</p>
                <p>Choose where Kiro stores learned data — locally in <code class="text-xs bg-muted px-1 rounded">.data/learned/</code> or in LocalStack S3.</p>
                <p class="font-medium text-foreground">Workflows</p>
                <p>Toggle auto-bump healthchecks for imported docker-compose files.</p>
                <p class="font-medium text-foreground">UI</p>
                <p>Toggle confetti celebrations on success events (deploy, invoke, pipeline, batch, workflow) with granular per-action control.</p>
                <p class="font-medium text-foreground">Unsaved Changes & Restore</p>
                <p>An amber indicator appears when you have unsaved modifications. A <strong>Restore Defaults</strong> button resets all settings to their original values.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>


    <!-- LAMBDA WORKFLOW -->
    <div v-if="active === 'lambda'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Hammer class="size-4 text-muted-foreground" /> Lambda Workflow</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['lw-build','lw-deploy','lw-status','lw-invoke'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['lw-build','lw-deploy','lw-status','lw-invoke'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">

        <!-- Animated flow diagram -->
        <div class="flex items-center justify-center gap-0 py-4 mb-3">
          <div v-for="(step, i) in ['Build','Deploy','Configure','Invoke','Inspect']" :key="step" class="flex items-center">
            <div class="px-3 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/5 text-blue-400 text-xs font-medium transition-all duration-150 hover:bg-blue-500/15 hover:shadow-md hover:shadow-blue-500/10" :style="{ animationDelay: `${i * 100}ms` }">{{ step }}</div>
            <div v-if="i < 4" class="w-8 h-px border-t border-dashed border-blue-500/40 flow-dash" />
          </div>
        </div>

        <!-- Building -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('lw-build')">
            <component :is="isOpen('lw-build') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Hammer class="size-3.5 text-muted-foreground" /> Building a Lambda
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('lw-build') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>The Builder page compiles your Java Lambda project into a deployable artifact. Supports Maven and Gradle with auto-detection based on <code class="text-xs bg-muted px-1 rounded">pom.xml</code> or <code class="text-xs bg-muted px-1 rounded">build.gradle</code>.</p>
                <p class="font-medium text-foreground">Step 1: Select your project</p>
                <p>Use the file browser to navigate to your Java project root. Mouseketool scans for Lambda handler classes implementing <code class="text-xs bg-muted px-1 rounded">RequestHandler</code> or <code class="text-xs bg-muted px-1 rounded">RequestStreamHandler</code>.</p>
                <p class="font-medium text-foreground">Step 2: Build</p>
                <p>Select a handler and click <strong>Build</strong>. The console streams logs in real-time. Use <strong>Stop</strong> to cancel, and <strong>Auto-scroll</strong> to pin to the bottom.</p>
                <p class="font-medium text-foreground">Step 3: Deploy or rebuild</p>
                <p>Successful builds appear in <strong>Cached Builds</strong>. Deploy directly to LocalStack or rebuild after source changes. Each build shows a TTL indicator based on the cleanup interval.</p>
                <p class="font-medium text-foreground">Environment variables</p>
                <p>Mouseketool detects env vars from SAM templates or <code class="text-xs bg-muted px-1 rounded">.env</code> files. These are unified across Deployments and pipeline cards. Rebuilding automatically carries over env vars from the previous build.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Deploying -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('lw-deploy')">
            <component :is="isOpen('lw-deploy') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Rocket class="size-3.5 text-muted-foreground" /> Deploying to LocalStack
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('lw-deploy') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Deploy from the <strong>Deploy</strong> button on a cached build card or from the Deployments page. Make sure LocalStack is running and connection settings are correct.</p>
                <p>If the function already exists, the deploy updates it with new code — no need to delete and recreate. The deploy override modal lets you confirm or skip redeployment.</p>
                <p class="font-medium text-foreground">Memory configuration</p>
                <p>Java Lambdas on LocalStack need more memory due to cold start overhead. Default is <strong>2048 MB</strong>. Change per-function via the Memory dropdown. Bump up if you see <code class="text-xs bg-muted px-1 rounded">OutOfMemoryError</code>.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Status -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('lw-status')">
            <component :is="isOpen('lw-status') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <CloudCog class="size-3.5 text-muted-foreground" /> Deployment Status
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('lw-status') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Mouseketool checks each function against LocalStack on page load. Click <strong>Refresh</strong> to re-check manually.</p>
                <div class="space-y-2">
                  <div class="flex items-center gap-2"><Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px]">active</Badge><span>Function exists and is ready.</span></div>
                  <div class="flex items-center gap-2"><Badge class="bg-red-500/20 text-red-500 border-red-500/40 text-[10px]">failed</Badge><span>Function exists but in a failed state.</span></div>
                  <div class="flex items-center gap-2"><Badge class="bg-yellow-500/20 text-yellow-500 border-yellow-500/40 text-[10px]">unknown</Badge><span>Couldn't reach LocalStack within 3 seconds.</span></div>
                  <div class="flex items-center gap-2"><Badge class="bg-zinc-500/20 text-zinc-400 border-zinc-500/40 text-[10px]">deleted</Badge><span>Function removed (container restart). Redeploy needed.</span></div>
                </div>
                <p>Use the search bar to filter by function name or handler class. The runtime dropdown filters by language runtime.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Invoking -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('lw-invoke')">
            <component :is="isOpen('lw-invoke') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Zap class="size-3.5 text-muted-foreground" /> Invoking Functions
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('lw-invoke') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Click <strong>Invoke</strong> on a deployment card to open the Add-on Settings screen, then continue to the invoke panel.</p>
                <p class="font-medium text-foreground">Environment variables</p>
                <p>Env vars are applied before each invocation via <code class="text-xs bg-muted px-1 rounded">UpdateFunctionConfiguration</code>. Use the <strong>Exclude</strong> checkbox to temporarily remove a var without deleting it.</p>
                <p class="font-medium text-foreground">Payload</p>
                <p>The editor accepts any valid JSON. Upload from disk or press <code class="text-xs bg-muted px-1 rounded">Ctrl+Enter</code> to invoke directly. For SQS-triggered Lambdas:</p>
                <pre class="bg-zinc-950 rounded-lg p-3 text-xs overflow-auto font-mono text-zinc-300 border border-zinc-800 relative"><span class="absolute top-1.5 right-2 text-[9px] text-zinc-600 font-sans">JSON</span>{{ sqsExample }}</pre>
                <p class="font-medium text-foreground">Understanding results</p>
                <ul class="list-disc list-inside space-y-1.5 ml-1">
                  <li><strong>Root Cause panel</strong> — Extracts all <code class="text-xs bg-muted px-1 rounded">Caused by</code> lines from logs.</li>
                  <li><strong>Diagnostics</strong> — Lists env vars pointing to unreachable services, checks handler class in jar.</li>
                  <li><strong>Local Class Diagnostic</strong> — Runs the class locally to capture the full stack trace when <code class="text-xs bg-muted px-1 rounded">ExceptionInInitializerError</code> occurs.</li>
                </ul>
                <p class="font-medium text-foreground">Debug mode & Re-invoke</p>
                <p><strong>Debug Invoke</strong> runs with extra JVM flags for detailed traces. The <strong>Re-invoke</strong> button (⚡) re-runs with the last payload without opening the invoke panel.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>


    <!-- PIPELINES -->
    <div v-if="active === 'pipelines'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Database class="size-4 text-muted-foreground" /> Pipelines</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['pt-app','pt-direct','pt-queue','pt-general','pl-exec','pl-history'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['pt-app','pt-direct','pt-queue','pt-general','pl-exec','pl-history'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">


        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1 mb-0.5">Usage</p>

        <!-- Common pipeline features -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pt-general')">
            <component :is="isOpen('pt-general') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Settings class="size-3.5 text-muted-foreground" /> General
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pt-general') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Search pipelines by name and filter by type using the pills at the top of the page.</p>
                <p class="font-medium text-foreground">Pipeline Edit Page</p>
                <p>Clickable step bubbles, editable filter policies, Heavy Load toggle, Add-ons, and Env Vars. Changes are not applied until you click Save.</p>
                <p class="font-medium text-foreground">Table Schema Save/Restore</p>
                <p>Save a table's schema for restoration after LocalStack restart. Optionally include a seed item in DynamoDB JSON format.</p>
              </div>
            </div>
          </div>
        </div>


        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pl-exec')">
            <component :is="isOpen('pl-exec') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Bell class="size-3.5 text-muted-foreground" /> Running Pipelines
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pl-exec') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Click <strong>Execute</strong> on a pipeline card to watch each step run in real-time via SSE.</p>
                <p class="font-medium text-foreground">Execution steps</p>
                <ul class="list-disc list-inside space-y-1.5 ml-1">
                  <li><strong>DynamoDB Insert</strong> — Inserts test item, purges queues, deletes log groups for clean slate.</li>
                  <li><strong>Stream Handler</strong> — Polls CloudWatch for stream handler logs.</li>
                  <li><strong>SNS Publish</strong> — Inferred from SQS evidence (SNS doesn't produce logs).</li>
                  <li><strong>SQS Deliver</strong> — Checks queue attributes and DLQ.</li>
                  <li><strong>Target Lambda</strong> — Polls CloudWatch. If no logs appear, performs a diagnostic invoke.</li>
                </ul>
                <p>Use <strong>Stop</strong> to abort at any time. If a step times out, it may be LocalStack's ESM pollers being slow — try again or check History.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- History -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pl-history')">
            <component :is="isOpen('pl-history') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Clock class="size-3.5 text-muted-foreground" /> Pipeline History
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pl-history') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Records every pipeline run, including external DynamoDB inserts. Runs are identified by the Stream Handler's <code class="text-xs bg-muted px-1 rounded">RequestId</code> and correlated with Target Lambda invocations within a 2-minute window.</p>
                <p class="font-medium text-foreground">DLQ detection</p>
                <p>When a run times out, Mouseketool checks the DLQ. If messages are found, a diagnostic invoke captures the full error details.</p>
                <p class="font-medium text-foreground">Live watch</p>
                <p>Click <strong>Watch Live</strong> for automatic SSE updates. New runs appear silently without loading spinners.</p>
                <p class="font-medium text-foreground">Filtering</p>
                <p>Filter by state (Success, Error, Filtered, Diagnosing), time range (5m, 15m, 1h, 6h), and source (Manual, External). Click any run to expand logs with color-coded output.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1 mb-0.5">Types</p>

        <!-- APP Pipeline -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pt-app')">
            <component :is="isOpen('pt-app') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Database class="size-3.5 text-muted-foreground" /> APP Pipeline
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pt-app') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <!-- Animated diagram -->
                <div class="flex items-center justify-center gap-0 py-2">
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/5"><Database class="size-3 text-amber-400" /><span class="text-[10px] text-amber-400 font-medium">DynamoDB</span></div>
                  <div class="w-6 h-px flow-dash text-amber-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-500/30 bg-blue-500/5"><Zap class="size-3 text-blue-400" /><span class="text-[10px] text-blue-400 font-medium">Stream</span></div>
                  <div class="w-6 h-px flow-dash text-blue-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-violet-500/30 bg-violet-500/5"><Radio class="size-3 text-violet-400" /><span class="text-[10px] text-violet-400 font-medium">SNS</span></div>
                  <div class="w-6 h-px flow-dash text-violet-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/5"><Inbox class="size-3 text-emerald-400" /><span class="text-[10px] text-emerald-400 font-medium">SQS</span></div>
                  <div class="w-6 h-px flow-dash text-emerald-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-500/30 bg-red-500/5"><Zap class="size-3 text-red-400" /><span class="text-[10px] text-red-400 font-medium">Lambda</span></div>
                </div>
                <p>The full event-driven chain that mirrors real AWS architecture. A DynamoDB Stream event triggers a lightweight Node.js Stream Handler (auto-generated) that unmarshalls the record and publishes to SNS. SNS fans out to SQS with optional filter policies, and SQS triggers your target Lambda.</p>
                <p class="font-medium text-foreground">The wizard</p>
                <p>A 6-step process: Source → DynamoDB → SNS → SQS → Lambdas → Add-ons. Resources already in use show an "In use" badge. DLQ is optional with configurable <code class="text-xs bg-muted px-1 rounded">maxReceiveCount</code>.</p>
                <p class="font-medium text-foreground">SNS Filter Policies</p>
                <p>9 operator types: string exact, prefix, anything-but, suffix, wildcard, number exact, number range, key exists/not exists. Filter scope: Message body or Message attributes. Rules combine with AND logic.</p>
                <p class="font-medium text-foreground">Heavy Load Mode</p>
                <p>Increases DynamoDB Stream batch size and window for high-throughput scenarios. Configurable from Settings, applies retroactively to all heavy load pipelines.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Direct Stream -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pt-direct')">
            <component :is="isOpen('pt-direct') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Zap class="size-3.5 text-muted-foreground" /> Direct Stream Processor
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pt-direct') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <!-- Animated diagram -->
                <div class="flex items-center justify-center gap-0 py-2">
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/5"><Database class="size-3 text-amber-400" /><span class="text-[10px] text-amber-400 font-medium">DynamoDB</span></div>
                  <div class="w-10 h-px flow-dash text-amber-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-500/30 bg-red-500/5"><Zap class="size-3 text-red-400" /><span class="text-[10px] text-red-400 font-medium">Lambda</span></div>
                </div>
                <p>The simplest pipeline type. A DynamoDB Stream triggers your Lambda function directly via an event source mapping — no intermediary services. Best for cases where you don't need fan-out, filtering, or retry queues.</p>
                <p class="font-medium text-foreground">When to use</p>
                <p>Use Direct Stream when your Lambda is the only consumer of the table's change events and you want the lowest latency path from write to invocation.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Queue Consumer -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('pt-queue')">
            <component :is="isOpen('pt-queue') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Inbox class="size-3.5 text-muted-foreground" /> Queue Consumer
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('pt-queue') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <!-- Animated diagram -->
                <div class="flex items-center justify-center gap-0 py-2">
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/5"><Inbox class="size-3 text-emerald-400" /><span class="text-[10px] text-emerald-400 font-medium">SQS</span></div>
                  <div class="w-10 h-px flow-dash text-emerald-500/40" />
                  <div class="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-500/30 bg-red-500/5"><Zap class="size-3 text-red-400" /><span class="text-[10px] text-red-400 font-medium">Lambda</span></div>
                </div>
                <p>An SQS queue triggers your Lambda function. Best for testing Lambdas that consume messages from a queue — common in decoupled microservice architectures where upstream services publish to SQS.</p>
                <p class="font-medium text-foreground">When to use</p>
                <p>Use Queue Consumer when your Lambda already expects SQS event payloads and you want to test it by sending messages directly to a queue.</p>
              </div>
            </div>
          </div>
        </div>


        <!-- Execution -->
    </div>


    <!-- BATCH JOBS -->
    <div v-if="active === 'batch'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Container class="size-4 text-muted-foreground" /> Batch Jobs</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['bj-registry','bj-run','bj-workflow'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['bj-registry','bj-run','bj-workflow'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">

        <!-- Animated flow diagram -->
        <div class="flex items-center justify-center gap-0 py-4 mb-3">
          <div v-for="(step, i) in ['Register','Configure','Run','Monitor']" :key="step" class="flex items-center">
            <div class="px-3 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs font-medium transition-all duration-150 hover:bg-amber-500/15 hover:shadow-md hover:shadow-amber-500/10" :style="{ animationDelay: `${i * 100}ms` }">{{ step }}</div>
            <div v-if="i < 3" class="w-8 h-px border-t border-dashed border-amber-500/40 flow-dash" />
          </div>
        </div>

        <!-- Project Registry -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('bj-registry')">
            <component :is="isOpen('bj-registry') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Container class="size-3.5 text-muted-foreground" /> Project Registry
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('bj-registry') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Register Docker-based projects that use docker-compose. Mouseketool scans for Dockerfiles and compose files with common naming patterns.</p>
                <p>Each project card shows the detected Dockerfile, image tag, compose services, and registration time. Edit paths if auto-detection picked wrong files. A file watcher monitors registered directories for changes and auto-refreshes via SSE.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Simple Run -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('bj-run')">
            <component :is="isOpen('bj-run') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Play class="size-3.5 text-muted-foreground" /> Simple Run
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('bj-run') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Execute a project's docker-compose file with a single click from the Launchpad page.</p>
                <p class="font-medium text-foreground">Environment variable presets</p>
                <p>Mouseketool scans compose files and <code class="text-xs bg-muted px-1 rounded">.env</code> files for variables. Fork them into named presets to customize values without modifying source files. Only one preset can be active at a time.</p>
                <p class="font-medium text-foreground">Port conflict detection</p>
                <p>Before starting, Mouseketool checks host ports in use. Conflicts are automatically remapped to the next available port. A badge shows remap count, and you can view the effective docker-compose config.</p>
                <p class="font-medium text-foreground">Container visualization</p>
                <p>The project info panel lists all services with volumes, env vars, image, and port mappings. Volume entries pointing to <code class="text-xs bg-muted px-1 rounded">.sh</code> files have a view button for syntax-highlighted content.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Workflow -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('bj-workflow')">
            <component :is="isOpen('bj-workflow') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Workflow class="size-3.5 text-muted-foreground" /> Workflow Editor
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('bj-workflow') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>A visual canvas (VueFlow) for building job dependency graphs. Each node represents a Docker container job with image, command, timeout, and env var overrides.</p>
                <p class="font-medium text-foreground">Creating workflows</p>
                <p>Click "New" then "Add Job" to place nodes. Connect by dragging handles. Import from existing compose files — <code class="text-xs bg-muted px-1 rounded">depends_on</code> relationships become edges.</p>
                <p class="font-medium text-foreground">Compose Studio</p>
                <p>AI-powered compose builder with Monaco editor. Actions: Generate (from prompt), Add Batch Project, Add Service, Add Healthchecks, Evaluate (review for issues).</p>
                <p class="font-medium text-foreground">Execution</p>
                <p>Clicking "Run" starts <code class="text-xs bg-muted px-1 rounded">docker compose up</code> in foreground. Each node shows live status (pending, running, healthy, exited, error). Logs stream in real-time.</p>
                <p class="font-medium text-foreground">Infrastructure services</p>
                <p>Supporting containers (databases, brokers, caches) are displayed in a separate panel to keep the dependency graph focused on batch jobs.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>


    <!-- TOOLS & ADD-ONS -->
    <div v-if="active === 'tools'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Terminal class="size-4 text-muted-foreground" /> Tools & Add-ons</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['tl-log','tl-vault','tl-heavy'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['tl-log','tl-vault','tl-heavy'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">
        <!-- Log Viewer -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('tl-log')">
            <component :is="isOpen('tl-log') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <MonitorPlay class="size-3.5 text-muted-foreground" /> Log Viewer
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('tl-log') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>All log viewers (Builder, Deployments, Execution, History, Launchpad) share consistent behavior:</p>
                <ul class="list-disc list-inside space-y-1.5 ml-1">
                  <li><strong>Auto-scroll</strong> — New lines scroll into view. Scrolling up disables follow; click arrow to re-enable.</li>
                  <li><strong>Search</strong> — Expanded view dims non-matching lines to 20% opacity, keeping context visible.</li>
                  <li><strong>Copy</strong> — Copies all content to clipboard with toast confirmation.</li>
                  <li><strong>Root cause panel</strong> — Extracts <code class="text-xs bg-muted px-1 rounded">Caused by</code> and exception lines at the top.</li>
                  <li><strong>Kiro explain</strong> — Sends error context to Kiro for plain-English explanation.</li>
                </ul>
                <p class="font-medium text-foreground">Color coding</p>
                <div class="flex gap-4 text-xs">
                  <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-red-400" /> Errors & exceptions</span>
                  <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-yellow-400" /> Warnings</span>
                  <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-blue-400" /> Section headers</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Vault -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('tl-vault')">
            <component :is="isOpen('tl-vault') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Shield class="size-3.5 text-muted-foreground" /> Vault Add-on
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('tl-vault') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Creates secrets in HashiCorp Vault before invocation. Configure Vault URL, root token, and secret paths with key-value entries.</p>
                <ul class="list-disc list-inside space-y-1.5 ml-1">
                  <li><strong>Existence guard</strong> — Existing secrets are skipped (not overwritten).</li>
                  <li><strong>Auto-cleanup</strong> — Mouseketool-created secrets are deleted after invocation.</li>
                  <li><strong>KV engine</strong> — Auto-detects KV v1 or v2.</li>
                </ul>
                <p class="font-medium text-foreground">Docker networking</p>
                <p>Lambda containers can't reach <code class="text-xs bg-muted px-1 rounded">localhost</code>. Use <code class="text-xs bg-muted px-1 rounded">host.docker.internal</code> for host services, or container hostnames for same-network services.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Heavy Load & Debug -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('tl-heavy')">
            <component :is="isOpen('tl-heavy') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Layers class="size-3.5 text-muted-foreground" /> Heavy Load & Debug Mode
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('tl-heavy') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p class="font-medium text-foreground">Heavy Load</p>
                <p>Increases DynamoDB Stream batch size and window for high-throughput scenarios. Configurable from Settings, applies retroactively. A pulsating orange banner on History shows active batch insertions.</p>
                <p class="font-medium text-foreground">Debug Mode</p>
                <p>Runs Lambda with <code class="text-xs bg-muted px-1 rounded">-verbose:class -Xlog:exceptions=info</code> JVM flags for detailed class-loading and exception traces. Flags are automatically cleaned up after invoke.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI & AUTOMATION -->
    <div v-if="active === 'ai'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Sparkles class="size-4 text-violet-500" /> AI & Automation</h3>
        <div class="flex gap-1">
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(['ai-features','ai-healing'])" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
          <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(['ai-features','ai-healing'])" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
        </div>
      </div>
      <div class="space-y-2">
        <!-- AI Features -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('ai-features')">
            <component :is="isOpen('ai-features') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <Sparkles class="size-3.5 text-violet-500" /> Kiro AI Features
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('ai-features') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>Mouseketool integrates with Kiro CLI. When detected, a glowing purple badge appears in the header.</p>
                <p class="font-medium text-foreground">Error Explanation</p>
                <p>When a Lambda fails, <strong>Explain with Kiro</strong> sends the error context for a plain-English explanation and fix suggestion.</p>
                <p class="font-medium text-foreground">Payload Generation</p>
                <p>Configure a <strong>Sample Path</strong> pointing to JSON samples and source code. The <strong>Generate</strong> button offers Successful and Failure payload options.</p>
                <p class="font-medium text-foreground">Pipeline Item Generation</p>
                <p>Generate items matching the pipeline's expected input. Options: Successful, Filtered (fails SNS filter), and Failure. Uses learned data, key schema, filter policy, and favorites as context.</p>
                <p class="font-medium text-foreground">Learning & Evaluation</p>
                <p>Learns from successful executions (up to 50 items per pipeline). Use <strong>Evaluate</strong> to rate quality — good samples become favorites, bad samples include feedback for improvement.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Self-Healing -->
        <div class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
          <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle('ai-healing')">
            <component :is="isOpen('ai-healing') ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
            <RefreshCw class="size-3.5 text-violet-500" /> Pipeline Self-Healing
          </button>
          <div class="grid transition-all duration-300 ease-in-out" :class="isOpen('ai-healing') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
              <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground space-y-3 border-l-2 border-l-zinc-500/30 ml-4">
                <p>When LocalStack restarts, all resources are deleted. Mouseketool detects this and recreates everything from locally persisted metadata.</p>
                <p class="font-medium text-foreground">How it works</p>
                <p>A health monitor polls every 5 seconds. On recovery, a blocking overlay ("Restoring AWS Resources") appears while full reconciliation runs.</p>
                <p class="font-medium text-foreground">What gets recreated</p>
                <ul class="list-disc list-inside space-y-1.5 ml-1">
                  <li><strong>DynamoDB tables</strong> — From saved schemas (or generic pk/sk if none saved).</li>
                  <li><strong>SNS topics & SQS queues</strong> — Same names, DLQ and redrive policies re-established.</li>
                  <li><strong>Stream handler</strong> — Redeployed from template with same env vars.</li>
                  <li><strong>Target Lambda</strong> — Redeployed from cached build. Warning icon if build was deleted.</li>
                  <li><strong>Event source mappings</strong> — DynamoDB→handler and SQS→Lambda with same batch settings.</li>
                  <li><strong>SNS subscriptions</strong> — Same filter policy and scope.</li>
                </ul>
                <p class="font-medium text-foreground">Vault secrets</p>
                <p>Secret values are never stored. After reconciliation, an amber "Secrets need recreation" badge appears — recreate manually via the Vault add-on.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SHORTCUTS -->
    <div v-if="active === 'shortcuts'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><Keyboard class="size-4 text-muted-foreground" /> Keyboard Shortcuts</h3>
      </div>
      <div class="text-sm text-muted-foreground space-y-3">
        <p>Mouseketool supports keyboard shortcuts for common actions:</p>
        <div class="space-y-2">
          <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <code class="text-xs bg-zinc-950 text-zinc-300 border border-zinc-800 px-2.5 py-1 rounded font-mono shrink-0 shadow-sm">Ctrl + Enter</code>
            <span>Invoke the selected Lambda from the payload editor (Deployments page).</span>
          </div>
          <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <code class="text-xs bg-zinc-950 text-zinc-300 border border-zinc-800 px-2.5 py-1 rounded font-mono shrink-0 shadow-sm">Escape</code>
            <span>Close the expanded log console or any open modal/dialog.</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TROUBLESHOOTING -->
    <div v-if="active === 'troubleshooting'" class="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div class="flex items-center justify-between mb-4">
        <h3 class="flex items-center gap-2 text-base font-semibold"><AlertTriangle class="size-4 text-muted-foreground" /> Troubleshooting</h3>
      </div>
      <div class="text-sm text-muted-foreground space-y-3">
        <p>Common errors and how to fix them:</p>

        <div class="space-y-3">
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">ECONNREFUSED</p>
            <p class="text-xs">LocalStack isn't running, or the host/port in Settings is wrong. Start your LocalStack container and verify connection settings.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">ECONNRESET</p>
            <p class="text-xs">Wrong protocol. If using <code class="text-[10px] bg-muted px-1 rounded">https</code> but LocalStack runs HTTP (or vice versa), switch the protocol in Settings.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">getaddrinfo EAI_AGAIN</p>
            <p class="text-xs">Host field contains a protocol prefix. Remove <code class="text-[10px] bg-muted px-1 rounded">http://</code> and use just the hostname.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">ExceptionInInitializerError</p>
            <p class="text-xs">Class crashed during static initialization — a dependency is unreachable from inside the Lambda container. Use <code class="text-[10px] bg-muted px-1 rounded">host.docker.internal</code> instead of <code class="text-[10px] bg-muted px-1 rounded">localhost</code>. The Local Class Diagnostic shows the full stack trace.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">Vault URL mismatch</p>
            <p class="text-xs">Lambda may be reading from an internal config file rather than the env var. Check <code class="text-[10px] bg-muted px-1 rounded">application.properties</code> for where the Vault URL is sourced.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">Pipeline step times out</p>
            <p class="text-xs">LocalStack's ESM pollers can be slow on the free tier. Try again, restart LocalStack, or check History — the invocation may have happened after the timeout.</p>
          </div>
          <div class="p-3 rounded-lg border border-red-500/10 hover:border-red-500/20 transition-colors">
            <p class="font-medium text-foreground text-xs mb-1">Stale logs from previous invocations</p>
            <p class="text-xs">LocalStack reuses warm containers. Mouseketool mitigates by killing warm containers before invoke and skipping stale log sources. If still seeing stale logs, restart LocalStack.</p>
          </div>
        </div>
      </div>
    </div>

          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-fade-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.tab-fade-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.tab-fade-enter-from { opacity: 0; transform: translateX(8px); }
.tab-fade-leave-to { opacity: 0; transform: translateX(-8px); }

.flow-dash {
  background: repeating-linear-gradient(90deg, currentColor 0, currentColor 4px, transparent 4px, transparent 8px);
  background-size: 200% 100%;
  animation: flow 4s linear infinite;
  height: 1px;
  border: none;
}

@keyframes flow {
  0% { background-position: 0% 0; }
  100% { background-position: -200% 0; }
}
</style>
