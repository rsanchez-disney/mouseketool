import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand } from "@aws-sdk/client-lambda";
import { SETTINGS_DIR, BUILDS_DIR, DEPLOYMENTS_FILE } from "../config/constants.js";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { loadSettings } from "../helpers/settings.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

// GET /api/deploy/check/:name — check if Lambda function exists
router.get("/check/:name", async (req, res) => {
  try {
    const client = await getLambdaClient();
    await client.send(new GetFunctionCommand({ FunctionName: req.params.name }));
    res.json({ exists: true });
  } catch { res.json({ exists: false }); }
});

router.post("/", async (req, res) => {
  const { buildId, handler, runtime = "java21", functionName } = req.body;
  if (!buildId || !handler || !functionName) return res.status(400).json({ error: "buildId, handler, and functionName are required" });

  try {
    const meta = JSON.parse(await readFile(join(BUILDS_DIR, buildId, "meta.json"), "utf-8"));
    const jarBytes = await readFile(meta.jarPath);
    const client = await getLambdaClient();
    const settings = await loadSettings();
    const memorySize = settings.lambda?.memoryMB ?? 2048;

    // Load saved env vars if they exist
    let envSource = "";
    let envConfig: { Variables: Record<string, string> } | undefined;
    try {
      const raw = JSON.parse(await readFile(join(BUILDS_DIR, buildId, "envvars.json"), "utf-8"));
      envSource = raw.source || "";
      const saved: { key: string; value: string }[] = Array.isArray(raw) ? raw : raw.vars || [];
      const vars = Object.fromEntries(saved.filter(e => e.key).map(e => [e.key, e.value]));
      if (Object.keys(vars).length) envConfig = { Variables: vars };
    } catch {}

    let action: string;
    let exists = false;
    try {
      await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      exists = true;
    } catch {}

    if (exists) {
      // Wait for function to be ready before updating
      async function waitReady() {
        for (let i = 0; i < 10; i++) {
          const fn = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
          const state = fn.Configuration?.LastUpdateStatus;
          if (!state || state === "Successful" || state === "Failed") return;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      await waitReady();
      await client.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: jarBytes }));
      await waitReady();
      await client.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName, Runtime: runtime, Handler: handler,
        Timeout: 60, MemorySize: memorySize, ...(envConfig ? { Environment: envConfig } : {}),
      }));
      action = "updated";
    } else {
      await client.send(new CreateFunctionCommand({
        FunctionName: functionName, Runtime: runtime, Handler: handler,
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Code: { ZipFile: jarBytes }, Timeout: 60, MemorySize: memorySize, Environment: envConfig,
      }));
      action = "created";
    }
    res.json({ functionName, handler, runtime, action });

    // Kill warm containers so LocalStack picks up the new code immediately
    try {
      const { exec } = await import("child_process");
      const dk = process.platform === "win32" ? "wsl docker" : "docker";
      exec(`${dk} ps --filter "name=lambda-${functionName}" -q`, (_, stdout) => {
        const ids = stdout?.trim();
        if (ids) exec(`${dk} rm -f ${ids.split("\n").join(" ")}`);
      });
    } catch {}

    // Read env source if available

    // Persist deployment metadata
    const deployments = await readFile(DEPLOYMENTS_FILE, "utf-8").then(d => JSON.parse(d)).catch(() => []);
    const existing = deployments.findIndex((d: any) => d.functionName === functionName);
    const deployment = {
      functionName, handler, runtime, action,
      buildId, projectName: meta.projectName, projectPath: meta.projectPath,
      buildTool: meta.buildTool, buildTime: meta.createdAt, deployedAt: new Date().toISOString(), status: "active", envSource,
    };
    if (existing >= 0) deployments[existing] = deployment;
    else deployments.unshift(deployment);
    await mkdir(SETTINGS_DIR, { recursive: true });
    await writeFile(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

export default router;
