import { execSync, spawn, ChildProcess } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const LS_PORT = 4577;
const BACKEND_PORT = 3099;
const CONTAINER_NAME = "mouseketool-test-localstack";
const DOCKER = process.platform === "win32" ? "wsl docker" : "docker";
const DATA_DIR = join(tmpdir(), "mouseketool-integration-test-data");

let backendProcess: ChildProcess | null = null;

export const TEST_CONFIG = {
  port: LS_PORT,
  endpoint: `http://localhost:${LS_PORT}`,
  backendPort: BACKEND_PORT,
  backendUrl: `http://localhost:${BACKEND_PORT}`,
  container: CONTAINER_NAME,
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
  dataDir: DATA_DIR,
};

export async function startLocalStack(): Promise<void> {
  try { execSync(`${DOCKER} rm -f ${CONTAINER_NAME}`, { stdio: "ignore" }); } catch {}
  await new Promise(r => setTimeout(r, 1000));

  console.log(`[integration] Starting LocalStack on port ${LS_PORT}...`);
  execSync(
    `${DOCKER} run -d --name ${CONTAINER_NAME} -p ${LS_PORT}:4566 -e LAMBDA_DOCKER_NETWORK=bridge -e MAIN_CONTAINER_NAME=${CONTAINER_NAME} localstack/localstack`,
    { stdio: "pipe", timeout: 60000 }
  );

  const maxWait = 60000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${LS_PORT}/_localstack/health`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.services?.lambda === "available") {
          await new Promise(r => setTimeout(r, 5000));
          console.log(`[integration] LocalStack ready (${Date.now() - start}ms)`);
          return;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("LocalStack failed to start within 60s");
}

export async function stopLocalStack(): Promise<void> {
  try {
    execSync(`${DOCKER} rm -f ${CONTAINER_NAME}`, { stdio: "ignore" });
    console.log("[integration] LocalStack stopped");
  } catch {}
}

export async function startBackend(): Promise<void> {
  // Create isolated data directory
  mkdirSync(DATA_DIR, { recursive: true });

  // Write settings that point to our test LocalStack
  const { writeFileSync } = await import("fs");
  const settingsDir = join(DATA_DIR, ".data");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({
    localstack: { protocol: "http", host: "localhost", port: LS_PORT },
    aws: { region: TEST_CONFIG.region, accessKeyId: TEST_CONFIG.accessKeyId, secretAccessKey: TEST_CONFIG.secretAccessKey },
  }));

  // Start backend with isolated data dir
  const backendDir = join(__dirname, "..", "..", "backend");
  const entry = join("dist", "index.js");

  console.log(`[integration] Starting backend on port ${BACKEND_PORT} with data dir: ${DATA_DIR}`);
  backendProcess = spawn("node", [entry], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      NODE_ENV: "development",
      MOUSEKETOOL_DATA_DIR: DATA_DIR,
    },
    stdio: "pipe",
  });

  backendProcess.stdout?.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg.includes("error") || msg.includes("Error")) console.log(`[test-backend] ${msg}`);
  });
  backendProcess.stderr?.on("data", (d) => console.error(`[test-backend-err] ${d.toString().trim()}`));

  // Wait for backend to be ready
  const maxWait = 30000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${BACKEND_PORT}/api/health`);
      if (res.ok) {
        console.log(`[integration] Backend ready (${Date.now() - start}ms)`);
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Backend failed to start within 30s");
}

export async function stopBackend(): Promise<void> {
  if (backendProcess?.pid) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${backendProcess.pid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(-backendProcess.pid, "SIGKILL");
      }
    } catch {
      backendProcess.kill("SIGKILL");
    }
    backendProcess = null;
    console.log("[integration] Backend stopped");
  }
}

export async function cleanup(): Promise<void> {
  await stopBackend();
  await stopLocalStack();
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  console.log("[integration] Cleanup complete");
}
