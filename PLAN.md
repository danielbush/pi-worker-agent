# Minimal plan for prime-worker

Use the existing Prime Agent CLI as the harness. Run its manager in the consumer codebase and supply a small collection of Markdown instructions. Delegate requested work to native RLM children or an external CLI. Do not build another agent loop, CLI, scheduler, or project-management system.

This plan describes the implementation; it contains no implementation code. Start with instructions and manual demonstrations. Add executable helpers only if those demonstrations expose a concrete gap that instructions and the existing runtime cannot handle.

## What to deliver

| File | Purpose |
| --- | --- |
| README.md | Prerequisites, how to launch from another codebase, how to resume, and a short demonstration. |
| DEFAULTS.md | Human-readable agent aliases, harness choices, exact model selectors, and reasoning defaults by work type. |
| skills/manager/SKILL.md | Interpret requests, delegate, track sessions, route follow-ups, and report results. |
| skills/external-harnesses/SKILL.md | Launch and resume Codex, Cursor, and Claude Code using their installed CLIs. |
| skills/external-harnesses/references/ | One short reference per external harness, containing its verified launch, result, and resume procedure. |

Keep these resources in this repository. Consumers do not need to copy them into their projects or alter their AGENTS.md. Prompt templates are optional conveniences; normal conversation must be enough.

## Launch inside another codebase

1. Install and authenticate Prime Agent through its existing setup. Install and authenticate an external CLI only when using that harness.
2. Start the normal interactive Prime Agent CLI with the consumer codebase as its working directory. Keep normal context and skill discovery enabled so the project's AGENTS.md and skills load as usual.
3. Supply absolute paths to the two skills through Prime Agent's repeatable `--skill` option. Explicitly invoke the manager skill in the initial prompt; loading skill metadata alone does not activate its instructions. The README must give a verified, copyable invocation when implemented.
4. The manager skill reads DEFAULTS.md relative to its own location. No assumption about the consumer's directory layout is needed.
5. Use a persistent, daemon-backed session. Record its identity and use Prime Agent's existing attach or resume commands to return to it. Do not use ephemeral mode for this workflow.

Do not change the working directory to prime-worker to launch it. Do not replace the consumer's system prompt or disable its context files. Explicit skill loading also avoids interfering with the consumer's appended system instructions.

The manager role applies to the root session where the user invoked it. A worker receives an execution assignment, not an instruction to become another manager. Native children inherit resources, so make this distinction explicit in both the manager skill and delegation prompts.

## Manager behavior

Use the user's words as the assignment. Read referenced material and enough surrounding context to understand it, but do not automatically generate a plan, split it into tickets, or invent acceptance criteria. Planning is a work request the user may choose to make.

Markdown headings such as “demo 2” are references to resolve in the supplied document, not a required format. Support arbitrary filenames, prose, and project conventions. Ask a short question only when missing information prevents a faithful assignment.

For each request:

1. Identify the requested work, agent alias, any explicit model/reasoning/harness override, and referenced material.
2. Resolve defaults and locate an existing worker if this is a continuation. If “grok's work” could refer to several assignments, ask which one.
3. Send the user's request with the relevant project path, source reference, necessary context, and expected kind of result. Preserve distinctions between clarifying, planning, implementing, investigating, and reviewing.
4. Record the request and worker identity. Report briefly who is doing what.
5. Receive the worker's result and relay the useful outcome, changed files, verification evidence, or blocker. A successful launch is not completed work.

The manager may inspect context, maintain its records, and coordinate. Delegate substantive planning, investigation, implementation, and review. Workers should follow the consumer's instructions and existing validation conventions. Do not prescribe a ticket format, branch strategy, worktree layout, commit policy, or testing framework.

Work will usually happen one thing at a time, but allow multiple workers to run in the same checkout, even when their edits may interfere. Do not add serialization, locking, collision detection, or automatic isolation.

The manager can also facilitate creating and using a worktree through an available tool such as `wt` when requested. Follow the tool's instructions and launch the worker in the resulting directory, recording that directory with its session. Keep this as an ordinary tool-assisted action; do not add a worktree manager or automatic creation, merging, or cleanup.

## Defaults and overrides

DEFAULTS.md is configuration read by the manager, not a new configuration parser. For each alias, specify its harness, exact model selector, base reasoning level, and any work-type overrides.

Carry forward the PRD's requested planning and implementation defaults: grok “4.6 high” and sol “5.6 medium.” These are user-facing preferences, not verified provider identifiers. During setup, resolve them against the selected harness's available models. Do not invent IDs or silently substitute another model. If unavailable, report that and obtain the user's choice.

Use the alias's base defaults for investigation and review unless configured otherwise. Explicit request overrides win over work-type defaults, which win over alias defaults. A request-time override affects that request; change saved defaults only when asked.

Aliases identify preferences, not one universal session: two requests for sol may need separate workers. Track each worker separately. Follow-ups continue the recorded harness and session; do not accidentally start a replacement because an alias's defaults changed. If a requested model change cannot be applied to the original session, explain the limitation before replacing it.

## Native RLM workers

Use Prime Agent's existing `rlm` capability to create a child with a unique readable name and the resolved model and reasoning level. Resolve exact models through its model discovery capability.

The returned handle confirms admission only. Record the child ID, name, and session directory. Tell the child to send its result to the parent through `agent_message`, with file references where appropriate. Do not treat the spawn return value as an answer or build a polling loop around it.

Continue a retained child using `agent_message`. Recover child identities through `rlm.list_subagents()` after compaction or restoration instead of relying on a Python variable still existing. Keep completed children available for follow-ups.

For “get sol to review grok's work,” give the reviewer the original assignment and the relevant changes or output. Record which implementation request the review concerns. For “get grok to process sol's review,” send the review and the user's instruction to the original grok worker. Its original session identity must remain the same.

## External harnesses

Use ordinary CLI execution from the RLM environment. Do not introduce an SDK integration or a generic adapter framework for the first version.

Each harness reference must document, from the installed version's help or official documentation:

- Executable, authentication prerequisite, and how to select the requested model and supported reasoning setting.
- How to start work in the consumer directory and ensure the worker reads the applicable project instructions, including AGENTS.md when the CLI does not load it itself.
- How to pass the assignment safely without shell interpolation changing its contents.
- How to capture the real session ID, output, exit status, and completion or failure.
- How to send another request to that exact session in the same project.

Prefer the CLI's structured output where available. Persist the returned session identity immediately. A process ID, log filename, or “most recent session” is not an adequate substitute.

A foreground invocation is sufficient initially. If a job outlives the tool call, retain the available execution handle and output location and inspect its actual status before retrying. Do not add a background service just for external workers.

Verify each of Codex, Cursor, and Claude Code independently. If an installed CLI cannot expose or resume an exact session, report that harness's limitation; do not present a fresh session as a continuation. External sessions are not native RLM children and must be resumed through their own CLI.

## Remember requests without imposing a work system

Prime Agent already persists transcripts and its native child registry. Reuse both. Add only a small manager-owned Markdown request record in the root session's artifact directory, outside the consumer's work documents.

For each request, retain a local reference, the user's wording, source references, consumer working directory, resolved harness/model/reasoning, worker identity, current status, result or output location, and links to related requests such as a review. Save a pending entry before launch and update it with the returned identity and subsequent results. These are internal coordination records, not project tickets.

On restoration, read this record and reconcile it with the native child registry or external CLI before claiming work is still running, completed, or resumable. After an interrupted launch with an uncertain outcome, inspect available session records before launching duplicate work.

Resume the original manager session for continuity. A new unrelated manager session does not automatically inherit its children. Do not build cross-session discovery for launch. If the original worker cannot be recovered, state that clearly and ask before starting a replacement.

## Implementation order and proof

1. Write the manager skill, defaults document, and launch instructions. Demonstrate loading them from a separate disposable codebase with its own AGENTS.md and an arbitrarily named work document. Confirm the manager and worker follow those instructions without adding project-management files.
2. Demonstrate a native RLM investigation and an optional planning request. Confirm alias defaults and explicit overrides select the intended available model and reasoning level. Confirm an unavailable selection produces a clear failure.
3. Demonstrate a small implementation, review by another worker, and processing that review in the original implementation session. Check identities and the actual result, not just the manager's description.
4. Detach and reattach the manager, then restore its saved session after a worker restart. Confirm request records remain readable and the retained worker can receive a follow-up. Document any recovery limitation observed.
5. Write and exercise each external harness reference: launch a small request, capture its identity and result, then continue that same session. Repeat a continuation after restoring the manager.
6. Keep the README to the verified setup, launch, request, and resume steps, with a short statement of any unsupported harness capability.

Use these demonstrations as acceptance checks. Do not create a new orchestration test framework. The first native RLM demonstration should happen before spending time on external integrations; the PRD's external-harness coverage is complete only when all three launch-and-resume paths have been verified.

## Basis for this plan

Checked against the local Prime Agent checkout at revision `cd10724fe`: `packages/coding-agent/README.md`, `docs/rlm.md`, `docs/rlm-runtime.md`, and `docs/long-running-agents.md`. These describe explicit skill loading, working-directory context discovery, model selection, native child admission and messaging, persistent registries, and daemon-backed restoration.

External CLI commands and the PRD's model labels have deliberately not been asserted as verified. Verify them during implementation against the versions and accounts actually used. No Prime Agent runtime changes are currently justified by the PRD.
