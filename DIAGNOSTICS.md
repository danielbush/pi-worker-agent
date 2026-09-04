# Diagnostics

Use these checks to verify and diagnose the `pi-worker-agent` system itself. This is maintainer documentation, not a policy file under `DATA_ROOT`.

Prefer the smallest check that answers the current question. The manager defaults to quick, non-live checks and stops when they provide enough confidence that the system is probably ready. It must not escalate to model probes or real-worker diagnostics merely because they are available.

Do not run broad live integration suites as routine verification. A diagnostic that launches a real worker must be explicit, focused, and user-observed.

## Quick readiness checks — default

Run these non-live, non-mutating checks first:

1. Call `worker_verify_project_structure`.
   - Expect every immediate project directory to be registered and contain `sequence.md`.
   - Stop on any structural error rather than interpreting project files.
2. Call `worker_list_projects`.
   - Confirm the reported `DATA_ROOT` and `PROJECT.md` are the intended installation.
3. Read the active `PROJECT.md` and, before task or job work, `WORKFLOW.md`.
   - For coding work, also read `CODE.md` and the target codebase instructions.
4. Call `worker_list_agent_profiles` and `worker_list_job_types`.
   - Confirm required profiles and job types are active.
   - Confirm every active job type has a trusted capability, worktree strategy, and active default profile.
5. When preparing an actual delegation, confirm the task has an authorized workspace and required dependencies have completed.
6. When verifying the codebase in development mode, run the default isolated code tests and static checks:

   ```sh
   bun run test
   bun run typecheck
   ```

   `bun run test` changes into `src/` before discovery. It does not include project-level integration tests, retained worktrees, model calls, network access, or real credentials.

If these checks pass and there is no specific warning or higher-confidence requirement, report that the system is probably ready and do not run a longer diagnostic.

A system-level setup verifier may eventually combine these quick checks. It should not silently include network access, model probes, configuration mutations, or real worker launches.

## Deciding whether to run more

Choose a targeted or extended diagnostic only when its additional evidence answers a concrete question, such as:

- a quick check failed or produced an ambiguous result;
- the relevant database migration, harness adapter, or delegation path changed;
- a new installation or model configuration has not yet been exercised;
- an incident points to a particular infrastructure boundary;
- the user asks for stronger confidence or a specific demonstration.

Do not run every available diagnostic. State what the chosen diagnostic will exercise before starting it, especially when it launches a real model or creates durable records.

Targeted checks include:

- `worker_list_models` when current model availability is relevant; this is a live harness probe, not a default startup check;
- one explicitly named integration test for the `INFRASTRUCTURE_WRAPPER` under investigation;
- one extended real-worker diagnostic, such as the profile-selection exercise below, when the full path needs evidence.

The tests under `tests/integration/` are opt-in real-resource contract checks. Run one only by changing into its directory and naming the individual file:

```sh
(cd tests/integration && bun test <specific-test>.test.ts)
```

Most currently use temporary local filesystem directories or SQLite databases. The Git tests spawn the local Git executable, and the worker-sandbox test exercises platform sandboxing; those process/platform boundaries are more environment-sensitive than the default suite. None of the current integration files calls a remote model or network service. Do not run bare `bun test` from the repository root or the whole integration directory as routine verification.

## Extended diagnostic — execution profile selection

This is not a default readiness check. It takes longer, launches real workers, and creates durable diagnostic records. Run it only when the profile-selection and retirement path specifically needs end-to-end evidence.

This focused real-worker diagnostic verifies that a manager can select an explicit agent profile for one job, otherwise use the job type's default, and preserve both jobs after configuration is retired.

Call `worker_prepare_diagnostic_project` and use the returned conventional `$DATA_ROOT/.test/system-diagnostics/workspace`; do not ask the user to choose a workspace or use a production project. Jobs must be read-only, must not run tests, and should only read its `README.md` and return a one-sentence identification. The user observes the manager tool output and decides whether the result is accepted.

### Arrange

1. Create two temporary active Pi agent profiles using a currently working model:
   - one profile for explicit selection;
   - one profile for the job-type default.
2. Create a temporary active job type with:
   - capability `read-only`;
   - worktree strategy `workspace`;
   - the default Demo profile as `defaultAgentProfileId`.
3. Create or reuse a diagnostic task associated with the returned `system-diagnostics` test project and authorized workspace.

### Explicit profile

Delegate the temporary job type with `agentProfileId` set to the explicit Demo profile.

Inspect it with `worker_task_status` in verbose mode. Expect:

- `agentProfileId` is the explicitly supplied profile;
- `agentProfileSelectionSource` is `explicit`;
- capability remains `read-only` from the job type;
- the immutable profile options, fingerprint, harness version, and native invocation are present;
- the worker completes with the expected one-sentence workspace identification.

### Job-type default

Delegate the same temporary job type again without `agentProfileId`.

Inspect it with `worker_task_status` in verbose mode. Expect:

- `agentProfileId` is the job type's default profile;
- `agentProfileSelectionSource` is `job-type-default`;
- capability remains `read-only`;
- the immutable execution snapshot is present;
- the worker completes with the same expected identification.

### Retirement and history

1. Retire the temporary job type.
2. Retire both temporary profiles.
3. Attempt to set a retired profile as a job-type default; expect it to fail before mutation.
4. Attempt another delegation using the retired job type; expect it to fail before launch.
5. Inspect the task again; expect both completed jobs and their immutable snapshots to remain readable.

Retired Demo records remain durable because historical jobs reference them. Do not delete them merely to clean up the diagnostic.

### Result from Vertical slice 14

The diagnostic was exercised against task `a9666661-f8e6-4e8a-9f40-c985907b9d68`:

- Explicit job `job_f10eb263-70f8-4e54-9005-02cdf5ac91e3` selected `slice14-demo-override` and recorded source `explicit`.
- Default job `job_54387417-a911-4465-a014-1e57572324d8` selected `slice14-demo-default` and recorded source `job-type-default`.
- Both jobs used capability `read-only`, retained complete execution snapshots, and returned: `The workspace identifies itself as Worker sandbox test.`
- After the temporary configuration was retired, invalid default assignment and delegation attempts failed while both completed jobs remained readable.
