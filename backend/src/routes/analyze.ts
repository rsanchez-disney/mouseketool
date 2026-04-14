import { Router } from "express";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { findJavaFiles } from "../helpers/fs-utils.js";

const router = Router();

async function findSamTemplate(projectPath: string): Promise<string | null> {
  for (const name of ["template.yaml", "template.yml"]) {
    try { await readFile(join(projectPath, name), "utf-8"); return join(projectPath, name); } catch {}
  }
  try { await readFile(join(projectPath, ".aws-sam", "build", "template.yaml"), "utf-8"); return join(projectPath, ".aws-sam", "build", "template.yaml"); } catch {}
  return null;
}

function parseEnvVars(templateContent: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = templateContent.split("\n");

  let inVariables = false;
  let variablesIndent = -1;

  for (const line of lines) {
    const stripped = line.replace(/\r$/, "");
    const trimmed = stripped.trimStart();
    const indent = stripped.length - trimmed.length;

    // Detect "Variables:" key
    if (/^\s*Variables:\s*$/.test(stripped)) {
      inVariables = true;
      variablesIndent = indent;
      continue;
    }

    if (inVariables) {
      // Empty or comment lines — skip
      if (!trimmed || trimmed.startsWith("#")) continue;
      // If indent is <= the Variables key, we've left the section
      if (indent <= variablesIndent) { inVariables = false; continue; }
      // Parse KEY: value pairs (skip CloudFormation intrinsics)
      const m = trimmed.match(/^(\w+):\s*(.+?)\s*$/);
      if (m) {
        const [, key, val] = m;
        if (!val.startsWith("!") && !val.includes("Fn::") && !val.includes("Ref")) {
          vars[key] = val;
        }
      }
    }
  }
  return vars;
}

async function findEnvFiles(projectPath: string): Promise<string[]> {
  try {
    const entries = await readdir(projectPath);
    return entries.filter(e => e.endsWith(".env") || e === ".env");
  } catch { return []; }
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const stripped = line.replace(/\r$/, "").trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const eq = stripped.indexOf("=");
    if (eq < 1) continue;
    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

router.post("/", async (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath) return res.status(400).json({ error: "projectPath is required" });

  try {
    const hasPom = await readFile(join(projectPath, "pom.xml"), "utf-8").then(() => true).catch(() => false);
    const hasGradle = await readFile(join(projectPath, "build.gradle"), "utf-8").then(() => true).catch(() => false);
    const buildTool = hasPom ? "maven" : hasGradle ? "gradle" : "unknown";

    const javaFiles = await findJavaFiles(join(projectPath, "src"));
    const handlers: string[] = [];
    for (const file of javaFiles) {
      const content = await readFile(file, "utf-8");
      if (/implements\s+(RequestHandler|RequestStreamHandler|SQSHandler)/.test(content) || /public\s+\S+\s+handleRequest\s*\(/.test(content)) {
        const pkg = content.match(/^package\s+([\w.]+)\s*;/m);
        const cls = content.match(/public\s+class\s+(\w+)/);
        if (pkg && cls) handlers.push(`${pkg[1]}.${cls[1]}::handleRequest`);
      }
    }

    // Detect env vars: SAM template first, then .env files as fallback
    let environmentVariables: Record<string, string> = {};
    let envSource = "";
    const samPath = await findSamTemplate(projectPath);
    if (samPath) {
      environmentVariables = parseEnvVars(await readFile(samPath, "utf-8"));
      envSource = samPath.replace(projectPath, "").replace(/^[/\\]/, "");
    }

    if (!Object.keys(environmentVariables).length) {
      const envFiles = await findEnvFiles(projectPath);
      for (const f of envFiles) {
        const parsed = parseEnvFile(await readFile(join(projectPath, f), "utf-8"));
        if (Object.keys(parsed).length) {
          environmentVariables = parsed;
          envSource = f;
          break;
        }
      }
    }

    res.json({ projectPath, buildTool, handlers, environmentVariables, envSource });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
