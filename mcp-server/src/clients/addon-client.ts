import axios, { type AxiosInstance } from "axios";

export interface AddonClientOptions {
  addonUrl: string;
  addonKey: string;
  timeout?: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  config_root: string;
  snapshots_count: number;
  memory_mb: number;
}

export interface FileReadResponse {
  path: string;
  content: string;
  size_bytes: number;
}

export interface FileWriteResponse {
  success: boolean;
  path: string;
  snapshot_id: string;
  bytes_written: number;
}

export interface SnapshotInfo {
  snapshot_id: string;
  timestamp: string;
  original_file: string;
  backup_file: string;
  label: string;
  file_size_bytes: number;
}

export interface BackupRestoreResponse {
  success: boolean;
  restored_file: string;
  restored_from: string;
  safety_backup: string;
}

export interface LogsTailResponse {
  lines: string[];
  count: number;
}

export interface WriteFileOptions {
  validateYaml?: boolean;
  label?: string;
}

export class AddonClient {
  private readonly client: AxiosInstance;
  public readonly addonUrl: string;
  public readonly addonKey: string;

  constructor(optionsOrUrl: AddonClientOptions | string, addonKey?: string) {
    if (typeof optionsOrUrl === "string") {
      this.addonUrl = optionsOrUrl.replace(/\/+$/, "");
      this.addonKey = addonKey || "";
      this.client = axios.create({
        baseURL: this.addonUrl,
        timeout: 10000,
        headers: {
          "X-Addon-API-Key": this.addonKey,
          "Content-Type": "application/json",
        },
      });
    } else {
      this.addonUrl = optionsOrUrl.addonUrl.replace(/\/+$/, "");
      this.addonKey = optionsOrUrl.addonKey;
      this.client = axios.create({
        baseURL: this.addonUrl,
        timeout: optionsOrUrl.timeout ?? 10000,
        headers: {
          "X-Addon-API-Key": this.addonKey,
          "Content-Type": "application/json",
        },
      });
    }
  }

  /**
   * Check Addon health and memory status.
   */
  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await this.client.get<HealthResponse>("/api/v1/health");
      return response.data;
    } catch (error: any) {
      this.handleAxiosError("checkHealth", error);
    }
  }

  /**
   * Read file content from /config through the secured path jail.
   */
  async readFile(path: string): Promise<FileReadResponse> {
    try {
      const response = await this.client.post<FileReadResponse>("/api/v1/file/read", { path });
      return response.data;
    } catch (error: any) {
      this.handleAxiosError(`readFile(${path})`, error);
    }
  }

  /**
   * Atomically write file content with pre-edit snapshot.
   */
  async writeFile(
    path: string,
    content: string,
    options?: WriteFileOptions
  ): Promise<FileWriteResponse> {
    try {
      const response = await this.client.post<FileWriteResponse>("/api/v1/file/write", {
        path,
        content,
        validate_yaml: options?.validateYaml ?? true,
        label: options?.label ?? "",
      });
      return response.data;
    } catch (error: any) {
      this.handleAxiosError(`writeFile(${path})`, error);
    }
  }

  /**
   * List all pre-edit snapshots.
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    try {
      const response = await this.client.get<SnapshotInfo[]>("/api/v1/backup/list");
      return response.data;
    } catch (error: any) {
      this.handleAxiosError("listSnapshots", error);
    }
  }

  /**
   * Restore a file from a snapshot or rollback a created file.
   */
  async restoreSnapshot(snapshotId: string): Promise<BackupRestoreResponse> {
    try {
      const response = await this.client.post<BackupRestoreResponse>("/api/v1/backup/restore", {
        snapshot_id: snapshotId,
      });
      return response.data;
    } catch (error: any) {
      this.handleAxiosError(`restoreSnapshot(${snapshotId})`, error);
    }
  }

  /**
   * Tail sanitized Home Assistant logs.
   */
  async getLogs(lines = 100): Promise<LogsTailResponse> {
    try {
      const response = await this.client.get<LogsTailResponse>(
        `/api/v1/logs/tail?lines=${encodeURIComponent(lines)}`
      );
      return response.data;
    } catch (error: any) {
      this.handleAxiosError(`getLogs(${lines})`, error);
    }
  }

  private handleAxiosError(context: string, error: any): never {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const detail =
        typeof error.response.data === "object"
          ? (error.response.data as any).detail || JSON.stringify(error.response.data)
          : String(error.response.data);
      throw new Error(
        `Addon API Error on ${context} [HTTP ${status}]: ${detail || error.message}`
      );
    }
    throw new Error(`Addon API Request Failed on ${context}: ${error.message || String(error)}`);
  }
}
