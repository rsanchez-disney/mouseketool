import { readdir, readFile } from "fs/promises";
import { join } from "path";

export async function findJavaFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory() && ![".", "target", "build", "node_modules"].some(s => e.name.startsWith(s))) {
        results.push(...(await findJavaFiles(full)));
      } else if (e.name.endsWith(".java")) {
        results.push(full);
      }
    }
  } catch { /* skip unreadable */ }
  return results;
}

export async function findJar(dir: string): Promise<string | null> {
  try {
    const { stat } = await import("fs/promises");
    const entries = await readdir(dir);
    const jars = entries.filter(e => e.endsWith(".jar") && !e.endsWith("-sources.jar") && !e.endsWith("-javadoc.jar") && !e.startsWith("original-"));
    if (!jars.length) return null;
    // Prefer the largest JAR (fat/shaded jar)
    let best = jars[0]!;
    let bestSize = 0;
    for (const j of jars) {
      const s = await stat(join(dir, j));
      if (s.size > bestSize) { best = j; bestSize = s.size; }
    }
    return join(dir, best);
  } catch { return null; }
}
