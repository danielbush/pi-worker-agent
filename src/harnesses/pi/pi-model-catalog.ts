/** Parses Pi `--list-models` rows as `provider/model` ids. */
export function parsePiModelCatalog(text: string): string[] {
  const ids: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\b/);
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}
