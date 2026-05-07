/**
 * Streaming exporter — writes a conversation to a file in pages so a 100k
 * message history doesn't blow up memory. Used by the `export_messages`
 * MCP tool.
 *
 * Strategy:
 *  1. Walk older history with `beforeMessageId` cursor.
 *  2. Each page is formatted and written immediately to a writable stream.
 *  3. For JSON we emit a top-level `{ ..., messages: [...] }` shape, opening
 *     the array, comma-separating page entries, then closing — that way we
 *     never hold the full array in memory.
 *  4. NDJSON is the simplest streaming option (one JSON object per line) —
 *     recommended for large exports.
 */

import { createWriteStream, statSync } from "node:fs";
import type { IMessageDB } from "./imessage-db.js";
import { toCSV, toMarkdown, toNDJSONLine } from "./tui/exportFormats.js";

export interface ExportOptions {
  db: IMessageDB;
  chatIdentifier: string;
  format: "markdown" | "csv" | "json" | "ndjson";
  outputPath: string;
  since: Date | null;
  until: Date | null;
  pageSize: number;
  signal?: AbortSignal;
}

export interface ExportResult {
  savedTo: string;
  count: number;
  oldest: Date | null;
  newest: Date | null;
  sizeBytes: number;
}

/** Type guard — Node ESM filesystem stream */
type WritableStream = ReturnType<typeof createWriteStream>;

function writeAndDrain(stream: WritableStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk)) {
      resolve();
    } else {
      stream.once("drain", () => resolve());
      stream.once("error", reject);
    }
  });
}

function endStream(stream: WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

export async function streamExport(opts: ExportOptions): Promise<ExportResult> {
  const { db, chatIdentifier, format, outputPath, since, until, pageSize, signal } = opts;

  const stream = createWriteStream(outputPath, { encoding: "utf8" });

  let count = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  let beforeMessageId: number | undefined;

  try {
    if (signal?.aborted) throw new Error("Export cancelled by client.");

    // Header
    if (format === "markdown") {
      const conv = await db.findChatByHandle(chatIdentifier);
      const name = conv?.displayName ?? conv?.rawIdentifier ?? chatIdentifier;
      await writeAndDrain(stream, `# ${name}\n\n`);
      if (conv?.threadSlug) await writeAndDrain(stream, `**Slug**: \`${conv.threadSlug}\`\n`);
      if (since) await writeAndDrain(stream, `**Since**: ${since.toISOString()}\n`);
      if (until) await writeAndDrain(stream, `**Until**: ${until.toISOString()}\n`);
      await writeAndDrain(stream, `**Exported**: ${new Date().toISOString()}\n\n---\n\n`);
    } else if (format === "csv") {
      await writeAndDrain(
        stream,
        "id,date,sender,handle,is_from_me,is_read,is_reply,reply_to_text,text,has_attachments\n",
      );
    } else if (format === "json") {
      await writeAndDrain(
        stream,
        `{\n  "chatIdentifier": ${JSON.stringify(chatIdentifier)},\n  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n  "messages": [\n`,
      );
    }
    // ndjson: no header

    let firstJson = true;

    // Page through history. After the first page, use beforeMessageId =
    // (oldest id in previous page) to fetch the next older page.
    while (true) {
      if (signal?.aborted) throw new Error("Export cancelled by client.");

      const page = await db.getMessagesForChat(chatIdentifier, pageSize, {
        includeReactionDetails: true,
        beforeMessageId,
      });
      if (page.length === 0) break;

      // Filter by date bounds (since/until) — applied per page
      const filtered = page.filter((m) => {
        if (since && m.date < since) return false;
        if (until && m.date > until) return false;
        return true;
      });

      // Track running oldest/newest for the result
      for (const m of filtered) {
        if (oldest == null || m.date < oldest) oldest = m.date;
        if (newest == null || m.date > newest) newest = m.date;
      }

      // Format and write
      if (filtered.length > 0) {
        if (format === "markdown") {
          await writeAndDrain(
            stream,
            toMarkdown(filtered, { thread: chatIdentifier }).split("\n").slice(7).join("\n"),
          );
          // ^ slice(7) skips the per-page header — we wrote it once above
        } else if (format === "csv") {
          // toCSV emits its own header; skip the first line on each page
          const csvBody = toCSV(filtered).split("\n").slice(1).join("\n");
          await writeAndDrain(stream, `${csvBody}\n`);
        } else if (format === "json") {
          for (const m of filtered) {
            if (!firstJson) await writeAndDrain(stream, ",\n");
            await writeAndDrain(stream, `    ${toNDJSONLine(m)}`);
            firstJson = false;
          }
        } else if (format === "ndjson") {
          for (const m of filtered) {
            await writeAndDrain(stream, `${toNDJSONLine(m)}\n`);
          }
        }
      }

      count += filtered.length;

      // Advance cursor — next page is older than the current oldest
      const pageOldestId = Math.min(...page.map((m) => m.id));
      if (page.length < pageSize) break; // last page
      if (since && oldest && oldest <= since) break; // crossed lower bound
      beforeMessageId = pageOldestId;

      // Yield so other tasks (e.g. health_check) can run
      await new Promise((r) => setImmediate(r));
    }

    // Footer
    if (format === "json") {
      await writeAndDrain(stream, `\n  ],\n  "count": ${count}\n}\n`);
    }

    await endStream(stream);
    const sizeBytes = (() => {
      try {
        return statSync(outputPath).size;
      } catch {
        return 0;
      }
    })();

    return { savedTo: outputPath, count, oldest, newest, sizeBytes };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
