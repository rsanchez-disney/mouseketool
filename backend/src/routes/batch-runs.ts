import { Router } from "express";
import { exec, execSync, spawn, ChildProcess } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
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

  const dir = join(process.cwd(), ".data", "batch-compose");
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

  const effectivePath = join(dir, composefile.replace(/[/\\]/g, "_"));
  await writeFile(effectivePath, raw);
  return { remaps, effectivePath };
}

async function buildEffectiveComposeAbsolute(composePath: string): Promise<{ remaps: PortRemap[]; effectivePath: string }> {
  if (!existsSync(composePath)) return { remaps: [], effectivePath: "" };

  let raw = await readFile(composePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return { remaps: [], effectivePath: "" };

  const projectPath = composePath.replace(/\\/g, "/").replace(/\/[^\/]+$/, "");
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
  const effectivePath = join(dir, "effective-" + basename(composePath));
  await writeFile(effectivePath, raw);
  return { remaps, effectivePath };
}

const RUNS_FILE = join(process.cwd(), ".data", "batch-runs.json");
const RUNS_DIR = join(process.cwd(), ".data", "batch-runs");
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
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
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
let lastRunContext: { projectPath: string; composeFile: string } | null = null;
let activeWorkflowRun: ChildProcess | null = null;
let lastWorkflowRunContext: { composePath: string } | null = null;
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
  const { projectId, projectPath, composefile, envOverrides } = req.body;
  if (!projectPath) { res.status(400).json({ error: "projectPath required" }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);
  let ended = false;
  const send = (event: string, data: any) => { if (!ended) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (typeof (res as any).flush === "function") (res as any).flush(); } };
  const finish = (reason?: string) => { if (!ended) { console.log("[batch-run] finish called:", reason || "unknown"); ended = true; res.end(); } };
  send("log", { line: "Mouseketool starting run..." });

  // Fix CRLF → LF in .sh files so Docker doesn't complain
  const fixedFiles: string[] = [];
  try {
    const scanDir = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory() && !f.name.startsWith(".") && f.name !== "node_modules" && f.name !== "target") scanDir(join(dir, f.name));
        else if (f.name.endsWith(".sh")) {
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
    send("log", { line: `⚠ Fixed CRLF → LF in ${fixedFiles.length} shell script(s):` });
    for (const f of fixedFiles) send("log", { line: `  ${f}` });
    send("log", { line: "" });
  }

  const runId = uuid();
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
    try {
      console.log("[batch-run] starting port analysis");
      const result = await buildEffectiveCompose(projectPath, cf);
      console.log("[batch-run] port analysis done, remaps:", result.remaps.length);
      remaps = result.remaps;
      if (result.effectivePath) effectiveCompose = result.effectivePath;
    } catch (e: any) {
      console.error("[batch-run] port analysis error:", e);
      send("log", { line: `⚠ Port scan skipped: ${e.message}` });
    }
    console.log("[batch-run] proceeding with compose:", effectiveCompose);

    if (remaps.length) {
      send("log", { line: "⚠ Port conflicts detected — remapping:" });
      for (const r of remaps) send("log", { line: `  ${r.service}: ${r.hostPort} → ${r.newHostPort} (container: ${r.containerPort})` });
      send("log", { line: "" });
    }

    send("remaps", remaps);

    const composeFile = effectiveCompose || cf;
    lastRunContext = { projectPath, composeFile };
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
    send("log", { line: `$ cd ${basename(projectPath)}` });
    send("log", { line: `$ docker compose -f "${basename(composeFile)}" up --build ...` });

    // Remove existing containers to prevent name conflicts
    const containerNames = getContainerNames(composeFile);
    if (containerNames.length) await removeContainers(containerNames, send);

    await mkdir(RUNS_DIR, { recursive: true });

    activeRun = spawn(spawnCmd, spawnArgs, { env });
    console.log("[batch-run] spawn:", spawnCmd, spawnArgs[spawnArgs.length - 1].slice(0, 200));
    activeRun.on("error", (e) => { console.error("[batch-run] spawn error:", e); send("error", { message: e.message }); finish("spawn-error"); });

    let logLines: string[] = [];
    const onData = (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString());
      console.log("[batch-run] chunk:", text.slice(0, 100));
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (trimmed) { send("log", { line: trimmed }); logLines.push(trimmed); }
      }
    };
    activeRun.stdout?.on("data", onData);
    activeRun.stderr?.on("data", onData);

    activeRun.on("close", async (code) => {
      activeRun = null;
      const duration = Date.now() - startTime;
      const exitCode = code ?? 0;

      try {
        await mkdir(RUNS_DIR, { recursive: true });
        await writeFile(join(RUNS_DIR, `${runId}.log`), logLines.join("\n"));
      } catch {}

      const run: BatchRun = {
        id: runId, projectId: projectId || "", projectName,
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

      send(exitCode === 0 ? "complete" : "error", { runId, exitCode, duration });

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

router.post("/simple/stop", async (_req, res) => {
  if (activeRun?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${activeRun.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-activeRun.pid, "SIGKILL");
    } catch { activeRun?.kill("SIGKILL"); }
    activeRun = null;
  }
  if (lastRunContext) await dockerDown(lastRunContext.projectPath, lastRunContext.composeFile);
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
  const filePath = join(process.cwd(), ".data", "batch-compose", composefile.replace(/[/\\]/g, "_"));
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
  const { workflowId, composePath, envOverrides, originalProjectPath } = req.body;
  if (!composePath) { res.status(400).json({ error: "composePath required" }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);
  let ended = false;
  const send = (event: string, data: any) => { if (!ended) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (typeof (res as any).flush === "function") (res as any).flush(); } };
  const finish = (reason?: string) => { if (!ended) { ended = true; res.end(); } };
  send("log", { line: "Mouseketool starting workflow run..." });

  // Load workflow to identify batch node containers
  let batchNodeNames = new Set<string>();
  try {
    const wfData = JSON.parse(await readFile(join(process.cwd(), ".data", "batch-workflows.json"), "utf-8"));
    const wf = wfData.find((w: any) => w.id === workflowId);
    if (wf?.nodes) batchNodeNames = new Set(wf.nodes.map((n: any) => n.name));
  } catch {}

  // Fix CRLF in .sh files
  const composeDir = dirname(composePath);
  try {
    const scanDir = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory() && !f.name.startsWith(".") && f.name !== "node_modules" && f.name !== "target") scanDir(join(dir, f.name));
        else if (f.name.endsWith(".sh")) {
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
      const result = await buildEffectiveComposeAbsolute(composePath);
      remaps = result.remaps;
      if (result.effectivePath) effectiveCompose = result.effectivePath;
    } catch (e: any) {
      send("log", { line: `⚠ Port scan skipped: ${e.message}` });
    }

    if (remaps.length) {
      send("log", { line: "⚠ Port conflicts detected — remapping:" });
      for (const r of remaps) send("log", { line: `  ${r.service}: ${r.hostPort} → ${r.newHostPort} (container: ${r.containerPort})` });
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
          // Volumes stay relative — files are copied to the workflow folder
          // env_file stays relative — copied to workflow folder
        }
        await writeFile(effectiveCompose, inlineHealthcheckTests(yaml.dump(compDoc, { lineWidth: -1, noRefs: true })));
      }
    }

    lastWorkflowRunContext = { composePath: effectiveCompose };
    const env = { ...process.env };
    if (envOverrides) { for (const e of envOverrides) { if (e.key) env[e.key] = e.value || ""; } }

    // Docker down before run
    const wfEffective = join(process.cwd(), ".data", "batch-workflows", workflowId || "", "effective-docker-compose.yml");
    if (existsSync(wfEffective)) {
      send("log", { line: "Cleaning up previous run..." });
      await dockerDown(dirname(wfEffective), wfEffective);
    }

    // Start containers in detached mode and stream logs simultaneously
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
          // Check if all batch nodes have exited — auto-stop if so

        } else {
          // Status tracking handled by per-node observers
          send("log", { line: trimmed });
        }
      }
    };
    activeWorkflowRun.stdout?.on("data", onData);
    activeWorkflowRun.stderr?.on("data", onData);

    activeWorkflowRun.on("error", (e) => { send("error", { message: e.message }); finish("spawn-error"); });

    // Single observer for all batch nodes — one docker inspect call per tick
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
      clearAllObservers();
      send("log", { line: "" });
      send("log", { line: "── All batch containers finished ──" });
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
    // Build containerName → nodeName map from compose
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
    }, 2000);
    activeObserverIntervals.push(observerIv);

    const done = new Promise<void>((resolve) => {
      activeWorkflowRun!.on("close", async (code) => {
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
    await dockerDown(dir, lastWorkflowRunContext.composePath);
  }
  res.json({ stopped: true });
});

export default router;
