"""Pytest conftest for the AI engine test suite.

Adds the project root to ``sys.path`` so the test modules can
``import engine.services.<module>`` without a package install.
Mirrors the convention used by setuptools / editable installs.
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
