import { request } from "@playwright/test";

export default async function globalSetup() {
  const api = await request.newContext({ baseURL: "http://localhost:3001" });

  // Check if LocalStack is already running
  const status = await api.get("/api/localstack/status").catch(() => null);
  const data = status ? await status.json() : null;

  if (data?.status !== "running") {
    console.log("[setup] Starting managed LocalStack instance...");
    await api.post("/api/localstack/start");
    // Wait for it to be ready
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const check = await api.get("/api/localstack/status").catch(() => null);
      const s = check ? await check.json() : null;
      if (s?.status === "running") { console.log("[setup] LocalStack ready."); break; }
    }
  } else {
    console.log("[setup] LocalStack already running.");
  }

  await api.dispose();
}
