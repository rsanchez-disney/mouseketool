import { Router } from "express";
import { loadSettings, saveSettings } from "../helpers/settings.js";
import { DEFAULTS } from "../config/interfaces.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json(await loadSettings());
});

router.put("/", async (req, res) => {
  res.json(await saveSettings({ ...DEFAULTS, ...req.body }));
});

export default router;
