#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { HARestClient } from "./clients/ha-rest.js";
import { HAWsClient } from "./clients/ha-ws.js";
import { AddonClient } from "./clients/addon-client.js";
import { DashboardRenderer } from "./browser/renderer.js";

import { registerDashboardTools } from "./tools/dashboard.js";
import { registerAutomationTools } from "./tools/automation.js";
import { registerSystemTools } from "./tools/system.js";
import type { ToolClients } from "./tools/types.js";

export function createServer(customClients?: ToolClients): {
  server: McpServer;
  clients: ToolClients;
} {
  const config = loadConfig();

  const clients: ToolClients = customClients || {
    restClient: new HARestClient({
      haUrl: config.haUrl,
      haToken: config.haToken,
    }),
    wsClient: new HAWsClient({
      haUrl: config.haUrl,
      haToken: config.haToken,
    }),
    addonClient: new AddonClient({
      addonUrl: config.addonUrl,
      addonKey: config.addonKey,
    }),
    renderer: new DashboardRenderer({
      haUrl: config.haUrl,
      haToken: config.haToken,
      browserStateDir: config.browserStateDir,
    }),
  };

  const server = new McpServer({
    name: "ha-ai-mcp",
    version: "0.1.0",
  });

  registerDashboardTools(server, clients);
  registerAutomationTools(server, clients);
  registerSystemTools(server, clients);

  return { server, clients };
}

export async function main(): Promise<void> {
  const { server, clients } = createServer();

  let isShuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    console.error(`[ha-ai-mcp] Received ${signal}, shutting down gracefully...`);

    try {
      await Promise.allSettled([
        clients.renderer.close(),
        clients.wsClient.disconnect(),
        server.close(),
      ]);
    } catch (err: any) {
      console.error(`[ha-ai-mcp] Error during shutdown: ${err.message}`);
    } finally {
      process.exit(0);
    }
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  console.error("[ha-ai-mcp] Connecting Home Assistant MCP server via Stdio transport...");
  await server.connect(transport);
  console.error("[ha-ai-mcp] Home Assistant MCP server running on stdio.");
}

// Automatically run main if invoked directly from CLI
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("[ha-ai-mcp] Fatal error starting server:", err);
    process.exit(1);
  });
}
