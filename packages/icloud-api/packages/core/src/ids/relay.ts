/**
 * Validation Data Relay Client — fetches IDS validation-data from a Mac relay server.
 *
 * The relay runs on macOS and generates validation-data via NAC APIs.
 * This client connects to it over HTTP to obtain the data for IDS registration.
 *
 * Reference: docs/RESEARCH_ALBERT_APNS_2026-02-27.md (NAC section)
 * Reference: docs/research/PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md
 */

export interface RelayConfig {
  /** URL of the Mac relay server (e.g. "http://relay-mac.local:8080"). */
  serverUrl: string;
  /** Optional bearer token for authentication. */
  authToken?: string;
}

/**
 * Fetch validation-data from the relay server.
 * Returns the raw binary blob needed for id-register.
 */
export async function fetchValidationData(config: RelayConfig): Promise<Buffer> {
  const url = `${config.serverUrl.replace(/\/$/, '')}/generate`;
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
  };
  if (config.authToken) {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  const res = await fetch(url, { method: 'POST', headers });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Relay server error: ${res.status} ${res.statusText} — ${body}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await res.json() as { error?: string; data?: string };
    if (json.error) {
      throw new Error(`Relay server returned error: ${json.error}`);
    }
    if (json.data) {
      return Buffer.from(json.data, 'base64');
    }
    throw new Error('Relay server returned empty JSON response');
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Check if the relay server is reachable and healthy.
 */
export async function checkRelayHealth(config: RelayConfig): Promise<{ ok: boolean; platform?: string }> {
  try {
    const url = `${config.serverUrl.replace(/\/$/, '')}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false };
    const data = await res.json() as { status: string; platform?: string };
    return { ok: data.status === 'ok', platform: data.platform };
  } catch {
    return { ok: false };
  }
}
