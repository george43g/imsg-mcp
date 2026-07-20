/**
 * Bare-attachment file actions — shared by the message drawer (Message
 * attachments) and the per-thread info drawer (ConversationAttachment rows).
 * Extracted from App.tsx: fs/spawn side effects + status dispatches only, no
 * component state — every function takes the reducer `dispatch` explicitly.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Message } from "../types.js";
import type { Action } from "./types.js";

export type AttFile = { filename: string; mimeType?: string | null; transferName?: string | null };

type Dispatch = (action: Action) => void;

/** Open a single attachment file in an external viewer (Quick Look / mpv). */
export function openAttachmentFile(att: AttFile, dispatch: Dispatch) {
  if (!att.filename) {
    dispatch({ type: "SET_STATUS", status: "Attachment has no file path." });
    return;
  }
  // Expand ~ to home directory
  const filepath = att.filename.replace(/^~/, process.env.HOME ?? "~");
  const mime = att.mimeType ?? "";

  // macOS Quick Look (qlmanage -p) handles images, PDFs, audio, docs, and
  // most archives natively — same UX as Finder spacebar preview. For video,
  // mpv is preferred when installed (better scrubbing); otherwise fall back
  // to Quick Look. All spawns are detached + unref'd so the TUI never blocks.
  import("node:child_process").then(({ spawn }) => {
    const spawnQuickLook = () =>
      spawn("qlmanage", ["-p", filepath], { detached: true, stdio: "ignore" }).unref();

    if (mime.startsWith("video/")) {
      const child = spawn("mpv", [filepath], { detached: true, stdio: "ignore" });
      child.on("error", spawnQuickLook);
      child.unref();
    } else {
      spawnQuickLook();
    }
  });
}

export function openAttachment(msg: Message | undefined, attIdx: number, dispatch: Dispatch) {
  // Surface UX feedback when `o` can't do anything — previously this
  // silently no-op'd, leaving the user wondering if the key worked.
  if (!msg) {
    dispatch({ type: "SET_STATUS", status: "No message selected." });
    return;
  }
  if (!msg.attachments?.length) {
    dispatch({ type: "SET_STATUS", status: "No attachment on this message." });
    return;
  }
  openAttachmentFile(msg.attachments[attIdx] ?? msg.attachments[0], dispatch);
}

/** Copy a single attachment file to ~/Downloads with a collision-safe name. */
export function saveAttachmentFile(att: AttFile, dispatch: Dispatch): string | null {
  if (!att.filename) {
    dispatch({ type: "SET_STATUS", status: "No attachment to save." });
    return null;
  }
  const src = att.filename.replace(/^~/, process.env.HOME ?? "~");
  try {
    const base = att.transferName ?? basename(src);
    const dir = join(homedir(), "Downloads");
    const ext = extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let dest = join(dir, base);
    for (let n = 1; existsSync(dest); n++) {
      dest = join(dir, `${stem}-${n}${ext}`);
    }
    copyFileSync(src, dest);
    dispatch({ type: "SET_STATUS", status: `Saved to ${dest.replace(homedir(), "~")}` });
    return dest;
  } catch (e) {
    dispatch({
      type: "SET_STATUS",
      status: `Save failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

export function saveAttachment(msg: Message, attIdx: number, dispatch: Dispatch) {
  const att = msg.attachments?.[attIdx];
  if (!att) {
    dispatch({ type: "SET_STATUS", status: "No attachment to save." });
    return;
  }
  saveAttachmentFile(att, dispatch);
}

/** Export ALL of a thread's attachments into ~/Downloads/<folder>/. */
export function saveAllAttachmentFiles(atts: AttFile[], folder: string, dispatch: Dispatch) {
  if (atts.length === 0) {
    dispatch({ type: "SET_STATUS", status: "No attachments to export." });
    return;
  }
  try {
    const dir = join(homedir(), "Downloads", folder);
    mkdirSync(dir, { recursive: true });
    let saved = 0;
    for (const att of atts) {
      if (!att.filename) continue;
      const src = att.filename.replace(/^~/, process.env.HOME ?? "~");
      if (!existsSync(src)) continue;
      const base = att.transferName ?? basename(src);
      const ext = extname(base);
      const stem = base.slice(0, base.length - ext.length);
      let dest = join(dir, base);
      for (let n = 1; existsSync(dest); n++) dest = join(dir, `${stem}-${n}${ext}`);
      copyFileSync(src, dest);
      saved++;
    }
    dispatch({
      type: "SET_STATUS",
      status: `Exported ${saved}/${atts.length} attachments → ${dir.replace(homedir(), "~")}`,
    });
  } catch (e) {
    dispatch({
      type: "SET_STATUS",
      status: `Export failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
