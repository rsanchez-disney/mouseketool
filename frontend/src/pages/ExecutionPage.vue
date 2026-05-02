<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, inject } from "vue";
import ParticleBurst from "@/components/ParticleBurst.vue";
import { useRoute, useRouter } from "vue-router";

function onKey(e: KeyboardEvent) { if (e.key === "Escape") expandedLogStep.value = ""; }
onMounted(() => { window.addEventListener("keydown", onKey); window.addEventListener("click", closeDropdowns); });
onUnmounted(() => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", closeDropdowns); });
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EvaluateModal from "@/components/EvaluateModal.vue";
import LogViewer from "@/components/LogViewer.vue";
import PipelineRunStep from "@/components/PipelineRunStep.vue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";

import {
  Database, Loader2, ArrowLeft, Play, Check, AlertTriangle, Bell, Inbox, Zap, ChevronDown, ChevronRight, Copy, Maximize2, Square, Search, Sparkles, MessageSquare,
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;
const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));

interface Pipeline { id: string; name: string; type?: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; heavyLoad?: boolean; }
interface Step { id: string; label: string; detail: string; status: "pending" | "running" | "success" | "timeout" | "error" | "filtered" | "diagnosing" | "unknown"; logs: string[]; collapsed: boolean; elapsed?: number; }

const pipeline = ref<Pipeline | null>(null);
const loading = ref(true);
const itemJson = ref("{}");
const executing = ref(false);

const steps = ref<Step[]>([]);

function initSteps(p: Pipeline): Step[] {
  const type = p.type || "app-pipeline";
  const stepDefs: Record<string, { id: string; label: string; detail: string }[]> = {
    "app-pipeline": [
      { id: "dynamodb", label: "DynamoDB Insert", detail: p.tableName },
      { id: "glue", label: "Stream Handler", detail: p.glueFunctionName },
      { id: "sns", label: "SNS Publish", detail: p.topicName },
      { id: "sqs", label: "SQS Deliver", detail: p.queueName },
      { id: "target", label: "Target Lambda", detail: p.targetFunctionName },
    ],
    "direct-stream": [
      { id: "dynamodb", label: "DynamoDB Insert", detail: p.tableName },
      { id: "target", label: "Target Lambda", detail: p.targetFunctionName },
    ],
    "queue-consumer": [
      { id: "sqs-trigger", label: "SQS Send", detail: p.queueName },
      { id: "target", label: "Target Lambda", detail: p.targetFunctionName },
    ],
    "sns-fanout": [
      { id: "sns-trigger", label: "SNS Publish", detail: p.topicName },
      { id: "sqs", label: "SQS Deliver", detail: p.queueName },
      { id: "target", label: "Target Lambda", detail: p.targetFunctionName },
    ],
  };
  return (stepDefs[type] || stepDefs["app-pipeline"]).map(s => ({ ...s, status: "pending" as const, logs: [], collapsed: false }));
}

const allDone = computed(() => steps.value.every(s => s.status !== "pending" && s.status !== "running"));
const confettiRef = ref<InstanceType<typeof ParticleBurst>>();
const copiedStep = ref("");
const expandedLogStep = ref("");
const expandedLogContent = ref<string[]>([]);
const expandedOpen = computed({
  get: () => !!expandedLogStep.value,
  set: (v: boolean) => { if (!v) expandedLogStep.value = ""; },
});
const expandedRootCause = computed(() => extractErrors(expandedLogContent.value));

// Heavy load batch counter
const batchCount = ref(0);
const batchBaseline = ref(0);
const isHeavyLoad = computed(() => !!pipeline.value?.heavyLoad);
const isPayloadInvalid = computed(() => { try { const o = JSON.parse(itemJson.value); return typeof o !== "object" || o === null || !Object.keys(o).length; } catch { return true; } });
const executeDisabledReason = computed(() => { if (isHeavyLoad.value) return "Manual execution is disabled while heavy load mode is active"; if (isPayloadInvalid.value) return "Payload must be a non-empty valid JSON object"; return ""; });
const generating = ref(false);
const generateOpen = ref(false);
const lastIntent = ref("");
const generateIntents = ref<{ id: string; label: string; description: string }[]>([]);
const lastGenerated = ref("");
const showEvaluate = ref(false);
const evaluated = ref(false);
const aiExplaining = ref(false);
const aiExplanation = ref("");
const aiExpandedKey = ref("");
function explainStepError(s: Step) {
  const errors = s.logs.filter(l => l.includes("Error") || l.includes("Exception") || l.includes("Caused by"));
  explainError(errors, s.logs);
}
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
      try { const types = await (await fetch("/api/triggers/types")).json(); const td = types.find((t: any) => t.id === (pipeline.value?.type || "app-pipeline")); if (td?.generateIntents) generateIntents.value = td.generateIntents; } catch {}
      // Load key schema for template
      if (pipeline.value.tableName) try {
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
            if (steps.value[steps.value.length - 1]?.status === "success") confettiRef.value?.fire();
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
  steps.value.forEach(s => { if (s.status === "running" || s.status === "pending") { s.status = "timeout"; s.logs = [...s.logs, "Monitoring stopped — pipeline may still be running in the background"]; } });
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
            <Label class="text-xs">Test {{ pipeline.type === "queue-consumer" ? "Message" : pipeline.type === "sns-fanout" ? "Message" : "Item" }} for <span class="font-mono font-semibold">{{ pipeline.tableName || pipeline.queueName || pipeline.topicName }}</span></Label>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="prettifyItem">{ } Prettify</Button>
              <Button v-if="kiroAvailable && lastGenerated && !evaluated" variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-muted-foreground hover:text-foreground" @click="showEvaluate = true">
                <MessageSquare class="size-3" /> Evaluate
              </Button>
              <Tooltip v-if="kiroAvailable">
                <TooltipTrigger as-child>
                <div class="relative">
                <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-violet-400 hover:text-violet-300" :disabled="generating || executing" @click.stop="generateOpen = !generateOpen">
                  <Sparkles v-if="!generating" class="size-3" /><Loader2 v-else class="size-3 animate-spin" /> {{ generating ? 'Generating...' : 'Generate' }}
                </Button>
                <div v-if="generateOpen" class="absolute right-0 top-7 z-50 w-48 rounded-lg border bg-popover p-1 shadow-lg">
                  <button v-for="opt in generateIntents" :key="opt.id" class="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-muted cursor-pointer" @click="generateItem(opt.id)"><span class="font-medium">{{ opt.label }}</span><span class="block text-muted-foreground text-[10px]">{{ opt.description }}</span></button>
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
            <Tooltip :disabled="!executeDisabledReason"><TooltipTrigger as-child><Button :disabled="executing || isHeavyLoad || isPayloadInvalid" class="gap-2 cursor-pointer active:scale-95 transition-transform min-w-[120px]" @click="execute">
              <Loader2 v-if="executing" class="size-4 animate-spin" /><Play v-else class="size-4" />
              {{ executing ? 'Running...' : allDone && steps[0].status !== 'pending' ? 'Re-run' : 'Execute' }}
            </Button></TooltipTrigger><TooltipContent>{{ executeDisabledReason }}</TooltipContent></Tooltip>
            <Button variant="destructive" :disabled="!executing" class="gap-2 cursor-pointer" @click="stopExecution"><Square class="size-3.5" /> Stop</Button>
          </div>
        </div>
      </div>

      <!-- Pipeline nodes -->
      <div class="space-y-0">
        <template v-for="(s, i) in steps" :key="s.id">
          <PipelineRunStep
            :icon="s.id === 'dynamodb' ? 'Database' : s.id === 'sns' || s.id === 'sns-trigger' ? 'Bell' : s.id === 'sqs' || s.id === 'sqs-trigger' ? 'Inbox' : 'Zap'"
            :label="s.label"
            :detail="s.detail"
            :status="s.status"
            :logs="s.logs"
            :elapsed="s.elapsed"
            :expanded="!s.collapsed && s.logs.length > 0"
            :show-connector="i < steps.length - 1"
            :info-tooltip="i === steps.length - 1 ? 'Lambda response is not available in observed runs. Only CloudWatch logs are captured. Use the Deployments page to see the full response.' : undefined"
            :show-kiro-hint="kiroAvailable && i === steps.length - 1 && (s.status === 'error' || s.status === 'timeout')"
            @toggle="toggleStep(s)"
            @explain="explainStepError(s)"
          />
        </template>
      </div>
    </template>

    <div v-else class="text-center py-16 text-muted-foreground"><p>Pipeline not found.</p></div>

    <EvaluateModal v-if="kiroAvailable" v-model="showEvaluate" type="pipeline" :id="pipelineId" :sample="lastGenerated" :subtype="lastIntent" @good="evaluated = true" @bad="evaluated = true" />

    <!-- Expanded log modal -->
    <LogViewer
      v-model:expanded="expandedOpen"
      :logs="expandedLogContent"
      :root-cause-lines="expandedRootCause"
      :kiro-available="kiroAvailable"
      :ai-explaining="aiExplaining"
      :ai-explanation="aiExplanation"
      height="hidden"
      @explain="explainError(expandedRootCause, expandedLogContent)"
    />

    <!-- Toast -->
    <div v-if="toastMessage" :key="toastMessage" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300">
      <Check class="size-4" />{{ toastMessage }}
    </div>
    <ParticleBurst ref="confettiRef" />
  </div>
</template>
