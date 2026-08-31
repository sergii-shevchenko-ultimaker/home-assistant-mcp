import { chromium, Browser, BrowserContext } from "playwright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export interface RendererConfig {
  haUrl: string;
  haToken: string;
  browserStateDir?: string;
}

export interface RenderOptions {
  urlPath: string;
  viewport?: { width: number; height: number };
  devicePreset?: "desktop" | "tablet" | "mobile";
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

export const DEVICE_PRESETS: Record<"desktop" | "tablet" | "mobile", { width: number; height: number }> = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

export function resolveViewport(options: RenderOptions): { width: number; height: number } {
  if (options.viewport) {
    return options.viewport;
  }
  if (options.devicePreset && DEVICE_PRESETS[options.devicePreset]) {
    return DEVICE_PRESETS[options.devicePreset];
  }
  return DEVICE_PRESETS.desktop;
}

export function resolveUrl(baseUrl: string, urlPath: string): string {
  if (!urlPath) {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }
  if (/^https?:\/\//i.test(urlPath)) {
    return urlPath;
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = urlPath.replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

export class DashboardRenderer {
  private config: RendererConfig;
  private browser: Browser | null = null;

  constructor(config: RendererConfig) {
    this.config = {
      ...config,
      haUrl: config.haUrl.replace(/\/+$/, ""),
      browserStateDir: config.browserStateDir || path.join(os.homedir(), ".ha-ai"),
    };
  }

  get isInitialized(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  async initBrowser(headless: boolean = true): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      return;
    }
    if (this.config.browserStateDir) {
      try {
        await fs.mkdir(this.config.browserStateDir, { recursive: true });
      } catch {
        // Ignore directory creation error
      }
    }
    this.browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }

  async setupAuth(context: BrowserContext): Promise<void> {
    const authPayload = JSON.stringify({
      access_token: this.config.haToken,
      token_type: "Bearer",
      expires_in: 1800,
      refresh_token: "",
      hassUrl: this.config.haUrl,
      clientId: this.config.haUrl,
    });

    await context.addInitScript((tokensStr: string) => {
      try {
        const globalObj = globalThis as unknown as { localStorage?: { setItem: (k: string, v: string) => void } };
        if (globalObj.localStorage) {
          globalObj.localStorage.setItem("hassTokens", tokensStr);
          globalObj.localStorage.setItem("dockedSidebar", '"auto"');
        }
      } catch {
        // Ignore localStorage access errors
      }
    }, authPayload);
  }

  async captureDashboard(options: RenderOptions): Promise<RenderResult> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.initBrowser(true);
    }

    const viewport = resolveViewport(options);
    const targetUrl = resolveUrl(this.config.haUrl, options.urlPath);
    const timeout = options.timeoutMs ?? 15000;

    const colorScheme =
      options.darkMode === true
        ? "dark"
        : options.darkMode === false
        ? "light"
        : "no-preference";

    const context = await this.browser!.newContext({
      viewport,
      colorScheme,
      deviceScaleFactor: 1,
    });

    try {
      await this.setupAuth(context);
      const page = await context.newPage();

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      try {
        await page.waitForLoadState("networkidle", {
          timeout: Math.min(timeout, 4000),
        });
      } catch {
        // Continue if networkidle takes longer
      }

      try {
        await page.waitForSelector(
          "home-assistant, home-assistant-main, hui-view, ha-card, #root, body",
          { timeout: Math.min(timeout, 4000) }
        );
      } catch {
        // Continue if custom selector not present
      }

      let imageBuffer: Buffer;
      if (options.elementSelector) {
        const element = await page.waitForSelector(options.elementSelector, {
          timeout,
          state: "visible",
        });
        if (!element) {
          throw new Error(`Element selector "${options.elementSelector}" not found`);
        }
        imageBuffer = await element.screenshot({ type: "png" });
      } else {
        imageBuffer = await page.screenshot({
          type: "png",
          fullPage: false,
        });
      }

      const base64Png = imageBuffer.toString("base64");

      return {
        imageBuffer,
        base64Png,
        width: viewport.width,
        height: viewport.height,
        url: targetUrl,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      } finally {
        this.browser = null;
      }
    }
  }
}
