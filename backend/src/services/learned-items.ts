import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { LEARNED_DIR } from "../config/constants.js";

const MAX_ITEMS = 50;

function filePath(pipelineId: string) { return join(LEARNED_DIR, `${pipelineId}.json`); }

export async function getLearnedItems(pipelineId: string): Promise<string[]> {
  try { return JSON.parse(await readFile(filePath(pipelineId), "utf-8")); } catch { return []; }
}

export async function addLearnedItems(pipelineId: string, items: string[]): Promise<void> {
  if (!items.length) return;
  await mkdir(LEARNED_DIR, { recursive: true });
  const existing = await getLearnedItems(pipelineId);
  const combined = [...existing, ...items].slice(-MAX_ITEMS);
  await writeFile(filePath(pipelineId), JSON.stringify(combined, null, 2));
}

export async function clearLearnedItems(pipelineId: string): Promise<void> {
  try { const { unlink } = await import("fs/promises"); await unlink(filePath(pipelineId)); } catch {}
}
