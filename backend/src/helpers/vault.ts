const DEFAULT_HEADERS = (token: string) => ({
  "X-Vault-Token": token,
  "Content-Type": "application/json",
});

const normalizeUrl = (url: string) => url.replace(/\/+$/, "");

export async function testConnection(url: string, token: string): Promise<{ ok: boolean; message: string }> {
  const base = normalizeUrl(url);
  try {
    const res = await fetch(`${base}/v1/auth/token/lookup-self`, { headers: DEFAULT_HEADERS(token), signal: AbortSignal.timeout(5000) });
    if (res.ok) return { ok: true, message: "Connected and authenticated" };
    if (res.status === 403) return { ok: false, message: "Token is invalid or expired" };
    const body = await res.json().catch(() => ({}));
    return { ok: false, message: body.errors?.[0] || `Vault responded with ${res.status}` };
  } catch (e: any) {
    return { ok: false, message: e.name === "TimeoutError" ? "Connection timed out" : e.message };
  }
}

// Detect KV version for the "secret/" mount, enable KV v1 if missing
async function ensureSecretMount(url: string, token: string): Promise<number> {
  const base = normalizeUrl(url);
  try {
    const headers = DEFAULT_HEADERS(token);
    const res = await fetch(`${base}/v1/sys/mounts`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) { console.log(`[vault] /sys/mounts returned ${res.status}`); return 2; }
    const mounts = await res.json();
    const secretMount = mounts["secret/"];
    if (secretMount?.type) {
      const v = Number(secretMount.options?.version) || 2;
      console.log(`[vault] secret/ mount found, version=${v}`);
      return v;
    }
    console.log(`[vault] secret/ mount not found, creating KV v1...`);
    const createRes = await fetch(`${base}/v1/sys/mounts/secret`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "kv", options: { version: "1" } }),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`[vault] create mount response: ${createRes.status}`);
    return 1;
  } catch (e: any) { console.log(`[vault] ensureSecretMount error: ${e.message}`); return 2; }
}

export interface SecretResult { path: string; created: boolean; skipped: boolean; existed: boolean; error?: string }

// User enters path like "dummy/secret" (relative to the secret/ mount).
// For KV v1: POST /v1/secret/dummy/secret with flat payload
// For KV v2: POST /v1/secret/data/dummy/secret with { data: payload }
export async function setupSecrets(url: string, token: string, secrets: { path: string; value: string }[]): Promise<SecretResult[]> {
  const base = normalizeUrl(url);
  const version = await ensureSecretMount(url, token);
  const results: SecretResult[] = [];

  for (const s of secrets) {
    try {
      const apiPath = version === 1
        ? `${base}/v1/secret/${s.path}`
        : `${base}/v1/secret/data/${s.path}`;

      // Check if secret already exists
      const existing = await fetch(apiPath, { headers: DEFAULT_HEADERS(token), signal: AbortSignal.timeout(5000) });
      if (existing.ok) {
        console.log(`[vault] secret already exists at ${s.path}, skipping`);
        results.push({ path: s.path, created: false, skipped: true, existed: true });
        continue;
      }

      let payload: Record<string, unknown>;
      try { payload = JSON.parse(s.value); } catch { payload = { value: s.value }; }

      const body = version === 1
        ? JSON.stringify(payload)
        : JSON.stringify({ data: payload });

      console.log(`[vault] writing to ${apiPath} (KV v${version})`);
      const res = await fetch(apiPath, {
        method: "POST",
        headers: DEFAULT_HEADERS(token),
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok || res.status === 204) {
        results.push({ path: s.path, created: true, skipped: false, existed: false });
      } else {
        const b = await res.json().catch(() => ({}));
        results.push({ path: s.path, created: false, skipped: false, existed: false, error: b.errors?.[0] || `Status ${res.status}` });
      }
    } catch (e: any) {
      results.push({ path: s.path, created: false, skipped: false, existed: false, error: e.message });
    }
  }
  return results;
}

export async function cleanupSecrets(url: string, token: string, paths: string[]): Promise<{ path: string; deleted: boolean; error?: string }[]> {
  const base = normalizeUrl(url);
  const version = await ensureSecretMount(url, token);
  const results = [];
  for (const path of paths) {
    try {
      const apiPath = version === 1
        ? `${base}/v1/secret/${path}`
        : `${base}/v1/secret/metadata/${path}`;
      const res = await fetch(apiPath, { method: "DELETE", headers: DEFAULT_HEADERS(token), signal: AbortSignal.timeout(5000) });
      results.push({ path, deleted: res.ok || res.status === 204 });
    } catch (e: any) {
      results.push({ path, deleted: false, error: e.message });
    }
  }
  return results;
}
