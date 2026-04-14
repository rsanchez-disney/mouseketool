import { join } from "path";

export const SETTINGS_DIR = join(process.cwd(), ".data");
export const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
export const BUILDS_DIR = join(SETTINGS_DIR, "builds");
export const DEPLOYMENTS_FILE = join(SETTINGS_DIR, "deployments.json");
