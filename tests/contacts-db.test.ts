import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ContactsDB } from "../src/contacts-db.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeAddressBookFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "imsg-contacts-"));
  tempDirs.push(dir);

  const dbPath = join(dir, "AddressBook-v22.abcddb");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE ZABCDRECORD (
      Z_PK INTEGER PRIMARY KEY,
      ZFIRSTNAME TEXT,
      ZLASTNAME TEXT,
      ZMIDDLENAME TEXT,
      ZNICKNAME TEXT,
      ZORGANIZATION TEXT
    );

    CREATE TABLE ZABCDPHONENUMBER (
      Z_PK INTEGER PRIMARY KEY,
      ZFULLNUMBER TEXT,
      ZLABEL TEXT,
      ZOWNER INTEGER,
      Z22_OWNER INTEGER
    );

    CREATE TABLE ZABCDEMAILADDRESS (
      Z_PK INTEGER PRIMARY KEY,
      ZADDRESS TEXT,
      ZLABEL TEXT,
      ZOWNER INTEGER,
      Z22_OWNER INTEGER
    );
  `);

  db.prepare(
    "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZMIDDLENAME, ZNICKNAME, ZORGANIZATION) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(1, "Armen", "Grigorian", null, "Dad", null);
  db.prepare(
    "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME, ZMIDDLENAME, ZNICKNAME, ZORGANIZATION) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(2, "Selena / Teagan", null, null, null, null);

  db.prepare(
    "INSERT INTO ZABCDPHONENUMBER (Z_PK, ZFULLNUMBER, ZLABEL, ZOWNER, Z22_OWNER) VALUES (?, ?, ?, ?, ?)",
  ).run(1, "0408 315 498", "_$!<Mobile>!$_", 1, 22);
  db.prepare(
    "INSERT INTO ZABCDPHONENUMBER (Z_PK, ZFULLNUMBER, ZLABEL, ZOWNER, Z22_OWNER) VALUES (?, ?, ?, ?, ?)",
  ).run(2, "0420 455 156", "_$!<Mobile>!$_", 2, 22);

  db.close();
  return dbPath;
}

describe("ContactsDB", () => {
  it("matches Australian local mobile numbers against international chat handles", () => {
    const contacts = new ContactsDB(makeAddressBookFixture());
    contacts.initialize();

    try {
      expect(contacts.lookupHandle("+61408315498")).toBe("Dad");
      expect(contacts.lookupHandle("+61420455156")).toBe("Selena / Teagan");
    } finally {
      contacts.close();
    }
  });

  it("prefers nickname over first and last name for display labels", () => {
    const contacts = new ContactsDB(makeAddressBookFixture());
    contacts.initialize();

    try {
      expect(contacts.lookupHandle("0408 315 498")).toBe("Dad");
    } finally {
      contacts.close();
    }
  });
});
