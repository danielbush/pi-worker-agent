# Coding

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
- Pure algorithmic, formatting and conversion logic can be functions that are used by classes.
- Use a system similar to James Shore's nullable architecture
  - Classes that directly interact with the outside world (DOM, fs, network) are INFRASTRUCTURE_WRAPPER's
    - code that talks to the outside world (DRIVER_CODE) should be injected into the INFRASTRUCTURE_WRAPPER via .create
      - Example: if an INFRASTRUCTURE_WRAPPER uses Math.random(), then `Math` is the DRIVER_CODE and .create will inject `Math` into the class instance, but the instance will call Math.random() OR define the code that calls Math.random().
    - the NULL_VARIANT is created with a static .createNull(...)
      - it should use EMBEDDED_STUB's to fake the interaction eg fake `Math` and `Math.random` using the above example
    - use .createNull to configure the EMBEDDED_STUB's
  - Classes that directly use INFRASTRUCTURE_WRAPPER's are INFRASTRUCTURE_CONSUMER's; these should also support .createNull(...) which should invoke the .createNull of nested INFRASTRUCTURE_WRAPPER's or INFRASTRUCTURE_CONSUMER's
  - call any INFRASTRUCTURE_WRAPPER or INFRASTRUCTURE_CONSUMER that is used by a class an INFRASTRUCTRUE_DEPENDENCY
  - both types of INFRASTRUCTURE_CODE must support a static .create() that creates production instances and .createNull() that creates NULL_VARIANT's;
  - aim to provide useful defaults for .create and .createNull to avoid having to specify too many parameters
  - in general: find the direct interface with the environment, extract it if not already and make this the INFRASTRUCTURE_WRAPPER, identify the required DRIVER_CODE and stub it out for the NULL_VARIANT (EMBEDDED_STUB's) ;  then make consumers of this wrapper into INFRASTRUCTURE_CONSUMER's; code tests use nulled versions of the code, see testing section below.
  - Constructors should NOT receive null flags, nullable backends, or null-specific state.  The class instance should NEVER know it is using a NULL_VARIANT or not.
  - createNull() configuration is confined to each class’s static createNull().
  - Production DRIVER_CODE is injected by create().
  - DRIVER_CODE invocation and coordination must remain in instance methods and constructors.
  - NULL_VARIANT's use EMBEDDED_STUB's implementing the same driver interfaces.
- Name source files after major domain constructs, such as `job.ts`, `task.ts`, and `worker-session.ts`; avoid generic names such as `types.ts` or `utils.ts`.
- Add concise docstrings that map classes to the constructs and ownership boundaries in `ARCHITECTURE.md`.
- file system layout
  - the filesystem should group subsystems and hide detail in subdirs
  - use a "deep modules" approach to keep the overall skeleton of the app on the surface (major classes, interfaces or other) and push detail and execution logic into subdirs
  - put INFRASTRUCTURE_WRAPPER's into `src/infrastructure/` and group by responsibility within that dir
  - Group all other code in `src/` by responsibility: eg `domain/`, `workflows/`, `demo/`, `storage/`, `harnesses/`, `extension/`, and `runner/`.
  - important constructs (usually coordinators, managers, mediators) should get their own files and sit near the top of the directory hierarchy; lower-level implementation code should be pushed down into subdirectories
  - introduce interfaces where more than one implementation of something may be needed

Specific to this project

- Keep database metadata separate from canonical file-based task data.
- Avoid duplicate sources of truth. For example, `request.md` is the canonical job prompt and is not duplicated as `jobs.instructions`.
- Do not invent extra entities, IDs, or current-state fields without a concrete need. Event logs should record obvious observable harness activity using only IDs the harness provides or that correlation strictly requires.
- In this project, “demo” means a policy-defined workflow through the real architecture against the managed project, not a hardcoded command or a separate fake domain model, registry, runner, or generated project.

## Testing and safety

- code tests - (unit and isolated/non-live integration tests)
  - COMMENT: as above, follow a pattern similar to James Shore's nullable architecture
  - put in `__tests__/` subdirectory collocated with the module under test
  - test must not invoke a real model but should NOT mock or monkey patch
  - test state never behaviour or interactions within the code.  If the state change is hidden, add tracking and emission mechanisms.
  - instantiate class-based code under test with `new`
  - instantiate INFRASTRUCTURE_DEPENDENCY's of class-based code under test with .createNull
  - for value objects, a static .createTestInstance can be used
  - mark sections of the test as: `// arrange`, `// act`, `// assert`
  - use Bun's test runner and TypeScript checker.
  - Be cautious with destructive operations. Never use an unrestricted recursive delete in tests; validate that cleanup targets are known test directories under the OS temporary directory.
  - Run `bun test` and `bun run typecheck` after code changes.

- Live integration tests (tests that interact with their environment, fs, network)
  - should go in project-level `tests/integration/`
  - INFRASTRUCTURE_WRAPPER's should be narrowly tested in isolation against a real or close-to-real resource to verify the contract with the outside world
  - .create should be exercised for INFRASTRUCTURE_CODE in general

## Technology

- Use Bun and follow `bun.md`.
- Keep TypeScript 7. Do not downgrade TypeScript to accommodate Cursor's older language server.

## Communication

- Be concise and answer the question directly.
- Do not bury a simple answer in a long explanation.
- State assumptions and mistakes plainly.
- When reporting changes, summarize what changed and whether tests and type-checking passed.
