import { Router } from "express";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { SETTINGS_DIR, BUILDS_DIR, DEPLOYMENTS_FILE, PIPELINES_FILE } from "../config/constants.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    // Deployments (lambdas)
    let deployments: any[] = [];
    try { deployments = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf-8")); } catch {}

    // Cached builds
    let buildCount = 0;
    try { const entries = await readdir(BUILDS_DIR, { withFileTypes: true }); buildCount = entries.filter(e => e.isDirectory()).length; } catch {}

    // Pipelines
    let pipelines: any[] = [];
    try { pipelines = JSON.parse(await readFile(PIPELINES_FILE, "utf-8")); } catch {}

    // Batch projects
    let batchProjects: any[] = [];
    try { batchProjects = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-projects.json"), "utf-8")); } catch {}

    // Workflows
    let workflows: any[] = [];
    try { workflows = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-workflows.json"), "utf-8")); } catch {}

    // Pipeline stats
    const pipelineStats = pipelines.map(p => {
      const runs: any[] = p.runs || [];
      const statusCounts: Record<string, number> = {};
      for (const r of runs) { statusCounts[r.status || "unknown"] = (statusCounts[r.status || "unknown"] || 0) + 1; }
      const lastRun = runs[runs.length - 1] || null;
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        targetFunctionName: p.targetFunctionName,
        totalRuns: runs.length,
        statusCounts,
        lastRunAt: lastRun?.timestamp || null,
        lastRunStatus: lastRun?.status || null,
      };
    });

    // Lambda invoke states
    const lambdaStates = deployments.map(d => ({
      functionName: d.functionName,
      statusCode: d.lastInvocationResult?.statusCode ?? null,
      functionError: d.lastInvocationResult?.functionError ?? null,
      invokedAt: d.lastInvocationResult?.invokedAt ?? null,
    }));

    res.json({
      counts: {
        lambdas: deployments.length,
        builds: buildCount,
        pipelines: pipelines.length,
        batchProjects: batchProjects.length,
        workflows: workflows.length,
      },
      pipelineStats,
      lambdaStates,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
