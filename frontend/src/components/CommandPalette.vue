<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { Hammer, Rocket, Database, Settings, Container, Play, HelpCircle, Home, Search, Zap, Plus, Moon, Sun, Workflow } from "lucide-vue-next";

const router = useRouter();
const open = ref(false);
const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement>();

// Dynamic data
const pipelines = ref<{ id: string; name: string }[]>([]);
const deployments = ref<{ functionName: string }[]>([]);

async function loadData() {
  try { pipelines.value = await (await fetch("/api/triggers/pipelines")).json(); } catch {}
  try { deployments.value = await (await fetch("/api/deployments")).json(); } catch {}
}

interface Cmd { label: string; path?: string; action?: () => void; icon: any; keywords: string; section?: string }

const staticCommands: Cmd[] = [
  { label: "Home", path: "/", icon: Home, keywords: "dashboard stats" },
  { label: "Builder", path: "/builder", icon: Hammer, keywords: "build maven gradle java" },
  { label: "Deployments", path: "/deployments", icon: Rocket, keywords: "deploy invoke lambda" },
  { label: "Triggers", path: "/triggers", icon: Database, keywords: "pipeline create trigger" },
  { label: "Batch Projects", path: "/batch-projects", icon: Container, keywords: "docker compose register" },
  { label: "Launchpad", path: "/launchpad", icon: Play, keywords: "run workflow execute" },
  { label: "Settings", path: "/settings", icon: Settings, keywords: "config connection localstack" },
  { label: "Profiles", path: "/settings?tab=profile", icon: Settings, keywords: "profile load unload workspace team" },
  { label: "Help & Guides", path: "/help", icon: HelpCircle, keywords: "help docs guide" },
  { label: "New Pipeline", path: "/triggers", icon: Plus, keywords: "create new pipeline", section: "Actions", action: () => router.push("/triggers") },
  { label: "New Workflow", path: "/launchpad", icon: Plus, keywords: "create new workflow", section: "Actions" },
  { label: "Toggle dark mode", icon: Moon, keywords: "theme dark light switch", section: "Actions", action: () => { const btn = document.querySelector<HTMLButtonElement>('[data-theme-toggle]'); if (btn) { const r = btn.getBoundingClientRect(); btn.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true })); } } },
];

const allCommands = computed<Cmd[]>(() => {
  const cmds: Cmd[] = [...staticCommands];
  for (const p of pipelines.value) {
    cmds.push({ label: `Execute ${p.name}`, path: `/triggers/${p.id}/execute`, icon: Zap, keywords: `execute run ${p.name}`, section: "Pipelines" });
    cmds.push({ label: `Edit ${p.name}`, path: `/triggers/${p.id}/edit`, icon: Database, keywords: `edit ${p.name}`, section: "Pipelines" });
  }
  for (const d of deployments.value) {
    cmds.push({ label: `Invoke ${d.functionName}`, path: "/deployments", icon: Rocket, keywords: `invoke ${d.functionName}`, section: "Lambdas" });
  }
  return cmds;
});

const filtered = computed(() => {
  if (!query.value) return allCommands.value.slice(0, 8);
  const q = query.value.toLowerCase();
  return allCommands.value.filter(c => c.label.toLowerCase().includes(q) || c.keywords.includes(q)).slice(0, 10);
});

watch(query, () => { selectedIndex.value = 0; });

function execute(cmd: Cmd) {
  open.value = false;
  query.value = "";
  if (cmd.action) cmd.action();
  else if (cmd.path) router.push(cmd.path);
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === ".") {
    e.preventDefault();
    open.value = !open.value;
    if (open.value) { loadData(); nextTick(() => inputRef.value?.focus()); }
  }
  if (!open.value) return;
  if (e.key === "Escape") { open.value = false; query.value = ""; }
  if (e.key === "ArrowDown") { e.preventDefault(); selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1); nextTick(() => document.querySelector("[data-cmd-active]")?.scrollIntoView({ block: "nearest" })); }
  if (e.key === "ArrowUp") { e.preventDefault(); selectedIndex.value = Math.max(selectedIndex.value - 1, 0); nextTick(() => document.querySelector("[data-cmd-active]")?.scrollIntoView({ block: "nearest" })); }
  if (e.key === "Enter" && filtered.value[selectedIndex.value]) { execute(filtered.value[selectedIndex.value]); }
}

onMounted(() => document.addEventListener("keydown", onKeydown, true));
onUnmounted(() => document.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh]" @click.self="open = false; query = ''">
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <div class="relative w-full max-w-md rounded-xl border bg-background shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <!-- Input -->
          <div class="flex items-center gap-2 px-4 py-3 border-b">
            <Search class="size-4 text-muted-foreground shrink-0" />
            <input
              ref="inputRef"
              v-model="query"
              placeholder="Type a command or search..."
              class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd class="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">Esc</kbd>
          </div>
          <!-- Results -->
          <div class="max-h-72 overflow-y-auto py-1">
            <button
              v-for="(cmd, i) in filtered" :key="cmd.label + cmd.path"
              :data-cmd-active="i === selectedIndex || undefined"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors cursor-pointer"
              :class="i === selectedIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'"
              @click="execute(cmd)"
              @mouseenter="selectedIndex = i"
            >
              <component :is="cmd.icon" class="size-4 shrink-0" />
              <span class="flex-1 truncate">{{ cmd.label }}</span>
              <span v-if="cmd.section" class="text-[9px] text-muted-foreground/60">{{ cmd.section }}</span>
            </button>
            <p v-if="!filtered.length" class="px-4 py-6 text-sm text-muted-foreground text-center">No results</p>
          </div>
          <!-- Footer -->
          <div class="flex items-center gap-3 px-4 py-2 border-t text-[10px] text-muted-foreground">
            <span><kbd class="bg-muted px-1 py-0.5 rounded font-mono">↑↓</kbd> navigate</span>
            <span><kbd class="bg-muted px-1 py-0.5 rounded font-mono">↵</kbd> open</span>
            <span><kbd class="bg-muted px-1 py-0.5 rounded font-mono">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
