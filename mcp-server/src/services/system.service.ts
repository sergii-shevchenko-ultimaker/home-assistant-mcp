import { IHARestClient } from "../domain/ports/ha-client.port.js";
import { IAddonClient } from "../domain/ports/addon-client.port.js";
import { BackupRestoreResult, LogsTailResult, SnapshotInfo, SystemHealth } from "../domain/models/system.js";
import { HAEntityState } from "../domain/models/entity.js";

export class SystemService {
  constructor(
    private readonly restClient: IHARestClient,
    private readonly addonClient: IAddonClient
  ) {}

  async getHealth(): Promise<SystemHealth> {
    let haOk = false;
    let haMsg = "";
    try {
      const resp = await this.restClient.checkApi();
      haOk = true;
      haMsg = resp.message || "API running";
    } catch (err: any) {
      haMsg = err.message;
    }

    let addonOk = false;
    let addonInfo: any = {};
    try {
      const health = await this.addonClient.checkHealth();
      addonOk = true;
      addonInfo = health;
    } catch (err: any) {
      addonInfo = { error: err.message };
    }

    const overallStatus: "ok" | "degraded" | "error" =
      haOk && addonOk ? "ok" : haOk || addonOk ? "degraded" : "error";

    return {
      status: overallStatus,
      homeAssistant: {
        reachable: haOk,
        message: haMsg,
      },
      addon: {
        reachable: addonOk,
        version: addonInfo.version,
        configRoot: addonInfo.config_root,
        snapshotsCount: addonInfo.snapshots_count,
        memoryMb: addonInfo.memory_mb,
        error: addonInfo.error,
      },
    };
  }

  async listEntities(domainFilter?: string, searchQuery?: string): Promise<HAEntityState[]> {
    const states = await this.restClient.getStates();

    return states.filter((s) => {
      if (domainFilter && !s.entity_id.startsWith(`${domainFilter}.`)) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const entityMatches = s.entity_id.toLowerCase().includes(q);
        const nameMatches = String(s.attributes?.friendly_name || "").toLowerCase().includes(q);
        if (!entityMatches && !nameMatches) {
          return false;
        }
      }
      return true;
    });
  }

  async getLogs(lines: number = 100): Promise<LogsTailResult> {
    return this.addonClient.getLogs(lines);
  }

  async createBackup(label: string = "manual-checkpoint"): Promise<{ snapshot_id: string; label: string }> {
    const res = await this.addonClient.writeFile("automations.yaml", "", {
      validateYaml: false,
      label,
    });
    return {
      snapshot_id: res.snapshot_id,
      label,
    };
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.addonClient.listSnapshots();
  }

  async restoreBackup(snapshotId: string): Promise<BackupRestoreResult> {
    return this.addonClient.restoreSnapshot(snapshotId);
  }
}
