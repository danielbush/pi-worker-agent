/** Queryable metadata and authorization for one worker execution location. */
export interface Workspace {
  id: string;
  name: string;
  rootDir: string;
  createdAt: string;
  lastUsedAt: string;
  authorizedAt?: string | null;
  authorizedBySessionId?: string | null;
}
