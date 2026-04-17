#!/usr/bin/env node
/**
 * MCP Dev Proxy - A persistent stdio proxy for MCP server development.
 *
 * This wrapper stays alive across child process restarts, buffering stdin
 * and forwarding it to new child processes. This allows Warp/Cursor to
 * maintain a stable connection while nodemon restarts the actual MCP server.
 *
 * Usage:
 *   MCP_DEV_CMD="tsx src/index.ts" tsx scripts/mcp-dev-proxy.ts
 */

import { spawn, ChildProcess } from "child_process";

const MCP_DEV_CMD = process.env.MCP_DEV_CMD || "tsx src/index.ts";
const RESTART_DELAY_MS = 100;

let child: ChildProcess | null = null;
let isShuttingDown = false;

function spawnChild(): void {
  const [cmd, ...args] = MCP_DEV_CMD.split(" ");
  
  child = spawn(cmd, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    detached: true, // own process group so we can kill the whole tree
  });
  child.unref(); // don't keep proxy alive solely for the child

  // Forward stdout from child to parent stdout
  child.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(data);
  });

  // Forward stderr from child to parent stderr
  child.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(data);
  });

  child.on("error", (err) => {
    console.error("[dev-proxy] Child process error:", err);
  });

  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }
    console.error(`[dev-proxy] Child exited (code: ${code}, signal: ${signal}), restarting in ${RESTART_DELAY_MS}ms...`);
    setTimeout(spawnChild, RESTART_DELAY_MS);
  });
}

// Forward stdin from parent to child
process.stdin.on("data", (data: Buffer) => {
  child?.stdin?.write(data);
});

// Handle parent process shutdown
function killChildGroup(signal: NodeJS.Signals): void {
  if (child?.pid) {
    try {
      process.kill(-child.pid, signal); // negative pid = entire process group
    } catch {
      // process group may already be gone
    }
  }
}

process.on("SIGINT", () => {
  isShuttingDown = true;
  killChildGroup("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  isShuttingDown = true;
  killChildGroup("SIGTERM");
  process.exit(0);
});

// Start the first child
spawnChild();