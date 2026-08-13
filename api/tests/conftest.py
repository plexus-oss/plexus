import os

# Settings() is constructed at import time and requires DATABASE_URL.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6390")
