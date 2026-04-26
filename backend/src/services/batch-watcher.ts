import { watch, FSWatcher } from "fs";
import { join } from "path";

const watchers = new Map<string, FSWatcher>();
const listeners = new Set<(projectId: string) => void>();

export function watchProject(projectId: string, projectPath: string) {
  if (watchers.has(projectId)) return;
  try {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(projectPath, { recursive: true }, (event, filename) => {
      if (!filename || event !== "change") return;
      const name = filename.toString().toLowerCase();
      if (name.includes("docker-compose") || name.includes("compose") || name.endsWith(".env") ||
          name.includes("dockerfile") || name.endsWith(".sh") || name.endsWith(".yml") || name.endsWith(".yaml")) {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => { for (const fn of listeners) fn(projectId); }, 500);
      }
    });
    watchers.set(projectId, watcher);
  } catch {}
}

export function unwatchProject(projectId: string) {
  const w = watchers.get(projectId);
  if (w) { w.close(); watchers.delete(projectId); }
}

export function onProjectChange(fn: (projectId: string) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function unwatchAll() {
  for (const [id, w] of watchers) { w.close(); }
  watchers.clear();
}
