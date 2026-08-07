from pydantic import BaseModel


class FleetHealthResponse(BaseModel):
    sources_total: int
    sources_online: int


class FleetSourceSeries(BaseModel):
    source_id: str
    online: bool
    timestamp_ms: list[int]
    avg: list[float]
    min: list[float]
    max: list[float]
    count: list[int]


class FleetMetricsResponse(BaseModel):
    metric: str
    interval: str
    sources_online: int
    sources_w_metric: int
    sources: list[FleetSourceSeries]
    truncated: bool = False
