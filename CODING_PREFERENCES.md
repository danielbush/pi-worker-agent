# Coding preferences

## Working style

- Work in small, testable increments toward the current target architecture.
- Prefer a direct implementation over speculative compatibility layers or temporary parallel models.
- This is a new project: do not preserve obsolete prototypes, schemas, APIs, or tests unless explicitly requested.
- Distinguish obsolete implementations from required architectural constructs. Replace a fake implementation without accidentally deleting a construct the target still needs, such as the detached runner.
- Re-read user-managed planning documents before acting; they may have changed since the previous turn.
- Ask when a material requirement is ambiguous instead of adding an unrequested concept.

## Design and structure

- Prefer OOP composition: small stateful “Lego bricks” with clear ownership and injected dependencies.
- Use classes for lifecycle, persistence, orchestration, and other stateful services.
- Keep pure formatting and conversion logic as functions.
- Name source files after major domain constructs, such as `job.ts`, `task.ts`, and `worker-session.ts`; avoid generic names such as `types.ts` or `utils.ts`.
- Group code by responsibility: `domain/`, `workflows/`, `demo/`, `storage/`, `harnesses/`, `extension/`, and `runner/`.
- Add concise docstrings that map classes to the constructs and ownership boundaries in `ARCHITECTURE.md`.
- Keep database metadata separate from canonical file-based task data.
- Avoid duplicate sources of truth. For example, `request.md` is the canonical job prompt and is not duplicated as `jobs.instructions`.
- Do not invent extra entities, IDs, or current-state fields without a concrete need. Event logs should record obvious observable harness activity using only IDs the harness provides or that correlation strictly requires.
- In this project, “demo” means a hardcoded workflow through the real architecture, not a separate fake domain model, registry, or runner.

## Testing and safety

- Put unit or non-live integration tests in the repository-level `__tests__/` directory.
- Test state never behaviour.
- Mark sections of the test as: `// arrange`, `// act`, `// assert`
- Live integration tests (tests that interact with their environment, fs, network) should go in `tests/integration/`.
- Use Bun's test runner and TypeScript checker.
- Automated tests must not invoke a real model; use recorded fixtures or deterministic adapters.
- Be cautious with destructive operations. Never use an unrestricted recursive delete in tests; validate that cleanup targets are known test directories under the OS temporary directory.
- Run `bun test` and `bun run typecheck` after code changes.

## Technology

- Use Bun and follow `bun.md`.
- Keep TypeScript 7. Do not downgrade TypeScript to accommodate Cursor's older language server.

## Communication

- Be concise and answer the question directly.
- Do not bury a simple answer in a long explanation.
- State assumptions and mistakes plainly.
- When reporting changes, summarize what changed and whether tests and type-checking passed.
