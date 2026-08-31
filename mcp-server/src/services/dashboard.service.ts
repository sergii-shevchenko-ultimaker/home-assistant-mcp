import { IHAWsClient } from "../domain/ports/ha-client.port.js";
import { IAddonClient } from "../domain/ports/addon-client.port.js";
import { IDashboardRenderer } from "../domain/ports/renderer.port.js";
import { RenderOptions, RenderResult } from "../domain/models/dashboard.js";

export class DashboardService {
  constructor(
    private readonly wsClient: IHAWsClient,
    private readonly addonClient: IAddonClient,
    private readonly renderer: IDashboardRenderer
  ) {}

  async getConfig(dashboardSlug?: string): Promise<{ source: string; config: any; rawContent?: string }> {
    try {
      const config = await this.wsClient.getLovelaceConfig(dashboardSlug ?? null);
      if (config) {
        return {
          source: "websocket",
          config,
          rawContent: JSON.stringify(config, null, 2),
        };
      }
    } catch {
      // Fallback to Addon file read
    }

    const candidatePaths = dashboardSlug && dashboardSlug !== "lovelace"
      ? [`dashboards/${dashboardSlug}.yaml`, `.storage/lovelace.${dashboardSlug}`]
      : ["ui-lovelace.yaml", ".storage/lovelace"];

    for (const filePath of candidatePaths) {
      try {
        const file = await this.addonClient.readFile(filePath);
        return {
          source: `addon_file:${filePath}`,
          config: file.content,
          rawContent: file.content,
        };
      } catch {
        continue;
      }
    }

    return {
      source: "empty",
      config: { title: "Home", views: [] },
      rawContent: "title: Home\nviews: []\n",
    };
  }

  async saveConfig(
    configYaml: string,
    dashboardSlug?: string,
    label: string = "mcp-dashboard-update"
  ): Promise<{ success: boolean; snapshotId?: string; message: string }> {
    const slug = dashboardSlug?.trim() || "lovelace";
    const targetFile = slug !== "lovelace" ? `dashboards/${slug}.yaml` : "ui-lovelace.yaml";

    const writeResult = await this.addonClient.writeFile(targetFile, configYaml, {
      validateYaml: true,
      label,
    });

    try {
      const parsed = JSON.parse(configYaml);
      if (typeof parsed === "object" && parsed !== null) {
        await this.wsClient.saveLovelaceConfig(parsed, slug === "lovelace" ? null : slug);
      }
    } catch {
      // Not JSON or WS save skipped; YAML file write succeeded
    }

    return {
      success: true,
      snapshotId: writeResult.snapshot_id,
      message: `Dashboard configuration successfully saved to "${targetFile}". Pre-edit snapshot ID: ${writeResult.snapshot_id}.`,
    };
  }

  async renderScreenshot(options: RenderOptions): Promise<RenderResult> {
    return this.renderer.captureDashboard(options);
  }
}
