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

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
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
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
