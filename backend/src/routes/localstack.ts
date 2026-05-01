import { Router } from "express";
import { exec, execSync } from "child_process";
import { mkdir } from "fs/promises";
import { join } from "path";
import { SETTINGS_DIR } from "../config/constants.js";

const router = Router();
const CONTAINER_NAME = "mouseketool-localstack";
const IMAGE = "localstack/localstack:community-archive";
const DATA_DIR = join(SETTINGS_DIR, "localstack-data");
const NETWORK_NAME = "mouseketool-network";

function run(cmd: string): Promise<string> {
  const fullCmd = process.platform === "win32" ? `wsl ${cmd}` : cmd;
  return new Promise((resolve, reject) => {
    exec(fullCmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function dockerAvailable(): boolean {
  try {
    const cmd = process.platform === "win32" ? "wsl docker ps -q" : "docker ps -q";
    execSync(cmd, { stdio: "pipe", timeout: 10000 });
    return true;
  } catch { return false; }
}

router.get("/docker-check", async (_req, res) => {
  const available = dockerAvailable();
  let portInUse = false;
  if (available) {
    try {
      const { createConnection } = await import("net");
      portInUse = await new Promise<boolean>((resolve) => {
        const sock = createConnection({ port: 4566, host: "localhost" });
        sock.on("connect", () => { sock.destroy(); resolve(true); });
        sock.on("error", () => { resolve(false); });
        setTimeout(() => { sock.destroy(); resolve(false); }, 2000);
      });
      // Check if it's OUR container using the port
      if (portInUse) {
        try {
          const out = await run(`docker inspect --format="{{.State.Status}}" ${CONTAINER_NAME}`);
          if (out === "running") portInUse = false; // it's ours, not a conflict
        } catch {}
      }
    } catch {}
  }
  res.json({ available, portInUse });
});

router.get("/status", async (_req, res) => {
  try {
    const out = await run(`docker inspect --format="{{.State.Status}}" ${CONTAINER_NAME}`);
    res.json({ status: out, container: CONTAINER_NAME });
  } catch {
    res.json({ status: "not_found", container: CONTAINER_NAME });
  }
});

router.post("/start", async (_req, res) => {
  try {
    await mkdir(DATA_DIR, { recursive: true });

    // Check if container exists but is stopped
    try {
      const state = await run(`docker inspect --format="{{.State.Status}}" ${CONTAINER_NAME}`);
      if (state === "running") { res.json({ ok: true, message: "Already running" }); return; }
      if (state === "exited" || state === "created") {
        await run(`docker start ${CONTAINER_NAME}`);
        res.json({ ok: true, message: "Started existing container" });
        return;
      }
    } catch { /* container doesn't exist, create it */ }

    // Ensure network exists
    try { await run(`docker network create ${NETWORK_NAME}`); } catch { /* already exists */ }

    // Run new container
    const volPath = process.platform === "win32"
      ? DATA_DIR.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_: string, d: string) => `/mnt/${d.toLowerCase()}`)
      : DATA_DIR;
    const cmd = [
      "docker run -d",
      `--name ${CONTAINER_NAME}`,
      `--hostname localstack`,
      `--network ${NETWORK_NAME}`,
      `--add-host=host.docker.internal:host-gateway`,
      `-p 4566:4566`,
      `-v "${volPath}:/var/lib/localstack"`,
      `-v "/var/run/docker.sock:/var/run/docker.sock"`,
      `-e DEBUG=0`,
      `-e AWS_ACCESS_KEY_ID=test`,
      `-e AWS_SECRET_ACCESS_KEY=test`,
      `-e DISABLE_CORS_CHECKS=1`,
      `-e LAMBDA_RUNTIME_ENVIRONMENT_TIMEOUT=240`,
      `-e MAIN_CONTAINER_NAME=${CONTAINER_NAME}`,
      `-e LAMBDA_DOCKER_NETWORK=${NETWORK_NAME}`,
      IMAGE,
    ].join(" ");

    await run(cmd);
    res.json({ ok: true, message: "Container started" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/stop", async (_req, res) => {
  try {
    await run(`docker stop ${CONTAINER_NAME}`);
    res.json({ ok: true, message: "Container stopped" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
