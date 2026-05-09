import { randomUUID } from "crypto";
import { initRunLogs, pushLog, pushEvent, finishRun, deleteRunLogs, getRunLogs, subscribe, getActiveRunId, setActiveRunId } from "../services/run-log-store.js";
// batch-runs: image rebuild + auto-teardown
import { Router } from "express";
import { exec, execSync, spawn, ChildProcess } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { SETTINGS_DIR } from "../config/constants.js";
import { join, dirname, basename } from "path";
import { v4 as uuid } from "uuid";
import { stripAnsi } from "../helpers/ansi.js";
import * as yaml from "js-yaml";

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

function getListeningPorts(): Set<number> {
  try {
    const isWin = process.platform === "win32";
    const out = execSync(isWin ? "netstat -ano" : "netstat -tlnp 2>/dev/null || ss -tlnp", { encoding: "utf-8", timeout: 3000 });
    const ports = new Set<number>();
    for (const line of out.split("\n")) {
      if (isWin && !line.includes("LISTENING")) continue;
      const m = line.match(/:(\d+)\s/);
      if (m) ports.add(parseInt(m[1], 10));
    }
    return ports;
  } catch { return new Set(); }
}

interface PortRemap { service: string; original: string; hostPort: number; newHostPort: number; containerPort: string }

async function buildEffectiveCompose(projectPath: string, composefile: string): Promise<{ remaps: PortRemap[]; effectivePath: string }> {
  const candidates = [composefile, `${composefile}.yml`, `${composefile}.yaml`];
  let composePath = "";
  for (const c of candidates) { const p = join(projectPath, c); if (existsSync(p)) { composePath = p; break; } }
  if (!composePath) return { remaps: [], effectivePath: "" };

  let raw = await readFile(composePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return { remaps: [], effectivePath: "" };

  const listening = getListeningPorts();
  const claimed = new Set(listening);
  const remaps: PortRemap[] = [];

  for (const [svcName, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!Array.isArray(svc.ports)) continue;
    for (const ps of svc.ports.map(String)) {
      const parts = ps.split(":");
      const hostPort = parts.length === 3 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
      const rest = parts.length === 3 ? parts[2] : parts[1];
      if (isNaN(hostPort) || !rest) continue;
      if (claimed.has(hostPort)) {
        let np = hostPort + 1;
        while (claimed.has(np) && np < 65535) np++;
        claimed.add(np);
        remaps.push({ service: svcName, original: ps, hostPort, newHostPort: np, containerPort: rest });
        // String replace in the raw YAML to preserve formatting
        const newPs = parts.length === 3 ? `${parts[0]}:${np}:${rest}` : `${np}:${rest}`;
        raw = raw.replace(ps, newPs);
      } else {
        claimed.add(hostPort);
      }
    }
  }

  const dir = join(SETTINGS_DIR, "batch-compose");
  await mkdir(dir, { recursive: true });

  // Resolve relative paths to absolute (build, volumes, env_file)
  const toAbs = (rel: string) => {
    const abs = join(projectPath, rel).replace(/\\/g, "/");
    // Convert to WSL path on Windows
    if (process.platform === "win32") return abs.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
    return abs;
  };

  for (const [, svc] of Object.entries(doc.services) as [string, any][]) {
    // build context
    if (svc.build) {
      if (typeof svc.build === "string" && svc.build.startsWith(".")) {
        const abs = toAbs(svc.build);
        raw = raw.replace(new RegExp(`(build:\\s*)${svc.build.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"), `$1${abs}`);
      } else if (svc.build?.context?.startsWith(".")) {
        const abs = toAbs(svc.build.context);
        raw = raw.replace(new RegExp(`(context:\\s*)${svc.build.context.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"), `$1${abs}`);
      }
    }
    // volumes - resolve host paths starting with ./
    if (Array.isArray(svc.volumes)) {
      for (const v of svc.volumes) {
        const vs = String(v);
        const hostPath = vs.split(":")[0];
        if (hostPath.startsWith("./") || hostPath.startsWith("../")) {
          const abs = toAbs(hostPath);
          raw = raw.replace(hostPath, abs);
        }
      }
    }
    // env_file
    const envFiles = Array.isArray(svc.env_file) ? svc.env_file : svc.env_file ? [svc.env_file] : [];
    for (const ef of envFiles) {
      if (typeof ef === "string" && !ef.startsWith("/")) {
        const abs = toAbs(ef);
        raw = raw.replace(new RegExp(`(- )?${ef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `$1${abs}`);
      }
    }
  }

  // Inject MK_CREATED_BY label
  const labelDoc = yaml.load(raw) as any;
  if (labelDoc?.services) {
    for (const [, svc] of Object.entries(labelDoc.services) as [string, any][]) {
      if (!svc.labels) svc.labels = {};
      if (Array.isArray(svc.labels)) svc.labels.push("MK_CREATED_BY=MOUSEKETOOL");
      else svc.labels["MK_CREATED_BY"] = "MOUSEKETOOL";
    }
    raw = yaml.dump(labelDoc, { lineWidth: -1, noRefs: true });
  }

  const effectivePath = join(dir, composefile.replace(/[/\\]/g, "_"));
  await writeFile(effectivePath, raw);
  return { remaps, effectivePath };
}

async function buildEffectiveComposeAbsolute(composePath: string, projectRoot?: string): Promise<{ remaps: PortRemap[]; effectivePath: string }> {
  if (!existsSync(composePath)) return { remaps: [], effectivePath: "" };

  let raw = await readFile(composePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return { remaps: [], effectivePath: "" };

  const projectPath = projectRoot || composePath.replace(/\\/g, "/").replace(/\/[^\/]+$/, "");
  const listening = getListeningPorts();
  const claimed = new Set(listening);
  const remaps: PortRemap[] = [];

  for (const [svcName, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!Array.isArray(svc.ports)) continue;
    for (const ps of svc.ports.map(String)) {
      const parts = ps.split(":");
      const hostPort = parts.length === 3 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
      const rest = parts.length === 3 ? parts[2] : parts[1];
      if (isNaN(hostPort) || !rest) continue;
      if (claimed.has(hostPort)) {
        let np = hostPort + 1;
        while (claimed.has(np) && np < 65535) np++;
        claimed.add(np);
        remaps.push({ service: svcName, original: ps, hostPort, newHostPort: np, containerPort: rest });
        const newPs = parts.length === 3 ? `${parts[0]}:${np}:${rest}` : `${np}:${rest}`;
        raw = raw.replace(ps, newPs);
      } else {
        claimed.add(hostPort);
      }
    }
  }


  const dir = dirname(composePath);
  await mkdir(dir, { recursive: true });
  // Inject MK_CREATED_BY label
  const labelDoc2 = yaml.load(raw) as any;
  if (labelDoc2?.services) {
    for (const [, svc] of Object.entries(labelDoc2.services) as [string, any][]) {
      if (!svc.labels) svc.labels = {};
      if (Array.isArray(svc.labels)) svc.labels.push("MK_CREATED_BY=MOUSEKETOOL");
      else svc.labels["MK_CREATED_BY"] = "MOUSEKETOOL";
    }
    raw = yaml.dump(labelDoc2, { lineWidth: -1, noRefs: true });
  }

  const effectivePath = join(dir, "effective-" + basename(composePath));
  await writeFile(effectivePath, raw);
  return { remaps, effectivePath };
}

const RUNS_FILE = join(SETTINGS_DIR, "batch-runs.json");
const RUNS_DIR = join(SETTINGS_DIR, "batch-runs");
const router = Router();

const dk = process.platform === "win32" ? "wsl docker" : "docker";
const compose = process.platform === "win32" ? "wsl docker compose" : "docker compose";

interface BatchRun {
  id: string; projectId: string; projectName: string; status: string;
  startedAt: string; finishedAt?: string; duration?: number; exitCode?: number;
}

async function loadRuns(): Promise<BatchRun[]> {
  try { return JSON.parse(await readFile(RUNS_FILE, "utf-8")); } catch { return []; }
}

async function saveRuns(runs: BatchRun[]) {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(RUNS_FILE, JSON.stringify(runs, null, 2));
}

function getContainerNames(composePath: string): string[] {
  try {
    const doc = yaml.load(readFileSync(composePath, "utf-8")) as any;
    if (!doc?.services) return [];
    return Object.entries(doc.services)
      .map(([name, svc]: [string, any]) => (svc as any).container_name || name)
      .filter(Boolean);
  } catch { return []; }
}

function removeContainers(names: string[], send: (e: string, d: any) => void): Promise<void> {
  if (!names.length) return Promise.resolve();
  const dk = process.platform === "win32" ? "wsl docker" : "docker";
  const cmd = process.platform === "win32" ? "wsl" : "bash";
  const joined = names.join(" ");
  const script = `docker rm -f ${joined} 2>/dev/null; true`;
  const args = process.platform === "win32" ? ["bash", "-c", script] : ["-c", script];
  send("log", { line: "Cleaning up existing containers..." });
  return new Promise(resolve => {
    const p = spawn(cmd, args);
    p.on("close", () => resolve());
    setTimeout(() => { p.kill(); resolve(); }, 10000);
  });
}

let activeRun: ChildProcess | null = null;
let activeBuildProc: ChildProcess | null = null;
let lastRunContext: { projectPath: string; composeFile: string } | null = null;
let activeWorkflowRun: ChildProcess | null = null;
let workflowAborted = false;
let lastWorkflowRunContext: { composePath: string } | null = null;

// Running state for watchdog
const runningState = { simpleProjectId: null as string | null, workflowId: null as string | null };
export function getRunningState() { return runningState; }
let activeObserverIntervals: NodeJS.Timeout[] = [];

function dockerDown(projectPath: string, composeFile: string): Promise<void> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    let cmd: string;
    let args: string[];
    if (isWin) {
      const wslProject = projectPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
      const wslCompose = composeFile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
      cmd = "wsl";
      args = ["bash", "-c", `cd '${wslProject}' && docker compose -f '${wslCompose}' down --volumes --remove-orphans 2>&1`];
    } else {
      cmd = "bash";
      args = ["-c", `cd "${projectPath}" && docker compose -f "${composeFile}" down --volumes --remove-orphans 2>&1`];
    }
    const p = spawn(cmd, args);
    p.on("close", () => resolve());
    setTimeout(() => { p.kill(); resolve(); }, 30000);
  });
}

router.post("/simple", async (req, res) => {
  const { projectId, projectPath, composefile, envOverrides, rebuild = true, portRemap = true } = req.body;
  if (!projectPath) { res.status(400).json({ error: "projectPath required" }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);
  let ended = false;
  const runId = randomUUID();
  const entityId = "simple:" + (projectId || projectPath);
  const storeId = runId;
  setActiveRunId(entityId, runId);
  initRunLogs(storeId);
  const send = (event: string, data: any) => { if (!ended) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (typeof (res as any).flush === "function") (res as any).flush(); } if (storeId) { if (event === "log") pushLog(storeId, data); else pushEvent(storeId, event, data); } };
  const finish = (reason?: string) => { if (!ended) { console.log("[batch-run] finish called:", reason || "unknown"); ended = true; res.end(); } if (storeId) finishRun(storeId); };
  send("run-id", { runId });
  send("log", { line: "Mouseketool starting run..." });

  // Fix CRLF -> LF in .sh files so Docker doesn't complain
  const fixedFiles: string[] = [];
  try {
    const scanDir = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory() && !f.name.startsWith(".") && f.name !== "node_modules" && f.name !== "target") scanDir(join(dir, f.name));
        else if (f.name.endsWith(".sh") || f.name.endsWith(".sql")) {
          const fp = join(dir, f.name);
          const content = readFileSync(fp, "utf-8");
          if (content.includes("\r\n")) {
            writeFileSync(fp, content.replace(/\r\n/g, "\n"));
            fixedFiles.push(fp.replace(projectPath, ".").replace(/\\/g, "/"));
          }
        }
      }
    };
    scanDir(projectPath);
  } catch {}
  if (fixedFiles.length) {
    send("log", { line: `[WARN] Fixed CRLF -> LF in ${fixedFiles.length} file(s):` });
    for (const f of fixedFiles) send("log", { line: `  ${f}` });
    send("log", { line: "" });
  }

  const recordId = uuid();
  const projectName = projectPath.split(/[/\\]/).pop() || "unknown";
  const cf = composefile || "docker-compose.yml";
  const startTime = Date.now();

  // Build env override flags
  const envFlags = (envOverrides || [])
    .filter((e: any) => e.key)
    .map((e: any) => `-e ${e.key}=${e.value || ""}`)
    .join(" ");

  try {

    // Analyze ports and generate modified compose
    let remaps: any[] = [];
    let effectiveCompose = cf;
    if (portRemap) { try {
      console.log("[batch-run] starting port analysis");
      const result = await buildEffectiveCompose(projectPath, cf);
      console.log("[batch-run] port analysis done, remaps:", result.remaps.length);
      remaps = result.remaps;
      if (result.effectivePath) effectiveCompose = result.effectivePath;
    } catch (e: any) {
      console.error("[batch-run] port analysis error:", e);
      send("log", { line: `[WARN] Port scan skipped: ${e.message}` });
    } }
    console.log("[batch-run] proceeding with compose:", effectiveCompose);

    if (remaps.length) {
      send("log", { line: "[WARN] Port conflicts detected - remapping:" });
      for (const r of remaps) send("log", { line: `  ${r.service}: ${r.hostPort} -> ${r.newHostPort} (container: ${r.containerPort})` });
      send("log", { line: "" });
    }

    send("remaps", remaps);

    const composeFile = effectiveCompose || cf;
    lastRunContext = { projectPath, composeFile };
    runningState.simpleProjectId = projectId || projectPath;

    // Identify app containers (services with build: directive) for exit detection
    const appContainerNames = new Set<string>();
    try {
      const compDoc = yaml.load(await readFile(composeFile, "utf-8")) as any;
      if (compDoc?.services) {
        for (const [svcName, svc] of Object.entries(compDoc.services) as [string, any][]) {
          if (svc.build || svc.image?.includes("mouseketool-batch")) appContainerNames.add(svcName.toLowerCase());
        }
      }
    } catch {}
    console.log("[batch-run] app containers to watch:", [...appContainerNames]);
    const env = { ...process.env };
    if (envOverrides) {
      for (const e of envOverrides) {
        if (e.key) env[e.key] = e.value || "";
      }
    }

    let shellCmd: string;
    let spawnArgs: string[];
    let spawnCmd: string;
    if (process.platform === "win32") {
      const wslProject = projectPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
      const wslCompose = composeFile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
      spawnCmd = "wsl";
      spawnArgs = ["bash", "-c", `cd '${wslProject}' && docker compose -f '${wslCompose}' up --build --force-recreate`];
    } else {
      spawnCmd = "bash";
      spawnArgs = ["-c", `cd "${projectPath}" && docker compose -f "${composeFile}" up --build --force-recreate`];
    }

    // Image rebuild logic: build tagged image, replace build: with image: in effective compose
    let imageTag = "";
    let dockerfile = "";
    if (projectId) {
      try {
        const projects = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-projects.json"), "utf-8"));
        const proj = projects.find((p: any) => p.id === projectId);
        if (proj) { imageTag = proj.imageTag || ""; dockerfile = proj.dockerfile || ""; }
      } catch {}
    }
    if (imageTag && dockerfile) {
      // Replace build: directives with image: in the effective compose
      try {
        let composeContent = await readFile(composeFile, "utf-8");
        // Remove build: lines (both "build: ." and multi-line build: context/dockerfile)
        composeContent = composeContent.replace(/^(\s*)build:.*$/gm, `$1image: ${imageTag}`);
        composeContent = composeContent.replace(/^\s*context:.*$\n?/gm, "");
        composeContent = composeContent.replace(/^\s*dockerfile:.*$\n?/gm, "");
        // Inject env overrides into app service
        if (envOverrides?.length) {
          const doc = yaml.load(composeContent) as any;
          if (doc?.services) {
            for (const [, svc] of Object.entries(doc.services) as [string, any][]) {
              if (svc.image?.includes("mouseketool-batch") || svc.build) {
                if (!svc.environment) svc.environment = {};
                if (Array.isArray(svc.environment)) { for (const e of envOverrides) { if (e.key) svc.environment.push(`${e.key}=${e.value || ""}`); } }
                else { for (const e of envOverrides) { if (e.key) svc.environment[e.key] = e.value || ""; } }
              }
            }
            composeContent = yaml.dump(doc, { lineWidth: -1, noRefs: true });
          }
        }
        await writeFile(composeFile, composeContent);
      } catch (e: any) { send("log", { line: `[WARN] Could not patch compose: ${e.message}` }); }

      if (rebuild) {
        // Build JAR first (Maven/Gradle)
        const hasPom = existsSync(join(projectPath, "pom.xml"));
        const hasGradle = existsSync(join(projectPath, "build.gradle")) || existsSync(join(projectPath, "build.gradle.kts"));
        if (hasPom || hasGradle) {
          const buildTool = hasPom ? (process.platform === "win32" ? "mvn.cmd" : "mvn") : (process.platform === "win32" ? "gradle.bat" : "gradle");
          const buildArgs = hasPom ? "clean install -DskipTests=true -B" : "clean build -x test --console=plain";
          send("log", { line: `$ ${buildTool} ${buildArgs}` });
          const buildSuccess = await new Promise<boolean>((resolve) => {
            const mvnProc = spawn(buildTool, buildArgs.split(" "), { cwd: projectPath, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" }, shell: true });
            activeBuildProc = mvnProc;
            mvnProc.on("close", () => { activeBuildProc = null; });
            mvnProc.stdout?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
            mvnProc.stderr?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
            mvnProc.on("close", (code) => resolve(code === 0));
            mvnProc.on("error", () => resolve(false));
          });
          if (!buildSuccess) {
            send("log", { line: `[FAIL] Build failed` });
            send("error", { message: "Maven/Gradle build failed" });
            finish("build-failed");
            return;
          }
          send("log", { line: `[OK] JAR built successfully` });
        }
        send("log", { line: `Rebuilding image: ${imageTag}` });
        // Remove old image
        const rmCmd = process.platform === "win32"
          ? `wsl docker rmi ${imageTag} 2>/dev/null; true`
          : `docker rmi ${imageTag} 2>/dev/null; true`;
        try { execSync(rmCmd, { timeout: 15000 }); } catch {}
        // Build new image
        const dfPath = join(projectPath, dockerfile).replace(/\\/g, "/");
        const ctxPath = projectPath.replace(/\\/g, "/");
        const buildCmd = process.platform === "win32"
          ? `wsl docker build -t ${imageTag} -f "${dfPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" "${ctxPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" 2>&1`
          : `docker build -t ${imageTag} -f "${dfPath}" "${ctxPath}" 2>&1`;
        send("log", { line: `$ docker build -t ${imageTag} ...` });
        const imgBuildSuccess = await new Promise<boolean>((resolve) => {
          const shell = process.platform === "win32" ? "cmd" : "bash";
          const shellArgs = process.platform === "win32" ? ["/c", buildCmd] : ["-c", buildCmd];
          const imgProc = spawn(shell, shellArgs, { cwd: projectPath });
          activeBuildProc = imgProc;
          imgProc.stdout?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
          imgProc.stderr?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
          imgProc.on("close", (code) => { activeBuildProc = null; resolve(code === 0); });
          imgProc.on("error", () => { activeBuildProc = null; resolve(false); });
        });
        if (!imgBuildSuccess) {
          send("log", { line: `[FAIL] Image build failed` });
          send("error", { message: "Image build failed" });
          finish("image-build-failed");
          return;
        }
        send("log", { line: `[OK] Image built: ${imageTag}` });
      } else {
        // Check if image exists, build if not
        const checkCmd = process.platform === "win32" ? `wsl docker image inspect ${imageTag} > /dev/null 2>&1` : `docker image inspect ${imageTag} > /dev/null 2>&1`;
        try { execSync(checkCmd, { timeout: 5000 }); send("log", { line: `Using existing image: ${imageTag}` }); }
        catch {
          send("log", { line: `Image not found, building: ${imageTag}` });
          const dfPath = join(projectPath, dockerfile).replace(/\\/g, "/");
          const ctxPath = projectPath.replace(/\\/g, "/");
          const buildCmd = process.platform === "win32"
            ? `wsl docker build -t ${imageTag} -f "${dfPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" "${ctxPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" 2>&1`
            : `docker build -t ${imageTag} -f "${dfPath}" "${ctxPath}" 2>&1`;
          const fbBuildOk = await new Promise<boolean>((resolve) => {
            const shell = process.platform === "win32" ? "cmd" : "bash";
            const shellArgs = process.platform === "win32" ? ["/c", buildCmd] : ["-c", buildCmd];
            const imgProc = spawn(shell, shellArgs, { cwd: projectPath });
            activeBuildProc = imgProc;
            imgProc.stdout?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
            imgProc.stderr?.on("data", (chunk: Buffer) => { for (const line of stripAnsi(chunk.toString()).split("\n")) { if (line.trim()) send("log", { line: line.trimEnd() }); } });
            imgProc.on("close", (code) => { activeBuildProc = null; resolve(code === 0); });
            imgProc.on("error", () => { activeBuildProc = null; resolve(false); });
          });
          if (!fbBuildOk) { send("log", { line: `[FAIL] Image build failed` }); send("error", { message: "Image build failed" }); finish("image-build-failed"); return; }
          send("log", { line: `[OK] Image built: ${imageTag}` });
        }
      }
    }

    // Tear down previous run containers
    if (lastRunContext) {
      send("log", { line: "Stopping previous run..." });
      try {
        const killCmd = process.platform === "win32"
          ? `wsl bash -c "docker compose -f '${lastRunContext.composeFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}' kill 2>/dev/null; true"`
          : `docker compose -f "${lastRunContext.composeFile}" kill 2>/dev/null; true`;
        execSync(killCmd, { stdio: "ignore", timeout: 5000 });
      } catch {}
      try { await dockerDown(lastRunContext.projectPath, lastRunContext.composeFile); } catch {}
    }

    send("log", { line: `$ cd ${basename(projectPath)}` });
    send("log", { line: `$ docker compose -f "${basename(composeFile)}" up --build ...` });


    // Inject env overrides into effective compose (for cases without image rebuild)
    if (envOverrides?.length && !(imageTag && dockerfile)) {
      try {
        const compRaw = await readFile(composeFile, "utf-8");
        const doc = yaml.load(compRaw) as any;
        if (doc?.services) {
          for (const [, svc] of Object.entries(doc.services) as [string, any][]) {
            if (svc.build || svc.image?.includes("mouseketool-batch")) {
              if (!svc.environment) svc.environment = {};
              if (Array.isArray(svc.environment)) { for (const e of envOverrides) { if (e.key) svc.environment.push(`${e.key}=${e.value || ""}`); } }
              else { for (const e of envOverrides) { if (e.key) svc.environment[e.key] = e.value || ""; } }
            }
          }
          await writeFile(composeFile, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
        }
      } catch {}
    }

    // Remove existing containers to prevent name conflicts
    const containerNames = getContainerNames(composeFile);
    if (containerNames.length) await removeContainers(containerNames, send);

    await mkdir(RUNS_DIR, { recursive: true });

    // Retry spawn if path not immediately available (antivirus/filesystem race)
    const trySpawn = () => spawn(spawnCmd, spawnArgs, { env });
    let spawnAttempt = 0;
    const startSpawn = (): ChildProcess => {
      const proc = trySpawn();
      proc.on("error", (e) => {
        if (spawnAttempt < 2) { spawnAttempt++; send("log", { line: `[WARN] Retrying (${spawnAttempt}/2)...` }); setTimeout(() => { activeRun = startSpawn(); }, 1500); }
        else { send("error", { message: e.message }); finish("spawn-error"); }
      });
      return proc;
    };

    activeRun = startSpawn();
    console.log("[batch-run] spawn:", spawnCmd, spawnArgs[spawnArgs.length - 1].slice(0, 200));

    let logLines: string[] = [];
    let batchExited = false;
    const onData = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      console.log("[batch-run] chunk:", text.slice(0, 100));
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (trimmed) { send("log", { line: trimmed }); logLines.push(trimmed); }
        // Detect batch container exit
        if (appContainerNames.size && trimmed.match(/exited with code/i)) {
          const containerMatch = trimmed.match(/^(\S+).*exited with code (\d+)/i) || trimmed.match(/(\S+)\s+\|.*exited with code (\d+)/i);
          if (containerMatch) {
            const name = containerMatch[1].toLowerCase().replace(/-\d+$/, "");
            if ([...appContainerNames].some(n => name.includes(n) || n.includes(name))) {
              appContainerNames.delete([...appContainerNames].find(n => name.includes(n))!);
              if (appContainerNames.size === 0) {
                send("log", { line: "" });
                send("log", { line: "Batch container(s) finished. Tearing down..." });
                batchExited = true;
                setTimeout(async () => {
                  if (activeRun?.pid) {
                    try { if (process.platform === "win32") execSync(`taskkill /PID ${activeRun.pid} /T /F`, { stdio: "ignore" }); else process.kill(-activeRun.pid, "SIGKILL"); } catch { activeRun?.kill("SIGKILL"); }
                    activeRun = null;
                  }
                  if (lastRunContext) { try { await dockerDown(lastRunContext.projectPath, lastRunContext.composeFile); } catch {} }
                  send("complete", { runId: recordId, exitCode: parseInt(containerMatch![2]) || 0, duration: Date.now() - startTime });
                  finish("batch-exit");
                }, 1000);
              }
            }
          }
        }
      }
    };
    activeRun.stdout?.on("data", onData);
    activeRun.stderr?.on("data", onData);

    activeRun.on("close", async (code) => {
        runningState.simpleProjectId = null;
      activeRun = null;
      if (batchExited) return; // Already handled by batch-exit detection
      const duration = Date.now() - startTime;
      const exitCode = code ?? 0;

      try {
        await mkdir(RUNS_DIR, { recursive: true });
        await writeFile(join(RUNS_DIR, `${recordId}.log`), logLines.join("\n"));
      } catch {}

      const run: BatchRun = {
        id: recordId, projectId: projectId || "", projectName,
        status: exitCode === 0 ? "success" : "error",
        startedAt: new Date(startTime).toISOString(),
        finishedAt: new Date().toISOString(),
        duration, exitCode,
      };

      try {
        const runs = await loadRuns();
        runs.unshift(run);
        if (runs.length > 100) runs.length = 100;
        await saveRuns(runs);
      } catch {}

      send(exitCode === 0 ? "complete" : "error", { runId: recordId, exitCode, duration });

      // Auto-cleanup containers
      if (lastRunContext) {
        send("log", { line: "" });
        send("log", { line: "Cleaning up containers..." });
        await dockerDown(lastRunContext.projectPath, lastRunContext.composeFile);
        send("log", { line: "Cleanup complete." });
      }

      finish("process-close");
    });
    } catch (e: any) { console.error("batch-run error:", e); send("error", { message: e.message || "Failed to start" }); finish("catch"); }

  // Keep the handler alive until the process finishes
  const done = new Promise<void>((resolve) => {
    if (activeRun) activeRun.on("close", () => resolve());
    else resolve();
  });

  req.on("close", () => {
    if (activeRun) {
      try {
        if (process.platform === "win32") execSync(`taskkill /PID ${activeRun.pid} /T /F`, { stdio: "ignore" });
        else process.kill(-activeRun.pid!, "SIGKILL");
      } catch { activeRun?.kill("SIGKILL"); }
      activeRun = null;
    }
    finish("req-close");
  });

  await done;
});


async function forceRemoveContainers(composeFile: string) {
  try {
    const doc = yaml.load(await readFile(composeFile, "utf-8")) as any;
    if (!doc?.services) return;
    const names = Object.entries(doc.services).map(([name, svc]: [string, any]) => svc.container_name || name).filter(Boolean);
    if (names.length) {
      const cmd = process.platform === "win32" ? `wsl docker rm -f ${names.join(" ")} 2>/dev/null; true` : `docker rm -f ${names.join(" ")} 2>/dev/null; true`;
      try { execSync(cmd, { stdio: "ignore", timeout: 15000 }); } catch {}
    }
  } catch {}
}
router.post("/simple/stop", async (_req, res) => {
  const stoppedId = runningState.simpleProjectId;
  runningState.simpleProjectId = null;
  if (activeBuildProc?.pid) {
    try { if (process.platform === "win32") execSync(`taskkill /PID ${activeBuildProc.pid} /T /F`, { stdio: "ignore" }); else activeBuildProc.kill("SIGKILL"); } catch {}
    activeBuildProc = null;
  }
  if (activeRun?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${activeRun.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-activeRun.pid, "SIGKILL");
    } catch { activeRun?.kill("SIGKILL"); }
    activeRun = null;
  }
  if (lastRunContext) {
    try {
      const killCmd = process.platform === "win32"
        ? `wsl bash -c "docker compose -f '${lastRunContext.composeFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}' kill 2>/dev/null; true"`
        : `docker compose -f "${lastRunContext.composeFile}" kill 2>/dev/null; true`;
      execSync(killCmd, { stdio: "ignore", timeout: 10000 });
    } catch {}
    try {
      const downCmd = process.platform === "win32"
        ? `wsl bash -c "docker compose -f '${lastRunContext.composeFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}' down --volumes --remove-orphans 2>/dev/null; true"`
        : `docker compose -f "${lastRunContext.composeFile}" down --volumes --remove-orphans 2>/dev/null; true`;
      execSync(downCmd, { stdio: "ignore", timeout: 15000 });
    } catch {}
    await forceRemoveContainers(lastRunContext.composeFile);
  }
  if (stoppedId) { const activeId = getActiveRunId("simple:" + stoppedId); if (activeId) finishRun(activeId); }
  res.json({ stopped: true });
});

router.post("/simple/teardown", async (_req, res) => {
  if (activeRun?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${activeRun.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-activeRun.pid, "SIGKILL");
    } catch { activeRun?.kill("SIGKILL"); }
    activeRun = null;
  }
  if (lastRunContext) {
    await dockerDown(lastRunContext.projectPath, lastRunContext.composeFile);
    res.json({ tornDown: true, projectPath: lastRunContext.projectPath });
  } else {
    res.json({ tornDown: false, error: "No previous run context" });
  }
});

router.get("/effective-config", async (req, res) => {
  const projectPath = req.query.projectPath as string;
  const composefile = req.query.composefile as string;
  if (!projectPath || !composefile) return res.status(400).json({ error: "projectPath and composefile required" });
  const filePath = join(SETTINGS_DIR, "batch-compose", composefile.replace(/[/\\]/g, "_"));
  try { res.json({ content: await readFile(filePath, "utf-8") }); }
  catch { res.status(404).json({ error: "No generated config found" }); }
});

router.get("/", async (_req, res) => { res.json(await loadRuns()); });

router.get("/:id/logs", async (req, res) => {
  try {
    const log = await readFile(join(RUNS_DIR, `${req.params.id}.log`), "utf-8");
    res.json({ log });
  } catch { res.status(404).json({ error: "Log not found" }); }
});

router.delete("/", async (_req, res) => {
  await saveRuns([]);
  res.json({ cleared: true });
});


router.post("/workflow", async (req, res) => {
  const { workflowId, composePath, envOverrides, originalProjectPath, rebuild = true } = req.body;
  if (!composePath) { res.status(400).json({ error: "composePath required" }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);
  let ended = false;
  const send = (event: string, data: any) => { if (!ended) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (typeof (res as any).flush === "function") (res as any).flush(); } if (event === "log") pushLog(runId, data); else pushEvent(runId, event, data); };
  const finish = (reason?: string) => { if (!ended) { ended = true; res.end(); } finishRun(runId); };
  const runId = randomUUID();
  const wfEntityId = "workflow:" + workflowId;
  workflowAborted = false;
  setActiveRunId(wfEntityId, runId);
  initRunLogs(runId);
  send("run-id", { runId });
  send("log", { line: "Mouseketool starting workflow run..." });

  // Load workflow to identify batch node containers
  let batchNodeNames = new Set<string>();
  try {
    const wfData = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-workflows.json"), "utf-8"));
    const wf = wfData.find((w: any) => w.id === workflowId);
    if (wf?.nodes) batchNodeNames = new Set(wf.nodes.map((n: any) => n.name));
    console.log("[batch-run/workflow] batchNodeNames:", [...batchNodeNames]);
    if (!originalProjectPath && wf?.originalComposePath) { (req.body as any).originalProjectPath = wf.originalComposePath.replace(/\\/g, "/").replace(/\/[^\/]+$/, ""); }
    if (!(req.body as any).originalProjectPath) {
      try {
        const bps = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-projects.json"), "utf-8"));
        const match = bps.find((p: any) => wf?.nodes?.some((n: any) => n.projectId === p.id));
        if (match?.path) (req.body as any).originalProjectPath = match.path.replace(/\\/g, "/");
      } catch {}
    }
  } catch {}

  // Fix CRLF in .sh files
  const composeDir = dirname(composePath);
  try {
    const scanDir = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory() && !f.name.startsWith(".") && f.name !== "node_modules" && f.name !== "target") scanDir(join(dir, f.name));
        else if (f.name.endsWith(".sh") || f.name.endsWith(".sql")) {
          const fp = join(dir, f.name);
          const c = readFileSync(fp, "utf-8");
          if (c.includes("\r\n")) writeFileSync(fp, c.replace(/\r\n/g, "\n"));
        }
      }
    };
    if (existsSync(composeDir)) scanDir(composeDir);
  } catch {}

  try {
    let remaps: any[] = [];
    let effectiveCompose = composePath;
    try {
      const result = await buildEffectiveComposeAbsolute(composePath, originalProjectPath);
      remaps = result.remaps;
      if (result.effectivePath) effectiveCompose = result.effectivePath;
    } catch (e: any) {
      send("log", { line: `[WARN] Port scan skipped: ${e.message}` });
    }

    if (remaps.length) {
      send("log", { line: "[WARN] Port conflicts detected - remapping:" });
      for (const r of remaps) send("log", { line: `  ${r.service}: ${r.hostPort} -> ${r.newHostPort} (container: ${r.containerPort})` });
      send("log", { line: "" });
    }
    send("remaps", remaps);

    // Resolve relative paths in compose file to original project directory
    if (originalProjectPath) {
      const compRaw = await readFile(effectiveCompose, "utf-8");
      const compDoc = yaml.load(compRaw) as any;
      if (compDoc?.services) {
        const toAbs = (rel: string) => {
          const abs = join(originalProjectPath, rel).replace(/\\/g, "/");
          if (process.platform === "win32") return abs.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`);
          return abs;
        };
        for (const [, svc] of Object.entries(compDoc.services) as [string, any][]) {
          if (svc.build) {
            if (typeof svc.build === "string" && svc.build.startsWith(".")) svc.build = toAbs(svc.build);
            else if (svc.build?.context?.startsWith(".")) svc.build.context = toAbs(svc.build.context);
          }
          // Volumes stay relative - files are copied to the workflow folder
          // env_file stays relative - copied to workflow folder
        }
        await writeFile(effectiveCompose, inlineHealthcheckTests(yaml.dump(compDoc, { lineWidth: -1, noRefs: true })));
      }
    }

    lastWorkflowRunContext = { composePath: effectiveCompose };
    runningState.workflowId = workflowId;
    const env = { ...process.env };
    if (envOverrides) { for (const e of envOverrides) { if (e.key) env[e.key] = e.value || ""; } }

    // Docker down before run
    const wfEffective = join(SETTINGS_DIR, "batch-workflows", workflowId || "", "effective-docker-compose.yml");
    if (existsSync(wfEffective)) {
      send("log", { line: "Cleaning up previous run..." });
      // Kill first for speed, then down for cleanup
      try {
        const killCmd = process.platform === "win32"
          ? `wsl bash -c "docker compose -f '${wfEffective.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}' kill 2>/dev/null; true"`
          : `docker compose -f "${wfEffective}" kill 2>/dev/null; true`;
        execSync(killCmd, { stdio: "ignore", timeout: 5000 });
      } catch {}
      await dockerDown(dirname(wfEffective), wfEffective);
    }

    // Start containers in detached mode and stream logs simultaneously

    // Rebuild images for batch nodes in the workflow
    if (batchNodeNames.size) {
      try {
        const projects = JSON.parse(await readFile(join(SETTINGS_DIR, "batch-projects.json"), "utf-8"));
        for (const proj of projects.filter((p: any) => p.services?.some((s: any) => batchNodeNames.has(s.name)) || batchNodeNames.has(p.name))) {
          console.log("[batch-run/workflow] matched project:", proj.name, "rebuild:", rebuild, "imageTag:", proj.imageTag, "dockerfile:", proj.dockerfile, "projectPath:", proj.projectPath);
          if (!proj.imageTag || !proj.dockerfile) continue;
          // Patch effective compose: replace build: with image:
          let compContent = await readFile(effectiveCompose, "utf-8");
          if (compContent.includes("build:")) {
            compContent = compContent.replace(/^(\s*)build:.*$/gm, `$1image: ${proj.imageTag}`);
            compContent = compContent.replace(/^\s*context:.*$\n?/gm, "");
            compContent = compContent.replace(/^\s*dockerfile:.*$\n?/gm, "");
            await writeFile(effectiveCompose, compContent);
          }
          if (rebuild) {
            send("log", { line: `Rebuilding image: ${proj.imageTag}` });
            // Build JAR first (Maven/Gradle) for workflow
            const hasPom = existsSync(join(proj.projectPath, "pom.xml"));
            const hasGradle = existsSync(join(proj.projectPath, "build.gradle")) || existsSync(join(proj.projectPath, "build.gradle.kts"));
            if (hasPom || hasGradle) {
              const bt = hasPom ? (process.platform === "win32" ? "mvn.cmd" : "mvn") : (process.platform === "win32" ? "gradle.bat" : "gradle");
              const ba = hasPom ? "clean install -DskipTests=true -B" : "clean build -x test --console=plain";
              send("log", { line: `$ ${bt} ${ba}` });
              const ok = await new Promise<boolean>((resolve) => {
                const p = spawn(bt, ba.split(" "), { cwd: proj.projectPath, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" }, shell: true });
                activeBuildProc = p;
                p.on("close", () => { activeBuildProc = null; });
                p.stdout?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
                p.stderr?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
                p.on("close", (code) => resolve(code === 0));
                p.on("error", () => resolve(false));
              });
              if (!ok) { send("log", { line: "[FAIL] JAR build failed, skipping image rebuild" }); if (workflowAborted) break; continue; }
              send("log", { line: "[OK] JAR built" });
            }
            const rmCmd = process.platform === "win32" ? `wsl bash -c "docker rm -f \$(docker ps -aq --filter ancestor=${proj.imageTag}) 2>/dev/null; docker rmi -f ${proj.imageTag} 2>/dev/null; true"` : `bash -c 'docker rm -f $(docker ps -aq --filter ancestor=${proj.imageTag}) 2>/dev/null; docker rmi -f ${proj.imageTag} 2>/dev/null; true'`;
            try { execSync(rmCmd, { timeout: 15000 }); } catch {}
            const dfPath = join(proj.projectPath, proj.dockerfile).replace(/\\/g, "/");
            const ctxPath = proj.projectPath.replace(/\\/g, "/");
            const buildCmd = process.platform === "win32"
              ? `wsl docker build -t ${proj.imageTag} -f "${dfPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" "${ctxPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" 2>&1`
              : `docker build -t ${proj.imageTag} -f "${dfPath}" "${ctxPath}" 2>&1`;
            send("log", { line: `$ docker build -t ${proj.imageTag} ...` });
            const wfBuildOk = await new Promise<boolean>((resolve) => {
              const shell = process.platform === "win32" ? "cmd" : "bash";
              const shellArgs = process.platform === "win32" ? ["/c", buildCmd] : ["-c", buildCmd];
              const imgProc = spawn(shell, shellArgs, { cwd: proj.projectPath });
              activeBuildProc = imgProc;
              imgProc.stdout?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
              imgProc.stderr?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
              imgProc.on("close", (code) => { activeBuildProc = null; resolve(code === 0); });
              imgProc.on("error", () => { activeBuildProc = null; resolve(false); });
            });
            if (!wfBuildOk) { send("log", { line: `[FAIL] Image build failed for ${proj.name}` }); }
            else { send("log", { line: `[OK] Image built: ${proj.imageTag}` }); }
          } else {
            const checkCmd = process.platform === "win32" ? `wsl docker image inspect ${proj.imageTag} > /dev/null 2>&1` : `docker image inspect ${proj.imageTag} > /dev/null 2>&1`;
            try { execSync(checkCmd, { timeout: 5000 }); }
            catch {
              send("log", { line: `Image not found, building: ${proj.imageTag}` });
              const dfPath = join(proj.projectPath, proj.dockerfile).replace(/\\/g, "/");
              const ctxPath = proj.projectPath.replace(/\\/g, "/");
              const buildCmd = process.platform === "win32"
                ? `wsl docker build -t ${proj.imageTag} -f "${dfPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" "${ctxPath.replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}" 2>&1`
                : `docker build -t ${proj.imageTag} -f "${dfPath}" "${ctxPath}" 2>&1`;
              const fbOk = await new Promise<boolean>((resolve) => {
                const shell = process.platform === "win32" ? "cmd" : "bash";
                const shellArgs = process.platform === "win32" ? ["/c", buildCmd] : ["-c", buildCmd];
                const imgProc = spawn(shell, shellArgs, { cwd: proj.projectPath });
                activeBuildProc = imgProc;
                imgProc.stdout?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
                imgProc.stderr?.on("data", (chunk: Buffer) => { for (const l of stripAnsi(chunk.toString()).split("\n")) { if (l.trim()) send("log", { line: l.trimEnd() }); } });
                imgProc.on("close", (code) => { activeBuildProc = null; resolve(code === 0); });
                imgProc.on("error", () => { activeBuildProc = null; resolve(false); });
              });
              if (!fbOk) { send("log", { line: `[FAIL] Image build failed for ${proj.name}` }); }
              else { send("log", { line: `[OK] Image built: ${proj.imageTag}` }); }
            }
          }
        }
      } catch {}
    }

    if (workflowAborted) { finish("aborted"); return; }
    send("build-complete", {});
    send("log", { line: `$ docker compose up --build ...` });
    const wslCompose = process.platform === "win32" ? effectiveCompose.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`) : effectiveCompose;
    let spawnCmd: string;
    let spawnArgs: string[];
    if (process.platform === "win32") {
      spawnCmd = "wsl";
      spawnArgs = ["bash", "-c", `docker compose -f '${wslCompose}' up --build --force-recreate 2>&1`];
    } else {
      spawnCmd = "bash";
      spawnArgs = ["-c", `docker compose -f "${effectiveCompose}" up --build --force-recreate 2>&1`];
    }
    activeWorkflowRun = spawn(spawnCmd, spawnArgs, { env });
    // Force-remove any leftover containers from previous runs
    try {
      const compDoc = yaml.load(await readFile(effectiveCompose, "utf-8")) as any;
      if (compDoc?.services) {
        const names = Object.entries(compDoc.services).map(([, svc]: [string, any]) => svc.container_name).filter(Boolean);
        if (names.length) {
          const rmCmd = process.platform === "win32" ? `wsl docker rm -f ${names.join(" ")} 2>/dev/null; true` : `docker rm -f ${names.join(" ")} 2>/dev/null; true`;
          try { execSync(rmCmd, { stdio: "ignore", timeout: 15000 }); } catch {}
        }
      }
    } catch {}
    let observerReady = false;

    const onData = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        // Parse container prefix: "container-name  | log text"
        const m = trimmed.match(/^(\S+)\s+\|\s+(.*)/);
        if (m) {
          const container = m[1];
          const logText = m[2];
          send("log", { line: trimmed, container });
          if (!observerReady) observerReady = true;
          // Status tracking handled by per-node observers
          // Check if all batch nodes have exited - auto-stop if so

        } else {
          // Status tracking handled by per-node observers
          send("log", { line: trimmed });
        }
      }
    };
    activeWorkflowRun.stdout?.on("data", onData);
    activeWorkflowRun.stderr?.on("data", onData);

    activeWorkflowRun.on("error", (e) => { send("error", { message: e.message }); finish("spawn-error"); });

    // Single observer for all batch nodes - one docker inspect call per tick
    activeObserverIntervals.forEach(iv => clearInterval(iv));
    activeObserverIntervals = [];
    const hasBeenRunning = new Set<string>();
    const terminalNodes = new Set<string>();
    const lastSentStatus = new Map<string, string>();

    function clearAllObservers() {
      for (const iv of activeObserverIntervals) clearInterval(iv);
      activeObserverIntervals.length = 0;
    }

    async function onAllObserversDone() {
      runningState.workflowId = null;
      clearAllObservers();
      send("log", { line: "" });
      send("log", { line: "-- All batch containers finished --" });
      send("complete", { workflowId, exitCode: 0 });
      if (activeWorkflowRun?.pid) {
        try { if (process.platform === "win32") execSync(`taskkill /PID ${activeWorkflowRun.pid} /T /F`, { stdio: "ignore" }); else process.kill(-activeWorkflowRun.pid, "SIGKILL"); } catch { activeWorkflowRun?.kill("SIGKILL"); }
        activeWorkflowRun = null;
      }
      if (lastWorkflowRunContext) {
        send("log", { line: "Cleaning up containers..." });
        await dockerDown(dirname(lastWorkflowRunContext.composePath), lastWorkflowRunContext.composePath);
        send("log", { line: "Cleanup complete." });
      }
      finish("all-batches-done");
    }

    const batchNames = [...batchNodeNames];
    // Build containerName -> nodeName map from compose
    const containerToNode = new Map<string, string>();
    try {
      const compDoc = yaml.load(readFileSync(effectiveCompose, "utf-8")) as any;
      if (compDoc?.services) {
        for (const [svc, def] of Object.entries(compDoc.services) as [string, any][]) {
          const cn = def.container_name || svc;
          const node = batchNames.find(n => cn === n || cn.includes(n) || svc === n);
          if (node) containerToNode.set(cn, node);
        }
      }
    } catch {}
    const containerNames = [...containerToNode.keys()];
    const observerIv = setInterval(() => {
      if (!observerReady) return;
      try {
        const names = containerNames.filter(cn => !terminalNodes.has(containerToNode.get(cn)!));
        if (!names.length) return;
        const inspectCmd = process.platform === "win32"
          ? `wsl bash -c "docker inspect --format '{{.Name}} {{.State.Status}} {{.State.ExitCode}}' ${names.join(' ')} 2>/dev/null || true"`
          : `bash -c 'docker inspect --format "{{.Name}} {{.State.Status}} {{.State.ExitCode}}" ${names.join(" ")} 2>/dev/null || true'`;
        const out = execSync(inspectCmd, { encoding: "utf-8", timeout: 5000 }).trim();
        for (const line of out.split("\n")) {
          const parts = line.trim().split(" ");
          if (parts.length < 3) continue;
          const cname = parts[0].replace(/^\//, ""); // docker inspect prefixes with /
          const status = parts[1];
          const exitCode = parseInt(parts[2] || "0", 10);
          // Map container name to node name
          const nodeName = containerToNode.get(cname) || batchNames.find(n => cname === n || cname.endsWith(n) || cname.includes(n));
          if (!nodeName || terminalNodes.has(nodeName)) continue;

          if (status === "running") {
            hasBeenRunning.add(nodeName);
            if (lastSentStatus.get(nodeName) !== "running") {
              send("status", { container: nodeName, status: "running" });
              lastSentStatus.set(nodeName, "running");
            }
          } else if (status === "exited") {
            const s = exitCode === 0 ? "success" : "error";
            if (!lastSentStatus.has(nodeName)) {
              send("status", { container: nodeName, status: "running" });
              setTimeout(() => {
                send("status", { container: nodeName, status: s });
                lastSentStatus.set(nodeName, s);
                terminalNodes.add(nodeName);
                if (terminalNodes.size >= batchNames.length) onAllObserversDone();
              }, 600);
            } else {
              send("status", { container: nodeName, status: s });
              lastSentStatus.set(nodeName, s);
              terminalNodes.add(nodeName);
              if (terminalNodes.size >= batchNames.length) onAllObserversDone();
            }
          }
        }
      } catch { /* ignore transient failures */ }
    }, 500);
    activeObserverIntervals.push(observerIv);

    const done = new Promise<void>((resolve) => {
      activeWorkflowRun!.on("close", async (code) => {
        runningState.workflowId = null;
        clearAllObservers();
        activeWorkflowRun = null;

        if (lastWorkflowRunContext) {
          send("log", { line: "" });
          send("log", { line: "Cleaning up containers..." });
          await dockerDown(dirname(lastWorkflowRunContext.composePath), lastWorkflowRunContext.composePath);
          send("log", { line: "Cleanup complete." });
        }
        finish("process-close");
        resolve();
      });
    });

    req.on("close", () => {
      clearAllObservers();
      if (activeWorkflowRun) {
        try {
          if (process.platform === "win32") execSync(`taskkill /PID ${activeWorkflowRun.pid} /T /F`, { stdio: "ignore" });
          else process.kill(-activeWorkflowRun.pid!, "SIGKILL");
        } catch { activeWorkflowRun?.kill("SIGKILL"); }
        activeWorkflowRun = null;
      }
      if (lastWorkflowRunContext) {
        dockerDown(dirname(lastWorkflowRunContext.composePath), lastWorkflowRunContext.composePath);
      }
      finish("req-close");
    });

    await done;
  } catch (e: any) { send("error", { message: e.message || "Failed to start workflow" }); finish("catch"); }
});

router.post("/workflow/stop", async (_req, res) => {
  workflowAborted = true;
  const stoppedWfId = runningState.workflowId;
  runningState.workflowId = null;
  // Send cancelled status for all non-terminal nodes
  if (stoppedWfId) {
    const stoppedRunId = getActiveRunId("workflow:" + stoppedWfId);
    const logs = stoppedRunId ? getRunLogs(stoppedRunId) : undefined;
    if (logs) {
      // Load workflow nodes to get all node names
      try {
        const wfData = JSON.parse(readFileSync(join(SETTINGS_DIR, "batch-workflows.json"), "utf-8"));
        const wf = wfData.find((w: any) => w.id === stoppedWfId);
        if (wf?.nodes) {
          const terminalStatuses = new Set(["success", "error"]);
          for (const node of wf.nodes) {
            const currentStatus = logs.statuses[node.name];
            if (!currentStatus || !terminalStatuses.has(currentStatus)) {
              pushEvent(stoppedRunId!, "status", { container: node.name, status: "cancelled" });
            }
          }
        }
      } catch {}
    }
  }
  if (activeBuildProc?.pid) {
    try { if (process.platform === "win32") execSync(`taskkill /PID ${activeBuildProc.pid} /T /F`, { stdio: "ignore" }); else activeBuildProc.kill("SIGKILL"); } catch {}
    activeBuildProc = null;
  }
  activeObserverIntervals.forEach(iv => clearInterval(iv));
  activeObserverIntervals = [];
  if (activeWorkflowRun?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${activeWorkflowRun.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-activeWorkflowRun.pid, "SIGKILL");
    } catch { activeWorkflowRun?.kill("SIGKILL"); }
    activeWorkflowRun = null;
  }
  if (lastWorkflowRunContext) {
    const dir = dirname(lastWorkflowRunContext.composePath);
    try {
      const killCmd = process.platform === "win32"
        ? `wsl bash -c "docker compose -f '${lastWorkflowRunContext.composePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)}' kill 2>/dev/null; true"`
        : `docker compose -f "${lastWorkflowRunContext.composePath}" kill 2>/dev/null; true`;
      execSync(killCmd, { stdio: "ignore", timeout: 10000 });
    } catch {}
    await dockerDown(dir, lastWorkflowRunContext.composePath);
    await forceRemoveContainers(lastWorkflowRunContext.composePath);
  }
  if (stoppedWfId) { const activeId = getActiveRunId("workflow:" + stoppedWfId); if (activeId) finishRun(activeId); }
  res.json({ stopped: true });
});


// Log store endpoints
router.get("/simple/logs/:id", (req, res) => {
  const activeId = getActiveRunId("simple:" + req.params.id);
  const logs = activeId ? getRunLogs(activeId) : undefined;
  if (!logs) return res.json({ found: false });
  res.json({ found: true, ...logs });
});

router.get("/simple/logs/:id/stream", (req, res) => {
  const activeId = getActiveRunId("simple:" + req.params.id);
  if (!activeId) return res.status(404).json({ error: "No active run" });
  const logs = getRunLogs(activeId);
  if (!logs || !logs.running) return res.status(404).json({ error: "No active run" });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  subscribe(activeId, res);
});

router.delete("/simple/logs/:id", (_req, res) => {
  const activeId = getActiveRunId("simple:" + _req.params.id);
  if (activeId) deleteRunLogs(activeId);
  res.json({ deleted: true });
});

router.get("/workflow/logs/:id", (req, res) => {
  const activeId = getActiveRunId("workflow:" + req.params.id);
  const logs = activeId ? getRunLogs(activeId) : undefined;
  if (!logs) return res.json({ found: false });
  res.json({ found: true, ...logs });
});

router.get("/workflow/logs/:id/stream", (req, res) => {
  const activeId = getActiveRunId("workflow:" + req.params.id);
  if (!activeId) return res.status(404).json({ error: "No active run" });
  const logs = getRunLogs(activeId);
  if (!logs || !logs.running) return res.status(404).json({ error: "No active run" });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  subscribe(activeId, res);
});

router.delete("/workflow/logs/:id", (_req, res) => {
  const activeId = getActiveRunId("workflow:" + _req.params.id);
  if (activeId) deleteRunLogs(activeId);
  res.json({ deleted: true });
});

export default router;
