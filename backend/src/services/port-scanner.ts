import { execSync } from "child_process";

let usedPortsCache: Set<number> | null = null;
let cacheTime = 0;

function getUsedPorts(): Set<number> {
  if (usedPortsCache && Date.now() - cacheTime < 2000) return usedPortsCache;
  const ports = new Set<number>();
  try {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "netstat -ano" : "netstat -tlnp 2>/dev/null || ss -tlnp";
    const out = execSync(cmd, { encoding: "utf-8", timeout: 3000 });
    for (const line of out.split("\n")) {
      if (isWin && !line.includes("LISTENING")) continue;
      const match = line.match(/:(\d+)\s/);
      if (match) ports.add(parseInt(match[1], 10));
    }
  } catch {}
  usedPortsCache = ports;
  cacheTime = Date.now();
  return ports;
}

export async function isPortInUse(port: number): Promise<boolean> {
  return getUsedPorts().has(port);
}

export async function findAvailablePort(start: number): Promise<number> {
  let port = start;
  while (port < 65535) {
    if (!(await isPortInUse(port))) return port;
    port++;
  }
  throw new Error("No available port found");
}

export async function scanPorts(ports: number[]): Promise<Map<number, boolean>> {
  const results = new Map<number, boolean>();
  await Promise.all(ports.map(async (p) => { results.set(p, await isPortInUse(p)); }));
  return results;
}
