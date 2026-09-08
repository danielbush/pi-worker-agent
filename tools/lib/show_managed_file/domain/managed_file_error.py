"""DOMAIN: the single failure type raised by the show-managed-file subsystem."""

from __future__ import annotations


class ManagedFileError(Exception):
    """A request, resolution, or editor-selection rule was violated.

    The CLI maps this to the `error: <message>` diagnostic and exit status 2.
    """
