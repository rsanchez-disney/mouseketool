import { Router } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import yaml from "js-yaml";

const BATCH_PROJECTS_FILE = join(process.cwd(), ".data", "batch-projects.json");
const router = Router();

interface EnvPreset {
  id: string; name: string; projectId: string; active: boolean;
  sections: { source: string; vars: { key: string; value: string }[] }[];
}

const PRESETS_FILE = join(process.cwd(), ".data", "batch-presets.json");
async function loadPresets(): Promise<EnvPreset[]> { try { return JSON.parse(await readFile(PRESETS_FILE, "utf-8")); } catch { return []; } }
async function savePresets(p: EnvPreset[]) { await writeFile(PRESETS_FILE, JSON.stringify(p, null, 2)); }

interface BatchProject {
  id: string; name: string; projectPath: string; dockerfile: string; composefile: string;
  composeFiles: string[]; imageTag: string; services: any[]; createdAt: string;
}

async function loadProjects(): Promise<BatchProject[]> {
  try { return JSON.parse(await readFile(BATCH_PROJECTS_FILE, "utf-8")); } catch { return []; }
}

async function saveProjects(projects: BatchProject[]) {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(BATCH_PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

router.get("/", async (_req, res) => { res.json(await loadProjects()); });

router.post("/", async (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath) return res.status(400).json({ error: "projectPath required" });

  const name = projectPath.split(/[/\\]/).pop() || "unknown";
  const tag = `mouseketool-batch/${name}:latest`;
  const { detectedDockerfile, composeFiles } = scanProjectFiles(projectPath);
  const df = detectedDockerfile || "Dockerfile";

  let services: any[] = [];
  if (composeFiles.length) {
    try { services = await parseDockerCompose(projectPath, composeFiles[0]); } catch {}
  }

  const project: BatchProject = { id: uuid(), name, projectPath, dockerfile: df, composefile: composeFiles[0] || "", composeFiles, imageTag: tag, services, createdAt: new Date().toISOString() };
  const projects = await loadProjects();
  projects.push(project);
  await saveProjects(projects);
  watchProject(project.id, project.projectPath);
  res.json(project);
});

router.delete("/:id", async (req, res) => {
  const projects = await loadProjects();
  const filtered = projects.filter(p => p.id !== req.params.id);
  if (filtered.length === projects.length) return res.status(404).json({ error: "Project not found" });
  unwatchProject(req.params.id);
  await saveProjects(filtered);
  res.json({ deleted: true });
});

router.get("/:id/services", async (req, res) => {
  const projects = await loadProjects();
  const p = projects.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  const cf = (req.query.compose as string) || p.composefile;
  try {
    const services = await parseDockerCompose(p.projectPath, cf);
    res.json(services);
  } catch { res.json(p.services || []); }
});

// Re-scan docker-compose for a project
router.post("/:id/rescan", async (req, res) => {
  const projects = await loadProjects();
  const p = projects.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  const { detectedDockerfile, composeFiles } = scanProjectFiles(p.projectPath);
  if (detectedDockerfile) p.dockerfile = detectedDockerfile;
  p.composeFiles = composeFiles;
  if (!p.composefile && composeFiles.length) p.composefile = composeFiles[0];
  try { p.services = await parseDockerCompose(p.projectPath, p.composefile); } catch { p.services = []; }
  await saveProjects(projects);
  res.json(p);
});

function scanProjectFiles(projectPath: string): { detectedDockerfile: string; composeFiles: string[] } {
  let detectedDockerfile = "";
  const composeFiles: string[] = [];
  try {
    const files = readdirSync(projectPath);
    // Dockerfile detection
    const dockerfilePatterns = ["Dockerfile", "dockerfile", "Dockerfile.local", "Dockerfile.dev"];
    for (const p of dockerfilePatterns) {
      if (files.includes(p)) { detectedDockerfile = p; break; }
    }
    if (!detectedDockerfile) {
      const df = files.find(f => f.toLowerCase().startsWith("dockerfile"));
      if (df) detectedDockerfile = df;
    }
    // Compose file detection — find ALL matching files
    const composePatterns = [/^docker-compose[\w.-]*\.ya?ml$/i, /^compose[\w.-]*\.ya?ml$/i];
    for (const f of files) {
      if (composePatterns.some(p => p.test(f)) && !composeFiles.includes(f)) composeFiles.push(f);
    }
  } catch {}
  return { detectedDockerfile, composeFiles };
}

async function parseDockerCompose(projectPath: string, composefile?: string): Promise<any[]> {
  const candidates = composefile
    ? [composefile, `${composefile}.yml`, `${composefile}.yaml`]
    : ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  let composePath = "";
  for (const c of candidates) {
    const p = join(projectPath, c);
    if (existsSync(p)) { composePath = p; break; }
  }
  if (!composePath) return [];

  const raw = await readFile(composePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return [];

  return Object.entries(doc.services).map(([name, svc]: [string, any]) => ({
    name,
    image: svc.image || null,
    build: svc.build ? (typeof svc.build === "string" ? svc.build : svc.build.context || ".") : null,
    command: svc.command || null,
    entrypoint: svc.entrypoint || null,
    ports: Array.isArray(svc.ports) ? svc.ports.map(String) : [],
    volumes: Array.isArray(svc.volumes) ? svc.volumes.map(String) : [],
    envVars: parseEnvVars(svc.environment),
    envFiles: Array.isArray(svc.env_file) ? svc.env_file : svc.env_file ? [svc.env_file] : [],
    dependsOn: Array.isArray(svc.depends_on) ? svc.depends_on : svc.depends_on ? Object.keys(svc.depends_on) : [],
  }));
}

function parseEnvVars(env: any): { key: string; value: string }[] {
  if (!env) return [];
  if (Array.isArray(env)) return env.map((e: string) => { const [k, ...v] = e.split("="); return { key: k, value: v.join("=") }; });
  return Object.entries(env).map(([key, value]) => ({ key, value: String(value ?? "") }));
}

// Scan project for env vars (.env files, docker-compose, etc.)
router.get("/:id/file", async (req, res) => {
  const projects = await loadProjects();
  const p = projects.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const full = join(p.projectPath, filePath);
  if (!full.startsWith(p.projectPath)) return res.status(403).json({ error: "Access denied" });
  try { const content = await readFile(full, "utf-8"); res.json({ content }); }
  catch { res.status(404).json({ error: "File not found" }); }
});

router.get("/:id/env-scan", async (req, res) => {
  const projects = await loadProjects();
  const p = projects.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  const cf = (req.query.compose as string) || p.composefile;
  const vars: { key: string; value: string; source: string }[] = [];
  // Re-parse compose file live
  let services: any[] = [];
  try { services = await parseDockerCompose(p.projectPath, cf); } catch {}
  for (const svc of services) {
    for (const ev of svc.envVars || []) {
      if (!vars.some(v => v.key === ev.key)) vars.push({ ...ev, source: `compose:${svc.name}` });
    }
  }
  // From .env files referenced in docker-compose
  for (const svc of services) {
    for (const envFile of svc.envFiles || []) {
      try {
        const content = await readFile(join(p.projectPath, envFile), "utf-8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const [k, ...v] = trimmed.split("=");
          if (k && !vars.some(e => e.key === k)) vars.push({ key: k, value: v.join("="), source: `file:${envFile}` });
        }
      } catch {}
    }
  }
  // From .env in project root
  try {
    const content = await readFile(join(p.projectPath, ".env"), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [k, ...v] = trimmed.split("=");
      if (k && !vars.some(e => e.key === k)) vars.push({ key: k, value: v.join("="), source: "file:.env" });
    }
  } catch {}
  res.json(vars);
});

import { watchProject, unwatchProject, onProjectChange } from "../services/batch-watcher.js";

// Preset CRUD
router.get("/:id/presets", async (req, res) => {
  const presets = await loadPresets();
  res.json(presets.filter(p => p.projectId === req.params.id));
});

router.post("/:id/presets", async (req, res) => {
  const { name, sections } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const preset: EnvPreset = { id: uuid(), name, projectId: req.params.id, active: false, sections: sections || [] };
  const presets = await loadPresets();
  presets.push(preset);
  await savePresets(presets);
  res.json(preset);
});

router.put("/:id/presets/:presetId", async (req, res) => {
  const presets = await loadPresets();
  const p = presets.find(p => p.id === req.params.presetId && p.projectId === req.params.id);
  if (!p) return res.status(404).json({ error: "Preset not found" });
  if (req.body.name !== undefined) p.name = req.body.name;
  if (req.body.sections !== undefined) p.sections = req.body.sections;
  if (req.body.active !== undefined) {
    if (req.body.active) presets.filter(x => x.projectId === req.params.id).forEach(x => x.active = false);
    p.active = req.body.active;
  }
  await savePresets(presets);
  res.json(p);
});

router.delete("/:id/presets/:presetId", async (req, res) => {
  const presets = await loadPresets();
  const filtered = presets.filter(p => !(p.id === req.params.presetId && p.projectId === req.params.id));
  await savePresets(filtered);
  res.json({ deleted: true });
});

// SSE endpoint for file change notifications
router.get("/watch", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const unsub = onProjectChange((projectId) => {
    res.write(`data: ${JSON.stringify({ projectId })}\n\n`);
  });
  req.on("close", unsub);
});

// Start watching all registered projects on import
(async () => {
  try {
    const projects = await loadProjects();
    for (const p of projects) watchProject(p.id, p.projectPath);
  } catch {}
})();

export { loadProjects };
export default router;
