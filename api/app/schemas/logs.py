from pydantic import BaseModel


class LogEvent(BaseModel):
    timestamp_ms: int
    metric: str
    value: str
    tags: dict[str, str] = {}
