/**
 * Terminal image display support.
 * Detects terminal capabilities and provides escape sequences for inline images.
 * Supports: Kitty Graphics Protocol, iTerm2 Inline Images.
 */

import { readFileSync } from "node:fs";

export type ImageProtocol = "kitty" | "iterm2" | null;

/** Detect which image protocol the current terminal supports */
export function detectImageProtocol(): ImageProtocol {
  if (process.env.KITTY_PID || process.env.TERM === "xterm-kitty" || process.env.KITTY_WINDOW_ID) {
    return "kitty";
  }
  const prog = process.env.TERM_PROGRAM ?? "";
  if (prog === "iTerm.app" || prog === "WezTerm" || prog === "ghostty") {
    return "iterm2";
  }
  return null;
}

/** Display an image file inline in the terminal at the current cursor position.
 *  Returns true if the image was displayed, false if unsupported.
 *  @param filepath - absolute path to the image file
 *  @param opts - display options
 */
export function displayImage(
  filepath: string,
  opts: { maxCols?: number; maxRows?: number } = {},
): boolean {
  const protocol = detectImageProtocol();
  if (!protocol) return false;

  const cols = opts.maxCols ?? 40;
  const rows = opts.maxRows ?? 15;

  try {
    const data = readFileSync(filepath);
    const b64 = data.toString("base64");

    if (protocol === "kitty") {
      writeKittyImage(b64, cols, rows);
    } else {
      writeIterm2Image(b64, filepath, data.length);
    }
    return true;
  } catch {
    return false;
  }
}

function writeKittyImage(b64: string, cols: number, rows: number): void {
  // Kitty graphics protocol: chunk base64 at 4096 bytes
  const chunkSize = 4096;
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const params =
      i === 0 ? `a=T,f=100,t=d,c=${cols},r=${rows},m=${isLast ? 0 : 1}` : `m=${isLast ? 0 : 1}`;
    process.stdout.write(`\x1b_G${params};${chunks[i]}\x1b\\`);
  }
}

function writeIterm2Image(b64: string, filename: string, size: number): void {
  const nameB64 = Buffer.from(filename.split("/").pop() ?? "image").toString("base64");
  process.stdout.write(
    `\x1b]1337;File=inline=1;width=auto;height=auto;preserveAspectRatio=1;name=${nameB64};size=${size}:${b64}\x07`,
  );
}

/** Check if a MIME type is an image we can potentially display inline */
export function isDisplayableImage(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("image/");
}

/** Check if a MIME type is a video we should open externally */
export function isVideo(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("video/");
}
