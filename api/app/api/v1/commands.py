import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import GatewayClient, OrgID

log = logging.getLogger(__name__)

router = APIRouter(prefix="/sources/{source_id}/commands", tags=["commands"])


class CommandRequest(BaseModel):
    command: str
    params: dict = {}


class CommandResponse(BaseModel):
    queued: bool


@router.post("", response_model=CommandResponse)
async def send_command(source_id: str, body: CommandRequest, org_id: OrgID, gw: GatewayClient):
    try:
        queued = await gw.send_command(org_id, source_id, body.command, body.params)
    except httpx.HTTPError as e:
        # Only genuine gateway/transport failures are a 502; anything else
        # (bugs, bad state) propagates as a 500 so it isn't masked.
        log.warning("gateway command failed for %s/%s: %s", org_id, source_id, e)
        raise HTTPException(status_code=502, detail="gateway unreachable")
    return CommandResponse(queued=queued)
