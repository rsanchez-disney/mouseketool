<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, provide, inject } from "vue";

const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));
import { VueFlow, useVueFlow } from "@vue-flow/core";
import BatchJobNode from "@/components/BatchJobNode.vue";
import LogViewer from "@/components/LogViewer.vue";
import { MiniMap } from "@vue-flow/minimap";
import { Controls } from "@vue-flow/controls";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Plus, Trash2, Import, Variable, Save, Play, Square, Clock, ChevronRight, HardDrive, KeyRound, FolderOpen, Container, Loader2, Pencil, AlertTriangle, Info, Eye, GitFork, ArrowUpAZAZ, ListOrdered, Check, X, FileText, Skull, Settings2 } from "lucide-vue-next";

// Toast
const toastMsg = ref("");
const toastType = ref<"warning" | "success">("warning");
function showToast(msg: string, type: "warning" | "success" = "warning") { toastMsg.value = msg; toastType.value = type; setTimeout(() => toastMsg.value = "", 3000); }

// Types
interface EnvVar { key: string; value: string }
interface JobNodeConfig {
  id: string; name: string; description?: string; imageName: string;
  command?: string; args: string[]; envVars: EnvVar[];
  timeout: number; position: { x: number; y: number };
}
interface BatchWorkflow {
  id: string; name: string;
  scannedEnvVars: EnvVar[]; commonEnvVars: EnvVar[];
  nodes: JobNodeConfig[]; edges: { source: string; target: string }[];
  createdAt: string; updatedAt: string;
}
interface BatchBuild { id: string; name: string; projectName: string; imageTag: string; services: any[] }

const activeTab = ref("workflow");

// Workflows
const workflows = ref<BatchWorkflow[]>([]);
const selectedWorkflowId = ref("");
const selectedWorkflow = computed(() => workflows.value.find(w => w.id === selectedWorkflowId.value));

async function loadWorkflows() {
  try { workflows.value = await (await fetch("/api/batch-workflows")).json(); } catch {}
  if (workflows.value.length && !selectedWorkflowId.value) selectedWorkflowId.value = workflows.value[0].id;
}

async function createWorkflow() {
  if (!builds.value.length) { showToast("Register at least one batch project first"); return; }
  const r = await fetch("/api/batch-workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "New Workflow" }) });
  const wf = await r.json();
  workflows.value.push(wf);
  selectedWorkflowId.value = wf.id;
}

async function deleteWorkflow() {
  if (!selectedWorkflowId.value) return;
  await fetch(`/api/batch-workflows/${selectedWorkflowId.value}`, { method: "DELETE" });
  workflows.value = workflows.value.filter(w => w.id !== selectedWorkflowId.value);
  selectedWorkflowId.value = workflows.value[0]?.id || "";
}

async function saveWorkflow() {
  if (!selectedWorkflow.value) return;
  const wf = selectedWorkflow.value;
  for (const n of flowNodes.value) {
    const node = wf.nodes.find(nd => nd.id === n.id);
    if (node) node.position = n.position;
  }
  await fetch(`/api/batch-workflows/${wf.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, edges: wf.edges, commonEnvVars: wf.commonEnvVars }),
  });
}

// Batch builds (for image selector)
const builds = ref<BatchBuild[]>([]);
async function loadBuilds() { try { builds.value = await (await fetch("/api/batch-builds")).json(); } catch {} }

// VueFlow
const flowNodes = ref<any[]>([]);
const flowEdges = ref<any[]>([]);

const { onConnect, addEdges } = useVueFlow();
onConnect((params) => {
  addEdges([params]);
  if (selectedWorkflow.value) {
    selectedWorkflow.value.edges.push({ source: params.source, target: params.target });
  }
});

function syncFlowFromWorkflow() {
  const wf = selectedWorkflow.value;
  if (!wf) { flowNodes.value = []; flowEdges.value = []; return; }
  flowNodes.value = wf.nodes.map(n => ({
    id: n.id, type: "batchJob", position: n.position,
    data: { label: n.name, imageName: n.imageName, envCount: n.envVars.length, command: n.command },
  }));
  flowEdges.value = wf.edges.map(e => ({
    id: `e-${e.source}-${e.target}`, source: e.source, target: e.target, animated: true,
  }));
}

watch(selectedWorkflowId, () => syncFlowFromWorkflow());

// Add node
const pickProjectOpen = ref(false);
const pickedProjectTag = ref("");

function addNode(imageTag?: string) {
  if (!selectedWorkflow.value) return;
  const tag = imageTag || "";
  const id = crypto.randomUUID();
  const node: JobNodeConfig = {
    id, name: "New Job", imageName: tag,
    args: [], envVars: [], timeout: 300,
    position: { x: 100 + selectedWorkflow.value.nodes.length * 250, y: 150 },
  };
  selectedWorkflow.value.nodes.push(node);
  flowNodes.value.push({
    id, type: "batchJob", position: node.position,
    data: { label: node.name, imageName: tag, envCount: 0 },
  });
}

function handleAddNode() {
  if (builds.value.length === 1) addNode(builds.value[0].imageTag);
  else { pickedProjectTag.value = ""; pickProjectOpen.value = true; }
}

function confirmPickProject() {
  if (!pickedProjectTag.value) return;
  addNode(pickedProjectTag.value);
  pickProjectOpen.value = false;
}

function removeNode(nodeId: string) {
  if (!selectedWorkflow.value) return;
  selectedWorkflow.value.nodes = selectedWorkflow.value.nodes.filter(n => n.id !== nodeId);
  selectedWorkflow.value.edges = selectedWorkflow.value.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
  flowNodes.value = flowNodes.value.filter(n => n.id !== nodeId);
  flowEdges.value = flowEdges.value.filter(e => e.source !== nodeId && e.target !== nodeId);
}

// Node editing
const editingNode = ref<JobNodeConfig | null>(null);
const editSheet = ref(false);

function openNodeEditor(nodeId: string) {
  if (!selectedWorkflow.value) return;
  editingNode.value = selectedWorkflow.value.nodes.find(n => n.id === nodeId) || null;
  if (editingNode.value) editSheet.value = true;
}
provide("onEditNode", openNodeEditor);
provide("onRemoveNode", removeNode);

function addNodeEnvVar() { editingNode.value?.envVars.push({ key: "", value: "" }); }
function removeNodeEnvVar(i: number) { editingNode.value?.envVars.splice(i, 1); }

function saveNodeEdit() {
  if (!editingNode.value || !selectedWorkflow.value) return;
  const fn = flowNodes.value.find(n => n.id === editingNode.value!.id);
  if (fn) fn.data = { label: editingNode.value.name, imageName: editingNode.value.imageName, envCount: editingNode.value.envVars.length, command: editingNode.value.command };
  editSheet.value = false;
}

// Common env vars
const commonSheet = ref(false);
function addCommonEnvVar() { selectedWorkflow.value?.commonEnvVars.push({ key: "", value: "" }); }
function removeCommonEnvVar(i: number) { selectedWorkflow.value?.commonEnvVars.splice(i, 1); }

// Import
const importBuildId = ref("");
const importing = ref(false);
async function importFromCompose() {
  if (!selectedWorkflow.value || !importBuildId.value) return;
  importing.value = true;
  try {
    const r = await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildId: importBuildId.value }),
    });
    const wf = await r.json();
    const idx = workflows.value.findIndex(w => w.id === wf.id);
    if (idx !== -1) workflows.value[idx] = wf;
    selectedWorkflowId.value = "";
    await nextTick();
    selectedWorkflowId.value = wf.id;
  } catch {}
  importing.value = false;
}
const buildsWithServices = computed(() => builds.value.filter(b => b.services?.length));

// Simple Run
const selectedProjectId = ref("");
const selectedProject = computed(() => builds.value.find(b => b.id === selectedProjectId.value));
const scannedEnvVars = ref<(EnvVar & { source: string })[]>([]);
const simpleEnvVars = ref<EnvVar[]>([]);

// Presets
interface EnvSection { source: string; vars: { key: string; value: string }[]; collapsed: boolean; sort: "default" | "az" | "za"; originalVars: { key: string; value: string }[] }
interface Preset { id: string; name: string; projectId: string; active: boolean; sections: { source: string; vars: { key: string; value: string }[] }[] }
const presets = ref<Preset[]>([]);
const scannedModal = ref(false);
const forkModal = ref(false);
const forkName = ref("");
const presetSections = ref<Record<string, EnvSection[]>>({});
const presetDirty = ref<Record<string, boolean>>({});
const presetCollapsed = ref<Record<string, boolean>>({});

// Grouped scanned env vars by source
const groupedScanned = computed(() => {
  const groups: Record<string, { key: string; value: string }[]> = {};
  for (const ev of scannedEnvVars.value) {
    const src = (ev as any).source || "unknown";
    if (!groups[src]) groups[src] = [];
    groups[src].push({ key: ev.key, value: ev.value });
  }
  return Object.entries(groups).map(([source, vars]) => ({ source, vars }));
});
const scannedCollapsed = ref<Record<string, boolean>>({});
const scannedSort = ref<Record<string, "default" | "az" | "za">>({});

function sortedVars(vars: { key: string; value: string }[], sort: "default" | "az" | "za", original?: { key: string; value: string }[]) {
  if (sort === "default") return original ? [...original] : vars;
  const sorted = [...vars].sort((a, b) => a.key.localeCompare(b.key));
  return sort === "za" ? sorted.reverse() : sorted;
}

function cycleSort(current: "default" | "az" | "za"): "default" | "az" | "za" {
  if (current === "default") return "az";
  if (current === "az") return "za";
  return "default";
}

async function loadPresets() {
  if (!selectedProjectId.value) { presets.value = []; return; }
  try { presets.value = await (await fetch(`/api/batch-builds/${selectedProjectId.value}/presets`)).json(); } catch { presets.value = []; }
  // Build sections for each preset
  for (const p of presets.value) {
    if (!presetSections.value[p.id]) {
      presetSections.value[p.id] = p.sections.map(s => ({ source: s.source, vars: [...s.vars], collapsed: false, sort: "default" as const, originalVars: [...s.vars] }));
    }
    presetDirty.value[p.id] = false;
  }
}

const activePreset = computed(() => presets.value.find(p => p.active));
const totalScannedCount = computed(() => scannedEnvVars.value.length);

function presetTotalCount(presetId: string) {
  const sections = presetSections.value[presetId];
  return sections ? sections.reduce((sum, s) => sum + s.vars.length, 0) : 0;
}

async function forkEnvVars() {
  if (!forkName.value.trim() || !selectedProjectId.value) return;
  const sections = groupedScanned.value.map(g => ({ source: g.source, vars: [...g.vars] }));
  const r = await fetch(`/api/batch-builds/${selectedProjectId.value}/presets`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: forkName.value.trim(), sections }),
  });
  const preset = await r.json();
  presets.value.push(preset);
  presetSections.value[preset.id] = preset.sections.map((s: any) => ({ source: s.source, vars: [...s.vars], collapsed: false, sort: "default" as const, originalVars: [...s.vars] }));
  presetDirty.value[preset.id] = false;
  forkModal.value = false;
  forkName.value = "";
}

async function activatePreset(presetId: string) {
  const isActive = presets.value.find(p => p.id === presetId)?.active;
  await fetch(`/api/batch-builds/${selectedProjectId.value}/presets/${presetId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: !isActive }),
  });
  presets.value.forEach(p => p.active = p.id === presetId ? !isActive : false);
}

async function deletePreset(presetId: string) {
  await fetch(`/api/batch-builds/${selectedProjectId.value}/presets/${presetId}`, { method: "DELETE" });
  presets.value = presets.value.filter(p => p.id !== presetId);
  delete presetSections.value[presetId];
  delete presetDirty.value[presetId];
}

async function savePreset(presetId: string) {
  const sections = presetSections.value[presetId]?.map(s => ({ source: s.source, vars: s.vars }));
  await fetch(`/api/batch-builds/${selectedProjectId.value}/presets/${presetId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections }),
  });
  // Update originals
  for (const s of presetSections.value[presetId]) s.originalVars = [...s.vars];
  presetDirty.value[presetId] = false;
  showToast("Preset saved", "success");
}

function markPresetDirty(presetId: string) { presetDirty.value[presetId] = true; }

function addPresetVar(presetId: string, sectionIdx: number) {
  presetSections.value[presetId][sectionIdx].vars.push({ key: "", value: "" });
  markPresetDirty(presetId);
}

function removePresetVar(presetId: string, sectionIdx: number, varIdx: number) {
  presetSections.value[presetId][sectionIdx].vars.splice(varIdx, 1);
  markPresetDirty(presetId);
}
const simpleRunning = ref(false);
const simpleLogs = ref<{ line: string }[]>([]);
const simpleResult = ref<{ runId?: string; exitCode?: number; duration?: number } | null>(null);
const simpleError = ref("");
const portRemaps = ref<{ service: string; original: string; hostPort: number; newHostPort: number; containerPort: string }[]>([]);
const effectiveConfigOpen = ref(false);
const effectiveConfig = ref("");
const highlightedConfig = computed(() => highlightYaml(effectiveConfig.value));

async function loadEffectiveConfig() {
  if (!selectedProject.value) return;
  effectiveConfigOpen.value = true;
  effectiveConfig.value = "";
  try {
    const r = await fetch(`/api/batch-runs/effective-config?projectPath=${encodeURIComponent(selectedProject.value.projectPath)}&composefile=${encodeURIComponent(selectedCompose.value)}`);
    const data = await r.json();
    effectiveConfig.value = data.content || "No generated config found";
  } catch { effectiveConfig.value = "No generated config found"; }
}
const projectServices = ref<any[]>([]);
const selectedCompose = ref("");
const expandedService = ref("");
const fileViewerOpen = ref(false);
const fileViewerPath = ref("");
const fileViewerContent = ref("");
const fileViewerLoading = ref(false);

function highlightSh(code: string): string {
  return code.split("\n").map(line => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Comment lines — highlight entire line and skip further processing
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) return `<span class="sh-comment">${esc(line)}</span>`;
    // Process non-comment lines token by token
    let result = esc(line);
    // Strings
    result = result.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="sh-string">$1</span>');
    result = result.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
    // Variables (but not inside already-highlighted spans)
    result = result.replace(/(\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span class="sh-var">$1</span>');
    // Keywords at word boundaries
    result = result.replace(/\b(if|then|else|elif|fi|for|do|done|while|until|case|esac|in|function|return|exit|local|export|source|set|unset|shift|break|continue)\b/g, '<span class="sh-keyword">$1</span>');
    // Commands at start of line or after pipe/semicolon
    result = result.replace(/(^|(?<=\| |; |&amp;&amp; ))(echo|cd|ls|cat|grep|sed|awk|find|mkdir|rm|cp|mv|chmod|chown|curl|wget|docker|java|mvn|gradle|npm|node|kill|sleep|wait|test|read|printf|exec|eval|trap|gzip|openssl|awslocal|aws)\b/g, '$1<span class="sh-cmd">$2</span>');
    return result;
  }).join("\n");
}

function highlightYaml(code: string): string {
  return code.split("\n").map(line => {
    const e = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (line.trimStart().startsWith("#")) return '<span class="sh-comment">' + e + '</span>';
    // Highlight strings first (before inserting spans with quotes in attributes)
    let r = e;
    r = r.replace(/("(?:[^"\\]|\\.)*")/g, '\x00STR$1\x00/STR');
    // Keys
    r = r.replace(/^(\s*)(\S+?)(:)/gm, '$1<span class="yaml-key">$2</span>$3');
    // Numbers and booleans
    r = r.replace(/:\s+(\d+)(\s*)$/gm, ': <span class="yaml-num">$1</span>$2');
    r = r.replace(/:\s+(true|false)\s*$/gm, ': <span class="yaml-bool">$1</span>');
    // Restore strings
    r = r.replace(/\x00STR(.*?)\x00\/STR/g, '<span class="sh-string">$1</span>');
    return r;
  }).join("\n");
}

async function viewFile(filePath: string) {
  if (!selectedProjectId.value) return;
  fileViewerPath.value = filePath;
  fileViewerContent.value = "";
  fileViewerLoading.value = true;
  fileViewerOpen.value = true;
  try {
    const r = await fetch(`/api/batch-builds/${selectedProjectId.value}/file?path=${encodeURIComponent(filePath)}`);
    const data = await r.json();
    fileViewerContent.value = data.content || "Empty file";
  } catch { fileViewerContent.value = "Failed to read file"; }
  fileViewerLoading.value = false;
}

const logSection = ref<HTMLElement | null>(null);

const rootCauseLines = computed(() => simpleLogs.value.filter(l => /Caused by[:.]/.test(l.line) || /Exception/.test(l.line) || /Error response from daemon/.test(l.line)).map(l => l.line));

const aiExplaining = ref(false);
const aiExplanation = ref("");
async function explainBatchError() {
  if (!rootCauseLines.value.length) return;
  aiExplaining.value = true; aiExplanation.value = "";
  try {
    const r = await fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: rootCauseLines.value.join("\n"), logs: simpleLogs.value.slice(-30).map(l => l.line), functionName: selectedProject.value?.name, context: "docker-compose batch run" }) });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "No response";
  } catch (e: any) { aiExplanation.value = `Failed: ${e.message}`; }
  finally { aiExplaining.value = false; }
}

async function loadProjectEnvVars() {
  scannedEnvVars.value = [];
  simpleEnvVars.value = [];
  projectServices.value = [];
  if (!selectedProjectId.value) return;
  try { scannedEnvVars.value = await (await fetch(`/api/batch-builds/${selectedProjectId.value}/env-scan?compose=${encodeURIComponent(selectedCompose.value)}`)).json(); } catch {}
  try { projectServices.value = (await (await fetch(`/api/batch-builds/${selectedProjectId.value}/services?compose=${encodeURIComponent(selectedCompose.value)}`)).json()); } catch {}
}

watch(selectedProjectId, async () => { simpleLogs.value = []; simpleResult.value = null; simpleError.value = ""; projectServices.value = []; scannedEnvVars.value = []; simpleEnvVars.value = []; presets.value = []; presetSections.value = {}; presetDirty.value = {}; selectedCompose.value = selectedProject.value?.composeFiles?.[0] || ""; await nextTick(); loadProjectEnvVars(); loadPresets(); });



async function runSimple() {
  if (!selectedProject.value) return;
  simpleRunning.value = true; simpleLogs.value = []; simpleResult.value = null; simpleError.value = ""; portRemaps.value = [];
  await nextTick();
  logSection.value?.scrollIntoView({ behavior: "smooth" });
  try {
    const res = await fetch("/api/batch-runs/simple", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProject.value.id, projectPath: selectedProject.value.projectPath, composefile: selectedCompose.value, envOverrides: activePreset.value ? presetSections.value[activePreset.value.id]?.flatMap(s => s.vars).filter(e => e.key) || [] : [] }),
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
          if (event === "log") { simpleLogs.value.push(data);   }
                  else if (event === "remaps") portRemaps.value = data;
          else if (event === "complete") simpleResult.value = data;
          else if (event === "error") { simpleError.value = data.message || `Exit code: ${data.exitCode}`; simpleResult.value = data; }
        }
      }
    }
  } catch (e: any) { simpleError.value = e.message; }
  simpleRunning.value = false;
}

const tearing = ref(false);
async function teardown() {
  tearing.value = true;
  try {
    await fetch("/api/batch-runs/simple/teardown", { method: "POST" });
    showToast("Containers torn down", "success");
    simpleRunning.value = false;
  } catch { showToast("Teardown failed", "warning"); }
  tearing.value = false;
}

async function stopSimple() {
  await fetch("/api/batch-runs/simple/stop", { method: "POST" });
  simpleRunning.value = false;
  teardown();
}

let watchSource: EventSource | null = null;
let watchReady = false;

onMounted(() => {
  loadWorkflows(); loadBuilds();
  watchSource = new EventSource("/api/batch-builds/watch");
  setTimeout(() => { watchReady = true; }, 1000);
  watchSource.onmessage = (e) => {
    if (!watchReady) return;
    const { projectId } = JSON.parse(e.data);
    if (projectId === selectedProjectId.value) {
      showToast("Updating project data...", "warning");
      loadProjectEnvVars().then(() => showToast("Project data updated", "success"));
    }
  };
});
onUnmounted(() => { watchSource?.close(); });
</script>

<template>
  <div class="space-y-4">
    <Tabs v-model="activeTab">
      <div class="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="workflow" class="cursor-pointer">Workflow</TabsTrigger>
          <TabsTrigger value="simple" class="cursor-pointer">Simple Run</TabsTrigger>
          <TabsTrigger value="runs" class="cursor-pointer">Runs</TabsTrigger>
        </TabsList>
      </div>

      <div v-show="activeTab === 'workflow'" class="mt-4 space-y-4">
        <div class="flex items-center gap-2 flex-wrap">
          <Select v-model="selectedWorkflowId" :disabled="!workflows.length">
            <SelectTrigger class="w-56"><SelectValue placeholder="Select workflow" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="wf in workflows" :key="wf.id" :value="wf.id">{{ wf.name }}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="createWorkflow"><Plus class="size-3.5" /> New</Button>
          <Button v-if="selectedWorkflow" variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="handleAddNode"><Container class="size-3.5" /> Add Job</Button>
          <Button v-if="selectedWorkflow" variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="commonSheet = true">
            <Variable class="size-3.5" /> Common Env Vars
            <Badge v-if="selectedWorkflow.commonEnvVars.length" variant="secondary" class="ml-1 text-[10px]">{{ selectedWorkflow.commonEnvVars.length }}</Badge>
          </Button>
          <div v-if="buildsWithServices.length && selectedWorkflow" class="flex items-center gap-1.5 ml-auto">
            <Select v-model="importBuildId">
              <SelectTrigger class="w-48 h-8 text-xs"><SelectValue placeholder="Import from..." /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="b in buildsWithServices" :key="b.id" :value="b.id">{{ b.projectName }} ({{ b.services.length }} svc)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="!importBuildId || importing" @click="importFromCompose">
              <Loader2 v-if="importing" class="size-3.5 animate-spin" /><Import v-else class="size-3.5" /> Import
            </Button>
          </div>
          <Button v-if="selectedWorkflow" size="sm" class="gap-1.5 cursor-pointer ml-auto" @click="saveWorkflow"><Save class="size-3.5" /> Save</Button>
          <Button v-if="selectedWorkflow" variant="ghost" size="sm" class="gap-1.5 text-red-500 cursor-pointer" @click="deleteWorkflow"><Trash2 class="size-3.5" /> Delete</Button>
        </div>

        <div v-if="selectedWorkflow" class="flex items-center gap-2">
          <Label class="text-xs">Name</Label>
          <Input v-model="selectedWorkflow.name" class="text-sm w-64" />
        </div>

        <div v-if="selectedWorkflow" class="h-[calc(100vh-280px)] min-h-[300px] rounded-lg border overflow-hidden">
          <VueFlow v-model:nodes="flowNodes" v-model:edges="flowEdges" fit-view-on-init class="h-full dot-grid">
            <template #node-batchJob="props">
              <BatchJobNode v-bind="props" />
            </template>
            <MiniMap />
            <Controls />
          </VueFlow>
        </div>

        <div v-else class="h-[calc(100vh-280px)] min-h-[300px] rounded-lg border bg-background flex items-center justify-center">
          <div class="text-center space-y-2">
            <p class="text-sm text-muted-foreground">No workflow selected</p>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="createWorkflow"><Plus class="size-3.5" /> Create Workflow</Button>
          </div>
        </div>
      </div>

      <TabsContent value="simple" class="mt-4 space-y-4">
        <p class="text-xs text-muted-foreground">Run your project's docker-compose file directly from Mouseketool.</p>

        <!-- Project Selector + Run + Scanned Modal -->
        <div class="flex items-center gap-3">
          <Select v-model="selectedProjectId" :disabled="simpleRunning">
            <SelectTrigger class="w-96"><SelectValue placeholder="Select a batch project" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="b in builds" :key="b.id" :value="b.id">{{ b.name }}</SelectItem>
            </SelectContent>
          </Select>
          <Select v-if="selectedProject?.composeFiles?.length > 1" v-model="selectedCompose" :disabled="simpleRunning" @update:model-value="loadProjectEnvVars()">
            <SelectTrigger class="w-56"><SelectValue placeholder="Select compose file" /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cf in selectedProject.composeFiles" :key="cf" :value="cf">{{ cf }}</SelectItem>
            </SelectContent>
          </Select>
          <Tooltip v-if="selectedProject"><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="scannedModal = true"><Eye class="size-3.5" /> Scanned Env Vars <Badge v-if="totalScannedCount" variant="secondary" class="ml-1 text-[10px]">{{ totalScannedCount }}</Badge></Button></TooltipTrigger><TooltipContent>View all env vars detected from compose and .env files</TooltipContent></Tooltip>
          <Button v-if="selectedProject" size="sm" class="gap-1.5 cursor-pointer" :disabled="simpleRunning || !selectedCompose" @click="runSimple">
            <Loader2 v-if="simpleRunning" class="size-3.5 animate-spin" /><Play v-else class="size-3.5" />
            {{ simpleRunning ? "Running..." : "Run" }}
          </Button>
          <Tooltip v-if="simpleRunning || tearing"><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer text-red-500 hover:text-red-400" :disabled="tearing" @click="stopSimple"><Loader2 v-if="tearing" class="size-3.5 animate-spin" /><Square v-else class="size-3.5" /> Stop</Button></TooltipTrigger><TooltipContent>Stop all containers and clean up resources</TooltipContent></Tooltip>
        </div>

        <div v-if="selectedProject" class="space-y-4">
          <div v-if="!selectedProject.composeFiles?.length" class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 flex items-center gap-2">
            <AlertTriangle class="size-4 shrink-0" /> No docker-compose file was detected in this project. Please check that a compose file exists in the project directory.
          </div>

          <!-- Project Info -->
          <div class="rounded-lg border p-3 space-y-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project Info</p>
            <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
              <span class="text-muted-foreground">Path</span>
              <span class="font-mono truncate" :title="selectedProject.projectPath">{{ selectedProject.projectPath }}</span>
              <span class="text-muted-foreground">Dockerfile</span>
              <span class="font-mono">{{ selectedProject.dockerfile }}</span>
              <span class="text-muted-foreground">Compose</span>
              <span class="font-mono">{{ selectedCompose || 'N/A' }}</span>
            </div>
            <div v-if="projectServices.length">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Containers ({{ projectServices.length }})</p>
              <div class="space-y-1.5">
                <div v-for="svc in projectServices" :key="svc.name" class="rounded-md border text-xs">
                  <button class="flex items-center gap-3 w-full px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors" @click="expandedService = expandedService === svc.name ? '' : svc.name">
                    <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="expandedService === svc.name ? 'rotate-90' : ''" />
                    <span class="font-medium">{{ svc.name }}</span>
                    <Badge v-if="svc.image" variant="outline" class="text-[9px] font-mono">{{ svc.image }}</Badge>
                    <Badge v-else-if="svc.build" variant="secondary" class="text-[9px]">build</Badge>
                    <Tooltip v-for="p in (svc.ports || [])" :key="p"><TooltipTrigger as-child><Badge variant="outline" class="text-[9px] font-mono">{{ p }}</Badge></TooltipTrigger><TooltipContent>Port mapping</TooltipContent></Tooltip>
                  </button>
                  <div v-if="expandedService === svc.name" class="px-3 pb-3 space-y-3 border-t pt-3">
                    <div v-if="svc.volumes?.length" class="space-y-1.5">
                      <div class="flex items-center gap-1.5"><HardDrive class="size-3 text-muted-foreground" /><span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Volumes</span></div>
                      <div v-for="v in svc.volumes" :key="v" class="flex items-center gap-2 ml-4">
                        <div class="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[10px] font-mono w-full">
                          <FolderOpen class="size-3 text-muted-foreground shrink-0" />
                          <span class="text-muted-foreground">{{ v.split(':')[0] }}</span>
                          <span class="text-muted-foreground/50 mx-0.5">&rarr;</span>
                          <span>{{ v.split(':').slice(1).join(':') }}</span>
                          <Tooltip v-if="v.split(':')[0].endsWith('.sh')"><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground ml-auto" @click.stop="viewFile(v.split(':')[0])"><FileText class="size-3" /></Button></TooltipTrigger><TooltipContent>View file contents</TooltipContent></Tooltip>
                        </div>
                      </div>
                    </div>
                    <div v-if="svc.envVars?.length" class="space-y-1.5">
                      <div class="flex items-center gap-1.5"><KeyRound class="size-3 text-muted-foreground" /><span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Environment</span></div>
                      <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 ml-4">
                        <template v-for="ev in svc.envVars" :key="ev.key">
                          <Badge variant="secondary" class="text-[9px] font-mono justify-self-start">{{ ev.key }}</Badge>
                          <span class="text-[10px] font-mono text-muted-foreground truncate">{{ ev.value }}</span>
                        </template>
                      </div>
                    </div>
                    <p v-if="!svc.volumes?.length && !svc.envVars?.length" class="text-[10px] text-muted-foreground text-center py-1">No volumes or env vars configured.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Presets Panel -->
          <div class="rounded-lg border p-3 space-y-3">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Environment Presets</p>
              <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer h-7 text-xs" @click="forkModal = true"><GitFork class="size-3" /> Fork Env Vars</Button>
            </div>
            <div class="rounded-md bg-muted/30 border border-muted px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
              <Info class="size-3.5 shrink-0 mt-0.5" />
              <span>By default, the project runs with the env var configuration detected from your compose and .env files (viewable via "Scanned Env Vars"). To customize, click <strong>Fork Env Vars</strong> to create a named preset. <span v-if="!activePreset">No preset is active — using scanned defaults.</span><span v-else>Active preset: <strong>{{ activePreset.name }}</strong></span></span>
            </div>

            <div v-if="!presets.length" class="text-xs text-muted-foreground text-center py-4">No presets yet. Fork the scanned env vars to create one.</div>

            <!-- Preset list -->
            <div v-for="preset in presets" :key="preset.id" class="rounded-lg border">
              <div class="flex items-center gap-2 px-3 py-2">
                <button class="flex items-center gap-2 flex-1 cursor-pointer" @click="presetCollapsed[preset.id] = !presetCollapsed[preset.id]">
                  <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="!presetCollapsed[preset.id] ? 'rotate-90' : ''" />
                  <span class="text-xs font-medium">{{ preset.name }}</span>
                  <Badge variant="secondary" class="text-[10px]">{{ presetTotalCount(preset.id) }}</Badge>
                  <Badge v-if="preset.active" class="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] gap-1"><Check class="size-2.5" />Active</Badge>
                </button>
                <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-7 cursor-pointer" :class="preset.active ? 'text-emerald-500' : 'text-muted-foreground hover:text-foreground'" @click="activatePreset(preset.id)"><Check class="size-3.5" /></Button></TooltipTrigger><TooltipContent>{{ preset.active ? 'Deactivate preset' : 'Activate preset' }}</TooltipContent></Tooltip>
                <Button v-if="presetDirty[preset.id]" variant="outline" size="sm" class="h-7 text-xs gap-1 cursor-pointer" @click="savePreset(preset.id)"><Save class="size-3" /> Save</Button>
                <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-red-500 cursor-pointer" @click="deletePreset(preset.id)"><Trash2 class="size-3.5" /></Button></TooltipTrigger><TooltipContent>Delete preset</TooltipContent></Tooltip>
              </div>
              <div v-if="!presetCollapsed[preset.id] && presetSections[preset.id]" class="px-3 pb-3 space-y-2 border-t pt-3">
                <div class="grid gap-2 items-start" :class="presetSections[preset.id].length > 1 ? 'md:grid-cols-2' : ''">
                  <div v-for="(section, si) in presetSections[preset.id]" :key="section.source" class="rounded-md border">
                    <div class="flex items-center gap-2 px-2.5 py-1.5 bg-muted/30">
                      <button class="flex items-center gap-1.5 flex-1 cursor-pointer" @click="section.collapsed = !section.collapsed">
                        <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="!section.collapsed ? 'rotate-90' : ''" />
                        <span class="text-[11px] font-medium font-mono">{{ section.source }}</span>
                        <Badge variant="secondary" class="text-[9px]">{{ section.vars.length }}</Badge>
                      </button>
                      <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-5 cursor-pointer text-muted-foreground hover:text-foreground" @click="section.sort = cycleSort(section.sort)">
                        <ArrowUpAZ v-if="section.sort === 'az'" class="size-3" /><ArrowDownAZ v-else-if="section.sort === 'za'" class="size-3" /><ListOrdered v-else class="size-3" />
                      </Button></TooltipTrigger><TooltipContent>Sort: {{ section.sort === 'az' ? 'A→Z' : section.sort === 'za' ? 'Z→A' : 'Default' }}</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-5 cursor-pointer text-muted-foreground hover:text-foreground" @click="addPresetVar(preset.id, si)"><Plus class="size-3" /></Button></TooltipTrigger><TooltipContent>Add env var</TooltipContent></Tooltip>
                    </div>
                    <div v-if="!section.collapsed" class="p-2 space-y-1 max-h-72 overflow-y-auto scrollbar-thin">
                      <div v-for="(ev, vi) in sortedVars(section.vars, section.sort, section.originalVars)" :key="vi" class="flex items-center gap-1.5">
                        <Input v-model="ev.key" placeholder="KEY" class="text-[11px] font-mono flex-1 h-7" @input="markPresetDirty(preset.id)" />
                        <Input v-model="ev.value" placeholder="value" class="text-[11px] font-mono flex-1 h-7" @input="markPresetDirty(preset.id)" />
                        <Button variant="ghost" size="icon" class="size-5 shrink-0 cursor-pointer text-muted-foreground hover:text-red-500" @click="removePresetVar(preset.id, si, vi)"><Trash2 class="size-2.5" /></Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Log Console -->
          <div v-if="simpleLogs.length || simpleRunning" ref="logSection" class="space-y-1 min-w-0 overflow-hidden">
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">Output ({{ simpleLogs.length }} lines)</span>
              <Tooltip v-if="activePreset"><TooltipTrigger as-child><Badge variant="outline" class="text-[10px] text-emerald-500 border-emerald-500/30 gap-1"><Settings2 class="size-2.5" /> {{ activePreset.name }}</Badge></TooltipTrigger><TooltipContent>Running with preset "{{ activePreset.name }}"</TooltipContent></Tooltip>
              <Badge v-else variant="outline" class="text-[10px] text-muted-foreground gap-1">scanned defaults</Badge>
              <Tooltip v-if="portRemaps.length"><TooltipTrigger as-child><Badge variant="outline" class="text-[10px] text-amber-500 border-amber-500/30 gap-1">{{ portRemaps.length }} port(s) remapped</Badge></TooltipTrigger><TooltipContent>Some ports were in use and were automatically remapped</TooltipContent></Tooltip>
              <Tooltip v-if="portRemaps.length"><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-6 cursor-pointer text-muted-foreground hover:text-foreground" @click="loadEffectiveConfig"><FileText class="size-3.5" /></Button></TooltipTrigger><TooltipContent>View effective docker-compose config</TooltipContent></Tooltip>
            </div>
            <LogViewer
              :logs="simpleLogs.map(l => l.line)"
              :loading="simpleRunning"
              loading-text="Starting containers..."
              empty-text="Run output will appear here"
              :root-cause-lines="rootCauseLines"
              :kiro-available="kiroAvailable"
              :ai-explaining="aiExplaining"
              :ai-explanation="aiExplanation"
              @explain="explainBatchError"
            >
              <template #after-root-cause-mini>
                <p v-if="kiroAvailable" class="mt-2 text-[10px] text-violet-400/60 italic">Expand log to explain with Kiro</p>
              </template>
            </LogViewer>
            <div v-if="simpleResult && !simpleError" class="flex items-center gap-2 text-sm text-green-500"><Check class="size-4" /> Completed successfully</div>
            <div v-if="simpleError" class="flex items-center gap-2 text-sm text-red-500"><X class="size-4" /> {{ simpleError }}</div>
          </div>
        </div>

        <div v-if="!selectedProject" class="rounded-lg border bg-background py-12 text-center">
          <p class="text-sm text-muted-foreground">Select a batch project to get started.</p>
        </div>
      </TabsContent>

      <TabsContent value="runs" class="mt-4">
        <Card><CardContent class="py-12 text-center text-sm text-muted-foreground">Run history will be available in the next update.</CardContent></Card>
      </TabsContent>
    </Tabs>

    <!-- Node Edit Sheet -->
    <Sheet v-model:open="editSheet">
      <SheetContent class="w-[420px] sm:max-w-[420px] overflow-y-auto overflow-x-hidden p-6">
        <SheetHeader class="mb-0">
          <SheetTitle class="flex items-center gap-2"><Container class="size-4" /> Edit Job Node</SheetTitle>
          <SheetDescription>Configure the execution settings for this batch job.</SheetDescription>
        </SheetHeader>
        <div v-if="editingNode" class="space-y-2">
          <div class="space-y-4 rounded-lg border p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">General</p>
            <div class="space-y-2"><Label class="text-xs">Name</Label><Input v-model="editingNode.name" class="text-sm" /></div>
            <div class="space-y-2"><Label class="text-xs">Description</Label><Input v-model="editingNode.description" class="text-sm" placeholder="Optional" /></div>
          </div>
          <div class="space-y-4 rounded-lg border p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Execution</p>
            <div class="space-y-2 min-w-0">
              <Label class="text-xs">Docker Image</Label>
              <Select v-model="editingNode.imageName">
                <SelectTrigger class="!w-full overflow-hidden"><SelectValue placeholder="Select image" /></SelectTrigger>
                <SelectContent><SelectItem v-for="b in builds" :key="b.id" :value="b.imageTag">{{ b.name }}</SelectItem></SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label class="text-xs flex items-center gap-1">Command Override <Tooltip><TooltipTrigger as-child><Info class="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent class="max-w-[220px]">Overrides the Dockerfile CMD/ENTRYPOINT. Leave empty to use the default. Auto-filled when importing from docker-compose.</TooltipContent></Tooltip></Label>
              <Input v-model="editingNode.command" class="text-sm font-mono" placeholder="e.g. java -cp app.jar com.example.Main" />
            </div>
            <div class="space-y-2"><Label class="text-xs">Timeout (seconds)</Label><Input v-model.number="editingNode.timeout" type="number" class="text-sm w-32" /></div>
          </div>
          <div class="space-y-4 rounded-lg border p-4">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Node-Specific Env Vars</p>
              <Button variant="ghost" size="sm" class="h-6 text-xs cursor-pointer" @click="addNodeEnvVar"><Plus class="size-3 mr-1" /> Add</Button>
            </div>
            <p class="text-[10px] text-muted-foreground">These override common and scanned env vars for this job only.</p>
            <div v-for="(ev, i) in editingNode.envVars" :key="i" class="flex items-center gap-2">
              <Input v-model="ev.key" placeholder="KEY" class="text-xs font-mono flex-1" />
              <Input v-model="ev.value" placeholder="value" class="text-xs font-mono flex-1" />
              <Button variant="ghost" size="icon" class="size-6 shrink-0 cursor-pointer" @click="removeNodeEnvVar(i)"><Trash2 class="size-3" /></Button>
            </div>
            <p v-if="!editingNode.envVars.length" class="text-xs text-muted-foreground text-center py-2">No overrides. This job will use common env vars only.</p>
          </div>
          <div class="flex justify-end"><Button size="sm" class="gap-1.5 cursor-pointer" @click="saveNodeEdit"><Save class="size-3.5" /> Save</Button></div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- Common Env Vars Sheet -->
    <Sheet v-model:open="commonSheet">
      <SheetContent class="w-[420px] sm:max-w-[420px] overflow-y-auto overflow-x-hidden p-6">
        <SheetHeader class="mb-0">
          <SheetTitle class="flex items-center gap-2"><Variable class="size-4" /> Common Environment Variables</SheetTitle>
          <SheetDescription>Shared across all jobs in this workflow. Node-specific vars take precedence on conflicts.</SheetDescription>
        </SheetHeader>
        <div v-if="selectedWorkflow" class="space-y-2">
          <div v-if="selectedWorkflow.scannedEnvVars.length" class="space-y-4 rounded-lg border p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scanned from Project</p>
            <p class="text-[10px] text-muted-foreground">Auto-detected from .env files and config. Read-only.</p>
            <div v-for="ev in selectedWorkflow.scannedEnvVars" :key="ev.key" class="flex items-center gap-2 opacity-60">
              <Input :model-value="ev.key" disabled class="text-xs font-mono flex-1" />
              <Input :model-value="ev.value" disabled class="text-xs font-mono flex-1" />
            </div>
          </div>
          <div class="space-y-4 rounded-lg border p-4">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Common Env Vars</p>
              <Button variant="ghost" size="sm" class="h-6 text-xs cursor-pointer" @click="addCommonEnvVar"><Plus class="size-3 mr-1" /> Add</Button>
            </div>
            <div v-for="(ev, i) in selectedWorkflow.commonEnvVars" :key="i" class="flex items-center gap-2">
              <Input v-model="ev.key" placeholder="KEY" class="text-xs font-mono flex-1" />
              <Input v-model="ev.value" placeholder="value" class="text-xs font-mono flex-1" />
              <Button variant="ghost" size="icon" class="size-6 shrink-0 cursor-pointer" @click="removeCommonEnvVar(i)"><Trash2 class="size-3" /></Button>
            </div>
            <p v-if="!selectedWorkflow.commonEnvVars.length" class="text-xs text-muted-foreground text-center py-2">No common env vars defined yet.</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- Project Picker -->
    <Dialog v-model:open="pickProjectOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader><DialogTitle>Select Batch Project</DialogTitle></DialogHeader>
        <div class="space-y-2 py-2">
          <div v-for="b in builds" :key="b.id" class="flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors" :class="pickedProjectTag === b.imageTag ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'" @click="pickedProjectTag = b.imageTag">
            <Container class="size-4 shrink-0" />
            <div class="min-w-0"><p class="text-sm font-medium">{{ b.name }}</p><p class="text-xs text-muted-foreground font-mono truncate">{{ b.imageTag }}</p></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" class="cursor-pointer" @click="pickProjectOpen = false">Cancel</Button>
          <Button size="sm" class="cursor-pointer" :disabled="!pickedProjectTag" @click="confirmPickProject">Add Job</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Scanned Env Vars Modal -->
    <Dialog v-model:open="scannedModal">
      <DialogContent class="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scanned Environment Variables</DialogTitle>
          <DialogDescription>Auto-detected from your compose file and .env files. These are read-only — fork them to create an editable preset.</DialogDescription>
        </DialogHeader>
        <div class="space-y-2 py-2">
          <div v-for="group in groupedScanned" :key="group.source" class="rounded-md border">
            <button class="flex items-center gap-2 w-full px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors" @click="scannedCollapsed[group.source] = !scannedCollapsed[group.source]">
              <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="!scannedCollapsed[group.source] ? 'rotate-90' : ''" />
              <span class="text-xs font-medium font-mono">{{ group.source }}</span>
              <Badge variant="secondary" class="text-[10px]">{{ group.vars.length }}</Badge>
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-5 ml-auto cursor-pointer text-muted-foreground hover:text-foreground" @click.stop="scannedSort[group.source] = cycleSort(scannedSort[group.source] || 'default')">
                <ArrowUpAZ v-if="scannedSort[group.source] === 'az'" class="size-3" /><ArrowDownAZ v-else-if="scannedSort[group.source] === 'za'" class="size-3" /><ListOrdered v-else class="size-3" />
              </Button></TooltipTrigger><TooltipContent>Sort: {{ (scannedSort[group.source] || 'default') === 'az' ? 'A→Z' : (scannedSort[group.source] || 'default') === 'za' ? 'Z→A' : 'Default' }}</TooltipContent></Tooltip>
            </button>
            <div v-if="!scannedCollapsed[group.source]" class="px-3 pb-3 space-y-1 border-t pt-2">
              <div v-for="ev in sortedVars(group.vars, scannedSort[group.source] || 'default', group.vars)" :key="ev.key" class="flex items-center gap-2">
                <Input :model-value="ev.key" disabled class="text-[11px] font-mono flex-1 h-7" />
                <Input :model-value="ev.value" disabled class="text-[11px] font-mono flex-1 h-7" />
              </div>
            </div>
          </div>
          <p v-if="!groupedScanned.length" class="text-xs text-muted-foreground text-center py-4">No env vars detected.</p>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Fork Env Vars Modal -->
    <Dialog v-model:open="forkModal">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fork Environment Variables</DialogTitle>
          <DialogDescription>Create a named preset from the currently scanned env vars. You can then edit them independently.</DialogDescription>
        </DialogHeader>
        <div class="space-y-2 py-2">
          <Label class="text-xs">Preset Name</Label>
          <Input v-model="forkName" placeholder="e.g. local-debug, staging-test" class="text-sm" @keydown.enter="forkEnvVars" />
        </div>
        <DialogFooter>
          <Button variant="outline" class="cursor-pointer" @click="forkModal = false">Cancel</Button>
          <Button class="cursor-pointer" :disabled="!forkName.trim()" @click="forkEnvVars">Create Preset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>


    <!-- Effective Config Modal -->
    <Dialog v-model:open="effectiveConfigOpen">
      <DialogContent class="sm:max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 text-sm"><FileText class="size-4" /> Effective Docker Compose Config</DialogTitle>
          <DialogDescription>This is the generated compose file Mouseketool used for the run. Port remappings are applied here.</DialogDescription>
        </DialogHeader>
        <div v-if="portRemaps.length" class="rounded-md border p-3 space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port Changes</p>
          <div class="grid gap-1.5">
            <div v-for="r in portRemaps" :key="r.original" class="flex items-center gap-2 text-xs rounded-md bg-muted/30 px-3 py-1.5">
              <Badge variant="secondary" class="font-mono text-[10px]">{{ r.service }}</Badge>
              <div class="flex items-center gap-1.5 font-mono">
                <span class="text-red-500 line-through">{{ r.hostPort }}:{{ r.containerPort }}</span>
                <span class="text-muted-foreground">→</span>
                <span class="text-emerald-500">{{ r.newHostPort }}:{{ r.containerPort }}</span>
              </div>
              <Badge variant="outline" class="text-[9px] text-amber-500 border-amber-500/30">remapped</Badge>
            </div>
          </div>
        </div>
        <div class="flex-1 min-h-0 rounded-md border bg-zinc-100 dark:bg-zinc-950 p-4 overflow-auto scrollbar-thin scrollbar-thumb-zinc-400 dark:scrollbar-thumb-zinc-700">
          <pre class="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre leading-5" v-html="highlightedConfig"></pre>
        </div>
      </DialogContent>
    </Dialog>

    <!-- File Viewer Modal -->
    <Dialog v-model:open="fileViewerOpen">
      <DialogContent class="sm:max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2 font-mono text-sm"><FileText class="size-4" /> {{ fileViewerPath }}</DialogTitle>
        </DialogHeader>
        <ScrollArea class="h-96 rounded-md border bg-zinc-100 dark:bg-zinc-950 p-4">
          <Loader2 v-if="fileViewerLoading" class="size-4 animate-spin text-muted-foreground" />
          <pre v-else class="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-5" v-html="fileViewerPath.endsWith('.sh') ? highlightSh(fileViewerContent) : fileViewerContent"></pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <!-- Toast -->
    <div v-if="toastMsg" :key="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in" :class="toastType === 'warning' ? 'bg-amber-600' : 'bg-green-600'">
      <AlertTriangle v-if="toastType === 'warning'" class="size-4" />{{ toastMsg }}
    </div>
  </div>
</template>

<style>
.sh-comment { color: #a1a1aa; }
.sh-keyword { color: #a855f7; }
.sh-cmd { color: #3b82f6; }
.sh-var { color: #f59e0b; }
.sh-string { color: #22c55e; }
:root:not(.dark) .sh-comment { color: #71717a; }
:root:not(.dark) .sh-keyword { color: #7c3aed; }
:root:not(.dark) .sh-cmd { color: #2563eb; }
:root:not(.dark) .sh-var { color: #d97706; }
:root:not(.dark) .sh-string { color: #16a34a; }
.yaml-key { color: #3b82f6; }
.yaml-num { color: #f59e0b; }
.yaml-bool { color: #a855f7; }
:root:not(.dark) .yaml-key { color: #2563eb; }
:root:not(.dark) .yaml-num { color: #d97706; }
:root:not(.dark) .yaml-bool { color: #7c3aed; }
.vue-flow__handle {
  background: hsl(var(--primary)) !important;
  border-color: hsl(var(--background)) !important;
}
.dot-grid {
  background-image: radial-gradient(circle, #a1a1aa 1px, transparent 1px) !important;
  background-size: 16px 16px !important;
}
:root.dark .dot-grid {
  background-image: radial-gradient(circle, #3f3f46 1px, transparent 1px) !important;
}
.vue-flow__controls {
  background: hsl(var(--muted)) !important;
  border: 1px solid hsl(var(--border)) !important;
  border-radius: 8px !important;
  box-shadow: none !important;
  overflow: hidden;
}
.vue-flow__controls-button {
  background: hsl(var(--muted)) !important;
  border: none !important;
  border-bottom: 1px solid hsl(var(--border)) !important;
  color: hsl(var(--foreground));
}
.vue-flow__controls-button svg { fill: currentColor !important; }
.vue-flow__controls-button svg path { fill: currentColor !important; }
.vue-flow__controls-button:hover { background: hsl(var(--accent)) !important; }
.vue-flow__minimap {
  background: hsl(var(--background)) !important;
  border: 1px solid hsl(var(--border)) !important;
  border-radius: 8px !important;
}
</style>
