import { expect, test } from "bun:test";
import { DEFAULT_DATA_ROOT, resolveDataRoot } from "../config.ts";

test("resolves data root from PI_WORKER_AGENT_DATA_ROOT first", () => {
  expect(resolveDataRoot({
    PI_WORKER_AGENT_DATA_ROOT: "/pi-specific",
    DATA_ROOT: "/generic",
  })).toBe("/pi-specific");
});

test("falls back to DATA_ROOT for manager convenience", () => {
  expect(resolveDataRoot({ DATA_ROOT: "/generic" })).toBe("/generic");
});

test("falls back to default data root", () => {
  expect(resolveDataRoot({})).toBe(DEFAULT_DATA_ROOT);
});
