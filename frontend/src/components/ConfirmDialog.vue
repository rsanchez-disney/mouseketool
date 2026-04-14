<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const open = defineModel<boolean>({ default: false });
defineProps<{ title?: string; description?: string }>();
const emit = defineEmits<{ confirm: [] }>();

function onConfirm() { open.value = false; emit("confirm"); }
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title ?? "Are you sure?" }}</DialogTitle>
        <DialogDescription>{{ description ?? "This action cannot be undone." }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="cursor-pointer" @click="open = false">Cancel</Button>
        <Button variant="destructive" class="cursor-pointer" @click="onConfirm">Delete</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
