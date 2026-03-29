import { TypedStreamParser } from "imessage-parser";

const METADATA_PATTERNS = [
  /^streamtyped$/i,
  /^NS[A-Z]/,
  /^[^A-Za-z0-9]*__kIM/,
  /^MessagePartAttributeName$/i,
  /^DataDetectedAttributeName$/i,
  /^CalendarEventAttributeName$/i,
  /^X\$version/,
  /^WversionYdd-result/,
  /^bplist/,
  /^\$class/,
  /^RMSV\$class/,
  /^NSData$/,
  /^NSDictionary$/,
  /^NSNumber$/,
  /^NSValue$/,
  /^at_\d+_[0-9A-F-]+$/i,
  /FileTransferGUIDAttributeName/i,
  /BaseWritingDirectionAttributeName/i,
  /^\d{2}.*��/,
];

const CONTROL_OR_DEL_RE = new RegExp("[\\x00-\\x1F\\x7F]", "g");
const CONTROL_SPLIT_RE = new RegExp("[\\x00-\\x1F\\x7F]+", "g");

function normalizeCandidate(text: string): string | null {
  const normalized = text
    .replace(/^[+;:"'()&\s]+/, "")
    .replace(CONTROL_OR_DEL_RE, " ")
    .replace(/\uFFFD+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized === "�" || normalized === "￼") return null;
  if (normalized.length < 2 && !/[\u{1F300}-\u{1FAFF}]/u.test(normalized)) return null;
  if (/^[A-Za-z0-9]{1,2}$/.test(normalized)) return null;
  if (METADATA_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  return normalized;
}

function scoreCandidate(text: string): number {
  let score = 0;
  if (/[A-Za-z]/.test(text)) score += 50;
  if (/\d/.test(text)) score += 10;
  if (/\s/.test(text)) score += 30;
  if (/[.!?]/.test(text)) score += 15;
  if (/[\u{1F300}-\u{1FAFF}]/u.test(text)) score += 100;
  if (/^[A-Za-z0-9]{1,3}$/.test(text)) score -= 100;
  score += Math.min(text.length, 200);
  return score;
}

export function extractAttributedBodyText(blob: Buffer | null): string | undefined {
  if (!blob) return undefined;

  const parser = new TypedStreamParser(blob);
  const candidates = new Map<string, number>();

  const remember = (values: string[]) => {
    for (const value of values) {
      const normalized = normalizeCandidate(value);
      if (!normalized) continue;
      candidates.set(normalized, scoreCandidate(normalized));
    }
  };

  try {
    remember(parser.parseAllNSStrings().map((entry) => entry.content));
  } catch {
    // Ignore parser failures and keep trying other extraction strategies.
  }

  try {
    remember(parser.extractReadableText());
  } catch {
    // Ignore parser failures and keep trying other extraction strategies.
  }

  remember(blob.toString("utf8").split(CONTROL_SPLIT_RE));

  const best = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0];
}
