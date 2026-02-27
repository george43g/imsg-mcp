/**
 * Types for Apple Identity Services (IDS).
 *
 * IDS handles device registration, encryption key publication,
 * recipient key lookup, and session token management for iMessage.
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md
 * Reference: docs/research/PYPUSH_IDS_SOURCE_CODE_ANALYSIS.md
 */

export interface IDSRegistrationConfig {
  /** DER-encoded auth certificate from id-authenticate-ds-id. */
  authCert: Buffer;
  /** Private key for the auth certificate (PEM). */
  authPrivateKey: string;
  /** APNs push token (32 bytes). */
  pushToken: Buffer;
  /** Push certificate from Albert (PEM). */
  pushCert: string;
  /** Push private key (PEM). */
  pushPrivateKey: string;
  /** Validation data from Mac relay or emulation. */
  validationData: Buffer;
  deviceName: string;
  hardwareVersion: string;
  osVersion: string;
  buildNumber: string;
  /** User handles (email URIs like "mailto:user@icloud.com"). */
  userHandles: string[];
  /** User ID (DSID). */
  userId: string;
}

export interface IDSIdentity {
  /** APNs push token for this device. */
  pushToken: Buffer;
  /** Public encryption key (RSA 1280-bit + EC P-256 in ASN.1). */
  publicKey: Buffer;
  /** Session token (required to send messages, expires). */
  sessionToken: Buffer;
  /** Client capabilities data. */
  clientData: Record<string, unknown>;
}

export interface IDSLookupResult {
  /** Queried URI (e.g. "mailto:user@icloud.com" or "tel:+1234567890"). */
  uri: string;
  /** One identity per registered device on this account. */
  identities: IDSIdentity[];
}

export interface IDSHandle {
  uri: string;
  status: number;
}

export interface IDSAuthResult {
  /** DER-encoded auth certificate. */
  cert: Buffer;
  status: number;
}

export interface IDSRegistrationResult {
  /** DER-encoded IDS identity certificate (for lookups). */
  idsCert: Buffer;
  /** Registered URIs with their status. */
  uris: { uri: string; status: number }[];
  status: number;
}

/** Bag configuration — service URLs fetched from init.ess.apple.com. */
export interface IDSBag {
  /** Raw bag plist data. */
  raw: Record<string, unknown>;
  /** Resolved endpoint URLs. */
  urls: IDSBagURLs;
}

export interface IDSBagURLs {
  authenticateDsId: string;
  authenticatePhoneNumber: string;
  register: string;
  getHandles: string;
  query: string;
  queryByService?: string;
}

/** HTTP-over-APNs request structure. */
export interface HTTPOverAPNsRequest {
  /** URL from bag. */
  url: string;
  /** HTTP method. */
  method: 'GET' | 'POST';
  /** HTTP headers. */
  headers: Record<string, string>;
  /** Body (will be gzipped). */
  body?: Buffer;
  /** Message UUID. */
  messageId?: string;
}

/** HTTP-over-APNs response structure. */
export interface HTTPOverAPNsResponse {
  /** HTTP status code. */
  status: number;
  /** Response body (gunzipped). */
  body: Buffer;
  /** Message UUID. */
  messageId?: string;
}
