export type ProjectCollection = "active" | "test" | "archive";

export function projectCollectionDirectory(collection: ProjectCollection): string {
  if (collection === "active") return "projects";
  return collection === "test" ? ".test" : ".archive";
}
