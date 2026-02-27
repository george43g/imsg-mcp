/**
 * IDS request signing — nonce generation, payload construction, and PKCS1-SHA1 signatures.
 *
 * Every IDS request (auth, registration, lookup) must be signed with
 * a nonce + payload + certificate. The signature is PKCS1-SHA1 RSA.
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md section 3
 * Reference: docs/research/PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md
 */

import { randomBytes, sign } from 'node:crypto';

/**
 * Build a 17-byte IDS nonce.
 *
 * Format: [protocol_type:1] [timestamp_ms_rounded:8BE] [random:8]
 * protocol_type: 0x01 = HTTP, 0x00 = APNs
 */
export function buildIDSNonce(protocolType: 0x00 | 0x01 = 0x01): Buffer {
  const nonce = Buffer.alloc(17);
  nonce.writeUInt8(protocolType, 0);

  const nowMs = BigInt(Math.floor(Date.now() / 1000) * 1000);
  nonce.writeBigUInt64BE(nowMs, 1);
  randomBytes(8).copy(nonce, 9);
  return nonce;
}

/**
 * Build the signing payload from nonce + data fields.
 *
 * Each field is prefixed with its BE 32-bit length.
 * Fields in order for HTTP: bag_key, query_string, payload_body, push_token.
 */
export function buildSigningPayload(
  nonce: Buffer,
  fields: Buffer[],
): Buffer {
  const parts: Buffer[] = [nonce];
  for (const field of fields) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(field.length, 0);
    parts.push(lenBuf, field);
  }
  return Buffer.concat(parts);
}

/**
 * Sign a payload using PKCS1-SHA1 RSA.
 * Returns the signature prefixed with [0x01, 0x01] per Apple protocol.
 */
export function signPayload(payload: Buffer, privateKeyPem: string): Buffer {
  const sig = sign('sha1', payload, { key: privateKeyPem, padding: 1 });
  return Buffer.concat([Buffer.from([0x01, 0x01]), sig]);
}

/**
 * Build the IDS signing headers for a request.
 *
 * Returns headers: x-{prefix}-nonce, x-{prefix}-sig, x-{prefix}-cert
 * All values are base64 encoded.
 */
export function buildSigningHeaders(opts: {
  /** Signing prefix ('auth', 'push', 'id'). */
  prefix: string;
  /** Nonce (17 bytes). */
  nonce: Buffer;
  /** Signature (2-byte prefix + RSA signature). */
  signature: Buffer;
  /** DER-encoded certificate. */
  certificate: Buffer;
}): Record<string, string> {
  return {
    [`x-${opts.prefix}-nonce`]: opts.nonce.toString('base64'),
    [`x-${opts.prefix}-sig`]: opts.signature.toString('base64'),
    [`x-${opts.prefix}-cert`]: opts.certificate.toString('base64'),
  };
}

/**
 * Sign an IDS request and return all required signing headers.
 *
 * This combines nonce generation, payload construction, signing, and header formatting.
 */
export function signIDSRequest(opts: {
  prefix: string;
  privateKeyPem: string;
  certificate: Buffer;
  /** Data fields to sign (bag_key, query_string, body, push_token). */
  fields: Buffer[];
  protocolType?: 0x00 | 0x01;
}): { headers: Record<string, string>; nonce: Buffer } {
  const nonce = buildIDSNonce(opts.protocolType ?? 0x01);
  const payload = buildSigningPayload(nonce, opts.fields);
  const signature = signPayload(payload, opts.privateKeyPem);
  const headers = buildSigningHeaders({
    prefix: opts.prefix,
    nonce,
    signature,
    certificate: opts.certificate,
  });
  return { headers, nonce };
}
