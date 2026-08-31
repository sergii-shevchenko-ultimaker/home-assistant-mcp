import type { HARestAdapter } from "../adapters/ha/ha-rest.adapter.js";
import type { HAWsAdapter } from "../adapters/ha/ha-ws.adapter.js";
import type { AddonAdapter } from "../adapters/addon/addon.adapter.js";
import type { PlaywrightDashboardAdapter } from "../adapters/browser/playwright.adapter.js";

export interface ToolClients {
  restClient: HARestAdapter;
  wsClient: HAWsAdapter;
  addonClient: AddonAdapter;
  renderer: PlaywrightDashboardAdapter;
}

export interface McpToolTextContent {
  type: "text";
  text: string;
}

export interface McpToolImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type McpToolContent = McpToolTextContent | McpToolImageContent;

export interface McpToolResult {
  [x: string]: unknown;
  content: McpToolContent[];
  isError?: boolean;
}
