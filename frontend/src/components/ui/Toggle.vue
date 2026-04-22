<script setup lang="ts">
const checked = defineModel<boolean>({ default: false });
defineProps<{ disabled?: boolean }>();
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    @click="checked = !checked"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="checked ? 'bg-primary' : 'bg-input'"
  >
    <span
      class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"
      :class="checked ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>
