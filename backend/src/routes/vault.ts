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

// POST /api/vault/read-paths — get key count per path
router.post("/read-paths", async (req, res) => {
  const { url, token, paths } = req.body;
  if (!url || !token || !paths?.length) return res.status(400).json({ error: "url, token, and paths are required" });
  const results: { path: string; keys: number }[] = [];
  for (const path of paths) {
    try {
      const r = await fetch(`${url}/v1/secret/data/${path}`, { headers: { "X-Vault-Token": token } });
      if (r.ok) {
        const data = await r.json();
        results.push({ path, keys: Object.keys(data?.data?.data ?? {}).length });
      } else { results.push({ path, keys: 0 }); }
    } catch { results.push({ path, keys: 0 }); }
  }
  res.json(results);
});


// POST /api/vault/read-secrets — get full key-value pairs per path
router.post("/read-secrets", async (req, res) => {
  const { url, token, paths } = req.body;
  if (!url || !token || !paths?.length) return res.status(400).json({ error: "url, token, and paths are required" });
  const results: { path: string; entries: { key: string; value: string }[] }[] = [];
  for (const path of paths) {
    try {
      const r = await fetch(`${url}/v1/secret/data/${path}`, { headers: { "X-Vault-Token": token } });
      if (r.ok) {
        const data = await r.json();
        const kv = data?.data?.data ?? {};
        results.push({ path, entries: Object.entries(kv).map(([k, v]) => ({ key: k, value: String(v) })) });
      } else { results.push({ path, entries: [] }); }
    } catch { results.push({ path, entries: [] }); }
  }
  res.json(results);
});

export default router;
