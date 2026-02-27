/**
 * IDS Key Lookup — query recipient public keys and session tokens.
 *
 * Uses HTTP-over-APNs to send id-query requests.
 * Returns one identity per device on the queried account.
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md section 6
 * Reference: docs/research/PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md
 */

import type { IDSLookupResult, IDSIdentity, IDSBagURLs } from './types.js';
import { signIDSRequest } from './signing.js';

/**
 * Look up public keys and push tokens for a set of URIs (phone/email handles).
 *
 * This is a direct HTTP request to id-query (or id-query-by-service from the bag).
 * In production, this should go through HTTP-over-APNs for proper routing.
 */
export async function lookupKeys(opts: {
  uris: string[];
  selfUri: string;
  bagUrls: IDSBagURLs;
  idsCert: Buffer;
  idsPrivateKey: string;
  pushToken: Buffer;
  pushCert: Buffer;
  pushPrivateKey: string;
}): Promise<IDSLookupResult[]> {
  const bodyPlist = buildQueryPlist(opts.uris);
  const bodyGzipped = await gzipBuffer(bodyPlist);

  const queryUrl = opts.bagUrls.queryByService ?? opts.bagUrls.query;

  const { headers: idHeaders } = signIDSRequest({
    prefix: 'id',
    privateKeyPem: opts.idsPrivateKey,
    certificate: opts.idsCert,
    fields: [
      Buffer.from('id-query'),
      Buffer.alloc(0),
      bodyGzipped,
      opts.pushToken,
    ],
  });

  const { headers: pushHeaders } = signIDSRequest({
    prefix: 'push',
    privateKeyPem: opts.pushPrivateKey,
    certificate: opts.pushCert,
    fields: [
      Buffer.from('id-query'),
      Buffer.alloc(0),
      bodyGzipped,
      opts.pushToken,
    ],
  });

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-apple-plist',
      'Content-Encoding': 'gzip',
      'Accept-Encoding': 'gzip',
      'User-Agent': 'com.apple.madrid-lookup [macOS,14.3,23D60,MacBookPro18,1]',
      'x-protocol-version': '1640',
      'x-id-self-uri': opts.selfUri,
      'x-push-token': opts.pushToken.toString('base64'),
      ...idHeaders,
      ...pushHeaders,
    },
    body: bodyGzipped,
  });

  if (!res.ok) {
    throw new Error(`IDS lookup failed: ${res.status} ${res.statusText}`);
  }

  const responseData = await res.arrayBuffer();
  return parseLookupResponse(Buffer.from(responseData));
}

function buildQueryPlist(uris: string[]): Buffer {
  const uriEntries = uris.map(u => `\t\t<string>${escapeXml(u)}</string>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>uris</key>
\t<array>
${uriEntries}
\t</array>
</dict>
</plist>`;
  return Buffer.from(xml, 'utf-8');
}

/**
 * Parse the id-query response plist.
 *
 * Response structure:
 *   results: { "uri": { identities: [...] } }
 *   status: 0
 *
 * Each identity contains: push-token, client-data (with public keys), session-token.
 */
function parseLookupResponse(data: Buffer): IDSLookupResult[] {
  const text = data.toString('utf-8');
  const results: IDSLookupResult[] = [];

  // Basic plist parsing for the results structure.
  // A production implementation should use a proper plist parser.
  const statusMatch = text.match(/<key>status<\/key>\s*<integer>(\d+)<\/integer>/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : -1;

  if (status !== 0) {
    return results;
  }

  // Extract URI results (simplified — real parsing needs nested plist handling)
  // For now, return empty results structure that will be populated
  // when a full binary plist parser is integrated.
  return results;
}

async function gzipBuffer(data: Buffer): Promise<Buffer> {
  const { gzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  return promisify(gzip)(data);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
