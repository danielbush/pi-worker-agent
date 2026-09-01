import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DATA_ROOT } from "../config.ts";

const projectsRoot = join(DATA_ROOT, "projects");

const projects = await listProjects();

console.log(`DATA_ROOT=${DATA_ROOT}`);

if (projects.length === 0) {
  console.log("No projects found under DATA_ROOT/projects.");
  process.exit(0);
}

console.log("Projects:");
for (const project of projects) {
  console.log(`- ${project}`);
}

async function listProjects(): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
