# Defaults

Configuration read by the manager skill. Edit this file to change saved defaults.
Everything here was resolved against the tools actually installed on this machine
(see "Verified against" at the bottom).

## Aliases

### grok

| Field | Value |
| --- | --- |
| Harness | native (Prime Agent RLM child) |
| Model selector | `openrouter/x-ai/grok-4.6` |
| Base reasoning | `high` |
| Alternative selector | `prime-inference/x-ai/grok-4.6` (same model, different provider) |

Work-type overrides: none. Planning, implementation, investigation, and review all
use `high`.

### sol

| Field | Value |
| --- | --- |
| Harness | native (Prime Agent RLM child) |
| Model selector | `openai-codex/gpt-5.6-sol` |
| Base reasoning | `medium` |
| Alternative selectors | `openrouter/openai/gpt-5.6-sol`, `prime-inference/openai/gpt-5.6-sol` |

Work-type overrides: none. Planning, implementation, investigation, and review all
use `medium`.

These carry forward the PRD's requested defaults: grok "4.6 high" and sol "5.6 medium".

## Reasoning levels

Prime Agent accepts: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
A level must be valid for the resolved child model or the spawn fails.

## Precedence

1. An override stated in the request ("get sol 5.6 xhigh to ...").
2. A work-type override for that alias in this file.
3. The alias's base defaults above.

A request-time override applies to that request only. Change this file only when the
user asks to change saved defaults.

## Harness selection

`native` unless the request names an external harness ("get codex to ...",
"get grok to implement demo 2 with cursor"). External harnesses are described in
`skills/external-harnesses/SKILL.md`, which owns their own model naming — an
external harness does not use the selectors above.

External harness model equivalents for these aliases:

| Alias | Codex (`-m`) | Cursor (`--model`) | Claude Code (`--model`) |
| --- | --- | --- | --- |
| grok | not available | `cursor-grok-4.6-high` | not available |
| sol | `gpt-5.6-sol` + `-c model_reasoning_effort="medium"` | `gpt-5.6-sol-medium` | not available |

If a request pairs an alias with a harness that cannot serve it, say so and ask
which to change. Do not substitute a different model.

## Verified against

- Prime Agent `0.9.3`; selectors returned by `rlm.find_models("grok-4.6")` and
  `rlm.find_models("gpt-5.6-sol")` on 2026-09-09.
- `codex-cli 0.153.4`, `cursor-agent 2026.09.02-c22c1a3`, `claude 2.1.266`.

Model availability follows the machine's active credentials. Re-resolve with
`rlm.find_models()` if a spawn reports the selector as unavailable; report the
failure and ask the user rather than choosing a substitute.
