import { accessSync, constants, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { HarnessCommandResult } from "../harness-contract.ts";

export interface CursorExecutableLocator {
  which(name: string): string | null;
  home: string;
  isExecutable(path: string): boolean;
  canonicalPath(path: string): string;
  help(path: string): string | null;
}

const NAMES = ["cursor-agent", "agent"] as const;

export function createCursorExecutableLocator(
  which: (name: string) => string | null,
  run: (command: string[], cwd: string) => HarnessCommandResult,
  home = process.env.HOME ?? "",
): CursorExecutableLocator {
  return {
    which,
    home,
    isExecutable: (path) => {
      try { accessSync(path, constants.X_OK); return true; } catch { return false; }
    },
    canonicalPath: (path) => {
      try { return realpathSync(path); } catch { return path; }
    },
    help: (path) => {
      const result = run([path, "--help"], home || "/");
      if (result.exitCode !== 0) return null;
      return result.stdout || result.stderr || null;
    },
  };
}

/** Returns the stable Cursor launcher. Identity may be proven via the versioned target; that path is never returned. */
export function resolveCursorExecutable(locator: CursorExecutableLocator): string {
  for (const name of NAMES) {
    const candidate = locator.which(name);
    if (candidate && accept(locator, candidate)) return candidate;
  }
  if (locator.home) {
    for (const name of NAMES) {
      const candidate = join(locator.home, ".local", "bin", name);
      if (accept(locator, candidate)) return candidate;
    }
  }
  throw new Error(`no verified cursor executable found; searched PATH for 'cursor-agent' and 'agent', plus '${locator.home}/.local/bin/cursor-agent' and '${locator.home}/.local/bin/agent'. A file named 'agent' is accepted only when it resolves into Cursor's install tree or its --help identifies the Cursor Agent CLI.`);
}

function accept(locator: CursorExecutableLocator, path: string): boolean {
  if (!path.startsWith("/") || !locator.isExecutable(path)) return false;
  if (basename(path) === "cursor-agent") return true;
  if (pathIsCursor(locator.canonicalPath(path))) return true;
  const help = locator.help(path);
  return Boolean(help && (help.includes("Start the Cursor Agent") || help.includes("CURSOR_API_ENDPOINT") || help.includes("api2.cursor.sh")));
}

function pathIsCursor(canonical: string): boolean {
  if (basename(canonical) === "cursor-agent") return true;
  return /\/cursor-agent\/versions\/[^/]+\/[^/]+$/.test(canonical);
}
