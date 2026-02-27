/**
 * IDS (Identity Services) — keyserver, registration, and key lookup.
 *
 * Phase 2 implementation. This module will handle:
 * - IDS authentication (CSR generation, auth cert exchange)
 * - Device registration (id-register with validation-data)
 * - Recipient key lookup (id-query)
 * - Session token management
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md
 */

export interface IDSRegistrationConfig {
  authCert: Buffer;
  pushToken: Buffer;
  validationData: Buffer;
  deviceName: string;
  hardwareVersion: string;
  osVersion: string;
  buildNumber: string;
}

export interface IDSIdentity {
  pushToken: Buffer;
  publicKey: Buffer;
  sessionToken: Buffer;
  clientData: Record<string, unknown>;
}

export interface IDSLookupResult {
  uri: string;
  identities: IDSIdentity[];
}

// Phase 2: Full IDS registration and lookup will be implemented here.
// The protocol is documented in docs/IDS_IDENTITY_SERVICES_RESEARCH.md
// and on https://theapplewiki.com/wiki/Identity_Services
