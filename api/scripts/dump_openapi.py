#!/usr/bin/env python3
"""Regenerate api/openapi.json from the FastAPI app.

Usage (from api/):
    uv run python scripts/dump_openapi.py

Run this whenever routes or schemas change, and commit the updated file.
Importing app.main does not open any connections (those happen in lifespan),
so a placeholder DATABASE_URL is enough when none is configured.
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Settings require database_url at import time; queries never run here.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://placeholder:placeholder@localhost/placeholder")

sys.path.insert(0, str(REPO_ROOT))

from app.main import app  # noqa: E402

out = REPO_ROOT / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(f"wrote {out} ({len(app.routes)} app routes)")
