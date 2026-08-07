from typing import Any

from pydantic import BaseModel


class LatestMetricsResponse(BaseModel):
    metrics: dict[str, float]


class MetricsQueryResponse(BaseModel):
    interval: str
    auto_downsampled: bool
    series: dict[str, dict[str, list[Any]]]
    truncated: bool = False
