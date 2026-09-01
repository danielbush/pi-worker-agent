/** Queryable metadata for one registered project in the `workspaces` table. */
export interface Project {
  id: string;
  name: string;
  rootDir: string;
  createdAt: string;
  lastUsedAt: string;
}
