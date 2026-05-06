import { Response } from "express";

interface RunLog {
  logs: { line: string; container?: string; phase?: string }[];
  running: boolean;
  statuses: Record<string, string>; // node/container -> status
  remaps: any[];
  result: any | null;
  error: string | null;
  buildComplete: boolean;
}

const store = new Map<string, RunLog>();
const activeRunIds = new Map<string, string>(); // entityId -> runId
const subscribers = new Map<string, Set<Response>>();

export function getActiveRunId(entityId: string): string | undefined {
  return activeRunIds.get(entityId);
}

export function setActiveRunId(entityId: string, runId: string) {
  activeRunIds.set(entityId, runId);
}

export function getRunLogs(id: string): RunLog | undefined {
  return store.get(id);
}

export function initRunLogs(id: string) {
  store.set(id, { logs: [], running: true, statuses: {}, remaps: [], result: null, error: null, buildComplete: false });
}

export function pushLog(id: string, entry: { line: string; container?: string; phase?: string }) {
  const r = store.get(id);
  if (!r) return;
  r.logs.push(entry);
  // Notify subscribers
  const subs = subscribers.get(id);
  if (subs) {
    for (const res of [...subs]) {
      try { res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`); } catch {}
    }
  }
}

export function pushEvent(id: string, event: string, data: any) {
  const r = store.get(id);
  if (!r) return;
  if (event === "status" && data.container) r.statuses[data.container] = data.status;
  if (event === "remaps") r.remaps = data;
  if (event === "build-complete") r.buildComplete = true;
  if (event === "complete") { r.result = data; r.running = false; }
  if (event === "error") { r.error = data.message || "Error"; r.running = false; }
  // Notify subscribers
  const subs = subscribers.get(id);
  if (subs) {
    for (const res of [...subs]) {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
    }
  }
}

export function finishRun(id: string) {
  const r = store.get(id);
  if (r) r.running = false;
}

export function deleteRunLogs(id: string) {
  store.delete(id);
  subscribers.delete(id);
  // Clear activeRunId if this was the active one
  for (const [entity, runId] of activeRunIds) {
    if (runId === id) { activeRunIds.delete(entity); break; }
  }
}

export function clearAllRunLogs() {
  store.clear();
  subscribers.clear();
}

export function subscribe(id: string, res: Response) {
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id)!.add(res);
  res.on("close", () => { subscribers.get(id)?.delete(res); });
}
