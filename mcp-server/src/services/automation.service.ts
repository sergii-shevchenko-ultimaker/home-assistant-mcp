import { IHARestClient } from "../domain/ports/ha-client.port.js";
import { IAddonClient } from "../domain/ports/addon-client.port.js";
import { AutomationSummary } from "../domain/models/automation.js";
import { ValidationError } from "../core/errors.js";

function splitYamlBlocks(yamlContent: string): string[] {
  if (!yamlContent.trim()) {
    return [];
  }
  const lines = yamlContent.split("\n");
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (line.startsWith("- ") && currentBlock.length > 0) {
      blocks.push(currentBlock.join("\n").trim());
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    const trimmed = currentBlock.join("\n").trim();
    if (trimmed) {
      blocks.push(trimmed);
    }
  }

  return blocks;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockMatchesIdOrAlias(block: string, targetId: string): boolean {
  const idRegex = new RegExp(`(^|\\n)\\s*-\\s*id:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)|(^|\\n)\\s*id:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)`, "i");
  const aliasRegex = new RegExp(`(^|\\n)\\s*alias:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)`, "i");
  return idRegex.test(block) || aliasRegex.test(block);
}

export class AutomationService {
  constructor(
    private readonly restClient: IHARestClient,
    private readonly addonClient: IAddonClient
  ) {}

  async listAutomations(domain: "automation" | "script" | "scene" = "automation"): Promise<AutomationSummary[]> {
    const states = await this.restClient.getStates();
    const prefix = `${domain}.`;

    return states
      .filter((s) => s.entity_id.startsWith(prefix))
      .map((s) => ({
        entity_id: s.entity_id,
        id: s.attributes?.id || s.entity_id.replace(prefix, ""),
        alias: s.attributes?.friendly_name || s.attributes?.alias,
        state: s.state,
        description: s.attributes?.description,
        last_triggered: s.attributes?.last_triggered || null,
      }));
  }

  async readAutomation(automationId: string): Promise<string> {
    const cleanId = automationId.replace(/^automation\./, "").trim();
    const file = await this.addonClient.readFile("automations.yaml");
    const blocks = splitYamlBlocks(file.content);

    const matchedBlock = blocks.find((b) => blockMatchesIdOrAlias(b, cleanId));
    if (!matchedBlock) {
      throw new ValidationError(`Automation "${cleanId}" not found in automations.yaml`);
    }

    return matchedBlock;
  }

  async writeAutomation(
    automationId: string,
    yamlCode: string,
    label?: string
  ): Promise<{ success: boolean; snapshotId: string; path: string }> {
    const cleanId = automationId.replace(/^automation\./, "").trim();

    let existingContent = "";
    try {
      const fileRes = await this.addonClient.readFile("automations.yaml");
      existingContent = fileRes.content;
    } catch {
      existingContent = "";
    }

    const blocks = splitYamlBlocks(existingContent);
    let formattedNewBlock = yamlCode.trim();

    if (!formattedNewBlock.startsWith("- ")) {
      const lines = formattedNewBlock.split("\n");
      const firstLine = `- ${lines[0]}`;
      const restLines = lines.slice(1).map((l) => (l.trim() ? `  ${l}` : l));
      formattedNewBlock = [firstLine, ...restLines].join("\n");
    }

    const existingIndex = blocks.findIndex((b) => blockMatchesIdOrAlias(b, cleanId));
    if (existingIndex >= 0) {
      blocks[existingIndex] = formattedNewBlock;
    } else {
      blocks.push(formattedNewBlock);
    }

    const updatedYaml = blocks.join("\n\n") + "\n";
    const snapshotLabel = label || `Update automation ${cleanId}`;

    const writeRes = await this.addonClient.writeFile("automations.yaml", updatedYaml, {
      validateYaml: true,
      label: snapshotLabel,
    });

    try {
      await this.restClient.callService("automation", "reload");
    } catch {
      // Reload is best-effort
    }

    return {
      success: true,
      snapshotId: writeRes.snapshot_id,
      path: writeRes.path,
    };
  }

  async triggerAutomation(entityId: string): Promise<{ success: boolean; entityId: string }> {
    const cleanEntityId = entityId.trim();
    const domain = cleanEntityId.split(".")[0] || "automation";

    await this.restClient.callService(domain, "trigger", { entity_id: cleanEntityId });

    return {
      success: true,
      entityId: cleanEntityId,
    };
  }
}
