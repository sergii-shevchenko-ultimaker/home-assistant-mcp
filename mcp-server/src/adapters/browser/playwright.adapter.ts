import path from "path";
import os from "os";
import { Browser, BrowserContext, chromium } from "playwright";
import { IDashboardRenderer } from "../../domain/ports/renderer.port.js";
import { DevicePreset, RenderOptions, RenderResult, ViewportDimensions } from "../../domain/models/dashboard.js";
import { ClientError } from "../../core/errors.js";

export interface RendererConfig {
  haUrl: string;
  haToken: string;
  browserStateDir?: string;
}

export const DEVICE_PRESETS: Record<DevicePreset, ViewportDimensions> = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

export function resolveViewport(options: RenderOptions): ViewportDimensions {
  if (options.viewport) {
    return options.viewport;
  }
  if (options.devicePreset && DEVICE_PRESETS[options.devicePreset]) {
    return DEVICE_PRESETS[options.devicePreset];
  }
  return DEVICE_PRESETS.desktop;
}

export function resolveUrl(baseUrl: string, urlPath: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
    return urlPath;
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  return cleanPath ? `${cleanBase}/${cleanPath}` : `${cleanBase}/`;
}

export class PlaywrightDashboardAdapter implements IDashboardRenderer {
  private readonly haUrl: string;
  private readonly haToken: string;
  private readonly browserStateDir: string;
  private browser: Browser | null = null;

  constructor(config: RendererConfig) {
    this.haUrl = config.haUrl.replace(/\/+$/, "");
    this.haToken = config.haToken;
    this.browserStateDir = config.browserStateDir || path.join(os.homedir(), ".ha-ai");
  }

  get isInitialized(): boolean {
    return this.browser !== null;
  }

  async initBrowser(headless: boolean = true): Promise<void> {
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({
          headless,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
      } catch (err: any) {
        throw new ClientError(`Failed to launch Chromium browser via Playwright: ${err.message}`);
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  resolveViewport(options: RenderOptions): ViewportDimensions {
    return resolveViewport(options);
  }

  resolveUrl(urlPath: string): string {
    return resolveUrl(this.haUrl, urlPath);
  }

  async setupAuth(context: BrowserContext): Promise<void> {
    const authData = {
      access_token: this.haToken,
      token_type: "Bearer",
      expires_in: 315360000,
      hassUrl: this.haUrl,
    };

    await context.addInitScript(
      (data) => {
        try {
          const storage = (globalThis as any).localStorage;
          if (storage) {
            storage.setItem("hassTokens", JSON.stringify(data));
            storage.setItem("dockedSidebar", '"auto"');
          }
        } catch {
          // ignore in environments without localStorage
        }
      },
      authData
    );
  }

  async captureDashboard(options: RenderOptions): Promise<RenderResult> {
    await this.initBrowser(true);

    if (!this.browser) {
      throw new ClientError("Browser instance is not initialized");
    }

    const viewport = this.resolveViewport(options);
    const targetUrl = this.resolveUrl(options.urlPath);
    const timeoutMs = options.timeoutMs ?? 15000;

    let colorScheme: "dark" | "light" | "no-preference" = "no-preference";
    if (options.darkMode === true) {
      colorScheme = "dark";
    } else if (options.darkMode === false) {
      colorScheme = "light";
    }

    const context = await this.browser.newContext({
      viewport,
      colorScheme,
      deviceScaleFactor: 1,
    });

    try {
      await this.setupAuth(context);
      const page = await context.newPage();

      try {
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });

        await Promise.race([
          page.waitForLoadState("networkidle", { timeout: 3000 }),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]).catch(() => {});

        try {
          await page.waitForSelector("home-assistant, home-assistant-main, hui-view, ha-card", {
            timeout: 2000,
          });
        } catch {
          // Continue if selector is delayed
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err: any) {
        throw new ClientError(`Failed loading dashboard at ${targetUrl}: ${err.message}`);
      }

      let buffer: Buffer;

      if (options.elementSelector) {
        const element = await page.$(options.elementSelector);
        if (!element) {
          throw new ClientError(`Element selector not found on page: ${options.elementSelector}`);
        }
        buffer = await element.screenshot({ type: "png" });
      } else {
        buffer = await page.screenshot({ type: "png", fullPage: false });
      }

      const base64Png = buffer.toString("base64");

      return {
        imageBuffer: buffer,
        base64Png,
        width: viewport.width,
        height: viewport.height,
        url: targetUrl,
      };
    } finally {
      await context.close();
    }
  }
}

export { PlaywrightDashboardAdapter as DashboardRenderer };
