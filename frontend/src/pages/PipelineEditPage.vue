<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Toggle from "@/components/ui/Toggle.vue";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Database, Zap, Bell, Inbox, ArrowLeft, Save, Loader2, AlertTriangle, Check, X, Plus, ListFilter, Lock, Settings2, Package, Plug, CheckCircle2, XCircle, ShieldAlert, ChevronDown,
} from "lucide-vue-next";
import VaultIcon from "@/components/icons/VaultIcon.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

const route = useRoute();
const router = useRouter();
const pipelineId = route.params.id as string;

interface Pipeline { id: string; name: string; type?: string; tableName: string; topicName: string; queueName: string; glueFunctionName: string; targetFunctionName: string; topicArn: string; queueUrl: string; subscriptionArn?: string; filterPolicy?: Record<string, unknown>; filterPolicyScope?: string; heavyLoad?: boolean; targetMissing?: boolean; vaultIncomplete?: boolean; addons?: string[]; vaultConfig?: { url: string; token: string; paths: string[] }; }

const pipeline = ref<Pipeline | null>(null);
const resources = ref<Record<string, any>>({});
const loading = ref(true);
const saving = ref(false);
const schemaSaved = ref(false);
const showSaveSchema = ref(false);
const saveSeedJson = ref("");
async function saveSchema() {
  if (!pipeline.value) return;
  try {
    const body: any = {};
    if (saveSeedJson.value.trim()) { try { body.seedItem = JSON.parse(saveSeedJson.value); } catch {} }
    await fetch(`/api/dynamodb/tables/${pipeline.value.tableName}/save-schema`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    showSaveSchema.value = false; saveSeedJson.value = "";
    schemaSaved.value = true;
    setTimeout(() => schemaSaved.value = false, 3000);
  } catch {}
}
const saveError = ref("");
const saveSuccess = ref(false);
const activeStep = ref<"dynamodb" | "streamHandler" | "sns" | "sqs" | "target" | "addons" | "envvars">("dynamodb");
watch(() => pipeline.value?.type, (t) => { if (t === "queue-consumer") activeStep.value = "sqs"; else if (t === "direct-stream") activeStep.value = "dynamodb"; }, { immediate: true });

// Editable state
const heavyLoad = ref(false);
const addons = ref<string[]>([]);
const vaultUrl = ref("");
const vaultToken = ref("");

// Env var panel state (inline, not modal)
const envVars = ref<{ key: string; value: string; isNull?: boolean }[]>([]);
const lsManaged = ref(false);
const hasLocalhostEnv = computed(() => lsManaged.value && envVars.value.some((e: any) => e.value?.includes("http://localhost")));
onMounted(async () => { try { const s = await (await fetch("/api/settings")).json(); lsManaged.value = !!s.localstackManaged; } catch {} });
const savingEnv = ref(false);
const envLoaded = ref(false);
const origEnvVars = ref("");
async function loadEnvVars() {
  if (!pipeline.value || envLoaded.value || pipeline.value.targetMissing) return;
  try { envVars.value = await (await fetch(`/api/deployments/lambda-env/${pipeline.value.targetFunctionName}`)).json(); } catch { envVars.value = []; }
  if (!envVars.value.length) envVars.value.push({ key: "", value: "" });
  envLoaded.value = true;
  origEnvVars.value = JSON.stringify(envVars.value);
}

// Target lambda selector for missing builds
interface AvailableDeployment { functionName: string; handler: string; runtime: string; buildId: string; }
const availableDeployments = ref<AvailableDeployment[]>([]);
const changingTarget = ref(false);
const showTargetWarning = ref(false);
const pendingTarget = ref<AvailableDeployment | null>(null);
async function loadAvailableDeployments() {
  try { availableDeployments.value = (await (await fetch("/api/deployments")).json()).filter((d: any) => d.functionName !== pipeline.value?.glueFunctionName && d.status === "active"); } catch {}
}
async function changeTarget(dep: AvailableDeployment) {
  if (!pipeline.value) return;
  changingTarget.value = true;
  try {
    const res = await fetch(`/api/triggers/pipelines/${pipelineId}/edit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newTargetFunctionName: dep.functionName }) });
    if (!res.ok) { console.error("changeTarget failed:", await res.text()); changingTarget.value = false; return; }
    pipeline.value.targetFunctionName = dep.functionName;
    pipeline.value.targetMissing = false;
    envLoaded.value = false;
    await loadEnvVars();
    try { resources.value = await (await fetch(`/api/triggers/pipelines/${pipelineId}/resources`)).json(); } catch {}
  } catch (e) { console.error("changeTarget error:", e); }
  changingTarget.value = false;
}
function addEnvVar() { envVars.value.push({ key: "", value: "" }); }
function removeEnvVar(i: number) { envVars.value.splice(i, 1); }
async function saveEnvVars() {
  if (!pipeline.value) return;
  savingEnv.value = true;
  await fetch(`/api/deployments/lambda-env/${pipeline.value.targetFunctionName}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envVars: envVars.value.filter(e => e.key) }),
  });
  savingEnv.value = false;
}

// Vault add-on state
const vaultSecrets = ref<{ path: string; entries: { key: string; value: string }[] }[]>([]);

// Stream handler options
const insertsOnly = ref(false);
const origInsertsOnly = ref(false);
const origVaultUrl = ref("");
const origVaultToken = ref("");
const origVaultSecrets = ref("[]");
const vaultTesting = ref(false);
const vaultTestResult = ref<{ ok: boolean; message: string } | null>(null);
const vaultCleanup = ref(false);
const vaultExpanded = ref(false);
const vaultPathKeys = ref<Record<string, number>>({});
async function loadVaultPathKeys() {
  if (!vaultUrl.value || !vaultToken.value || !vaultSecrets.value.length) return;
  const paths = vaultSecrets.value.filter(s => s.path).map(s => s.path);
  if (!paths.length) return;
  try {
    const res = await fetch("/api/vault/read-paths", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, paths }) });
    const data = await res.json();
    const map: Record<string, number> = {};
    for (const r of data) map[r.path] = r.keys;
    vaultPathKeys.value = map;
  } catch {}
}
function addSecret() { vaultSecrets.value.push({ path: "", entries: [{ key: "", value: "" }] }); }
function removeSecret(i: number) { vaultSecrets.value.splice(i, 1); }
async function testVaultConnection() {
  vaultTesting.value = true; vaultTestResult.value = null;
  try {
    const res = await fetch("/api/vault/test-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value }) });
    vaultTestResult.value = await res.json();
  } catch (e: any) { vaultTestResult.value = { ok: false, message: e.message }; }
  vaultTesting.value = false;
}

// Filter policy state
type FilterOp = "exact-string" | "prefix" | "anything-but" | "anything-but-prefix" | "suffix" | "wildcard" | "exact-number" | "number-range" | "exists";
interface FilterRule { field: string; op: FilterOp; values: string[]; chipInput: string; rangeMin: string; rangeMax: string; rangeLow: ">" | ">="; rangeHigh: "<" | "<="; existsVal: boolean; }
const filterEnabled = ref(false);
const filterScope = ref<"MessageBody" | "MessageAttributes">("MessageBody");
const filterRules = ref<FilterRule[]>([]);
const filterOps: { value: FilterOp; label: string }[] = [
  { value: "exact-string", label: "String - exact match" },
  { value: "prefix", label: "String - prefix" },
  { value: "anything-but", label: "String - anything-but" },
  { value: "anything-but-prefix", label: "String - anything-but prefix" },
  { value: "suffix", label: "String - suffix" },
  { value: "wildcard", label: "String - wildcard" },
  { value: "exact-number", label: "Number - exact match" },
  { value: "number-range", label: "Number - range" },
  { value: "exists", label: "Key - exists / not exists" },
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

// Parse existing filter policy back into rules
function parseFilterPolicy(policy: Record<string, unknown>, scope?: string) {
  filterEnabled.value = true;
  filterScope.value = (scope as any) || "MessageAttributes";
  filterRules.value = [];
  for (const [field, cond] of Object.entries(policy)) {
    const rule = newRule();
    rule.field = field;
    if (!Array.isArray(cond)) { filterRules.value.push(rule); continue; }
    const arr = cond as any[];
    if (!arr.length) { filterRules.value.push(rule); continue; }
    const first = arr[0];
    if (typeof first === "string") { rule.op = "exact-string"; rule.values = arr; }
    else if (first?.prefix) { rule.op = "prefix"; rule.values = arr.map((v: any) => v.prefix); }
    else if (first?.suffix) { rule.op = "suffix"; rule.values = arr.map((v: any) => v.suffix); }
    else if (first?.wildcard) { rule.op = "wildcard"; rule.values = arr.map((v: any) => v.wildcard); }
    else if (first?.["anything-but"]) {
      const ab = first["anything-but"];
      if (ab?.prefix) { rule.op = "anything-but-prefix"; rule.values = Array.isArray(ab.prefix) ? ab.prefix : [ab.prefix]; }
      else { rule.op = "anything-but"; rule.values = Array.isArray(ab) ? ab : [ab]; }
    }
    else if (first?.numeric) {
      const n = first.numeric;
      if (n[0] === "=") { rule.op = "exact-number"; rule.values = [String(n[1])]; }
      else { rule.op = "number-range"; rule.rangeLow = n[0]; rule.rangeMin = String(n[1]); if (n.length > 2) { rule.rangeHigh = n[2]; rule.rangeMax = String(n[3]); } }
    }
    else if (first?.exists !== undefined) { rule.op = "exists"; rule.existsVal = first.exists; }
    filterRules.value.push(rule);
  }
}

const hasChanges = computed(() => {
  if (!pipeline.value) return false;
  const p = pipeline.value;
  if (heavyLoad.value !== !!p.heavyLoad) return true;
  if (pipeline.value?.glueFunctionName && insertsOnly.value !== origInsertsOnly.value) return true;
  if (JSON.stringify(addons.value) !== JSON.stringify(p.addons ?? [])) return true;
  const currentPolicy = buildFilterPolicy();
  const origPolicy = p.filterPolicy && Object.keys(p.filterPolicy).length ? p.filterPolicy : null;
  if (JSON.stringify(currentPolicy) !== JSON.stringify(origPolicy)) return true;
  if (filterEnabled.value && filterScope.value !== (p.filterPolicyScope || "MessageAttributes")) return true;
  if (vaultUrl.value !== origVaultUrl.value || vaultToken.value !== origVaultToken.value) return true;
  if (JSON.stringify(vaultSecrets.value) !== origVaultSecrets.value) return true;
  if (envLoaded.value && JSON.stringify(envVars.value) !== origEnvVars.value) return true;
  return false;
});

const allEditSteps = [
  { key: "dynamodb" as const, label: "DynamoDB", icon: Database, kinds: ["dynamodb"] },
  { key: "streamHandler" as const, label: "Stream Handler", icon: Zap, kinds: ["stream-handler"] },
  { key: "sns" as const, label: "SNS Topic", icon: Bell, kinds: ["sns"] },
  { key: "sqs" as const, label: "SQS Queue", icon: Inbox, kinds: ["sqs"] },
  { key: "target" as const, label: "Target Lambda", icon: Zap, kinds: ["lambda"] },
];
const steps = computed(() => {
  const t = pipeline.value?.type || "app-pipeline";
  const typeMap: Record<string, string[]> = { "app-pipeline": ["dynamodb","stream-handler","sns","sqs","lambda"], "direct-stream": ["dynamodb","lambda"], "queue-consumer": ["sqs","lambda"], "sns-fanout": ["sns","sqs","lambda"] };
  const active = typeMap[t] || typeMap["app-pipeline"];
  return allEditSteps.filter(s => s.kinds.some(k => active.includes(k)));
});

function formatBytes(b: number) { if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }

onMounted(async () => {
  try {
    const [pRes, rRes] = await Promise.all([
      fetch("/api/triggers/pipelines"),
      fetch(`/api/triggers/pipelines/${pipelineId}/resources`),
    ]);
    const pipelines = await pRes.json();
    pipeline.value = pipelines.find((p: Pipeline) => p.id === pipelineId) ?? null;
    resources.value = await rRes.json();
    if (pipeline.value) {
      heavyLoad.value = !!pipeline.value.heavyLoad;
      addons.value = [...(pipeline.value.addons ?? [])];
      if (pipeline.value.vaultConfig) {
        vaultUrl.value = pipeline.value.vaultConfig.url;
        vaultToken.value = pipeline.value.vaultConfig.token;
        vaultSecrets.value = pipeline.value.vaultConfig.paths.map((p: string) => ({ path: p, entries: [{ key: "", value: "" }] }));
        origVaultUrl.value = vaultUrl.value;
        origVaultToken.value = vaultToken.value;
        origVaultSecrets.value = JSON.stringify(vaultSecrets.value);
        loadVaultPathKeys();
      }
      if (pipeline.value.filterPolicy && Object.keys(pipeline.value.filterPolicy).length) {
        parseFilterPolicy(pipeline.value.filterPolicy, pipeline.value.filterPolicyScope);
      }
      loadEnvVars();
      // Load stream handler inserts-only setting
      if (pipeline.value.targetMissing) loadAvailableDeployments();

      try {
        if (!pipeline.value.glueFunctionName) throw new Error("skip");
        const glueEnv = await (await fetch(`/api/deployments/lambda-env/${pipeline.value.glueFunctionName}`)).json();
        insertsOnly.value = glueEnv.some((e: any) => e.key === "STREAM_INSERTS_ONLY" && e.value === "true");
        origInsertsOnly.value = insertsOnly.value;
      } catch {}
    }
  } catch {}
  loading.value = false;
});

async function save() {
  saving.value = true; saveError.value = ""; saveSuccess.value = false;
  try {
    const body: any = { heavyLoad: heavyLoad.value, addons: addons.value, filterPolicy: buildFilterPolicy(), filterPolicyScope: filterEnabled.value ? filterScope.value : undefined };
    if (addons.value.includes("vault") && vaultSecrets.value.some(s => s.path)) {
      body.vaultConfig = { url: vaultUrl.value, token: vaultToken.value, paths: vaultSecrets.value.filter(s => s.path).map(s => s.path) };
    }
    const res = await fetch(`/api/triggers/pipelines/${pipelineId}/edit`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Save failed"); }
    // Save inserts-only setting on glue Lambda
    if (pipeline.value && pipeline.value.glueFunctionName) {
      const name = pipeline.value.glueFunctionName;
      const envRes = await (await fetch(`/api/deployments/lambda-env/${name}`)).json();
      const vars = envRes.filter((e: any) => e.key !== "STREAM_INSERTS_ONLY");
      if (insertsOnly.value) vars.push({ key: "STREAM_INSERTS_ONLY", value: "true" });
      await fetch(`/api/deployments/lambda-env/${name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envVars: vars }) });
    }
    // Save env vars if changed
    if (envLoaded.value && JSON.stringify(envVars.value) !== origEnvVars.value && pipeline.value) {
      await fetch(`/api/deployments/lambda-env/${pipeline.value.targetFunctionName}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envVars: envVars.value.filter(e => e.key) }) });
      origEnvVars.value = JSON.stringify(envVars.value);
    }
    // Update local pipeline ref so hasChanges resets
    if (pipeline.value) {
      // Vault: create secrets if entries have values
      if (addons.value.includes("vault") && vaultSecrets.value.some(s => s.path && s.entries.some(e => e.key && e.value))) {
        const secrets = vaultSecrets.value.filter(s => s.path && s.entries.some(e => e.key)).map(s => ({ path: s.path, value: JSON.stringify(Object.fromEntries(s.entries.filter(e => e.key).map(e => [e.key, e.value]))) }));
        const paths = secrets.map(s => s.path);
        await fetch("/api/vault/cleanup-secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, paths }) });
        await fetch("/api/vault/setup-secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, secrets }) });
        if (pipeline.value) pipeline.value.vaultIncomplete = false;
      }
      pipeline.value.heavyLoad = heavyLoad.value;
      pipeline.value.addons = [...addons.value];
      pipeline.value.filterPolicy = buildFilterPolicy() ?? undefined;
      pipeline.value.filterPolicyScope = filterEnabled.value ? filterScope.value : undefined;
      if (body.vaultConfig) pipeline.value.vaultConfig = body.vaultConfig;
      origInsertsOnly.value = insertsOnly.value;
      origVaultUrl.value = vaultUrl.value;
      origVaultToken.value = vaultToken.value;
      origVaultSecrets.value = JSON.stringify(vaultSecrets.value);
      loadVaultPathKeys();
    }
    saveSuccess.value = true;
    setTimeout(() => saveSuccess.value = false, 3000);
  } catch (e: any) { saveError.value = e.message; }
  saving.value = false;
}
</script>


<template>
<div>
  <div v-if="loading" class="flex items-center justify-center h-64"><Loader2 class="size-6 animate-spin text-muted-foreground" /></div>
  <div v-else-if="!pipeline" class="flex flex-col items-center justify-center h-64 gap-3">
    <p class="text-sm text-muted-foreground">Pipeline not found</p>
    <Button variant="outline" class="gap-1.5 cursor-pointer" @click="router.push('/triggers')"><ArrowLeft class="size-3.5" /> Back</Button>
  </div>
  <div v-else class="flex h-full">
    <!-- Left sidebar: step bubbles -->
    <div class="w-56 shrink-0 border-r p-4 space-y-0">
      <div class="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer" @click="router.push('/triggers')"><ArrowLeft class="size-4" /></Button>
        <p class="text-sm font-semibold truncate">{{ pipeline.name }}</p>
      </div>
      <div v-for="(s, i) in steps" :key="s.key">
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer"
          :class="activeStep === s.key ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'"
          @click="activeStep = s.key"
        >
          <div class="size-8 rounded-full flex items-center justify-center shrink-0" :class="activeStep === s.key ? 'bg-primary/20' : 'bg-muted'">
            <component :is="s.icon" class="size-4" />
          </div>
          <span class="text-xs font-medium">{{ s.label }}</span>
        </button>
        <div v-if="i < steps.length - 1" class="pl-[22px] py-0.5"><div class="w-0.5 h-3 bg-border" /></div>
      </div>
      <Separator class="my-3" />
      <div class="space-y-1">
        <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer" :class="activeStep === 'addons' ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'" @click="activeStep = 'addons'">
          <div class="size-8 rounded-full flex items-center justify-center shrink-0" :class="activeStep === 'addons' ? 'bg-primary/20' : 'bg-muted'"><Plus class="size-4" /></div>
          <span class="text-xs font-medium">Add-ons</span>
        </button>
        <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer" :class="activeStep === 'envvars' ? 'bg-primary/10 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'" @click="activeStep = 'envvars'">
          <div class="size-8 rounded-full flex items-center justify-center shrink-0" :class="activeStep === 'envvars' ? 'bg-primary/20' : 'bg-muted'"><Settings2 class="size-4" /></div>
          <span class="text-xs font-medium">Env Vars</span>
        </button>
      </div>
    </div>

    <!-- Right panel -->
    <div class="flex-1 overflow-y-auto p-6 space-y-4">
      <!-- Header bar -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">{{ activeStep === 'addons' ? 'Add-ons' : activeStep === 'envvars' ? 'Environment Variables' : steps.find(s => s.key === activeStep)?.label }}</h2>
          <p class="text-xs text-muted-foreground">{{ activeStep === 'sns' ? 'View metadata and edit filter policies' : activeStep === 'addons' ? 'Enable and configure pipeline add-ons' : activeStep === 'envvars' ? 'Configure environment variables for the target Lambda' : 'Read-only resource details' }}</p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Heavy load toggle -->
          <div class="flex items-center gap-2">
            <Label class="text-xs text-muted-foreground">Heavy Load</Label>
            <Toggle v-model="heavyLoad" />
          </div>
          <Separator orientation="vertical" class="h-6" />
          <!-- Save -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button :disabled="saving || !hasChanges" class="gap-1.5 cursor-pointer" @click="save">
                <Loader2 v-if="saving" class="size-4 animate-spin" />
                <Save v-else class="size-4" />
                Save
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ hasChanges ? 'Save all changes' : 'No changes to save' }}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <!-- Unsaved changes warning -->
      <div v-if="hasChanges" class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 flex items-center gap-2">
        <AlertTriangle class="size-3.5 shrink-0" />
        You have unsaved changes. Click Save to apply them or they will be lost.
      </div>

      <!-- Save result -->
      <div v-if="saveSuccess" class="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-xs text-green-500 flex items-center gap-2"><Check class="size-3.5 shrink-0" /> Changes saved successfully</div>
      <div v-if="saveError" class="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500 flex items-center gap-2"><AlertTriangle class="size-3.5 shrink-0" /> {{ saveError }}</div>

      <!-- DynamoDB detail -->
      <template v-if="activeStep === 'dynamodb'">
        <Card>
          <CardHeader class="pb-3"><CardTitle class="text-sm flex items-center gap-2"><Database class="size-4" /> Table Details <Badge variant="outline" class="text-[10px]"><Lock class="size-2.5 mr-0.5" /> Read-only</Badge></CardTitle></CardHeader>
          <CardContent v-if="resources.dynamodb" class="space-y-2 text-sm">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span class="text-xs text-muted-foreground">Table Name</span><p class="font-mono text-xs">{{ resources.dynamodb.tableName }}</p></div>
              <div><span class="text-xs text-muted-foreground">Status</span><p class="text-xs"><Badge variant="outline">{{ resources.dynamodb.status }}</Badge></p></div>
              <div><span class="text-xs text-muted-foreground">Item Count</span><p class="font-mono text-xs">{{ resources.dynamodb.itemCount?.toLocaleString() }}</p></div>
              <div><span class="text-xs text-muted-foreground">Size</span><p class="font-mono text-xs">{{ formatBytes(resources.dynamodb.sizeBytes) }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.dynamodb.arn }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">Stream ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.dynamodb.streamArn }}</p></div>
            </div>
            <div v-if="resources.dynamodb.keySchema?.length" class="pt-2">
              <span class="text-xs text-muted-foreground">Key Schema</span>
              <div class="flex gap-2 mt-1">
                <Badge v-for="k in resources.dynamodb.keySchema" :key="k.AttributeName" variant="secondary" class="font-mono text-[10px]">{{ k.AttributeName }} ({{ k.KeyType }})</Badge>
              </div>
            </div>
          </CardContent>
          <CardContent v-else class="text-xs text-muted-foreground">Unable to fetch table details</CardContent>
        </Card>
        <div v-if="resources.dynamodb" class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showSaveSchema = true"><Save class="size-3.5" /> Save Schema</Button>
          <span v-if="schemaSaved" class="text-xs text-green-500">Saved!</span>
        </div>
      </template>

      <!-- Stream Handler detail -->
      <template v-if="activeStep === 'streamHandler'">
        <Card>
          <CardHeader class="pb-3"><CardTitle class="text-sm flex items-center gap-2"><Zap class="size-4" /> Stream Handler <Badge variant="outline" class="text-[10px]"><Lock class="size-2.5 mr-0.5" /> Read-only</Badge></CardTitle></CardHeader>
          <CardContent v-if="resources.streamHandler" class="space-y-2 text-sm">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span class="text-xs text-muted-foreground">Function Name</span><p class="font-mono text-xs">{{ resources.streamHandler.functionName }}</p></div>
              <div><span class="text-xs text-muted-foreground">Runtime</span><p class="text-xs">{{ resources.streamHandler.runtime }}</p></div>
              <div><span class="text-xs text-muted-foreground">Memory</span><p class="text-xs">{{ resources.streamHandler.memorySize }} MB</p></div>
              <div><span class="text-xs text-muted-foreground">Timeout</span><p class="text-xs">{{ resources.streamHandler.timeout }}s</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">Handler</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.streamHandler.handler }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.streamHandler.arn }}</p></div>
            </div>
            <Separator class="my-2" />
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-medium">Inserts only</p>
                <p class="text-[10px] text-muted-foreground">Skip MODIFY and REMOVE events, only process INSERT</p>
              </div>
              <Toggle v-model="insertsOnly" />
            </div>
            <div v-if="!insertsOnly" class="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 mt-2">
              <p class="text-[10px] text-amber-500">The stream handler processes all DynamoDB stream event types (INSERT, MODIFY, REMOVE) by default. Enable "Inserts only" above to filter out updates and deletes.</p>
            </div>
          </CardContent>
          <CardContent v-else class="text-xs text-muted-foreground">Unable to fetch function details</CardContent>
        </Card>
      </template>

      <!-- SNS detail + filter policy editor -->
      <template v-if="activeStep === 'sns'">
        <Card>
          <CardHeader class="pb-3"><CardTitle class="text-sm flex items-center gap-2"><Bell class="size-4" /> Topic Details <Badge variant="outline" class="text-[10px]"><Lock class="size-2.5 mr-0.5" /> Read-only</Badge></CardTitle></CardHeader>
          <CardContent v-if="resources.sns" class="space-y-2 text-sm">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span class="text-xs text-muted-foreground">Topic Name</span><p class="font-mono text-xs">{{ resources.sns.topicName }}</p></div>
              <div><span class="text-xs text-muted-foreground">Subscriptions</span><p class="text-xs">{{ resources.sns.subscriptionsConfirmed ?? ' -' }} confirmed</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.sns.arn }}</p></div>
            </div>
            <div v-if="resources.sns.subscriptions?.length" class="pt-2">
              <span class="text-xs text-muted-foreground">Subscriptions</span>
              <div class="space-y-1 mt-1">
                <div v-for="s in resources.sns.subscriptions" :key="s.subscriptionArn" class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5">
                  <Badge variant="outline" class="text-[9px]">{{ s.protocol }}</Badge>
                  <span class="truncate text-muted-foreground">{{ s.endpoint }}</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardContent v-else class="text-xs text-muted-foreground">Unable to fetch topic details</CardContent>
        </Card>

        <!-- Filter Policy Editor -->
        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm flex items-center gap-2"><ListFilter class="size-4" /> Filter Policy</CardTitle>
              <Toggle v-model="filterEnabled" />
            </div>
            <CardDescription class="text-xs">Filter which messages reach the SQS queue based on attributes or body fields</CardDescription>
          </CardHeader>
          <CardContent v-if="filterEnabled" class="space-y-3">
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
            <p class="text-xs text-muted-foreground">All rules are combined with AND logic.</p>
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
                  <div v-if="['exact-string','prefix','anything-but','anything-but-prefix','suffix','wildcard','exact-number'].includes(r.op)" class="space-y-1.5">
                    <Input v-model="r.chipInput" :placeholder="r.op.startsWith('exact-number') ? 'Type a number and press Enter' : 'Type a value and press Enter'" class="font-mono text-xs h-7 flex-1" :type="r.op === 'exact-number' ? 'number' : 'text'" @keydown.enter.prevent="addChip(r)" />
                    <div v-if="r.values.length" class="flex flex-wrap gap-1">
                      <Badge v-for="(v, vi) in r.values" :key="vi" variant="secondary" class="gap-1 text-xs font-mono">{{ v }}<button class="ml-0.5 hover:text-destructive cursor-pointer" @click="removeChip(r, vi)"><X class="size-2.5" /></button></Badge>
                    </div>
                  </div>
                  <div v-else-if="r.op === 'number-range'" class="flex items-center gap-2 flex-wrap">
                    <Select v-model="r.rangeLow"><SelectTrigger class="h-7 text-xs w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value=">">&gt;</SelectItem><SelectItem value=">=">&gt;=</SelectItem></SelectContent></Select>
                    <Input v-model="r.rangeMin" type="number" placeholder="Min" class="font-mono text-xs h-7 w-28" />
                    <span class="text-xs text-muted-foreground">and</span>
                    <Select v-model="r.rangeHigh"><SelectTrigger class="h-7 text-xs w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="<">&lt;</SelectItem><SelectItem value="<=">&lt;=</SelectItem></SelectContent></Select>
                    <Input v-model="r.rangeMax" type="number" placeholder="Max" class="font-mono text-xs h-7 w-28" />
                  </div>
                  <div v-else-if="r.op === 'exists'" class="flex items-center gap-2">
                    <Select v-model="r.existsVal"><SelectTrigger class="h-7 text-xs w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem :value="true">Exists (true)</SelectItem><SelectItem :value="false">Not exists (false)</SelectItem></SelectContent></Select>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="addFilterRule"><Plus class="size-3.5" /> Add rule</Button>
          </CardContent>
        </Card>
      </template>

      <!-- SQS detail -->
      <template v-if="activeStep === 'sqs'">
        <Card>
          <CardHeader class="pb-3"><CardTitle class="text-sm flex items-center gap-2"><Inbox class="size-4" /> Queue Details <Badge variant="outline" class="text-[10px]"><Lock class="size-2.5 mr-0.5" /> Read-only</Badge></CardTitle></CardHeader>
          <CardContent v-if="resources.sqs" class="space-y-2 text-sm">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span class="text-xs text-muted-foreground">Queue Name</span><p class="font-mono text-xs">{{ resources.sqs.queueName }}</p></div>
              <div><span class="text-xs text-muted-foreground">Visibility Timeout</span><p class="font-mono text-xs">{{ resources.sqs.visibilityTimeout ?? ' -' }}s</p></div>
              <div><span class="text-xs text-muted-foreground">Messages Available</span><p class="font-mono text-xs">{{ resources.sqs.messagesAvailable ?? ' -' }}</p></div>
              <div><span class="text-xs text-muted-foreground">Messages In Flight</span><p class="font-mono text-xs">{{ resources.sqs.messagesInFlight ?? ' -' }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">URL</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.sqs.url }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.sqs.arn }}</p></div>
            </div>
            <div class="pt-2 space-y-1.5">
              <span class="text-xs text-muted-foreground">Connected Resources</span>
              <div class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5"><Bell class="size-3 shrink-0 text-muted-foreground" /> Subscribed to <span class="font-semibold">{{ resources.sqs.subscribedTopic?.name }}</span></div>
              <div class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5"><Zap class="size-3 shrink-0 text-muted-foreground" /> Triggers <span class="font-semibold">{{ resources.sqs.connectedTarget?.name }}</span></div>
              <div v-if="resources.sqs.redrivePolicy" class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5"><Inbox class="size-3 shrink-0 text-muted-foreground" /> DLQ configured</div>
            </div>
          </CardContent>
          <CardContent v-else class="text-xs text-muted-foreground">Unable to fetch queue details</CardContent>
        </Card>
      </template>

      <!-- Target Lambda detail -->
      <template v-if="activeStep === 'target'">
        <Card>
          <CardHeader class="pb-3"><CardTitle class="text-sm flex items-center gap-2"><Zap class="size-4" /> Target Lambda <Badge variant="outline" class="text-[10px]"><Lock class="size-2.5 mr-0.5" /> Read-only</Badge></CardTitle></CardHeader>
          <CardContent v-if="resources.target" class="space-y-2 text-sm">
            <div class="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><span class="text-xs text-muted-foreground">Function Name</span><p class="font-mono text-xs">{{ resources.target.functionName }}</p></div>
              <div><span class="text-xs text-muted-foreground">Runtime</span><p class="text-xs">{{ resources.target.runtime }}</p></div>
              <div><span class="text-xs text-muted-foreground">Memory</span><p class="text-xs">{{ resources.target.memorySize }} MB</p></div>
              <div><span class="text-xs text-muted-foreground">Timeout</span><p class="text-xs">{{ resources.target.timeout }}s</p></div>
              <div><span class="text-xs text-muted-foreground">Env Vars</span><p class="text-xs">{{ resources.target.envVarCount ?? 0 }} configured</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">Handler</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.target.handler }}</p></div>
              <div class="col-span-2"><span class="text-xs text-muted-foreground">ARN</span><p class="font-mono text-[10px] text-muted-foreground break-all">{{ resources.target.arn }}</p></div>
            </div>
            <div class="pt-2 space-y-1.5">
              <span class="text-xs text-muted-foreground">Connected Resources</span>
              <div v-if="pipeline?.type === 'direct-stream'" class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5"><Database class="size-3 shrink-0 text-muted-foreground" /> Triggered by DynamoDB Stream <span class="font-semibold">{{ pipeline.tableName }}</span></div>
              <div v-else-if="resources.target.connectedQueue?.name" class="flex items-center gap-2 text-[10px] font-mono bg-muted/50 rounded-md px-3 py-1.5"><Inbox class="size-3 shrink-0 text-muted-foreground" /> Triggered by <span class="font-semibold">{{ resources.target.connectedQueue.name }}</span></div>
            </div>
          </CardContent>
          <CardContent v-else class="text-xs text-muted-foreground">Unable to fetch function details</CardContent>
        </Card>
        <Card v-if="pipeline?.targetMissing">
          <CardContent class="py-4 space-y-3">
            <div class="flex items-center gap-2 text-amber-500">
              <AlertTriangle class="size-4 shrink-0" />
              <p class="text-sm font-medium">Target Lambda build not found</p>
            </div>
            <p class="text-xs text-muted-foreground">The original build for this pipeline's target Lambda was deleted or is unavailable. Select an available deployment to reconnect the pipeline.</p>
            <p class="text-xs text-amber-500">Selecting a new target will clear all previous execution logs for this pipeline.</p>
            <div class="space-y-1.5 max-h-48 overflow-auto">
              <button v-for="d in availableDeployments" :key="d.functionName" class="w-full text-left px-3 py-2 rounded-md border text-sm flex items-center gap-2 transition-colors hover:border-primary/50 cursor-pointer" :disabled="changingTarget" @click="pendingTarget = d; showTargetWarning = true">
                <Zap class="size-4 text-muted-foreground shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="font-mono text-xs font-semibold truncate">{{ d.functionName }}</p>
                  <p class="text-[10px] text-muted-foreground truncate">{{ d.handler }}</p>
                </div>
              </button>
              <p v-if="!availableDeployments.length" class="text-xs text-muted-foreground text-center py-4">No active deployments available. Build and deploy a Lambda first.</p>
            </div>
          </CardContent>
        </Card>
      </template>

      <!-- Add-ons panel -->
      <template v-if="activeStep === 'addons'">
        <Card class="!py-3">
          <CardContent class="py-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 cursor-pointer" @click="addons.includes('vault') ? vaultExpanded = !vaultExpanded : undefined">
                <div class="size-9 rounded-lg bg-muted flex items-center justify-center"><VaultIcon class="size-4" /></div>
                <div>
                  <p class="text-sm font-medium">Vault</p>
                  <p class="text-xs text-muted-foreground">Create secrets in a Vault instance for the target Lambda</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Badge v-if="addons.includes('vault') && vaultTestResult?.ok" class="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">Connected</Badge>
                <Badge v-if="pipeline?.vaultIncomplete" class="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">Secrets need recreation</Badge>

                <span class="text-xs text-muted-foreground">{{ addons.includes('vault') ? 'Enabled' : 'Disabled' }}</span>
                <Toggle :model-value="addons.includes('vault')" @update:model-value="addons.includes('vault') ? addons = addons.filter(a => a !== 'vault') : addons.push('vault')" />
              </div>
            </div>
            <!-- Collapsible vault config -->
            <div v-if="addons.includes('vault')" class="mt-3">
              <button class="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors" @click="vaultExpanded = !vaultExpanded">
                <ChevronDown class="size-3 transition-transform" :class="vaultExpanded ? '' : '-rotate-90'" />
                {{ vaultExpanded ? 'Hide configuration' : 'Show configuration' }}
              </button>
              <div v-if="vaultExpanded" class="mt-3 space-y-4">
                <!-- Connection -->
                <div class="space-y-3 rounded-lg border p-4">
                  <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
                  <div class="space-y-2">
                    <Label class="text-xs">Vault URL</Label>
                    <div class="flex gap-2">
                      <Input v-model="vaultUrl" placeholder="http://localhost:8200" class="font-mono text-xs flex-1" />
                      <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="shrink-0 text-xs cursor-pointer" @click="vaultUrl = 'http://localhost:8200'">Default</Button></TooltipTrigger><TooltipContent>Set to http://localhost:8200</TooltipContent></Tooltip>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <Label class="text-xs">Root Token</Label>
                      <Tooltip><TooltipTrigger as-child><ShieldAlert class="size-3.5 text-yellow-500 cursor-help" /></TooltipTrigger><TooltipContent class="max-w-[200px] text-center">Only use root tokens in local/test environments.</TooltipContent></Tooltip>
                    </div>
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
                <div class="space-y-3 rounded-lg border p-4">
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Secrets</p>
                    <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="addSecret"><Plus class="size-3" /> Add</Button>
                  </div>
                  <div v-if="!vaultSecrets.length" class="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">No secrets configured. Click "Add" to create one.</div>
                  <div class="space-y-2">
                    <div v-for="(s, i) in vaultSecrets" :key="i" class="space-y-2 p-3 rounded-md border bg-muted/30">
                      <div class="flex items-center gap-2">
                        <Input v-model="s.path" placeholder="dummy/secret" class="font-mono text-xs h-7 flex-1" />
                        <Tooltip v-if="vaultPathKeys[s.path]"><TooltipTrigger as-child><Badge class="bg-green-500/20 text-green-500 border-green-500/40 text-[10px] shrink-0">{{ vaultPathKeys[s.path] }} key{{ vaultPathKeys[s.path] > 1 ? 's' : '' }}</Badge></TooltipTrigger><TooltipContent>{{ vaultPathKeys[s.path] }} key{{ vaultPathKeys[s.path] > 1 ? 's' : '' }} created under this path in Vault</TooltipContent></Tooltip>
                        <Button variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="removeSecret(i)"><X class="size-3" /></Button>
                      </div>
                      <div v-for="(e, j) in s.entries" :key="j" class="flex items-center gap-2">
                        <Input v-model="e.key" placeholder="key" class="font-mono text-xs h-7 flex-1" />
                        <Input v-model="e.value" type="password" placeholder="value" class="font-mono text-xs h-7 flex-1" />
                        <Button v-if="s.entries.length > 1" variant="ghost" size="icon" class="size-6 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="s.entries.splice(j, 1)"><X class="size-2.5" /></Button>
                      </div>
                      <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer w-full" @click="s.entries.push({ key: '', value: '' })"><Plus class="size-3" /> Add field</Button>
                    </div>
                  </div>
                <p class="text-[10px] text-muted-foreground mt-3">Secret paths are saved with the pipeline. Key/value pairs are not stored — they are created in Vault during pipeline execution.</p>

                </div>
              </div>
                <!-- Options -->
                <div class="space-y-3 rounded-lg border p-4">
                  <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</p>
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium">Auto-cleanup</p>
                      <p class="text-xs text-muted-foreground">Delete created secrets after invocation</p>
                    </div>
                    <Toggle v-model="vaultCleanup" />
                  </div>
                </div>

            </div>
          </CardContent>
        </Card>
      </template>

      <!-- Env Vars panel -->
      <template v-if="activeStep === 'envvars'">
        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm flex items-center gap-2"><Settings2 class="size-4" /> Environment Variables <Badge variant="outline" class="text-[10px]">{{ envVars.filter(e => e.key).length }}</Badge></CardTitle>
              <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="addEnvVar"><Plus class="size-3.5" /> Add</Button>
                
              </div>
            </div>
            <CardDescription class="text-xs mt-2">These are applied directly to the target Lambda's configuration — they are NOT pipeline-specific. If other pipelines share the same target Lambda, changes here will affect them too.</CardDescription>
            <div v-if="hasLocalhostEnv" class="flex items-start gap-2 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-1.5 mt-3"><AlertTriangle class="size-3 shrink-0" /> <span>Mouseketool's managed LocalStack runs on its own Docker network, so <code class="font-mono bg-amber-500/10 px-1 rounded text-[10px]">localhost</code> won't resolve to your host machine. Use <code class="font-mono bg-amber-500/10 px-1 rounded text-[10px]">host.docker.internal</code> instead.</span></div>
          </CardHeader>
          <CardContent class="space-y-2">
            <div v-for="(e, i) in envVars" :key="i" class="flex items-center gap-2">
              <Input v-model="e.key" placeholder="KEY" class="font-mono text-xs flex-1" />
              <Input v-model="e.value" placeholder="value" class="font-mono text-xs flex-1" :disabled="e.isNull" :class="e.isNull ? 'opacity-40' : ''" />
              <Tooltip><TooltipTrigger as-child><label class="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer whitespace-nowrap"><input type="checkbox" v-model="e.isNull" class="accent-primary" />Exclude</label></TooltipTrigger><TooltipContent>Exclude this variable from the Lambda configuration</TooltipContent></Tooltip>
              <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive shrink-0 cursor-pointer px-2" @click="removeEnvVar(i)"><X class="size-3" /></Button>
            </div>
            <p v-if="!envVars.length" class="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">No environment variables configured.</p>
            <div v-if="pipeline?.targetMissing" class="flex items-center gap-2 text-xs text-amber-500 py-4 text-center border border-dashed border-amber-500/30 rounded-md justify-center">
              <AlertTriangle class="size-3.5" /> Environment variables will be available after selecting a target Lambda.
            </div>
          </CardContent>
        </Card>
      </template>

    </div>
  </div>



  <!-- Save Schema Dialog -->
  <Dialog v-model:open="showTargetWarning">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Change target Lambda?</DialogTitle>
        <DialogDescription>This will clear all previous execution logs for this pipeline and reconnect it to the selected deployment.</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="cursor-pointer" @click="showTargetWarning = false">Cancel</Button>
        <Button class="cursor-pointer" @click="showTargetWarning = false; if (pendingTarget) changeTarget(pendingTarget)">Confirm</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>


  <Dialog v-model:open="showSaveSchema"><DialogContent class="sm:max-w-md"><DialogHeader><DialogTitle>Save Table Schema</DialogTitle><DialogDescription>Save the schema for <span class="font-mono font-semibold">{{ pipeline?.tableName }}</span>. Optionally include a seed item to insert on restore.</DialogDescription></DialogHeader>
    <div class="space-y-2">
      <Label>Seed Item <span class="text-muted-foreground font-normal">(optional, DynamoDB JSON)</span></Label>
      <textarea v-model="saveSeedJson" placeholder='{"pk": {"S": "example"}, "sk": {"S": "item-1"}}' class="w-full h-32 font-mono text-xs bg-zinc-900 border border-zinc-700 rounded-md p-3 text-zinc-200 outline-none resize-y" />
    </div>
    <DialogFooter><Button variant="outline" class="cursor-pointer active:scale-95 transition-transform" @click="showSaveSchema = false">Cancel</Button><Button class="gap-2 cursor-pointer active:scale-95 transition-transform" @click="saveSchema"><Save class="size-4" /> Save</Button></DialogFooter>
  </DialogContent></Dialog>

</div>

</template>
