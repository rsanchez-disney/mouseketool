<script setup lang="ts">
import { cn } from "@/lib/utils";
import { TabsList as TabsListPrimitive, type TabsListProps } from "reka-ui";
import { computed } from "vue";

const props = defineProps<TabsListProps & { class?: string }>();
const delegated = computed(() => { const { class: _, ...rest } = props; return rest; });
</script>

<template>
  <TabsListPrimitive v-bind="delegated" :class="cn('inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground', props.class)">
    <slot />
  </TabsListPrimitive>
</template>
