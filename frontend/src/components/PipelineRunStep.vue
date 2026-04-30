<script setup lang="ts">
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import LogViewer from "@/components/LogViewer.vue";
import { Database, Zap, Bell, Inbox, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-vue-next";

const iconMap: Record<string, any> = { Database, Zap, Bell, Inbox };

const props = defineProps<{
  icon: string;
  label: string;
  detail: string;
  status: string;
  logs: string[];
  expanded: boolean;
  showConnector: boolean;
  showKiroHint?: boolean;
  aiExplaining?: boolean;
  aiExplanation?: string;
}>();

const emit = defineEmits<{ toggle: []; explain: []; expand: [logs: string[]] }>();

const rootCauseLines = computed(() =>
  props.logs.filter(l => l.includes("Caused by") || l.includes("FunctionError") || l.includes("errorMessage") || l.includes("Error:") || l.includes("errorType") || l.includes("Type:") || l.includes('"Level":"ERROR"') || l.includes('"Level": "ERROR"'))
);

const statusColor: Record<string, string> = {
  success: "green-500", error: "red-500", filtered: "blue-400",
  timeout: "amber-500", pending: "zinc-500", diagnosing: "purple-500",
  skipped: "zinc-500", running: "amber-500",
};

function color(status: string) { return statusColor[status] || "zinc-500"; }
</script>

<template>
  <div>
    <div class="border rounded-lg overflow-hidden" :class="[
      status === 'running' ? 'border-primary shadow-md shadow-primary/10' :
      status === 'pending' || status === 'skipped' ? 'border-dashed opacity-60' :
      `border-${color(status)}/40`
    ]">
      <button class="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer hover:bg-muted/30" @click="emit('toggle')">
        <div class="size-6 rounded-full flex items-center justify-center" :class="[
          status === 'running' ? 'bg-primary/20' : status === 'pending' || status === 'skipped' ? 'bg-muted' : `bg-${color(status)}/20`
        ]">
          <Loader2 v-if="status === 'running'" class="size-3 animate-spin text-primary" />
          <AlertTriangle v-else-if="status === 'error' || status === 'timeout'" class="size-3" :class="`text-${color(status)}`" />
          <component v-else-if="status !== 'running'" :is="iconMap[icon] || Zap" class="size-3" :class="[
            status === 'pending' || status === 'skipped' ? 'text-muted-foreground' : `text-${color(status)}`
          ]" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold">{{ label }}</p>
          <p class="text-[10px] text-muted-foreground font-mono truncate">{{ detail }}</p>
        </div>
        <Badge :class="[
          status === 'pending' || status === 'skipped' ? 'bg-muted text-muted-foreground' :
          status === 'filtered' ? 'bg-blue-400/20 text-blue-400 border-blue-400/40' :
          status === 'success' ? 'bg-green-500/20 text-green-500 border-green-500/40' :
          status === 'error' || status === 'timeout' ? 'bg-red-500/20 text-red-500 border-red-500/40' :
          status === 'diagnosing' ? 'bg-purple-500/20 text-purple-500 border-purple-500/40' :
          'bg-amber-500/20 text-amber-500 border-amber-500/40'
        ]" class="text-[10px]">{{ status }}</Badge>
        <ChevronDown v-if="expanded" class="size-3.5 text-muted-foreground" />
        <ChevronRight v-else class="size-3.5 text-muted-foreground" />
      </button>
      <LogViewer
        v-if="expanded && logs.length"
        :logs="logs"
        :wrap="false"
        :root-cause-lines="rootCauseLines"
        :kiro-available="showKiroHint"
        :ai-explaining="aiExplaining"
        :ai-explanation="aiExplanation"
        :height="logs.length > 3 ? 'h-48' : 'h-auto'"
        @explain="emit('explain')"
      >
        <template v-if="showKiroHint" #after-root-cause-mini>
          <div class="mt-2 flex items-center gap-1.5 text-[10px] text-violet-400/70 font-medium"><svg class="size-3 shrink-0" viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="khi4" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#khi4)"><path d="M398.554 818.914C316.315 1001.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 333.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C615.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" fill="black"/></g></svg> Expand to use Kiro Assistance</div>
        </template>
      </LogViewer>
    </div>
    <div v-if="showConnector" class="pl-[11px]">
      <div class="w-0.5 h-4" :class="[
        status === 'success' ? 'bg-green-500' :
        status === 'error' || status === 'timeout' ? 'bg-red-500' :
        status === 'filtered' ? 'bg-blue-400' :
        'bg-border'
      ]" />
    </div>
  </div>
</template>
