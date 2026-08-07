from fastapi import APIRouter

from app.api.v1 import commands, fleet, logs, metrics, sources, video

router = APIRouter(prefix="/v1")

router.include_router(sources.router)
router.include_router(metrics.router)
router.include_router(logs.router)
router.include_router(video.router)
router.include_router(commands.router)
router.include_router(fleet.router)
