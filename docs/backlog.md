# Backlog

## feat

- **feat: Decouple workflow job types from execution permissions**
  - COMMENT: The original intention was that `WORKFLOW.md` defined the job types; loosen the hardcoded connection while still ensuring read-only execution.
  - Current: `JOB_TYPES`, `JobDelegator`, and `toolsForJob()` must stay synchronized with workflow policy.
  - Direction: separate the policy-defined job purpose from a trusted profile such as `read-only`, `code`, or `test`.
  - Keep profiles application-enforced so policy cannot grant arbitrary tools or bypass read-only execution.
  - COMMENT: I'm wondering if we can define the prefer set of job types, workflows, and execution profiles in WORKFLOW.md then the manager agent populates a bunch of tables in the db; these tables are used to provide the appropriate tools to the runner/harness; the risk is the written statement in WORKFLOW.md might get out of sync with the db implementation; AGENTS.md would specify that the change starts in WORKFLOW.md and is "compiled" into the hard rules in the db.  It could even run some tests to verify the correct tooling is provided based on job type.
  - COMMENT: so job types and execution profiles are defined in markdown and compiled to database tables -- no code changes which would result in having to modify the core system; we could provide tools to add these and audit with timestamps, id
  - COMMENT: or we have a configuration file instead of the markdown that defines job types and execution profiles; and this is created instead of the db tables; if the config is not found, then the system stops; it could potentially encode workflows also; the config file reader could check it for integrity issues before letting the system run anything; there are data integrity issues because if the config changes it might make existing recorded values dangling (a deleted execution profile or job type); so maybe we have db tables that hold the config and enforce some referential integrity with the system metadata for tasks/jobs; a flag to delete means old entries can be retained in the system; old tasks/jobs once finished are fossils, so maybe this is overkill, the main thing would be recording enough data for an audit - what capabilities were provided when the job was run? etc

## refactor

## fix

## chore
