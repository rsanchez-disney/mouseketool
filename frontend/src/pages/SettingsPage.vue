<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Save, Check, Loader2, Server, KeyRound, Trash2, Clock, Eye, Cpu, Flame } from "lucide-vue-next";

const settings = ref({
  localstack: { host: "localhost", port: 4566, protocol: "http" },
  aws: { accessKeyId: "test", secretAccessKey: "test", region: "us-east-1" },
  cleanup: { ttlMinutes: 1440, deleteOnStartup: false },
  pipeline: { observerPollingMs: 500 },
  lambda: { memoryMB: 2048 },
  heavyLoad: { batchSize: 1000, batchWindowSeconds: 300 },
});
const saving = ref(false);
const saved = ref(false);
const showElapsed = ref(localStorage.getItem("mk:showElapsed") !== "false");
watch(showElapsed, v => localStorage.setItem("mk:showElapsed", String(v)));

onMounted(async () => {
  const data = await (await fetch("/api/settings")).json();
  settings.value = { ...settings.value, ...data, localstack: { ...settings.value.localstack, ...data.localstack }, pipeline: { ...settings.value.pipeline, ...data.pipeline } };
});

async function save() {
  saving.value = true;
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings.value),
  });
  saving.value = false;
  saved.value = true;
  setTimeout(() => (saved.value = false), 2000);
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
      <p class="text-sm text-muted-foreground mt-1">Configure your LocalStack connection and build preferences.</p>
    </div>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Server class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>LocalStack Connection</CardTitle>
            <CardDescription>The endpoint where your LocalStack instance is running.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid grid-cols-[auto_1fr_auto] gap-4 items-end">
        <div class="space-y-2">
          <Label>Protocol</Label>
          <Select v-model="settings.localstack.protocol">
            <SelectTrigger class="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">http</SelectItem>
              <SelectItem value="https">https</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-2">
          <Label for="host">Host / IP Address</Label>
          <Input id="host" v-model="settings.localstack.host" placeholder="localhost" />
        </div>
        <div class="space-y-2">
          <Label for="port">Port</Label>
          <Input id="port" v-model.number="settings.localstack.port" type="number" placeholder="4566" />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <KeyRound class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>AWS Credentials</CardTitle>
            <CardDescription>Credentials used to authenticate with LocalStack. Typically dummy values.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="ak">Access Key ID</Label>
            <Input id="ak" v-model="settings.aws.accessKeyId" />
          </div>
          <div class="space-y-2">
            <Label for="sk">Secret Access Key</Label>
            <Input id="sk" v-model="settings.aws.secretAccessKey" type="password" />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="region">Region</Label>
          <Input id="region" v-model="settings.aws.region" placeholder="us-east-1" />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Trash2 class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>Build Cleanup</CardTitle>
            <CardDescription>Cached builds older than this threshold are automatically deleted.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <Label for="ttl">Auto-delete after (minutes)</Label>
        <Input id="ttl" v-model.number="settings.cleanup.ttlMinutes" type="number" class="max-w-48" />
        <p class="text-xs text-muted-foreground">Default: 1440 minutes (24 hours)</p>
        <div class="flex items-center gap-3 pt-3 border-t mt-3">
          <Switch v-model="settings.cleanup.deleteOnStartup" class="cursor-pointer" />
          <div><Label class="text-sm">Delete all cached builds on startup</Label><p class="text-xs text-muted-foreground">When enabled, all cached builds are removed every time the backend starts.</p></div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Clock class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>Observer Polling Interval</CardTitle>
            <CardDescription>How frequently pipeline observers poll LocalStack for SQS and CloudWatch updates.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <Label for="observerPolling">Interval (milliseconds)</Label>
        <Input id="observerPolling" v-model.number="settings.pipeline.observerPollingMs" type="number" min="100" max="5000" step="100" class="max-w-48" />
        <p class="text-xs text-muted-foreground">Default: 500ms. Controls how often observers check SQS queues and CloudWatch logs during pipeline execution.</p>
        <p class="text-xs text-amber-500">Lower values detect changes faster but increase load on LocalStack. Higher values reduce load but may miss fast-moving messages in SQS.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Cpu class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>Lambda</CardTitle>
            <CardDescription>Default configuration applied when deploying functions</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <Label for="lambdaMemory">Memory (MB)</Label>
        <select id="lambdaMemory" v-model.number="settings.lambda.memoryMB" class="h-9 text-sm bg-zinc-900 border border-zinc-700 rounded-md px-3 text-zinc-200 outline-none max-w-48">
          <option v-for="m in [128, 256, 512, 1024, 1536, 2048, 3008]" :key="m" :value="m">{{ m }} MB</option>
        </select>
        <p class="text-xs text-muted-foreground">Applied to every Lambda deployed from the Builder page. Default: 2048 MB.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Flame class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>Heavy Load</CardTitle>
            <CardDescription>Batch settings for pipelines with heavy load enabled</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-2">
        <Label for="hlBatchSize">Batch Size</Label>
        <Input id="hlBatchSize" v-model.number="settings.heavyLoad.batchSize" type="number" min="1" max="10000" class="max-w-48" />
        <p class="text-xs text-muted-foreground">Max records per stream handler invocation. Default: 1000.</p>
        <Label for="hlWindow">Batch Window (seconds)</Label>
        <Input id="hlWindow" v-model.number="settings.heavyLoad.batchWindowSeconds" type="number" min="1" max="300" class="max-w-48" />
        <p class="text-xs text-muted-foreground">Max wait time before firing. Default: 300s (5 min). Applied on pipeline creation or edit.</p>
        <p class="text-xs text-amber-500">Saving these settings will immediately update all pipelines that have heavy load enabled.</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Eye class="size-5 text-muted-foreground" />
          <div>
            <CardTitle>UI Preferences</CardTitle>
            <CardDescription>Customize how information is displayed in the app.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch v-model="showElapsed" class="cursor-pointer" />
          <div><Label class="text-sm">Show elapsed time on history cards</Label><p class="text-xs text-muted-foreground">Display how long each pipeline step took to complete.</p></div>
        </div>
      </CardContent>
    </Card>

    <Button @click="save" :disabled="saving" class="gap-2 cursor-pointer active:scale-95 transition-transform">
      <Loader2 v-if="saving" class="size-4 animate-spin" />
      <Check v-else-if="saved" class="size-4" />
      <Save v-else class="size-4" />
      {{ saving ? "Saving..." : saved ? "Saved" : "Save Settings" }}
    </Button>
  </div>
</template>
