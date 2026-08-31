# Home Assistant AI MCP Server, Addon & Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, modular, and paranoid-secure Home Assistant AI integration consisting of a lightweight HA OS Addon, a local TypeScript MCP Server with client-side Playwright rendering, and a structured AI Skill Pack for dashboard and automation iteration.

**Architecture:** A lightweight Python/FastAPI container on HA OS handles atomic snapshots, guarded file writes, and log reading behind constant-time API key auth. A local TypeScript MCP server communicates with HA Core (REST/WS), the Addon, and drives a local Playwright browser to capture dashboard screenshots for AI visual feedback. Three modular markdown skills guide agent workflows.

**Tech Stack:** 
- HA Addon: Python 3.11, Alpine base (`ghcr.io/home-assistant/amd64-base-python:3.11-alpine`), FastAPI, Uvicorn, Pydantic, PyYAML, aiofiles, pytest
- Local MCP Server: TypeScript, Node.js 20+, `@modelcontextprotocol/sdk`, Playwright, Axios/Fetch, ws, Vitest/Jest
- AI Skills: OpenCode / Antigravity Markdown SOPs

## Global Constraints
- Paranoid Security: Strictly jail file access within `/config`. Disallow reading/writing `.storage/core.auth`, `secrets.yaml`, SSH keys, and SSL certificates.
- Constant-time verification for `X-Addon-API-Key` via `hmac.compare_digest`.
- Mandatory auto-snapshot in `/config/.snapshots/` before any file modification.
- Lightweight Addon footprint (< 35MB RAM, ~0% idle CPU).
- No embedded browser or ML inside HA Addon; all rendering stays local in MCP server.
- Bite-sized, easily testable tasks with no external mystery dependencies.

---

### Task 1: Project Scaffolding & Monorepo Structure

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `addon/pyproject.toml`
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`

**Interfaces:**
- Produces: Base workspace directory layout for `addon/`, `mcp-server/`, and `skills/`.

- [ ] **Step 1: Write root `.gitignore` and workspace configurations**
- [ ] **Step 2: Initialize root `package.json` with scripts for building both TypeScript MCP and testing Python addon**
- [ ] **Step 3: Setup `addon/pyproject.toml` for Python dependencies and pytest configuration**
- [ ] **Step 4: Setup `mcp-server/package.json` with `@modelcontextprotocol/sdk`, `playwright`, `ws`, `zod`, and `vitest`**
- [ ] **Step 5: Verify setup runs `npm install` and Python venv installs without error**
- [ ] **Step 6: Commit:** `git commit -m "chore: scaffold project directories, package.json, and tsconfig"`

---

### Task 2: HA Addon - Security Guard & Path Jail Module (Python)

**Files:**
- Create: `addon/app/security.py`
- Test: `addon/tests/test_security.py`

**Interfaces:**
- Produces:
  - `verify_api_key(provided_key: str, expected_key: str) -> bool`
  - `sanitize_path(config_root: str, requested_path: str) -> str` (raises `SecurityException` on jailbreak or deny-list hit)
  - `sanitize_log_line(line: str) -> str` (redacts password/token/key matches)

- [ ] **Step 1: Write failing test in `addon/tests/test_security.py` covering path traversal (`../../etc/passwd`, `../../.storage/core.auth`), `secrets.yaml` rejection, and constant-time API key verification**
- [ ] **Step 2: Run `pytest addon/tests/test_security.py` and verify failure**
- [ ] **Step 3: Implement `addon/app/security.py` using `hmac.compare_digest`, `os.path.realpath`, and regex sanitization**
- [ ] **Step 4: Run `pytest addon/tests/test_security.py` and verify all tests pass**
- [ ] **Step 5: Commit:** `git commit -m "feat(addon): implement paranoid security guard and path jail module"`

---

### Task 3: HA Addon - Snapshot & Backup Manager (Python)

**Files:**
- Create: `addon/app/snapshots.py`
- Test: `addon/tests/test_snapshots.py`

**Interfaces:**
- Produces:
  - `create_snapshot(config_root: str, relative_path: str) -> str` (returns snapshot filepath)
  - `list_snapshots(config_root: str) -> list[dict]`
  - `restore_snapshot(config_root: str, snapshot_filename: str) -> bool`

- [ ] **Step 1: Write failing test in `addon/tests/test_snapshots.py` for creating timestamped backups in `.snapshots/`, listing backups, and atomically restoring a previous file**
- [ ] **Step 2: Run `pytest addon/tests/test_snapshots.py` to confirm failure**
- [ ] **Step 3: Implement `addon/app/snapshots.py` using `shutil.copy2` and atomic replacement**
- [ ] **Step 4: Run `pytest addon/tests/test_snapshots.py` to confirm passes**
- [ ] **Step 5: Commit:** `git commit -m "feat(addon): implement atomic pre-edit snapshot and rollback manager"`

---

### Task 4: HA Addon - FastAPI Server & HA OS Addon Packaging

**Files:**
- Create: `addon/app/main.py`
- Create: `addon/config.yaml`
- Create: `addon/Dockerfile`
- Create: `addon/run.sh`
- Test: `addon/tests/test_api.py`

**Interfaces:**
- Consumes: `security.py`, `snapshots.py`
- Produces: REST endpoints (`/api/v1/health`, `/api/v1/file/read`, `/api/v1/file/write`, `/api/v1/backup/list`, `/api/v1/backup/restore`, `/api/v1/logs/tail`)

- [ ] **Step 1: Write failing tests in `addon/tests/test_api.py` with `httpx.AsyncClient` / `TestClient` verifying all endpoints with valid and invalid `X-Addon-API-Key`**
- [ ] **Step 2: Run `pytest addon/tests/test_api.py` to verify failure**
- [ ] **Step 3: Implement `addon/app/main.py` with FastAPI, dependency-injected security, and YAML validation gates**
- [ ] **Step 4: Create HA Addon metadata: `addon/config.yaml`, `addon/Dockerfile`, and startup `addon/run.sh`**
- [ ] **Step 5: Run `pytest addon/tests/` to verify all addon tests pass**
- [ ] **Step 6: Commit:** `git commit -m "feat(addon): complete lightweight FastAPI server and HA OS addon manifest"`

---

### Task 5: Local MCP Server - Configuration & HA Clients (TypeScript)

**Files:**
- Create: `mcp-server/src/config.ts`
- Create: `mcp-server/src/clients/ha-rest.ts`
- Create: `mcp-server/src/clients/ha-ws.ts`
- Create: `mcp-server/src/clients/addon-client.ts`
- Test: `mcp-server/tests/clients.test.ts`

**Interfaces:**
- Produces:
  - `HARestClient`: `getStates()`, `callService(domain, service, data)`
  - `HAWsClient`: `connect()`, `getLovelaceConfig(urlPath?)`, `saveLovelaceConfig(config, urlPath?)`
  - `AddonClient`: `readFile(path)`, `writeFile(path, content)`, `listSnapshots()`, `restoreSnapshot(id)`, `getLogs(lines)`

- [ ] **Step 1: Write failing unit test in `mcp-server/tests/clients.test.ts` mocking REST, WS, and Addon HTTP endpoints**
- [ ] **Step 2: Run `npm test` in `mcp-server` to confirm failure**
- [ ] **Step 3: Implement `config.ts`, `ha-rest.ts`, `ha-ws.ts`, and `addon-client.ts`**
- [ ] **Step 4: Run `npm test` in `mcp-server` to confirm all client tests pass**
- [ ] **Step 5: Commit:** `git commit -m "feat(mcp): implement HA REST, WebSocket, and Addon API clients"`

---

### Task 6: Local MCP Server - Playwright Headless Renderer (TypeScript)

**Files:**
- Create: `mcp-server/src/browser/renderer.ts`
- Test: `mcp-server/tests/renderer.test.ts`

**Interfaces:**
- Produces:
  - `DashboardRenderer`: `initBrowser()`, `authenticateSession()`, `captureDashboardView(options: RenderOptions) -> Promise<Buffer>`
  - `RenderOptions`: `{ urlPath: string, viewport?: { width: number, height: number }, darkMode?: boolean, elementSelector?: string }`

- [ ] **Step 1: Write failing unit/mock test in `mcp-server/tests/renderer.test.ts` validating Playwright launch options, session storage persistence path, and screenshot output buffer format**
- [ ] **Step 2: Run `npm test` to verify test fails**
- [ ] **Step 3: Implement `mcp-server/src/browser/renderer.ts` with auto-wait for `ha-card` / `hui-card` components and session reuse**
- [ ] **Step 4: Run `npm test` to verify renderer tests pass**
- [ ] **Step 5: Commit:** `git commit -m "feat(mcp): implement client-side Playwright headless dashboard renderer"`

---

### Task 7: Local MCP Server - Tool Registrations & MCP Stdio Server (TypeScript)

**Files:**
- Create: `mcp-server/src/tools/dashboard.ts`
- Create: `mcp-server/src/tools/automation.ts`
- Create: `mcp-server/src/tools/system.ts`
- Create: `mcp-server/src/index.ts`
- Test: `mcp-server/tests/tools.test.ts`

**Interfaces:**
- Consumes: All clients and `DashboardRenderer`
- Produces: Fully registered MCP Server running on `stdio` exposing `ha_dashboard_*`, `ha_automation_*`, and `ha_system_*` tools.

- [ ] **Step 1: Write failing tool execution test in `mcp-server/tests/tools.test.ts` calling tools with Zod schema validation**
- [ ] **Step 2: Run `npm test` to verify test fails**
- [ ] **Step 3: Implement `dashboard.ts`, `automation.ts`, `system.ts`, and wire into `index.ts` using `@modelcontextprotocol/sdk/server/mcp.js`**
- [ ] **Step 4: Build TypeScript code (`npm run build`) and run test suite**
- [ ] **Step 5: Commit:** `git commit -m "feat(mcp): implement MCP tool definitions and stdio server entrypoint"`

---

### Task 8: AI Skill Pack (`skills/`)

**Files:**
- Create: `skills/ha-dashboard-designer/SKILL.md`
- Create: `skills/ha-automation-builder/SKILL.md`
- Create: `skills/ha-troubleshooter/SKILL.md`
- Test: `skills/tests/validate-skills.test.ts` (Verifies frontmatter, tool references, and valid markdown schema)

**Interfaces:**
- Produces: 3 production-ready OpenCode/Antigravity skills for dashboard visual iteration, automation design, and safe rollback troubleshooting.

- [ ] **Step 1: Write `skills/ha-dashboard-designer/SKILL.md` with step-by-step SOP on querying entities, updating Lovelace YAML, taking Playwright screenshots, and iteratively polishing cards**
- [ ] **Step 2: Write `skills/ha-automation-builder/SKILL.md` with SOP on drafting YAML, validating entity IDs, triggering actions, and inspecting execution logs**
- [ ] **Step 3: Write `skills/ha-troubleshooter/SKILL.md` with safety SOP on analyzing sanitized logs, checking health, and triggering snapshot rollbacks**
- [ ] **Step 4: Add skill validation test and verify all skill files match schema**
- [ ] **Step 5: Commit:** `git commit -m "docs(skills): add ha-dashboard-designer, ha-automation-builder, and ha-troubleshooter skills"`

---

### Task 9: End-to-End Verification & Documentation

**Files:**
- Create: `README.md`
- Create: `docs/setup-guide.md`
- Test: `tests/e2e/smoke.test.ts`

- [ ] **Step 1: Create an end-to-end smoke test verifying the complete workflow: reading config, modifying with auto-snapshot, taking a mock Playwright render, and restoring backup**
- [ ] **Step 2: Write `docs/setup-guide.md` covering HA Addon installation in HA OS, generating API keys, and connecting Antigravity/Claude Code via `mcpServers` config**
- [ ] **Step 3: Write comprehensive root `README.md` with quickstart instructions**
- [ ] **Step 4: Run full test suite across Python and TypeScript modules**
- [ ] **Step 5: Commit:** `git commit -m "chore: add setup guide, documentation, and e2e smoke verification test"`
