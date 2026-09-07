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
- Strive to establish and document a clear data model for the system using a file like ARCHITECTURE.md.  This is primary and comes before any code. Modelling includes the typed representations of the data from enums to value objects to data structures to persisted structures that the coding system interfaces directly with eg database tables.  Ask: what are the inputs into the system/sub-system, how are they transformed, stored, emitted.  Code around these data-structures is secondary and can always be rewritten or improved.
- Treat related configuration values as one domain concept rather than passing independent primitives throughout the system.
  - Represent a coherent configuration with an immutable value object when it owns validation, normalization, derived values, or mappings.
  - Keep each configuration fact in one place. Consumers must ask the owning value object for derived values rather than reconstructing paths, names, identifiers, or defaults.
  - Instantiate configuration value objects once at a composition root and inject them into consumers.
  - Avoid duplicating configuration literals or branching on their physical representation outside the owning value object.
  - Prefer semantic operations such as `rootFor(collection)` or `isReservedDirectory(name)` over exposing enough primitives for consumers to reproduce the logic.
  - Do not create value objects for unrelated values or simple scalars that have no shared rules or behavior.
- Use classes for lifecycle, persistence, orchestration, and other stateful services.
- Pure algorithmic, formatting and conversion logic can be functions that are used by classes.
- The class-vs-function test: a class must earn its name with state, an injected
  dependency, a lifecycle, or a credible second implementation. If a construct
  has none of these, it is a function — even at a boundary. Keep the boundary
  as a module (public functions, private helpers), not as a wrapper class
  around what is really one operation. Do not invent a value object for a
  result that carries no validation, normalization, or behaviour.
- Prefer polymorphism and composition over branching on implementation identities. Consumers of a shared abstraction should not reconstruct provider-specific behavior with `if` or `switch` statements on names such as a harness, backend, or vendor. Put variation behind the owning interface or adapter, and persist or pass shared data in an implementation-neutral shape. Discriminant checks remain appropriate at composition, validation, serialization, and protocol-routing boundaries when the identity itself is the data being handled.
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
  - Define INFRASTRUCTURE_WRAPPER boundaries around external systems or APIs, not around each application use case. Prefer one cohesive filesystem, database, process, or network wrapper over many wrappers that repeat the same environmental calls.
  - Design a wrapper's public API around what the application needs. It need not mirror, generalize, or expose the underlying driver API; it should provide cohesive application-facing operations and values.
  - DRIVER_CODE and driver interfaces are private implementation details of the wrapper. Consumers receive the wrapper, never its driver, and should not need to understand how its production or null behavior is implemented.
  - A wrapper may coordinate driver calls to fulfil its application-facing contract. Domain interpretation such as project listing rules, validation policy, filtering, or workflow sequencing belongs in an INFRASTRUCTURE_CONSUMER that uses the wrapper.
  - Keep wrappers cohesive rather than universal. Consumers should depend on only the wrapper capabilities they require, while related consumers may share one wrapper instance and one NULL_VARIANT state.
  - Do not leak environment-library representations such as filesystem directory-entry or stat objects. Wrappers translate them into small application-owned values before returning them.
  - In general: identify the direct interface with the environment and make that the INFRASTRUCTURE_WRAPPER. Identify and inject its DRIVER_CODE, provide an EMBEDDED_STUB for the NULL_VARIANT, and make domain-aware users of that wrapper INFRASTRUCTURE_CONSUMER's; code tests use nulled versions of the wrapper as described below.
  - Constructors should NOT receive null flags, nullable backends, or null-specific state.  The class instance should NEVER know it is using a NULL_VARIANT or not.
  - createNull() configuration is confined to each class’s static createNull().
  - Production DRIVER_CODE is injected by create().
  - Static `create()` and `createNull()` methods are shallow, declarative composition roots. Their bodies should make the object graph obvious at a glance: instantiate the class, connect named dependencies or named driver objects, and return it.
  - Do not define operational callbacks, filesystem traversal, network calls, credential handling, control flow, data transformation, or lifecycle behavior inside `create()` or `createNull()`. If a factory needs more than straightforward constructor wiring, extract the behavior into a named driver, adapter, instance method, or function and inject that name.
  - Production and null driver implementations should be named so factory wiring reads as composition rather than implementation. Keep DRIVER_CODE invocation and coordination out of factories and in the owning driver, adapter, instance method, or constructor.
  - NULL_VARIANT's use EMBEDDED_STUB's implementing the same driver interfaces.
- Give each major class or value object its own source file named after that construct, such as `ProjectCollectionPaths` in `project-collection-paths.ts` (TS/JS) or `project_collection_paths.py` (Python). Name files after the primary domain construct rather than a broad topic, and avoid generic names such as `types.ts`/`utils.py`.
- Add concise docstrings that map classes to the constructs and ownership boundaries in `ARCHITECTURE.md`.
- file system layout
  - the filesystem should group subsystems and hide detail in subdirs
  - use a "deep modules" approach to keep the overall skeleton of the app on the surface (major classes, interfaces or other) and push detail and execution logic into subdirs
  - put only INFRASTRUCTURE_WRAPPER's, adapters, and private driver details into `src/infrastructure/`, grouped by responsibility within that directory
  - place INFRASTRUCTURE_CONSUMER's with their application responsibility, such as `workflows/`, even when they rely heavily on filesystem, database, process, or network services
  - Group all other code in `src/` by responsibility: eg `domain/`, `workflows/`, `demo/`, `storage/`, `harnesses/`, `extension/`, and `runner/`.
  - three-way classification for every construct: DOMAIN (what the program is
    about; encodes its rules), INFRASTRUCTURE (talks to the outside world), and
    APPLICATION/WORKFLOW (orchestrates domain + infrastructure for a use case).
    Group files by these categories.
  - **Work with the structure the codebase already has.** Do not impose this
    layout over an existing, differently-organised codebase. Apply it to new
    code, and to existing code only when the user asks for a refactor.
  - important constructs (usually coordinators, managers, mediators) should get their own files and sit near the top of the directory hierarchy; lower-level implementation code should be pushed down into subdirectories
  - introduce interfaces where more than one implementation of something may be needed

Specific to this project

- Keep database metadata separate from canonical file-based task data.
- Avoid duplicate sources of truth. For example, `request.md` is the canonical job prompt and is not duplicated as `jobs.instructions`.
- Do not invent extra entities, IDs, or current-state fields without a concrete need. Event logs should record obvious observable harness activity using only IDs the harness provides or that correlation strictly requires.
- In this project, “demo” means a policy-defined workflow through the real architecture against the managed project, not a hardcoded command or a separate fake domain model, registry, runner, or generated project.

## Testing and safety

- code tests - (unit and sociable unit tests)
  - COMMENT: as above, follow a pattern similar to James Shore's nullable architecture
  - put in `__tests__/` subdirectory collocated with the module under test
  - test must not invoke a real model but should NOT mock or monkey patch
  - test state never behaviour or interactions within the code.  If the state change is hidden, add tracking and emission mechanisms.
  - instantiate class-based code under test with `new`
  - instantiate INFRASTRUCTURE_DEPENDENCY's of class-based code under test with .createNull
  - for value objects, a static .createTestInstance can be used
  - mark sections of the test as: `// arrange`, `// act`, `// assert`
  - Be cautious with destructive operations. Never use an unrestricted recursive delete in tests; validate that cleanup targets are known test directories under the OS temporary directory.
  - Run the code tests and static checks after code changes.

- Live integration tests (tests that interact with their environment, filesystem, network, credentials, or external processes)
  - keep each test narrowly focused on one `INFRASTRUCTURE_WRAPPER` contract against a real or close-to-real resource
  - selectively exercise a small number of production `.create()` composition roots only far enough to verify that their infrastructure dependencies are wired correctly
  - do not use broad live integration suites as routine verification; invoke each required live test explicitly
  - do not exercise complete workflows, unrelated infrastructure, or every `.create()` method merely to increase integration coverage

## Communication

- Be concise and answer the question directly.
- Do not bury a simple answer in a long explanation.
- State assumptions and mistakes plainly.
- When reporting changes, summarize what changed and whether tests and type-checking passed.

## Python

- Manage Python and dependencies with **uv**: `uv add` / `uv add --dev` for
  dependencies, `uv run` for anything executable. Never pip, never edit
  `pyproject.toml` dependency lists by hand.
- Lint and format with **ruff**: `uv run ruff check`, `uv run ruff format`.
  Fix real diagnostics; suppress only with a per-case justification.
- Type-check with **ty**: `uv run ty check`. Type new code; fix diagnostics
  rather than broad-ignore them.
- Test with **pytest**, not stdlib `unittest`. Keep the arrange/act/assert
  structure and the testing-and-safety rules above; express tests with pytest
  fixtures, plain `assert`, and `tmp_path` rather than `unittest.TestCase`
  classes and `tempfile` boilerplate.
- Modules use snake_case (kebab-case file rules from other languages do not
  translate to Python imports).

## Language mappings

The rules above are language-neutral in intent. Apply them per language with
these mappings; add a row when a new language actually shows up, not before.

| Concept | TS/JS | Python |
|---|---|---|
| Source files | kebab-case, `src/` tree | snake_case modules; the project's library root plays the `src/` role (or `src/` if present) |
| Tests | `__tests__/` collocated with the module | `tests/` mirroring the source layout, pytest |
| Null-variant factory | `.createNull(...)` | `.create_null(...)` |
| Driver to inject for randomness | `Math.random` | `random` |
| Dependency/toolchain runner | npm scripts | `uv run` |
