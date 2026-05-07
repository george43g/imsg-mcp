import { describe, expect, it } from "vitest";
import {
  extractArchivedAttributedStringText,
  extractChatSummaryText,
  extractNullPaddedAsciiText,
} from "../src/plist-text.js";

const STAGE_SUMMARY_ARCHIVE = Buffer.from(
  "YnBsaXN0MDDUAQIDBAUGBwpYJHZlcnNpb25ZJGFyY2hpdmVyVCR0b3BYJG9iamVjdHMSAAGGoF8QD05TS2V5ZWRBcmNoaXZlctEICVRyb290gAGmCwwTFBogVSRudWxs0w0ODxARElhOU1N0cmluZ1YkY2xhc3NcTlNBdHRyaWJ1dGVzgAKABYADbxBIAFMAdABhAGcAZQAgADEANwAgIBwAUwBhAG4AYwB0AHUAYQByAHkAIABQAHIAZQBjAGkAbgBjAHQgHQAgAHMAZQBsAGwAaQBuAGcAOwAgAGwAYQBuAGQAIABpAG4AIABQAGEAawBlAG4AaABhAG0AIABFAGEAcwB0ACAAZgByAG8AbQAgACQAMwA1ADUAawAu0xUWDhcYGVdOUy5rZXlzWk5TLm9iamVjdHOgoIAE0hscHR5aJGNsYXNzbmFtZVgkY2xhc3Nlc1xOU0RpY3Rpb25hcnmiHR9YTlNPYmplY3TSGxwhIl8QEk5TQXR0cmlidXRlZFN0cmluZ6IjH18QEk5TQXR0cmlidXRlZFN0cmluZwAIABEAGgAkACkAMgA3AEkATABRAFMAWgBgAGcAcAB3AIQAhgCIAIoBHQEkASwBNwE4ATkBOwFAAUsBVAFhAWQBbQFyAYcBigAAAAAAAAIBAAAAAAAAACQAAAAAAAAAAAAAAAAAAAGf",
  "base64",
);

const STAGE_CHAT_SUMMARY = Buffer.from(
  "YnBsaXN0MDDTAQIDBAgMXxAVY2hhdFN1bW1hcnlEaWN0aW9uYXJ5XxAQc2hvdWxkRm9yY2VUb1NNU18QE2xhc3RTZWVuTWVzc2FnZUd1aWTTBQYHCAkKXxATY2hhdFN1bW1hcnlDb25zdW1lZF8QHGNoYXRTdW1tYXJ5QXNzb2NpYXRlZE1lc3NhZ2VbY2hhdFN1bW1hcnkIXxAkMkE2RjVGRTMtNTFBQy00MkVELTIyQkItQTNDMUExQjAyODQ0TxECB2JwbGlzdDAw1AECAwQFBgcKWCR2ZXJzaW9uWSRhcmNoaXZlclQkdG9wWCRvYmplY3RzEgABhqBfEA9OU0tleWVkQXJjaGl2ZXLRCAlUcm9vdIABpgsMExQaIFUkbnVsbNMNDg8QERJYTlNTdHJpbmdWJGNsYXNzXE5TQXR0cmlidXRlc4ACgAWAA28QSABTAHQAYQBnAGUAIAAxADcAICAcAFMAYQBuAGMAdAB1AGEAcgB5ACAAUAByAGUAYwBpAG4AYwB0IB0AIABzAGUAbABsAGkAbgBnADsAIABsAGEAbgBkACAAaQBuACAAUABhAGsAZQBuAGgAYQBtACAARQBhAHMAdAAgAGYAcgBvAG0AIAAkADMANQA1AGsALtMVFg4XGBlXTlMua2V5c1pOUy5vYmplY3RzoKCABNIbHB0eWiRjbGFzc25hbWVYJGNsYXNzZXNcTlNEaWN0aW9uYXJ5oh0fWE5TT2JqZWN00hscISJfEBJOU0F0dHJpYnV0ZWRTdHJpbmeiIx9fEBJOU0F0dHJpYnV0ZWRTdHJpbmcACAARABoAJAApADIANwBJAEwAUQBTAFoAYABnAHAAdwCEAIYAiACKAR0BJAEsATcBOAE5ATsBQAFLAVQBYQFkAW0BcgGHAYoAAAAAAAACAQAAAAAAAAAkAAAAAAAAAAAAAAAAAAABnwhfECQ1RjZFMjI5QS1COThFLURDNEYtM0IwMS1ERjIxQzA1MTIzQzEACAAPACcAOgBQAFcAbQCMAJgAmQDAAssCzAAAAAAAAAIBAAAAAAAAAA0AAAAAAAAAAAAAAAAAAALz",
  "base64",
);

describe("extractNullPaddedAsciiText", () => {
  it("extracts chat summary text from null-padded plist bytes", () => {
    const snippet = "Stage 17 Sanctuary Precinct selling; land in Pakenham East from $355k.";
    const nullPadded = Buffer.from([...snippet].flatMap((char) => [0, char.charCodeAt(0)]));
    const blob = Buffer.concat([
      Buffer.from("bplist00chatSummaryDictionary", "utf8"),
      Buffer.from([0x10, 0x48]),
      nullPadded,
      Buffer.from("NSAttributedString", "utf8"),
    ]);

    expect(extractNullPaddedAsciiText(blob)).toBe(snippet);
  });

  it("returns undefined when no null-padded text is present", () => {
    expect(extractNullPaddedAsciiText(Buffer.from("bplist00no-snippet", "utf8"))).toBeUndefined();
  });
});

describe("chat summary plist parsing", () => {
  it("extracts archived attributed-string text from keyed archives", () => {
    expect(extractArchivedAttributedStringText(STAGE_SUMMARY_ARCHIVE)).toBe(
      "Stage 17 “Sanctuary Precinct” selling; land in Pakenham East from $355k.",
    );
  });

  it("extracts the nested chat summary from chat properties", () => {
    expect(extractChatSummaryText(STAGE_CHAT_SUMMARY)).toBe(
      "Stage 17 “Sanctuary Precinct” selling; land in Pakenham East from $355k.",
    );
  });
});
