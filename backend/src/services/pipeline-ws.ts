import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { watcher } from "./pipeline-watcher.js";

const clients = new Map<string, Set<WebSocket>>(); // pipelineId -> connected clients

export function initPipelineWs(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/pipelines" });

  wss.on("connection", (ws, req) => {
    // Client sends pipelineId as query param: /ws/pipelines?id=xxx
    const url = new URL(req.url || "", "http://localhost");
    const pipelineId = url.searchParams.get("id");
    if (!pipelineId) { ws.close(4000, "Missing pipeline id"); return; }

    if (!clients.has(pipelineId)) clients.set(pipelineId, new Set());

    // Batch count polling for heavy load pipelines
    const batchInterval = setInterval(() => {
      const count = watcher.getBatchCount(pipelineId);
      if (count > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "batch-count", count }));
      }
    }, 1500);
    clients.get(pipelineId)!.add(ws);

    ws.on("close", () => {
      clearInterval(batchInterval);
      clients.get(pipelineId)?.delete(ws);
      if (clients.get(pipelineId)?.size === 0) clients.delete(pipelineId);
    });
  });

  // Pipe watcher events to connected clients
  watcher.onNewRun.subscribe(event => {
    const sockets = clients.get(event.pipelineId);
    if (!sockets?.size) return;
    const msg = JSON.stringify({ type: "new-run", runId: event.run.id, source: event.run.source, timestamp: event.run.timestamp });
    for (const ws of sockets) { if (ws.readyState === WebSocket.OPEN) ws.send(msg); }
  });

  watcher.onStepUpdate.subscribe(event => {
    const sockets = clients.get(event.pipelineId);
    if (!sockets?.size) return;
    const msg = JSON.stringify({ type: "step-update", runId: event.runId, step: event.step, status: event.status, logs: event.logs, elapsed: event.elapsed });
    for (const ws of sockets) { if (ws.readyState === WebSocket.OPEN) ws.send(msg); }
  });

  console.log("[ws] Pipeline WebSocket ready at /ws/pipelines");
}
