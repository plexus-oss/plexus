from pydantic import BaseModel


class DeviceResponse(BaseModel):
    source_id: str
    online: bool
    last_seen_ms: int | None


class DeviceListResponse(BaseModel):
    devices: list[DeviceResponse]
