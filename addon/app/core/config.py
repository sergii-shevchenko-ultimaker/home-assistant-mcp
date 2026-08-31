"""Configuration and dependency injection helpers for the HA Addon."""

import json
import os
from fastapi import Header, HTTPException, status

from .security import verify_api_key


def get_config_root() -> str:
    """Return the Home Assistant configuration directory path."""
    return os.environ.get("CONFIG_ROOT", "/config")


def get_api_key() -> str:
    """Return the configured Addon API Key."""
    env_key = os.environ.get("ADDON_API_KEY", "")
    if env_key:
        return env_key

    options_path = "/data/options.json"
    if os.path.isfile(options_path):
        try:
            with open(options_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return str(data.get("api_key", ""))
        except Exception:
            pass

    return ""


def verify_token(
    x_addon_api_key: str | None = Header(default=None, alias="X-Addon-API-Key"),
) -> None:
    """FastAPI dependency to authenticate requests using constant-time comparison."""
    expected_key = get_api_key()
    if not x_addon_api_key or not verify_api_key(x_addon_api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Addon-API-Key header",
        )
