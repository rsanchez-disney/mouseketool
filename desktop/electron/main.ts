import { app, BrowserWindow, Menu, ipcMain } from "electron";
import { spawn, execSync, ChildProcess } from "child_process";
import { createServer } from "net";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const openDevTools = process.argv.includes("--devtools");

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort = 3001;

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(start, () => { server.close(() => resolve(start)); });
    server.on("error", () => resolve(findFreePort(start + 1)));
  });
}

function startBackend(): Promise<void> {
  const backendDir = isDev
    ? path.join(__dirname, "..", "..", "..", "backend")
    : path.join(process.resourcesPath, "backend");

  const entry = "dist/index.js";

  // In production, process.execPath is the Electron exe — we must use system node
  const nodeBin = isDev ? process.execPath : "node";

  backendProcess = spawn(nodeBin, [entry], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(backendPort), NODE_ENV: isDev ? "development" : "production" },
    stdio: "pipe",
    shell: !isDev,
  });

  console.log(`[electron] Starting backend: ${nodeBin} ${entry} in ${backendDir}`);
  backendProcess.stdout?.on("data", (d) => console.log(`[backend] ${d.toString().trim()}`));
  backendProcess.stderr?.on("data", (d) => console.error(`[backend-err] ${d.toString().trim()}`));
  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
    if (mainWindow) app.quit();
  });

  return new Promise((resolve) => {
    const check = setInterval(async () => {
      try {
        await fetch(`http://localhost:${backendPort}/api/health`);
        // Any response means backend is up (even non-200)
        clearInterval(check); resolve();
      } catch {}
    }, 300);
    // Timeout after 30s
    setTimeout(() => { clearInterval(check); resolve(); }, 30000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Mouseketool",
    icon: isDev
      ? path.join(__dirname, "..", "..", "assets", "icon.ico")
      : path.join(process.resourcesPath, "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In production, backend serves the frontend static files
  mainWindow.loadURL(`http://localhost:${backendPort}`).catch(() => {
    mainWindow?.loadURL(`data:text/html,<h1>Backend failed to start</h1><p>Check that port ${backendPort} is free and Node.js is on PATH.</p>`);
  });

  if (isDev || openDevTools) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.on("ready", async () => {
  Menu.setApplicationMenu(null);

  ipcMain.on("set-title-bar-overlay", (_event, options) => {
    if (mainWindow) {
      try { mainWindow.setTitleBarOverlay(options); } catch {}
    }
  });

  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window-close", () => mainWindow?.close());

  backendPort = await findFreePort(3001);
  console.log(`[electron] Using port ${backendPort}`);
  await startBackend();
  createWindow();
});

function killBackend() {
  if (backendProcess?.pid) {
    try { execSync(`taskkill /PID ${backendProcess.pid} /T /F`, { stdio: "ignore" }); } catch {}
  }
}

app.on("window-all-closed", () => {
  killBackend();
  app.quit();
});

app.on("before-quit", () => {
  killBackend();
});
