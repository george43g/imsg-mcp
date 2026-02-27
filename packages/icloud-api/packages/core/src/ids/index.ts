/**
 * IDS (Identity Services) — keyserver, registration, and key lookup.
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md
 */

export type {
  IDSRegistrationConfig,
  IDSIdentity,
  IDSLookupResult,
  IDSHandle,
  IDSAuthResult,
  IDSRegistrationResult,
  IDSBag,
  IDSBagURLs,
  HTTPOverAPNsRequest,
  HTTPOverAPNsResponse,
} from './types.js';

export {
  buildIDSNonce,
  buildSigningPayload,
  signPayload,
  buildSigningHeaders,
  signIDSRequest,
} from './signing.js';

export {
  fetchBag,
  getDefaultBag,
  BAG_URL,
} from './bag.js';

export {
  generateIDSKeyPair,
  computeCommonName,
  createIDSCsr,
  authenticateWithDsId,
} from './auth.js';

export {
  registerWithIDS,
} from './registration.js';

export {
  lookupKeys,
} from './lookup.js';

export {
  fetchValidationData,
  checkRelayHealth,
} from './relay.js';

export type { RelayConfig } from './relay.js';
