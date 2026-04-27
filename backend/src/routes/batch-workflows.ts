import { Router } from "express";
import { readFile, writeFile, mkdir, copyFile, rm } from "fs/promises";
import { join, dirname, basename } from "path";
import { existsSync, cpSync, mkdirSync } from "fs";
import { v4 as uuid } from "uuid";
import * as yaml from "js-yaml";
import { loadSettings } from "../helpers/settings.js";

const WORKFLOWS_FILE = join(process.cwd(), ".data", "batch-workflows.json");
const WORKFLOWS_DIR = join(process.cwd(), ".data", "batch-workflows");
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


function inlineHealthcheckTests(yamlStr: string): string {
  return yamlStr.replace(/test:\n((?:\s+-\s+.+\n)+)/g, (_match, items) => {
    const vals = items.trim().split("\n").map((l: string) => {
      let v = l.replace(/^\s*-\s*/, "").trim();
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      return '"' + v + '"';
    });
    return "test: [" + vals.join(", ") + "]\n";
  });
}

function parseEnvFile(content: string): { key: string; value: string }[] {
  return content.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => { const [k, ...v] = l.split("="); return { key: k.trim(), value: v.join("=").trim() }; })
    .filter(e => e.key);
}

function serializeEnvFile(vars: { key: string; value: string }[]): string {
  return vars.map(e => `${e.key}=${e.value}`).join("\n") + "\n";
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
  const wfDir = join(WORKFLOWS_DIR, wf.id);
  await mkdir(wfDir, { recursive: true });
  await writeFile(join(wfDir, ".env"), "");
  await writeFile(join(wfDir, "docker-compose.yml"), 'version: "3.8"\nservices: {}\n');
  (wf as any).composePath = join(wfDir, "docker-compose.yml");
  (wf as any).envFilePath = join(wfDir, ".env");
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
  // Docker down on effective compose if it exists
  try {
    const { execSync } = await import("child_process");
    const effCompose = join(WORKFLOWS_DIR, req.params.id, "effective-docker-compose.yml");
    if (existsSync(effCompose)) {
      const isWin = process.platform === "win32";
      const wslPath = effCompose.replace(/\\\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
      const cmd = isWin
        ? `wsl bash -c "docker compose -f '${wslPath}' down --volumes --remove-orphans 2>&1; true"`
        : `bash -c 'docker compose -f "${effCompose}" down --volumes --remove-orphans 2>&1; true'`;
      execSync(cmd, { timeout: 30000, stdio: "ignore" });
    }
  } catch {}
  const wfDir = join(WORKFLOWS_DIR, req.params.id);
  try { await rm(wfDir, { recursive: true, force: true }); } catch {}
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
  const oldPositions = layoutNodes(meta.services);
  const nodeMap = new Map<string, string>();
  const nodes: BatchJobNode[] = meta.services.map((s: any) => {
    const id = uuid();
    nodeMap.set(s.name, id);
    const pos = oldPositions.get(s.name) || { x: 0, y: 0 };
    return {
      id, name: s.name, imageName: meta.imageTag,
      command: Array.isArray(s.command) ? s.command.join(" ") : s.command || undefined,
      args: [], envVars: s.envVars.filter((e: any) => !commonKeySet.has(e.key)),
      timeout: 300, position: pos,
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


function layoutNodes(services: { name: string; dependsOn: string[] }[], auxiliaryNames?: Set<string>): Map<string, { x: number; y: number }> {
  // Compute depth: nodes with no deps = level 0, nodes depending on level 0 = level 1, etc.
  const depth = new Map<string, number>();
  const names = new Set(services.map(s => s.name));
  function getDepth(name: string, visited = new Set<string>()): number {
    if (depth.has(name)) return depth.get(name)!;
    if (visited.has(name)) return 0;
    visited.add(name);
    const svc = services.find(s => s.name === name);
    if (!svc || !svc.dependsOn.length) { depth.set(name, 0); return 0; }
    const parentDepths = svc.dependsOn.filter(d => names.has(d) && !(auxiliaryNames?.has(d))).map(d => getDepth(d, visited));
    const d = parentDepths.length ? Math.max(...parentDepths) + 1 : 0;
    depth.set(name, d);
    return d;
  }
  for (const s of services) getDepth(s.name);

  // Group by level
  const levels = new Map<number, string[]>();
  for (const s of services) {
    const d = depth.get(s.name) || 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(s.name);
  }

  // Position: each level is a row, nodes spread horizontally centered
  const positions = new Map<string, { x: number; y: number }>();
  const NODE_W = 280;
  const NODE_H = 180;
  for (const [level, names] of levels) {
    const totalWidth = names.length * NODE_W;
    const startX = -(totalWidth / 2) + NODE_W / 2;
    names.forEach((name, i) => {
      positions.set(name, { x: startX + i * NODE_W, y: level * NODE_H });
    });
  }
  return positions;
}

const DEFAULT_EXCLUDE = ["localstack", "mockoon", "vault", "vault-setup", "redis", "dynamodb-local", "minio", "zookeeper", "kafka", "elasticsearch", "postgres", "mysql", "mongo", "rabbitmq", "nginx", "traefik", "consul", "etcd", "adminer", "sftp"];

router.post("/:id/import-file", async (req, res) => {
  const { filePath, exclude = [] } = req.body;
  if (!filePath) return res.status(400).json({ error: "filePath required" });
  if (!existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  const wfs = await loadWorkflows();
  const wf = wfs.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });

  const raw = await readFile(filePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return res.status(400).json({ error: "No services found in compose file" });

  const excludeSet = new Set([...DEFAULT_EXCLUDE, ...exclude].map((s: string) => s.toLowerCase()));
  const batchServiceEntries = Object.entries(doc.services).filter(([name]) => !excludeSet.has(name.toLowerCase()));

  // Validate env_file consistency across batch services
  const envFileRefs: { name: string; files: string[] }[] = batchServiceEntries.map(([name, svc]: [string, any]) => {
    const ef = Array.isArray(svc.env_file) ? svc.env_file : svc.env_file ? [svc.env_file] : [];
    return { name, files: ef };
  });

  const withEnvFile = envFileRefs.filter(r => r.files.length > 0);
  const withoutEnvFile = envFileRefs.filter(r => r.files.length === 0);

  // If some have env_file and some don't → fail
  if (withEnvFile.length > 0 && withoutEnvFile.length > 0) {
    return res.status(400).json({
      error: "Inconsistent env_file usage",
      details: `These containers use env_file: ${withEnvFile.map(r => r.name).join(", ")}. These do not: ${withoutEnvFile.map(r => r.name).join(", ")}. All batch containers must reference the same .env file. Add env_file to the missing containers.`,
    });
  }

  // If any have multiple env_file entries → fail
  const multiFile = withEnvFile.filter(r => r.files.length > 1);
  if (multiFile.length) {
    return res.status(400).json({
      error: "Multiple env_file entries not supported",
      details: `Container(s) ${multiFile.map(r => r.name).join(", ")} reference multiple env files. Mouseketool currently supports a single shared .env file per workflow.`,
    });
  }

  // If they have env_file, all must reference the same file
  if (withEnvFile.length > 0) {
    const uniqueFiles = new Set(withEnvFile.map(r => r.files[0]));
    if (uniqueFiles.size > 1) {
      return res.status(400).json({
        error: "Different env_file references",
        details: `Containers reference different .env files: ${[...uniqueFiles].join(", ")}. All batch containers must reference the same .env file.`,
      });
    }
  }

  // Determine the .env file path
  const composeDir = dirname(filePath);
  const envFileName = withEnvFile.length > 0 ? withEnvFile[0].files[0] : null;
  const envFilePath = envFileName ? join(composeDir, envFileName) : null;

  // Parse common env vars from .env file
  let commonEnvVars: { key: string; value: string }[] = [];
  if (envFilePath && existsSync(envFilePath)) {
    const envContent = await readFile(envFilePath, "utf-8");
    commonEnvVars = parseEnvFile(envContent);
  }

  // Copy files to metadata folder
  const wfDir = join(WORKFLOWS_DIR, wf.id);
  await mkdir(wfDir, { recursive: true });
  const copiedCompose = join(wfDir, "docker-compose.yml");
  const warnings: string[] = [];
  await copyFile(filePath, copiedCompose);
  if (envFilePath && existsSync(envFilePath)) {
    await copyFile(envFilePath, join(wfDir, envFileName!));
    if (envFileName !== ".env") try { await rm(join(wfDir, ".env")); } catch {}
  } else {
    // No .env file — create an empty one
    await writeFile(join(wfDir, ".env"), "");
  }

  // Copy volume-mapped files/dirs to workflow metadata
  const bumpedServices: string[] = [];
  const settings = await loadSettings();
  if (settings.workflow.autoBumpHealthchecks) {
  // Bump healthcheck settings for reliability
  const healthySvcNames = new Set<string>();
  for (const [svcName, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!svc.healthcheck) continue;
    healthySvcNames.add(svcName);
    for (const key of ["interval", "timeout"] as const) {
      const cur = svc.healthcheck[key]; const sec = cur ? parseInt(String(cur)) : 0;
      if (sec < 20) { svc.healthcheck[key] = "20s"; if (!bumpedServices.includes(svcName)) bumpedServices.push(svcName); }
    }
    const sp = svc.healthcheck.start_period; const spSec = sp ? parseInt(String(sp)) : 0;
    if (spSec < 60) { svc.healthcheck.start_period = "60s"; if (!bumpedServices.includes(svcName)) bumpedServices.push(svcName); }
    const ret = svc.healthcheck.retries; if (!ret || ret < 10) { svc.healthcheck.retries = 10; }
  }
  // Auto-add healthcheck for common DB containers that lack one
  for (const [svcName, svc] of Object.entries(doc.services) as [string, any][]) {
    if (svc.healthcheck) continue;
    const img = (svc.image || "").toLowerCase();
    if (img.includes("mysql")) {
      svc.healthcheck = { test: ["CMD", "mysqladmin", "ping", "-h", "localhost"], interval: "20s", timeout: "20s", retries: 10, start_period: "60s" };
      healthySvcNames.add(svcName);
      bumpedServices.push(svcName);
    } else if (img.includes("postgres")) {
      svc.healthcheck = { test: ["CMD-SHELL", "pg_isready"], interval: "20s", timeout: "20s", retries: 10, start_period: "60s" };
      healthySvcNames.add(svcName);
      bumpedServices.push(svcName);
    } else if (img.includes("redis")) {
      svc.healthcheck = { test: ["CMD", "redis-cli", "ping"], interval: "10s", timeout: "10s", retries: 5, start_period: "10s" };
      healthySvcNames.add(svcName);
    }
  }
  // Ensure depends_on uses service_healthy for containers with healthchecks
  for (const [, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!svc.depends_on) continue;
    if (typeof svc.depends_on === "object" && !Array.isArray(svc.depends_on)) {
      for (const [dep, cfg] of Object.entries(svc.depends_on) as [string, any][]) {
        if (healthySvcNames.has(dep) && cfg?.condition !== "service_healthy" && cfg?.condition !== "service_completed_successfully") {
          svc.depends_on[dep] = { condition: "service_healthy" };
        }
      }
    }
  }
  } // end autoBumpHealthchecks
  await writeFile(copiedCompose, inlineHealthcheckTests(yaml.dump(doc, { lineWidth: -1, noRefs: true })));

  for (const [, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!Array.isArray(svc.volumes)) continue;
    for (const v of svc.volumes) {
      const hostPath = String(v).split(":")[0];
      if (!hostPath || hostPath.startsWith("/")) continue;
      const srcPath = join(composeDir, hostPath);
      const destPath = join(wfDir, hostPath);
      if (!existsSync(srcPath)) continue;
      try {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath, { recursive: true });
      } catch {}
    }
  }

  // Parse services for nodes
  const allServices = Object.entries(doc.services).map(([name, svc]: [string, any]) => ({
    name,
    image: svc.image || null,
    build: svc.build ? (typeof svc.build === "string" ? svc.build : svc.build.context || ".") : null,
    command: svc.command || null,
    ports: Array.isArray(svc.ports) ? svc.ports.map(String) : [],
    volumes: Array.isArray(svc.volumes) ? svc.volumes.map(String) : [],
    envVars: parseEnvVars(svc.environment),
    dependsOn: Array.isArray(svc.depends_on) ? svc.depends_on : svc.depends_on ? Object.keys(svc.depends_on) : [],
  }));

  const batchServices = allServices.filter(s => !excludeSet.has(s.name.toLowerCase()));
  const auxiliaryNames = new Set(allServices.filter(s => excludeSet.has(s.name.toLowerCase())).map(s => s.name));

  const positions = layoutNodes(batchServices, auxiliaryNames);
  const nodeMap = new Map<string, string>();
  const nodes: BatchJobNode[] = batchServices.map((s) => {
    const id = uuid();
    nodeMap.set(s.name, id);
    const pos = positions.get(s.name) || { x: 0, y: 0 };
    return {
      id, name: s.name, imageName: s.image || s.build || "",
      command: Array.isArray(s.command) ? s.command.join(" ") : s.command || undefined,
      args: [], envVars: s.envVars,
      timeout: 300, position: pos,
    };
  });

  const edges: { source: string; target: string }[] = [];
  for (const s of batchServices) {
    for (const dep of s.dependsOn) {
      if (auxiliaryNames.has(dep)) continue;
      if (dep === s.name) { warnings.push(`Container "${s.name}" has a self-dependency — skipped`); continue; }
      const sourceId = nodeMap.get(dep);
      const targetId = nodeMap.get(s.name);
      if (sourceId && targetId) edges.push({ source: sourceId, target: targetId });
    }
  }

  wf.nodes = nodes;
  wf.edges = edges;
  wf.commonEnvVars = commonEnvVars;
  wf.updatedAt = new Date().toISOString();
  (wf as any).composePath = copiedCompose;
  (wf as any).originalComposePath = filePath;
  (wf as any).envFilePath = join(wfDir, envFileName || ".env");
  (wf as any).excludeList = [...excludeSet];
  (wf as any).auxiliaryServices = [...auxiliaryNames];
  res.json({ ...wf, warnings });
});

// Save env vars back to files
router.post("/:id/save-env", async (req, res) => {
  const { commonEnvVars, nodes } = req.body;
  const wfs = await loadWorkflows();
  const wf = wfs.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: "Workflow not found" });

  const wfDir = join(WORKFLOWS_DIR, wf.id);
  const envPath = (wf as any).envFilePath || join(wfDir, ".env");
  const composePath = join(wfDir, "docker-compose.yml");

  // Write common env vars to .env file
  if (commonEnvVars) {
    wf.commonEnvVars = commonEnvVars;
    await writeFile(envPath, serializeEnvFile(commonEnvVars));
  }

  // Write per-node env vars back to compose file
  if (nodes && existsSync(composePath)) {
    const raw = await readFile(composePath, "utf-8");
    const doc = yaml.load(raw) as any;
    if (doc?.services) {
      for (const node of nodes) {
        if (doc.services[node.name]) {
          const envObj: Record<string, string> = {};
          for (const ev of node.envVars || []) { if (ev.key) envObj[ev.key] = ev.value; }
          doc.services[node.name].environment = envObj;
        }
      }
      await writeFile(composePath, inlineHealthcheckTests(yaml.dump(doc, { lineWidth: -1, noRefs: true })));
    }
    wf.nodes = nodes;
  }

  wf.updatedAt = new Date().toISOString();
  await saveWorkflows(wfs);
  res.json({ saved: true });
});

// Download effective compose
router.get("/:id/effective-compose", async (req, res) => {
  const wfDir = join(WORKFLOWS_DIR, req.params.id);
  const composePath = join(wfDir, "docker-compose.yml");
  try {
    const content = await readFile(composePath, "utf-8");
    res.json({ content });
  } catch { res.status(404).json({ error: "No compose file found" }); }
});



function parseEnvVars(env: any): { key: string; value: string }[] {
  if (!env) return [];
  if (Array.isArray(env)) return env.map((e: string) => { const [k, ...v] = e.split("="); return { key: k, value: v.join("=") }; });
  return Object.entries(env).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

export default router;
