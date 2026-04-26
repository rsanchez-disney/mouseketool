<script setup lang="ts">
import { cn } from "@/lib/utils";
import { TabsContent as TabsContentPrimitive, type TabsContentProps } from "reka-ui";
import { computed } from "vue";

const props = defineProps<TabsContentProps & { class?: string }>();
const delegated = computed(() => { const { class: _, ...rest } = props; return rest; });
</script>

<template>
  <TabsContentPrimitive v-bind="delegated" :class="cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', props.class)">
    <slot />
  </TabsContentPrimitive>
</template>
