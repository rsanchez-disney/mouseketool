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

async function fetchLambdaLogs(functionName: string): Promise<string[]> {
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

async function invokeFunction(client: any, functionName: string, payload: any, buildId?: string, handler?: string) {
  const result = await client.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: new TextEncoder().encode(JSON.stringify(payload ?? {})),
    LogType: "Tail",
  }));

  const responsePayload = result.Payload ? new TextDecoder().decode(result.Payload) : null;
  const parsed = responsePayload ? JSON.parse(responsePayload) : null;

  let logs: string[] = [];

  // Tail logs from invoke response (skip if function errored — local diagnostic is more reliable)
  if (result.LogResult && !result.FunctionError) {
    logs.push(...Buffer.from(result.LogResult, "base64").toString("utf-8").split("\n").filter(Boolean));
  }

  // Poll CloudWatch for logs (skip if function errored — local diagnostic is more reliable)
  if (!logs.length && !result.FunctionError) {
    for (let i = 0; i < 5 && !logs.length; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      logs = await fetchLambdaLogs(functionName);
    }
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

router.post("/invoke", async (req, res) => {
  const { functionName, payload, debug, memorySize } = req.body;
  if (!functionName) return res.status(400).json({ error: "functionName is required" });

  try {
    const client = await getLambdaClient();

    // Look up deployment for buildId/handler
    const deployments = await loadDeployments();
    const dep = deployments.find((d: any) => d.functionName === functionName);

    // Apply env vars from persisted file before invocation
    let envVars: Record<string, string> = {};
    if (dep?.buildId) {
      try {
        const saved: { key: string; value: string; isNull?: boolean }[] = JSON.parse(await readFile(envVarsPath(dep.buildId), "utf-8"));
        envVars = Object.fromEntries(saved.filter(e => e.key && !e.isNull).map(e => [e.key, e.value]));
      } catch {}
    }

    // Debug adds verbose JVM flags
    if (debug) {
      envVars._JAVA_OPTIONS = "-verbose:class -Xlog:exceptions=info";
    }

    // Update Lambda env vars
    try {
      await client.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Environment: { Variables: envVars },
        ...(memorySize ? { MemorySize: memorySize } : {}),
      }));
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        const cfg = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
        if (cfg.Configuration?.LastUpdateStatus !== "InProgress") break;
      }
      // Kill warm Lambda containers to ensure fresh execution environment with updated env vars
      try {
        const { execSync } = await import("child_process");
        const ids = execSync(`wsl docker ps --filter "name=lambda-${functionName}" -q`, { encoding: "utf-8" }).trim();
        if (ids) execSync(`wsl docker rm -f ${ids.split("\n").join(" ")}`, { encoding: "utf-8" });
        console.log("[invoke] Killed warm containers for", functionName);
      } catch (e: any) { console.log("[invoke] Container cleanup skipped:", e.message); }
    } catch (e: any) {
      console.error("[invoke] env var update failed:", e.message);
    }

    console.log("[invoke] env vars count:", Object.keys(envVars).length, "invoking:", functionName);
    const invokeResult = await invokeFunction(client, functionName, payload, dep?.buildId, dep?.handler);
    console.log("[invoke] result:", invokeResult.statusCode, "error:", invokeResult.functionError, "logs:", invokeResult.logs?.length);

    // Remove debug flags after invoke so they don't leak
    if (debug) {
      envVars._JAVA_OPTIONS = "-Xlog:exceptions=info";
      await client.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Environment: { Variables: envVars },
      }));
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

export default router;
