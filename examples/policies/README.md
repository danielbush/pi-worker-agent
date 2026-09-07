# Example policies

These are the maintainer's real policy files, shipped as examples.

- `WORKFLOWS.md` — model profiles, preferred roles, job types, workflows,
  approval rules.
- `CODE.md` — coding standards the manager includes in worker briefs.

## Use your own

The manager reads policies from `policies/` at the repository root, which is
gitignored except for `.gitkeep`. Either copy these examples and edit them:

```sh
cp examples/policies/WORKFLOWS.md examples/policies/CODE.md policies/
```

or write your own from scratch. `policies/WORKFLOWS.md` is required before the
manager can run work; `policies/CODE.md` is optional but recommended — without
it, workers get no coding-standards guidance.

The maintainer's own setup symlinks these examples into `policies/`, so edits
to the live files are also edits to the examples:

```sh
ln -s ../examples/policies/WORKFLOWS.md policies/WORKFLOWS.md
ln -s ../examples/policies/CODE.md policies/CODE.md
```
