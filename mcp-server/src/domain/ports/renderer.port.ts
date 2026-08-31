import { RenderOptions, RenderResult } from "../models/dashboard.js";

export interface IDashboardRenderer {
  initBrowser(headless?: boolean): Promise<void>;
  close(): Promise<void>;
  captureDashboard(options: RenderOptions): Promise<RenderResult>;
}
