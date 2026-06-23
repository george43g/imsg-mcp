/**
 * macOS Contacts Database Reader
 *
 * Loads contacts from all available sources:
 * - Local: ~/Library/Application Support/AddressBook/AddressBook-v22.abcddb
 * - iCloud / other accounts: ~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb
 *
 * Merges all into a single lookup so phone/email resolve to display names from any source.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

export interface Contact {
  id: number;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  nickname: string | null;
  organization: string | null;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
}

export interface ContactLookup {
  contactId: number;
  displayName: string;
  label?: string;
}

/**
 * Normalize phone number for comparison (digits only, canonical form).
 * - US: strip leading 1 so 10 digits.
 * - AU/international: keep full digits (e.g. 61... for Australia).
 */
function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // US: 11 digits starting with 1 -> drop 1
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * All normalized forms to use when storing a number in the map,
 * so lookups by +61..., 04..., 0... all hit.
 */
function normalizedPhoneVariants(phone: string): string[] {
  const normalized = normalizePhoneNumber(phone);
  const variants = new Set<string>([normalized]);

  // Australia: 61 + 9 digits -> also store bare mobile digits and local 04... format
  if (normalized.length === 11 && normalized.startsWith("61")) {
    const localMobile = normalized.slice(2);
    variants.add(localMobile);
    if (localMobile.length === 9 && localMobile.startsWith("4")) {
      variants.add(`0${localMobile}`);
    }
  }

  // Australia: local 04... mobile -> also store bare mobile digits and 61-prefixed format
  if (normalized.length === 10 && normalized.startsWith("04")) {
    const mobileDigits = normalized.slice(1);
    variants.add(mobileDigits);
    variants.add(`61${mobileDigits}`);
  }

  // US: also store with leading 1
  if (normalized.length === 10) {
    variants.add(`1${normalized}`);
  }
  // Australia: 9 digits starting with 4 (mobile) -> also store with 61 prefix
  if (normalized.length === 9 && normalized.startsWith("4")) {
    variants.add(`61${normalized}`);
    variants.add(`0${normalized}`);
  }

  return [...variants];
}

/**
 * Normalize email for comparison (lowercase, trim)
 */
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

const ADDRESS_BOOK_DIR = join(homedir(), "Library", "Application Support", "AddressBook");
const MAIN_DB_NAME = "AddressBook-v22.abcddb";

/**
 * Discover all Address Book database paths: main DB plus each source (e.g. iCloud).
 */
function discoverContactDbPaths(customPaths?: string | string[]): string[] {
  if (customPaths) {
    const list = Array.isArray(customPaths) ? customPaths : [customPaths];
    return list.filter((p) => existsSync(p));
  }

  const paths: string[] = [];
  const mainDb = join(ADDRESS_BOOK_DIR, MAIN_DB_NAME);
  if (existsSync(mainDb)) paths.push(mainDb);

  const sourcesDir = join(ADDRESS_BOOK_DIR, "Sources");
  if (existsSync(sourcesDir)) {
    try {
      const subdirs = readdirSync(sourcesDir, { withFileTypes: true });
      for (const d of subdirs) {
        if (!d.isDirectory()) continue;
        const sourceDb = join(sourcesDir, d.name, MAIN_DB_NAME);
        if (existsSync(sourceDb)) paths.push(sourceDb);
      }
    } catch {
      // ignore read errors
    }
  }

  return paths;
}

export class ContactsDB {
  private dbPaths: string[] = [];
  private databases: Database.Database[] = [];
  private phoneMap: Map<string, ContactLookup> = new Map();
  private emailMap: Map<string, ContactLookup> = new Map();
  private contactCache: Map<number, Contact> = new Map();
  private initialized = false;
  /** Next id when loading from multiple DBs (avoids Z_PK collisions across sources). */
  private nextContactId = 1;

  constructor(dbPaths?: string | string[]) {
    this.dbPaths = discoverContactDbPaths(dbPaths);
  }

  /**
   * Initialize the contact lookup maps from all discovered DBs (local + iCloud/sources).
   */
  initialize(): void {
    if (this.initialized) return;

    for (const path of this.dbPaths) {
      try {
        const db = new Database(path, { readonly: true });
        this.databases.push(db);
        this.loadContactsFromDb(db);
      } catch (err) {
        console.warn(`ContactsDB: could not load ${path}:`, err);
      }
    }

    this.initialized = true;
  }

  /**
   * Load contacts from a single Address Book SQLite DB into the shared maps.
   */
  private loadContactsFromDb(db: Database.Database): void {
    const contacts = db
      .prepare(`
      SELECT 
        Z_PK as localId,
        ZFIRSTNAME as firstName,
        ZLASTNAME as lastName,
        ZMIDDLENAME as middleName,
        ZNICKNAME as nickname,
        ZORGANIZATION as organization
      FROM ZABCDRECORD
      WHERE ZFIRSTNAME IS NOT NULL OR ZLASTNAME IS NOT NULL OR ZORGANIZATION IS NOT NULL
    `)
      .all() as any[];

    for (const row of contacts) {
      const localId = row.localId as number;

      const phones = (
        db
          .prepare(`
        SELECT ZFULLNUMBER as number, ZLABEL as label
        FROM ZABCDPHONENUMBER
        WHERE ZOWNER = ? OR Z22_OWNER = ?
      `)
          .all(localId, localId) as any[]
      ).filter((p) => p.number);

      const emails = (
        db
          .prepare(`
        SELECT ZADDRESS as email, ZLABEL as label
        FROM ZABCDEMAILADDRESS
        WHERE ZOWNER = ? OR Z22_OWNER = ?
      `)
          .all(localId, localId) as any[]
      ).filter((e) => e.email);

      // Cross-source dedup + union: if any handle already resolves to a contact
      // loaded from an earlier source DB, reuse that contact instead of minting
      // a new id. Otherwise a person split across a local card (phone) and an
      // iCloud card (email) gets two ids and their chats never merge.
      //
      // A single card can bridge MULTIPLE previously-separate ids (its phone hit
      // contact X, its email hit contact Y) — in that case union them all into
      // one identity so "wherever a contact's handles are found, they merge".
      const existingIds = this.findExistingContactIds(
        phones.map((p) => p.number as string),
        emails.map((e) => e.email as string),
      );
      let contact: Contact;
      if (existingIds.length === 0) {
        contact = {
          id: this.nextContactId++,
          firstName: row.firstName,
          lastName: row.lastName,
          middleName: row.middleName,
          nickname: row.nickname,
          organization: row.organization,
          displayName: this.buildDisplayName(row),
          phoneNumbers: [],
          emails: [],
        };
      } else {
        const survivorId = existingIds[0];
        for (let i = 1; i < existingIds.length; i++) {
          this.mergeContacts(survivorId, existingIds[i]);
        }
        contact = this.contactCache.get(survivorId) as Contact;
      }

      for (const phone of phones) {
        if (!contact.phoneNumbers.includes(phone.number)) contact.phoneNumbers.push(phone.number);
        const lookup: ContactLookup = {
          contactId: contact.id,
          displayName: contact.displayName,
          label: phone.label,
        };
        for (const variant of normalizedPhoneVariants(phone.number)) {
          this.phoneMap.set(variant, lookup);
        }
      }

      for (const email of emails) {
        if (!contact.emails.includes(email.email)) contact.emails.push(email.email);
        this.emailMap.set(normalizeEmail(email.email), {
          contactId: contact.id,
          displayName: contact.displayName,
          label: email.label,
        });
      }

      this.contactCache.set(contact.id, contact);
    }
  }

  /**
   * Probe the already-loaded lookup maps for every existing contactId that
   * shares any of these handles (loaded from earlier source DBs). Returns the
   * distinct ids in first-seen order; the caller treats the first as the
   * survivor and unions the rest. Empty when none match.
   */
  private findExistingContactIds(phones: string[], emails: string[]): number[] {
    const ids: number[] = [];
    const seen = new Set<number>();
    const add = (id: number) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };
    for (const number of phones) {
      for (const variant of normalizedPhoneVariants(number)) {
        const hit = this.phoneMap.get(variant);
        if (hit) add(hit.contactId);
      }
    }
    for (const email of emails) {
      const hit = this.emailMap.get(normalizeEmail(email));
      if (hit) add(hit.contactId);
    }
    return ids;
  }

  /**
   * Fold contact `dropId` into `keepId`: union their phone/email lists and
   * re-point every lookup-map entry (preserving labels) from the dropped id to
   * the survivor, then forget the dropped id. Used when one card bridges two
   * previously-separate identities.
   */
  private mergeContacts(keepId: number, dropId: number): void {
    if (keepId === dropId) return;
    const keep = this.contactCache.get(keepId);
    const drop = this.contactCache.get(dropId);
    if (!keep || !drop) return;

    for (const p of drop.phoneNumbers)
      if (!keep.phoneNumbers.includes(p)) keep.phoneNumbers.push(p);
    for (const e of drop.emails) if (!keep.emails.includes(e)) keep.emails.push(e);

    for (const [key, lookup] of this.phoneMap) {
      if (lookup.contactId === dropId) {
        this.phoneMap.set(key, { ...lookup, contactId: keepId, displayName: keep.displayName });
      }
    }
    for (const [key, lookup] of this.emailMap) {
      if (lookup.contactId === dropId) {
        this.emailMap.set(key, { ...lookup, contactId: keepId, displayName: keep.displayName });
      }
    }
    this.contactCache.delete(dropId);
  }

  /**
   * Look up a contact by phone number or email.
   */
  lookupContact(handle: string): ContactLookup | null {
    if (!this.initialized) {
      this.initialize();
    }

    if (/[\d+\-()\s]/.test(handle)) {
      for (const variant of normalizedPhoneVariants(handle)) {
        const contact = this.phoneMap.get(variant);
        if (contact) {
          return contact;
        }
      }
    }

    if (handle.includes("@")) {
      const normalized = normalizeEmail(handle);
      const contact = this.emailMap.get(normalized);
      if (contact) {
        return contact;
      }
    }

    return null;
  }

  /**
   * Look up a contact by phone number or email
   * Returns display name if found, or the original handle if not
   */
  lookupHandle(handle: string): string {
    return this.lookupContact(handle)?.displayName ?? handle;
  }

  /**
   * Get full contact details by ID
   */
  getContact(id: number): Contact | null {
    if (!this.initialized) {
      this.initialize();
    }
    return this.contactCache.get(id) || null;
  }

  /**
   * Search contacts by name
   */
  searchContacts(query: string): Contact[] {
    if (!this.initialized) {
      this.initialize();
    }

    const lowerQuery = query.toLowerCase();
    return Array.from(this.contactCache.values()).filter(
      (c) =>
        c.displayName.toLowerCase().includes(lowerQuery) ||
        c.phoneNumbers.some((p) => p.includes(query)) ||
        c.emails.some((e) => e.toLowerCase().includes(lowerQuery)),
    );
  }

  /**
   * Build display name from contact fields
   */
  private buildDisplayName(row: any): string {
    if (row.nickname) return row.nickname;

    const parts: string[] = [];

    if (row.firstName) parts.push(row.firstName);
    if (row.lastName) parts.push(row.lastName);

    if (parts.length > 0) {
      return parts.join(" ");
    }

    if (row.organization) return row.organization;

    return "Unknown Contact";
  }

  /**
   * Close all database connections
   */
  close(): void {
    for (const db of this.databases) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    this.databases = [];
  }

  /**
   * Paginated list of all loaded contacts, sorted by displayName.
   * Used by the MCP `list_contacts` tool.
   */
  listContacts(offset = 0, limit = 20): { contacts: Contact[]; total: number } {
    if (!this.initialized) {
      this.initialize();
    }
    const all = Array.from(this.contactCache.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    const slice = limit === 0 ? all.slice(offset) : all.slice(offset, offset + limit);
    return { contacts: slice, total: all.length };
  }

  /**
   * Get statistics about loaded contacts
   */
  getStats() {
    if (!this.initialized) {
      this.initialize();
    }

    return {
      totalContacts: this.contactCache.size,
      phoneNumbers: this.phoneMap.size,
      emails: this.emailMap.size,
    };
  }
}
