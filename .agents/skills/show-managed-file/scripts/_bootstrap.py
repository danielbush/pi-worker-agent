"""Put the repository root on `sys.path` for direct script execution.

The entry point lives in the skill directory while its implementation lives in
`tools/lib/show_managed_file/`. Running the script directly puts only the
`scripts/` directory on `sys.path`, so the repository root is added here before
the entry point imports the package.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]

if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))
