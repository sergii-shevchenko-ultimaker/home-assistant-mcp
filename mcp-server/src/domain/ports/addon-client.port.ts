import { BackupRestoreResult, LogsTailResult, SnapshotInfo } from "../models/system.js";

export interface FileReadResult {
  path: string;
  content: string;
  size_bytes: number;
}

export interface FileWriteResult {
  success: boolean;
  path: string;
  snapshot_id: string;
  bytes_written: number;
}

export interface AddonHealthResult {
  status: string;
  version: string;
  config_root: string;
  snapshots_count: number;
  memory_mb: number;
}

export interface IAddonClient {
  checkHealth(): Promise<AddonHealthResult>;
  readFile(path: string): Promise<FileReadResult>;
  writeFile(
    path: string,
    content: string,
    options?: { validateYaml?: boolean; label?: string }
  ): Promise<FileWriteResult>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  restoreSnapshot(snapshotId: string): Promise<BackupRestoreResult>;
  getLogs(lines?: number): Promise<LogsTailResult>;
}
