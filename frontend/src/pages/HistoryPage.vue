<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") expandedLogKey.value = ""; }
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => { window.removeEventListener("keydown", onKey); stopLive(); });
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Database, Loader2, ArrowLeft, Check, AlertTriangle, Bell, Inbox, Zap, ChevronDown, ChevronRight, Clock, Radio, Copy, Maximize2, Minimize2, Search, X, Info,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;

interface Pipeline { id: string; name: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; }
interface RunStep { requestId: string; logs: string[]; error: boolean; }
interface InferredStep { status: string; logs: string[]; elapsed?: number; }
interface Run { id: string; timestamp: number; item?: string | null; source?: "manual" | "external"; handler: RunStep; sns?: InferredStep | null; sqs?: InferredStep | null; target: RunStep & { elapsed?: number } | null; status: string; diagAvailable?: boolean; totalElapsed?: number; }

const pipeline = ref<Pipeline | null>(null);
const runs = ref<Run[]>([]);
const loading = ref(true);
const expandedRun = ref<string | null>(null);
const expandedStep = ref<string | null>(null);
const copiedKey = ref("");
const expandedLogKey = ref("");
const expandedLogContent = ref<string[]>([]);
const logSearch = ref("");
const searchOpen = ref(false);

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
let eventSource: EventSource | null = null;

async function loadPipeline() {
  const all = await (await fetch("/api/triggers/pipelines")).json();
  pipeline.value = all.find((p: Pipeline) => p.id === pipelineId) ?? null;
}

async function loadHistory(silent = false) {
  if (!silent) loading.value = true;
  try {
    const data = await (await fetch(`/api/triggers/pipelines/${pipelineId}/history`)).json();
    runs.value = data.runs ?? [];
  } catch {} finally { if (!silent) loading.value = false; }
}

let liveInterval: ReturnType<typeof setInterval> | null = null;

function startLive() {
  if (eventSource) eventSource.close();
  live.value = true;
  loadHistory(true);
  eventSource = new EventSource(`/api/triggers/pipelines/${pipelineId}/history/live`);
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "new-run") loadHistory(true);
    else if (data.type === "step-update") {
      const run = runs.value.find(r => r.id === data.runId);
      if (run) {
        if (data.step === "sns" && data.status !== "running") run.sns = { status: data.status, logs: data.logs, elapsed: data.elapsed };
        else if (data.step === "sqs" && data.status !== "running") run.sqs = { status: data.status, logs: data.logs, elapsed: data.elapsed };
        else if (data.step === "target") {
          if (data.status === "running") return;
          if (data.status === "diagnosing") {
            run.target = { requestId: "", logs: data.logs, error: false, elapsed: data.elapsed };
            run.status = "diagnosing";
            return;
          }
          run.target = { requestId: "", logs: data.logs, error: data.status === "error" || data.status === "timeout", elapsed: data.elapsed };
          run.status = data.status === "success" ? "success" : data.status === "filtered" ? "filtered" : "error";
          // Compute total elapsed
          run.totalElapsed = ((run.handler as any)?.elapsed || 0) + (run.sns?.elapsed || 0) + (run.sqs?.elapsed || 0) + (run.target?.elapsed || 0);
          if (data.status === "error") loadHistory(true);
        }
      } else { loadHistory(true); }
    }
  };
  eventSource.onerror = () => { stopLive(); };
}

function stopLive() {
  live.value = false;
  eventSource?.close(); eventSource = null;
}

function toggleRun(id: string) { expandedRun.value = expandedRun.value === id ? null : id; expandedStep.value = null; }
function toggleStep(runId: string, step: string) { const key = `${runId}:${step}`; expandedStep.value = expandedStep.value === key ? null : key; }

function statusColor(status: string) {
  if (status === "success") return "text-green-500";
  if (status === "error") return "text-red-500";
  if (status === "filtered") return "text-blue-400";
  if (status === "pending") return "text-amber-500";
  return "text-muted-foreground";
}

import { formatTime, formatDate, formatMs, extractErrors } from "@/lib/format";

onMounted(async () => { await loadPipeline(); await loadHistory(); startLive(); });
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="router.push('/triggers')"><ArrowLeft class="size-4" /></Button>
      <div class="flex-1">
        <h1 class="text-xl font-bold tracking-tight">{{ pipeline?.name ?? 'Pipeline History' }}</h1>
        <p class="text-xs text-muted-foreground">CloudWatch-based invocation history grouped by RequestId.</p>
      </div>
      <Button v-if="!live" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="startLive"><Radio class="size-3.5" /> Watch Live</Button>
      <Button v-else variant="default" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="stopLive"><Radio class="size-3.5 animate-pulse" /> Watching</Button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading history...</p></div>

    <div v-else-if="!runs.length" class="text-center py-16 text-muted-foreground">
      <Clock class="size-12 mx-auto mb-4 opacity-30" />
      <p>No invocations found in the last hour.</p>
      <p class="text-xs mt-1">Insert items into <span class="font-mono font-semibold">{{ pipeline?.tableName }}</span> to trigger the pipeline, or use the Execute page.</p>
    </div>

    <div v-else class="space-y-2">
      <Card v-for="run in runs" :key="run.id" class="!py-0 !gap-0 overflow-hidden transition-all" :class="expandedRun === run.id ? 'border-primary/40' : ''">
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
          <!-- DynamoDB Insert -->
          <div class="border rounded-lg overflow-hidden border-green-500/40">
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="toggleStep(run.id, 'dynamo')">
              <div class="size-6 rounded-full bg-green-500/20 flex items-center justify-center"><Database class="size-3 text-green-500" /></div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold">DynamoDB Insert</p>
                <p class="text-[10px] text-muted-foreground">{{ formatTime(run.timestamp) }}</p>
              </div>
              <Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px]">success</Badge>
              <ChevronDown v-if="expandedStep===run.id+':dynamo'" class="size-3.5 text-muted-foreground" />
              <ChevronRight v-else class="size-3.5 text-muted-foreground" />
            </button>
            <div v-if="expandedStep===run.id+':dynamo'" class="border-t bg-zinc-950">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs([`Received: ${new Date(run.timestamp).toISOString()}`, '', run.item || 'No item data available'])"><Copy class="size-3" /></Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandLogs(run.id+':dynamo', [`Received: ${new Date(run.timestamp).toISOString()}`, '', run.item || 'No item data available'])"><Maximize2 class="size-3" /></Button>
              </div>
              <div class="px-3 pb-2 max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <pre class="text-xs text-zinc-300 font-mono whitespace-pre leading-relaxed">Received: {{ new Date(run.timestamp).toISOString() }}

{{ run.item || 'No item data available' }}</pre>
              </div>
            </div>
          </div>
          <div class="pl-[11px]"><div class="w-0.5 h-4 bg-green-500" /></div>

          <!-- Stream Handler -->
          <div class="border rounded-lg overflow-hidden" :class="[run.handler.error?'border-red-500/40':'border-green-500/40']">
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="toggleStep(run.id, 'handler')">
              <div class="size-6 rounded-full flex items-center justify-center" :class="[run.handler.error?'bg-red-500/20':'bg-green-500/20']">
                <AlertTriangle v-if="run.handler.error" class="size-3 text-red-500" />
                <Zap v-else class="size-3 text-green-500" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold">Stream Handler</p>
                <p class="text-[10px] text-muted-foreground font-mono truncate">{{ pipeline?.glueFunctionName }}</p>
              </div>
              <span v-if="showElapsed && (run.handler as any).elapsed" class="text-[10px] text-muted-foreground font-mono shrink-0">{{ formatMs((run.handler as any).elapsed) }}</span>
              <Badge :class="[run.handler.error?'bg-red-500/20 text-red-500 border-red-500/40':'bg-green-500/20 text-green-500 border-green-500/40']" class="text-[10px]">{{ run.handler.error ? 'error' : 'success' }}</Badge>
              <ChevronDown v-if="expandedStep===run.id+':handler'" class="size-3.5 text-muted-foreground" />
              <ChevronRight v-else class="size-3.5 text-muted-foreground" />
            </button>
            <div v-if="expandedStep===run.id+':handler'" class="border-t bg-zinc-950">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs(run.handler.logs)"><Copy class="size-3" /></Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandLogs(run.id+':handler', run.handler.logs)"><Maximize2 class="size-3" /></Button>
              </div>
              <div class="px-3 pb-2 max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <div v-for="(line, i) in run.handler.logs" :key="i" :class="[line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') ? 'text-red-400' : line.startsWith('⚠') ? 'text-yellow-400' : line.includes('──') ? 'text-blue-400 font-semibold mt-2' : 'text-zinc-300']" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
              </div>
            </div>
          </div>

          <!-- SNS -->
          <div class="pl-[11px]"><div class="w-0.5 h-4" :class="run.handler.error?'bg-red-500':'bg-green-500'" /></div>
          <div class="border rounded-lg overflow-hidden" :class="[!run.sns||run.sns.status==='skipped'?'border-dashed opacity-60':run.sns.status==='filtered'?'border-blue-400/40':run.sns.status==='success'?'border-green-500/40':'border-amber-500/40']">
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="toggleStep(run.id, 'sns')">
              <div class="size-6 rounded-full flex items-center justify-center" :class="[!run.sns||run.sns.status==='skipped'?'bg-muted':run.sns.status==='filtered'?'bg-blue-400/20':run.sns.status==='success'?'bg-green-500/20':'bg-amber-500/20']">
                <Bell class="size-3" :class="[!run.sns||run.sns.status==='skipped'?'text-muted-foreground':run.sns.status==='filtered'?'text-blue-400':run.sns.status==='success'?'text-green-500':'text-amber-500']" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold">SNS Publish</p>
                <p class="text-[10px] text-muted-foreground">{{ pipeline?.topicName }}</p>
              </div>
              <span v-if="showElapsed && run.sns?.elapsed" class="text-[10px] text-muted-foreground font-mono shrink-0">{{ formatMs(run.sns.elapsed) }}</span>
              <Badge :class="[!run.sns||run.sns.status==='skipped'?'bg-muted text-muted-foreground':run.sns.status==='filtered'?'bg-blue-400/20 text-blue-400 border-blue-400/40':run.sns.status==='success'?'bg-green-500/20 text-green-500 border-green-500/40':'bg-amber-500/20 text-amber-500 border-amber-500/40']" class="text-[10px]">{{ run.sns?.status ?? 'pending' }}</Badge>
              <ChevronDown v-if="expandedStep===run.id+':sns'" class="size-3.5 text-muted-foreground" />
              <ChevronRight v-else class="size-3.5 text-muted-foreground" />
            </button>
            <div v-if="expandedStep===run.id+':sns' && run.sns?.logs?.length" class="border-t bg-zinc-950">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs(run.sns.logs)"><Copy class="size-3" /></Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandLogs(run.id+':sns', run.sns.logs)"><Maximize2 class="size-3" /></Button>
              </div>
              <div class="px-3 pb-2 max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <div v-for="(line, i) in run.sns.logs" :key="i" class="text-xs font-mono whitespace-pre leading-relaxed text-zinc-300">{{ line }}</div>
              </div>
            </div>
          </div>

          <!-- SQS -->
          <div class="pl-[11px]"><div class="w-0.5 h-4" :class="[!run.sqs||run.sqs.status==='skipped'?'bg-border':run.sqs.status==='filtered'?'bg-blue-400':run.sqs.status==='success'?'bg-green-500':'bg-amber-500']" /></div>
          <div class="border rounded-lg overflow-hidden" :class="[!run.sqs||run.sqs.status==='skipped'?'border-dashed opacity-60':run.sqs.status==='filtered'?'border-blue-400/40':run.sqs.status==='success'?'border-green-500/40':'border-amber-500/40']">
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="toggleStep(run.id, 'sqs')">
              <div class="size-6 rounded-full flex items-center justify-center" :class="[!run.sqs||run.sqs.status==='skipped'?'bg-muted':run.sqs.status==='filtered'?'bg-blue-400/20':run.sqs.status==='success'?'bg-green-500/20':'bg-amber-500/20']">
                <Inbox class="size-3" :class="[!run.sqs||run.sqs.status==='skipped'?'text-muted-foreground':run.sqs.status==='filtered'?'text-blue-400':run.sqs.status==='success'?'text-green-500':'text-amber-500']" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold">SQS Deliver</p>
                <p class="text-[10px] text-muted-foreground">{{ pipeline?.queueName }}</p>
              </div>
              <span v-if="showElapsed && run.sqs?.elapsed" class="text-[10px] text-muted-foreground font-mono shrink-0">{{ formatMs(run.sqs.elapsed) }}</span>
              <Badge :class="[!run.sqs||run.sqs.status==='skipped'?'bg-muted text-muted-foreground':run.sqs.status==='filtered'?'bg-blue-400/20 text-blue-400 border-blue-400/40':run.sqs.status==='success'?'bg-green-500/20 text-green-500 border-green-500/40':'bg-amber-500/20 text-amber-500 border-amber-500/40']" class="text-[10px]">{{ run.sqs?.status ?? 'pending' }}</Badge>
              <ChevronDown v-if="expandedStep===run.id+':sqs'" class="size-3.5 text-muted-foreground" />
              <ChevronRight v-else class="size-3.5 text-muted-foreground" />
            </button>
            <div v-if="expandedStep===run.id+':sqs' && run.sqs?.logs?.length" class="border-t bg-zinc-950">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs(run.sqs.logs)"><Copy class="size-3" /></Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandLogs(run.id+':sqs', run.sqs.logs)"><Maximize2 class="size-3" /></Button>
              </div>
              <div class="px-3 pb-2 max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <div v-for="(line, i) in run.sqs.logs" :key="i" class="text-xs font-mono whitespace-pre leading-relaxed text-zinc-300">{{ line }}</div>
              </div>
            </div>
          </div>
          <div class="pl-[11px]"><div class="w-0.5 h-4" :class="run.status==='filtered'?'bg-blue-400':run.status==='diagnosing'?'bg-purple-500 animate-pulse':run.target?run.target.error?'bg-red-500':'bg-green-500':'bg-border'" /></div>

          <!-- Target Lambda -->
          <div v-if="run.target" class="border rounded-lg overflow-hidden" :class="[run.target.error?'border-red-500/40':run.status==='filtered'?'border-blue-400/40':run.status==='diagnosing'?'border-purple-500/40 animate-pulse':'border-green-500/40']">
            <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="toggleStep(run.id, 'target')">
              <div class="size-6 rounded-full flex items-center justify-center" :class="[run.target.error?'bg-red-500/20':run.status==='filtered'?'bg-blue-400/20':run.status==='diagnosing'?'bg-purple-500/20':'bg-green-500/20']">
                <AlertTriangle v-if="run.target.error" class="size-3 text-red-500" />
                <Bell v-else-if="run.status==='filtered'" class="size-3 text-blue-400" />
                <Search v-else-if="run.status==='diagnosing'" class="size-3 text-purple-500" />
                <Zap v-else class="size-3 text-green-500" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold">Target Lambda</p>
                <p class="text-[10px] text-muted-foreground font-mono truncate">{{ pipeline?.targetFunctionName }}</p>
              </div>
              <Tooltip v-if="run.diagAvailable"><TooltipTrigger as-child><Info class="size-3.5 text-blue-400 shrink-0 cursor-help" /></TooltipTrigger><TooltipContent>Error logs available from diagnostic invoke</TooltipContent></Tooltip>
              <span v-if="showElapsed && run.target.elapsed" class="text-[10px] text-muted-foreground font-mono shrink-0">{{ formatMs(run.target.elapsed) }}</span>
              <Badge :class="[run.target.error?'bg-red-500/20 text-red-500 border-red-500/40':run.status==='filtered'?'bg-blue-400/20 text-blue-400 border-blue-400/40':run.status==='diagnosing'?'bg-purple-500/20 text-purple-500 border-purple-500/40':'bg-green-500/20 text-green-500 border-green-500/40']" class="text-[10px]">{{ run.status === 'filtered' ? 'filtered' : run.status === 'diagnosing' ? 'diagnosing...' : run.target.error ? 'error' : 'success' }}</Badge>
              <ChevronDown v-if="expandedStep===run.id+':target'" class="size-3.5 text-muted-foreground" />
              <ChevronRight v-else class="size-3.5 text-muted-foreground" />
            </button>
            <div v-if="expandedStep===run.id+':target'" class="border-t bg-zinc-950">
              <div class="flex items-center justify-end gap-1 px-2 pt-1">
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs(run.target.logs)"><Copy class="size-3" /></Button>
                <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandLogs(run.id+':target', run.target.logs)"><Maximize2 class="size-3" /></Button>
              </div>
              <div class="px-3 pb-2 max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 w-0 min-w-full">
                <div v-if="run.target.error && extractErrors(run.target.logs).length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
                  <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
                  <div v-for="(line, i) in extractErrors(run.target.logs)" :key="'err'+i" class="text-xs font-mono text-red-300 whitespace-pre leading-relaxed">{{ line.trim() }}</div>
                </div>
                <div v-for="(line, i) in run.target.logs" :key="i" :class="[line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' : line.startsWith('⚠') ? 'text-yellow-400' : line.includes('──') ? 'text-blue-400 font-semibold mt-2' : 'text-zinc-400']" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
              </div>
            </div>
          </div>
          <div v-else class="border border-dashed rounded-lg px-3 py-2 flex items-center gap-3 opacity-60">
            <div class="size-6 rounded-full bg-muted flex items-center justify-center"><Zap class="size-3 text-muted-foreground" /></div>
            <p class="text-xs text-muted-foreground">Target Lambda — no invocation detected yet</p>
          </div>
        </div>
      </Card>
    </div>

    <!-- Expanded log modal -->
    <Dialog :open="!!expandedLogKey" @update:open="expandedLogKey = ''">
      <DialogContent class="!max-w-[97vw] w-[97vw] max-h-[90vh] p-0 gap-0 border-zinc-800 bg-zinc-950 shadow-2xl !rounded-lg [&>button]:hidden">
        <DialogTitle class="sr-only">Logs</DialogTitle><DialogDescription class="sr-only">Expanded log output</DialogDescription>
        <div class="flex items-center justify-end gap-1 px-3 py-2">
          <div class="mr-auto flex items-center">
            <Button v-if="!searchOpen" variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="searchOpen = true"><Search class="size-3.5" /></Button>
            <div v-else class="relative flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200"><Search class="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" /><input v-model="logSearch" placeholder="Search logs…" class="h-7 w-56 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500" @vue:mounted="(e: any) => e.el.focus()" /><Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-400 hover:text-white shrink-0" @click="searchOpen = false; logSearch = ''"><X class="size-3" /></Button></div>
          </div>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="copyLogs(expandedLogContent)"><Copy class="size-3.5" /></Button>
          <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="expandedLogKey = ''"><Minimize2 class="size-3.5" /></Button>
        </div>
        <div class="overflow-auto scrollbar-visible px-4 pb-4 h-[80vh]">
          <div v-if="extractErrors(expandedLogContent).length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
            <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
            <div v-for="(line, i) in extractErrors(expandedLogContent)" :key="'erc'+i" class="text-xs font-mono text-red-300 whitespace-pre leading-relaxed">{{ line.trim() }}</div>
          </div>
          <div v-for="(line, i) in expandedLogContent" :key="i" :class="[logSearch && !line.toLowerCase().includes(logSearch.toLowerCase()) ? 'opacity-20' : line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' : line.startsWith('⚠') ? 'text-yellow-400' : line.includes('──') ? 'text-blue-400 font-semibold mt-2' : 'text-zinc-400']" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Toast -->
    <div v-if="toastMsg" :key="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <Check class="size-4" />{{ toastMsg }}
    </div>
  </div>
</template>
