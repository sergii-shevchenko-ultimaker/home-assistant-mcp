export interface SystemHealth {
  status: "ok" | "degraded" | "error";
  homeAssistant: {
    reachable: boolean;
    message?: string;
  };
  addon: {
    reachable: boolean;
    version?: string;
    configRoot?: string;
    snapshotsCount?: number;
    memoryMb?: number;
    error?: string;
  };
}

export interface SnapshotInfo {
  snapshot_id: string;
  original_relative_path: string;
  created_at: string;
  size_bytes: number;
  label: string;
  is_new_file?: boolean;
  backup_filename?: string;
}

export interface BackupRestoreResult {
  success: boolean;
  restored_file: string;
  restored_from: string;
  safety_backup: string;
}

export interface LogsTailResult {
  lines: string[];
  count: number;
}
