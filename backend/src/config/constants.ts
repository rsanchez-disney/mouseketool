import { join } from "path";

// Detect packaged Electron: NODE_ENV is set by Electron main process
const isPackaged = process.env.NODE_ENV === "production";
const baseDir = process.env.MOUSEKETOOL_DATA_DIR
  || (isPackaged ? join(process.env.APPDATA || process.env.HOME || process.cwd(), "mouseketool") : process.cwd());

export const SETTINGS_DIR = join(baseDir, ".data");
export const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
export const BUILDS_DIR = join(SETTINGS_DIR, "builds");
export const DEPLOYMENTS_FILE = join(SETTINGS_DIR, "deployments.json");
export const PIPELINES_FILE = join(SETTINGS_DIR, "pipelines.json");
export const SCHEMAS_DIR = join(SETTINGS_DIR, "table-schemas");
export const LEARNED_DIR = join(SETTINGS_DIR, "learned");
export const FAVORITES_DIR = join(SETTINGS_DIR, "favorites");
export const FEEDBACK_DIR = join(SETTINGS_DIR, "feedback");
