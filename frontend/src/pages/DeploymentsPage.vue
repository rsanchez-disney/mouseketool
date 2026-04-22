<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, inject } from "vue";
import { Card, CardContent } from "@/components/ui/card";


onMounted(() => { window.addEventListener("keydown", onKey); window.addEventListener("click", closeDropdowns); });
const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));

onUnmounted(() => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", closeDropdowns); });
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { expandedResult.value = false; return; }
  if (e.ctrlKey && e.key === "Enter" && !invoking.value && selected.value) { e.preventDefault(); invoke(false); }
}
function closeDropdowns() { sampleDropdownOpen.value = false; generateOpen.value = false; }
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import Toggle from "@/components/ui/Toggle.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import {
  Rocket, Play, Clock, Loader2, CheckCircle2, XCircle, Copy, Check, ArrowLeft, ArrowRight,
  Zap, Cpu, Timer, HardDrive, Feather, Diamond, Trash2, ShieldAlert, Plus, X, Plug, Bug, Maximize2, Minimize2, Upload, ArrowDown, Square, RefreshCw, Search, Sparkles, FolderOpen, FileJson, MessageSquare,
} from "lucide-vue-next";
import VaultIcon from "@/components/icons/VaultIcon.vue";
import FolderBrowser from "@/components/FolderBrowser.vue";
import EvaluateModal from "@/components/EvaluateModal.vue";

interface Deployment {
  functionName: string; handler: string; runtime: string;
  projectName: string; buildTime: string; deployedAt: string; status: string;
  buildTool?: string;
  config?: { memorySize: number | null; timeout: number | null; codeSize: number | null };
  lastInvocation?: { statusCode: number; error: boolean; invokedAt: string };
  lastPayload?: any;
  lastInvocationResult?: InvokeResult;
  buildId?: string;
}
interface InvokeResult {
  statusCode?: number; functionError?: string | null; payload: any; logs?: string[]; invokedAt: string;
}

// --- State ---
const deployments = ref<Deployment[]>([]);
const searchQuery = ref("");
const filteredDeployments = computed(() => {
  if (!searchQuery.value) return deployments.value;
  const q = searchQuery.value.toLowerCase();
  return deployments.value.filter(d => d.functionName.toLowerCase().includes(q) || d.handler.toLowerCase().includes(q));
});
const loading = ref(true);
const selected = ref<Deployment | null>(null);
const step = ref<"list" | "addons" | "invoke">("list");

// Invoke state
const payload = ref("{}");
const jsonFileInput = ref<HTMLInputElement | null>(null);

function uploadJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { payload.value = JSON.stringify(JSON.parse(reader.result as string), null, 2); } catch { payload.value = reader.result as string; } };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = "";
}
const deployEnvVars = ref<{ key: string; value: string }[]>([]);
function prettifyPayload() { try { payload.value = JSON.stringify(JSON.parse(payload.value), null, 2); } catch {} }
const savingEnvVars = ref(false);
const envVarsCollapsed = ref(localStorage.getItem("mk:envCollapsed") !== "false");
const invoking = ref(false);
let invokeAbort: AbortController | null = null;
function stopInvoke() { invokeAbort?.abort(); invoking.value = false; invokeAbort = null; invokeError.value = "Stopped by user"; }
const result = ref<InvokeResult | null>(null);
const invokeError = ref("");
const copied = ref(false);
const copyToast = ref("");
const aiExplaining = ref(false);
const aiExplanation = ref("");
const generating = ref(false);
const generateOpen = ref(false);
const sampleDropdownOpen = ref(false);
const showSampleBrowser = ref(false);
async function generatePayload(intent: string) {
  generating.value = true; generateOpen.value = false;
  try {
    const r = await fetch("/api/ai/generate-payload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, functionName: selected.value?.functionName, samplePath: samplePath.value || undefined }) });
    const data = await r.json();
    if (data.payload) { const p = typeof data.payload === "string" ? data.payload : JSON.stringify(data.payload, null, 2); payload.value = p; lastGenerated.value = p; }
    else if (data.error) invokeError.value = "AI: " + data.error;
  } catch (e: any) { invokeError.value = "AI: " + e.message; }
  finally { generating.value = false; evaluated.value = false; }
}
const samplePath = ref("");
async function loadSamplePath() {
const lastGenerated = ref("");
const showEvaluate = ref(false);
const evaluated = ref(false);

  if (!selected.value) return;
  try { const r = await (await fetch(`/api/deployments/${selected.value.functionName}/sample-path`)).json(); samplePath.value = r.samplePath || ""; } catch {}
}
const sampleFiles = ref<string[]>([]);
async function loadSampleFiles() {
  if (!selected.value || !samplePath.value) { sampleFiles.value = []; return; }
  try { sampleFiles.value = await (await fetch(`/api/deployments/${selected.value.functionName}/sample-files`)).json(); } catch { sampleFiles.value = []; }
}
async function loadSampleFile(filename: string) {
  if (!selected.value) return;
  try {
    const r = await (await fetch(`/api/deployments/${selected.value.functionName}/sample-files/${encodeURIComponent(filename)}`)).json();
    if (r.content) { try { payload.value = JSON.stringify(JSON.parse(r.content), null, 2); } catch { payload.value = r.content; } }
  } catch {}
}
async function saveSamplePath() {
  if (!selected.value) return;
  await fetch(`/api/deployments/${selected.value.functionName}/sample-path`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ samplePath: samplePath.value }) });
  await loadSampleFiles();
}
async function explainError() {

  if (!rootCauseLines.value.length) return;
  aiExplaining.value = true; aiExplanation.value = "";
  try {
    const dep = selected.value;
    const r = await fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: rootCauseLines.value.join("\n"), logs: result.value?.logs?.slice(-30), functionName: dep?.functionName, runtime: dep?.runtime, handler: dep?.handler, memoryMB: dep?.config?.memorySize, timeout: dep?.config?.timeout, envVars: deployEnvVars.value.map(e => e.key) }) });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "No response";
  } catch (e: any) { aiExplanation.value = `Failed: ${e.message}`; }
  finally { aiExplaining.value = false; }
}

const expandedResult = ref(false);
const expandedResultInner = ref<HTMLElement | null>(null);
const logSearch = ref("");
const searchOpen = ref(false);

const rootCauseLines = computed(() => {
  if (!result.value?.logs) return [];
  return result.value.logs.filter((l: string) => /Caused by[:.]/.test(l) || /"ThrowableClass"/.test(l));
});

function scrollExpandedResultToBottom() {
  if (expandedResultInner.value) expandedResultInner.value.scrollTop = expandedResultInner.value.scrollHeight;
}


// Vault add-on state
const vaultEnabled = ref(false);
const vaultPanelOpen = ref(false);
const vaultUrl = ref("");
const vaultToken = ref("");
const vaultSecrets = ref<{ path: string; entries: { key: string; value: string }[] }[]>([]);
const vaultCleanup = ref(false);
const vaultTesting = ref(false);
const vaultTestResult = ref<{ ok: boolean; message: string } | null>(null);
const vaultSave = ref(false);

// Delete confirm
const confirmDelete = ref(false);
const pendingDeleteName = ref("");

const stepIndex = computed(() => step.value === "list" ? 0 : step.value === "addons" ? 1 : 2);

// --- Data ---
async function loadDeployments() {
  if (!deployments.value.length) loading.value = true;
  deployments.value = (await fetch("/api/deployments").then(r => r.json())).filter((d: any) => !d.functionName.startsWith("mk-shadow-"));
  loading.value = false;
}

async function openAddons(d: Deployment) {
  selected.value = d;
  result.value = d.lastInvocationResult || null;
  invokeError.value = "";
  payload.value = d.lastPayload ? JSON.stringify(d.lastPayload, null, 2) : "{}";
  step.value = "addons";
  await loadSamplePath();
  await loadVaultConfig();
}

async function goToInvoke() {
  step.value = "invoke";
  await loadEnvVars();
  await loadSamplePath();
  await loadSampleFiles();
}

async function loadEnvVars() {
  if (!selected.value?.functionName) return;
  try {
    const res = await fetch(`/api/deployments/lambda-env/${selected.value.functionName}`);
    deployEnvVars.value = await res.json();
  } catch { deployEnvVars.value = []; }
}

async function saveEnvVars() {
  if (!selected.value?.functionName) return;
  savingEnvVars.value = true;
  await fetch(`/api/deployments/lambda-env/${selected.value.functionName}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envVars: deployEnvVars.value }),
  });
  savingEnvVars.value = false;
}

function backToList() {
  selected.value = null;
  result.value = null;
  invokeError.value = "";
  vaultEnabled.value = false;
  vaultPanelOpen.value = false;
  vaultUrl.value = "";
  vaultToken.value = "";
  vaultSecrets.value = [];
  vaultCleanup.value = false;
  vaultTestResult.value = null;
  step.value = "list";
}

function backToAddons() {
  result.value = null;
  invokeError.value = "";
  step.value = "addons";
}

async function quickInvoke(d: Deployment) {
  selected.value = d;
  payload.value = d.lastPayload ? JSON.stringify(d.lastPayload, null, 2) : "{}";
  if (d.lastInvocationResult) result.value = d.lastInvocationResult;
  else result.value = null;
  invokeError.value = "";
  step.value = "invoke";
  await loadEnvVars();
  await invoke();
  await loadDeployments();
}

const deleting = ref(false);

async function deleteDeployment(functionName: string) {
  deleting.value = true;
  await fetch(`/api/deployments/${functionName}`, { method: "DELETE" });
  await loadDeployments();
  deleting.value = false;
}

// --- Vault ---
async function testVaultConnection() {
  vaultTesting.value = true;
  vaultTestResult.value = null;
  try {
    const res = await fetch("/api/vault/test-connection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value }),
    });
    vaultTestResult.value = await res.json();
  } catch (e: any) { vaultTestResult.value = { ok: false, message: e.message }; }
  vaultTesting.value = false;
}

function addSecret() { vaultSecrets.value.push({ path: "", entries: [{ key: "", value: "" }] }); }
function removeSecret(i: number) { vaultSecrets.value.splice(i, 1); }

const VAULT_STORAGE_KEY = "vault_addon_settings";

async function saveVaultConfig() {
  vaultEnabled.value = true;
  vaultPanelOpen.value = false;
  if (vaultSave.value) {
    const stripped = vaultSecrets.value.map(s => ({ path: s.path, entries: s.entries.map(e => ({ key: e.key, value: "" })) }));
    const data = JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, secrets: stripped, cleanup: vaultCleanup.value });
    localStorage.setItem(VAULT_STORAGE_KEY, data);
  } else {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  }
}
  if (selected.value) fetch(`/api/deployments/${selected.value.functionName}/vault-config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, secrets: vaultSecrets.value, cleanup: vaultCleanup.value }) }).catch(() => {});


async function loadVaultConfig() {
  const stored = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!stored) return;
  const json = stored;
  if (!json) { localStorage.removeItem(VAULT_STORAGE_KEY); return; }
  try {
    const data = JSON.parse(json);
    vaultUrl.value = data.url || "";
    vaultToken.value = data.token || "";
    vaultSecrets.value = data.secrets || [];
    vaultCleanup.value = data.cleanup || false;
    vaultSave.value = true;
    vaultEnabled.value = true;
    const paths = (data.secrets || []).filter((s: any) => s.path).map((s: any) => s.path);
    if (paths.length && data.url && data.token) {
      try {
        const r = await fetch("/api/vault/read-secrets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: data.url, token: data.token, paths }) });
        const hydrated = await r.json();
        for (const h of hydrated) { const s = vaultSecrets.value.find((vs: any) => vs.path === h.path); if (s && h.entries.length) s.entries = h.entries; }
      } catch {}
    }
  } catch { localStorage.removeItem(VAULT_STORAGE_KEY); }
}

// --- Invoke ---
async function invoke(debug = false) {
  if (!selected.value) return;
  // Auto-save env vars before invoking
  await saveEnvVars();
  invoking.value = true;
  result.value = null;
  invokeError.value = "";

  // Setup vault secrets if enabled
  let skippedSecrets: string[] = [];
  if (vaultEnabled.value && vaultSecrets.value.length) {
    try {
      const secretsPayload = vaultSecrets.value.filter(s => s.path).map(s => ({ path: s.path, value: JSON.stringify(Object.fromEntries(s.entries.filter(e => e.key).map(e => [e.key, e.value]))) }));
      if (!secretsPayload.length) {
        invokeError.value = "Vault is enabled but no secrets have valid paths";
        invoking.value = false;
        return;
      }
      const setupRes = await fetch("/api/vault/setup-secrets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, secrets: secretsPayload }),
      });
      if (!setupRes.ok) {
        const err = await setupRes.json().catch(() => ({ error: "Unknown error" }));
        invokeError.value = `Vault setup failed: ${err.error}`;
        invoking.value = false;
        return;
      }
      const setupData = await setupRes.json();
      const failed = setupData.filter((r: any) => !r.created && !r.skipped);
      if (failed.length) {
        invokeError.value = `Vault: failed to create secrets: ${failed.map((r: any) => `${r.path} (${r.error})`).join(", ")}`;
        invoking.value = false;
        return;
      }
      skippedSecrets = setupData.filter((r: any) => r.existed).map((r: any) => r.path);
    } catch (e: any) {
      invokeError.value = `Vault setup failed: ${e.message}`;
      invoking.value = false;
      return;
    }
  }

  try {
    invokeAbort = new AbortController();
    const res = await fetch("/api/deployments/invoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ functionName: selected.value.functionName, payload: JSON.parse(payload.value), debug }),
      signal: invokeAbort.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      invokeError.value = data.error;
    } else {
      // Inject skipped secret warnings into logs
      if (skippedSecrets.length) {
        const warnings = ["", "── Vault Secrets ──", ...skippedSecrets.map(p => `⚠ Skipped (already exists): ${p}`)];
        data.logs = [...(data.logs || []), ...warnings];
      }
      result.value = data;
      // Cache result on the deployment for re-invoke
      if (selected.value) {
        const dep = deployments.value.find(d => d.functionName === selected.value!.functionName);
        if (dep) (dep as any).lastInvocationResult = data;
      }
    }
  } catch (e: any) { invokeError.value = e.message; }

  // Cleanup vault secrets if enabled
  if (vaultEnabled.value && vaultCleanup.value && vaultSecrets.value.length) {
    try {
      await fetch("/api/vault/cleanup-secrets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: vaultUrl.value, token: vaultToken.value, paths: vaultSecrets.value.filter(s => s.path).map(s => s.path) }),
      });
    } catch { /* best effort */ }
  }

  invoking.value = false;
  loadDeployments();
}

function copyResult() {
  navigator.clipboard.writeText(JSON.stringify(result.value?.payload, null, 2) || "");
  copied.value = true;
  copyToast.value = "Copied to clipboard";
  setTimeout(() => { copied.value = false; copyToast.value = ""; }, 2000);
}

import { timeAgo, formatDateTime, formatBytes } from "@/lib/format";
const formatDate = formatDateTime;
function statusStyle(s: string) {
  if (s === "active") return "bg-green-500/20 text-green-500 border-green-500/40";
  if (s === "failed") return "bg-red-500/20 text-red-500 border-red-500/40";
  if (s === "unknown") return "bg-yellow-500/20 text-yellow-500 border-yellow-500/40";
  return "bg-zinc-500/20 text-zinc-400 border-zinc-500/40";
}
function statusTip(s: string) {
  if (s === "active") return "Function exists and is invocable on LocalStack";
  if (s === "failed") return "Function exists but is in a failed state";
  if (s === "unknown") return "Could not reach LocalStack to verify status";
  return "Function was removed from LocalStack";
}

onMounted(() => { loadDeployments(); loadVaultConfig(); });
</script>

<template>
  <div class="space-y-3 overflow-hidden">
    <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">Deployments</h1>
      <p class="text-muted-foreground">Manage and invoke your deployed Lambda functions.</p>
    </div>
    <Button v-if="!loading && deployments.length" variant="outline" size="sm" class="gap-2 cursor-pointer" @click="loadDeployments"><RefreshCw class="size-3.5" /> Refresh</Button>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Loader2 class="size-8 animate-spin" />
      <p class="text-sm">Checking deployment status...</p>
    </div>

    <div v-else-if="!deployments.length" class="text-center py-16 text-muted-foreground">
      <Rocket class="size-12 mx-auto mb-4 opacity-30" />
      <p>No deployments yet. Build and deploy a Lambda from the Builder page.</p>
    </div>

    <div v-else class="relative overflow-hidden">
      <div class="flex transition-transform duration-300 ease-in-out" :style="{ transform: `translateX(-${stepIndex * 100}%)` }">

        <!-- Step 1: List -->
        <div class="min-w-full space-y-3" style="width: 0">
          <div class="relative">
            <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input v-model="searchQuery" placeholder="Filter by function name or handler…" class="pl-9 h-8 text-xs focus-visible:ring-0 shadow-none" />
          </div>
          <Card v-for="d in filteredDeployments" :key="d.functionName" class="!py-3 transition-all hover:border-primary/50">
            <CardContent class="py-3 space-y-2">
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-sm font-semibold truncate">{{ d.functionName }}</span>
                    <Tooltip>
                      <TooltipTrigger as-child><Badge :class="statusStyle(d.status)" class="text-[10px] shrink-0">{{ d.status }}</Badge></TooltipTrigger>
                      <TooltipContent>{{ statusTip(d.status) }}</TooltipContent>
                    </Tooltip>
                    <Badge variant="secondary" class="text-[10px]">{{ d.runtime }}</Badge>
                  </div>
                  <p class="text-xs text-muted-foreground truncate">{{ d.handler }}</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <Button @click="openAddons(d)" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
                    <Play class="size-3.5" /> Invoke
                  </Button>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button @click.stop="quickInvoke(d)" :disabled="!d.lastPayload" variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform">
                        <Zap class="size-3.5" /> Re-invoke
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ d.lastPayload ? 'Re-invoke with last payload' : 'Invoke at least once first' }}</TooltipContent>
                  </Tooltip>
                  <Button @click.stop="pendingDeleteName = d.functionName; confirmDelete = true" variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-destructive cursor-pointer active:scale-95 transition-transform">
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </div>
              <div class="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <Badge v-if="d.buildTool" variant="outline" class="text-[10px] gap-1">
                  <Feather v-if="d.buildTool === 'maven'" class="size-3" /><Diamond v-else class="size-3" />
                  {{ d.buildTool }}
                </Badge>
                <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1"><Clock class="size-3" /> Built {{ timeAgo(d.buildTime) }}</span></TooltipTrigger><TooltipContent>{{ formatDate(d.buildTime) }}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1"><Rocket class="size-3" /> Deployed {{ timeAgo(d.deployedAt) }}</span></TooltipTrigger><TooltipContent>{{ formatDate(d.deployedAt) }}</TooltipContent></Tooltip>
                <template v-if="d.config">
                  <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1"><Cpu class="size-3" /> {{ d.config.memorySize ?? '—' }} MB</span></TooltipTrigger><TooltipContent>Memory allocated</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1"><Timer class="size-3" /> {{ d.config.timeout ?? '—' }}s</span></TooltipTrigger><TooltipContent>Execution timeout</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1"><HardDrive class="size-3" /> {{ formatBytes(d.config.codeSize) }}</span></TooltipTrigger><TooltipContent>Package size</TooltipContent></Tooltip>
                </template>
                <Tooltip v-if="d.lastInvocation">
                  <TooltipTrigger as-child>
                    <span class="flex items-center gap-1">
                      <Badge :class="d.lastInvocation.error ? 'bg-red-500/20 text-red-500 border-red-500/40' : 'bg-green-500/20 text-green-500 border-green-500/40'" class="text-[10px]">{{ d.lastInvocation.statusCode }}</Badge>
                      {{ timeAgo(d.lastInvocation.invokedAt) }}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Last invocation: {{ formatDate(d.lastInvocation.invokedAt) }}</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
          <div v-if="searchQuery && !filteredDeployments.length" class="text-center py-10 text-muted-foreground">
            <Search class="size-8 mx-auto mb-3 opacity-30" />
            <p class="text-sm">No deployments matching "{{ searchQuery }}"</p>
          </div>
        </div>

        <!-- Step 2: Add-on Settings -->
        <div class="min-w-full px-1" style="width: 0">
          <div v-if="selected" class="space-y-4">
            <div class="flex items-center gap-3">
              <Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="backToList"><ArrowLeft class="size-4" /></Button>
              <div class="flex-1">
                <h2 class="text-base font-semibold flex items-center gap-2"><Plug class="size-4" /> Invoke Settings</h2>
                <p class="text-xs text-muted-foreground">{{ selected.functionName }} — configure add-ons and AI settings before invoking</p>
              </div>
            </div>

            <!-- Vault Add-on Card -->
            <Card class="!py-3">
              <CardContent class="py-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="size-9 rounded-lg bg-muted flex items-center justify-center">
                      <VaultIcon class="size-4" />
                    </div>
                    <div>
                      <p class="text-sm font-medium">Vault</p>
                      <p class="text-xs text-muted-foreground">Create secrets in a Vault instance before invocation</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <Badge v-if="vaultEnabled && vaultTestResult?.ok" class="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">Connected</Badge>
                    <span class="text-xs text-muted-foreground">{{ vaultEnabled ? 'Enabled' : 'Disabled' }}</span>
                    <Badge v-if="vaultEnabled && !vaultTestResult?.ok && vaultUrl" class="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">Secrets may need recreation</Badge>

                    <Toggle v-model="vaultEnabled" />
                    <Button @click="vaultPanelOpen = true" :disabled="!vaultEnabled" variant="outline" size="sm" class="gap-1.5 cursor-pointer">
                      Configure
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <!-- AI Sample Path -->
            <Card v-if="kiroAvailable" class="!py-3">
              <CardContent class="py-3">
                <div class="flex items-center gap-3 mb-3">
                  <div class="size-9 rounded-lg bg-muted flex items-center justify-center">
                    <Sparkles class="size-4 text-violet-400" />
                  </div>
                  <div>
                    <p class="text-sm font-medium">AI Payload Generation</p>
                    <p class="text-xs text-muted-foreground">Point Kiro to a folder with sample JSON files and your project source code</p>
                  </div>
                </div>
                <div class="space-y-2">
                  <div class="flex gap-2">
                    <Input v-model="samplePath" placeholder="Paste a path or click Browse..." class="font-mono text-xs h-8 flex-1" @keydown.enter="saveSamplePath" />
                    <Button variant="outline" size="sm" class="shrink-0 gap-1.5 cursor-pointer" @click="showSampleBrowser = true"><Search class="size-3.5" /> Browse</Button>
                    <Button v-if="samplePath" variant="ghost" size="icon" class="size-8 shrink-0 cursor-pointer text-muted-foreground hover:text-destructive" @click="samplePath = ''; saveSamplePath()"><X class="size-3.5" /></Button>

                  </div>
                  <p class="text-[10px] text-muted-foreground">Kiro will read <code class="bg-muted px-1 rounded">.json</code> files as sample payloads and scan the project source for context. Saved per deployment.</p>
                </div>
              </CardContent>
            </Card>

            <div class="flex justify-end">
              <Button @click="goToInvoke" class="gap-1.5 cursor-pointer">
                Continue to Invoke <ArrowRight class="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <!-- Step 3: Invoke -->
        <div class="min-w-full px-1" style="width: 0">
          <div v-if="selected" class="space-y-4">
            <div class="flex items-center gap-3">
              <Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="backToAddons"><ArrowLeft class="size-4" /></Button>
              <div>
                <h2 class="text-base font-semibold flex items-center gap-2"><Play class="size-4" /> {{ selected.functionName }}</h2>
                <p class="text-xs text-muted-foreground">{{ selected.handler }}</p>
              </div>
            </div>

            <!-- Active Add-ons -->
            <div v-if="vaultEnabled" class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium">Active Add-ons:</span>
              <div class="flex items-center gap-1.5 rounded-md border px-2 py-1 bg-muted/50">
                <VaultIcon class="size-3" />
                <span>Vault</span>
                <span v-if="vaultCleanup" class="text-muted-foreground/60">· auto-cleanup</span>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <!-- Env Vars -->
              <div class="lg:col-span-2 space-y-2">
                <div class="flex items-center justify-between cursor-pointer select-none" @click="envVarsCollapsed = !envVarsCollapsed; localStorage.setItem('mk:envCollapsed', String(envVarsCollapsed))">
                  <label class="text-sm font-medium flex items-center gap-2 cursor-pointer">
                    Environment Variables
                    <Badge variant="outline" class="text-[10px]">{{ deployEnvVars.length }}</Badge>
                    <ArrowRight class="size-3 transition-transform" :class="{ 'rotate-90': envVarsCollapsed }" />
                  </label>
                  <div class="flex gap-1" @click.stop>
                    <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="deployEnvVars.push({ key: '', value: '' }); envVarsCollapsed = false"><Plus class="size-3" /> Add</Button>
                    <Button variant="ghost" size="sm" class="h-6 text-xs cursor-pointer" @click="saveEnvVars" :disabled="savingEnvVars">{{ savingEnvVars ? 'Saving...' : 'Save' }}</Button>
                  </div>
                </div>
                <template v-if="!envVarsCollapsed">
                  <div v-if="!deployEnvVars.length" class="text-xs text-muted-foreground py-2 text-center border border-dashed rounded-md">No env vars. Click "Add" or they'll be loaded from the SAM template on first deploy.</div>
                  <div v-else class="max-h-40 overflow-auto space-y-1.5 scrollbar-thin">
                    <div v-for="(env, i) in deployEnvVars" :key="i" class="flex items-center gap-2">
                      <Input v-model="env.key" placeholder="KEY" class="font-mono text-xs h-7 flex-[2]" />
                      <Input v-model="env.value" placeholder="value" class="font-mono text-xs h-7 flex-[3]" :disabled="env.isNull" :class="env.isNull ? 'opacity-40' : ''" />
                      <Tooltip><TooltipTrigger as-child><label class="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer whitespace-nowrap"><input type="checkbox" v-model="env.isNull" class="accent-primary" />Exclude</label></TooltipTrigger><TooltipContent>Exclude this variable from the Lambda configuration</TooltipContent></Tooltip>
                      <Button variant="ghost" size="icon" class="size-7 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer" @click="deployEnvVars.splice(i, 1)">×</Button>
                    </div>
                  </div>
                  <p class="text-[10px] text-muted-foreground">Env vars are applied to the Lambda before each invocation. Saved in the build folder.</p>
                </template>
              </div>

              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium">Payload (JSON)</label>
                  <div class="flex items-center gap-1">
                    <template v-if="!kiroAvailable">
                      <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="jsonFileInput?.click()">
                        <Upload class="size-3" /> Upload
                      </Button>
                    </template>
                    <!-- No samplePath: upload only + hint -->
                    <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="prettifyPayload">{ } Prettify</Button>
                    <template v-if="kiroAvailable && !samplePath">
                      <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="jsonFileInput?.click()">
                        <Upload class="size-3" /> Upload
                      </Button>
                      <Tooltip><TooltipTrigger as-child><span class="inline-flex"><Button variant="ghost" size="sm" class="h-6 text-xs gap-1 text-violet-400/40 cursor-not-allowed" disabled><Sparkles class="size-3" /> Generate</Button></span></TooltipTrigger><TooltipContent>Go back to Invoke Settings and set an AI Sample Path</TooltipContent></Tooltip>
                    </template>
                    <!-- samplePath configured: dropdown + generate -->
                    <template v-else-if="kiroAvailable">
                      <div class="relative">
                      <Button v-if="lastGenerated && !evaluated" variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-muted-foreground hover:text-foreground" @click="showEvaluate = true">
                        <MessageSquare class="size-3" /> Evaluate
                      </Button>

                        <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click.stop="sampleDropdownOpen = !sampleDropdownOpen">
                          <FileJson class="size-3" /> Samples <Badge v-if="sampleFiles.length" variant="secondary" class="text-[9px] ml-0.5">{{ sampleFiles.length }}</Badge>
                        </Button>
                        <div v-if="sampleDropdownOpen" class="absolute right-0 top-7 z-50 w-56 max-h-48 overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
                          <div v-if="!sampleFiles.length" class="px-3 py-2 text-xs text-muted-foreground">No .json files found</div>
                          <button v-for="f in sampleFiles" :key="f" class="w-full text-left px-3 py-1.5 text-xs font-mono rounded-md hover:bg-muted cursor-pointer truncate" @click="loadSampleFile(f); sampleDropdownOpen = false">{{ f }}</button>
                        </div>
                      </div>
                      <div class="relative">
                        <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-violet-400 hover:text-violet-300" :disabled="generating" @click.stop="generateOpen = !generateOpen">
                          <Sparkles v-if="!generating" class="size-3" /><Loader2 v-else class="size-3 animate-spin" /> {{ generating ? 'Generating...' : 'Generate' }}
                        </Button>
                        <div v-if="generateOpen" class="absolute right-0 top-7 z-50 w-48 rounded-lg border bg-popover p-1 shadow-lg">
                          <button v-for="opt in [{v:'success',l:'Successful payload'},{v:'error',l:'Failure payload'}]" :key="opt.v" class="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-muted cursor-pointer" @click="generatePayload(opt.v)">{{ opt.l }}</button>
                        </div>
                      </div>
                    </template>
                  </div>
                  <input ref="jsonFileInput" type="file" accept=".json,application/json" class="hidden" @change="uploadJson" />
                </div>
                <textarea v-model="payload" rows="12" class="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none scrollbar-thin" placeholder='{"Records": [{"body": "..."}]}' />
                <div class="flex gap-2">
                  <Button @click="invoke(false)" :disabled="invoking" class="flex-1 gap-2 cursor-pointer active:scale-[0.98] transition-transform">
                    <Loader2 v-if="invoking" class="size-4 animate-spin" />
                    <Play v-else class="size-4" />
                    {{ invoking ? "Invoking..." : "Invoke" }}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button @click="invoke(true)" :disabled="invoking" variant="outline" class="gap-2 cursor-pointer active:scale-[0.98] transition-transform">
                        <Bug class="size-4" /> Debug
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Invoke with verbose JVM logging to capture more error details</TooltipContent>
                  </Tooltip>
                  <Button variant="destructive" size="icon" class="size-9 cursor-pointer" :disabled="!invoking" @click="stopInvoke"><Square class="size-3.5" /></Button>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium">Result</label>
                  <div class="flex items-center gap-2">
                    <Badge v-if="result && !result.functionError" class="bg-green-500/10 text-green-600 border-green-500/20">{{ result.statusCode }}</Badge>
                    <Badge v-else-if="result?.functionError || invokeError" variant="destructive">Error</Badge>
                  </div>
                </div>
                <div class="bg-zinc-950 text-zinc-300 rounded-lg p-4 h-72 font-mono text-xs leading-relaxed overflow-hidden relative border border-zinc-800">
                  <div class="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                    <div v-if="!result && !invokeError && !invoking" class="h-full flex items-center justify-center text-zinc-600">Invoke a function to see results here</div>
                    <div v-if="invoking" class="h-full flex items-center justify-center gap-2 text-zinc-500"><Loader2 class="size-4 animate-spin" /> Running...</div>
                    <template v-if="invokeError"><div class="text-red-400">{{ invokeError }}</div></template>
                    <template v-if="result">
                        <div v-if="rootCauseLines.length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
                          <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
                          <div v-for="(line, i) in rootCauseLines" :key="'rc'+i" class="text-xs font-mono text-red-300 whitespace-pre leading-relaxed">{{ line.trim() }}</div>
                          <template v-if="kiroAvailable"><div class="mt-2 flex items-center gap-1.5 text-[10px] text-violet-400/70 font-medium"><svg class="size-3 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="khi2" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#khi2)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg> Expand to use Kiro Assistance</div></template>
                        </div>
                      <div v-if="result.functionError" class="text-red-400 mb-2">Function error: {{ result.functionError }}</div>
                      <pre class="whitespace-pre">{{ JSON.stringify(result.payload, null, 2) }}</pre>
                      <div v-if="result.logs?.length" class="mt-3 pt-3 border-t border-zinc-800">
                        <div class="text-zinc-500 mb-1">Lambda Logs:</div>
                        <div v-for="(line, i) in result.logs" :key="i" :class="[
                          line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' :
                          line.startsWith('⚠') ? 'text-yellow-400' :
                          line.includes('──') ? 'text-blue-400 font-semibold mt-2' :
                          'text-zinc-400'
                        ]" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
                      </div>
                      
                      <div class="mt-3 text-zinc-600">Invoked at {{ formatDate(result.invokedAt) }}</div>
                    </template>
                  </div>
                  <Button v-if="result" variant="ghost" size="icon" class="absolute top-2 right-10 size-7 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyResult">
                    <Check v-if="copied" class="size-3.5 text-green-500" /><Copy v-else class="size-3.5" />
                  </Button>
                  <Button v-if="result" variant="ghost" size="icon" class="absolute top-2 right-2 size-7 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expandedResult = true">
                    <Maximize2 class="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

  <EvaluateModal v-if="kiroAvailable" v-model="showEvaluate" :type="'deployment'" :id="selected?.functionName ?? ''" :sample="lastGenerated" @good="evaluated = true" @bad="evaluated = true" />

  <FolderBrowser v-if="kiroAvailable" v-model="showSampleBrowser" title="Select Sample Directory" description="Navigate to the folder containing your JSON sample files and project source." :initial-path="samplePath" scroll-height="280px" @select="(p: string) => { samplePath = p; saveSamplePath(); }" />

    <!-- Vault Configuration Panel -->
  <Sheet v-model:open="vaultPanelOpen">
    <SheetContent class="w-[420px] sm:max-w-[420px] overflow-y-auto p-6">
      <SheetHeader class="mb-4">
        <SheetTitle class="flex items-center gap-2"><VaultIcon class="size-4" /> Vault Configuration</SheetTitle>
        <SheetDescription>Configure secrets to create in your Vault instance before invoking the Lambda.</SheetDescription>
      </SheetHeader>

      <div class="space-y-6">
        <!-- Connection -->
        <div class="space-y-4 rounded-lg border p-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
          <div class="space-y-2">
            <Label>Vault URL</Label>
            <div class="flex gap-2">
              <Input v-model="vaultUrl" placeholder="http://localhost:8200" class="font-mono text-xs flex-1" />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="outline" size="sm" class="shrink-0 text-xs cursor-pointer" @click="vaultUrl = 'http://localhost:8200'">Default</Button>
                </TooltipTrigger>
                <TooltipContent>Set to http://localhost:8200</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <Label>Root Token</Label>
              <Tooltip>
                <TooltipTrigger as-child><ShieldAlert class="size-3.5 text-yellow-500 cursor-help" /></TooltipTrigger>
                <TooltipContent class="max-w-[200px] text-center">Only use root tokens in local/test environments.</TooltipContent>
              </Tooltip>
            </div>
            <Input v-model="vaultToken" type="password" placeholder="hvs.xxxxx" class="font-mono text-xs" />
          </div>
          <Button @click="testVaultConnection" :disabled="!vaultUrl || !vaultToken || vaultTesting" variant="outline" size="sm" class="w-full gap-2 cursor-pointer">
            <Loader2 v-if="vaultTesting" class="size-3.5 animate-spin" />
            <Plug v-else class="size-3.5" />
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
            <Button variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer" @click="addSecret"><Plus class="size-3" /> Add</Button>
          </div>
          <div v-if="!vaultSecrets.length" class="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-md">No secrets configured. Click "Add" to create one.</div>
          <div class="space-y-2 max-h-60 overflow-auto scrollbar-thin">
            <div v-for="(s, i) in vaultSecrets" :key="i" class="space-y-2 p-3 rounded-md border bg-muted/30">
              <div class="flex items-center gap-2">
                <Input v-model="s.path" placeholder="dummy/secret" class="font-mono text-xs h-7 flex-1" />
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
        </div>

        <!-- Options -->
        <div class="space-y-4 rounded-lg border p-4">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</p>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium">Auto-cleanup</p>
              <p class="text-xs text-muted-foreground">Delete created secrets after invocation</p>
            </div>
            <Toggle v-model="vaultCleanup" />
          </div>
        </div>

        <!-- Save settings -->
        <div class="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p class="text-sm font-medium">Remember settings</p>
            <p class="text-xs text-muted-foreground">Stored in this browser. Available across tabs and reloads.</p>
          </div>
          <Toggle v-model="vaultSave" />
        </div>

        <Button @click="saveVaultConfig" class="w-full cursor-pointer" :disabled="!vaultUrl || !vaultToken">
          Save Configuration
        </Button>
      </div>
    </SheetContent>
  </Sheet>
  <ConfirmDialog v-model="confirmDelete" title="Delete deployment?" description="This will remove the deployment and delete the Lambda function from LocalStack." @confirm="deleteDeployment(pendingDeleteName)" />

  <!-- Expanded Result Modal -->
  <Dialog v-model:open="expandedResult">
    <DialogContent class="!max-w-[97vw] w-[97vw] max-h-[90vh] p-0 gap-0 border-zinc-800 bg-zinc-950 shadow-2xl !rounded-lg [&>button]:hidden flex flex-col">
      <DialogTitle class="sr-only">Invocation Result</DialogTitle>
      <DialogDescription class="sr-only">Expanded invocation result</DialogDescription>
      <div class="flex items-center justify-end gap-1 px-3 py-2 shrink-0">
        <div class="mr-auto flex items-center">
          <Button v-if="!searchOpen" variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="searchOpen = true"><Search class="size-3.5" /></Button>
          <div v-else class="relative flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200"><Search class="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" /><input v-model="logSearch" placeholder="Search logs…" class="h-7 w-56 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500" @vue:mounted="(e: any) => e.el.focus()" /><Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-400 hover:text-white shrink-0" @click="searchOpen = false; logSearch = ''"><X class="size-3" /></Button></div>
        </div>
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="scrollExpandedResultToBottom">
          <ArrowDown class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="copyResult">
          <Check v-if="copied" class="size-3.5 text-green-500" /><Copy v-else class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="expandedResult = false">
          <Minimize2 class="size-3.5" />
        </Button>
      </div>
      <div ref="expandedResultInner" class="overflow-auto scrollbar-visible px-4 pb-4 flex-1 min-h-0 text-zinc-300 font-mono text-xs leading-relaxed">
        <template v-if="result">
          <!-- Root Cause Summary -->
          <div v-if="rootCauseLines.length" class="mb-4 rounded-md border border-red-500/20 bg-red-500/5 p-3">
            <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
            <div v-for="(line, i) in rootCauseLines" :key="i" class="text-red-300 whitespace-nowrap">{{ line.trim() }}</div>
            <button v-if="kiroAvailable" @click="explainError" :disabled="aiExplaining" class="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/20 to-purple-500/20 border border-violet-500/40 text-[11px] font-medium text-violet-300 hover:from-violet-500/30 hover:to-purple-500/30 hover:text-violet-200 cursor-pointer disabled:opacity-50 transition-all shadow-[0_0_6px_rgba(139,92,246,0.1)]">
              <svg class="size-3.5 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="ke" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#ke)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg>
              <span v-if="aiExplaining" class="animate-pulse text-violet-400">Asking Kiro...</span>
              <span v-else>Explain with Kiro</span>
            </button>
            <div v-if="kiroAvailable && aiExplanation" class="mt-3 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5 p-3.5 text-xs text-violet-200/90 whitespace-pre-wrap leading-relaxed">
              <div class="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold"><svg class="size-3 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="kh" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#kh)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg> Kiro</div>
              {{ aiExplanation }}
            </div>
          </div>

          <div v-if="result.functionError" class="text-red-400 mb-2 whitespace-nowrap">Function error: {{ result.functionError }}</div>
          <pre class="whitespace-pre">{{ JSON.stringify(result.payload, null, 2) }}</pre>
          <div v-if="result.logs?.length" class="mt-3 pt-3 border-t border-zinc-800">
            <div class="text-zinc-500 mb-1">Lambda Logs:</div>
            <div v-for="(line, i) in result.logs" :key="i" class="text-xs font-mono whitespace-pre leading-relaxed" :class="[
              logSearch && !line.toLowerCase().includes(logSearch.toLowerCase()) ? 'opacity-20' :
              line.includes('ERROR') || line.includes('Exception') || line.includes('Caused by') || line.includes('FunctionError') ? 'text-red-400' :
              line.startsWith('⚠') ? 'text-yellow-400' :
              line.includes('──') ? 'text-blue-400 font-semibold mt-2' :
              'text-zinc-400'
            ]">{{ line }}</div>
            </div>
          </template>
        </div>
    </DialogContent>
  </Dialog>
  <div v-if="deleting" class="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-3 shadow-lg">
    <Loader2 class="size-4 animate-spin" />
    Deleting deployment...
  </div>
  <div v-if="copyToast" :key="copyToast" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white bg-green-600 rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
    <Check class="size-4" />{{ copyToast }}
  </div>
  </div>
</template>
