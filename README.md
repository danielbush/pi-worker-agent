# pi-worker-agent

A work-in-progress Pi extension for managing durable tasks and detached worker agents from Pi.

Development is driven through the managed `pi-worker-agent` project under the configured data root. The current target is manager-orchestrated `plan → implement → review` work through named Pi or Cursor Agent profiles, without a hardcoded demo command.

See:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target data and source architecture.
- [`DESIGN.md`](DESIGN.md) — current outcomes, intent, and implementation plan.
- [`examples/`](examples/) — default policy files for project management, workflow, and coding.

## Install and test

```bash
bun install
bun test
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

The manager uses narrow orchestration tools to register workspaces and management projects, create and associate tasks, query project task status, list live harness model catalogs, delegate jobs explicitly, inspect completed implementation diffs, and merge user-approved work into its authorized project workspace. Manager mode exposes only read and orchestration tools; arbitrary shell commands and file mutations are blocked. The manager may inspect and propose any workspace path, but registration or directory creation requires interactive user approval. SQLite records approved canonical workspace paths, maps `$DATA_ROOT/projects/<directoryName>` entries to durable project metadata, and associates tasks through `projects_tasks`; Markdown `taskid://...` links remain human-facing references. Projects, workspaces, and tasks use bare UUIDs, and manager tools accept unique leading shorthand of at least four characters.

When directly developing this system, the user can run `/development-mode` and confirm the warning to restore unrestricted coding tools for the current session. `/manager-mode` immediately restores the restricted tool set, and every new or reloaded session starts restricted.

Quickly test the boundary with the harmless prompt `Use bash to run pwd. Do not use another tool.` It should be unavailable or blocked after startup and after `/manager-mode`, succeed after confirmed `/development-mode`, then become unavailable again after `/manager-mode`.

The manager compiles `$DATA_ROOT/WORKFLOW.md` (default `work/WORKFLOW.md`). We ship the template as `examples/WORKFLOW.md`; consumers copy it into the data root. That file contains exactly one strictly parsed fenced YAML profile configuration. The example defaults use `pi-sol-high` for planning, implementation, and fixes, and `pi-sol-medium` for review/tests. Additional harness profiles may be configured as overrides; if a selected harness cannot start, stop and continue on a working profile. `worker_create_task` accepts optional purpose-to-profile overrides; these select only harness-native model options and cannot grant capabilities. Delegation verifies one resolved SDK-worker runtime, SDK version/help contract, authentication, model catalog, native options, selected process-isolation strategy, Bun, and runner before creating execution state.

Pi workers use `@earendil-works/pi-coding-agent`; Cursor workers use `@cursor/sdk`. Each SDK runs inside a dedicated, independently cancellable Bun subprocess. Pi uses whole-process OS sandboxing. Cursor currently uses the explicit `NullSandbox` trusted-process strategy because its local-agent stream stalls behind the sandbox runtime HTTP proxy; see `CURSOR_SDK_PROXY_STREAM_STALL` in [`ISSUES.md`](ISSUES.md). Cursor SDK authentication requires `CURSOR_API_KEY` or credentials created by `Cursor.auth.login()` in `~/.cursor/sdk/auth.json`; a Cursor Agent CLI keychain login is not reused by the SDK.

To authenticate the Cursor SDK without putting an API key in the environment, run this from the installed project and complete the browser login:

```bash
bun -e 'import { Cursor } from "@cursor/sdk"; const { email } = await Cursor.auth.login({ apiKeyName: "pi-worker-agent" }); console.log("Logged in", email ?? "");'
```

The SDK stores a named, revocable credential in `~/.cursor/sdk/auth.json`. Confirm that the manager can use it with `worker_list_models` for `cursor-agent`; successful output includes the live Cursor model IDs. Model IDs come from that SDK catalog and are matched exactly. Default example workflow jobs still use Pi.

Planning and review workers are read-only by application-selected tools; implementation workers receive an isolated worktree plus write, edit, and shell tools. Reviews inherit the implementation worktree through their dependency and inspect it without write tools. Process isolation is selected through `HarnessSandboxCatalog`: Pi runs through `@anthropic-ai/sandbox-runtime` (`sandbox-exec` on macOS and Bubblewrap on Linux), while Cursor currently runs with `NullSandbox`. Pi sandbox writes are limited to the implementation worktree, canonical worker-session directory, and a non-canonical private OS temporary directory; common model-provider domains are allowlisted and sensitive credential directories are denied to worker reads. Cursor retains worktree isolation and the same minimal private environment but is trusted same-user code, so its shell tool is not confined by an OS boundary. Selected Pi or Cursor SDK credentials are staged after preflight under a disposable private `HOME` and removed on every settlement path. The child receives only its selected SDK credential and a minimal runtime environment; it does not receive the manager's persistent Cursor/Pi files. Linux hosts running Pi workers must provide `bubblewrap`, `socat`, and `ripgrep`.

Settled worker results trigger a new manager turn. The manager re-reads policy, evaluates the result, and performs the next required transition; the runner itself never invents successor jobs. When an implementation is ready under the workflow, the manager tells the user the job finished and asks whether to merge it into the project. The user can ask to inspect the result and `git diff`, approve the merge, or leave it unmerged. Inspection is read-only. The merge tool independently shows the destination and changed files for interactive approval, requires a completed implementation job and clean matching Git state, commits its worktree changes, and cherry-picks them into the authorized workspace. It aborts a conflicting cherry-pick rather than leaving a partial merge. After accepting the task outcome, the manager uses a narrow completion tool to settle the task.

Verbose status includes the immutable profile fingerprint, trusted capability, harness version, and native invocation snapshot. Inspect any created task from Pi with:

```text
/task-status <task-uuid>
```
