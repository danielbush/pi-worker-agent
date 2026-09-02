import { expect, test } from "bun:test";
import { cursorCatalogHasModel, parseCursorModelCatalog } from "../cursor-model-catalog.ts";

const LIVE = `Available models

auto - Auto (default)
gpt-5.3-codex-high - Codex 5.3 High
cursor-grok-4.5-high - Cursor Grok 4.5
cursor-grok-4.6-high - Cursor Grok 4.6
`;

test("extracts catalog ids from id-dash-label rows and ignores the header", () => {
  // arrange/act
  const ids = parseCursorModelCatalog(LIVE);

  // assert
  expect(ids).toEqual(["auto", "gpt-5.3-codex-high", "cursor-grok-4.5-high", "cursor-grok-4.6-high"]);
  expect(cursorCatalogHasModel(LIVE, "cursor-grok-4.5-high")).toBe(true);
  expect(cursorCatalogHasModel(LIVE, "auto")).toBe(true);
});

test("strips ANSI before reading the id", () => {
  // arrange
  const catalog = `\u001b[1mAvailable models\u001b[0m\n\u001b[32mcursor-grok-4.5-high\u001b[0m - Cursor Grok 4.5\n`;

  // act/assert
  expect(parseCursorModelCatalog(catalog)).toEqual(["cursor-grok-4.5-high"]);
  expect(cursorCatalogHasModel(catalog, "cursor-grok-4.5-high")).toBe(true);
});

test("does not treat labels, prefixes, or header words as ids", () => {
  // arrange/act/assert
  expect(cursorCatalogHasModel(LIVE, "Auto")).toBe(false);
  expect(cursorCatalogHasModel(LIVE, "Codex")).toBe(false);
  expect(cursorCatalogHasModel(LIVE, "Available")).toBe(false);
  expect(cursorCatalogHasModel(LIVE, "cursor-grok-4.5")).toBe(false);
  expect(cursorCatalogHasModel(LIVE, "gpt-5.3-codex-high - Codex 5.3 High")).toBe(false);
});
