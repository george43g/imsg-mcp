import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getContactsDbPaths } from "../src/config.js";
import { ContactsDB } from "../src/contacts-db.js";
import { compareVcfEntriesToContacts, parseVcfFile } from "../src/vcf-contact-compare.js";
import { isGitLfsPointer } from "./helpers.js";

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
    const paths = getContactsDbPaths();
    const first = paths?.[0];
    // No paths (e.g. missing .env.test) or Git LFS stub: skip assertion; CI with `git lfs pull` runs the full check.
    if (!first || isGitLfsPointer(first)) {
      return;
    }

    const entries = parseVcfFile(defaultVcf);
    const contacts = new ContactsDB(paths);
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
