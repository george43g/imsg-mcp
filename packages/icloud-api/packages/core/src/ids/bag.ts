/**
 * IDS Bag — fetch service configuration/URLs from Apple's init server.
 *
 * The bag is a signed plist containing all IDS endpoint URLs.
 * Endpoint: https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3
 *
 * Reference: docs/research/IDS_BAG_ENDPOINT_RESEARCH.md
 */

import type { IDSBag, IDSBagURLs } from './types.js';

const BAG_URL = 'https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3';

const BAG_HEADERS = {
  'User-Agent': 'com.apple.invitation-registration [macOS,14.3,23D60,MacBookPro18,1]',
  Accept: '*/*',
};

const DEFAULT_BAG_URLS: IDSBagURLs = {
  authenticateDsId: 'https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticateDS',
  authenticatePhoneNumber: 'https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/authenticatePhoneNumber',
  register: 'https://identity.ess.apple.com/WebObjects/TDIdentityService.woa/wa/register',
  getHandles: 'https://profile.ess.apple.com/WebObjects/VCProfileService.woa/wa/getHandles',
  query: 'https://query.ess.apple.com/WebObjects/QueryService.woa/wa/query',
  queryByService: 'https://query.ess.apple.com/WebObjects/QueryService.woa/wa/queryByService',
};

/**
 * Known bag key -> IDSBagURLs field mapping.
 * Bag keys are short identifiers; values are full URLs.
 */
const BAG_KEY_MAP: Record<string, keyof IDSBagURLs> = {
  'id-authenticate-ds-id': 'authenticateDsId',
  'id-authenticate-phone-number': 'authenticatePhoneNumber',
  'id-register': 'register',
  'id-get-handles': 'getHandles',
  'id-query': 'query',
  'id-query-by-service': 'queryByService',
};

/**
 * Fetch the IDS bag from Apple's init server.
 * Falls back to hardcoded defaults if the fetch fails.
 */
export async function fetchBag(): Promise<IDSBag> {
  try {
    const res = await fetch(BAG_URL, { headers: BAG_HEADERS });
    if (!res.ok) {
      throw new Error(`Bag fetch failed: ${res.status}`);
    }

    const raw = await parseBagResponse(await res.arrayBuffer());
    const urls = extractURLs(raw);
    return { raw, urls };
  } catch {
    return { raw: {}, urls: { ...DEFAULT_BAG_URLS } };
  }
}

/**
 * Return the hardcoded default bag URLs (for offline/testing use).
 */
export function getDefaultBag(): IDSBag {
  return { raw: {}, urls: { ...DEFAULT_BAG_URLS } };
}

async function parseBagResponse(data: ArrayBuffer): Promise<Record<string, unknown>> {
  // The bag response is a signed plist. The outer plist contains:
  //   bag: <data> (inner plist with actual URLs)
  //   certs: <array>
  //   signature: <data>
  // For now, attempt basic XML plist extraction.
  const text = new TextDecoder().decode(data);
  const result: Record<string, unknown> = {};

  // Extract URL values from plist key-string pairs
  const pattern = /<key>([^<]+)<\/key>\s*<string>([^<]+)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    result[m[1]] = m[2];
  }

  return result;
}

function extractURLs(raw: Record<string, unknown>): IDSBagURLs {
  const urls = { ...DEFAULT_BAG_URLS };

  for (const [bagKey, urlField] of Object.entries(BAG_KEY_MAP)) {
    const value = raw[bagKey];
    if (typeof value === 'string' && value.startsWith('http')) {
      urls[urlField] = value;
    }
  }

  return urls;
}

export { BAG_URL };
