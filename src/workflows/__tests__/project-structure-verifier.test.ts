import { expect, test } from "bun:test";
import { ManagedProjectStructure } from "../../infrastructure/filesystem/managed-project-structure.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectStructureVerifier } from "../project-structure-verifier.ts";

const PROJECT = {
  id: "project_demo",
  directoryName: "demo",
  title: "Demo",
  description: null,
  createdAt: "2026-09-03T00:00:00Z",
  lastUsedAt: "2026-09-03T00:00:00Z",
};

test("verifies immediate project directories and registered identities", () => {
  // arrange
  const verifier = new ProjectStructureVerifier(
    Registry.createNull({ projects: [PROJECT] }),
    ManagedProjectStructure.createNull([
      { name: "demo", kind: "directory", hasSequenceFile: true },
    ]),
  );

  // act
  const result = verifier.verify();

  // assert
  expect(result).toEqual({
    dataRoot: "/null-worker-agent",
    projectsRoot: "/null-worker-agent/projects",
    projects: [PROJECT],
  });
});

test("reports every structural and registration problem together", () => {
  // arrange
  const verifier = new ProjectStructureVerifier(
    Registry.createNull({ projects: [{ ...PROJECT, directoryName: "missing" }] }),
    ManagedProjectStructure.createNull([
      { name: "notes.md", kind: "file", hasSequenceFile: false },
      { name: "demo", kind: "directory", hasSequenceFile: false },
    ]),
  );

  // act
  const verification = () => verifier.verify();

  // assert
  expect(verification).toThrow("DATA_ROOT/projects entries must be directories: notes.md (file)");
  expect(verification).toThrow("Project directories missing a regular sequence.md: demo");
  expect(verification).toThrow("Project directories are not registered: demo");
  expect(verification).toThrow("Registered projects have no directory: missing");
});
