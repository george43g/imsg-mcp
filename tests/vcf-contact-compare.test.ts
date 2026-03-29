import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContactsDB } from "../src/contacts-db.js";
import { compareVcfEntriesToContacts, parseVcfFile } from "../src/vcf-contact-compare.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultVcf = join(root, "env-data", "contacts.vcf");

/** Same threshold as agreed handoff bar; fixture currently ~98% (see script output). */
const MIN_MATCH_RATE = 0.8;

describe("VCF vs Address Book (env-data fixture)", () => {
  it("parseVcfFile reads at least one card", () => {
    const entries = parseVcfFile(defaultVcf);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("lookupHandle match rate meets minimum vs VCF FN strings", () => {
    const entries = parseVcfFile(defaultVcf);
    const contacts = new ContactsDB();
    contacts.initialize();
    try {
      const { total, matchRate } = compareVcfEntriesToContacts(entries, (h) =>
        contacts.lookupHandle(h),
      );
      expect(total).toBeGreaterThan(0);
      expect(matchRate).toBeGreaterThanOrEqual(MIN_MATCH_RATE);
    } finally {
      contacts.close();
    }
  });
});
