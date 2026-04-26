<script setup lang="ts">
import { inject } from "vue";
import { Handle, Position } from "@vue-flow/core";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-vue-next";

defineProps<{
  id: string;
  data: { label: string; imageName?: string; envCount?: number; command?: string };
}>();

const onEditNode = inject<(id: string) => void>("onEditNode", () => {});
const onRemoveNode = inject<(id: string) => void>("onRemoveNode", () => {});
</script>

<template>
  <Handle id="top-src" type="source" :position="Position.Top" class="!bg-emerald-500 !border-emerald-300" />
  <Handle id="right-src" type="source" :position="Position.Right" class="!bg-emerald-500 !border-emerald-300" />
  <Handle id="bottom-tgt" type="target" :position="Position.Bottom" class="!bg-violet-500 !border-violet-300" />
  <Handle id="left-tgt" type="target" :position="Position.Left" class="!bg-violet-500 !border-violet-300" />
  <div class="bg-background border-2 border-primary/30 rounded-lg px-4 py-3 min-w-[180px] shadow-sm hover:border-primary/60 transition-colors">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium truncate">{{ data.label }}</span>
      <div class="flex items-center gap-0.5">
        <button class="p-0.5 rounded hover:bg-muted cursor-pointer" @click.stop="onEditNode(id)"><Pencil class="size-3 text-muted-foreground" /></button>
        <button class="p-0.5 rounded hover:bg-red-500/10 cursor-pointer" @click.stop="onRemoveNode(id)"><Trash2 class="size-3 text-muted-foreground hover:text-red-500" /></button>
      </div>
    </div>
    <p v-if="data.imageName" class="text-[10px] text-muted-foreground truncate mt-0.5">{{ data.imageName }}</p>
    <div class="flex items-center gap-1.5 mt-1.5">
      <Badge v-if="data.envCount" variant="outline" class="text-[9px] px-1 py-0">{{ data.envCount }} vars</Badge>
      <Badge v-if="data.command" variant="outline" class="text-[9px] px-1 py-0">cmd</Badge>
    </div>
  </div>
</template>
