/**
 * Parser for Apple's typedstream format used in NSArchiver.
 * Forked from imessage-parser's TypedStreamParser to remove the upstream dependency.
 *
 * This handles the binary `attributedBody` column in the iMessage database,
 * which stores NSAttributedString data serialised via NSArchiver (typedstream format).
 */
import { BufferReader } from "./buffer-reader.js";

export interface NSStringData {
  className: string;
  content: string;
  encoding: string;
}

const PREAMBLE_NSSTRING = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]);

const METADATA_KEYWORDS = [
  "streamtyped",
  "NSMutableAttributedString",
  "NSAttributedString",
  "NSObject",
  "NSMutableString",
  "NSString",
  "NSDictionary",
  "NSNumber",
  "NSValue",
  "NSFont",
  "NSParagraphStyle",
  "__kIM",
  "NSData",
  "bplist",
  "NSKeyedArchiver",
  "NS.rangeval",
  "Z$classname",
  "$class",
  "$classname",
];

export class TypedStreamParser {
  private reader: BufferReader;
  private headerParsed = false;

  constructor(buffer: Buffer) {
    this.reader = new BufferReader(buffer);
  }

  /** Parse all NSString objects found in the buffer. */
  parseAllNSStrings(): NSStringData[] {
    const strings: NSStringData[] = [];
    this.parseHeader();

    while (this.reader.remaining > 0) {
      const found = this.parseNSString();
      if (found) {
        strings.push(found);
      } else if (this.reader.remaining > 0) {
        this.reader.skip(1);
      }
    }

    return strings;
  }

  /** Fallback: extract readable text segments by scanning for printable byte runs. */
  extractReadableText(): string[] {
    this.reader.seek(0);
    const texts: string[] = [];
    let current = "";
    let inText = false;

    while (this.reader.remaining > 0) {
      const byte = this.reader.readUInt8();

      if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
        current += String.fromCharCode(byte);
        inText = true;
      } else if (byte >= 128 && byte <= 255) {
        if (this.isValidUTF8Sequence(byte)) {
          current += this.readUTF8Char(byte);
          inText = true;
        } else {
          this.flushSegment(current, inText, texts);
          current = "";
          inText = false;
        }
      } else {
        this.flushSegment(current, inText, texts);
        current = "";
        inText = false;
      }
    }

    this.flushSegment(current, true, texts);
    return texts;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private parseHeader(): void {
    if (this.headerParsed) return;
    const magic = this.reader.peekBytes(11);
    if (!magic || magic.toString("ascii") !== "streamtyped") return;

    this.reader.skip(11);
    while (this.reader.remaining > 0) {
      const next4 = this.reader.peekBytes(4);
      if (next4 && /^[A-Z]/.test(next4.toString("ascii"))) break;
      this.reader.skip(1);
    }
    this.headerParsed = true;
  }

  private parseNSString(): NSStringData | null {
    const pos = this.reader.findPattern("NSString");
    if (pos === -1) return null;

    this.reader.seek(pos + 8); // skip "NSString"

    const preamble = this.reader.peekBytes(5);
    if (preamble && preamble.equals(PREAMBLE_NSSTRING)) {
      this.reader.skip(5);
    }

    const lengthByte = this.reader.readUInt8();
    let length: number;
    if (lengthByte === 0x81) {
      length = this.reader.readUInt16LE();
    } else {
      length = lengthByte;
    }

    if (length === 0 || length > this.reader.remaining) return null;

    return {
      className: "NSString",
      content: this.reader.readString(length, "utf8"),
      encoding: "utf8",
    };
  }

  private isValidUTF8Sequence(firstByte: number): boolean {
    this.reader.seek(this.reader.position - 1);
    if ((firstByte & 0xe0) === 0xc0) return this.reader.remaining >= 2;
    if ((firstByte & 0xf0) === 0xe0) return this.reader.remaining >= 3;
    if ((firstByte & 0xf8) === 0xf0) return this.reader.remaining >= 4;
    this.reader.skip(1);
    return false;
  }

  private readUTF8Char(firstByte: number): string {
    const bytes = [firstByte];
    const extra =
      (firstByte & 0xe0) === 0xc0 ? 1 : (firstByte & 0xf0) === 0xe0 ? 2 : (firstByte & 0xf8) === 0xf0 ? 3 : 0;
    for (let i = 0; i < extra; i++) bytes.push(this.reader.readUInt8());
    try {
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return "";
    }
  }

  private flushSegment(text: string, inText: boolean, out: string[]): void {
    if (!inText || text.length <= 3) return;
    const cleaned = this.cleanText(text);
    if (cleaned.length > 3) out.push(cleaned);
  }

  private cleanText(text: string): string {
    let cleaned = text;
    for (const kw of METADATA_KEYWORDS) {
      cleaned = cleaned.replaceAll(kw, "");
    }
    return cleaned
      .replace(/\{[^}]*\}/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[\x00-\x1f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
