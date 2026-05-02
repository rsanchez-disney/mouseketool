<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from "vue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Toggle from "@/components/ui/Toggle.vue";
import { Save, Check, Loader2, AlertTriangle, RotateCcw, Power, Square, ChevronLeft, ChevronRight, Server, KeyRound, Trash2, Clock, Cpu, Flame, Sparkles, Container, Palette } from "lucide-vue-next";

const tab = ref<"connection" | "lambda" | "builds" | "pipelines" | "ai" | "workflows" | "ui">("connection");
const tabs = [
  { id: "connection" as const, label: "Connection", icon: Server },
  { id: "lambda" as const, label: "Lambda", icon: Cpu },
  { id: "builds" as const, label: "Builds", icon: Trash2 },
  { id: "pipelines" as const, label: "Pipelines", icon: Clock },
  { id: "ai" as const, label: "AI", icon: Sparkles },
  { id: "workflows" as const, label: "Workflows", icon: Container },
  { id: "ui" as const, label: "UI", icon: Palette },
];

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
  confetti: { enabled: true, onDeploy: true, onInvoke: true, onPipeline: true, onBatch: true, onWorkflow: true },
  localstackManaged: false,
});
const saving = ref(false);
const lsManaged = computed({ get: () => settings.value.localstackManaged, set: (v: boolean) => { settings.value.localstackManaged = v; } });
const lsStatus = ref<"running" | "exited" | "not_found" | "loading">("loading");
const lsStarting = ref(false);
const lsStopping = ref(false);
const dockerAvailable = ref(true);
const portInUse = ref(false);
const infraPanel = ref(0);
const saved = ref(false);
const toast = ref("");
const dirty = ref(false);
const initialSettings = ref("");

onMounted(async () => {
  const data = await (await fetch("/api/settings")).json();
  const merged = { ...settings.value, ...data, localstack: { ...settings.value.localstack, ...data.localstack }, pipeline: { ...settings.value.pipeline, ...data.pipeline }, cleanup: { ...settings.value.cleanup, ...data.cleanup }, heavyLoad: { ...settings.value.heavyLoad, ...data.heavyLoad }, ai: { ...settings.value.ai, ...data.ai }, confetti: { ...settings.value.confetti, ...data.confetti }, workflow: { ...settings.value.workflow, ...data.workflow }, historyRetention: { ...settings.value.historyRetention, ...data.historyRetention } };
  initialSettings.value = JSON.stringify(merged);
  checkDocker(); checkLsStatus();
  settings.value = merged;
});

onMounted(() => {
  setTimeout(() => {
    initialSettings.value = JSON.stringify(settings.value);
    watch(settings, () => { dirty.value = JSON.stringify(settings.value) !== initialSettings.value; }, { deep: true });
  }, 500);
});

async function toggleManaged(v: boolean) { settings.value.localstackManaged = v; await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings.value) }); initialSettings.value = JSON.stringify(settings.value); dirty.value = false; }

async function checkDocker() { try { const r = await (await fetch("/api/localstack/docker-check")).json(); dockerAvailable.value = r.available; portInUse.value = r.portInUse || false; } catch { dockerAvailable.value = false; } }
async function checkLsStatus() { try { const r = await (await fetch("/api/localstack/status")).json(); lsStatus.value = r.status as any; } catch { lsStatus.value = "not_found"; } }
async function startLs() { lsStarting.value = true; try { await fetch("/api/localstack/start", { method: "POST" }); await new Promise(r => setTimeout(r, 2000)); await checkLsStatus(); } finally { lsStarting.value = false; } }
async function stopLs() { lsStopping.value = true; try { await fetch("/api/localstack/stop", { method: "POST" }); await checkLsStatus(); } finally { lsStopping.value = false; } }

async function save() {
  saving.value = true;
  await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings.value) });
  saving.value = false;
  saved.value = true; dirty.value = false; initialSettings.value = JSON.stringify(settings.value);
  setTimeout(() => (saved.value = false), 2000);
}

async function restoreDefaults() {
  const defaults = await (await fetch("/api/settings/defaults")).json();
  defaults.localstackManaged = settings.value.localstackManaged;
  settings.value = defaults;
  await save();
  toast.value = "Defaults applied successfully"; setTimeout(() => { toast.value = ""; }, 3000);
}

</script>

<template>
  <div class="max-w-3xl mx-auto">
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
      <!-- Infrastructure Carousel -->
      <div class="relative mb-6">
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
            <div class="w-full shrink-0">
      <!-- LocalStack Management -->
      <div class="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 p-5 mb-6">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-sm font-medium flex items-center gap-2">Managed LocalStack Instance</h2>
            <p class="text-[11px] text-muted-foreground mt-0.5">Let Mouseketool manage a LocalStack container for you via Docker.</p>
          </div>
          <Tooltip><TooltipTrigger as-child><span class="inline-flex"><Toggle :model-value="lsManaged" @update:model-value="toggleManaged" :disabled="!dockerAvailable || portInUse || lsStatus === 'running' || lsStarting" /></span></TooltipTrigger><TooltipContent>{{ lsStarting ? "Can't disable while the container is starting" : lsStatus === "running" ? "Stop the container before disabling" : !dockerAvailable ? "Docker not detected" : portInUse ? "Port 4566 in use" : "Enable managed LocalStack" }}</TooltipContent></Tooltip>
        </div>

        <div v-if="!dockerAvailable" class="text-[11px] text-amber-500 flex items-center gap-1.5 mb-3"><AlertTriangle class="size-3" /> Docker not detected on this system. Install Docker to enable this feature.</div>
        <div v-if="dockerAvailable && portInUse && !lsManaged" class="text-[11px] text-amber-500 flex items-center gap-1.5 mb-3"><AlertTriangle class="size-3" /> Port 4566 is already in use. Stop the existing process to enable managed mode.</div>

        <div v-if="lsManaged" class="space-y-4">
          <!-- Status -->
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
              <Button v-if="lsStatus !== 'running'" size="sm" @click="startLs" :disabled="lsStarting || lsStatus === 'loading'" class="gap-1.5 text-xs h-7 cursor-pointer">
                <Loader2 v-if="lsStarting" class="size-3 animate-spin" /><Power v-else class="size-3" /> {{ lsStarting ? "Starting..." : "Start" }}
              </Button>
              <Button v-else variant="outline" size="sm" @click="stopLs" :disabled="lsStopping" class="gap-1.5 text-xs h-7 cursor-pointer text-red-400 hover:text-red-300">
                <Loader2 v-if="lsStopping" class="size-3 animate-spin" /><Square v-else class="size-3" /> {{ lsStopping ? "Stopping..." : "Stop" }}
              </Button>
            </div>
          </div>

          <!-- Info -->
          <div class="grid grid-cols-2 gap-3 text-[11px]">
            <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
              <p class="text-muted-foreground">Endpoint</p>
              <p class="font-mono mt-0.5">http://localhost:4566</p>
            </div>
            <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
              <p class="text-muted-foreground">Network</p>
              <p class="font-mono mt-0.5">mouseketool-network</p>
            </div>
            <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
              <p class="text-muted-foreground">Data Persistence</p>
              <p class="font-mono mt-0.5">.data/localstack-data</p>
            </div>
            <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2">
              <p class="text-muted-foreground">Host Access</p>
              <p class="font-mono mt-0.5">host.docker.internal</p>
            </div>
          </div>
          <p class="text-[10px] text-muted-foreground">Lambdas running inside this instance can reach host services (e.g. Vault on localhost:8200) via <code class="text-[10px]">host.docker.internal</code>.</p>
        </div>
      </div>
            </div>
            <div class="w-full shrink-0">
              <!-- MiniStack Panel -->
              <div class="rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-5">
                <div class="flex items-center justify-between mb-3">
                  <div>
                    <h2 class="text-sm font-medium flex items-center gap-2">Managed MiniStack Instance <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">Coming Soon</span></h2>
                    <p class="text-[11px] text-muted-foreground mt-0.5">MIT-licensed AWS emulator — free forever, no account required.</p>
                  </div>
                  <Tooltip><TooltipTrigger as-child><span class="inline-flex"><Toggle :model-value="false" disabled /></span></TooltipTrigger><TooltipContent>Coming in a future version</TooltipContent></Tooltip>
                </div>
                <div class="space-y-3 opacity-50">
                  <div class="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3">
                    <div class="flex items-center gap-3">
                      <div class="size-2.5 rounded-full bg-zinc-600" />
                      <div>
                        <p class="text-xs font-medium">Not Available</p>
                        <p class="text-[10px] text-muted-foreground font-mono">mouseketool-ministack · ministackorg/ministack:latest</p>
                      </div>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-3 text-[11px]">
                    <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Image Size</p><p class="font-mono mt-0.5">~270 MB</p></div>
                    <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">RAM at Idle</p><p class="font-mono mt-0.5">~21 MB</p></div>
                    <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">Startup</p><p class="font-mono mt-0.5">&lt; 2 seconds</p></div>
                    <div class="rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"><p class="text-muted-foreground">License</p><p class="font-mono mt-0.5">MIT — Free forever</p></div>
                  </div>
                  <p class="text-[10px] text-muted-foreground">Drop-in LocalStack replacement with 40+ AWS services. No account, no API key, no telemetry.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      <div :class="lsManaged ? 'opacity-50 pointer-events-none' : ''">
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


      <div :class="lsManaged ? 'opacity-50 pointer-events-none' : ''">
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

    <!-- Lambda Tab -->
    <div v-show="tab === 'lambda'" class="space-y-6">
      <div>
        <h2 class="text-sm font-medium mb-1">Default Memory</h2>
        <p class="text-xs text-muted-foreground mb-4">Applied to every Lambda deployed from the Builder page.</p>
        <select v-model.number="settings.lambda.memoryMB" class="h-9 text-sm bg-background border rounded-md px-3 outline-none max-w-48">
          <option v-for="m in [128, 256, 512, 1024, 1536, 2048, 3008]" :key="m" :value="m">{{ m }} MB</option>
        </select>
        <p class="text-xs text-muted-foreground mt-2">Default: 2048 MB. Higher memory also allocates more CPU.</p>
      </div>
    </div>

    <!-- Builds Tab -->
    <div v-show="tab === 'builds'" class="space-y-6">
      <div>
        <h2 class="text-sm font-medium mb-1">Auto-Cleanup</h2>
        <p class="text-xs text-muted-foreground mb-4">Cached builds older than this threshold are automatically deleted.</p>
        <div class="space-y-2">
          <Label for="ttl">Delete after (minutes)</Label>
          <Input id="ttl" v-model.number="settings.cleanup.ttlMinutes" type="number" class="max-w-48" :disabled="settings.cleanup.deleteOnStartup" />
          <p class="text-xs text-muted-foreground">Default: 1440 minutes (24 hours)</p>
        </div>
      </div>

      <div class="border-t pt-6">
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
    <div v-show="tab === 'pipelines'" class="space-y-6">
      <div>
        <h2 class="text-sm font-medium mb-1">History Retention</h2>
        <p class="text-xs text-muted-foreground mb-4">Control how long pipeline invocation history is kept.</p>
        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <Label class="text-sm shrink-0">Mode:</Label>
            <select v-model="settings.historyRetention.mode" class="bg-background border rounded-md px-3 py-1.5 text-sm">
              <option value="age">By age</option>
              <option value="amount">By amount</option>
            </select>
          </div>
          <div v-if="settings.historyRetention.mode === 'age'" class="space-y-1">
            <Label>Max age (days)</Label>
            <Input v-model.number="settings.historyRetention.maxDays" type="number" min="1" max="10" class="max-w-48" />
            <p class="text-xs text-muted-foreground">Runs older than this are removed. Min: 1, Max: 10, Default: 2.</p>
          </div>
          <div v-if="settings.historyRetention.mode === 'amount'" class="space-y-1">
            <Label>Max runs per pipeline</Label>
            <Input v-model.number="settings.historyRetention.maxRuns" type="number" min="5" max="500" class="max-w-48" />
            <p class="text-xs text-muted-foreground">Oldest runs removed to keep at most this many. Default: 50.</p>
          </div>
        </div>
      </div>

      <div class="border-t pt-6">
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
    <div v-show="tab === 'ai'" class="space-y-6">
      <div>
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
    <div v-show="tab === 'workflows'" class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium">Auto-bump healthchecks</h2>
          <p class="text-xs text-muted-foreground mt-0.5 max-w-md">Automatically increase healthcheck intervals, timeouts, start periods, and retries when importing a docker-compose file. Also auto-adds healthchecks for MySQL, Postgres, and Redis containers.</p>
        </div>
        <button class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0" :class="settings.workflow.autoBumpHealthchecks ? 'bg-primary' : 'bg-muted'" @click="settings.workflow.autoBumpHealthchecks = !settings.workflow.autoBumpHealthchecks">
          <span class="inline-block size-3.5 transform rounded-full bg-white transition-transform" :class="settings.workflow.autoBumpHealthchecks ? 'translate-x-4.5' : 'translate-x-0.5'" />
        </button>
      </div>
    </div>
    <div v-show="tab === 'ui'" class="space-y-6">
      <div class="flex items-center justify-between">
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
      </div>
    </div>
    <div v-if="toast" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg bg-green-600 animate-in fade-in slide-in-from-bottom-3 duration-300">{{ toast }}</div>
  </div>
</template>
