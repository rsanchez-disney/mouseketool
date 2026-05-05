<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import FolderBrowser from "@/components/FolderBrowser.vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { timeAgo } from "@/lib/format";
import { FolderOpen, Container, Trash2, Plus, RefreshCw, FileCode2, Clock, Loader2, Check, XCircle, Pencil, AlertTriangle, Play, Rocket, ChevronDown, Search } from "lucide-vue-next";
import { useRouter } from "vue-router";
const router = useRouter();

interface BatchProject { id: string; name: string; projectPath: string; dockerfile: string; imageTag: string; services: any[]; createdAt: string }

function onKey(e: KeyboardEvent) { if (e.key === "Escape") showBrowser.value = false; }
onMounted(async () => {
  loadWorkflows();
  window.addEventListener("keydown", onKey);
  await loadProjects();
  const [pState, pList] = await Promise.all([
    fetch("/api/profile/state").then(r => r.json()).catch(() => null),
    fetch("/api/profile").then(r => r.json()).catch(() => []),
  ]);
  profileState.value = pState;
  if (pState) {
    profile.value = pList.find((p: any) => p.id === pState.activeProfile);
    profileBatchNames.value = (profile.value?.batches || []).map((b: any) => b.repoName);
    // Find missing batches (in profile but not registered)
    const registered = projects.value.map(p => p.name);
    missingBatches.value = (profile.value?.batches || []).filter((b: any) => !registered.includes(b.repoName));
  }
});
onUnmounted(() => window.removeEventListener("keydown", onKey));

const projects = ref<BatchProject[]>([]);
const showBrowser = ref(false);
const selectedPath = ref("");
const profileState = ref<any>(null);
const profile = ref<any>(null);
const profileBatchNames = ref<string[]>([]);
const missingBatches = ref<any[]>([]);
const batchSearch = ref("");

const filteredProjects = computed(() => {
  if (!batchSearch.value) return projects.value;
  const q = batchSearch.value.toLowerCase();
  return projects.value.filter(p => p.name.toLowerCase().includes(q) || p.projectPath.toLowerCase().includes(q));
});


const selectedBatches = ref<Set<string>>(new Set());
const showActionsMenu = ref(false);

const registering = ref(false);
const registerError = ref("");

async function loadProjects() { try { projects.value = await (await fetch("/api/batch-builds")).json(); } catch {} }

function selectFolder(path: string) { selectedPath.value = path; showBrowser.value = false; registerProject(); }

async function registerProject() {
  if (!selectedPath.value) return;
  registering.value = true; registerError.value = "";
  try {
    const r = await fetch("/api/batch-builds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectPath: selectedPath.value }) });
    if (!r.ok) { registerError.value = (await r.json()).error; registering.value = false; return; }
    selectedPath.value = "";
    loadProjects();
  } catch (e: any) { registerError.value = e.message; }
  registering.value = false;
}

const deleteTarget = ref<BatchProject | null>(null);
const editTarget = ref<BatchProject | null>(null);
const editDockerfile = ref("");
const editComposefile = ref("");

function openEdit(p: BatchProject) {
  editTarget.value = p;
  editDockerfile.value = p.dockerfile;
  editComposefile.value = p.composefile;
}

async function saveEdit() {
  if (!editTarget.value) return;
  toastMsg.value = "Saving and rescanning..."; toastType.value = "loading";
  try {
    await fetch(`/api/batch-builds/${editTarget.value.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dockerfile: editDockerfile.value, composefile: editComposefile.value }) });
    editTarget.value = null;
    loadProjects();
    toastMsg.value = "Saved"; toastType.value = "success";
  } catch { toastMsg.value = "Save failed"; toastType.value = "error"; }
  setTimeout(() => toastMsg.value = "", 3000);
}
async function confirmDelete() { if (!deleteTarget.value) return; await fetch(`/api/batch-builds/${deleteTarget.value.id}`, { method: "DELETE" }); deleteTarget.value = null; loadProjects(); }

function toggleSelect(id: string) { selectedBatches.value.has(id) ? selectedBatches.value.delete(id) : selectedBatches.value.add(id); selectedBatches.value = new Set(selectedBatches.value); }

async function confirmBulkDelete() {
  for (const id of selectedBatches.value) {
    await fetch(`/api/batch-builds/${id}`, { method: "DELETE" });
  }
  selectedBatches.value = new Set();
  loadProjects();
}

const rescanning = ref("");
const toastMsg = ref("");
const toastType = ref<"loading" | "success" | "error">("loading");

async function rescan(p: BatchProject) {
  rescanning.value = p.id;
  toastMsg.value = "Scanning docker-compose..."; toastType.value = "loading";
  try { await fetch(`/api/batch-builds/${p.id}/rescan`, { method: "POST" }); loadProjects(); toastMsg.value = "Scan complete"; toastType.value = "success"; } catch { toastMsg.value = "Scan failed"; toastType.value = "error"; }
  rescanning.value = "";
  setTimeout(() => toastMsg.value = "", 3000);
}

const exportTarget = ref<BatchProject | null>(null);
const exportCompose = ref("");
const exporting = ref(false);
const workflows = ref<any[]>([]);
async function loadWorkflows() { try { workflows.value = await (await fetch("/api/batch-workflows")).json(); } catch {} }

async function exportToLaunchpad(p: BatchProject, compose?: string) {
  const filePath = p.projectPath + "/" + (compose || p.composeFiles?.[0] || p.composefile);
  exporting.value = true;
  try {
    const wfRes = await fetch("/api/batch-workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name }) });
    const wf = await wfRes.json();
    await fetch(`/api/batch-workflows/${wf.id}/import-file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath }) });
    exportTarget.value = null;
    router.push({ path: "/launchpad", query: { workflowId: wf.id } });
  } catch { toastMsg.value = "Export failed"; toastType.value = "error"; setTimeout(() => toastMsg.value = "", 3000); }
  exporting.value = false;
}

function hasWorkflow(p: BatchProject) { return workflows.value.some(w => w.name === p.name); }
function handleExport(p: BatchProject) {
  if (p.composeFiles?.length > 1) { exportTarget.value = p; exportCompose.value = p.composeFiles[0]; }
  else exportToLaunchpad(p);
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Batch Projects</h1>
        <p class="text-sm text-muted-foreground mt-1">Register and manage Docker-based batch projects.</p>
      </div>
      <Button variant="outline" @click="showBrowser = true" class="gap-2 cursor-pointer active:scale-95 transition-all"><Plus class="size-4" /> Register</Button>
    </div>

    <!-- Search + Actions -->
    <div v-if="projects.length" class="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-3 py-2 mb-4">
      <div class="relative">
        <Search class="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input v-model="batchSearch" placeholder="Search..." class="h-7 w-44 rounded-md bg-background border pl-8 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
      </div>
      <div class="h-4 w-px bg-border" />
      <template v-if="selectedBatches.size">
        <span class="text-xs text-muted-foreground">{{ selectedBatches.size }} selected</span>
        <div class="relative">
          <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer active:scale-95 transition-transform" @click="showActionsMenu = !showActionsMenu"><ChevronDown class="size-3.5" /> Actions</Button>
          <div v-if="showActionsMenu" class="fixed inset-0 z-40" @click="showActionsMenu = false" />
          <div v-if="showActionsMenu" class="absolute left-0 top-full mt-1 w-48 rounded-md border bg-popover shadow-md z-50 py-1">
            <button class="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" :class="selectedBatches.size > 1 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'" :disabled="selectedBatches.size > 1" @click="selectedBatches.size === 1 && openEdit(projects.find(p => p.id === [...selectedBatches][0])!)"><Pencil class="size-3.5" /> Edit</button>
            <div class="border-t my-1" />
            <button class="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors flex items-center gap-2 cursor-pointer" @click="confirmBulkDelete(); showActionsMenu = false"><Trash2 class="size-3.5" /> Delete selected</button>
          </div>
        </div>
        <Button variant="ghost" size="sm" class="text-xs cursor-pointer" @click="selectedBatches = new Set()">Clear</Button>
      </template>
      <span v-else class="ml-auto text-[11px] text-muted-foreground font-mono tabular-nums">{{ filteredProjects.length }}<span class="text-muted-foreground/40">/{{ projects.length }}</span></span>
    </div>

    <!-- Project List -->
    <div class="space-y-2">
      <div v-for="p in filteredProjects" :key="p.id" class="flex items-center gap-3 rounded-xl border p-4 transition-all hover:bg-muted/30">
        <Tooltip :disabled="!profileBatchNames.includes(p.name)"><TooltipTrigger as-child><input type="checkbox" :checked="selectedBatches.has(p.id)" @change="toggleSelect(p.id)" :disabled="profileBatchNames.includes(p.name)" :class="['accent-primary size-4 shrink-0', profileBatchNames.includes(p.name) ? 'cursor-not-allowed' : 'cursor-pointer']" /></TooltipTrigger><TooltipContent>Managed by active profile — cannot be deleted</TooltipContent></Tooltip>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{ p.name }}</span>
            <Tooltip v-if="profileBatchNames.includes(p.name)"><TooltipTrigger as-child><span class="inline-flex items-center px-1.5 py-0.5 rounded-md border border-foreground/20 bg-foreground/5 text-[10px] font-medium text-foreground/80">{{ profile?.name }}</span></TooltipTrigger><TooltipContent>This batch was imported from the {{ profile?.name }} profile</TooltipContent></Tooltip>
            <Tooltip v-if="!p.composefile"><TooltipTrigger as-child><Badge class="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] gap-1"><AlertTriangle class="size-2.5" />No compose file</Badge></TooltipTrigger><TooltipContent>No docker-compose file was detected. Click edit to specify one.</TooltipContent></Tooltip>
          </div>
          <p class="text-xs text-muted-foreground truncate">{{ p.projectPath }}</p>
          <div class="flex items-center gap-3 text-xs text-muted-foreground">
            <span class="flex items-center gap-1 font-mono"><Container class="size-3" />{{ p.imageTag }}</span>
            <Badge v-if="p.services?.length" variant="secondary" class="text-[10px]">{{ p.services.length }} service(s)</Badge>
            <span class="flex items-center gap-1"><Clock class="size-3" />Registered {{ timeAgo(p.createdAt) }}</span>
            
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-emerald-500 cursor-pointer" @click="router.push(`/batch-projects/${p.id}/run`)"><Play class="size-4" /></Button></TooltipTrigger><TooltipContent>Run project</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-blue-500 cursor-pointer" :disabled="exporting || hasWorkflow(p)" @click="handleExport(p)"><Rocket class="size-4" /></Button></TooltipTrigger><TooltipContent>{{ hasWorkflow(p) ? "Workflow already exists for this project" : "Export to Launchpad" }}</TooltipContent></Tooltip>
        </div>
      </div>
    </div>

    <p v-if="!filteredProjects.length && batchSearch" class="text-sm text-muted-foreground text-center py-10">No projects match your search.</p>
    <div v-else-if="!projects.length" class="flex flex-col items-center justify-center py-20 text-muted-foreground"><Container class="size-12 mb-4 opacity-40" /><p class="text-sm font-medium">No batch projects registered.</p><p class="text-xs mt-1">Click "Register" to add a Docker-based project.</p></div>

    <!-- Missing from profile -->
    <div v-if="missingBatches.length" class="space-y-2 mt-6">
      <p class="text-xs text-muted-foreground font-medium">Missing from workspace:</p>
      <div v-for="b in missingBatches" :key="b.repoName" class="flex items-center justify-between rounded-xl border border-dashed p-4 opacity-50">
        <div class="space-y-0.5">
          <p class="text-sm font-medium">{{ b.displayName }}</p>
          <p class="text-xs text-muted-foreground font-mono">{{ b.repoName }}</p>
        </div>
        <span class="text-xs text-muted-foreground">Not found in workspace</span>
      </div>
    </div>

    <FolderBrowser v-model="showBrowser" title="Select Project Directory" description="Navigate to your batch project root." @select="selectFolder" />
    <Dialog :open="!!editTarget" @update:open="v => { if (!v) editTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Project Settings</DialogTitle>
          <DialogDescription>Update the Dockerfile and compose file paths for this project.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div class="space-y-2"><Label>Dockerfile</Label><Input v-model="editDockerfile" placeholder="Dockerfile" /></div>
          <div class="space-y-2"><Label>Compose File</Label><Input v-model="editComposefile" placeholder="docker-compose.yml" /></div>
        </div>
        <DialogFooter><Button @click="saveEdit" class="cursor-pointer">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog :open="!!exportTarget" @update:open="v => { if (!v) exportTarget = null }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader><DialogTitle>Select Compose File</DialogTitle><DialogDescription>This project has multiple compose files. Choose one to export.</DialogDescription></DialogHeader>
        <div class="space-y-2 py-2">
          <label v-for="cf in exportTarget?.composeFiles" :key="cf" class="flex items-center gap-2 cursor-pointer text-sm"><input type="radio" :value="cf" v-model="exportCompose" class="accent-primary" />{{ cf }}</label>
        </div>
        <DialogFooter><Button @click="exportToLaunchpad(exportTarget!, exportCompose)" :disabled="exporting" class="cursor-pointer">Export</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <div v-if="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300" :class="toastType === 'error' ? 'bg-red-600' : toastType === 'success' ? 'bg-green-600' : 'bg-zinc-700'"><Loader2 v-if="toastType === 'loading'" class="size-4 animate-spin" /><Check v-else-if="toastType === 'success'" class="size-4" /><XCircle v-else class="size-4" />{{ toastMsg }}</div>
  </div>
</template>