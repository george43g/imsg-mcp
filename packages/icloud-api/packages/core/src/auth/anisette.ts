/**
 * Anisette data providers.
 *
 * Anisette is device-level authentication metadata required by GSA.
 * Fields: X-Apple-I-MD (OTP, ~30s lifetime), X-Apple-I-MD-M (machine ID), X-Apple-I-MD-RINFO.
 *
 * v1: Simple HTTP server (risk of account locks with shared use)
 * v3: WebSocket provisioning with ADI framework (safer, self-hosted)
 *
 * Reference: docs/GRANDSLAM_GSA_RESEARCH.md section 8-9
 */

import type { AnisetteData, AnisetteProvider } from './types.js';

/**
 * Fetches anisette data from a remote anisette v3 server.
 * Compatible with SideStore/AltStore anisette servers.
 *
 * Default servers:
 *   - Self-hosted Docker: http://localhost:6969
 *   - ani.sidestore.io (public, but shared — use for testing only)
 */
export class RemoteAnisetteProvider implements AnisetteProvider {
  constructor(private serverUrl: string) {}

  async getAnisetteData(): Promise<AnisetteData> {
    const url = this.serverUrl.replace(/\/$/, '');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'akd/1.0' },
    });
    if (!res.ok) {
      throw new Error(`Anisette server error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json() as Record<string, string>;

    const md = data['X-Apple-I-MD'];
    const mdm = data['X-Apple-I-MD-M'];
    if (!md || !mdm) {
      throw new Error('Anisette server returned incomplete data (missing MD or MD-M)');
    }

    return {
      'X-Apple-I-MD': md,
      'X-Apple-I-MD-M': mdm,
      'X-Apple-I-MD-RINFO': data['X-Apple-I-MD-RINFO'] ?? '17106176',
    };
  }
}

/**
 * Static anisette data for testing — NOT for production.
 * Hardcoded values will be rejected by Apple servers.
 */
export class StaticAnisetteProvider implements AnisetteProvider {
  constructor(private data: AnisetteData) {}

  async getAnisetteData(): Promise<AnisetteData> {
    return this.data;
  }
}
