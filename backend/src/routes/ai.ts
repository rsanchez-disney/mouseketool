import { Router } from "express";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { DEPLOYMENTS_FILE } from "../config/constants.js";
import { findJavaFiles } from "../helpers/fs-utils.js";
import { detectKiro, askKiro } from "../helpers/kiro.js";

const router = Router();

async function loadFeedback(type: string, id: string): Promise<string[]> {
  try {
    const { readFile: rf } = await import("fs/promises");
    const { FEEDBACK_DIR } = await import("../config/constants.js");
    const items: { sample: string; reason: string }[] = JSON.parse(await rf(join(FEEDBACK_DIR, `${type}-${id}.json`), "utf-8"));
    if (!items.length) return [];
    return [`\n--- User feedback on previous generations (avoid these mistakes) ---`, ...items.slice(-5).map(f => `BAD: ${f.sample.slice(0, 200)}\nREASON: ${f.reason}`)];
  } catch { return []; }
}


router.get("/status", async (_req, res) => {
  const result = await detectKiro();
  res.json(result);
});

router.post("/explain", async (req, res) => {
  const { error, logs, functionName, runtime, memoryMB, envVars, handler, timeout } = req.body;
  if (!error) return res.status(400).json({ error: "error field required" });
  const prompt = [
    "You are a concise AWS Lambda debugging assistant. The Lambda is running locally on LocalStack (not real AWS). LocalStack emulates AWS services but has quirks — timeouts, cold starts, and container reuse can cause issues that wouldn't happen in production.",
    "Explain the error in 2-3 sentences, then suggest a fix. If the error looks LocalStack-specific, say so.",
    `--- Lambda metadata ---`,
    `Function: ${functionName || "unknown"}`,
    runtime ? `Runtime: ${runtime}` : "",
    handler ? `Handler: ${handler}` : "",
    memoryMB ? `Memory: ${memoryMB}MB` : "",
    timeout ? `Timeout: ${timeout}s` : "",
    envVars?.length ? `Env vars set: ${envVars.join(", ")}` : "",
    `--- Error ---`,
    error,
    logs?.length ? `--- Recent logs (last ${Math.min(logs.length, 30)} lines) ---\n${logs.slice(-30).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  try {
    const explanation = await askKiro(prompt);
    res.json({ explanation });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/generate-payload", async (req, res) => {
  const { intent, samplePath, functionName, customPrompt } = req.body;
  if (!intent && !customPrompt) return res.status(400).json({ error: "intent or customPrompt required" });
  const kiro = await detectKiro(); if (!kiro.available) return res.status(503).json({ error: "Kiro CLI not available" });


  try {
    // 1. Collect sample JSON files
    let samples: { name: string; content: string }[] = [];
    const lookupPath = samplePath || null;
    if (lookupPath) {
      try {
        const entries = await readdir(lookupPath, { withFileTypes: true, recursive: true });
        const jsonFiles = entries.filter(e => e.isFile() && e.name.endsWith(".json") && !e.name.includes("node_modules")).slice(0, 10);
        for (const f of jsonFiles) {
          try {
            const full = join((f as any).parentPath || (f as any).path || lookupPath, f.name);
            const content = await readFile(full, "utf-8");
            if (content.length < 20000) samples.push({ name: f.name, content });
          } catch {}
        }
      } catch {}
    }

    // 2. Find handler source code from deployment
    let handlerSource = "";
    if (functionName) {
      try {
        const deps = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf-8"));
        const dep = deps.find((d: any) => d.functionName === functionName);
        if (dep?.projectPath && dep?.handler) {
          const handlerClass = dep.handler.split("::")[0].split(".").pop();
          const javaFiles = await findJavaFiles(dep.projectPath);
          const match = javaFiles.find(f => f.includes(handlerClass));
          if (match) {
            const src = await readFile(match, "utf-8");
            handlerSource = src.length < 30000 ? src : src.slice(0, 30000);
          }
        }
      } catch {}
    }

    // 3. Build prompt
    const intentLabel = customPrompt || (
      intent === "success" ? "a payload that should be processed successfully" :
      intent === "error" ? "a payload that should trigger an error or failure path" :
      intent === "edge" ? "an edge case payload (empty fields, boundary values, unusual but valid data)" :
      intent
    );

    const prompt = [
      "You are a JSON payload generator for AWS Lambda functions running on LocalStack.",
      "Generate ONLY valid JSON — no explanation, no markdown, no code fences. Just the raw JSON object.",
      "",
      `Generate ${intentLabel}.`,
      samples.length ? `\n--- Sample JSON files (use these as structural reference) ---` : "",
      ...samples.map(s => `File: ${s.name}\n${s.content}`),
      handlerSource ? `\n--- Handler source code (understand the expected input structure) ---\n${handlerSource}` : "",
      ...await loadFeedback("deployment", functionName || "unknown"),
    ].filter(Boolean).join("\n");


    const result = await askKiro(prompt, 90000);

    // Extract JSON from response (in case Kiro wraps it)
    let payload = result;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) payload = jsonMatch[0];

    // Validate it's parseable
    try { JSON.parse(payload); } catch { return res.json({ payload: result, warning: "Response may not be valid JSON" }); }
    res.json({ payload });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/generate-item", async (req, res) => {
  const { intent, pipelineId, customPrompt } = req.body;
  if (!intent && !customPrompt) return res.status(400).json({ error: "intent or customPrompt required" });
  if (!pipelineId) return res.status(400).json({ error: "pipelineId required" });
  const kiro = await detectKiro(); if (!kiro.available) return res.status(503).json({ error: "Kiro CLI not available" });


  try {
    const { loadPipelines } = await import("../services/pipeline-watcher.js");
    const { getLearnedItems } = await import("../services/learned-items.js");
    const pipeline = loadPipelines().find(p => p.id === pipelineId);
    if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });

    // Collect context
    const learned = await getLearnedItems(pipelineId);

    // Get table key schema
    let keySchema = "";
    try {
      const { getDynamoClient } = await import("../helpers/dynamo-client.js");
      const { DescribeTableCommand } = await import("@aws-sdk/client-dynamodb");
      const ddb = await getDynamoClient();
      const { Table } = await ddb.send(new DescribeTableCommand({ TableName: pipeline.tableName }));
      keySchema = (Table?.KeySchema || []).map((k: any) => `${k.AttributeName} (${k.KeyType})`).join(", ");
    } catch {}

    // Get favorites
    let favorites: string[] = [];
    try {
      const { readFile: rf } = await import("fs/promises");
      const { FAVORITES_DIR } = await import("../config/constants.js");
      favorites = JSON.parse(await rf(join(FAVORITES_DIR, `pipeline-${pipelineId}.json`), "utf-8"));
    } catch {}

    const intentLabel = customPrompt || (
      intent === "success" ? "a DynamoDB item that should be processed successfully through the pipeline" :
      intent === "filtered" ? "a DynamoDB item that intentionally does NOT match the SNS filter policy" :
      intent === "edge" ? "an edge case DynamoDB item with boundary values or unusual but valid data" :
      intent
    );

    const prompt = [
      "You are a DynamoDB item generator for pipeline testing on LocalStack.",
      "Generate ONLY valid JSON — no explanation, no markdown, no code fences. Just the raw JSON object.",
      "The item should be a plain JSON object (NOT DynamoDB marshalled format). Use simple key-value pairs.",
      "",
      `Table: ${pipeline.tableName}`,
      keySchema ? `Key schema: ${keySchema}` : "",
      pipeline.filterPolicy ? `SNS filter policy (${pipeline.filterPolicyScope || "MessageAttributes"}): ${JSON.stringify(pipeline.filterPolicy)}` : "",
      "",
      `Generate ${intentLabel}.`,
      learned.length ? `\n--- Learned items from previous runs (${learned.length}) ---\n${learned.slice(-10).join("\n")}` : "",
      favorites.length ? `\n--- Saved favorites ---\n${favorites.slice(-5).join("\n")}` : "",
      ...await loadFeedback("pipeline", pipelineId),
    ].filter(Boolean).join("\n");

    const result = await askKiro(prompt, 90000);
    let payload = result;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) payload = jsonMatch[0];
    try { JSON.parse(payload); } catch { return res.json({ payload: result, warning: "Response may not be valid JSON" }); }
    res.json({ payload });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/save-generation", async (req, res) => {
  const { type, id, content } = req.body;
  if (!type || !id || !content) return res.status(400).json({ error: "type, id, and content required" });
  try {
    const { readFile: rf, writeFile: wf, mkdir: mk } = await import("fs/promises");
    const { FAVORITES_DIR } = await import("../config/constants.js");
    await mk(FAVORITES_DIR, { recursive: true });
    const file = join(FAVORITES_DIR, `${type}-${id}.json`);
    let existing: string[] = [];
    try { existing = JSON.parse(await rf(file, "utf-8")); } catch {}
    existing.push(content);
    if (existing.length > 50) existing = existing.slice(-50);
    await wf(file, JSON.stringify(existing, null, 2));
    res.json({ saved: true, count: existing.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;

router.post("/save-feedback", async (req, res) => {
  const { type, id, sample, reason } = req.body;
  if (!type || !id || !sample || !reason) return res.status(400).json({ error: "type, id, sample, and reason required" });
  try {
    const { readFile: rf, writeFile: wf, mkdir: mk } = await import("fs/promises");
    const { FEEDBACK_DIR } = await import("../config/constants.js");
    await mk(FEEDBACK_DIR, { recursive: true });
    const file = join(FEEDBACK_DIR, `${type}-${id}.json`);
    let existing: { sample: string; reason: string }[] = [];
    try { existing = JSON.parse(await rf(file, "utf-8")); } catch {}
    existing.push({ sample, reason });
    if (existing.length > 30) existing = existing.slice(-30);
    await wf(file, JSON.stringify(existing, null, 2));
    res.json({ saved: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


