<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, provide, inject } from "vue";
import { VueFlow, useVueFlow, MarkerType } from "@vue-flow/core";
import BatchJobNode from "@/components/BatchJobNode.vue";
import FolderBrowser from "@/components/FolderBrowser.vue";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRoute } from "vue-router";
import ComposeStudio from "@/components/ComposeStudio.vue";
import { Plus, Trash2, Variable, Save, Container, Server, Loader2, Info, ChevronRight, ChevronDown, ChevronLeft, FolderOpen, Check, ArrowRight, ArrowLeft, FileCode2, FileDown, Import, Play, RotateCcw, Square, X, Code2, CircleAlert, Search } from "lucide-vue-next";

// Toast
const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));
const toastMsg = ref("");
const toastType = ref<"warning" | "success">("warning");
const route = useRoute();
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
  composePath?: string; excludeList?: string[]; auxiliaryServices?: string[];
  type?: 'imported' | 'scratch'; complete?: boolean;
  createdAt: string; updatedAt: string;
}

// Wizard state
const wizardStep = ref(0); // 0 = landing, 1 = name, 2 = source, 3 = configure
const editorMode = ref(false);
const deleteTarget = ref<{ id: string; name: string } | null>(null);
const wizardName = ref("");
const wizardSource = ref<"import" | "scratch" | "">("");
const wizardComposePath = ref("");
const showFileBrowser = ref(false);
const importing = ref(false);

// Compose Studio
const composeStudioMode = ref(false);
const showAuxPanel = ref(false);
const composeYaml = ref("");
const composeStudioRef = ref<InstanceType<typeof ComposeStudio> | null>(null);

const steps = [
  { label: "Name", description: "Name your workflow" },
  { label: "Source", description: "Import or create a compose file" },
  { label: "Configure", description: "Edit your workflow graph" },
];

// Workflows
const workflows = ref<BatchWorkflow[]>([]);
const builds = ref<any[]>([]);
const selectedWorkflowId = ref("");
const wfSearch = ref("");
const wfFilter = ref<"all" | "imported" | "scratch" | "incomplete">("all");
const wfProjectFilter = ref("");
const showProjectDropdown = ref(false);
function closeProjectDropdown(e: MouseEvent) { if (showProjectDropdown.value && !(e.target as HTMLElement)?.closest?.(".project-dropdown")) showProjectDropdown.value = false; }
const filteredWorkflows = computed(() => {
  let list = workflows.value;
  const q = wfSearch.value.toLowerCase().trim();
  if (q) list = list.filter(w => w.name.toLowerCase().includes(q));
  if (wfFilter.value === "imported") list = list.filter(w => w.type === "imported");
  else if (wfFilter.value === "scratch") list = list.filter(w => w.type === "scratch");
  else if (wfFilter.value === "incomplete") list = list.filter(w => w.complete === false);
  if (wfProjectFilter.value) {
    const p = wfProjectFilter.value;
    list = list.filter(w => w.nodes.some(n => n.name === p || n.imageName === p));
  }
  return list;
});
const selectedWorkflow = computed(() => workflows.value.find(w => w.id === selectedWorkflowId.value));

async function loadWorkflows() {
  try { workflows.value = await (await fetch("/api/batch-workflows")).json(); } catch {}
}

function startNewWorkflow() {
  wizardStep.value = 1;
  workflowLogs.value = [];
  openConsoleTabs.value = []; activeConsoleTab.value = "all"; consolePanelCollapsed.value = true;
  editorMode.value = false;
  composeStudioMode.value = false;
    composeYaml.value = ""; // prevent auto-save from overwriting resolved paths
  wizardName.value = "";
  wizardSource.value = "";
  wizardComposePath.value = "";
  selectedWorkflowId.value = "";
}

async function editWorkflow(wf: BatchWorkflow) {
  selectedWorkflowId.value = wf.id;
  workflowLogs.value = [];
  openConsoleTabs.value = []; activeConsoleTab.value = "all"; consolePanelCollapsed.value = true;
  if (wf.type === 'scratch' && !wf.complete) {
    try { const r = await fetch(`/api/batch-workflows/${wf.id}/effective-compose`); const { content } = await r.json(); composeYaml.value = content || ""; } catch { composeYaml.value = ""; }
    composeStudioMode.value = true;
    editorMode.value = true;
    wizardStep.value = 3;
    return;
  }
  wizardStep.value = 3;
  editorMode.value = true;
  composeStudioMode.value = false;
  syncFlowFromWorkflow();
}

async function createAndProceed() {
  if (workflows.value.some(w => w.name.toLowerCase() === wizardName.value.trim().toLowerCase())) { showToast("A workflow with that name already exists", "warning"); return; }
  const r = await fetch("/api/batch-workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: wizardName.value }) });
  const wf = await r.json();
  workflows.value.push(wf);
  selectedWorkflowId.value = wf.id;
  wizardStep.value = 2;
}

async function importCompose() {
  if (!selectedWorkflow.value || !wizardComposePath.value) return;
  importing.value = true;
  try {
    const r = await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/import-file`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: wizardComposePath.value }),
    });
    const wf = await r.json();
    if (!r.ok) { showToast(wf.details || wf.error || "Import failed", "warning"); importing.value = false; return; }
    if (wf.warnings?.length) showToast(wf.warnings.join(". "), "warning");
    const idx = workflows.value.findIndex(w => w.id === wf.id);
    if (idx !== -1) workflows.value[idx] = wf;
    selectedWorkflowId.value = "";
    await nextTick();
    selectedWorkflowId.value = wf.id;
    workflowLogs.value = []; openConsoleTabs.value = []; activeConsoleTab.value = "all"; consolePanelCollapsed.value = true;
    wizardStep.value = 3;
    editorMode.value = true;
    composeStudioMode.value = false;
  } catch { showToast("Import failed", "warning"); }
  importing.value = false;
}

function skipToConfigureEmpty() {
  if (!builds.value.length) { showToast('Register at least one batch project before creating a scratch workflow', 'warning'); return; }
  composeStudioMode.value = true;
  composeYaml.value = "";
  wizardStep.value = 3;
  workflowLogs.value = []; openConsoleTabs.value = []; activeConsoleTab.value = "all"; consolePanelCollapsed.value = true;
}

function confirmDeleteWorkflow() {
  if (!selectedWorkflow.value) return;
  deleteTarget.value = { id: selectedWorkflow.value.id, name: selectedWorkflow.value.name };
}

function confirmDeleteById(wf: any) {
  deleteTarget.value = { id: wf.id, name: wf.name };
}

async function executeDelete() {
  if (!deleteTarget.value) return;
  await fetch(`/api/batch-workflows/${deleteTarget.value.id}`, { method: "DELETE" });
  workflows.value = workflows.value.filter(w => w.id !== deleteTarget.value!.id);
  if (selectedWorkflowId.value === deleteTarget.value.id) { selectedWorkflowId.value = ""; wizardStep.value = 0; editorMode.value = false; }
  deleteTarget.value = null;
  workflowLogs.value = [];
  openConsoleTabs.value = []; activeConsoleTab.value = "all"; consolePanelCollapsed.value = true;
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
  await fetch(`/api/batch-workflows/${wf.id}/save-env`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commonEnvVars: wf.commonEnvVars, nodes: wf.nodes }),
  });
  showToast("Workflow and env vars saved", "success");
  editorMode.value = true;
}

async function switchToCodeMode() {
  if (selectedWorkflow.value?.composePath) {
    try {
      const r = await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/effective-compose`);
      const { content } = await r.json();
      composeYaml.value = content || "";
    } catch { composeYaml.value = ""; }
  }
  composeStudioMode.value = true;
}

async function handleComposeApply(yamlStr: string) {
  if (!selectedWorkflow.value) return;
  if (!yamlStr.trim()) { showToast("The compose file is empty — write or generate a compose first", "warning"); return; }
  try {
    if (!/^services:/m.test(yamlStr)) {
      showToast("The compose file must have a 'services' section", "warning"); return;
    }
  } catch {}
  try {
    const r = await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/import-file`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: yamlStr }),
    });
    const wf = await r.json();
    if (!r.ok) { showToast(wf.details || wf.error || "Apply failed", "warning"); return; }
    const idx = workflows.value.findIndex(w => w.id === wf.id);
    if (idx !== -1) workflows.value[idx] = wf;
    selectedWorkflowId.value = "";
    await nextTick();
    selectedWorkflowId.value = wf.id;
    composeStudioMode.value = false;
    syncFlowFromWorkflow();
    showToast("Applied to canvas", "success");
  } catch { showToast("Apply failed", "warning"); }
}

async function handleGenerateTemplate() {
  composeStudioRef.value?.setLoading(true);
  try {
    const ctx = await (await fetch("/api/batch-builds/context")).json();
    const r = await fetch("/api/ai/compose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", currentYaml: composeYaml.value, context: ctx }),
    });
    if (!r.ok) {
      const names = ctx.projects?.map((p) => p.name).join(", ") || "my services";
      const fallback = `# Available projects: ${names}\nservices:\n  # Add your services here\n`;
      composeYaml.value = fallback;
      composeStudioRef.value?.pushAssistantMessage("Kiro is not available. Here's a starter template.", fallback);
      return;
    }
    const data = await r.json();
    composeStudioRef.value?.pushAssistantMessage(data.explanation || "Generated a compose template.", data.yaml);
    composeYaml.value = data.yaml || "";
  } catch {
    composeStudioRef.value?.pushAssistantMessage("Failed to generate template. Try again later.");
  }
}

async function handleComposeAction(payload: { action: string; serviceName?: string }) {
  composeStudioRef.value?.setLoading(true);
  try {
    const ctx = await (await fetch("/api/batch-builds/context")).json();
    const r = await fetch("/api/ai/compose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: payload.action, serviceName: payload.serviceName, currentYaml: composeYaml.value, context: ctx }),
    });
    if (!r.ok) {
      composeStudioRef.value?.pushAssistantMessage("Kiro is not available. Start Kiro CLI to enable AI features.");
      return;
    }
    const data = await r.json();
    composeStudioRef.value?.pushAssistantMessage(data.explanation || "Done.", data.yaml);
    if (data.yaml) composeYaml.value = data.yaml;
  } catch {
    composeStudioRef.value?.pushAssistantMessage("Request failed. Try again later.");
  }
}

async function downloadCompose() {
  if (!selectedWorkflow.value) return;
  const r = await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/effective-compose`);
  const { content } = await r.json();
  const blob = new Blob([content], { type: "application/x-yaml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${selectedWorkflow.value.name}-compose.yml`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// VueFlow
const flowNodes = ref<any[]>([]);
const flowEdges = ref<any[]>([]);
const { onConnect, addEdges, findNode } = useVueFlow();

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
    id: n.id, type: "batchJob", position: n.position, style: { opacity: 1 },
    data: { label: n.name, imageName: n.imageName, envCount: n.envVars.length, command: n.command },
  }));
  flowEdges.value = wf.edges.map(e => ({
    id: `e-${e.source}-${e.target}`, source: e.source, target: e.target,
    sourceHandle: 'bottom', targetHandle: 'top',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#71717a' },
  }));
}

watch(selectedWorkflowId, () => syncFlowFromWorkflow());

// Add node
function addNode() {
  if (!selectedWorkflow.value) return;
  const id = crypto.randomUUID();
  const node: JobNodeConfig = {
    id, name: "New Job", imageName: "",
    args: [], envVars: [], timeout: 300,
    position: { x: 100 + selectedWorkflow.value.nodes.length * 250, y: 150 },
  };
  selectedWorkflow.value.nodes.push(node);
  flowNodes.value.push({ id, type: "batchJob", position: node.position, style: { opacity: 1 }, data: { label: node.name, imageName: "", envCount: 0 } });
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

// Console panel
const openConsoleTabs = ref<string[]>([]);
const activeConsoleTab = ref("all");
const consolePanelCollapsed = ref(true);
const aiExplaining = ref(false);
const aiExplanation = ref("");

function onOpenConsole(containerName: string) {
  const name = flowNodes.value.find(n => n.id === containerName)?.data.label || containerName;
  if (!openConsoleTabs.value.includes(name)) openConsoleTabs.value.push(name);
  activeConsoleTab.value = name;
  consolePanelCollapsed.value = false;
}
provide("onOpenConsole", onOpenConsole);

const activeTabLogs = computed(() => {
  if (activeConsoleTab.value === "all") return workflowLogs.value;
  return workflowLogs.value.filter(l => l.container === activeConsoleTab.value).map(l => ({ ...l, line: l.line.replace(/^\S+\s+\|\s+/, "") }));
});

const activeTabRootCause = computed(() => {
  if (activeConsoleTab.value === "all") return [];
  return activeTabLogs.value
    .map(l => l.line)
    .filter(l => /Exception|Error|Caused by/i.test(l));
});

async function explainContainerErrors() {
  if (!activeTabRootCause.value.length) return;
  aiExplaining.value = true;
  aiExplanation.value = "";
  try {
    const r = await fetch("/api/ai/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: activeTabRootCause.value.join("\n"), logs: activeTabLogs.value.slice(-30).map(l => l.line), functionName: activeConsoleTab.value, context: "docker-compose workflow run" }),
    });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "Kiro is not available. Start Kiro CLI to enable AI explanations.";
  } catch { aiExplanation.value = "Failed to get explanation."; }
  aiExplaining.value = false;
}

function closeConsoleTab(name: string) {
  openConsoleTabs.value = openConsoleTabs.value.filter(t => t !== name);
  if (activeConsoleTab.value === name) activeConsoleTab.value = openConsoleTabs.value[0] || "all";
}

// Workflow execution
const workflowRunning = ref(false);
const workflowLogSection = ref<HTMLElement | null>(null);
const workflowStopping = ref(false);
const workflowLogs = ref<{ line: string; container?: string }[]>([]);
const portRemaps = ref<any[]>([]);
const selectedNodeContainer = ref("");
const filteredLogs = computed(() => selectedNodeContainer.value ? workflowLogs.value.filter(l => l.container === selectedNodeContainer.value) : workflowLogs.value);

async function runWorkflow() {
  if (!selectedWorkflow.value?.composePath) return;
  workflowRunning.value = true; workflowLogs.value = []; portRemaps.value = []; selectedNodeContainer.value = "";
  consolePanelCollapsed.value = false; activeConsoleTab.value = "all";
  await nextTick();
  workflowLogSection.value?.scrollIntoView({ behavior: "smooth" });
  for (const n of flowNodes.value) n.data = { ...n.data, status: "idle" };
  try {
    const res = await fetch("/api/batch-runs/workflow", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: selectedWorkflow.value.id, composePath: (selectedWorkflow.value as any).composePath, originalProjectPath: (selectedWorkflow.value as any).originalComposePath ? (selectedWorkflow.value as any).originalComposePath.replace(/[/\\][^/\\]+$/, '') : undefined }),
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
          if (event === "log") workflowLogs.value.push(data);
          else if (event === "status") {
            const match = flowNodes.value.find(n => n.data.label === data.container || data.container?.endsWith(n.data.label) || data.container?.includes(n.data.label));
            if (match) {
              const vfNode = findNode(match.id);
              if (vfNode) vfNode.data = { ...vfNode.data, status: data.status };
            }
          }
          else if (event === "remaps") portRemaps.value = data;
          else if (event === "complete") showToast("Workflow completed", "success");
          else if (event === "error") showToast(data.message || "Workflow failed", "warning");
        }
      }
    }
  } catch (e: any) { showToast(e.message, "warning"); }
  workflowRunning.value = false;
}

async function stopWorkflow() {
  workflowStopping.value = true;
  showToast("Stopping workflow...", "warning");
  try { await fetch("/api/batch-runs/workflow/stop", { method: "POST" }); } catch { showToast("Stop failed", "warning"); workflowStopping.value = false; return; }
  workflowRunning.value = false;
  workflowStopping.value = false;
  showToast("Workflow stopped", "success");
}

function onNodeClick(nodeId: string) {
  if (!workflowRunning.value && !workflowLogs.value.length) return openNodeEditor(nodeId);
  const fn = flowNodes.value.find(n => n.id === nodeId);
  if (fn) selectedNodeContainer.value = selectedNodeContainer.value === fn.data.label ? "" : fn.data.label;
}

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

const savingCommon = ref(false);
async function saveCommonEnvVars() {
  if (!selectedWorkflow.value) return;
  savingCommon.value = true;
  try {
    await fetch(`/api/batch-workflows/${selectedWorkflow.value.id}/save-env`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commonEnvVars: selectedWorkflow.value.commonEnvVars }),
    });
    showToast("Common env vars saved", "success");
  } catch { showToast("Save failed", "warning"); }
  savingCommon.value = false;
}

onMounted(async () => {
  await loadWorkflows();
  try { builds.value = await (await fetch('/api/batch-builds')).json(); } catch {}
  const qid = route.query.workflowId as string;
  if (qid) {
    const wf = workflows.value.find(w => w.id === qid);
    if (wf) { selectedWorkflowId.value = wf.id; wizardStep.value = 3; editorMode.value = true; syncFlowFromWorkflow(); }
  }
});
</script>


<template>
  <div class="space-y-4" @click="closeProjectDropdown">
    <!-- Stepper (visible during wizard) -->
    <div v-if="wizardStep >= 1 && !editorMode" class="flex items-center gap-2 mb-2">
      <button class="text-xs text-muted-foreground hover:text-foreground cursor-pointer" @click="wizardStep = 0">Workflows</button>
      <template v-for="(step, i) in steps" :key="i">
        <ChevronRight class="size-3 text-muted-foreground" />
        <button class="flex items-center gap-1.5 text-xs cursor-pointer" :class="wizardStep === i + 1 ? 'text-foreground font-medium' : wizardStep > i + 1 ? 'text-emerald-500' : 'text-muted-foreground'" @click="wizardStep > i + 1 ? wizardStep = i + 1 : undefined">
          <div class="size-5 rounded-full flex items-center justify-center text-[10px] font-bold border" :class="wizardStep === i + 1 ? 'border-primary bg-primary text-primary-foreground' : wizardStep > i + 1 ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-muted-foreground/30'">
            <Check v-if="wizardStep > i + 1" class="size-3" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          {{ step.label }}
        </button>
      </template>
    </div>

    <!-- Step 0: Landing — Workflow List -->
    <div v-if="wizardStep === 0" class="max-w-3xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Workflows</h2>
          <p class="text-xs text-muted-foreground">Visual docker-compose orchestration with dependency graphs.</p>
        </div>
        <Button size="sm" class="gap-1.5 cursor-pointer" @click="startNewWorkflow"><Plus class="size-3.5" /> New Workflow</Button>
      </div>
      <!-- Search & Filters -->
      <div class="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <div class="relative">
          <Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input v-model="wfSearch" placeholder="Search..." class="h-7 w-36 rounded-md bg-background border pl-8 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div class="h-4 w-px bg-border" />
        <div class="flex items-center gap-1.5">
          <button v-for="f in [{v:'all',l:'All'},{v:'imported',l:'Imported'},{v:'scratch',l:'Scratch'},{v:'incomplete',l:'Incomplete'}]" :key="f.v" @click="wfFilter = f.v" class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer" :class="wfFilter === f.v ? 'bg-foreground/10 text-foreground ring-1 ring-foreground/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
            {{ f.l }}
          </button>
        </div>
        <div v-if="builds.length" class="h-4 w-px bg-border" />
        <div v-if="builds.length" class="relative project-dropdown">
          <button @click="showProjectDropdown = !showProjectDropdown" class="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1" :class="wfProjectFilter ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40' : 'text-muted-foreground hover:text-foreground hover:bg-muted'">
            <Container class="size-3" /> {{ wfProjectFilter || 'Project' }}
            <ChevronDown class="size-3" />
          </button>
          <div v-if="showProjectDropdown" class="absolute top-full left-0 mt-1 z-20 w-52 rounded-lg border bg-background shadow-lg py-1 max-h-48 overflow-y-auto">
            <button class="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted cursor-pointer transition-colors" :class="!wfProjectFilter ? 'text-foreground font-medium' : 'text-muted-foreground'" @click="wfProjectFilter = ''; showProjectDropdown = false">All projects</button>
            <button v-for="b in builds" :key="b.name" class="w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted cursor-pointer transition-colors truncate" :class="wfProjectFilter === b.name ? 'text-emerald-400 font-medium' : 'text-muted-foreground'" @click="wfProjectFilter = b.name; showProjectDropdown = false">{{ b.name }}</button>
          </div>
        </div>
        <span class="ml-auto text-[11px] text-muted-foreground font-mono tabular-nums">{{ filteredWorkflows.length }}<span class="text-muted-foreground/40">/{{ workflows.length }}</span></span>
      </div>
      <div v-if="filteredWorkflows.length" class="space-y-2">
        <button v-for="wf in filteredWorkflows" :key="wf.id" class="w-full flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors text-left" @click="editWorkflow(wf)">
          <Container class="size-4 shrink-0 text-muted-foreground" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium">{{ wf.name }}</p>
            <div class="flex items-center gap-3 mt-0.5">
              <span class="text-xs text-muted-foreground">{{ wf.nodes.length }} node(s)</span>
              <span class="text-xs text-muted-foreground">{{ wf.edges.length }} edge(s)</span>
              <Badge v-if="wf.type === 'imported'" variant="secondary" class="text-[9px]">Imported</Badge>
              <Badge v-if="wf.type === 'scratch'" variant="outline" class="text-[9px]">Scratch</Badge>
              <Badge v-if="wf.complete === false" variant="destructive" class="text-[9px] gap-0.5"><CircleAlert class="size-2.5" /> Incomplete</Badge>
            </div>
          </div>
          <ChevronRight class="size-4 text-muted-foreground" />
          <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-7 text-muted-foreground hover:text-red-500 cursor-pointer shrink-0" @click.stop="confirmDeleteById(wf)"><Trash2 class="size-3.5" /></Button></TooltipTrigger><TooltipContent>Delete workflow</TooltipContent></Tooltip>
        </button>
      </div>
      <div v-else-if="!filteredWorkflows.length && workflows.length" class="rounded-lg border bg-background py-6 text-center">
        <p class="text-sm text-muted-foreground">No workflows match your filters.</p>
      </div>
      <div v-else class="rounded-lg border bg-background py-12 text-center">
        <p class="text-sm text-muted-foreground mb-3">No workflows yet.</p>
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="startNewWorkflow"><Plus class="size-3.5" /> Create your first workflow</Button>
      </div>
    </div>

    <!-- Step 1: Name -->
    <div v-if="wizardStep === 1" class="max-w-md mx-auto space-y-6 pt-8">
      <div class="text-center space-y-1">
        <h2 class="text-lg font-semibold">Name your workflow</h2>
        <p class="text-xs text-muted-foreground">Choose a descriptive name for this workflow.</p>
      </div>
      <div class="space-y-2">
        <Label class="text-xs">Workflow Name</Label>
        <Input v-model="wizardName" placeholder="e.g. contract-submission-pipeline" class="text-sm" autofocus @keydown.enter="wizardName.trim() && createAndProceed()" />
      </div>
      <div class="flex justify-end">
        <Button size="sm" class="gap-1.5 cursor-pointer" :disabled="!wizardName.trim()" @click="createAndProceed">Next <ArrowRight class="size-3.5" /></Button>
      </div>
    </div>

    <!-- Step 2: Source -->
    <div v-if="wizardStep === 2" class="max-w-xl mx-auto space-y-6 pt-8">
      <div class="text-center space-y-1">
        <h2 class="text-lg font-semibold">How do you want to start?</h2>
        <p class="text-xs text-muted-foreground">Import an existing docker-compose file or start with an empty canvas.</p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <button class="rounded-lg border p-4 text-left cursor-pointer transition-colors hover:bg-muted/50" :class="wizardSource === 'import' ? 'border-primary bg-primary/5' : ''" @click="wizardSource = 'import'">
          <Import class="size-5 mb-2 text-primary" />
          <p class="text-sm font-medium">Import compose file</p>
          <p class="text-xs text-muted-foreground mt-1">Browse your filesystem and select a docker-compose file. Mouseketool will detect batch jobs and dependencies.</p>
        </button>
        <Tooltip :disabled="kiroAvailable">
          <TooltipTrigger as-child>
            <button class="rounded-lg border p-4 text-left transition-colors" :class="!kiroAvailable ? 'opacity-50 cursor-not-allowed' : wizardSource === 'scratch' ? 'border-primary bg-primary/5 cursor-pointer' : 'cursor-pointer hover:bg-muted/50'" :disabled="!kiroAvailable" @click="kiroAvailable && (wizardSource = 'scratch')">
              <FileCode2 class="size-5 mb-2 text-primary" />
              <p class="text-sm font-medium">Start from scratch <Tooltip><TooltipTrigger as-child><span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30 cursor-help">Beta</span></TooltipTrigger><TooltipContent>This feature uses AI and may produce inaccurate results</TooltipContent></Tooltip></p>
              <p class="text-xs text-muted-foreground mt-1">Use Compose Studio with AI to build your compose file.</p>
            </button>
          </TooltipTrigger>
          <TooltipContent>Kiro AI is not available. Start Kiro CLI to enable this feature.</TooltipContent>
        </Tooltip>
      </div>

      <!-- Import flow -->
      <div v-if="wizardSource === 'import'" class="space-y-3">
        <div class="flex items-center gap-2">
          <Input v-model="wizardComposePath" placeholder="Path to docker-compose file" class="text-sm font-mono flex-1" readonly />
          <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer shrink-0" @click="showFileBrowser = true"><FolderOpen class="size-3.5" /> Browse</Button>
        </div>
        <div v-if="wizardComposePath" class="rounded-md bg-muted/30 border border-muted px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
          <Info class="size-3.5 shrink-0 mt-0.5" />
          <span>Mouseketool will parse this file, identify batch job containers (excluding common auxiliary services like localstack, vault, redis, etc.), and create a visual dependency graph.</span>
        </div>
      </div>

      <div class="flex justify-between">
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="wizardStep = 1"><ChevronLeft class="size-3.5" /> Back</Button>
        <Button v-if="wizardSource === 'import'" size="sm" class="gap-1.5 cursor-pointer" :disabled="!wizardComposePath || importing" @click="importCompose">
          <Loader2 v-if="importing" class="size-3.5 animate-spin" /><ArrowRight v-else class="size-3.5" /> Import &amp; Configure
        </Button>
        <Button v-else-if="wizardSource === 'scratch'" size="sm" class="gap-1.5 cursor-pointer" @click="skipToConfigureEmpty">Next <ArrowRight class="size-3.5" /></Button>
      </div>
    </div>

    <!-- Compose Studio Mode -->
    <div v-if="wizardStep === 3 && composeStudioMode && selectedWorkflow" class="space-y-0" style="height: calc(100vh - 140px)">
      <ComposeStudio
        ref="composeStudioRef"
        v-model="composeYaml"
        :builds="builds"
        :workflow-id="selectedWorkflow?.id"
        @apply="handleComposeApply"
        @action="handleComposeAction"
      />
    </div>

        <!-- Step 3: Configure (VueFlow) -->
    <div v-if="wizardStep === 3 && !composeStudioMode && selectedWorkflow" class="space-y-4">
      <!-- Editor toolbar -->
      <div v-if="editorMode" class="flex items-center gap-2 flex-wrap">
        <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="editorMode = false; wizardStep = 0"><ArrowLeft class="size-4" /></Button></TooltipTrigger><TooltipContent>Back to workflows</TooltipContent></Tooltip>
        <span class="text-lg font-semibold">{{ selectedWorkflow.name }}</span>
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="workflowRunning" @click="addNode"><Container class="size-3.5" /> Add Job</Button>
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="workflowRunning" @click="commonSheet = true">
          <Variable class="size-3.5" /> Common Env Vars
          <Badge v-if="selectedWorkflow.commonEnvVars.length" variant="secondary" class="ml-1 text-[10px]">{{ selectedWorkflow.commonEnvVars.length }}</Badge>
        </Button>
        <div class="ml-auto flex items-center gap-1.5">
          <Button size="sm" class="gap-1.5 cursor-pointer" :disabled="workflowRunning || !selectedWorkflow?.composePath" @click="runWorkflow"><Loader2 v-if="workflowRunning" class="size-3.5 animate-spin" /><RotateCcw v-else-if="workflowLogs.length" class="size-3.5" /><Play v-else class="size-3.5" /> {{ workflowRunning ? "Running..." : workflowLogs.length ? "Re-run" : "Run" }}</Button>
          <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer text-red-500 hover:text-red-400" :disabled="!workflowRunning || workflowStopping" @click="stopWorkflow"><Loader2 v-if="workflowStopping" class="size-3.5 animate-spin" /><Square v-else class="size-3.5" /> Stop</Button></TooltipTrigger><TooltipContent>Stop all containers and clean up</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="workflowRunning || !selectedWorkflow?.composePath" @click="downloadCompose"><FileDown class="size-3.5" /> Download Compose</Button></TooltipTrigger><TooltipContent>Download the effective docker-compose file used for execution</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="workflowRunning" @click="switchToCodeMode()"><Code2 class="size-3.5" /> Code</Button></TooltipTrigger><TooltipContent>Switch to YAML editor with AI assistant</TooltipContent></Tooltip>
          <Button variant="ghost" size="sm" class="gap-1.5 text-red-500 cursor-pointer" :disabled="workflowRunning" @click="confirmDeleteWorkflow"><Trash2 class="size-3.5" /> Delete</Button>
        </div>
      </div>
      <!-- Wizard toolbar -->
      <div v-else class="flex items-center gap-2 flex-wrap">
        <Input v-model="selectedWorkflow.name" class="text-sm w-64" />
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="addNode"><Container class="size-3.5" /> Add Job</Button>
        <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="commonSheet = true">
          <Variable class="size-3.5" /> Common Env Vars
          <Badge v-if="selectedWorkflow.commonEnvVars.length" variant="secondary" class="ml-1 text-[10px]">{{ selectedWorkflow.commonEnvVars.length }}</Badge>
        </Button>
        <div class="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" class="gap-1.5 text-red-500 cursor-pointer" @click="confirmDeleteWorkflow"><Trash2 class="size-3.5" /> Delete</Button>
        </div>
      </div>

      <div :class="workflowLogs.length || workflowRunning ? 'h-[calc(100vh-420px)] min-h-[200px]' : 'h-[calc(100vh-220px)] min-h-[300px]'" class="rounded-lg border overflow-hidden">
        <VueFlow v-model:nodes="flowNodes" v-model:edges="flowEdges" fit-view-on-init class="h-full dot-grid" @node-click="({ node }) => onNodeClick(node.id)">
          <template #node-batchJob="props"><BatchJobNode v-bind="props" /></template>
          <MiniMap />
          <Controls />
          <!-- Auxiliary Services Panel -->
          <div v-if="selectedWorkflow?.auxiliaryServices?.length" class="absolute top-2 right-2 z-10">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer bg-background/90 backdrop-blur-sm shadow-sm" @click="showAuxPanel = !showAuxPanel">
                  <Server class="size-3.5" /> Infrastructure
                  <Badge variant="secondary" class="ml-0.5 text-[10px]">{{ selectedWorkflow.auxiliaryServices.length }}</Badge>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show auxiliary/infrastructure services</TooltipContent>
            </Tooltip>
            <div v-if="showAuxPanel" class="mt-1.5 w-64 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-2 space-y-1 max-h-48 overflow-y-auto">
              <p class="text-[10px] font-medium text-muted-foreground px-2 py-1">Infrastructure services (not shown on canvas)</p>
              <div v-for="svc in selectedWorkflow.auxiliaryServices" :key="typeof svc === 'string' ? svc : svc.name" class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 text-xs">
                <Server class="size-3.5 text-muted-foreground shrink-0" />
                <div class="min-w-0">
                  <p class="font-medium truncate">{{ typeof svc === 'string' ? svc : svc.name }}</p>
                  <p v-if="typeof svc !== 'string' && svc.image" class="text-[10px] text-muted-foreground truncate">{{ svc.image }}</p>
                </div>
              </div>
            </div>
          </div>
          <svg class="absolute" width="0" height="0">
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" class="fill-zinc-500" />
              </marker>
            </defs>
          </svg>
        </VueFlow>
      </div>
      <!-- Console Panel -->
      <div v-if="workflowLogs.length || workflowRunning" ref="workflowLogSection" class="space-y-0 rounded-lg border overflow-hidden">
        <button class="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted/80 transition-colors cursor-pointer" @click="consolePanelCollapsed = !consolePanelCollapsed">
          <component :is="consolePanelCollapsed ? ChevronRight : ChevronDown" class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium">Consoles</span>
          <Badge variant="secondary" class="text-[10px]">{{ openConsoleTabs.length + 1 }}</Badge>
        </button>
        <div v-if="!consolePanelCollapsed">
          <div class="flex items-center gap-0.5 px-2 py-1 border-t bg-background overflow-x-auto">
            <button class="flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer whitespace-nowrap" :class="activeConsoleTab === 'all' ? 'bg-muted font-medium' : 'hover:bg-muted/50 text-muted-foreground'" @click="activeConsoleTab = 'all'">All</button>
            <button v-for="tab in openConsoleTabs" :key="tab" class="flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer whitespace-nowrap" :class="activeConsoleTab === tab ? 'bg-muted font-medium' : 'hover:bg-muted/50 text-muted-foreground'" @click="activeConsoleTab = tab">
              {{ tab }}
              <X class="size-3 hover:text-red-500" @click.stop="closeConsoleTab(tab)" />
            </button>
          </div>
          <div class="border-t">
            <LogViewer v-if="activeConsoleTab === 'all'" :logs="workflowLogs.map(l => l.line)" :loading="workflowRunning" loading-text="Starting workflow..." empty-text="Workflow output will appear here" />
            <LogViewer v-else :logs="activeTabLogs.map(l => l.line)" :loading="workflowRunning" loading-text="Starting workflow..." empty-text="No output for this container yet" :root-cause-lines="activeTabRootCause" :kiro-available="kiroAvailable" :ai-explaining="aiExplaining" :ai-explanation="aiExplanation" @explain="explainContainerErrors" />
          </div>
        </div>
      </div>
    </div>

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
            <div class="space-y-2">
              <Label class="text-xs">Docker Image</Label>
              <Input v-model="editingNode.imageName" class="text-sm font-mono" placeholder="e.g. my-batch:latest" />
            </div>
            <div class="space-y-2">
              <Label class="text-xs flex items-center gap-1">Command Override <Tooltip><TooltipTrigger as-child><Info class="size-3 text-muted-foreground cursor-help" /></TooltipTrigger><TooltipContent class="max-w-[220px]">Overrides the Dockerfile CMD/ENTRYPOINT.</TooltipContent></Tooltip></Label>
              <Input v-model="editingNode.command" class="text-sm font-mono" placeholder="e.g. java -cp app.jar com.example.Main" />
            </div>
            <div class="space-y-2"><Label class="text-xs">Timeout (seconds)</Label><Input v-model.number="editingNode.timeout" type="number" class="text-sm w-32" /></div>
          </div>
          <div class="space-y-4 rounded-lg border p-4">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Node-Specific Env Vars</p>
              <Button variant="ghost" size="sm" class="h-6 text-xs cursor-pointer" @click="addNodeEnvVar"><Plus class="size-3 mr-1" /> Add</Button>
            </div>
            <div v-for="(ev, i) in editingNode.envVars" :key="i" class="flex items-center gap-2">
              <Input v-model="ev.key" placeholder="KEY" class="text-xs font-mono flex-1" />
              <Input v-model="ev.value" placeholder="value" class="text-xs font-mono flex-1" />
              <Button variant="ghost" size="icon" class="size-6 shrink-0 cursor-pointer" @click="removeNodeEnvVar(i)"><Trash2 class="size-3" /></Button>
            </div>
            <p v-if="!editingNode.envVars.length" class="text-xs text-muted-foreground text-center py-2">No overrides.</p>
          </div>
          <div class="flex justify-end"><Button size="sm" class="gap-1.5 cursor-pointer" @click="saveNodeEdit"><Save class="size-3.5" /> Save</Button></div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- Common Env Vars Sheet -->
    <Sheet v-model:open="commonSheet">
      <SheetContent class="w-[560px] sm:max-w-[560px] overflow-y-auto overflow-x-hidden p-6">
        <SheetHeader class="mb-0">
          <SheetTitle class="flex items-center gap-2"><Variable class="size-4" /> Common Environment Variables</SheetTitle>
          <SheetDescription>Shared across all jobs. Node-specific vars take precedence.</SheetDescription>
        </SheetHeader>
        <div v-if="selectedWorkflow" class="space-y-2">
          <Tooltip v-if="(selectedWorkflow as any).originalComposePath"><TooltipTrigger as-child><Badge variant="outline" class="text-[10px] gap-1 cursor-default"><Info class="size-3" /> Imported</Badge></TooltipTrigger><TooltipContent class="max-w-[400px] font-mono text-[10px]">{{ (selectedWorkflow as any).originalComposePath }}</TooltipContent></Tooltip>
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
          <div class="flex justify-end"><Button size="sm" class="gap-1.5 cursor-pointer" :disabled="savingCommon" @click="saveCommonEnvVars"><Loader2 v-if="savingCommon" class="size-3.5 animate-spin" /><Save v-else class="size-3.5" /> Save</Button></div>
        </div>
      </SheetContent>
    </Sheet>

    <!-- File Browser -->
    <FolderBrowser v-model="showFileBrowser" title="Select Docker Compose File" description="Navigate to your compose file." mode="file" :file-filter="'\\.ya?ml$'" @select="p => wizardComposePath = p" />

    <!-- Delete Confirmation -->
    <Dialog :open="!!deleteTarget" @update:open="v => { if (!v) deleteTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Workflow</DialogTitle>
          <DialogDescription>Are you sure you want to delete "{{ deleteTarget?.name }}"? This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" class="cursor-pointer" @click="deleteTarget = null">Cancel</Button>
          <Button variant="destructive" class="cursor-pointer" @click="executeDelete">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Toast -->
    <div v-if="toastMsg" :key="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300" :class="toastType === 'warning' ? 'bg-amber-600' : 'bg-green-600'">
      {{ toastMsg }}
    </div>
  </div>
</template>

<style>
.vue-flow__handle { background: hsl(var(--primary)) !important; border-color: hsl(var(--background)) !important; }
.vue-flow__handle.target { width: 8px !important; height: 8px !important; min-width: 0 !important; min-height: 0 !important; opacity: 0.5 !important; }
.vue-flow__handle.source { width: 8px !important; height: 8px !important; }
.vue-flow__node, .vue-flow__node * { opacity: 1 !important; }
.vue-flow__node.selected, .vue-flow__node:focus { outline: none !important; box-shadow: none !important; }
.dot-grid { background-image: radial-gradient(circle, #a1a1aa 1px, transparent 1px) !important; background-size: 16px 16px !important; }
:root.dark .dot-grid { background-image: radial-gradient(circle, #3f3f46 1px, transparent 1px) !important; }
.vue-flow__controls { background: hsl(var(--muted)) !important; border: 1px solid hsl(var(--border)) !important; border-radius: 8px !important; box-shadow: none !important; overflow: hidden; }
.vue-flow__controls-button { background: hsl(var(--muted)) !important; border: none !important; border-bottom: 1px solid hsl(var(--border)) !important; color: hsl(var(--foreground)); }
.vue-flow__controls-button svg { fill: currentColor !important; }
.vue-flow__controls-button svg path { fill: currentColor !important; }
.vue-flow__controls-button:hover { background: hsl(var(--accent)) !important; }
.vue-flow__minimap { background: hsl(var(--background)) !important; border: 1px solid hsl(var(--border)) !important; border-radius: 8px !important; }

.vue-flow__edge-path { stroke: #71717a !important; stroke-width: 2 !important; stroke-dasharray: 8 4 !important; animation: dash-flow 0.6s linear infinite !important; transition: stroke 0.2s; }
.vue-flow__edge:hover .vue-flow__edge-path { stroke: #a1a1aa !important; }
@keyframes dash-flow { to { stroke-dashoffset: -12; } }
</style>
