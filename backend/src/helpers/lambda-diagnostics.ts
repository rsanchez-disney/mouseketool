// Shared diagnostic utilities for Lambda error extraction

export function extractLogsFromPayload(parsed: any): string[] {
  if (!parsed) return [];
  const logs: string[] = [];
  if (parsed.errorType || parsed.errorMessage) logs.push(`${parsed.errorType || "Error"}: ${parsed.errorMessage || "Unknown"}`);
  if (Array.isArray(parsed.stackTrace)) for (const frame of parsed.stackTrace) logs.push(`  at ${frame}`);
  let cause = parsed.cause; let depth = 0;
  while (cause && depth < 10) {
    logs.push(`Caused by: ${cause.errorType || ""}: ${cause.errorMessage || ""}`);
    if (Array.isArray(cause.stackTrace)) for (const frame of cause.stackTrace) logs.push(`  at ${frame}`);
    cause = cause.cause; depth++;
  }
  return logs;
}

export function diagnoseError(parsed: any, envVars: Record<string, string>): string[] {
  const hints: string[] = [];
  const errorType = parsed?.errorType || "";
  const errorMsg = parsed?.errorMessage || "";
  if (errorType.includes("ExceptionInInitializerError")) {
    hints.push("The Lambda class was found but crashed during static initialization.");
    hints.push("  This usually means a dependency (Vault, DB, external service) is unreachable.");
  }
  if (errorType.includes("NoClassDefFoundError") || errorType.includes("ClassNotFoundException")) {
    const missing = errorMsg.match(/: (.+)/)?.[1] || "";
    hints.push(`Missing class: ${missing}`);
    hints.push("  The deployment JAR may not include all dependencies. Check shade plugin output.");
  }
  const hostVars = Object.entries(envVars).filter(([_, v]) => /^https?:\/\//.test(v));
  if (hostVars.length && errorType.includes("ExceptionInInitializerError")) {
    hints.push("");
    hints.push("Environment variables pointing to services that may be unreachable:");
    for (const [k, v] of hostVars) hints.push(`  ${k} = ${v}`);
  }
  return hints;
}

import { readFile, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { join } from "path";
import { BUILDS_DIR, DEPLOYMENTS_FILE } from "../config/constants.js";

export async function localClassDiagnose(buildId: string, handler: string, envVars?: Record<string, string>): Promise<string[]> {
  try {
    const className = handler.split("::")[0];
    const metaPath = join(BUILDS_DIR, buildId, "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    const jarPath = meta.jarPath;
    const tmpDir = join(BUILDS_DIR, buildId);
    const diagClass = join(tmpDir, "Diag.class");
    try { await readFile(diagClass); } catch {
      const diagSrc = 'public class Diag{public static void main(String[] a){try{Class.forName(a[0]);System.out.println("OK");}catch(Throwable t){t.printStackTrace(System.out);}}}';
      await writeFile(join(tmpDir, "Diag.java"), diagSrc);
      await new Promise<void>((resolve, reject) => { execFile("javac", ["-d", tmpDir, join(tmpDir, "Diag.java")], (err) => err ? reject(err) : resolve()); });
    }
    const sep = process.platform === "win32" ? ";" : ":";
    return new Promise((resolve) => {
      execFile("java", ["-cp", `${jarPath}${sep}${tmpDir}`, "Diag", className], { timeout: 15000, env: { ...process.env, ...envVars } }, (_err, stdout, stderr) => {
        const output = (stdout + "\n" + stderr).split("\n").filter(l => l.trim() && !l.startsWith("ERROR StatusLogger") && !l.startsWith("WARNING:"));
        resolve(output.length ? output : ["Diagnostic ran but produced no output"]);
      });
    });
  } catch (e: any) { return [`Diagnostic failed: ${e.message}`]; }
}

export async function getDeploymentInfo(functionName: string): Promise<{ buildId: string; handler: string } | null> {
  try {
    const deps = JSON.parse(await readFile(DEPLOYMENTS_FILE, "utf-8"));
    const dep = deps.find((d: any) => d.functionName === functionName);
    return dep ? { buildId: dep.buildId, handler: dep.handler } : null;
  } catch { return null; }
}
