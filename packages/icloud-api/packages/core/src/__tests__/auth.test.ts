import { describe, it, expect } from 'vitest';
import {
  buildCPD,
  derivePasswordKey,
  buildInitBody,
  buildCompleteBody,
  GSA_ENDPOINT,
} from '../auth/gsa.js';
import { RemoteAnisetteProvider, StaticAnisetteProvider } from '../auth/anisette.js';
import type { AnisetteData } from '../auth/types.js';

const MOCK_ANISETTE: AnisetteData = {
  'X-Apple-I-MD': 'dGVzdC1vdHA=',
  'X-Apple-I-MD-M': 'dGVzdC1tYWNoaW5l',
  'X-Apple-I-MD-RINFO': '17106176',
};

describe('GSA Authentication', () => {
  it('GSA endpoint is correct', () => {
    expect(GSA_ENDPOINT).toBe('https://gsa.apple.com/grandslam/GsService2');
  });

  describe('buildCPD', () => {
    it('includes anisette data and timestamps', () => {
      const cpd = buildCPD(MOCK_ANISETTE);
      expect(cpd['X-Apple-I-MD']).toBe(MOCK_ANISETTE['X-Apple-I-MD']);
      expect(cpd['X-Apple-I-MD-M']).toBe(MOCK_ANISETTE['X-Apple-I-MD-M']);
      expect(cpd['X-Apple-I-MD-RINFO']).toBe('17106176');
      expect(cpd['bootstrap-protocol']).toBe('SRP');
      expect(cpd['X-Apple-I-Client-Time']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('derivePasswordKey', () => {
    it('derives a 32-byte key with s2k protocol', () => {
      const salt = Buffer.from('test-salt');
      const key = derivePasswordKey('password123', salt, 1000, 's2k');
      expect(key.length).toBe(32);
    });

    it('derives a different key with s2k_fo protocol', () => {
      const salt = Buffer.from('test-salt');
      const keyS2k = derivePasswordKey('password123', salt, 1000, 's2k');
      const keyS2kFo = derivePasswordKey('password123', salt, 1000, 's2k_fo');
      expect(keyS2k.length).toBe(32);
      expect(keyS2kFo.length).toBe(32);
      expect(keyS2k.equals(keyS2kFo)).toBe(false);
    });

    it('is deterministic', () => {
      const salt = Buffer.from('consistent-salt');
      const key1 = derivePasswordKey('mypass', salt, 2000, 's2k');
      const key2 = derivePasswordKey('mypass', salt, 2000, 's2k');
      expect(key1.equals(key2)).toBe(true);
    });
  });

  describe('buildInitBody', () => {
    it('produces valid XML plist with username and A2k', () => {
      const a2k = Buffer.from('fake-public-key');
      const cpd = buildCPD(MOCK_ANISETTE);
      const body = buildInitBody('test@icloud.com', a2k, cpd);

      expect(body).toContain('<?xml version="1.0"');
      expect(body).toContain('<key>o</key>');
      expect(body).toContain('<string>init</string>');
      expect(body).toContain('<key>u</key>');
      expect(body).toContain('test@icloud.com');
      expect(body).toContain('<key>A2k</key>');
      expect(body).toContain('<key>ps</key>');
      expect(body).toContain('<string>s2k</string>');
      expect(body).toContain('<string>s2k_fo</string>');
    });

    it('escapes XML special characters in username', () => {
      const a2k = Buffer.from('key');
      const cpd = buildCPD(MOCK_ANISETTE);
      const body = buildInitBody('user<>&"@test.com', a2k, cpd);
      expect(body).toContain('user&lt;&gt;&amp;&quot;@test.com');
    });
  });

  describe('buildCompleteBody', () => {
    it('produces valid XML plist with M1 and challenge', () => {
      const m1 = Buffer.from('client-proof');
      const cpd = buildCPD(MOCK_ANISETTE);
      const body = buildCompleteBody(m1, 'challenge-string', 'test@icloud.com', cpd);

      expect(body).toContain('<key>o</key>');
      expect(body).toContain('<string>complete</string>');
      expect(body).toContain('<key>M1</key>');
      expect(body).toContain('<key>c</key>');
      expect(body).toContain('challenge-string');
    });
  });
});

describe('Anisette Providers', () => {
  describe('StaticAnisetteProvider', () => {
    it('returns the static data', async () => {
      const provider = new StaticAnisetteProvider(MOCK_ANISETTE);
      const data = await provider.getAnisetteData();
      expect(data).toEqual(MOCK_ANISETTE);
    });
  });

  describe('RemoteAnisetteProvider', () => {
    it('constructs with a server URL', () => {
      const provider = new RemoteAnisetteProvider('http://localhost:6969');
      expect(provider).toBeDefined();
    });
  });
});
