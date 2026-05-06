// force restart
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
const __pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
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
import statsRoutes from "./routes/stats.js";
import localstackRoutes from "./routes/localstack.js";
import profileRoutes from "./routes/profile.js";
import { startContainerWatchdog } from "./services/container-watchdog.js";
import { watcher } from "./services/pipeline-watcher.js";
import { initPipelineWs } from "./services/pipeline-ws.js";
import { initShadowInfra, ensureBucketExists } from "./services/shadow-infra.js";
import { reconcilePipelines } from "./services/reconcile.js";
import { reconcileDeployments } from "./routes/deployments.js";
import { readdirSync, existsSync, readFileSync } from "fs";



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
app.get("/api/version", (_req, res) => {
  const pkg = JSON.parse(readFileSync(__pkgPath, "utf-8"));
  res.json({ version: pkg.version });
});
app.get("/api/update-check", async (_req, res) => {
  try {
    const pkg = JSON.parse(readFileSync(__pkgPath, "utf-8"));
    const repo = pkg.repository?.url?.replace(/\.git$/, "")?.replace("https://github.com/", "") || pkg.repository || "";
    if (!repo) return res.json({ available: false });
    const r = await fetch(`https://github.disney.com/api/v3/repos/${repo}/releases/latest`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/vnd.github.v3+json" } });
    if (!r.ok) return res.json({ available: false });
    const data = await r.json() as any;
    const latest = data.tag_name?.replace(/^v/, "") || "";
    const current = pkg.version;
    const available = latest && latest !== current && latest.localeCompare(current, undefined, { numeric: true }) > 0;
    res.json({ available, latest, current, url: data.html_url });
  } catch { res.json({ available: false }); }
});
app.use("/api/stats", statsRoutes);
app.use("/api/localstack", localstackRoutes);
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
app.use("/api/profile", profileRoutes);

// Cleanup scheduler
setInterval(cleanupBuilds, 30 * 60 * 1000);
cleanupBuilds();

// In production (Electron), serve the frontend static files
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.join(process.cwd(), "..", "frontend", "dist");
  console.log(`[static] Serving frontend from: ${frontendDist} (exists: ${existsSync(frontendDist)})`);
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.use((req, res, next) => { if (req.path.startsWith("/api/") || req.path.startsWith("/ws/")) return next(); res.sendFile(path.join(frontendDist, "index.html")); });
  }
}

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  watcher.start();
  initPipelineWs(server);
  initShadowInfra();
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
      console.log("[health] LocalStack recovered - running reconciliation");
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
process.on("SIGINT", async () => { watcher.stop(); try { const { execSync } = await import("child_process"); const cmd = process.platform === "win32" ? "wsl docker stop mouseketool-localstack" : "docker stop mouseketool-localstack"; execSync(cmd, { stdio: "ignore", timeout: 10000 }); } catch {} process.exit(0); });
process.on("SIGTERM", async () => { watcher.stop(); try { const { execSync } = await import("child_process"); const cmd = process.platform === "win32" ? "wsl docker stop mouseketool-localstack" : "docker stop mouseketool-localstack"; execSync(cmd, { stdio: "ignore", timeout: 10000 }); } catch {} process.exit(0); });
