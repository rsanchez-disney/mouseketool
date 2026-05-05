// ⚠️ WORKSPACE SAFETY RULE:
// Mouseketool must NEVER perform destructive or modifying actions on the user's workspace folder.
// The ONLY allowed operations on the workspace are:
//   1. SCAN — read folder names to detect existing projects
//   2. CLONE — add new project folders via git clone (only if not already present)
//   3. mvn versions:update-parent — the sole exception, modifies pom.xml to fix parent resolution (not committed)
// NO deleting, moving, renaming, or writing to any file inside the workspace. Ever.
//

import { Router } from "express";
import { readFile, writeFile, readdir, rm, mkdir } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";
import { detectKiro, askKiro } from "../helpers/kiro.js";
import { loadSettings } from "../helpers/settings.js";
import { DEPLOYMENTS_FILE, PIPELINES_FILE, BUILDS_DIR } from "../config/constants.js";

const router = Router();
const DATA_DIR = join(process.cwd(), ".data");
const PROFILE_STATE_FILE = join(DATA_DIR, "profile-state.json");
const CUSTOM_PROFILES_DIR = join(DATA_DIR, "profiles");
const BUNDLED_PROFILES_DIR = join(process.cwd(), "profiles");

// --- Helpers ---
async function loadProfileState() {
  try { return JSON.parse(await readFile(PROFILE_STATE_FILE, "utf-8")); } catch { return null; }
}
async function saveProfileState(state: any) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PROFILE_STATE_FILE, JSON.stringify(state, null, 2));
}

async function listProfiles() {
  const profiles: any[] = [];
  // Bundled
  if (existsSync(BUNDLED_PROFILES_DIR)) {
    for (const f of await readdir(BUNDLED_PROFILES_DIR)) {
      if (f.endsWith(".json")) profiles.push({ ...JSON.parse(await readFile(join(BUNDLED_PROFILES_DIR, f), "utf-8")), source: "bundled" });
    }
  }
  // Custom
  if (existsSync(CUSTOM_PROFILES_DIR)) {
    for (const f of await readdir(CUSTOM_PROFILES_DIR)) {
      if (f.endsWith(".json")) profiles.push({ ...JSON.parse(await readFile(join(CUSTOM_PROFILES_DIR, f), "utf-8")), source: "custom" });
    }
  }
  return profiles;
}

// GET /api/profile — list all profiles
router.get("/", async (_req, res) => {
  res.json(await listProfiles());
});

// GET /api/profile/state — get active profile state
router.get("/state", async (_req, res) => {
  res.json(await loadProfileState());
});

// POST /api/profile/load — load a profile (after frontend confirms destructive action)
// Body: { profileId: string, workspacePath: string, autoDownload: boolean }
router.post("/load", async (req, res) => {
  const { profileId, workspacePath, autoDownload } = req.body;
  if (!profileId || !workspacePath) return res.status(400).json({ error: "profileId and workspacePath required" });

  const profiles = await listProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  // Save state
  console.log(`[profile:load] Loading profile "${profileId}" with workspace "${workspacePath}", autoDownload=${autoDownload}`);
  await saveProfileState({ activeProfile: profileId, workspacePath, autoDownload, loadedAt: new Date().toISOString(), provisioningResults: null });
  res.json({ ok: true, profile });
});

// POST /api/profile/unload — unload active profile
router.post("/unload", async (_req, res) => {
  console.log("[profile:unload] Unloading active profile");
  await saveProfileState(null);
  // Clear deployments and pipelines
  await writeFile(DEPLOYMENTS_FILE, "[]");
  await writeFile(PIPELINES_FILE, "[]");
  await writeFile(join(process.cwd(), ".data", "batch-projects.json"), "[]");
  res.json({ ok: true });
});

// POST /api/profile/cleanup — wipe all LocalStack resources
router.post("/cleanup", async (req, res) => {
  try {
    const settings = await loadSettings();
    const endpoint = `${settings.localstack.protocol}://${settings.localstack.host}:${settings.localstack.port}`;
    const region = settings.aws.region;
    const credentials = { accessKeyId: settings.aws.accessKeyId, secretAccessKey: settings.aws.secretAccessKey };

    const { LambdaClient, ListFunctionsCommand, DeleteFunctionCommand } = await import("@aws-sdk/client-lambda");
    const { DynamoDBClient, ListTablesCommand, DeleteTableCommand } = await import("@aws-sdk/client-dynamodb");
    const { SNSClient, ListTopicsCommand, DeleteTopicCommand } = await import("@aws-sdk/client-sns");
    const { SQSClient, ListQueuesCommand, DeleteQueueCommand } = await import("@aws-sdk/client-sqs");

    const lambda = new LambdaClient({ endpoint, region, credentials });
    const dynamo = new DynamoDBClient({ endpoint, region, credentials });
    const sns = new SNSClient({ endpoint, region, credentials });
    const sqs = new SQSClient({ endpoint, region, credentials });

    // Delete all Lambdas
    const fns = await lambda.send(new ListFunctionsCommand({}));
    console.log(`[profile:cleanup] Deleting ${fns.Functions?.length || 0} Lambda functions`);
    for (const fn of fns.Functions || []) {
      try { await lambda.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName })); console.log(`[profile:cleanup]   ✓ ${fn.FunctionName}`); } catch (e: any) { console.log(`[profile:cleanup]   ✗ ${fn.FunctionName}: ${e.message}`); }
    }

    // Delete all DynamoDB tables
    const tables = await dynamo.send(new ListTablesCommand({}));
    console.log(`[profile:cleanup] Deleting ${tables.TableNames?.length || 0} DynamoDB tables`);
    for (const t of tables.TableNames || []) {
      try { await dynamo.send(new DeleteTableCommand({ TableName: t })); console.log(`[profile:cleanup]   ✓ ${t}`); } catch (e: any) { console.log(`[profile:cleanup]   ✗ ${t}: ${e.message}`); }
    }

    // Delete all SNS topics
    const topics = await sns.send(new ListTopicsCommand({}));
    console.log(`[profile:cleanup] Deleting ${topics.Topics?.length || 0} SNS topics`);
    for (const t of topics.Topics || []) {
      try { await sns.send(new DeleteTopicCommand({ TopicArn: t.TopicArn })); console.log(`[profile:cleanup]   ✓ ${t.TopicArn?.split(":").pop()}`); } catch (e: any) { console.log(`[profile:cleanup]   ✗ ${t.TopicArn}: ${e.message}`); }
    }

    // Delete all SQS queues
    const queues = await sqs.send(new ListQueuesCommand({}));
    console.log(`[profile:cleanup] Deleting ${queues.QueueUrls?.length || 0} SQS queues`);
    for (const q of queues.QueueUrls || []) {
      try { await sqs.send(new DeleteQueueCommand({ QueueUrl: q })); console.log(`[profile:cleanup]   ✓ ${q.split("/").pop()}`); } catch (e: any) { console.log(`[profile:cleanup]   ✗ ${q}: ${e.message}`); }
    }

    // Clear local data files
    await writeFile(DEPLOYMENTS_FILE, "[]");
    await writeFile(PIPELINES_FILE, "[]");
    await writeFile(join(process.cwd(), ".data", "batch-projects.json"), "[]");
    await writeFile(join(process.cwd(), ".data", "batch-workflows.json"), "[]");
    // Delete workflow folders
    try { const wfDir = join(process.cwd(), ".data", "batch-workflows"); const { readdirSync, rmSync } = await import("fs"); for (const d of readdirSync(wfDir, { withFileTypes: true })) { if (d.isDirectory()) rmSync(join(wfDir, d.name), { recursive: true, force: true }); } } catch {}
    // Delete effective compose cache
    try { const compDir = join(process.cwd(), ".data", "batch-compose"); const { rmSync } = await import("fs"); rmSync(compDir, { recursive: true, force: true }); } catch {}

    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/scan — scan workspace for profile projects
// Body: { workspacePath: string, profileId: string }
router.post("/scan", async (req, res) => {
  const { workspacePath, profileId } = req.body;
  const profiles = await listProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const results: any[] = [];

  for (const l of profile.lambdas || []) {
    const p = join(workspacePath, l.repoName);
    const found = existsSync(p);
    const meta: any = { repoName: l.repoName, displayName: l.displayName, type: "lambda", found, path: found ? p : undefined };
    if (found) {
      // Detect build tool
      if (existsSync(join(p, "pom.xml"))) meta.buildTool = "maven";
      else if (existsSync(join(p, "build.gradle")) || existsSync(join(p, "build.gradle.kts"))) meta.buildTool = "gradle";
      else if (existsSync(join(p, "package.json"))) meta.buildTool = "npm";
      // Detect language + version
      if (meta.buildTool === "maven") {
        try {
          const pom = require("fs").readFileSync(join(p, "pom.xml"), "utf-8");
          const javaVer = pom.match(/<maven\.compiler\.(?:target|release)>(\d+)/)?.[1] || pom.match(/<java\.version>(\d+)/)?.[1];
          meta.language = "java" + (javaVer || "");
        } catch { meta.language = "java"; }
      } else if (meta.buildTool === "gradle") {
        try {
          const gradle = require("fs").readFileSync(join(p, existsSync(join(p, "build.gradle.kts")) ? "build.gradle.kts" : "build.gradle"), "utf-8");
          const javaVer = gradle.match(/targetCompatibility\s*=\s*['"]?(\d+)/)?.[1] || gradle.match(/languageVersion\.set\(JavaLanguageVersion\.of\((\d+)\)/)?.[1];
          meta.language = "java" + (javaVer || "");
        } catch { meta.language = "java"; }
      } else if (meta.buildTool === "npm") {
        meta.language = "typescript";
      }
      // Detect handler using same logic as /api/analyze (scan Java source)
      try {
        const { findJavaFiles } = await import("../helpers/fs-utils.js");
        const { readFile: rf2 } = await import("fs/promises");
        const javaFiles = await findJavaFiles(join(p, "src"));
        for (const jf of javaFiles) {
          const src = await rf2(jf, "utf-8");
          if (/implements\s+(RequestHandler|RequestStreamHandler|SQSHandler)/.test(src) || /public\s+\S+\s+handleRequest\s*\(/.test(src)) {
            const pkg = src.match(/^package\s+([\w.]+)\s*;/m);
            const cls = src.match(/public\s+class\s+(\w+)/);
            if (pkg && cls) { meta.handler = `${pkg[1]}.${cls[1]}::handleRequest`; break; }
          }
        }
      } catch {}
    }
    results.push(meta);
  }
  for (const b of profile.batches || []) {
    const p = join(workspacePath, b.repoName);
    results.push({ repoName: b.repoName, displayName: b.displayName, type: "batch", found: existsSync(p), path: existsSync(p) ? p : undefined });
  }

  console.log(`[profile:scan] Found ${results.filter(r => r.found).length}/${results.length} projects in workspace`);
  res.json(results);
});

// POST /api/profile/clone-project — clone a repo using git + token from MCP config
// Body: { repoName: string, workspacePath: string }
router.post("/clone-project", async (req, res) => {
  const { repoName, workspacePath, org: profileOrg } = req.body;
  if (!repoName || !workspacePath) return res.status(400).json({ error: "repoName and workspacePath required" });

  // Read GitHub config from MCP settings
  const { readFile: rf } = await import("fs/promises");
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const configPaths = [join(home, ".kiro", "settings", "mcp.json"), join(home, ".kiro", "mcp.json")];
  let token = "", host = "", org = "";
  for (const cp of configPaths) {
    try {
      const content = JSON.parse(await rf(cp, "utf-8"));
      const servers = content.mcpServers || {};
      for (const [key, cfg] of Object.entries(servers) as [string, any][]) {
        if (!key.toLowerCase().includes("github") || cfg.disabled || !cfg.env?.GITHUB_TOKEN) continue;
        token = cfg.env.GITHUB_TOKEN;
        host = cfg.env.GITHUB_HOST || "github.com";
        // org comes from profile, not MCP config
        break;
      }
      if (token) break;
    } catch {}
  }
  if (!token || !host) return res.status(400).json({ error: "No GitHub token found in MCP config" });

  const cloneUrl = `https://${token}@${host}/${profileOrg ? profileOrg + "/" : ""}${repoName}.git`;
  const targetPath = join(workspacePath, repoName);

  try {
    const { execSync } = await import("child_process");
    console.log(`[profile:clone] Cloning ${repoName} from ${host}/${profileOrg || ""}`);
    execSync(`git clone ${cloneUrl} "${targetPath}"`, { stdio: "pipe", timeout: 120000 });
    console.log(`[profile:clone] ✓ Cloned ${repoName} to ${targetPath}`);
    res.json({ ok: true, path: targetPath });
  } catch (e: any) {
    const msg = e.stderr?.toString() || e.message || "Clone failed";
    res.status(400).json({ error: msg.includes("404") || msg.includes("not found") ? "Repository not found — check permissions" : msg.substring(0, 200) });
  }
});

// GET /api/profile/github-status — check if Kiro + GitHub MCP is available
router.get("/github-status", async (_req, res) => {
  const kiro = await detectKiro();
  if (!kiro.available) return res.json({ available: false, error: "Kiro CLI not found" });
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const configPaths = [
      join(home, ".kiro", "settings", "mcp.json"),
      join(home, ".kiro", "mcp.json"),
      join(process.cwd(), ".kiro", "mcp", "mcp.json"),
    ];
    for (const cp of configPaths) {
      try {
        const content = JSON.parse(await readFile(cp, "utf-8"));
        const servers = content.mcpServers || {};
        // Find a github entry with a valid command and token
        for (const [key, cfg] of Object.entries(servers) as [string, any][]) {
          if (!key.toLowerCase().includes("github")) continue;
          if (cfg.disabled) continue;
          if (!cfg.command) continue;
          const token = cfg.env?.GITHUB_TOKEN || "";
          if (!token) continue;
          return res.json({ available: true, host: cfg.env?.GITHUB_HOST || "github.com" });
        }
      } catch {}
    }
    res.json({ available: false, error: "No valid GitHub MCP configured" });
  } catch {
    res.json({ available: false, error: "Could not check MCP config" });
  }
});

// POST /api/profile/save-results — save provisioning results
router.post("/save-results", async (req, res) => {
  const state = await loadProfileState();
  if (!state) return res.status(400).json({ error: "No active profile" });
  state.provisioningResults = req.body;
  await saveProfileState(state);
  res.json({ ok: true });
});

export default router;
