# System Design: Home Assistant AI MCP Server, Lightweight HA Addon & Skills

**Date:** 2026-08-31  
**Status:** Approved  
**Repository:** `ha-ai`

---

## 1. Overview & Goals

The `ha-ai` platform enables an autonomous AI agent to safely inspect, configure, iterate on, and visually test a remote Home Assistant OS instance.

### Primary Objectives
1. **Visual Dashboard Iteration:** Enable the AI agent to create and modify Lovelace dashboards, immediately render them headlessly via client-side Playwright, inspect the screenshots for visual bugs or styling issues, and iteratively refine card layouts.
2. **Full Lifecycle Configuration Management:** Provide tools to view and modify automations (`automations.yaml`), scripts (`scripts.yaml`), Lovelace storage configs, and query live entity states.
3. **Paranoid Security:** Strict path jailing within `/config`, constant-time API key verification, automatic secret redactions (`secrets.yaml`, `.storage/core.auth`, etc.), and zero unauthorized remote command execution.
4. **Lightweight Server-Side Footprint:** A minimal Python FastAPI container running as a Home Assistant OS Addon (< 35MB RAM, ~0% idle CPU) with zero heavy browser or ML dependencies on the HA host.
5. **Fail-Safe Rollback:** Mandatory atomic snapshot creation before every mutating file operation, coupled with single-call rollback capabilities.

---

## 2. System Architecture

```
+-----------------------------------------------------------------------------------+
| LOCAL WORKSTATION                                                                 |
|                                                                                   |
|  +--------------------+                                                           |
|  |    AI Agent        |                                                           |
|  |  (Antigravity)     |                                                           |
|  +---------+----------+                                                           |
|            | MCP Protocol (stdio / JSON-RPC)                                      |
|  +---------v----------+         +-----------------------------------+             |
|  |  Local MCP Server  |-------->| Client-Side Playwright Engine     |             |
|  |  (TypeScript)      |         | (Renders Lovelace UI Views to PNG)|             |
|  +----+----------+----+         +-----------------+-----------------+             |
+-------|----------|--------------------------------|-------------------------------+
        |          |                                |
        | HTTPS / WS                                | HTTPS (Browser Web UI)
        | (HA Token)                                |
        |          | HTTP:8099 (X-Addon-API-Key)    |
+-------v----------v--------------------------------v-------------------------------+
| REMOTE HOME ASSISTANT OS HOST                                                     |
|                                                                                   |
|  +--------------------+               +----------------------------------------+  |
|  | Home Assistant Core|               | Custom HA Addon (Docker Container)     |  |
|  | (REST & WS APIs)   |               | - Python 3.11 / FastAPI (Alpine)       |  |
|  +--------------------+               +-------------------+--------------------+  |
|                                                           | Mounts /config         |
|                                                           v                        |
|                                           +------------------------------------+  |
|                                           | HA Storage & Filesystem (/config)  |  |
|                                           | - automations.yaml, scripts.yaml   |  |
|                                           | - .storage/lovelace*               |  |
|                                           | - .snapshots/ (auto pre-snapshots) |  |
|                                           | - home-assistant.log               |  |
|                                           +------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Component Specification

### Component 1: Lightweight HA Addon (`addon/`)

Built as a Home Assistant OS Add-on utilizing an Alpine Linux Python base image.

#### Key Security Guards
* **Constant-Time Auth:** Request header `X-Addon-API-Key` compared using `hmac.compare_digest`.
* **Path Traversal Jail:** All requested paths are canonicalized via `os.path.realpath`. Any path resolving outside `/config` triggers an immediate `403 Forbidden`.
* **Deny List & Secret Redaction:**
  * Strict write/read lock on sensitive files: `.storage/core.auth`, `.storage/core.config_entries`, `secrets.yaml`, SSL keys (`*.pem`), SSH private keys.
  * Filter regex for sensitive patterns (`password`, `token`, `secret`, `api_key`) applied on log streaming.
* **Atomic Pre-Edit Snapshots:** Before any file write, the addon makes an atomic copy of the target file into `/config/.snapshots/YYYYMMDD_HHMMSS_<filename>.bak`.

#### REST API Endpoints

| Endpoint | Method | Headers | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/health` | GET | `X-Addon-API-Key` | Healthcheck, HA Core status, container memory/CPU metrics. |
| `/api/v1/file/read` | POST | `X-Addon-API-Key` | Safely reads file contents from `/config` with deny-list protection. |
| `/api/v1/file/write` | POST | `X-Addon-API-Key` | Validates YAML, creates pre-snapshot, writes file atomically. |
| `/api/v1/backup/list` | GET | `X-Addon-API-Key` | Lists all snapshots available in `/config/.snapshots/`. |
| `/api/v1/backup/restore` | POST | `X-Addon-API-Key` | Restores a target snapshot file instantly over current active file. |
| `/api/v1/logs/tail` | GET | `X-Addon-API-Key` | Returns the last $N$ lines of `home-assistant.log` with secret sanitization. |

---

### Component 2: Local MCP Server (`mcp-server/`)

Built with TypeScript using `@modelcontextprotocol/sdk` and `playwright`.

#### Structure
```
mcp-server/
├── src/
│   ├── index.ts               # Stdio MCP entrypoint
│   ├── config.ts              # Environment configuration & validation
│   ├── clients/
│   │   ├── ha-rest.ts         # REST API client (entity states, service execution)
│   │   ├── ha-ws.ts           # WebSocket client (Lovelace WS protocol)
│   │   └── addon-client.ts    # Secure HTTP client to the HA Addon
│   ├── browser/
│   │   └── renderer.ts        # Playwright headless browser session manager
│   └── tools/
│       ├── dashboard.ts       # ha_dashboard_* tool definitions
│       ├── automation.ts      # ha_automation_* tool definitions
│       └── system.ts          # ha_system_* tool definitions
├── package.json
└── tsconfig.json
```

#### Playwright Headless Renderer
* Stores authenticated session storage state in local cache (`~/.ha-ai/browser-state.json`).
* Configurable viewports: Desktop (`1920x1080`), Tablet (`768x1024`), Mobile (`375x812`).
* Supports dark mode / light mode toggle emulation.
* Automatically waits for custom Lovelace web components (`ha-card`, `hui-card`) to resolve before capturing the PNG screenshot.

#### Exposed MCP Tools

1. **Dashboard Tools:**
   * `ha_dashboard_get_config`: Retrieve raw YAML/JSON Lovelace configuration for default or secondary dashboards.
   * `ha_dashboard_save_config`: Validate YAML schema, trigger Addon snapshot, and commit dashboard updates.
   * `ha_dashboard_render_screenshot`: Open target dashboard path in local Playwright browser and return PNG image.
2. **Automation Tools:**
   * `ha_automation_list`: List all active automations/scripts with IDs, state, and trigger descriptions.
   * `ha_automation_read`: Fetch YAML definition of a specific automation.
   * `ha_automation_write`: Validate syntax and safely save an automation block.
   * `ha_automation_trigger`: Execute an automation action for testing and validation.
3. **System & Safety Tools:**
   * `ha_system_list_entities`: Query entity registry with domain filtering and search queries.
   * `ha_system_get_logs`: Fetch the last $N$ lines of sanitized HA logs.
   * `ha_system_create_backup`: Create a manual disk snapshot in `/config/.snapshots/`.
   * `ha_system_restore_backup`: Roll back to a specific snapshot ID upon error.

---

### Component 3: AI Skill Pack (`skills/`)

1. **`ha-dashboard-designer`:**
   * SOP for querying entity states, constructing Lovelace card layouts, applying changes, capturing Playwright screenshots, evaluating visual layout, and iterating until approved.
2. **`ha-automation-builder`:**
   * SOP for drafting automations, checking entity schemas/services, writing YAML safely, triggering actions, and validating execution against log traces.
3. **`ha-troubleshooter`:**
   * SOP for reading sanitized system logs, identifying broken integrations or invalid configuration references, and executing safety rollbacks if errors occur.

---

## 4. Verification & Testing Plan

1. **HA Addon Unit & Security Tests:**
   * Path traversal attack test suite (e.g. `../../etc/passwd`, `../../.storage/core.auth`).
   * API Key timing attack resistance and unauthorized request rejection (`401`/`403`).
   * Snapshot creation and rollback integrity checks.
2. **Local MCP Server Tests:**
   * Schema validation tests for all MCP tool inputs and outputs.
   * Mocked HA REST / WebSocket connection handlers.
   * Playwright browser rendering and screenshot generation tests across desktop and mobile viewports.
3. **End-to-End Integration Verification:**
   * Modify a test Lovelace dashboard via MCP tool.
   * Capture rendered screenshot and verify visual changes.
   * Trigger intentional rollback and verify original configuration restoration.
