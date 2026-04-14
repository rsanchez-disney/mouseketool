import { Router } from "express";
import { testConnection, setupSecrets, cleanupSecrets } from "../helpers/vault.js";

const router = Router();

router.post("/test-connection", async (req, res) => {
  const { url, token } = req.body;
  if (!url || !token) return res.status(400).json({ error: "url and token are required" });
  res.json(await testConnection(url, token));
});

router.post("/setup-secrets", async (req, res) => {
  const { url, token, secrets } = req.body;
  if (!url || !token || !secrets?.length) return res.status(400).json({ error: "url, token, and secrets are required" });
  res.json(await setupSecrets(url, token, secrets));
});

router.post("/cleanup-secrets", async (req, res) => {
  const { url, token, paths } = req.body;
  if (!url || !token || !paths?.length) return res.status(400).json({ error: "url, token, and paths are required" });
  res.json(await cleanupSecrets(url, token, paths));
});

export default router;
