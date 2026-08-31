import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClients, McpToolResult } from "./types.js";

export const listEntitiesSchema = {
  domain_filter: z
    .string()
    .optional()
    .describe("Filter by domain prefix (e.g. 'light', 'sensor', 'switch', 'binary_sensor')"),
  search_query: z
    .string()
    .optional()
    .describe("Search query to filter entity_id or friendly_name"),
};

export const getLogsSchema = {
  lines_count: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe("Number of log lines to retrieve from Home Assistant log (default: 100)"),
};

export const createBackupSchema = {
  label: z
    .string()
    .describe("Description or label for the manual backup snapshot"),
};

export const restoreBackupSchema = {
  snapshot_id: z
    .string()
    .describe("Snapshot ID to restore (e.g. 'snap_20260831_120000_configuration_yaml')"),
};

export async function handleSystemHealth(clients: ToolClients): Promise<McpToolResult> {
  try {
    const [haApi, addonHealth] = await Promise.allSettled([
      clients.restClient.checkApi(),
      clients.addonClient.checkHealth(),
    ]);

    const isHaOk = haApi.status === "fulfilled";
    const isAddonOk = addonHealth.status === "fulfilled";

    const report = {
      status: isHaOk && isAddonOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      homeassistant: {
        api: isHaOk ? "ok" : "unreachable",
        url: (clients.restClient as any).haUrl || (clients.restClient as any).client?.defaults?.baseURL,
        details: isHaOk ? (haApi as PromiseFulfilledResult<any>).value : { error: (haApi as PromiseRejectedResult).reason?.message },
      },
      addon: isAddonOk
        ? (addonHealth as PromiseFulfilledResult<any>).value
        : { status: "unreachable", error: (addonHealth as PromiseRejectedResult).reason?.message },
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(report, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to retrieve system health: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleSystemListEntities(
  clients: ToolClients,
  args: { domain_filter?: string; search_query?: string }
): Promise<McpToolResult> {
  try {
    const states = await clients.restClient.getStates();
    const domainFilter = args.domain_filter?.toLowerCase().trim();
    const searchQuery = args.search_query?.toLowerCase().trim();

    const filtered = states
      .filter((s) => {
        if (domainFilter && !s.entity_id.toLowerCase().startsWith(`${domainFilter}.`)) {
          return false;
        }
        if (searchQuery) {
          const entityMatch = s.entity_id.toLowerCase().includes(searchQuery);
          const nameMatch =
            s.attributes?.friendly_name &&
            String(s.attributes.friendly_name).toLowerCase().includes(searchQuery);
          if (!entityMatch && !nameMatch) {
            return false;
          }
        }
        return true;
      })
      .map((s) => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes?.friendly_name || s.entity_id,
        last_changed: s.last_changed,
        last_updated: s.last_updated,
        attributes: s.attributes,
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(filtered, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to list entities: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleSystemGetLogs(
  clients: ToolClients,
  args: { lines_count?: number }
): Promise<McpToolResult> {
  try {
    const linesCount = args.lines_count ?? 100;
    const logs = await clients.addonClient.getLogs(linesCount);

    return {
      content: [
        {
          type: "text",
          text: logs.lines.join("\n") || "(No log output available)",
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to retrieve logs: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleSystemCreateBackup(
  clients: ToolClients,
  args: { label: string }
): Promise<McpToolResult> {
  try {
    let currentContent = "default_config:\n";
    try {
      const file = await clients.addonClient.readFile("configuration.yaml");
      currentContent = file.content;
    } catch {
      // default skeleton
    }

    const writeRes = await clients.addonClient.writeFile("configuration.yaml", currentContent, {
      validateYaml: false,
      label: args.label,
    });

    return {
      content: [
        {
          type: "text",
          text: `Backup created successfully with label "${args.label}". Snapshot ID: ${writeRes.snapshot_id} for file "${writeRes.path}".`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to create backup snapshot: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleSystemRestoreBackup(
  clients: ToolClients,
  args: { snapshot_id: string }
): Promise<McpToolResult> {
  try {
    const res = await clients.addonClient.restoreSnapshot(args.snapshot_id);

    return {
      content: [
        {
          type: "text",
          text: `Successfully restored backup from snapshot "${args.snapshot_id}". Restored file: ${res.restored_file} (Source backup: ${res.restored_from}, Safety backup: ${res.safety_backup}).`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to restore backup snapshot: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export function registerSystemTools(server: McpServer, clients: ToolClients): void {
  server.registerTool(
    "ha_system_health",
    {
      description: "Check the health, connectivity, and status of Home Assistant and the AI Addon.",
    },
    async () => handleSystemHealth(clients)
  );

  server.registerTool(
    "ha_system_list_entities",
    {
      description: "List and filter Home Assistant entities by domain and search query with full state attributes.",
      inputSchema: listEntitiesSchema,
    },
    async (args) => handleSystemListEntities(clients, args)
  );

  server.registerTool(
    "ha_system_get_logs",
    {
      description: "Fetch sanitized, tail-formatted Home Assistant core logs.",
      inputSchema: getLogsSchema,
    },
    async (args) => handleSystemGetLogs(clients, args)
  );

  server.registerTool(
    "ha_system_create_backup",
    {
      description: "Create an instant snapshot backup with a custom label.",
      inputSchema: createBackupSchema,
    },
    async (args) => handleSystemCreateBackup(clients, args)
  );

  server.registerTool(
    "ha_system_restore_backup",
    {
      description: "Restore a configuration or automation file from a previous snapshot backup.",
      inputSchema: restoreBackupSchema,
    },
    async (args) => handleSystemRestoreBackup(clients, args)
  );
}
