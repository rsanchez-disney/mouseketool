<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") { showBrowser.value = false; } }
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import FolderBrowser from "@/components/FolderBrowser.vue";
import LogViewer from "@/components/LogViewer.vue";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog.vue";



import {
  FolderOpen, Search, Hammer, Rocket, Trash2,
  Loader2, CheckCircle2, XCircle, Package, Clock, RotateCcw, Square,
  Feather, Diamond,
} from "lucide-vue-next";

// --- Types ---
interface FsItem { name: string; path: string; isDirectory: boolean }
interface AnalysisResult { projectPath: string; buildTool: string; handlers: string[]; environmentVariables?: Record<string, string>; envSource?: string }
interface Build { id: string; projectPath: string; buildTool: string; handler: string; jarPath: string; createdAt: string; projectName: string }

// --- Cleanup TTL ---
const ttlMinutes = ref(1440);
async function loadTtl() { try { const s = await (await fetch("/api/settings")).json(); ttlMinutes.value = s.cleanup?.ttlMinutes ?? 1440; } catch {} }
function buildExpiry(b: Build) {
  const created = new Date(b.createdAt).getTime();
  const expiresAt = created + ttlMinutes.value * 60000;
  const remaining = expiresAt - Date.now();
  const elapsed = Date.now() - created;
  const total = ttlMinutes.value * 60000;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const color = remaining < 900000 ? "bg-red-500" : remaining < 3600000 ? "bg-amber-500" : "bg-green-500";
  let label: string;
  if (remaining <= 0) label = "Expired";
  else if (remaining < 60000) label = `${Math.ceil(remaining / 1000)}s left`;
  else if (remaining < 3600000) label = `${Math.floor(remaining / 60000)}m left`;
  else label = `${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m left`;
  return { pct, color, label, expired: remaining <= 0 };
}

// --- Directory Browser ---
const showBrowser = ref(false);

function openBrowser() {
  showBrowser.value = true;
}

async function selectFolder(path: string) {
  selectedProject.value = path;
  await analyzeProject();
}

// --- Project Analysis ---
const selectedProject = ref("");
const analysis = ref<AnalysisResult | null>(null);
const analyzing = ref(false);
const selectedHandler = ref("");
const selectedRuntime = ref("java21");
const functionName = ref("");
const envVars = ref<{ key: string; value: string }[]>([]);

async function analyzeProject() {
  if (!selectedProject.value) return;
  analyzing.value = true;
  analysis.value = null;
  selectedHandler.value = "";
  const data = await (await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath: selectedProject.value }),
  })).json();
  analysis.value = data;
  if (data.handlers.length === 1) selectedHandler.value = data.handlers[0];
  functionName.value = selectedProject.value.split(/[/\\]/).pop() || "";
  envVars.value = data.environmentVariables ? Object.entries(data.environmentVariables).map(([key, value]) => ({ key, value: value as string })) : [];
  analyzing.value = false;
}

// --- Build ---
const building = ref(false);
const buildLogs = ref<{ line: string; isError?: boolean }[]>([]);
const buildResult = ref<Build | null>(null);
const buildError = ref("");
const buildStartTime = ref(0);
const buildElapsed = ref(0);
const buildTotalTime = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

function startTimer() {
  buildStartTime.value = Date.now();
  buildElapsed.value = 0;
  buildTotalTime.value = 0;
  timerInterval = setInterval(() => { buildElapsed.value = Date.now() - buildStartTime.value; }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  buildTotalTime.value = Date.now() - buildStartTime.value;
  buildElapsed.value = buildTotalTime.value;
}

import { formatMs, timeAgo } from "@/lib/format";

const cancelling = ref(false);

async function cancelBuild() {
  cancelling.value = true;
  await fetch("/api/builds/cancel", { method: "POST" });
  stopTimer();
  building.value = false;
  cancelling.value = false;
}


function rebuildFromCache(b: Build) {
  selectedProject.value = b.projectPath;
  selectedHandler.value = b.handler;
  functionName.value = b.projectName;
  analyzeProject().then(() => {
    if (b.handler) selectedHandler.value = b.handler;
  });
}

async function startBuild() {
  building.value = true;
  buildLogs.value = [];
  buildResult.value = null;
  buildError.value = "";
  startTimer();

  const res = await fetch("/api/builds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectPath: selectedProject.value,
      buildTool: analysis.value?.buildTool,
      handler: selectedHandler.value,
    }),
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    let event = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (event === "log") buildLogs.value.push(data);
        else if (event === "complete") { buildResult.value = data; loadBuilds(); }
        else if (event === "error") buildError.value = data.message;
      }
    }
    await nextTick();
  }
  stopTimer();
  building.value = false;
}

// --- Deploy ---
const deploying = ref(false);
const deployResult = ref<{ functionName: string; action: string } | null>(null);

const deployMessage = ref("");
const deploySuccess = ref(false);

// Override modal
const showOverrideModal = ref(false);
const pendingDeployBuild = ref<Build | null>(null);
const overrideDontAskAgain = ref(false);
const skipOverrideWarning = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem("mk:skipOverrideWarning") || "[]")));

function saveSkipPreference(name: string) {
  skipOverrideWarning.value.add(name);
  localStorage.setItem("mk:skipOverrideWarning", JSON.stringify([...skipOverrideWarning.value]));
}

async function startDeploy(build: Build) {
  const name = functionName.value || build.projectName;
  if (skipOverrideWarning.value.has(name)) { deploy(build); return; }
  try {
    const res = await fetch(`/api/deploy/check/${encodeURIComponent(name)}`);
    const { exists } = await res.json();
    if (exists) { pendingDeployBuild.value = build; overrideDontAskAgain.value = false; showOverrideModal.value = true; return; }
  } catch {}
  deploy(build);
}

function confirmOverride() {
  showOverrideModal.value = false;
  if (overrideDontAskAgain.value && pendingDeployBuild.value) saveSkipPreference(functionName.value || pendingDeployBuild.value.projectName);
  if (pendingDeployBuild.value) deploy(pendingDeployBuild.value);
  pendingDeployBuild.value = null;
}

async function deploy(build: Build) {
  deploying.value = true;
  deployResult.value = null;
  deployMessage.value = "";
  try {
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildId: build.id,
        handler: selectedHandler.value || build.handler,
        runtime: selectedRuntime.value,
        functionName: functionName.value || build.projectName,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      deploySuccess.value = false;
      deployMessage.value = data.error || "Deploy failed";
    } else {
      deployResult.value = data;
      // Save detected env vars as defaults for invoke step
      if (envVars.value.length) {
        fetch(`/api/deployments/env/${build.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(envVars.value),
        }).catch(() => {});
      }
      deploySuccess.value = true;
      deployMessage.value = `Lambda "${data.functionName}" ${data.action} successfully`;
    }
  } catch (e: any) {
    deploySuccess.value = false;
    deployMessage.value = e.message;
  }
  deploying.value = false;
  setTimeout(() => { deployMessage.value = ""; }, 5000);
}

// --- Builds ---
const builds = ref<Build[]>([]);

async function loadBuilds() {
  builds.value = await (await fetch("/api/builds")).json();
}

const deleting = ref(false);

async function deleteBuild(id: string) {
  deleting.value = true;
  await fetch(`/api/builds/${id}`, { method: "DELETE" });
  await loadBuilds();
  deleting.value = false;
}

const confirmDeleteBuild = ref(false);
const pendingDeleteBuildId = ref("");

onMounted(() => { loadBuilds(); loadTtl(); });
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Lambda Builder</h1>
      <p class="text-sm text-muted-foreground mt-1">Build and deploy Java Lambda functions to LocalStack.</p>
    </div>

    <!-- Project Selection -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <FolderOpen class="size-5" />
          Project
        </CardTitle>
        <CardDescription>Select a Java Lambda project directory to analyze and build.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex gap-3 items-end">
          <div class="flex-1 space-y-2">
            <Label>Project Path</Label>
            <Input v-model="selectedProject" placeholder="Paste a path or click Browse..." @keydown.enter="analyzeProject" />
          </div>
          <Button @click="openBrowser" variant="outline" class="gap-2">
            <Search class="size-4" />
            Browse
          </Button>
          <Button v-if="selectedProject" @click="analyzeProject" variant="ghost" size="icon" :disabled="analyzing">
            <RotateCcw class="size-4" :class="{ 'animate-spin': analyzing }" />
          </Button>
        </div>

        <!-- Analysis Results -->
        <div v-if="analyzing" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin" /> Analyzing project structure...
        </div>

        <template v-if="analysis">
          <Separator />
          <div class="flex items-center gap-2">
            <Badge variant="secondary">{{ analysis.buildTool }}</Badge>
            <span class="text-sm text-muted-foreground">{{ analysis.handlers.length }} handler(s) detected</span>
          </div>

          <div class="grid grid-cols-[1fr_auto_auto] gap-4">
            <div class="space-y-2 min-w-0">
              <Label>Handler</Label>
              <Select v-model="selectedHandler">
                <SelectTrigger class="truncate">
                  <SelectValue placeholder="Select handler..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="h in analysis.handlers" :key="h" :value="h">{{ h.split('.').pop() }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Runtime</Label>
              <Select v-model="selectedRuntime">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="java21">Java 21</SelectItem>
                  <SelectItem value="java17">Java 17</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Function Name</Label>
              <Input v-model="functionName" placeholder="my-lambda" />
            </div>
          </div>

          <!-- Environment Variables (configured in Deployments page before invoke) -->
          <div v-if="envVars.length" class="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 flex items-center gap-2">
            <span>{{ envVars.length }} env var{{ envVars.length > 1 ? 's' : '' }} detected from {{ analysis?.envSource || 'template' }}.</span>
            <span class="text-muted-foreground/70">Configure them in the Deployments page before invoking.</span>
          </div>

          <div v-if="selectedHandler" class="text-xs text-muted-foreground font-mono bg-muted px-3 py-2 rounded-md">
            {{ selectedHandler }}
          </div>

          <Button @click="startBuild" :disabled="building || !selectedHandler" class="gap-2 cursor-pointer active:scale-[0.98] transition-transform">
            <Loader2 v-if="building" class="size-4 animate-spin" />
            <Hammer v-else class="size-4" />
            {{ building ? "Building..." : "Build Project" }}
          </Button>
        </template>
      </CardContent>
    </Card>

    <!-- Build Console -->
    <Card v-if="buildLogs.length || building">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Package class="size-5" />
          Build Console
          <div class="ml-auto flex items-center gap-2">
            <Tooltip v-if="building">
              <TooltipTrigger as-child>
                <Button variant="destructive" size="icon" class="size-7 cursor-pointer" @click="cancelBuild">
                  <Square class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop build</TooltipContent>
            </Tooltip>

            <Badge v-if="building" variant="outline" class="animate-pulse min-w-[8rem] justify-center tabular-nums">Running · {{ formatMs(buildElapsed) }}</Badge>
            <Badge v-else-if="buildResult" class="bg-green-500/10 text-green-600 border-green-500/20">Success · {{ formatMs(buildTotalTime) }}</Badge>
            <Badge v-else-if="buildError" variant="destructive">Failed · {{ formatMs(buildTotalTime) }}</Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <LogViewer
          :logs="buildLogs"
          :loading="building"
          loading-text="Building..."
          empty-text="Build output will appear here"
        />

        <div v-if="buildError" class="flex items-center gap-2 text-sm text-destructive">
          <XCircle class="size-4" /> {{ buildError }}
        </div>

        <div v-if="buildResult" class="space-y-3">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 class="size-4" /> Build complete
            </div>
            <Button @click="startDeploy(buildResult!)" :disabled="deploying" size="sm" class="gap-2 cursor-pointer active:scale-95 transition-transform">
              <Loader2 v-if="deploying" class="size-4 animate-spin" />
              <Rocket v-else class="size-4" />
              {{ deploying ? "Deploying..." : "Deploy to LocalStack" }}
            </Button>
          </div>

        </div>
      </CardContent>
    </Card>

    <!-- Cached Builds -->
    <Card v-if="builds.length">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Clock class="size-5" />
          Cached Builds
        </CardTitle>
        <CardDescription>Previous builds available for redeployment.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div v-for="b in builds" :key="b.id" class="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
            <div class="space-y-0.5 min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm">{{ b.projectName }}</span>
                <Badge variant="outline" class="text-xs gap-1">
                  <Feather v-if="b.buildTool === 'maven'" class="size-3" />
                  <Diamond v-else class="size-3" />
                  {{ b.buildTool }}
                </Badge>
              </div>
              <div class="text-xs text-muted-foreground truncate">
                {{ b.handler || 'No handler set' }} · {{ timeAgo(b.createdAt) }}
              </div>
              <Tooltip>
                <TooltipTrigger as-child>
                  <div class="flex items-center gap-2 mt-1 cursor-default">
                    <div class="h-1 flex-1 rounded-full bg-muted overflow-hidden"><div class="h-full rounded-full transition-all" :class="buildExpiry(b).color" :style="{ width: buildExpiry(b).pct + '%' }" /></div>
                    <span class="text-[10px] shrink-0" :class="buildExpiry(b).pct > 90 ? 'text-red-500' : buildExpiry(b).pct > 75 ? 'text-amber-500' : 'text-muted-foreground'">{{ buildExpiry(b).label }}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left">Auto-cleanup timer</TooltipContent>
              </Tooltip>
            </div>
            <div class="flex items-center gap-2 ml-4">
              <Button @click="rebuildFromCache(b)" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
                <Hammer class="size-3.5" /> Rebuild
              </Button>
              <Button @click="startDeploy(b)" :disabled="deploying" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
                <Rocket class="size-3.5" /> Deploy
              </Button>
              <Button @click="pendingDeleteBuildId = b.id; confirmDeleteBuild = true" variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-destructive cursor-pointer active:scale-95 transition-transform">
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <FolderBrowser v-model="showBrowser" title="Select Project Directory" description="Navigate to your Java Lambda project root." :initial-path="selectedProject" @select="selectFolder" />

    <!-- Deploy toast -->
    <div v-if="deployMessage" :key="deployMessage" :class="deploySuccess ? 'bg-green-600' : 'bg-destructive'" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in">
      <CheckCircle2 v-if="deploySuccess" class="size-4 shrink-0" />
      <XCircle v-else class="size-4 shrink-0" />
      {{ deployMessage }}
    </div>

    <!-- Deploying overlay -->
    <div v-if="deploying" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg">
      <Loader2 class="size-4 animate-spin" />
      Deploying Lambda...
    </div>
    <div v-if="deleting" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg">
      <Loader2 class="size-4 animate-spin" />
      Deleting build...
    </div>
    <div v-if="cancelling" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm bg-destructive text-destructive-foreground rounded-lg px-4 py-3 shadow-lg">
      <Loader2 class="size-4 animate-spin" />
      Stopping build...
    </div>
    <ConfirmDialog v-model="confirmDeleteBuild" title="Delete build?" description="This will permanently remove the build artifact." @confirm="deleteBuild(pendingDeleteBuildId)" />

    <!-- Override confirm modal -->
    <Dialog v-model:open="showOverrideModal">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lambda already exists</DialogTitle>
          <DialogDescription>A Lambda function with the name <span class="font-mono font-semibold">{{ functionName || pendingDeployBuild?.projectName }}</span> already exists on LocalStack.</DialogDescription>
        </DialogHeader>
        <div class="text-xs space-y-3 py-2">
          <p class="text-muted-foreground">Deploying will override the existing function code and configuration. Any event source mappings (pipelines) pointing to this function will continue to work.</p>
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="overrideDontAskAgain" class="accent-primary" /><span class="text-muted-foreground">Don't ask again for this function</span></label>
        </div>
        <DialogFooter>
          <Button variant="outline" class="cursor-pointer" @click="showOverrideModal = false; pendingDeployBuild = null">Cancel</Button>
          <Button class="gap-1.5 cursor-pointer" @click="confirmOverride">Override</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
