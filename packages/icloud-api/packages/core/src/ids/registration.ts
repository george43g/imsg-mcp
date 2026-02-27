/**
 * IDS Registration — register device keys and capabilities with Apple's IDS.
 *
 * Sends an id-register POST with device info, encryption keys, validation-data,
 * and service capabilities. Returns an IDS identity certificate for lookups.
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md section 4
 * Reference: docs/research/PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md
 */

import type { IDSRegistrationConfig, IDSRegistrationResult, IDSBagURLs } from './types.js';
import { signIDSRequest } from './signing.js';

/**
 * Register this device with IDS.
 *
 * The registration plist includes:
 * - device-name, hardware-version, os-version, software-version
 * - validation-data (from Mac relay or emulation)
 * - services array (com.apple.madrid + sub-services)
 * - users array with public keys and URIs
 */
export async function registerWithIDS(
  config: IDSRegistrationConfig,
  bagUrls: IDSBagURLs,
  encryptionKeys: { publicIdentityKey: Buffer },
): Promise<IDSRegistrationResult> {
  const bodyPlist = buildRegistrationPlist(config, encryptionKeys);
  const bodyGzipped = await gzipBuffer(bodyPlist);

  // Sign with both push and auth certs
  const { headers: pushHeaders } = signIDSRequest({
    prefix: 'push',
    privateKeyPem: config.pushPrivateKey,
    certificate: Buffer.from(config.pushCert, 'utf-8'),
    fields: [
      Buffer.from('id-register'),
      Buffer.alloc(0),
      bodyGzipped,
      config.pushToken,
    ],
  });

  const { headers: authHeaders } = signIDSRequest({
    prefix: 'auth-0',
    privateKeyPem: config.authPrivateKey,
    certificate: config.authCert,
    fields: [
      Buffer.from('id-register'),
      Buffer.alloc(0),
      bodyGzipped,
      config.pushToken,
    ],
  });

  const res = await fetch(bagUrls.register, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-apple-plist',
      'Content-Encoding': 'gzip',
      'Accept-Encoding': 'gzip',
      'User-Agent': 'com.apple.invitation-registration [macOS,14.3,23D60,MacBookPro18,1]',
      'x-protocol-version': '1640',
      'x-auth-user-id-0': config.userId,
      'x-push-token': config.pushToken.toString('base64'),
      ...pushHeaders,
      ...authHeaders,
    },
    body: bodyGzipped,
  });

  if (!res.ok) {
    throw new Error(`IDS registration failed: ${res.status} ${res.statusText}`);
  }

  const responseData = await res.arrayBuffer();
  return parseRegistrationResponse(Buffer.from(responseData));
}

function buildRegistrationPlist(
  config: IDSRegistrationConfig,
  keys: { publicIdentityKey: Buffer },
): Buffer {
  const uriEntries = config.userHandles
    .map(h => `\t\t\t\t\t<dict>\n\t\t\t\t\t\t<key>uri</key>\n\t\t\t\t\t\t<string>${escapeXml(h)}</string>\n\t\t\t\t\t</dict>`)
    .join('\n');

  const identityKeyBase64 = keys.publicIdentityKey.toString('base64');
  const validationDataBase64 = config.validationData.toString('base64');
  const pushTokenBase64 = config.pushToken.toString('base64');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>device-name</key>
\t<string>${escapeXml(config.deviceName)}</string>
\t<key>hardware-version</key>
\t<string>${escapeXml(config.hardwareVersion)}</string>
\t<key>language</key>
\t<string>en-US</string>
\t<key>os-version</key>
\t<string>macOS,${escapeXml(config.osVersion)},${escapeXml(config.buildNumber)}</string>
\t<key>retry-count</key>
\t<integer>0</integer>
\t<key>services</key>
\t<array>
\t\t<dict>
\t\t\t<key>capabilities</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>flags</key>
\t\t\t\t\t<integer>17</integer>
\t\t\t\t\t<key>name</key>
\t\t\t\t\t<string>Messenger</string>
\t\t\t\t\t<key>version</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t</dict>
\t\t\t</array>
\t\t\t<key>service</key>
\t\t\t<string>com.apple.madrid</string>
\t\t\t<key>sub-services</key>
\t\t\t<array>
\t\t\t\t<string>com.apple.private.alloy.sms</string>
\t\t\t\t<string>com.apple.private.alloy.gelato</string>
\t\t\t\t<string>com.apple.private.alloy.biz</string>
\t\t\t\t<string>com.apple.private.alloy.gamecenter.imessage</string>
\t\t\t</array>
\t\t\t<key>users</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>client-data</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>public-message-identity-key</key>
\t\t\t\t\t\t<data>${identityKeyBase64}</data>
\t\t\t\t\t\t<key>ec-version</key>
\t\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t\t<key>kt-version</key>
\t\t\t\t\t\t<integer>5</integer>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>uris</key>
\t\t\t\t\t<array>
${uriEntries}
\t\t\t\t\t</array>
\t\t\t\t\t<key>user-id</key>
\t\t\t\t\t<string>${escapeXml(config.userId)}</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t</dict>
\t</array>
\t<key>software-version</key>
\t<string>${escapeXml(config.buildNumber)}</string>
\t<key>validation-data</key>
\t<data>${validationDataBase64}</data>
</dict>
</plist>`;

  return Buffer.from(xml, 'utf-8');
}

function parseRegistrationResponse(data: Buffer): IDSRegistrationResult {
  const text = data.toString('utf-8');

  const certMatch = text.match(/<key>cert<\/key>\s*<data>\s*([\s\S]*?)\s*<\/data>/);
  const statusMatch = text.match(/<key>status<\/key>\s*<integer>(\d+)<\/integer>/);
  const uriPattern = /<key>uri<\/key>\s*<string>([^<]+)<\/string>\s*<key>status<\/key>\s*<integer>(\d+)<\/integer>/g;

  const certB64 = certMatch?.[1]?.replace(/\s/g, '') ?? '';
  const idsCert = certB64 ? Buffer.from(certB64, 'base64') : Buffer.alloc(0);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : -1;

  const uris: { uri: string; status: number }[] = [];
  let um: RegExpExecArray | null;
  while ((um = uriPattern.exec(text)) !== null) {
    uris.push({ uri: um[1], status: parseInt(um[2], 10) });
  }

  return { idsCert, uris, status };
}

async function gzipBuffer(data: Buffer): Promise<Buffer> {
  const { gzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  return promisify(gzip)(data);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
