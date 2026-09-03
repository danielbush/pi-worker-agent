import { DATA_ROOT } from "../config.ts";
import { loadConfiguredProjects, message } from "./project-configuration.ts";

try {
  const projects = await loadConfiguredProjects(DATA_ROOT);
  console.log(`DATA_ROOT=${DATA_ROOT}`);
  console.log("Projects:");
  for (const project of projects) console.log(`- ${project}`);
} catch (error) {
  console.error(`projects: ${message(error)}`);
  process.exit(1);
}
