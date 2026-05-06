<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from "vue";
import "@/monaco-env";
import * as monaco from "monaco-editor";
import yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import EvaluateModal from "@/components/EvaluateModal.vue";
import { Wand2, Sparkles, Download, Loader2, Play, Plus, HeartPulse, ArrowLeft, Container, MessageSquare } from "lucide-vue-next";

interface ChatMessage {
  role: "assistant";
  content: string;
  yaml?: string;
}

interface BatchProject {
  name: string;
  imageTag?: string;
}

const props = defineProps<{ modelValue: string; builds?: BatchProject[]; workflowId?: string }>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  apply: [yaml: string];
  action: [payload: { action: string; serviceName?: string }];
}>();

// Monaco
const editorContainer = ref<HTMLElement | null>(null);
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
let ignoreChange = false;

function isDark() { return document.documentElement.classList.contains("dark"); }

function defineThemes() {
  monaco.editor.defineTheme("mouseketool-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "key", foreground: "18181b", fontStyle: "bold" },
      { token: "string", foreground: "16a34a" },
      { token: "number", foreground: "2563eb" },
      { token: "comment", foreground: "a1a1aa", fontStyle: "italic" },
      { token: "type", foreground: "9333ea" },
    ],
    colors: {
      "editor.background": "#fafafa",
      "editor.foreground": "#18181b",
      "editor.lineHighlightBackground": "#f4f4f5",
      "editor.selectionBackground": "#e4e4e7",
      "editorLineNumber.foreground": "#a1a1aa",
      "editorLineNumber.activeForeground": "#52525b",
      "editorCursor.foreground": "#18181b",
      "editor.inactiveSelectionBackground": "#e4e4e780",
      "editorIndentGuide.background": "#e4e4e7",
      "editorIndentGuide.activeBackground": "#a1a1aa",
      "scrollbarSlider.background": "#00000020",
      "scrollbarSlider.hoverBackground": "#00000035",
    },
  });
  monaco.editor.defineTheme("mouseketool-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "key", foreground: "e4e4e7", fontStyle: "bold" },
      { token: "string", foreground: "4ade80" },
      { token: "number", foreground: "60a5fa" },
      { token: "comment", foreground: "71717a", fontStyle: "italic" },
      { token: "type", foreground: "c084fc" },
    ],
    colors: {
      "editor.background": "#1c1c1c",
      "editor.foreground": "#e4e4e7",
      "editor.lineHighlightBackground": "#27272a",
      "editor.selectionBackground": "#3f3f46",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editorCursor.foreground": "#e4e4e7",
      "editor.inactiveSelectionBackground": "#3f3f4680",
      "editorIndentGuide.background": "#27272a",
      "editorIndentGuide.activeBackground": "#52525b",
      "scrollbarSlider.background": "#ffffff15",
      "scrollbarSlider.hoverBackground": "#ffffff25",
    },
  });
}

onMounted(() => {
  if (!editorContainer.value) return;
  defineThemes();
  editorInstance = monaco.editor.create(editorContainer.value, {
    value: props.modelValue, language: "yaml", theme: isDark() ? "mouseketool-dark" : "mouseketool-light",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace", fontLigatures: true,
    minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false,
    automaticLayout: true, tabSize: 2, wordWrap: "on", formatOnPaste: true,
  });
  editorInstance.onDidChangeModelContent(() => { if (!ignoreChange) emit("update:modelValue", editorInstance!.getValue()); });
});
onUnmounted(() => editorInstance?.dispose());
watch(() => props.modelValue, (val) => {
  if (editorInstance && editorInstance.getValue() !== val) { ignoreChange = true; editorInstance.setValue(val); ignoreChange = false; }
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savingDisabled = false;
let pendingContent = "";
function saveNow() {
  if (savingDisabled || !props.workflowId || !pendingContent.trim()) return;
  fetch(`/api/batch-workflows/${props.workflowId}/save-compose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: pendingContent }) }).catch(() => {});
}
watch(() => props.modelValue, (val) => {
  if (!props.workflowId || !val.trim()) return;
  pendingContent = val;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
});
onUnmounted(() => { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } });

let obs: MutationObserver | null = null;
onMounted(() => { obs = new MutationObserver(() => monaco.editor.setTheme(isDark() ? "mouseketool-dark" : "mouseketool-light")); obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); });
onUnmounted(() => obs?.disconnect());

function downloadYaml() {
  const blob = new Blob([props.modelValue], { type: "application/x-yaml" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "docker-compose.yml"; a.click(); URL.revokeObjectURL(a.href);
}

// Action panel
const messages = ref<ChatMessage[]>([]);
const loading = ref(false);
const chatScroll = ref<HTMLElement | null>(null);
const showAddServiceInput = ref(false);
const addServiceName = ref("");
const showBatchSelect = ref(false);
const showEvaluate = ref(false);
const evaluated = ref(false);
const lastAiResponse = ref("");

const hasYaml = computed(() => !!props.modelValue.trim());


function scrollChat() { nextTick(() => chatScroll.value?.scrollTo({ top: chatScroll.value.scrollHeight, behavior: "smooth" })); }
const yamlValid = computed(() => { try { const doc = yaml.load(props.modelValue); return doc && typeof doc === "object" && !!(doc as any).services; } catch { return false; } });

function disableSaveAndApply(yaml: string) { savingDisabled = true; if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } emit("apply", yaml); }
function applyYaml(yaml: string) { disableSaveAndApply(yaml); }
function emitAction(action: string, serviceName?: string) { loading.value = true; showAddServiceInput.value = false; showBatchSelect.value = false; emit("action", { action, serviceName }); }
function submitAddService() { const n = addServiceName.value.trim(); if (!n) return; addServiceName.value = ""; emitAction("add-service", n); }
function selectBatch(name: string) { emitAction("add-service", name); }

function pushAssistantMessage(content: string, yaml?: string) {
  loading.value = false; messages.value.push({ role: "assistant", content, yaml });
  lastAiResponse.value = yaml || content; evaluated.value = false;
  if (yaml) { emit("update:modelValue", yaml); pendingContent = yaml; saveNow(); }
  scrollChat();
}
function setLoading(val: boolean) { loading.value = val; }
defineExpose({ pushAssistantMessage, setLoading });
</script>

<template>
  <div class="flex h-full border rounded-lg overflow-hidden bg-background">
    <!-- Left: Editor -->
    <div class="flex flex-col" style="width: 60%">
      <div class="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/30">
        <span class="text-xs font-medium text-muted-foreground mr-auto">docker-compose.yml</span>
        <Button v-if="lastAiResponse && !evaluated" variant="ghost" size="sm" class="h-6 text-xs gap-1 cursor-pointer text-muted-foreground hover:text-foreground" @click="showEvaluate = true">
          <MessageSquare class="size-3" /> Evaluate
        </Button>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="sm" class="gap-1.5 cursor-pointer" :disabled="loading || !yamlValid" @click="disableSaveAndApply(modelValue)">
              <Wand2 class="size-3.5" /> Apply to Canvas
            </Button>
          </TooltipTrigger>
          <TooltipContent>Parse YAML and create workflow nodes</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="size-8 cursor-pointer" :disabled="loading" @click="downloadYaml">
              <Download class="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download YAML</TooltipContent>
        </Tooltip>
      </div>
      <div class="flex-1 relative">
        <div ref="editorContainer" class="absolute inset-0" />
        <!-- Loading overlay -->
        <div v-if="loading" class="absolute inset-0 bg-background/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10">
          <div class="relative flex items-center justify-center">
            <div class="absolute size-20 rounded-full bg-purple-500/20 animate-ping" />
            <div class="absolute size-14 rounded-full bg-purple-500/10 animate-pulse" />
            <Sparkles class="size-8 text-purple-500 animate-bounce relative z-10" />
          </div>
          <p class="text-sm font-medium bg-gradient-to-r from-purple-500 to-violet-400 bg-clip-text text-transparent animate-pulse">
            Kiro is crafting your compose...
          </p>
          <div class="flex gap-1">
            <span class="size-1.5 rounded-full bg-purple-500 animate-bounce" style="animation-delay: 0ms" />
            <span class="size-1.5 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 150ms" />
            <span class="size-1.5 rounded-full bg-violet-400 animate-bounce" style="animation-delay: 300ms" />
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Actions / Results -->
    <div class="flex flex-col border-l" style="width: 40%">
      <div class="px-3 py-2 border-b bg-muted/30">
        <span class="text-xs font-medium text-muted-foreground">AI Assistant</span>
      </div>

      <div ref="chatScroll" class="flex-1 overflow-y-auto p-3 space-y-3">
        <!-- Action Panel -->
        <div class="flex flex-col gap-3">
          <div class="flex flex-col items-center gap-1 pt-4 pb-2">
            <Sparkles class="size-6 text-purple-500" />
            <p class="text-sm font-semibold">Compose Actions</p>
            <p class="text-xs text-muted-foreground">Let Kiro help you build your compose file</p>
          </div>

          <!-- Generate -->
          <button class="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors text-left w-full disabled:opacity-40 disabled:cursor-not-allowed" :disabled="loading" @click="emitAction('generate')">
            <div class="flex items-start gap-2.5">
              <Sparkles class="size-4 text-purple-500 shrink-0 mt-0.5" />
              <div>
                <p class="text-sm font-bold">Generate Compose</p>
                <p class="text-xs text-muted-foreground">Create a complete compose from your registered projects</p>
              </div>
            </div>
          </button>

          <!-- Add Batch Project -->
          <div>
            <Tooltip :disabled="hasYaml">
              <TooltipTrigger as-child>
                <button class="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors text-left w-full disabled:opacity-40 disabled:cursor-not-allowed" :disabled="loading || !hasYaml || !props.builds?.length" @click="showBatchSelect = !showBatchSelect; showAddServiceInput = false">
                  <div class="flex items-start gap-2.5">
                    <Container class="size-4 text-purple-500 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-bold">Add Batch Project</p>
                      <p class="text-xs text-muted-foreground">Add a registered batch project to your compose</p>
                    </div>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent v-if="!hasYaml">Write or generate a compose first</TooltipContent>
            </Tooltip>
            <div v-if="showBatchSelect" class="flex flex-col gap-1 mt-2 pl-2">
              <button v-for="b in props.builds" :key="b.name" class="flex items-center gap-2 px-3 py-2 rounded-md border text-left hover:bg-muted/50 cursor-pointer transition-colors text-xs" @click="selectBatch(b.name)">
                <Container class="size-3.5 text-muted-foreground shrink-0" />
                <span class="font-medium">{{ b.name }}</span>
                <span v-if="b.imageTag" class="text-muted-foreground ml-auto truncate max-w-[120px]">{{ b.imageTag }}</span>
              </button>
            </div>
          </div>

          <!-- Add Service -->
          <div>
            <Tooltip :disabled="hasYaml">
              <TooltipTrigger as-child>
                <button class="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors text-left w-full disabled:opacity-40 disabled:cursor-not-allowed" :disabled="loading || !hasYaml" @click="showAddServiceInput = !showAddServiceInput; showBatchSelect = false">
                  <div class="flex items-start gap-2.5">
                    <Plus class="size-4 text-purple-500 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-bold">Add Service</p>
                      <p class="text-xs text-muted-foreground">Add a new infrastructure service (mysql, redis, etc.)</p>
                    </div>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent v-if="!hasYaml">Write or generate a compose first</TooltipContent>
            </Tooltip>
            <div v-if="showAddServiceInput" class="flex items-center gap-2 mt-2 pl-2">
              <Input v-model="addServiceName" placeholder="e.g. mysql, redis, sftp" class="text-xs flex-1" @keydown.enter="submitAddService" />
              <Button size="sm" class="h-8 text-xs cursor-pointer" :disabled="!addServiceName.trim()" @click="submitAddService">Add</Button>
            </div>
          </div>

          <!-- Add Healthchecks -->
          <Tooltip :disabled="hasYaml">
            <TooltipTrigger as-child>
              <button class="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors text-left w-full disabled:opacity-40 disabled:cursor-not-allowed" :disabled="loading || !hasYaml" @click="emitAction('add-healthchecks')">
                <div class="flex items-start gap-2.5">
                  <HeartPulse class="size-4 text-purple-500 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-sm font-bold">Add Healthchecks</p>
                    <p class="text-xs text-muted-foreground">Add healthchecks to services that don't have one</p>
                  </div>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent v-if="!hasYaml">Write or generate a compose first</TooltipContent>
          </Tooltip>


          <!-- Explain -->
        </div>

      </div>
    </div>
    <EvaluateModal v-model="showEvaluate" type="compose" id="compose-studio" :sample="lastAiResponse" @good="evaluated = true" @bad="evaluated = true" />
  </div>
</template>
