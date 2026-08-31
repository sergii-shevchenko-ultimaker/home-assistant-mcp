import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HARestClient } from "../clients/ha-rest.js";
import type { HAWsClient } from "../clients/ha-ws.js";
import type { AddonClient } from "../clients/addon-client.js";
import type { DashboardRenderer } from "../browser/renderer.js";

export interface ToolClients {
  restClient: HARestClient;
  wsClient: HAWsClient;
  addonClient: AddonClient;
  renderer: DashboardRenderer;
}

export type McpToolResult = CallToolResult;
