<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarInset, SidebarTrigger, SidebarSeparator,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Rocket, Settings, Sun, Moon, CloudCog, CircleHelp } from "lucide-vue-next";

const route = useRoute();
const dark = ref(false);

watchEffect(() => {
  document.documentElement.classList.toggle("dark", dark.value);
});

const nav = [
  { label: "Lambda Builder", path: "/builder", icon: Rocket },
  { label: "Deployments", path: "/deployments", icon: CloudCog },
  { label: "Settings", path: "/settings", icon: Settings },
];
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
                    <span class="text-xs text-muted-foreground">Lambda Dev Workbench</span>
                  </div>
                </router-link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in nav" :key="item.path">
                  <SidebarMenuButton as-child :is-active="route.path === item.path">
                    <router-link :to="item.path" class="flex items-center gap-2">
                      <component :is="item.icon" class="size-4" />
                      <span>{{ item.label }}</span>
                    </router-link>
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
                  <Button variant="ghost" size="icon" class="size-8 cursor-pointer" @click="dark = !dark">
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
            {{ nav.find(n => n.path === route.path)?.label ?? 'Mouseketool' }}
          </span>
          <div class="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8" as-child>
                  <router-link to="/help"><CircleHelp class="size-4" /></router-link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Help & Guides</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main class="flex-1 p-6">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
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
