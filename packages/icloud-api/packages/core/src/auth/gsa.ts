/**
 * GrandSlam Authentication (GSA) — SRP-6a with Apple's iCloud services.
 *
 * Protocol: POST to https://gsa.apple.com/grandslam/GsService2
 * Format: XML plist request/response
 * SRP: 2048-bit group, SHA-256, PBKDF2 password derivation
 *
 * Reference: docs/GRANDSLAM_GSA_RESEARCH.md
 */

import { createHash, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import type {
  AnisetteData,
  AuthConfig,
  AuthSession,
  GSASessionData,
} from './types.js';

const GSA_ENDPOINT = 'https://gsa.apple.com/grandslam/GsService2';

const GSA_HEADERS = {
  'Content-Type': 'text/x-xml-plist',
  Accept: '*/*',
  'User-Agent': 'akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0',
};

/**
 * Build the "cpd" (Client Proof Data) dictionary from anisette data.
 * Contains device info, timestamps, and anisette OTPs.
 */
export function buildCPD(anisette: AnisetteData): Record<string, string> {
  const now = new Date();
  return {
    'bootstrap-protocol': 'SRP',
    'X-Apple-I-Client-Time': now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'X-Apple-I-TimeZone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'X-Apple-Locale': 'en_US',
    'X-Apple-I-MD': anisette['X-Apple-I-MD'],
    'X-Apple-I-MD-M': anisette['X-Apple-I-MD-M'],
    'X-Apple-I-MD-RINFO': anisette['X-Apple-I-MD-RINFO'],
  };
}

/**
 * Derive the password key from Apple ID password using the server-selected protocol.
 *
 * s2k:    PBKDF2(SHA256(password),         salt, iterations, 32)
 * s2k_fo: PBKDF2(SHA256(password).hex(),   salt, iterations, 32)
 */
export function derivePasswordKey(
  password: string,
  salt: Buffer,
  iterations: number,
  protocol: string,
): Buffer {
  const passHash = createHash('sha256').update(password, 'utf8').digest();

  let input: Buffer;
  if (protocol === 's2k_fo') {
    input = Buffer.from(passHash.toString('hex'), 'utf8');
  } else {
    input = passHash;
  }

  return pbkdf2Sync(input, salt, iterations, 32, 'sha256');
}

/**
 * Decrypt the GSA spd (session payload data) using the SRP session key.
 * The session key is used to derive an AES-CBC decryption key via HMAC.
 */
export function decryptSessionData(
  spd: Buffer,
  sessionKey: Buffer,
): GSASessionData {
  const spdKey = createHash('sha256')
    .update(Buffer.concat([Buffer.from('extra data key:'), sessionKey]))
    .digest();
  const spdIv = createHash('sha256')
    .update(Buffer.concat([Buffer.from('extra data iv:'), sessionKey]))
    .digest()
    .subarray(0, 16);

  const decipher = createDecipheriv('aes-256-cbc', spdKey, spdIv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(spd), decipher.final()]);

  // The decrypted payload is a binary plist; parse it
  // For now return a placeholder — full plist parsing in integration
  return parsePlistBuffer(decrypted);
}

function parsePlistBuffer(buf: Buffer): GSASessionData {
  // Minimal plist extraction — the real implementation will use the `plist` package.
  // For now, attempt to find known keys in the raw buffer as a bootstrapping step.
  const str = buf.toString('utf8');
  const extract = (key: string): string | undefined => {
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`);
    const m = str.match(pattern);
    return m?.[1];
  };

  return {
    aDsID: extract('aDsID') ?? '',
    idmsToken: extract('idms-token'),
    GsIdmsToken: extract('GsIdmsToken'),
    authToken: extract('t')?.slice(0, 200),
    acname: extract('acname'),
  };
}

/**
 * Build a GSA init request plist body.
 */
export function buildInitBody(
  username: string,
  aPublic: Buffer,
  cpd: Record<string, string>,
): string {
  const a2kBase64 = aPublic.toString('base64');
  const cpdEntries = Object.entries(cpd)
    .map(([k, v]) => `\t\t<key>${escapeXml(k)}</key>\n\t\t<string>${escapeXml(v)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>A2k</key>
\t<data>${a2kBase64}</data>
\t<key>cpd</key>
\t<dict>
${cpdEntries}
\t</dict>
\t<key>o</key>
\t<string>init</string>
\t<key>ps</key>
\t<array>
\t\t<string>s2k</string>
\t\t<string>s2k_fo</string>
\t</array>
\t<key>u</key>
\t<string>${escapeXml(username)}</string>
</dict>
</plist>`;
}

/**
 * Build a GSA complete request plist body.
 */
export function buildCompleteBody(
  m1: Buffer,
  challenge: string,
  username: string,
  cpd: Record<string, string>,
): string {
  const m1Base64 = m1.toString('base64');
  const cpdEntries = Object.entries(cpd)
    .map(([k, v]) => `\t\t<key>${escapeXml(k)}</key>\n\t\t<string>${escapeXml(v)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>M1</key>
\t<data>${m1Base64}</data>
\t<key>c</key>
\t<string>${escapeXml(challenge)}</string>
\t<key>cpd</key>
\t<dict>
${cpdEntries}
\t</dict>
\t<key>o</key>
\t<string>complete</string>
\t<key>u</key>
\t<string>${escapeXml(username)}</string>
</dict>
</plist>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { GSA_ENDPOINT, GSA_HEADERS };
