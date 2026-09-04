import type { ProjectCollection } from "./project-collection.ts";

/** Durable metadata for one management project in an active, test, or archive collection. */
export interface Project {
  id: string;
  collection: ProjectCollection;
  directoryName: string;
  title: string;
  description: string | null;
  createdAt: string;
  lastUsedAt: string;
}
