import { Router } from "express";
import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const dirPath = resolve((req.query.path as string) || homedir());
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      try { items.push({ name: e.name, path: join(dirPath, e.name), isDirectory: e.isDirectory() }); } catch { /* skip */ }
    }
    items.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    res.json({ path: dirPath, parent: resolve(dirPath, ".."), items });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
