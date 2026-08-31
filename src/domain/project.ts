/** Queryable metadata for one registered project in `projects`. */
export interface Project {
  id: string;
  name: string;
  rootDir: string;
  createdAt: string;
  lastUsedAt: string;
}
