# Issues

## CURSOR_SDK_PROXY_STREAM_STALL

- **Date identified:** 2026-09-03
- **Status:** Open; worked around with the explicit Cursor `NullSandbox` strategy
- **Affected versions:** `@cursor/sdk` 1.0.30 and `@anthropic-ai/sandbox-runtime` 0.0.26; the same stall was reproduced experimentally with sandbox runtime 0.0.75

Cursor SDK local-agent runs do not progress through the HTTP/HTTPS proxy created by `@anthropic-ai/sandbox-runtime`. Authentication, model discovery, `Agent.create()`, and `agent.send()` complete. The run emits `RUNNING`, then `run.stream()` receives no model, assistant, or tool events and eventually ends with `Connection failed repeatedly` (about 6 minutes 47 seconds in the observed managed job).

The failure was narrowed with phase telemetry around worker readiness, `Agent.create()`, `agent.send()`, `run.stream()`, and `run.wait()`:

- The same Grok 4.5 High SDK probe without a proxy completed successfully in about 10 seconds.
- The same probe routed only through the sandbox runtime's authenticated HTTP proxy, without filesystem sandboxing, stalled after `RUNNING`.
- Full OS sandboxing stalled at the same phase.
- Sandbox debug logs showed successful connections to `api.cursor.com` and `api2.cursor.sh` and no denied destination.
- A temporary broad diagnostic allowlist produced the same stall, ruling out a missing domain as the cause observed here.
- Enabling local binding and trying the newer sandbox-runtime proxy did not change the behavior.
- `api2direct.cursor.sh` is not a usable substitute backend for this SDK flow; account requests returned `The request could not be routed`.
- The requested canary worktrees remained unchanged in both failed managed jobs.

This points to an interoperability problem between the Cursor SDK's long-lived local-agent stream and the sandbox runtime HTTP proxy, rather than authentication, model availability, filesystem policy, or the domain allowlist. The package published for `@cursor/sdk` is bundled; `opensrc` resolves its repository metadata to the public `cursor/cursor` repository, which does not contain the SDK implementation source needed to diagnose the transport further.

The current workaround selects process isolation per harness: Pi remains inside the whole-process OS sandbox, while Cursor SDK uses the explicit `NullSandbox` strategy (`mode: "none"`). Cursor still receives an isolated git worktree, a private minimal environment and credential home, immutable execution metadata, a restricted SDK tool list, and canonical event recording. This is Firstmate-style trusted same-user process isolation, not an OS security boundary: Cursor's shell tool can technically access paths outside its worktree.

Remove the workaround only after a live Cursor SDK run can stream model and tool events through a domain-restricted whole-process sandbox without weakening the network boundary.

- **COMMENT (2026-09-03):** What about “Docker sandbox” and Docker container strategies?
