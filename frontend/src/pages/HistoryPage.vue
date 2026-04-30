<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, inject } from "vue";
import { useRoute, useRouter } from "vue-router";

onUnmounted(() => { stopLive(); });
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PipelineRunStep from "@/components/PipelineRunStep.vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import LogViewer from "@/components/LogViewer.vue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Database, Loader2, ArrowLeft, Check, AlertTriangle, Bell, Inbox, Zap, ChevronDown, ChevronRight, Clock, Radio, Copy, Maximize2, Search, Info, Trash2,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;
const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));

interface Pipeline { id: string; name: string; type?: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; heavyLoad?: boolean; }
interface RunStep { requestId: string; logs: string[]; error: boolean; }
interface InferredStep { status: string; logs: string[]; elapsed?: number; }
interface Run { id: string; timestamp: number; item?: string | null; items?: string[]; source?: "manual" | "external"; handler: RunStep; sns?: InferredStep | null; sqs?: InferredStep | null; target: RunStep & { elapsed?: number } | null; status: string; diagAvailable?: boolean; totalElapsed?: number; }

const pipeline = ref<Pipeline | null>(null);
interface HistoryStepDef { id: string; label: string; icon: string; detailField: string; dataField: string; }
const historySteps = ref<HistoryStepDef[]>([]);
function getStepState(run: Run, step: HistoryStepDef): { status: string; logs: string[]; elapsed?: number } {
  if (step.dataField === "item") {
    // DynamoDB insert is always success if the run exists
    const stripMk = (s: string) => { try { const d = JSON.parse(s); const clean = (Array.isArray(d) ? d : [d]).map((i: any) => { const { _mk_ts, ...r } = i; return r; }); return JSON.stringify(clean.length === 1 ? clean[0] : clean); } catch { return s; } };
    return { status: "success", logs: run.items?.length ? [`Batched ${run.items.length} items`, ...run.items.map(stripMk)] : [stripMk(run.item || "") || "No item data"], elapsed: undefined };
  }
  if (step.dataField === "handler") {
    return { status: run.handler?.error ? "error" : "success", logs: run.handler?.logs || [], elapsed: (run.handler as any)?.elapsed };
  }
  if (step.dataField === "target") {
    if (!run.target) return { status: run.status === "pending" ? "pending" : "pending", logs: ["No invocation detected yet"] };
    if (run.status === "diagnosing") return { status: "diagnosing", logs: run.target.logs || [], elapsed: (run.target as any)?.elapsed };
    return { status: run.target.error ? "error" : run.status === "filtered" ? "filtered" : "success", logs: run.target.logs || [], elapsed: (run.target as any)?.elapsed };
  }
  // sns or sqs
  const data = (run as any)[step.dataField];
  if (!data) return { status: "pending", logs: [] };
  return { status: data.status || "pending", logs: data.logs || [], elapsed: data.elapsed };
}
const runs = ref<Run[]>([]);
const loading = ref(true);
const expandedRun = ref<string | null>(null);
const expandedStep = ref<string | null>(null);
const copiedKey = ref("");
const expandedLogKey = ref("");
const expandedLogContent = ref<string[]>([]);
const expandedOpen = computed({
  get: () => !!expandedLogKey.value,
  set: (v: boolean) => { if (!v) expandedLogKey.value = ""; },
});
const expandedRootCause = computed(() => expandedLogKey.value.endsWith(":target") ? extractErrors(expandedLogContent.value) : []);
const isTargetStep = computed(() => expandedLogKey.value.endsWith(":target"));

// Heavy load batch counter
const batchCount = ref(0);
const stateFilter = ref<string>("all");
const timeRange = ref<string>("all");
const sourceFilter = ref<string>("all");

const filteredRuns = computed(() => {
  let result = runs.value;
  if (stateFilter.value !== "all") result = result.filter(r => r.status === stateFilter.value);
  if (sourceFilter.value !== "all") result = result.filter(r => r.source === sourceFilter.value);
  if (timeRange.value !== "all") {
    const now = Date.now();
    const ms = timeRange.value === "5m" ? 300000 : timeRange.value === "15m" ? 900000 : timeRange.value === "1h" ? 3600000 : timeRange.value === "6h" ? 21600000 : 0;
    if (ms) result = result.filter(r => now - r.timestamp < ms);
  }
  return result;
});

function copyLogs(logs: string[]) {
  navigator.clipboard.writeText(logs.join("\n"));
  toastMsg.value = "Copied to clipboard"; setTimeout(() => toastMsg.value = "", 2000);
}
function expandLogs(key: string, logs: string[]) {
  expandedLogContent.value = logs; expandedLogKey.value = key;
}
const toastMsg = ref("");
const showElapsed = ref(localStorage.getItem("mk:showElapsed") !== "false");
const live = ref(false);
let ws: WebSocket | null = null;


async function loadPipeline() {
  const all = await (await fetch("/api/triggers/pipelines")).json();
  pipeline.value = all.find((p: Pipeline) => p.id === pipelineId) ?? null;
  try { const types = await (await fetch("/api/triggers/types")).json(); const td = types.find((t: any) => t.id === (pipeline.value?.type || "app-pipeline")); if (td?.historySteps) historySteps.value = td.historySteps; } catch {}
}

async function loadHistory(silent = false) {
  if (!silent) loading.value = true;
  try {
    const data = await (await fetch(`/api/triggers/pipelines/${pipelineId}/history`)).json();
    runs.value = data.runs ?? [];
  } catch {} finally { if (!silent) loading.value = false; }
}

const clearing = ref(false);
const confirmClear = ref(false);
const clearIncludePending = ref(false);

const aiExplaining = ref(false);
const aiExplanation = ref("");
const aiRunId = ref("");
async function explainError(errors: string[], logs: string[], runId: string) {
  aiExplaining.value = true; aiExplanation.value = ""; aiRunId.value = runId;
  try {
    const r = await fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: errors.join("\n"), logs: logs.slice(-30), functionName: pipeline.value?.targetFunctionName }) });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "No response";
  } catch (e: any) { aiExplanation.value = `Failed: ${e.message}`; }
  finally { aiExplaining.value = false; }
}
async function clearHistory() {
  clearing.value = true;
  await fetch(`/api/triggers/pipelines/${pipelineId}/history${clearIncludePending.value ? "?includePending=true" : ""}`, { method: "DELETE" });
  clearIncludePending.value = false;
  await loadHistory(true);
  clearing.value = false;
  toastMsg.value = "History cleared"; setTimeout(() => toastMsg.value = "", 2000);
}



function startLive() {
  if (ws) ws.close();
  live.value = true;
  loadHistory(true);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws/pipelines?id=${pipelineId}`);
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "batch-count") { batchCount.value = data.count; }
    else if (data.type === "new-run") { batchCount.value = 0; loadHistory(true); }
    else if (data.type === "step-update") {
      const run = runs.value.find(r => r.id === data.runId);
      if (run) {
        if ((data.step === "sns" || data.step === "sns-trigger") && data.status !== "running") run.sns = { status: data.status, logs: data.logs, elapsed: data.elapsed };
        else if ((data.step === "sqs" || data.step === "sqs-trigger") && data.status !== "running") run.sqs = { status: data.status, logs: data.logs, elapsed: data.elapsed };
        else if (data.step === "target") {
          if (data.status === "running") return;
          if (data.status === "diagnosing") { run.target = { requestId: "", logs: data.logs, error: false, elapsed: data.elapsed }; run.status = "diagnosing"; return; }
          run.target = { requestId: "", logs: data.logs, error: data.status === "error" || data.status === "timeout", elapsed: data.elapsed };
          run.status = data.status === "success" ? "success" : data.status === "filtered" ? "filtered" : "error";
        } else if (data.step === "dynamodb") {
          run.item = data.logs.join("\n");
        }
      } else { loadHistory(true); }
    }
  };
  ws.onclose = () => { if (live.value) setTimeout(() => startLive(), 2000); };
}

function stopLive() {
  live.value = false;
  ws?.close(); ws = null;
}

function toggleRun(id: string) { expandedRun.value = expandedRun.value === id ? null : id; expandedStep.value = null; }
function toggleStep(runId: string, step: string) { const key = `${runId}:${step}`; expandedStep.value = expandedStep.value === key ? null : key; }

function statusColor(status: string) {
  if (status === "success") return "text-green-500";
  if (status === "error") return "text-red-500";
  if (status === "filtered") return "text-blue-400";
  if (status === "pending") return "text-amber-500";
  if (status === "diagnosing") return "text-purple-500";
  return "text-muted-foreground";
}

import { formatTime, formatDate, formatMs, extractErrors } from "@/lib/format";

onMounted(async () => {
  await loadPipeline(); await loadHistory(); startLive();

});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="router.push('/triggers')"><ArrowLeft class="size-4" /></Button>
      <div class="flex-1">
        <h1 class="text-xl font-bold tracking-tight">{{ pipeline?.name ?? 'Pipeline History' }}</h1>
        <p class="text-xs text-muted-foreground">Pipeline invocation history with step-by-step execution tracking.</p>
      </div>
      <Button v-if="runs.length" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform text-muted-foreground hover:text-destructive" :disabled="clearing" @click="confirmClear = true"><Trash2 class="size-3.5" /> Clear</Button>
      <Button v-if="!live" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="startLive"><Radio class="size-3.5" /> Watch Live</Button>
      <Button v-else variant="default" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="stopLive"><Radio class="size-3.5 animate-pulse" /> Watching</Button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading history...</p></div>


    <template v-else>

    <div v-if="!runs.length" class="text-center py-16 text-muted-foreground">
      <Clock class="size-12 mx-auto mb-4 opacity-30" />
      <p>No invocations found in the last hour.</p>
      <p class="text-xs mt-1">Insert items into <span class="font-mono font-semibold">{{ pipeline?.tableName }}</span> to trigger the pipeline, or use the Execute page.</p>
    </div>
    <!-- Filters toolbar -->
    <div v-if="runs.length" class="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
      <div class="flex items-center gap-1.5">
        <button v-for="s in [{v:'all',l:'All'},{v:'success',l:'Success'},{v:'error',l:'Error'},{v:'filtered',l:'Filtered'},{v:'diagnosing',l:'Diagnosing'}]" :key="s.v" @click="stateFilter = s.v" class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer" :class="stateFilter === s.v ? s.v === 'success' ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/40' : s.v === 'error' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' : s.v === 'filtered' ? 'bg-blue-400/20 text-blue-400 ring-1 ring-blue-400/40' : s.v === 'diagnosing' ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' : 'bg-foreground/10 text-foreground ring-1 ring-foreground/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
          {{ s.l }}
        </button>
      </div>
      <div class="h-4 w-px bg-border" />
      <div class="flex items-center gap-1.5">
        <button v-for="t in [{v:'all',l:'All'},{v:'5m',l:'5m'},{v:'15m',l:'15m'},{v:'1h',l:'1h'},{v:'6h',l:'6h'}]" :key="t.v" @click="timeRange = t.v" class="px-2 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer" :class="timeRange === t.v ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
          {{ t.l }}
        </button>
      </div>
      <div class="h-4 w-px bg-border" />
      <div class="flex items-center gap-1.5">
        <button v-for="f in [{v:'all',l:'All'},{v:'manual',l:'Manual'},{v:'external',l:'External'}]" :key="f.v" @click="sourceFilter = f.v" class="px-2 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer" :class="sourceFilter === f.v ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
          {{ f.l }}
        </button>
      </div>
      <span class="ml-auto text-[11px] text-muted-foreground font-mono tabular-nums">{{ filteredRuns.length }}<span class="text-muted-foreground/40">/{{ runs.length }}</span></span>
    </div>
    <div v-if="pipeline?.heavyLoad && batchCount > 0" class="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-2.5 mt-3">
      <div class="size-2 rounded-full bg-orange-500 animate-pulse" />
      <span class="text-xs text-orange-400 font-mono">Batching {{ batchCount }} new item{{ batchCount !== 1 ? 's' : '' }}...</span>
    </div>

    <div class="space-y-2">
      <Card v-for="run in filteredRuns" :key="run.id" class="!py-0 !gap-0 overflow-hidden transition-all" :class="expandedRun === run.id ? 'border-primary/40' : ''">
        <!-- Run header -->
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors" @click="toggleRun(run.id)">
          <div class="flex items-center justify-center size-8 rounded-full shrink-0" :class="[run.status==='success'?'bg-green-500/20':run.status==='error'?'bg-red-500/20':run.status==='filtered'?'bg-blue-400/20':run.status==='diagnosing'?'bg-purple-500/20':'bg-amber-500/20']">
            <Check v-if="run.status==='success'" class="size-4 text-green-500" />
            <AlertTriangle v-else-if="run.status==='error'" class="size-4 text-red-500" />
            <Bell v-else-if="run.status==='filtered'" class="size-4 text-blue-400" />
            <Search v-else-if="run.status==='diagnosing'" class="size-4 text-purple-500 animate-pulse" />
            <Loader2 v-else class="size-4 text-amber-500 animate-spin" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold font-mono truncate">{{ run.id.slice(0, 8) }}</p>
            <p class="text-xs text-muted-foreground">{{ formatDate(run.timestamp) }} {{ formatTime(run.timestamp) }} <Badge v-if="run.source" variant="outline" class="text-[9px] ml-1">{{ run.source === 'manual' ? 'manual' : 'external' }}</Badge> <span v-if="showElapsed && run.totalElapsed" class="text-[10px] ml-1 font-mono">{{ formatMs(run.totalElapsed) }}</span></p>
          </div>
          <Badge :class="[run.status==='success'?'bg-green-500/20 text-green-500 border-green-500/40':run.status==='error'?'bg-red-500/20 text-red-500 border-red-500/40':run.status==='filtered'?'bg-blue-400/20 text-blue-400 border-blue-400/40':run.status==='diagnosing'?'bg-purple-500/20 text-purple-500 border-purple-500/40':'bg-amber-500/20 text-amber-500 border-amber-500/40']" class="text-[10px]">{{ run.status === 'diagnosing' ? 'diagnosing' : run.status }}</Badge>
          <ChevronDown v-if="expandedRun === run.id" class="size-4 text-muted-foreground shrink-0" />
          <ChevronRight v-else class="size-4 text-muted-foreground shrink-0" />
        </button>

        <!-- Expanded: pipeline steps -->
        <div v-if="expandedRun === run.id" class="border-t px-4 py-3 space-y-0">
          <PipelineRunStep
            v-for="(step, i) in historySteps"
            :key="step.id"
            :icon="step.icon"
            :label="step.label"
            :detail="(pipeline as any)?.[step.detailField] || ''"
            :status="getStepState(run, step).status"
            :logs="getStepState(run, step).logs"
            :elapsed="getStepState(run, step).elapsed"
            :expanded="expandedStep === run.id + ':' + step.id"
            :show-connector="i < historySteps.length - 1"
            :show-kiro-hint="kiroAvailable && i === historySteps.length - 1 && (getStepState(run, step).status === 'error' || getStepState(run, step).status === 'timeout')"
            :ai-explaining="aiExplaining && aiRunId === run.id"
            :ai-explanation="aiRunId === run.id ? aiExplanation : ''"
            @toggle="toggleStep(run.id, step.id)"
            @explain="explainError(getStepState(run, step).logs.filter(l => l.includes('Error') || l.includes('Exception') || l.includes('Caused by')), getStepState(run, step).logs, run.id)"
          />

        </div>
      </Card>
    </div>
    </template>

    <LogViewer
      v-model:expanded="expandedOpen"
      :logs="expandedLogContent"
      :root-cause-lines="expandedRootCause"
      :kiro-available="isTargetStep && kiroAvailable"
      :ai-explaining="aiExplaining && aiRunId === expandedLogKey"
      :ai-explanation="aiRunId === expandedLogKey ? aiExplanation : ''"
      height="hidden"
      @explain="explainError(expandedRootCause, expandedLogContent, expandedLogKey)"
    />

    <Dialog v-model:open="confirmClear"><DialogContent class="sm:max-w-sm"><DialogHeader><DialogTitle>Clear history?</DialogTitle><DialogDescription>This will delete all completed invocation records.</DialogDescription></DialogHeader>
      <label class="flex items-center gap-2 text-sm cursor-pointer"><input v-model="clearIncludePending" type="checkbox" class="accent-primary" /><span class="text-muted-foreground">Also remove pending/diagnosing runs</span></label>
      <div class="flex justify-end gap-2 pt-2"><Button variant="outline" size="sm" @click="confirmClear = false">Cancel</Button><Button variant="destructive" size="sm" @click="confirmClear = false; clearHistory()">Clear</Button></div>
    </DialogContent></Dialog>

    <!-- Toast -->
    <div v-if="toastMsg" :key="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <Check class="size-4" />{{ toastMsg }}
    </div>
  </div>
</template>
