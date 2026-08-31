"""Sanitized log retrieval service."""

import os
from typing import Any

from ..core.security import sanitize_log_line


class LogService:
    """Service handling log tailing and secret sanitization."""

    @staticmethod
    def tail_logs(config_root: str, lines: int = 100) -> dict[str, Any]:
        """Read and sanitize the last N lines from home-assistant.log."""
        log_file = os.path.join(config_root, "home-assistant.log")
        if not os.path.isfile(log_file):
            return {"lines": [], "count": 0}

        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()

        tail_slice = all_lines[-lines:] if lines < len(all_lines) else all_lines
        sanitized = [sanitize_log_line(line.rstrip("\r\n")) for line in tail_slice]

        return {
            "lines": sanitized,
            "count": len(sanitized),
        }
