import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

function resolveEnvPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value.startsWith("~/") || value === "~") {
    return join(homedir(), value.slice(2));
  }
  return resolve(process.cwd(), value);
}

export function getEnv(): string {
  return process.env.VITE_ENV ?? "development";
}

/** Bundled DB / mock-sending mode (cloud, CI tests via `.env.test`). */
export function isAiEnv(): boolean {
  return getEnv() === "ai";
}

/** Any non-`ai` mode (e.g. `development` on your Mac). */
export function isLocalEnv(): boolean {
  return !isAiEnv();
}

export function getImsgDbPath(): string {
  return resolveEnvPath(
    process.env.VITE_IMSG_DB_PATH,
    join(homedir(), "Library", "Messages", "chat.db"),
  );
}

export function getContactsDbPaths(): string[] | undefined {
  const main = process.env.VITE_CONTACTS_DB_PATH ?? join(homedir(), "Library", "Application Support", "AddressBook", "AddressBook-v22.abcddb");

  const mainResolved = resolveEnvPath(main, "");
  const paths = new Set<string>([mainResolved]);

  const sourcesSegment = `${sep}Sources${sep}`;
  const sourcesIndex = mainResolved.indexOf(sourcesSegment);
  const addressBookDir =
    sourcesIndex >= 0 ? mainResolved.slice(0, sourcesIndex) : dirname(mainResolved);

  const addSourceDb = (path: string) => {
    if (existsSync(path)) {
      paths.add(path);
    }
  };

  const uuid = process.env.VITE_ADDRESS_BOOK_UUID;
  if (uuid) {
    addSourceDb(join(addressBookDir, "Sources", uuid, "AddressBook-v22.abcddb"));
  }

  const sourcesDir = join(addressBookDir, "Sources");
  if (existsSync(sourcesDir)) {
    try {
      const entries = readdirSync(sourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        addSourceDb(join(sourcesDir, entry.name, "AddressBook-v22.abcddb"));
      }
    } catch {
      // Ignore unreadable Address Book source directories.
    }
  }

  return [...paths];
}

export function getSlugsDbPath(): string {
  return resolveEnvPath(process.env.VITE_SLUGS_DB_PATH, join(homedir(), ".imsg-mcp", "slugs.db"));
}

export function getVcfPath(): string {
  return resolveEnvPath(process.env.VITE_VCF_PATH, join(process.cwd(), "fixtures", "contacts.vcf"));
}
