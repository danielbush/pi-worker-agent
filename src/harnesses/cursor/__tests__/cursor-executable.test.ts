import { expect, test } from "bun:test";
import { resolveCursorExecutable, type CursorExecutableLocator } from "../cursor-executable.ts";

function locator(options: {
  which: CursorExecutableLocator["which"];
  paths?: string[];
  home?: string;
  canonicalPath?: CursorExecutableLocator["canonicalPath"];
  help?: CursorExecutableLocator["help"];
}): CursorExecutableLocator {
  const paths = new Set(options.paths ?? []);
  return {
    which: options.which,
    home: options.home ?? "/home/test",
    isExecutable: (path) => paths.has(path),
    canonicalPath: options.canonicalPath ?? ((path) => path),
    help: options.help ?? (() => null),
  };
}

test("prefers PATH cursor-agent and returns that stable launcher", () => {
  const path = "/opt/bin/cursor-agent";
  expect(resolveCursorExecutable(locator({
    which: (name) => name === "cursor-agent" ? path : null,
    paths: [path],
  }))).toBe(path);
});

test("accepts the agent alias only through the versioned install tree and still returns the stable path", () => {
  const alias = "/home/test/.local/bin/agent";
  const versioned = "/home/test/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/cursor-agent";
  expect(resolveCursorExecutable(locator({
    which: (name) => name === "agent" ? alias : null,
    paths: [alias],
    canonicalPath: (path) => path === alias ? versioned : path,
  }))).toBe(alias);
});

test("falls back to ~/.local/bin/cursor-agent when PATH has nothing", () => {
  const local = "/home/test/.local/bin/cursor-agent";
  expect(resolveCursorExecutable(locator({
    which: () => null,
    paths: [local],
  }))).toBe(local);
});

test("rejects an unrelated executable named agent", () => {
  expect(() => resolveCursorExecutable(locator({
    which: (name) => name === "agent" ? "/opt/agent" : null,
    paths: ["/opt/agent"],
  }))).toThrow("no verified cursor executable");
});

test("accepts a legacy agent whose --help identifies Cursor", () => {
  const alias = "/usr/local/bin/agent";
  expect(resolveCursorExecutable(locator({
    which: (name) => name === "agent" ? alias : null,
    paths: [alias],
    help: () => "Start the Cursor Agent\n",
  }))).toBe(alias);
});
