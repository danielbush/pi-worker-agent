# Backlog

## feat

- **External harnesses as stage runners**
  - Let a stage name a *runner* — what executes it — instead of always spawning
    an in-process subagent.
    - `rlm` — current behaviour, a Prime Agent subagent.
    - `prime` — a separate `prime-agent -p --autonomous` process. Its
      `--autonomous-gate "<test cmd>"` means the stage isn't done until the
      gate passes. OpenRouter works as `--model openrouter/<id>`; codex is
      `--model openai/gpt-5.1-codex`.
    - `cursor` — `cursor-agent`. Flags unverified.
  - Mechanically it's the same shape, `rlm()` swapped for `bash()`:
    - `bash(command)` takes a command string only — no `cwd`. Put the `cd` in
      the command, and `shlex.quote` the prompt.
    - `h = bash(cmd)` without `await` returns a live handle. Poll with
      `h.poll()`, `h.tail()`, `h.kill()`. Never block the kernel on a stage.
  - Still RLM — orchestration stays code in a cell, and `bash()` is first-class
    in the REPL. Recursion by subprocess rather than by subagent.
  - But we lose the Prime-native features:
    - No `agent_message` / `agent_observe` — can't converse with a worker
      mid-run or watch its reasoning. Exit code and files only.
    - No session tree — depth, parent, siblings aren't tracked, so
      `rlm.list_subagents()` and the TUI don't see it.
    - No shared harness state — the worker gets no memories, skills, or specs.
      Everything it needs goes in the prompt or in files.
    - No cost or token accounting across the tree.
  - Worth it for a different agent's judgement, or a hard unattended gate.
    Possible because stages already pass results by file — live handles between
    stages would make this impossible.
