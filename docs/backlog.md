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

- **feat: Add worker timeout and cancellation controls**
  - Detect workers that remain alive without useful progress and let the manager or user cancel the whole sandboxed process tree.
  - Persist terminal job status, exit information, and a canonical cancellation or timeout event instead of leaving work indefinitely `running`.
  - Make timeout policy configurable without treating every long-running worker as hung.

- **feat: Retry or resume failed workers safely**
  - Add manager operations that either retry from durable task/job context or resume a retained native harness session in the original worktree and sandbox boundary.
  - Preserve the failed attempt, its transcript, and its relationship to the new attempt; allow policy to continue after provider-credit or transient harness failures.
  - Support opening a retained Pi conversation for follow-up without silently granting the resumed agent unrestricted interactive permissions.
  - COMMENT: If a worker runs out of credits and suddenly stops, we need to recover; I'm also curious about loading its Pi session and talking to it.

- **feat: Add a Windows worker sandbox backend**
  - Detect native Windows and fail closed for writable workers until an approved sandbox backend is configured.
  - Investigate and prototype WSL2, Windows Sandbox, and AppContainer against the same filesystem, process, network, path-translation, startup, and operational requirements.
  - Prefer WSL2 if it can reuse the Linux sandbox reliably while denying Windows-drive mounts and unsafe interop; retain a native option if WSL2 provisioning or isolation is unsuitable.
  - COMMENT: WSL2 sounds tempting because we are back in Linux land; investigate all three approaches.

## refactor

- **refactor: Allow multiple worker sessions per job**
  - The architecture permits multiple worker attempts, but `workerSessions.jobId` is currently unique and the runtime assumes one session per job.
  - Make attempts explicit enough for retry and resume while preserving each session's events, native harness identity, and terminal result.
  - Define which attempt determines the job's current status without losing earlier failure evidence.

## fix

- **fix: Reconcile orphaned running jobs after process loss**
  - On manager or host restart, detect persisted `running` jobs whose worker process no longer exists and settle or recover them according to policy.
  - Preserve the absence of a normal exit as a distinct diagnostic rather than fabricating an exit code.
  - Integrate reconciliation with completion notification so the manager can choose retry, resume, cancellation, or abandonment.

- **fix: Preserve complete harness failure diagnostics**
  - Record structured provider or harness error details when exposed, plus process exit code, stderr, and transcript events available before failure.
  - Ensure exceptions during startup, output parsing, cancellation, and cleanup still leave a useful canonical terminal record.
  - Avoid reducing credit exhaustion and other retryable provider failures to an ambiguous generic worker failure.

## test

- **test: Verify a clean installation end to end**
  - Clone the repository into a separate clean location and start it using only the documented setup path.
  - Exercise project and workspace registration, task delegation, the default workflow, status reporting, and worker sandbox startup without relying on this checkout's existing data or configuration.
  - Record each discovered problem as a focused `fix` backlog item before correcting and retesting it.
  - COMMENT: I'll clone this project somewhere and start it up; then we fix any issues.

## chore
