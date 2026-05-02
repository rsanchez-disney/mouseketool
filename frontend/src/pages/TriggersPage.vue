<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from "vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import { useRouter } from "vue-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import Toggle from "@/components/ui/Toggle.vue";
import TargetLambdaSelector from "@/components/TargetLambdaSelector.vue";
import VaultIcon from "@/components/icons/VaultIcon.vue";
import {
  Database, Loader2, Plus, Radio, CircleOff, ArrowRight, ArrowLeft, RefreshCw, AlertTriangle, Check,
  HardDrive, Inbox, Zap, Cable, Trash2, RotateCcw, Play, Bell, Package, Settings2, Clock, Plug, CheckCircle2, XCircle, X, ShieldAlert, ChevronRight, ChevronDown, ListFilter, Pencil, Flame, Info, Save, Workflow, Megaphone, Search } from "lucide-vue-next";

interface PipelineTypeDef { id: string; name: string; description: string; icon: string; steps: string[]; triggerKind: string; requiresStreamHandler: boolean; requiresFilterPolicy: boolean; supportsHeavyLoad: boolean; heavyLoadLabel?: string; aiLearningSource: string; templateLambda?: string; disabled?: boolean; disabledReason?: string; }

const triggerRouter = useRouter();
type SourceType = "dynamodb" | "s3";
const sources = [
  { type: "dynamodb" as SourceType, label: "DynamoDB", icon: Database, enabled: true },
  { type: "s3" as SourceType, label: "S3 Bucket", icon: HardDrive, enabled: false, tooltip: "Coming in a future release" },
];

// Toast
const toastMessage = ref("");
const toastError = ref(false);
function showToast(msg: string, isError = false) {
  toastMessage.value = msg; toastError.value = isError;
  setTimeout(() => { toastMessage.value = ""; }, 4000);
}

// View + wizard state
const view = ref<"list" | "type-select" | "wizard">("list");
const pipelineTypes = ref<PipelineTypeDef[]>([]);
const selectedPipelineType = ref<PipelineTypeDef | null>(null);
const typeIcons: Record<string, any> = { Workflow, Zap, Inbox, Megaphone, HardDrive };
const stepIndex = ref(0);
watch(stepIndex, () => window.scrollTo({ top: 0, behavior: "smooth" }));
const selectedSource = ref<SourceType | null>(null);

// DynamoDB
interface DynamoTable { name: string; status: string; itemCount?: number; sizeBytes?: number; keySchema?: { name: string; type: string }[]; streamEnabled: boolean; streamViewType?: string | null; streamArn?: string | null; }
const tables = ref<DynamoTable[]>([]);
const loading = ref(false);
const selectedTable = ref<DynamoTable | null>(null);
const showCreate = ref(false);
const newTableName = ref(""); const newPartitionKey = ref(""); const newPartitionKeyType = ref("S");
const newSortKey = ref(""); const newSortKeyType = ref("S"); const creating = ref(false);
const enablingStream = ref("");
// Schema save/restore
const showRestore = ref(false);
const savedSchemas = ref<{ tableName: string; hasSeed: boolean }[]>([]);
const restoreSchema = ref("");
const restoreSeedJson = ref("");
const restoring = ref(false);
const schemaSavedWizard = ref(false);
const showSaveSchema = ref(false);
watch(restoreSchema, async (name) => {
  if (!name) { restoreSeedJson.value = ""; return; }
  try {
    const schema = await (await fetch(`/api/dynamodb/schemas/${name}`)).json();
    restoreSeedJson.value = schema.seedItem ? JSON.stringify(schema.seedItem, null, 2) : "";
  } catch { restoreSeedJson.value = ""; }
});
const saveSeedJson = ref("");
async function saveTableSchema() {
  if (!selectedTable.value) return;
  const body: any = {};
  if (saveSeedJson.value.trim()) { try { body.seedItem = JSON.parse(saveSeedJson.value); } catch {} }
  await fetch(`/api/dynamodb/tables/${selectedTable.value.name}/save-schema`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  showSaveSchema.value = false; saveSeedJson.value = "";
  schemaSavedWizard.value = true; setTimeout(() => schemaSavedWizard.value = false, 3000);
}
async function loadSchemas() { try { savedSchemas.value = await (await fetch("/api/dynamodb/schemas")).json(); } catch {} }
async function restoreTable() {
  if (!restoreSchema.value) return;
  restoring.value = true;
  try {
    const body: any = {};
    if (restoreSeedJson.value.trim()) body.seedItem = JSON.parse(restoreSeedJson.value);
    await fetch(`/api/dynamodb/schemas/${restoreSchema.value}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    showRestore.value = false; restoreSchema.value = ""; restoreSeedJson.value = "";
    await loadTables();
  } catch {}
  restoring.value = false;
}



// SNS
interface SnsTopic { arn: string; name: string; }
const topics = ref<SnsTopic[]>([]);
const loadingTopics = ref(false);
const selectedTopic = ref<SnsTopic | null>(null);
const showCreateTopic = ref(false);
const newTopicName = ref(""); const creatingTopic = ref(false); const topicCreatedByUs = ref(false);

// Filter policy
type FilterOp = "exact-string" | "prefix" | "anything-but" | "anything-but-prefix" | "suffix" | "wildcard" | "exact-number" | "number-range" | "exists";
interface FilterRule { field: string; op: FilterOp; values: string[]; chipInput: string; rangeMin: string; rangeMax: string; rangeLow: ">" | ">="; rangeHigh: "<" | "<="; existsVal: boolean; }
const filterEnabled = ref(false);
const filterScope = ref<"MessageBody" | "MessageAttributes">("MessageBody");
const filterRules = ref<FilterRule[]>([]);
const filterOps: { value: FilterOp; label: string }[] = [
  { value: "exact-string", label: "String — exact match" },
  { value: "prefix", label: "String — prefix" },
  { value: "anything-but", label: "String — anything-but" },
  { value: "anything-but-prefix", label: "String — anything-but prefix" },
  { value: "suffix", label: "String — suffix" },
  { value: "wildcard", label: "String — wildcard" },
  { value: "exact-number", label: "Number — exact match" },
  { value: "number-range", label: "Number — range" },
  { value: "exists", label: "Key — exists / not exists" },
];
function newRule(): FilterRule { return { field: "", op: "exact-string", values: [], chipInput: "", rangeMin: "", rangeMax: "", rangeLow: ">=", rangeHigh: "<=", existsVal: true }; }
function addFilterRule() { filterRules.value.push(newRule()); }
watch(filterEnabled, v => { if (v && !filterRules.value.length) addFilterRule(); });
function removeFilterRule(i: number) { filterRules.value.splice(i, 1); }
function addChip(r: FilterRule) { const v = r.chipInput.trim(); if (!v || r.values.includes(v)) return; r.values.push(v); r.chipInput = ""; }
function removeChip(r: FilterRule, i: number) { r.values.splice(i, 1); }
function buildFilterPolicy(): Record<string, unknown> | null {
  if (!filterEnabled.value || !filterRules.value.length) return null;
  const policy: Record<string, unknown> = {};
  for (const r of filterRules.value) {
    if (!r.field) continue;
    let condition: unknown;
    switch (r.op) {
      case "exact-string": condition = r.values; break;
      case "prefix": condition = r.values.map(v => ({ prefix: v })); break;
      case "anything-but": condition = [{ "anything-but": r.values }]; break;
      case "anything-but-prefix": condition = [{ "anything-but": { prefix: r.values.length === 1 ? r.values[0] : r.values } }]; break;
      case "suffix": condition = r.values.map(v => ({ suffix: v })); break;
      case "wildcard": condition = r.values.map(v => ({ wildcard: v })); break;
      case "exact-number": condition = r.values.map(v => ({ numeric: ["=", Number(v)] })); break;
      case "number-range": {
        const ops: (string | number)[] = [];
        if (r.rangeMin) { ops.push(r.rangeLow, Number(r.rangeMin)); }
        if (r.rangeMax) { ops.push(r.rangeHigh, Number(r.rangeMax)); }
        condition = ops.length ? [{ numeric: ops }] : [];
        break;
      }
      case "exists": condition = [{ exists: r.existsVal }]; break;
    }
    if (condition && (Array.isArray(condition) ? condition.length : true)) policy[r.field] = condition;
  }
  return Object.keys(policy).length ? policy : null;
}

// SQS
interface SqsQueue { name: string; url: string; arn: string | null; messageCount: number; }
const queues = ref<SqsQueue[]>([]);
const loadingQueues = ref(false);
const selectedQueue = ref<SqsQueue | null>(null);
const showCreateQueue = ref(false);
const newQueueName = ref(""); const creatingQueue = ref(false); const createDlq = ref(true); const maxReceiveCount = ref(3); const queueCreatedByUs = ref(false);

// Lambda + templates
interface LambdaFunc { name: string; runtime: string; handler: string; arn: string; templateId?: string | null; outdated?: boolean; }
interface Template { id: string; name: string; description: string; envVars: string[]; hash: string; }
const functions = ref<LambdaFunc[]>([]);
const templates = ref<Template[]>([]);
const loadingFunctions = ref(false);
const selectedGlueFunction = ref<LambdaFunc | null>(null);
const selectedTargetFunction = ref<LambdaFunc | null>(null);
const showDeployTemplate = ref(false);
const deployTemplateName = ref(""); const deployingTemplate = ref(false);

// Wire
const wiring = ref(false);
const wireResult = ref<{ wired: boolean; results: { step: string; detail: string }[] } | null>(null);
const wireError = ref("");
const wireButtonRef = ref<HTMLElement | null>(null);
const pipelineName = ref("");

watch([selectedGlueFunction, selectedTargetFunction], ([g, t]) => {
  if (g && t) nextTick(() => wireButtonRef.value?.scrollIntoView({ behavior: "smooth", block: "center" }));
});

// Mappings
interface Pipeline { id: string; name: string; type?: string; sourceType: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; addons?: string[]; createdAt: string; topicCreatedByUs?: boolean; queueCreatedByUs?: boolean; vaultConfig?: { url: string; token: string; paths: string[] }; heavyLoad?: boolean; targetMissing?: boolean; vaultIncomplete?: boolean; }

function getWarnings(p: Pipeline): { message: string }[] {
  const w: { message: string }[] = [];
  if (p.targetMissing) w.push({ message: "Target Lambda build not found — select a deployment on the edit page" });
  if (p.vaultIncomplete) w.push({ message: "Vault secrets need to be recreated after LocalStack restart" });
  return w;
}
const mappings = ref<Pipeline[]>([]);
const loadingMappings = ref(false);
const deploymentInfo = ref<Record<string, { status: string; runtime: string; deployedAt: string }>>({});
async function loadDeploymentInfo() { try { const deps = await (await fetch("/api/deployments")).json(); for (const d of deps) { deploymentInfo.value[d.functionName] = { status: d.status || "unknown", runtime: d.runtime || "", deployedAt: d.deployedAt || "" }; } } catch {} }

// Resources already used by existing pipelines
const usedTables = computed(() => new Set(mappings.value.map(m => m.tableName)));
const usedTopics = computed(() => new Set(mappings.value.map(m => m.topicName)));
const usedQueues = computed(() => new Set(mappings.value.map(m => m.queueName)));
const usedFunctions = computed(() => new Set(mappings.value.map(m => m.glueFunctionName).filter(Boolean)));
const deletingMapping = ref(""); const expandedAddons = ref("");
const selectedPipelines = ref<Set<string>>(new Set());
const showActionsMenu = ref(false);
const showDeleteConfirm = ref(false);
const deleteExternalResources = ref(false);
const deleteVaultSecrets = ref(false);
const selectedHasExternal = computed(() => [...selectedPipelines.value].some(id => { const p = mappings.value.find(m => m.id === id); return p && (p.topicCreatedByUs === false || p.queueCreatedByUs === false); }));
const pipelineSearch = ref("");
const pipelineTypeFilter = ref("all");
const filteredMappings = computed(() => mappings.value.filter(m => {
  if (pipelineTypeFilter.value !== "all" && m.type !== pipelineTypeFilter.value) return false;
  if (pipelineSearch.value) { const q = pipelineSearch.value.toLowerCase(); return m.name.toLowerCase().includes(q) || m.targetFunctionName.toLowerCase().includes(q); }
  return true;
}));

const selectedHasVault = computed(() => [...selectedPipelines.value].some(id => { const p = mappings.value.find(m => m.id === id); return p?.vaultConfig?.paths?.length; }));
const showStepsModal = ref(false);
const stepsPipeline = ref<Pipeline | null>(null);

function openStepsModal() {
  const id = [...selectedPipelines.value][0];
  stepsPipeline.value = mappings.value.find(m => m.id === id) ?? null;
  showStepsModal.value = true; showActionsMenu.value = false;
}

// Quick test
const showQuickTest = ref(false);

// Env var editor
const showEnvEditor = ref(false);
const envEditorPipelineId = ref("");
const envEditorPipelineName = ref("");
const envVars = ref<{ key: string; value: string }[]>([]);
const savingEnv = ref(false);

async function openEnvEditor(id: string, name: string) {
  envEditorPipelineId.value = id;
  envEditorPipelineName.value = name;
  const pipeline = mappings.value.find(p => p.id === id);
  if (!pipeline) return;
  try { envVars.value = await (await fetch(`/api/deployments/lambda-env/${pipeline.targetFunctionName}`)).json(); } catch { envVars.value = []; }
  if (!envVars.value.length) envVars.value.push({ key: "", value: "" });
  showEnvEditor.value = true;
}
function addEnvVar() { envVars.value.push({ key: "", value: "" }); }
function removeEnvVar(i: number) { envVars.value.splice(i, 1); }
async function saveEnvVars() {
  savingEnv.value = true;
  const pipeline = mappings.value.find(p => p.id === envEditorPipelineId.value);
  if (!pipeline) { savingEnv.value = false; return; }
  await fetch(`/api/deployments/lambda-env/${pipeline.targetFunctionName}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envVars: envVars.value.filter(e => e.key) }),
  });
  savingEnv.value = false;
  showEnvEditor.value = false;
}

// Vault add-on
const showVaultSheet = ref(false);
const heavyLoad = ref(false);
const vaultEnabled = ref(false);
const vaultUrl = ref("");
const vaultToken = ref("");
const vaultSecrets = ref<{ path: string; entries: { key: string; value: string }[] }[]>([]);
const vaultTesting = ref(false);
const vaultTestResult = ref<{ ok: boolean; message: string } | null>(null);
const vaultApplying = ref(false);

function openVault(id: string, name: string) {
  vaultTestResult.value = null; vaultApplying.value = false;
  if (!vaultSecrets.value.length) vaultSecrets.value.push({ path: "", entries: [{ key: "", value: "" }] });
  showVaultSheet.value = true;
}

async function testVaultConnection() {
  vaultTesting.value = true; vaultTestResult.value = null;
  try {
    const res = await fetch("/api/vault/test-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value }) });
    vaultTestResult.value = await res.json();
  } catch (e: any) { vaultTestResult.value = { ok: false, message: e.message }; }
  vaultTesting.value = false;
}

async function applyVaultSecrets() {
  vaultApplying.value = true;
  try {
    // Create secrets in Vault
    const secretsPayload = vaultSecrets.value.filter(s => s.path).map(s => ({ path: s.path, value: JSON.stringify(Object.fromEntries(s.entries.filter(e => e.key).map(e => [e.key, e.value]))) }));
    const setupRes = await fetch("/api/vault/setup-secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, secrets: secretsPayload }) });
    if (!setupRes.ok) { const err = await setupRes.json().catch(() => ({ error: "Unknown" })); showToast(`Vault setup failed: ${err.error}`, true); vaultApplying.value = false; return; }
    showToast("Vault secrets created successfully.");
    showVaultSheet.value = false;
  } catch (e: any) { showToast(`Error: ${e.message}`, true); }
  vaultApplying.value = false;
}
const quickTestTable = ref(""); const quickTestJson = ref("");
const quickTestLoading = ref(false);
const quickTestResult = ref<{ ok: boolean; message: string } | null>(null);

// Pipeline execution
const showExecution = ref(false);
const executionPipelineId = ref("");
const executionPipelineName = ref("");
interface ExecStep { id: string; label: string; icon: string; status: "pending" | "running" | "success" | "timeout" | "error" | "unknown"; logs: string[]; }
const execSteps = ref<ExecStep[]>([]);
const execExpandedStep = ref<string | null>(null);

function initExecSteps(): ExecStep[] {
  return [
    { id: "dynamodb", label: "DynamoDB Insert", icon: "database", status: "pending", logs: [] },
    { id: "glue", label: "Stream Handler", icon: "zap", status: "pending", logs: [] },
    { id: "sns", label: "SNS Publish", icon: "bell", status: "pending", logs: [] },
    { id: "sqs", label: "SQS Deliver", icon: "inbox", status: "pending", logs: [] },
    { id: "target", label: "Target Lambda", icon: "zap", status: "pending", logs: [] },
  ];
}

async function executePipeline() {
  if (!quickTestJson.value || !executionPipelineId.value) return;
  execSteps.value = initExecSteps();
  execExpandedStep.value = null;

  let item: any;
  try { item = JSON.parse(quickTestJson.value); } catch { return; }

  const res = await fetch(`/api/triggers/pipelines/${executionPipelineId.value}/execute`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  });

  const reader = res.body?.getReader();
  if (!reader) return;
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
        const { step, status, logs } = JSON.parse(line.slice(6));
        if (step === "done" || step === "error") continue;
        const s = execSteps.value.find(s => s.id === step);
        if (s) { s.status = status; if (logs?.length) s.logs = logs; }
      } catch {}
    }
  }
}

function openExecution(pipelineId: string, pipelineName: string, tableName: string) {
  executionPipelineId.value = pipelineId;
  executionPipelineName.value = pipelineName;
  quickTestTable.value = tableName;
  quickTestResult.value = null;
  execSteps.value = initExecSteps();
  showExecution.value = true;
  // Load key schema for template
  fetch(`/api/dynamodb/tables/${tableName}/describe`).then(r => r.json()).then(({ keys }) => {
    const t: Record<string, any> = {}; for (const k of keys) t[k.name] = k.attributeType === "N" ? 0 : "value";
    quickTestJson.value = JSON.stringify(t, null, 2);
  }).catch(() => { quickTestJson.value = "{}"; });
}

// Navigation
function selectSource(s: typeof sources[0]) { if (s.enabled) selectedSource.value = s.type; }
function goToStep(n: number) { stepIndex.value = n; }
function goToNextStep() {
  const activeKinds = selectedPipelineType.value ? [...selectedPipelineType.value.steps.filter(s => s !== "stream-handler"), "addons"] : [];
  const nextIdx = stepIndex.value + 1;
  if (nextIdx >= activeKinds.length) return;
  const nextKind = activeKinds[nextIdx];
  // Load data for the next step
  if (nextKind === "dynamodb" && !tables.value.length) loadTables();
  if (nextKind === "sns" && !topics.value.length) loadTopics();
  if (nextKind === "sqs" && !queues.value.length) loadQueues();
  if (nextKind === "lambda") { loadFunctions(); loadTemplates(); }
  stepIndex.value = nextIdx;
}
function goToPrevStep() { if (stepIndex.value > 0) stepIndex.value--; }
// Legacy navigation (used by Next buttons in panels)
function goToStep2() { goToNextStep(); }
function goToStep3() { if (!selectedTable.value) return; goToNextStep(); }
function goToStep4() { if (!selectedTopic.value) return; goToNextStep(); }
function goToStep5() { if (!selectedQueue.value) return; goToNextStep(); }

// Data loaders
async function loadTables() { loading.value = true; try { tables.value = await (await fetch("/api/dynamodb/tables")).json(); } catch { tables.value = []; } loading.value = false; }
async function loadTopics() { loadingTopics.value = true; try { topics.value = await (await fetch("/api/sns/topics")).json(); } catch { topics.value = []; } loadingTopics.value = false; }
async function loadQueues() { loadingQueues.value = true; try { queues.value = (await (await fetch("/api/sqs/queues")).json()).filter((q: SqsQueue) => !q.name.startsWith("mk-shadow-")); } catch { queues.value = []; } loadingQueues.value = false; }
async function loadFunctions() { loadingFunctions.value = true; try { functions.value = (await (await fetch("/api/triggers/functions")).json()).filter((f: LambdaFunc) => !f.name.startsWith("mk-shadow-")); } catch { functions.value = []; } loadingFunctions.value = false; }
async function loadTemplates() { try { templates.value = await (await fetch("/api/triggers/templates")).json(); } catch { templates.value = []; } }
async function loadMappings() { loadingMappings.value = true; try { mappings.value = await (await fetch("/api/triggers/pipelines")).json(); } catch { mappings.value = []; } loadingMappings.value = false; }

// Create actions
async function createTable() {
  creating.value = true;
  try {
    const res = await fetch("/api/dynamodb/tables", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableName: newTableName.value, partitionKey: newPartitionKey.value, partitionKeyType: newPartitionKeyType.value, sortKey: newSortKey.value || undefined, sortKeyType: newSortKey.value ? newSortKeyType.value : undefined }) });
    if (res.ok) { showCreate.value = false; newTableName.value = ""; newPartitionKey.value = ""; newSortKey.value = ""; await loadTables(); }
    else { const d = await res.json(); showToast(d.error || "Failed to create table", true); }
  } catch {} creating.value = false;
}
async function enableStream(name: string) { enablingStream.value = name; try { await fetch(`/api/dynamodb/tables/${name}/enable-stream`, { method: "POST" }); await loadTables(); } catch {} enablingStream.value = ""; }
async function createTopic() {
  creatingTopic.value = true;
  try { const res = await fetch("/api/sns/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicName: newTopicName.value }) });
    if (res.ok) { showCreateTopic.value = false; newTopicName.value = ""; topicCreatedByUs.value = true; await loadTopics(); }
    else { const d = await res.json(); showToast(d.error || "Failed to create topic", true); }
  } catch {} creatingTopic.value = false;
}
async function createQueue() {
  creatingQueue.value = true;
  try { const res = await fetch("/api/sqs/queues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queueName: newQueueName.value, createDlq: createDlq.value, maxReceiveCount: maxReceiveCount.value }) });
    if (res.ok) { showCreateQueue.value = false; newQueueName.value = ""; createDlq.value = true; maxReceiveCount.value = 3; queueCreatedByUs.value = true; await loadQueues(); }
    else { const d = await res.json(); showToast(d.error || "Failed to create queue", true); }
  } catch {} creatingQueue.value = false;
}
async function deployTemplate(t: Template) {
  deployingTemplate.value = true;
  const name = deployTemplateName.value || `mouseketool-${t.id}`;
  const envVars: Record<string, string> = {};
  if (t.envVars.includes("SNS_TOPIC_ARN") && selectedTopic.value) envVars.SNS_TOPIC_ARN = selectedTopic.value.arn;
  try {
    const res = await fetch("/api/triggers/templates/deploy", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: t.id, functionName: name, envVars }) });
    if (res.ok) { showDeployTemplate.value = false; deployTemplateName.value = ""; await loadFunctions(); }
  } catch {} deployingTemplate.value = false;
}

// Wire pipeline
async function wirePipeline() {
  if (!selectedTargetFunction.value) return;
  const typeId = selectedPipelineType.value?.id || "app-pipeline";
  const typeSteps = selectedPipelineType.value?.steps || ["dynamodb", "stream-handler", "sns", "sqs", "lambda"];
  if (typeSteps.includes("dynamodb") && !selectedTable.value?.streamArn) return;
  if (typeSteps.includes("stream-handler") && !selectedGlueFunction.value) return;
  if (typeSteps.includes("sns") && !selectedTopic.value) return;
  if (typeSteps.includes("sqs") && !selectedQueue.value) return;
  wiring.value = true; wireError.value = ""; wireResult.value = null;
  try {
    const res = await fetch("/api/triggers/wire", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: typeId, streamArn: selectedTable.value?.streamArn, glueFunctionName: selectedGlueFunction.value?.name, topicArn: selectedTopic.value?.arn, queueUrl: selectedQueue.value?.url, targetFunctionName: selectedTargetFunction.value.name, pipelineName: pipelineName.value, addons: vaultEnabled.value ? ["vault"] : [], filterPolicy: buildFilterPolicy(), filterPolicyScope: filterEnabled.value ? filterScope.value : undefined, topicCreatedByUs: topicCreatedByUs.value, queueCreatedByUs: queueCreatedByUs.value, heavyLoad: heavyLoad.value, vaultConfig: vaultEnabled.value && vaultSecrets.value.some(s => s.path) ? { url: vaultUrl.value, token: vaultToken.value, paths: vaultSecrets.value.filter(s => s.path).map(s => s.path) } : undefined }) });
    const data = await res.json();
    if (res.ok) {
      wireResult.value = data;
      // Vault secrets were already created in the add-ons step
    } else wireError.value = data.error || "Failed to wire";
  } catch (e: any) { wireError.value = e.message; }
  wiring.value = false;
}

// Mappings actions
async function deleteMapping(id: string) { deletingMapping.value = id; try { await fetch(`/api/triggers/pipelines/${id}`, { method: "DELETE" }); await loadMappings(); } catch {} deletingMapping.value = ""; }
async function deleteSelected() {
  showDeleteConfirm.value = false;
  const params = new URLSearchParams();
  if (deleteExternalResources.value) params.set("deleteExternal", "true");
  if (deleteVaultSecrets.value) params.set("deleteVault", "true");
  const qs = params.toString() ? `?${params}` : "";
  for (const id of selectedPipelines.value) { deletingMapping.value = id; try { await fetch(`/api/triggers/pipelines/${id}${qs}`, { method: "DELETE" }); } catch {} }
  selectedPipelines.value = new Set(); deletingMapping.value = ""; deleteExternalResources.value = false; deleteVaultSecrets.value = false; await loadMappings();
}
function toggleSelect(id: string) { selectedPipelines.value.has(id) ? selectedPipelines.value.delete(id) : selectedPipelines.value.add(id); selectedPipelines.value = new Set(selectedPipelines.value); }

// Quick test
async function openQuickTest(tableName: string) {
  quickTestTable.value = tableName; quickTestResult.value = null;
  try { const { keys } = await (await fetch(`/api/dynamodb/tables/${tableName}/describe`)).json();
    const t: Record<string, any> = {}; for (const k of keys) t[k.name] = k.attributeType === "N" ? 0 : "value";
    quickTestJson.value = JSON.stringify(t, null, 2);
  } catch { quickTestJson.value = "{}"; }
  showQuickTest.value = true;
}
async function runQuickTest() {
  quickTestLoading.value = true; quickTestResult.value = null;
  try { const item = JSON.parse(quickTestJson.value);
    const res = await fetch(`/api/dynamodb/tables/${quickTestTable.value}/put-item`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) });
    const data = await res.json();
    quickTestResult.value = res.ok ? { ok: true, message: "Item inserted. The pipeline should trigger shortly." } : { ok: false, message: data.error || "Failed" };
  } catch (e: any) { quickTestResult.value = { ok: false, message: e.message || "Invalid JSON" }; }
  quickTestLoading.value = false;
}

function selectTable(t: DynamoTable) { if (t.streamEnabled) selectedTable.value = t; }
import { formatBytes } from "@/lib/format";
const stepKindMeta: Record<string, { label: string; description: string }> = {
  "dynamodb": { label: "DynamoDB", description: "Select table" },
  "stream-handler": { label: "Stream Handler", description: "Select handler" },
  "sns": { label: "SNS", description: "Select topic" },
  "sqs": { label: "SQS", description: "Select queue" },
  "lambda": { label: "Lambda", description: "Select target" },
  "addons": { label: "Add-ons", description: "Configure add-ons" },
};
const pipelineSteps = computed(() => {
  if (!selectedPipelineType.value) return [{ label: "Source", description: "Choose event source" }];
  const steps = selectedPipelineType.value.steps
    .filter(s => s !== "stream-handler") // stream-handler is part of the Lambda step
    .map(s => stepKindMeta[s] || { label: s, description: "" });
  steps.push(stepKindMeta["addons"]);
  return steps;
});
const currentStepKind = computed(() => {
  if (!selectedPipelineType.value) return "dynamodb";
  const activeKinds = [...selectedPipelineType.value.steps.filter(s => s !== "stream-handler"), "addons"];
  return activeKinds[stepIndex.value] || "dynamodb";
});

function startWizard() { view.value = "wizard"; stepIndex.value = 0; selectedSource.value = null; selectedTable.value = null; selectedTopic.value = null; selectedQueue.value = null; selectedGlueFunction.value = null; selectedTargetFunction.value = null; wireResult.value = null; wireError.value = ""; pipelineName.value = ""; heavyLoad.value = false; vaultEnabled.value = false; vaultUrl.value = ""; vaultToken.value = ""; vaultSecrets.value = []; vaultTestResult.value = null; filterEnabled.value = false; filterScope.value = "MessageBody"; filterRules.value = []; topics.value = []; queues.value = []; tables.value = []; topicCreatedByUs.value = false; queueCreatedByUs.value = false; }
function isTemplateDeployed(t: Template) { return functions.value.some(f => f.templateId === t.id); }
function stepsForPipeline(p: Pipeline) {
  const t = p.type || "app-pipeline";
  const all: Record<string, { label: string; detail: string; icon: any }[]> = {
    "app-pipeline": [
      { label: "DynamoDB", detail: p.tableName, icon: Database },
      { label: "Stream Handler", detail: p.glueFunctionName, icon: Zap },
      { label: "SNS Topic", detail: p.topicName, icon: Bell },
      { label: "SQS Queue", detail: p.queueName, icon: Inbox },
      { label: "Target Lambda", detail: p.targetFunctionName, icon: Zap },
    ],
    "direct-stream": [
      { label: "DynamoDB", detail: p.tableName, icon: Database },
      { label: "Target Lambda", detail: p.targetFunctionName, icon: Zap },
    ],
    "queue-consumer": [
      { label: "SQS Queue", detail: p.queueName, icon: Inbox },
      { label: "Target Lambda", detail: p.targetFunctionName, icon: Zap },
    ],
    "sns-fanout": [
      { label: "SNS Topic", detail: p.topicName, icon: Bell },
      { label: "SQS Queue", detail: p.queueName, icon: Inbox },
      { label: "Target Lambda", detail: p.targetFunctionName, icon: Zap },
    ],
  };
  return all[t] || all["app-pipeline"];
}
function startOver() { loadMappings(); view.value = "list"; }
async function showTypeSelect() { view.value = "type-select"; if (!pipelineTypes.value.length) { try { pipelineTypes.value = await (await fetch("/api/triggers/types")).json(); } catch {} } }
function selectPipelineType(t: PipelineTypeDef) {
  selectedPipelineType.value = t;
  startWizard();
  // Load data for the first step
  const firstKind = t.steps.filter(s => s !== "stream-handler")[0];
  if (firstKind === "dynamodb" && !tables.value.length) loadTables();
  if (firstKind === "sns" && !topics.value.length) loadTopics();
  if (firstKind === "sqs" && !queues.value.length) loadQueues();
  if (firstKind === "lambda") { loadFunctions(); loadTemplates(); }
}

onMounted(loadMappings);
</script>

<template>
  <div class="space-y-3 overflow-hidden">
    <div class="flex items-center justify-between">
      <div><h1 class="text-2xl font-bold tracking-tight">Triggers</h1><p class="text-muted-foreground">Configure event source triggers for your Lambda functions.</p></div>
      <div v-if="view === 'list'" class="flex items-center gap-2"><Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="cursor-pointer active:scale-95 transition-transform" @click="loadMappings"><RefreshCw class="size-4" /></Button></TooltipTrigger><TooltipContent>Refresh</TooltipContent></Tooltip><Button class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showTypeSelect"><Plus class="size-4" /> New Pipeline</Button></div>
      <Button v-else variant="outline" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="startOver"><ArrowLeft class="size-4" /> Back to Pipelines</Button>
    </div>
    <template v-if="view === 'list'">
      <div v-if="loadingMappings" class="space-y-3"><SkeletonCard v-for="n in 3" :key="n" /></div>
      <div v-else-if="!mappings.length" class="text-center py-16 text-muted-foreground"><Cable class="size-12 mx-auto mb-4 opacity-30" /><p>No active pipelines.</p><p class="text-xs mt-1">Click "New Pipeline" to set up a trigger chain.</p></div>
      <div v-else class="space-y-2">
        <div class="flex items-center gap-2 mb-3">
          <template v-if="selectedPipelines.size">
            <span class="text-xs text-muted-foreground">{{ selectedPipelines.size }} selected</span>
            <div class="relative">
              <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showActionsMenu = !showActionsMenu"><ChevronDown class="size-3.5" /> Actions</Button>
              <div v-if="showActionsMenu" class="fixed inset-0 z-40" @click="showActionsMenu = false" />
              <div v-if="showActionsMenu" class="absolute left-0 top-full mt-1 w-48 rounded-md border bg-popover shadow-md z-50 py-1">
                <button class="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" :class="selectedPipelines.size > 1 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'" :disabled="selectedPipelines.size > 1" @click="selectedPipelines.size === 1 && openStepsModal()"><Cable class="size-3.5" /> See steps</button>
                <div class="border-t my-1" />
                <button class="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors flex items-center gap-2 cursor-pointer" @click="showDeleteConfirm = true; showActionsMenu = false"><Trash2 class="size-3.5" /> Delete selected</button>
              </div>
            </div>
            <Button variant="ghost" size="sm" class="text-xs cursor-pointer" @click="selectedPipelines = new Set()">Clear</Button>
          </template>
        </div>
        <div class="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2 mb-3">
          <div class="relative">
            <Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input v-model="pipelineSearch" placeholder="Search..." class="h-7 w-36 rounded-md bg-background border pl-8 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div class="h-4 w-px bg-border" />
          <div class="flex items-center gap-1.5">
            <button v-for="t in [{v:'all',l:'All'},{v:'app-pipeline',l:'App Pipeline'},{v:'direct-stream',l:'Direct Stream'},{v:'queue-consumer',l:'Queue Consumer'}]" :key="t.v" @click="pipelineTypeFilter = t.v" class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer" :class="pipelineTypeFilter === t.v ? 'bg-foreground/10 text-foreground ring-1 ring-foreground/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
              {{ t.l }}
            </button>
          </div>
        </div>
        <Card v-for="m in filteredMappings" :key="m.id" class="!py-3" :class="selectedPipelines.has(m.id) ? 'border-primary ring-1 ring-primary/20' : ''"><CardContent class="py-3 space-y-2"><div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <input type="checkbox" :checked="selectedPipelines.has(m.id)" @change="toggleSelect(m.id)" class="accent-primary size-4 shrink-0 cursor-pointer" />
            <div class="min-w-0 flex-1 space-y-1">
              <p class="font-semibold text-sm flex items-center gap-1.5">{{ m.name }}<Tooltip v-if="m.heavyLoad"><TooltipTrigger as-child><Flame class="size-3.5 text-orange-500 animate-flicker" /></TooltipTrigger><TooltipContent>Heavy load enabled — large batch size and window</TooltipContent></Tooltip><Tooltip v-if="getWarnings(m).length"><TooltipTrigger as-child><AlertTriangle class="size-3.5 text-amber-500" /></TooltipTrigger><TooltipContent>{{ getWarnings(m)[0].message }}</TooltipContent></Tooltip></p>
              <div class="flex items-center gap-1.5 text-muted-foreground">
                <Zap class="size-3.5 shrink-0" /><span class="font-mono text-xs">{{ m.targetFunctionName }}</span><span v-if="m.type" class="text-[10px] text-muted-foreground ml-1">·</span><span v-if="m.type" class="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{{ m.type.replace('-', ' ') }}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <Tooltip v-if="m.sourceType"><TooltipTrigger as-child><span class="inline-flex"><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" :disabled="m.heavyLoad" @click="triggerRouter.push(`/triggers/${m.id}/execute`)"><Play class="size-3.5" /> Execute</Button></span></TooltipTrigger><TooltipContent>{{ m.heavyLoad ? 'Manual execution is disabled in heavy load mode — insert items directly into DynamoDB' : 'Run pipeline with a test item' }}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="triggerRouter.push(`/triggers/${m.id}/history`)"><Clock class="size-3.5" /> History</Button></TooltipTrigger><TooltipContent>View invocation history from CloudWatch logs</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="triggerRouter.push(`/triggers/${m.id}/edit`)"><Pencil class="size-3.5" /> Edit</Button></TooltipTrigger><TooltipContent>Edit pipeline settings</TooltipContent></Tooltip>
          </div>
        </div>
          <!-- Configured add-ons -->
          <div v-if="m.addons?.length" class="pt-2 border-t mt-2">
            <button class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors" @click="expandedAddons = expandedAddons === m.id ? '' : m.id">
              <ChevronRight class="size-3 transition-transform" :class="expandedAddons === m.id ? 'rotate-90' : ''" />
              Configured add-ons ({{ m.addons.length }})
            </button>
            <div v-if="expandedAddons === m.id" class="mt-2 flex flex-wrap gap-2">
              <div v-if="m.addons.includes('vault')" class="flex items-center gap-1.5 rounded-md border px-2 py-1 bg-muted/50 text-xs" :class="m.vaultIncomplete ? 'border-amber-500/40' : ''"><VaultIcon class="size-3" /><span>Vault</span><Tooltip v-if="m.vaultIncomplete"><TooltipTrigger as-child><AlertTriangle class="size-3 text-amber-500" /></TooltipTrigger><TooltipContent>Vault secrets need to be recreated after LocalStack restart</TooltipContent></Tooltip></div>
            </div>
          </div>
        </CardContent></Card>
      </div>
    </template>
    <template v-if="view === 'type-select'">
      <div class="space-y-4">
        <div><h2 class="text-lg font-semibold">Choose a pipeline type</h2><p class="text-sm text-muted-foreground">Select the architecture pattern for your new pipeline.</p></div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <Tooltip v-for="t in pipelineTypes" :key="t.id" :disabled="!t.disabled">
            <TooltipTrigger as-child>
              <button class="rounded-xl border p-5 text-left transition-all space-y-2" :class="t.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50 hover:bg-muted/50 active:scale-[0.98]'" @click="!t.disabled && selectPipelineType(t)">
                <component :is="typeIcons[t.icon] || Workflow" class="size-7 text-primary" />
                <p class="text-sm font-semibold">{{ t.name }}</p>
                <p class="text-xs text-muted-foreground leading-relaxed">{{ t.description }}</p>
                <div class="flex flex-wrap gap-1 pt-1"><Badge v-for="s in t.steps" :key="s" variant="secondary" class="text-[10px]">{{ s }}</Badge><Badge v-if="t.disabled" class="text-[10px] bg-amber-500/20 text-amber-500 border-amber-500/40">Coming soon</Badge></div>
              </button>
            </TooltipTrigger>
            <TooltipContent v-if="t.disabled">{{ t.disabledReason }}</TooltipContent>
          </Tooltip>
          <Tooltip><TooltipTrigger as-child>
            <div class="rounded-xl border border-dashed p-5 text-left opacity-50 cursor-not-allowed space-y-2">
              <HardDrive class="size-7 text-muted-foreground" />
              <p class="text-sm font-semibold text-muted-foreground">S3 Event Processor</p>
              <p class="text-xs text-muted-foreground leading-relaxed">Trigger a Lambda from S3 bucket events (object created, deleted).</p>
              <div class="flex flex-wrap gap-1 pt-1"><Badge variant="secondary" class="text-[10px]">s3</Badge><Badge variant="secondary" class="text-[10px]">lambda</Badge><Badge class="text-[10px] bg-amber-500/20 text-amber-500 border-amber-500/40">Coming soon</Badge></div>
            </div>
          </TooltipTrigger><TooltipContent>Coming in a future release</TooltipContent></Tooltip>
        </div>
      </div>
    </template>
    <template v-if="view === 'wizard'">
    <!-- Breadcrumb Stepper -->
    <div class="flex items-center gap-2 mb-2">
      <button class="text-xs text-muted-foreground hover:text-foreground cursor-pointer" @click="view = 'list'">Pipelines</button>
      <template v-for="(step, i) in pipelineSteps" :key="i">
        <ChevronRight class="size-3 text-muted-foreground" />
        <button class="flex items-center gap-1.5 text-xs cursor-pointer" :class="stepIndex === i ? 'text-foreground font-medium' : stepIndex > i ? 'text-emerald-500' : 'text-muted-foreground'" @click="stepIndex > i ? goToStep(i) : undefined">
          <div class="size-5 rounded-full flex items-center justify-center text-[10px] font-bold border" :class="stepIndex === i ? 'border-primary bg-primary text-primary-foreground' : stepIndex > i ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-muted-foreground/30'">
            <Check v-if="stepIndex > i" class="size-3" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          {{ step.label }}
        </button>
      </template>
    </div>
    <div>
        <!-- Step: DynamoDB -->
        <div v-if="currentStepKind === 'dynamodb'" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Select a DynamoDB table</span></div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToPrevStep();selectedTable=null"><ArrowLeft class="size-3.5" /> Back</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="loadTables"><RefreshCw class="size-3.5" /> Refresh</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showCreate=true"><Plus class="size-3.5" /> Create Table</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="loadSchemas(); showRestore=true"><HardDrive class="size-3.5" /> Restore Table</Button>
            <Button v-if="selectedTable" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="() => showSaveSchema = true"><Save class="size-3.5" /> Save Schema</Button>
            <span v-if="schemaSavedWizard" class="text-xs text-green-500">Saved!</span>
          </div>
          <div v-if="loading" class="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading tables...</p></div>
          <div v-else-if="!tables.length" class="text-center py-16 text-muted-foreground"><Database class="size-12 mx-auto mb-4 opacity-30" /><p>No DynamoDB tables found.</p></div>
          <div v-else class="space-y-2">
            <Card v-for="t in tables" :key="t.name" class="!py-3 transition-all" :class="[selectedTable?.name===t.name?'border-primary ring-1 ring-primary/20':'',usedTables.has(t.name)?'border-dashed opacity-50 cursor-not-allowed':t.streamEnabled?'hover:border-primary/50 cursor-pointer':'opacity-75']" @click="!usedTables.has(t.name)&&selectTable(t)"><CardContent class="py-3 space-y-2"><div class="flex items-center justify-between gap-4"><div class="min-w-0 flex-1 space-y-1"><div class="flex items-center gap-2"><Database class="size-4 text-muted-foreground shrink-0" /><span class="font-mono text-sm font-semibold truncate">{{ t.name }}</span><Badge variant="secondary" class="text-[10px]">{{ t.status }}</Badge>
              <Tooltip v-if="t.streamEnabled"><TooltipTrigger as-child><Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px] gap-1"><Radio class="size-3" /> Stream</Badge></TooltipTrigger><TooltipContent>Streams enabled ({{ t.streamViewType }})</TooltipContent></Tooltip>
              <Tooltip v-else><TooltipTrigger as-child><Badge class="bg-zinc-500/20 text-zinc-400 border-zinc-500/40 text-[10px] gap-1"><CircleOff class="size-3" /> No Stream</Badge></TooltipTrigger><TooltipContent>Streams not enabled</TooltipContent></Tooltip>
              <Badge v-if="usedTables.has(t.name)" class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px]">In use</Badge>
            </div><div class="flex items-center gap-3 text-xs text-muted-foreground"><span v-if="t.keySchema?.length">Keys: {{ t.keySchema.map(k=>`${k.name} (${k.type})`).join(', ') }}</span><span>{{ t.itemCount??0 }} items</span><span v-if="t.sizeBytes">{{ formatBytes(t.sizeBytes) }}</span></div></div>
            <div class="flex items-center gap-2 shrink-0">
              <template v-if="!t.streamEnabled"><Button @click.stop="enableStream(t.name)" :disabled="enablingStream===t.name" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform text-xs"><Loader2 v-if="enablingStream===t.name" class="size-3.5 animate-spin" /><Radio v-else class="size-3.5" />Enable Stream</Button></template>
              <template v-else><Button v-if="selectedTable?.name===t.name" variant="default" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click.stop="goToStep3">Next <ArrowRight class="size-3.5" /></Button></template>
            </div></div>
            <div v-if="!t.streamEnabled" class="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-1.5"><AlertTriangle class="size-3.5 shrink-0" /><span>Streams must be enabled. Click "Enable Stream".</span></div>
            </CardContent></Card>
          </div>
        </div>
        <!-- Step: SNS Topic -->
        <div v-if="currentStepKind === 'sns'" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Select an SNS topic</span></div>
          <div v-if="selectedPipelineType?.id === 'sns-fanout'" class="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2"><Info class="size-3.5 shrink-0 text-blue-400" /><span>Multi-subscriber fan-out (multiple SQS queues per topic) will be available in a future release.</span></div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToStep(1);selectedTopic=null"><ArrowLeft class="size-3.5" /> Back</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="loadTopics"><RefreshCw class="size-3.5" /> Refresh</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showCreateTopic=true"><Plus class="size-3.5" /> Create Topic</Button>
          </div>
          <div v-if="loadingTopics" class="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading SNS topics...</p></div>
          <div v-else-if="!topics.length" class="text-center py-16 text-muted-foreground"><Bell class="size-12 mx-auto mb-4 opacity-30" /><p>No SNS topics found.</p><p class="text-xs mt-1">Create one for the stream handler to publish to.</p></div>
          <div v-else class="space-y-2">
            <Card v-for="t in topics" :key="t.arn" class="!py-3 transition-all" :class="usedTopics.has(t.name)?'border-dashed opacity-50 cursor-not-allowed':selectedTopic?.arn===t.arn?'border-primary ring-1 ring-primary/20':'hover:border-primary/50 cursor-pointer'" @click="!usedTopics.has(t.name)&&(selectedTopic=t)"><CardContent class="py-3"><div class="flex items-center justify-between gap-4"><div class="min-w-0 flex-1 space-y-1"><div class="flex items-center gap-2"><Bell class="size-4 text-muted-foreground shrink-0" /><span class="font-mono text-sm font-semibold truncate">{{ t.name }}</span><Badge v-if="usedTopics.has(t.name)" class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px]">In use</Badge></div><div class="text-xs text-muted-foreground truncate">{{ t.arn }}</div></div>
            <div class="shrink-0"><Button v-if="selectedTopic?.arn===t.arn" variant="default" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click.stop="goToStep4">Next <ArrowRight class="size-3.5" /></Button></div>
            </div></CardContent></Card>
          </div>

          <div v-if="selectedTopic" class="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2"><Info class="size-3.5 shrink-0 text-blue-400" /><span>The filter policy will be applied to the SNS → SQS subscription selected in the next step.</span></div>
          <!-- Filter policy (optional) -->
          <div v-if="selectedTopic" class="space-y-3 pt-2">
            <div class="flex items-center gap-3">
              <Toggle v-model="filterEnabled" />
              <div class="flex items-center gap-1.5 text-sm"><ListFilter class="size-3.5 text-muted-foreground" /> Filter policy <span class="text-xs text-muted-foreground">(optional)</span></div>
            </div>
            <template v-if="filterEnabled">
              <div class="flex items-center gap-2">
                <Label class="text-xs text-muted-foreground shrink-0">Scope:</Label>
                <Select v-model="filterScope">
                  <SelectTrigger class="h-7 text-xs w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MessageBody">Message body</SelectItem>
                    <SelectItem value="MessageAttributes">Message attributes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p class="text-xs text-muted-foreground">All rules are combined with AND logic. OR conditions will be available in a future release.</p>
              <div class="space-y-3">
                <Card v-for="(r, i) in filterRules" :key="i" class="!py-3">
                  <CardContent class="py-3 space-y-2">
                    <div class="flex items-center gap-2">
                      <Input v-model="r.field" placeholder="Field name" class="font-mono text-xs h-7 flex-1" />
                      <Select v-model="r.op" @update:model-value="() => { r.values = []; r.chipInput = ''; }">
                        <SelectTrigger class="h-7 text-xs w-56"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem v-for="o in filterOps" :key="o.value" :value="o.value">{{ o.label }}</SelectItem></SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="removeFilterRule(i)"><X class="size-3" /></Button>
                    </div>
                    <!-- Chip input for string/number exact -->
                    <div v-if="['exact-string','prefix','anything-but','anything-but-prefix','suffix','wildcard','exact-number'].includes(r.op)" class="space-y-1.5">
                      <div class="flex items-center gap-1.5">
                        <Input v-model="r.chipInput" :placeholder="r.op.startsWith('exact-number') ? 'Type a number and press Enter' : 'Type a value and press Enter'" class="font-mono text-xs h-7 flex-1" :type="r.op === 'exact-number' ? 'number' : 'text'" @keydown.enter.prevent="addChip(r)" />
                      </div>
                      <div v-if="r.values.length" class="flex flex-wrap gap-1">
                        <Badge v-for="(v, vi) in r.values" :key="vi" variant="secondary" class="gap-1 text-xs font-mono">{{ v }}<button class="ml-0.5 hover:text-destructive cursor-pointer" @click="removeChip(r, vi)"><X class="size-2.5" /></button></Badge>
                      </div>
                    </div>
                    <!-- Range input for number-range -->
                    <div v-else-if="r.op === 'number-range'" class="flex items-center gap-2 flex-wrap">
                      <Select v-model="r.rangeLow">
                        <SelectTrigger class="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value=">">&#x3E;</SelectItem><SelectItem value=">=">&gt;=</SelectItem></SelectContent>
                      </Select>
                      <Input v-model="r.rangeMin" type="number" placeholder="Min" class="font-mono text-xs h-7 w-28" />
                      <span class="text-xs text-muted-foreground">and</span>
                      <Select v-model="r.rangeHigh">
                        <SelectTrigger class="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="<">&lt;</SelectItem><SelectItem value="<=">&lt;=</SelectItem></SelectContent>
                      </Select>
                      <Input v-model="r.rangeMax" type="number" placeholder="Max" class="font-mono text-xs h-7 w-28" />
                    </div>
                    <!-- Exists toggle -->
                    <div v-else-if="r.op === 'exists'" class="flex items-center gap-2">
                      <Select v-model="r.existsVal">
                        <SelectTrigger class="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem :value="true">Exists (true)</SelectItem><SelectItem :value="false">Not exists (false)</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="addFilterRule"><Plus class="size-3.5" /> Add rule</Button>
            </template>
          </div>
        </div>
        <!-- Step: SQS Queue -->
        <div v-if="currentStepKind === 'sqs'" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Select an SQS queue</span></div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToStep(2);selectedQueue=null"><ArrowLeft class="size-3.5" /> Back</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="loadQueues"><RefreshCw class="size-3.5" /> Refresh</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showCreateQueue=true"><Plus class="size-3.5" /> Create Queue</Button>
          </div>
          <div v-if="loadingQueues" class="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading SQS queues...</p></div>
          <div v-else-if="!queues.length" class="text-center py-16 text-muted-foreground"><Inbox class="size-12 mx-auto mb-4 opacity-30" /><p>No SQS queues found.</p></div>
          <div v-else class="space-y-2">
            <Card v-for="q in queues.filter(q => !q.name.endsWith('-dlq'))" :key="q.url" class="!py-3 transition-all" :class="usedQueues.has(q.name)?'border-dashed opacity-50 cursor-not-allowed':selectedQueue?.url===q.url?'border-primary ring-1 ring-primary/20':'hover:border-primary/50 cursor-pointer'" @click="!usedQueues.has(q.name)&&(selectedQueue=q)"><CardContent class="py-3"><div class="flex items-center justify-between gap-4"><div class="min-w-0 flex-1 space-y-1"><div class="flex items-center gap-2"><Inbox class="size-4 text-muted-foreground shrink-0" /><span class="font-mono text-sm font-semibold truncate">{{ q.name }}</span><Badge v-if="usedQueues.has(q.name)" class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px]">In use</Badge></div><div class="text-xs text-muted-foreground">{{ q.messageCount }} messages</div></div>
            <div class="shrink-0"><Button v-if="selectedQueue?.url===q.url" variant="default" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click.stop="goToStep5">Next <ArrowRight class="size-3.5" /></Button></div>
            </div></CardContent></Card>
            <template v-if="queues.some(q => q.name.endsWith('-dlq'))">
              <div class="text-xs text-muted-foreground font-medium pt-3">Dead Letter Queues</div>
              <Card v-for="q in queues.filter(q => q.name.endsWith('-dlq'))" :key="q.url" class="!py-3 border-dashed opacity-60"><CardContent class="py-3"><div class="flex items-center gap-2"><Inbox class="size-4 text-muted-foreground shrink-0" /><span class="font-mono text-sm truncate">{{ q.name }}</span><span class="text-xs text-muted-foreground ml-auto">{{ q.messageCount }} messages</span></div></CardContent></Card>
            </template>
          </div>
        </div>
        <!-- Step 5: Lambda selection + wire -->
        <div v-if="currentStepKind === 'lambda' && selectedPipelineType?.requiresStreamHandler" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Select Lambdas &amp; wire pipeline</span></div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToStep(3);selectedGlueFunction=null;selectedTargetFunction=null;wireResult=null;wireError=''"><ArrowLeft class="size-3.5" /> Back</Button>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="loadFunctions"><RefreshCw class="size-3.5" /> Refresh</Button>
          </div>
          <!-- Summary -->
          <div class="flex flex-wrap items-center gap-2 text-xs bg-muted/50 border rounded-lg px-3 py-2">
            <Badge variant="secondary" class="gap-1 text-[10px]"><Database class="size-3" />{{ selectedTable?.name }}</Badge><ArrowRight class="size-3 text-muted-foreground" />
            <Badge variant="outline" class="gap-1 text-[10px]"><Zap class="size-3" />Stream Handler</Badge><ArrowRight class="size-3 text-muted-foreground" />
            <Badge variant="secondary" class="gap-1 text-[10px]"><Bell class="size-3" />{{ selectedTopic?.name }}</Badge><ArrowRight class="size-3 text-muted-foreground" />
            <Badge variant="secondary" class="gap-1 text-[10px]"><Inbox class="size-3" />{{ selectedQueue?.name }}</Badge><ArrowRight class="size-3 text-muted-foreground" />
            <Badge variant="outline" class="gap-1 text-[10px]"><Zap class="size-3" />Target</Badge>
          </div>
          <!-- Templates -->
          <div v-if="templates.length && !wireResult" class="space-y-2">
            <p class="text-xs text-muted-foreground font-medium">Template Lambdas:</p>
            <div v-for="t in templates" :key="t.id" class="flex items-center gap-3 bg-muted/30 border rounded-lg px-3 py-2">
              <Package class="size-4 text-muted-foreground shrink-0" />
              <div class="flex-1 min-w-0"><p class="text-xs font-semibold">{{ t.name }}</p><p class="text-[10px] text-muted-foreground">{{ t.description }}</p></div>
              <Badge v-if="isTemplateDeployed(t)" class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px] gap-1"><Check class="size-3" />Deployed</Badge>
              <Button v-else variant="outline" size="sm" class="gap-1.5 text-xs cursor-pointer active:scale-95 transition-transform" @click="showDeployTemplate=true;deployTemplateName=`mouseketool-${t.id}`"><Plus class="size-3.5" />Deploy</Button>
            </div>
          </div>
          <div v-if="loadingFunctions" class="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3"><Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading functions...</p></div>
          <div v-else-if="!functions.length && !wireResult" class="text-center py-12 text-muted-foreground"><Zap class="size-12 mx-auto mb-4 opacity-30" /><p>No Lambda functions found.</p><p class="text-xs mt-1">Deploy one from Deployments or use a template above.</p></div>
          <template v-else-if="!wireResult">
            <!-- Stream Handler -->
            <div class="border rounded-lg p-3 space-y-2" :class="selectedGlueFunction ? 'border-green-500/40 bg-green-500/5' : 'border-dashed'">
              <div class="flex items-center justify-between">
                <div><p class="text-xs font-semibold flex items-center gap-1.5"><span class="inline-flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">1</span> Stream Handler</p><p class="text-[10px] text-muted-foreground mt-0.5">Triggered by DynamoDB Stream. Publishes the unmarshalled item to SNS.</p></div>
                <Badge v-if="selectedGlueFunction" class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px] gap-1"><Check class="size-3" />{{ selectedGlueFunction.name }}</Badge>
              </div>
              <div class="space-y-1">
              <Card v-for="f in functions" :key="'glue-'+f.arn" class="!py-2 transition-all" :class="usedFunctions.has(f.name)?'border-dashed opacity-50 cursor-not-allowed':selectedGlueFunction?.name===f.name?'border-primary ring-1 ring-primary/20':'hover:border-primary/50 cursor-pointer'" @click="!usedFunctions.has(f.name)&&(selectedGlueFunction=f,selectedTargetFunction?.name===f.name&&(selectedTargetFunction=null))"><CardContent class="py-2"><div class="flex items-center gap-2"><Zap class="size-3.5 text-muted-foreground shrink-0" /><span class="font-mono text-xs font-semibold truncate">{{ f.name }}</span><Badge variant="secondary" class="text-[10px]">{{ f.runtime }}</Badge><Badge v-if="f.templateId" variant="outline" class="text-[10px] gap-1"><Package class="size-3" />template</Badge><Tooltip v-if="f.templateId"><TooltipTrigger as-child><Info class="size-3 text-muted-foreground cursor-help shrink-0" /></TooltipTrigger><TooltipContent class="max-w-[250px]">This template processes all DynamoDB stream events by default (INSERT, MODIFY, REMOVE). You can filter to inserts only from the pipeline edit page after creation.</TooltipContent></Tooltip><Tooltip v-if="f.outdated"><TooltipTrigger as-child><Badge class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px] gap-1"><AlertTriangle class="size-3" />outdated</Badge></TooltipTrigger><TooltipContent>Template source has changed. Redeploy to update.</TooltipContent></Tooltip></div></CardContent></Card>
            </div></div>
            <!-- Target Lambda -->
            <div class="border rounded-lg p-3 space-y-2" :class="[selectedTargetFunction ? 'border-green-500/40 bg-green-500/5' : 'border-dashed', !selectedGlueFunction ? 'opacity-50 pointer-events-none' : '']">
              <div class="flex items-center justify-between">
                <div><p class="text-xs font-semibold flex items-center gap-1.5"><span class="inline-flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">2</span> Target Lambda</p><p class="text-[10px] text-muted-foreground mt-0.5">{{ selectedGlueFunction ? 'Triggered by SQS. Your actual business logic handler.' : 'Select a Stream Handler first.' }}</p></div>
                <Badge v-if="selectedTargetFunction" class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px] gap-1"><Check class="size-3" />{{ selectedTargetFunction.name }}</Badge>
              </div>
              <div v-if="selectedGlueFunction" class="space-y-1">
              <Tooltip v-for="f in functions" :key="'target-'+f.arn"><TooltipTrigger as-child><Card class="!py-2 transition-all" :class="usedFunctions.has(f.name)||f.name===selectedGlueFunction?.name?'border-dashed opacity-50 cursor-not-allowed':selectedTargetFunction?.name===f.name?'border-primary ring-1 ring-primary/20 cursor-pointer':'hover:border-primary/50 cursor-pointer'" @click="!usedFunctions.has(f.name)&&f.name!==selectedGlueFunction?.name&&(selectedTargetFunction=f)"><CardContent class="py-2"><div class="flex items-center gap-2"><Zap class="size-3.5 text-muted-foreground shrink-0" /><span class="font-mono text-xs font-semibold truncate">{{ f.name }}</span><Badge variant="secondary" class="text-[10px]">{{ f.runtime }}</Badge><Badge v-if="f.templateId" variant="outline" class="text-[10px] gap-1"><Package class="size-3" />template</Badge><Tooltip v-if="f.outdated"><TooltipTrigger as-child><Badge class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px] gap-1"><AlertTriangle class="size-3" />outdated</Badge></TooltipTrigger><TooltipContent>Template source has changed. Redeploy to update.</TooltipContent></Tooltip></div></CardContent></Card></TooltipTrigger><TooltipContent v-if="usedFunctions.has(f.name)">Already used by another pipeline</TooltipContent><TooltipContent v-else-if="f.name===selectedGlueFunction?.name">Already selected as the Stream Handler</TooltipContent></Tooltip>
            </div></div>
          </template>
          <!-- Wire button -->
          <div v-if="selectedGlueFunction && selectedTargetFunction && !wireResult" ref="wireButtonRef" class="pt-2 space-y-3">
            <div class="space-y-1.5">
              <Label class="text-xs">Pipeline Name <span class="text-muted-foreground font-normal">(optional)</span></Label>
              <Input v-model="pipelineName" :placeholder="`${selectedTable?.name ?? 'table'} → ${selectedTargetFunction?.name ?? 'lambda'}`" class="font-mono text-xs" />
            </div>
            <Button class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="goToNextStep()">Next: Add-ons <ArrowRight class="size-3.5" /></Button>
          </div>
        </div>
        <!-- Step: Target Lambda (simple - for non-APP types) -->
        <div v-if="currentStepKind === 'lambda' && !selectedPipelineType?.requiresStreamHandler" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Select a target Lambda</span></div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToPrevStep()"><ArrowLeft class="size-3.5" /> Back</Button>
          </div>
          <TargetLambdaSelector :used-functions="usedTargets" @select="fn => { selectedTargetFunction = fn; }" />
          <div v-if="selectedTargetFunction" class="space-y-3 pt-2">
            <div class="flex items-center gap-2">
              <Label class="text-xs">Pipeline name (optional)</Label>
              <Input v-model="pipelineName" placeholder="Auto-generated if empty" class="h-8 text-xs max-w-xs" />
            </div>
            <Button class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="goToNextStep">Next <ArrowRight class="size-3.5" /></Button>
          </div>
        </div>

        <!-- Step: Add-ons -->
        <div v-if="currentStepKind === 'addons'" class="space-y-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="default" class="text-[10px]">Step {{ stepIndex + 1 }}</Badge><span>Configure add-ons (optional)</span></div>
          <div class="flex items-center gap-2">
            <Button v-if="!wireResult" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="stepIndex = 4"><ArrowLeft class="size-3.5" /> Back</Button>
          </div>

          <!-- Vault Add-on Card -->
          <Card class="!py-3">
            <CardContent class="py-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="size-9 rounded-lg bg-muted flex items-center justify-center"><VaultIcon class="size-4" /></div>
                  <div>
                    <p class="text-sm font-medium">Vault</p>
                    <p class="text-xs text-muted-foreground">Create secrets in Vault for the target Lambda to read during initialization</p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <Badge v-if="vaultEnabled && vaultTestResult?.ok" class="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">Connected</Badge>
                  <span class="text-xs text-muted-foreground">{{ vaultEnabled ? 'Enabled' : 'Disabled' }}</span>
                  <Toggle v-model="vaultEnabled" />
                  <Button @click="showVaultSheet = true" :disabled="!vaultEnabled" variant="outline" size="sm" class="gap-1.5 cursor-pointer">Configure</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Info banner -->
          <!-- Heavy Load Card -->
          <Card class="!py-3" :class="{ 'opacity-50': !selectedPipelineType?.supportsHeavyLoad }">
            <CardContent class="py-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="size-9 rounded-lg bg-muted flex items-center justify-center"><Flame class="size-4" /></div>
                  <div>
                    <p class="text-sm font-medium">Heavy Load</p>
                    <p class="text-xs text-muted-foreground">Increase batch size and window for high-throughput DynamoDB streams</p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-xs text-muted-foreground">{{ heavyLoad ? 'Enabled' : 'Disabled' }}</span>
                  <Tooltip :disabled="selectedPipelineType?.supportsHeavyLoad !== false"><TooltipTrigger as-child><span><Toggle v-model="heavyLoad" :disabled="!selectedPipelineType?.supportsHeavyLoad" /></span></TooltipTrigger><TooltipContent>Coming in a future release</TooltipContent></Tooltip>
                </div>
              </div>
            </CardContent>
          </Card>

          <div v-if="vaultEnabled" class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 space-y-1">
            <p class="font-semibold">How add-ons work in pipelines</p>
            <p>Unlike the Deployments page where Vault secrets are created before each invocation, here secrets are created once and their values are <span class="font-semibold">applied as environment variables</span> to the target Lambda when the pipeline is saved. The event source mapping will use these pre-configured values.</p>
          </div>

          <!-- Wire button -->
          <div v-if="!wireResult" class="pt-2">
            <Button :disabled="wiring" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="wirePipeline"><Loader2 v-if="wiring" class="size-4 animate-spin" /><Cable v-else class="size-4" />{{ wiring ? 'Wiring...' : 'Wire Pipeline' }}</Button>
          </div>
          <div v-if="wireError" class="flex items-center gap-2 text-xs text-red-500 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2"><AlertTriangle class="size-3.5 shrink-0" /><span>{{ wireError }}</span></div>
          <div v-if="wireResult" class="space-y-3">
            <div class="flex items-center gap-2 text-sm text-green-500 bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-3"><Check class="size-5 shrink-0" /><div><p class="font-semibold">Pipeline wired!</p><p class="text-xs text-green-400 mt-1">DynamoDB → Stream Handler → SNS → SQS → Target Lambda</p></div></div>
            <div class="space-y-1"><div v-for="r in wireResult.results" :key="r.step" class="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2"><Cable class="size-3.5 shrink-0" /><span class="font-medium">{{ r.step }}</span><span class="font-mono text-[10px] opacity-60 truncate">{{ r.detail }}</span></div></div>
            <Button variant="outline" class="gap-1.5 cursor-pointer active:scale-95 transition-transform mt-2" @click="startOver"><RotateCcw class="size-4" /> Start Over</Button>
          </div>
        </div>
    </div>
    </template>
    <!-- Create Table Dialog -->
    <Dialog v-model:open="showCreate"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Create DynamoDB Table</DialogTitle><DialogDescription>Streams enabled by default (NEW_AND_OLD_IMAGES).</DialogDescription></DialogHeader>
      <div class="space-y-4"><div class="space-y-2"><Label>Table Name</Label><Input v-model="newTableName" placeholder="my-table" class="font-mono text-xs" /></div>
        <div class="grid grid-cols-[1fr_auto] gap-2"><div class="space-y-2"><Label>Partition Key</Label><Input v-model="newPartitionKey" placeholder="pk" class="font-mono text-xs" /></div><div class="space-y-2"><Label>Type</Label><Select v-model="newPartitionKeyType"><SelectTrigger class="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="S">String</SelectItem><SelectItem value="N">Number</SelectItem><SelectItem value="B">Binary</SelectItem></SelectContent></Select></div></div>
        <div class="grid grid-cols-[1fr_auto] gap-2"><div class="space-y-2"><Label>Sort Key <span class="text-muted-foreground font-normal">(optional)</span></Label><Input v-model="newSortKey" placeholder="sk" class="font-mono text-xs" /></div><div class="space-y-2"><Label>Type</Label><Select v-model="newSortKeyType"><SelectTrigger class="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="S">String</SelectItem><SelectItem value="N">Number</SelectItem><SelectItem value="B">Binary</SelectItem></SelectContent></Select></div></div>
      </div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showCreate=false">Cancel</Button><Button :disabled="!newTableName||!newPartitionKey||creating" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="createTable"><Loader2 v-if="creating" class="size-4 animate-spin" /><Check v-else class="size-4" />{{ creating?'Creating...':'Create' }}</Button></DialogFooter>
    </DialogContent></Dialog>
    <!-- Restore Table Dialog -->
    <Dialog v-model:open="showRestore"><DialogContent class="sm:max-w-lg"><DialogHeader><DialogTitle>Restore Table from Schema</DialogTitle><DialogDescription>Recreate a previously saved table. Optionally provide a seed item in DynamoDB JSON format.</DialogDescription></DialogHeader>
      <div class="space-y-4">
        <div class="space-y-2">
          <Label>Saved Schema</Label>
          <Select v-model="restoreSchema"><SelectTrigger><SelectValue placeholder="Select a schema..." /></SelectTrigger><SelectContent><SelectItem v-for="s in savedSchemas" :key="s.tableName" :value="s.tableName">{{ s.tableName }}</SelectItem></SelectContent></Select>
        </div>
        <div class="space-y-2">
          <Label>Seed Item <span class="text-muted-foreground font-normal">{{ restoreSeedJson ? '(saved seed loaded, you may edit)' : '(optional, DynamoDB JSON)' }}</span></Label>
          <textarea v-model="restoreSeedJson" placeholder='{"pk": {"S": "example"}, "sk": {"S": "item-1"}}' class="w-full h-32 font-mono text-xs bg-zinc-900 border border-zinc-700 rounded-md p-3 text-zinc-200 outline-none resize-y" />
        </div>
      </div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showRestore=false">Cancel</Button><Button :disabled="!restoreSchema||restoring" class="gap-2 cursor-pointer active:scale-95 transition-transform min-w-[120px]" @click="restoreTable"><Loader2 v-if="restoring" class="size-4 animate-spin" /><HardDrive v-else class="size-4" />{{ restoring?'Restoring...':'Restore' }}</Button></DialogFooter>
    </DialogContent></Dialog>
    <!-- Save Schema Dialog -->
    <Dialog v-model:open="showSaveSchema"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Save Table Schema</DialogTitle><DialogDescription>Save the schema for <span class="font-mono font-semibold">{{ selectedTable?.name }}</span>. Optionally include a seed item to insert on restore.</DialogDescription></DialogHeader>
      <div class="space-y-2">
        <Label>Seed Item <span class="text-muted-foreground font-normal">(optional, DynamoDB JSON)</span></Label>
        <textarea v-model="saveSeedJson" placeholder='{"pk": {"S": "example"}, "sk": {"S": "item-1"}}' class="w-full h-32 font-mono text-xs bg-zinc-900 border border-zinc-700 rounded-md p-3 text-zinc-200 outline-none resize-y" />
      </div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showSaveSchema=false">Cancel</Button><Button class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="saveTableSchema"><Save class="size-4" /> Save</Button></DialogFooter>
    </DialogContent></Dialog>


    <!-- Create Topic Dialog -->
    <Dialog v-model:open="showCreateTopic"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Create SNS Topic</DialogTitle><DialogDescription>Create a standard SNS topic on LocalStack.</DialogDescription></DialogHeader>
      <div class="space-y-2"><Label>Topic Name</Label><Input v-model="newTopicName" placeholder="my-topic" class="font-mono text-xs" /></div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showCreateTopic=false">Cancel</Button><Button :disabled="!newTopicName||creatingTopic" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="createTopic"><Loader2 v-if="creatingTopic" class="size-4 animate-spin" /><Check v-else class="size-4" />{{ creatingTopic?'Creating...':'Create' }}</Button></DialogFooter>
    </DialogContent></Dialog>
    <!-- Create Queue Dialog -->
    <Dialog v-model:open="showCreateQueue"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Create SQS Queue</DialogTitle><DialogDescription>Create a standard SQS queue on LocalStack.</DialogDescription></DialogHeader>
      <div class="space-y-2"><Label>Queue Name</Label><Input v-model="newQueueName" placeholder="my-queue" class="font-mono text-xs" /></div>
      <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="createDlq" class="accent-primary" />Create Dead Letter Queue (<span class="font-mono text-xs">{{ newQueueName ? newQueueName + '-dlq' : '…-dlq' }}</span>)</label>
      <div v-if="createDlq" class="flex items-center gap-2 text-sm"><Label class="whitespace-nowrap">Max Receive Count</Label><Input v-model.number="maxReceiveCount" type="number" min="1" max="100" class="w-20 font-mono text-xs" /></div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showCreateQueue=false">Cancel</Button><Button :disabled="!newQueueName||creatingQueue" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="createQueue"><Loader2 v-if="creatingQueue" class="size-4 animate-spin" /><Check v-else class="size-4" />{{ creatingQueue?'Creating...':'Create' }}</Button></DialogFooter>
    </DialogContent></Dialog>
    <!-- Deploy Template Dialog -->
    <Dialog v-model:open="showDeployTemplate"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Deploy Template Lambda</DialogTitle><DialogDescription>Deploy a glue function to LocalStack. SNS_TOPIC_ARN will be set automatically.</DialogDescription></DialogHeader>
      <div class="space-y-2"><Label>Function Name</Label><Input v-model="deployTemplateName" placeholder="mouseketool-dynamodb-to-sns" class="font-mono text-xs" /></div>
      <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showDeployTemplate=false">Cancel</Button><Button :disabled="!deployTemplateName||deployingTemplate" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="deployTemplate(templates[0])"><Loader2 v-if="deployingTemplate" class="size-4 animate-spin" /><Check v-else class="size-4" />{{ deployingTemplate?'Deploying...':'Deploy' }}</Button></DialogFooter>
    </DialogContent></Dialog>
    <!-- Env Var Editor Dialog -->
    <Dialog v-model:open="showEnvEditor"><DialogContent class="!max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Environment Variables</DialogTitle><DialogDescription>Configure env vars for the target Lambda in <span class="font-semibold">{{ envEditorPipelineName }}</span>. Applied before each pipeline execution.</DialogDescription></DialogHeader>
      <div class="space-y-2">
        <div v-for="(e, i) in envVars" :key="i" class="flex items-center gap-2">
          <Input v-model="e.key" placeholder="KEY" class="font-mono text-xs flex-1" />
          <Input v-model="e.value" placeholder="value" class="font-mono text-xs flex-1" :disabled="e.isNull" :class="e.isNull ? 'opacity-40' : ''" />
          <Tooltip><TooltipTrigger as-child><label class="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer whitespace-nowrap"><input type="checkbox" v-model="e.isNull" class="accent-primary" />Exclude</label></TooltipTrigger><TooltipContent>Exclude this variable from the Lambda configuration</TooltipContent></Tooltip>
          <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer active:scale-95 transition-transform px-2" @click="removeEnvVar(i)">✕</Button>
        </div>
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="addEnvVar"><Plus class="size-3.5" /> Add Variable</Button>
      </div>
      <DialogFooter>
        <Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showEnvEditor=false">Cancel</Button>
        <Button :disabled="savingEnv" class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="saveEnvVars"><Loader2 v-if="savingEnv" class="size-4 animate-spin" /><Check v-else class="size-4" />{{ savingEnv ? 'Saving...' : 'Save' }}</Button>
      </DialogFooter>
    </DialogContent></Dialog>
    <!-- See Steps Modal -->
    <Dialog v-model:open="showStepsModal"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Pipeline Steps</DialogTitle><DialogDescription>{{ stepsPipeline?.name }}</DialogDescription></DialogHeader>
      <div v-if="stepsPipeline" class="space-y-0 py-2">
        <template v-for="(step, i) in stepsForPipeline(stepsPipeline)" :key="step.label">
          <div class="flex items-center gap-3 py-2"><div class="size-7 rounded-full bg-muted flex items-center justify-center"><component :is="step.icon" class="size-3.5 text-muted-foreground" /></div><div><p class="text-xs font-semibold">{{ step.label }}</p><p class="font-mono text-[10px] text-muted-foreground">{{ step.detail }}</p></div></div>
          <div v-if="i < stepsForPipeline(stepsPipeline).length - 1" class="pl-[13px]"><div class="w-0.5 h-4 bg-border" /></div>
        </template>
      </div>
    </DialogContent></Dialog>

    <!-- Delete Confirmation Modal -->
    <Dialog v-model:open="showDeleteConfirm"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Delete pipelines</DialogTitle><DialogDescription>Are you sure you want to delete {{ selectedPipelines.size }} selected pipeline{{ selectedPipelines.size > 1 ? 's' : '' }}?</DialogDescription></DialogHeader>
      <div class="text-xs space-y-2 py-2">
        <p class="font-medium">The following resources will be deleted:</p>
        <ul class="list-disc pl-5 space-y-0.5 text-muted-foreground">
          <li>Event source mappings</li>
          <li>Stream handler Lambda function</li>
          <li>SNS → SQS subscription</li>
          <li v-if="!selectedHasExternal">SNS topic (created by Mouseketool)</li>
          <li v-if="!selectedHasExternal">SQS queue and its dead letter queue (created by Mouseketool)</li>
          <li>CloudWatch log groups (invocation history)</li>
        </ul>
        <p class="font-medium pt-1">The following resources will be preserved:</p>
        <ul class="list-disc pl-5 space-y-0.5 text-muted-foreground">
          <li>DynamoDB source table</li>
          <li>Target Lambda function and its deployment</li>
          <li v-if="selectedHasExternal">SNS topic and SQS queue (not created by Mouseketool)</li>
        </ul>
        <div v-if="selectedHasExternal" class="pt-2 border-t border-border mt-2">
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="deleteExternalResources" class="accent-primary" /><span class="text-muted-foreground">Also delete SNS topics and SQS queues not created by Mouseketool</span></label>
        </div>
        <div v-if="selectedHasVault" class="pt-2" :class="selectedHasExternal ? '' : 'border-t border-border mt-2'">
          <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="deleteVaultSecrets" class="accent-primary" /><span class="text-muted-foreground">Also delete Vault secrets created during pipeline setup</span></label>
        </div>
      </div>
      <DialogFooter><Button variant="outline" class="cursor-pointer" @click="showDeleteConfirm = false">Cancel</Button><Button variant="destructive" class="gap-1.5 cursor-pointer" @click="deleteSelected"><Trash2 class="size-3.5" /> Delete</Button></DialogFooter>
    </DialogContent></Dialog>

    <!-- Deleting toast -->
    <div v-if="deletingMapping" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg">
      <Loader2 class="size-4 animate-spin" /> Deleting pipelines...
    </div>

    <!-- Vault Sheet -->
    <Sheet v-model:open="showVaultSheet">
    <SheetContent class="w-[420px] sm:max-w-[420px] overflow-y-auto p-6">
      <SheetHeader class="mb-4">
        <SheetTitle class="flex items-center gap-2"><VaultIcon class="size-4" /> Vault Configuration</SheetTitle>
        <SheetDescription>Configure secrets to create in your Vault instance. Values will be applied as environment variables to the target Lambda.</SheetDescription>
      </SheetHeader>
      <div class="space-y-6">
        <!-- Connection -->
        <div class="space-y-4 rounded-lg border p-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
          <div class="space-y-2">
            <Label>Vault URL</Label>
            <div class="flex gap-2">
              <Input v-model="vaultUrl" placeholder="http://localhost:8200" class="font-mono text-xs flex-1" />
              <Button variant="outline" size="sm" class="shrink-0 text-xs cursor-pointer" @click="vaultUrl = 'http://localhost:8200'">Default</Button>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-2"><Label>Root Token</Label><ShieldAlert class="size-3.5 text-yellow-500" /></div>
            <Input v-model="vaultToken" type="password" placeholder="hvs.xxxxx" class="font-mono text-xs" />
          </div>
          <Button @click="testVaultConnection" :disabled="!vaultUrl || !vaultToken || vaultTesting" variant="outline" size="sm" class="w-full gap-2 cursor-pointer">
            <Loader2 v-if="vaultTesting" class="size-3.5 animate-spin" /><Plug v-else class="size-3.5" />
            {{ vaultTesting ? "Testing..." : "Test Connection" }}
          </Button>
          <div v-if="vaultTestResult" class="flex items-center gap-2 text-xs" :class="vaultTestResult.ok ? 'text-green-500' : 'text-red-500'">
            <CheckCircle2 v-if="vaultTestResult.ok" class="size-3.5" /><XCircle v-else class="size-3.5" />
            {{ vaultTestResult.message }}
          </div>
        </div>
        <!-- Secrets -->
        <div class="space-y-4 rounded-lg border p-4">
          <div class="flex items-center justify-between">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Secrets</p>
            <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="vaultSecrets.push({ path: '', entries: [{ key: '', value: '' }] })"><Plus class="size-3" /> Add</Button>
          </div>
          <div v-if="!vaultSecrets.length" class="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">No secrets configured.</div>
          <div class="space-y-2 max-h-60 overflow-auto scrollbar-thin">
            <div v-for="(s, i) in vaultSecrets" :key="i" class="space-y-2 p-3 rounded-md border bg-muted/30">
              <div class="flex items-center gap-2">
                <Input v-model="s.path" placeholder="dummy/secret" class="font-mono text-xs h-7 flex-1" />
                <Button variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="vaultSecrets.splice(i, 1)"><X class="size-3" /></Button>
              </div>
              <div v-for="(e, j) in s.entries" :key="j" class="flex items-center gap-2">
                <Input v-model="e.key" placeholder="key" class="font-mono text-xs h-7 flex-1" />
                <Input v-model="e.value" type="password" placeholder="value" class="font-mono text-xs h-7 flex-1" />
                <Button v-if="s.entries.length > 1" variant="ghost" size="icon" class="size-6 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="s.entries.splice(j, 1)"><X class="size-2.5" /></Button>
              </div>
              <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer w-full" @click="s.entries.push({ key: '', value: '' })"><Plus class="size-3" /> Add field</Button>
            </div>
          </div>
        </div>
        <Button @click="applyVaultSecrets" :disabled="!vaultUrl || !vaultToken || !vaultSecrets.some(s => s.path) || vaultApplying" class="w-full gap-2 cursor-pointer">
          <Loader2 v-if="vaultApplying" class="size-3.5 animate-spin" /><Check v-else class="size-3.5" />
          {{ vaultApplying ? "Creating..." : "Create Secrets in Vault" }}
        </Button>
      </div>
    </SheetContent>
    </Sheet>
    <!-- Toast -->
    <div v-if="toastMessage" :key="toastMessage" :class="toastError ? 'bg-destructive' : 'bg-green-600'" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300">
      <AlertTriangle v-if="toastError" class="size-4" /><Check v-else class="size-4" />{{ toastMessage }}
    </div>
  </div>
</template>
