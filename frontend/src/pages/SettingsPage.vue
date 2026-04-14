<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Save, Check, Loader2, Server, KeyRound, Trash2 } from "lucide-vue-next";

const settings = ref({
  localstack: { host: "localhost", port: 4566 },
  aws: { accessKeyId: "test", secretAccessKey: "test", region: "us-east-1" },
  cleanup: { ttlMinutes: 1440 },
});
const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  settings.value = await (await fetch("/api/settings")).json();
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
      </CardContent>
    </Card>

    <Button @click="save" :disabled="saving" class="gap-2">
      <Loader2 v-if="saving" class="size-4 animate-spin" />
      <Check v-else-if="saved" class="size-4" />
      <Save v-else class="size-4" />
      {{ saving ? "Saving..." : saved ? "Saved" : "Save Settings" }}
    </Button>
  </div>
</template>
