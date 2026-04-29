import { Router } from "express";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { DEPLOYMENTS_FILE } from "../config/constants.js";
import { findJavaFiles } from "../helpers/fs-utils.js";
import { detectKiro, askKiro } from "../helpers/kiro.js";
import { getPipelineType } from "../services/pipeline-types.js";

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
  const { error, logs, functionName, runtime, memoryMB, envVars, handler, timeout, context } = req.body;
  if (!error) return res.status(400).json({ error: "error field required" });
  const kiro = await detectKiro();
  if (!kiro.available) return res.status(503).json({ error: "Kiro CLI is not running. Start Kiro to enable AI explanations." });
  const isDocker = context?.includes("docker-compose");
  const prompt = [
    isDocker
      ? "You are a concise Docker debugging assistant. The containers are running via docker-compose locally. Explain the error in 2-3 sentences, then suggest a fix."
      : "You are a concise AWS Lambda debugging assistant. The Lambda is running locally on LocalStack (not real AWS). LocalStack emulates AWS services but has quirks — timeouts, cold starts, and container reuse can cause issues that wouldn't happen in production.",
    isDocker ? "" : "Explain the error in 2-3 sentences, then suggest a fix. If the error looks LocalStack-specific, say so.",
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
    const typeDef = getPipelineType(pipeline.type || "app-pipeline");
    const triggerKind = typeDef?.triggerKind || "dynamodb-insert";

    // Get table key schema (only for dynamodb-insert)
    let keySchema = "";
    if (triggerKind === "dynamodb-insert") {
      try {
        const { getDynamoClient } = await import("../helpers/dynamo-client.js");
        const { DescribeTableCommand } = await import("@aws-sdk/client-dynamodb");
        const ddb = await getDynamoClient();
        const { Table } = await ddb.send(new DescribeTableCommand({ TableName: pipeline.tableName }));
        keySchema = (Table?.KeySchema || []).map((k: any) => `${k.AttributeName} (${k.KeyType})`).join(", ");
      } catch {}
    }

    // Get target Lambda handler source (for sqs-send context)
    let handlerSource = "";
    if (triggerKind === "sqs-send" && pipeline.targetFunctionName) {
      try {
        const deps = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf-8"));
        const dep = deps.find((d: any) => d.functionName === pipeline.targetFunctionName);
        if (dep?.projectPath && dep?.handler) {
          const handlerClass = dep.handler.split("::")[0].split(".").pop();
          const javaFiles = await findJavaFiles(dep.projectPath);
          const match = javaFiles.find((f: string) => f.includes(handlerClass));
          if (match) {
            const src = await readFile(match, "utf-8");
            handlerSource = src.length < 30000 ? src : src.slice(0, 30000);
          }
        }
      } catch {}
    }

    // Get favorites
    let favorites: string[] = [];
    try {
      const { readFile: rf } = await import("fs/promises");
      const { FAVORITES_DIR } = await import("../config/constants.js");
      favorites = JSON.parse(await rf(join(FAVORITES_DIR, `pipeline-${pipelineId}.json`), "utf-8"));
    } catch {}

    const intentLabels: Record<string, Record<string, string>> = {
      "dynamodb-insert": {
        success: "a DynamoDB item that should be processed successfully through the pipeline",
        filtered: "a DynamoDB item that intentionally does NOT match the SNS filter policy",
        edge: "an edge case DynamoDB item with boundary values or unusual but valid data",
      },
      "sqs-send": {
        "dynamodb-event": "a DynamoDB Streams event record (the JSON body that DynamoDB Streams produces when a table item changes — include eventName, dynamodb.Keys, dynamodb.NewImage, dynamodb.OldImage with AttributeValue format like {S:'value'}, {N:'123'})",
        "s3-event": "an S3 event notification record (the JSON body that S3 produces for object events — include eventName like ObjectCreated:Put, s3.bucket.name, s3.object.key, s3.object.size)",
        "sns-notification": "an SNS notification message (the JSON body that SNS wraps when forwarding — include Type, MessageId, TopicArn, Subject, Message with a nested JSON payload, Timestamp)",
        "custom": "a generic JSON message body with realistic fields that the target Lambda can process",
        "error": "a malformed or unexpected message body likely to cause the target Lambda to fail (missing required fields, wrong types, null values)",
      },
      "sns-publish": {
        success: "an SNS message body that matches the filter policy and should be processed successfully",
        filtered: "an SNS message body that intentionally does NOT match the SNS filter policy",
        edge: "an edge case SNS message body with boundary values or unusual but valid data",
      },
    };
    const intentLabel = customPrompt || (intentLabels[triggerKind]?.[intent] || intent);

    let promptParts: string[];
    if (triggerKind === "sqs-send") {
      promptParts = [
        "You are generating the message body that will be SENT to an SQS queue. Generate ONLY the raw event content (e.g. the DynamoDB stream record, S3 notification, or SNS message itself). Do NOT wrap it in a Records array, do NOT add SQS envelope fields like messageId/receiptHandle/body. The user will send this directly as the SQS message body.",
        "Generate ONLY valid JSON — no explanation, no markdown, no code fences. Just the raw JSON object.",
        "",
        `Queue: ${pipeline.queueUrl || "unknown"}`,
        `Target Lambda: ${pipeline.targetFunctionName}`,
        "",
        `Generate ${intentLabel}.`,
        handlerSource ? `\n--- Target Lambda handler source ---\n${handlerSource}` : "",
        learned.length ? `\n--- Learned items from previous runs (${learned.length}) ---\n${learned.slice(-10).join("\n")}` : "",
        favorites.length ? `\n--- Saved favorites ---\n${favorites.slice(-5).join("\n")}` : "",
        ...await loadFeedback("pipeline", pipelineId),
      ];
    } else if (triggerKind === "sns-publish") {
      promptParts = [
        "You are an SNS message body generator for pipeline testing on LocalStack.",
        "Generate ONLY valid JSON — no explanation, no markdown, no code fences. Just the raw JSON object.",
        "",
        `Topic: ${pipeline.topicArn || "unknown"}`,
        pipeline.filterPolicy ? `SNS filter policy (${pipeline.filterPolicyScope || "MessageAttributes"}): ${JSON.stringify(pipeline.filterPolicy)}` : "",
        "",
        `Generate ${intentLabel}.`,
        learned.length ? `\n--- Learned items from previous runs (${learned.length}) ---\n${learned.slice(-10).join("\n")}` : "",
        favorites.length ? `\n--- Saved favorites ---\n${favorites.slice(-5).join("\n")}` : "",
        ...await loadFeedback("pipeline", pipelineId),
      ];
    } else {
      promptParts = [
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
      ];
    }
    const prompt = promptParts.filter(Boolean).join("\n");

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


router.post("/compose", async (req, res) => {
  const { action, serviceName, currentYaml, context } = req.body as {
    action: 'generate' | 'add-service' | 'add-healthchecks' | 'wire-dependencies' | 'explain';
    serviceName?: string; currentYaml?: string; context?: any;
  };
  const validActions = ['generate', 'add-service', 'add-healthchecks', 'wire-dependencies', 'explain'] as const;
  if (!action || !validActions.includes(action)) return res.status(400).json({ error: "valid action required" });
  if (action === 'add-service' && !serviceName) return res.status(400).json({ error: "serviceName required for add-service" });
  const kiro = await detectKiro();
  if (!kiro.available) return res.status(503).json({ error: "Kiro CLI not available" });

  try {
    const projectNames = (context?.projects || []).map((p: any) => p.name).join(", ") || "my services";
    const projectSummary = (context?.projects || []).map((p: any) => {
      const svcs = (p.services || []).map((svc: any) => {
        const lines = [svc.build ? `  - ${svc.name}: build=${svc.build} (Dockerfile in project dir)` : `  - ${svc.name}: image=${svc.image}`];
        if (svc.ports?.length) lines.push(`    ports: ${svc.ports.join(", ")}`);
        if (svc.envVars?.length) lines.push(`    env: ${svc.envVars.map((e: any) => typeof e === "string" ? e : e.key + "=" + e.value).join(", ")}`);
        if (svc.volumes?.length) lines.push(`    volumes: ${svc.volumes.join(", ")}`);
        if (svc.dependsOn?.length) lines.push(`    depends_on: ${svc.dependsOn.join(", ")}`);
        if (svc.healthcheck) lines.push(`    healthcheck: ${JSON.stringify(svc.healthcheck)}`);
        return lines.join("\n");
      }).join("\n");
      return `Project: ${p.name} (image: ${p.imageTag})\nServices:\n${svcs}`;
    }).join("\n\n");

    const actionPrompts: Record<string, string> = {
      generate: `Generate a docker-compose.yml for these batch projects: ${projectNames}. Include infrastructure services they depend on (MySQL, Redis, etc.) with healthchecks. Use depends_on with service_healthy conditions.`,
      'add-service': `Add a ${serviceName} service to this docker-compose. Include appropriate healthcheck, ports, volumes, and environment variables. Wire it into existing depends_on chains where appropriate.`,
      'add-healthchecks': "Add healthchecks to all services in this docker-compose that don't have one. Use appropriate health check commands for each service type (mysqladmin ping for mysql, redis-cli ping for redis, curl for web services, etc.).",
      'wire-dependencies': "Analyze the services in this docker-compose and add appropriate depends_on relationships. Infrastructure services (mysql, redis, localstack) should start first. Batch/application services should depend on their infrastructure with condition: service_healthy where healthchecks exist.",
      explain: "Explain what each service in this docker-compose does, how they're connected, and the startup order.",
    };

    const bt = "`";
    const fence = bt + bt + bt;
    const promptParts = [
      "You are a Docker Compose expert. Generate valid docker-compose YAML based on the user request.",
      "Rules:",
      action === 'explain'
        ? "- Provide a clear explanation only. No YAML output needed."
        : `- Output the YAML inside a ${fence}yaml code fence, followed by a brief explanation.`,
      `- The container_name can be the same as the service name (the YAML section key). No special suffix needed.`,
      "- For batch/application services from registered projects: use \`build:\\n  context: <absolute project path>\\n  dockerfile: Dockerfile\` (NOT image:). The project path is provided in the context below.",
      "- For infrastructure services (mysql, redis, localstack, etc.): use \`image:\` with the standard Docker Hub image.",
      "- Use the actual env vars, volumes, and ports from the registered projects when applicable.",
      "- Include healthchecks for infrastructure services (mysql, redis, postgres, etc.).",
      "- Use depends_on with condition: service_healthy where a healthcheck exists.",
      "- Include a shared network named `cs-batch-network`.",
      "- Use version-less compose format (no `version:` key).",
      "",
      projectSummary ? `--- Registered projects and services ---\n${projectSummary}` : "",
      currentYaml ? `--- Current YAML (modify this) ---\n${currentYaml}` : "",
      "",
      actionPrompts[action],
    ];

    // Load favorites (good samples) and feedback (bad samples)
    let favorites: string[] = [];
    try {
      const { readFile: rf } = await import("fs/promises");
      const { FAVORITES_DIR } = await import("../config/constants.js");
      favorites = JSON.parse(await rf(join(FAVORITES_DIR, "compose-compose-studio.json"), "utf-8"));
    } catch {}
    if (favorites.length) {
      promptParts.push("\n--- Previously approved compose files (use as reference) ---");
      for (const f of favorites.slice(-3)) promptParts.push(f.slice(0, 500));
    }
    promptParts.push(...await loadFeedback("compose", "compose-studio"));

    const systemPrompt = promptParts.filter(Boolean).join("\n");

    const result = await askKiro(systemPrompt, 120000);

    let yaml = "";
    let explanation = result;
    // Try fenced YAML first
    const yamlMatch = result.match(/```ya?ml\n([\s\S]*?)```/);
    if (yamlMatch) {
      yaml = yamlMatch[1].trim();
      explanation = result.replace(yamlMatch[0], "").trim();
    } else if (action !== "explain") {
      // Fallback: if response starts with or contains "services:" it's likely raw YAML
      const svcIdx = result.indexOf("services:");
      if (svcIdx !== -1) {
        // Split at double-newline boundaries, keep only the YAML part
        const afterSvc = result.substring(svcIdx);
        // Find where YAML ends: look for a blank line followed by a line that doesn't start with space, #, -, or a yaml key pattern
        const parts = afterSvc.split(/\n\n/);
        const yamlParts: string[] = [];
        for (const part of parts) {
          const firstLine = part.trimStart().split("\n")[0];
          // If first line looks like prose (contains ** or starts with a sentence), stop
          if (firstLine.includes("**") || firstLine.startsWith("Explanation") || (/^[A-Z][a-z]+ [a-z]/.test(firstLine) && !firstLine.includes(":"))) break;
          yamlParts.push(part);
        }
        yaml = yamlParts.join("\n\n").trim();
        explanation = result.substring(0, svcIdx).trim() + " " + afterSvc.substring(yaml.length).trim();
        explanation = explanation.trim() || "Generated compose file.";
      }
    }


    const defaultExplanations: Record<string, string> = {
      generate: "Generated a docker-compose file based on your registered batch projects. Review the services, ports, and dependencies, then click Apply to Canvas when ready.",
      "add-service": "Added the requested service to your compose file with appropriate configuration.",
      "add-healthchecks": "Added healthchecks to services that were missing them.",
      "wire-dependencies": "Analyzed services and added depends_on relationships.",
      explain: explanation || "No explanation available.",
    };
    if (!explanation || explanation.length < 10) explanation = defaultExplanations[action] || "Done.";
    if (yaml && action === "generate") yaml = "# Generated by Kiro based on your registered batch projects.\n# The more projects you register, the richer this compose will be.\n\n" + yaml;
    res.json({ yaml, explanation });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
