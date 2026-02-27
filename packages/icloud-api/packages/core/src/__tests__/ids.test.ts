import { describe, it, expect } from 'vitest';
import {
  buildIDSNonce,
  buildSigningPayload,
  signPayload,
  buildSigningHeaders,
  signIDSRequest,
  computeCommonName,
  generateIDSKeyPair,
  getDefaultBag,
  BAG_URL,
} from '../ids/index.js';

describe('IDS Signing', () => {
  describe('buildIDSNonce', () => {
    it('produces 17-byte nonce with correct protocol type', () => {
      const nonce = buildIDSNonce(0x01);
      expect(nonce.length).toBe(17);
      expect(nonce[0]).toBe(0x01);
    });

    it('supports APNs protocol type (0x00)', () => {
      const nonce = buildIDSNonce(0x00);
      expect(nonce[0]).toBe(0x00);
    });

    it('produces unique nonces', () => {
      const a = buildIDSNonce();
      const b = buildIDSNonce();
      expect(a.equals(b)).toBe(false);
    });

    it('timestamp is rounded to seconds', () => {
      const nonce = buildIDSNonce();
      const ts = nonce.readBigUInt64BE(1);
      expect(Number(ts) % 1000).toBe(0);
    });
  });

  describe('buildSigningPayload', () => {
    it('concatenates nonce + length-prefixed fields', () => {
      const nonce = Buffer.alloc(17, 0x01);
      const field1 = Buffer.from('hello');
      const field2 = Buffer.from('world');

      const payload = buildSigningPayload(nonce, [field1, field2]);

      // nonce(17) + len(4) + field1(5) + len(4) + field2(5) = 35
      expect(payload.length).toBe(35);
      expect(payload.subarray(0, 17)).toEqual(nonce);
      expect(payload.readUInt32BE(17)).toBe(5);
      expect(payload.subarray(21, 26).toString()).toBe('hello');
      expect(payload.readUInt32BE(26)).toBe(5);
      expect(payload.subarray(30, 35).toString()).toBe('world');
    });

    it('handles empty fields', () => {
      const nonce = Buffer.alloc(17, 0x02);
      const payload = buildSigningPayload(nonce, [Buffer.alloc(0)]);
      expect(payload.length).toBe(21);
      expect(payload.readUInt32BE(17)).toBe(0);
    });
  });

  describe('signPayload', () => {
    it('produces a signature prefixed with 0x01 0x01', () => {
      const { privateKey } = generateIDSKeyPair();
      const payload = Buffer.from('test data to sign');
      const sig = signPayload(payload, privateKey);

      expect(sig[0]).toBe(0x01);
      expect(sig[1]).toBe(0x01);
      expect(sig.length).toBeGreaterThan(2);
    });
  });

  describe('buildSigningHeaders', () => {
    it('produces base64-encoded headers with correct prefixes', () => {
      const nonce = Buffer.from('testnonce12345678', 'utf-8').subarray(0, 17);
      const signature = Buffer.from('testsig');
      const certificate = Buffer.from('testcert');

      const headers = buildSigningHeaders({
        prefix: 'auth',
        nonce,
        signature,
        certificate,
      });

      expect(headers['x-auth-nonce']).toBe(nonce.toString('base64'));
      expect(headers['x-auth-sig']).toBe(signature.toString('base64'));
      expect(headers['x-auth-cert']).toBe(certificate.toString('base64'));
    });

    it('supports push prefix', () => {
      const headers = buildSigningHeaders({
        prefix: 'push',
        nonce: Buffer.alloc(17),
        signature: Buffer.alloc(4),
        certificate: Buffer.alloc(4),
      });
      expect(headers).toHaveProperty('x-push-nonce');
      expect(headers).toHaveProperty('x-push-sig');
      expect(headers).toHaveProperty('x-push-cert');
    });
  });

  describe('signIDSRequest', () => {
    it('returns headers and nonce in one call', () => {
      const { privateKey } = generateIDSKeyPair();
      const cert = Buffer.from('fake-cert');
      const result = signIDSRequest({
        prefix: 'id',
        privateKeyPem: privateKey,
        certificate: cert,
        fields: [Buffer.from('test-field')],
      });

      expect(result.nonce).toHaveLength(17);
      expect(result.headers).toHaveProperty('x-id-nonce');
      expect(result.headers).toHaveProperty('x-id-sig');
      expect(result.headers).toHaveProperty('x-id-cert');
    });
  });
});

describe('IDS Authentication', () => {
  describe('computeCommonName', () => {
    it('returns uppercase hex SHA-1 of user ID', () => {
      const cn = computeCommonName('test@icloud.com');
      expect(cn).toMatch(/^[0-9A-F]{40}$/);
      expect(cn.length).toBe(40);
    });

    it('is deterministic', () => {
      expect(computeCommonName('user@example.com')).toBe(computeCommonName('user@example.com'));
    });

    it('different inputs produce different CNs', () => {
      expect(computeCommonName('a@b.com')).not.toBe(computeCommonName('c@d.com'));
    });
  });

  describe('generateIDSKeyPair', () => {
    it('generates 2048-bit RSA key pair in PEM format', () => {
      const { publicKey, privateKey } = generateIDSKeyPair();
      expect(publicKey).toContain('BEGIN PUBLIC KEY');
      expect(privateKey).toContain('BEGIN PRIVATE KEY');
    });

    it('generates unique key pairs each time', () => {
      const a = generateIDSKeyPair();
      const b = generateIDSKeyPair();
      expect(a.publicKey).not.toBe(b.publicKey);
    });
  });
});

describe('IDS Bag', () => {
  describe('getDefaultBag', () => {
    it('returns a bag with all required URLs', () => {
      const bag = getDefaultBag();
      expect(bag.urls.authenticateDsId).toContain('https://');
      expect(bag.urls.register).toContain('https://');
      expect(bag.urls.getHandles).toContain('https://');
      expect(bag.urls.query).toContain('https://');
    });
  });

  it('has correct BAG_URL constant', () => {
    expect(BAG_URL).toBe('https://init.ess.apple.com/WebObjects/VCInit.woa/wa/getBag?ix=3');
  });
});
