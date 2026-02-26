#!/usr/bin/env tsx
/**
 * Compare contacts from contacts.vcf with the tool's Address Book integration.
 * Reports how many VCF contacts resolve to the expected name via ContactsDB.lookupHandle.
 *
 * Usage: pnpm exec tsx scripts/compare-contacts-vcf.ts [path/to/contacts.vcf]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContactsDB } from '../src/contacts-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const defaultVcf = join(root, 'contacts.vcf');

interface VCardEntry {
  fn: string;
  tel: string[];
  email: string[];
}

function parseVcf(path: string): VCardEntry[] {
  const text = readFileSync(path, 'utf-8');
  const entries: VCardEntry[] = [];
  const blocks = text.split(/(?=BEGIN:VCARD)/).filter(Boolean);

  for (const block of blocks) {
    if (!block.trim().startsWith('BEGIN:VCARD')) continue;
    let fn = '';
    const tel: string[] = [];
    const email: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FN:')) {
        fn = trimmed.slice(3).trim();
      } else if (trimmed.startsWith('TEL;') || trimmed.startsWith('TEL:')) {
        const value = trimmed.replace(/^TEL[^:]*:/, '').trim();
        if (value) tel.push(value);
      } else if (trimmed.startsWith('EMAIL;') || trimmed.startsWith('EMAIL:')) {
        const value = trimmed.replace(/^EMAIL[^:]*:/, '').trim();
        if (value) email.push(value);
      }
    }
    if (fn || tel.length || email.length) {
      entries.push({ fn, tel, email });
    }
  }
  return entries;
}

function main() {
  const vcfPath = process.argv[2] || defaultVcf;
  console.log('Comparing VCF contacts with Address Book integration\n');
  console.log(`VCF: ${vcfPath}\n`);

  let entries: VCardEntry[];
  try {
    entries = parseVcf(vcfPath);
  } catch (e) {
    console.error('Failed to read VCF:', e);
    process.exit(1);
  }

  const contacts = new ContactsDB();
  contacts.initialize();
  const stats = contacts.getStats();
  console.log(`Address Book: ${stats.totalContacts} contacts, ${stats.phoneNumbers} phone entries, ${stats.emails} email entries\n`);

  let match = 0;
  let mismatch = 0;
  let notFound = 0;
  const mismatches: { fn: string; handle: string; expected: string; got: string }[] = [];
  const notFounds: { fn: string; handle: string }[] = [];

  for (const entry of entries) {
    const expectedName = entry.fn || '(no name)';
    const handles = [
      ...entry.tel,
      ...entry.email,
    ].filter(Boolean);

    for (const handle of handles) {
      const resolved = contacts.lookupHandle(handle);
      if (resolved === handle) {
        notFound++;
        if (notFounds.length < 15) {
          notFounds.push({ fn: expectedName, handle });
        }
      } else if (resolved !== expectedName) {
        mismatch++;
        if (mismatches.length < 15) {
          mismatches.push({ fn: expectedName, handle, expected: expectedName, got: resolved });
        }
      } else {
        match++;
      }
    }
  }

  const total = match + mismatch + notFound;
  console.log('Results (by handle: each TEL/EMAIL counted once):');
  console.log(`  Match (resolved to VCF name): ${match}`);
  console.log(`  Mismatch (resolved to different name): ${mismatch}`);
  console.log(`  Not found (returned raw handle): ${notFound}`);
  console.log(`  Total lookups: ${total}`);
  if (total > 0) {
    console.log(`  Match rate: ${((100 * match) / total).toFixed(1)}%`);
  }

  if (mismatches.length > 0) {
    console.log('\nSample mismatches (VCF name vs resolved name):');
    for (const m of mismatches) {
      console.log(`  "${m.fn}" / ${m.handle} => "${m.got}" (expected "${m.expected}")`);
    }
  }
  if (notFounds.length > 0) {
    console.log('\nSample not found (handle not in Address Book or normalization missed):');
    for (const n of notFounds) {
      console.log(`  "${n.fn}" / ${n.handle}`);
    }
  }

  // Spot-check Mona from context
  const monaResolved = contacts.lookupHandle('+61451082095');
  const monaEmailResolved = contacts.lookupHandle('monaquilty@gmail.com');
  console.log('\nSpot check (from conversation context):');
  console.log(`  +61451082095 => "${monaResolved}" ${monaResolved === 'Mona' ? '(expected)' : ''}`);
  console.log(`  monaquilty@gmail.com => "${monaEmailResolved}" ${monaEmailResolved !== 'monaquilty@gmail.com' ? '(resolved)' : '(not in Address Book)'}`);

  contacts.close();
}

main();
