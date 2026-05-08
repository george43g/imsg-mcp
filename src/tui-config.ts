/**
 * Persistent TUI settings — loaded from a JSON file on the filesystem.
 *
 * Resolution order (first one found wins):
 *   1. $XDG_CONFIG_HOME/imsg-mcp/config.json
 *   2. $HOME/.config/imsg-mcp/config.json
 *   3. $HOME/.imsg-mcp/config.json     (matches the slugs.db location)
 *
 * If no file exists, defaults are returned and the *write* path is
 * `$HOME/.config/imsg-mcp/config.json` (modern XDG-style location).
 *
 * Schema is validated with Zod. Parse errors → defaults + a stderr
 * warning (we never fail the TUI launch over a malformed config).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

// ── Schema ────────────────────────────────────────────────────────────────

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export const TuiConfigSchema = z.object({
  /** Glyph preset. "safe" is the universally-renderable default. */
  theme: z.enum(["safe", "powerline"]).default("safe"),
  /** 6-digit hex color used to derive the whole UI palette. */
  accentColor: z.string().regex(HEX6, "must be a 6-digit hex like #RRGGBB").default("#1982FC"),
});

export type TuiConfig = z.infer<typeof TuiConfigSchema>;

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  theme: "safe",
  accentColor: "#1982FC",
};

// ── Path resolution ───────────────────────────────────────────────────────

/** Candidate paths we try to read from, in order. */
function candidatePaths(): string[] {
  const home = homedir();
  const out: string[] = [];
  if (process.env.XDG_CONFIG_HOME) {
    out.push(join(process.env.XDG_CONFIG_HOME, "imsg-mcp", "config.json"));
  }
  out.push(join(home, ".config", "imsg-mcp", "config.json"));
  out.push(join(home, ".imsg-mcp", "config.json"));
  return out;
}

/** Where the file actually lives (first existing candidate), or null. */
export function findTuiConfigPath(): string | null {
  for (const p of candidatePaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Where to write a fresh config file. Returns the *first* candidate so
 *  XDG-style wins on a clean machine. */
export function defaultTuiConfigPath(): string {
  return candidatePaths()[0] ?? candidatePaths()[1];
}

// ── Loader ────────────────────────────────────────────────────────────────

export interface LoadedTuiConfig {
  config: TuiConfig;
  /** Path of the file we read from, or `null` if defaults were used. */
  source: string | null;
  /** Human-readable warnings (parse errors, schema errors). Empty when clean. */
  warnings: string[];
}

export function loadTuiConfig(): LoadedTuiConfig {
  const warnings: string[] = [];
  const path = findTuiConfigPath();
  if (!path) return { config: DEFAULT_TUI_CONFIG, source: null, warnings };

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const result = TuiConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      warnings.push(`tui-config: ${path} has invalid fields (${issues}); using defaults`);
      return { config: DEFAULT_TUI_CONFIG, source: path, warnings };
    }
    return { config: result.data, source: path, warnings };
  } catch (err) {
    warnings.push(
      `tui-config: failed to read ${path} (${err instanceof Error ? err.message : String(err)}); using defaults`,
    );
    return { config: DEFAULT_TUI_CONFIG, source: path, warnings };
  }
}

// ── Writer (used by `imsg-cli config edit` to seed a file if missing) ────

export function writeTuiConfig(config: TuiConfig, path = defaultTuiConfigPath()): string {
  // Validate before writing so we never persist garbage.
  TuiConfigSchema.parse(config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

// ── Layered resolution (CLI > env > config > defaults) ───────────────────

export interface TuiConfigOverrides {
  /** From `imsg --theme=...` */
  cliTheme?: string;
  /** From `imsg --accent=...` */
  cliAccent?: string;
}

export interface ResolvedTuiConfig extends TuiConfig {
  /** Where each value came from, useful for `imsg-cli config show`. */
  origin: {
    theme: "cli" | "env" | "config" | "default";
    accentColor: "cli" | "env" | "config" | "default";
  };
  /** The on-disk file path that contributed (or `null` if no file). */
  configPath: string | null;
  /** Any warnings raised during loading (malformed file, invalid env, etc). */
  warnings: string[];
}

export function resolveTuiConfig(overrides: TuiConfigOverrides = {}): ResolvedTuiConfig {
  const loaded = loadTuiConfig();
  const warnings = [...loaded.warnings];

  // Theme precedence: CLI > env > config > default
  let theme: TuiConfig["theme"] = loaded.config.theme;
  let themeOrigin: ResolvedTuiConfig["origin"]["theme"] = loaded.source ? "config" : "default";

  if (process.env.IMSG_TUI_THEME) {
    const t = process.env.IMSG_TUI_THEME;
    if (t === "safe" || t === "powerline") {
      theme = t;
      themeOrigin = "env";
    } else {
      warnings.push(`IMSG_TUI_THEME="${t}" is not "safe" or "powerline"; ignoring`);
    }
  }
  if (overrides.cliTheme !== undefined) {
    if (overrides.cliTheme === "safe" || overrides.cliTheme === "powerline") {
      theme = overrides.cliTheme;
      themeOrigin = "cli";
    } else {
      warnings.push(`--theme="${overrides.cliTheme}" is not "safe" or "powerline"; ignoring`);
    }
  }

  // Accent precedence: CLI > env > config > default
  let accentColor = loaded.config.accentColor;
  let accentOrigin: ResolvedTuiConfig["origin"]["accentColor"] = loaded.source
    ? "config"
    : "default";

  if (process.env.IMSG_TUI_ACCENT) {
    if (HEX6.test(process.env.IMSG_TUI_ACCENT)) {
      accentColor = process.env.IMSG_TUI_ACCENT;
      accentOrigin = "env";
    } else {
      warnings.push(
        `IMSG_TUI_ACCENT="${process.env.IMSG_TUI_ACCENT}" is not a 6-digit hex; ignoring`,
      );
    }
  }
  if (overrides.cliAccent !== undefined) {
    if (HEX6.test(overrides.cliAccent)) {
      accentColor = overrides.cliAccent;
      accentOrigin = "cli";
    } else {
      warnings.push(`--accent="${overrides.cliAccent}" is not a 6-digit hex; ignoring`);
    }
  }

  return {
    theme,
    accentColor,
    origin: { theme: themeOrigin, accentColor: accentOrigin },
    configPath: loaded.source,
    warnings,
  };
}
