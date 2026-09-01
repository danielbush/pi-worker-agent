# Examples

This directory contains default, editable examples for configuring a worker-agent installation.

- `PROJECT_MANAGEMENT.md` — default project structure and sequencing policy.
- `WORKFLOW.md` — default task, job, dependency, and review policy.
- `CODING.md` — default coding policy.

Consumers normally copy these files into their data root and customize them, or create their own policies. The symlinks from this maintainer checkout's gitignored `work/` directory exist only so the examples can be maintained and used in place; they are not part of normal usage. Set `DATA_ROOT` or `PI_WORKER_AGENT_DATA_ROOT` to use another data root.
