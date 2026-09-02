# Backlog

## feat

- **feat: Decouple workflow job types from execution permissions**
  - COMMENT: The original intention was that `WORKFLOW.md` defined the job types; loosen the hardcoded connection while still ensuring read-only execution.
  - Current: `JOB_TYPES`, `JobDelegator`, and `toolsForJob()` must stay synchronized with workflow policy.
  - Direction: separate policy-defined job purpose and harness-native worker profiles from trusted capability profiles such as `read-only`, `code`, or `test`.
  - Keep capability profiles application-enforced so policy cannot grant arbitrary tools or bypass read-only execution.
  - COMMENT: I'm wondering if we can define the prefer set of job types, workflows, and execution profiles in WORKFLOW.md then the manager agent populates a bunch of tables in the db; these tables are used to provide the appropriate tools to the runner/harness; the risk is the written statement in WORKFLOW.md might get out of sync with the db implementation; AGENTS.md would specify that the change starts in WORKFLOW.md and is "compiled" into the hard rules in the db.  It could even run some tests to verify the correct tooling is provided based on job type.
  - COMMENT: so job types and execution profiles are defined in markdown and compiled to database tables -- no code changes which would result in having to modify the core system; we could provide tools to add these and audit with timestamps, id
  - COMMENT: or we have a configuration file instead of the markdown that defines job types and execution profiles; and this is created instead of the db tables; if the config is not found, then the system stops; it could potentially encode workflows also; the config file reader could check it for integrity issues before letting the system run anything; there are data integrity issues because if the config changes it might make existing recorded values dangling (a deleted execution profile or job type); so maybe we have db tables that hold the config and enforce some referential integrity with the system metadata for tasks/jobs; a flag to delete means old entries can be retained in the system; old tasks/jobs once finished are fossils, so maybe this is overkill, the main thing would be recording enough data for an audit - what capabilities were provided when the job was run? etc
  - Default assignments should select named worker profiles containing each harness's native model and options; tasks can select another configured profile per job purpose.
  - Do not force a standard model/effort mapping across harnesses; expose and validate native catalogs and configuration while snapshotting exact resolved values on each job.
  - Keep trusted capabilities separate from worker profiles so task overrides cannot escalate permissions.
  - COMMENT: whilst the default is set by the workflow, I should be able to override it when setting the task, so the task should support overrides.

- **feat: Expose concise live worker activity**
  - Add a narrow manager query that efficiently tails recent canonical events for a task's active or selected job without requiring arbitrary filesystem access.
  - Offer `/task-status <task-id> --activity` for timestamps and compact recent activity while keeping the default status limited to job ID, title, and status.
  - Let the manager summarize recent tool, test, and assistant activity; avoid loading or printing the entire `events.jsonl`.
  - COMMENT: worth making a command or documenting how to read events.jsonl efficiently so the manager can give an update?

- **feat: Add a Windows worker sandbox backend**
  - Detect native Windows and fail closed for writable workers until an approved sandbox backend is configured.
  - Investigate and prototype WSL2, Windows Sandbox, and AppContainer against the same filesystem, process, network, path-translation, startup, and operational requirements.
  - Prefer WSL2 if it can reuse the Linux sandbox reliably while denying Windows-drive mounts and unsafe interop; retain a native option if WSL2 provisioning or isolation is unsuitable.
  - COMMENT: WSL2 sounds tempting because we are back in Linux land; investigate all three approaches.

## refactor

## fix

## test

- **test: Verify a clean installation end to end**
  - Clone the repository into a separate clean location and start it using only the documented setup path.
  - Exercise project and workspace registration, task delegation, the default workflow, status reporting, and worker sandbox startup without relying on this checkout's existing data or configuration.
  - Record each discovered problem as a focused `fix` backlog item before correcting and retesting it.
  - COMMENT: I'll clone this project somewhere and start it up; then we fix any issues.

## chore
