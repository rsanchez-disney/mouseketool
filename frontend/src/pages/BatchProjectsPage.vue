<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import FolderBrowser from "@/components/FolderBrowser.vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { timeAgo } from "@/lib/format";
import { FolderOpen, Container, Trash2, Plus, RefreshCw, FileCode2, Clock, Loader2, Check, XCircle, Pencil, AlertTriangle, Play, Rocket } from "lucide-vue-next";
import { useRouter } from "vue-router";
const router = useRouter();

interface BatchProject { id: string; name: string; projectPath: string; dockerfile: string; imageTag: string; services: any[]; createdAt: string }

function onKey(e: KeyboardEvent) { if (e.key === "Escape") showBrowser.value = false; }
onMounted(() => { window.addEventListener("keydown", onKey); loadProjects(); });
onUnmounted(() => window.removeEventListener("keydown", onKey));

const projects = ref<BatchProject[]>([]);
const showBrowser = ref(false);
const selectedPath = ref("");

const registering = ref(false);
const registerError = ref("");

async function loadProjects() { try { projects.value = await (await fetch("/api/batch-builds")).json(); } catch {} }

function selectFolder(path: string) { selectedPath.value = path; }

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

function handleExport(p: BatchProject) {
  if (p.composeFiles?.length > 1) { exportTarget.value = p; exportCompose.value = p.composeFiles[0]; }
  else exportToLaunchpad(p);
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Register Project -->
    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="flex items-center gap-2 text-base"><Container class="size-4" /> Register Batch Project</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-xs text-muted-foreground">Point to a project directory. Mouseketool will auto-detect the Dockerfile and docker-compose file.</p>
        <div class="flex gap-3 items-end">
          <div class="flex-1 space-y-2">
            <Label class="text-xs">Project Path</Label>
            <Input v-model="selectedPath" placeholder="/path/to/your/batch/project" class="text-sm" />
          </div>
          <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer mb-0.5" @click="showBrowser = true"><FolderOpen class="size-3.5" /> Browse</Button>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" class="gap-1.5 cursor-pointer" :disabled="!selectedPath || registering" @click="registerProject">
            <Loader2 v-if="registering" class="size-3.5 animate-spin" /><Plus v-else class="size-3.5" /> Register
          </Button>
          <span v-if="registerError" class="text-xs text-red-500">{{ registerError }}</span>
        </div>
      </CardContent>
    </Card>

    <!-- Registered Projects -->
    <Card>
      <CardHeader class="pb-1">
        <CardTitle class="flex items-center gap-2 text-base">Registered Projects <Badge v-if="projects.length" variant="secondary">{{ projects.length }}</Badge></CardTitle>
      </CardHeader>
      <CardContent>
        <div v-if="projects.length" class="space-y-2">
          <div v-for="p in projects" :key="p.id" class="flex items-center justify-between rounded-lg border p-3">
            <div class="space-y-0.5 min-w-0 flex-1">
              <p class="text-sm font-medium">{{ p.name }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ p.projectPath }}</p>
              <div class="flex items-center gap-3 mt-1.5">
                <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1 text-xs text-muted-foreground font-mono"><Container class="size-3 shrink-0" />{{ p.imageTag }}</span></TooltipTrigger><TooltipContent>Docker image tag</TooltipContent></Tooltip>
                <Tooltip v-if="p.services?.length"><TooltipTrigger as-child><Badge variant="outline" class="text-[10px]">{{ p.services.length }} service(s)</Badge></TooltipTrigger><TooltipContent>Detected docker-compose services</TooltipContent></Tooltip>
                <Tooltip v-if="!p.composefile"><TooltipTrigger as-child><Badge class="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] gap-1"><AlertTriangle class="size-2.5" />No compose file</Badge></TooltipTrigger><TooltipContent>No docker-compose file was detected. Click edit to specify one.</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger as-child><span class="flex items-center gap-1 text-xs text-muted-foreground"><Clock class="size-3 shrink-0" />{{ timeAgo(p.createdAt) }}</span></TooltipTrigger><TooltipContent>Registered on {{ new Date(p.createdAt).toLocaleString('en-GB') }}</TooltipContent></Tooltip>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0 ml-3">
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-emerald-500 cursor-pointer" @click="router.push(`/batch-projects/${p.id}/run`)"><Play class="size-4" /></Button></TooltipTrigger><TooltipContent>Run project</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-blue-500 cursor-pointer" :disabled="exporting" @click="handleExport(p)"><Rocket class="size-4" /></Button></TooltipTrigger><TooltipContent>Export to Launchpad</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-foreground cursor-pointer" @click="openEdit(p)"><Pencil class="size-4" /></Button></TooltipTrigger><TooltipContent>Edit project settings</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger as-child><Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-red-500 cursor-pointer" @click="deleteTarget = p"><Trash2 class="size-4" /></Button></TooltipTrigger><TooltipContent>Remove project</TooltipContent></Tooltip>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground text-center py-6">No projects registered yet. Add a batch project above to get started.</p>
      </CardContent>
    </Card>

    <FolderBrowser v-model="showBrowser" title="Select Project Directory" description="Navigate to your batch project root." @select="selectFolder" />
    <Dialog :open="!!editTarget" @update:open="v => { if (!v) editTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Project Settings</DialogTitle>
          <DialogDescription>Update the Dockerfile and compose file paths for {{ editTarget?.name }}.</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <div class="space-y-1.5">
            <Label class="text-xs">Dockerfile</Label>
            <Input v-model="editDockerfile" class="text-sm font-mono" placeholder="Dockerfile" />
          </div>
          <div class="space-y-1.5">
            <Label class="text-xs">Compose File</Label>
            <Input v-model="editComposefile" class="text-sm font-mono" placeholder="docker-compose.yml" />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" class="cursor-pointer" @click="editTarget = null">Cancel</Button>
          <Button class="cursor-pointer" @click="saveEdit">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!deleteTarget" @update:open="v => { if (!v) deleteTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Project</DialogTitle>
          <DialogDescription>Remove {{ deleteTarget?.name }} from the registry? This does not delete any files.</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" class="cursor-pointer" @click="deleteTarget = null">Cancel</Button>
          <Button variant="destructive" class="cursor-pointer" @click="confirmDelete">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!exportTarget" @update:open="v => { if (!v) exportTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Compose File</DialogTitle>
          <DialogDescription>{{ exportTarget?.name }} has multiple compose files. Pick one to export.</DialogDescription>
        </DialogHeader>
        <div class="space-y-2 py-2">
          <button v-for="cf in exportTarget?.composeFiles" :key="cf" class="w-full flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors text-left" :class="exportCompose === cf ? 'border-primary bg-primary/5' : ''" @click="exportCompose = cf">
            <FileCode2 class="size-4 shrink-0 text-muted-foreground" />
            <span class="text-sm font-mono">{{ cf }}</span>
          </button>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" class="cursor-pointer" @click="exportTarget = null">Cancel</Button>
          <Button class="cursor-pointer gap-1.5" :disabled="!exportCompose || exporting" @click="exportToLaunchpad(exportTarget!, exportCompose)"><Loader2 v-if="exporting" class="size-3.5 animate-spin" /><Rocket v-else class="size-3.5" /> Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div v-if="toastMsg" :key="toastMsg" class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-300" :class="toastType === 'error' ? 'bg-red-600' : toastType === 'success' ? 'bg-green-600' : 'bg-primary'">
      <Loader2 v-if="toastType === 'loading'" class="size-4 animate-spin" />
      <Check v-else-if="toastType === 'success'" class="size-4" />
      <XCircle v-else class="size-4" />
      {{ toastMsg }}
    </div>
  </div>
</template>
