<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, inject } from "vue";
import { useRoute } from "vue-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Toggle from "@/components/ui/Toggle.vue";
import FolderBrowser from "@/components/FolderBrowser.vue";
import { Save, Check, Loader2, AlertTriangle, RotateCcw, Power, Square, ChevronLeft, ChevronRight, ChevronDown, Server, KeyRound, Trash2, Clock, Cpu, Flame, Sparkles, Container, Palette, UserCircle, FolderOpen, Download, Hammer, Workflow, Info, ArrowUpCircle } from "lucide-vue-next";

const tab = ref<"connection" | "lambda" | "builds" | "pipelines" | "ai" | "workflows" | "ui" | "profile" | "about">("connection");
const _route = useRoute();
const tabs = [
  { id: "connection" as const, label: "Connection", icon: Server },
  { id: "lambda" as const, label: "Lambda", icon: Cpu },
  { id: "builds" as const, label: "Builds", icon: Hammer },
  { id: "pipelines" as const, label: "Pipelines", icon: Workflow },
  { id: "ai" as const, label: "AI", icon: Sparkles },
  { id: "workflows" as const, label: "Workflows", icon: Container },
  { id: "ui" as const, label: "UI", icon: Palette },
  { id: "profile" as const, label: "Profile", icon: UserCircle },
  { id: "about" as const, label: "About", icon: Info },
];
if (_route.query.tab && tabs.some(t => t.id === _route.query.tab)) tab.value = _route.query.tab as typeof tab.value;

const settings = ref({
  localstack: { host: "localhost", port: 4566, protocol: "http" },
  aws: { accessKeyId: "test", secretAccessKey: "test", region: "us-east-1" },
  cleanup: { ttlMinutes: 1440, deleteOnStartup: false },
  pipeline: { observerPollingMs: 500 },
  lambda: { memoryMB: 2048 },
  heavyLoad: { batchSize: 1000, batchWindowSeconds: 300 },
  ai: { learnedStorage: "local" as "local" | "s3" },
  workflow: { autoBumpHealthchecks: false },
  historyRetention: { mode: "age" as "amount" | "age", maxRuns: 50, maxDays: 2 },
  themeAnimation: true,
  confetti: { enabled: true, onDeploy: true, onInvoke: true, onPipeline: true, onBatch: true, onWorkflow: true },
  localstackManaged: false,
});
const globalThemeAnim = inject<{ value: boolean }>("themeAnimation");
const saving = ref(false);
const lsManaged = computed({ get: () => settings.value.localstackManaged, set: (v: boolean) => { settings.value.localstackManaged = v; } });
const lsStatus = ref<"running" | "exited" | "not_found" | "loading">("loading");
const lsStarting = ref(false);
const lsStopping = ref(false);
const dockerAvailable = ref(true);
const portInUse = ref(false);
const infraPanel = ref(0);
const connMode = ref<'manual' | 'managed'>('manual');

const profiles = ref<any[]>([]);
const profileState = ref<any>(null);
const selectedProfile = ref("");
const workspacePath = ref("");
const showProfileBrowser = ref(false);
const workspaceValid = ref(false);
const autoDownload = ref(false);
const githubAvailable = ref(false);
const profileLoading = ref(false);
const showDestructiveModal = ref(false);
const showUnloadModal = ref(false);
const provisioningActive = ref(false);
const provisioningSteps = ref<{ label: string; status: "pending" | "running" | "done" | "error"; detail?: string }[]>([]);
const buildPanel = ref<{ name: string; status: "building" | "done" | "error" }[]>([]);
const buildPanelOpen = ref(true);
const lsHealthy = ref(false);
const appVersion = ref("");
const updateInfo = inject<{ updateAvailable: any; updateLatest: any; updateUrl: any }>("updateInfo", { updateAvailable: ref(false), updateLatest: ref(""), updateUrl: ref("") });

const saved = ref(false);
const toast = ref("");
const dirty = ref(false);
const initialSettings = ref("");

onMounted(async () => {
  const data = await (await fetch("/api/settings")).json();
  const merged = { ...settings.value, ...data, localstack: { ...settings.value.localstack, ...data.localstack }, pipeline: { ...settings.value.pipeline, ...data.pipeline }, cleanup: { ...settings.value.cleanup, ...data.cleanup }, heavyLoad: { ...settings.value.heavyLoad, ...data.heavyLoad }, ai: { ...settings.value.ai, ...data.ai }, confetti: { ...settings.value.confetti, ...data.confetti }, workflow: { ...settings.value.workflow, ...data.workflow }, historyRetention: { ...settings.value.historyRetention, ...data.historyRetention } };
  initialSettings.value = JSON.stringify(merged);
  if (merged.localstackManaged) connMode.value = 'managed';
  checkDocker(); checkLsStatus();
  settings.value = merged;
  try { const v = await (await fetch("/api/version")).json(); appVersion.value = v.version; } catch {}
});


onMounted(async () => {
  const [pList, pState, ghStatus, health] = await Promise.all([
    fetch("/api/profile").then(r => r.json()).catch(() => []),
    fetch("/api/profile/state").then(r => r.json()).catch(() => null),
    fetch("/api/profile/github-status").then(r => r.json()).catch(() => ({ available: false })),
    fetch("/api/health").then(r => r.json()).catch(() => ({ localstack: false })),
  ]);
  profiles.value = pList;
  profileState.value = pState;
  githubAvailable.value = ghStatus.available;
  lsHealthy.value = health.localstack;
  if (!lsHealthy.value) checkProfileHealth();
  if (pState) { selectedProfile.value = pState.activeProfile; workspacePath.value = pState.workspacePath; autoDownload.value = pState.autoDownload || false; }
});

onMounted(() => {
  setTimeout(() => {
    initialSettings.value = JSON.stringify(settings.value);
    watch(settings, () => { dirty.value = JSON.stringify(settings.value) !== initialSettings.value; }, { deep: true });
  }, 500);
});

async function toggleManaged(v: boolean) { settings.value.localstackManaged = v; connMode.value = v ? 'managed' : 'manual'; initialSettings.value = JSON.stringify(settings.value); await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings.value) }); initialSettings.value = JSON.stringify(settings.value); dirty.value = false; }

async function checkDocker() { try { const r = await (await fetch("/api/localstack/docker-check")).json(); dockerAvailable.value = r.available; portInUse.value = r.portInUse || false; } catch { dockerAvailable.value = false; } }
async function checkLsStatus() { try { const r = await (await fetch("/api/localstack/status")).json(); lsStatus.value = r.status as any; } catch { lsStatus.value = "not_found"; } }
async function startLs() { lsStarting.value = true; try { await fetch("/api/localstack/start", { method: "POST" }); await new Promise(r => setTimeout(r, 2000)); await checkLsStatus(); } finally { lsStarting.value = false; } }
async function stopLs() { lsStopping.value = true; try { await fetch("/api/localstack/stop", { method: "POST" }); await checkLsStatus(); } finally { lsStopping.value = false; } }

async function save() {
  saving.value = true;
  await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings.value) });
  saving.value = false;
  saved.value = true; dirty.value = false; initialSettings.value = JSON.stringify(settings.value);
  if (globalThemeAnim) globalThemeAnim.value = settings.value.themeAnimation;
  setTimeout(() => (saved.value = false), 2000);
}

async function restoreDefaults() {
  const defaults = await (await fetch("/api/settings/defaults")).json();
  defaults.localstackManaged = settings.value.localstackManaged;
  settings.value = defaults;
  await save();
  toast.value = "Defaults applied successfully"; setTimeout(() => { toast.value = ""; }, 3000);
}


watch(tab, async (t) => { if (t === "profile") checkProfileHealth(); });

let healthInterval: any = null;
async function checkProfileHealth() {
  lsHealthy.value = (await fetch("/api/health").then(r => r.json()).catch(() => ({ localstack: false }))).localstack;
  if (!healthInterval && !lsHealthy.value) { healthInterval = setInterval(async () => { await checkProfileHealth(); if (lsHealthy.value && healthInterval) { clearInterval(healthInterval); healthInterval = null; } }, 5000); }
}

function selectWorkspace(path: string) {
  workspacePath.value = path;
  showProfileBrowser.value = false;
  workspaceValid.value = true;
}

function requestLoadProfile() {
  if (!selectedProfile.value || !workspacePath.value.trim() || !lsHealthy.value) return;
  showDestructiveModal.value = true;
}

async function confirmLoadProfile() {
  showDestructiveModal.value = false;
  provisioningActive.value = true;
  provisioningSteps.value = [
    { label: "Cleaning up existing resources...", status: "running" },
    { label: "Scanning workspace...", status: "pending" },
    { label: "Building Lambda projects...", status: "pending" },
    { label: "Deploying to LocalStack...", status: "pending" },
    { label: "Registering batch projects...", status: "pending" },
  ];

  try {
    // Step 1: Cleanup
    await fetch("/api/profile/cleanup", { method: "POST" });
    provisioningSteps.value[0].status = "done";

    // Step 2: Load profile
    await fetch("/api/profile/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.value, workspacePath: workspacePath.value.trim(), autoDownload: autoDownload.value }) });

    // Step 3: Scan
    provisioningSteps.value[1].status = "running";
    const scanRes = await fetch("/api/profile/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: workspacePath.value.trim(), profileId: selectedProfile.value }) });
    const scanResults = await scanRes.json();
    const foundLambdas = scanResults.filter((r: any) => r.type === "lambda" && r.found);
    const foundBatches = scanResults.filter((r: any) => r.type === "batch" && r.found);
    const notFound = scanResults.filter((r: any) => !r.found);
    provisioningSteps.value[1].status = "done";
    provisioningSteps.value[1].detail = foundLambdas.length + " Lambdas, " + foundBatches.length + " batches found" + (notFound.length ? ", " + notFound.length + " missing" : "");

    const clonedRepos = new Set<string>();
    // Step 3.5: Auto-download if enabled
    if (autoDownload.value && notFound.length) {
      provisioningSteps.value.splice(2, 0, { label: "Cloning missing projects...", status: "running" });
      let cloned = 0;
      for (const p of notFound) {
        try {
          const r = await fetch("/api/profile/clone-project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoName: p.repoName, workspacePath: workspacePath.value.trim(), org: profiles.value.find(pr => pr.id === selectedProfile.value)?.org }) });
          if (r.ok) { cloned++; clonedRepos.add(p.repoName); p.found = true; p.path = workspacePath.value.trim() + "/" + p.repoName; }
        } catch {}
      }
      provisioningSteps.value[2].status = "done";
      provisioningSteps.value[2].detail = cloned + "/" + notFound.length + " cloned";
      // Re-scan to update found lists
      const reScan = await (await fetch("/api/profile/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: workspacePath.value.trim(), profileId: selectedProfile.value }) })).json();
      foundLambdas.length = 0;
      foundBatches.length = 0;
      reScan.filter((r: any) => r.type === "lambda" && r.found).forEach((r: any) => foundLambdas.push(r));
      reScan.filter((r: any) => r.type === "batch" && r.found).forEach((r: any) => foundBatches.push(r));
    }

    // Step 4: Build
    const buildIdx = provisioningSteps.value.findIndex(s => s.label.includes("Building"));
    provisioningSteps.value[buildIdx].status = "running";
    const buildResults: any[] = [];
    const CONCURRENCY = 3;
    let buildsDone = 0;
    const buildQueue = [...foundLambdas];
    buildPanel.value = foundLambdas.map((l: any) => ({ name: l.repoName, status: "building" as const }));
    async function runBuild(l: any) {
      try {
        const r = await fetch("/api/builds/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectPath: l.path, freshClone: clonedRepos?.has(l.repoName) || false }) });
        const data = await r.json();
        buildResults.push({ ...l, buildId: data.buildId, handler: data.handler, success: r.ok, parentUpdated: data.parentUpdated });
        const bp = buildPanel.value.find(b => b.name === l.repoName); if (bp) bp.status = r.ok ? "done" : "error";
      } catch { buildResults.push({ ...l, success: false }); const bp = buildPanel.value.find(b => b.name === l.repoName); if (bp) bp.status = "error"; }
      buildsDone++;
      provisioningSteps.value[buildIdx].detail = buildsDone + "/" + foundLambdas.length;
    }
    for (let i = 0; i < buildQueue.length; i += CONCURRENCY) {
      await Promise.all(buildQueue.slice(i, i + CONCURRENCY).map(runBuild));
    }
    provisioningSteps.value[buildIdx].status = "done";
    const pomUpdated = buildResults.filter(b => b.parentUpdated).length;
    provisioningSteps.value[buildIdx].detail = buildResults.filter(b => b.success).length + "/" + foundLambdas.length + " built" + (pomUpdated ? ` (${pomUpdated} parent POM${pomUpdated > 1 ? "s" : ""} updated)` : "");

    // Step 5: Deploy
    const deployIdx = provisioningSteps.value.findIndex(s => s.label.includes("Deploying"));
    provisioningSteps.value[deployIdx].status = "running";
    let deployed = 0;
    const deployable = buildResults.filter(x => x.success && x.buildId);
    await Promise.all(deployable.map(async (b) => {
      try {
        const r = await fetch("/api/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: b.buildId, handler: b.handler, functionName: b.repoName, runtime: "java21" }) });
        if (r.ok) { deployed++; b.deployed = true; }
      } catch {}
    }));
    provisioningSteps.value[deployIdx].status = "done";
    provisioningSteps.value[deployIdx].detail = deployed + " deployed";

    // Step 6: Register batches
    const batchIdx = provisioningSteps.value.findIndex(s => s.label.includes("Registering"));
    provisioningSteps.value[batchIdx].status = "running";
    for (const b of foundBatches) {
      try { await fetch("/api/batch-builds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectPath: b.path }) }); } catch {}
    }
    provisioningSteps.value[batchIdx].status = "done";
    provisioningSteps.value[batchIdx].detail = foundBatches.length + " registered";

    // Save results
    await fetch("/api/profile/save-results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lambdas: buildResults, batches: foundBatches, notFound: scanResults.filter((r: any) => !r.found) }) });
    profileState.value = await (await fetch("/api/profile/state")).json();
  } catch (e: any) {
    const running = provisioningSteps.value.find(s => s.status === "running");
    if (running) { running.status = "error"; running.detail = e.message; }
  }
  profileLoading.value = false;
}

function reloadApp() { window.location.reload(); }

async function unloadProfile() {
  if (!lsHealthy.value) { toast.value = "LocalStack must be running to unload"; setTimeout(() => { toast.value = ""; }, 3000); return; }
  provisioningActive.value = true;
  provisioningSteps.value = [
    { label: "Deleting Lambda functions...", status: "running" },
    { label: "Deleting DynamoDB tables...", status: "pending" },
    { label: "Deleting SNS topics...", status: "pending" },
    { label: "Deleting SQS queues...", status: "pending" },
    { label: "Clearing pipelines and configs...", status: "pending" },
  ];
  await fetch("/api/profile/cleanup", { method: "POST" });
  provisioningSteps.value.forEach(s => s.status = "done");
  provisioningSteps.value.push({ label: "Unloading profile...", status: "running" });
  await fetch("/api/profile/unload", { method: "POST" });
  provisioningSteps.value[provisioningSteps.value.length - 1].status = "done";
  setTimeout(() => window.location.reload(), 1000);
}

</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
        <p class="text-sm text-muted-foreground mt-1">Configure your development environment.</p>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="dirty" class="flex items-center gap-1.5 text-xs text-amber-500"><AlertTriangle class="size-3.5" /> Unsaved changes</span>
      <Button variant="ghost" size="sm" @click="restoreDefaults" :disabled="saving" class="gap-1.5 text-xs text-muted-foreground cursor-pointer"><RotateCcw class="size-3" /> Restore Defaults</Button>
      <Button @click="save" :disabled="saving || !dirty" class="gap-2 cursor-pointer active:scale-95 transition-all">
        <Loader2 v-if="saving" class="size-4 animate-spin" />
        <Check v-else-if="saved" class="size-4" />
        <Save v-else class="size-4" />
        {{ saving ? "Saving..." : saved ? "Saved" : "Save" }}
      </Button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b mb-6">
      <button
        v-for="t in tabs" :key="t.id"
        :class="['flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer -mb-px', tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground']"
        @click="tab = t.id"
      >
        <component :is="t.icon" class="size-3.5" />
        {{ t.label }}
      </button>
    </div>
    <!-- Connection Tab -->
    <div v-show="tab === 'connection'" class="space-y-6">
      <!-- Section selector -->
      <div class="flex gap-2">
        <button @click="connMode = 'manual'" :class="['flex-1 rounded-lg border px-4 py-3 text-left transition-all cursor-pointer', connMode === 'manual' ? 'border-primary/50 bg-primary/5' : 'border-white/10 opacity-50']">
          <p class="text-sm font-medium">Manual</p>
          <p class="text-[11px] text-muted-foreground mt-0.5">Configure endpoint and credentials manually.</p>
        </button>
        <button @click="connMode = 'managed'" :class="['flex-1 rounded-lg border px-4 py-3 text-left transition-all cursor-pointer', connMode === 'managed' ? 'border-primary/50 bg-primary/5' : 'border-white/10 opacity-50']">
          <p class="text-sm font-medium">Managed</p>
          <p class="text-[11px] text-muted-foreground mt-0.5">Let Mouseketool manage infrastructure via Docker.</p>
        </button>
      </div>

      <!-- Managed Section -->
      <div v-show="connMode === 'managed'">
        <div class="relative">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] text-muted-foreground uppercase tracking-wider">Infrastructure Provider</span>
            <div class="flex items-center gap-1">
              <button class="size-6 flex items-center justify-center rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer disabled:opacity-30" :disabled="infraPanel === 0" @click="infraPanel = 0"><ChevronLeft class="size-3.5" /></button>
              <span class="text-[10px] text-muted-foreground tabular-nums">{{ infraPanel + 1 }} / 2</span>
              <button class="size-6 flex items-center justify-center rounded-md hover:bg-white/[0.05] transition-colors cursor-pointer disabled:opacity-30" :disabled="infraPanel === 1" @click="infraPanel = 1"><ChevronRight class="size-3.5" /></button>
            </div>
          </div>
          <div class="overflow-hidden rounded-xl">
            <div class="flex transition-transform duration-300 ease-in-out" :style="{ transform: `translateX(-${infraPanel * 100}%)` }">
              <!-- LocalStack Panel -->
              <div class="w-full shrink-0">
                <div class="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 p-5">
                  <div class="flex items-center justify-between">
                    <div>
                      <h2 class="text-sm font-medium">Managed LocalStack Instance</h2>
                      <p class="text-[11px] text-muted-foreground mt-0.5">Let Mouseketool manage a LocalStack container for you via Docker.</p>
                    </div>
                    <Tooltip><TooltipTrigger as-child><span class="inline-flex"><Toggle :model-value="lsManaged" @update:model-value="toggleManaged" :disabled="!dockerAvailable || lsStatus === 'running' || lsStarting" /></span></TooltipTrigger><TooltipContent>{{ lsStarting ? "Can't disable while the container is starting" : lsStatus === "running" ? "Stop the container before disabling" : !dockerAvailable ? "Docker not detected" : "Enable managed LocalStack" }}</TooltipContent></Tooltip>
                  </div>
                  <div v-if="!dockerAvailable" class="text-[11px] text-amber-500 flex items-center gap-1.5 mt-3"><AlertTriangle class="size-3" /> Docker not detected. Install Docker to enable this feature.</div>
                  <div v-if="dockerAvailable && portInUse && !lsManaged" class="text-[11px] text-amber-500 flex items-center gap-1.5 mt-3"><AlertTriangle class="size-3" /> Port 4566 is already in use.</div>
                  <div class="space-y-4 mt-4">
                    <div class="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3">
                      <div class="flex items-center gap-3">
                        <span v-if="lsStatus === 'running'" class="relative flex size-2.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span class="relative inline-flex rounded-full size-2.5 bg-emerald-500" /></span>
                        <div v-else :class="['size-2.5 rounded-full', lsStatus === 'loading' ? 'bg-zinc-500 animate-pulse' : 'bg-zinc-600']" />
                        <div>
                          <p class="text-xs font-medium">{{ lsStatus === "running" ? "Running" : lsStatus === "exited" ? "Stopped" : lsStatus === "loading" ? "Checking..." : "Not Started" }}</p>
                          <p class="text-[10px] text-muted-foreground font-mono">mouseketool-localstack · localstack/localstack:community-archive</p>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button v-if="lsStatus !== 'running'" size="sm" @click="startLs" :disabled="!lsManaged || lsStarting || lsStatus === 'loading'" class="gap-1.5 text-xs h-7 cursor-pointer"><Loader2 v-if="lsStarting" class="size-3 animate-spin" /><Power v-else class="size-3" /> {{ lsStarting ? "Starting..." : "Start" }}</Button>
                        <Button v-else variant="outline" size="sm" @click="stopLs" :disabled="!lsManaged || lsStopping" class="gap-1.5 text-xs h-7 cursor-pointer text-red-400 hover:text-red-300"><Loader2 v-if="lsStopping" class="size-3 animate-spin" /><Square v-else class="size-3" /> {{ lsStopping ? "Stopping..." : "Stop" }}</Button>
                      </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-[11px]">
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Endpoint</p><p class="font-mono mt-0.5">http://localhost:4566</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Network</p><p class="font-mono mt-0.5">mouseketool-network</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Data Persistence</p><p class="font-mono mt-0.5">.data/localstack-data</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Host Access</p><p class="font-mono mt-0.5">host.docker.internal</p></div>
                    </div>
                    <p class="text-[10px] text-muted-foreground">Lambdas can reach host services via <code class="text-[10px]">host.docker.internal</code>.</p>
                  </div>
                </div>
              </div>
              <!-- MiniStack Panel -->
              <div class="w-full shrink-0">
                <div class="rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-5">
                  <div class="flex items-center justify-between mb-3">
                    <div>
                      <h2 class="text-sm font-medium flex items-center gap-2">Managed MiniStack Instance <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">Coming soon</span></h2>
                      <p class="text-[11px] text-muted-foreground mt-0.5">MIT-licensed AWS emulator - free forever, no account required.</p>
                    </div>
                    <Tooltip><TooltipTrigger as-child><span class="inline-flex"><Toggle :model-value="false" disabled /></span></TooltipTrigger><TooltipContent>Coming in a future release</TooltipContent></Tooltip>
                  </div>
                  <div class="space-y-3 opacity-50">
                    <div class="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3"><div class="flex items-center gap-3"><div class="size-2.5 rounded-full bg-zinc-600" /><div><p class="text-xs font-medium">Not Available</p><p class="text-[10px] text-muted-foreground font-mono">mouseketool-ministack · ministackorg/ministack:latest</p></div></div></div>
                    <div class="grid grid-cols-2 gap-3 text-[11px]">
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Image Size</p><p class="font-mono mt-0.5">~270 MB</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">RAM at Idle</p><p class="font-mono mt-0.5">~21 MB</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Startup</p><p class="font-mono mt-0.5">&lt; 2 seconds</p></div>
                      <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">License</p><p class="font-mono mt-0.5">MIT - Free forever</p></div>
                    </div>
                    <p class="text-[10px] text-muted-foreground">Drop-in LocalStack replacement with 40+ AWS services. No account, no API key, no telemetry.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Manual Section -->
      <div v-show="connMode === 'manual'" class="space-y-6">
        <div>
          <h2 class="text-sm font-medium mb-1">LocalStack Endpoint</h2>
          <p class="text-xs text-muted-foreground mb-4">The endpoint where your LocalStack instance is running.</p>
          <div class="grid grid-cols-[auto_1fr_auto] gap-4 items-end">
            <div class="space-y-2">
              <Label>Protocol</Label>
              <Select v-model="settings.localstack.protocol">
                <SelectTrigger class="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="https">https</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label for="host">Host / IP Address</Label>
              <Input id="host" v-model="settings.localstack.host" placeholder="localhost" />
            </div>
            <div class="space-y-2">
              <Label for="port">Port</Label>
              <Input id="port" v-model.number="settings.localstack.port" type="number" placeholder="4566" />
            </div>
          </div>
        </div>

        <div>
          <h2 class="text-sm font-medium mb-1">AWS Credentials</h2>
          <p class="text-xs text-muted-foreground mb-4">Credentials used to authenticate with LocalStack. Typically dummy values.</p>
          <div class="grid grid-cols-3 gap-4">
            <div class="space-y-2">
              <Label for="ak">Access Key ID</Label>
              <Input id="ak" v-model="settings.aws.accessKeyId" />
            </div>
            <div class="space-y-2">
              <Label for="sk">Secret Access Key</Label>
              <Input id="sk" v-model="settings.aws.secretAccessKey" type="password" />
            </div>
            <div class="space-y-2">
              <Label for="region">Region</Label>
              <Input id="region" v-model="settings.aws.region" placeholder="us-east-1" />
            </div>
          </div>
        </div>
      </div>
    </div>


    <!-- Lambda Tab -->
    <div v-show="tab === 'lambda'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4">
        <h2 class="text-sm font-medium mb-1">Default Memory</h2>
        <p class="text-xs text-muted-foreground mb-4">Applied to every Lambda deployed from the Builder page.</p>
        <select v-model.number="settings.lambda.memoryMB" class="h-9 text-sm bg-background border rounded-md px-3 outline-none max-w-48">
          <option v-for="m in [128, 256, 512, 1024, 1536, 2048, 3008]" :key="m" :value="m">{{ m }} MB</option>
        </select>
        <p class="text-xs text-muted-foreground mt-2">Default: 2048 MB. Higher memory also allocates more CPU.</p>
      </div>
    </div>

    <!-- Builds Tab -->
    <div v-show="tab === 'builds'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4">
        <h2 class="text-sm font-medium mb-1">Auto-Cleanup</h2>
        <p class="text-xs text-muted-foreground mb-4">Cached builds older than this threshold are automatically deleted.</p>
        <div class="space-y-2">
          <Label for="ttl">Delete after (minutes)</Label>
          <Input id="ttl" v-model.number="settings.cleanup.ttlMinutes" type="number" class="max-w-48" :disabled="settings.cleanup.deleteOnStartup" />
          <p class="text-xs text-muted-foreground">Default: 1440 minutes (24 hours)</p>
        </div>
      </div>

      <div class="rounded-lg border p-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-medium">Delete on startup</h2>
            <p class="text-xs text-muted-foreground mt-0.5">Remove all cached builds every time the backend starts.</p>
          </div>
          <Toggle v-model="settings.cleanup.deleteOnStartup" />
        </div>
      </div>
    </div>

    <!-- Pipelines Tab -->
    <div v-show="tab === 'pipelines'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4">
        <h2 class="text-sm font-medium mb-1">History Retention</h2>
        <p class="text-xs text-muted-foreground mb-4">Control how long pipeline invocation history is kept.</p>
        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <Label class="text-sm shrink-0">Mode:</Label>
            <Select v-model="settings.historyRetention.mode"><SelectTrigger class="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="age">By age</SelectItem><SelectItem value="amount">By amount</SelectItem></SelectContent></Select>
            <Input v-if="settings.historyRetention.mode === 'age'" v-model.number="settings.historyRetention.maxDays" type="number" min="1" max="10" class="max-w-24" />
            <Input v-if="settings.historyRetention.mode === 'amount'" v-model.number="settings.historyRetention.maxRuns" type="number" min="5" max="500" class="max-w-24" />
            <span class="text-xs text-muted-foreground">{{ settings.historyRetention.mode === "age" ? "days" : "runs per pipeline" }}</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border p-4">
        <h2 class="text-sm font-medium mb-1">Heavy Load</h2>
        <p class="text-xs text-muted-foreground mb-4">Batch settings for pipelines with heavy load enabled.</p>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="hlBatchSize">Batch Size</Label>
            <Input id="hlBatchSize" v-model.number="settings.heavyLoad.batchSize" type="number" min="1" max="10000" />
            <p class="text-xs text-muted-foreground">Max records per invocation. Default: 1000.</p>
          </div>
          <div class="space-y-2">
            <Label for="hlWindow">Batch Window (seconds)</Label>
            <Input id="hlWindow" v-model.number="settings.heavyLoad.batchWindowSeconds" type="number" min="1" max="300" />
            <p class="text-xs text-muted-foreground">Max wait before firing. Default: 300s.</p>
          </div>
        </div>
        <p class="text-xs text-amber-500 mt-3">Saving will immediately update all pipelines with heavy load enabled.</p>
      </div>
    </div>

    <!-- AI Tab -->
    <div v-show="tab === 'ai'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4">
        <h2 class="text-sm font-medium mb-1">Learned Data Storage</h2>
        <p class="text-xs text-muted-foreground mb-4">Where Kiro stores learned data from pipeline runs and evaluations.</p>
        <div class="flex items-center gap-3">
          <button @click="settings.ai.learnedStorage = 'local'" class="flex-1 rounded-lg border p-4 text-left text-xs transition-colors cursor-pointer" :class="settings.ai.learnedStorage === 'local' ? 'border-primary bg-primary/5' : 'hover:bg-muted'">
            <p class="font-medium">Local</p>
            <p class="text-muted-foreground mt-1">Stored in .data/learned/. Persists across LocalStack restarts.</p>
          </button>
          <button @click="settings.ai.learnedStorage = 's3'" class="flex-1 rounded-lg border p-4 text-left text-xs transition-colors cursor-pointer" :class="settings.ai.learnedStorage === 's3' ? 'border-primary bg-primary/5' : 'hover:bg-muted'">
            <p class="font-medium">S3</p>
            <p class="text-muted-foreground mt-1">Stored in LocalStack S3. Shared across tools.</p>
          </button>
        </div>
        <p v-if="settings.ai.learnedStorage === 's3'" class="text-xs text-amber-500 mt-3">Warning: Data stored in S3 will be lost if LocalStack restarts without persistence.</p>
      </div>
    </div>

    <!-- Workflows Tab -->
    <div v-show="tab === 'workflows'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4"><div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium">Auto-bump healthchecks</h2>
          <p class="text-xs text-muted-foreground mt-0.5 max-w-md">Automatically increase healthcheck intervals, timeouts, start periods, and retries when importing a docker-compose file. Also auto-adds healthchecks for MySQL, Postgres, and Redis containers.</p>
        </div>
        <button class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0" :class="settings.workflow.autoBumpHealthchecks ? 'bg-primary' : 'bg-muted'" @click="settings.workflow.autoBumpHealthchecks = !settings.workflow.autoBumpHealthchecks">
          <span class="inline-block size-3.5 transform rounded-full bg-white transition-transform" :class="settings.workflow.autoBumpHealthchecks ? 'translate-x-4.5' : 'translate-x-0.5'" />
        </button>
      </div></div>
    </div>
    <div v-show="tab === 'ui'" class="grid grid-cols-2 gap-4 items-start">
      <div class="rounded-lg border p-4 space-y-4"><div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium">Confetti celebrations</h2>
          <p class="text-xs text-muted-foreground mt-0.5 max-w-md">Show a confetti burst when actions complete successfully.</p>
        </div>
        <Toggle v-model="settings.confetti.enabled" />
      </div>
      <div class="space-y-2.5 pl-1" :class="!settings.confetti.enabled && 'opacity-40 pointer-events-none'">
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" v-model="settings.confetti.onDeploy" class="rounded size-3.5 accent-primary" /> When a Lambda is deployed to LocalStack</label>
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" v-model="settings.confetti.onInvoke" class="rounded size-3.5 accent-primary" /> When a Lambda invocation succeeds</label>
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" v-model="settings.confetti.onPipeline" class="rounded size-3.5 accent-primary" /> When a pipeline execution completes successfully</label>
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" v-model="settings.confetti.onBatch" class="rounded size-3.5 accent-primary" /> When a batch run finishes without errors</label>
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" v-model="settings.confetti.onWorkflow" class="rounded size-3.5 accent-primary" /> When a workflow completes with all nodes healthy</label>
      </div></div>
      <div class="rounded-lg border p-4"><div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium">Theme transition animation</h2>
          <p class="text-xs text-muted-foreground mt-0.5 max-w-md">Circular reveal animation when switching between dark and light mode.</p>
        </div>
        <Toggle v-model="settings.themeAnimation" />
      </div></div>
    </div>
    <!-- Profile Tab -->
    <div v-show="tab === 'profile'" class="space-y-6">
      <div>
        <h2 class="text-sm font-medium">Workspace Directory</h2>
        <p class="text-xs text-muted-foreground mt-0.5 mb-3">Root folder where your team's repositories are cloned.</p>
        <div class="flex gap-2">
          <Input v-model="workspacePath" placeholder="C:/repos/team" class="flex-1 text-sm" :disabled="!!profileState" />
          <Button variant="outline" size="sm" @click="showProfileBrowser = true" :disabled="!!profileState" class="gap-1.5 cursor-pointer"><FolderOpen class="size-3.5" />Browse</Button>
        </div>
        <p v-if="workspaceValid" class="text-xs text-green-500 mt-1">✓ Valid workspace directory</p>
      </div>

      <div>
        <h2 class="text-sm font-medium">Profile</h2>
        <p class="text-xs text-muted-foreground mt-0.5 mb-3">Select a development profile to load.</p>
        <Select v-model="selectedProfile" :disabled="!!profileState || !workspacePath.trim()">
          <SelectTrigger class="w-full"><SelectValue placeholder="Select a profile..." /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
          </SelectContent>
        </Select>
        <p v-if="selectedProfile" class="text-xs text-muted-foreground mt-1.5">{{ profiles.find(p => p.id === selectedProfile)?.description }}</p>
      </div>

      <div class="flex items-center gap-2" :class="!githubAvailable && 'opacity-40 pointer-events-none'">
        <input type="checkbox" v-model="autoDownload" :disabled="!!profileState || !githubAvailable" class="rounded size-3.5 accent-primary" id="auto-dl" />
        <label for="auto-dl" class="text-xs cursor-pointer">Auto-download all projects I have access to</label>
        <Tooltip v-if="!githubAvailable"><TooltipTrigger><span class="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 font-medium">Requires Kiro + GitHub MCP</span></TooltipTrigger><TooltipContent><p class="text-xs">Install Kiro CLI and configure a GitHub MCP server to enable auto-cloning.</p></TooltipContent></Tooltip>
      </div>

      <div class="flex items-center gap-3">
        <Button v-if="!profileState" @click="requestLoadProfile" :disabled="!selectedProfile || !workspacePath.trim() || !lsHealthy" class="gap-2 cursor-pointer active:scale-95 transition-all">
          <Download class="size-4" /> Load Profile
        </Button>
        <Button v-else variant="destructive" @click="showUnloadModal = true" class="gap-2 cursor-pointer active:scale-95 transition-all">
          Unload Profile
        </Button>
        <span v-if="!lsHealthy" class="text-xs text-amber-500 flex items-center gap-1"><AlertTriangle class="size-3" />LocalStack must be running</span>
      </div>

      <div v-if="profileState" class="rounded-lg border p-4 bg-muted/30 space-y-2">
        <p class="text-sm font-medium">Active: {{ profiles.find(p => p.id === profileState.activeProfile)?.name }}</p>
        <p class="text-xs text-muted-foreground">Workspace: {{ profileState.workspacePath }}</p>
        <p class="text-xs text-muted-foreground">Loaded: {{ new Date(profileState.loadedAt).toLocaleString() }}</p>
      </div>
    </div>

    <!-- Destructive Load Modal -->
    <div v-if="showDestructiveModal" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 animate-in fade-in duration-200">
      <div class="bg-background border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
        <h2 class="text-lg font-semibold">Load Profile - Clean Slate Required</h2>
        <p class="text-sm text-muted-foreground">Loading a profile will delete all existing resources in LocalStack to ensure a clean workspace. This includes:</p>
        <ul class="text-xs text-muted-foreground space-y-1 pl-4 list-disc">
          <li>All deployed Lambda functions</li>
          <li>All DynamoDB tables</li>
          <li>All SNS topics and subscriptions</li>
          <li>All SQS queues and event source mappings</li>
          <li>All saved pipelines and their configurations</li>
          <li>All vault add-on configurations</li>
          <li>All cached builds</li>
        </ul>
        <p class="text-xs text-amber-500 font-medium">This action cannot be undone.</p>
        <div class="flex justify-end gap-3 pt-2">
          <Button variant="ghost" size="sm" @click="showDestructiveModal = false" class="cursor-pointer">Cancel</Button>
          <Button variant="destructive" size="sm" @click="confirmLoadProfile" class="cursor-pointer">Continue and Wipe</Button>
        </div>
      </div>
    </div>

    <!-- Unload Confirmation Modal -->
    <div v-if="showUnloadModal" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 animate-in fade-in duration-200">
      <div class="bg-background border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4 animate-in zoom-in-95 duration-200">
        <h2 class="text-lg font-semibold">Unload Profile</h2>
        <p class="text-sm text-muted-foreground">Unloading the active profile will delete all resources from LocalStack and reset Mouseketool. This includes:</p>
        <ul class="text-xs text-muted-foreground space-y-1 pl-4 list-disc">
          <li>All deployed Lambda functions</li>
          <li>All DynamoDB tables</li>
          <li>All SNS topics and subscriptions</li>
          <li>All SQS queues and event source mappings</li>
          <li>All saved pipelines and their configurations</li>
          <li>All vault add-on configurations</li>
          <li>All registered batch projects</li>
          <li>All cached builds</li>
        </ul>
        <p class="text-xs text-muted-foreground">Your workspace files will not be modified.</p>
        <p class="text-xs text-amber-500 font-medium">The app will reload after unloading.</p>
        <div class="flex justify-end gap-3 pt-2">
          <Button variant="ghost" size="sm" @click="showUnloadModal = false" class="cursor-pointer">Cancel</Button>
          <Button variant="destructive" size="sm" @click="showUnloadModal = false; unloadProfile()" class="cursor-pointer">Unload and Wipe</Button>
        </div>
      </div>
    </div>

    <!-- Provisioning Overlay -->
    <div v-if="provisioningActive" class="fixed inset-0 z-[300] flex items-center justify-center bg-background/95 backdrop-blur-sm animate-in fade-in duration-300">
      <div class="max-w-lg w-full mx-4 space-y-6">
        <div class="text-center">
          <h2 class="text-xl font-semibold">Loading Profile</h2>
          <p class="text-sm text-muted-foreground mt-1">{{ profiles.find(p => p.id === selectedProfile)?.name }}</p>
        </div>
        <div class="space-y-3">
          <div v-for="(step, i) in provisioningSteps" :key="i" class="flex items-center gap-3 text-sm">
            <Loader2 v-if="step.status === 'running'" class="size-4 animate-spin text-primary shrink-0" />
            <Check v-else-if="step.status === 'done'" class="size-4 text-green-500 shrink-0" />
            <AlertTriangle v-else-if="step.status === 'error'" class="size-4 text-red-500 shrink-0" />
            <div v-else class="size-4 rounded-full border-2 border-muted shrink-0" />
            <div class="flex-1">
              <span :class="step.status === 'pending' && 'text-muted-foreground'">{{ step.label }}</span>
              <span v-if="step.detail" class="text-xs text-muted-foreground ml-2">{{ step.detail }}</span>
            </div>
          </div>
        </div>
        <!-- Build panel -->
        <div v-if="buildPanel.length" class="rounded-lg border bg-muted/20 overflow-hidden">
          <button class="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer" @click="buildPanelOpen = !buildPanelOpen">
            <span>Build details</span>
            <span class="flex items-center gap-1.5"><span class="font-mono">{{ buildPanel.filter(b => b.status === 'done').length }}/{{ buildPanel.length }}</span><ChevronDown class="size-3 transition-transform" :class="buildPanelOpen ? 'rotate-180' : ''"/></span>
          </button>
          <div v-if="buildPanelOpen" class="max-h-32 overflow-y-auto border-t px-3 py-1.5 space-y-1">
            <div v-for="b in buildPanel" :key="b.name" class="flex items-center gap-2 text-xs">
              <Check v-if="b.status === 'done'" class="size-3 text-green-500 shrink-0" />
              <AlertTriangle v-else-if="b.status === 'error'" class="size-3 text-red-500 shrink-0" />
              <Loader2 v-else class="size-3 animate-spin text-muted-foreground shrink-0" />
              <span :class="b.status === 'building' ? 'text-foreground' : 'text-muted-foreground'">{{ b.name }}</span>
            </div>
          </div>
        </div>

        <div v-if="provisioningSteps.every(s => s.status === 'done' || s.status === 'error')" class="text-center pt-4">
          <Button @click="reloadApp" class="cursor-pointer">Done</Button>
        </div>
      </div>
    </div>

    <!-- About Tab -->
    <div v-show="tab === 'about'" class="space-y-6 flex flex-col items-center text-center py-8">
      <div class="flex flex-col items-center gap-3">
        <div class="flex aspect-square size-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="size-8 fill-current"><circle cx="50" cy="60" r="35"/><circle cx="22" cy="28" r="20"/><circle cx="78" cy="28" r="20"/></svg>
        </div>
        <h2 class="text-xl font-bold">Mouseketool</h2>
        <p class="text-sm text-muted-foreground">Developer Workbench</p>
        <p class="text-sm font-mono">v{{ appVersion }}</p>
      </div>
      <div v-if="updateInfo.updateAvailable.value" class="flex items-center gap-3 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
        <ArrowUpCircle class="size-5 text-emerald-500 shrink-0" />
        <div class="flex-1">
          <p class="text-sm font-medium">Update available: v{{ updateInfo.updateLatest.value }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">A newer version of Mouseketool is available.</p>
        </div>
        <a :href="updateInfo.updateUrl.value" target="_blank" class="text-xs font-medium text-emerald-500 hover:underline cursor-pointer">Download</a>
      </div>
      <div v-else class="flex items-center gap-2 text-sm text-muted-foreground"><Check class="size-4 text-emerald-500" /> You're on the latest version.</div>
      <div class="space-y-2 text-sm text-muted-foreground">
        <p>Build, deploy, and invoke Lambdas. Create event pipelines. Orchestrate batch workflows. AI-assisted — all from one UI.</p>
        <p class="text-xs">Internal tool - not for public distribution.</p>
      </div>
    </div>

    <FolderBrowser v-model="showProfileBrowser" title="Select Workspace Directory" description="Navigate to the root folder where your team repositories are cloned." @select="selectWorkspace" />
    <div v-if="toast" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg bg-green-600 animate-in fade-in slide-in-from-bottom-3 duration-300">{{ toast }}</div>
  </div>
</template>
