import { homedir } from "node:os";
import { join, resolve } from "node:path";

function resolveEnvPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value.startsWith("~/") || value === "~") {
    return join(homedir(), value.slice(2));
  }
  return resolve(process.cwd(), value);
}

export function getEnv(): string {
  return process.env.VITE_ENV ?? "local";
}

export function isLocalEnv(): boolean {
  return getEnv() === "local";
}

export function getImsgDbPath(): string {
  return resolveEnvPath(
    process.env.VITE_IMSG_DB_PATH,
    join(homedir(), "Library", "Messages", "chat.db"),
  );
}

export function getContactsDbPaths(): string[] | undefined {
  const main = process.env.VITE_CONTACTS_DB_PATH;
  if (!main) return undefined;

  const paths = [resolveEnvPath(main, "")];

  const uuid = process.env.VITE_ADDRESS_BOOK_UUID;
  if (uuid) {
    const mainResolved = paths[0];
    const baseDir = resolve(mainResolved, "..");
    const sourceDb = join(baseDir, "Sources", uuid, "AddressBook-v22.abcddb");
    paths.push(sourceDb);
  }

  return paths;
}

export function getSlugsDbPath(): string {
  return resolveEnvPath(process.env.VITE_SLUGS_DB_PATH, join(homedir(), ".imsg-mcp", "slugs.db"));
}

export function getVcfPath(): string {
  return resolveEnvPath(process.env.VITE_VCF_PATH, join(process.cwd(), "env-data", "contacts.vcf"));
}
