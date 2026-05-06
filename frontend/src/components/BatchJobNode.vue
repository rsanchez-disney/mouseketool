<script setup lang="ts">
import { computed, inject } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, Pencil, Trash2, Loader2, CheckCircle2, XCircle, Circle, Terminal } from "lucide-vue-next";

const props = defineProps<{
  id: string;
  data: { label: string; imageName?: string; envCount?: number; command?: string; status?: "idle" | "running" | "success" | "error" | "cancelled" | "unknown" };
}>();

const onEditNode = inject<(id: string) => void>("onEditNode", () => {});
const onRemoveNode = inject<(id: string) => void>("onRemoveNode", () => {});
const onOpenConsole = inject<(id: string) => void>("onOpenConsole", () => {});

const nodeClass = computed(() => {
  switch (props.data.status) {
    case "running": return "border-amber-500 bg-amber-100 dark:bg-amber-500/20 shadow-amber-500/20 shadow-md";
    case "success": return "border-emerald-500 bg-emerald-100 dark:bg-emerald-500/20 shadow-emerald-500/20 shadow-md";
    case "error": return "border-red-500 bg-red-100 dark:bg-red-500/20 shadow-red-500/20 shadow-md";
    case "cancelled": return "border-red-400 bg-red-50 dark:bg-red-500/10 shadow-red-400/10 shadow-md";
    case "unknown": return "border-zinc-400 bg-zinc-100 dark:bg-zinc-500/20 shadow-zinc-400/20 shadow-md animate-pulse";
    default: return "border-primary/30 bg-background hover:border-primary/60";
  }
});
</script>

<template>
  <Handle id="top" type="target" :position="Position.Top" class="!bg-primary !border-primary/60" />
  <Handle id="right" type="source" :position="Position.Right" class="!bg-primary !border-primary/60" />
  <Handle id="bottom" type="source" :position="Position.Bottom" class="!bg-primary !border-primary/60" />
  <Handle id="left" type="target" :position="Position.Left" class="!bg-primary !border-primary/60" />

  <div :class="['relative border-2 rounded-lg px-4 py-3 min-w-[180px] transition-all', nodeClass]">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <Loader2 v-if="data.status === 'running'" class="size-3.5 text-amber-500 animate-spin shrink-0" />
        <CheckCircle2 v-else-if="data.status === 'success'" class="size-3.5 text-emerald-500 shrink-0" />
        <XCircle v-else-if="data.status === 'error' || data.status === 'cancelled'" class="size-3.5 text-red-500 shrink-0" />
        <Circle v-else class="size-3.5 text-muted-foreground/40 shrink-0" />
        <span class="text-sm font-medium truncate">{{ data.label }}</span>
      </div>
      <TooltipProvider>
        <div class="flex items-center gap-0.5">
          <Tooltip><TooltipTrigger as-child><button class="p-0.5 rounded hover:bg-muted cursor-pointer" @click.stop="onEditNode(id)"><Pencil class="size-3 text-muted-foreground" /></button></TooltipTrigger><TooltipContent>Edit node</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger as-child><button class="p-0.5 rounded hover:bg-muted cursor-pointer" @click.stop="onOpenConsole(id)"><Terminal class="size-3 text-muted-foreground hover:text-blue-400" /></button></TooltipTrigger><TooltipContent>Open console</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger as-child><button class="p-0.5 rounded hover:bg-red-500/10 cursor-pointer" @click.stop="onRemoveNode(id)"><Trash2 class="size-3 text-muted-foreground hover:text-red-500" /></button></TooltipTrigger><TooltipContent>Delete node</TooltipContent></Tooltip>
        </div>
      </TooltipProvider>
    </div>
    <p v-if="data.imageName" class="text-[10px] text-muted-foreground truncate mt-0.5">{{ data.imageName }}</p>
    <div class="flex items-center gap-1.5 mt-1.5">
      <Badge v-if="data.status === 'cancelled'" class="text-[9px] px-1 py-0 bg-red-500/10 text-red-500 border-red-500/20">Cancelled</Badge>
      <Badge v-if="data.envCount" variant="outline" class="text-[9px] px-1 py-0">{{ data.envCount }} vars</Badge>
      <Badge v-if="data.command" variant="outline" class="text-[9px] px-1 py-0">cmd</Badge>
    </div>
  </div>
</template>
