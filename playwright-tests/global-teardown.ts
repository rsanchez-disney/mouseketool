import { request } from "@playwright/test";

export default async function globalTeardown() {
  const api = await request.newContext({ baseURL: "http://localhost:3001" });
  try {
    const res = await api.get("/api/builds");
    const builds = await res.json();
    const testBuilds = builds.filter((b: any) => b.projectName === "sample-lambda");
    for (const b of testBuilds) {
      await api.delete(`/api/builds/${b.id}`);
    }
    if (testBuilds.length) console.log(`[teardown] Cleaned up ${testBuilds.length} test build(s).`);
  } catch {}
  await api.dispose();
}
