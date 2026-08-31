export type DevicePreset = "desktop" | "tablet" | "mobile";

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface RenderOptions {
  urlPath: string;
  viewport?: ViewportDimensions;
  devicePreset?: DevicePreset;
  darkMode?: boolean;
  elementSelector?: string;
  timeoutMs?: number;
}

export interface RenderResult {
  imageBuffer: Buffer;
  base64Png: string;
  width: number;
  height: number;
  url: string;
}
