// force restart
import express from "express";
import cors from "cors";
import settingsRoutes from "./routes/settings.js";
import filesystemRoutes from "./routes/filesystem.js";
import analyzeRoutes from "./routes/analyze.js";
import buildsRoutes, { cleanupBuilds } from "./routes/builds.js";
import deployRoutes from "./routes/deploy.js";
import deploymentsRoutes from "./routes/deployments.js";
import vaultRoutes from "./routes/vault.js";
import dynamodbRoutes from "./routes/dynamodb.js";
import sqsRoutes from "./routes/sqs.js";
import triggersRoutes from "./routes/triggers.js";
import snsRoutes from "./routes/sns.js";
import aiRoutes from "./routes/ai.js";
import batchBuildsRoutes from "./routes/batch-builds.js";
import batchWorkflowsRoutes from "./routes/batch-workflows.js";
import batchRunsRoutes from "./routes/batch-runs.js";
import { watcher } from "./services/pipeline-watcher.js";
import { initPipelineWs } from "./services/pipeline-ws.js";
import { initShadowInfra, ensureBucketExists } from "./services/shadow-infra.js";
import { reconcilePipelines } from "./services/reconcile.js";
import { reconcileDeployments } from "./routes/deployments.js";
import { readdirSync, existsSync } from "fs";



const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

let reconciling = false;
export function setReconciling(v: boolean) { reconciling = v; }

app.get("/api/health", async (_req, res) => {
  try {
    const s = await (await import("./helpers/settings.js")).loadSettings();
    const url = `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}/_localstack/health`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return res.json({ status: "ok", localstack: true, reconciling });
    res.json({ status: "ok", localstack: false, reconciling });
  } catch { res.json({ status: "ok", localstack: false, reconciling }); }
});
app.use("/api/settings", settingsRoutes);
app.use("/api/fs", filesystemRoutes);
app.use("/api/analyze", analyzeRoutes);
app.use("/api/builds", buildsRoutes);
app.use("/api/deploy", deployRoutes);
app.use("/api/deployments", deploymentsRoutes);
app.use("/api/vault", vaultRoutes);
app.use("/api/dynamodb", dynamodbRoutes);
app.use("/api/sqs", sqsRoutes);
app.use("/api/triggers", triggersRoutes);
app.use("/api/sns", snsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/batch-builds", batchBuildsRoutes);
app.use("/api/batch-workflows", batchWorkflowsRoutes);
app.use("/api/batch-runs", batchRunsRoutes);

// Cleanup scheduler
setInterval(cleanupBuilds, 30 * 60 * 1000);
cleanupBuilds();

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  watcher.start();
  initShadowInfra();
  initPipelineWs(server);
  startHealthMonitor();
});


let lsWasDown = true;
let consecutiveFailures = 0; // assume down on startup so first successful check triggers reconciliation
async function checkLocalStack(): Promise<boolean> {
  try {
    const s = await (await import("./helpers/settings.js")).loadSettings();
    const url = `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}/_localstack/health`;
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}
function startHealthMonitor() {
  setInterval(async () => {
    const up = await checkLocalStack();
    if (up && lsWasDown) {
      console.log("[health] LocalStack recovered — running reconciliation");
      lsWasDown = false;
      reconciling = true;
      try { await reconcileDeployments(); } catch (e: any) { console.error("[health] Lambda reconciliation failed:", e.message); }
      try { await reconcilePipelines(); } catch (e: any) { console.error("[health] Pipeline reconciliation failed:", e.message); }
      await new Promise(r => setTimeout(r, 3000));
      try { await initShadowInfra(); } catch {}
      reconciling = false;
    } else if (!up && !lsWasDown) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.log("[health] LocalStack went down (3 consecutive failures)");
        lsWasDown = true;
        consecutiveFailures = 0;
      }
    } else if (up) {
      consecutiveFailures = 0;
      await ensureBucketExists();
    }
  }, 5000);
}

process.on("uncaughtException", (err) => { console.error("[FATAL] Uncaught exception (kept alive):", err.message); });
process.on("unhandledRejection", (err: any) => { console.error("[FATAL] Unhandled rejection (kept alive):", err?.message || err); });
process.on("SIGINT", () => { watcher.stop(); process.exit(0); });
process.on("SIGTERM", () => { watcher.stop(); process.exit(0); });
