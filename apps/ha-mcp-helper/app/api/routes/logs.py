"""Sanitized log retrieval endpoints."""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ...core.config import get_config_root
from ...services.log_service import LogService
from ..schemas import LogsTailResponse

router = APIRouter(tags=["Logs"])


@router.get("/logs/tail", response_model=LogsTailResponse)
def tail_logs(
    lines: int = Query(default=100, ge=1, le=1000),
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Tail and redact credentials from recent Home Assistant logs."""
    try:
        return LogService.tail_logs(config_root, lines=lines)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read logs: {err}",
        )
