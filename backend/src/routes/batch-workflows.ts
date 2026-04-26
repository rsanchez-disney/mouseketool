import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";

const WORKFLOWS_FILE = join(process.cwd(), ".data", "batch-workflows.json");
const router = Router();

interface BatchJobNode {
  id: string; name: string; description?: string; imageName: string;
  command?: string; args: string[]; envVars: { key: string; value: string }[];
  timeout: number; position: { x: number; y: number };
}

interface BatchWorkflow {
  id: string; name: string;
  scannedEnvVars: { key: string; value: string }[];
  commonEnvVars: { key: string; value: string }[];
  nodes: BatchJobNode[]; edges: { source: string; target: string }[];
  createdAt: string; updatedAt: string;
}

async function loadWorkflows(): Promise<BatchWorkflow[]> {
  try { return JSON.parse(await readFile(WORKFLOWS_FILE, "utf-8")); } catch { return []; }
}

async function saveWorkflows(wfs: BatchWorkflow[]) {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(WORKFLOWS_FILE, JSON.stringify(wfs, null, 2));
}

router.get("/", async (_req, res) => { res.json(await loadWorkflows()); });

router.post("/", async (req, res) => {
  const { name } = req.body;
  const wf: BatchWorkflow = {
    id: uuid(), name: name || "New Workflow",
    scannedEnvVars: [], commonEnvVars: [], nodes: [], edges: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const wfs = await loadWorkflows();
  wfs.push(wf);
  await saveWorkflows(wfs);
  res.json(wf);
});

router.put("/:id", async (req, res) => {
  const wfs = await loadWorkflows();
  const idx = wfs.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Workflow not found" });
  const { name, nodes, edges, commonEnvVars, scannedEnvVars } = req.body;
  if (name !== undefined) wfs[idx].name = name;
  if (nodes !== undefined) wfs[idx].nodes = nodes;
  if (edges !== undefined) wfs[idx].edges = edges;
  if (commonEnvVars !== undefined) wfs[idx].commonEnvVars = commonEnvVars;
  if (scannedEnvVars !== undefined) wfs[idx].scannedEnvVars = scannedEnvVars;
  wfs[idx].updatedAt = new Date().toISOString();
  await saveWorkflows(wfs);
  res.json(wfs[idx]);
});

router.delete("/:id", async (req, res) => {
  const wfs = await loadWorkflows();
  const filtered = wfs.filter(w => w.id !== req.params.id);
  if (filtered.length === wfs.length) return res.status(404).json({ error: "Workflow not found" });
  await saveWorkflows(filtered);
  res.json({ deleted: true });
});

router.post("/:id/import", async (req, res) => {
  const { buildId } = req.body;
  if (!buildId) return res.status(400).json({ error: "buildId required" });

  const wfs = await loadWorkflows();
  const wf = wfs.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });

  // Load build metadata with parsed services
  const BATCH_BUILDS_DIR = join(process.cwd(), ".data", "batch-builds");
  let meta: any;
  try { meta = JSON.parse(await readFile(join(BATCH_BUILDS_DIR, buildId, "meta.json"), "utf-8")); }
  catch { return res.status(404).json({ error: "Build not found" }); }

  if (!meta.services?.length) return res.status(400).json({ error: "No docker-compose services found in this build" });

  // Find common env vars (same key+value across ALL services)
  const allEnvMaps = meta.services.map((s: any) => new Map(s.envVars.map((e: any) => [e.key, e.value])));
  const commonKeys = allEnvMaps[0] ? [...allEnvMaps[0].keys()].filter((k: string) =>
    allEnvMaps.every((m: Map<string, string>) => m.get(k) === allEnvMaps[0].get(k))
  ) : [];
  const commonEnvVars = commonKeys.map((k: string) => ({ key: k, value: allEnvMaps[0].get(k)! }));
  const commonKeySet = new Set(commonKeys);

  // Create nodes from services
  const nodeMap = new Map<string, string>();
  const nodes: BatchJobNode[] = meta.services.map((s: any, i: number) => {
    const id = uuid();
    nodeMap.set(s.name, id);
    return {
      id, name: s.name, imageName: meta.imageTag,
      command: Array.isArray(s.command) ? s.command.join(" ") : s.command || undefined,
      args: [], envVars: s.envVars.filter((e: any) => !commonKeySet.has(e.key)),
      timeout: 300, position: { x: 250 * i, y: 100 + (s.dependsOn?.length ? 200 : 0) },
    };
  });

  // Create edges from depends_on
  const edges: { source: string; target: string }[] = [];
  for (const s of meta.services) {
    for (const dep of s.dependsOn || []) {
      const sourceId = nodeMap.get(dep);
      const targetId = nodeMap.get(s.name);
      if (sourceId && targetId) edges.push({ source: sourceId, target: targetId });
    }
  }

  wf.nodes = nodes;
  wf.edges = edges;
  wf.commonEnvVars = commonEnvVars;
  wf.updatedAt = new Date().toISOString();
  await saveWorkflows(wfs);
  res.json(wf);
});

export default router;
