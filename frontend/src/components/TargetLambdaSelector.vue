<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Zap, Loader2, RefreshCw, Search } from "lucide-vue-next";

interface LambdaFunc { name: string; runtime: string; handler: string; arn: string; templateId?: string | null; }

const props = defineProps<{ usedFunctions?: Set<string> }>();
const emit = defineEmits<{ (e: "select", fn: LambdaFunc): void }>();

const functions = ref<LambdaFunc[]>([]);
const loading = ref(false);
const search = ref("");
const selected = ref<LambdaFunc | null>(null);

const filtered = computed(() => {
  const q = search.value.toLowerCase();
  return functions.value
    .filter(f => !f.templateId && !f.name.startsWith("mouseketool-"))
    .filter(f => !q || f.name.toLowerCase().includes(q) || f.handler.toLowerCase().includes(q));
});

async function loadFunctions() {
  loading.value = true;
  try { functions.value = await (await fetch("/api/triggers/functions")).json(); } catch { functions.value = []; }
  loading.value = false;
}

function selectFn(fn: LambdaFunc) {
  if (props.usedFunctions?.has(fn.name)) return;
  selected.value = fn;
  emit("select", fn);
}

onMounted(loadFunctions);
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" @click="loadFunctions"><RefreshCw class="size-3.5" /> Refresh</Button>
      <div class="relative flex-1 max-w-xs">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input v-model="search" placeholder="Filter functions..." class="pl-8 h-8 text-xs" />
      </div>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
      <Loader2 class="size-8 animate-spin" /><p class="text-sm">Loading functions...</p>
    </div>
    <div v-else-if="!filtered.length" class="text-center py-12 text-muted-foreground">
      <Zap class="size-12 mx-auto mb-4 opacity-30" /><p>No Lambda functions available.</p><p class="text-xs mt-1">Deploy a function first from the Deployments page.</p>
    </div>
    <div v-else class="space-y-2">
      <Tooltip v-for="fn in filtered" :key="fn.name" :disabled="!usedFunctions?.has(fn.name)">
        <TooltipTrigger as-child>
          <Card class="!py-2 transition-all" :class="[selected?.name === fn.name ? 'border-primary ring-1 ring-primary/20' : '', usedFunctions?.has(fn.name) ? 'border-dashed opacity-50 cursor-not-allowed' : 'hover:border-primary/50 cursor-pointer']" @click="selectFn(fn)">
            <CardContent class="py-2 flex items-center gap-3">
              <div class="size-8 rounded-full bg-primary/10 flex items-center justify-center"><Zap class="size-4 text-primary" /></div>
              <div class="flex-1 min-w-0">
                <p class="font-mono text-sm font-semibold truncate">{{ fn.name }}</p>
                <p class="text-xs text-muted-foreground truncate">{{ fn.handler }}</p>
              </div>
              <Badge variant="secondary" class="text-[10px]">{{ fn.runtime }}</Badge>
              <Badge v-if="usedFunctions?.has(fn.name)" class="bg-amber-500/20 text-amber-500 border-amber-500/40 text-[10px]">In use</Badge>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent>This function is already used by another pipeline</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
