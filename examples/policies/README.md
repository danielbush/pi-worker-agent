# Example policies

These are the maintainer's real policy files, shipped as examples.

- `WORKFLOWS.md` — model profiles, preferred roles, job types, workflows,
  approval rules.
- `CODE.md` — GLOBAL coding standards the manager includes in worker
  briefs. Keep it generic: project-specific standards (toolchains,
  verification commands, layout) belong in a `CODE.md` at each project's own
  workspace root, which overrides this file.

## Use your own

The manager reads policies from `policies/` at the repository root, which is
gitignored except for `.gitkeep`. Either copy these examples and edit them:

```sh
cp examples/policies/WORKFLOWS.md examples/policies/CODE.md policies/
```

or write your own from scratch. `policies/WORKFLOWS.md` is required before the
manager can run work; `policies/CODE.md` is optional but recommended — without
it, workers get no coding-standards guidance.
