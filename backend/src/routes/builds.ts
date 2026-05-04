import { Router } from "express";
import { exec, execSync } from "child_process";
import { readFile, writeFile, mkdir, readdir, rm, copyFile } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";
import { SETTINGS_DIR, BUILDS_DIR } from "../config/constants.js";
import { loadSettings } from "../helpers/settings.js";
import { findJar, findJavaFiles } from "../helpers/fs-utils.js";
import { stripAnsi } from "../helpers/ansi.js";

const router = Router();

const SHADE_PLUGIN = `
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-shade-plugin</artifactId>
      <version>3.5.1</version>
      <executions>
        <execution>
          <phase>package</phase>
          <goals><goal>shade</goal></goals>
          <configuration>
            <transformers>
              <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                <manifestEntries>
                  <Multi-Release>true</Multi-Release>
                </manifestEntries>
              </transformer>
              <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
            </transformers>
            <filters>
              <filter>
                <artifact>*:*</artifact>
                <excludes>
                  <exclude>META-INF/*.SF</exclude>
                  <exclude>META-INF/*.DSA</exclude>
                  <exclude>META-INF/*.RSA</exclude>
                </excludes>
              </filter>
            </filters>
          </configuration>
        </execution>
      </executions>
    </plugin>`;

async function injectShadePlugin(projectPath: string): Promise<string | null> {
  const pomPath = join(projectPath, "pom.xml");
  try {
    const pom = await readFile(pomPath, "utf-8");
    if (pom.includes("maven-shade-plugin")) return null; // already has it

    const tempPom = join(projectPath, ".pom-shaded.xml");
    let modified: string;

    if (pom.includes("</plugins>")) {
      modified = pom.replace("</plugins>", `${SHADE_PLUGIN}\n  </plugins>`);
    } else if (pom.includes("</build>")) {
      modified = pom.replace("</build>", `  <plugins>${SHADE_PLUGIN}\n  </plugins>\n  </build>`);
    } else {
      modified = pom.replace("</project>", `  <build>\n    <plugins>${SHADE_PLUGIN}\n    </plugins>\n  </build>\n</project>`);
    }

    await writeFile(tempPom, modified);
    return tempPom;
  } catch { return null; }
}

let activeBuild: ReturnType<typeof exec> | null = null;

router.post("/cancel", (_req, res) => {
  if (activeBuild && activeBuild.pid) {
    const pid = activeBuild.pid;
    try {
      if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      else process.kill(-pid, "SIGKILL");
    } catch { activeBuild.kill("SIGKILL"); }
    activeBuild = null;
    res.json({ cancelled: true });
  } else res.json({ cancelled: false, message: "No active build" });
});

router.post("/", (req, res) => {
  const { projectPath, buildTool, handler } = req.body;
  if (!projectPath) { res.status(400).json({ error: "projectPath required" }); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

  let ended = false;
  const send = (event: string, data: any) => { if (!ended) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const finish = () => { if (!ended) { ended = true; res.end(); } };

  const tool = buildTool || "maven";

  (async () => {
    let tempPom: string | null = null;

    if (tool === "maven") {
      send("log", { line: "Checking for shade plugin..." });
      tempPom = await injectShadePlugin(projectPath);
      if (tempPom) send("log", { line: "Shade plugin not found — injecting into temporary pom." });
      else send("log", { line: "Shade plugin already configured." });
    }

    const isWin = process.platform === "win32";
    const cmd = tool === "maven" ? (isWin ? "mvn.cmd" : "mvn") : (isWin ? "gradle.bat" : "gradle");
    const pomFlag = tempPom ? ` -f .pom-shaded.xml` : "";
    const args = tool === "maven" ? `package -DskipTests -B${pomFlag}` : "shadowJar --console=plain";

    send("log", { line: `$ cd ${projectPath}` });
    send("log", { line: `$ ${cmd} ${args}` });

    const earlyBuildId = uuid();
    const logDir = join(SETTINGS_DIR, "build-logs", projectPath.replace(/[\\/:*?"<>|]/g, "_"), earlyBuildId); await mkdir(logDir, { recursive: true });
    const logFile = join(logDir, `build-${Date.now()}.log`);
    const script = isWin
      ? `cd /d "${projectPath}" && ${cmd} ${args} > "${logFile}" 2>&1 & echo %errorlevel% > "${logFile}.exit"`
      : `cd "${projectPath}" && ${cmd} ${args} > "${logFile}" 2>&1; echo $? > "${logFile}.exit"`;

    let linesSent = 0;

    const tailer = setInterval(async () => {
      try {
        const lines = (await readFile(logFile, "utf-8")).split("\n");
        for (let i = linesSent; i < lines.length; i++) {
          const line = stripAnsi(lines[i]!).trimEnd();
          if (line) send("log", { line });
        }
        linesSent = lines.length;
      } catch { /* file not ready */ }
    }, 1000);

    activeBuild = exec(script, { env: { ...process.env, TERM: "dumb", NO_COLOR: "1" }, shell: isWin ? "cmd.exe" : "/bin/sh" }, async () => {
      activeBuild = null;
      clearInterval(tailer);

      // Clean up temp pom
      if (tempPom) rm(tempPom, { force: true }).catch(() => {});

      try {
        const output = await readFile(logFile, "utf-8");
        const allLines = output.split("\n");
        for (let i = linesSent; i < allLines.length; i++) {
          const line = stripAnsi(allLines[i]!).trimEnd();
          if (line) send("log", { line });
        }

        const exitCode = parseInt((await readFile(`${logFile}.exit`, "utf-8")).trim(), 10);
        rm(logFile, { force: true }).catch(() => {});
        rm(`${logFile}.exit`, { force: true }).catch(() => {});

        if (exitCode !== 0) { send("error", { message: `Build failed with exit code ${exitCode}` }); finish(); return; }

        await mkdir(BUILDS_DIR, { recursive: true });
        const targetDir = tool === "maven" ? join(projectPath, "target") : join(projectPath, "build", "libs");
        const jarPath = await findJar(targetDir);
        if (!jarPath) { send("error", { message: "Build succeeded but no JAR found" }); finish(); return; }

        const buildId = earlyBuildId;
        const buildDir = join(BUILDS_DIR, buildId);
        await mkdir(buildDir);
        const jarName = jarPath.split(/[/\\]/).pop()!;
        const destJar = join(buildDir, jarName);
        await copyFile(jarPath, destJar);

        // Fix log4j multi-release: Lambda runtime doesn't load META-INF/versions/9/ classes,
        // so replace the base StackLocator with the Java 9+ (StackWalker) version.
        // Also merge Log4j2Plugins.dat from all JARs — shade plugin can't do this natively.
        try {
          const { execFileSync } = await import("child_process");
          const tmpFix = join(buildDir, "_mrfix");
          await mkdir(tmpFix, { recursive: true });

          // 1. Fix StackLocator
          execFileSync("jar", ["xf", destJar, "META-INF/versions/9/org/apache/logging/log4j/util/StackLocator.class"], { cwd: tmpFix });
          await mkdir(join(tmpFix, "org", "apache", "logging", "log4j", "util"), { recursive: true });
          await copyFile(join(tmpFix, "META-INF", "versions", "9", "org", "apache", "logging", "log4j", "util", "StackLocator.class"), join(tmpFix, "org", "apache", "logging", "log4j", "util", "StackLocator.class"));
          execFileSync("jar", ["uf", destJar, "org/apache/logging/log4j/util/StackLocator.class"], { cwd: tmpFix });

          // 2. Merge Log4j2Plugins.dat using log4j's own PluginCache
          const mergerSrc = `
import org.apache.logging.log4j.core.config.plugins.processor.PluginCache;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.jar.*;
public class PluginMerger {
  public static void main(String[] args) throws Exception {
    PluginCache cache = new PluginCache();
    String datPath = "META-INF/org/apache/logging/log4j/core/config/plugins/Log4j2Plugins.dat";
    List<URL> urls = new ArrayList<>();
    for (int i = 0; i < args.length - 1; i++) {
      try { urls.add(new URL("jar:file:" + args[i] + "!/" + datPath)); } catch (Exception e) {}
    }
    cache.loadCacheFiles(Collections.enumeration(urls));
    File out = new File(args[args.length - 1]);
    out.getParentFile().mkdirs();
    try (OutputStream os = new FileOutputStream(out)) { cache.writeCache(os); }
    int total = cache.getAllCategories().values().stream().mapToInt(Map::size).sum();
    System.out.println("Merged " + total + " plugins");
  }
}`;
          const mergerJava = join(tmpFix, "PluginMerger.java");
          const { writeFile: wf } = await import("fs/promises");
          await wf(mergerJava, mergerSrc);
          const sep = process.platform === "win32" ? ";" : ":";
          execFileSync("javac", ["-cp", destJar, "-proc:none", mergerJava], { cwd: tmpFix });

          // Find log4j-core jar in Maven cache
          const m2 = join(process.env.USERPROFILE || process.env.HOME || "", ".m2", "repository", "org", "apache", "logging", "log4j", "log4j-core");
          let log4jJars: string[] = [];
          try {
            const { readdirSync } = await import("fs");
            const findJars = (dir: string): string[] => {
              const results: string[] = [];
              for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) results.push(...findJars(p));
                else if (e.name.endsWith(".jar") && !e.name.includes("sources") && !e.name.includes("javadoc")) results.push(p);
              }
              return results;
            };
            log4jJars = findJars(m2);
          } catch { /* no m2 cache */ }

          const datOut = join(tmpFix, "META-INF", "org", "apache", "logging", "log4j", "core", "config", "plugins", "Log4j2Plugins.dat");
          execFileSync("java", ["-cp", `${tmpFix}${sep}${destJar}`, "PluginMerger", destJar, ...log4jJars, datOut], { cwd: tmpFix });
          execFileSync("jar", ["uf", destJar, "META-INF/org/apache/logging/log4j/core/config/plugins/Log4j2Plugins.dat"], { cwd: tmpFix });

          await rm(tmpFix, { recursive: true, force: true });
        } catch { /* non-fatal */ }

        const meta = { id: buildId, projectPath, buildTool: tool, handler: handler || "", jarPath: destJar, createdAt: new Date().toISOString(), projectName: projectPath.split(/[/\\]/).pop() || "unknown" };
        await writeFile(join(buildDir, "meta.json"), JSON.stringify(meta, null, 2));

        // Carry over envvars from previous build of the same project
        try {
          const allBuilds = await readdir(BUILDS_DIR, { withFileTypes: true });
          for (const e of allBuilds) {
            if (!e.isDirectory() || e.name === buildId) continue;
            const prev = join(BUILDS_DIR, e.name);
            const prevEnv = join(prev, "envvars.json");
            try {
              const prevMeta = JSON.parse(await readFile(join(prev, "meta.json"), "utf-8"));
              if (prevMeta.projectPath === projectPath) {
                await copyFile(prevEnv, join(buildDir, "envvars.json"));
                break;
              }
            } catch { /* skip */ }
          }
        } catch { /* non-fatal */ }


        // If no envvars.json yet, detect from SAM template / .env files
        try {
          await readFile(join(buildDir, "envvars.json"), "utf-8");
        } catch {
          try {
            const { analyzeEnvVars } = await import("./analyze.js");
            const detected = await analyzeEnvVars(projectPath);
            if (detected.length) await writeFile(join(buildDir, "envvars.json"), JSON.stringify(detected));
          } catch {}
        }

        send("complete", meta);
      } catch (e: any) { send("error", { message: e.message }); }
      finish();
    });
  })();
});

// POST /api/builds/sync — synchronous build for provisioning (blocks until complete)
// POST /api/builds/sync — synchronous build for provisioning (blocks until complete)
router.post("/sync", async (req, res) => {
  const { projectPath, freshClone } = req.body;
  if (!projectPath) return res.status(400).json({ error: "projectPath required" });

  const { exec } = await import("child_process");
  const run = (cmd: string, opts: any) => new Promise<void>((resolve, reject) => { exec(cmd, opts, (err: any) => err ? reject(err) : resolve()); });
  const { existsSync: ex, readdirSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } = await import("fs");
  const { join: pjoin } = await import("path");

  const isMaven = ex(pjoin(projectPath, "pom.xml"));
  const isGradle = ex(pjoin(projectPath, "build.gradle")) || ex(pjoin(projectPath, "build.gradle.kts"));
  if (!isMaven && !isGradle) return res.status(400).json({ error: "No pom.xml or build.gradle found" });

  const tool = isMaven ? "maven" : "gradle";
  const isWin = process.platform === "win32";
  const cmd = tool === "maven" ? (isWin ? "mvn.cmd" : "mvn") : (isWin ? "gradle.bat" : "gradle");
  const args = tool === "maven" ? "package -DskipTests -B -q" : "shadowJar --console=plain -q";

  // EXCEPTION: mvn versions:update-parent is the ONLY allowed modification to workspace files.
  let parentUpdated = false;
  if (freshClone && isMaven) {
    console.log(`[profile:build] Running versions:update-parent for freshly cloned project`);
    try {
      await run(`${cmd} versions:update-parent -DgenerateBackupPoms=false -B -q`, { cwd: projectPath, timeout: 60000, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" } });
      console.log(`[profile:build] ✓ Parent POM updated`); parentUpdated = true;
    } catch { console.log(`[profile:build] ⚠ versions:update-parent failed, continuing anyway`); }
  }

  console.log(`[profile:build] Building ${projectPath} with ${tool}`);
  try {
    await run(`${cmd} ${args}`, { cwd: projectPath, timeout: 300000, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" } });
  } catch (e: any) {
    console.log(`[profile:build] ✗ Build failed: ${e.message.substring(0, 100)}`);
    return res.status(400).json({ error: "Build failed" });
  }

  // Find JAR
  const targetDir = tool === "maven" ? pjoin(projectPath, "target") : pjoin(projectPath, "build", "libs");
  try {
    const jars = readdirSync(targetDir).filter((f: string) => f.endsWith(".jar") && !f.endsWith("-sources.jar") && !f.endsWith("-javadoc.jar") && !f.includes("original"));
    if (!jars.length) return res.status(400).json({ error: "No JAR found after build" });

    const { v4: uuid } = await import("uuid");
    const buildId = uuid();
    const buildDir = pjoin(BUILDS_DIR, buildId);
    mkdirSync(buildDir, { recursive: true });
    const jarName = jars[0]!;
    copyFileSync(pjoin(targetDir, jarName), pjoin(buildDir, jarName));

    // Detect handler: SAM template first
    let handler = "";
    try {
      const samPaths = ["template-local.yml", "template.yaml", "template.yml", "sam-template.yaml"];
      for (const sp of samPaths) {
        const samPath = pjoin(projectPath, sp);
        if (ex(samPath)) {
          const sam = readFileSync(samPath, "utf-8");
          const m = sam.match(/^\s*Handler:\s*(.+)/m);
          if (m) { handler = m[1].trim(); break; }
        }
      }
    } catch {}

    // Fallback: scan Java source for handler classes
    if (!handler) {
      const srcDir = pjoin(projectPath, "src");
      if (ex(srcDir)) {
        const javaFiles = await findJavaFiles(srcDir);
        console.log(`[profile:build] Scanning ${javaFiles.length} Java files for handlers`);
        for (const jf of javaFiles) {
          const src = readFileSync(jf, "utf-8");
          if (/implements\s+(RequestHandler|RequestStreamHandler|SQSHandler)/.test(src) || /public\s+\S+\s+handleRequest\s*\(/.test(src)) {
            const pkg = src.match(/^package\s+([\w.]+)\s*;/m);
            const cls = src.match(/public\s+class\s+(\w+)/);
            if (pkg && cls) { handler = `${pkg[1]}.${cls[1]}::handleRequest`; console.log(`[profile:build] ✓ Detected handler: ${handler}`); break; }
          }
        }
        if (!handler) console.log(`[profile:build] ⚠ No handler found in ${javaFiles.length} source files`);
      }
    }

    const projectName = projectPath.split(/[\\/]/).pop() || "unknown";

    // Detect env vars from .env files or SAM template and save for deploy
    try {
      const envVars: { key: string; value: string }[] = [];
      let envSource = "";
      // Try .env files first
      const envFiles = [".env", ".env.local", ".env.development", ".env.example", ".env.sample"];
      for (const ef of envFiles) {
        const envPath = pjoin(projectPath, ef);
        if (ex(envPath)) {
          const content = readFileSync(envPath, "utf-8");
          for (const line of content.split(/\r?\n/)) {
            const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
            if (m) envVars.push({ key: m[1], value: m[2].replace(/^["\']+|["\']+$/g, "") });
          }
          if (envVars.length) { envSource = ef; break; }
        }
      }
      // Fallback: SAM template
      if (!envVars.length) {
        const samPaths2 = ["template-local.yml", "template.yaml", "template.yml", "sam-template.yaml"];
        for (const sp of samPaths2) {
          const samPath2 = pjoin(projectPath, sp);
          if (ex(samPath2)) {
            const sam2 = readFileSync(samPath2, "utf-8");
            // Parse Variables section respecting YAML indentation
            const samLines = sam2.split(/\r?\n/);
            const varIdx = samLines.findIndex((l: string) => /^\s+Variables:\s*$/.test(l));
            if (varIdx >= 0) {
              const baseIndent = samLines[varIdx].match(/^(\s*)/)?.[1].length || 0;
              for (let vi = varIdx + 1; vi < samLines.length; vi++) {
                const line = samLines[vi];
                if (!line.trim()) continue;
                const lineIndent = line.match(/^(\s*)/)?.[1].length || 0;
                if (lineIndent <= baseIndent) break;
                const m = line.match(/^\s+(\w+):\s*(.*)/);
                if (m && m[1] !== "Variables") envVars.push({ key: m[1], value: m[2].replace(/^["\']+ |["\']+ $/g, "").replace(/^!Ref\s+/, "") });
              }
            }
            if (envVars.length) { envSource = sp; break; }
          }
        }
      }
      // Lowest precedence: scan README for dotenv/env section
      if (!envVars.length) {
        const readmeFiles = ["README.md", "readme.md", "Readme.md"];
        for (const rf of readmeFiles) {
          const rPath = pjoin(projectPath, rf);
          if (ex(rPath)) {
            const readme = readFileSync(rPath, "utf-8");
            const envSection = readme.match(/(?:#+[^\n]*(?:env|environment)[^\n]*\n[\s\S]*?```[^\n]*\n([\s\S]*?)```|```(?:dotenv|env)\n([\s\S]*?)```)/i);
            if (envSection) {
              for (const line of envSection[1].split(/\n/)) {
                const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)/);
                if (m) envVars.push({ key: m[1], value: m[2].replace(/^["\']+ |["\']+ $/g, "") });
              }
              if (envVars.length) envSource = rf;
            }
            break;
          }
        }
      }
      if (envVars.length) {
        writeFileSync(pjoin(buildDir, "envvars.json"), JSON.stringify({ vars: envVars, source: envSource }));
        console.log(`[profile:build] ✓ Detected ${envVars.length} env vars from ${envSource}`);
      }
    } catch {}
    writeFileSync(pjoin(buildDir, "meta.json"), JSON.stringify({
      id: buildId, projectPath, buildTool: tool, handler, jarPath: pjoin(buildDir, jarName),
      createdAt: new Date().toISOString(), projectName
    }));

    console.log(`[profile:build] ✓ Built ${projectName} → ${buildId} (handler: ${handler || "none"})`);
    res.json({ buildId, handler, projectName, jarPath: pjoin(buildDir, jarName), parentUpdated });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/", async (_req, res) => {
  await mkdir(BUILDS_DIR, { recursive: true });
  const entries = await readdir(BUILDS_DIR, { withFileTypes: true });
  const builds = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try { builds.push(JSON.parse(await readFile(join(BUILDS_DIR, e.name, "meta.json"), "utf-8"))); } catch { /* skip */ }
  }
  builds.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const settings = await loadSettings();
  const ttlMs = settings.cleanup.ttlMinutes * 60 * 1000;
  const active = builds.filter((b: any) => Date.now() - new Date(b.createdAt).getTime() <= ttlMs);
  res.json(active);
});

router.delete("/:id", async (req, res) => {
  try { await rm(join(BUILDS_DIR, req.params.id), { recursive: true }); res.json({ deleted: true }); }
  catch { res.status(404).json({ error: "Build not found" }); }
});

let firstRun = true;
export async function cleanupBuilds() {
  const settings = await loadSettings();
  try {
    const entries = await readdir(BUILDS_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        if (firstRun && settings.cleanup.deleteOnStartup) {
          await rm(join(BUILDS_DIR, e.name), { recursive: true });
        } else {
          const meta = JSON.parse(await readFile(join(BUILDS_DIR, e.name, "meta.json"), "utf-8"));
          const ttlMs = settings.cleanup.ttlMinutes * 60 * 1000;
          if (Date.now() - new Date(meta.createdAt).getTime() > ttlMs) await rm(join(BUILDS_DIR, e.name), { recursive: true });
        }
      } catch {}
    }
    if (firstRun && settings.cleanup.deleteOnStartup) console.log("[cleanup] Deleted all cached builds on startup");
  } catch {}
  // Clean up old build log files
  try {
    const { readdir: rd2 } = await import("fs/promises");
    const logBaseDir = join(SETTINGS_DIR, "build-logs");
    const ttlMs = settings.cleanup.ttlMinutes * 60 * 1000;
    for (const proj of await rd2(logBaseDir).catch(() => [] as string[])) {
      const projDir = join(logBaseDir, proj);
      for (const f of await rd2(projDir).catch(() => [] as string[])) {
        const ts = parseInt(f.match(/build-(\d+)\.log/)?.[1] || "0");
        if (ts && Date.now() - ts > ttlMs) await rm(join(projDir, f)).catch(() => {});
      }
    }
  } catch {}
  firstRun = false;
}

export default router;
