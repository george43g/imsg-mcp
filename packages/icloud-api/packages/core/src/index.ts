/**
 * @icloud-api/core — Cross-platform iMessage/iCloud API client.
 *
 * Modules:
 *   auth/     — GrandSlam (SRP-6a), anisette, 2FA
 *   apns/     — Apple Push Notification Service binary protocol
 *   ids/      — Identity Services registration and key lookup (Phase 2)
 *   crypto/   — pair-ec and legacy pair encryption (Phase 3)
 *   messages/ — iMessage wire format, types, serialization (Phase 3)
 *   contacts/ — iCloud Contacts via CardDAV/JSON (Phase 4)
 */

export * as auth from './auth/index.js';
export * as apns from './apns/index.js';
export * as ids from './ids/index.js';
export * as crypto from './crypto/index.js';
export * as messages from './messages/index.js';
export * as contacts from './contacts/index.js';
