import { readFile, writeFile, mkdir } from "fs/promises";
import { SETTINGS_DIR, SETTINGS_FILE } from "../config/constants.js";
import { Settings, DEFAULTS } from "../config/interfaces.js";

export async function loadSettings(): Promise<Settings> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(SETTINGS_FILE, "utf-8")) };
  } catch { return DEFAULTS; }
}

export async function saveSettings(s: Settings): Promise<Settings> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2));
  return s;
}
