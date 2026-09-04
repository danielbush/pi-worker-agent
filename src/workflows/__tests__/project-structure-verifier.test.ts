import { expect, test } from "bun:test";
import { ManagedProjectStructure } from "../managed-project-structure.ts";
import { Registry } from "../../storage/registry.ts";
import { ProjectStructureVerifier } from "../project-structure-verifier.ts";

const PROJECT = {
  id: "project_demo",
  collection: "active" as const,
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
    roots: {
      active: "/null-worker-agent/projects",
      test: "/null-worker-agent/projects/.test",
      archive: "/null-worker-agent/projects/.archive",
    },
    projects: [PROJECT],
  });
});

test("rejects duplicate names and collection mismatches", () => {
  const verifier = new ProjectStructureVerifier(
    Registry.createNull({ projects: [PROJECT] }),
    ManagedProjectStructure.createNull([
      { collection: "active", name: "demo", kind: "directory", hasSequenceFile: true },
      { collection: "test", name: "demo", kind: "directory", hasSequenceFile: true },
    ]),
  );

  expect(() => verifier.verify()).toThrow("Project directory names occur in multiple collections: demo");
  expect(() => verifier.verify()).toThrow("test/demo registered as active");
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
  expect(verification).toThrow("Project collection entries must be directories: active/notes.md (file)");
  expect(verification).toThrow("Project directories missing a regular sequence.md: active/demo");
  expect(verification).toThrow("Project directories are not registered: active/demo");
  expect(verification).toThrow("Registered projects have no directory: active/missing");
});
