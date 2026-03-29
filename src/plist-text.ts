import { parseBuffer } from "bplist-parser";

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length >= 4 ? normalized : undefined;
}

export function extractNullPaddedAsciiText(blob: Buffer | null): string | undefined {
  if (!blob) return undefined;

  let best = "";
  let current = "";

  const flush = () => {
    if (current.length > best.length) {
      best = current;
    }
    current = "";
  };

  for (let index = 0; index < blob.length - 1; index += 1) {
    const first = blob[index];
    const second = blob[index + 1];

    if (first === 0 && second >= 32 && second <= 126) {
      current += String.fromCharCode(second);
      index += 1;
      continue;
    }

    flush();
  }

  flush();

  return normalizeText(best);
}

export function extractArchivedAttributedStringText(blob: Buffer | null): string | undefined {
  if (!blob) return undefined;

  try {
    const [plist] = parseBuffer(blob) as Array<{ $objects?: unknown[] }>;
    const objects = plist?.$objects;
    if (!Array.isArray(objects)) {
      return extractNullPaddedAsciiText(blob);
    }

    const attributedString = objects.find(
      (value): value is { NSString?: { UID?: number } } =>
        typeof value === "object" && value !== null && "NSString" in value,
    );
    const stringUid = attributedString?.NSString?.UID;
    if (typeof stringUid === "number" && typeof objects[stringUid] === "string") {
      return normalizeText(objects[stringUid] as string);
    }

    const firstString = objects.find(
      (value): value is string =>
        typeof value === "string" && !value.startsWith("$") && !value.startsWith("NS"),
    );
    return normalizeText(firstString) ?? extractNullPaddedAsciiText(blob);
  } catch {
    return extractNullPaddedAsciiText(blob);
  }
}

export function extractChatSummaryText(blob: Buffer | null): string | undefined {
  if (!blob) return undefined;

  try {
    const [plist] = parseBuffer(blob) as Array<{
      chatSummaryDictionary?: { chatSummary?: Buffer | null };
    }>;
    const chatSummary = plist?.chatSummaryDictionary?.chatSummary;
    if (chatSummary) {
      return extractArchivedAttributedStringText(chatSummary);
    }
  } catch {
    // Fall back to heuristic extraction below.
  }

  return extractNullPaddedAsciiText(blob);
}
