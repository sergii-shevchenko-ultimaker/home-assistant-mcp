import axios, { AxiosInstance } from "axios";
import {
  AddonHealthResult,
  FileReadResult,
  FileWriteResult,
  IAddonClient,
} from "../../domain/ports/addon-client.port.js";
import { BackupRestoreResult, LogsTailResult, SnapshotInfo } from "../../domain/models/system.js";
import { ClientError } from "../../core/errors.js";

export interface AddonClientOptions {
  addonUrl: string;
  addonKey: string;
  timeoutMs?: number;
}

export class AddonAdapter implements IAddonClient {
  private readonly client: AxiosInstance;

  constructor(options: AddonClientOptions | string, addonKey?: string) {
    let url: string;
    let key: string;
    let timeout = 10000;

    if (typeof options === "string") {
      url = options;
      key = addonKey ?? "";
    } else {
      url = options.addonUrl;
      key = options.addonKey;
      timeout = options.timeoutMs ?? 10000;
    }

    const cleanUrl = url.replace(/\/+$/, "");

    this.client = axios.create({
      baseURL: cleanUrl,
      timeout,
      headers: {
        "X-Addon-API-Key": key,
        "Content-Type": "application/json",
      },
    });
  }

  async checkHealth(): Promise<AddonHealthResult> {
    try {
      const resp = await this.client.get<AddonHealthResult>("/api/v1/health");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon health check failed: ${err.message}`, err.response?.status);
    }
  }

  async readFile(path: string): Promise<FileReadResult> {
    try {
      const resp = await this.client.post<FileReadResult>("/api/v1/file/read", { path });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon readFile failed: ${err.message}`, err.response?.status);
    }
  }

  async writeFile(
    path: string,
    content: string,
    options: { validateYaml?: boolean; label?: string } = {}
  ): Promise<FileWriteResult> {
    try {
      const resp = await this.client.post<FileWriteResult>("/api/v1/file/write", {
        path,
        content,
        validate_yaml: options.validateYaml ?? true,
        label: options.label ?? "",
      });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon writeFile failed: ${err.message}`, err.response?.status);
    }
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    try {
      const resp = await this.client.get<SnapshotInfo[]>("/api/v1/backup/list");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon listSnapshots failed: ${err.message}`, err.response?.status);
    }
  }

  async restoreSnapshot(snapshotId: string): Promise<BackupRestoreResult> {
    try {
      const resp = await this.client.post<BackupRestoreResult>("/api/v1/backup/restore", {
        snapshot_id: snapshotId,
      });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon restoreSnapshot failed: ${err.message}`, err.response?.status);
    }
  }

  async getLogs(lines: number = 100): Promise<LogsTailResult> {
    try {
      const resp = await this.client.get<LogsTailResult>(`/api/v1/logs/tail?lines=${lines}`);
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon getLogs failed: ${err.message}`, err.response?.status);
    }
  }
}

// Backward-compatible alias
export { AddonAdapter as AddonClient };
