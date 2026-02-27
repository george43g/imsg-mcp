/**
 * iMessage encryption — pair-ec and legacy pair formats.
 *
 * Phase 3 implementation. This module will handle:
 * - pair-ec: ECDH (P-256 compact) + HKDF (SHA-256) + AES-CTR (64-bit counter)
 * - Legacy pair: HMAC-SHA256 + AES-CTR + RSA-OAEP + ECDSA
 * - Message signing and verification
 * - PreKey management
 *
 * Reference: docs/IDS_IDENTITY_SERVICES_RESEARCH.md (pair-ec section)
 * Reference: docs/RESEARCH_IMESSAGE_PROTOCOL_AND_IMPLEMENTATIONS.md
 */

export interface EncryptedMessage {
  payload: Buffer;
  key: Buffer;
  signature: Buffer;
  validator?: Buffer;
}

export interface DecryptedMessage {
  plaintext: Buffer;
  counter: number;
  verified: boolean;
}

// Phase 3: Encryption will be implemented based on pair-ec protobuf structures
// documented in the IDS wiki and pypush source.
