<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") expandedLogStep.value = ""; }
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Database, Loader2, ArrowLeft, Play, Check, AlertTriangle, Bell, Inbox, Zap, ChevronDown, ChevronRight, Copy, Maximize2, Minimize2, Square, Search, X,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;

interface Pipeline { id: string; name: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; heavyLoad?: boolean; }
interface Step { id: string; label: string; detail: string; status: "pending" | "running" | "success" | "timeout" | "error" | "filtered" | "diagnosing" | "unknown"; logs: string[]; collapsed: boolean; elapsed?: number; }

const pipeline = ref<Pipeline | null>(null);
const loading = ref(true);
const itemJson = ref("{}");
const executing = ref(false);

const steps = ref<Step[]>([]);

function initSteps(p: Pipeline): Step[] {
  return [
    { id: "dynamodb", label: "DynamoDB Insert", detail: p.tableName, status: "pending", logs: [], collapsed: false },
    { id: "glue", label: "Stream Handler", detail: p.glueFunctionName, status: "pending", logs: [], collapsed: false },
    { id: "sns", label: "SNS Publish", detail: p.topicName, status: "pending", logs: [], collapsed: false },
    { id: "sqs", label: "SQS Deliver", detail: p.queueName, status: "pending", logs: [], collapsed: false },
    { id: "target", label: "Target Lambda", detail: p.targetFunctionName, status: "pending", logs: [], collapsed: false },
  ];
}

const allDone = computed(() => steps.value.every(s => s.status !== "pending" && s.status !== "running"));
const copiedStep = ref("");
const expandedLogStep = ref("");
const expandedLogContent = ref<string[]>([]);
const logSearch = ref("");
const searchOpen = ref(false);

// Heavy load batch counter
const batchCount = ref(0);
const batchBaseline = ref(0);
let batchPoll: ReturnType<typeof setInterval> | null = null;
function startBatchPoll() {
  if (!pipeline.value?.heavyLoad || batchPoll) return;
  batchPoll = setInterval(async () => {
    try {
      const { count } = await (await fetch(`/api/dynamodb/tables/${pipeline.value!.tableName}/count`)).json();
      batchCount.value = count - batchBaseline.value;
    } catch {}
  }, 1000);
}
function stopBatchPoll() { if (batchPoll) { clearInterval(batchPoll); batchPoll = null; } }
const autoDiagnose = ref(true);
const showElapsed = ref(localStorage.getItem("mk:showElapsed") !== "false");

import { extractErrors, formatMs } from "@/lib/format";
function copyStepLogs(logs: string[]) {
  navigator.clipboard.writeText(logs.join("\n"));
  showToast("Copied to clipboard");
}
function expandStep(s: Step) {
  expandedLogContent.value = s.logs;
  expandedLogStep.value = s.id;
}

// Toast
const toastMessage = ref("");
function showToast(msg: string) { toastMessage.value = msg; setTimeout(() => toastMessage.value = "", 2000); }

async function loadPipeline() {
  loading.value = true;
  try {
    const all = await (await fetch("/api/triggers/pipelines")).json();
    pipeline.value = all.find((p: Pipeline) => p.id === pipelineId) ?? null;
    if (pipeline.value) {
      steps.value = initSteps(pipeline.value);
      // Load key schema for template
      try {
        const { keys } = await (await fetch(`/api/dynamodb/tables/${pipeline.value.tableName}/describe`)).json();
        const t: Record<string, any> = {}; for (const k of keys) t[k.name] = k.attributeType === "N" ? 0 : "value";
        itemJson.value = JSON.stringify(t, null, 2);
      } catch { itemJson.value = "{}"; }
    }
  } catch {}
  loading.value = false;
}

let execAbort: AbortController | null = null;

async function execute() {
  if (!pipeline.value) return;
  executing.value = true;
  steps.value = initSteps(pipeline.value);
  batchCount.value = 0; batchBaseline.value = 0; stopBatchPoll();

  // Capture baseline item count for heavy load
  if (pipeline.value.heavyLoad) {
    try { const { count } = await (await fetch(`/api/dynamodb/tables/${pipeline.value.tableName}/count`)).json(); batchBaseline.value = count; } catch {}
  }

  let item: any;
  try { item = JSON.parse(itemJson.value); } catch { return; }

  execAbort = new AbortController();
  const res = await fetch(`/api/triggers/pipelines/${pipelineId}/execute`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
    signal: execAbort.signal,
  }).catch(() => null);

  if (!res) { executing.value = false; return; }
  const reader = res.body?.getReader();
  if (!reader) { executing.value = false; return; }
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const { step, status, logs, elapsed } = JSON.parse(line.slice(6));
        if (step === "done" || step === "error") continue;
        const s = steps.value.find(s => s.id === step);
        if (s) {
          // If auto-diagnose is off and we get diagnosing, convert to error
          if (status === "diagnosing" && !autoDiagnose.value) {
            s.status = "error";
            s.logs = ["Target Lambda timed out.", "", "Auto-diagnose is disabled. Enable it to automatically extract error details."];
            s.collapsed = true;
            if (steps.value.every(st => st.status !== "pending" && st.status !== "running")) executing.value = false;
          } else {
            s.status = status;
          }
          // Heavy load batch polling
          if (step === "dynamodb" && status === "success" && pipeline.value?.heavyLoad) startBatchPoll();
          if (step === "glue" && status === "running") stopBatchPoll();
          if (logs?.length) s.logs = logs;
          if (elapsed) s.elapsed = elapsed;
          // Auto-collapse completed steps, expand running
          if (status === "running") {
            steps.value.forEach(st => { if (st.id !== step && st.status !== "running") st.collapsed = true; });
            s.collapsed = false;
          } else if (status === "success" || status === "timeout" || status === "error" || status === "filtered") {
            s.collapsed = true;
            // If all steps are done, reset executing immediately (don't wait for stream close)
            if (steps.value.every(st => st.status !== "pending" && st.status !== "running")) executing.value = false;
          }
        }
      } catch {}
    }
  }
  stopBatchPoll();
  executing.value = false;
  execAbort = null;
}

function stopExecution() {
  execAbort?.abort();
  stopBatchPoll();
  steps.value.forEach(s => { if (s.status === "running" || s.status === "pending") { s.status = "error"; s.logs = s.logs.length ? [...s.logs, "Stopped by user"] : ["Stopped by user"]; } });
  executing.value = false;
  execAbort = null;
}

function toggleStep(s: Step) { s.collapsed = !s.collapsed; }

function statusColor(status: string) {
  if (status === "success") return "text-green-500";
  if (status === "running") return "text-primary";
  if (status === "filtered") return "text-blue-400";
  if (status === "diagnosing") return "text-purple-500";
  if (status === "timeout") return "text-amber-500";
  if (status === "error") return "text-red-500";
  return "text-muted-foreground";
}

function statusBg(status: string) {
  if (status === "success") return "bg-green-500";
  if (status === "running") return "bg-primary";
  if (status === "filtered") return "bg-blue-400";
  if (status === "diagnosing") return "bg-purple-500";
  if (status === "timeout") return "bg-amber-500";
  if (status === "error") return "bg-red-500";
  return "bg-muted-foreground/30";
}

function connectorColor(status: string) {
  if (status === "success") return "bg-green-500";
  if (status === "running") return "bg-primary animate-pulse";
  if (status === "filtered") return "bg-blue-400";
  if (status === "diagnosing") return "bg-purple-500 animate-pulse";
  if (status === "timeout") return "bg-amber-500";
  if (status === "error") return "bg-red-500";
  return "bg-border";
}

onMounted(loadPipeline);
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="router.push('/triggers')"><ArrowLeft class="size-4" /></Button>
      <div>
        <h1 class="text-xl font-bold tracking-tight">{{ pipeline?.name ?? 'Pipeline Execution' }}</h1>
        <p class="text-xs text-muted-foreground">Execute and observe each step of the pipeline in real time.</p>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading pipeline...</p></div>

    <template v-else-if="pipeline">
      <!-- JSON input + execute -->
      <div class="flex gap-4 items-start">
        <div class="flex-1 space-y-1.5">
          <Label class="text-xs">Test Item for <span class="font-mono font-semibold">{{ pipeline.tableName }}</span></Label>
          <textarea v-model="itemJson" rows="5" class="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none scrollbar-thin" spellcheck="false" />
        </div>
        <div class="flex flex-col gap-2 mt-6 shrink-0">
          <div class="flex items-center gap-2">
            <Button :disabled="executing" class="gap-2 cursor-pointer active:scale-95 transition-transform min-w-[120px]" @click="execute">
              <Loader2 v-if="executing" class="size-4 animate-spin" /><Play v-else class="size-4" />
              {{ executing ? 'Running...' : allDone && steps[0].status !== 'pending' ? 'Re-run' : 'Execute' }}
            </Button>
            <Button variant="destructive" :disabled="!executing" class="gap-2 cursor-pointer" @click="stopExecution"><Square class="size-3.5" /> Stop</Button>
          </div>
          <label class="flex items-center gap-2 text-xs text-muted-foreground" :class="executing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'"><Switch v-model="autoDiagnose" class="cursor-pointer" :disabled="executing" /><span>Auto-diagnose on error</span></label>
        </div>
      </div>

      <!-- Pipeline nodes -->
      <div class="space-y-0">
        <template v-for="(s, i) in steps" :key="s.id">
          <!-- Connector line (between nodes) -->
          <div v-if="i > 0" class="flex items-center pl-[19px]">
            <div class="w-0.5 h-6 transition-colors duration-500" :class="connectorColor(s.status === 'pending' ? steps[i-1].status : s.status)" />
          </div>

          <!-- Heavy load batch indicator -->
          <div v-if="i === 1 && pipeline?.heavyLoad && steps[0].status === 'success' && s.status === 'pending' && batchCount > 0" class="flex items-center gap-2 pl-10 py-1.5">
            <div class="size-2 rounded-full bg-orange-500 animate-pulse" />
            <span class="text-xs text-orange-400 font-mono">Batching {{ batchCount }} new item{{ batchCount !== 1 ? 's' : '' }}...</span>
          </div>

          <!-- Node -->
          <div class="border rounded-lg overflow-hidden transition-all duration-300" :class="[s.status==='running'?'border-primary shadow-md shadow-primary/10':s.status==='success'?'border-green-500/40':s.status==='filtered'?'border-blue-400/40':s.status==='diagnosing'?'border-purple-500/40':s.status==='timeout'?'border-amber-500/40':s.status==='error'?'border-red-500/40':'border-border']">
            <!-- Node header -->
            <button class="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors" @click="toggleStep(s)">
              <!-- Status dot -->
              <div class="flex items-center justify-center size-8 rounded-full shrink-0 transition-colors" :class="[s.status==='success'?'bg-green-500/20':s.status==='running'?'bg-primary/20':s.status==='filtered'?'bg-blue-400/20':s.status==='diagnosing'?'bg-purple-500/20':s.status==='timeout'?'bg-amber-500/20':s.status==='error'?'bg-red-500/20':'bg-muted']">
                <Loader2 v-if="s.status==='running'" class="size-4 animate-spin" :class="statusColor(s.status)" />
                <Check v-else-if="s.status==='success'" class="size-4" :class="statusColor(s.status)" />
                <AlertTriangle v-else-if="s.status==='error'||s.status==='timeout'||s.status==='filtered'" class="size-4" :class="statusColor(s.status)" />
                <Search v-else-if="s.status==='diagnosing'" class="size-4 text-purple-500 animate-pulse" />
                <Database v-else-if="s.id==='dynamodb'" class="size-4 text-muted-foreground" />
                <Zap v-else-if="s.id==='glue'||s.id==='target'" class="size-4 text-muted-foreground" />
                <Bell v-else-if="s.id==='sns'" class="size-4 text-muted-foreground" />
                <Inbox v-else class="size-4 text-muted-foreground" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold">{{ s.label }}</p>
                <p class="text-xs text-muted-foreground font-mono truncate">{{ s.detail }}</p>
              </div>
              <span v-if="showElapsed && s.elapsed" class="text-[10px] text-muted-foreground font-mono shrink-0">{{ formatMs(s.elapsed) }}</span>
              <Badge v-if="s.status!=='pending'" :class="[s.status==='success'?'bg-green-500/20 text-green-500 border-green-500/40':s.status==='running'?'bg-primary/20 text-primary border-primary/40':s.status==='filtered'?'bg-blue-400/20 text-blue-400 border-blue-400/40':s.status==='diagnosing'?'bg-purple-500/20 text-purple-500 border-purple-500/40':s.status==='timeout'?'bg-amber-500/20 text-amber-500 border-amber-500/40':'bg-red-500/20 text-red-500 border-red-500/40']" class="text-[10px] shrink-0">{{ s.status === 'timeout' ? 'timed out' : s.status === 'diagnosing' ? 'diagnosing...' : s.status }}</Badge>
              <ChevronDown v-if="!s.collapsed && s.logs.length" class="size-4 text-muted-foreground shrink-0" />
              <ChevronRight v-else-if="s.logs.length" class="size-4 text-muted-foreground shrink-0" />
            </button>

            <!-- Logs panel -->
            <div v-if="!s.collapsed && s.logs.length" class="border-t bg-zinc-950 transition-all">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyStepLogs(s.logs)">
                  <Copy class="size-3" />
                </Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandStep(s)">
                  <Maximize2 class="size-3" />
                </Button>
              </div>
              <div class="px-4 pb-3 max-h-56 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <div v-if="(s.status==='error'||s.status==='timeout') && extractErrors(s.logs).length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
                  <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
                  <div v-for="(line, i) in extractErrors(s.logs)" :key="'rc'+i" class="text-xs font-mono text-red-300 whitespace-pre-wrap leading-relaxed">{{ line.trim() }}</div>
                </div>
                <div v-for="(line, i) in s.logs" :key="i" :class="[line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' : line.startsWith('⚠') ? 'text-yellow-400' : line.includes('──') ? 'text-blue-400 font-semibold mt-2' : 'text-zinc-400']" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <div v-else class="text-center py-16 text-muted-foreground"><p>Pipeline not found.</p></div>

    <!-- Expanded log modal -->
    <Dialog :open="!!expandedLogStep" @update:open="expandedLogStep = ''">
      <DialogContent class="!max-w-[97vw] w-[97vw] max-h-[90vh] p-0 gap-0 border-zinc-800 bg-zinc-950 shadow-2xl !rounded-lg [&>button]:hidden">
        <DialogTitle class="sr-only">Logs</DialogTitle><DialogDescription class="sr-only">Expanded log output</DialogDescription>
        <div class="flex items-center justify-end gap-1 px-3 py-2">
          <div class="mr-auto flex items-center">
            <Button v-if="!searchOpen" variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="searchOpen = true"><Search class="size-3.5" /></Button>
            <div v-else class="relative flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200"><Search class="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" /><input v-model="logSearch" placeholder="Search logs…" class="h-7 w-56 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500" @vue:mounted="(e: any) => e.el.focus()" /><Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-400 hover:text-white shrink-0" @click="searchOpen = false; logSearch = ''"><X class="size-3" /></Button></div>
          </div>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="copyStepLogs(expandedLogContent)"><Copy class="size-3.5" /></Button>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="expandedLogStep = ''"><Minimize2 class="size-3.5" /></Button>
        </div>
        <div class="overflow-auto scrollbar-visible px-4 pb-4 h-[80vh]">
          <div v-if="extractErrors(expandedLogContent).length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
            <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
            <div v-for="(line, i) in extractErrors(expandedLogContent)" :key="'erc'+i" class="text-xs font-mono text-red-300 whitespace-pre-wrap leading-relaxed">{{ line.trim() }}</div>
          </div>
          <div v-for="(line, i) in expandedLogContent" :key="i" :class="[logSearch && !line.toLowerCase().includes(logSearch.toLowerCase()) ? 'opacity-20' : line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' : line.startsWith('⚠') ? 'text-yellow-400' : line.includes('──') ? 'text-blue-400 font-semibold mt-2' : 'text-zinc-400']" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Toast -->
    <div v-if="toastMessage" :key="toastMessage" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <Check class="size-4" />{{ toastMessage }}
    </div>
  </div>
</template>
