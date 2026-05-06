<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Rocket, Hammer, CloudCog, Zap, AlertTriangle, Terminal, Shield,
  Database, Bell, Clock, Keyboard, Sparkles, RefreshCw,
  Container, Play, Home, Settings, ChevronDown, ChevronRight, Search,
  Layers, MonitorPlay, Workflow, Inbox, Radio, ChevronsDownUp, ChevronsUpDown, UserCircle
} from "lucide-vue-next";
import { marked } from "marked";

// Icon map for dynamic resolution
const iconMap: Record<string, any> = {
  Rocket, Hammer, CloudCog, Zap, AlertTriangle, Terminal, Shield,
  Database, Bell, Clock, Keyboard, Sparkles, RefreshCw,
  Container, Play, Home, Settings, Layers, MonitorPlay, Workflow, Inbox, Radio, UserCircle
};

// Load all markdown files at build time
const mdFiles = import.meta.glob("../../../docs/help/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import meta from "../../../docs/help/_meta.json";

interface Section { id: string; tab: string; title: string; icon: string; html: string; raw: string; group?: string; order: number; }

// Parse frontmatter and render markdown
function parseMd(content: string): { id: string; tab: string; title: string; icon: string; body: string; group?: string; order: number } {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fm) return { id: "", tab: "", title: "", icon: "", body: content, order: 99 };
  const attrs: Record<string, string> = {};
  fm[1].split("\n").forEach(line => { const [k, ...v] = line.split(":"); if (k.trim()) attrs[k.trim()] = v.join(":").trim(); });
  return { id: attrs.id || "", tab: attrs.tab || "", title: attrs.title || "", icon: attrs.icon || "", body: fm[2], group: attrs.group, order: parseInt(attrs.order) || 99 };
}

// Diagram definitions - injected where <!-- diagram:name --> appears in markdown
const diagrams: Record<string, string> = {
  "lambda-flow": `<div class="flex items-center justify-center gap-0 py-4 mb-3">${["Build","Deploy","Configure","Invoke","Inspect"].map((s, i) => `<div class="px-4 py-2 rounded-md border border-blue-500/30 bg-blue-500/5 text-blue-400 text-sm font-medium">${s}</div>${i < 4 ? '<div class="w-10 flow-dash" style="color:rgb(59 130 246 / 0.4)"></div>' : ""}`).join("")}</div>`,
  "batch-flow": `<div class="flex items-center justify-center gap-0 py-4 mb-3">${["Register","Configure","Run","Monitor"].map((s, i) => `<div class="px-4 py-2 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm font-medium">${s}</div>${i < 3 ? '<div class="w-10 flow-dash" style="color:rgb(245 158 11 / 0.4)"></div>' : ""}`).join("")}</div>`,
  "app-pipeline": `<div class="flex items-center justify-center gap-0 py-3 mb-2 flex-wrap"><span class="px-3 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-xs text-amber-400 font-medium">DynamoDB</span><span class="w-6 flow-dash" style="color:rgb(245 158 11 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/5 text-xs text-blue-400 font-medium">Stream</span><span class="w-6 flow-dash" style="color:rgb(59 130 246 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 text-xs text-violet-400 font-medium">SNS</span><span class="w-6 flow-dash" style="color:rgb(139 92 246 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-400 font-medium">SQS</span><span class="w-6 flow-dash" style="color:rgb(16 185 129 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-400 font-medium">Lambda</span></div>`,
  "direct-stream": `<div class="flex items-center justify-center gap-0 py-3 mb-2"><span class="px-3 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-xs text-amber-400 font-medium">DynamoDB</span><span class="w-12 flow-dash" style="color:rgb(245 158 11 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-400 font-medium">Lambda</span></div>`,
  "queue-consumer": `<div class="flex items-center justify-center gap-0 py-3 mb-2"><span class="px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-400 font-medium">SQS</span><span class="w-12 flow-dash" style="color:rgb(16 185 129 / 0.4)"></span><span class="px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-400 font-medium">Lambda</span></div>`,
};

function injectDiagrams(html: string): string {
  return html.replace(/<!--\s*diagram:(\S+)\s*-->/g, (_, name) => diagrams[name] || "");
}

const sections: Section[] = Object.values(mdFiles).map(raw => {
  const { id, tab, title, icon, body, group, order } = parseMd(raw as string);
  return { id, tab, title, icon, html: injectDiagrams(marked.parse(body, { async: false }) as string), raw: body.toLowerCase(), group, order };
}).filter(s => s.id).sort((a, b) => a.order - b.order);

// Group sections by tab
const sectionsByTab = computed(() => {
  const map: Record<string, Section[]> = {};
  for (const s of sections) { (map[s.tab] ||= []).push(s); }
  return map;
});

const tabs = meta.tabs;
const active = ref("start");
const searchQuery = ref("");
const openSections = ref<Set<string>>(new Set());
const loaded = ref(false);
const tabTransition = ref(false);

onMounted(() => { setTimeout(() => { loaded.value = true; }, 50); });
watch(active, () => { tabTransition.value = false; nextTick(() => { tabTransition.value = true; }); });
onMounted(() => { tabTransition.value = true; });

function toggle(id: string) {
  if (openSections.value.has(id)) { openSections.value.delete(id); return; }
  const prefix = id.split("-")[0];
  for (const key of [...openSections.value]) { if (key.startsWith(prefix + "-")) openSections.value.delete(key); }
  openSections.value.add(id);
}
function isOpen(id: string) { return openSections.value.has(id); }
function openAll(ids: string[]) { ids.forEach(id => openSections.value.add(id)); }
function closeAll(ids: string[]) { ids.forEach(id => openSections.value.delete(id)); }

const activeTab = computed(() => tabs.find(t => t.id === active.value));

// Search
const searchResults = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return null;
  const matches: Record<string, string[]> = {};
  for (const s of sections) {
    if (s.raw.includes(q) || s.id.includes(q) || s.title.toLowerCase().includes(q)) {
      (matches[s.tab] ||= []).push(s.id);
    }
  }
  return matches;
});

function tabMatchCount(tabId: string) { return searchResults.value?.[tabId]?.length || 0; }

watch(searchQuery, (q) => {
  if (!q.trim()) return;
  const results = searchResults.value;
  if (!results) return;
  const firstTab = Object.keys(results)[0];
  if (firstTab && !results[active.value]?.length) active.value = firstTab;
  for (const ids of Object.values(results)) { ids.forEach(id => openSections.value.add(id)); }
});

function getIcon(name: string) { return iconMap[name] || Home; }
function tabSectionIds(tabId: string) { return (sectionsByTab.value[tabId] || []).map(s => s.id); }

// Group sections within a tab by their group field
function tabGroups(tabId: string): { label: string | null; sections: Section[] }[] {
  const items = sectionsByTab.value[tabId] || [];
  if (!items.some(s => s.group)) return [{ label: null, sections: items }];
  const groups: { label: string | null; sections: Section[] }[] = [];
  let current: string | null = null;
  for (const s of items) {
    const g = s.group || null;
    if (g !== current) { groups.push({ label: g, sections: [] }); current = g; }
    groups[groups.length - 1].sections.push(s);
  }
  return groups;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div :class="['flex items-center justify-between transition-[opacity,transform] duration-700', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4']">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Help & Guides</h1>
        <p class="text-muted-foreground text-sm">Everything you need to know to get the most out of Mouseketool.</p>
      </div>
      <div class="relative w-64">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input v-model="searchQuery" placeholder="Search help..." class="pl-8 h-8 text-xs" />
      </div>
    </div>

    <!-- Breadcrumb -->
    <div :class="['text-xs text-muted-foreground flex items-center gap-1 transition-[opacity,transform] duration-700 delay-100', loaded ? 'opacity-100' : 'opacity-0']">
      <span>Help</span>
      <ChevronRight class="size-3" />
      <span class="text-foreground font-medium transition-all duration-300">{{ activeTab?.label }}</span>
    </div>

    <!-- Tabs -->
    <div :class="['transition-[opacity,transform] duration-700 delay-200', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6']">
    <div class="flex gap-1 border-b mb-6">
      <button
        v-for="t in tabs" :key="t.id"
        :class="['flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer -mb-px', active === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground']"
        @click="active = t.id"
      >
        <component :is="getIcon(t.icon)" class="size-3.5" />
        {{ t.label }}
        <span v-if="searchQuery && tabMatchCount(t.id)" class="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-primary/15 text-primary">{{ tabMatchCount(t.id) }}</span>
      </button>
    </div>

      <div class="min-w-0">
        <Transition name="tab-fade" mode="out-in">
          <div :key="active">
            <div class="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div class="flex items-center justify-between mb-4">
                <h3 class="flex items-center gap-2 text-base font-semibold">
                  <component :is="getIcon(activeTab?.icon || 'Home')" class="size-4 text-muted-foreground" />
                  {{ activeTab?.label }}
                </h3>
                <div v-if="(sectionsByTab[active]?.length || 0) > 1" class="flex gap-1">
                  <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="openAll(tabSectionIds(active))" title="Open all"><ChevronsUpDown class="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" class="h-6 w-6 cursor-pointer opacity-40 hover:opacity-100" @click="closeAll(tabSectionIds(active))" title="Close all"><ChevronsDownUp class="size-3.5" /></Button>
                </div>
              </div>

              <!-- Single-section tabs (shortcuts, troubleshooting) render directly -->
              <div v-if="(sectionsByTab[active]?.length || 0) === 1" class="prose-help text-sm text-muted-foreground" v-html="sectionsByTab[active][0].html" />

              <!-- Multi-section tabs render as collapsibles, optionally grouped -->
              <div v-else class="space-y-2">
                <template v-for="group in tabGroups(active)" :key="group.label">
                  <p v-if="group.label" class="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4 mb-1 first:mt-0">{{ group.label }}</p>
                  <div v-for="section in group.sections" :key="section.id" class="border rounded-lg overflow-hidden transition-all duration-300 hover:border-zinc-500/30 hover:shadow-sm">
                    <button class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-left cursor-pointer hover:bg-muted/50 transition-colors" @click="toggle(section.id)">
                      <component :is="isOpen(section.id) ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground transition-transform duration-200" />
                      <component :is="getIcon(section.icon)" class="size-3.5 text-muted-foreground" />
                      {{ section.title }}
                    </button>
                    <div class="grid transition-all duration-300 ease-in-out" :class="isOpen(section.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
                      <div class="overflow-hidden">
                        <div class="px-4 pt-3 pb-4 pl-5 text-sm text-muted-foreground border-l-2 border-l-zinc-500/30 ml-4 prose-help" v-html="section.html" />
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-fade-enter-active, .tab-fade-leave-active { transition: opacity 0.15s ease; }
.tab-fade-enter-from, .tab-fade-leave-to { opacity: 0; }

:deep(.prose-help) { display: flex; flex-direction: column; gap: 0.75rem; }
:deep(.prose-help h2) { font-weight: 500; color: var(--foreground); font-size: 0.875rem; margin-top: 1rem; margin-bottom: 0.25rem; }
:deep(.prose-help p) { line-height: 1.625; }
:deep(.prose-help ul) { list-style-type: disc; list-style-position: inside; margin-left: 0.25rem; display: flex; flex-direction: column; gap: 0.375rem; }
:deep(.prose-help ol) { list-style-type: decimal; list-style-position: inside; margin-left: 0.25rem; display: flex; flex-direction: column; gap: 0.375rem; }
:deep(.prose-help code) { font-size: 0.75rem; background: hsl(var(--muted)); padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
:deep(.prose-help pre) { background: #09090b; border-radius: 0.5rem; padding: 0.75rem; font-size: 0.75rem; overflow: auto; font-family: monospace; color: #d4d4d8; border: 1px solid #27272a; }
:deep(.prose-help pre code) { background: transparent; padding: 0; }
:deep(.prose-help table) { width: 100%; font-size: 0.75rem; border-collapse: collapse; }
:deep(.prose-help th) { text-align: left; font-weight: 500; color: var(--foreground); padding: 0.5rem; border-bottom: 1px solid hsl(var(--border)); }
:deep(.prose-help td) { padding: 0.5rem; border-bottom: 1px solid hsl(var(--border) / 0.5); }
:deep(.prose-help strong) { color: var(--foreground); }
:deep(.flow-dash) { height: 1px; border: none; background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 8px); animation: dash-scroll 0.5s linear infinite; }
@keyframes dash-scroll { to { background-position: 8px 0; } }
</style>
