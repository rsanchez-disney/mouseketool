<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") { expandedConsole.value = false; showBrowser.value = false; } }
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

const expandedConsole = ref(false);
const expandedLogInner = ref<HTMLElement | null>(null);
const logSearch = ref("");
const searchOpen = ref(false);

function scrollExpandedToBottom() {
  if (expandedLogInner.value) expandedLogInner.value.scrollTop = expandedLogInner.value.scrollHeight;
}
const buildLogsCopied = ref(false);
const copyToastMsg = ref("");

function copyBuildLogs() {
  navigator.clipboard.writeText(buildLogs.value.map(l => l.line).join("\n"));
  buildLogsCopied.value = true;
  copyToastMsg.value = "Copied to clipboard";
  setTimeout(() => { buildLogsCopied.value = false; copyToastMsg.value = ""; }, 2000);
}
import {
  FolderOpen, FolderUp, Folder, File, Search, Hammer, Rocket, Trash2,
  Loader2, CheckCircle2, XCircle, Package, Clock, RotateCcw, Square, ArrowDown,
  Feather, Diamond, Maximize2, Minimize2, Copy, Check, X,
} from "lucide-vue-next";

// --- Types ---
interface FsItem { name: string; path: string; isDirectory: boolean }
interface AnalysisResult { projectPath: string; buildTool: string; handlers: string[]; environmentVariables?: Record<string, string>; envSource?: string }
interface Build { id: string; projectPath: string; buildTool: string; handler: string; jarPath: string; createdAt: string; projectName: string }

// --- Directory Browser ---
const showBrowser = ref(false);
const browserPath = ref("");
const browserParent = ref("");
const browserItems = ref<FsItem[]>([]);
const browserLoading = ref(false);

async function browse(path?: string) {
  browserLoading.value = true;
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const data = await (await fetch(`/api/fs${q}`)).json();
  browserPath.value = data.path;
  browserParent.value = data.parent;
  browserItems.value = data.items;
  browserLoading.value = false;
}

function openBrowser() {
  showBrowser.value = true;
  browse(selectedProject.value || undefined);
}

async function selectFolder() {
  selectedProject.value = browserPath.value;
  showBrowser.value = false;
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
const logContainer = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const logInner = ref<HTMLElement | null>(null);
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

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

const cancelling = ref(false);

async function cancelBuild() {
  cancelling.value = true;
  await fetch("/api/builds/cancel", { method: "POST" });
  stopTimer();
  building.value = false;
  cancelling.value = false;
}

function scrollToBottom() {
  if (logInner.value) logInner.value.scrollTop = logInner.value.scrollHeight;
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
  autoScroll.value = true;
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
    if (autoScroll.value) scrollToBottom();
  }
  stopTimer();
  building.value = false;
}

// --- Deploy ---
const deploying = ref(false);
const deployResult = ref<{ functionName: string; action: string } | null>(null);

const deployMessage = ref("");
const deploySuccess = ref(false);

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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

onMounted(loadBuilds);
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
            <Tooltip>
              <TooltipTrigger as-child>
                <Button :variant="autoScroll ? 'default' : 'outline'" size="icon" class="size-7 cursor-pointer" @click="autoScroll = !autoScroll; if (autoScroll) scrollToBottom()">
                  <ArrowDown class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ autoScroll ? 'Auto-scroll on' : 'Auto-scroll off' }}</TooltipContent>
            </Tooltip>
            <Badge v-if="building" variant="outline" class="animate-pulse min-w-[8rem] justify-center tabular-nums">Running · {{ formatMs(buildElapsed) }}</Badge>
            <Badge v-else-if="buildResult" class="bg-green-500/10 text-green-600 border-green-500/20">Success · {{ formatMs(buildTotalTime) }}</Badge>
            <Badge v-else-if="buildError" variant="destructive">Failed · {{ formatMs(buildTotalTime) }}</Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div ref="logContainer" class="bg-zinc-950 text-zinc-300 rounded-lg p-4 h-72 font-mono text-xs leading-relaxed overflow-hidden relative">
          <Button variant="ghost" size="icon" class="absolute top-2 right-2 z-10 size-7 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandedConsole = true">
            <Maximize2 class="size-3.5" />
          </Button>
          <div ref="logInner" class="h-full overflow-auto scrollbar-thin">
            <div v-for="(log, i) in buildLogs" :key="i" :class="log.isError ? 'text-red-400' : ''" class="whitespace-nowrap">{{ log.line }}</div>
            <div v-if="building" class="inline-block w-2 h-4 bg-zinc-400 animate-pulse" />
          </div>
        </div>

        <div v-if="buildError" class="flex items-center gap-2 text-sm text-destructive">
          <XCircle class="size-4" /> {{ buildError }}
        </div>

        <div v-if="buildResult" class="space-y-3">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 class="size-4" /> Build complete
            </div>
            <Button @click="deploy(buildResult!)" :disabled="deploying" size="sm" class="gap-2 cursor-pointer active:scale-95 transition-transform">
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
            </div>
            <div class="flex items-center gap-2 ml-4">
              <Button @click="rebuildFromCache(b)" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
                <Hammer class="size-3.5" /> Rebuild
              </Button>
              <Button @click="deploy(b)" :disabled="deploying" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
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

    <!-- Directory Browser Dialog -->
    <Dialog v-model:open="showBrowser">
      <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select Project Directory</DialogTitle>
          <DialogDescription>Navigate to your Java Lambda project root.</DialogDescription>
        </DialogHeader>

        <div class="flex items-center gap-2 py-2">
          <Button @click="browse(browserParent)" variant="outline" size="sm" :disabled="browserPath === browserParent" class="gap-1.5">
            <FolderUp class="size-4" /> Up
          </Button>
          <code class="text-xs bg-muted rounded-md px-3 py-1.5 flex-1 truncate">{{ browserPath }}</code>
        </div>

        <ScrollArea class="h-[50vh] rounded-md border">
          <div v-if="browserLoading" class="flex justify-center p-8">
            <Loader2 class="size-6 animate-spin text-muted-foreground" />
          </div>
          <div v-else class="p-1">
            <button
              v-for="item in browserItems"
              :key="item.path"
              @click="item.isDirectory ? browse(item.path) : undefined"
              :disabled="!item.isDirectory"
              class="w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-default hover:enabled:bg-accent"
            >
              <Folder v-if="item.isDirectory" class="size-4 text-primary shrink-0" />
              <File v-else class="size-4 text-muted-foreground shrink-0" />
              <span class="truncate">{{ item.name }}</span>
            </button>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button @click="showBrowser = false" variant="outline">Cancel</Button>
          <Button @click="selectFolder" class="gap-2">
            <FolderOpen class="size-4" /> Select This Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Deploy toast -->
    <div v-if="deployMessage" :key="deployMessage" :class="deploySuccess ? 'bg-green-600' : 'bg-destructive'" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <CheckCircle2 v-if="deploySuccess" class="size-4 shrink-0" />
      <XCircle v-else class="size-4 shrink-0" />
      {{ deployMessage }}
    </div>
    <div v-if="copyToastMsg" :key="copyToastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <Check class="size-4" />{{ copyToastMsg }}
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

    <!-- Expanded Console Modal -->
    <Dialog v-model:open="expandedConsole">
      <DialogContent class="!max-w-[97vw] w-[97vw] max-h-[90vh] p-0 gap-0 border-zinc-800 bg-zinc-950 shadow-2xl !rounded-lg [&>button]:hidden">
        <DialogTitle class="sr-only">Build Console</DialogTitle>
        <DialogDescription class="sr-only">Expanded build console output</DialogDescription>
        <div class="flex items-center justify-end gap-1 px-3 py-2">
          <div class="mr-auto flex items-center">
            <Button v-if="!searchOpen" variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="searchOpen = true"><Search class="size-3.5" /></Button>
            <div v-else class="relative flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200"><Search class="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" /><input v-model="logSearch" placeholder="Search logs…" class="h-7 w-56 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500" @vue:mounted="(e: any) => e.el.focus()" /><Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-400 hover:text-white shrink-0" @click="searchOpen = false; logSearch = ''"><X class="size-3" /></Button></div>
          </div>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="scrollExpandedToBottom">
            <ArrowDown class="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="copyBuildLogs">
            <Check v-if="buildLogsCopied" class="size-3.5 text-green-500" /><Copy v-else class="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="expandedConsole = false">
            <Minimize2 class="size-3.5" />
          </Button>
        </div>
        <div ref="expandedLogInner" class="overflow-auto scrollbar-visible px-4 pb-4 h-[80vh] text-zinc-300 font-mono text-xs leading-relaxed">
          <div v-for="(log, i) in buildLogs" :key="i" :class="[logSearch && !log.line.toLowerCase().includes(logSearch.toLowerCase()) ? 'opacity-20' : log.isError ? 'text-red-400' : '']" class="whitespace-nowrap">{{ log.line }}</div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
