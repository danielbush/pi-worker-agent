import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DATA_ROOT } from "../config.ts";
import { validateProjectMappings } from "./project-configuration.ts";

try {
  const projects = await configuredProjects(DATA_ROOT);
  console.log(`DATA_ROOT=${DATA_ROOT}`);
  console.log("Projects:");
  for (const project of projects) console.log(`- ${project}`);
} catch (error) {
  console.error(`projects: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function configuredProjects(dataRoot: string): Promise<string[]> {
  await requireDirectory(dataRoot, "DATA_ROOT");
  await requireFile(join(dataRoot, "PROJECT_MANAGEMENT.md"), "PROJECT_MANAGEMENT.md");

  const projectsRoot = join(dataRoot, "projects");
  await requireDirectory(projectsRoot, "DATA_ROOT/projects");
  const projectDirectories = (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const registryPath = join(dataRoot, "registry.sqlite");
  await requireFile(registryPath, "registry.sqlite");
  const database = new Database(registryPath, { readonly: true });
  try {
    const registeredDirectories = database
      .query<{ directoryName: string }, []>("SELECT directoryName FROM projects ORDER BY directoryName")
      .all()
      .map((row) => row.directoryName);
    return validateProjectMappings(projectDirectories, registeredDirectories);
  } catch (error) {
    throw new Error(`cannot read project registry: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    database.close();
  }
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
