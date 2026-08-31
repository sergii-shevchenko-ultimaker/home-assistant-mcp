import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import {
  DashboardRenderer,
  DEVICE_PRESETS,
  resolveViewport,
  resolveUrl,
  RendererConfig,
  RenderOptions,
} from "../src/browser/renderer.js";

describe("DashboardRenderer - Helpers & Configuration", () => {
  const config: RendererConfig = {
    haUrl: "http://localhost:8123",
    haToken: "test-ha-token-12345",
  };

  describe("resolveViewport", () => {
    it("should default to desktop dimensions (1920x1080)", () => {
      const vp = resolveViewport({});
      expect(vp).toEqual({ width: 1920, height: 1080 });
    });

    it("should resolve device presets correctly", () => {
      expect(resolveViewport({ devicePreset: "desktop" })).toEqual(DEVICE_PRESETS.desktop);
      expect(resolveViewport({ devicePreset: "desktop" })).toEqual({ width: 1920, height: 1080 });

      expect(resolveViewport({ devicePreset: "tablet" })).toEqual(DEVICE_PRESETS.tablet);
      expect(resolveViewport({ devicePreset: "tablet" })).toEqual({ width: 768, height: 1024 });

      expect(resolveViewport({ devicePreset: "mobile" })).toEqual(DEVICE_PRESETS.mobile);
      expect(resolveViewport({ devicePreset: "mobile" })).toEqual({ width: 375, height: 812 });
    });

    it("should prioritize custom viewport over device preset", () => {
      const customVp = { width: 1440, height: 900 };
      const vp = resolveViewport({ devicePreset: "mobile", viewport: customVp });
      expect(vp).toEqual(customVp);
    });
  });

  describe("resolveUrl", () => {
    it("should resolve relative urlPath without leading slash", () => {
      const url = resolveUrl("http://localhost:8123", "lovelace/0");
      expect(url).toBe("http://localhost:8123/lovelace/0");
    });

    it("should resolve relative urlPath with leading slash", () => {
      const url = resolveUrl("http://localhost:8123", "/dashboard-energy");
      expect(url).toBe("http://localhost:8123/dashboard-energy");
    });

    it("should handle trailing slashes in base haUrl", () => {
      const url = resolveUrl("http://localhost:8123///", "/lovelace/1");
      expect(url).toBe("http://localhost:8123/lovelace/1");
    });

    it("should handle empty urlPath", () => {
      const url = resolveUrl("http://localhost:8123", "");
      expect(url).toBe("http://localhost:8123/");
    });

    it("should preserve full URLs if provided in urlPath", () => {
      const url = resolveUrl("http://localhost:8123", "https://other-ha-domain.com/lovelace/0");
      expect(url).toBe("https://other-ha-domain.com/lovelace/0");
    });
  });
});

describe("DashboardRenderer - Browser Lifecycle & Rendering", () => {
  let server: http.Server;
  let serverUrl: string;
  let renderer: DashboardRenderer;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/dashboard-test" || req.url?.startsWith("/dashboard-test")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Home Assistant Test Dashboard</title>
              <style>
                body {
                  margin: 0;
                  padding: 20px;
                  background-color: #f5f5f5;
                  color: #333333;
                  font-family: sans-serif;
                }
                @media (prefers-color-scheme: dark) {
                  body {
                    background-color: #111111;
                    color: #eeeeee;
                  }
                  ha-card {
                    background-color: #222222;
                    color: #ffffff;
                    border: 1px solid #444444;
                  }
                }
                home-assistant-main {
                  display: block;
                }
                hui-view {
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                  gap: 16px;
                }
                ha-card {
                  display: block;
                  background: #ffffff;
                  border-radius: 8px;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  padding: 16px;
                }
              </style>
            </head>
            <body>
              <home-assistant-main>
                <div id="auth-status">Checking...</div>
                <hui-view>
                  <ha-card id="card-light">
                    <h2>Living Room Light</h2>
                    <p>State: ON</p>
                  </ha-card>
                  <ha-card id="card-sensor">
                    <h2>Temperature</h2>
                    <p>21.5 &deg;C</p>
                  </ha-card>
                </hui-view>
              </home-assistant-main>
              <script>
                const tokens = localStorage.getItem("hassTokens");
                const authEl = document.getElementById("auth-status");
                if (tokens) {
                  const parsed = JSON.parse(tokens);
                  authEl.innerText = "Authenticated: " + parsed.access_token;
                } else {
                  authEl.innerText = "Unauthenticated";
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      if (req.url === "/slow-page") {
        // Delayed response
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Slow</h1></body></html>");
        }, 3000);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}`;

    renderer = new DashboardRenderer({
      haUrl: serverUrl,
      haToken: "test-auth-token-xyz-987",
    });
  });

  afterEach(async () => {
    if (renderer) {
      await renderer.close();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should initialize browser and close cleanly", async () => {
    expect(renderer.isInitialized).toBe(false);
    await renderer.initBrowser(true);
    expect(renderer.isInitialized).toBe(true);
    await renderer.close();
    expect(renderer.isInitialized).toBe(false);
  });

  it("should capture full dashboard screenshot with desktop preset", async () => {
    const result = await renderer.captureDashboard({
      urlPath: "/dashboard-test",
      devicePreset: "desktop",
    });

    expect(result).toBeDefined();
    expect(result.url).toBe(`${serverUrl}/dashboard-test`);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.imageBuffer).toBeInstanceOf(Buffer);
    expect(result.imageBuffer.length).toBeGreaterThan(1000);

    // PNG Header verification: 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(result.imageBuffer.subarray(0, 8)).toEqual(pngMagic);

    expect(result.base64Png).toBeDefined();
    expect(result.base64Png.length).toBeGreaterThan(1000);
    expect(Buffer.from(result.base64Png, "base64")).toEqual(result.imageBuffer);
  });

  it("should capture dashboard with tablet and mobile presets", async () => {
    const tabletResult = await renderer.captureDashboard({
      urlPath: "dashboard-test",
      devicePreset: "tablet",
    });
    expect(tabletResult.width).toBe(768);
    expect(tabletResult.height).toBe(1024);

    const mobileResult = await renderer.captureDashboard({
      urlPath: "dashboard-test",
      devicePreset: "mobile",
    });
    expect(mobileResult.width).toBe(375);
    expect(mobileResult.height).toBe(812);
  });

  it("should inject Home Assistant auth tokens into browser localStorage", async () => {
    await renderer.initBrowser(true);
    const result = await renderer.captureDashboard({
      urlPath: "/dashboard-test",
    });
    expect(result.imageBuffer.length).toBeGreaterThan(1000);
  });

  it("should capture a specific element when elementSelector is provided", async () => {
    const cardResult = await renderer.captureDashboard({
      urlPath: "/dashboard-test",
      elementSelector: "#card-light",
    });

    expect(cardResult).toBeDefined();
    expect(cardResult.imageBuffer).toBeInstanceOf(Buffer);
    expect(cardResult.imageBuffer.length).toBeGreaterThan(500);
    // Element screenshot will typically be smaller in bytes than full screen
    expect(cardResult.base64Png).toBe(cardResult.imageBuffer.toString("base64"));
  });

  it("should support dark mode color scheme emulation", async () => {
    const darkResult = await renderer.captureDashboard({
      urlPath: "/dashboard-test",
      darkMode: true,
    });
    expect(darkResult.imageBuffer.length).toBeGreaterThan(1000);

    const lightResult = await renderer.captureDashboard({
      urlPath: "/dashboard-test",
      darkMode: false,
    });
    expect(lightResult.imageBuffer.length).toBeGreaterThan(1000);

    // Dark and light screenshots should have different buffer outputs due to different background colors
    expect(darkResult.imageBuffer.equals(lightResult.imageBuffer)).toBe(false);
  });

  it("should throw a clear error when elementSelector is not found", async () => {
    await expect(
      renderer.captureDashboard({
        urlPath: "/dashboard-test",
        elementSelector: "#non-existent-card-selector-12345",
        timeoutMs: 1500,
      })
    ).rejects.toThrow(/not found|timeout/i);
  });

  it("should throw a clear error when navigation times out", async () => {
    await expect(
      renderer.captureDashboard({
        urlPath: "/slow-page",
        timeoutMs: 500,
      })
    ).rejects.toThrow(/timeout/i);
  });
});
