import { expect, test } from "bun:test";
import { ManagerPermissions } from "../manager-permissions.ts";

const CODING_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "write",
  "edit",
  "worker_register_workspace",
  "worker_verify_project_structure",
  "worker_list_projects",
  "worker_register_project",
  "worker_add_task_to_project",
  "worker_project_tasks",
  "worker_task_status",
  "worker_create_task",
  "worker_complete_task",
  "worker_inspect_job_changes",
  "worker_open_job_worktree",
  "worker_merge_job",
  "worker_list_models",
  "worker_delegate_job",
];

test("defers action methods until the Pi session starts", () => {
  // arrange
  const permissions = ManagerPermissions.createNull(CODING_TOOLS);

  // act
  permissions.register();

  // assert
  expect(permissions.state.activeTools).toEqual(CODING_TOOLS);
});

test("locks the manager to read and orchestration tools", () => {
  // arrange
  const permissions = ManagerPermissions.createNull(CODING_TOOLS);

  // act
  permissions.register();
  permissions.startSession();

  // assert
  expect(permissions.state).toEqual({
    mode: "manager",
    activeTools: [
      "read",
      "grep",
      "find",
      "ls",
      "worker_register_workspace",
      "worker_verify_project_structure",
      "worker_list_projects",
      "worker_register_project",
      "worker_add_task_to_project",
      "worker_project_tasks",
      "worker_task_status",
      "worker_create_task",
      "worker_complete_task",
      "worker_inspect_job_changes",
      "worker_open_job_worktree",
      "worker_merge_job",
      "worker_list_models",
      "worker_delegate_job",
    ],
  });
  expect(permissions.blockedToolCall("bash")).toEqual({
    block: true,
    reason: "bash is unavailable in manager mode; the user must explicitly enable development mode",
    terminate: true,
  });
  expect(permissions.blockedToolCall("worker_delegate_job")).toBeUndefined();
});

test("requires an explicit mode change before restoring coding tools", () => {
  // arrange
  const permissions = ManagerPermissions.createNull(CODING_TOOLS);
  permissions.register();
  permissions.startSession();

  // act
  permissions.enableDevelopment();

  // assert
  expect(permissions.state).toEqual({
    mode: "development",
    activeTools: CODING_TOOLS,
  });
  expect(permissions.blockedToolCall("bash")).toBeUndefined();

  // act
  permissions.lock();

  // assert
  expect(permissions.state.mode).toBe("manager");
  expect(permissions.state.activeTools).not.toContain("bash");
});

test("can restore coding tools after loading from an already restricted tool set", () => {
  // arrange
  const permissions = ManagerPermissions.createNull(["read", "worker_delegate_job"]);
  permissions.register();
  permissions.startSession();

  // act
  permissions.enableDevelopment();

  // assert
  expect(permissions.state.activeTools).toEqual([
    "read",
    "worker_delegate_job",
    "bash",
    "write",
    "edit",
  ]);
});
