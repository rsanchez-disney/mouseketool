<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from "vue";
import { useRouter } from "vue-router";
import { Rocket, Layers, GitBranch, Container, Workflow, Activity, ArrowRight, Sparkles, RefreshCw, Gauge, Eye, LayoutGrid } from "lucide-vue-next";

const router = useRouter();

interface Stats {
  counts: { lambdas: number; builds: number; pipelines: number; batchProjects: number; workflows: number };
  pipelineStats: { id: string; name: string; type: string; targetFunctionName: string; totalRuns: number; statusCounts: Record<string, number>; lastRunAt: number | null; lastRunStatus: string | null }[];
  lambdaStates: { functionName: string; statusCode: number | null; functionError: string | null; invokedAt: string | null }[];
}

const stats = ref<Stats | null>(null);
const loaded = ref(false);
const now = ref(Date.now());

// Typewriter
const phrases = ["backend developers", "batch applications", "AWS event-driven pipelines", "LocalStack workflows", "serverless testing"];
const currentPhrase = ref("");
const phraseIndex = ref(0);
const charIndex = ref(0);
const deleting = ref(false);
let typeTimer: ReturnType<typeof setTimeout> | null = null;

function typeStep() {
  const phrase = phrases[phraseIndex.value];
  if (!deleting.value) {
    currentPhrase.value = phrase.slice(0, charIndex.value + 1);
    charIndex.value++;
    if (charIndex.value >= phrase.length) { typeTimer = setTimeout(() => { deleting.value = true; typeStep(); }, 2000); return; }
    typeTimer = setTimeout(typeStep, 60);
  } else {
    currentPhrase.value = phrase.slice(0, charIndex.value - 1);
    charIndex.value--;
    if (charIndex.value <= 0) { deleting.value = false; phraseIndex.value = (phraseIndex.value + 1) % phrases.length; typeTimer = setTimeout(typeStep, 400); return; }
    typeTimer = setTimeout(typeStep, 30);
  }
}

// Particle system
const heroRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let particles: { x: number; y: number; ox: number; oy: number; vx: number; vy: number; size: number }[] = [];
let mouse = { x: -1000, y: -1000 };
let animFrame = 0;

function initParticles() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  particles = [];
  const spacing = 24;
  for (let x = 0; x < canvas.width + spacing; x += spacing) {
    for (let y = 0; y < canvas.height + spacing; y += spacing) {
      particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, size: 1.5 });
    }
  }
}

function animateParticles() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isDark = document.documentElement.classList.contains("dark");
  ctx.fillStyle = isDark ? "rgba(148, 163, 184, 0.4)" : "rgba(100, 116, 139, 0.25)";

  const radius = 100;
  for (const p of particles) {
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < radius) {
      const force = (radius - dist) / radius;
      p.vx += (dx / dist) * force * 3;
      p.vy += (dy / dist) * force * 3;
    }
    // Spring back to origin
    p.vx += (p.ox - p.x) * 0.03;
    p.vy += (p.oy - p.y) * 0.03;
    // Damping
    p.vx *= 0.85;
    p.vy *= 0.85;
    p.x += p.vx;
    p.y += p.vy;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  animFrame = requestAnimationFrame(animateParticles);
}

function onMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
}

function onMouseLeave() { mouse.x = -1000; mouse.y = -1000; }

// Count-up animation
const displayCounts = ref<Record<string, number>>({});
function animateCountUp(key: string, target: number) {
  if (!target) { displayCounts.value[key] = 0; return; }
  const duration = 800;
  const start = performance.now();
  function tick() {
    const elapsed = performance.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    displayCounts.value[key] = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(tick);
  }
  tick();
}

onMounted(async () => {
  try { stats.value = await (await fetch("/api/stats")).json(); } catch {}
  setTimeout(() => { quickStats.value.forEach(s => { displayCounts.value[s.label] = 0; }); nextTick(() => { quickStats.value.forEach(s => animateCountUp(s.label, s.value)); }); }, 600);
  setTimeout(() => { loaded.value = true; }, 100);

  setInterval(() => { now.value = Date.now(); }, 1000);
  setTimeout(typeStep, 800);
  setTimeout(() => { initParticles(); animateParticles(); }, 200);
  window.addEventListener("resize", initParticles);
});

onUnmounted(() => {
  if (typeTimer) clearTimeout(typeTimer);
  cancelAnimationFrame(animFrame);
  window.removeEventListener("resize", initParticles);
});

const quickStats = computed(() => {
  if (!stats.value) return [];
  const c = stats.value.counts;
  return [
    { label: "Lambdas", value: c.lambdas, icon: Rocket, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", path: "/deployments" },
    { label: "Builds", value: c.builds, icon: Layers, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", path: "/builder" },
    { label: "Pipelines", value: c.pipelines, icon: GitBranch, color: "text-cyan-400", bg: "bg-cyan-500/15 dark:bg-cyan-500/10", border: "border-cyan-500/20", path: "/triggers" },
    { label: "Batch Projects", value: c.batchProjects, icon: Container, color: "text-emerald-400", bg: "bg-emerald-500/15 dark:bg-emerald-500/10", border: "border-emerald-500/20", path: "/batch-projects" },
    { label: "Workflows", value: c.workflows, icon: Workflow, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", path: "/launchpad" },
  ];
});

const totalRuns = computed(() => stats.value?.pipelineStats.reduce((s, p) => s + p.totalRuns, 0) || 0);
const successRate = computed(() => {
  if (!totalRuns.value) return 0;
  const successes = stats.value?.pipelineStats.reduce((s, p) => s + (p.statusCounts.success || 0), 0) || 0;
  return Math.round((successes / totalRuns.value) * 100);
});

const recentActivity = computed(() => {
  if (!stats.value) return [];
  const events: { label: string; time: number; status: string }[] = [];
  for (const p of stats.value.pipelineStats) {
    if (p.lastRunAt) events.push({ label: p.targetFunctionName, time: p.lastRunAt, status: p.lastRunStatus || "unknown" });
  }
  return events.sort((a, b) => b.time - a.time).slice(0, 6);
});

const features = [
  { icon: Sparkles, title: "AI Payload Generation", desc: "Generate test payloads from samples using Kiro", color: "text-violet-400" },
  { icon: Eye, title: "Pipeline Observation", desc: "Real-time step-by-step execution tracking", color: "text-cyan-400" },
  { icon: LayoutGrid, title: "Visual Workflows", desc: "Drag-and-drop job dependency graphs", color: "text-emerald-400" },
  { icon: RefreshCw, title: "Self-Healing", desc: "Auto-recreates resources on restart", color: "text-amber-400" },
  { icon: Gauge, title: "Diagnostic Invoke", desc: "Captured event replay for error reproduction", color: "text-rose-400" },
];

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const diff = now.value - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function donutSegments(counts: Record<string, number>, total: number): { offset: number; length: number; color: string }[] {
  if (!total) return [];
  const colors: Record<string, string> = { success: 'rgba(16,185,129,0.6)', filtered: 'rgba(99,102,241,0.5)', error: 'rgba(239,68,68,0.5)', diagnosing: 'rgba(6,182,212,0.5)' };
  const segments: { offset: number; length: number; color: string }[] = [];
  let offset = 0;
  for (const [status, color] of Object.entries(colors)) {
    const count = counts[status] || 0;
    if (count) { const length = (count / total) * 100; segments.push({ offset, length, color }); offset += length; }
  }
  return segments;
}
function pipelineSuccessRate(counts: Record<string, number>, total: number): number {
  return total ? Math.round(((counts.success || 0) / total) * 100) : 0;
}

function statusDot(status: string): string {
  switch (status) { case "success": return "bg-emerald-500/50"; case "error": return "bg-red-500/50"; case "filtered": return "bg-indigo-500/50"; default: return "bg-zinc-500/50"; }
}
</script>

<template>
  <div class="min-h-full overflow-hidden scrollbar-thin">
    <!-- Hero Section with particle background -->
    <div ref="heroRef" class="relative flex flex-col items-center justify-center pt-4 pb-6">
      <!-- <canvas ref="canvasRef" class="absolute inset-0 w-full h-full pointer-events-none" /> -->

      <!-- Logo -->
      <div :class="['relative z-10 transition-[opacity,transform] duration-1000 ease-out', loaded ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-75 translate-y-8']">
        <div class="flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-800 border border-white/10 shadow-2xl">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="size-9 fill-current text-white drop-shadow-lg">
            <circle cx="50" cy="60" r="35"/><circle cx="22" cy="28" r="20"/><circle cx="78" cy="28" r="20"/>
          </svg>
        </div>
      </div>

      <h1 :class="['relative z-10 mt-3 text-3xl font-bold tracking-tight text-foreground transition-[opacity,transform] duration-1000 delay-200', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4']">
        Mouseketool
      </h1>

      <p :class="['relative z-10 mt-2 text-lg text-muted-foreground transition-[opacity,transform] duration-1000 delay-300 h-7', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4']">
        Disney developer tool for <span class="text-foreground font-medium">{{ currentPhrase }}</span><span class="animate-pulse">|</span>
      </p>

      <div :class="['relative z-10 mt-3 flex items-center gap-2 text-xs text-muted-foreground transition-[opacity,transform] duration-1000 delay-500', loaded ? 'opacity-100' : 'opacity-0']">
        <span class="relative flex size-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span class="relative inline-flex rounded-full size-2 bg-emerald-500" />
        </span>
        Connected to LocalStack
      </div>
    </div>

    <!-- Quick Stats -->
    <div :class="['max-w-5xl mx-auto px-6 transition-[opacity,transform] duration-1000 delay-500', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8']">
      <div class="grid grid-cols-5 gap-2.5">
        <button
          v-for="s in quickStats" :key="s.label"
          :class="['group relative flex flex-col items-center gap-1 rounded-xl border bg-white/[0.02] p-3 hover:bg-white/[0.05] transition-all duration-300 cursor-pointer active:scale-95', s.border]"
          @click="router.push(s.path)"
        >
          <div :class="['flex items-center justify-center size-8 rounded-lg transition-transform group-hover:scale-110', s.bg]">
            <component :is="s.icon" :class="['size-4', s.color]" />
          </div>
          <span class="text-xl font-bold tabular-nums">{{ displayCounts[s.label] ?? s.value }}</span>
          <span class="text-[9px] text-muted-foreground uppercase tracking-wider">{{ s.label }}</span>
        </button>
      </div>
    </div>

    <!-- Main Content Grid -->
    <div v-if="stats" :class="['max-w-5xl mx-auto px-6 mt-5 pb-8 grid grid-cols-3 gap-3 transition-[opacity,transform] duration-1000 delay-700', loaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8']">

      <!-- Pipeline Activity (2 cols) -->
      <div class="col-span-2 rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-medium flex items-center gap-2"><Activity class="size-4 text-muted-foreground" /> Pipeline Activity</h2>
          <div class="flex items-center gap-3">
            <span class="text-xs text-muted-foreground tabular-nums">{{ totalRuns }} runs</span>
          </div>
        </div>

        <div v-if="!stats.pipelineStats.length" class="text-xs text-muted-foreground text-center py-6">
          <GitBranch class="size-6 mx-auto mb-2 opacity-20" />
          No pipelines created yet
        </div>

        <div v-else class="space-y-1">
          <div v-for="p in stats.pipelineStats" :key="p.id" class="group flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer" @click="router.push(`/triggers/${p.id}/history`)">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-xs font-medium truncate max-w-[200px]">{{ p.name }}</span>
              <span v-if="p.lastRunAt && (now - p.lastRunAt) < 300000" class="relative flex size-1.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-75" /><span class="relative inline-flex rounded-full size-1.5 bg-zinc-400" /></span>
              <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/70">{{ p.type.replace('-', ' ') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1">
                <span v-if="p.statusCounts.success" class="inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400/50">✓ {{ p.statusCounts.success }}</span>
                <span v-if="p.statusCounts.filtered" class="inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-indigo-500/15 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400/50">⊘ {{ p.statusCounts.filtered }}</span>
                <span v-if="p.statusCounts.error" class="inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-red-500/15 dark:bg-red-500/10 text-red-600 dark:text-red-400/50">✗ {{ p.statusCounts.error }}</span>
                <span v-if="p.statusCounts.diagnosing" class="inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-cyan-500/15 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400/50">◎ {{ p.statusCounts.diagnosing }}</span>
              </div>
              <span class="text-[10px] text-muted-foreground/60 tabular-nums">{{ timeAgo(p.lastRunAt) }}</span>
              <ArrowRight class="size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>

      </div>
      <!-- Right column -->
      <div class="space-y-3">
        <!-- Recent Activity Feed -->
        <div class="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <h2 class="text-sm font-medium mb-2.5 flex items-center gap-2"><Activity class="size-4 text-muted-foreground" /> Recent</h2>
          <div v-if="!recentActivity.length" class="text-xs text-muted-foreground text-center py-3">No activity yet</div>
          <div v-else class="space-y-1.5">
            <div v-for="(ev, i) in recentActivity" :key="i" class="flex items-center gap-2 py-1">
              <span :class="['size-1.5 rounded-full shrink-0', statusDot(ev.status)]" />
              <span class="text-[11px] font-mono truncate flex-1">{{ ev.label }}</span>
              <span class="text-[9px] text-muted-foreground shrink-0 tabular-nums">{{ timeAgo(ev.time) }}</span>
            </div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <h2 class="text-sm font-medium mb-2.5">Quick Actions</h2>
          <div class="space-y-1">
            <button class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:bg-white/[0.05] transition-colors cursor-pointer text-left" @click="router.push('/builder')">
              <Rocket class="size-3.5 text-violet-400" /> Build & Deploy Lambda
            </button>
            <button class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:bg-white/[0.05] transition-colors cursor-pointer text-left" @click="router.push('/triggers')">
              <GitBranch class="size-3.5 text-cyan-400" /> Create Pipeline
            </button>
            <button class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:bg-white/[0.05] transition-colors cursor-pointer text-left" @click="router.push('/launchpad')">
              <Workflow class="size-3.5 text-rose-400" /> Launch Workflow
            </button>
          </div>
        </div>
      </div>

      <!-- Feature Highlights (full width) -->
      <div class="col-span-3 grid grid-cols-5 gap-2.5">
        <div v-for="f in features" :key="f.title" class="rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors">
          <component :is="f.icon" :class="['size-4 mb-1.5', f.color]" />
          <h3 class="text-[11px] font-medium mb-0.5">{{ f.title }}</h3>
          <p class="text-[10px] text-muted-foreground leading-relaxed">{{ f.desc }}</p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="stats && !stats.counts.lambdas && !stats.counts.pipelines" :class="['max-w-5xl mx-auto px-6 mt-2 text-center transition-[opacity,transform] duration-1000 delay-900', loaded ? 'opacity-100' : 'opacity-0']">
      <p class="text-sm text-muted-foreground">Get started by building and deploying a Lambda function →</p>
      <button class="mt-3 text-xs text-violet-400 hover:text-violet-300 transition-colors cursor-pointer" @click="router.push('/builder')">Open Lambda Builder</button>
    </div>
  </div>
</template>
