/**
 * iCloud Contacts sync via CardDAV and proprietary JSON API.
 *
 * Phase 4 implementation. This module will handle:
 * - CardDAV sync (RFC 6352) via contacts.icloud.com
 * - Proprietary JSON API (/co/startup, /co/contacts)
 * - Contact CRUD operations
 * - Delta sync with sync tokens
 *
 * Reference: docs/research/TRACK_10_ICLOUD_CONTACTS.md
 */

export interface iCloudContact {
  id: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers: string[];
  emails: string[];
  organization?: string;
}

// Phase 4: Contact sync will be implemented here.
// CardDAV with app-specific password is the simplest approach.
// The pyicloud JSON API provides an alternative for programmatic access.
