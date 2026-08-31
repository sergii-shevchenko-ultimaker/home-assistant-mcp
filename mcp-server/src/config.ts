import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const configSchema = z.object({
  HA_URL: z.string().default("http://localhost:8123"),
  HA_TOKEN: z.string().default(""),
  ADDON_URL: z.string().default("http://localhost:8099"),
  ADDON_KEY: z.string().default(""),
  BROWSER_STATE_DIR: z.string().default(() => path.join(os.homedir(), ".ha-ai")),
});

export interface AppConfig {
  haUrl: string;
  haToken: string;
  addonUrl: string;
  addonKey: string;
  browserStateDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse({
    HA_URL: env.HA_URL || undefined,
    HA_TOKEN: env.HA_TOKEN !== undefined ? env.HA_TOKEN : undefined,
    ADDON_URL: env.ADDON_URL || undefined,
    ADDON_KEY: env.ADDON_KEY !== undefined ? env.ADDON_KEY : undefined,
    BROWSER_STATE_DIR: env.BROWSER_STATE_DIR || undefined,
  });

  return {
    haUrl: parsed.HA_URL.replace(/\/+$/, ""),
    haToken: parsed.HA_TOKEN,
    addonUrl: parsed.ADDON_URL.replace(/\/+$/, ""),
    addonKey: parsed.ADDON_KEY,
    browserStateDir: parsed.BROWSER_STATE_DIR,
  };
}
