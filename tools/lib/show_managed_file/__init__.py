"""Internal package for the show-managed-file skill.

Layered as `domain/` (targets and requests), `application/` (resolution and
editor launching), and `infrastructure/` (filesystem and editor/process
wrappers). The public entry point stays
`.agents/skills/show-managed-file/scripts/show_managed_file.py`.
"""
