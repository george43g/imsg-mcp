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
  const variants: string[] = [normalized];
  // US: also store with leading 1
  if (normalized.length === 10) {
    variants.push(`1${normalized}`);
  }
  // Australia: 61 + 9 digits (e.g. 61410871808) -> also store 9 digits (410871808) for 04... lookups
  if (normalized.length === 11 && normalized.startsWith("61")) {
    variants.push(normalized.slice(2));
  }
  // Australia: 9 digits starting with 4 (mobile) -> also store with 61 prefix
  if (normalized.length === 9 && normalized.startsWith("4")) {
    variants.push(`61${normalized}`);
  }
  return variants;
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
      const globalId = this.nextContactId++;
      const contact: Contact = {
        id: globalId,
        firstName: row.firstName,
        lastName: row.lastName,
        middleName: row.middleName,
        nickname: row.nickname,
        organization: row.organization,
        displayName: this.buildDisplayName(row),
        phoneNumbers: [],
        emails: [],
      };

      const localId = row.localId as number;

      const phones = db
        .prepare(`
        SELECT ZFULLNUMBER as number, ZLABEL as label
        FROM ZABCDPHONENUMBER
        WHERE ZOWNER = ? OR Z22_OWNER = ?
      `)
        .all(localId, localId) as any[];

      for (const phone of phones) {
        if (phone.number) {
          contact.phoneNumbers.push(phone.number);
          const lookup: ContactLookup = {
            contactId: contact.id,
            displayName: contact.displayName,
            label: phone.label,
          };
          for (const variant of normalizedPhoneVariants(phone.number)) {
            this.phoneMap.set(variant, lookup);
          }
        }
      }

      const emails = db
        .prepare(`
        SELECT ZADDRESS as email, ZLABEL as label
        FROM ZABCDEMAILADDRESS
        WHERE ZOWNER = ? OR Z22_OWNER = ?
      `)
        .all(localId, localId) as any[];

      for (const email of emails) {
        if (email.email) {
          contact.emails.push(email.email);
          const normalized = normalizeEmail(email.email);
          this.emailMap.set(normalized, {
            contactId: contact.id,
            displayName: contact.displayName,
            label: email.label,
          });
        }
      }

      this.contactCache.set(contact.id, contact);
    }
  }

  /**
   * Look up a contact by phone number or email
   * Returns display name if found, or the original handle if not
   */
  lookupHandle(handle: string): string {
    if (!this.initialized) {
      this.initialize();
    }

    // Try phone number lookup (try normalized and, for AU 04..., the 61-prefix form)
    if (/[\d+\-()\s]/.test(handle)) {
      const normalized = normalizePhoneNumber(handle);
      let contact = this.phoneMap.get(normalized);
      if (!contact && normalized.length === 9 && normalized.startsWith("4")) {
        contact = this.phoneMap.get(`61${normalized}`);
      }
      if (contact) {
        return contact.displayName;
      }
    }

    // Try email lookup
    if (handle.includes("@")) {
      const normalized = normalizeEmail(handle);
      const contact = this.emailMap.get(normalized);
      if (contact) {
        return contact.displayName;
      }
    }

    // Not found - return original handle
    return handle;
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
    const parts: string[] = [];

    if (row.firstName) parts.push(row.firstName);
    if (row.lastName) parts.push(row.lastName);

    if (parts.length > 0) {
      return parts.join(" ");
    }

    if (row.nickname) return row.nickname;
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
