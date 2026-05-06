<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, Hammer, AlertTriangle, Check, Download, GitBranch, Feather, Diamond } from "lucide-vue-next";

const router = useRouter();
const profileState = ref<any>(null);
const profile = ref<any>(null);
const scanResults = ref<any[]>([]);
const loading = ref(true);
const cloning = ref<string | null>(null);
const cloneErrors = ref<Record<string, string>>({});

const lambdaProjects = computed(() => {
  if (!profile.value) return [];
  return (profile.value.lambdas || []).map((l: any) => {
    const scan = scanResults.value.find(s => s.repoName === l.repoName);
    const result = profileState.value?.provisioningResults?.lambdas?.find((r: any) => r.repoName === l.repoName);
    return { ...l, ...scan, found: scan?.found || false, deployed: result?.deployed || false, built: result?.success || false, buildId: result?.buildId, handler: scan?.handler || result?.handler || "", cloneError: cloneErrors.value[l.repoName] };
  });
});

onMounted(async () => {
  try {
    const [state, profiles] = await Promise.all([
      fetch("/api/profile/state").then(r => r.json()),
      fetch("/api/profile").then(r => r.json()),
    ]);
    profileState.value = state;
    if (!state) { router.push("/settings"); return; }
    profile.value = profiles.find((p: any) => p.id === state.activeProfile);
    await scan();
  } finally { loading.value = false; }
});

async function scan() {
  if (!profileState.value) return;
  const r = await fetch("/api/profile/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: profileState.value.workspacePath, profileId: profileState.value.activeProfile }) });
  scanResults.value = await r.json();
}

async function cloneProject(repoName: string) {
  cloning.value = repoName;
  delete cloneErrors.value[repoName];
  try {
    const r = await fetch("/api/profile/clone-project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repoName, workspacePath: profileState.value.workspacePath, org: profile.value?.org }) });
    if (!r.ok) { const d = await r.json(); cloneErrors.value[repoName] = d.error || "Clone failed"; }
    else { await scan(); }
  } catch (e: any) { cloneErrors.value[repoName] = e.message; }
  finally { cloning.value = null; }
}

function goRebuild(path: string) {
  router.push("/builder?path=" + encodeURIComponent(path));
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
        <p class="text-sm text-muted-foreground mt-1">Lambda projects managed by your active profile.</p>
      </div>
      <Button variant="outline" size="sm" @click="scan" class="gap-1.5 cursor-pointer"><RefreshCw class="size-3.5" />Refresh</Button>
    </div>

    <div v-if="profile" class="rounded-lg border bg-muted/20 px-4 py-3 mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div>
          <p class="text-sm font-medium">{{ profile.name }}</p>
          <p class="text-[11px] text-muted-foreground">{{ profile.description }} · {{ profileState?.workspacePath }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{{ lambdaProjects.filter(p => p.found).length }}/{{ lambdaProjects.length }} found</span>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="size-6 animate-spin text-muted-foreground" />
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <div
        v-for="p in lambdaProjects" :key="p.repoName"
        :class="['rounded-xl border p-4 space-y-3 transition-all', p.found ? 'bg-card' : 'opacity-50 border-dashed']"
      >
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-medium">{{ p.displayName }}</h3>
            <p class="text-xs text-muted-foreground font-mono">{{ p.repoName }}</p>
          </div>
          <div class="flex items-center gap-1.5">
            <Badge v-if="p.language" variant="secondary">{{ p.language }}</Badge>
            <Badge v-if="p.buildTool" variant="outline" class="gap-1"><Feather v-if="p.buildTool === 'maven'" class="size-3" /><Diamond v-else class="size-3" />{{ p.buildTool }}</Badge>
          </div>
        </div>

        <div v-if="p.handler" class="text-xs text-muted-foreground font-mono bg-muted px-3 py-2 rounded-md truncate">{{ p.handler }}</div>

        <!-- Found state -->
        <div v-if="p.found" class="flex items-center justify-between">
          <span class="flex items-center gap-1 text-xs" :class="p.deployed ? 'text-green-500' : p.built ? 'text-blue-400' : 'text-amber-500'">
            <Check v-if="p.deployed" class="size-3" />
            <Check v-else-if="p.built" class="size-3" />
            <AlertTriangle v-else class="size-3" />
            {{ p.deployed ? 'Deployed' : p.built ? 'Built - not deployed' : 'Build failed' }}
          </span>
          <Button variant="outline" size="sm" @click="goRebuild(p.path)" class="gap-1.5 cursor-pointer text-xs"><Hammer class="size-3" />Rebuild</Button>
        </div>

        <!-- Not found state -->
        <div v-else class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">Not found in workspace</span>
          <div class="flex items-center gap-2">
            <Tooltip v-if="p.cloneError"><TooltipTrigger><AlertTriangle class="size-3.5 text-amber-500" /></TooltipTrigger><TooltipContent><p class="text-xs">{{ p.cloneError }}</p></TooltipContent></Tooltip>
            <Button variant="outline" size="sm" @click="cloneProject(p.repoName)" :disabled="cloning === p.repoName" class="gap-1.5 cursor-pointer text-xs">
              <Loader2 v-if="cloning === p.repoName" class="size-3 animate-spin" />
              <Download v-else class="size-3" />
              {{ cloning === p.repoName ? 'Cloning...' : 'Clone' }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!loading && !lambdaProjects.length" class="text-center py-20 text-sm text-muted-foreground">No active profile. Go to Settings to load one.</div>
  </div>
</template>
