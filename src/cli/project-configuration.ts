/** Validates the hard project-directory to registry mapping before manager startup. */
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
