import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "../../__tests__/test-directory.ts";
import { Id } from "../../src/domain/id.ts";
import { Registry } from "../../src/storage/registry.ts";
import { ProjectRegistrar } from "../../src/workflows/project-registrar.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTestDirectory(root);
});

test("registers only a project backed by a DATA_ROOT project directory", () => {
  // arrange
  const root = mkdtempSync(join(tmpdir(), "pi-worker-project-registrar-"));
  roots.push(root);
  const projectDirectory = join(root, "projects", "demo");
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(join(projectDirectory, "sequence.md"), "# Demo\n");
  const registry = Registry.create(root);
  const registrar = ProjectRegistrar.create(root, registry, Id.create());

  // act
  const project = registrar.register({ directoryName: "demo", title: "Demo" });

  // assert
  expect(registry.projects.get(project.id)).toEqual(project);
  expect(() => registrar.register({ directoryName: "../demo", title: "Escape" })).toThrow(
    "Invalid project directory name",
  );
  registry.close();
});
