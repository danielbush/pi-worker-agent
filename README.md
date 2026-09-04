# pi-worker-agent

A work-in-progress Pi extension for managing durable tasks and detached worker agents from Pi.

Development is driven through the managed `pi-worker-agent` project under the configured data root. The current target is manager-orchestrated `plan → implement → review` work through named Pi or Cursor Agent profiles, without a hardcoded demo command.

See:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target data and source architecture.
- [`DIAGNOSTICS.md`](DIAGNOSTICS.md) — focused readiness checks and diagnostic exercises.
- [`DESIGN.md`](DESIGN.md) — current outcomes, intent, and implementation plan.
- [`examples/`](examples/) — default policy files for project management, workflow, and coding.

## Install and test

```bash
bun install
bun run test
bun run typecheck
```

Worker-agent data defaults to the project-local, gitignored `work/` directory.
Consumers normally copy the example policies into their data root and customize
them, or create their own. This maintainer checkout symlinks its `work/` policy
files to `examples/` only so the examples can be maintained and used in place;
the symlinks are not part of normal usage. Consumers can choose another data
root by setting `DATA_ROOT`, or set `PI_WORKER_AGENT_DATA_ROOT` when they need
the worker-agent-specific variable to take precedence.

```dotenv
DATA_ROOT=/path/to/worker-agent-data
# or, with precedence over DATA_ROOT:
PI_WORKER_AGENT_DATA_ROOT=/path/to/worker-agent-data
```

List managed projects with the same data-root resolution used by the extension:

```bash
bun run projects
```

The project-local extension entry point is:

```text
.pi/extensions/worker-agent/index.ts
```

## Managed-project development

The current project sequence and vertical-slice walkthrough are stored under:

```text
$DATA_ROOT/projects/pi-worker-agent/
```

`WORKFLOW.md` defines the coding flow the manager applies. Planning and review are defaults, with explicit per-task omissions available:

```text
plan → implement → review
```

The manager uses narrow orchestration tools to verify the structured boundary around `$DATA_ROOT/projects/`, safely manage text files inside registered policy-owned project directories, register workspaces and management projects, create and associate tasks, query project task status, list live harness model catalogs, delegate jobs explicitly, inspect completed implementation diffs, and merge user-approved work into its authorized project workspace. Manager mode exposes only read and orchestration tools; arbitrary shell commands and file mutations are blocked. `worker_manage_project_file` is the explicit exception for policy work: it resolves a registered project, confines text mutations to its non-symlink directory tree, requires exact inspected content for updates and deletes, writes atomically, and returns a diff. The manager may inspect and propose any workspace path, but registration or directory creation requires interactive user approval. SQLite records approved canonical workspace paths, maps `$DATA_ROOT/projects/<directoryName>` entries to durable project metadata, and associates tasks through `projects_tasks`; Markdown `taskid://...` links remain human-facing references. At manager startup, `worker_verify_project_structure` rejects non-directory entries, missing regular `sequence.md` files, and mismatches between those immediate directories and registered metadata before policy-owned contents are interpreted. Projects, workspaces, and tasks use bare UUIDs, and manager tools accept unique leading shorthand of at least four characters.

When directly developing this system, the user can run `/development-mode` and confirm the warning to restore unrestricted coding tools for the current session. `/manager-mode` immediately restores the restricted tool set, and every new or reloaded session starts restricted.

Quickly test the boundary with the harmless prompt `Use bash to run pwd. Do not use another tool.` It should be unavailable or blocked after startup and after `/manager-mode`, succeed after confirmed `/development-mode`, then become unavailable again after `/manager-mode`.

`$DATA_ROOT/WORKFLOW.md` (default `work/WORKFLOW.md`) remains human-readable task, dependency, review, and merge policy. Structured execution prerequisites live in durable `agentProfiles` and `jobTypes` catalogs configured through narrow manager tools. Every active job type has a trusted capability, worktree strategy, and non-null default agent profile. Delegation may explicitly select another active profile for one job; otherwise it uses the job-type default. The job records both catalog IDs, the assignment source, and the exact verified invocation snapshot.

Pi workers use `@earendil-works/pi-coding-agent`; Cursor workers use `@cursor/sdk`. Each SDK runs inside a dedicated, independently cancellable Bun subprocess. Pi uses whole-process OS sandboxing. Cursor currently uses the explicit `NullSandbox` trusted-process strategy because its local-agent stream stalls behind the sandbox runtime HTTP proxy; see `CURSOR_SDK_PROXY_STREAM_STALL` in [`ISSUES.md`](ISSUES.md). Cursor SDK authentication requires `CURSOR_API_KEY` or credentials created by `Cursor.auth.login()` in `~/.cursor/sdk/auth.json`; a Cursor Agent CLI keychain login is not reused by the SDK.

To authenticate the Cursor SDK without putting an API key in the environment, run this from the installed project and complete the browser login:

```bash
bun -e 'import { Cursor } from "@cursor/sdk"; const { email } = await Cursor.auth.login({ apiKeyName: "pi-worker-agent" }); console.log("Logged in", email ?? "");'
```

The SDK stores a named, revocable credential in `~/.cursor/sdk/auth.json`. Confirm that the manager can use it with `worker_list_models` for `cursor-agent`; successful output includes the live Cursor model IDs. Model IDs come from that SDK catalog and are matched exactly. Default example workflow jobs still use Pi.

Planning and review workers are read-only by application-selected tools; implementation workers receive an isolated worktree plus write, edit, and shell tools. Reviews inherit the implementation worktree through their dependency and inspect it without write tools. Process isolation is selected through `HarnessSandboxCatalog`: Pi runs through `@anthropic-ai/sandbox-runtime` (`sandbox-exec` on macOS and Bubblewrap on Linux), while Cursor currently runs with `NullSandbox`. Pi sandbox writes are limited to the implementation worktree, canonical worker-session directory, and a non-canonical private OS temporary directory; common model-provider domains are allowlisted and sensitive credential directories are denied to worker reads. Cursor retains worktree isolation and the same minimal private environment but is trusted same-user code, so its shell tool is not confined by an OS boundary. Selected Pi or Cursor SDK credentials are staged after preflight under a disposable private `HOME` and removed on every settlement path. The child receives only its selected SDK credential and a minimal runtime environment; it does not receive the manager's persistent Cursor/Pi files. Linux hosts running Pi workers must provide `bubblewrap`, `socat`, and `ripgrep`.

Settled worker results trigger a new manager turn. The manager re-reads policy, evaluates the result, and performs the next required transition; the runner itself never invents successor jobs. When an implementation is ready under the workflow, the manager tells the user the job finished and asks whether to merge it into the project. The user can ask to inspect the result and `git diff`, approve the merge, or leave it unmerged. Inspection is read-only and opens the completed job's derived worktree with the executable named by `EDITOR`; an unset or unavailable editor produces a setup error instead of merging. After the user approves in conversation, the merge tool runs without a redundant second confirmation. It requires a completed implementation job and clean matching Git state, commits its worktree changes, and cherry-picks them into the authorized workspace. It aborts a conflicting cherry-pick rather than leaving a partial merge, and removes the detached implementation worktree through Git only after a successful merge. After accepting the task outcome, the manager uses a narrow completion tool to settle the task.

Verbose status includes the immutable profile fingerprint, trusted capability, harness version, and native invocation snapshot. Inspect any created task from Pi with:

```text
/task-status <task-uuid>
```
