<script setup lang="ts">
import { ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, FolderUp, FolderOpen, Folder, File } from "lucide-vue-next";

interface FsItem { name: string; path: string; isDirectory: boolean }

const open = defineModel<boolean>({ default: false });
const props = defineProps<{ title?: string; description?: string; initialPath?: string; scrollHeight?: string; mode?: "directory" | "file"; fileFilter?: string }>();
const emit = defineEmits<{ select: [path: string] }>();
const selectedFile = ref("");
function fileMatchesFilter(name: string) { if (!props.fileFilter) return true; try { return new RegExp(props.fileFilter, 'i').test(name); } catch { return true; } }

const browserPath = ref("");
const browserParent = ref("");
const browserItems = ref<FsItem[]>([]);
const browserLoading = ref(false);

async function browse(path?: string) {
  browserLoading.value = true; selectedFile.value = "";
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  const data = await (await fetch(`/api/fs${q}`)).json();
  browserPath.value = data.path;
  browserParent.value = data.parent;
  browserItems.value = data.items;
  browserLoading.value = false;
}

watch(open, (v) => { if (v) browse(props.initialPath || undefined); });

function select() {
  emit("select", props.mode === "file" ? selectedFile.value : browserPath.value);
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>{{ title ?? "Select Directory" }}</DialogTitle>
        <DialogDescription>{{ description ?? "Navigate to the target folder." }}</DialogDescription>
      </DialogHeader>

      <div class="flex items-center gap-2 py-2 shrink-0">
        <Button @click="browse(browserParent)" variant="outline" size="sm" :disabled="browserPath === browserParent" class="gap-1.5">
          <FolderUp class="size-4" /> Up
        </Button>
        <code class="text-xs bg-muted rounded-md px-3 py-1.5 flex-1 truncate">{{ browserPath }}</code>
      </div>

      <ScrollArea class="rounded-md border" :style="{ height: props.scrollHeight ?? 'min(50vh, 400px)' }">
        <div v-if="browserLoading" class="flex justify-center p-8">
          <Loader2 class="size-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else class="p-1">
          <button
            v-for="item in browserItems"
            :key="item.path"
            @click="item.isDirectory ? browse(item.path) : (props.mode === 'file' && fileMatchesFilter(item.name) ? (selectedFile = item.path) : undefined)"
            :disabled="!item.isDirectory && (props.mode !== 'file' || !fileMatchesFilter(item.name))"
            :class="['w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-default hover:enabled:bg-accent', !item.isDirectory && selectedFile === item.path ? 'bg-primary/10 ring-1 ring-primary' : '']"
          >
            <Folder v-if="item.isDirectory" class="size-4 text-primary shrink-0" />
            <File v-else class="size-4 text-muted-foreground shrink-0" />
            <span class="truncate">{{ item.name }}</span>
          </button>
        </div>
      </ScrollArea>

      <DialogFooter class="shrink-0">
        <Button @click="open = false" variant="outline">Cancel</Button>
        <Button @click="select" :disabled="props.mode === 'file' && !selectedFile" class="gap-2 cursor-pointer">
          <FolderOpen class="size-4" /> {{ props.mode === 'file' ? 'Select File' : 'Select This Folder' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
