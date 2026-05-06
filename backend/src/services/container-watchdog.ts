import { execSync } from "child_process";
import { getRunningState } from "../routes/batch-runs.js";

const POLL_INTERVAL = 10_000; // 10s
const isWin = process.platform === "win32";

function getMouseketoolContainers(): string[] {
  try {
    const cmd = isWin
      ? 'wsl docker ps -q --filter "label=MK_CREATED_BY=MOUSEKETOOL" 2>/dev/null'
      : 'docker ps -q --filter "label=MK_CREATED_BY=MOUSEKETOOL" 2>/dev/null';
    const out = execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch { return []; }
}

function killContainers(ids: string[]) {
  if (!ids.length) return;
  const batch = ids.join(" ");
  const cmd = isWin
    ? `wsl docker rm -f ${batch} 2>/dev/null; true`
    : `docker rm -f ${batch} 2>/dev/null; true`;
  try { execSync(cmd, { stdio: "ignore", timeout: 15000 }); } catch {}
  console.log(`[watchdog] Killed ${ids.length} orphaned container(s)`);
}

function sweep() {
  const state = getRunningState();
  // If something is actively running, don't kill anything
  if (state.simpleProjectId || state.workflowId) return;
  const containers = getMouseketoolContainers();
  if (containers.length) {
    console.log(`[watchdog] Found ${containers.length} orphaned MK container(s) - killing`);
    killContainers(containers);
  }
}

let interval: NodeJS.Timeout | null = null;

export function startContainerWatchdog() {
  // Immediate sweep on startup
  setTimeout(sweep, 3000);
  interval = setInterval(sweep, POLL_INTERVAL);
  console.log("[watchdog] Container watchdog started");
}

export function stopContainerWatchdog() {
  if (interval) { clearInterval(interval); interval = null; }
}
