"""File read and write endpoints."""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from ...core.config import get_config_root
from ...core.security import SecurityException
from ...services.file_service import FileService
from ..schemas import FileReadRequest, FileReadResponse, FileWriteRequest, FileWriteResponse

router = APIRouter(tags=["Files"])


@router.post("/file/read", response_model=FileReadResponse)
def read_file(
    req: FileReadRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Safely read file contents within configuration root."""
    try:
        return FileService.read_file(config_root, req.path)
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except FileNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {err}",
        )


@router.post("/file/write", response_model=FileWriteResponse)
def write_file(
    req: FileWriteRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Atomically write file with validation and automatic pre-edit snapshot."""
    try:
        return FileService.write_file(
            config_root=config_root,
            relative_path=req.path,
            content=req.content,
            validate_yaml=req.validate_yaml,
            label=req.label,
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file: {err}",
        )
