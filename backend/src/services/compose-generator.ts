import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { isPortInUse, findAvailablePort } from "./port-scanner.js";

export interface PortRemap {
  service: string;
  original: string;       // e.g. "8080:80"
  hostPort: number;
  newHostPort: number;
  containerPort: string;  // e.g. "80"
}

function parseHostPort(portStr: string): { host: number; rest: string } | null {
  // Formats: "8080:80", "8080:80/tcp", "127.0.0.1:8080:80"
  const parts = portStr.split(":");
  if (parts.length === 2) return { host: parseInt(parts[0], 10), rest: parts[1] };
  if (parts.length === 3) return { host: parseInt(parts[1], 10), rest: parts[2] };
  return null;
}

export async function analyzeAndRemap(projectPath: string, composefile: string): Promise<{ remaps: PortRemap[]; modifiedPath: string }> {
  const candidates = [composefile, `${composefile}.yml`, `${composefile}.yaml`];
  let composePath = "";
  for (const c of candidates) {
    const p = join(projectPath, c);
    if (existsSync(p)) { composePath = p; break; }
  }
  if (!composePath) return { remaps: [], modifiedPath: "" };

  const raw = await readFile(composePath, "utf-8");
  const doc = yaml.load(raw) as any;
  if (!doc?.services) return { remaps: [], modifiedPath: composePath };

  const remaps: PortRemap[] = [];
  const usedPorts = new Set<number>();

  // Collect all host ports and check conflicts
  for (const [svcName, svc] of Object.entries(doc.services) as [string, any][]) {
    if (!Array.isArray(svc.ports)) continue;
    for (let i = 0; i < svc.ports.length; i++) {
      const portStr = String(svc.ports[i]);
      const parsed = parseHostPort(portStr);
      if (!parsed || isNaN(parsed.host)) continue;

      const inUse = await isPortInUse(parsed.host) || usedPorts.has(parsed.host);
      if (inUse) {
        const newPort = await findAvailablePort(parsed.host + 1);
        usedPorts.add(newPort);
        remaps.push({ service: svcName, original: portStr, hostPort: parsed.host, newHostPort: newPort, containerPort: parsed.rest });

        // Rewrite the port in the doc
        const parts = portStr.split(":");
        if (parts.length === 2) svc.ports[i] = `${newPort}:${parsed.rest}`;
        else if (parts.length === 3) svc.ports[i] = `${parts[0]}:${newPort}:${parsed.rest}`;
      } else {
        usedPorts.add(parsed.host);
      }
    }
  }

  // Write modified compose file
  const overrideDir = join(projectPath, ".mouseketool");
  await mkdir(overrideDir, { recursive: true });
  const modifiedPath = join(overrideDir, "docker-compose.generated.yml");
  await writeFile(modifiedPath, yaml.dump(doc, { lineWidth: -1 }));

  return { remaps, modifiedPath };
}
