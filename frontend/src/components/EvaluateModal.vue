<script setup lang="ts">
import { ref } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Loader2, Check } from "lucide-vue-next";

const open = defineModel<boolean>({ default: false });
const props = defineProps<{ type: string; id: string; sample: string }>();
const emit = defineEmits<{ good: []; bad: [reason: string] }>();

const step = ref<"choose" | "feedback" | "done">("choose");
const reason = ref("");
const saving = ref(false);

function reset() { step.value = "choose"; reason.value = ""; saving.value = false; }
function onOpen(v: boolean) { if (v) reset(); }

async function saveGood() {
  saving.value = true;
  await fetch("/api/ai/save-generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: props.type, id: props.id, content: props.sample }) });
  saving.value = false; step.value = "done"; emit("good");
}

async function saveBad() {
  if (!reason.value.trim()) return;
  saving.value = true;
  await fetch("/api/ai/save-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: props.type, id: props.id, sample: props.sample, reason: reason.value }) });
  saving.value = false; step.value = "done"; emit("bad", reason.value);
}
</script>

<template>
  <Dialog v-model:open="open" @update:open="onOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Evaluate AI Sample</DialogTitle>
        <DialogDescription>How was the quality of the generated sample?</DialogDescription>
      </DialogHeader>

      <div v-if="step === 'choose'" class="flex gap-3 py-2">
        <Button variant="outline" class="flex-1 gap-2 cursor-pointer h-16 flex-col" @click="saveGood" :disabled="saving">
          <ThumbsUp class="size-5 text-green-500" />
          <span class="text-xs">Good</span>
        </Button>
        <Button variant="outline" class="flex-1 gap-2 cursor-pointer h-16 flex-col" @click="step = 'feedback'">
          <ThumbsDown class="size-5 text-red-500" />
          <span class="text-xs">Bad</span>
        </Button>
      </div>

      <div v-else-if="step === 'feedback'" class="space-y-3 py-2">
        <p class="text-sm text-muted-foreground">What was wrong with the generated sample?</p>
        <textarea v-model="reason" rows="4" class="w-full rounded-md border bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" placeholder="e.g. Missing required field 'orderId', values were unrealistic, wrong data types..." />
        <DialogFooter class="gap-2">
          <Button variant="outline" size="sm" class="cursor-pointer" @click="step = 'choose'">Back</Button>
          <Button size="sm" class="gap-1.5 cursor-pointer" :disabled="!reason.trim() || saving" @click="saveBad">
            <Loader2 v-if="saving" class="size-3.5 animate-spin" />
            Send Feedback
          </Button>
        </DialogFooter>
      </div>

      <div v-else class="flex flex-col items-center gap-2 py-4">
        <Check class="size-8 text-green-500" />
        <p class="text-sm font-medium">Thanks for the feedback!</p>
        <p class="text-xs text-muted-foreground">Kiro will use this to improve future generations.</p>
        <Button variant="outline" size="sm" class="mt-2 cursor-pointer" @click="open = false">Close</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
