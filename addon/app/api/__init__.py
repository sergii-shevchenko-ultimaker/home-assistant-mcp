"""API routing and registration module."""

from fastapi import APIRouter, Depends

from ..core.config import verify_token
from .routes import backups, files, health, logs

api_v1 = APIRouter(prefix="/api/v1", dependencies=[Depends(verify_token)])
api_v1.include_router(health.router)
api_v1.include_router(files.router)
api_v1.include_router(backups.router)
api_v1.include_router(logs.router)

__all__ = ["api_v1"]
