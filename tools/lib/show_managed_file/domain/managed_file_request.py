"""DOMAIN: one validated request to show a managed file."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.lib.show_managed_file.domain.managed_file_error import ManagedFileError
from tools.lib.show_managed_file.domain.managed_target import ManagedTarget


@dataclass(frozen=True)
class ManagedFileRequest:
    """Normalized intent: either a managed target or one explicit file path.

    Owns the target-versus-file exclusivity rule and the rule that a run id
    only applies to the task target, so no consumer re-checks argparse values.
    """

    root: Path
    target: ManagedTarget | None = None
    explicit_file: str | None = None
    project: str | None = None
    run_id: str | None = None

    def __post_init__(self) -> None:
        if self.target is not None and self.explicit_file is not None:
            raise ManagedFileError("--target and --file are mutually exclusive")
        if self.target is None and self.explicit_file is None:
            raise ManagedFileError("either --target or --file is required")
        if self.run_id and (self.target is None or not self.target.accepts_run_id):
            raise ManagedFileError("--run-id is valid only for the task target")

    @classmethod
    def for_target(
        cls,
        root: Path,
        target: str,
        *,
        project: str | None = None,
        run_id: str | None = None,
    ) -> ManagedFileRequest:
        return cls(
            root=root,
            target=ManagedTarget.parse(target),
            project=project,
            run_id=run_id,
        )

    @classmethod
    def for_file(cls, root: Path, path: str) -> ManagedFileRequest:
        """Explicit paths ignore project and run selection, as they always have."""
        return cls(root=root, explicit_file=path)
