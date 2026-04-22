<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, inject } from "vue";
import { useRoute, useRouter } from "vue-router";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") expandedLogStep.value = ""; }
onMounted(() => { window.addEventListener("keydown", onKey); window.addEventListener("click", closeDropdowns); });
onUnmounted(() => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", closeDropdowns); });
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EvaluateModal from "@/components/EvaluateModal.vue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import {
  Database, Loader2, ArrowLeft, Play, Check, AlertTriangle, Bell, Inbox, Zap, ChevronDown, ChevronRight, Copy, Maximize2, Minimize2, Square, Search, X, Sparkles, MessageSquare,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;
const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));

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
const generating = ref(false);
const generateOpen = ref(false);
const lastGenerated = ref("");
const showEvaluate = ref(false);
const evaluated = ref(false);
const aiExplaining = ref(false);
const aiExplanation = ref("");
const aiExpandedKey = ref("");
async function explainError(errors: string[], logs: string[]) {
  aiExplaining.value = true; aiExplanation.value = ""; aiExpandedKey.value = "expanded";
  try {
    const r = await fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: errors.join("\n"), logs: logs.slice(-30), functionName: pipeline.value?.targetFunctionName }) });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "No response";
  } catch (e: any) { aiExplanation.value = `Failed: ${e.message}`; }
  finally { aiExplaining.value = false; }
}
async function generateItem(intent: string) {
  generating.value = true; generateOpen.value = false; lastGenerated.value = "";
  try {
    const r = await fetch("/api/ai/generate-item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, pipelineId }) });
    const data = await r.json();
    if (data.payload) { const p = typeof data.payload === "string" ? data.payload : JSON.stringify(data.payload, null, 2); itemJson.value = p; lastGenerated.value = p; }
  } catch {}
  finally { generating.value = false; evaluated.value = false; }
}
function closeDropdowns() { generateOpen.value = false; }
function prettifyItem() { try { itemJson.value = JSON.stringify(JSON.parse(itemJson.value), null, 2); } catch {} }

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
{
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
          <div class="flex items-center justify-between">
            <Label class="text-xs">Test Item for <span class="font-mono font-semibold">{{ pipeline.tableName }}</span></Label>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="prettifyItem">{ } Prettify</Button>
              <Button v-if="kiroAvailable && lastGenerated && !evaluated" variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-muted-foreground hover:text-foreground" @click="showEvaluate = true">
                <MessageSquare class="size-3" /> Evaluate
              </Button>
              <Tooltip v-if="kiroAvailable">
                <TooltipTrigger as-child>
                <div class="relative">
                <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-violet-400 hover:text-violet-300" :disabled="generating" @click.stop="generateOpen = !generateOpen">
                  <Sparkles v-if="!generating" class="size-3" /><Loader2 v-else class="size-3 animate-spin" /> {{ generating ? 'Generating...' : 'Generate' }}
                </Button>
                <div v-if="generateOpen" class="absolute right-0 top-7 z-50 w-48 rounded-lg border bg-popover p-1 shadow-lg">
                  <button v-for="opt in [{v:'success',l:'Successful item'},{v:'filtered',l:'Filtered item'},{v:'edge',l:'Failure item'}]" :key="opt.v" class="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-muted cursor-pointer" @click="generateItem(opt.v)">{{ opt.l }}</button>
                </div>
                </div>
                </TooltipTrigger>
                <TooltipContent>Kiro learns from every successful pipeline run to improve generation</TooltipContent>
              </Tooltip>
            </div>
          </div>
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

    <EvaluateModal v-if="kiroAvailable" v-model="showEvaluate" type="pipeline" :id="pipelineId" :sample="lastGenerated" @good="evaluated = true" @bad="evaluated = true" />

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
            <button v-if="kiroAvailable" @click="explainError(extractErrors(expandedLogContent), expandedLogContent)" :disabled="aiExplaining" class="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/20 to-purple-500/20 border border-violet-500/40 text-[11px] font-medium text-violet-300 hover:from-violet-500/30 hover:to-purple-500/30 hover:text-violet-200 cursor-pointer disabled:opacity-50 transition-all shadow-[0_0_6px_rgba(139,92,246,0.1)]">
              <svg class="size-3.5 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="ke2" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#ke2)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg>
              <span v-if="aiExplaining" class="animate-pulse text-violet-400">Asking Kiro...</span>
              <span v-else>Explain with Kiro</span>
            </button>
            <div v-if="kiroAvailable && aiExplanation" class="mt-3 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5 p-3.5 text-xs text-violet-200/90 whitespace-pre-wrap leading-relaxed">
              <div class="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold"><svg class="size-3 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="ke3" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#ke3)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg> Kiro</div>
              {{ aiExplanation }}
            </div>
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
