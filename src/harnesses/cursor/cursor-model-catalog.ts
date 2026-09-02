const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Parses Cursor `--list-models` output as `id - label` rows after stripping ANSI. */
export function parseCursorModelCatalog(text: string): string[] {
  const ids: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI, "");
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const id = line.slice(0, separator).trim();
    if (id) ids.push(id);
  }
  return ids;
}

export function cursorCatalogHasModel(text: string, model: string): boolean {
  return parseCursorModelCatalog(text).includes(model);
}
