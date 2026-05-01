import { Router } from "express";
import { loadSettings, saveSettings } from "../helpers/settings.js";
import { DEFAULTS } from "../config/interfaces.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json(await loadSettings());
});

router.get("/defaults", async (_req, res) => { const { readFile } = await import("fs/promises"); const { join } = await import("path"); try { res.json(JSON.parse(await readFile(join(process.cwd(), ".data", "defaults.json"), "utf-8"))); } catch { res.json({}); } });

router.put("/", async (req, res) => {
  const settings = await saveSettings({ ...DEFAULTS, ...req.body });

  // Re-apply heavy load settings to all pipelines with heavyLoad enabled
  try {
    const { loadPipelines } = await import("../services/pipeline-watcher.js");
    const { getLambdaClient } = await import("../helpers/lambda-client.js");
    const { UpdateEventSourceMappingCommand } = await import("@aws-sdk/client-lambda");
    const pipelines = loadPipelines().filter(p => p.heavyLoad);
    if (pipelines.length) {
      const client = await getLambdaClient();
      const batch = settings.heavyLoad?.batchSize ?? 1000;
      const window = settings.heavyLoad?.batchWindowSeconds ?? 300;
      for (const p of pipelines) {
        const uuid = p.uuids[0];
        if (uuid) {
          try { await client.send(new UpdateEventSourceMappingCommand({ UUID: uuid, BatchSize: batch, MaximumBatchingWindowInSeconds: window })); } catch {}
        }
      }
    }
  } catch {}

  res.json(settings);
});

export default router;
