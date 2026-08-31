# Home Assistant AI Helper App

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

A lightweight, paranoid-secure Home Assistant companion app enabling autonomous AI agents (such as Antigravity, Claude Code, Gemini CLI, OpenCode, and Cursor) to safely read, modify, snapshot, and validate configurations and automations.

---

## Features

- 🛡️ **Paranoid Security**: Strict path jailing within `/config`, constant-time API key verification, and sensitive credential protection (`secrets.yaml`, `.storage/core.auth`, SSH keys, and certificates are strictly blocked).
- 🔄 **Atomic Snapshots & Rollback**: Automatically creates timestamped pre-edit snapshots in `/config/.snapshots/` before every file modification.
- 🪶 **Ultra Lightweight**: Minimal Python FastAPI Alpine container with `< 35MB` RAM usage and `~0%` idle CPU.
- 📜 **Sanitized Logs**: Streams tail logs with passwords, tokens, and API keys automatically redacted.

---

## Configuration

In Home Assistant, navigate to **Settings** -> **Apps** -> **Home Assistant AI Helper** -> **Configuration**:

```yaml
api_key: "your-strong-random-secret-key"
```

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `api_key` | `string` | **Yes** | Shared secret API key used by the local MCP server (`X-Addon-API-Key` header). |

---

## Exposed Endpoints (Port 8099)

All endpoints require authentication via `X-Addon-API-Key` header:

- `GET /api/v1/health`: App status, version, and memory usage.
- `POST /api/v1/file/read`: Safe read of configuration files in `/config`.
- `POST /api/v1/file/write`: Safe atomic write with YAML syntax validation and pre-edit snapshot.
- `GET /api/v1/backup/list`: List existing snapshot backups in `/config/.snapshots/`.
- `POST /api/v1/backup/restore`: Restore a snapshot backup with automatic pre-restore safety backup.
- `GET /api/v1/logs/tail`: Retrieve recent sanitized Home Assistant logs.
