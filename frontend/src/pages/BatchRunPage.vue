<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, inject } from "vue";
import { useRoute, useRouter } from "vue-router";
import LogViewer from "@/components/LogViewer.vue";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Save, Play, Square, ChevronRight, ChevronLeft, HardDrive, KeyRound, FolderOpen, Container, Loader2, AlertTriangle, Info, Eye, GitFork, ArrowUpAZ, ArrowDownAZ, ListOrdered, Check, X, FileText, Settings2 } from "lucide-vue-next";

const kiroAvailable = inject<import("vue").Ref<boolean>>("kiroAvailable", ref(false));
const route = useRoute();
const router = useRouter();

// Toast
const toastMsg = ref("");
const toastType = ref<"warning" | "success">("warning");
function showToast(msg: string, type: "warning" | "success" = "warning") { toastMsg.value = msg; toastType.value = type; setTimeout(() => toastMsg.value = "", 3000); }

// Types
interface EnvVar { key: string; value: string }
interface EnvSection { source: string; vars: EnvVar[]; collapsed: boolean; sort: "default" | "az" | "za"; originalVars: EnvVar[] }
interface Preset { id: string; name: string; projectId: string; active: boolean; sections: { source: string; vars: EnvVar[] }[] }

// Project
const project = ref<any>(null);
const selectedCompose = ref("");
const loading = ref(true);

async function loadProject() {
  loading.value = true;
  try {
    const projects = await (await fetch("/api/batch-builds")).json();
    project.value = projects.find((p: any) => p.id === route.params.id);
    if (project.value) selectedCompose.value = project.value.composeFiles?.[0] || project.value.composefile || "";
  } catch {}
  loading.value = false;
}

// Env vars
const scannedEnvVars = ref<(EnvVar & { source: string })[]>([]);
const projectServices = ref<any[]>([]);

async function loadProjectEnvVars() {
  scannedEnvVars.value = []; projectServices.value = [];
  if (!project.value) return;
  try { scannedEnvVars.value = await (await fetch(`/api/batch-builds/${project.value.id}/env-scan?compose=${encodeURIComponent(selectedCompose.value)}`)).json(); } catch {}
  try { projectServices.value = await (await fetch(`/api/batch-builds/${project.value.id}/services?compose=${encodeURIComponent(selectedCompose.value)}`)).json(); } catch {}
}

const groupedScanned = computed(() => {
  const groups: Record<string, EnvVar[]> = {};
  for (const ev of scannedEnvVars.value) {
    const src = (ev as any).source || "unknown";
    if (!groups[src]) groups[src] = [];
    groups[src].push({ key: ev.key, value: ev.value });
  }
  return Object.entries(groups).map(([source, vars]) => ({ source, vars }));
});

// Presets
const presets = ref<Preset[]>([]);
const presetSections = ref<Record<string, EnvSection[]>>({});
const presetDirty = ref<Record<string, boolean>>({});
const presetCollapsed = ref<Record<string, boolean>>({});
const activePreset = computed(() => presets.value.find(p => p.active));
const totalScannedCount = computed(() => scannedEnvVars.value.length);

function presetTotalCount(id: string) { return presetSections.value[id]?.reduce((s, sec) => s + sec.vars.length, 0) || 0; }

async function loadPresets() {
  if (!project.value) { presets.value = []; return; }
  try { presets.value = await (await fetch(`/api/batch-builds/${project.value.id}/presets`)).json(); } catch { presets.value = []; }
  for (const p of presets.value) {
    if (!presetSections.value[p.id]) {
      presetSections.value[p.id] = p.sections.map(s => ({ source: s.source, vars: [...s.vars], collapsed: false, sort: "default" as const, originalVars: [...s.vars] }));
    }
    presetDirty.value[p.id] = false;
    presetCollapsed.value[p.id] = true;
  }
}

function sortedVars(vars: EnvVar[], sort: "default" | "az" | "za", original?: EnvVar[]) {
  if (sort === "default") return original ? [...original] : vars;
  const sorted = [...vars].sort((a, b) => a.key.localeCompare(b.key));
  return sort === "za" ? sorted.reverse() : sorted;
}
function cycleSort(c: "default" | "az" | "za"): "default" | "az" | "za" { return c === "default" ? "az" : c === "az" ? "za" : "default"; }
function markPresetDirty(id: string) { presetDirty.value[id] = true; }
function addPresetVar(id: string, si: number) { presetSections.value[id][si].vars.push({ key: "", value: "" }); markPresetDirty(id); }
function removePresetVar(id: string, si: number, vi: number) { presetSections.value[id][si].vars.splice(vi, 1); markPresetDirty(id); }

const scannedModal = ref(false);
const scannedCollapsed = ref<Record<string, boolean>>({});
const scannedSort = ref<Record<string, "default" | "az" | "za">>({});
const forkModal = ref(false);
const forkName = ref("");

async function forkEnvVars() {
  if (!forkName.value.trim() || !project.value) return;
  const sections = groupedScanned.value.map(g => ({ source: g.source, vars: [...g.vars] }));
  const r = await fetch(`/api/batch-builds/${project.value.id}/presets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: forkName.value.trim(), sections }) });
  const preset = await r.json();
  presets.value.push(preset);
  presetSections.value[preset.id] = preset.sections.map((s: any) => ({ source: s.source, vars: [...s.vars], collapsed: false, sort: "default" as const, originalVars: [...s.vars] }));
  presetDirty.value[preset.id] = false;
  forkModal.value = false; forkName.value = "";
}

async function activatePreset(presetId: string) {
  const isActive = presets.value.find(p => p.id === presetId)?.active;
  await fetch(`/api/batch-builds/${project.value.id}/presets/${presetId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !isActive }) });
  presets.value.forEach(p => p.active = p.id === presetId ? !isActive : false);
}
async function deletePreset(presetId: string) {
  await fetch(`/api/batch-builds/${project.value.id}/presets/${presetId}`, { method: "DELETE" });
  presets.value = presets.value.filter(p => p.id !== presetId);
  delete presetSections.value[presetId]; delete presetDirty.value[presetId];
}
async function savePreset(presetId: string) {
  const sections = presetSections.value[presetId]?.map(s => ({ source: s.source, vars: s.vars }));
  await fetch(`/api/batch-builds/${project.value.id}/presets/${presetId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections }) });
  for (const s of presetSections.value[presetId]) s.originalVars = [...s.vars];
  presetDirty.value[presetId] = false;
  showToast("Preset saved", "success");
}

// Run
const simpleRunning = ref(false);
const simpleLogs = ref<{ line: string }[]>([]);
const simpleResult = ref<any>(null);
const simpleError = ref("");
const portRemaps = ref<any[]>([]);
const tearing = ref(false);
const logSection = ref<HTMLElement | null>(null);

const rootCauseLines = computed(() => simpleLogs.value.filter(l => /Caused by[:.]/.test(l.line) || /Exception/.test(l.line) || /Error response from daemon/.test(l.line)).map(l => l.line));
const aiExplaining = ref(false);
const aiExplanation = ref("");

async function explainBatchError() {
  if (!rootCauseLines.value.length) return;
  aiExplaining.value = true; aiExplanation.value = "";
  try {
    const r = await fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: rootCauseLines.value.join("\n"), logs: simpleLogs.value.slice(-30).map(l => l.line), functionName: project.value?.name, context: "docker-compose batch run" }) });
    const data = await r.json();
    aiExplanation.value = data.explanation || data.error || "No response";
  } catch (e: any) { aiExplanation.value = `Failed: ${e.message}`; }
  finally { aiExplaining.value = false; }
}

async function runSimple() {
  if (!project.value) return;
  simpleRunning.value = true; simpleLogs.value = []; simpleResult.value = null; simpleError.value = ""; portRemaps.value = [];
  await nextTick();
  logSection.value?.scrollIntoView({ behavior: "smooth" });
  try {
    const res = await fetch("/api/batch-runs/simple", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.value.id, projectPath: project.value.projectPath, composefile: selectedCompose.value, envOverrides: activePreset.value ? presetSections.value[activePreset.value.id]?.flatMap(s => s.vars).filter(e => e.key) || [] : [] }),
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
          if (event === "log") simpleLogs.value.push(data);
          else if (event === "remaps") portRemaps.value = data;
          else if (event === "complete") simpleResult.value = data;
          else if (event === "error") { simpleError.value = data.message || `Exit code: ${data.exitCode}`; simpleResult.value = data; }
        }
      }
    }
  } catch (e: any) { simpleError.value = e.message; }
  simpleRunning.value = false;
}

async function teardown() {
  tearing.value = true;
  try { await fetch("/api/batch-runs/simple/teardown", { method: "POST" }); showToast("Containers torn down", "success"); simpleRunning.value = false; } catch { showToast("Teardown failed", "warning"); }
  tearing.value = false;
}
async function stopSimple() {
  await fetch("/api/batch-runs/simple/stop", { method: "POST" });
  simpleRunning.value = false; teardown();
}

// Effective config
const effectiveConfigOpen = ref(false);
const effectiveConfig = ref("");
const highlightedConfig = computed(() => highlightYaml(effectiveConfig.value));

async function loadEffectiveConfig() {
  if (!project.value) return;
  effectiveConfigOpen.value = true; effectiveConfig.value = "";
  try {
    const r = await fetch(`/api/batch-runs/effective-config?projectPath=${encodeURIComponent(project.value.projectPath)}&composefile=${encodeURIComponent(selectedCompose.value)}`);
    effectiveConfig.value = (await r.json()).content || "No generated config found";
  } catch { effectiveConfig.value = "No generated config found"; }
}

// File viewer
const expandedService = ref("");
const fileViewerOpen = ref(false);
const fileViewerPath = ref("");
const fileViewerContent = ref("");
const fileViewerLoading = ref(false);

async function viewFile(filePath: string) {
  if (!project.value) return;
  fileViewerPath.value = filePath; fileViewerContent.value = ""; fileViewerLoading.value = true; fileViewerOpen.value = true;
  try { fileViewerContent.value = (await (await fetch(`/api/batch-builds/${project.value.id}/file?path=${encodeURIComponent(filePath)}`)).json()).content || "Empty file"; } catch { fileViewerContent.value = "Failed to read file"; }
  fileViewerLoading.value = false;
}

function highlightSh(code: string): string {
  return code.split("\n").map(line => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) return `<span class="sh-comment">${esc(line)}</span>`;
    let result = esc(line);
    result = result.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="sh-string">$1</span>');
    result = result.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="sh-string">$1</span>');
    result = result.replace(/(\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span class="sh-var">$1</span>');
    result = result.replace(/\b(if|then|else|elif|fi|for|do|done|while|until|case|esac|in|function|return|exit|local|export|source|set|unset|shift|break|continue)\b/g, '<span class="sh-keyword">$1</span>');
    result = result.replace(/(^|(?<=\| |; |&amp;&amp; ))(echo|cd|ls|cat|grep|sed|awk|find|mkdir|rm|cp|mv|chmod|chown|curl|wget|docker|java|mvn|gradle|npm|node|kill|sleep|wait|test|read|printf|exec|eval|trap|gzip|openssl|awslocal|aws)\b/g, '$1<span class="sh-cmd">$2</span>');
    return result;
  }).join("\n");
}

function highlightYaml(code: string): string {
  return code.split("\n").map(line => {
    const e = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (line.trimStart().startsWith("#")) return '<span class="sh-comment">' + e + '</span>';
    let r = e;
    r = r.replace(/("(?:[^"\\]|\\.)*")/g, '\x00STR$1\x00/STR');
    r = r.replace(/^(\s*)(\S+?)(:)/gm, '$1<span class="yaml-key">$2</span>$3');
    r = r.replace(/:\s+(\d+)(\s*)$/gm, ': <span class="yaml-num">$1</span>$2');
    r = r.replace(/:\s+(true|false)\s*$/gm, ': <span class="yaml-bool">$1</span>');
    r = r.replace(/\x00STR(.*?)\x00\/STR/g, '<span class="sh-string">$1</span>');
    return r;
  }).join("\n");
}

// Watcher
let watchSource: EventSource | null = null;
let watchReady = false;

onMounted(async () => {
  await loadProject();
  if (project.value) { loadProjectEnvVars(); loadPresets(); }
  watchSource = new EventSource("/api/batch-builds/watch");
  setTimeout(() => { watchReady = true; }, 1000);
  watchSource.onmessage = (e) => {
    if (!watchReady) return;
    const { projectId } = JSON.parse(e.data);
    if (projectId === project.value?.id) {
      showToast("Updating project data...", "warning");
      loadProjectEnvVars().then(() => showToast("Project data updated", "success"));
    }
  };
});
onUnmounted(() => { watchSource?.close(); });

watch(selectedCompose, () => { if (project.value) loadProjectEnvVars(); });
</script>


<template>
  <div class="max-w-5xl mx-auto space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="router.push('/batch-projects')"><ChevronLeft class="size-4" /></Button></TooltipTrigger><TooltipContent>Back to projects</TooltipContent></Tooltip>
      <div v-if="project" class="flex items-center gap-2 min-w-0">
        <Container class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-lg font-semibold truncate">{{ project.name }}</span>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Select v-if="project?.composeFiles?.length > 1" v-model="selectedCompose" :disabled="simpleRunning">
          <SelectTrigger class="w-56"><SelectValue placeholder="Select compose file" /></SelectTrigger>
          <SelectContent><SelectItem v-for="cf in project.composeFiles" :key="cf" :value="cf">{{ cf }}</SelectItem></SelectContent>
        </Select>
        <Tooltip v-if="project"><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="scannedModal = true"><Eye class="size-3.5" /> Scanned Env Vars <Badge v-if="totalScannedCount" variant="secondary" class="ml-1 text-[10px]">{{ totalScannedCount }}</Badge></Button></TooltipTrigger><TooltipContent>View all env vars detected from compose and .env files</TooltipContent></Tooltip>
        <Button v-if="project" size="sm" class="gap-1.5 cursor-pointer" :disabled="simpleRunning || !selectedCompose" @click="runSimple">
          <Loader2 v-if="simpleRunning" class="size-3.5 animate-spin" /><Play v-else class="size-3.5" /> {{ simpleRunning ? "Running..." : "Run" }}
        </Button>
        <Tooltip v-if="project"><TooltipTrigger as-child><Button variant="outline" size="sm" class="gap-1.5 cursor-pointer text-red-500 hover:text-red-400" :disabled="!simpleRunning && !tearing" @click="stopSimple"><Loader2 v-if="tearing" class="size-3.5 animate-spin" /><Square v-else class="size-3.5" /> Stop</Button></TooltipTrigger><TooltipContent>Stop all containers and clean up resources</TooltipContent></Tooltip>
      </div>
    </div>

    <div v-if="loading" class="py-12 text-center"><Loader2 class="size-5 animate-spin mx-auto text-muted-foreground" /></div>
    <div v-else-if="!project" class="py-12 text-center text-sm text-muted-foreground">Project not found. <Button variant="link" class="cursor-pointer px-1" @click="router.push('/batch-projects')">Go back</Button></div>

    <template v-else>
      <div v-if="!project.composeFiles?.length" class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 flex items-center gap-2">
        <AlertTriangle class="size-4 shrink-0" /> No docker-compose file was detected in this project.
      </div>

      <!-- Project Info -->
      <div class="rounded-lg border p-3 space-y-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project Info</p>
        <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
          <span class="text-muted-foreground">Path</span><span class="font-mono truncate" :title="project.projectPath">{{ project.projectPath }}</span>
          <span class="text-muted-foreground">Image</span><span class="font-mono truncate">{{ project.imageTag }}</span>
          <span class="text-muted-foreground">Dockerfile</span><span class="font-mono">{{ project.dockerfile }}</span>
          <span class="text-muted-foreground">Compose</span><span class="font-mono">{{ selectedCompose || 'N/A' }}</span>
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
                      <span class="text-muted-foreground">{{ v.split(':')[0] }}</span><span class="text-muted-foreground/50 mx-0.5">&rarr;</span><span>{{ v.split(':').slice(1).join(':') }}</span>
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
          <span>By default, the project runs with the env var configuration detected from your compose and .env files. To customize, click <strong>Fork Env Vars</strong> to create a named preset. <span v-if="!activePreset">No preset is active — using scanned defaults.</span><span v-else>Active preset: <strong>{{ activePreset.name }}</strong></span></span>
        </div>
        <div v-if="!presets.length" class="text-xs text-muted-foreground text-center py-4">No presets yet. Fork the scanned env vars to create one.</div>
        <div v-for="preset in presets" :key="preset.id" class="rounded-lg border">
          <div class="flex items-center gap-2 px-3 py-2">
            <button class="flex items-center gap-2 flex-1 cursor-pointer" @click="presetCollapsed[preset.id] = !presetCollapsed[preset.id]">
              <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="!presetCollapsed[preset.id] ? 'rotate-90' : ''" />
              <span class="text-xs font-medium">{{ preset.name }}</span>
              <Badge variant="secondary" class="text-[10px]">{{ presetTotalCount(preset.id) }}</Badge>
              <Badge v-if="preset.active" class="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] gap-1"><Check class="size-2.5" />Active</Badge>
            </button>
            <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-7 cursor-pointer" :class="preset.active ? 'text-emerald-500' : 'text-muted-foreground hover:text-foreground'" @click="activatePreset(preset.id)"><Check class="size-3.5" /></Button></TooltipTrigger><TooltipContent>{{ preset.active ? 'Deactivate' : 'Activate' }}</TooltipContent></Tooltip>
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
        <LogViewer :logs="simpleLogs.map(l => l.line)" :loading="simpleRunning" loading-text="Starting containers..." empty-text="Run output will appear here" :root-cause-lines="rootCauseLines" :kiro-available="kiroAvailable" :ai-explaining="aiExplaining" :ai-explanation="aiExplanation" @explain="explainBatchError">
          <template #after-root-cause-mini><p v-if="kiroAvailable" class="mt-2 text-[10px] text-violet-400/60 italic">Expand log to explain with Kiro</p></template>
        </LogViewer>
        <div v-if="simpleResult && !simpleError" class="flex items-center gap-2 text-sm text-green-500"><Check class="size-4" /> Completed successfully</div>
        <div v-if="simpleError" class="flex items-center gap-2 text-sm text-red-500"><X class="size-4" /> {{ simpleError }}</div>
      </div>
    </template>

    <!-- Scanned Env Vars Modal -->
    <Dialog v-model:open="scannedModal">
      <DialogContent class="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Scanned Environment Variables</DialogTitle><DialogDescription>Auto-detected from your compose file and .env files. Fork them to create an editable preset.</DialogDescription></DialogHeader>
        <div class="space-y-2 py-2">
          <div v-for="group in groupedScanned" :key="group.source" class="rounded-md border">
            <button class="flex items-center gap-2 w-full px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors" @click="scannedCollapsed[group.source] = !scannedCollapsed[group.source]">
              <ChevronRight class="size-3 text-muted-foreground transition-transform shrink-0" :class="!scannedCollapsed[group.source] ? 'rotate-90' : ''" />
              <span class="text-xs font-medium font-mono">{{ group.source }}</span>
              <Badge variant="secondary" class="text-[10px]">{{ group.vars.length }}</Badge>
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-5 ml-auto cursor-pointer text-muted-foreground hover:text-foreground" @click.stop="scannedSort[group.source] = cycleSort(scannedSort[group.source] || 'default')">
                <ArrowUpAZ v-if="scannedSort[group.source] === 'az'" class="size-3" /><ArrowDownAZ v-else-if="scannedSort[group.source] === 'za'" class="size-3" /><ListOrdered v-else class="size-3" />
              </Button></TooltipTrigger><TooltipContent>Sort</TooltipContent></Tooltip>
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

    <!-- Fork Modal -->
    <Dialog v-model:open="forkModal">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader><DialogTitle>Fork Environment Variables</DialogTitle><DialogDescription>Create a named preset from the currently scanned env vars.</DialogDescription></DialogHeader>
        <div class="space-y-2 py-2"><Label class="text-xs">Preset Name</Label><Input v-model="forkName" placeholder="e.g. local-debug" class="text-sm" @keydown.enter="forkEnvVars" /></div>
        <DialogFooter><Button variant="outline" class="cursor-pointer" @click="forkModal = false">Cancel</Button><Button class="cursor-pointer" :disabled="!forkName.trim()" @click="forkEnvVars">Create Preset</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Effective Config Modal -->
    <Dialog v-model:open="effectiveConfigOpen">
      <DialogContent class="sm:max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle class="flex items-center gap-2 text-sm"><FileText class="size-4" /> Effective Docker Compose Config</DialogTitle><DialogDescription>Generated compose file with port remappings applied.</DialogDescription></DialogHeader>
        <div v-if="portRemaps.length" class="rounded-md border p-3 space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port Changes</p>
          <div class="grid gap-1.5">
            <div v-for="r in portRemaps" :key="r.original" class="flex items-center gap-2 text-xs rounded-md bg-muted/30 px-3 py-1.5">
              <Badge variant="secondary" class="font-mono text-[10px]">{{ r.service }}</Badge>
              <div class="flex items-center gap-1.5 font-mono"><span class="text-red-500 line-through">{{ r.hostPort }}:{{ r.containerPort }}</span><span class="text-muted-foreground">→</span><span class="text-emerald-500">{{ r.newHostPort }}:{{ r.containerPort }}</span></div>
              <Badge variant="outline" class="text-[9px] text-amber-500 border-amber-500/30">remapped</Badge>
            </div>
          </div>
        </div>
        <div class="flex-1 min-h-0 rounded-md border bg-zinc-100 dark:bg-zinc-950 p-4 overflow-auto scrollbar-thin">
          <pre class="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre leading-5" v-html="highlightedConfig"></pre>
        </div>
      </DialogContent>
    </Dialog>

    <!-- File Viewer Modal -->
    <Dialog v-model:open="fileViewerOpen">
      <DialogContent class="sm:max-w-4xl max-h-[80vh]">
        <DialogHeader><DialogTitle class="flex items-center gap-2 font-mono text-sm"><FileText class="size-4" /> {{ fileViewerPath }}</DialogTitle></DialogHeader>
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
</style>
