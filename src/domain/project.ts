/** Durable metadata for one `$DATA_ROOT/projects/<directoryName>` management project. */
export interface Project {
  id: string;
  directoryName: string;
  title: string;
  description: string | null;
  createdAt: string;
  lastUsedAt: string;
}
