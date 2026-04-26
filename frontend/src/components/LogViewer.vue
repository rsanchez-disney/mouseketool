<script setup lang="ts">
import { ref, watch, nextTick, computed } from "vue";
import { Copy, Check, Maximize2, Minimize2, Search, X, ArrowDown } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export interface LogLine { line: string; isError?: boolean }

const props = withDefaults(defineProps<{
  logs: LogLine[] | string[];
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  rootCauseLines?: string[];
  height?: string;
  kiroAvailable?: boolean;
  aiExplaining?: boolean;
  aiExplanation?: string;
}>(), {
  loadingText: "Running...",
  emptyText: "No output yet",
  height: "h-72",
  rootCauseLines: () => [],
});

const emit = defineEmits<{ explain: []; copy: [text: string] }>();

// Normalize logs to strings
const lines = computed(() => props.logs.map(l => typeof l === "string" ? l : l.line));
const isErrorLine = (i: number) => {
  const raw = props.logs[i];
  if (typeof raw !== "string" && raw?.isError) return true;
  const l = lines.value[i];
  return /ERROR|Exception|Caused by|FunctionError/.test(l);
};

function lineClass(line: string, i: number, search: string): string {
  if (search && !line.toLowerCase().includes(search.toLowerCase())) return "opacity-20";
  if (isErrorLine(i)) return "text-red-400";
  if (line.startsWith("⚠") || line.includes("WARNING")) return "text-yellow-400";
  if (line.includes("──")) return "text-blue-400 font-semibold mt-2";
  if (line.startsWith("$")) return "text-blue-400";
  return "text-zinc-400";
}

// State — expanded supports v-model:expanded from parent
const expanded = defineModel<boolean>("expanded", { default: false });
const searchOpen = ref(false);
const logSearch = ref("");
const copied = ref(false);
const follow = ref(true);
let autoScrolling = false;

// Refs
const miniInner = ref<HTMLElement | null>(null);
const expandedInner = ref<HTMLElement | null>(null);

function copyLogs() {
  const text = lines.value.join("\n");
  navigator.clipboard.writeText(text);
  emit("copy", text);
  copied.value = true;
  setTimeout(() => copied.value = false, 2000);
}

function scrollToBottom(el: HTMLElement | null) {
  if (!el) return;
  autoScrolling = true;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => autoScrolling = false);
}

function onScroll(el: HTMLElement | null) {
  if (autoScrolling || !el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  if (!atBottom) follow.value = false;
}

function clickFollow() {
  follow.value = true;
  scrollToBottom(expandedInner.value);
}

// Auto-scroll on new logs
watch(() => props.logs.length, () => {
  if (!follow.value) return;
  nextTick(() => {
    scrollToBottom(miniInner.value);
    scrollToBottom(expandedInner.value);
  });
});

// Reset follow when expanded
watch(expanded, (v) => {
  if (!v) return;
  if (!props.loading && props.rootCauseLines.length) {
    follow.value = false;
    nextTick(() => { if (expandedInner.value) expandedInner.value.scrollTop = 0; });
  } else {
    follow.value = true;
    nextTick(() => scrollToBottom(expandedInner.value));
  }
});

// When loading finishes with errors, scroll expanded to top
watch(() => props.loading, (now, was) => {
  if (now && !was) { follow.value = true; }
  if (was && !now && props.rootCauseLines.length && expanded.value) {
    follow.value = false;
    nextTick(() => { if (expandedInner.value) expandedInner.value.scrollTop = 0; });
  }
});
</script>

<template>
  <!-- Minimized -->
  <div :class="['bg-zinc-950 text-zinc-300 rounded-lg p-4 font-mono text-xs leading-relaxed overflow-hidden relative border border-zinc-800', height]">
    <div ref="miniInner" class="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 min-w-0 break-all" @scroll="onScroll(miniInner)">
      <div v-if="loading && !logs.length" class="h-full flex items-center justify-center gap-2 text-zinc-500">
        <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        {{ loadingText }}
      </div>
      <div v-else-if="!logs.length" class="h-full flex items-center justify-center text-zinc-600">{{ emptyText }}</div>
      <template v-else>
        <!-- Root cause (minimized) -->
        <div v-if="rootCauseLines.length" class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 w-0 min-w-full">
          <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
          <div class="overflow-x-auto scrollbar-thin" style="scrollbar-color: #52525b transparent">
            <div v-for="(line, i) in rootCauseLines" :key="'rc'+i" class="text-xs font-mono text-red-300 whitespace-pre leading-relaxed">{{ line.trim() }}</div>
          </div>
          <slot name="after-root-cause-mini" />
        </div>
        <slot name="before-logs" />
        <div v-for="(line, i) in lines" :key="i" :class="lineClass(line, i, '')" class="text-xs font-mono whitespace-pre-wrap leading-relaxed">{{ line }}</div>
      </template>
    </div>
    <!-- Minimized toolbar -->
    <template v-if="logs.length">
      <slot name="toolbar-extra" />
      <Button variant="ghost" size="icon" class="absolute top-2 right-10 size-7 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="copyLogs">
        <Check v-if="copied" class="size-3.5 text-green-500" /><Copy v-else class="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" class="absolute top-2 right-2 size-7 cursor-pointer text-zinc-500 hover:text-zinc-300" @click="expanded = true">
        <Maximize2 class="size-3.5" />
      </Button>
    </template>
  </div>

  <!-- Expanded Modal -->
  <Dialog v-model:open="expanded">
    <DialogContent class="!max-w-[97vw] w-[97vw] h-[90vh] p-0 gap-0 border-zinc-800 bg-zinc-950 shadow-2xl !rounded-lg [&>button]:hidden flex flex-col">
      <DialogTitle class="sr-only">Log Output</DialogTitle>
      <DialogDescription class="sr-only">Expanded log output</DialogDescription>
      <div class="flex items-center justify-end gap-1 px-3 py-2 shrink-0">
        <div class="mr-auto flex items-center">
          <Button v-if="!searchOpen" variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="searchOpen = true"><Search class="size-3.5" /></Button>
          <div v-else class="relative flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200">
            <Search class="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input v-model="logSearch" placeholder="Search logs…" class="h-7 w-56 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-zinc-500" @vue:mounted="(e: any) => e.el.focus()" />
            <Button variant="ghost" size="icon" class="size-6 cursor-pointer text-zinc-400 hover:text-white shrink-0" @click="searchOpen = false; logSearch = ''"><X class="size-3" /></Button>
          </div>
        </div>
        <slot name="toolbar-expanded" />
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="clickFollow">
          <ArrowDown :class="follow ? 'size-3.5 text-emerald-400' : 'size-3.5'" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="copyLogs">
          <Check v-if="copied" class="size-3.5 text-green-500" /><Copy v-else class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" class="size-7 cursor-pointer text-zinc-300 hover:text-white" @click="expanded = false">
          <Minimize2 class="size-3.5" />
        </Button>
      </div>
      <div ref="expandedInner" class="overflow-auto scrollbar-thin px-4 pb-4 flex-1 min-h-0 text-zinc-300 font-mono text-xs leading-relaxed" @scroll="onScroll(expandedInner)">
        <!-- Root cause (expanded) -->
        <div v-if="rootCauseLines.length" class="mb-4 rounded-md border border-red-500/20 bg-red-500/5 p-3 grid" style="scrollbar-color: #52525b transparent">
          <div class="text-red-400 font-semibold mb-1.5 text-[11px] uppercase tracking-wide">Root Cause</div>
          <div class="overflow-x-auto scrollbar-thin" style="scrollbar-color: #52525b transparent">
            <div v-for="(line, i) in rootCauseLines" :key="'erc'+i" class="text-xs font-mono text-red-300 whitespace-pre leading-relaxed">{{ line.trim() }}</div>
          </div>
          <!-- Kiro explain button (expanded only) -->
          <button v-if="kiroAvailable" :disabled="aiExplaining" class="mt-3 w-fit flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/20 to-purple-500/20 border border-violet-500/40 text-[11px] font-medium text-violet-300 hover:from-violet-500/30 hover:to-purple-500/30 hover:text-violet-200 cursor-pointer disabled:opacity-50 transition-all shadow-[0_0_6px_rgba(139,92,246,0.1)]" @click="$emit('explain')">
            <svg class="size-3.5 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="klv" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#klv)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg>
            <span v-if="aiExplaining" class="animate-pulse text-violet-400">Asking Kiro...</span>
            <span v-else>Explain with Kiro</span>
          </button>
          <div v-if="kiroAvailable && aiExplanation" class="mt-3 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5 p-3.5 text-xs text-violet-200/90 whitespace-pre-wrap leading-relaxed">
            <div class="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider text-violet-400/70 font-semibold">
              <svg class="size-3 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="klvh" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#klvh)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg>
              Kiro
            </div>
            {{ aiExplanation }}
          </div>
        </div>
        <slot name="before-logs-expanded" />
        <div v-for="(line, i) in lines" :key="i" :class="lineClass(line, i, logSearch)" class="text-xs font-mono whitespace-pre leading-relaxed">{{ line }}</div>
      </div>
    </DialogContent>
  </Dialog>
</template>
