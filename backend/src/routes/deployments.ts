import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { execFile } from "child_process";
import { join } from "path";
import { GetFunctionCommand, InvokeCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { CloudWatchLogsClient, DescribeLogStreamsCommand, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DEPLOYMENTS_FILE, SETTINGS_DIR, BUILDS_DIR } from "../config/constants.js";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { loadSettings } from "../helpers/settings.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

async function getCWClient() {
  const s = await loadSettings();
  return new CloudWatchLogsClient({
    endpoint: `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}`,
    region: s.aws.region,
    credentials: { accessKeyId: s.aws.accessKeyId, secretAccessKey: s.aws.secretAccessKey },
  });
}

export async function fetchLambdaLogs(functionName: string): Promise<string[]> {
  try {
    const cw = await getCWClient();
    const logGroup = `/aws/lambda/${functionName}`;
    const streams = await cw.send(new DescribeLogStreamsCommand({ logGroupName: logGroup, orderBy: "LastEventTime", descending: true, limit: 1 }));
    const streamName = streams.logStreams?.[0]?.logStreamName;
    if (!streamName) return [];
    const events = await cw.send(new GetLogEventsCommand({ logGroupName: logGroup, logStreamName: streamName, startFromHead: true, limit: 200 }));
    return (events.events || []).map(e => e.message?.trimEnd() || "").filter(Boolean);
  } catch { return []; }
}

async function checkStatus(d: any, client: any): Promise<void> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const fn = await client.send(new GetFunctionCommand({ FunctionName: d.functionName }), { abortSignal: ac.signal });
    clearTimeout(timer);
    d.status = fn.Configuration?.State === "Failed" ? "failed" : "active";
    d.config = {
      memorySize: fn.Configuration?.MemorySize ?? null,
      timeout: fn.Configuration?.Timeout ?? null,
      codeSize: fn.Configuration?.CodeSize ?? null,
    };
  } catch { d.status = "unknown"; }
}

async function loadDeployments(): Promise<any[]> {
  return readFile(DEPLOYMENTS_FILE, "utf-8").then(d => JSON.parse(d)).catch(() => []);
}

async function saveDeployments(deployments: any[]): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
}

router.get("/", async (_req, res) => {
  const deployments = await loadDeployments();
  try {
    const client = await getLambdaClient();
    await Promise.all(deployments.map((d: any) => checkStatus(d, client)));
  } catch {}
  res.json(deployments);
});

router.delete("/:functionName", async (req, res) => {
  try {
    const deployments = await loadDeployments();
    const filtered = deployments.filter((d: any) => d.functionName !== req.params.functionName);
    if (filtered.length === deployments.length) return res.status(404).json({ error: "Deployment not found" });
    await saveDeployments(filtered);
    try {
      const { DeleteFunctionCommand } = await import("@aws-sdk/client-lambda");
      const client = await getLambdaClient();
      await client.send(new DeleteFunctionCommand({ FunctionName: req.params.functionName }));
    } catch {}
    res.json({ deleted: true });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

import { extractLogsFromPayload, diagnoseError, localClassDiagnose } from "../helpers/lambda-diagnostics.js";

export async function invokeFunction(client: any, functionName: string, payload: any, buildId?: string, handler?: string) {
  const result = await client.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: new TextEncoder().encode(JSON.stringify(payload ?? {})),
    LogType: "Tail",
  }));

  const responsePayload = result.Payload ? new TextDecoder().decode(result.Payload) : null;
  const parsed = responsePayload ? JSON.parse(responsePayload) : null;

  let logs: string[] = [];

  // Prefer CloudWatch logs (complete) over LogResult (4KB truncated)
  if (!result.FunctionError) {
    for (let i = 0; i < 5 && !logs.length; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      logs = await fetchLambdaLogs(functionName);
    }
  }

  // Fall back to LogResult if CloudWatch had nothing
  if (!logs.length && result.LogResult && !result.FunctionError) {
    logs.push(...Buffer.from(result.LogResult, "base64").toString("utf-8").split("\n").filter(Boolean));
  }

  // Extract from error payload as fallback
  const payloadLogs = extractLogsFromPayload(parsed);
  if (payloadLogs.length) {
    if (logs.length) logs.push("");
    logs.push(...payloadLogs);
  }

  // Diagnostics
  if (result.FunctionError) {
    // Always include raw payload for debugging
    if (parsed) logs.push("", "── Raw Error Payload ──", JSON.stringify(parsed, null, 2));

    const fnConfig = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
    const envVars = fnConfig.Configuration?.Environment?.Variables || {};
    const hints = diagnoseError(parsed, envVars);
    if (hints.length) logs.push("", "── Diagnostics ──", ...hints);

    // If no meaningful logs, try local class loading diagnostic
    if (buildId && handler) {
      const diagLogs = await localClassDiagnose(buildId, handler, envVars);
      if (diagLogs.length) logs.push("", "── Local Class Diagnostic ──", ...diagLogs);
    }
  }

  return {
    statusCode: result.StatusCode,
    functionError: result.FunctionError || null,
    payload: parsed,
    logs,
    invokedAt: new Date().toISOString(),
  };
}

// --- Env vars endpoints (persisted in build folder) ---

function envVarsPath(buildId: string) { return join(BUILDS_DIR, buildId, "envvars.json"); }

router.get("/env/:buildId", async (req, res) => {
  try {
    const data = JSON.parse(await readFile(envVarsPath(req.params.buildId), "utf-8"));
    res.json(data);
  } catch { res.json([]); }
});

router.put("/env/:buildId", async (req, res) => {
  try {
    await writeFile(envVarsPath(req.params.buildId), JSON.stringify(req.body));
    res.json({ saved: true });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

// GET /api/deployments/lambda-env/:name — read env vars from Lambda config (source of truth)
router.get("/lambda-env/:name", async (req, res) => {
  try {
    const client = await getLambdaClient();
    const cfg = await client.send(new GetFunctionCommand({ FunctionName: req.params.name }));
    const lambdaVars = cfg.Configuration?.Environment?.Variables || {};
    const active = Object.entries(lambdaVars).map(([key, value]) => ({ key, value }));

    // Merge with local cache to preserve excluded (isNull) entries
    let cached: { key: string; value: string; isNull?: boolean }[] = [];
    try {
      const deployments = await loadDeployments();
      const dep = deployments.find((d: any) => d.functionName === req.params.name);
      if (dep?.buildId) cached = JSON.parse(await readFile(envVarsPath(dep.buildId), "utf-8"));
    } catch {}
    if (!cached.length) {
      try {
        const { loadPipelines } = await import("../services/pipeline-watcher.js");
        const p = loadPipelines().find(pp => pp.targetFunctionName === req.params.name);
        if (p?.envVars?.length) cached = p.envVars as any;
      } catch {}
    }

    // Add back excluded entries that aren't on the Lambda
    const activeKeys = new Set(active.map(e => e.key));
    const excluded = cached.filter(e => e.isNull && e.key && !activeKeys.has(e.key));
    res.json([...active, ...excluded]);
  } catch { res.json([]); }
});

// PUT /api/deployments/lambda-env/:name — write env vars to Lambda config + local cache
router.put("/lambda-env/:name", async (req, res) => {
  try {
    const envVars: { key: string; value: string; isNull?: boolean }[] = req.body.envVars ?? [];
    const entries = envVars.filter(e => e.key && !e.isNull);
    const client = await getLambdaClient();
    await client.send(new UpdateFunctionConfigurationCommand({
      FunctionName: req.params.name,
      Environment: { Variables: Object.fromEntries(entries.map(e => [e.key, e.value])) },
    }));

    // Persist locally as fallback (pipeline + build cache)
    const deployments = await loadDeployments();
    const dep = deployments.find((d: any) => d.functionName === req.params.name);
    if (dep?.buildId) {
      try { await writeFile(envVarsPath(dep.buildId), JSON.stringify(envVars)); } catch {}
    }
    const { loadPipelines, savePipelines } = await import("../services/pipeline-watcher.js");
    const pipelines = loadPipelines();
    const p = pipelines.find(pp => pp.targetFunctionName === req.params.name);
    if (p) { p.envVars = envVars; savePipelines(pipelines); }

    res.json({ saved: true });
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

router.post("/invoke", async (req, res) => {
  const { functionName, payload, debug } = req.body;
  if (!functionName) return res.status(400).json({ error: "functionName is required" });

  try {
    const client = await getLambdaClient();

    // Look up deployment for buildId/handler
    const deployments = await loadDeployments();
    const dep = deployments.find((d: any) => d.functionName === functionName);

    // Only update Lambda config if debug mode or custom memory requested
    if (debug) {
      try {
        const fnCfg = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
        const currentVars = fnCfg.Configuration?.Environment?.Variables || {};
        const updatedVars = { ...currentVars };
        if (debug) updatedVars._JAVA_OPTIONS = "-verbose:class -Xlog:exceptions=info";
        await client.send(new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          Environment: { Variables: updatedVars },
        }));
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          const cfg = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
          if (cfg.Configuration?.LastUpdateStatus !== "InProgress") break;
        }
        try {
          const { execSync } = await import("child_process");
          const dk = process.platform === "win32" ? "wsl docker" : "docker";
          const ids = execSync(`${dk} ps --filter "name=lambda-${functionName}" -q`, { encoding: "utf-8" }).trim();
          if (ids) execSync(`${dk} rm -f ${ids.split("\n").join(" ")}`, { encoding: "utf-8" });
        } catch {}
      } catch (e: any) {
        console.error("[invoke] config update failed:", e.message);
      }
    }

    console.log("[invoke] invoking:", functionName);
    const invokeResult = await invokeFunction(client, functionName, payload, dep?.buildId, dep?.handler);
    console.log("[invoke] result:", invokeResult.statusCode, "error:", invokeResult.functionError, "logs:", invokeResult.logs?.length);

    // Remove debug flags after invoke so they don't leak
    if (debug) {
      try {
        const fnCfg = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
        const currentVars = { ...(fnCfg.Configuration?.Environment?.Variables || {}) };
        delete currentVars._JAVA_OPTIONS;
        await client.send(new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          Environment: { Variables: currentVars },
        }));
      } catch {}
    }

    // Persist last invocation
    if (dep) {
      dep.lastInvocation = { statusCode: invokeResult.statusCode, error: !!invokeResult.functionError, invokedAt: invokeResult.invokedAt };
      dep.lastPayload = payload ?? {};
      await saveDeployments(deployments);
    }

    res.json(invokeResult);
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});


// GET /api/deployments/:name/sample-path
router.get("/:name/sample-path", async (req, res) => {
  const deps = await loadDeployments();
  const dep = deps.find(d => d.functionName === req.params.name);
  res.json({ samplePath: dep?.samplePath || "" });
});

// PUT /api/deployments/:name/sample-path
router.put("/:name/sample-path", async (req, res) => {
  const deps = await loadDeployments();
  const dep = deps.find(d => d.functionName === req.params.name);
  if (!dep) return res.status(404).json({ error: "Deployment not found" });
  dep.samplePath = req.body.samplePath || undefined;
  await saveDeployments(deps);
  res.json({ saved: true });
});


// GET /api/deployments/:name/sample-files — list JSON files from samplePath
router.get("/:name/sample-files", async (req, res) => {
  const deps = await loadDeployments();
  const dep = deps.find(d => d.functionName === req.params.name);
  if (!dep?.samplePath) return res.json([]);
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dep.samplePath, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && e.name.endsWith(".json")).map(e => e.name);
    res.json(files);
  } catch { res.json([]); }
});

// GET /api/deployments/:name/sample-files/:filename — read a specific sample file
router.get("/:name/sample-files/:filename", async (req, res) => {
  const deps = await loadDeployments();
  const dep = deps.find(d => d.functionName === req.params.name);
  if (!dep?.samplePath) return res.status(404).json({ error: "No sample path configured" });
  try {
    const { readFile: rf } = await import("fs/promises");
    const { join } = await import("path");
    const content = await rf(join(dep.samplePath, req.params.filename), "utf-8");
    res.json({ content });
  } catch { res.status(404).json({ error: "File not found" }); }
});

export default router;

// PUT /api/deployments/:name/vault-config — save vault config and sync to pipelines using this Lambda
router.put("/:name/vault-config", async (req, res) => {
  const { url, token, secrets, cleanup } = req.body;
  // Save on deployment
  const deps = await loadDeployments();
  const dep = deps.find(d => d.functionName === req.params.name);
  if (dep) {
    dep.vaultConfig = url ? { url, token, paths: (secrets || []).map((s: any) => s.path).filter(Boolean) } : undefined;
    await saveDeployments(deps);
  }
  // Sync to pipelines that use this Lambda as target
  try {
    const { loadPipelines, savePipelines } = await import("../services/pipeline-watcher.js");
    const pipelines = loadPipelines();
    let synced = 0;
    for (const p of pipelines) {
      if (p.targetFunctionName !== req.params.name) continue;
      if (url) {
        p.vaultConfig = { url, token, paths: (secrets || []).map((s: any) => s.path).filter(Boolean) };
        if (!p.addons?.includes("vault")) (p.addons = p.addons || []).push("vault");
      } else {
        delete p.vaultConfig;
        p.addons = (p.addons || []).filter(a => a !== "vault");
      }
      synced++;
    }
    savePipelines(pipelines);
    res.json({ saved: true, pipelinesSynced: synced });
  } catch { res.json({ saved: true, pipelinesSynced: 0 }); }
});


