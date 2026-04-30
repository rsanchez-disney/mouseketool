import { execFile } from "child_process";
import { stripAnsi } from "./ansi.js";

let kiroPath: string | null = null;
let detected: boolean | null = null;

export async function detectKiro(): Promise<{ available: boolean; path?: string }> {
  if (detected !== null) return { available: detected, path: kiroPath ?? undefined };
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    execFile(cmd, ["kiro-cli"], (err, stdout) => {
      if (err || !stdout.trim()) { detected = false; resolve({ available: false }); return; }
      kiroPath = stdout.trim().split(/\r?\n/)[0];
      detected = true;
      resolve({ available: true, path: kiroPath });
    });
  });
}

export async function askKiro(prompt: string, timeoutMs = 60000, cwd?: string): Promise<string> {
  if (!detected || !kiroPath) throw new Error("Kiro CLI not available");
  return new Promise((resolve, reject) => {
    const child = execFile(kiroPath!, ["chat", "--no-interactive", "--wrap", "never"], { timeout: timeoutMs, cwd: cwd || undefined }, (err, stdout) => {
      if (err) { reject(new Error(`Kiro failed: ${err.message}`)); return; }
      const clean = stripAnsi(stdout).replace(/^> /, "").trim();
      resolve(clean);
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
