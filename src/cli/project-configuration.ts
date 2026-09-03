import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

export interface ConfiguredProjectRegistry {
  projects: string[];
  database: Database;
}

/** Validates manager startup and returns configured project directory names. */
export async function loadConfiguredProjects(dataRoot: string): Promise<string[]> {
  const configured = await openConfiguredProjectRegistry(dataRoot);
  try {
    return configured.projects;
  } finally {
    configured.database.close();
  }
}

/** Opens the validated project registry; the caller owns and must close the database. */
export async function openConfiguredProjectRegistry(dataRoot: string): Promise<ConfiguredProjectRegistry> {
  await requireDirectory(dataRoot, "DATA_ROOT");
  await requireFile(join(dataRoot, "PROJECT_MANAGEMENT.md"), "PROJECT_MANAGEMENT.md");

  const projectsRoot = join(dataRoot, "projects");
  await requireDirectory(projectsRoot, "DATA_ROOT/projects");
  const directories = (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const registryPath = join(dataRoot, "registry.sqlite");
  await requireFile(registryPath, "registry.sqlite");
  // WAL-mode SQLite may need to recreate its sidecar files even for SELECTs.
  const database = new Database(registryPath, { readwrite: true, create: false });
  try {
    const registered = database
      .query<{ directoryName: string }, []>("SELECT directoryName FROM projects ORDER BY directoryName")
      .all()
      .map((row) => row.directoryName);
    return { projects: validateProjectMappings(directories, registered), database };
  } catch (error) {
    database.close();
    throw new Error(`cannot read project registry: ${message(error)}`);
  }
}

/** Validates the hard project-directory to registry mapping. */
export function validateProjectMappings(projectDirectories: readonly string[], registeredDirectories: readonly string[]): string[] {
  if (projectDirectories.length === 0) throw new Error("no project directories found under DATA_ROOT/projects");

  const projectSet = new Set(projectDirectories);
  const registeredSet = new Set(registeredDirectories);
  const unregistered = projectDirectories.filter((name) => !registeredSet.has(name));
  if (unregistered.length) throw new Error(`project directories are not registered: ${unregistered.join(", ")}`);

  const missing = registeredDirectories.filter((name) => !projectSet.has(name));
  if (missing.length) throw new Error(`registered projects have no directory: ${missing.join(", ")}`);

  return [...projectDirectories];
}

async function requireDirectory(path: string, label: string): Promise<void> {
  const value = await safeStat(path);
  if (!value?.isDirectory()) throw new Error(`${label} is missing or is not a directory: ${path}`);
}

async function requireFile(path: string, label: string): Promise<void> {
  const value = await safeStat(path);
  if (!value?.isFile()) throw new Error(`${label} is missing or is not a file: ${path}`);
}

async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
