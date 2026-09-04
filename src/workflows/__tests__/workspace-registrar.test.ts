import { expect, test } from "bun:test";
import { WorkspaceDirectory } from "../workspace-directory.ts";
import { Clock } from "../../infrastructure/system/clock.ts";
import { Registry } from "../../storage/registry.ts";
import { WorkspaceRegistrar } from "../workspace-registrar.ts";

const TIMESTAMP = "2026-09-02T12:00:00Z";

test("records a workspace after an approved preflight", () => {
  // arrange
  const registry = Registry.createNull();
  const preflight = {
    requestedPath: "/code/demo",
    canonicalPath: "/code/demo",
    exists: true,
    gitRepository: true,
  };
  const directories = WorkspaceDirectory.createNull({ "/code/demo": preflight });
  const registrar = new WorkspaceRegistrar(
    registry,
    directories,
    { createWorkspaceId: () => "workspace_demo" },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const workspace = registrar.register({
    name: "demo",
    preflight,
    createIfMissing: false,
    userApproved: true,
    approvedBySessionId: "session_manager",
  });

  // assert
  expect(workspace).toMatchObject({
    id: "workspace_demo",
    rootDir: "/code/demo",
    authorizedAt: TIMESTAMP,
    authorizedBySessionId: "session_manager",
  });
  expect(registry.workspaces.get("workspace_demo")).toEqual(workspace);
  expect(directories.state.creations).toEqual([]);
});

test("does not record a workspace without user approval", () => {
  // arrange
  const registry = Registry.createNull();
  const preflight = {
    requestedPath: "/code/demo",
    canonicalPath: "/code/demo",
    exists: true,
    gitRepository: true,
  };
  const registrar = new WorkspaceRegistrar(
    registry,
    WorkspaceDirectory.createNull({ "/code/demo": preflight }),
    { createWorkspaceId: () => "workspace_demo" },
    Clock.createNull(TIMESTAMP),
  );

  // act
  const registration = () => registrar.register({
    name: "demo",
    preflight,
    createIfMissing: false,
    userApproved: false,
    approvedBySessionId: "session_manager",
  });

  // assert
  expect(registration).toThrow("requires user approval");
  expect(registry.workspaces.list()).toEqual([]);
});
