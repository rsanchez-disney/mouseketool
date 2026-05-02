<script setup lang="ts">
import { ref, watchEffect, onMounted, onUnmounted, provide } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarInset, SidebarTrigger, SidebarSeparator,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import CommandPalette from "@/components/CommandPalette.vue";
import { Home, Rocket, Settings, Sun, Moon, CloudCog, CircleHelp, Workflow, WifiOff, Loader2, Container, Play } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
function navTo(path: string) { if (route.path === path || route.path.startsWith(path + "/")) { router.replace({ path, query: { _t: Date.now().toString() } }); } else { router.push(path); } }
const dark = ref(localStorage.getItem("mk:theme") === "dark");
const themeAnimation = ref(true);
onMounted(async () => { try { const s = await (await fetch("/api/settings")).json(); themeAnimation.value = s.themeAnimation !== false; } catch {} });
function toggleTheme(e: MouseEvent) {
  if (!themeAnimation.value || !(document as any).startViewTransition) { dark.value = !dark.value; return; }
  const x = e.clientX; const y = e.clientY;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = (document as any).startViewTransition(() => { dark.value = !dark.value; });
  transition.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 400, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" });
  });
}

watchEffect(() => {
  document.documentElement.classList.toggle("dark", dark.value);
  localStorage.setItem("mk:theme", dark.value ? "dark" : "light");
});

// LocalStack health check
const localstackDown = ref(false);
const isReconciling = ref(false);
let healthInterval: ReturnType<typeof setInterval> | null = null;
async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const data = await r.json();
    localstackDown.value = !data.localstack;
    isReconciling.value = !!data.reconciling;
  } catch { localstackDown.value = true; }
}
onMounted(() => { checkHealth(); healthInterval = setInterval(checkHealth, 5000); checkKiro(); });
onUnmounted(() => { if (healthInterval) clearInterval(healthInterval); });

// Kiro AI detection
const kiroAvailable = ref(false);
provide("kiroAvailable", kiroAvailable);
provide("themeAnimation", themeAnimation);
async function checkKiro() { try { const r = await fetch("/api/ai/status"); const d = await r.json(); kiroAvailable.value = d.available; } catch {} }
const serverlessNav = [
  { label: "Lambda Builder", path: "/builder", icon: Rocket },
  { label: "Deployments", path: "/deployments", icon: CloudCog },
  { label: "Triggers", path: "/triggers", icon: Workflow },
];
const batchNav = [
  { label: "Batch Projects", path: "/batch-projects", icon: Container },
  { label: "Launchpad", path: "/launchpad", icon: Play },
];
const otherNav = [
  { label: "Settings", path: "/settings", icon: Settings },
];
const allNav = [{ label: "Home", path: "/", icon: Home }, ...serverlessNav, ...batchNav, ...otherNav];
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <SidebarProvider>
      <Sidebar collapsible="icon" class="border-r">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" as-child>
                <router-link to="/" class="flex items-center gap-2">
                  <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="size-4 fill-current"><circle cx="50" cy="60" r="35"/><circle cx="22" cy="28" r="20"/><circle cx="78" cy="28" r="20"/></svg>
                  </div>
                  <div class="flex flex-col gap-0.5 leading-none">
                    <span class="font-semibold">Mouseketool</span>
                    <span class="text-xs text-muted-foreground">Developer Workbench</span>
                  </div>
                </router-link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Serverless</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in serverlessNav" :key="item.path">
                  <SidebarMenuButton as-child :is-active="route.path === item.path || route.path.startsWith(item.path + '/')">
                    <a class="flex items-center gap-2 cursor-pointer" @click="navTo(item.path)">
                      <component :is="item.icon" class="size-4" />
                      <span>{{ item.label }}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <div class="mx-3 border-t" />
          <SidebarGroup>
            <SidebarGroupLabel>Batch</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in batchNav" :key="item.path">
                  <SidebarMenuButton as-child :is-active="route.path === item.path || route.path.startsWith(item.path + '/')">
                    <a class="flex items-center gap-2 cursor-pointer" @click="navTo(item.path)">
                      <component :is="item.icon" class="size-4" />
                      <span>{{ item.label }}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <div class="mx-3 border-t" />
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in otherNav" :key="item.path">
                  <SidebarMenuButton as-child :is-active="route.path === item.path">
                    <a class="flex items-center gap-2 cursor-pointer" @click="navTo(item.path)">
                      <component :is="item.icon" class="size-4" />
                      <span>{{ item.label }}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button variant="ghost" size="icon" class="size-8 cursor-pointer" data-theme-toggle @click="toggleTheme($event)">
                    <Sun v-if="dark" class="size-4" />
                    <Moon v-else class="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Toggle theme</TooltipContent>
              </Tooltip>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header class="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger class="-ml-1 cursor-pointer" />
          <Separator orientation="vertical" class="mr-2 h-4" />
          <span class="text-sm font-medium text-muted-foreground">
            {{ allNav.find(n => n.path === route.path || route.path.startsWith(n.path + '/'))?.label ?? 'Mouseketool' }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <Tooltip v-if="kiroAvailable">
              <TooltipTrigger as-child>
                <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/15 to-purple-500/15 border border-violet-500/40 shadow-[0_0_8px_rgba(139,92,246,0.15)]">
                  <div class="relative"><div class="size-2 rounded-full bg-violet-400"></div><div class="absolute inset-0 size-2 rounded-full bg-violet-400 animate-ping opacity-50"></div></div>
                  <span class="text-[11px] font-semibold bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-300 dark:to-purple-300 bg-clip-text text-transparent">Kiro AI</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Kiro AI detected and ready</TooltipContent>
            </Tooltip>
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border">
                  <div class="size-2 rounded-full bg-zinc-500"></div>
                  <span class="text-[11px] font-medium text-muted-foreground">Kiro AI</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>Install Kiro CLI on your machine to unlock AI features</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="navTo('/help')">
                  <CircleHelp class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Help & Guides</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main class="flex-1 p-6 relative">
          <div v-if="localstackDown && route.path !== '/settings' && route.path !== '/help'" class="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div class="text-center space-y-3 max-w-sm">
              <WifiOff class="size-12 mx-auto text-muted-foreground opacity-50" />
              <h2 class="text-lg font-semibold">LocalStack Unavailable</h2>
              <p class="text-sm text-muted-foreground">Cannot connect to your LocalStack instance. Make sure it's running and the connection settings are correct.</p>
              <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="$router.push('/settings')"><Settings class="size-3.5" /> Check Settings</Button>
            </div>
          </div>
          <div v-else-if="isReconciling && route.path !== '/settings' && route.path !== '/help'" class="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div class="text-center space-y-3 max-w-sm">
              <Loader2 class="size-12 mx-auto text-primary animate-spin" />
              <h2 class="text-lg font-semibold">Restoring AWS Resources</h2>
              <p class="text-sm text-muted-foreground">Mouseketool detected a LocalStack restart and is recreating Lambda functions and pipeline resources. This may take a moment.</p>
            </div>
          </div>

          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" :key="route.fullPath" />
            </transition>
          </router-view>
        </main>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
  <CommandPalette />
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
