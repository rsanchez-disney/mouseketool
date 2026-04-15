import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand } from "@aws-sdk/client-lambda";
import { SETTINGS_DIR, BUILDS_DIR, DEPLOYMENTS_FILE } from "../config/constants.js";
import { getLambdaClient } from "../helpers/lambda-client.js";
import { formatAwsError } from "../helpers/aws-error.js";

const router = Router();

router.post("/", async (req, res) => {
  const { buildId, handler, runtime = "java21", functionName } = req.body;
  if (!buildId || !handler || !functionName) return res.status(400).json({ error: "buildId, handler, and functionName are required" });

  try {
    const meta = JSON.parse(await readFile(join(BUILDS_DIR, buildId, "meta.json"), "utf-8"));
    const jarBytes = await readFile(meta.jarPath);
    const client = await getLambdaClient();

    // Load saved env vars if they exist
    let envConfig: { Variables: Record<string, string> } | undefined;
    try {
      const saved: { key: string; value: string }[] = JSON.parse(await readFile(join(BUILDS_DIR, buildId, "envvars.json"), "utf-8"));
      const vars = Object.fromEntries(saved.filter(e => e.key).map(e => [e.key, e.value]));
      if (Object.keys(vars).length) envConfig = { Variables: vars };
    } catch {}

    let action: string;
    try {
      await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      await client.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: jarBytes }));
      await new Promise(r => setTimeout(r, 1000));
      await client.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName, Runtime: runtime, Handler: handler,
        Timeout: 60, MemorySize: 2048, Environment: envConfig,
      }));
      action = "updated";
    } catch {
      await client.send(new CreateFunctionCommand({
        FunctionName: functionName, Runtime: runtime, Handler: handler,
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Code: { ZipFile: jarBytes }, Timeout: 60, MemorySize: 2048, Environment: envConfig,
      }));
      action = "created";
    }
    res.json({ functionName, handler, runtime, action });

    // Persist deployment metadata
    const deployments = await readFile(DEPLOYMENTS_FILE, "utf-8").then(d => JSON.parse(d)).catch(() => []);
    const existing = deployments.findIndex((d: any) => d.functionName === functionName);
    const deployment = {
      functionName, handler, runtime, action,
      buildId, projectName: meta.projectName, projectPath: meta.projectPath,
      buildTool: meta.buildTool, buildTime: meta.createdAt, deployedAt: new Date().toISOString(), status: "active",
    };
    if (existing >= 0) deployments[existing] = deployment;
    else deployments.unshift(deployment);
    await mkdir(SETTINGS_DIR, { recursive: true });
    await writeFile(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  } catch (err: any) { res.status(500).json({ error: formatAwsError(err) }); }
});

export default router;
