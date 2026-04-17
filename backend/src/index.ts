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
import { watcher } from "./services/pipeline-watcher.js";
import { initShadowInfra } from "./services/shadow-infra.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    const s = await (await import("./helpers/settings.js")).loadSettings();
    const url = `${s.localstack.protocol}://${s.localstack.host}:${s.localstack.port}/_localstack/health`;
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return res.json({ status: "ok", localstack: true });
    res.json({ status: "ok", localstack: false });
  } catch { res.json({ status: "ok", localstack: false }); }
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

// Cleanup scheduler
setInterval(cleanupBuilds, 30 * 60 * 1000);
cleanupBuilds();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  watcher.start();
  initShadowInfra();
});

process.on("SIGINT", () => { watcher.stop(); process.exit(0); });
process.on("SIGTERM", () => { watcher.stop(); process.exit(0); });
